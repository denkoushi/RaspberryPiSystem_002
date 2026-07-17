from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from pathlib import Path

from evdev import InputDevice, categorize, ecodes
from .hid_line_decoder import HidLineDecoder

LOGGER = logging.getLogger("torque_agent.hid")

async def read_hid_device(path: Path, on_line: Callable[[Path, str], Awaitable[None]]) -> None:
    device = InputDevice(str(path))
    decoder = HidLineDecoder()
    device.grab()
    LOGGER.info("Exclusively grabbed HID device %s", path)
    try:
        async for event in device.async_read_loop():
            if event.type != ecodes.EV_KEY:
                continue
            key_event = categorize(event)
            if key_event.keystate != key_event.key_down:
                continue
            key_code = key_event.keycode[0] if isinstance(key_event.keycode, list) else key_event.keycode
            line = decoder.feed(key_code)
            if line:
                await on_line(path, line)
    finally:
        device.ungrab()
        device.close()
        await asyncio.sleep(0)
