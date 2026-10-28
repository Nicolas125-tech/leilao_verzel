from datetime import datetime, timezone
import hashlib
import hmac
from typing import Any
from uuid import UUID

from app.core.config import settings

GENESIS_HASH = "0" * 64


def format_utc_iso(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    else:
        dt = dt.astimezone(timezone.utc)
    return dt.isoformat()


def generate_bidder_pseudonym(user_id: UUID | str, secret: str | None = None) -> str:
    key = (secret or settings.HMAC_SECRET_KEY).encode("utf-8")
    short_hash = (
        hmac.new(key, str(user_id).encode("utf-8"), hashlib.sha256)
        .hexdigest()[:10]
        .upper()
    )
    return f"LICITANTE-{short_hash}"


def canonical_bid_payload(
    lot_id: str | UUID,
    sequence_number: int,
    pseudonym: str,
    amount_cents: int,
    created_at_iso: str,
    previous_hash: str,
) -> str:
    return (
        f"{str(lot_id)}|{sequence_number}|{pseudonym}|"
        f"{amount_cents}|{created_at_iso}|{previous_hash}"
    )


def compute_bid_hash(
    lot_id: str | UUID,
    sequence_number: int,
    bidder_masked_name: str,
    amount_cents: int,
    created_at_iso: str,
    previous_hash: str,
) -> str:
    payload = canonical_bid_payload(
        lot_id=lot_id,
        sequence_number=sequence_number,
        pseudonym=bidder_masked_name,
        amount_cents=amount_cents,
        created_at_iso=created_at_iso,
        previous_hash=previous_hash,
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def compute_node_signature(
    lot_id: str | UUID,
    sequence_number: int,
    pseudonym: str,
    amount_cents: int,
    created_at_iso: str,
    previous_hash: str,
    secret: str | None = None,
) -> str:
    key = (secret or settings.HMAC_SECRET_KEY).encode("utf-8")
    payload = canonical_bid_payload(
        lot_id=lot_id,
        sequence_number=sequence_number,
        pseudonym=pseudonym,
        amount_cents=amount_cents,
        created_at_iso=created_at_iso,
        previous_hash=previous_hash,
    )
    return hmac.new(key, payload.encode("utf-8"), hashlib.sha256).hexdigest()


def verify_bid_chain(
    bids: list[dict[str, Any]],
    expected_head_hash: str,
    expected_count: int,
    secret: str | None = None,
) -> tuple[bool, dict[str, Any]]:
    anomalies: list[str] = []
    broken_at: int | None = None
    reason: str | None = None

    if not bids:
        if expected_count == 0 and expected_head_hash == GENESIS_HASH:
            return True, {
                "is_valid": True,
                "is_intact": True,
                "broken_at_sequence": None,
                "tampered_at_sequence": None,
                "reason": None,
                "anomalies": [],
                "nodes": [],
            }
        error_msg = (
            f"Lote sem lances possui estado inconsistente: contagem esperada {expected_count}, "
            f"head_hash '{expected_head_hash}'"
        )
        return False, {
            "is_valid": False,
            "is_intact": False,
            "broken_at_sequence": 0,
            "tampered_at_sequence": 0,
            "reason": error_msg,
            "anomalies": [error_msg],
            "nodes": [],
        }

    if len(bids) != expected_count:
        error_msg = (
            f"Contagem divergente: lote registra {expected_count} lances, "
            f"mas foram encontrados {len(bids)} registros no banco (possível exclusão)"
        )
        anomalies.append(error_msg)
        if broken_at is None:
            broken_at = len(bids) + 1
            reason = error_msg

    expected_seq = 1
    expected_prev = GENESIS_HASH
    evaluated_nodes: list[dict[str, Any]] = []

    for idx, bid in enumerate(bids):
        seq = bid.get("sequence_number")
        stored_curr = bid.get("current_hash")
        stored_prev = bid.get("previous_hash")
        pseudonym = bid.get("bidder_pseudonym") or bid.get("bidder_masked_name", "")

        if seq != expected_seq:
            msg = f"Quebra de sequência no registro {idx + 1}: esperado #{expected_seq}, encontrado #{seq}"
            anomalies.append(msg)
            if broken_at is None:
                broken_at = expected_seq
                reason = msg

        if stored_prev != expected_prev:
            msg = (
                f"Quebra de encadeamento no lance #{seq}: previous_hash armazenado '{stored_prev}' "
                f"diverge do esperado '{expected_prev}'"
            )
            anomalies.append(msg)
            if broken_at is None:
                broken_at = seq
                reason = msg

        recalculated = compute_bid_hash(
            lot_id=bid["lot_id"],
            sequence_number=seq,
            bidder_masked_name=pseudonym,
            amount_cents=bid["amount_cents"],
            created_at_iso=bid["created_at_iso"],
            previous_hash=expected_prev,
        )

        if stored_curr != recalculated:
            msg = (
                f"Adulteração detectada no lance #{seq}: hash armazenado '{stored_curr}' "
                f"não confere com o hash recalculado '{recalculated}'"
            )
            anomalies.append(msg)
            if broken_at is None:
                broken_at = seq
                reason = msg

        node_sig = compute_node_signature(
            lot_id=bid["lot_id"],
            sequence_number=seq,
            pseudonym=pseudonym,
            amount_cents=bid["amount_cents"],
            created_at_iso=bid["created_at_iso"],
            previous_hash=expected_prev,
            secret=secret,
        )

        evaluated_nodes.append(
            {
                "sequence_number": seq,
                "bid_id": bid.get("id"),
                "bidder_masked_name": pseudonym,
                "bidder_pseudonym": pseudonym,
                "amount_cents": bid["amount_cents"],
                "created_at_iso": bid["created_at_iso"],
                "previous_hash": stored_prev,
                "expected_previous_hash": expected_prev,
                "stored_hash": stored_curr,
                "recalculated_hash": recalculated,
                "node_signature": node_sig,
                "direct_valid": (
                    seq == expected_seq
                    and stored_prev == expected_prev
                    and stored_curr == recalculated
                ),
            }
        )

        expected_prev = recalculated
        expected_seq += 1

    last_bid_hash = bids[-1].get("current_hash")
    if last_bid_hash != expected_head_hash:
        msg = (
            f"Topo da cadeia inconsistente: lote aponta head_hash '{expected_head_hash}', "
            f"mas último lance da lista possui '{last_bid_hash}'"
        )
        anomalies.append(msg)
        if broken_at is None:
            broken_at = len(bids)
            reason = msg

    for node in evaluated_nodes:
        is_node_valid = bool(
            node.pop("direct_valid")
            and (broken_at is None or node["sequence_number"] < broken_at)
        )
        node["is_valid"] = is_node_valid
        node["status"] = "valid" if is_node_valid else "invalid"

    is_valid = len(anomalies) == 0
    return is_valid, {
        "is_valid": is_valid,
        "is_intact": is_valid,
        "broken_at_sequence": broken_at,
        "tampered_at_sequence": broken_at,
        "reason": reason,
        "anomalies": anomalies,
        "nodes": evaluated_nodes,
    }


def generate_receipt_signature(
    receipt_code: str,
    lot_id: str | UUID,
    winner_masked_name: str,
    final_amount_cents: int,
    settled_at_iso: str,
    secret: str | None = None,
) -> str:
    key = (secret or settings.HMAC_SECRET_KEY).encode("utf-8")
    payload = f"{receipt_code}|{str(lot_id)}|{winner_masked_name}|{final_amount_cents}|{settled_at_iso}"
    return hmac.new(key, payload.encode("utf-8"), hashlib.sha256).hexdigest()


def verify_receipt_signature(
    signature: str,
    receipt_code: str,
    lot_id: str | UUID,
    winner_masked_name: str,
    final_amount_cents: int,
    settled_at_iso: str,
    secret: str | None = None,
) -> bool:
    expected = generate_receipt_signature(
        receipt_code=receipt_code,
        lot_id=lot_id,
        winner_masked_name=winner_masked_name,
        final_amount_cents=final_amount_cents,
        settled_at_iso=settled_at_iso,
        secret=secret,
    )
    return hmac.compare_digest(signature, expected)
