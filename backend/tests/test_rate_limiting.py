import httpx
import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.database import get_db
from app.core.rate_limit import RateLimiter, get_client_ip, rate_limiter
from app.main import app
from app.models.base import Base


@pytest_asyncio.fixture
async def db_session():
    test_engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(
        bind=test_engine,
        class_=AsyncSession,
        expire_on_commit=False,
        autoflush=False,
    )

    async with session_factory() as session:
        yield session

    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await test_engine.dispose()


@pytest_asyncio.fixture
async def client(db_session: AsyncSession):
    rate_limiter.clear_all()
    async def _override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = _override_get_db
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()
    rate_limiter.clear_all()


def test_rate_limiter_unit_sliding_window():
    limiter = RateLimiter()
    key = "test_user_key"

    for _ in range(5):
        limiter.check(key=key, max_requests=5, window_seconds=60, detail="Rate limit exceeded")

    with pytest.raises(Exception) as exc_info:
        limiter.check(key=key, max_requests=5, window_seconds=60, detail="Rate limit exceeded")

    err = exc_info.value
    assert getattr(err, "status_code", None) == 429
    assert "Retry-After" in getattr(err, "headers", {})


def test_rate_limiter_unit_reset():
    limiter = RateLimiter()
    key = "failed_attempts_key"

    for _ in range(3):
        limiter.record(key=key, window_seconds=300)

    limiter.reset(key)
    limiter.check_limit_exceeded(key=key, max_requests=3, window_seconds=300, detail="Bloqueado")


def test_get_client_ip_headers():
    class DummyRequest:
        def __init__(self, headers=None, host="127.0.0.1"):
            self.headers = headers or {}
            self.client = type("Client", (), {"host": host})()

    req_cf = DummyRequest(headers={"CF-Connecting-IP": "203.0.113.19"})
    assert get_client_ip(req_cf) == "203.0.113.19"

    req_xff = DummyRequest(headers={"X-Forwarded-For": "198.51.100.42, 10.0.0.1"})
    assert get_client_ip(req_xff) == "198.51.100.42"

    req_direct = DummyRequest(headers={}, host="192.168.1.50")
    assert get_client_ip(req_direct) == "192.168.1.50"


@pytest.mark.asyncio
async def test_login_rate_limiting_after_consecutive_failures(client: httpx.AsyncClient):
    reg = await client.post(
        "/api/v1/auth/register",
        json={
            "name": "Security Target",
            "email": "target@auction.com",
            "password": "CorrectPassword123",
            "role": "BIDDER",
        },
    )
    assert reg.status_code == 201

    headers = {"CF-Connecting-IP": "198.51.100.5"}

    for _ in range(10):
        failed_res = await client.post(
            "/api/v1/auth/login",
            headers=headers,
            json={"email": "target@auction.com", "password": "WrongPassword"},
        )
        assert failed_res.status_code == 401

    blocked_res = await client.post(
        "/api/v1/auth/login",
        headers=headers,
        json={"email": "target@auction.com", "password": "CorrectPassword123"},
    )
    assert blocked_res.status_code == 429
    assert "Retry-After" in blocked_res.headers
    assert int(blocked_res.headers["Retry-After"]) > 0


@pytest.mark.asyncio
async def test_bid_rate_limiting_enforcement(client: httpx.AsyncClient):
    reg = await client.post(
        "/api/v1/auth/register",
        json={
            "name": "Fast Bidder",
            "email": "fast@auction.com",
            "password": "Password123",
            "role": "BIDDER",
        },
    )
    assert reg.status_code == 201
    bidder_token = reg.json()["access_token"]
    user_id = reg.json()["user"]["id"]

    for _ in range(30):
        rate_limiter.record(f"bids:{user_id}", window_seconds=60)

    res = await client.post(
        "/api/v1/lots/00000000-0000-0000-0000-000000000001/bids",
        headers={"Authorization": f"Bearer {bidder_token}"},
        json={"amount_cents": 200000},
    )
    assert res.status_code == 429
    assert "Retry-After" in res.headers
