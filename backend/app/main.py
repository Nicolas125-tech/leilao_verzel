from uuid import UUID
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.router import api_router
from app.core.config import settings
from app.services.websocket import ws_manager

app = FastAPI(
    title="Casa de Leiloes Verzel API",
    version="0.1.0",
    description="API para pregao de arte em tempo real com liquidacao atomica e auditoria criptografica",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)


@app.websocket("/ws/lots/{lot_id}")
async def lot_websocket_endpoint(websocket: WebSocket, lot_id: UUID):
    await ws_manager.connect(lot_id, websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        ws_manager.disconnect(lot_id, websocket)


@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "environment": settings.ENVIRONMENT,
    }
