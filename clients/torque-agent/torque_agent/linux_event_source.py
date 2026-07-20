from __future__ import annotations

import asyncio
import errno
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

    def _close_device(self) -> None:
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
            self._loop = None
            self._grabbed = False

    def _open_device(self) -> None:
        if self._ecodes is None or self._categorize is None:
            raise RuntimeError("evdev adapter has not been initialized")
        try:
            self._device = self._input_device(str(self._device_path))
            self._device.grab()
            self._grabbed = True
            self._loop = self._device.async_read_loop()
        except Exception:
            self._close_device()
            raise

    async def _reopen_after_disconnect(self) -> None:
        while True:
            try:
                self._open_device()
                return
            except OSError as error:
                if error.errno not in {errno.ENOENT, errno.ENODEV}:
                    raise CaptureDeviceError(
                        "device could not be grabbed after reconnect; stop torque-agent if it owns the device"
                    ) from error
                await asyncio.sleep(0.05)

    async def __aenter__(self) -> LinuxEvdevEventSource:
        try:
            from evdev import InputDevice, categorize, ecodes
        except ImportError as error:
            raise CaptureDeviceError("capture requires Linux with the evdev package installed") from error

        self._input_device = InputDevice
        self._ecodes = ecodes
        self._categorize = categorize
        try:
            self._started_ns = time.monotonic_ns()
            self._open_device()
        except Exception as error:
            self._close_device()
            raise CaptureDeviceError(
                "device could not be grabbed exclusively; stop torque-agent if it owns the device"
            ) from error
        return self

    async def __aexit__(self, exc_type: object, exc: object, traceback: object) -> None:
        self._close_device()

    def __aiter__(self) -> LinuxEvdevEventSource:
        return self

    async def __anext__(self) -> ObservedKeyEvent:
        if self._loop is None or self._ecodes is None or self._categorize is None or self._started_ns is None:
            raise RuntimeError("event source is not open")
        while True:
            try:
                event = await anext(self._loop)
            except (OSError, StopAsyncIteration):
                self._close_device()
                await self._reopen_after_disconnect()
                continue
            if event.type == self._ecodes.EV_SYN and event.code == self._ecodes.SYN_DROPPED:
                raise CaptureDeviceError(
                    "kernel input buffer overrun detected; captured key data is incomplete"
                )
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
