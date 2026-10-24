from datetime import datetime
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field


class DepositRequest(BaseModel):
    amount_cents: int = Field(..., gt=0, description="Valor do depósito em centavos (maior que zero)")


class WalletResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: UUID
    total_balance_cents: int
    committed_balance_cents: int
    available_balance_cents: int


class TransactionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    wallet_id: UUID
    user_id: UUID
    lot_id: UUID | None = None
    type: str
    amount_cents: int
    balance_after_cents: int
    committed_after_cents: int
    description: str
    created_at: datetime
