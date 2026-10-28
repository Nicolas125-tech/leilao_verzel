import asyncio
from datetime import datetime, timedelta, timezone
from uuid import UUID
import httpx
import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.core.database import get_db
from app.main import app
from app.models.base import Base
from app.services.bidding import lock_wallets


@pytest_asyncio.fixture
async def session_factory():
    test_engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
        echo=False,
    )
    async with test_engine.begin() as conn:
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
async def client(session_factory: async_sessionmaker[AsyncSession]):
    async def _override_get_db():
        async with session_factory() as session:
            yield session

    app.dependency_overrides[get_db] = _override_get_db
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()


async def _register_and_fund(
    client: httpx.AsyncClient,
    name: str,
    email: str,
    role: str = "BIDDER",
    deposit_cents: int = 0,
) -> dict:
    reg = await client.post(
        "/api/v1/auth/register",
        json={
            "name": name,
            "email": email,
            "password": "StrongPassword123",
            "role": role,
        },
    )
    assert reg.status_code == 201
    data = reg.json()
    if role == "BIDDER" and deposit_cents > 0:
        dep = await client.post(
            "/api/v1/wallet/deposit",
            headers={"Authorization": f"Bearer {data['access_token']}"},
            json={"amount_cents": deposit_cents},
        )
        assert dep.status_code == 200
    return data


async def _create_open_lot(
    client: httpx.AsyncClient,
    auctioneer_token: str,
    starting_bid_cents: int = 10000,
    min_increment_cents: int = 1000,
) -> dict:
    now = datetime.now(timezone.utc)
    resp = await client.post(
        "/api/v1/lots",
        headers={"Authorization": f"Bearer {auctioneer_token}"},
        json={
            "external_artwork_id": "27992",
            "title": "A Sunday on La Grande Jatte",
            "artist": "Georges Seurat",
            "date_display": "1884/86",
            "medium_display": "Oil on canvas",
            "image_url": "https://example.com/grande-jatte.jpg",
            "attributes_json": {"origin": "France"},
            "starting_bid_cents": starting_bid_cents,
            "min_increment_cents": min_increment_cents,
            "start_time": (now - timedelta(minutes=15)).isoformat(),
            "end_time": (now + timedelta(hours=1)).isoformat(),
        },
    )
    assert resp.status_code == 201
    return resp.json()


@pytest.mark.asyncio
async def test_massive_concurrent_bidding_preserves_financial_and_lot_integrity(
    client: httpx.AsyncClient,
):
    auctioneer = await _register_and_fund(
        client, "Curador Verzel", "curador_stress@verzel.com.br", "AUCTIONEER"
    )
    bidders = [
        await _register_and_fund(
            client,
            f"Licitante {i + 1}",
            f"licitante_stress_{i + 1}@verzel.com.br",
            "BIDDER",
            500000,
        )
        for i in range(3)
    ]

    lot = await _create_open_lot(
        client,
        auctioneer["access_token"],
        starting_bid_cents=10000,
        min_increment_cents=1000,
    )
    lot_id = lot["id"]

    async def _send_bid(bidder_token: str, amount_cents: int) -> httpx.Response:
        return await client.post(
            f"/api/v1/lots/{lot_id}/bids",
            headers={"Authorization": f"Bearer {bidder_token}"},
            json={"amount_cents": amount_cents},
        )

    bid_amounts = [
        10000, 15000, 12000, 24000, 11000,
        18000, 14000, 22000, 13000, 20000,
        16000, 23000, 17000, 21000, 19000,
    ]
    tasks = [
        _send_bid(
            bidders[i % 3]["access_token"],
            bid_amounts[i],
        )
        for i in range(15)
    ]

    results = await asyncio.gather(*tasks, return_exceptions=True)

    exceptions = [r for r in results if isinstance(r, BaseException)]
    assert not exceptions, f"Exceções não tratadas ou deadlocks detectados: {exceptions}"

    responses: list[httpx.Response] = [r for r in results if isinstance(r, httpx.Response)]
    assert len(responses) == 15

    server_errors = [r for r in responses if r.status_code >= 500]
    assert not server_errors, (
        f"Erros internos/deadlocks (HTTP 5xx) durante concorrência: "
        f"{[r.text for r in server_errors]}"
    )

    accepted_responses = [r for r in responses if r.status_code == 201]
    assert len(accepted_responses) >= 1, "Pelo menos um lance válido deve ser aceito."

    accepted_bids = [r.json() for r in accepted_responses]
    highest_accepted_amount = max(b["amount_cents"] for b in accepted_bids)

    lot_after = (await client.get(f"/api/v1/lots/{lot_id}")).json()
    assert lot_after["current_bid_cents"] == highest_accepted_amount
    assert lot_after["bid_count"] == len(accepted_bids)

    audit_resp = await client.get(f"/api/v1/lots/{lot_id}/audit")
    assert audit_resp.status_code == 200
    audit_data = audit_resp.json()
    assert audit_data["is_chain_valid"] is True
    assert audit_data["total_bids"] == len(accepted_bids)

    wallets = []
    for bidder in bidders:
        w_resp = await client.get(
            "/api/v1/wallet",
            headers={"Authorization": f"Bearer {bidder['access_token']}"},
        )
        assert w_resp.status_code == 200
        w_data = w_resp.json()
        wallets.append((bidder["user"]["id"], w_data))

        assert w_data["total_balance_cents"] == 500000
        assert (
            w_data["total_balance_cents"]
            == w_data["committed_balance_cents"] + w_data["available_balance_cents"]
        )

        if bidder["user"]["id"] == lot_after["leader_user_id"]:
            assert w_data["committed_balance_cents"] == highest_accepted_amount
            assert w_data["available_balance_cents"] == 500000 - highest_accepted_amount
        else:
            assert w_data["committed_balance_cents"] == 0
            assert w_data["available_balance_cents"] == 500000

    sum_total = sum(w["total_balance_cents"] for _, w in wallets)
    sum_committed = sum(w["committed_balance_cents"] for _, w in wallets)
    sum_available = sum(w["available_balance_cents"] for _, w in wallets)

    assert sum_total == 1500000
    assert sum_committed == highest_accepted_amount
    assert sum_available == 1500000 - highest_accepted_amount
    assert sum_total == sum_committed + sum_available


@pytest.mark.asyncio
async def test_lock_wallets_deterministic_ordering_and_deduplication(
    client: httpx.AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
):
    u1 = await _register_and_fund(client, "User 1", "u1_lock@verzel.com.br", "BIDDER", 100000)
    u2 = await _register_and_fund(client, "User 2", "u2_lock@verzel.com.br", "BIDDER", 200000)

    uid1 = UUID(u1["user"]["id"])
    uid2 = UUID(u2["user"]["id"])

    async with session_factory() as session:
        locked = await lock_wallets(session, [uid2, uid1, uid2])
        assert len(locked) == 2
        assert locked[uid1].total_balance_cents == 100000
        assert locked[uid2].total_balance_cents == 200000
        assert list(locked.keys()) == sorted([uid1, uid2], key=lambda u: str(u))

