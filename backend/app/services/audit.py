from uuid import UUID
from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.crypto import (
    format_utc_iso,
    generate_bidder_pseudonym,
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
            detail="Lote não encontrado.",
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
            "user_id": b.user_id,
            "sequence_number": b.sequence_number,
            "bidder_masked_name": b.bidder_masked_name,
            "bidder_pseudonym": generate_bidder_pseudonym(
                b.user_id,
                settings.HMAC_SECRET_KEY,
            ),
            "amount_cents": b.amount_cents,
            "created_at_iso": format_utc_iso(b.created_at),
            "previous_hash": b.previous_hash,
            "current_hash": b.current_hash,
        }
        for b in bids
    ]

    is_intact, verification_meta = verify_bid_chain(
        bids=bid_dicts,
        expected_head_hash=lot.head_hash,
        expected_count=lot.bid_count,
        secret=settings.HMAC_SECRET_KEY,
    )

    nodes = [
        AuditNodeResponse(**node_data)
        for node_data in verification_meta["nodes"]
    ]
    tampered_seq = verification_meta["tampered_at_sequence"]

    return AuditChainResponse(
        lot_id=lot.id,
        lot_number=lot.lot_number,
        title=lot.title,
        is_chain_valid=is_intact,
        is_intact=is_intact,
        total_bids=len(bids),
        head_hash=lot.head_hash,
        broken_at_sequence=tampered_seq,
        tampered_at_sequence=tampered_seq,
        anomalies=verification_meta["anomalies"],
        nodes=nodes,
    )
