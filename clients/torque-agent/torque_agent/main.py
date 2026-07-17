from __future__ import annotations

import asyncio
import logging

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .api_client import OutboxSender
from .binding import BindingStore
from .config import AgentConfig
from .hid_reader import read_hid_device
from .ingestor import TorqueEventIngestor
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
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(config.browser_origins),
        allow_methods=["POST", "GET"],
        allow_headers=["content-type"],
        max_age=600,
    )

    @app.get("/health")
    async def health() -> dict[str, object]:
        return {
            "ok": True,
            "queuedEvents": queue.count(),
            "localAuditEvents": queue.local_error_count(),
            "bound": binding_store.current() is not None,
        }

    @app.post("/heartbeat")
    async def heartbeat(body: HeartbeatBody) -> dict[str, bool]:
        if not body.currentTemplateBoltId or not body.confirmationId or not body.torqueWrenchProfileId:
            binding_store.clear()
            return {"ok": True, "bound": False}
        binding_store.update(
            WorkBinding(
                session_id=body.sessionId,
                current_template_bolt_id=body.currentTemplateBoltId,
                confirmation_id=body.confirmationId,
                torque_wrench_profile_id=body.torqueWrenchProfileId,
            )
        )
        return {"ok": True, "bound": True}

    return app


async def run_agent(config: AgentConfig) -> None:
    queue = QueueStore(config.queue_path)
    bindings = BindingStore(config.heartbeat_ttl_seconds)
    registry = build_registry(config)
    parsers = {device.path: registry.create(device.parser_profile) for device in config.devices}
    parser_profiles = {device.path: device.parser_profile for device in config.devices}
    ingestor = TorqueEventIngestor(
        queue=queue,
        bindings=bindings,
        parsers=parsers,
        parser_profiles=parser_profiles,
    )

    app = create_app(config, bindings, queue)
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=config.local_port, log_level="info"))
    tasks = [asyncio.create_task(OutboxSender(config.api_base_url, config.client_key, queue).run()),
             asyncio.create_task(server.serve())]
    tasks.extend(asyncio.create_task(read_hid_device(device.path, ingestor.on_line)) for device in config.devices)
    await asyncio.gather(*tasks)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    asyncio.run(run_agent(AgentConfig.from_env()))
