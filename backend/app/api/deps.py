from collections.abc import Callable
from uuid import UUID
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import decode_access_token
from app.models.user import User

bearer_scheme = HTTPBearer(auto_error=False)


async def _resolve_user_from_credentials(
    credentials: HTTPAuthorizationCredentials | None,
    db: AsyncSession,
) -> tuple[User | None, str | None]:
    if not credentials or not credentials.credentials:
        return None, "Token de autenticação ausente."

    payload = decode_access_token(credentials.credentials)
    if not payload:
        return None, "Token de autenticação inválido ou expirado."

    user_id_str = payload.get("sub")
    if not user_id_str:
        return None, "Token malformado."

    try:
        user_uuid = UUID(user_id_str)
    except ValueError:
        return None, "Identificador de usuário inválido no token."

    result = await db.execute(select(User).where(User.id == user_uuid))
    user = result.scalar_one_or_none()
    if not user:
        return None, "Usuário não encontrado."

    return user, None


async def get_optional_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> User | None:
    user, _ = await _resolve_user_from_credentials(credentials, db)
    return user


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    user, error_detail = await _resolve_user_from_credentials(credentials, db)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=error_detail or "Token de autenticação inválido.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


def require_role(allowed_roles: list[str]) -> Callable:
    async def _role_guard(current_user: User = Depends(get_current_user)) -> User:
        if current_user.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Acesso negado. Ação permitida apenas para: {', '.join(allowed_roles)}.",
            )
        return current_user

    return _role_guard


require_bidder = require_role(["BIDDER"])
require_auctioneer = require_role(["AUCTIONEER"])
