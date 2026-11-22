import httpx
import pytest


@pytest.mark.asyncio
async def test_root_endpoint_returns_service_metadata(client: httpx.AsyncClient):
    response = await client.get("/")
    assert response.status_code == 200
    data = response.json()
    assert data["service"] == "Casa de Leilões Verzel API"
    assert data["status"] == "online"
    assert data["docs"] == "/docs"
    assert data["health"] == "/health"


@pytest.mark.asyncio
async def test_health_endpoint_includes_timestamp_and_status(client: httpx.AsyncClient):
    response = await client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert data["database"] == "connected"
    assert "timestamp" in data
    assert "service" in data
