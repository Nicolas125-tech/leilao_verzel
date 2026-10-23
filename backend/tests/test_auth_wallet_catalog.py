import httpx
import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.database import get_db
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
    async def _override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = _override_get_db
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_register_bidder_and_fetch_me(client: httpx.AsyncClient):
    payload = {
        "name": "Nicolas Brito",
        "email": "nicolas@verzel.com.br",
        "password": "StrongPassword123",
        "role": "BIDDER",
    }
    resp = await client.post("/api/v1/auth/register", json=payload)
    assert resp.status_code == 201
    data = resp.json()

    assert "access_token" in data
    assert data["token_type"] == "bearer"
    user = data["user"]
    assert user["email"] == "nicolas@verzel.com.br"
    assert user["role"] == "BIDDER"
    assert user["public_code"].startswith("LIC-")
    assert "(N***s B.)" in user["masked_name"]
    assert "password" not in user
    assert "password_hash" not in user

    me_resp = await client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {data['access_token']}"},
    )
    assert me_resp.status_code == 200
    me_data = me_resp.json()
    assert me_data["id"] == user["id"]
    assert me_data["email"] == "nicolas@verzel.com.br"
    assert me_data["public_code"] == user["public_code"]


@pytest.mark.asyncio
async def test_register_duplicate_email_returns_conflict(client: httpx.AsyncClient):
    payload = {
        "name": "Helena Costa",
        "email": "helena@verzel.com.br",
        "password": "StrongPassword123",
        "role": "AUCTIONEER",
    }
    first = await client.post("/api/v1/auth/register", json=payload)
    assert first.status_code == 201
    assert first.json()["user"]["public_code"].startswith("LEI-")

    duplicate = await client.post("/api/v1/auth/register", json=payload)
    assert duplicate.status_code == 409


@pytest.mark.asyncio
async def test_login_valid_and_invalid_credentials(client: httpx.AsyncClient):
    await client.post(
        "/api/v1/auth/register",
        json={
            "name": "Carlos Mendes",
            "email": "carlos@verzel.com.br",
            "password": "SecretPass99",
            "role": "BIDDER",
        },
    )

    valid_login = await client.post(
        "/api/v1/auth/login",
        json={"email": "carlos@verzel.com.br", "password": "SecretPass99"},
    )
    assert valid_login.status_code == 200
    assert "access_token" in valid_login.json()

    wrong_password = await client.post(
        "/api/v1/auth/login",
        json={"email": "carlos@verzel.com.br", "password": "WrongPassword"},
    )
    assert wrong_password.status_code == 401

    unknown_email = await client.post(
        "/api/v1/auth/login",
        json={"email": "inexistente@verzel.com.br", "password": "SecretPass99"},
    )
    assert unknown_email.status_code == 401


@pytest.mark.asyncio
async def test_me_requires_valid_jwt_token(client: httpx.AsyncClient):
    unauth = await client.get("/api/v1/auth/me")
    assert unauth.status_code == 401

    invalid_token = await client.get(
        "/api/v1/auth/me",
        headers={"Authorization": "Bearer token.invalido.aqui"},
    )
    assert invalid_token.status_code == 401


@pytest.mark.asyncio
async def test_get_wallet_initial_balances(client: httpx.AsyncClient):
    reg = await client.post(
        "/api/v1/auth/register",
        json={
            "name": "Joao Licitante",
            "email": "joao.licitante@verzel.com.br",
            "password": "StrongPassword123",
            "role": "BIDDER",
        },
    )
    token = reg.json()["access_token"]

    resp = await client.get(
        "/api/v1/wallet",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["total_balance_cents"] == 0
    assert data["committed_balance_cents"] == 0
    assert data["available_balance_cents"] == 0


@pytest.mark.asyncio
async def test_deposit_increases_balance_and_records_transaction(client: httpx.AsyncClient):
    reg = await client.post(
        "/api/v1/auth/register",
        json={
            "name": "Mariana Souza",
            "email": "mariana.souza@verzel.com.br",
            "password": "StrongPassword123",
            "role": "BIDDER",
        },
    )
    token = reg.json()["access_token"]

    deposit_resp = await client.post(
        "/api/v1/wallet/deposit",
        headers={"Authorization": f"Bearer {token}"},
        json={"amount_cents": 500000},
    )
    assert deposit_resp.status_code == 200
    wallet = deposit_resp.json()
    assert wallet["total_balance_cents"] == 500000
    assert wallet["committed_balance_cents"] == 0
    assert wallet["available_balance_cents"] == 500000

    tx_resp = await client.get(
        "/api/v1/wallet/transactions",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert tx_resp.status_code == 200
    txs = tx_resp.json()
    assert len(txs) == 1
    first_tx = txs[0]
    assert first_tx["type"] == "DEPOSIT"
    assert first_tx["amount_cents"] == 500000
    assert first_tx["balance_after_cents"] == 500000
    assert first_tx["committed_after_cents"] == 0


@pytest.mark.asyncio
async def test_deposit_invalid_amount_returns_422(client: httpx.AsyncClient):
    reg = await client.post(
        "/api/v1/auth/register",
        json={
            "name": "Pedro Alvares",
            "email": "pedro.alvares@verzel.com.br",
            "password": "StrongPassword123",
            "role": "BIDDER",
        },
    )
    token = reg.json()["access_token"]

    zero_resp = await client.post(
        "/api/v1/wallet/deposit",
        headers={"Authorization": f"Bearer {token}"},
        json={"amount_cents": 0},
    )
    assert zero_resp.status_code == 422

    negative_resp = await client.post(
        "/api/v1/wallet/deposit",
        headers={"Authorization": f"Bearer {token}"},
        json={"amount_cents": -5000},
    )
    assert negative_resp.status_code == 422


@pytest.mark.asyncio
async def test_auctioneer_cannot_deposit_or_access_wallet(client: httpx.AsyncClient):
    reg = await client.post(
        "/api/v1/auth/register",
        json={
            "name": "Carla Leiloeira",
            "email": "carla.leiloeira@verzel.com.br",
            "password": "StrongPassword123",
            "role": "AUCTIONEER",
        },
    )
    token = reg.json()["access_token"]

    wallet_resp = await client.get(
        "/api/v1/wallet",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert wallet_resp.status_code == 403

    deposit_resp = await client.post(
        "/api/v1/wallet/deposit",
        headers={"Authorization": f"Bearer {token}"},
        json={"amount_cents": 100000},
    )
    assert deposit_resp.status_code == 403


@pytest.mark.asyncio
async def test_wallet_transactions_chronological_listing(client: httpx.AsyncClient):
    reg = await client.post(
        "/api/v1/auth/register",
        json={
            "name": "Fernanda Lima",
            "email": "fernanda.lima@verzel.com.br",
            "password": "StrongPassword123",
            "role": "BIDDER",
        },
    )
    token = reg.json()["access_token"]

    await client.post(
        "/api/v1/wallet/deposit",
        headers={"Authorization": f"Bearer {token}"},
        json={"amount_cents": 100000},
    )
    await client.post(
        "/api/v1/wallet/deposit",
        headers={"Authorization": f"Bearer {token}"},
        json={"amount_cents": 250000},
    )

    tx_resp = await client.get(
        "/api/v1/wallet/transactions",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert tx_resp.status_code == 200
    txs = tx_resp.json()
    assert len(txs) == 2
    assert txs[0]["amount_cents"] == 250000
    assert txs[0]["balance_after_cents"] == 350000
    assert txs[1]["amount_cents"] == 100000
    assert txs[1]["balance_after_cents"] == 100000

