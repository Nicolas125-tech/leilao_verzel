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


MOCK_EXTERNAL_ARTWORKS = [
    {
        "external_id": "27992",
        "title": "A Sunday on La Grande Jatte",
        "artist": "Georges Seurat",
        "date_display": "1884/86",
        "medium_display": "Oil on canvas",
        "image_url": "https://www.artic.edu/iiif/2/1adf2696-8489-499b-cad2-821d7fde4b33/full/843,/0/default.jpg",
        "attributes": {
            "dimensions": "207.5 x 308.1 cm",
            "place_of_origin": "France",
            "department": "Painting and Sculpture",
        },
        "source": "artic",
    }
]


@pytest.mark.asyncio
async def test_catalog_successful_external_fetch(client: httpx.AsyncClient):
    with patch(
        "app.services.catalog.fetch_external_artworks",
        new_callable=AsyncMock,
    ) as mock_fetch:
        mock_fetch.return_value = MOCK_EXTERNAL_ARTWORKS

        resp = await client.get("/api/v1/catalog?q=seurat")
        assert resp.status_code == 200
        items = resp.json()
        assert len(items) == 1
        first = items[0]
        assert first["external_id"] == "27992"
        assert first["title"] == "A Sunday on La Grande Jatte"
        assert first["artist"] == "Georges Seurat"
        assert "1adf2696-8489-499b-cad2-821d7fde4b33" in first["image_url"]
        assert first["source"] == "artic"


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
            request=httpx.Request("GET", "https://api.artic.edu/api/v1/artworks/search"),
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
