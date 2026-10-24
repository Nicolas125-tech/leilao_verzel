import pytest
import pytest_asyncio
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.crypto import verify_receipt_signature
from app.models.base import Base
from app.models.lot import Bid, Lot, WinningCertificate
from app.models.user import User
from app.models.wallet import Wallet
from app.seed import run_seed
from app.services.audit import audit_lot_bid_chain


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
