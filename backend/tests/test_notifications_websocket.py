from datetime import datetime, timedelta, timezone
from uuid import UUID
from fastapi.testclient import TestClient
import httpx
import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from starlette.websockets import WebSocketDisconnect

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
    starting_bid_cents: int = 10000,
    min_increment_cents: int = 1000,
    remaining_seconds: int = 3600,
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
            "medium_display": "Oil on canvas",
            "image_url": "https://example.com/water-lilies.jpg",
            "attributes_json": {"origin": "France"},
            "starting_bid_cents": starting_bid_cents,
            "min_increment_cents": min_increment_cents,
            "start_time": (now - timedelta(minutes=10)).isoformat(),
            "end_time": (now + timedelta(seconds=remaining_seconds)).isoformat(),
        },
    )
    assert resp.status_code == 201
    return resp.json()


@pytest.mark.asyncio
async def test_outbid_notification_emitted_to_previous_leader_via_websocket(
    client: httpx.AsyncClient,
    db_session: AsyncSession,
):
    auctioneer = await _register_and_fund(
        client, "Helena Leiloeira", "helena@verzel.com.br", "AUCTIONEER"
    )
    user_a = await _register_and_fund(
        client, "Licitante A", "licitante_a@verzel.com.br", "BIDDER", 50000
    )
    user_b = await _register_and_fund(
        client, "Licitante B", "licitante_b@verzel.com.br", "BIDDER", 50000
    )

    lot = await _create_live_lot(
        client,
        auctioneer["access_token"],
        title="Water Lilies",
        starting_bid_cents=10000,
        min_increment_cents=1000,
    )
    lot_id = lot["id"]

    lot_record = (
        await db_session.execute(select(Lot).where(Lot.id == UUID(lot_id)))
    ).scalar_one()
    lot_record.lot_number = 1
    await db_session.commit()

    with TestClient(app) as sync_client:
        with sync_client.websocket_connect(f"/ws/lots/{lot_id}") as ws_lot, \
             sync_client.websocket_connect(f"/ws/notifications?token={user_a['access_token']}") as ws_user_a, \
             sync_client.websocket_connect(f"/ws/notifications?token={user_b['access_token']}") as ws_user_b:

            bid_a_resp = await client.post(
                f"/api/v1/lots/{lot_id}/bids",
                headers={"Authorization": f"Bearer {user_a['access_token']}"},
                json={"amount_cents": 10000},
            )
            assert bid_a_resp.status_code == 201

            msg_bid_a = ws_lot.receive_json()
            assert msg_bid_a["event"] == "NEW_BID"
            assert msg_bid_a["bid"]["amount_cents"] == 10000
            assert ws_user_a._send_rx.statistics().current_buffer_used == 0
            assert ws_user_b._send_rx.statistics().current_buffer_used == 0

            bid_b_resp = await client.post(
                f"/api/v1/lots/{lot_id}/bids",
                headers={"Authorization": f"Bearer {user_b['access_token']}"},
                json={"amount_cents": 15000},
            )
            assert bid_b_resp.status_code == 201

            msg_bid_b = ws_lot.receive_json()
            assert msg_bid_b["event"] == "NEW_BID"
            assert msg_bid_b["lot_id"] == lot_id
            assert msg_bid_b["bid"]["amount_cents"] == 15000

            notification_a = ws_user_a.receive_json()
            assert notification_a == {
                "type": "NOTIFICATION",
                "event": "OUTBID",
                "lot_id": lot_id,
                "lot_number": 1,
                "artwork_title": "Water Lilies",
                "new_highest_bid_cents": 15000,
                "message": "Seu lance no Lote 1 (Water Lilies) foi superado por R$ 150,00!",
                "action_url": f"/lots/{lot_id}",
            }

            assert ws_user_b._send_rx.statistics().current_buffer_used == 0


@pytest.mark.asyncio
async def test_notifications_websocket_rejects_unauthenticated_connection():
    with TestClient(app) as sync_client:
        with pytest.raises(WebSocketDisconnect) as exc_missing:
            with sync_client.websocket_connect("/ws/notifications"):
                pass
        assert exc_missing.value.code == 1008

        with pytest.raises(WebSocketDisconnect) as exc_invalid:
            with sync_client.websocket_connect("/ws/notifications?token=invalid.token.here"):
                pass
        assert exc_invalid.value.code == 1008


@pytest.mark.asyncio
async def test_anti_sniping_broadcasts_lot_extended(
    client: httpx.AsyncClient,
    db_session: AsyncSession,
):
    auctioneer = await _register_and_fund(
        client, "Helena Leiloeira", "helena_anti@verzel.com.br", "AUCTIONEER"
    )
    bidder = await _register_and_fund(
        client, "Licitante C", "licitante_c@verzel.com.br", "BIDDER", 50000
    )

    lot = await _create_live_lot(
        client,
        auctioneer["access_token"],
        title="Anti Sniping Lot",
        starting_bid_cents=10000,
        min_increment_cents=1000,
        remaining_seconds=60,
    )
    lot_id = lot["id"]

    with TestClient(app) as sync_client:
        with sync_client.websocket_connect(f"/ws/lots/{lot_id}") as ws_lot:
            bid_resp = await client.post(
                f"/api/v1/lots/{lot_id}/bids",
                headers={"Authorization": f"Bearer {bidder['access_token']}"},
                json={"amount_cents": 10000},
            )
            assert bid_resp.status_code == 201

            msg_bid = ws_lot.receive_json()
            assert msg_bid["event"] == "NEW_BID"

            msg_ext = ws_lot.receive_json()
            assert msg_ext["event"] == "LOT_EXTENDED"
            assert msg_ext["lot_id"] == lot_id
            assert msg_ext["extension_count"] == 1
            assert "new_end_time" in msg_ext
