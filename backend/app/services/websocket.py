from collections import defaultdict
import logging
from typing import Any
from uuid import UUID
from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect, status

from app.core.security import decode_access_token

logger = logging.getLogger("verzel.auction.websocket")


class ConnectionManager:
    def __init__(self) -> None:
        self._connections: dict[str, set[WebSocket]] = defaultdict(set)
        self._user_connections: dict[str, set[WebSocket]] = defaultdict(set)

    async def connect(self, lot_id: str | UUID, websocket: WebSocket) -> None:
        await websocket.accept()
        self._connections[str(lot_id)].add(websocket)

    def disconnect(self, lot_id: str | UUID, websocket: WebSocket) -> None:
        key = str(lot_id)
        if key in self._connections:
            self._connections[key].discard(websocket)
            if not self._connections[key]:
                del self._connections[key]

    async def connect_user(self, user_id: str | UUID, websocket: WebSocket) -> None:
        await websocket.accept()
        self._user_connections[str(user_id)].add(websocket)

    def disconnect_user(self, user_id: str | UUID, websocket: WebSocket) -> None:
        key = str(user_id)
        if key in self._user_connections:
            self._user_connections[key].discard(websocket)
            if not self._user_connections[key]:
                del self._user_connections[key]

    async def send_user_notification(
        self,
        user_id: str | UUID,
        payload: dict[str, Any],
    ) -> None:
        key = str(user_id)
        active = list(self._user_connections.get(key, set()))
        stale: list[WebSocket] = []
        for ws in active:
            try:
                await ws.send_json(payload)
            except (WebSocketDisconnect, RuntimeError):
                stale.append(ws)
        for ws in stale:
            self.disconnect_user(key, ws)

    async def broadcast(self, lot_id: str | UUID, message: dict[str, Any]) -> None:
        key = str(lot_id)
        active = list(self._connections.get(key, set()))
        stale: list[WebSocket] = []
        for ws in active:
            try:
                await ws.send_json(message)
            except (WebSocketDisconnect, RuntimeError):
                stale.append(ws)
        for ws in stale:
            self.disconnect(key, ws)

    async def broadcast_new_bid(
        self,
        lot_id: str | UUID,
        bid_dict: dict[str, Any],
        lot_summary: dict[str, Any] | None = None,
    ) -> None:
        payload: dict[str, Any] = {
            "event": "NEW_BID",
            "lot_id": str(lot_id),
            "bid": bid_dict,
            "lot": lot_summary,
        }
        if lot_summary:
            payload.update(lot_summary)
        await self.broadcast(lot_id, payload)

    async def broadcast_lot_settled(
        self,
        lot_id: str | UUID,
        cert_dict: dict[str, Any] | None,
    ) -> None:
        await self.broadcast(
            lot_id,
            {
                "event": "LOT_SETTLED",
                "lot_id": str(lot_id),
                "certificate": cert_dict,
            },
        )

    async def broadcast_lot_cancelled(self, lot_id: str | UUID) -> None:
        await self.broadcast(
            lot_id,
            {
                "event": "LOT_CANCELLED",
                "lot_id": str(lot_id),
            },
        )

    async def broadcast_lot_extended(
        self,
        lot_id: str | UUID,
        new_end_time: str,
        extension_count: int,
    ) -> None:
        await self.broadcast(
            lot_id,
            {
                "event": "LOT_EXTENDED",
                "lot_id": str(lot_id),
                "new_end_time": new_end_time,
                "extension_count": extension_count,
            },
        )


ws_manager = ConnectionManager()
router = APIRouter()


@router.websocket("/ws/notifications")
@router.websocket("/api/v1/ws/notifications")
@router.websocket("/ws/users/{user_id}")
@router.websocket("/api/v1/ws/users/{user_id}")
async def stream_user_notifications(
    websocket: WebSocket,
    user_id: str | None = None,
    token: str | None = Query(None),
):
    resolved_token = token or websocket.query_params.get("token")
    if not resolved_token:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    payload = decode_access_token(resolved_token)
    if not payload:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    token_user_id = payload.get("sub")
    if not token_user_id:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    if user_id and str(user_id) != str(token_user_id):
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await ws_manager.connect_user(token_user_id, websocket)
    logger.info("Sessão WebSocket pessoal conectada para o usuário %s", token_user_id)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        logger.info("Sessão WebSocket pessoal finalizada para o usuário %s", token_user_id)
    except (ConnectionError, RuntimeError) as exc:
        logger.warning("Falha de conexão WebSocket pessoal para %s: %s", token_user_id, exc)
    finally:
        ws_manager.disconnect_user(token_user_id, websocket)
