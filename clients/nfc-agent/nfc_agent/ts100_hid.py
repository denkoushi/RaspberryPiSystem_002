from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import datetime, timezone
import logging
import os
from typing import Optional, Any

try:
    from evdev import InputDevice, categorize, ecodes, list_devices
except Exception as exc:  # pragma: no cover - runtime fallback
    InputDevice = None  # type: ignore
    categorize = None  # type: ignore
    ecodes = None  # type: ignore
    list_devices = lambda: []  # type: ignore
    EVDEV_IMPORT_ERROR = str(exc)
else:
    EVDEV_IMPORT_ERROR = None


LOGGER = logging.getLogger("nfc_agent.ts100_hid")


@dataclass
class Ts100Status:
    connected: bool
    reader_name: Optional[str]
    message: str
    last_error: Optional[str] = None
    device_path: Optional[str] = None


class Ts100HidReader:
    """
    TS100 (HIDキーボードエミュレーション) から UID を読み取り、イベントキューへ投入する。
    - evdev を使用して /dev/input/by-id/... を監視
    - UIDは Enter/改行で確定とみなし送信
    - デバウンスはUID確定後に任せる（同一UID連投は上位側の処理でフィルタ可）
    """

    def __init__(self, event_queue: "asyncio.Queue[dict[str, Any]]", loop: asyncio.AbstractEventLoop):
        self.event_queue = event_queue
        self.loop = loop
        self.device_path = os.environ.get("TS100_HID_DEVICE")
        self.device: Optional[InputDevice] = None
        self.task: Optional[asyncio.Task[None]] = None
        self.status = Ts100Status(connected=False, reader_name=None, message="initializing")

    def start(self) -> None:
        if EVDEV_IMPORT_ERROR:
            self.status = Ts100Status(
                connected=False,
                reader_name=None,
                message="python-evdev がインストールされていません。`sudo apt-get install -y python3-evdev` を実行してください。",
                last_error=f"evdev-import-error: {EVDEV_IMPORT_ERROR}",
            )
            return

        path = self.device_path or self._auto_detect()
        if not path:
            self.status = Ts100Status(
                connected=False,
                reader_name=None,
                message="TS100 HIDデバイスが見つかりません。`TS100_HID_DEVICE` で明示指定してください。",
                last_error="device-not-found",
            )
            return

        try:
            self.device = InputDevice(path)
            self.status = Ts100Status(
                connected=True,
                reader_name=self.device.name,
                message=f"監視中: {path}",
                device_path=path,
            )
            self.task = self.loop.create_task(self._read_loop())
        except Exception as exc:  # pragma: no cover - runtime safety
            self.status = Ts100Status(
                connected=False,
                reader_name=None,
                message=f"HIDデバイスを開けません: {path}",
                last_error=str(exc),
                device_path=path,
            )

    async def shutdown(self) -> None:
        if self.task:
            self.task.cancel()
            try:
                await self.task
            except asyncio.CancelledError:
                pass
        if self.device:
            try:
                self.device.close()
            except Exception:
                pass

    def _auto_detect(self) -> Optional[str]:
        for dev_path in list_devices():
            try:
                dev = InputDevice(dev_path)
                name = (dev.name or "").lower()
                phys = (dev.phys or "").lower()
                if "ts100" in name or "ts-100" in name or "ts100" in phys or "ts-100" in phys:
                    return dev_path
            except Exception:
                continue
        return None

    async def _read_loop(self) -> None:
        assert self.device, "device not initialized"
        buffer = ""
        async for event in self.device.async_read_loop():
            try:
                if event.type != ecodes.EV_KEY:
                    continue
                key_event = categorize(event)
                if getattr(key_event, "keystate", None) != key_event.key_down:
                    continue
                keycode = key_event.keycode
                char = self._keycode_to_char(keycode)
                if char is None:
                    continue
                if char == "\n":
                    uid = buffer.strip()
                    buffer = ""
                    if not uid:
                        continue
                    event_payload = {
                        "uid": uid,
                        "reader": "ts100-hid",
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                        "type": "rfid-tag",
                    }
                    await self.event_queue.put(event_payload)
                else:
                    buffer += char
            except Exception as exc:
                LOGGER.exception("TS100 HID read loop error: %s", exc)
                self.status.last_error = str(exc)
                await asyncio.sleep(0.5)

    def _keycode_to_char(self, keycode: Any) -> Optional[str]:
        # keycode can be like 'KEY_A' or ['KEY_LEFTSHIFT', 'KEY_A']
        code = None
        if isinstance(keycode, str):
            code = keycode
        elif isinstance(keycode, (list, tuple)) and keycode:
            code = keycode[-1]
        if not code:
            return None

        mapping = {
            "KEY_0": "0",
            "KEY_1": "1",
            "KEY_2": "2",
            "KEY_3": "3",
            "KEY_4": "4",
            "KEY_5": "5",
            "KEY_6": "6",
            "KEY_7": "7",
            "KEY_8": "8",
            "KEY_9": "9",
            "KEY_A": "A",
            "KEY_B": "B",
            "KEY_C": "C",
            "KEY_D": "D",
            "KEY_E": "E",
            "KEY_F": "F",
            "KEY_G": "G",
            "KEY_H": "H",
            "KEY_I": "I",
            "KEY_J": "J",
            "KEY_K": "K",
            "KEY_L": "L",
            "KEY_M": "M",
            "KEY_N": "N",
            "KEY_O": "O",
            "KEY_P": "P",
            "KEY_Q": "Q",
            "KEY_R": "R",
            "KEY_S": "S",
            "KEY_T": "T",
            "KEY_U": "U",
            "KEY_V": "V",
            "KEY_W": "W",
            "KEY_X": "X",
            "KEY_Y": "Y",
            "KEY_Z": "Z",
            "KEY_ENTER": "\n",
            "KEY_KPENTER": "\n",
            "KEY_SPACE": " ",
        }
        return mapping.get(code)
