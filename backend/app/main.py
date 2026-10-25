from contextlib import asynccontextmanager
import logging
import time
from uuid import UUID

from fastapi import Depends, FastAPI, Request, Response, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.router import api_router
from app.core.config import settings
from app.core.database import get_db
from app.services.websocket import ws_manager

logger = logging.getLogger("verzel.auction.api")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Iniciando motor de pregão Verzel no ambiente: %s", settings.ENVIRONMENT)
    yield
    logger.info("Encerrando serviços da Casa de Leilões Verzel")


app = FastAPI(
    title="Casa de Leilões Verzel API",
    version="0.1.0",
    description="API para pregão de arte em tempo real com liquidação atômica e auditoria criptográfica",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_origin_regex=r"^https:\/\/.*\.vercel\.app$|^http:\/\/localhost(:\d+)?$|^http:\/\/127\.0\.0\.1(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Process-Time"],
)


@app.middleware("http")
async def track_response_latency(request: Request, call_next):
    started_at = time.perf_counter()
    response: Response = await call_next(request)
    elapsed_ms = (time.perf_counter() - started_at) * 1000
    response.headers["X-Process-Time"] = f"{elapsed_ms:.2f}ms"
    return response


app.include_router(api_router)


@app.websocket("/ws/lots/{lot_id}")
@app.websocket("/api/v1/ws/lots/{lot_id}")
async def stream_auction_lot_bids(websocket: WebSocket, lot_id: UUID):
    await ws_manager.connect(lot_id, websocket)
    logger.info("Sessão WebSocket conectada para o lote %s", lot_id)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        logger.info("Sessão WebSocket finalizada para o lote %s", lot_id)
        ws_manager.disconnect(lot_id, websocket)
    except (ConnectionError, RuntimeError) as exc:
        logger.warning("Falha de conexão WebSocket no lote %s: %s", lot_id, exc)
        ws_manager.disconnect(lot_id, websocket)


@app.get("/health")
async def check_auction_system_health(db: AsyncSession = Depends(get_db)):
    database_connected = True
    try:
        await db.execute(text("SELECT 1"))
    except Exception as exc:
        logger.error("Erro na verificação de conectividade da base de dados: %s", exc)
        database_connected = False

    return {
        "status": "healthy" if database_connected else "degraded",
        "database": "connected" if database_connected else "disconnected",
        "environment": settings.ENVIRONMENT,
        "service": "verzel-auction-api",
    }
