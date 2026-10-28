from datetime import datetime, timezone
import logging
from uuid import UUID
from fastapi import HTTPException, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.crypto import GENESIS_HASH, format_utc_iso
from app.models.lot import Bid, Lot
from app.models.user import User
from app.models.wallet import Wallet, WalletTransaction
from app.schemas.lot import (
    DisputeCounts,
    DisputeItem,
    LotCreateRequest,
    MyDisputesResponse,
)
from app.services.settlement import settle_lot
from app.services.websocket import ws_manager

logger = logging.getLogger("verzel.auction.catalog")


def ensure_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def resolve_lot_status(lot: Lot, now: datetime | None = None) -> str:
    if lot.status == "CANCELLED":
        return "CANCELLED"
    if lot.status == "ENDED":
        return "ENDED"

    now_utc = ensure_utc(now or datetime.now(timezone.utc))
    start_utc = ensure_utc(lot.start_time)
    end_utc = ensure_utc(lot.end_time)

    if now_utc >= end_utc:
        return "ENDED"
    if now_utc < start_utc:
        return "SCHEDULED"
    return "LIVE"


async def sync_lot_temporal_state(db: AsyncSession, lot: Lot) -> Lot:
    now_utc = datetime.now(timezone.utc)
    resolved = resolve_lot_status(lot, now_utc)
    if resolved == "ENDED" and (lot.status != "ENDED" or lot.settled_at is None):
        return await settle_lot(db, lot)

    if resolved != lot.status:
        lot.status = resolved
        await db.commit()
        await db.refresh(lot)
    return lot


async def get_next_lot_number(db: AsyncSession) -> int:
    result = await db.execute(select(func.coalesce(func.max(Lot.lot_number), 100)))
    current_max = result.scalar_one()
    return int(current_max) + 1


async def create_lot(
    db: AsyncSession,
    auctioneer: User,
    payload: LotCreateRequest,
) -> Lot:
    now_utc = datetime.now(timezone.utc)
    next_number = await get_next_lot_number(db)

    if now_utc >= payload.end_time:
        initial_status = "ENDED"
    elif now_utc < payload.start_time:
        initial_status = "SCHEDULED"
    else:
        initial_status = "LIVE"

    lot = Lot(
        lot_number=next_number,
        auctioneer_id=auctioneer.id,
        external_artwork_id=payload.external_artwork_id,
        title=payload.title,
        artist=payload.artist,
        date_display=payload.date_display,
        medium_display=payload.medium_display,
        image_url=payload.image_url,
        attributes_json=payload.attributes_json,
        starting_bid_cents=payload.starting_bid_cents,
        min_increment_cents=payload.min_increment_cents,
        current_bid_cents=None,
        leader_user_id=None,
        leader_masked_name=None,
        start_time=payload.start_time,
        end_time=payload.end_time,
        original_end_time=payload.end_time,
        extension_count=0,
        status=initial_status,
        bid_count=0,
        head_hash=GENESIS_HASH,
        settled_at=now_utc if initial_status == "ENDED" else None,
    )
    db.add(lot)
    await db.commit()
    await db.refresh(lot)

    logger.info(
        "Novo lote catalogado: #%s ('%s', %s) com lance inicial de R$ %.2f",
        lot.lot_number,
        lot.title,
        lot.artist,
        lot.starting_bid_cents / 100,
    )

    return lot


async def list_public_lots(
    db: AsyncSession,
    status_filter: str | None = None,
    query_text: str | None = None,
) -> list[Lot]:
    stmt = select(Lot).where(Lot.status != "CANCELLED").order_by(Lot.lot_number.asc())
    if query_text and query_text.strip():
        pattern = f"%{query_text.strip()}%"
        stmt = stmt.where(
            or_(
                Lot.title.ilike(pattern),
                Lot.artist.ilike(pattern),
                Lot.medium_display.ilike(pattern),
            )
        )

    result = await db.execute(stmt)
    lots = list(result.scalars().all())

    synced_lots: list[Lot] = []
    for lot in lots:
        synced = await sync_lot_temporal_state(db, lot)
        if synced.status == "CANCELLED":
            continue
        if status_filter and synced.status != status_filter.upper():
            continue
        synced_lots.append(synced)

    return synced_lots


async def get_lot_by_id(db: AsyncSession, lot_id: UUID) -> Lot:
    result = await db.execute(select(Lot).where(Lot.id == lot_id))
    lot = result.scalar_one_or_none()
    if not lot:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Lote não encontrado.",
        )
    return await sync_lot_temporal_state(db, lot)


async def cancel_lot(db: AsyncSession, auctioneer: User, lot_id: UUID) -> Lot:
    result = await db.execute(select(Lot).where(Lot.id == lot_id).with_for_update())
    lot = result.scalar_one_or_none()
    if not lot:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Lote não encontrado.",
        )

    if lot.auctioneer_id != auctioneer.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Apenas o leiloeiro responsável por este lote pode cancelá-lo.",
        )

    now_utc = datetime.now(timezone.utc)
    resolved = resolve_lot_status(lot, now_utc)
    if resolved in ("ENDED", "CANCELLED"):
        if resolved == "ENDED" and lot.status != "ENDED":
            lot.status = "ENDED"
            if lot.settled_at is None:
                lot.settled_at = now_utc
            await db.commit()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Não é possível cancelar um lote com status {resolved}.",
        )

    if lot.leader_user_id is not None and lot.current_bid_cents is not None:
        wallet_res = await db.execute(
            select(Wallet).where(Wallet.user_id == lot.leader_user_id).with_for_update()
        )
        leader_wallet = wallet_res.scalar_one_or_none()
        if leader_wallet:
            refund_amount = lot.current_bid_cents
            leader_wallet.committed_balance_cents = max(
                0, leader_wallet.committed_balance_cents - refund_amount
            )
            refund_tx = WalletTransaction(
                wallet_id=leader_wallet.id,
                user_id=lot.leader_user_id,
                lot_id=lot.id,
                type="CANCEL_REFUND",
                amount_cents=refund_amount,
                balance_after_cents=leader_wallet.total_balance_cents,
                committed_after_cents=leader_wallet.committed_balance_cents,
                description=f"Estorno automático por cancelamento do Lote #{lot.lot_number}",
            )
            db.add(refund_tx)
            logger.info(
                "Lote #%s: caução de R$ %.2f estornada para o licitante líder %s por cancelamento do pregão",
                lot.lot_number,
                refund_amount / 100,
                lot.leader_masked_name,
            )

    lot.status = "CANCELLED"
    lot.cancelled_at = now_utc
    await db.commit()
    await db.refresh(lot)

    logger.warning(
        "Lote #%s cancelado pelo leiloeiro %s",
        lot.lot_number,
        auctioneer.masked_name,
    )

    await ws_manager.broadcast_lot_cancelled(lot.id)
    return lot


async def get_my_disputes(db: AsyncSession, bidder: User) -> MyDisputesResponse:
    subq = (
        select(
            Bid.lot_id.label("lot_id"),
            func.max(Bid.amount_cents).label("user_highest_bid_cents"),
            func.count(Bid.id).label("user_bid_count"),
        )
        .where(Bid.user_id == bidder.id)
        .group_by(Bid.lot_id)
        .subquery()
    )

    stmt = (
        select(Lot, subq.c.user_highest_bid_cents, subq.c.user_bid_count)
        .join(subq, Lot.id == subq.c.lot_id)
        .order_by(Lot.end_time.desc())
    )
    result = await db.execute(stmt)
    rows = result.all()

    now_utc = datetime.now(timezone.utc)
    in_dispute_count = 0
    won_count = 0
    lost_count = 0
    items: list[DisputeItem] = []

    for lot, highest_cents, bid_count in rows:
        synced_lot = await sync_lot_temporal_state(db, lot)
        end_utc = ensure_utc(synced_lot.end_time)
        is_user_winning = (synced_lot.leader_user_id == bidder.id)

        if synced_lot.status == "ENDED" or now_utc >= end_utc:
            time_remaining_formatted = "Encerrado"
        else:
            delta_seconds = max(0, int((end_utc - now_utc).total_seconds()))
            hours = delta_seconds // 3600
            minutes = (delta_seconds % 3600) // 60
            seconds = delta_seconds % 60
            if hours > 0:
                time_remaining_formatted = f"{hours}h {minutes:02d}m"
            elif minutes > 0:
                time_remaining_formatted = f"{minutes}m {seconds:02d}s"
            else:
                time_remaining_formatted = f"{seconds}s"

        if synced_lot.status in ("LIVE", "SCHEDULED"):
            status_str = "WINNING" if is_user_winning else "OUTBID"
            in_dispute_count += 1
        elif synced_lot.status == "ENDED":
            if is_user_winning:
                status_str = "WON"
                won_count += 1
            else:
                status_str = "LOST"
                lost_count += 1
        else:
            status_str = "CANCELLED"
            lost_count += 1

        items.append(
            DisputeItem(
                lot_id=synced_lot.id,
                lot_number=synced_lot.lot_number,
                artwork_title=synced_lot.title,
                artwork_artist=synced_lot.artist,
                artwork_image_url=synced_lot.image_url,
                user_highest_bid_cents=int(highest_cents),
                user_bid_count=int(bid_count),
                current_bid_cents=int(synced_lot.current_bid_cents or synced_lot.starting_bid_cents),
                ends_at_iso=format_utc_iso(synced_lot.end_time),
                time_remaining_formatted=time_remaining_formatted,
                status=status_str,
                leader_pseudonym=synced_lot.leader_masked_name or "",
                is_user_winning=is_user_winning,
            )
        )

    return MyDisputesResponse(
        counts=DisputeCounts(
            in_dispute=in_dispute_count,
            won=won_count,
            lost=lost_count,
        ),
        items=items,
    )
