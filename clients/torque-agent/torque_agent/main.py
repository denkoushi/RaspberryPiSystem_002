from __future__ import annotations

import asyncio
import logging

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .api_client import OutboxSender
from .binding import BindingStore
from .cem3_btla_parser import Cem3BtlaHogpParser
from .config import AgentConfig
from .connection_lease import ConnectionLeaseManager
from .delivery import AsyncioOutboxWakeSignal
from .ingestor import TorqueEventIngestor
from .parser_registry import ParserRegistry, SyntheticDelimitedFixtureParser
from .queue_store import QueueStore
from .websocket_stream import WebSocketDeliveryNotifier, register_delivery_stream

LOGGER = logging.getLogger("torque_agent")


class HeartbeatBody(BaseModel):
    sessionId: str
    currentTemplateBoltId: str | None
    confirmationId: str | None
    torqueWrenchProfileId: str | None


class LeaseAcquireBody(BaseModel):
    sessionId: str
    currentTemplateBoltId: str
    confirmationId: str
    torqueWrenchProfileId: str
    requestId: str


class LeaseTakeoverBody(LeaseAcquireBody):
    physicalWrenchPresent: bool
    reason: str


class LeaseReleaseBody(BaseModel):
    reason: str = "CLIENT_RELEASE"


def build_registry(config: AgentConfig) -> ParserRegistry:
    registry = ParserRegistry()
    registry.register(
        Cem3BtlaHogpParser.PROFILE,
        Cem3BtlaHogpParser,
        frame_terminators=Cem3BtlaHogpParser.FRAME_TERMINATORS,
    )
    if config.synthetic_fixture_enabled:
        registry.register(SyntheticDelimitedFixtureParser.PROFILE, SyntheticDelimitedFixtureParser)
    return registry


def create_app(
    config: AgentConfig,
    binding_store: BindingStore,
    queue: QueueStore,
    lease_manager: ConnectionLeaseManager,
    delivery_notifier: WebSocketDeliveryNotifier | None = None,
) -> FastAPI:
    app = FastAPI(title="torque-agent", docs_url=None, redoc_url=None)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(config.browser_origins),
        allow_methods=["POST", "GET"],
        allow_headers=["content-type"],
        max_age=600,
    )
    register_delivery_stream(
        app,
        delivery_notifier or WebSocketDeliveryNotifier(config.browser_origins),
    )

    @app.get("/health")
    async def health() -> dict[str, object]:
        return {
            **lease_manager.snapshot(),
            "queuedEvents": queue.count(),
            "localAuditEvents": queue.local_error_count(),
        }

    @app.post("/heartbeat")
    async def heartbeat(body: HeartbeatBody) -> dict[str, object]:
        return await lease_manager.heartbeat(
            session_id=body.sessionId,
            current_template_bolt_id=body.currentTemplateBoltId,
            confirmation_id=body.confirmationId,
            profile_id=body.torqueWrenchProfileId,
        )

    @app.post("/lease/acquire")
    async def acquire(body: LeaseAcquireBody) -> dict[str, object]:
        return await lease_manager.acquire(
            profile_id=body.torqueWrenchProfileId,
            session_id=body.sessionId,
            current_template_bolt_id=body.currentTemplateBoltId,
            confirmation_id=body.confirmationId,
            request_id=body.requestId,
        )

    @app.post("/lease/takeover")
    async def takeover(body: LeaseTakeoverBody) -> dict[str, object]:
        if not body.physicalWrenchPresent:
            return {**lease_manager.snapshot(), "lastError": "PHYSICAL_WRENCH_CONFIRMATION_REQUIRED"}
        return await lease_manager.acquire(
            profile_id=body.torqueWrenchProfileId,
            session_id=body.sessionId,
            current_template_bolt_id=body.currentTemplateBoltId,
            confirmation_id=body.confirmationId,
            request_id=body.requestId,
            takeover=True,
            reason=body.reason,
        )

    @app.post("/lease/release")
    async def release(body: LeaseReleaseBody) -> dict[str, object]:
        return await lease_manager.release(body.reason)

    return app


async def run_agent(config: AgentConfig) -> None:
    # evdev is Linux-only. Keep the adapter import at the production runtime
    # boundary so configuration, HTTP, replay, and unit tests remain portable.
    from .hid_reader import read_hid_device

    queue = QueueStore(config.queue_path)
    wake_signal = AsyncioOutboxWakeSignal()
    delivery_notifier = WebSocketDeliveryNotifier(config.browser_origins)
    bindings = BindingStore(config.heartbeat_ttl_seconds)
    lease_manager = ConnectionLeaseManager(config, bindings)
    registry = build_registry(config)
    parsers = {device.path: registry.create(device.parser_profile) for device in config.devices}
    parser_profiles = {device.path: device.parser_profile for device in config.devices}
    frame_terminators = {
        device.path: registry.frame_terminators(device.parser_profile) for device in config.devices
    }
    ingestor = TorqueEventIngestor(
        queue=queue,
        bindings=bindings,
        parsers=parsers,
        parser_profiles=parser_profiles,
        wake_signal=wake_signal,
    )

    app = create_app(config, bindings, queue, lease_manager, delivery_notifier)
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=config.local_port, log_level="info"))
    async def supervise_hid() -> None:
        while True:
            await lease_manager.active_event.wait()
            readers = [
                asyncio.create_task(
                    read_hid_device(
                        device.path,
                        ingestor.on_line,
                        ingestor.on_decode_error,
                        frame_terminators[device.path],
                        on_exclusive_state=lease_manager.mark_hid_exclusive,
                    )
                )
                for device in config.devices
            ]
            try:
                while lease_manager.active_event.is_set():
                    await asyncio.sleep(0.1)
            finally:
                for reader in readers:
                    reader.cancel()
                await asyncio.gather(*readers, return_exceptions=True)

    tasks = [
        asyncio.create_task(
            OutboxSender(
                config.api_base_url,
                config.client_key,
                queue,
                tls_verify=config.tls_verify,
                wake_signal=wake_signal,
                notifier=delivery_notifier,
            ).run()
        ),
        asyncio.create_task(lease_manager.run()),
        asyncio.create_task(supervise_hid()),
        asyncio.create_task(server.serve()),
    ]
    await asyncio.gather(*tasks)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    asyncio.run(run_agent(AgentConfig.from_env()))
