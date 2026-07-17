from __future__ import annotations

import time
from pathlib import Path
from typing import Any

from .capture_models import CaptureDeviceError, ObservedKeyEvent


class LinuxEvdevEventSource:
    """Linux-only EV_KEY adapter. Importing this module does not import evdev."""

    def __init__(self, device_path: Path) -> None:
        self._device_path = device_path
        self._device: Any | None = None
        self._ecodes: Any | None = None
        self._categorize: Any | None = None
        self._started_ns: int | None = None
        self._loop: Any | None = None
        self._grabbed = False

    async def __aenter__(self) -> LinuxEvdevEventSource:
        try:
            from evdev import InputDevice, categorize, ecodes
        except ImportError as error:
            raise CaptureDeviceError("capture requires Linux with the evdev package installed") from error

        try:
            self._device = InputDevice(str(self._device_path))
            self._device.grab()
            self._grabbed = True
            self._ecodes = ecodes
            self._categorize = categorize
            self._started_ns = time.monotonic_ns()
            self._loop = self._device.async_read_loop()
        except Exception as error:
            if self._device is not None:
                if self._grabbed:
                    try:
                        self._device.ungrab()
                    except OSError:
                        pass
                self._device.close()
                self._device = None
                self._grabbed = False
            raise CaptureDeviceError(
                "device could not be grabbed exclusively; stop torque-agent if it owns the device"
            ) from error
        return self

    async def __aexit__(self, exc_type: object, exc: object, traceback: object) -> None:
        if self._device is None:
            return
        try:
            if self._grabbed:
                try:
                    self._device.ungrab()
                except OSError:
                    pass
        finally:
            self._device.close()
            self._device = None
            self._grabbed = False

    def __aiter__(self) -> LinuxEvdevEventSource:
        return self

    async def __anext__(self) -> ObservedKeyEvent:
        if self._loop is None or self._ecodes is None or self._categorize is None or self._started_ns is None:
            raise RuntimeError("event source is not open")
        while True:
            try:
                event = await anext(self._loop)
            except StopAsyncIteration:
                raise
            if event.type != self._ecodes.EV_KEY:
                continue
            key_event = self._categorize(event)
            key_codes = key_event.keycode if isinstance(key_event.keycode, list) else [key_event.keycode]
            state_names = {
                key_event.key_down: "down",
                key_event.key_up: "up",
                key_event.key_hold: "hold",
            }
            return ObservedKeyEvent(
                relative_ns=time.monotonic_ns() - self._started_ns,
                event_code=int(event.code),
                event_value=int(event.value),
                key_state=state_names.get(key_event.keystate, f"unknown:{key_event.keystate}"),
                key_codes=tuple(str(code) for code in key_codes),
            )
