"""hmac_audit_seal_and_constraints

Revision ID: 0003_hmac_audit_seal_and_constraints
Revises: 0002_add_catalog_cache
Create Date: 2026-11-21 23:25:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

from app.core.config import settings
from app.core.crypto import GENESIS_HASH
from app.core.migration_helpers import rechain_and_seal_legacy_data

revision: str = "0003_hmac_audit_seal_and_constraints"
down_revision: Union[str, None] = "0002_add_catalog_cache"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _column_names(inspector: sa.Inspector, table_name: str) -> set[str]:
    return {col["name"] for col in inspector.get_columns(table_name)}


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    lot_cols = _column_names(inspector, "lots")
    if "integrity_seal" not in lot_cols:
        op.add_column(
            "lots",
            sa.Column("integrity_seal", sa.String(length=64), nullable=False, server_default=""),
        )

    bid_cols = _column_names(inspector, "bids")
    if "node_signature" not in bid_cols:
        op.add_column(
            "bids",
            sa.Column("node_signature", sa.String(length=64), nullable=False, server_default=""),
        )

    if bind.dialect.name == "postgresql":
        op.alter_column(
            "lots",
            "head_hash",
            existing_type=sa.String(length=64),
            server_default=GENESIS_HASH,
        )

    rechain_and_seal_legacy_data(bind, secret=settings.HMAC_SECRET_KEY)

    inspector = sa.inspect(bind)
    existing_uqs = inspector.get_unique_constraints("bids")
    has_seq_unique = any(
        uq.get("name") == "uq_bid_lot_sequence"
        or uq.get("column_names") == ["lot_id", "sequence_number"]
        for uq in existing_uqs
    )
    if not has_seq_unique:
        with op.batch_alter_table("bids") as batch_op:
            batch_op.create_unique_constraint("uq_bid_lot_sequence", ["lot_id", "sequence_number"])

    existing_indexes = inspector.get_indexes("bids")
    has_current_hash_unique = any(
        uq.get("column_names") == ["current_hash"] for uq in existing_uqs
    ) or any(
        idx.get("unique") and idx.get("column_names") == ["current_hash"]
        for idx in existing_indexes
    )
    if not has_current_hash_unique:
        op.create_index("ix_bids_current_hash", "bids", ["current_hash"], unique=True)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    existing_indexes = {idx["name"] for idx in inspector.get_indexes("bids")}
    if "ix_bids_current_hash" in existing_indexes:
        op.drop_index("ix_bids_current_hash", table_name="bids")

    existing_uqs = {uq["name"] for uq in inspector.get_unique_constraints("bids") if uq.get("name")}
    if "uq_bid_lot_sequence" in existing_uqs:
        with op.batch_alter_table("bids") as batch_op:
            batch_op.drop_constraint("uq_bid_lot_sequence", type_="unique")

    bid_cols = _column_names(inspector, "bids")
    if "node_signature" in bid_cols:
        op.drop_column("bids", "node_signature")

    lot_cols = _column_names(inspector, "lots")
    if "integrity_seal" in lot_cols:
        op.drop_column("lots", "integrity_seal")

    if bind.dialect.name == "postgresql":
        op.alter_column(
            "lots",
            "head_hash",
            existing_type=sa.String(length=64),
            server_default="GENESIS",
        )
