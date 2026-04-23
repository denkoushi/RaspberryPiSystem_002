from __future__ import annotations

import asyncio
import contextlib
import logging
from dataclasses import dataclass, field
from typing import Optional

import serial

LOGGER = logging.getLogger("barcode_agent.serial")


@dataclass
class SerialReaderStatus:
    connected: bool = False
    device: str = ""
    message: str = "starting"
    last_error: Optional[str] = None
    last_line: Optional[str] = None


@dataclass
class SerialLineReader:
    """シリアルから1行ずつ読み取り、asyncio.Queue に投入する（再接続付き）。"""

    device: str
    baud: int
    line_queue: "asyncio.Queue[str]"
    status: SerialReaderStatus = field(default_factory=SerialReaderStatus)
    _stop: asyncio.Event = field(default_factory=asyncio.Event)
    _task: Optional[asyncio.Task[None]] = None

    def start(self) -> None:
        self.status.device = self.device
        self._task = asyncio.create_task(self._run())

    async def shutdown(self) -> None:
        self._stop.set()
        if self._task:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
            self._task = None

    def get_status(self) -> SerialReaderStatus:
        return self.status

    async def _run(self) -> None:
        delay = 1.0
        while not self._stop.is_set():
            ser: Optional[serial.Serial] = None
            try:
                LOGGER.info("Opening serial %s @ %s", self.device, self.baud)
                ser = serial.Serial(self.device, self.baud, timeout=1.0)
                self.status.connected = True
                self.status.message = "reading"
                self.status.last_error = None
                delay = 1.0
                while not self._stop.is_set():
                    line_bytes = await asyncio.to_thread(ser.readline)
                    if not line_bytes:
                        continue
                    text = line_bytes.decode("utf-8", errors="replace").strip()
                    if text:
                        self.status.last_line = text
                        await self.line_queue.put(text)
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001 — 再接続のため広く捕捉
                self.status.connected = False
                self.status.message = "disconnected"
                self.status.last_error = str(exc)
                LOGGER.warning("Serial error (%s): %s; retry in %.1fs", self.device, exc, delay)
                await asyncio.sleep(delay)
                delay = min(delay * 2, 60.0)
            finally:
                if ser is not None:
                    with contextlib.suppress(Exception):
                        ser.close()
                self.status.connected = False
                if not self._stop.is_set():
                    self.status.message = "reconnecting"
