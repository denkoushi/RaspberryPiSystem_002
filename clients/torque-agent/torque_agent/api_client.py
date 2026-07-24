from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Protocol

import httpx

from .delivery import (
    DeliveryNotifier,
    NullDeliveryNotifier,
    NullOutboxWakeSignal,
    OutboxWakeSignal,
    TorqueRecordCommitted,
)
from .queue_store import QueueStore

LOGGER = logging.getLogger("torque_agent.sender")


class TorqueRecordApi(Protocol):
    async def post(self, session_id: str, event_id: str, payload: dict[str, object]) -> httpx.Response: ...


class HttpxTorqueRecordApi:
    def __init__(self, api_base_url: str, client_key: str, *, tls_verify: bool) -> None:
        self._api_base_url = api_base_url
        self._client_key = client_key
        self._client = httpx.AsyncClient(timeout=10, verify=tls_verify)

    async def __aenter__(self) -> "HttpxTorqueRecordApi":
        return self

    async def __aexit__(self, *args: object) -> None:
        await self._client.aclose()

    async def post(self, session_id: str, event_id: str, payload: dict[str, object]) -> httpx.Response:
        body = dict(payload)
        body["sourceEventKey"] = event_id
        return await self._client.post(
            f"{self._api_base_url}/api/assembly/work-sessions/{session_id}/record-torque",
            headers={"x-client-key": self._client_key},
            json=body,
        )


class OutboxSender:
    def __init__(
        self,
        api_base_url: str,
        client_key: str,
        queue: QueueStore,
        *,
        tls_verify: bool = True,
        wake_signal: OutboxWakeSignal | None = None,
        notifier: DeliveryNotifier | None = None,
        acknowledged_at_factory: Callable[[], str] | None = None,
    ) -> None:
        self.api_base_url = api_base_url
        self.client_key = client_key
        self.queue = queue
        self.tls_verify = tls_verify
        self.wake_signal = wake_signal or NullOutboxWakeSignal()
        self.notifier = notifier or NullDeliveryNotifier()
        self.acknowledged_at_factory = acknowledged_at_factory or (
            lambda: datetime.now(UTC).isoformat().replace("+00:00", "Z")
        )

    async def _send_once(self, api: TorqueRecordApi) -> bool:
        for event_id, envelope in self.queue.pending():
            session_id = envelope["sessionId"]
            payload = dict(envelope["payload"])
            try:
                response = await api.post(session_id, event_id, payload)
                if 200 <= response.status_code < 300:
                    self.queue.acknowledge(event_id)
                    try:
                        await self.notifier.committed(
                            TorqueRecordCommitted(
                                session_id=session_id,
                                source_event_key=event_id,
                                captured_at=envelope.get("capturedAt"),
                                acknowledged_at=self.acknowledged_at_factory(),
                            )
                        )
                    except Exception:
                        LOGGER.exception(
                            "Torque record %s was committed but its local notification failed",
                            event_id,
                        )
                else:
                    self.queue.mark_attempt(event_id, f"HTTP {response.status_code}: {response.text}")
                    return False
            except (httpx.TimeoutException, httpx.NetworkError) as error:
                self.queue.mark_attempt(event_id, str(error))
                return False
        return True

    async def send_once(self) -> bool:
        async with HttpxTorqueRecordApi(
            self.api_base_url,
            self.client_key,
            tls_verify=self.tls_verify,
        ) as api:
            return await self._send_once(api)

    async def run(self) -> None:
        retry_delay_seconds = 1
        async with HttpxTorqueRecordApi(
            self.api_base_url,
            self.client_key,
            tls_verify=self.tls_verify,
        ) as api:
            while True:
                delivery_clear = await self._send_once(api)
                if delivery_clear:
                    retry_delay_seconds = 1
                    await self.wake_signal.wait(timeout_seconds=1)
                else:
                    retry_delay_seconds = min(retry_delay_seconds * 2, 30)
                    await asyncio.sleep(retry_delay_seconds)
