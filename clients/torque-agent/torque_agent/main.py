from __future__ import annotations

import asyncio
import logging
from pathlib import Path
from uuid import uuid4

import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .api_client import OutboxSender
from .binding import BindingStore
from .config import AgentConfig
from .hid_reader import read_hid_device
from .models import WorkBinding
from .parser_registry import ParserRegistry, SyntheticDelimitedFixtureParser
from .queue_store import QueueStore

LOGGER = logging.getLogger("torque_agent")


class HeartbeatBody(BaseModel):
    sessionId: str
    currentTemplateBoltId: str | None
    confirmationId: str | None
    torqueWrenchProfileId: str | None


def build_registry(config: AgentConfig) -> ParserRegistry:
    registry = ParserRegistry()
    if config.synthetic_fixture_enabled:
        registry.register(SyntheticDelimitedFixtureParser.PROFILE, SyntheticDelimitedFixtureParser)
    return registry


def create_app(config: AgentConfig, binding_store: BindingStore, queue: QueueStore) -> FastAPI:
    app = FastAPI(title="torque-agent", docs_url=None, redoc_url=None)
    app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["POST", "GET"], allow_headers=["*"])

    @app.get("/health")
    async def health() -> dict[str, object]:
        return {"ok": True, "queuedEvents": queue.count(), "bound": binding_store.current() is not None}

    @app.post("/heartbeat")
    async def heartbeat(body: HeartbeatBody) -> dict[str, bool]:
        if not body.currentTemplateBoltId or not body.confirmationId or not body.torqueWrenchProfileId:
            raise HTTPException(status_code=409, detail="A confirmed torque-wrench binding is required")
        binding_store.update(
            WorkBinding(
                session_id=body.sessionId,
                current_template_bolt_id=body.currentTemplateBoltId,
                confirmation_id=body.confirmationId,
                torque_wrench_profile_id=body.torqueWrenchProfileId,
            )
        )
        return {"ok": True}

    return app


async def run_agent(config: AgentConfig) -> None:
    queue = QueueStore(config.queue_path)
    bindings = BindingStore(config.heartbeat_ttl_seconds)
    registry = build_registry(config)
    parsers = {device.path: registry.create(device.parser_profile) for device in config.devices}

    async def on_line(device_path: Path, raw_text: str) -> None:
        binding = bindings.current()
        if not binding:
            LOGGER.warning("Discarded HID input without a live browser binding: %s", device_path)
            return
        parsed = parsers[device_path].parse(raw_text)
        event_id = str(uuid4())
        queue.enqueue(
            event_id,
            {
                "sessionId": binding.session_id,
                "payload": {
                    "expectedTemplateBoltId": binding.current_template_bolt_id,
                    "confirmationId": binding.confirmation_id,
                    "serialNumber": parsed.serial_number,
                    "value": parsed.value,
                    "unit": parsed.unit,
                    "deviceRecordedAt": parsed.device_recorded_at,
                    "deviceMemoryCounter": parsed.memory_counter,
                    "deviceJudgement": parsed.device_judgement,
                    "rawPayload": {
                        "rawText": parsed.raw_text,
                        "devicePath": str(device_path),
                        "parserProfile": next(d.parser_profile for d in config.devices if d.path == device_path),
                    },
                },
            },
        )

    app = create_app(config, bindings, queue)
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=config.local_port, log_level="info"))
    tasks = [asyncio.create_task(OutboxSender(config.api_base_url, config.client_key, queue).run()),
             asyncio.create_task(server.serve())]
    tasks.extend(asyncio.create_task(read_hid_device(device.path, on_line)) for device in config.devices)
    await asyncio.gather(*tasks)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    asyncio.run(run_agent(AgentConfig.from_env()))
