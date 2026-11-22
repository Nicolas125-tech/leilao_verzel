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
    return dt.strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def _hmac_hex(payload: str, secret: str | None = None) -> str:
    key = (secret or settings.HMAC_SECRET_KEY).encode("utf-8")
    return hmac.new(key, payload.encode("utf-8"), hashlib.sha256).hexdigest()


def generate_bidder_pseudonym(user_id: UUID | str, secret: str | None = None) -> str:
    short_hash = _hmac_hex(str(user_id), secret=secret)[:10].upper()
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
    secret: str | None = None,
) -> str:
    payload = canonical_bid_payload(
        lot_id=lot_id,
        sequence_number=sequence_number,
        pseudonym=bidder_masked_name,
        amount_cents=amount_cents,
        created_at_iso=created_at_iso,
        previous_hash=previous_hash,
    )
    return _hmac_hex(f"bid-hash:v2|{payload}", secret=secret)


def compute_node_signature(
    lot_id: str | UUID,
    sequence_number: int,
    pseudonym: str,
    amount_cents: int,
    created_at_iso: str,
    previous_hash: str,
    current_hash: str,
    secret: str | None = None,
) -> str:
    payload = canonical_bid_payload(
        lot_id=lot_id,
        sequence_number=sequence_number,
        pseudonym=pseudonym,
        amount_cents=amount_cents,
        created_at_iso=created_at_iso,
        previous_hash=previous_hash,
    )
    return _hmac_hex(f"bid-sig:v2|{payload}|{current_hash}", secret=secret)


def compute_lot_seal(
    lot_id: str | UUID,
    bid_count: int,
    head_hash: str,
    auctioneer_id: str | UUID,
    end_time_iso: str,
    leader_user_id: str | UUID | None,
    current_bid_cents: int | None,
    secret: str | None = None,
) -> str:
    leader_part = str(leader_user_id) if leader_user_id is not None else "NONE"
    bid_part = str(current_bid_cents) if current_bid_cents is not None else "NONE"
    payload = (
        f"lot-seal:v2|{str(lot_id)}|{bid_count}|{head_hash}|"
        f"{str(auctioneer_id)}|{end_time_iso}|{leader_part}|{bid_part}"
    )
    return _hmac_hex(payload, secret=secret)


def verify_lot_seal(
    stored_seal: str | None,
    lot_id: str | UUID,
    bid_count: int,
    head_hash: str,
    auctioneer_id: str | UUID,
    end_time_iso: str,
    leader_user_id: str | UUID | None,
    current_bid_cents: int | None,
    secret: str | None = None,
) -> bool:
    if not stored_seal:
        return False
    expected = compute_lot_seal(
        lot_id=lot_id,
        bid_count=bid_count,
        head_hash=head_hash,
        auctioneer_id=auctioneer_id,
        end_time_iso=end_time_iso,
        leader_user_id=leader_user_id,
        current_bid_cents=current_bid_cents,
        secret=secret,
    )
    return hmac.compare_digest(stored_seal, expected)


def verify_bid_chain(
    bids: list[dict[str, Any]],
    expected_head_hash: str,
    expected_count: int,
    secret: str | None = None,
    lot_seal_meta: dict[str, Any] | None = None,
) -> tuple[bool, dict[str, Any]]:
    anomalies: list[str] = []
    broken_at: int | None = None
    reason: str | None = None

    lot_seal_valid = True
    if lot_seal_meta is not None:
        lot_seal_valid = verify_lot_seal(
            stored_seal=lot_seal_meta.get("stored_seal"),
            lot_id=lot_seal_meta["lot_id"],
            bid_count=expected_count,
            head_hash=expected_head_hash,
            auctioneer_id=lot_seal_meta["auctioneer_id"],
            end_time_iso=lot_seal_meta["end_time_iso"],
            leader_user_id=lot_seal_meta.get("leader_user_id"),
            current_bid_cents=lot_seal_meta.get("current_bid_cents"),
            secret=secret,
        )
        if not lot_seal_valid:
            msg = "Selo criptográfico do lote (integrity_seal) ausente ou divergente."
            anomalies.append(msg)
            reason = msg

    if not bids:
        if expected_count != 0 or not hmac.compare_digest(expected_head_hash or "", GENESIS_HASH):
            error_msg = (
                f"Lote sem lances possui estado inconsistente: contagem esperada {expected_count}, "
                f"head_hash '{expected_head_hash}'"
            )
            anomalies.append(error_msg)
            broken_at = 0
            reason = error_msg
        if lot_seal_meta is not None and (
            lot_seal_meta.get("leader_user_id") is not None
            or lot_seal_meta.get("current_bid_cents") is not None
        ):
            msg = "Lote sem lances possui líder ou valor atual divergente."
            anomalies.append(msg)
            if broken_at is None:
                broken_at = 0
                reason = msg
        is_valid = len(anomalies) == 0
        return is_valid, {
            "is_valid": is_valid,
            "is_intact": is_valid,
            "is_lot_seal_valid": lot_seal_valid,
            "broken_at_sequence": broken_at,
            "tampered_at_sequence": broken_at,
            "reason": reason,
            "anomalies": anomalies,
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
        stored_curr = bid.get("current_hash") or ""
        stored_prev = bid.get("previous_hash") or ""
        stored_sig = bid.get("node_signature") or ""
        pseudonym = bid.get("bidder_pseudonym") or bid.get("bidder_masked_name", "")

        if seq != expected_seq:
            msg = f"Quebra de sequência no registro {idx + 1}: esperado #{expected_seq}, encontrado #{seq}"
            anomalies.append(msg)
            if broken_at is None:
                broken_at = expected_seq
                reason = msg

        prev_matches = hmac.compare_digest(stored_prev, expected_prev)
        if not prev_matches:
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
            secret=secret,
        )

        hash_matches = hmac.compare_digest(stored_curr, recalculated)
        if not hash_matches:
            msg = (
                f"Adulteração detectada no lance #{seq}: hash armazenado '{stored_curr}' "
                f"não confere com o hash recalculado '{recalculated}'"
            )
            anomalies.append(msg)
            if broken_at is None:
                broken_at = seq
                reason = msg

        expected_sig = compute_node_signature(
            lot_id=bid["lot_id"],
            sequence_number=seq,
            pseudonym=pseudonym,
            amount_cents=bid["amount_cents"],
            created_at_iso=bid["created_at_iso"],
            previous_hash=expected_prev,
            current_hash=recalculated,
            secret=secret,
        )
        sig_matches = bool(stored_sig) and hmac.compare_digest(stored_sig, expected_sig)
        if not sig_matches:
            msg = f"Assinatura HMAC ausente ou inválida no lance #{seq}."
            anomalies.append(msg)
            if broken_at is None:
                broken_at = seq
                reason = msg

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
                "stored_signature": stored_sig,
                "node_signature": stored_sig,
                "is_signature_valid": sig_matches,
                "direct_valid": (
                    seq == expected_seq
                    and prev_matches
                    and hash_matches
                    and sig_matches
                ),
            }
        )

        expected_prev = recalculated
        expected_seq += 1

    last_bid = bids[-1]
    last_bid_hash = last_bid.get("current_hash") or ""
    if not hmac.compare_digest(last_bid_hash, expected_head_hash or ""):
        msg = (
            f"Topo da cadeia inconsistente: lote aponta head_hash '{expected_head_hash}', "
            f"mas último lance da lista possui '{last_bid_hash}'"
        )
        anomalies.append(msg)
        if broken_at is None:
            broken_at = len(bids)
            reason = msg

    if lot_seal_meta is not None:
        meta_leader = lot_seal_meta.get("leader_user_id")
        last_user = last_bid.get("user_id")
        if meta_leader is not None and last_user is not None and str(meta_leader) != str(last_user):
            msg = "Líder registrado no lote diverge do autor do último lance."
            anomalies.append(msg)
            if reason is None:
                reason = msg

        meta_bid_cents = lot_seal_meta.get("current_bid_cents")
        if meta_bid_cents is not None and int(meta_bid_cents) != int(last_bid["amount_cents"]):
            msg = "Valor atual registrado no lote diverge do último lance."
            anomalies.append(msg)
            if reason is None:
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
        "is_lot_seal_valid": lot_seal_valid,
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
    final_bid_hash: str,
    settled_at_iso: str,
    secret: str | None = None,
) -> str:
    payload = (
        f"receipt:v2|{receipt_code}|{str(lot_id)}|{winner_masked_name}|"
        f"{final_amount_cents}|{final_bid_hash}|{settled_at_iso}"
    )
    return _hmac_hex(payload, secret=secret)


def verify_receipt_signature(
    signature: str,
    receipt_code: str,
    lot_id: str | UUID,
    winner_masked_name: str,
    final_amount_cents: int,
    final_bid_hash: str,
    settled_at_iso: str,
    secret: str | None = None,
) -> bool:
    expected = generate_receipt_signature(
        receipt_code=receipt_code,
        lot_id=lot_id,
        winner_masked_name=winner_masked_name,
        final_amount_cents=final_amount_cents,
        final_bid_hash=final_bid_hash,
        settled_at_iso=settled_at_iso,
        secret=secret,
    )
    return hmac.compare_digest(signature, expected)
