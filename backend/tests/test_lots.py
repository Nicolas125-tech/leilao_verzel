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


async def _register_user(client: httpx.AsyncClient, name: str, email: str, role: str) -> dict:
    resp = await client.post(
        "/api/v1/auth/register",
        json={
            "name": name,
            "email": email,
            "password": "StrongPassword123",
            "role": role,
        },
    )
    assert resp.status_code == 201
    return resp.json()


def _sample_lot_payload(
    title: str = "A Sunday on La Grande Jatte",
    artist: str = "Georges Seurat",
    start_offset_minutes: int = -10,
    end_offset_minutes: int = 60,
    starting_bid_cents: int = 150000,
    min_increment_cents: int = 10000,
) -> dict:
    now = datetime.now(timezone.utc)
    return {
        "external_artwork_id": "27992",
        "title": title,
        "artist": artist,
        "date_display": "1884/86",
        "medium_display": "Oil on canvas",
        "image_url": "https://www.artic.edu/iiif/2/1adf2696-8489-499b-cad2-821d7fde4b33/full/843,/0/default.jpg",
        "attributes_json": {
            "dimensions": "207.5 x 308.1 cm",
            "place_of_origin": "France",
            "department": "Painting and Sculpture",
        },
        "starting_bid_cents": starting_bid_cents,
        "min_increment_cents": min_increment_cents,
        "start_time": (now + timedelta(minutes=start_offset_minutes)).isoformat(),
        "end_time": (now + timedelta(minutes=end_offset_minutes)).isoformat(),
    }


@pytest.mark.asyncio
async def test_auctioneer_can_create_lot_and_persist_full_artwork_snapshot(client: httpx.AsyncClient):
    auctioneer = await _register_user(client, "Helena Curadora", "helena@verzel.com.br", "AUCTIONEER")
    token = auctioneer["access_token"]

    payload = _sample_lot_payload()
    resp = await client.post(
        "/api/v1/lots",
        headers={"Authorization": f"Bearer {token}"},
        json=payload,
    )
    assert resp.status_code == 201
    lot = resp.json()

    assert lot["lot_number"] >= 101
    assert lot["title"] == "A Sunday on La Grande Jatte"
    assert lot["artist"] == "Georges Seurat"
    assert lot["starting_bid_cents"] == 150000
    assert lot["min_increment_cents"] == 10000
    assert lot["current_bid_cents"] is None
    assert lot["bid_count"] == 0
    assert lot["head_hash"] == "GENESIS"
    assert lot["status"] == "LIVE"
    assert lot["attributes_json"]["place_of_origin"] == "France"


@pytest.mark.asyncio
async def test_bidder_and_non_owner_permissions_on_lots(client: httpx.AsyncClient):
    owner = await _register_user(client, "Leiloeiro Dono", "dono@verzel.com.br", "AUCTIONEER")
    other_auctioneer = await _register_user(client, "Outro Leiloeiro", "outro@verzel.com.br", "AUCTIONEER")
    bidder = await _register_user(client, "Nicolas Licitante", "nicolas@verzel.com.br", "BIDDER")

    forbidden_create = await client.post(
        "/api/v1/lots",
        headers={"Authorization": f"Bearer {bidder['access_token']}"},
        json=_sample_lot_payload(),
    )
    assert forbidden_create.status_code == 403

    created = await client.post(
        "/api/v1/lots",
        headers={"Authorization": f"Bearer {owner['access_token']}"},
        json=_sample_lot_payload(),
    )
    assert created.status_code == 201
    lot_id = created.json()["id"]

    bidder_cancel = await client.post(
        f"/api/v1/lots/{lot_id}/cancel",
        headers={"Authorization": f"Bearer {bidder['access_token']}"},
    )
    assert bidder_cancel.status_code == 403

    other_auctioneer_cancel = await client.post(
        f"/api/v1/lots/{lot_id}/cancel",
        headers={"Authorization": f"Bearer {other_auctioneer['access_token']}"},
    )
    assert other_auctioneer_cancel.status_code == 403


@pytest.mark.asyncio
async def test_public_showcase_lists_lots_with_search_status_filter_and_hides_cancelled(
    client: httpx.AsyncClient,
):
    auctioneer = await _register_user(client, "Curador Chefe", "curador@verzel.com.br", "AUCTIONEER")
    headers = {"Authorization": f"Bearer {auctioneer['access_token']}"}

    live_resp = await client.post(
        "/api/v1/lots",
        headers=headers,
        json=_sample_lot_payload(
            title="Water Lilies",
            artist="Claude Monet",
            start_offset_minutes=-15,
            end_offset_minutes=45,
        ),
    )
    assert live_resp.status_code == 201

    scheduled_resp = await client.post(
        "/api/v1/lots",
        headers=headers,
        json=_sample_lot_payload(
            title="The Bedroom",
            artist="Vincent van Gogh",
            start_offset_minutes=30,
            end_offset_minutes=120,
        ),
    )
    assert scheduled_resp.status_code == 201

    to_cancel_resp = await client.post(
        "/api/v1/lots",
        headers=headers,
        json=_sample_lot_payload(
            title="Old Guitarist",
            artist="Pablo Picasso",
            start_offset_minutes=10,
            end_offset_minutes=90,
        ),
    )
    assert to_cancel_resp.status_code == 201
    cancelled_id = to_cancel_resp.json()["id"]

    cancel_action = await client.post(f"/api/v1/lots/{cancelled_id}/cancel", headers=headers)
    assert cancel_action.status_code == 200
    assert cancel_action.json()["status"] == "CANCELLED"

    all_public = await client.get("/api/v1/lots")
    assert all_public.status_code == 200
    titles = [item["title"] for item in all_public.json()]
    assert "Water Lilies" in titles
    assert "The Bedroom" in titles
    assert "Old Guitarist" not in titles

    only_live = await client.get("/api/v1/lots?status=LIVE")
    assert only_live.status_code == 200
    assert len(only_live.json()) == 1
    assert only_live.json()[0]["title"] == "Water Lilies"

    only_scheduled = await client.get("/api/v1/lots?status=SCHEDULED")
    assert only_scheduled.status_code == 200
    assert len(only_scheduled.json()) == 1
    assert only_scheduled.json()[0]["title"] == "The Bedroom"

    search_monet = await client.get("/api/v1/lots?q=monet")
    assert search_monet.status_code == 200
    assert len(search_monet.json()) == 1
    assert search_monet.json()[0]["artist"] == "Claude Monet"


@pytest.mark.asyncio
async def test_lot_status_transitions_and_time_window_validation(client: httpx.AsyncClient):
    auctioneer = await _register_user(client, "Curador Tempo", "tempo@verzel.com.br", "AUCTIONEER")
    headers = {"Authorization": f"Bearer {auctioneer['access_token']}"}

    invalid_window = await client.post(
        "/api/v1/lots",
        headers=headers,
        json=_sample_lot_payload(start_offset_minutes=60, end_offset_minutes=10),
    )
    assert invalid_window.status_code == 422

    expired_lot_resp = await client.post(
        "/api/v1/lots",
        headers=headers,
        json=_sample_lot_payload(
            title="The Great Wave off Kanagawa",
            artist="Katsushika Hokusai",
            start_offset_minutes=-60,
            end_offset_minutes=-5,
        ),
    )
    assert expired_lot_resp.status_code == 201
    expired_id = expired_lot_resp.json()["id"]

    detail_resp = await client.get(f"/api/v1/lots/{expired_id}")
    assert detail_resp.status_code == 200
    assert detail_resp.json()["status"] == "ENDED"

    cancel_ended = await client.post(f"/api/v1/lots/{expired_id}/cancel", headers=headers)
    assert cancel_ended.status_code == 409
