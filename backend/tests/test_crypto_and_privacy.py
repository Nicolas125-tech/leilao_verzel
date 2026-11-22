from datetime import datetime, timezone
import hashlib
import uuid
import pytest

from app.core.config import Settings
from app.core.crypto import (
    GENESIS_HASH,
    canonical_bid_payload,
    compute_bid_hash,
    compute_lot_seal,
    compute_node_signature,
    format_utc_iso,
    generate_receipt_signature,
    verify_bid_chain,
    verify_lot_seal,
    verify_receipt_signature,
)
from app.core.privacy import generate_public_code, mask_name


def _make_signed_bid(
    lot_id: uuid.UUID,
    sequence_number: int,
    pseudonym: str,
    amount_cents: int,
    created_at_iso: str,
    previous_hash: str,
    secret: str | None = None,
) -> dict:
    current_hash = compute_bid_hash(
        lot_id=lot_id,
        sequence_number=sequence_number,
        bidder_masked_name=pseudonym,
        amount_cents=amount_cents,
        created_at_iso=created_at_iso,
        previous_hash=previous_hash,
        secret=secret,
    )
    node_signature = compute_node_signature(
        lot_id=lot_id,
        sequence_number=sequence_number,
        pseudonym=pseudonym,
        amount_cents=amount_cents,
        created_at_iso=created_at_iso,
        previous_hash=previous_hash,
        current_hash=current_hash,
        secret=secret,
    )
    return {
        "lot_id": lot_id,
        "sequence_number": sequence_number,
        "bidder_masked_name": pseudonym,
        "bidder_pseudonym": pseudonym,
        "amount_cents": amount_cents,
        "created_at_iso": created_at_iso,
        "previous_hash": previous_hash,
        "current_hash": current_hash,
        "node_signature": node_signature,
    }


def test_public_code_format_and_determinism():
    user_id = uuid.uuid4()
    code_bidder = generate_public_code(user_id, "BIDDER")
    code_auctioneer = generate_public_code(user_id, "AUCTIONEER")

    assert code_bidder.startswith("LIC-")
    assert code_auctioneer.startswith("LEI-")
    assert len(code_bidder) == 8
    assert len(code_auctioneer) == 8
    assert generate_public_code(user_id, "BIDDER") == code_bidder
    assert generate_public_code(str(user_id), "BIDDER") == code_bidder


def test_name_masking_privacy():
    code = "LIC-48F9"
    assert mask_name("Nicolas Brito", code) == "LIC-48F9 (N***s B.)"
    assert mask_name("Ana Silva Pereira", code) == "LIC-48F9 (A*a P.)"
    assert mask_name("Carlos", code) == "LIC-48F9 (C***s)"
    assert mask_name("Lu", code) == "LIC-48F9 (L*)"
    assert mask_name("", code) == "LIC-48F9"
    masked = mask_name("Gabriel Vasconcelos", code)
    assert "Vasconcelos" not in masked
    assert masked == "LIC-48F9 (G***l V.)"


def test_crypto_empty_bids_validation():
    valid, res = verify_bid_chain(bids=[], expected_head_hash=GENESIS_HASH, expected_count=0)
    assert valid is True
    assert res["is_valid"] is True
    assert res["is_lot_seal_valid"] is True
    assert res["broken_at_sequence"] is None
    assert res["anomalies"] == []

    valid, res = verify_bid_chain(bids=[], expected_head_hash=GENESIS_HASH, expected_count=1)
    assert valid is False
    assert res["is_valid"] is False
    assert res["broken_at_sequence"] == 0

    valid, res = verify_bid_chain(bids=[], expected_head_hash="SOME_HASH", expected_count=0)
    assert valid is False
    assert res["is_valid"] is False


def test_crypto_valid_chain_bids():
    lot_id = uuid.uuid4()
    t1 = format_utc_iso(datetime.now(timezone.utc))
    t2 = format_utc_iso(datetime.now(timezone.utc))
    t3 = format_utc_iso(datetime.now(timezone.utc))

    b1 = _make_signed_bid(lot_id, 1, "LICITANTE-AAAA111111", 100000, t1, GENESIS_HASH)
    b2 = _make_signed_bid(lot_id, 2, "LICITANTE-BBBB222222", 120000, t2, b1["current_hash"])
    b3 = _make_signed_bid(lot_id, 3, "LICITANTE-AAAA111111", 150000, t3, b2["current_hash"])

    valid, res = verify_bid_chain(bids=[b1, b2, b3], expected_head_hash=b3["current_hash"], expected_count=3)
    assert valid is True
    assert res["is_valid"] is True
    assert res["broken_at_sequence"] is None
    assert len(res["anomalies"]) == 0
    assert all(node["is_signature_valid"] is True for node in res["nodes"])


def test_crypto_rejects_unkeyed_sha256_or_missing_signature():
    lot_id = uuid.uuid4()
    t1 = format_utc_iso(datetime.now(timezone.utc))
    payload = canonical_bid_payload(lot_id, 1, "LICITANTE-AAAA111111", 100000, t1, GENESIS_HASH)
    unkeyed_hash = hashlib.sha256(payload.encode("utf-8")).hexdigest()

    forged_bid = {
        "lot_id": lot_id,
        "sequence_number": 1,
        "bidder_masked_name": "LICITANTE-AAAA111111",
        "bidder_pseudonym": "LICITANTE-AAAA111111",
        "amount_cents": 100000,
        "created_at_iso": t1,
        "previous_hash": GENESIS_HASH,
        "current_hash": unkeyed_hash,
        "node_signature": "",
    }
    valid, res = verify_bid_chain(bids=[forged_bid], expected_head_hash=unkeyed_hash, expected_count=1)
    assert valid is False
    assert res["broken_at_sequence"] == 1
    assert res["nodes"][0]["is_signature_valid"] is False
    assert res["nodes"][0]["stored_signature"] == ""


def test_crypto_tampering_detection_sql_update():
    lot_id = uuid.uuid4()
    t1 = format_utc_iso(datetime.now(timezone.utc))
    b1 = _make_signed_bid(lot_id, 1, "LICITANTE-AAAA111111", 100000, t1, GENESIS_HASH)
    original_hash = b1["current_hash"]
    b1["amount_cents"] = 999999

    valid, res = verify_bid_chain(bids=[b1], expected_head_hash=original_hash, expected_count=1)
    assert valid is False
    assert res["is_valid"] is False
    assert res["broken_at_sequence"] == 1
    assert any("Adulteração detectada" in a for a in res["anomalies"])


def test_crypto_deletion_middle_bid():
    lot_id = uuid.uuid4()
    t1 = format_utc_iso(datetime.now(timezone.utc))
    t2 = format_utc_iso(datetime.now(timezone.utc))
    t3 = format_utc_iso(datetime.now(timezone.utc))

    b1 = _make_signed_bid(lot_id, 1, "LIC-1", 100, t1, GENESIS_HASH)
    b2 = _make_signed_bid(lot_id, 2, "LIC-2", 200, t2, b1["current_hash"])
    b3 = _make_signed_bid(lot_id, 3, "LIC-1", 300, t3, b2["current_hash"])

    valid, res = verify_bid_chain(bids=[b1, b3], expected_head_hash=b3["current_hash"], expected_count=3)
    assert valid is False
    assert res["is_valid"] is False
    assert any("Contagem divergente" in a for a in res["anomalies"])
    assert any("Quebra de sequência" in a for a in res["anomalies"])


def test_crypto_deletion_last_bid():
    lot_id = uuid.uuid4()
    t1 = format_utc_iso(datetime.now(timezone.utc))
    t2 = format_utc_iso(datetime.now(timezone.utc))

    b1 = _make_signed_bid(lot_id, 1, "LIC-1", 100, t1, GENESIS_HASH)
    b2 = _make_signed_bid(lot_id, 2, "LIC-2", 200, t2, b1["current_hash"])

    valid, res = verify_bid_chain(bids=[b1], expected_head_hash=b2["current_hash"], expected_count=2)
    assert valid is False
    assert res["is_valid"] is False
    assert any("Contagem divergente" in a for a in res["anomalies"])
    assert any("Topo da cadeia inconsistente" in a for a in res["anomalies"])


def test_crypto_lot_seal_and_tamper_detection():
    lot_id = uuid.uuid4()
    auctioneer_id = uuid.uuid4()
    leader_id = uuid.uuid4()
    end_iso = format_utc_iso(datetime.now(timezone.utc))
    t1 = format_utc_iso(datetime.now(timezone.utc))

    b1 = _make_signed_bid(lot_id, 1, "LICITANTE-1111", 150000, t1, GENESIS_HASH)
    b1["user_id"] = leader_id

    seal = compute_lot_seal(
        lot_id=lot_id,
        bid_count=1,
        head_hash=b1["current_hash"],
        auctioneer_id=auctioneer_id,
        end_time_iso=end_iso,
        leader_user_id=leader_id,
        current_bid_cents=150000,
    )
    assert verify_lot_seal(
        seal,
        lot_id=lot_id,
        bid_count=1,
        head_hash=b1["current_hash"],
        auctioneer_id=auctioneer_id,
        end_time_iso=end_iso,
        leader_user_id=leader_id,
        current_bid_cents=150000,
    ) is True

    valid, res = verify_bid_chain(
        bids=[b1],
        expected_head_hash=b1["current_hash"],
        expected_count=1,
        lot_seal_meta={
            "stored_seal": seal,
            "lot_id": lot_id,
            "auctioneer_id": uuid.uuid4(),
            "end_time_iso": end_iso,
            "leader_user_id": leader_id,
            "current_bid_cents": 150000,
        },
    )
    assert valid is False
    assert res["is_lot_seal_valid"] is False
    assert any("Selo criptográfico do lote" in a for a in res["anomalies"])


def test_crypto_receipt_signature():
    receipt_code = "ARP-2026-8F41C2"
    lot_id = uuid.uuid4()
    winner = "LIC-48F9 (N***s B.)"
    amount = 500000
    final_bid_hash = "a" * 64
    now_iso = format_utc_iso(datetime.now(timezone.utc))

    sig = generate_receipt_signature(receipt_code, lot_id, winner, amount, final_bid_hash, now_iso)
    assert len(sig) == 64
    assert verify_receipt_signature(sig, receipt_code, lot_id, winner, amount, final_bid_hash, now_iso) is True
    assert verify_receipt_signature(sig, receipt_code, lot_id, winner, 500001, final_bid_hash, now_iso) is False
    assert verify_receipt_signature(sig, receipt_code, lot_id, winner, amount, "b" * 64, now_iso) is False
    assert verify_receipt_signature(sig, "ARP-2026-000000", lot_id, winner, amount, final_bid_hash, now_iso) is False


def test_production_secret_validation_fail_fast():
    dev_settings = Settings(ENVIRONMENT="development")
    dev_settings.validate_production_secrets()

    prod_default = Settings(ENVIRONMENT="production")
    with pytest.raises(RuntimeError):
        prod_default.validate_production_secrets()

    prod_short_hmac = Settings(
        ENVIRONMENT="production",
        JWT_SECRET_KEY="prod_jwt_key_with_sufficient_entropy_2026",
        HMAC_SECRET_KEY="too_short",
    )
    with pytest.raises(RuntimeError):
        prod_short_hmac.validate_production_secrets()

    prod_valid = Settings(
        ENVIRONMENT="production",
        JWT_SECRET_KEY="prod_jwt_key_with_sufficient_entropy_2026",
        HMAC_SECRET_KEY="prod_hmac_key_with_more_than_32_characters_2026",
    )
    prod_valid.validate_production_secrets()
