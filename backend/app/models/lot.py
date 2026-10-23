from datetime import datetime
from typing import TYPE_CHECKING, Any
import uuid
from uuid import UUID

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    JSON,
    String,
    Text,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, utc_now

if TYPE_CHECKING:
    from app.models.user import User


class Lot(Base, TimestampMixin):
    __tablename__ = "lots"

    id: Mapped[UUID] = mapped_column(
        Uuid,
        primary_key=True,
        default=uuid.uuid4,
    )
    lot_number: Mapped[int] = mapped_column(
        Integer,
        unique=True,
        index=True,
        autoincrement=True,
        nullable=False,
    )
    auctioneer_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("users.id", ondelete="RESTRICT"),
        index=True,
        nullable=False,
    )
    external_artwork_id: Mapped[str] = mapped_column(String(64), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    artist: Mapped[str] = mapped_column(String(255), nullable=False)
    date_display: Mapped[str] = mapped_column(String(120), nullable=False)
    medium_display: Mapped[str] = mapped_column(String(255), nullable=False)
    image_url: Mapped[str] = mapped_column(Text, nullable=False)
    attributes_json: Mapped[dict[str, Any]] = mapped_column(
        JSON,
        default=dict,
        nullable=False,
    )

    starting_bid_cents: Mapped[int] = mapped_column(BigInteger, nullable=False)
    min_increment_cents: Mapped[int] = mapped_column(BigInteger, nullable=False)
    current_bid_cents: Mapped[int | None] = mapped_column(BigInteger, nullable=True)

    leader_user_id: Mapped[UUID | None] = mapped_column(
        Uuid,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    leader_masked_name: Mapped[str | None] = mapped_column(String(80), nullable=True)

    start_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    end_time: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        index=True,
    )
    original_end_time: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
    )
    extension_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    status: Mapped[str] = mapped_column(
        String(20),
        default="SCHEDULED",
        nullable=False,
        index=True,
    )
    bid_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    head_hash: Mapped[str] = mapped_column(
        String(64),
        default="GENESIS",
        nullable=False,
    )
    cancelled_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    settled_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    bids: Mapped[list["Bid"]] = relationship(
        "Bid",
        back_populates="lot",
        cascade="all, delete-orphan",
        lazy="selectin",
        order_by="Bid.sequence_number.asc()",
    )
    certificate: Mapped["WinningCertificate | None"] = relationship(
        "WinningCertificate",
        back_populates="lot",
        uselist=False,
        cascade="all, delete-orphan",
        lazy="selectin",
    )

    __table_args__ = (
        CheckConstraint("starting_bid_cents > 0", name="ck_lot_starting_bid_positive"),
        CheckConstraint("min_increment_cents > 0", name="ck_lot_min_increment_positive"),
    )


class Bid(Base):
    __tablename__ = "bids"

    id: Mapped[UUID] = mapped_column(
        Uuid,
        primary_key=True,
        default=uuid.uuid4,
    )
    lot_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("lots.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    user_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("users.id", ondelete="RESTRICT"),
        index=True,
        nullable=False,
    )
    bidder_masked_name: Mapped[str] = mapped_column(String(80), nullable=False)
    sequence_number: Mapped[int] = mapped_column(Integer, nullable=False)
    amount_cents: Mapped[int] = mapped_column(BigInteger, nullable=False)
    previous_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    current_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    extension_triggered: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        nullable=False,
        index=True,
    )

    lot: Mapped["Lot"] = relationship("Lot", back_populates="bids")


class WinningCertificate(Base):
    __tablename__ = "settlements"

    id: Mapped[UUID] = mapped_column(
        Uuid,
        primary_key=True,
        default=uuid.uuid4,
    )
    receipt_code: Mapped[str] = mapped_column(
        String(32),
        unique=True,
        index=True,
        nullable=False,
    )
    lot_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("lots.id", ondelete="RESTRICT"),
        unique=True,
        nullable=False,
    )
    winner_user_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
    )
    winner_masked_name: Mapped[str] = mapped_column(String(80), nullable=False)
    auctioneer_user_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
    )
    final_amount_cents: Mapped[int] = mapped_column(BigInteger, nullable=False)
    final_bid_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    receipt_signature: Mapped[str] = mapped_column(String(64), nullable=False)
    settled_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        nullable=False,
    )

    lot: Mapped["Lot"] = relationship(
        "Lot",
        back_populates="certificate",
        lazy="selectin",
    )


Settlement = WinningCertificate
