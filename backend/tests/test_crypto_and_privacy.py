from datetime import datetime, timezone
import uuid
import pytest

from app.core.crypto import (
    GENESIS_HASH,
    compute_bid_hash,
    generate_receipt_signature,
    verify_bid_chain,
    verify_receipt_signature,
)
from app.core.privacy import generate_public_code, mask_name


def test_public_code_format_and_determinism():
    user_id = uuid.uuid4()
    code_bidder = generate_public_code(user_id, "BIDDER")
    code_auctioneer = generate_public_code(user_id, "AUCTIONEER")

    assert code_bidder.startswith("LIC-")
    assert code_auctioneer.startswith("LEI-")
    assert len(code_bidder) == 8  # LIC-XXXX
    assert len(code_auctioneer) == 8  # LEI-XXXX
    # Deterministic: same user_id produces identical code
    assert generate_public_code(user_id, "BIDDER") == code_bidder
    assert generate_public_code(str(user_id), "BIDDER") == code_bidder


def test_name_masking_privacy():
    code = "LIC-48F9"
    assert mask_name("Nicolas Brito", code) == "LIC-48F9 (N***s B.)"
    assert mask_name("Ana Silva Pereira", code) == "LIC-48F9 (A*a P.)"
    assert mask_name("Carlos", code) == "LIC-48F9 (C***s)"
    assert mask_name("Lu", code) == "LIC-48F9 (L*)"
    assert mask_name("", code) == "LIC-48F9"
    # Guaranteed privacy: never leaks full surname or private handles
    masked = mask_name("Gabriel Vasconcelos", code)
    assert "Vasconcelos" not in masked
    assert masked == "LIC-48F9 (G***l V.)"


def test_crypto_empty_bids_validation():
    # Valid initial empty lot
    valid, res = verify_bid_chain(bids=[], expected_head_hash=GENESIS_HASH, expected_count=0)
    assert valid is True
    assert res["is_valid"] is True
    assert res["broken_at_sequence"] is None
    assert res["anomalies"] == []

    # Inconsistent expected count on empty list
    valid, res = verify_bid_chain(bids=[], expected_head_hash=GENESIS_HASH, expected_count=1)
    assert valid is False
    assert res["is_valid"] is False
    assert res["broken_at_sequence"] == 0

    # Inconsistent head_hash on empty list
    valid, res = verify_bid_chain(bids=[], expected_head_hash="SOME_HASH", expected_count=0)
    assert valid is False
    assert res["is_valid"] is False


def test_crypto_valid_chain_bids():
    lot_id = uuid.uuid4()
    t1 = datetime.now(timezone.utc).isoformat()
    t2 = datetime.now(timezone.utc).isoformat()
    t3 = datetime.now(timezone.utc).isoformat()

    h1 = compute_bid_hash(
        lot_id=lot_id,
        sequence_number=1,
        bidder_masked_name="LIC-1111 (J***o S.)",
        amount_cents=100000,
        created_at_iso=t1,
        previous_hash=GENESIS_HASH,
    )

    h2 = compute_bid_hash(
        lot_id=lot_id,
        sequence_number=2,
        bidder_masked_name="LIC-2222 (M***a O.)",
        amount_cents=120000,
        created_at_iso=t2,
        previous_hash=h1,
    )

    h3 = compute_bid_hash(
        lot_id=lot_id,
        sequence_number=3,
        bidder_masked_name="LIC-1111 (J***o S.)",
        amount_cents=150000,
        created_at_iso=t3,
        previous_hash=h2,
    )

    bids = [
        {
            "lot_id": lot_id,
            "sequence_number": 1,
            "bidder_masked_name": "LIC-1111 (J***o S.)",
            "amount_cents": 100000,
            "created_at_iso": t1,
            "previous_hash": GENESIS_HASH,
            "current_hash": h1,
        },
        {
            "lot_id": lot_id,
            "sequence_number": 2,
            "bidder_masked_name": "LIC-2222 (M***a O.)",
            "amount_cents": 120000,
            "created_at_iso": t2,
            "previous_hash": h1,
            "current_hash": h2,
        },
        {
            "lot_id": lot_id,
            "sequence_number": 3,
            "bidder_masked_name": "LIC-1111 (J***o S.)",
            "amount_cents": 150000,
            "created_at_iso": t3,
            "previous_hash": h2,
            "current_hash": h3,
        },
    ]

    valid, res = verify_bid_chain(bids=bids, expected_head_hash=h3, expected_count=3)
    assert valid is True
    assert res["is_valid"] is True
    assert res["broken_at_sequence"] is None
    assert len(res["anomalies"]) == 0


def test_crypto_tampering_detection_sql_update():
    lot_id = uuid.uuid4()
    t1 = datetime.now(timezone.utc).isoformat()

    h1 = compute_bid_hash(
        lot_id=lot_id,
        sequence_number=1,
        bidder_masked_name="LIC-1111 (J***o S.)",
        amount_cents=100000,
        created_at_iso=t1,
        previous_hash=GENESIS_HASH,
    )

    # Simulates SQL UPDATE on amount_cents
    tampered_bids = [
        {
            "lot_id": lot_id,
            "sequence_number": 1,
            "bidder_masked_name": "LIC-1111 (J***o S.)",
            "amount_cents": 999999,  # tampered
            "created_at_iso": t1,
            "previous_hash": GENESIS_HASH,
            "current_hash": h1,
        }
    ]

    valid, res = verify_bid_chain(bids=tampered_bids, expected_head_hash=h1, expected_count=1)
    assert valid is False
    assert res["is_valid"] is False
    assert res["broken_at_sequence"] == 1
    assert any("Adulteração detectada" in a for a in res["anomalies"])


def test_crypto_deletion_middle_bid():
    lot_id = uuid.uuid4()
    t1 = datetime.now(timezone.utc).isoformat()
    t2 = datetime.now(timezone.utc).isoformat()
    t3 = datetime.now(timezone.utc).isoformat()

    h1 = compute_bid_hash(lot_id, 1, "LIC-1", 100, t1, GENESIS_HASH)
    h2 = compute_bid_hash(lot_id, 2, "LIC-2", 200, t2, h1)
    h3 = compute_bid_hash(lot_id, 3, "LIC-1", 300, t3, h2)

    # Someone deletes bid #2 directly in SQL
    bids_without_2 = [
        {"lot_id": lot_id, "sequence_number": 1, "bidder_masked_name": "LIC-1", "amount_cents": 100, "created_at_iso": t1, "previous_hash": GENESIS_HASH, "current_hash": h1},
        {"lot_id": lot_id, "sequence_number": 3, "bidder_masked_name": "LIC-1", "amount_cents": 300, "created_at_iso": t3, "previous_hash": h2, "current_hash": h3},
    ]

    valid, res = verify_bid_chain(bids=bids_without_2, expected_head_hash=h3, expected_count=3)
    assert valid is False
    assert res["is_valid"] is False
    # Detected count mismatch and sequence gap
    assert any("Contagem divergente" in a for a in res["anomalies"])
    assert any("Quebra de sequência" in a for a in res["anomalies"])


def test_crypto_deletion_last_bid():
    lot_id = uuid.uuid4()
    t1 = datetime.now(timezone.utc).isoformat()
    t2 = datetime.now(timezone.utc).isoformat()

    h1 = compute_bid_hash(lot_id, 1, "LIC-1", 100, t1, GENESIS_HASH)
    h2 = compute_bid_hash(lot_id, 2, "LIC-2", 200, t2, h1)

    # Someone deletes bid #2 (the last bid) in SQL.
    # The lot table still says bid_count=2 and head_hash=h2.
    bids_only_1 = [
        {"lot_id": lot_id, "sequence_number": 1, "bidder_masked_name": "LIC-1", "amount_cents": 100, "created_at_iso": t1, "previous_hash": GENESIS_HASH, "current_hash": h1},
    ]

    valid, res = verify_bid_chain(bids=bids_only_1, expected_head_hash=h2, expected_count=2)
    assert valid is False
    assert res["is_valid"] is False
    assert any("Contagem divergente" in a for a in res["anomalies"])
    assert any("Topo da cadeia inconsistente" in a for a in res["anomalies"])


def test_crypto_receipt_signature():
    receipt_code = "ARP-2026-8F41C2"
    lot_id = uuid.uuid4()
    winner = "LIC-48F9 (N***s B.)"
    amount = 500000
    now_iso = datetime.now(timezone.utc).isoformat()

    sig = generate_receipt_signature(receipt_code, lot_id, winner, amount, now_iso)
    assert len(sig) == 64
    assert verify_receipt_signature(sig, receipt_code, lot_id, winner, amount, now_iso) is True
    # Tampered amount fails
    assert verify_receipt_signature(sig, receipt_code, lot_id, winner, 500001, now_iso) is False
    # Tampered code fails
    assert verify_receipt_signature(sig, "ARP-2026-000000", lot_id, winner, amount, now_iso) is False
