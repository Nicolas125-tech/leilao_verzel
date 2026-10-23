from fastapi import APIRouter, Query

from app.schemas.catalog import CatalogItem
from app.services.catalog import search_catalog

router = APIRouter(prefix="/catalog", tags=["catalog"])


@router.get("", response_model=list[CatalogItem])
async def get_catalog(
    q: str | None = Query(default=None, description="Termo de busca para obras de arte ou artistas"),
):
    artworks = await search_catalog(query=q)
    return [CatalogItem.model_validate(item) for item in artworks]
