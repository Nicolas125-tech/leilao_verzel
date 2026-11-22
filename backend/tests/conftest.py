from pathlib import Path
import sys
import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

backend_dir = Path(__file__).resolve().parent.parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from app.core.privacy import generate_public_code, mask_name  # noqa: E402
from app.core.security import create_access_token, hash_password  # noqa: E402
from app.models.user import User  # noqa: E402
from app.models.wallet import Wallet  # noqa: E402
from app.schemas.auth import UserResponse  # noqa: E402


async def create_auctioneer(
    db_session: AsyncSession,
    name: str,
    email: str,
    password: str = "StrongPassword123",
) -> dict:
    user_id = uuid.uuid4()
    public_code = generate_public_code(user_id, "AUCTIONEER")
    masked = mask_name(name, public_code)

    auctioneer = User(
        id=user_id,
        name=name,
        email=email,
        password_hash=hash_password(password),
        role="AUCTIONEER",
        public_code=public_code,
        masked_name=masked,
    )
    wallet = Wallet(
        user_id=user_id,
        total_balance_cents=0,
        committed_balance_cents=0,
    )
    db_session.add_all([auctioneer, wallet])
    await db_session.commit()
    await db_session.refresh(auctioneer)

    token = create_access_token(user_id=auctioneer.id, role=auctioneer.role)
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": UserResponse.model_validate(auctioneer).model_dump(mode="json"),
    }
