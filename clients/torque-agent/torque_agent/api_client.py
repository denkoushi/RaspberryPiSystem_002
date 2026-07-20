from __future__ import annotations

import asyncio
import logging

import httpx

from .queue_store import QueueStore

LOGGER = logging.getLogger("torque_agent.sender")


class OutboxSender:
    def __init__(self, api_base_url: str, client_key: str, queue: QueueStore, *, tls_verify: bool = True) -> None:
        self.api_base_url = api_base_url
        self.client_key = client_key
        self.queue = queue
        self.tls_verify = tls_verify

    async def send_once(self) -> bool:
        async with httpx.AsyncClient(timeout=10, verify=self.tls_verify) as client:
            for event_id, envelope in self.queue.pending():
                session_id = envelope["sessionId"]
                payload = dict(envelope["payload"])
                payload["sourceEventKey"] = event_id
                try:
                    response = await client.post(
                        f"{self.api_base_url}/api/assembly/work-sessions/{session_id}/record-torque",
                        headers={"x-client-key": self.client_key},
                        json=payload,
                    )
                    if 200 <= response.status_code < 300:
                        self.queue.acknowledge(event_id)
                    else:
                        self.queue.mark_attempt(event_id, f"HTTP {response.status_code}: {response.text}")
                        return False
                except (httpx.TimeoutException, httpx.NetworkError) as error:
                    self.queue.mark_attempt(event_id, str(error))
                    return False
        return True

    async def run(self) -> None:
        retry_delay_seconds = 1
        while True:
            delivery_clear = await self.send_once()
            if delivery_clear:
                retry_delay_seconds = 1
            else:
                retry_delay_seconds = min(retry_delay_seconds * 2, 30)
            await asyncio.sleep(retry_delay_seconds)
