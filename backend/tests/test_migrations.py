from datetime import timedelta
import hashlib
import hmac
import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import settings
from app.core.crypto import GENESIS_HASH, format_utc_iso
from app.core.migration_helpers import rechain_and_seal_legacy_data
from app.core.privacy import generate_public_code, mask_name
from app.core.security import hash_password
from app.models.base import utc_now
from app.models.lot import Bid, Lot, WinningCertificate
from app.models.user import User
from app.models.wallet import Wallet
from app.services.audit import audit_lot_bid_chain
from app.services.settlement import get_public_receipt


def _legacy_sha256_bid_hash(
    lot_id: uuid.UUID,
    seq: int,
    masked_name: str,
    amount_cents: int,
    created_at_iso: str,
    prev_hash: str,
) -> str:
    payload = f"{lot_id}|{seq}|{masked_name}|{amount_cents}|{created_at_iso}|{prev_hash}"
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _legacy_receipt_sig(
    receipt_code: str,
    lot_id: uuid.UUID,
    winner_masked_name: str,
    final_amount_cents: int,
    settled_at_iso: str,
) -> str:
    payload = f"{receipt_code}|{lot_id}|{winner_masked_name}|{final_amount_cents}|{settled_at_iso}"
    return hmac.new(
        settings.HMAC_SECRET_KEY.encode("utf-8"),
        payload.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


@pytest.mark.asyncio
async def test_rechain_and_seal_legacy_data_upgrades_lots_101_103_104(
    session_factory: async_sessionmaker[AsyncSession],
):
    now = utc_now()
    auc_id = uuid.uuid4()
    b1_id = uuid.uuid4()
    b2_id = uuid.uuid4()

    auc_code = generate_public_code(auc_id, "AUCTIONEER")
    b1_code = generate_public_code(b1_id, "BIDDER")
    b2_code = generate_public_code(b2_id, "BIDDER")

    auc_user = User(
        id=auc_id,
        name="Helena Curadora",
        email="helena.mig@verzel.com.br",
        password_hash=hash_password("Verzel2026!"),
        role="AUCTIONEER",
        public_code=auc_code,
        masked_name=mask_name("Helena Curadora", auc_code),
    )
    b1_user = User(
        id=b1_id,
        name="Nicolas Brito",
        email="nicolas.mig@verzel.com.br",
        password_hash=hash_password("Verzel2026!"),
        role="BIDDER",
        public_code=b1_code,
        masked_name=mask_name("Nicolas Brito", b1_code),
    )
    b2_user = User(
        id=b2_id,
        name="Marina Silva",
        email="marina.mig@verzel.com.br",
        password_hash=hash_password("Verzel2026!"),
        role="BIDDER",
        public_code=b2_code,
        masked_name=mask_name("Marina Silva", b2_code),
    )

    lot_101_id = uuid.uuid4()
    lot_101 = Lot(
        id=lot_101_id,
        lot_number=101,
        auctioneer_id=auc_id,
        external_artwork_id="111628",
        title="Nighthawks",
        artist="Edward Hopper",
        date_display="1942",
        medium_display="Óleo sobre tela",
        image_url="/artworks/nighthawks.svg",
        attributes_json={"place_of_origin": "Estados Unidos"},
        starting_bid_cents=350000,
        min_increment_cents=25000,
        start_time=now + timedelta(days=1),
        end_time=now + timedelta(days=8),
        original_end_time=now + timedelta(days=8),
        status="SCHEDULED",
        bid_count=0,
        head_hash="GENESIS",
        integrity_seal="",
    )

    lot_103_id = uuid.uuid4()
    t103_1 = now - timedelta(minutes=25)
    t103_2 = now - timedelta(minutes=18)
    t103_3 = now - timedelta(minutes=9)
    h103_1 = _legacy_sha256_bid_hash(lot_103_id, 1, b1_user.masked_name, 200000, t103_1.isoformat(), "GENESIS")
    h103_2 = _legacy_sha256_bid_hash(lot_103_id, 2, b2_user.masked_name, 240000, t103_2.isoformat(), h103_1)
    h103_3 = _legacy_sha256_bid_hash(lot_103_id, 3, b1_user.masked_name, 280000, t103_3.isoformat(), h103_2)

    lot_103 = Lot(
        id=lot_103_id,
        lot_number=103,
        auctioneer_id=auc_id,
        external_artwork_id="27992",
        title="A Sunday on La Grande Jatte",
        artist="Georges Seurat",
        date_display="1884-1886",
        medium_display="Óleo sobre tela",
        image_url="/artworks/grande-jatte.svg",
        attributes_json={"place_of_origin": "França"},
        starting_bid_cents=200000,
        min_increment_cents=20000,
        current_bid_cents=280000,
        leader_user_id=b1_id,
        leader_masked_name=b1_user.masked_name,
        start_time=now - timedelta(hours=3),
        end_time=now + timedelta(days=7),
        original_end_time=now + timedelta(days=7),
        status="LIVE",
        bid_count=3,
        head_hash=h103_3,
        integrity_seal="",
    )

    lot_104_id = uuid.uuid4()
    t104_1 = now - timedelta(hours=3, minutes=20)
    t104_2 = now - timedelta(hours=2, minutes=45)
    settled_time = now - timedelta(hours=2)
    h104_1 = _legacy_sha256_bid_hash(lot_104_id, 1, b2_user.masked_name, 260000, t104_1.isoformat(), "GENESIS")
    h104_2 = _legacy_sha256_bid_hash(lot_104_id, 2, b1_user.masked_name, 320000, t104_2.isoformat(), h104_1)

    lot_104 = Lot(
        id=lot_104_id,
        lot_number=104,
        auctioneer_id=auc_id,
        external_artwork_id="16568",
        title="Water Lilies",
        artist="Claude Monet",
        date_display="1906",
        medium_display="Óleo sobre tela",
        image_url="/artworks/water-lilies.svg",
        attributes_json={"place_of_origin": "França"},
        starting_bid_cents=260000,
        min_increment_cents=20000,
        current_bid_cents=320000,
        leader_user_id=b1_id,
        leader_masked_name=b1_user.masked_name,
        start_time=now - timedelta(hours=4),
        end_time=settled_time,
        original_end_time=settled_time,
        status="ENDED",
        bid_count=2,
        head_hash=h104_2,
        integrity_seal="",
        settled_at=settled_time,
    )

    legacy_bids = [
        Bid(lot_id=lot_103_id, user_id=b1_id, bidder_masked_name=b1_user.masked_name, sequence_number=1, amount_cents=200000, previous_hash="GENESIS", current_hash=h103_1, node_signature="", created_at=t103_1),
        Bid(lot_id=lot_103_id, user_id=b2_id, bidder_masked_name=b2_user.masked_name, sequence_number=2, amount_cents=240000, previous_hash=h103_1, current_hash=h103_2, node_signature="", created_at=t103_2),
        Bid(lot_id=lot_103_id, user_id=b1_id, bidder_masked_name=b1_user.masked_name, sequence_number=3, amount_cents=280000, previous_hash=h103_2, current_hash=h103_3, node_signature="", created_at=t103_3),
        Bid(lot_id=lot_104_id, user_id=b2_id, bidder_masked_name=b2_user.masked_name, sequence_number=1, amount_cents=260000, previous_hash="GENESIS", current_hash=h104_1, node_signature="", created_at=t104_1),
        Bid(lot_id=lot_104_id, user_id=b1_id, bidder_masked_name=b1_user.masked_name, sequence_number=2, amount_cents=320000, previous_hash=h104_1, current_hash=h104_2, node_signature="", created_at=t104_2),
    ]

    receipt_code = f"ARP-{settled_time.year}-104LEG"
    legacy_cert = WinningCertificate(
        receipt_code=receipt_code,
        lot_id=lot_104_id,
        winner_user_id=b1_id,
        winner_masked_name=b1_user.masked_name,
        auctioneer_user_id=auc_id,
        final_amount_cents=320000,
        final_bid_hash=h104_2,
        receipt_signature=_legacy_receipt_sig(
            receipt_code, lot_104_id, b1_user.masked_name, 320000, settled_time.isoformat()
        ),
        settled_at=settled_time,
    )

    async with session_factory() as session:
        session.add_all([auc_user, b1_user, b2_user])
        await session.flush()
        session.add_all(
            [
                Wallet(user_id=auc_id, total_balance_cents=320000, committed_balance_cents=0),
                Wallet(user_id=b1_id, total_balance_cents=1180000, committed_balance_cents=280000),
                Wallet(user_id=b2_id, total_balance_cents=1200000, committed_balance_cents=0),
                lot_101,
                lot_103,
                lot_104,
            ]
        )
        await session.flush()
        session.add_all(legacy_bids + [legacy_cert])
        await session.commit()

        # Before migration, legacy lots 101, 103 and 104 fail audit & receipt fails v2 verification.
        for lot_id in (lot_101_id, lot_103_id, lot_104_id):
            pre_audit = await audit_lot_bid_chain(session, lot_id)
            assert pre_audit.is_intact is False
        pre_receipt = await get_public_receipt(session, receipt_code)
        assert pre_receipt.is_signature_valid is False

        stats = await session.run_sync(
            lambda sync_sess: rechain_and_seal_legacy_data(
                sync_sess.connection(),
                settings.HMAC_SECRET_KEY,
            )
        )
        await session.commit()

    assert stats == {
        "lots_updated": 3,
        "bids_updated": 5,
        "settlements_updated": 1,
    }

    async with session_factory() as fresh_session:
        for lot_id in (lot_101_id, lot_103_id, lot_104_id):
            post_audit = await audit_lot_bid_chain(fresh_session, lot_id)
            assert post_audit.is_intact is True
            assert post_audit.is_chain_valid is True
            assert post_audit.is_lot_seal_valid is True
            assert post_audit.anomalies == []

        audit_101 = await audit_lot_bid_chain(fresh_session, lot_101_id)
        assert audit_101.head_hash == GENESIS_HASH

        audit_103 = await audit_lot_bid_chain(fresh_session, lot_103_id)
        assert len(audit_103.nodes) == 3
        assert all(n.is_signature_valid and len(n.stored_signature) == 64 for n in audit_103.nodes)

        audit_104 = await audit_lot_bid_chain(fresh_session, lot_104_id)
        assert len(audit_104.nodes) == 2
        assert all(n.is_signature_valid and len(n.stored_signature) == 64 for n in audit_104.nodes)

        post_receipt = await get_public_receipt(fresh_session, receipt_code)
        assert post_receipt.is_signature_valid is True
        assert post_receipt.final_bid_hash == audit_104.head_hash
        assert post_receipt.settled_at_iso == format_utc_iso(settled_time)
