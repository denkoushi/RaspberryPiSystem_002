from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

from .hid_line_decoder import DecodedHidFrame, HidLineDecoder

LOGGER = logging.getLogger("torque_agent.hid")


class _HidConnectionUnavailable(Exception):
    def __init__(self, message: str, *, was_connected: bool = False) -> None:
        super().__init__(message)
        self.was_connected = was_connected


def _load_evdev() -> Any:
    import evdev

    return evdev


async def _read_hid_connection(
    path: Path,
    on_line: Callable[[Path, str], Awaitable[None]],
    on_decode_error: Callable[[Path, DecodedHidFrame], Awaitable[None]] | None,
    frame_terminators: frozenset[str] | None,
    evdev: Any,
    on_exclusive_state: Callable[[Path, bool], None] | None,
) -> None:
    try:
        device = evdev.InputDevice(str(path))
    except OSError as error:
        raise _HidConnectionUnavailable(str(error)) from error

    decoder = HidLineDecoder(terminators=frame_terminators)
    grabbed = False
    try:
        try:
            device.grab()
            grabbed = True
        except OSError as error:
            raise _HidConnectionUnavailable(str(error)) from error
        LOGGER.info("Exclusively grabbed HID device %s", path)
        if on_exclusive_state is not None:
            on_exclusive_state(path, True)
        try:
            iterator = device.async_read_loop().__aiter__()
        except OSError as error:
            raise _HidConnectionUnavailable(str(error), was_connected=True) from error
        while True:
            try:
                event = await iterator.__anext__()
            except StopAsyncIteration as error:
                raise _HidConnectionUnavailable("input event stream ended", was_connected=True) from error
            except OSError as error:
                raise _HidConnectionUnavailable(str(error), was_connected=True) from error
            if event.type != evdev.ecodes.EV_KEY:
                continue
            key_event = evdev.categorize(event)
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
        if on_exclusive_state is not None:
            on_exclusive_state(path, False)
        try:
            if grabbed:
                device.ungrab()
        except OSError:
            LOGGER.debug("HID device %s disappeared before ungrab", path)
        finally:
            try:
                device.close()
            except OSError:
                LOGGER.debug("HID device %s disappeared before close", path)


async def read_hid_device(
    path: Path,
    on_line: Callable[[Path, str], Awaitable[None]],
    on_decode_error: Callable[[Path, DecodedHidFrame], Awaitable[None]] | None = None,
    frame_terminators: frozenset[str] | None = None,
    retry_delay_seconds: float = 1.0,
    on_exclusive_state: Callable[[Path, bool], None] | None = None,
) -> None:
    if retry_delay_seconds <= 0:
        raise ValueError("retry_delay_seconds must be greater than zero")
    evdev = _load_evdev()
    unavailable_logged = False
    while True:
        try:
            await _read_hid_connection(
                path,
                on_line,
                on_decode_error,
                frame_terminators,
                evdev,
                on_exclusive_state,
            )
        except _HidConnectionUnavailable as error:
            if error.was_connected or not unavailable_logged:
                LOGGER.warning("HID device %s unavailable; retrying same configured path: %s", path, error)
                unavailable_logged = True
            else:
                LOGGER.debug("HID device %s remains unavailable: %s", path, error)
            await asyncio.sleep(retry_delay_seconds)
