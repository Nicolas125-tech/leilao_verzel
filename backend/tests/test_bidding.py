from datetime import datetime, timedelta, timezone
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


async def _create_user_and_deposit(
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


async def _create_lot(
    client: httpx.AsyncClient,
    auctioneer_token: str,
    start_offset_seconds: int = -600,
    end_offset_seconds: int = 3600,
    starting_bid_cents: int = 100000,
    min_increment_cents: int = 10000,
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
            "image_url": "https://www.artic.edu/iiif/2/1adf2696-8489-499b-cad2-821d7fde4b33/full/843,/0/default.jpg",
            "attributes_json": {"origin": "France"},
            "starting_bid_cents": starting_bid_cents,
            "min_increment_cents": min_increment_cents,
            "start_time": (now + timedelta(seconds=start_offset_seconds)).isoformat(),
            "end_time": (now + timedelta(seconds=end_offset_seconds)).isoformat(),
        },
    )
    assert resp.status_code == 201
    return resp.json()


@pytest.mark.asyncio
async def test_first_bid_acceptance_and_hash_chain(client: httpx.AsyncClient):
    auctioneer = await _create_user_and_deposit(client, "Curador", "curador@verzel.com.br", "AUCTIONEER")
    bidder1 = await _create_user_and_deposit(client, "Nicolas Brito", "nicolas@verzel.com.br", "BIDDER", 300000)

    lot = await _create_lot(client, auctioneer["access_token"])
    lot_id = lot["id"]

    bid_resp = await client.post(
        f"/api/v1/lots/{lot_id}/bids",
        headers={"Authorization": f"Bearer {bidder1['access_token']}"},
        json={"amount_cents": 100000},
    )
    assert bid_resp.status_code == 201
    bid = bid_resp.json()

    assert bid["sequence_number"] == 1
    assert bid["previous_hash"] == "GENESIS"
    assert len(bid["current_hash"]) == 64
    assert bid["amount_cents"] == 100000
    assert bid["extension_triggered"] is False
    assert bid["bidder_masked_name"] == bidder1["user"]["masked_name"]

    lot_detail = (await client.get(f"/api/v1/lots/{lot_id}")).json()
    assert lot_detail["current_bid_cents"] == 100000
    assert lot_detail["bid_count"] == 1
    assert lot_detail["head_hash"] == bid["current_hash"]
    assert lot_detail["leader_masked_name"] == bidder1["user"]["masked_name"]

    wallet = (
        await client.get(
            "/api/v1/wallet",
            headers={"Authorization": f"Bearer {bidder1['access_token']}"},
        )
    ).json()
    assert wallet["total_balance_cents"] == 300000
    assert wallet["committed_balance_cents"] == 100000
    assert wallet["available_balance_cents"] == 200000

    txs = (
        await client.get(
            "/api/v1/wallet/transactions",
            headers={"Authorization": f"Bearer {bidder1['access_token']}"},
        )
    ).json()
    assert txs[0]["type"] == "BID_HOLD"
    assert txs[0]["amount_cents"] == 100000
    assert txs[0]["committed_after_cents"] == 100000


@pytest.mark.asyncio
async def test_outbid_and_immediate_balance_release(client: httpx.AsyncClient):
    auctioneer = await _create_user_and_deposit(client, "Curador", "curador@verzel.com.br", "AUCTIONEER")
    bidder1 = await _create_user_and_deposit(client, "Nicolas Brito", "nicolas@verzel.com.br", "BIDDER", 300000)
    bidder2 = await _create_user_and_deposit(client, "Marina Silva", "marina@verzel.com.br", "BIDDER", 300000)

    lot = await _create_lot(client, auctioneer["access_token"])
    lot_id = lot["id"]

    first_bid = (
        await client.post(
            f"/api/v1/lots/{lot_id}/bids",
            headers={"Authorization": f"Bearer {bidder1['access_token']}"},
            json={"amount_cents": 100000},
        )
    ).json()

    second_resp = await client.post(
        f"/api/v1/lots/{lot_id}/bids",
        headers={"Authorization": f"Bearer {bidder2['access_token']}"},
        json={"amount_cents": 120000},
    )
    assert second_resp.status_code == 201
    second_bid = second_resp.json()

    assert second_bid["sequence_number"] == 2
    assert second_bid["previous_hash"] == first_bid["current_hash"]

    wallet1 = (
        await client.get(
            "/api/v1/wallet",
            headers={"Authorization": f"Bearer {bidder1['access_token']}"},
        )
    ).json()
    assert wallet1["total_balance_cents"] == 300000
    assert wallet1["committed_balance_cents"] == 0
    assert wallet1["available_balance_cents"] == 300000

    txs1 = (
        await client.get(
            "/api/v1/wallet/transactions",
            headers={"Authorization": f"Bearer {bidder1['access_token']}"},
        )
    ).json()
    assert txs1[0]["type"] == "BID_RELEASE"
    assert txs1[0]["amount_cents"] == 100000
    assert txs1[0]["committed_after_cents"] == 0

    wallet2 = (
        await client.get(
            "/api/v1/wallet",
            headers={"Authorization": f"Bearer {bidder2['access_token']}"},
        )
    ).json()
    assert wallet2["committed_balance_cents"] == 120000
    assert wallet2["available_balance_cents"] == 180000


@pytest.mark.asyncio
async def test_bidding_rejection_rules(client: httpx.AsyncClient):
    auctioneer = await _create_user_and_deposit(client, "Curador", "curador@verzel.com.br", "AUCTIONEER")
    bidder1 = await _create_user_and_deposit(client, "Licitante Um", "lic1@verzel.com.br", "BIDDER", 300000)
    bidder2 = await _create_user_and_deposit(client, "Licitante Dois", "lic2@verzel.com.br", "BIDDER", 200000)

    live_lot = await _create_lot(client, auctioneer["access_token"], starting_bid_cents=100000, min_increment_cents=10000)
    lot_id = live_lot["id"]

    auctioneer_bid = await client.post(
        f"/api/v1/lots/{lot_id}/bids",
        headers={"Authorization": f"Bearer {auctioneer['access_token']}"},
        json={"amount_cents": 100000},
    )
    assert auctioneer_bid.status_code == 403

    below_starting = await client.post(
        f"/api/v1/lots/{lot_id}/bids",
        headers={"Authorization": f"Bearer {bidder1['access_token']}"},
        json={"amount_cents": 90000},
    )
    assert below_starting.status_code == 400
    assert "mínimo" in below_starting.json()["detail"].lower()

    valid_first = await client.post(
        f"/api/v1/lots/{lot_id}/bids",
        headers={"Authorization": f"Bearer {bidder1['access_token']}"},
        json={"amount_cents": 100000},
    )
    assert valid_first.status_code == 201

    self_outbid = await client.post(
        f"/api/v1/lots/{lot_id}/bids",
        headers={"Authorization": f"Bearer {bidder1['access_token']}"},
        json={"amount_cents": 120000},
    )
    assert self_outbid.status_code == 400
    assert any(
        term in self_outbid.json()["detail"].lower()
        for term in ("líder", "maior lance", "ganhando")
    )

    below_increment = await client.post(
        f"/api/v1/lots/{lot_id}/bids",
        headers={"Authorization": f"Bearer {bidder2['access_token']}"},
        json={"amount_cents": 105000},
    )
    assert below_increment.status_code == 400
    assert "mínimo" in below_increment.json()["detail"].lower()

    insufficient_funds = await client.post(
        f"/api/v1/lots/{lot_id}/bids",
        headers={"Authorization": f"Bearer {bidder2['access_token']}"},
        json={"amount_cents": 250000},
    )
    assert insufficient_funds.status_code == 400
    assert "saldo" in insufficient_funds.json()["detail"].lower()

    scheduled_lot = await _create_lot(
        client,
        auctioneer["access_token"],
        start_offset_seconds=1800,
        end_offset_seconds=5400,
    )
    bid_scheduled = await client.post(
        f"/api/v1/lots/{scheduled_lot['id']}/bids",
        headers={"Authorization": f"Bearer {bidder2['access_token']}"},
        json={"amount_cents": 100000},
    )
    assert bid_scheduled.status_code == 400
    assert "iniciado" in bid_scheduled.json()["detail"].lower()

    ended_lot = await _create_lot(
        client,
        auctioneer["access_token"],
        start_offset_seconds=-3600,
        end_offset_seconds=-60,
    )
    bid_ended = await client.post(
        f"/api/v1/lots/{ended_lot['id']}/bids",
        headers={"Authorization": f"Bearer {bidder2['access_token']}"},
        json={"amount_cents": 100000},
    )
    assert bid_ended.status_code == 400
    assert "encerrado" in bid_ended.json()["detail"].lower()


@pytest.mark.asyncio
async def test_anti_sniping_extension(client: httpx.AsyncClient):
    auctioneer = await _create_user_and_deposit(client, "Curador", "curador@verzel.com.br", "AUCTIONEER")
    bidder = await _create_user_and_deposit(client, "Licitante Rapido", "rapido@verzel.com.br", "BIDDER", 500000)

    sniping_lot = await _create_lot(
        client,
        auctioneer["access_token"],
        start_offset_seconds=-600,
        end_offset_seconds=45,
    )
    lot_id = sniping_lot["id"]
    original_end = datetime.fromisoformat(sniping_lot["end_time"])

    bid_resp = await client.post(
        f"/api/v1/lots/{lot_id}/bids",
        headers={"Authorization": f"Bearer {bidder['access_token']}"},
        json={"amount_cents": 100000},
    )
    assert bid_resp.status_code == 201
    assert bid_resp.json()["extension_triggered"] is True

    updated_lot = (await client.get(f"/api/v1/lots/{lot_id}")).json()
    new_end = datetime.fromisoformat(updated_lot["end_time"])
    assert updated_lot["extension_count"] == 1
    extension_delta = (new_end - original_end).total_seconds()
    assert abs(extension_delta - 120) < 1


@pytest.mark.asyncio
async def test_cancelled_lot_refunds_committed_balance(client: httpx.AsyncClient):
    auctioneer = await _create_user_and_deposit(client, "Curador", "curador@verzel.com.br", "AUCTIONEER")
    bidder = await _create_user_and_deposit(client, "Licitante Estorno", "estorno@verzel.com.br", "BIDDER", 300000)

    lot = await _create_lot(client, auctioneer["access_token"])
    lot_id = lot["id"]

    bid_resp = await client.post(
        f"/api/v1/lots/{lot_id}/bids",
        headers={"Authorization": f"Bearer {bidder['access_token']}"},
        json={"amount_cents": 150000},
    )
    assert bid_resp.status_code == 201

    cancel_resp = await client.post(
        f"/api/v1/lots/{lot_id}/cancel",
        headers={"Authorization": f"Bearer {auctioneer['access_token']}"},
    )
    assert cancel_resp.status_code == 200
    assert cancel_resp.json()["status"] == "CANCELLED"

    wallet = (
        await client.get(
            "/api/v1/wallet",
            headers={"Authorization": f"Bearer {bidder['access_token']}"},
        )
    ).json()
    assert wallet["total_balance_cents"] == 300000
    assert wallet["committed_balance_cents"] == 0
    assert wallet["available_balance_cents"] == 300000

    txs = (
        await client.get(
            "/api/v1/wallet/transactions",
            headers={"Authorization": f"Bearer {bidder['access_token']}"},
        )
    ).json()
    assert txs[0]["type"] == "CANCEL_REFUND"
    assert txs[0]["amount_cents"] == 150000
    assert txs[0]["committed_after_cents"] == 0
