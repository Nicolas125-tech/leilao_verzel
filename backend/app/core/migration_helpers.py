from typing import Any
from uuid import UUID

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from app.core.crypto import (
    GENESIS_HASH,
    compute_bid_hash,
    compute_lot_seal,
    compute_node_signature,
    format_utc_iso,
    generate_bidder_pseudonym,
    generate_receipt_signature,
)


def _lots_table() -> sa.TableClause:
    return sa.table(
        "lots",
        sa.column("id", sa.Uuid()),
        sa.column("lot_number", sa.Integer()),
        sa.column("auctioneer_id", sa.Uuid()),
        sa.column("current_bid_cents", sa.BigInteger()),
        sa.column("leader_user_id", sa.Uuid()),
        sa.column("end_time", sa.DateTime(timezone=True)),
        sa.column("bid_count", sa.Integer()),
        sa.column("head_hash", sa.String(64)),
        sa.column("integrity_seal", sa.String(64)),
    )


def _bids_table() -> sa.TableClause:
    return sa.table(
        "bids",
        sa.column("id", sa.Uuid()),
        sa.column("lot_id", sa.Uuid()),
        sa.column("user_id", sa.Uuid()),
        sa.column("sequence_number", sa.Integer()),
        sa.column("amount_cents", sa.BigInteger()),
        sa.column("previous_hash", sa.String(64)),
        sa.column("current_hash", sa.String(64)),
        sa.column("node_signature", sa.String(64)),
        sa.column("created_at", sa.DateTime(timezone=True)),
    )


def _settlements_table() -> sa.TableClause:
    return sa.table(
        "settlements",
        sa.column("id", sa.Uuid()),
        sa.column("receipt_code", sa.String(32)),
        sa.column("lot_id", sa.Uuid()),
        sa.column("winner_masked_name", sa.String(80)),
        sa.column("final_amount_cents", sa.BigInteger()),
        sa.column("final_bid_hash", sa.String(64)),
        sa.column("receipt_signature", sa.String(64)),
        sa.column("settled_at", sa.DateTime(timezone=True)),
    )


def rechain_and_seal_legacy_data(
    connection: Connection,
    secret: str | None = None,
) -> dict[str, int]:
    lots_t = _lots_table()
    bids_t = _bids_table()
    settlements_t = _settlements_table()

    lots_rows = (
        connection.execute(sa.select(lots_t).order_by(lots_t.c.lot_number.asc()))
        .mappings()
        .all()
    )

    lots_updated = 0
    bids_updated = 0
    settlements_updated = 0
    head_hash_by_lot: dict[Any, str] = {}

    for lot in lots_rows:
        lot_id: UUID = lot["id"]
        bids_rows = (
            connection.execute(
                sa.select(bids_t)
                .where(bids_t.c.lot_id == lot_id)
                .order_by(bids_t.c.sequence_number.asc(), bids_t.c.created_at.asc())
            )
            .mappings()
            .all()
        )

        if not bids_rows:
            new_head = GENESIS_HASH
            new_count = 0
            effective_leader = None
            effective_bid_cents = None
        else:
            prev_hash = GENESIS_HASH
            for bid in bids_rows:
                pseudonym = generate_bidder_pseudonym(bid["user_id"], secret=secret)
                created_at_iso = format_utc_iso(bid["created_at"])
                curr_hash = compute_bid_hash(
                    lot_id=lot_id,
                    sequence_number=bid["sequence_number"],
                    bidder_masked_name=pseudonym,
                    amount_cents=bid["amount_cents"],
                    created_at_iso=created_at_iso,
                    previous_hash=prev_hash,
                    secret=secret,
                )
                node_sig = compute_node_signature(
                    lot_id=lot_id,
                    sequence_number=bid["sequence_number"],
                    pseudonym=pseudonym,
                    amount_cents=bid["amount_cents"],
                    created_at_iso=created_at_iso,
                    previous_hash=prev_hash,
                    current_hash=curr_hash,
                    secret=secret,
                )
                connection.execute(
                    sa.update(bids_t)
                    .where(bids_t.c.id == bid["id"])
                    .values(
                        previous_hash=prev_hash,
                        current_hash=curr_hash,
                        node_signature=node_sig,
                    )
                )
                prev_hash = curr_hash
                bids_updated += 1

            new_head = prev_hash
            new_count = len(bids_rows)
            effective_leader = bids_rows[-1]["user_id"]
            effective_bid_cents = bids_rows[-1]["amount_cents"]

        seal = compute_lot_seal(
            lot_id=lot_id,
            bid_count=new_count,
            head_hash=new_head,
            auctioneer_id=lot["auctioneer_id"],
            end_time_iso=format_utc_iso(lot["end_time"]),
            leader_user_id=effective_leader,
            current_bid_cents=effective_bid_cents,
            secret=secret,
        )

        connection.execute(
            sa.update(lots_t)
            .where(lots_t.c.id == lot_id)
            .values(
                head_hash=new_head,
                bid_count=new_count,
                integrity_seal=seal,
            )
        )
        head_hash_by_lot[lot_id] = new_head
        lots_updated += 1

    settlement_rows = connection.execute(sa.select(settlements_t)).mappings().all()
    for cert in settlement_rows:
        final_bid_hash = head_hash_by_lot.get(cert["lot_id"], cert["final_bid_hash"])
        receipt_sig = generate_receipt_signature(
            receipt_code=cert["receipt_code"],
            lot_id=cert["lot_id"],
            winner_masked_name=cert["winner_masked_name"],
            final_amount_cents=cert["final_amount_cents"],
            final_bid_hash=final_bid_hash,
            settled_at_iso=format_utc_iso(cert["settled_at"]),
            secret=secret,
        )
        connection.execute(
            sa.update(settlements_t)
            .where(settlements_t.c.id == cert["id"])
            .values(
                final_bid_hash=final_bid_hash,
                receipt_signature=receipt_sig,
            )
        )
        settlements_updated += 1

    return {
        "lots_updated": lots_updated,
        "bids_updated": bids_updated,
        "settlements_updated": settlements_updated,
    }
