import re
import httpx
import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from tests.test_audit import _create_live_lot, _register_and_fund, client, db_session


PSEUDONYM_PATTERN = re.compile(r"^LICITANTE-[0-9A-F]{6,10}$")


async def _seed_lot_with_three_bids(client: httpx.AsyncClient) -> dict:
    auctioneer = await _register_and_fund(
        client,
        "Helena Curadora",
        "helena.curadora@verzel.com.br",
        "AUCTIONEER",
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
        "users": (bidder_1["user"], bidder_2["user"], auctioneer["user"]),
    }


@pytest.mark.asyncio
async def test_intact_audit_chain_and_pseudonym_privacy(client: httpx.AsyncClient):
    seeded = await _seed_lot_with_three_bids(client)
    lot_id = seeded["lot_id"]

    audit_resp = await client.get(f"/api/v1/lots/{lot_id}/audit")
    assert audit_resp.status_code == 200
    payload = audit_resp.json()
    raw_body = audit_resp.text

    assert payload["is_intact"] is True
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
        assert len(node["node_signature"]) == 64
        pseudonym = node["bidder_pseudonym"]
        assert PSEUDONYM_PATTERN.match(pseudonym), (
            f"Esperado pseudônimo HMAC no formato LICITANTE-XXXXXX, recebido: {pseudonym!r}"
        )


@pytest.mark.asyncio
async def test_sql_tampering_on_node_2_invalidates_node_2_and_subsequent_nodes(
    client: httpx.AsyncClient,
    db_session: AsyncSession,
):
    seeded = await _seed_lot_with_three_bids(client)
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
