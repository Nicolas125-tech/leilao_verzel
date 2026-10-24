from fastapi import APIRouter
from app.api.v1.endpoints.auth import router as auth_router
from app.api.v1.endpoints.catalog import router as catalog_router
from app.api.v1.endpoints.lots import router as lots_router
from app.api.v1.endpoints.settlement import router as settlement_router
from app.api.v1.endpoints.wallet import router as wallet_router, wallets_router

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(auth_router)
api_router.include_router(wallet_router)
api_router.include_router(wallets_router)
api_router.include_router(catalog_router)
api_router.include_router(lots_router)
api_router.include_router(settlement_router)
