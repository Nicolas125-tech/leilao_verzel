from uuid import UUID
from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.crypto import (
    GENESIS_HASH,
    compute_bid_hash,
    format_utc_iso,
    verify_bid_chain,
)
from app.models.lot import Bid, Lot
from app.schemas.audit import AuditChainResponse, AuditNodeResponse


async def audit_lot_bid_chain(
    db: AsyncSession,
    lot_id: UUID,
) -> AuditChainResponse:
    lot_res = await db.execute(select(Lot).where(Lot.id == lot_id))
    lot = lot_res.scalar_one_or_none()
    if not lot:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Lote nao encontrado.",
        )

    bids_res = await db.execute(
        select(Bid)
        .where(Bid.lot_id == lot.id)
        .order_by(Bid.sequence_number.asc(), Bid.created_at.asc())
    )
    bids = list(bids_res.scalars().all())

    bid_dicts = [
        {
            "id": b.id,
            "lot_id": b.lot_id,
            "sequence_number": b.sequence_number,
            "bidder_masked_name": b.bidder_masked_name,
            "amount_cents": b.amount_cents,
            "created_at_iso": format_utc_iso(b.created_at),
            "previous_hash": b.previous_hash,
            "current_hash": b.current_hash,
        }
        for b in bids
    ]

    is_chain_valid, verification_meta = verify_bid_chain(
        bids=bid_dicts,
        expected_head_hash=lot.head_hash,
        expected_count=lot.bid_count,
    )

    nodes: list[AuditNodeResponse] = []
    expected_seq = 1
    expected_prev = GENESIS_HASH

    for b in bid_dicts:
        recalculated = compute_bid_hash(
            lot_id=b["lot_id"],
            sequence_number=b["sequence_number"],
            bidder_masked_name=b["bidder_masked_name"],
            amount_cents=b["amount_cents"],
            created_at_iso=b["created_at_iso"],
            previous_hash=b["previous_hash"],
        )
        node_valid = (
            b["sequence_number"] == expected_seq
            and b["previous_hash"] == expected_prev
            and b["current_hash"] == recalculated
        )
        nodes.append(
            AuditNodeResponse(
                sequence_number=b["sequence_number"],
                bid_id=b["id"],
                bidder_masked_name=b["bidder_masked_name"],
                amount_cents=b["amount_cents"],
                created_at_iso=b["created_at_iso"],
                previous_hash=b["previous_hash"],
                expected_previous_hash=expected_prev,
                stored_hash=b["current_hash"],
                recalculated_hash=recalculated,
                is_valid=node_valid,
            )
        )
        expected_prev = b["current_hash"]
        expected_seq += 1

    return AuditChainResponse(
        lot_id=lot.id,
        lot_number=lot.lot_number,
        title=lot.title,
        is_chain_valid=is_chain_valid,
        total_bids=len(bids),
        head_hash=lot.head_hash,
        broken_at_sequence=verification_meta.get("broken_at_sequence"),
        anomalies=verification_meta.get("anomalies", []),
        nodes=nodes,
    )
