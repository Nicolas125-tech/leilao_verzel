import asyncio
import copy
from datetime import datetime, timedelta, timezone
import logging
import random
import re
import time
from typing import Any
import httpx
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.lot import CatalogCache
from app.services.lots import ensure_utc

logger = logging.getLogger(__name__)

CACHE_TTL_MINUTES = 10
STALE_CACHE_NOTICE = "API externa instável. Exibindo acervo local."


class CatalogCircuitBreaker:
    def __init__(
        self,
        failure_threshold: int = 3,
        recovery_timeout_seconds: float = 60.0,
    ) -> None:
        self.failure_threshold = failure_threshold
        self.recovery_timeout_seconds = recovery_timeout_seconds
        self._state: str = "CLOSED"
        self._failure_count: int = 0
        self._opened_at: float | None = None

    @property
    def state(self) -> str:
        if (
            self._state == "OPEN"
            and self._opened_at is not None
            and (time.monotonic() - self._opened_at) >= self.recovery_timeout_seconds
        ):
            self._state = "HALF_OPEN"
        return self._state

    @property
    def failure_count(self) -> int:
        return self._failure_count

    def allow_request(self) -> bool:
        return self.state in ("CLOSED", "HALF_OPEN")

    def record_success(self) -> None:
        self.reset()

    def record_failure(self) -> None:
        self._failure_count += 1
        if self._state == "HALF_OPEN" or self._failure_count >= self.failure_threshold:
            self._state = "OPEN"
            self._opened_at = time.monotonic()

    def reset(self) -> None:
        self._failure_count = 0
        self._opened_at = None
        self._state = "CLOSED"


circuit_breaker = CatalogCircuitBreaker(
    failure_threshold=3,
    recovery_timeout_seconds=60.0,
)

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


def _build_cache_key(query: str | None, skip: int, limit: int) -> str:
    clean_q = query.strip().lower() if query and query.strip() else ""
    return f"q={clean_q}|skip={skip}|limit={limit}"


async def fetch_external_artworks(
    query: str | None = None,
    skip: int = 0,
    limit: int = 12,
    max_attempts: int = 3,
) -> list[dict[str, Any]]:
    params = {
        "q": query.strip() if query and query.strip() else "painting",
        "has_image": 1,
        "limit": limit,
        "skip": skip,
        "fields": "id,title,creators,creation_date,technique,measurements,culture,department,images",
    }

    url = settings.CLEVELAND_ART_API_BASE_URL
    timeout = httpx.Timeout(float(settings.CLEVELAND_TIMEOUT_SECONDS))
    headers = {
        "User-Agent": "LeilaoVerzel/1.0 (contato@verzel.com.br; avaliacao-tecnica)",
        "Accept": "application/json",
    }

    payload: dict[str, Any] = {}
    last_exc: Exception | None = None

    for attempt in range(max_attempts):
        try:
            async with httpx.AsyncClient(timeout=timeout, headers=headers) as client:
                response = await client.get(url, params=params)
                response.raise_for_status()
                payload = response.json()
            break
        except (httpx.HTTPError, httpx.TimeoutException) as exc:
            last_exc = exc
            if attempt < max_attempts - 1:
                backoff_seconds = (0.2 * (2 ** attempt)) + random.uniform(0.01, 0.05)
                await asyncio.sleep(backoff_seconds)
    else:
        if last_exc is not None:
            raise last_exc

    data = payload.get("data", [])
    results: list[dict[str, Any]] = []

    for item in data:
        if not isinstance(item, dict):
            continue
        images = item.get("images")
        if not isinstance(images, dict):
            continue
        web_image = images.get("web")
        if not isinstance(web_image, dict):
            continue
        image_url = web_image.get("url")
        if not image_url:
            continue

        creators = item.get("creators") or []
        if creators and isinstance(creators, list) and isinstance(creators[0], dict):
            raw_desc = str(creators[0].get("description") or "")
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


async def _get_cache_entry(
    db: AsyncSession | None,
    cache_key: str,
) -> CatalogCache | None:
    if db is None:
        return None
    try:
        stmt = select(CatalogCache).where(CatalogCache.cache_key == cache_key)
        result = await db.execute(stmt)
        return result.scalar_one_or_none()
    except SQLAlchemyError as exc:
        logger.warning("Tabela catalog_cache indisponível na leitura (%s); ignorando cache.", exc)
        try:
            await db.rollback()
        except SQLAlchemyError:
            pass
        return None


async def _save_cache_entry(
    db: AsyncSession | None,
    cache_key: str,
    query: str | None,
    artworks: list[dict[str, Any]],
) -> None:
    if db is None:
        return
    try:
        now_utc = datetime.now(timezone.utc)
        expires_at = now_utc + timedelta(minutes=CACHE_TTL_MINUTES)
        existing = await _get_cache_entry(db, cache_key)

        if existing is not None:
            existing.payload_json = copy.deepcopy(artworks)
            existing.created_at = now_utc
            existing.expires_at = expires_at
        else:
            entry = CatalogCache(
                cache_key=cache_key,
                query_text=(query or "").strip(),
                payload_json=copy.deepcopy(artworks),
                created_at=now_utc,
                expires_at=expires_at,
            )
            db.add(entry)

        await db.commit()
    except SQLAlchemyError as exc:
        logger.warning("Não foi possível persistir cache em catalog_cache (%s).", exc)
        try:
            await db.rollback()
        except SQLAlchemyError:
            pass


async def search_catalog(
    query: str | None = None,
    skip: int = 0,
    limit: int = 12,
    db: AsyncSession | None = None,
) -> list[dict[str, Any]]:
    cache_key = _build_cache_key(query, skip, limit)
    now_utc = datetime.now(timezone.utc)
    cached_entry = await _get_cache_entry(db, cache_key)

    if (
        cached_entry is not None
        and cached_entry.payload_json
        and ensure_utc(cached_entry.expires_at) > now_utc
    ):
        return copy.deepcopy(cached_entry.payload_json)

    if circuit_breaker.allow_request():
        try:
            artworks = await fetch_external_artworks(query, skip=skip, limit=limit)
            circuit_breaker.record_success()
            if artworks:
                await _save_cache_entry(db, cache_key, query, artworks)
                return artworks
        except (httpx.HTTPError, httpx.TimeoutException, ValueError) as exc:
            circuit_breaker.record_failure()
            logger.warning(
                "Falha ao consultar catálogo externo (circuit=%s), acionando contingência: %s",
                circuit_breaker.state,
                exc,
            )
    else:
        logger.warning(
            "Circuit Breaker em estado OPEN; desviando chamada externa para contingência local."
        )

    if cached_entry is not None and cached_entry.payload_json:
        stale_items: list[dict[str, Any]] = []
        for raw_item in cached_entry.payload_json:
            item_copy = copy.deepcopy(raw_item)
            item_copy["source"] = "cache_stale"
            item_copy["notice"] = STALE_CACHE_NOTICE
            attrs = dict(item_copy.get("attributes") or {})
            attrs["notice"] = STALE_CACHE_NOTICE
            item_copy["attributes"] = attrs
            stale_items.append(item_copy)
        return stale_items

    if query and query.strip():
        q_clean = query.strip().lower()
        matched = [
            copy.deepcopy(item)
            for item in LOCAL_FALLBACK_ARTWORKS
            if q_clean in item["title"].lower()
            or q_clean in item["artist"].lower()
            or q_clean in item.get("attributes", {}).get("department", "").lower()
        ]
        if matched:
            return matched[skip : skip + limit]

    return [
        copy.deepcopy(item) for item in LOCAL_FALLBACK_ARTWORKS[skip : skip + limit]
    ]
