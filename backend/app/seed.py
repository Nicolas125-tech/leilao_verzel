import asyncio
from datetime import timedelta
import logging
import sys
from typing import Any
import uuid

import httpx
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.crypto import (
    GENESIS_HASH,
    compute_bid_hash,
    format_utc_iso,
    generate_bidder_pseudonym,
    generate_receipt_signature,
)
from app.core.database import AsyncSessionLocal, engine
from app.core.privacy import generate_public_code, mask_name
from app.core.security import hash_password
from app.models.base import Base, utc_now
from app.models.lot import Bid, Lot, WinningCertificate
from app.models.user import User
from app.models.wallet import Wallet, WalletTransaction
from app.services import catalog

logger = logging.getLogger(__name__)

FALLBACK_LOT_101: dict[str, Any] = {
    "external_artwork_id": "111628",
    "title": "Nighthawks",
    "artist": "Edward Hopper",
    "date_display": "1942",
    "medium_display": "Óleo sobre tela",
    "image_url": "/artworks/nighthawks.svg",
    "attributes_json": {
        "place_of_origin": "Estados Unidos",
        "dimensions": "84.1 x 152.4 cm",
        "department_title": "Artes das Américas",
        "classification_title": "Pintura",
    },
}

FALLBACK_LOT_102: dict[str, Any] = {
    "external_artwork_id": "28560",
    "title": "The Bedroom",
    "artist": "Vincent van Gogh",
    "date_display": "1889",
    "medium_display": "Óleo sobre tela",
    "image_url": "/artworks/the-bedroom.svg",
    "attributes_json": {
        "place_of_origin": "França",
        "dimensions": "73.6 x 92.3 cm",
        "department_title": "Pintura e Escultura",
        "classification_title": "Pintura",
    },
}

FALLBACK_LOT_103: dict[str, Any] = {
    "external_artwork_id": "27992",
    "title": "A Sunday on La Grande Jatte",
    "artist": "Georges Seurat",
    "date_display": "1884-1886",
    "medium_display": "Óleo sobre tela",
    "image_url": "/artworks/grande-jatte.svg",
    "attributes_json": {
        "place_of_origin": "França",
        "dimensions": "207.5 x 308.1 cm",
        "department_title": "Pintura e Escultura",
        "classification_title": "Pintura",
    },
}

FALLBACK_LOT_104: dict[str, Any] = {
    "external_artwork_id": "16568",
    "title": "Water Lilies",
    "artist": "Claude Monet",
    "date_display": "1906",
    "medium_display": "Óleo sobre tela",
    "image_url": "/artworks/water-lilies.svg",
    "attributes_json": {
        "place_of_origin": "França",
        "dimensions": "89.9 x 94.1 cm",
        "department_title": "Pintura e Escultura",
        "classification_title": "Pintura",
    },
}


async def _resolve_seed_artwork(query: str, fallback: dict[str, Any]) -> dict[str, Any]:
    try:
        artworks = await catalog.fetch_external_artworks(query)
        if artworks and len(artworks) > 0:
            first = artworks[0]
            return {
                "external_artwork_id": first["external_id"],
                "title": first["title"],
                "artist": first["artist"],
                "date_display": first["date_display"],
                "medium_display": first["medium_display"],
                "image_url": first["image_url"],
                "attributes_json": first["attributes"],
            }
    except (httpx.HTTPError, httpx.TimeoutException) as exc:
        logger.warning(
            "Seed: Falha ao buscar '%s' na API externa, usando contingência local: %s",
            query,
            exc,
        )

    return fallback


async def _resolve_all_seed_artworks() -> dict[int, dict[str, Any]]:
    art_101, art_102, art_103, art_104 = await asyncio.gather(
        _resolve_seed_artwork("landscape", FALLBACK_LOT_101),
        _resolve_seed_artwork("van gogh", FALLBACK_LOT_102),
        _resolve_seed_artwork("monet", FALLBACK_LOT_103),
        _resolve_seed_artwork("water lilies", FALLBACK_LOT_104),
    )
    return {
        101: art_101,
        102: art_102,
        103: art_103,
        104: art_104,
    }


def _build_user(name: str, email: str, role: str, password: str = "Verzel2026!") -> User:
    user_id = uuid.uuid4()
    pub_code = generate_public_code(user_id, role)
    masked = mask_name(name, pub_code)
    return User(
        id=user_id,
        name=name,
        email=email,
        password_hash=hash_password(password),
        role=role,
        public_code=pub_code,
        masked_name=masked,
    )


async def run_seed(db: AsyncSession) -> None:
    resolved_by_lot = await _resolve_all_seed_artworks()

    existing = await db.execute(
        select(User).where(User.email == "curador@verzel.com.br")
    )
    if existing.scalar_one_or_none() is not None:
        lots_res = await db.execute(select(Lot))
        updated = False
        for lot_obj in lots_res.scalars().all():
            target_art = resolved_by_lot.get(lot_obj.lot_number)
            if target_art and lot_obj.image_url != target_art["image_url"]:
                lot_obj.external_artwork_id = target_art["external_artwork_id"]
                lot_obj.title = target_art["title"]
                lot_obj.artist = target_art["artist"]
                lot_obj.date_display = target_art["date_display"]
                lot_obj.medium_display = target_art["medium_display"]
                lot_obj.image_url = target_art["image_url"]
                lot_obj.attributes_json = target_art["attributes_json"]
                updated = True
        if updated:
            await db.commit()
        return

    now = utc_now()

    auctioneer = _build_user("Helena Curadora", "curador@verzel.com.br", "AUCTIONEER")
    nicolas = _build_user("Nicolas Brito", "nicolas@verzel.com.br", "BIDDER")
    marina = _build_user("Marina Silva", "marina@verzel.com.br", "BIDDER")

    db.add_all([auctioneer, nicolas, marina])
    await db.flush()

    auc_wallet = Wallet(
        user_id=auctioneer.id,
        total_balance_cents=320000,
        committed_balance_cents=0,
    )
    nicolas_wallet = Wallet(
        user_id=nicolas.id,
        total_balance_cents=1180000,
        committed_balance_cents=280000,
    )
    marina_wallet = Wallet(
        user_id=marina.id,
        total_balance_cents=1200000,
        committed_balance_cents=0,
    )
    db.add_all([auc_wallet, nicolas_wallet, marina_wallet])
    await db.flush()

    lot_scheduled = Lot(
        id=uuid.uuid4(),
        lot_number=101,
        auctioneer_id=auctioneer.id,
        **resolved_by_lot[101],
        starting_bid_cents=350000,
        min_increment_cents=25000,
        current_bid_cents=None,
        leader_user_id=None,
        leader_masked_name=None,
        start_time=now + timedelta(days=1),
        end_time=now + timedelta(days=8),
        original_end_time=now + timedelta(days=8),
        extension_count=0,
        status="SCHEDULED",
        bid_count=0,
        head_hash=GENESIS_HASH,
    )

    lot_live_empty = Lot(
        id=uuid.uuid4(),
        lot_number=102,
        auctioneer_id=auctioneer.id,
        **resolved_by_lot[102],
        starting_bid_cents=180000,
        min_increment_cents=15000,
        current_bid_cents=None,
        leader_user_id=None,
        leader_masked_name=None,
        start_time=now - timedelta(hours=2),
        end_time=now + timedelta(days=7),
        original_end_time=now + timedelta(days=7),
        extension_count=0,
        status="LIVE",
        bid_count=0,
        head_hash=GENESIS_HASH,
    )

    nicolas_pseudo = generate_bidder_pseudonym(nicolas.id, settings.HMAC_SECRET_KEY)
    marina_pseudo = generate_bidder_pseudonym(marina.id, settings.HMAC_SECRET_KEY)

    lot_live_disputed_id = uuid.uuid4()
    b1_time = now - timedelta(minutes=25)
    b1_hash = compute_bid_hash(
        lot_id=lot_live_disputed_id,
        sequence_number=1,
        bidder_masked_name=nicolas_pseudo,
        amount_cents=200000,
        created_at_iso=format_utc_iso(b1_time),
        previous_hash=GENESIS_HASH,
    )
    b2_time = now - timedelta(minutes=18)
    b2_hash = compute_bid_hash(
        lot_id=lot_live_disputed_id,
        sequence_number=2,
        bidder_masked_name=marina_pseudo,
        amount_cents=240000,
        created_at_iso=format_utc_iso(b2_time),
        previous_hash=b1_hash,
    )
    b3_time = now - timedelta(minutes=9)
    b3_hash = compute_bid_hash(
        lot_id=lot_live_disputed_id,
        sequence_number=3,
        bidder_masked_name=nicolas_pseudo,
        amount_cents=280000,
        created_at_iso=format_utc_iso(b3_time),
        previous_hash=b2_hash,
    )

    lot_live_disputed = Lot(
        id=lot_live_disputed_id,
        lot_number=103,
        auctioneer_id=auctioneer.id,
        **resolved_by_lot[103],
        starting_bid_cents=200000,
        min_increment_cents=20000,
        current_bid_cents=280000,
        leader_user_id=nicolas.id,
        leader_masked_name=nicolas.masked_name,
        start_time=now - timedelta(hours=3),
        end_time=now + timedelta(days=7),
        original_end_time=now + timedelta(days=7),
        extension_count=0,
        status="LIVE",
        bid_count=3,
        head_hash=b3_hash,
    )

    lot_settled_id = uuid.uuid4()
    s1_time = now - timedelta(hours=3, minutes=20)
    s1_hash = compute_bid_hash(
        lot_id=lot_settled_id,
        sequence_number=1,
        bidder_masked_name=marina_pseudo,
        amount_cents=260000,
        created_at_iso=format_utc_iso(s1_time),
        previous_hash=GENESIS_HASH,
    )
    s2_time = now - timedelta(hours=2, minutes=45)
    s2_hash = compute_bid_hash(
        lot_id=lot_settled_id,
        sequence_number=2,
        bidder_masked_name=nicolas_pseudo,
        amount_cents=320000,
        created_at_iso=format_utc_iso(s2_time),
        previous_hash=s1_hash,
    )
    settled_time = now - timedelta(hours=2)

    lot_settled = Lot(
        id=lot_settled_id,
        lot_number=104,
        auctioneer_id=auctioneer.id,
        **resolved_by_lot[104],
        starting_bid_cents=260000,
        min_increment_cents=20000,
        current_bid_cents=320000,
        leader_user_id=nicolas.id,
        leader_masked_name=nicolas.masked_name,
        start_time=now - timedelta(hours=4),
        end_time=settled_time,
        original_end_time=settled_time,
        extension_count=0,
        status="ENDED",
        bid_count=2,
        head_hash=s2_hash,
        settled_at=settled_time,
    )

    cancelled_time = now - timedelta(hours=1)
    lot_cancelled = Lot(
        id=uuid.uuid4(),
        lot_number=105,
        auctioneer_id=auctioneer.id,
        external_artwork_id="6565",
        title="American Gothic",
        artist="Grant Wood",
        date_display="1930",
        medium_display="Óleo sobre painel",
        image_url="/artworks/american-gothic.svg",
        attributes_json={
            "place_of_origin": "Estados Unidos",
            "dimensions": "78 x 65.3 cm",
            "department_title": "Artes das Américas",
            "classification_title": "Pintura",
        },
        starting_bid_cents=220000,
        min_increment_cents=20000,
        current_bid_cents=None,
        leader_user_id=None,
        leader_masked_name=None,
        start_time=now - timedelta(hours=2),
        end_time=now + timedelta(hours=1),
        original_end_time=now + timedelta(hours=1),
        extension_count=0,
        status="CANCELLED",
        bid_count=0,
        head_hash=GENESIS_HASH,
        cancelled_at=cancelled_time,
    )

    db.add_all(
        [
            lot_scheduled,
            lot_live_empty,
            lot_live_disputed,
            lot_settled,
            lot_cancelled,
        ]
    )
    await db.flush()

    bids_103 = [
        Bid(
            lot_id=lot_live_disputed.id,
            user_id=nicolas.id,
            bidder_masked_name=nicolas.masked_name,
            sequence_number=1,
            amount_cents=200000,
            previous_hash=GENESIS_HASH,
            current_hash=b1_hash,
            extension_triggered=False,
            created_at=b1_time,
        ),
        Bid(
            lot_id=lot_live_disputed.id,
            user_id=marina.id,
            bidder_masked_name=marina.masked_name,
            sequence_number=2,
            amount_cents=240000,
            previous_hash=b1_hash,
            current_hash=b2_hash,
            extension_triggered=False,
            created_at=b2_time,
        ),
        Bid(
            lot_id=lot_live_disputed.id,
            user_id=nicolas.id,
            bidder_masked_name=nicolas.masked_name,
            sequence_number=3,
            amount_cents=280000,
            previous_hash=b2_hash,
            current_hash=b3_hash,
            extension_triggered=False,
            created_at=b3_time,
        ),
    ]

    bids_104 = [
        Bid(
            lot_id=lot_settled.id,
            user_id=marina.id,
            bidder_masked_name=marina.masked_name,
            sequence_number=1,
            amount_cents=260000,
            previous_hash=GENESIS_HASH,
            current_hash=s1_hash,
            extension_triggered=False,
            created_at=s1_time,
        ),
        Bid(
            lot_id=lot_settled.id,
            user_id=nicolas.id,
            bidder_masked_name=nicolas.masked_name,
            sequence_number=2,
            amount_cents=320000,
            previous_hash=s1_hash,
            current_hash=s2_hash,
            extension_triggered=False,
            created_at=s2_time,
        ),
    ]
    db.add_all(bids_103 + bids_104)

    receipt_code = f"ARP-{settled_time.year}-104A9F"
    settled_at_iso = format_utc_iso(settled_time)
    cert_signature = generate_receipt_signature(
        receipt_code=receipt_code,
        lot_id=lot_settled.id,
        winner_masked_name=nicolas.masked_name,
        final_amount_cents=320000,
        settled_at_iso=settled_at_iso,
    )
    certificate = WinningCertificate(
        receipt_code=receipt_code,
        lot_id=lot_settled.id,
        winner_user_id=nicolas.id,
        winner_masked_name=nicolas.masked_name,
        auctioneer_user_id=auctioneer.id,
        final_amount_cents=320000,
        final_bid_hash=s2_hash,
        receipt_signature=cert_signature,
        settled_at=settled_time,
    )
    db.add(certificate)

    txs = [
        WalletTransaction(
            wallet_id=nicolas_wallet.id,
            user_id=nicolas.id,
            lot_id=None,
            type="DEPOSIT",
            amount_cents=1500000,
            balance_after_cents=1500000,
            committed_after_cents=0,
            description="Aporte inicial de demonstração na carteira",
            created_at=now - timedelta(hours=5),
        ),
        WalletTransaction(
            wallet_id=marina_wallet.id,
            user_id=marina.id,
            lot_id=None,
            type="DEPOSIT",
            amount_cents=1200000,
            balance_after_cents=1200000,
            committed_after_cents=0,
            description="Aporte inicial de demonstração na carteira",
            created_at=now - timedelta(hours=5),
        ),
        WalletTransaction(
            wallet_id=nicolas_wallet.id,
            user_id=nicolas.id,
            lot_id=lot_settled.id,
            type="SETTLEMENT_DEBIT",
            amount_cents=320000,
            balance_after_cents=1180000,
            committed_after_cents=0,
            description="Liquidação definitiva de arremate do Lote #104",
            created_at=settled_time,
        ),
        WalletTransaction(
            wallet_id=auc_wallet.id,
            user_id=auctioneer.id,
            lot_id=lot_settled.id,
            type="SETTLEMENT_CREDIT",
            amount_cents=320000,
            balance_after_cents=320000,
            committed_after_cents=0,
            description="Crédito recebido pela venda do Lote #104",
            created_at=settled_time,
        ),
        WalletTransaction(
            wallet_id=nicolas_wallet.id,
            user_id=nicolas.id,
            lot_id=lot_live_disputed.id,
            type="BID_HOLD",
            amount_cents=280000,
            balance_after_cents=1180000,
            committed_after_cents=280000,
            description="Reserva de saldo por liderança no Lote #103",
            created_at=b3_time,
        ),
    ]
    db.add_all(txs)

    await db.commit()


async def reset_demo_data(db: AsyncSession) -> None:
    await db.execute(delete(WinningCertificate))
    await db.execute(delete(WalletTransaction))
    await db.execute(delete(Bid))
    await db.execute(delete(Lot))
    await db.execute(delete(Wallet))
    await db.execute(delete(User))
    await db.flush()
    db.expire_all()
    await run_seed(db)


async def _main() -> None:
    if "--reset" in sys.argv:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
            await conn.run_sync(Base.metadata.create_all)
    async with AsyncSessionLocal() as session:
        await run_seed(session)


if __name__ == "__main__":
    asyncio.run(_main())
