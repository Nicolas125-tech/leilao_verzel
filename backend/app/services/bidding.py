from datetime import datetime, timedelta, timezone
from uuid import UUID
from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.crypto import compute_bid_hash, format_utc_iso
from app.models.base import utc_now
from app.models.lot import Bid, Lot
from app.models.user import User
from app.models.wallet import Wallet, WalletTransaction
from app.schemas.bid import BidCreateRequest, BidResponse
from app.services.lots import ensure_utc, resolve_lot_status
from app.services.websocket import ws_manager

ANTI_SNIPING_WINDOW_SECONDS = 120


async def place_bid(
    db: AsyncSession,
    bidder: User,
    lot_id: UUID,
    payload: BidCreateRequest,
) -> Bid:
    lot_query = await db.execute(select(Lot).where(Lot.id == lot_id).with_for_update())
    lot = lot_query.scalar_one_or_none()
    if not lot:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Lote não encontrado.",
        )

    now_utc = utc_now()
    resolved_status = resolve_lot_status(lot, now_utc)

    if resolved_status == "SCHEDULED":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Este lote ainda não foi iniciado.",
        )

    if resolved_status == "ENDED":
        if lot.status != "ENDED":
            lot.status = "ENDED"
            if lot.settled_at is None and lot.bid_count == 0:
                lot.settled_at = now_utc
            await db.commit()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Este lote já foi encerrado.",
        )

    if resolved_status == "CANCELLED":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Este lote foi cancelado pelo leiloeiro.",
        )

    if lot.leader_user_id == bidder.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Você já detém o maior lance neste lote.",
        )

    if lot.current_bid_cents is None:
        min_required_cents = lot.starting_bid_cents
    else:
        min_required_cents = lot.current_bid_cents + lot.min_increment_cents

    if payload.amount_cents < min_required_cents:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Lance abaixo do valor mínimo exigido de R$ {min_required_cents / 100:.2f}.",
        )

    involved_user_ids = sorted(
        {uid for uid in (bidder.id, lot.leader_user_id) if uid is not None},
        key=lambda u: str(u),
    )
    wallets_query = await db.execute(
        select(Wallet)
        .where(Wallet.user_id.in_(involved_user_ids))
        .order_by(Wallet.user_id.asc())
        .with_for_update()
    )
    wallets_by_user: dict[UUID, Wallet] = {
        w.user_id: w for w in wallets_query.scalars().all()
    }

    bidder_wallet = wallets_by_user.get(bidder.id)
    if not bidder_wallet:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Carteira do licitante não encontrada.",
        )

    if payload.amount_cents > bidder_wallet.available_balance_cents:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Saldo disponível insuficiente para cobrir este lance.",
        )

    if lot.leader_user_id is not None and lot.current_bid_cents is not None:
        prev_leader_wallet = wallets_by_user.get(lot.leader_user_id)
        if prev_leader_wallet:
            released_amount = lot.current_bid_cents
            prev_leader_wallet.committed_balance_cents = max(
                0, prev_leader_wallet.committed_balance_cents - released_amount
            )
            release_tx = WalletTransaction(
                wallet_id=prev_leader_wallet.id,
                user_id=lot.leader_user_id,
                lot_id=lot.id,
                type="BID_RELEASE",
                amount_cents=released_amount,
                balance_after_cents=prev_leader_wallet.total_balance_cents,
                committed_after_cents=prev_leader_wallet.committed_balance_cents,
                description=f"Desbloqueio imediato por lance superado no Lote #{lot.lot_number}",
                created_at=utc_now(),
            )
            db.add(release_tx)

    bidder_wallet.committed_balance_cents += payload.amount_cents
    hold_tx = WalletTransaction(
        wallet_id=bidder_wallet.id,
        user_id=bidder.id,
        lot_id=lot.id,
        type="BID_HOLD",
        amount_cents=payload.amount_cents,
        balance_after_cents=bidder_wallet.total_balance_cents,
        committed_after_cents=bidder_wallet.committed_balance_cents,
        description=f"Reserva de saldo por liderança no Lote #{lot.lot_number}",
        created_at=utc_now(),
    )
    db.add(hold_tx)

    remaining_seconds = (ensure_utc(lot.end_time) - now_utc).total_seconds()
    extension_triggered = False
    if remaining_seconds <= ANTI_SNIPING_WINDOW_SECONDS:
        lot.end_time = ensure_utc(lot.end_time) + timedelta(seconds=ANTI_SNIPING_WINDOW_SECONDS)
        lot.extension_count += 1
        extension_triggered = True

    sequence_number = lot.bid_count + 1
    previous_hash = lot.head_hash
    bid_created_at = utc_now()
    created_at_iso = format_utc_iso(bid_created_at)

    current_hash = compute_bid_hash(
        lot_id=lot.id,
        sequence_number=sequence_number,
        bidder_masked_name=bidder.masked_name,
        amount_cents=payload.amount_cents,
        created_at_iso=created_at_iso,
        previous_hash=previous_hash,
    )

    new_bid = Bid(
        lot_id=lot.id,
        user_id=bidder.id,
        bidder_masked_name=bidder.masked_name,
        sequence_number=sequence_number,
        amount_cents=payload.amount_cents,
        previous_hash=previous_hash,
        current_hash=current_hash,
        extension_triggered=extension_triggered,
        created_at=bid_created_at,
    )
    db.add(new_bid)

    lot.status = "LIVE"
    lot.current_bid_cents = payload.amount_cents
    lot.leader_user_id = bidder.id
    lot.leader_masked_name = bidder.masked_name
    lot.bid_count = sequence_number
    lot.head_hash = current_hash

    await db.commit()
    await db.refresh(new_bid)

    bid_payload = BidResponse.model_validate(new_bid).model_dump(mode="json")
    lot_summary = {
        "lot_id": str(lot.id),
        "lot_number": lot.lot_number,
        "title": lot.title,
        "current_bid_cents": lot.current_bid_cents,
        "bid_count": lot.bid_count,
        "leader_user_id": str(lot.leader_user_id) if lot.leader_user_id else None,
        "leader_masked_name": lot.leader_masked_name,
        "lot_end_time": format_utc_iso(lot.end_time),
        "extension_count": lot.extension_count,
        "current_hash": lot.head_hash,
    }
    await ws_manager.broadcast_new_bid(lot.id, bid_payload, lot_summary)

    return new_bid
