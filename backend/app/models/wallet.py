import uuid
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import BigInteger, CheckConstraint, ForeignKey, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.user import User


class Wallet(Base, TimestampMixin):
    __tablename__ = "wallets"

    id: Mapped[UUID] = mapped_column(
        Uuid,
        primary_key=True,
        default=uuid.uuid4,
    )
    user_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("users.id", ondelete="CASCADE"),
        unique=True,
        index=True,
        nullable=False,
    )
    total_balance_cents: Mapped[int] = mapped_column(
        BigInteger,
        default=0,
        nullable=False,
    )
    committed_balance_cents: Mapped[int] = mapped_column(
        BigInteger,
        default=0,
        nullable=False,
    )

    user: Mapped["User"] = relationship(
        "User",
        back_populates="wallet",
        lazy="selectin",
    )
    transactions: Mapped[list["WalletTransaction"]] = relationship(
        "WalletTransaction",
        back_populates="wallet",
        cascade="all, delete-orphan",
        lazy="selectin",
        order_by="desc(WalletTransaction.created_at)",
    )

    __table_args__ = (
        CheckConstraint("total_balance_cents >= 0", name="ck_wallet_total_positive"),
        CheckConstraint("committed_balance_cents >= 0", name="ck_wallet_committed_positive"),
        CheckConstraint(
            "committed_balance_cents <= total_balance_cents",
            name="ck_wallet_balance_consistency",
        ),
    )

    @property
    def available_balance_cents(self) -> int:
        return self.total_balance_cents - self.committed_balance_cents


class WalletTransaction(Base, TimestampMixin):
    __tablename__ = "wallet_transactions"

    id: Mapped[UUID] = mapped_column(
        Uuid,
        primary_key=True,
        default=uuid.uuid4,
    )
    wallet_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("wallets.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    user_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    lot_id: Mapped[UUID | None] = mapped_column(
        Uuid,
        ForeignKey("lots.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    type: Mapped[str] = mapped_column(
        String(30),
        nullable=False,
    )
    amount_cents: Mapped[int] = mapped_column(
        BigInteger,
        nullable=False,
    )
    balance_after_cents: Mapped[int] = mapped_column(
        BigInteger,
        nullable=False,
    )
    committed_after_cents: Mapped[int] = mapped_column(
        BigInteger,
        nullable=False,
    )
    description: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )

    wallet: Mapped["Wallet"] = relationship("Wallet", back_populates="transactions")
