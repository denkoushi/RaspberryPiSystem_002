from __future__ import annotations

import asyncio
import contextlib
import logging
from typing import Any, Dict, Optional

import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from .config import AgentConfig
from .queue_store import QueueStore
from .reader import ReaderService, ReaderStatus
from .resend_worker import ResendWorker


LOGGER = logging.getLogger("nfc_agent")


class WebSocketManager:
    def __init__(self) -> None:
        self.connections: set[WebSocket] = set()

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        self.connections.add(websocket)

    async def disconnect(self, websocket: WebSocket) -> None:
        self.connections.discard(websocket)

    async def broadcast(self, message: Dict[str, Any]) -> None:
        dead: list[WebSocket] = []
        for websocket in self.connections:
            try:
                await websocket.send_json(message)
            except RuntimeError:
                dead.append(websocket)
            except WebSocketDisconnect:
                dead.append(websocket)
        for websocket in dead:
            await self.disconnect(websocket)


def create_app(
    config: AgentConfig,
    queue_store: QueueStore,
    reader_service: ReaderService,
    event_manager: WebSocketManager,
    last_event_holder: Dict[str, Optional[Dict[str, Any]]],
) -> FastAPI:
    app = FastAPI(title="NFC Agent")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/api/agent/status")
    async def agent_status() -> Dict[str, Any]:
        status: ReaderStatus = reader_service.get_status()
        return {
            "readerConnected": status.connected,
            "readerName": status.reader_name,
            "message": status.message,
            "lastError": status.last_error,
            "queueSize": queue_store.count(),
            "lastEvent": last_event_holder["event"],
        }

    @app.get("/api/agent/queue")
    async def queue_preview() -> Dict[str, Any]:
        events = queue_store.list_events(limit=50)
        return {"events": [{"id": event_id, "payload": payload} for event_id, payload in events]}

    @app.post("/api/agent/flush")
    async def flush_queue() -> Dict[str, Any]:
        events = queue_store.list_events(limit=500)
        ids = [event_id for event_id, _ in events]
        queue_store.delete(ids)
        return {"flushed": len(ids)}

    @app.websocket("/stream")
    async def websocket_stream(websocket: WebSocket) -> None:
        await event_manager.connect(websocket)
        try:
            # WebSocket接続が確立されたら、キューに保存されたイベントを即座に再送する
            # （resend_workerが定期的にチェックするが、接続直後に再送することで遅延を最小化）
            if queue_store.count() > 0:
                events = queue_store.list_events(limit=100)
                successful_ids: list[int] = []
                for event_id, payload in events:
                    try:
                        await websocket.send_json(payload)
                        successful_ids.append(event_id)
                        await asyncio.sleep(0.05)  # 少し間隔を空ける
                    except Exception:
                        break  # エラーが発生した場合は停止
                if successful_ids:
                    queue_store.delete(successful_ids)
                    LOGGER.info("Resent %d queued events to new WebSocket connection", len(successful_ids))
            
            while True:
                await websocket.receive_text()
        except WebSocketDisconnect:
            await event_manager.disconnect(websocket)

    return app


async def event_worker(
    event_queue: "asyncio.Queue[Dict[str, Any]]",
    queue_store: QueueStore,
    event_manager: WebSocketManager,
    last_event_holder: Dict[str, Optional[Dict[str, Any]]],
) -> None:
    while True:
        event = await event_queue.get()
        last_event_holder["event"] = event
        queue_store.enqueue(event)
        await event_manager.broadcast(event)
        event_queue.task_done()


async def main() -> None:
    config = AgentConfig.load()
    logging.basicConfig(level=config.log_level.upper(), format="%(asctime)s [%(levelname)s] %(message)s")

    LOGGER.info("Starting NFC Agent (mode=%s)", config.agent_mode)

    queue_store = QueueStore(config.queue_db_path)
    event_queue: "asyncio.Queue[Dict[str, Any]]" = asyncio.Queue()
    event_manager = WebSocketManager()
    loop = asyncio.get_running_loop()
    reader_service = ReaderService(event_queue, loop)
    reader_service.start(config.agent_mode)
    last_event_holder: Dict[str, Optional[Dict[str, Any]]] = {"event": None}

    app = create_app(config, queue_store, reader_service, event_manager, last_event_holder)
    config_uvicorn = uvicorn.Config(
        app,
        host=config.rest_host,
        port=config.rest_port,
        log_level=config.log_level.lower(),
        lifespan="on",
    )
    server = uvicorn.Server(config_uvicorn)

    async def serve_uvicorn() -> None:
        await server.serve()

    worker_task = asyncio.create_task(event_worker(event_queue, queue_store, event_manager, last_event_holder))
    
    # オフライン耐性: キューに保存されたイベントを再送するワーカー
    resend_worker = ResendWorker(queue_store, event_manager, config)
    resend_worker.start()

    try:
        await serve_uvicorn()
    finally:
        resend_worker.stop()
        await resend_worker.wait_stopped()
        worker_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await worker_task
        await reader_service.shutdown()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        LOGGER.info("Agent stopped by user.")
