from datetime import timedelta
from unittest.mock import AsyncMock, patch
import httpx
import pytest
import pytest_asyncio
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.crypto import verify_receipt_signature
from app.core.database import get_db
from app.main import app
from app.models.base import Base, utc_now
from app.models.lot import Bid, Lot, WinningCertificate
from app.models.user import User
from app.models.wallet import Wallet
from app.seed import reset_demo_data, run_seed
from app.services.audit import audit_lot_bid_chain
from app.services.lots import ensure_utc


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


@pytest.mark.asyncio
async def test_seed_populates_all_lifecycle_states(db_session: AsyncSession):
    await run_seed(db_session)

    users_res = await db_session.execute(select(User))
    users = list(users_res.scalars().all())
    assert len(users) >= 3

    roles = {u.role for u in users}
    assert "AUCTIONEER" in roles
    assert "BIDDER" in roles

    wallets_res = await db_session.execute(select(Wallet))
    wallets = list(wallets_res.scalars().all())
    assert len(wallets) == len(users)

    bidder_ids = {u.id for u in users if u.role == "BIDDER"}
    bidder_wallets = [w for w in wallets if w.user_id in bidder_ids]
    assert all(w.total_balance_cents > 0 for w in bidder_wallets)

    lots_res = await db_session.execute(select(Lot).order_by(Lot.lot_number.asc()))
    lots = list(lots_res.scalars().all())
    assert len(lots) >= 5

    scheduled_lots = [l for l in lots if l.status == "SCHEDULED"]
    live_no_bids = [l for l in lots if l.status == "LIVE" and l.bid_count == 0]
    live_with_bids = [l for l in lots if l.status == "LIVE" and l.bid_count >= 2]
    settled_lots = [
        l for l in lots if l.status in ("ENDED", "SETTLED") and l.settled_at is not None and l.certificate is not None
    ]
    cancelled_lots = [l for l in lots if l.status == "CANCELLED" and l.cancelled_at is not None]

    assert len(scheduled_lots) >= 1
    assert len(live_no_bids) >= 1
    assert len(live_with_bids) >= 1
    assert len(settled_lots) >= 1
    assert len(cancelled_lots) >= 1

    cert = settled_lots[0].certificate
    assert cert is not None
    assert cert.receipt_code.startswith("ARP-")
    assert verify_receipt_signature(
        signature=cert.receipt_signature,
        receipt_code=cert.receipt_code,
        lot_id=cert.lot_id,
        winner_masked_name=cert.winner_masked_name,
        final_amount_cents=cert.final_amount_cents,
        settled_at_iso=cert.settled_at.isoformat() if cert.settled_at.tzinfo else f"{cert.settled_at.isoformat()}+00:00",
    )

    disputed_lot = live_with_bids[0]
    audit = await audit_lot_bid_chain(db_session, disputed_lot.id)
    assert audit.is_chain_valid is True
    assert audit.total_bids == disputed_lot.bid_count
    assert audit.head_hash == disputed_lot.head_hash


@pytest.mark.asyncio
async def test_seed_is_idempotent(db_session: AsyncSession):
    await run_seed(db_session)

    users_count_1 = (await db_session.execute(select(func.count(User.id)))).scalar_one()
    lots_count_1 = (await db_session.execute(select(func.count(Lot.id)))).scalar_one()
    bids_count_1 = (await db_session.execute(select(func.count(Bid.id)))).scalar_one()
    certs_count_1 = (await db_session.execute(select(func.count(WinningCertificate.id)))).scalar_one()

    # Segunda execucao consecutiva nao deve falhar nem duplicar registros
    await run_seed(db_session)

    users_count_2 = (await db_session.execute(select(func.count(User.id)))).scalar_one()
    lots_count_2 = (await db_session.execute(select(func.count(Lot.id)))).scalar_one()
    bids_count_2 = (await db_session.execute(select(func.count(Bid.id)))).scalar_one()
    certs_count_2 = (await db_session.execute(select(func.count(WinningCertificate.id)))).scalar_one()

    assert users_count_2 == users_count_1
    assert lots_count_2 == lots_count_1
    assert bids_count_2 == bids_count_1
    assert certs_count_2 == certs_count_1


@pytest.mark.asyncio
async def test_seed_seven_day_window_and_reset_demo_data(db_session: AsyncSession):
    await run_seed(db_session)
    now = utc_now()

    lots_res = await db_session.execute(select(Lot).order_by(Lot.lot_number.asc()))
    lots_by_number = {lot.lot_number: lot for lot in lots_res.scalars().all()}

    lot_101 = lots_by_number[101]
    lot_102 = lots_by_number[102]
    lot_103 = lots_by_number[103]

    assert ensure_utc(lot_101.start_time) >= now + timedelta(hours=23)
    assert ensure_utc(lot_101.end_time) >= now + timedelta(days=7, hours=23)
    assert ensure_utc(lot_102.end_time) >= now + timedelta(days=6, hours=23)
    assert ensure_utc(lot_103.end_time) >= now + timedelta(days=6, hours=23)

    await db_session.execute(
        update(Lot).where(Lot.lot_number == 102).values(status="CANCELLED")
    )
    await db_session.commit()

    await reset_demo_data(db_session)

    refreshed_res = await db_session.execute(select(Lot).where(Lot.lot_number == 102))
    refreshed_102 = refreshed_res.scalar_one()
    assert refreshed_102.status == "LIVE"
    assert refreshed_102.bid_count == 0


@pytest.mark.asyncio
async def test_demo_reset_endpoint_restores_seed_state(db_session: AsyncSession):
    await run_seed(db_session)

    await db_session.execute(
        update(Bid).where(Bid.sequence_number == 2).values(amount_cents=999999)
    )
    await db_session.commit()

    async def _override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = _override_get_db
    try:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post("/api/v1/demo/reset")
            assert resp.status_code == 200
            payload = resp.json()
            assert payload == {
                "status": "ok",
                "message": "Demonstração restaurada com sucesso.",
            }
    finally:
        app.dependency_overrides.clear()

    lot_103_res = await db_session.execute(select(Lot).where(Lot.lot_number == 103))
    lot_103 = lot_103_res.scalar_one()
    audit = await audit_lot_bid_chain(db_session, lot_103.id)
    assert audit.is_chain_valid is True
    assert audit.total_bids == 3


@pytest.mark.asyncio
async def test_seed_with_active_external_api_uses_cleveland_images(db_session: AsyncSession):
    async def _mock_fetch(query: str | None = None):
        slug = (query or "art").replace(" ", "_")
        return [
            {
                "external_id": f"cma-{slug}",
                "title": f"Masterpiece ({query})",
                "artist": "Master Artist",
                "date_display": "1890",
                "medium_display": "Oil on canvas",
                "image_url": f"https://openaccess-cdn.clevelandart.org/mock/{slug}_web.jpg",
                "attributes": {
                    "dimensions": "100 x 80 cm",
                    "place_of_origin": "France",
                    "department": "European Painting and Sculpture",
                },
                "source": "cleveland_art",
            }
        ]

    with patch(
        "app.services.catalog.fetch_external_artworks",
        new_callable=AsyncMock,
        side_effect=_mock_fetch,
    ):
        await run_seed(db_session)

    lots_res = await db_session.execute(select(Lot).order_by(Lot.lot_number.asc()))
    lots_by_number = {lot.lot_number: lot for lot in lots_res.scalars().all()}

    for lot_num in (101, 102, 103, 104):
        assert lots_by_number[lot_num].image_url.startswith(
            "https://openaccess-cdn.clevelandart.org/"
        )

    audit_103 = await audit_lot_bid_chain(db_session, lots_by_number[103].id)
    assert audit_103.is_chain_valid is True
    assert audit_103.total_bids == 3

    cert = lots_by_number[104].certificate
    assert cert is not None
    assert verify_receipt_signature(
        signature=cert.receipt_signature,
        receipt_code=cert.receipt_code,
        lot_id=cert.lot_id,
        winner_masked_name=cert.winner_masked_name,
        final_amount_cents=cert.final_amount_cents,
        settled_at_iso=cert.settled_at.isoformat() if cert.settled_at.tzinfo else f"{cert.settled_at.isoformat()}+00:00",
    )


@pytest.mark.asyncio
async def test_seed_with_unavailable_external_api_falls_back_to_local_svg(db_session: AsyncSession):
    with patch(
        "app.services.catalog.fetch_external_artworks",
        new_callable=AsyncMock,
        side_effect=httpx.TimeoutException("Cleveland API timeout"),
    ):
        await run_seed(db_session)

    lots_res = await db_session.execute(select(Lot).order_by(Lot.lot_number.asc()))
    lots_by_number = {lot.lot_number: lot for lot in lots_res.scalars().all()}

    for lot_num in (101, 102, 103, 104, 105):
        assert lots_by_number[lot_num].image_url.startswith("/artworks/")
        assert lots_by_number[lot_num].image_url.endswith(".svg")

    audit_103 = await audit_lot_bid_chain(db_session, lots_by_number[103].id)
    assert audit_103.is_chain_valid is True
    assert audit_103.total_bids == 3

    cert = lots_by_number[104].certificate
    assert cert is not None
    assert verify_receipt_signature(
        signature=cert.receipt_signature,
        receipt_code=cert.receipt_code,
        lot_id=cert.lot_id,
        winner_masked_name=cert.winner_masked_name,
        final_amount_cents=cert.final_amount_cents,
        settled_at_iso=cert.settled_at.isoformat() if cert.settled_at.tzinfo else f"{cert.settled_at.isoformat()}+00:00",
    )
