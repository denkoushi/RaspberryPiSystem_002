from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
import contextlib
from datetime import datetime, timezone
from typing import Any, Optional, Tuple

try:
    from smartcard.CardMonitoring import CardMonitor, CardObserver
    from smartcard.System import readers
    from smartcard.Exceptions import CardConnectionException, NoReadersAvailable
    from smartcard.util import toHexString
except ImportError:  # pragma: no cover - handled at runtime
    CardMonitor = None  # type: ignore
    CardObserver = object  # type: ignore
    readers = lambda: []  # type: ignore
    CardConnectionException = Exception  # type: ignore
    NoReadersAvailable = Exception  # type: ignore

    def toHexString(data):  # type: ignore
        return ""


@dataclass
class ReaderStatus:
    connected: bool = False
    reader_name: Optional[str] = None
    message: str = ""
    last_error: Optional[str] = None


def _format_uid(data: list[int]) -> str:
    return "".join(part.zfill(2) for part in toHexString(data).split(" "))


class AsyncCardObserver(CardObserver):  # type: ignore[misc]
    def __init__(self, loop: asyncio.AbstractEventLoop, queue: "asyncio.Queue[dict[str, Any]]", status: ReaderStatus):
        self.loop = loop
        self.queue = queue
        self.status = status

    def update(self, observable, actions: Tuple[list[Any], list[Any]]):  # type: ignore[override]
        added_cards, _ = actions
        for card in added_cards:
            try:
                connection = card.createConnection()
                connection.connect()
                data, sw1, sw2 = connection.transmit([0xFF, 0xCA, 0x00, 0x00, 0x00])
                if sw1 == 0x90:
                    uid = _format_uid(data)
                    event = {
                        "uid": uid,
                        "reader": getattr(card, "reader", "unknown"),
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                        "type": "nfc-card",
                    }
                    asyncio.run_coroutine_threadsafe(self.queue.put(event), self.loop)
                else:
                    self.status.last_error = f"Unexpected status word: {sw1:02X}{sw2:02X}"
            except CardConnectionException as exc:  # pragma: no cover
                self.status.last_error = f"Card connection error: {exc}"


class ReaderService:
    def __init__(self, event_queue: "asyncio.Queue[dict[str, Any]]", loop: asyncio.AbstractEventLoop):
        self.event_queue = event_queue
        self.loop = loop
        self.monitor: Optional[CardMonitor] = None
        self.observer: Optional[AsyncCardObserver] = None
        self.status = ReaderStatus(message="initializing")
        self.mock_task: Optional[asyncio.Task[None]] = None

    def start(self, mode: str) -> None:
        if mode == "mock":
            self.status = ReaderStatus(connected=True, reader_name="mock-reader", message="Mock mode")
            self.mock_task = self.loop.create_task(self._mock_events())
            return

        if CardMonitor is None:
            self.status = ReaderStatus(
                connected=False,
                message="pyscard がインストールされていません。`sudo apt install python3-pyscard` を実行後、pcscd を再起動してください。",
                last_error="import-error",
            )
            return

        try:
            available_readers = readers()
        except NoReadersAvailable:
            available_readers = []

        if not available_readers:
            self.status = ReaderStatus(
                connected=False,
                message="PC/SC リーダーが見つかりません。RC-S300/S1 を接続し `pcsc_scan` で認識を確認してください。",
                last_error="no-readers",
            )
            return

        try:
            self.monitor = CardMonitor()
        except Exception as exc:  # pragma: no cover
            self.status = ReaderStatus(connected=False, message="カードモニタ初期化に失敗しました", last_error=str(exc))
            return

        self.observer = AsyncCardObserver(self.loop, self.event_queue, self.status)
        self.monitor.addObserver(self.observer)
        reader_name = str(available_readers[0])
        self.status = ReaderStatus(connected=True, reader_name=reader_name, message="監視中")

    async def _mock_events(self) -> None:
        counter = 0
        while True:
            counter += 1
            event = {
                "uid": f"MOCK{counter:04d}",
                "reader": "mock-reader",
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "type": "nfc-card",
                "mock": True,
            }
            await self.event_queue.put(event)
            await asyncio.sleep(5)

    async def shutdown(self) -> None:
        if self.monitor and self.observer:
            self.monitor.deleteObserver(self.observer)
            self.monitor = None
        if self.mock_task:
            self.mock_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self.mock_task

    def get_status(self) -> ReaderStatus:
        return self.status
