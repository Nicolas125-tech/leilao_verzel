from datetime import datetime
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field


class BidCreateRequest(BaseModel):
    amount_cents: int = Field(..., gt=0, description="Valor do lance em centavos")


class BidResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    lot_id: UUID
    user_id: UUID
    bidder_masked_name: str
    sequence_number: int
    amount_cents: int
    previous_hash: str
    current_hash: str
    extension_triggered: bool
    created_at: datetime
