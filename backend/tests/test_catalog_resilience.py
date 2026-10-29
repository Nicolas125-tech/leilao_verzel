from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch
import httpx
import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.database import get_db
from app.main import app
from app.models.base import Base
import app.services.catalog as catalog_service
from app.services.catalog import (
    LOCAL_FALLBACK_ARTWORKS,
    STALE_CACHE_NOTICE,
    CatalogCircuitBreaker,
)


@pytest_asyncio.fixture
async def db_session():
    test_engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(
        bind=test_engine,
        class_=AsyncSession,
        expire_on_commit=False,
        autoflush=False,
    )

    async with session_factory() as session:
        yield session

    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await test_engine.dispose()


@pytest_asyncio.fixture
async def client(db_session: AsyncSession):
    async def _override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = _override_get_db
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()


@pytest.fixture(autouse=True)
def reset_circuit_breaker():
    catalog_service.circuit_breaker.reset()
    yield
    catalog_service.circuit_breaker.reset()


MOCK_CLEVELAND_API_PAYLOAD = {
    "data": [
        {
            "id": 135378,
            "title": "The Red Kerchief",
            "creators": [
                {
                    "description": "Claude Monet (French, 1840-1926)",
                }
            ],
            "creation_date": "c. 1868-1873",
            "technique": "Oil on canvas",
            "measurements": "Framed: 125.7 x 106.7 x 11.4 cm",
            "culture": ["France, 19th century"],
            "department": "European Painting and Sculpture",
            "images": {
                "web": {
                    "url": "https://openaccess-cdn.clevelandart.org/1958.39/1958.39_web.jpg",
                }
            },
        }
    ]
}


def _build_mock_http_client(side_effect_or_response):
    mock_http_client = AsyncMock()
    if isinstance(side_effect_or_response, httpx.Response):
        mock_http_client.get.return_value = side_effect_or_response
    else:
        mock_http_client.get.side_effect = side_effect_or_response
    mock_http_client.__aenter__.return_value = mock_http_client
    mock_http_client.__aexit__.return_value = None
    return mock_http_client


@pytest.mark.asyncio
async def test_normal_response_saves_to_database_cache_with_10_min_ttl(
    client: httpx.AsyncClient,
    db_session: AsyncSession,
):
    ok_response = httpx.Response(
        200,
        json=MOCK_CLEVELAND_API_PAYLOAD,
        request=httpx.Request("GET", "https://openaccess-api.clevelandart.org/api/artworks/"),
    )
    mock_http_client = _build_mock_http_client(ok_response)

    with patch("app.services.catalog.httpx.AsyncClient", return_value=mock_http_client):
        resp = await client.get("/api/v1/catalog?q=monet&skip=0&limit=12")
        assert resp.status_code == 200
        assert mock_http_client.get.call_count == 1

        cached_resp = await client.get("/api/v1/catalog?q=monet&skip=0&limit=12")
        assert cached_resp.status_code == 200
        assert mock_http_client.get.call_count == 1

    items = resp.json()
    assert len(items) == 1
    assert items[0]["external_id"] == "135378"
    assert items[0]["source"] == "cleveland_art"

    row = (
        await db_session.execute(
            text("SELECT created_at, expires_at FROM catalog_cache WHERE cache_key LIKE '%monet%'")
        )
    ).first()
    assert row is not None, "O resultado deveria ter sido gravado na tabela catalog_cache."

    created_at_raw, expires_at_raw = row
    created_at = (
        datetime.fromisoformat(created_at_raw)
        if isinstance(created_at_raw, str)
        else created_at_raw
    )
    expires_at = (
        datetime.fromisoformat(expires_at_raw)
        if isinstance(expires_at_raw, str)
        else expires_at_raw
    )
    ttl_seconds = (expires_at - created_at).total_seconds()
    assert abs(ttl_seconds - 600) <= 5, f"TTL esperado de 600s (10 min), obtido: {ttl_seconds}s"


@pytest.mark.asyncio
async def test_slow_external_api_timeout_retries_with_backoff_and_returns_stale_cache(
    client: httpx.AsyncClient,
    db_session: AsyncSession,
):
    ok_response = httpx.Response(
        200,
        json=MOCK_CLEVELAND_API_PAYLOAD,
        request=httpx.Request("GET", "https://openaccess-api.clevelandart.org/api/artworks/"),
    )
    warm_http_client = _build_mock_http_client(ok_response)

    with patch("app.services.catalog.httpx.AsyncClient", return_value=warm_http_client):
        warm_resp = await client.get("/api/v1/catalog?q=monet&skip=0&limit=12")
        assert warm_resp.status_code == 200

    past_time = datetime.now(timezone.utc) - timedelta(minutes=15)
    await db_session.execute(
        text("UPDATE catalog_cache SET expires_at = :expired_at"),
        {"expired_at": past_time.isoformat()},
    )
    await db_session.commit()

    timeout_exc = httpx.TimeoutException("Request timed out after 4.0s")
    slow_http_client = _build_mock_http_client(timeout_exc)

    with (
        patch("app.services.catalog.httpx.AsyncClient", return_value=slow_http_client),
        patch("asyncio.sleep", new_callable=AsyncMock) as mock_sleep,
    ):
        stale_resp = await client.get("/api/v1/catalog?q=monet&skip=0&limit=12")

    assert stale_resp.status_code == 200
    assert slow_http_client.get.call_count >= 2, "Deveria acionar retries antes de desistir."
    assert mock_sleep.call_count >= 1, "Deveria aplicar backoff assíncrono entre as tentativas."

    stale_items = stale_resp.json()
    assert len(stale_items) == 1
    assert stale_items[0]["external_id"] == "135378"
    assert stale_items[0]["source"] == "cache_stale"
    assert stale_items[0]["notice"] == STALE_CACHE_NOTICE


@pytest.mark.asyncio
async def test_consecutive_500_failures_open_circuit_breaker(
    client: httpx.AsyncClient,
):
    req = httpx.Request("GET", "https://openaccess-api.clevelandart.org/api/artworks/")
    error_500 = httpx.HTTPStatusError(
        "500 Internal Server Error",
        request=req,
        response=httpx.Response(500, request=req),
    )
    failing_http_client = _build_mock_http_client(error_500)

    with (
        patch("app.services.catalog.httpx.AsyncClient", return_value=failing_http_client),
        patch("asyncio.sleep", new_callable=AsyncMock),
    ):
        for i in range(3):
            resp = await client.get(f"/api/v1/catalog?q=falha_{i}")
            assert resp.status_code == 200

        cb = getattr(catalog_service, "circuit_breaker", None)
        assert cb is not None, "Circuit Breaker não encontrado em app.services.catalog."
        assert cb.state == "OPEN", f"Circuit Breaker deveria estar OPEN após 3 falhas 500, mas está {cb.state}."

        calls_before_short_circuit = failing_http_client.get.call_count
        short_circuit_resp = await client.get("/api/v1/catalog?q=bloqueado_pelo_cb")
        assert short_circuit_resp.status_code == 200
        assert failing_http_client.get.call_count == calls_before_short_circuit

    local_cb = CatalogCircuitBreaker(failure_threshold=3, recovery_timeout_seconds=60.0)
    assert local_cb.state == "CLOSED"
    for _ in range(3):
        local_cb.record_failure()
    assert local_cb.state == "OPEN"
    assert local_cb.allow_request() is False

    local_cb._opened_at = local_cb._opened_at - 61.0  # type: ignore[operator]
    assert local_cb.state == "HALF_OPEN"
    assert local_cb.allow_request() is True
    local_cb.record_success()
    assert local_cb.state == "CLOSED"


@pytest.mark.asyncio
async def test_catastrophic_outage_without_prior_cache_returns_local_fallback_200_ok(
    client: httpx.AsyncClient,
):
    req = httpx.Request("GET", "https://openaccess-api.clevelandart.org/api/artworks/")
    catastrophic_errors = [
        httpx.ConnectError("DNS resolution failed / API unreachable", request=req),
        httpx.HTTPStatusError(
            "500 Internal Server Error",
            request=req,
            response=httpx.Response(500, request=req),
        ),
    ]

    for exc in catastrophic_errors:
        broken_client = _build_mock_http_client(exc)
        with (
            patch("app.services.catalog.httpx.AsyncClient", return_value=broken_client),
            patch("asyncio.sleep", new_callable=AsyncMock),
        ):
            resp = await client.get("/api/v1/catalog?skip=0&limit=12")

        assert resp.status_code == 200
        items = resp.json()
        assert len(items) == len(LOCAL_FALLBACK_ARTWORKS)
        assert all(item["source"] == "local_fallback" for item in items)
        assert [item["external_id"] for item in items] == [
            art["external_id"] for art in LOCAL_FALLBACK_ARTWORKS
        ]


@pytest.mark.asyncio
async def test_lot_creation_persists_immutable_artwork_snapshot_independent_of_external_api(
    client: httpx.AsyncClient,
):
    reg = await client.post(
        "/api/v1/auth/register",
        json={
            "name": "Curador Resiliencia",
            "email": "curador_resiliencia@verzel.com.br",
            "password": "StrongPassword123",
            "role": "AUCTIONEER",
        },
    )
    assert reg.status_code == 201
    token = reg.json()["access_token"]

    now = datetime.now(timezone.utc)
    create_resp = await client.post(
        "/api/v1/lots",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "external_artwork_id": "135378",
            "title": "The Red Kerchief",
            "artist": "Claude Monet",
            "date_display": "c. 1868-1873",
            "medium_display": "Oil on canvas",
            "image_url": "https://openaccess-cdn.clevelandart.org/1958.39/1958.39_web.jpg",
            "attributes_json": {"place_of_origin": "France", "department": "Painting"},
            "starting_bid_cents": 250000,
            "min_increment_cents": 10000,
            "start_time": (now - timedelta(minutes=5)).isoformat(),
            "end_time": (now + timedelta(hours=2)).isoformat(),
        },
    )
    assert create_resp.status_code == 201
    lot_data = create_resp.json()
    lot_id = lot_data["id"]

    req = httpx.Request("GET", "https://openaccess-api.clevelandart.org/api/artworks/")
    broken_client = _build_mock_http_client(httpx.ConnectError("API down", request=req))

    with patch("app.services.catalog.httpx.AsyncClient", return_value=broken_client):
        detail_resp = await client.get(f"/api/v1/lots/{lot_id}")
        assert detail_resp.status_code == 200
        detail = detail_resp.json()
        assert detail["title"] == "The Red Kerchief"
        assert detail["artist"] == "Claude Monet"
        assert detail["image_url"] == "https://openaccess-cdn.clevelandart.org/1958.39/1958.39_web.jpg"
        assert detail["attributes_json"]["place_of_origin"] == "France"
        assert broken_client.get.call_count == 0


@pytest.mark.asyncio
async def test_catalog_search_succeeds_when_catalog_cache_table_is_missing(
    client: httpx.AsyncClient,
    db_session: AsyncSession,
):
    await db_session.execute(text("DROP TABLE catalog_cache"))
    await db_session.commit()

    ok_response = httpx.Response(
        200,
        json=MOCK_CLEVELAND_API_PAYLOAD,
        request=httpx.Request("GET", "https://openaccess-api.clevelandart.org/api/artworks/"),
    )
    mock_http_client = _build_mock_http_client(ok_response)

    with patch("app.services.catalog.httpx.AsyncClient", return_value=mock_http_client):
        resp = await client.get("/api/v1/catalog?limit=8")

    assert resp.status_code == 200
    items = resp.json()
    assert len(items) == 1
    assert items[0]["external_id"] == "135378"

