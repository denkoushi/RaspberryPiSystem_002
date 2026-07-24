from __future__ import annotations

import asyncio
import logging

from fastapi import FastAPI, WebSocket, WebSocketDisconnect

from .delivery import DeliveryNotifier, TorqueRecordCommitted

LOGGER = logging.getLogger("torque_agent.stream")


class WebSocketDeliveryNotifier(DeliveryNotifier):
    SEND_TIMEOUT_SECONDS = 0.25

    def __init__(self, allowed_origins: tuple[str, ...]) -> None:
        self._allowed_origins = frozenset(allowed_origins)
        self._connections: set[WebSocket] = set()

    def origin_allowed(self, origin: str | None) -> bool:
        return origin is not None and origin in self._allowed_origins

    async def accept(self, websocket: WebSocket) -> bool:
        if not self.origin_allowed(websocket.headers.get("origin")):
            await websocket.close(code=1008, reason="Origin is not allowed")
            return False
        await websocket.accept()
        self._connections.add(websocket)
        return True

    def disconnect(self, websocket: WebSocket) -> None:
        self._connections.discard(websocket)

    async def committed(self, event: TorqueRecordCommitted) -> None:
        async def send(websocket: WebSocket) -> tuple[WebSocket, bool]:
            try:
                await asyncio.wait_for(
                    websocket.send_json(event.as_payload()),
                    timeout=self.SEND_TIMEOUT_SECONDS,
                )
                return websocket, True
            except Exception:
                LOGGER.warning("Dropping an unavailable torque delivery stream")
                return websocket, False

        results = await asyncio.gather(*(send(websocket) for websocket in tuple(self._connections)))
        for websocket, delivered in results:
            if not delivered:
                self.disconnect(websocket)
                try:
                    await asyncio.wait_for(
                        websocket.close(code=1011, reason="Delivery stream unavailable"),
                        timeout=self.SEND_TIMEOUT_SECONDS,
                    )
                except Exception:
                    pass


def register_delivery_stream(app: FastAPI, notifier: WebSocketDeliveryNotifier) -> None:
    @app.websocket("/stream")
    async def delivery_stream(websocket: WebSocket) -> None:
        if not await notifier.accept(websocket):
            return
        try:
            while True:
                await websocket.receive_text()
        except WebSocketDisconnect:
            pass
        finally:
            notifier.disconnect(websocket)
