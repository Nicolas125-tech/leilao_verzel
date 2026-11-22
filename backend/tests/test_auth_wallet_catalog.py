from datetime import datetime, timedelta, timezone
import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from tests.conftest import create_auctioneer


@pytest.mark.asyncio
async def test_register_bidder_and_fetch_me(client: httpx.AsyncClient):
    payload = {
        "name": "Nicolas Brito",
        "email": "nicolas@verzel.com.br",
        "password": "StrongPassword123",
        "role": "BIDDER",
    }
    resp = await client.post("/api/v1/auth/register", json=payload)
    assert resp.status_code == 201
    data = resp.json()

    assert "access_token" in data
    assert data["token_type"] == "bearer"
    user = data["user"]
    assert user["email"] == "nicolas@verzel.com.br"
    assert user["role"] == "BIDDER"
    assert user["public_code"].startswith("LIC-")
    assert "(N***s B.)" in user["masked_name"]
    assert "password" not in user
    assert "password_hash" not in user

    me_resp = await client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {data['access_token']}"},
    )
    assert me_resp.status_code == 200
    me_data = me_resp.json()
    assert me_data["id"] == user["id"]
    assert me_data["email"] == "nicolas@verzel.com.br"
    assert me_data["public_code"] == user["public_code"]


@pytest.mark.asyncio
async def test_register_duplicate_email_returns_conflict(client: httpx.AsyncClient):
    payload = {
        "name": "Helena Costa",
        "email": "helena@verzel.com.br",
        "password": "StrongPassword123",
        "role": "BIDDER",
    }
    first = await client.post("/api/v1/auth/register", json=payload)
    assert first.status_code == 201
    assert first.json()["user"]["public_code"].startswith("LIC-")

    duplicate = await client.post("/api/v1/auth/register", json=payload)
    assert duplicate.status_code == 409


@pytest.mark.asyncio
async def test_public_register_rejects_auctioneer_role(
    client: httpx.AsyncClient,
    db_session: AsyncSession,
):
    resp = await client.post(
        "/api/v1/auth/register",
        json={
            "name": "Leiloeiro Invasor",
            "email": "invasor@verzel.com.br",
            "password": "StrongPassword123",
            "role": "AUCTIONEER",
        },
    )
    assert resp.status_code == 403

    user = (
        await db_session.execute(select(User).where(User.email == "invasor@verzel.com.br"))
    ).scalar_one_or_none()
    assert user is None


@pytest.mark.asyncio
async def test_login_valid_and_invalid_credentials(client: httpx.AsyncClient):
    await client.post(
        "/api/v1/auth/register",
        json={
            "name": "Carlos Mendes",
            "email": "carlos@verzel.com.br",
            "password": "SecretPass99",
            "role": "BIDDER",
        },
    )

    valid_login = await client.post(
        "/api/v1/auth/login",
        json={"email": "carlos@verzel.com.br", "password": "SecretPass99"},
    )
    assert valid_login.status_code == 200
    assert "access_token" in valid_login.json()

    wrong_password = await client.post(
        "/api/v1/auth/login",
        json={"email": "carlos@verzel.com.br", "password": "WrongPassword"},
    )
    assert wrong_password.status_code == 401

    unknown_email = await client.post(
        "/api/v1/auth/login",
        json={"email": "inexistente@verzel.com.br", "password": "SecretPass99"},
    )
    assert unknown_email.status_code == 401


@pytest.mark.asyncio
async def test_me_requires_valid_jwt_token(client: httpx.AsyncClient):
    unauth = await client.get("/api/v1/auth/me")
    assert unauth.status_code == 401

    invalid_token = await client.get(
        "/api/v1/auth/me",
        headers={"Authorization": "Bearer token.invalido.aqui"},
    )
    assert invalid_token.status_code == 401


@pytest.mark.asyncio
async def test_get_wallet_initial_balances(client: httpx.AsyncClient):
    reg = await client.post(
        "/api/v1/auth/register",
        json={
            "name": "Joao Licitante",
            "email": "joao.licitante@verzel.com.br",
            "password": "StrongPassword123",
            "role": "BIDDER",
        },
    )
    token = reg.json()["access_token"]

    resp = await client.get(
        "/api/v1/wallet",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["total_balance_cents"] == 0
    assert data["committed_balance_cents"] == 0
    assert data["available_balance_cents"] == 0


@pytest.mark.asyncio
async def test_deposit_increases_balance_and_records_transaction(client: httpx.AsyncClient):
    reg = await client.post(
        "/api/v1/auth/register",
        json={
            "name": "Mariana Souza",
            "email": "mariana.souza@verzel.com.br",
            "password": "StrongPassword123",
            "role": "BIDDER",
        },
    )
    token = reg.json()["access_token"]

    deposit_resp = await client.post(
        "/api/v1/wallet/deposit",
        headers={"Authorization": f"Bearer {token}"},
        json={"amount_cents": 500000},
    )
    assert deposit_resp.status_code == 200
    wallet = deposit_resp.json()
    assert wallet["total_balance_cents"] == 500000
    assert wallet["committed_balance_cents"] == 0
    assert wallet["available_balance_cents"] == 500000

    tx_resp = await client.get(
        "/api/v1/wallet/transactions",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert tx_resp.status_code == 200
    txs = tx_resp.json()
    assert len(txs) == 1
    first_tx = txs[0]
    assert first_tx["type"] == "DEPOSIT"
    assert first_tx["amount_cents"] == 500000
    assert first_tx["balance_after_cents"] == 500000
    assert first_tx["committed_after_cents"] == 0


@pytest.mark.asyncio
async def test_deposit_invalid_amount_returns_422(client: httpx.AsyncClient):
    reg = await client.post(
        "/api/v1/auth/register",
        json={
            "name": "Pedro Alvares",
            "email": "pedro.alvares@verzel.com.br",
            "password": "StrongPassword123",
            "role": "BIDDER",
        },
    )
    token = reg.json()["access_token"]

    zero_resp = await client.post(
        "/api/v1/wallet/deposit",
        headers={"Authorization": f"Bearer {token}"},
        json={"amount_cents": 0},
    )
    assert zero_resp.status_code == 422

    negative_resp = await client.post(
        "/api/v1/wallet/deposit",
        headers={"Authorization": f"Bearer {token}"},
        json={"amount_cents": -5000},
    )
    assert negative_resp.status_code == 422


@pytest.mark.asyncio
async def test_auctioneer_cannot_deposit_or_access_wallet(
    client: httpx.AsyncClient,
    db_session: AsyncSession,
):
    reg = await create_auctioneer(db_session, "Carla Leiloeira", "carla.leiloeira@verzel.com.br")
    token = reg["access_token"]

    wallet_resp = await client.get(
        "/api/v1/wallet",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert wallet_resp.status_code == 403

    deposit_resp = await client.post(
        "/api/v1/wallet/deposit",
        headers={"Authorization": f"Bearer {token}"},
        json={"amount_cents": 100000},
    )
    assert deposit_resp.status_code == 403


@pytest.mark.asyncio
async def test_wallet_transactions_chronological_listing(client: httpx.AsyncClient):
    reg = await client.post(
        "/api/v1/auth/register",
        json={
            "name": "Fernanda Lima",
            "email": "fernanda.lima@verzel.com.br",
            "password": "StrongPassword123",
            "role": "BIDDER",
        },
    )
    token = reg.json()["access_token"]

    await client.post(
        "/api/v1/wallet/deposit",
        headers={"Authorization": f"Bearer {token}"},
        json={"amount_cents": 100000},
    )
    await client.post(
        "/api/v1/wallet/deposit",
        headers={"Authorization": f"Bearer {token}"},
        json={"amount_cents": 250000},
    )

    tx_resp = await client.get(
        "/api/v1/wallet/transactions",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert tx_resp.status_code == 200
    txs = tx_resp.json()
    assert len(txs) == 2
    assert txs[0]["amount_cents"] == 250000
    assert txs[0]["balance_after_cents"] == 350000
    assert txs[1]["amount_cents"] == 100000
    assert txs[1]["balance_after_cents"] == 100000


@pytest.mark.asyncio
async def test_public_lot_routes_do_not_expose_user_ids_and_return_own_flags(
    client: httpx.AsyncClient,
    db_session: AsyncSession,
):
    auctioneer = await create_auctioneer(db_session, "Helena Curadora", "helena.priv@verzel.com.br")
    bidder1 = (
        await client.post(
            "/api/v1/auth/register",
            json={
                "name": "Nicolas Brito",
                "email": "nicolas.priv@verzel.com.br",
                "password": "StrongPassword123",
            },
        )
    ).json()
    bidder2 = (
        await client.post(
            "/api/v1/auth/register",
            json={
                "name": "Marina Silva",
                "email": "marina.priv@verzel.com.br",
                "password": "StrongPassword123",
            },
        )
    ).json()

    for bidder in (bidder1, bidder2):
        dep = await client.post(
            "/api/v1/wallet/deposit",
            headers={"Authorization": f"Bearer {bidder['access_token']}"},
            json={"amount_cents": 500000},
        )
        assert dep.status_code == 200

    now = datetime.now(timezone.utc)
    lot_resp = await client.post(
        "/api/v1/lots",
        headers={"Authorization": f"Bearer {auctioneer['access_token']}"},
        json={
            "external_artwork_id": "27992",
            "title": "Privacy Check Artwork",
            "artist": "Georges Seurat",
            "date_display": "1886",
            "medium_display": "Oil on canvas",
            "image_url": "/artworks/grande-jatte.svg",
            "attributes_json": {"origin": "France"},
            "starting_bid_cents": 100000,
            "min_increment_cents": 10000,
            "start_time": (now - timedelta(minutes=10)).isoformat(),
            "end_time": (now + timedelta(hours=1)).isoformat(),
        },
    )
    assert lot_resp.status_code == 201
    lot_id = lot_resp.json()["id"]

    b1 = await client.post(
        f"/api/v1/lots/{lot_id}/bids",
        headers={"Authorization": f"Bearer {bidder1['access_token']}"},
        json={"amount_cents": 100000},
    )
    assert b1.status_code == 201
    b2 = await client.post(
        f"/api/v1/lots/{lot_id}/bids",
        headers={"Authorization": f"Bearer {bidder2['access_token']}"},
        json={"amount_cents": 120000},
    )
    assert b2.status_code == 201

    sensitive_ids = {
        auctioneer["user"]["id"],
        bidder1["user"]["id"],
        bidder2["user"]["id"],
    }
    forbidden_keys = {
        "user_id",
        "leader_user_id",
        "auctioneer_id",
        "winner_user_id",
        "auctioneer_user_id",
    }

    for path in ("/api/v1/lots", f"/api/v1/lots/{lot_id}"):
        anon_resp = await client.get(path)
        assert anon_resp.status_code == 200
        for uid in sensitive_ids:
            assert uid not in anon_resp.text
        for key in forbidden_keys:
            assert f'"{key}"' not in anon_resp.text

    anon_detail = (await client.get(f"/api/v1/lots/{lot_id}")).json()
    assert anon_detail["is_user_leading"] is False
    assert anon_detail["has_user_participated"] is False
    assert all(b["is_own_bid"] is False for b in anon_detail["bids"])

    b2_detail = (
        await client.get(
            f"/api/v1/lots/{lot_id}",
            headers={"Authorization": f"Bearer {bidder2['access_token']}"},
        )
    ).json()
    assert b2_detail["is_user_leading"] is True
    assert b2_detail["has_user_participated"] is True
    assert [b["is_own_bid"] for b in b2_detail["bids"]] == [False, True]

    b1_detail = (
        await client.get(
            f"/api/v1/lots/{lot_id}",
            headers={"Authorization": f"Bearer {bidder1['access_token']}"},
        )
    ).json()
    assert b1_detail["is_user_leading"] is False
    assert b1_detail["has_user_participated"] is True
    assert [b["is_own_bid"] for b in b1_detail["bids"]] == [True, False]

