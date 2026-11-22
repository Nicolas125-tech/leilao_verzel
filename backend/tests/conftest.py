import os
from pathlib import Path
import sys
import uuid

import httpx
import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool, StaticPool

backend_dir = Path(__file__).resolve().parent.parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

import app.models.lot  # noqa: E402, F401
import app.models.user  # noqa: E402, F401
import app.models.wallet  # noqa: E402, F401
from app.core.database import get_db  # noqa: E402
from app.core.privacy import generate_public_code, mask_name  # noqa: E402
from app.core.rate_limit import rate_limiter  # noqa: E402
from app.core.security import create_access_token, hash_password  # noqa: E402
from app.main import app  # noqa: E402
from app.models.base import Base  # noqa: E402
from app.models.user import User  # noqa: E402
from app.models.wallet import Wallet  # noqa: E402
from app.schemas.auth import UserResponse  # noqa: E402

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL", "").strip()
IS_POSTGRES = TEST_DATABASE_URL.startswith("postgresql")


@pytest.fixture
def is_postgres() -> bool:
    return IS_POSTGRES


@pytest_asyncio.fixture
async def session_factory():
    if IS_POSTGRES:
        test_engine = create_async_engine(
            TEST_DATABASE_URL,
            poolclass=NullPool,
            echo=False,
        )
    else:
        test_engine = create_async_engine(
            "sqlite+aiosqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
            echo=False,
        )

    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)

    factory = async_sessionmaker(
        bind=test_engine,
        class_=AsyncSession,
        expire_on_commit=False,
        autoflush=False,
    )

    yield factory

    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await test_engine.dispose()


@pytest_asyncio.fixture
async def db_session(session_factory: async_sessionmaker[AsyncSession]):
    async with session_factory() as session:
        yield session


@pytest_asyncio.fixture
async def client(session_factory: async_sessionmaker[AsyncSession]):
    rate_limiter.clear_all()

    async def _override_get_db():
        async with session_factory() as session:
            yield session

    app.dependency_overrides[get_db] = _override_get_db
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()
    rate_limiter.clear_all()


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
    payload = {
        "access_token": token,
        "token_type": "bearer",
        "user": UserResponse.model_validate(auctioneer).model_dump(mode="json"),
    }
    db_session.expunge_all()
    return payload
