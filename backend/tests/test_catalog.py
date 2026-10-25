from unittest.mock import AsyncMock, patch
import httpx
import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.database import get_db
from app.main import app
from app.models.base import Base


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
        },
        {
            "id": 999999,
            "title": "Artwork Without Web Image",
            "creators": [],
            "images": {},
        },
    ]
}


@pytest.mark.asyncio
async def test_catalog_successful_external_fetch(client: httpx.AsyncClient):
    mock_response = httpx.Response(
        200,
        json=MOCK_CLEVELAND_API_PAYLOAD,
        request=httpx.Request("GET", "https://openaccess-api.clevelandart.org/api/artworks/"),
    )
    mock_http_client = AsyncMock()
    mock_http_client.get.return_value = mock_response
    mock_http_client.__aenter__.return_value = mock_http_client
    mock_http_client.__aexit__.return_value = None

    with patch(
        "app.services.catalog.httpx.AsyncClient",
        return_value=mock_http_client,
    ):
        resp = await client.get("/api/v1/catalog?q=monet")
        assert resp.status_code == 200
        items = resp.json()
        assert len(items) == 1
        first = items[0]
        assert first["external_id"] == "135378"
        assert first["title"] == "The Red Kerchief"
        assert first["artist"] == "Claude Monet"
        assert first["date_display"] == "c. 1868-1873"
        assert first["medium_display"] == "Oil on canvas"
        assert first["image_url"] == "https://openaccess-cdn.clevelandart.org/1958.39/1958.39_web.jpg"
        assert first["attributes"]["place_of_origin"] == "France, 19th century"
        assert first["attributes"]["department"] == "European Painting and Sculpture"
        assert first["source"] == "cleveland_art"


@pytest.mark.asyncio
async def test_catalog_timeout_triggers_local_fallback(client: httpx.AsyncClient):
    with patch(
        "app.services.catalog.fetch_external_artworks",
        new_callable=AsyncMock,
    ) as mock_fetch:
        mock_fetch.side_effect = httpx.TimeoutException("Connection timed out after 4 seconds")

        resp = await client.get("/api/v1/catalog?q=qualquer")
        assert resp.status_code == 200
        items = resp.json()
        assert len(items) > 0
        first = items[0]
        assert first["source"] == "local_fallback"
        assert len(first["title"]) > 0
        assert len(first["image_url"]) > 0


@pytest.mark.asyncio
async def test_catalog_http_error_triggers_local_fallback(client: httpx.AsyncClient):
    with patch(
        "app.services.catalog.fetch_external_artworks",
        new_callable=AsyncMock,
    ) as mock_fetch:
        mock_fetch.side_effect = httpx.HTTPStatusError(
            "503 Service Unavailable",
            request=httpx.Request("GET", "https://openaccess-api.clevelandart.org/api/artworks/"),
            response=httpx.Response(503),
        )

        resp = await client.get("/api/v1/catalog")
        assert resp.status_code == 200
        items = resp.json()
        assert len(items) > 0
        assert all(item["source"] == "local_fallback" for item in items)


@pytest.mark.asyncio
async def test_catalog_public_access(client: httpx.AsyncClient):
    resp = await client.get("/api/v1/catalog")
    assert resp.status_code == 200
