from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.seed import reset_demo_data

router = APIRouter(prefix="/demo", tags=["demo"])


@router.post("/reset")
async def reset_demo(
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    await reset_demo_data(db)
    return {
        "status": "ok",
        "message": "Demonstração restaurada com sucesso.",
    }
