import logging
import re
from typing import Any
import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

LOCAL_FALLBACK_ARTWORKS: list[dict[str, Any]] = [
    {
        "external_id": "27992",
        "title": "A Sunday on La Grande Jatte",
        "artist": "Georges Seurat",
        "date_display": "1884/86",
        "medium_display": "Óleo sobre tela",
        "image_url": "/artworks/grande-jatte.svg",
        "attributes": {
            "dimensions": "207.5 x 308.1 cm",
            "place_of_origin": "França",
            "department": "Pintura e Escultura",
            "classification": "Pintura",
        },
        "source": "local_fallback",
    },
    {
        "external_id": "28560",
        "title": "The Bedroom",
        "artist": "Vincent van Gogh",
        "date_display": "1889",
        "medium_display": "Óleo sobre tela",
        "image_url": "/artworks/the-bedroom.svg",
        "attributes": {
            "dimensions": "73.6 x 92.3 cm",
            "place_of_origin": "França",
            "department": "Pintura e Escultura",
            "classification": "Pintura",
        },
        "source": "local_fallback",
    },
    {
        "external_id": "16568",
        "title": "Water Lilies",
        "artist": "Claude Monet",
        "date_display": "1906",
        "medium_display": "Óleo sobre tela",
        "image_url": "/artworks/water-lilies.svg",
        "attributes": {
            "dimensions": "89.9 x 94.1 cm",
            "place_of_origin": "França",
            "department": "Pintura e Escultura",
            "classification": "Pintura",
        },
        "source": "local_fallback",
    },
    {
        "external_id": "111628",
        "title": "Nighthawks",
        "artist": "Edward Hopper",
        "date_display": "1942",
        "medium_display": "Óleo sobre tela",
        "image_url": "/artworks/nighthawks.svg",
        "attributes": {
            "dimensions": "84.1 x 152.4 cm",
            "place_of_origin": "Estados Unidos",
            "department": "Artes das Américas",
            "classification": "Pintura",
        },
        "source": "local_fallback",
    },
    {
        "external_id": "24645",
        "title": "The Great Wave off Kanagawa",
        "artist": "Katsushika Hokusai",
        "date_display": "c. 1830/32",
        "medium_display": "Xilogravura colorida",
        "image_url": "/artworks/great-wave.svg",
        "attributes": {
            "dimensions": "25.7 x 37.9 cm",
            "place_of_origin": "Japão",
            "department": "Arte Asiática",
            "classification": "Gravura",
        },
        "source": "local_fallback",
    },
    {
        "external_id": "6565",
        "title": "American Gothic",
        "artist": "Grant Wood",
        "date_display": "1930",
        "medium_display": "Óleo sobre painel",
        "image_url": "/artworks/american-gothic.svg",
        "attributes": {
            "dimensions": "78 x 65.3 cm",
            "place_of_origin": "Estados Unidos",
            "department": "Artes das Américas",
            "classification": "Pintura",
        },
        "source": "local_fallback",
    },
]


async def fetch_external_artworks(query: str | None = None) -> list[dict[str, Any]]:
    params = {
        "q": query.strip() if query and query.strip() else "painting",
        "has_image": 1,
        "limit": 12,
    }

    url = settings.CLEVELAND_ART_API_BASE_URL
    timeout = httpx.Timeout(settings.CLEVELAND_TIMEOUT_SECONDS)
    headers = {
        "User-Agent": "LeilaoVerzel/1.0 (contato@verzel.com.br; avaliacao-tecnica)",
        "Accept": "application/json",
    }

    async with httpx.AsyncClient(timeout=timeout, headers=headers) as client:
        response = await client.get(url, params=params)
        response.raise_for_status()
        payload = response.json()

    data = payload.get("data", [])
    results: list[dict[str, Any]] = []

    for item in data:
        images = item.get("images") or {}
        web_image = images.get("web") or {}
        image_url = web_image.get("url")
        if not image_url:
            continue

        creators = item.get("creators") or []
        if creators and isinstance(creators, list):
            raw_desc = creators[0].get("description") or ""
            artist = re.sub(r"\s*\([^)]*\)", "", raw_desc).strip() or "Artista Desconhecido"
        else:
            artist = "Artista Desconhecido"

        culture_list = item.get("culture") or []
        place_of_origin = (
            culture_list[0]
            if isinstance(culture_list, list) and culture_list
            else "Origem não informada"
        )

        results.append(
            {
                "external_id": str(item.get("id")),
                "title": item.get("title") or "Obra Sem Título",
                "artist": artist,
                "date_display": item.get("creation_date") or "Data Desconhecida",
                "medium_display": item.get("technique") or "Técnica Mista",
                "image_url": image_url,
                "attributes": {
                    "dimensions": item.get("measurements") or "Dimensões não informadas",
                    "place_of_origin": place_of_origin,
                    "department": item.get("department") or "Acervo Geral",
                },
                "source": "cleveland_art",
            }
        )

    return results


async def search_catalog(query: str | None = None) -> list[dict[str, Any]]:
    try:
        artworks = await fetch_external_artworks(query)
        if artworks:
            return artworks
    except (httpx.HTTPError, httpx.TimeoutException) as exc:
        logger.warning("Falha ao consultar catálogo externo, acionando contingência local: %s", exc)

    if query and query.strip():
        q_clean = query.strip().lower()
        matched = [
            item
            for item in LOCAL_FALLBACK_ARTWORKS
            if q_clean in item["title"].lower()
            or q_clean in item["artist"].lower()
            or q_clean in item.get("attributes", {}).get("department", "").lower()
        ]
        if matched:
            return matched

    return LOCAL_FALLBACK_ARTWORKS
