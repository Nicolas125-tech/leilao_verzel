from fastapi import APIRouter, Query

from app.schemas.catalog import CatalogItem
from app.services.catalog import search_catalog

router = APIRouter(prefix="/catalog", tags=["catalog"])


@router.get("", response_model=list[CatalogItem])
async def get_catalog(
    q: str | None = Query(default=None, description="Termo de busca para obras de arte ou artistas"),
    skip: int = Query(default=0, ge=0, description="Offset de paginação"),
    limit: int = Query(default=12, ge=1, le=50, description="Quantidade máxima de itens por página"),
):
    artworks = await search_catalog(query=q, skip=skip, limit=limit)
    return [CatalogItem.model_validate(item) for item in artworks]
