"""initial_schema

Revision ID: 0001_initial_schema
Revises: 
Create Date: 2026-10-23 09:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0001_initial_schema"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("email", sa.String(length=160), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("role", sa.String(length=20), nullable=False, server_default="BIDDER"),
        sa.Column("public_code", sa.String(length=16), nullable=False),
        sa.Column("masked_name", sa.String(length=80), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_users_email"), "users", ["email"], unique=True)
    op.create_index(op.f("ix_users_public_code"), "users", ["public_code"], unique=True)

    op.create_table(
        "wallets",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("total_balance_cents", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("committed_balance_cents", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("total_balance_cents >= 0", name="ck_wallet_total_positive"),
        sa.CheckConstraint("committed_balance_cents >= 0", name="ck_wallet_committed_positive"),
        sa.CheckConstraint("committed_balance_cents <= total_balance_cents", name="ck_wallet_balance_consistency"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_wallets_user_id"), "wallets", ["user_id"], unique=True)

    op.create_table(
        "lots",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("lot_number", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("auctioneer_id", sa.Uuid(), nullable=False),
        sa.Column("external_artwork_id", sa.String(length=64), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("artist", sa.String(length=255), nullable=False),
        sa.Column("date_display", sa.String(length=120), nullable=False),
        sa.Column("medium_display", sa.String(length=255), nullable=False),
        sa.Column("image_url", sa.Text(), nullable=False),
        sa.Column("attributes_json", sa.JSON(), nullable=False),
        sa.Column("starting_bid_cents", sa.BigInteger(), nullable=False),
        sa.Column("min_increment_cents", sa.BigInteger(), nullable=False),
        sa.Column("current_bid_cents", sa.BigInteger(), nullable=True),
        sa.Column("leader_user_id", sa.Uuid(), nullable=True),
        sa.Column("leader_masked_name", sa.String(length=80), nullable=True),
        sa.Column("start_time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("end_time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("original_end_time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("extension_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="SCHEDULED"),
        sa.Column("bid_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("head_hash", sa.String(length=64), nullable=False, server_default="GENESIS"),
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("settled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("starting_bid_cents > 0", name="ck_lot_starting_bid_positive"),
        sa.CheckConstraint("min_increment_cents > 0", name="ck_lot_min_increment_positive"),
        sa.ForeignKeyConstraint(["auctioneer_id"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["leader_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_lots_auctioneer_id"), "lots", ["auctioneer_id"], unique=False)
    op.create_index(op.f("ix_lots_end_time"), "lots", ["end_time"], unique=False)
    op.create_index(op.f("ix_lots_lot_number"), "lots", ["lot_number"], unique=True)
    op.create_index(op.f("ix_lots_status"), "lots", ["status"], unique=False)

    op.create_table(
        "wallet_transactions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("wallet_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("lot_id", sa.Uuid(), nullable=True),
        sa.Column("type", sa.String(length=30), nullable=False),
        sa.Column("amount_cents", sa.BigInteger(), nullable=False),
        sa.Column("balance_after_cents", sa.BigInteger(), nullable=False),
        sa.Column("committed_after_cents", sa.BigInteger(), nullable=False),
        sa.Column("description", sa.String(length=255), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["lot_id"], ["lots.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["wallet_id"], ["wallets.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_wallet_transactions_lot_id"), "wallet_transactions", ["lot_id"], unique=False)
    op.create_index(op.f("ix_wallet_transactions_user_id"), "wallet_transactions", ["user_id"], unique=False)
    op.create_index(op.f("ix_wallet_transactions_wallet_id"), "wallet_transactions", ["wallet_id"], unique=False)

    op.create_table(
        "bids",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("lot_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("bidder_masked_name", sa.String(length=80), nullable=False),
        sa.Column("sequence_number", sa.Integer(), nullable=False),
        sa.Column("amount_cents", sa.BigInteger(), nullable=False),
        sa.Column("previous_hash", sa.String(length=64), nullable=False),
        sa.Column("current_hash", sa.String(length=64), nullable=False),
        sa.Column("extension_triggered", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["lot_id"], ["lots.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_bids_created_at"), "bids", ["created_at"], unique=False)
    op.create_index(op.f("ix_bids_lot_id"), "bids", ["lot_id"], unique=False)
    op.create_index(op.f("ix_bids_user_id"), "bids", ["user_id"], unique=False)

    op.create_table(
        "settlements",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("receipt_code", sa.String(length=32), nullable=False),
        sa.Column("lot_id", sa.Uuid(), nullable=False),
        sa.Column("winner_user_id", sa.Uuid(), nullable=False),
        sa.Column("winner_masked_name", sa.String(length=80), nullable=False),
        sa.Column("auctioneer_user_id", sa.Uuid(), nullable=False),
        sa.Column("final_amount_cents", sa.BigInteger(), nullable=False),
        sa.Column("final_bid_hash", sa.String(length=64), nullable=False),
        sa.Column("receipt_signature", sa.String(length=64), nullable=False),
        sa.Column("settled_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["auctioneer_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["lot_id"], ["lots.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["winner_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_settlements_lot_id"), "settlements", ["lot_id"], unique=True)
    op.create_index(op.f("ix_settlements_receipt_code"), "settlements", ["receipt_code"], unique=True)


def downgrade() -> None:
    op.drop_table("settlements")
    op.drop_table("bids")
    op.drop_table("wallet_transactions")
    op.drop_table("lots")
    op.drop_table("wallets")
    op.drop_table("users")
