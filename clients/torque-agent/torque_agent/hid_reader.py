from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from pathlib import Path

from evdev import InputDevice, categorize, ecodes
from .hid_line_decoder import DecodedHidFrame, HidLineDecoder

LOGGER = logging.getLogger("torque_agent.hid")

async def read_hid_device(
    path: Path,
    on_line: Callable[[Path, str], Awaitable[None]],
    on_decode_error: Callable[[Path, DecodedHidFrame], Awaitable[None]] | None = None,
) -> None:
    device = InputDevice(str(path))
    decoder = HidLineDecoder()
    grabbed = False
    try:
        device.grab()
        grabbed = True
        LOGGER.info("Exclusively grabbed HID device %s", path)
        async for event in device.async_read_loop():
            if event.type != ecodes.EV_KEY:
                continue
            key_event = categorize(event)
            key_code = key_event.keycode[0] if isinstance(key_event.keycode, list) else key_event.keycode
            key_state = {
                key_event.key_down: "down",
                key_event.key_up: "up",
                key_event.key_hold: "hold",
            }.get(key_event.keystate)
            if key_state is None:
                continue
            frame = decoder.feed(key_code, key_state)
            if frame is None:
                continue
            if frame.unsupported_key_codes:
                if on_decode_error is not None:
                    await on_decode_error(path, frame)
                else:
                    LOGGER.warning(
                        "Discarded HID frame with %d unsupported key(s) from %s",
                        len(frame.unsupported_key_codes),
                        path,
                    )
                continue
            if frame.text:
                await on_line(path, frame.text)
    finally:
        try:
            if grabbed:
                device.ungrab()
        finally:
            device.close()
        await asyncio.sleep(0)
