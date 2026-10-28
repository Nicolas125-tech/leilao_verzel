from uuid import UUID
from pydantic import BaseModel, Field


class AuditNodeResponse(BaseModel):
    sequence_number: int
    bid_id: UUID
    bidder_masked_name: str
    bidder_pseudonym: str
    amount_cents: int
    created_at_iso: str
    previous_hash: str
    expected_previous_hash: str
    stored_hash: str
    recalculated_hash: str
    node_signature: str
    is_valid: bool
    status: str


class AuditChainResponse(BaseModel):
    lot_id: UUID
    lot_number: int
    title: str
    is_chain_valid: bool
    is_intact: bool
    total_bids: int
    head_hash: str
    broken_at_sequence: int | None = None
    tampered_at_sequence: int | None = None
    anomalies: list[str] = Field(default_factory=list)
    nodes: list[AuditNodeResponse] = Field(default_factory=list)
