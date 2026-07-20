from __future__ import annotations

import asyncio
from pathlib import Path
from types import SimpleNamespace

import pytest

from torque_agent import hid_reader


class StopReader(Exception):
    pass


class FakeEventLoop:
    def __init__(self, items: list[object]) -> None:
        self._items = iter(items)

    def __aiter__(self) -> FakeEventLoop:
        return self

    async def __anext__(self) -> object:
        try:
            item = next(self._items)
        except StopIteration as error:
            raise StopAsyncIteration from error
        if isinstance(item, Exception):
            raise item
        return item


class FakeDevice:
    def __init__(self, path: str, items: list[object]) -> None:
        self.path = path
        self._items = items
        self.grabbed = False
        self.ungrabbed = False
        self.closed = False

    def grab(self) -> None:
        self.grabbed = True

    def ungrab(self) -> None:
        self.ungrabbed = True

    def close(self) -> None:
        self.closed = True

    def async_read_loop(self) -> FakeEventLoop:
        return FakeEventLoop(self._items)


def key_event(code: str) -> SimpleNamespace:
    return SimpleNamespace(type=1, key_code=code)


def test_reader_waits_for_exact_path_reopens_after_disconnect_and_resets_partial_frame(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    stable_path = Path("/dev/input/by-id/bluetooth-TOHNICHI-event-kbd")
    opened_paths: list[str] = []
    devices = [
        FakeDevice(str(stable_path), [key_event("KEY_1"), OSError(19, "disconnected")]),
        FakeDevice(str(stable_path), [key_event("KEY_2"), key_event("KEY_ENTER")]),
    ]

    def open_device(path: str) -> FakeDevice:
        opened_paths.append(path)
        if len(opened_paths) == 1:
            raise FileNotFoundError(path)
        return devices[len(opened_paths) - 2]

    monkeypatch.setattr(
        hid_reader,
        "_load_evdev",
        lambda: SimpleNamespace(
            InputDevice=open_device,
            categorize=lambda event: SimpleNamespace(
                keycode=event.key_code,
                keystate=1,
                key_down=1,
                key_up=0,
                key_hold=2,
            ),
            ecodes=SimpleNamespace(EV_KEY=1),
        ),
    )

    received: list[str] = []

    async def on_line(path: Path, value: str) -> None:
        assert path == stable_path
        received.append(value)
        raise StopReader

    with pytest.raises(StopReader):
        asyncio.run(
            hid_reader.read_hid_device(
                stable_path,
                on_line,
                frame_terminators=frozenset({"KEY_ENTER"}),
                retry_delay_seconds=0.001,
            )
        )

    assert opened_paths == [str(stable_path), str(stable_path), str(stable_path)]
    assert received == ["2"]
    assert all(device.grabbed and device.ungrabbed and device.closed for device in devices)


def test_reader_rejects_non_positive_retry_delay() -> None:
    async def on_line(path: Path, value: str) -> None:
        raise AssertionError((path, value))

    with pytest.raises(ValueError, match="greater than zero"):
        asyncio.run(
            hid_reader.read_hid_device(
                Path("/dev/input/by-id/fixture"),
                on_line,
                retry_delay_seconds=0,
            )
        )
