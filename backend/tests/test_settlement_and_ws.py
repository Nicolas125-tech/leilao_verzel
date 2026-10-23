from datetime import datetime, timedelta, timezone
from uuid import UUID
from fastapi.testclient import TestClient
import httpx
import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.crypto import verify_receipt_signature
from app.core.database import get_db
from app.main import app
from app.models.base import Base
from app.models.lot import Lot
from app.models.wallet import Wallet


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


async def _create_live_lot(
    client: httpx.AsyncClient,
    auctioneer_token: str,
    title: str = "Water Lilies",
    artist: str = "Claude Monet",
    starting_bid_cents: int = 100000,
    min_increment_cents: int = 10000,
) -> dict:
    now = datetime.now(timezone.utc)
    resp = await client.post(
        "/api/v1/lots",
        headers={"Authorization": f"Bearer {auctioneer_token}"},
        json={
            "external_artwork_id": "16568",
            "title": title,
            "artist": artist,
            "date_display": "1906",
            "medium_display": "Oil on canvas",
            "image_url": "https://www.artic.edu/iiif/2/3c27b499-af56-f0d5-9aa1-52191118fdba/full/843,/0/default.jpg",
            "attributes_json": {"origin": "France"},
            "starting_bid_cents": starting_bid_cents,
            "min_increment_cents": min_increment_cents,
            "start_time": (now - timedelta(minutes=15)).isoformat(),
            "end_time": (now + timedelta(minutes=30)).isoformat(),
        },
    )
    assert resp.status_code == 201
    return resp.json()


async def _expire_lot_in_db(db_session: AsyncSession, lot_id: str) -> None:
    res = await db_session.execute(select(Lot).where(Lot.id == UUID(lot_id)))
    lot_obj = res.scalar_one()
    lot_obj.end_time = datetime.now(timezone.utc) - timedelta(seconds=10)
    await db_session.commit()


@pytest.mark.asyncio
async def test_lot_settlement_transfers_balance_and_creates_signed_receipt(
    client: httpx.AsyncClient,
    db_session: AsyncSession,
):
    auctioneer = await _register_and_fund(client, "Helena Leiloeira", "helena@verzel.com.br", "AUCTIONEER")
    bidder = await _register_and_fund(client, "Nicolas Brito", "nicolas@verzel.com.br", "BIDDER", 400000)

    lot = await _create_live_lot(client, auctioneer["access_token"])
    lot_id = lot["id"]

    bid_resp = await client.post(
        f"/api/v1/lots/{lot_id}/bids",
        headers={"Authorization": f"Bearer {bidder['access_token']}"},
        json={"amount_cents": 150000},
    )
    assert bid_resp.status_code == 201

    await _expire_lot_in_db(db_session, lot_id)

    settled_resp = await client.get(f"/api/v1/lots/{lot_id}")
    assert settled_resp.status_code == 200
    settled_lot = settled_resp.json()

    assert settled_lot["status"] == "ENDED"
    assert settled_lot["settled_at"] is not None
    assert settled_lot["certificate"] is not None

    cert = settled_lot["certificate"]
    assert cert["receipt_code"].startswith("ARP-")
    assert cert["final_amount_cents"] == 150000
    assert cert["winner_masked_name"] == bidder["user"]["masked_name"]
    assert verify_receipt_signature(
        signature=cert["receipt_signature"],
        receipt_code=cert["receipt_code"],
        lot_id=lot_id,
        winner_masked_name=cert["winner_masked_name"],
        final_amount_cents=cert["final_amount_cents"],
        settled_at_iso=cert["settled_at_iso"],
    )

    winner_wallet = (
        await client.get(
            "/api/v1/wallet",
            headers={"Authorization": f"Bearer {bidder['access_token']}"},
        )
    ).json()
    assert winner_wallet["total_balance_cents"] == 250000
    assert winner_wallet["committed_balance_cents"] == 0
    assert winner_wallet["available_balance_cents"] == 250000

    winner_txs = (
        await client.get(
            "/api/v1/wallet/transactions",
            headers={"Authorization": f"Bearer {bidder['access_token']}"},
        )
    ).json()
    assert winner_txs[0]["type"] == "SETTLEMENT_DEBIT"
    assert winner_txs[0]["amount_cents"] == 150000

    auc_wallet_res = await db_session.execute(
        select(Wallet).where(Wallet.user_id == UUID(auctioneer["user"]["id"]))
    )
    auc_wallet = auc_wallet_res.scalar_one()
    assert auc_wallet.total_balance_cents == 150000


@pytest.mark.asyncio
async def test_public_receipt_consultation(
    client: httpx.AsyncClient,
    db_session: AsyncSession,
):
    auctioneer = await _register_and_fund(client, "Helena Leiloeira", "helena@verzel.com.br", "AUCTIONEER")
    bidder = await _register_and_fund(client, "Nicolas Brito", "nicolas@verzel.com.br", "BIDDER", 300000)

    lot = await _create_live_lot(client, auctioneer["access_token"], title="The Bedroom", artist="Vincent van Gogh")
    lot_id = lot["id"]

    await client.post(
        f"/api/v1/lots/{lot_id}/bids",
        headers={"Authorization": f"Bearer {bidder['access_token']}"},
        json={"amount_cents": 180000},
    )
    await _expire_lot_in_db(db_session, lot_id)

    settled_lot = (await client.get(f"/api/v1/lots/{lot_id}")).json()
    receipt_code = settled_lot["certificate"]["receipt_code"]

    public_resp = await client.get(f"/api/v1/receipts/{receipt_code}")
    assert public_resp.status_code == 200
    receipt = public_resp.json()
    assert receipt["receipt_code"] == receipt_code
    assert receipt["title"] == "The Bedroom"
    assert receipt["artist"] == "Vincent van Gogh"
    assert receipt["winner_masked_name"] == bidder["user"]["masked_name"]
    assert receipt["final_amount_cents"] == 180000
    assert receipt["is_signature_valid"] is True

    not_found = await client.get("/api/v1/receipts/ARP-INEXISTENTE-0000")
    assert not_found.status_code == 404


@pytest.mark.asyncio
async def test_bidder_bids_and_wins_listing(
    client: httpx.AsyncClient,
    db_session: AsyncSession,
):
    auctioneer = await _register_and_fund(client, "Helena Leiloeira", "helena@verzel.com.br", "AUCTIONEER")
    bidder1 = await _register_and_fund(client, "Nicolas Brito", "nicolas@verzel.com.br", "BIDDER", 800000)
    bidder2 = await _register_and_fund(client, "Marina Silva", "marina@verzel.com.br", "BIDDER", 800000)

    lot_winning = await _create_live_lot(client, auctioneer["access_token"], title="Obra Liderada")
    lot_outbid = await _create_live_lot(client, auctioneer["access_token"], title="Obra Superada")
    lot_won = await _create_live_lot(client, auctioneer["access_token"], title="Obra Arrematada")

    await client.post(
        f"/api/v1/lots/{lot_winning['id']}/bids",
        headers={"Authorization": f"Bearer {bidder1['access_token']}"},
        json={"amount_cents": 100000},
    )

    await client.post(
        f"/api/v1/lots/{lot_outbid['id']}/bids",
        headers={"Authorization": f"Bearer {bidder1['access_token']}"},
        json={"amount_cents": 100000},
    )
    await client.post(
        f"/api/v1/lots/{lot_outbid['id']}/bids",
        headers={"Authorization": f"Bearer {bidder2['access_token']}"},
        json={"amount_cents": 120000},
    )

    await client.post(
        f"/api/v1/lots/{lot_won['id']}/bids",
        headers={"Authorization": f"Bearer {bidder1['access_token']}"},
        json={"amount_cents": 140000},
    )
    await _expire_lot_in_db(db_session, lot_won["id"])

    forbidden = await client.get(
        "/api/v1/me/bids-and-wins",
        headers={"Authorization": f"Bearer {auctioneer['access_token']}"},
    )
    assert forbidden.status_code == 403

    me_resp = await client.get(
        "/api/v1/me/bids-and-wins",
        headers={"Authorization": f"Bearer {bidder1['access_token']}"},
    )
    assert me_resp.status_code == 200
    summary = me_resp.json()

    status_by_title = {item["lot"]["title"]: item["user_bid_status"] for item in summary["participated_lots"]}
    assert status_by_title["Obra Liderada"] == "WINNING"
    assert status_by_title["Obra Superada"] == "OUTBID"

    won_titles = [item["title"] for item in summary["won_lots"]]
    assert "Obra Arrematada" in won_titles
    assert summary["won_lots"][0]["certificate"]["receipt_code"].startswith("ARP-")


@pytest.mark.asyncio
async def test_auctioneer_dashboard(
    client: httpx.AsyncClient,
    db_session: AsyncSession,
):
    auctioneer = await _register_and_fund(client, "Helena Leiloeira", "helena@verzel.com.br", "AUCTIONEER")
    bidder = await _register_and_fund(client, "Nicolas Brito", "nicolas@verzel.com.br", "BIDDER", 500000)

    lot1 = await _create_live_lot(client, auctioneer["access_token"], title="Lote Vendido")
    await _create_live_lot(client, auctioneer["access_token"], title="Lote Em Andamento")

    await client.post(
        f"/api/v1/lots/{lot1['id']}/bids",
        headers={"Authorization": f"Bearer {bidder['access_token']}"},
        json={"amount_cents": 220000},
    )
    await _expire_lot_in_db(db_session, lot1["id"])

    forbidden = await client.get(
        "/api/v1/auctioneer/dashboard",
        headers={"Authorization": f"Bearer {bidder['access_token']}"},
    )
    assert forbidden.status_code == 403

    dash_resp = await client.get(
        "/api/v1/auctioneer/dashboard",
        headers={"Authorization": f"Bearer {auctioneer['access_token']}"},
    )
    assert dash_resp.status_code == 200
    dash = dash_resp.json()
    assert dash["total_revenue_cents"] == 220000
    assert dash["settled_with_winner_count"] == 1
    assert len(dash["lots"]) == 2


@pytest.mark.asyncio
async def test_websocket_lot_events_broadcast(
    client: httpx.AsyncClient,
    db_session: AsyncSession,
):
    auctioneer = await _register_and_fund(client, "Helena Leiloeira", "helena@verzel.com.br", "AUCTIONEER")
    bidder = await _register_and_fund(client, "Nicolas Brito", "nicolas@verzel.com.br", "BIDDER", 500000)

    lot = await _create_live_lot(client, auctioneer["access_token"])
    lot_id = lot["id"]

    with TestClient(app) as sync_client:
        with sync_client.websocket_connect(f"/ws/lots/{lot_id}") as ws:
            bid_resp = await client.post(
                f"/api/v1/lots/{lot_id}/bids",
                headers={"Authorization": f"Bearer {bidder['access_token']}"},
                json={"amount_cents": 110000},
            )
            assert bid_resp.status_code == 201

            msg1 = ws.receive_json()
            assert msg1["event"] == "NEW_BID"
            assert msg1["lot_id"] == lot_id
            assert msg1["bid"]["amount_cents"] == 110000

            await _expire_lot_in_db(db_session, lot_id)
            await client.get(f"/api/v1/lots/{lot_id}")

            msg2 = ws.receive_json()
            assert msg2["event"] == "LOT_SETTLED"
            assert msg2["lot_id"] == lot_id
            assert msg2["certificate"]["receipt_code"].startswith("ARP-")
