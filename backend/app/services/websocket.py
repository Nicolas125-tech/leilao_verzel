from collections import defaultdict
from typing import Any
from uuid import UUID
from fastapi import WebSocket


class ConnectionManager:
    def __init__(self) -> None:
        self._connections: dict[str, set[WebSocket]] = defaultdict(set)

    async def connect(self, lot_id: str | UUID, websocket: WebSocket) -> None:
        await websocket.accept()
        self._connections[str(lot_id)].add(websocket)

    def disconnect(self, lot_id: str | UUID, websocket: WebSocket) -> None:
        key = str(lot_id)
        if key in self._connections:
            self._connections[key].discard(websocket)
            if not self._connections[key]:
                del self._connections[key]

    async def broadcast(self, lot_id: str | UUID, message: dict[str, Any]) -> None:
        key = str(lot_id)
        active = list(self._connections.get(key, set()))
        stale: list[WebSocket] = []
        for ws in active:
            try:
                await ws.send_json(message)
            except Exception:
                stale.append(ws)
        for ws in stale:
            self.disconnect(key, ws)

    async def broadcast_new_bid(
        self,
        lot_id: str | UUID,
        bid_dict: dict[str, Any],
        lot_summary: dict[str, Any] | None = None,
    ) -> None:
        await self.broadcast(
            lot_id,
            {
                "event": "NEW_BID",
                "lot_id": str(lot_id),
                "bid": bid_dict,
                "lot": lot_summary,
            },
        )

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


ws_manager = ConnectionManager()
