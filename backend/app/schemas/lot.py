from datetime import datetime, timezone
from typing import Any
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field, computed_field, model_validator

from app.core.crypto import format_utc_iso
from app.schemas.bid import BidResponse


def _to_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


class LotCreateRequest(BaseModel):
    external_artwork_id: str = Field(..., min_length=1, max_length=64)
    title: str = Field(..., min_length=1, max_length=255)
    artist: str = Field(..., min_length=1, max_length=255)
    date_display: str = Field(default="Data Desconhecida", max_length=120)
    medium_display: str = Field(default="Técnica Mista", max_length=255)
    image_url: str = Field(..., min_length=1)
    attributes_json: dict[str, Any] = Field(default_factory=dict)
    starting_bid_cents: int = Field(..., gt=0)
    min_increment_cents: int = Field(..., gt=0)
    start_time: datetime
    end_time: datetime

    @model_validator(mode="after")
    def validate_time_window(self) -> "LotCreateRequest":
        start_utc = _to_utc(self.start_time)
        end_utc = _to_utc(self.end_time)
        if end_utc <= start_utc:
            raise ValueError("O horário de encerramento deve ser posterior ao horário de início.")
        self.start_time = start_utc
        self.end_time = end_utc
        return self


class CertificateSummaryResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    receipt_code: str
    lot_id: UUID
    winner_user_id: UUID
    winner_masked_name: str
    auctioneer_user_id: UUID
    final_amount_cents: int
    final_bid_hash: str
    receipt_signature: str
    settled_at: datetime

    @computed_field
    @property
    def settled_at_iso(self) -> str:
        return format_utc_iso(self.settled_at)


class LotResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    lot_number: int
    auctioneer_id: UUID
    external_artwork_id: str
    title: str
    artist: str
    date_display: str
    medium_display: str
    image_url: str
    attributes_json: dict[str, Any]
    starting_bid_cents: int
    min_increment_cents: int
    current_bid_cents: int | None = None
    leader_user_id: UUID | None = None
    leader_masked_name: str | None = None
    start_time: datetime
    end_time: datetime
    original_end_time: datetime
    extension_count: int
    status: str
    bid_count: int
    head_hash: str
    cancelled_at: datetime | None = None
    settled_at: datetime | None = None
    created_at: datetime
    certificate: CertificateSummaryResponse | None = None
    bids: list[BidResponse] = Field(default_factory=list)


class PublicReceiptResponse(BaseModel):
    receipt_code: str
    lot_id: UUID
    lot_number: int
    title: str
    artist: str
    date_display: str
    medium_display: str
    image_url: str
    attributes_json: dict[str, Any]
    winner_masked_name: str
    final_amount_cents: int
    final_bid_hash: str
    receipt_signature: str
    settled_at: datetime
    settled_at_iso: str
    is_signature_valid: bool


class ParticipatedLotItem(BaseModel):
    lot: LotResponse
    my_highest_bid_cents: int
    user_bid_status: str


class BidderBidsAndWinsResponse(BaseModel):
    participated_lots: list[ParticipatedLotItem]
    won_lots: list[LotResponse]


class AuctioneerDashboardResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    total_revenue_cents: int
    settled_with_winner_count: int
    active_lots_count: int
    lots: list[LotResponse]
