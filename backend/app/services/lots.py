from datetime import datetime, timezone
from uuid import UUID
from fastapi import HTTPException, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.crypto import GENESIS_HASH
from app.models.lot import Lot
from app.models.user import User
from app.models.wallet import Wallet, WalletTransaction
from app.schemas.lot import LotCreateRequest


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
        from app.services.settlement import settle_lot

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

    lot.status = "CANCELLED"
    lot.cancelled_at = now_utc
    await db.commit()
    await db.refresh(lot)

    from app.services.websocket import ws_manager

    await ws_manager.broadcast_lot_cancelled(lot.id)
    return lot
