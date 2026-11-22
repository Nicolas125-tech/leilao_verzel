from datetime import datetime, timedelta, timezone
import hashlib
import re
from uuid import UUID
import httpx
import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.crypto import (
    GENESIS_HASH,
    canonical_bid_payload,
    format_utc_iso,
    generate_bidder_pseudonym,
)
from app.models.lot import Bid, Lot, WinningCertificate
from app.models.wallet import Wallet
from app.services.audit import LotIntegrityError, build_lot_seal
from app.services.settlement import settle_expired_lots, settle_lot
from tests.conftest import create_auctioneer
from tests.test_audit import _create_live_lot, _register_and_fund, client, db_session


PSEUDONYM_PATTERN = re.compile(r"^LICITANTE-[0-9A-F]{6,10}$")


async def _seed_lot_with_three_bids(client: httpx.AsyncClient, db_session: AsyncSession) -> dict:
    auctioneer = await create_auctioneer(
        db_session,
        "Helena Curadora",
        "helena.curadora@verzel.com.br",
    )
    bidder_1 = await _register_and_fund(
        client,
        "Nicolas Brito",
        "nicolas.brito@verzel.com.br",
        "BIDDER",
        deposit_cents=800000,
    )
    bidder_2 = await _register_and_fund(
        client,
        "Marina Silva",
        "marina.silva@verzel.com.br",
        "BIDDER",
        deposit_cents=800000,
    )

    lot = await _create_live_lot(
        client,
        auctioneer["access_token"],
        starting_bid_cents=100000,
        min_increment_cents=10000,
    )
    lot_id = lot["id"]

    for token, amount in [
        (bidder_1["access_token"], 100000),
        (bidder_2["access_token"], 120000),
        (bidder_1["access_token"], 150000),
    ]:
        bid_resp = await client.post(
            f"/api/v1/lots/{lot_id}/bids",
            headers={"Authorization": f"Bearer {token}"},
            json={"amount_cents": amount},
        )
        assert bid_resp.status_code == 201

    return {
        "lot_id": lot_id,
        "auctioneer": auctioneer,
        "bidder_1": bidder_1,
        "bidder_2": bidder_2,
        "users": (bidder_1["user"], bidder_2["user"], auctioneer["user"]),
    }


@pytest.mark.asyncio
async def test_intact_audit_chain_and_pseudonym_privacy(
    client: httpx.AsyncClient,
    db_session: AsyncSession,
):
    seeded = await _seed_lot_with_three_bids(client, db_session)
    lot_id = seeded["lot_id"]

    audit_resp = await client.get(f"/api/v1/lots/{lot_id}/audit")
    assert audit_resp.status_code == 200
    payload = audit_resp.json()
    raw_body = audit_resp.text

    assert payload["is_intact"] is True
    assert payload["is_lot_seal_valid"] is True
    assert payload["tampered_at_sequence"] is None
    assert len(payload["nodes"]) == 3

    for user_record in seeded["users"]:
        assert user_record["email"] not in raw_body
        assert user_record["name"] not in raw_body
        assert str(user_record["id"]) not in raw_body

    for idx, node in enumerate(payload["nodes"], start=1):
        assert node["sequence_number"] == idx
        assert node["status"] == "valid"
        assert node["is_valid"] is True
        assert node["is_signature_valid"] is True
        assert len(node["stored_signature"]) == 64
        assert node["node_signature"] == node["stored_signature"]
        pseudonym = node["bidder_pseudonym"]
        assert PSEUDONYM_PATTERN.match(pseudonym), (
            f"Esperado pseudônimo HMAC no formato LICITANTE-XXXXXX, recebido: {pseudonym!r}"
        )


@pytest.mark.asyncio
async def test_sql_tampering_on_node_2_invalidates_node_2_and_subsequent_nodes(
    client: httpx.AsyncClient,
    db_session: AsyncSession,
):
    seeded = await _seed_lot_with_three_bids(client, db_session)
    lot_id = seeded["lot_id"]

    await db_session.execute(
        text("UPDATE bids SET amount_cents = 999999 WHERE sequence_number = 2")
    )
    await db_session.commit()

    audit_resp = await client.get(f"/api/v1/lots/{lot_id}/audit")
    assert audit_resp.status_code == 200
    payload = audit_resp.json()

    assert payload["is_intact"] is False
    assert payload["tampered_at_sequence"] == 2

    nodes_by_seq = {node["sequence_number"]: node for node in payload["nodes"]}
    assert nodes_by_seq[1]["status"] == "valid"
    assert nodes_by_seq[1]["is_valid"] is True

    assert nodes_by_seq[2]["status"] == "invalid"
    assert nodes_by_seq[2]["is_valid"] is False

    assert nodes_by_seq[3]["status"] == "invalid"
    assert nodes_by_seq[3]["is_valid"] is False


@pytest.mark.asyncio
async def test_sql_forging_unkeyed_sha256_chain_still_fails_hmac_audit(
    client: httpx.AsyncClient,
    db_session: AsyncSession,
):
    seeded = await _seed_lot_with_three_bids(client, db_session)
    lot_id = UUID(seeded["lot_id"])

    bids_res = await db_session.execute(
        select(Bid).where(Bid.lot_id == lot_id).order_by(Bid.sequence_number.asc())
    )
    bids = list(bids_res.scalars().all())
    bids[1].amount_cents = 999999

    prev = bids[0].current_hash
    for bid in bids[1:]:
        pseudonym = generate_bidder_pseudonym(bid.user_id, settings.HMAC_SECRET_KEY)
        payload_str = canonical_bid_payload(
            lot_id=lot_id,
            sequence_number=bid.sequence_number,
            pseudonym=pseudonym,
            amount_cents=bid.amount_cents,
            created_at_iso=format_utc_iso(bid.created_at),
            previous_hash=prev,
        )
        forged_sha256 = hashlib.sha256(payload_str.encode("utf-8")).hexdigest()
        bid.previous_hash = prev
        bid.current_hash = forged_sha256
        bid.node_signature = forged_sha256
        prev = forged_sha256

    lot_obj = (await db_session.execute(select(Lot).where(Lot.id == lot_id))).scalar_one()
    lot_obj.head_hash = prev
    await db_session.commit()

    audit_resp = await client.get(f"/api/v1/lots/{lot_id}/audit")
    assert audit_resp.status_code == 200
    payload = audit_resp.json()
    assert payload["is_intact"] is False
    assert payload["tampered_at_sequence"] == 2
    assert payload["nodes"][0]["is_valid"] is True
    assert payload["nodes"][1]["is_valid"] is False
    assert payload["nodes"][1]["is_signature_valid"] is False
    assert payload["nodes"][2]["is_valid"] is False


@pytest.mark.asyncio
async def test_deleting_last_bid_and_updating_head_detected_by_lot_seal(
    client: httpx.AsyncClient,
    db_session: AsyncSession,
):
    seeded = await _seed_lot_with_three_bids(client, db_session)
    lot_id = UUID(seeded["lot_id"])

    bids_res = await db_session.execute(
        select(Bid).where(Bid.lot_id == lot_id).order_by(Bid.sequence_number.asc())
    )
    bids = list(bids_res.scalars().all())
    await db_session.delete(bids[-1])

    lot_obj = (await db_session.execute(select(Lot).where(Lot.id == lot_id))).scalar_one()
    lot_obj.bid_count = 2
    lot_obj.head_hash = bids[1].current_hash
    lot_obj.current_bid_cents = bids[1].amount_cents
    lot_obj.leader_user_id = bids[1].user_id
    await db_session.commit()

    audit_resp = await client.get(f"/api/v1/lots/{lot_id}/audit")
    assert audit_resp.status_code == 200
    payload = audit_resp.json()
    assert payload["is_intact"] is False
    assert payload["is_lot_seal_valid"] is False


@pytest.mark.asyncio
async def test_tampering_auctioneer_or_end_time_blocks_bidding_cancel_and_settlement(
    client: httpx.AsyncClient,
    db_session: AsyncSession,
):
    seeded = await _seed_lot_with_three_bids(client, db_session)
    lot_id = UUID(seeded["lot_id"])
    bidder_2_token = seeded["bidder_2"]["access_token"]
    auctioneer_token = seeded["auctioneer"]["access_token"]
    bidder_1_id = UUID(seeded["bidder_1"]["user"]["id"])

    # Create a second valid expired lot to confirm sweep skips tampered lot without aborting others
    valid_lot = await _create_live_lot(client, auctioneer_token, title="Lote Válido Expirado")
    valid_bid = await client.post(
        f"/api/v1/lots/{valid_lot['id']}/bids",
        headers={"Authorization": f"Bearer {bidder_2_token}"},
        json={"amount_cents": 100000},
    )
    assert valid_bid.status_code == 201
    valid_lot_obj = (await db_session.execute(select(Lot).where(Lot.id == UUID(valid_lot["id"])))).scalar_one()
    valid_lot_obj.end_time = datetime.now(timezone.utc) - timedelta(seconds=10)
    valid_lot_obj.integrity_seal = build_lot_seal(valid_lot_obj)

    # Tamper auctioneer_id on seeded lot directly in DB
    attacker = await _register_and_fund(client, "Atacante", "atacante@verzel.com.br", "BIDDER")
    tampered_lot = (await db_session.execute(select(Lot).where(Lot.id == lot_id))).scalar_one()
    tampered_lot.auctioneer_id = UUID(attacker["user"]["id"])
    tampered_lot.end_time = datetime.now(timezone.utc) - timedelta(seconds=10)
    await db_session.commit()

    # Audit exposes broken seal
    audit_resp = await client.get(f"/api/v1/lots/{lot_id}/audit")
    assert audit_resp.status_code == 200
    audit = audit_resp.json()
    assert audit["is_intact"] is False
    assert audit["is_lot_seal_valid"] is False

    # Read endpoints remain accessible without settling
    lot_get = await client.get(f"/api/v1/lots/{lot_id}")
    assert lot_get.status_code == 200
    assert lot_get.json()["status"] == "LIVE"
    assert lot_get.json()["certificate"] is None

    # Bidding is blocked fail-closed with 409
    bid_blocked = await client.post(
        f"/api/v1/lots/{lot_id}/bids",
        headers={"Authorization": f"Bearer {bidder_2_token}"},
        json={"amount_cents": 200000},
    )
    assert bid_blocked.status_code == 409

    # Cancel is blocked fail-closed with 409 (using attacker as owner check passes or let's restore owner & tamper end_time)
    tampered_lot_for_cancel = (await db_session.execute(select(Lot).where(Lot.id == lot_id))).scalar_one()
    tampered_lot_for_cancel.auctioneer_id = UUID(seeded["auctioneer"]["user"]["id"])
    await db_session.commit()
    cancel_blocked = await client.post(
        f"/api/v1/lots/{lot_id}/cancel",
        headers={"Authorization": f"Bearer {auctioneer_token}"},
    )
    assert cancel_blocked.status_code == 409

    # Direct settlement raises LotIntegrityError and leaves wallets and certificates untouched
    with pytest.raises(LotIntegrityError):
        await settle_lot(db_session, tampered_lot_for_cancel)
    await db_session.rollback()

    cert_res = await db_session.execute(
        select(WinningCertificate).where(WinningCertificate.lot_id == lot_id)
    )
    assert cert_res.scalar_one_or_none() is None

    winner_wallet = (
        await db_session.execute(select(Wallet).where(Wallet.user_id == bidder_1_id))
    ).scalar_one()
    assert winner_wallet.total_balance_cents == 800000
    assert winner_wallet.committed_balance_cents == 150000

    # Sweep skips the tampered lot and settles the valid expired lot
    settled_count = await settle_expired_lots(db_session)
    assert settled_count == 1
    refreshed_valid = (
        await db_session.execute(select(Lot).where(Lot.id == UUID(valid_lot["id"])))
    ).scalar_one()
    assert refreshed_valid.status == "ENDED"
    assert refreshed_valid.settled_at is not None
