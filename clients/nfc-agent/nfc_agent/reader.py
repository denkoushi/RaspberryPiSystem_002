from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
import contextlib
from datetime import datetime, timezone
from typing import Any, Optional, Tuple
import logging
import time

try:
    from smartcard.CardMonitoring import CardMonitor, CardObserver
    from smartcard.System import readers
    from smartcard.Exceptions import CardConnectionException
    from smartcard.util import toHexString
except ImportError as exc:  # pragma: no cover - handled at runtime
    CardMonitor = None  # type: ignore
    CardObserver = object  # type: ignore
    readers = lambda: []  # type: ignore
    CardConnectionException = Exception  # type: ignore
    NoReadersAvailable = Exception  # type: ignore

    def toHexString(data):  # type: ignore
        return ""

    IMPORT_ERROR_MESSAGE = str(exc)
else:
    try:
        from smartcard.Exceptions import NoReadersAvailable  # type: ignore
        IMPORT_ERROR_MESSAGE = None
    except ImportError as exc:  # pragma: no cover
        NoReadersAvailable = Exception  # type: ignore
        IMPORT_ERROR_MESSAGE = f"NoReadersAvailable missing ({exc})"


LOGGER = logging.getLogger("nfc_agent.reader")

if IMPORT_ERROR_MESSAGE:
    if IMPORT_ERROR_MESSAGE.startswith("NoReadersAvailable missing"):
        LOGGER.warning("Optional pyscard exception not available: %s", IMPORT_ERROR_MESSAGE)
    else:
        LOGGER.error("Failed to import pyscard modules: %s", IMPORT_ERROR_MESSAGE)


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
        self.last_uid: Optional[str] = None
        self.last_timestamp: Optional[float] = None

    def update(self, observable, actions: Tuple[list[Any], list[Any]]):  # type: ignore[override]
        added_cards, removed_cards = actions
        LOGGER.info("=== update() called ===")
        LOGGER.info("Card observer update: added=%s removed=%s", added_cards, removed_cards)
        for card in added_cards:
            try:
                LOGGER.info("Creating connection for card: %s", card)
                connection = card.createConnection()
                connection.connect()
                LOGGER.info("Connection established for card: %s", card)
                data, sw1, sw2 = connection.transmit([0xFF, 0xCA, 0x00, 0x00, 0x00])
                LOGGER.info("Transmit result: data=%s sw1=%s sw2=%s", data, sw1, sw2)
                if sw1 == 0x90:
                    uid = _format_uid(data)
                    now = time.time()
                    LOGGER.info("Processing card UID='%s' repr=%s", uid, repr(uid))
                    LOGGER.info("Current time: %s", now)
                    LOGGER.info("Last UID='%s' repr=%s", self.last_uid, repr(self.last_uid))
                    LOGGER.info("Last timestamp: %s", self.last_timestamp)
                    if self.last_uid and self.last_timestamp:
                        time_diff = now - self.last_timestamp
                        LOGGER.info("Time difference: %.3f seconds", time_diff)
                        LOGGER.info("UIDs match: %s", uid == self.last_uid)
                    if self.last_uid == uid and self.last_timestamp and now - self.last_timestamp < 2.0:
                        LOGGER.info("Debounce: SKIPPING UID %s", uid)
                        continue
                    LOGGER.info("Debounce: PROCESSING UID %s", uid)
                    self.last_uid = uid
                    self.last_timestamp = now
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
                LOGGER.exception("Card connection error for card %s", card, exc_info=exc)
            except Exception as exc:  # pragma: no cover
                self.status.last_error = f"Card observer error: {exc}"
                LOGGER.exception("Unhandled error while processing card %s", card, exc_info=exc)


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
                message=(
                    "pyscard がインストールされていません。`sudo apt install python3-pyscard` を実行後、pcscd を再起動してください。"
                ),
                last_error=f"import-error: {IMPORT_ERROR_MESSAGE}" if IMPORT_ERROR_MESSAGE else "import-error",
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
