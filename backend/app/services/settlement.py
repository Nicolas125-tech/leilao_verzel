import uuid
from uuid import UUID
from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.crypto import (
    format_utc_iso,
    generate_receipt_signature,
    verify_receipt_signature,
)
from app.models.base import utc_now
from app.models.lot import Bid, Lot, WinningCertificate
from app.models.user import User
from app.models.wallet import Wallet, WalletTransaction
from app.schemas.lot import (
    AuctioneerDashboardResponse,
    BidderBidsAndWinsResponse,
    CertificateSummaryResponse,
    LotResponse,
    ParticipatedLotItem,
    PublicReceiptResponse,
)
from app.services.websocket import ws_manager


async def settle_lot(db: AsyncSession, lot: Lot) -> Lot:
    res = await db.execute(select(Lot).where(Lot.id == lot.id).with_for_update())
    locked_lot = res.scalar_one_or_none()
    if not locked_lot:
        return lot

    if locked_lot.status == "CANCELLED":
        return locked_lot

    if locked_lot.settled_at is not None and locked_lot.status == "ENDED":
        return locked_lot

    now_utc = utc_now()

    if (
        locked_lot.bid_count == 0
        or locked_lot.leader_user_id is None
        or locked_lot.current_bid_cents is None
    ):
        locked_lot.status = "ENDED"
        locked_lot.settled_at = now_utc
        await db.commit()
        await db.refresh(locked_lot)
        await ws_manager.broadcast_lot_settled(locked_lot.id, None)
        return locked_lot

    existing_cert_res = await db.execute(
        select(WinningCertificate).where(WinningCertificate.lot_id == locked_lot.id)
    )
    existing_cert = existing_cert_res.scalar_one_or_none()
    if existing_cert is not None:
        locked_lot.status = "ENDED"
        if locked_lot.settled_at is None:
            locked_lot.settled_at = existing_cert.settled_at
        await db.commit()
        await db.refresh(locked_lot)
        return locked_lot

    user_ids = sorted(
        {locked_lot.leader_user_id, locked_lot.auctioneer_id},
        key=lambda u: str(u),
    )
    wallets_res = await db.execute(
        select(Wallet)
        .where(Wallet.user_id.in_(user_ids))
        .order_by(Wallet.user_id.asc())
        .with_for_update()
    )
    wallets_by_user: dict[UUID, Wallet] = {
        w.user_id: w for w in wallets_res.scalars().all()
    }

    final_amount = locked_lot.current_bid_cents
    winner_wallet = wallets_by_user.get(locked_lot.leader_user_id)
    if winner_wallet:
        winner_wallet.committed_balance_cents = max(
            0, winner_wallet.committed_balance_cents - final_amount
        )
        winner_wallet.total_balance_cents = max(
            0, winner_wallet.total_balance_cents - final_amount
        )
        debit_tx = WalletTransaction(
            wallet_id=winner_wallet.id,
            user_id=locked_lot.leader_user_id,
            lot_id=locked_lot.id,
            type="SETTLEMENT_DEBIT",
            amount_cents=final_amount,
            balance_after_cents=winner_wallet.total_balance_cents,
            committed_after_cents=winner_wallet.committed_balance_cents,
            description=f"Liquidacao definitiva de arremate do Lote #{locked_lot.lot_number}",
            created_at=utc_now(),
        )
        db.add(debit_tx)

    auctioneer_wallet = wallets_by_user.get(locked_lot.auctioneer_id)
    if auctioneer_wallet:
        auctioneer_wallet.total_balance_cents += final_amount
        credit_tx = WalletTransaction(
            wallet_id=auctioneer_wallet.id,
            user_id=locked_lot.auctioneer_id,
            lot_id=locked_lot.id,
            type="SETTLEMENT_CREDIT",
            amount_cents=final_amount,
            balance_after_cents=auctioneer_wallet.total_balance_cents,
            committed_after_cents=auctioneer_wallet.committed_balance_cents,
            description=f"Credito recebido pela venda do Lote #{locked_lot.lot_number}",
            created_at=utc_now(),
        )
        db.add(credit_tx)

    settled_at = utc_now()
    settled_at_iso = format_utc_iso(settled_at)
    receipt_code = f"ARP-{settled_at.year}-{uuid.uuid4().hex[:6].upper()}"
    winner_masked = locked_lot.leader_masked_name or ""

    signature = generate_receipt_signature(
        receipt_code=receipt_code,
        lot_id=locked_lot.id,
        winner_masked_name=winner_masked,
        final_amount_cents=final_amount,
        settled_at_iso=settled_at_iso,
    )

    certificate = WinningCertificate(
        receipt_code=receipt_code,
        lot_id=locked_lot.id,
        winner_user_id=locked_lot.leader_user_id,
        winner_masked_name=winner_masked,
        auctioneer_user_id=locked_lot.auctioneer_id,
        final_amount_cents=final_amount,
        final_bid_hash=locked_lot.head_hash,
        receipt_signature=signature,
        settled_at=settled_at,
    )
    db.add(certificate)

    locked_lot.status = "ENDED"
    locked_lot.settled_at = settled_at

    await db.commit()
    await db.refresh(locked_lot)
    await db.refresh(certificate)
    locked_lot.certificate = certificate

    cert_payload = CertificateSummaryResponse.model_validate(certificate).model_dump(mode="json")
    await ws_manager.broadcast_lot_settled(locked_lot.id, cert_payload)

    return locked_lot


async def get_public_receipt(
    db: AsyncSession,
    receipt_code: str,
) -> PublicReceiptResponse:
    res = await db.execute(
        select(WinningCertificate).where(WinningCertificate.receipt_code == receipt_code)
    )
    cert = res.scalar_one_or_none()
    if not cert:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Comprovante de arremate nao encontrado.",
        )

    lot_res = await db.execute(select(Lot).where(Lot.id == cert.lot_id))
    lot = lot_res.scalar_one()

    settled_at_iso = format_utc_iso(cert.settled_at)
    is_valid = verify_receipt_signature(
        signature=cert.receipt_signature,
        receipt_code=cert.receipt_code,
        lot_id=cert.lot_id,
        winner_masked_name=cert.winner_masked_name,
        final_amount_cents=cert.final_amount_cents,
        settled_at_iso=settled_at_iso,
    )

    return PublicReceiptResponse(
        receipt_code=cert.receipt_code,
        lot_id=lot.id,
        lot_number=lot.lot_number,
        title=lot.title,
        artist=lot.artist,
        date_display=lot.date_display,
        medium_display=lot.medium_display,
        image_url=lot.image_url,
        attributes_json=lot.attributes_json,
        winner_masked_name=cert.winner_masked_name,
        final_amount_cents=cert.final_amount_cents,
        final_bid_hash=cert.final_bid_hash,
        receipt_signature=cert.receipt_signature,
        settled_at=cert.settled_at,
        settled_at_iso=settled_at_iso,
        is_signature_valid=is_valid,
    )


async def get_bidder_bids_and_wins(
    db: AsyncSession,
    bidder: User,
) -> BidderBidsAndWinsResponse:
    from app.services.lots import sync_lot_temporal_state

    bids_res = await db.execute(
        select(Bid)
        .where(Bid.user_id == bidder.id)
        .order_by(Bid.created_at.desc())
    )
    user_bids = list(bids_res.scalars().all())

    max_bid_by_lot: dict[UUID, int] = {}
    ordered_lot_ids: list[UUID] = []
    for b in user_bids:
        if b.lot_id not in max_bid_by_lot:
            ordered_lot_ids.append(b.lot_id)
            max_bid_by_lot[b.lot_id] = b.amount_cents
        elif b.amount_cents > max_bid_by_lot[b.lot_id]:
            max_bid_by_lot[b.lot_id] = b.amount_cents

    if not ordered_lot_ids:
        return BidderBidsAndWinsResponse(participated_lots=[], won_lots=[])

    lots_res = await db.execute(select(Lot).where(Lot.id.in_(ordered_lot_ids)))
    lots_by_id: dict[UUID, Lot] = {lot.id: lot for lot in lots_res.scalars().all()}

    participated_lots: list[ParticipatedLotItem] = []
    won_lots: list[LotResponse] = []

    for lot_id in ordered_lot_ids:
        lot = lots_by_id.get(lot_id)
        if not lot:
            continue
        synced_lot = await sync_lot_temporal_state(db, lot)
        lot_resp = LotResponse.model_validate(synced_lot)
        is_leader = synced_lot.leader_user_id == bidder.id

        if synced_lot.status == "ENDED" and is_leader:
            user_bid_status = "WON"
            won_lots.append(lot_resp)
        elif synced_lot.status == "CANCELLED":
            user_bid_status = "CANCELLED"
        elif is_leader:
            user_bid_status = "WINNING"
        else:
            user_bid_status = "OUTBID"

        participated_lots.append(
            ParticipatedLotItem(
                lot=lot_resp,
                my_highest_bid_cents=max_bid_by_lot[lot_id],
                user_bid_status=user_bid_status,
            )
        )

    return BidderBidsAndWinsResponse(
        participated_lots=participated_lots,
        won_lots=won_lots,
    )


async def get_auctioneer_dashboard(
    db: AsyncSession,
    auctioneer: User,
) -> AuctioneerDashboardResponse:
    from app.services.lots import sync_lot_temporal_state

    lots_res = await db.execute(
        select(Lot)
        .where(Lot.auctioneer_id == auctioneer.id)
        .order_by(Lot.lot_number.desc())
    )
    raw_lots = list(lots_res.scalars().all())

    synced_lots: list[Lot] = []
    for lot in raw_lots:
        synced = await sync_lot_temporal_state(db, lot)
        synced_lots.append(synced)

    certs_res = await db.execute(
        select(WinningCertificate).where(
            WinningCertificate.auctioneer_user_id == auctioneer.id
        )
    )
    certs = list(certs_res.scalars().all())

    total_revenue_cents = sum(c.final_amount_cents for c in certs)
    settled_with_winner_count = len(certs)
    active_lots_count = sum(1 for l in synced_lots if l.status in ("LIVE", "SCHEDULED"))

    return AuctioneerDashboardResponse(
        total_revenue_cents=total_revenue_cents,
        settled_with_winner_count=settled_with_winner_count,
        active_lots_count=active_lots_count,
        lots=[LotResponse.model_validate(l) for l in synced_lots],
    )
