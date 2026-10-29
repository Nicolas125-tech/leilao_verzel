"""add_catalog_cache_table

Revision ID: 0002_add_catalog_cache
Revises: 0001_initial_schema
Create Date: 2026-10-28 21:15:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0002_add_catalog_cache"
down_revision: Union[str, None] = "0001_initial_schema"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "catalog_cache" not in inspector.get_table_names():
        op.create_table(
            "catalog_cache",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("cache_key", sa.String(length=255), nullable=False),
            sa.Column("query_text", sa.String(length=255), nullable=False, server_default=""),
            sa.Column("payload_json", sa.JSON(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(op.f("ix_catalog_cache_cache_key"), "catalog_cache", ["cache_key"], unique=True)
        op.create_index(op.f("ix_catalog_cache_expires_at"), "catalog_cache", ["expires_at"], unique=False)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "catalog_cache" in inspector.get_table_names():
        op.drop_index(op.f("ix_catalog_cache_expires_at"), table_name="catalog_cache")
        op.drop_index(op.f("ix_catalog_cache_cache_key"), table_name="catalog_cache")
        op.drop_table("catalog_cache")
