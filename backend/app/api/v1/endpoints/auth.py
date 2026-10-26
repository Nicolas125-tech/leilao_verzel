import uuid
from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.database import get_db
from app.core.privacy import generate_public_code, mask_name
from app.core.rate_limit import get_client_ip, rate_limiter
from app.core.security import create_access_token, hash_password, verify_password
from app.models.user import User
from app.models.wallet import Wallet
from app.schemas.auth import TokenResponse, UserLoginRequest, UserRegisterRequest, UserResponse

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def register(
    payload: UserRegisterRequest,
    db: AsyncSession = Depends(get_db),
):
    existing_user_query = await db.execute(select(User).where(User.email == payload.email))
    if existing_user_query.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Já existe um usuário cadastrado com este e-mail.",
        )

    user_id = uuid.uuid4()
    public_code = generate_public_code(user_id, payload.role)
    masked = mask_name(payload.name, public_code)
    hashed_pwd = hash_password(payload.password)

    new_user = User(
        id=user_id,
        name=payload.name,
        email=payload.email,
        password_hash=hashed_pwd,
        role=payload.role,
        public_code=public_code,
        masked_name=masked,
    )
    new_wallet = Wallet(
        user_id=user_id,
        total_balance_cents=0,
        committed_balance_cents=0,
    )

    db.add(new_user)
    db.add(new_wallet)
    await db.commit()
    await db.refresh(new_user)

    token = create_access_token(user_id=new_user.id, role=new_user.role)
    return TokenResponse(
        access_token=token,
        token_type="bearer",
        user=UserResponse.model_validate(new_user),
    )


@router.post("/login", response_model=TokenResponse)
async def login(
    payload: UserLoginRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    client_ip = get_client_ip(request)
    normalized_email = payload.email.lower().strip()
    rate_key = f"login_failed:{client_ip}:{normalized_email}"

    rate_limiter.check_limit_exceeded(
        key=rate_key,
        max_requests=10,
        window_seconds=900,
        detail="Muitas tentativas inválidas de autenticação. Por segurança, tente novamente em alguns minutos.",
    )

    result = await db.execute(select(User).where(User.email == payload.email))
    user = result.scalar_one_or_none()

    if not user or not verify_password(payload.password, user.password_hash):
        rate_limiter.record(rate_key, window_seconds=900)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="E-mail ou senha incorretos.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    rate_limiter.reset(rate_key)
    token = create_access_token(user_id=user.id, role=user.role)
    return TokenResponse(
        access_token=token,
        token_type="bearer",
        user=UserResponse.model_validate(user),
    )


@router.get("/me", response_model=UserResponse)
async def get_me(
    current_user: User = Depends(get_current_user),
):
    return UserResponse.model_validate(current_user)
