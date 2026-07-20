from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Protocol


CAPTURE_SCHEMA_VERSION = 1
PRIVATE_EVENTS_FILE = "events.torque-capture-private.jsonl"
PRIVATE_MANIFEST_FILE = "manifest.torque-capture-private.json"
DEFAULT_FRAME_TERMINATORS = ("KEY_ENTER", "KEY_KPENTER", "KEY_TAB")
FRAME_TERMINATORS_BY_NAME = {
    "enter": ("KEY_ENTER", "KEY_KPENTER"),
    "tab": ("KEY_TAB",),
}


class CaptureSafetyError(ValueError):
    """The requested operation violates a capture safety contract."""


class CaptureIncompleteError(RuntimeError):
    """The operation completed without satisfying its capture contract."""


class CaptureDeviceError(RuntimeError):
    """The operating system or input device could not complete the operation."""


@dataclass(frozen=True)
class ObservedKeyEvent:
    relative_ns: int
    event_code: int
    event_value: int
    key_state: str
    key_codes: tuple[str, ...]


@dataclass(frozen=True)
class CapturedKeyEvent:
    sequence: int
    relative_ns: int
    frame_no: int
    event_code: int
    event_value: int
    key_state: str
    key_codes: tuple[str, ...]

    def to_private_record(self) -> dict[str, object]:
        return {
            "schemaVersion": CAPTURE_SCHEMA_VERSION,
            "sequence": self.sequence,
            "relativeNs": self.relative_ns,
            "frameNo": self.frame_no,
            "eventType": "EV_KEY",
            "eventCode": self.event_code,
            "eventValue": self.event_value,
            "keyState": self.key_state,
            "keyCodes": list(self.key_codes),
        }


@dataclass(frozen=True)
class CaptureConfiguration:
    device: Path
    output: Path
    scenario: str
    expected_frames: int
    firmware: str
    output_config: str
    timeout_seconds: float = 120.0
    frame_terminators: tuple[str, ...] = DEFAULT_FRAME_TERMINATORS


class AsyncKeyEventSource(Protocol):
    async def __aenter__(self) -> AsyncKeyEventSource: ...

    async def __aexit__(self, exc_type: object, exc: object, traceback: object) -> None: ...

    def __aiter__(self) -> AsyncKeyEventSource: ...

    async def __anext__(self) -> ObservedKeyEvent: ...
