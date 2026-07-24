from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class TorqueRecordCommitted:
    session_id: str
    source_event_key: str
    captured_at: str | None
    acknowledged_at: str

    def as_payload(self) -> dict[str, str | None]:
        return {
            "type": "torqueRecordCommitted",
            "sessionId": self.session_id,
            "sourceEventKey": self.source_event_key,
            "capturedAt": self.captured_at,
            "acknowledgedAt": self.acknowledged_at,
        }


class DeliveryNotifier(Protocol):
    async def committed(self, event: TorqueRecordCommitted) -> None: ...


class NullDeliveryNotifier:
    async def committed(self, event: TorqueRecordCommitted) -> None:
        return None


class OutboxWakeSignal(Protocol):
    def notify(self) -> None: ...

    async def wait(self, timeout_seconds: float) -> None: ...


class NullOutboxWakeSignal:
    def notify(self) -> None:
        return None

    async def wait(self, timeout_seconds: float) -> None:
        await asyncio.sleep(timeout_seconds)


class AsyncioOutboxWakeSignal:
    """Process-local wake-up with a bounded safety scan for durable queue rows."""

    def __init__(self) -> None:
        self._event = asyncio.Event()

    def notify(self) -> None:
        self._event.set()

    async def wait(self, timeout_seconds: float) -> None:
        try:
            await asyncio.wait_for(self._event.wait(), timeout=timeout_seconds)
        except TimeoutError:
            return
        finally:
            self._event.clear()
