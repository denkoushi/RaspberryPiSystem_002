from __future__ import annotations

import asyncio
import contextlib
import logging
import time
from collections import deque
from datetime import datetime, timezone
from typing import Any, Deque, Dict, Optional

import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from .config import AgentConfig
from .serial_reader import SerialLineReader, SerialReaderStatus

LOGGER = logging.getLogger("barcode_agent")

MAX_REPLAY = 50
EVENT_TYPE = "barcodeScan"


class EventIdGenerator:
    """JS safe integer 範囲で単調増加する eventId を生成する。"""

    def __init__(self) -> None:
        self._last_id = 0

    def next(self) -> int:
        candidate = time.time_ns() // 1_000_000
        if candidate <= self._last_id:
            candidate = self._last_id + 1
        self._last_id = candidate
        return candidate


class WebSocketManager:
    def __init__(self) -> None:
        self.connections: set[WebSocket] = set()

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        self.connections.add(websocket)

    async def disconnect(self, websocket: WebSocket) -> None:
        self.connections.discard(websocket)

    async def broadcast(self, message: Dict[str, Any]) -> bool:
        delivered = False
        dead: list[WebSocket] = []
        for websocket in self.connections:
            try:
                await websocket.send_json(message)
                delivered = True
            except RuntimeError:
                dead.append(websocket)
            except WebSocketDisconnect:
                dead.append(websocket)
        for websocket in dead:
            await self.disconnect(websocket)
        return delivered


def create_app(
    config: AgentConfig,
    reader: SerialLineReader,
    event_manager: WebSocketManager,
    replay: Deque[Dict[str, Any]],
    last_event_holder: Dict[str, Optional[Dict[str, Any]]],
) -> FastAPI:
    app = FastAPI(title="Barcode Agent")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/api/agent/status")
    async def agent_status() -> Dict[str, Any]:
        st: SerialReaderStatus = reader.get_status()
        return {
            "readerConnected": st.connected,
            "serialDevice": st.device,
            "message": st.message,
            "lastError": st.last_error,
            "lastLine": st.last_line,
            "lastEvent": last_event_holder["event"],
            "restPort": config.rest_port,
        }

    @app.websocket("/stream")
    async def websocket_stream(websocket: WebSocket) -> None:
        await event_manager.connect(websocket)
        try:
            for payload in list(replay):
                try:
                    await websocket.send_json(payload)
                except Exception:
                    break
            while True:
                await websocket.receive_text()
        except WebSocketDisconnect:
            await event_manager.disconnect(websocket)

    return app


async def event_worker(
    line_queue: "asyncio.Queue[str]",
    event_manager: WebSocketManager,
    replay: Deque[Dict[str, Any]],
    last_event_holder: Dict[str, Optional[Dict[str, Any]]],
    event_id_generator: EventIdGenerator,
) -> None:
    while True:
        text = await line_queue.get()
        event_id = event_id_generator.next()
        ts = datetime.now(timezone.utc).isoformat()
        payload: Dict[str, Any] = {
            "type": EVENT_TYPE,
            "text": text,
            "timestamp": ts,
            "eventId": event_id,
        }
        last_event_holder["event"] = payload
        replay.append(payload)
        await event_manager.broadcast(payload)
        line_queue.task_done()


async def main() -> None:
    config = AgentConfig.load()
    logging.basicConfig(level=config.log_level.upper(), format="%(asctime)s [%(levelname)s] %(message)s")

    LOGGER.info(
        "Starting Barcode Agent (device=%s baud=%s port=%s)",
        config.serial_device,
        config.serial_baud,
        config.rest_port,
    )

    line_queue: asyncio.Queue[str] = asyncio.Queue()
    reader = SerialLineReader(config.serial_device, config.serial_baud, line_queue)
    reader.start()

    event_manager = WebSocketManager()
    replay: Deque[Dict[str, Any]] = deque(maxlen=MAX_REPLAY)
    last_event_holder: Dict[str, Optional[Dict[str, Any]]] = {"event": None}
    event_id_generator = EventIdGenerator()

    app = create_app(config, reader, event_manager, replay, last_event_holder)
    config_uvicorn = uvicorn.Config(
        app,
        host=config.rest_host,
        port=config.rest_port,
        log_level=config.log_level.lower(),
        lifespan="on",
    )
    server = uvicorn.Server(config_uvicorn)

    worker_task = asyncio.create_task(
        event_worker(line_queue, event_manager, replay, last_event_holder, event_id_generator)
    )

    try:
        await server.serve()
    finally:
        worker_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await worker_task
        await reader.shutdown()
