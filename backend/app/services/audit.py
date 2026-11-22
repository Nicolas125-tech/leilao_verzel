from typing import Any
from uuid import UUID
from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.crypto import (
    GENESIS_HASH,
    compute_lot_seal,
    format_utc_iso,
    generate_bidder_pseudonym,
    verify_bid_chain,
)
from app.models.lot import Bid, Lot
from app.schemas.audit import AuditChainResponse, AuditNodeResponse


class LotIntegrityError(Exception):
    """Erro de domínio disparado quando a cadeia de lances ou o selo do lote falham na verificação."""

    def __init__(self, lot_id: UUID, anomalies: list[str]) -> None:
        self.lot_id = lot_id
        self.anomalies = anomalies
        super().__init__(
            f"Integridade criptográfica comprometida no lote {lot_id}: {'; '.join(anomalies)}"
        )


def build_lot_seal(lot: Lot, secret: str | None = None) -> str:
    return compute_lot_seal(
        lot_id=lot.id,
        bid_count=lot.bid_count,
        head_hash=lot.head_hash,
        auctioneer_id=lot.auctioneer_id,
        end_time_iso=format_utc_iso(lot.end_time),
        leader_user_id=lot.leader_user_id,
        current_bid_cents=lot.current_bid_cents,
        secret=secret,
    )


async def verify_lot_integrity(
    db: AsyncSession,
    lot: Lot,
) -> tuple[bool, dict[str, Any]]:
    bids_res = await db.execute(
        select(Bid)
        .where(Bid.lot_id == lot.id)
        .order_by(Bid.sequence_number.asc(), Bid.created_at.asc())
        .execution_options(populate_existing=True)
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
            "node_signature": b.node_signature,
        }
        for b in bids
    ]

    lot_seal_meta = {
        "stored_seal": lot.integrity_seal,
        "lot_id": lot.id,
        "auctioneer_id": lot.auctioneer_id,
        "end_time_iso": format_utc_iso(lot.end_time),
        "leader_user_id": lot.leader_user_id,
        "current_bid_cents": lot.current_bid_cents,
    }

    return verify_bid_chain(
        bids=bid_dicts,
        expected_head_hash=lot.head_hash,
        expected_count=lot.bid_count,
        secret=settings.HMAC_SECRET_KEY,
        lot_seal_meta=lot_seal_meta,
    )


async def audit_lot_bid_chain(
    db: AsyncSession,
    lot_id: UUID,
) -> AuditChainResponse:
    lot_res = await db.execute(
        select(Lot)
        .where(Lot.id == lot_id)
        .execution_options(populate_existing=True)
    )
    lot = lot_res.scalar_one_or_none()
    if not lot:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Lote não encontrado.",
        )

    is_intact, verification_meta = await verify_lot_integrity(db, lot)
    nodes = [
        AuditNodeResponse(**node_data)
        for node_data in verification_meta["nodes"]
    ]
    tampered_seq = verification_meta["tampered_at_sequence"]

    return AuditChainResponse(
        lot_id=lot.id,
        lot_number=lot.lot_number,
        title=lot.title,
        genesis_hash=GENESIS_HASH,
        lot_seal=lot.integrity_seal,
        is_lot_seal_valid=verification_meta["is_lot_seal_valid"],
        is_chain_valid=is_intact,
        is_intact=is_intact,
        total_bids=len(nodes),
        head_hash=lot.head_hash,
        broken_at_sequence=tampered_seq,
        tampered_at_sequence=tampered_seq,
        anomalies=verification_meta["anomalies"],
        nodes=nodes,
    )
