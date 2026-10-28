from datetime import datetime, timedelta, timezone
from uuid import UUID
import httpx
import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.database import get_db
from app.main import app
from app.models.base import Base
from app.models.lot import Lot


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
            "password": "Password123!",
            "role": role,
        },
    )
    assert reg.status_code == 201
    auth_data = reg.json()

    if deposit_cents > 0 and role == "BIDDER":
        dep = await client.post(
            "/api/v1/wallets/deposit",
            headers={"Authorization": f"Bearer {auth_data['access_token']}"},
            json={"amount_cents": deposit_cents},
        )
        assert dep.status_code == 200

    return auth_data


async def _create_live_lot(
    client: httpx.AsyncClient,
    auctioneer_token: str,
    title: str = "Obra de Teste",
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
            "artist": "Claude Monet",
            "date_display": "1906",
            "medium_display": "Óleo sobre tela",
            "image_url": "/artworks/water-lilies.svg",
            "attributes_json": {"origin": "França"},
            "starting_bid_cents": starting_bid_cents,
            "min_increment_cents": min_increment_cents,
            "start_time": (now - timedelta(minutes=10)).isoformat(),
            "end_time": (now + timedelta(hours=2)).isoformat(),
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
async def test_my_disputes_endpoint_classifies_winning_outbid_and_lost(
    client: httpx.AsyncClient,
    db_session: AsyncSession,
):
    auctioneer = await _register_and_fund(
        client,
        name="Helena Curadora",
        email="helena@verzel.com.br",
        role="AUCTIONEER",
    )
    bidder1 = await _register_and_fund(
        client,
        name="Nicolas Brito",
        email="nicolas@verzel.com.br",
        role="BIDDER",
        deposit_cents=1000000,
    )
    bidder2 = await _register_and_fund(
        client,
        name="Marina Silva",
        email="marina@verzel.com.br",
        role="BIDDER",
        deposit_cents=1000000,
    )

    lot_a = await _create_live_lot(client, auctioneer["access_token"], title="Lote A - Vitória Ativa")
    lot_b = await _create_live_lot(client, auctioneer["access_token"], title="Lote B - Disputa Superada")
    lot_c = await _create_live_lot(client, auctioneer["access_token"], title="Lote C - Encerrado e Perdido")

    bid_a = await client.post(
        f"/api/v1/lots/{lot_a['id']}/bids",
        headers={"Authorization": f"Bearer {bidder1['access_token']}"},
        json={"amount_cents": 150000},
    )
    assert bid_a.status_code == 201

    bid_b1 = await client.post(
        f"/api/v1/lots/{lot_b['id']}/bids",
        headers={"Authorization": f"Bearer {bidder1['access_token']}"},
        json={"amount_cents": 100000},
    )
    assert bid_b1.status_code == 201

    bid_b2 = await client.post(
        f"/api/v1/lots/{lot_b['id']}/bids",
        headers={"Authorization": f"Bearer {bidder2['access_token']}"},
        json={"amount_cents": 120000},
    )
    assert bid_b2.status_code == 201

    bid_c1 = await client.post(
        f"/api/v1/lots/{lot_c['id']}/bids",
        headers={"Authorization": f"Bearer {bidder1['access_token']}"},
        json={"amount_cents": 100000},
    )
    assert bid_c1.status_code == 201

    bid_c2 = await client.post(
        f"/api/v1/lots/{lot_c['id']}/bids",
        headers={"Authorization": f"Bearer {bidder2['access_token']}"},
        json={"amount_cents": 130000},
    )
    assert bid_c2.status_code == 201

    await _expire_lot_in_db(db_session, lot_c["id"])

    response = await client.get(
        "/api/v1/lots/my-disputes",
        headers={"Authorization": f"Bearer {bidder1['access_token']}"},
    )

    assert response.status_code == 200
    data = response.json()

    assert "counts" in data
    assert data["counts"]["in_dispute"] == 2
    assert data["counts"]["won"] == 0
    assert data["counts"]["lost"] == 1

    items = data.get("items") or data.get("disputes")
    assert isinstance(items, list)
    assert len(items) == 3

    by_title = {item["artwork_title"]: item for item in items}

    item_a = by_title["Lote A - Vitória Ativa"]
    assert item_a["lot_id"] == lot_a["id"]
    assert item_a["lot_number"] == lot_a["lot_number"]
    assert item_a["artwork_artist"] == "Claude Monet"
    assert item_a["artwork_image_url"] == "/artworks/water-lilies.svg"
    assert item_a["user_highest_bid_cents"] == 150000
    assert item_a["user_bid_count"] == 1
    assert item_a["current_bid_cents"] == 150000
    assert "ends_at_iso" in item_a
    assert "time_remaining_formatted" in item_a
    assert item_a["status"] == "WINNING"
    assert item_a["is_user_winning"] is True
    assert item_a["leader_pseudonym"].startswith("LIC-")
    assert "N***s B." in item_a["leader_pseudonym"]

    item_b = by_title["Lote B - Disputa Superada"]
    assert item_b["lot_id"] == lot_b["id"]
    assert item_b["user_highest_bid_cents"] == 100000
    assert item_b["user_bid_count"] == 1
    assert item_b["current_bid_cents"] == 120000
    assert item_b["status"] == "OUTBID"
    assert item_b["is_user_winning"] is False
    assert item_b["leader_pseudonym"].startswith("LIC-")
    assert "M***a S." in item_b["leader_pseudonym"]

    item_c = by_title["Lote C - Encerrado e Perdido"]
    assert item_c["lot_id"] == lot_c["id"]
    assert item_c["user_highest_bid_cents"] == 100000
    assert item_c["user_bid_count"] == 1
    assert item_c["current_bid_cents"] == 130000
    assert item_c["status"] == "LOST"
    assert item_c["is_user_winning"] is False
    assert item_c["leader_pseudonym"].startswith("LIC-")
    assert "M***a S." in item_c["leader_pseudonym"]

    settlement_resp = await client.get(
        "/api/v1/settlement/my-bids",
        headers={"Authorization": f"Bearer {bidder1['access_token']}"},
    )
    assert settlement_resp.status_code == 200
    assert settlement_resp.json()["counts"] == data["counts"]
