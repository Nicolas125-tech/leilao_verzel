from datetime import datetime, timedelta, timezone
from uuid import UUID
import httpx
import pytest
import pytest_asyncio
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.crypto import GENESIS_HASH
from app.core.database import get_db
from app.main import app
from app.models.base import Base
from app.models.lot import Bid


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
    title: str = "A Sunday on La Grande Jatte",
    artist: str = "Georges Seurat",
    starting_bid_cents: int = 100000,
    min_increment_cents: int = 10000,
) -> dict:
    now = datetime.now(timezone.utc)
    resp = await client.post(
        "/api/v1/lots",
        headers={"Authorization": f"Bearer {auctioneer_token}"},
        json={
            "external_artwork_id": "27992",
            "title": title,
            "artist": artist,
            "date_display": "1884-1886",
            "medium_display": "Oil on canvas",
            "image_url": "https://www.artic.edu/iiif/2/1adf2696-8489-499b-cad2-821d7fde4b33/full/843,/0/default.jpg",
            "attributes_json": {"origin": "France"},
            "starting_bid_cents": starting_bid_cents,
            "min_increment_cents": min_increment_cents,
            "start_time": (now - timedelta(minutes=15)).isoformat(),
            "end_time": (now + timedelta(minutes=30)).isoformat(),
        },
    )
    assert resp.status_code == 201
    return resp.json()


@pytest.mark.asyncio
async def test_audit_empty_lot(client: httpx.AsyncClient):
    auctioneer = await _register_and_fund(client, "Helena Leiloeira", "helena@verzel.com.br", "AUCTIONEER")
    lot = await _create_live_lot(client, auctioneer["access_token"])
    lot_id = lot["id"]

    resp = await client.get(f"/api/v1/lots/{lot_id}/audit")
    assert resp.status_code == 200
    audit = resp.json()

    assert audit["lot_id"] == lot_id
    assert audit["is_chain_valid"] is True
    assert audit["total_bids"] == 0
    assert audit["head_hash"] == GENESIS_HASH
    assert audit["broken_at_sequence"] is None
    assert audit["nodes"] == []


@pytest.mark.asyncio
async def test_audit_valid_bid_chain(client: httpx.AsyncClient):
    auctioneer = await _register_and_fund(client, "Helena Leiloeira", "helena@verzel.com.br", "AUCTIONEER")
    bidder1 = await _register_and_fund(client, "Nicolas Brito", "nicolas@verzel.com.br", "BIDDER", 600000)
    bidder2 = await _register_and_fund(client, "Marina Silva", "marina@verzel.com.br", "BIDDER", 600000)

    lot = await _create_live_lot(client, auctioneer["access_token"])
    lot_id = lot["id"]

    await client.post(
        f"/api/v1/lots/{lot_id}/bids",
        headers={"Authorization": f"Bearer {bidder1['access_token']}"},
        json={"amount_cents": 100000},
    )
    await client.post(
        f"/api/v1/lots/{lot_id}/bids",
        headers={"Authorization": f"Bearer {bidder2['access_token']}"},
        json={"amount_cents": 120000},
    )
    b3 = await client.post(
        f"/api/v1/lots/{lot_id}/bids",
        headers={"Authorization": f"Bearer {bidder1['access_token']}"},
        json={"amount_cents": 150000},
    )
    last_bid_hash = b3.json()["current_hash"]

    resp = await client.get(f"/api/v1/lots/{lot_id}/audit")
    assert resp.status_code == 200
    audit = resp.json()

    assert audit["lot_id"] == lot_id
    assert audit["is_chain_valid"] is True
    assert audit["total_bids"] == 3
    assert audit["head_hash"] == last_bid_hash
    assert audit["broken_at_sequence"] is None
    assert len(audit["nodes"]) == 3
    assert audit["nodes"][0]["sequence_number"] == 1
    assert audit["nodes"][0]["previous_hash"] == GENESIS_HASH
    assert audit["nodes"][0]["is_valid"] is True
    assert audit["nodes"][2]["sequence_number"] == 3
    assert audit["nodes"][2]["stored_hash"] == last_bid_hash
    assert audit["nodes"][2]["is_valid"] is True


@pytest.mark.asyncio
async def test_audit_tampered_bid_detection(
    client: httpx.AsyncClient,
    db_session: AsyncSession,
):
    auctioneer = await _register_and_fund(client, "Helena Leiloeira", "helena@verzel.com.br", "AUCTIONEER")
    bidder1 = await _register_and_fund(client, "Nicolas Brito", "nicolas@verzel.com.br", "BIDDER", 600000)
    bidder2 = await _register_and_fund(client, "Marina Silva", "marina@verzel.com.br", "BIDDER", 600000)

    lot = await _create_live_lot(client, auctioneer["access_token"])
    lot_id = lot["id"]

    await client.post(
        f"/api/v1/lots/{lot_id}/bids",
        headers={"Authorization": f"Bearer {bidder1['access_token']}"},
        json={"amount_cents": 100000},
    )
    await client.post(
        f"/api/v1/lots/{lot_id}/bids",
        headers={"Authorization": f"Bearer {bidder2['access_token']}"},
        json={"amount_cents": 120000},
    )
    await client.post(
        f"/api/v1/lots/{lot_id}/bids",
        headers={"Authorization": f"Bearer {bidder1['access_token']}"},
        json={"amount_cents": 150000},
    )

    # Adultera diretamente no banco de dados o valor do lance #2 sem recomputar o hash
    await db_session.execute(
        update(Bid)
        .where(Bid.lot_id == UUID(lot_id), Bid.sequence_number == 2)
        .values(amount_cents=999999)
    )
    await db_session.commit()

    resp = await client.get(f"/api/v1/lots/{lot_id}/audit")
    assert resp.status_code == 200
    audit = resp.json()

    assert audit["is_chain_valid"] is False
    assert audit["broken_at_sequence"] == 2
    assert len(audit["anomalies"]) >= 1
    assert audit["nodes"][1]["sequence_number"] == 2
    assert audit["nodes"][1]["is_valid"] is False


@pytest.mark.asyncio
async def test_audit_route_is_public(client: httpx.AsyncClient):
    auctioneer = await _register_and_fund(client, "Helena Leiloeira", "helena@verzel.com.br", "AUCTIONEER")
    lot = await _create_live_lot(client, auctioneer["access_token"])
    lot_id = lot["id"]

    # Chamada sem cabecalho Authorization
    resp = await client.get(f"/api/v1/lots/{lot_id}/audit")
    assert resp.status_code == 200
