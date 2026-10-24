import asyncio
from datetime import timedelta
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.crypto import (
    GENESIS_HASH,
    compute_bid_hash,
    format_utc_iso,
    generate_receipt_signature,
)
from app.core.database import AsyncSessionLocal, engine
from app.core.privacy import generate_public_code, mask_name
from app.core.security import hash_password
from app.models.base import Base, utc_now
from app.models.lot import Bid, Lot, WinningCertificate
from app.models.user import User
from app.models.wallet import Wallet, WalletTransaction


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
    existing = await db.execute(
        select(User).where(User.email == "curador@verzel.com.br")
    )
    if existing.scalar_one_or_none() is not None:
        lots_res = await db.execute(select(Lot))
        artwork_by_lot = {
            101: "/artworks/nighthawks.svg",
            102: "/artworks/the-bedroom.svg",
            103: "/artworks/grande-jatte.svg",
            104: "/artworks/water-lilies.svg",
            105: "/artworks/american-gothic.svg",
        }
        updated = False
        for lot_obj in lots_res.scalars().all():
            target_img = artwork_by_lot.get(lot_obj.lot_number)
            if target_img and lot_obj.image_url != target_img:
                lot_obj.image_url = target_img
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

    # Carteiras iniciais e depositos base:
    # - Nicolas deposita R$ 15.000,00 (1_500_000 centavos), arremata Lote #104 por R$ 3.200,00 (320_000)
    #   e lidera Lote #103 por R$ 2.800,00 (280_000 comprometidos).
    # - Marina deposita R$ 12.000,00 (1_200_000 centavos), sem saldo comprometido ativo.
    # - Leiloeira recebe R$ 3.200,00 (320_000 centavos) da liquidacao do Lote #104.
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

    # Lote 101: SCHEDULED (agendado para iniciar no futuro, sem lances)
    lot_scheduled = Lot(
        id=uuid.uuid4(),
        lot_number=101,
        auctioneer_id=auctioneer.id,
        external_artwork_id="111628",
        title="Nighthawks",
        artist="Edward Hopper",
        date_display="1942",
        medium_display="Oil on canvas",
        image_url="/artworks/nighthawks.svg",
        attributes_json={
            "place_of_origin": "United States",
            "dimensions": "84.1 x 152.4 cm",
            "department_title": "Arts of the Americas",
            "classification_title": "Oil on canvas",
        },
        starting_bid_cents=350000,
        min_increment_cents=25000,
        current_bid_cents=None,
        leader_user_id=None,
        leader_masked_name=None,
        start_time=now + timedelta(hours=2),
        end_time=now + timedelta(hours=6),
        original_end_time=now + timedelta(hours=6),
        extension_count=0,
        status="SCHEDULED",
        bid_count=0,
        head_hash=GENESIS_HASH,
    )

    # Lote 102: LIVE sem lances (aberto para o primeiro lance)
    lot_live_empty = Lot(
        id=uuid.uuid4(),
        lot_number=102,
        auctioneer_id=auctioneer.id,
        external_artwork_id="28560",
        title="The Bedroom",
        artist="Vincent van Gogh",
        date_display="1889",
        medium_display="Oil on canvas",
        image_url="/artworks/the-bedroom.svg",
        attributes_json={
            "place_of_origin": "France",
            "dimensions": "73.6 x 92.3 cm",
            "department_title": "Painting and Sculpture of Europe",
            "classification_title": "Painting",
        },
        starting_bid_cents=180000,
        min_increment_cents=15000,
        current_bid_cents=None,
        leader_user_id=None,
        leader_masked_name=None,
        start_time=now - timedelta(minutes=30),
        end_time=now + timedelta(minutes=45),
        original_end_time=now + timedelta(minutes=45),
        extension_count=0,
        status="LIVE",
        bid_count=0,
        head_hash=GENESIS_HASH,
    )

    # Lote 103: LIVE disputado com 3 lances encadeados
    lot_live_disputed_id = uuid.uuid4()
    b1_time = now - timedelta(minutes=25)
    b1_hash = compute_bid_hash(
        lot_id=lot_live_disputed_id,
        sequence_number=1,
        bidder_masked_name=nicolas.masked_name,
        amount_cents=200000,
        created_at_iso=format_utc_iso(b1_time),
        previous_hash=GENESIS_HASH,
    )
    b2_time = now - timedelta(minutes=18)
    b2_hash = compute_bid_hash(
        lot_id=lot_live_disputed_id,
        sequence_number=2,
        bidder_masked_name=marina.masked_name,
        amount_cents=240000,
        created_at_iso=format_utc_iso(b2_time),
        previous_hash=b1_hash,
    )
    b3_time = now - timedelta(minutes=9)
    b3_hash = compute_bid_hash(
        lot_id=lot_live_disputed_id,
        sequence_number=3,
        bidder_masked_name=nicolas.masked_name,
        amount_cents=280000,
        created_at_iso=format_utc_iso(b3_time),
        previous_hash=b2_hash,
    )

    lot_live_disputed = Lot(
        id=lot_live_disputed_id,
        lot_number=103,
        auctioneer_id=auctioneer.id,
        external_artwork_id="27992",
        title="A Sunday on La Grande Jatte",
        artist="Georges Seurat",
        date_display="1884-1886",
        medium_display="Oil on canvas",
        image_url="/artworks/grande-jatte.svg",
        attributes_json={
            "place_of_origin": "France",
            "dimensions": "207.5 x 308.1 cm",
            "department_title": "Painting and Sculpture of Europe",
            "classification_title": "Oil on canvas",
        },
        starting_bid_cents=200000,
        min_increment_cents=20000,
        current_bid_cents=280000,
        leader_user_id=nicolas.id,
        leader_masked_name=nicolas.masked_name,
        start_time=now - timedelta(minutes=40),
        end_time=now + timedelta(minutes=25),
        original_end_time=now + timedelta(minutes=25),
        extension_count=0,
        status="LIVE",
        bid_count=3,
        head_hash=b3_hash,
    )

    # Lote 104: ENDED / SETTLED com certificado assinado
    lot_settled_id = uuid.uuid4()
    s1_time = now - timedelta(hours=3, minutes=20)
    s1_hash = compute_bid_hash(
        lot_id=lot_settled_id,
        sequence_number=1,
        bidder_masked_name=marina.masked_name,
        amount_cents=260000,
        created_at_iso=format_utc_iso(s1_time),
        previous_hash=GENESIS_HASH,
    )
    s2_time = now - timedelta(hours=2, minutes=45)
    s2_hash = compute_bid_hash(
        lot_id=lot_settled_id,
        sequence_number=2,
        bidder_masked_name=nicolas.masked_name,
        amount_cents=320000,
        created_at_iso=format_utc_iso(s2_time),
        previous_hash=s1_hash,
    )
    settled_time = now - timedelta(hours=2)

    lot_settled = Lot(
        id=lot_settled_id,
        lot_number=104,
        auctioneer_id=auctioneer.id,
        external_artwork_id="16568",
        title="Water Lilies",
        artist="Claude Monet",
        date_display="1906",
        medium_display="Oil on canvas",
        image_url="/artworks/water-lilies.svg",
        attributes_json={
            "place_of_origin": "France",
            "dimensions": "89.9 x 94.1 cm",
            "department_title": "Painting and Sculpture of Europe",
            "classification_title": "Oil on canvas",
        },
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

    # Lote 105: CANCELLED
    cancelled_time = now - timedelta(hours=1)
    lot_cancelled = Lot(
        id=uuid.uuid4(),
        lot_number=105,
        auctioneer_id=auctioneer.id,
        external_artwork_id="6565",
        title="American Gothic",
        artist="Grant Wood",
        date_display="1930",
        medium_display="Oil on beaverboard",
        image_url="/artworks/american-gothic.svg",
        attributes_json={
            "place_of_origin": "United States",
            "dimensions": "78 x 65.3 cm",
            "department_title": "Arts of the Americas",
            "classification_title": "Painting",
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

    # Lances do Lote 103 (LIVE disputado)
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

    # Lances do Lote 104 (SETTLED)
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

    # Certificado de arremate assinado para o Lote 104
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

    # Transacoes de carteira para historico realista
    txs = [
        WalletTransaction(
            wallet_id=nicolas_wallet.id,
            user_id=nicolas.id,
            lot_id=None,
            type="DEPOSIT",
            amount_cents=1500000,
            balance_after_cents=1500000,
            committed_after_cents=0,
            description="Aporte inicial de demonstracao na carteira",
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
            description="Aporte inicial de demonstracao na carteira",
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
            description="Liquidacao definitiva de arremate do Lote #104",
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
            description="Credito recebido pela venda do Lote #104",
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
            description="Reserva de saldo por lideranca no Lote #103",
            created_at=b3_time,
        ),
    ]
    db.add_all(txs)

    await db.commit()


async def _main() -> None:
    import sys

    if "--reset" in sys.argv:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
            await conn.run_sync(Base.metadata.create_all)
    async with AsyncSessionLocal() as session:
        await run_seed(session)


if __name__ == "__main__":
    asyncio.run(_main())
