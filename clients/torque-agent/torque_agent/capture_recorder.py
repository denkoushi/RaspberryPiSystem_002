from __future__ import annotations

import asyncio
import json
import os
import re
from collections.abc import AsyncIterator
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .capture_models import (
    CAPTURE_SCHEMA_VERSION,
    PRIVATE_EVENTS_FILE,
    PRIVATE_MANIFEST_FILE,
    AsyncKeyEventSource,
    CapturedKeyEvent,
    CaptureConfiguration,
    CaptureDeviceError,
    CaptureIncompleteError,
    CaptureSafetyError,
    ObservedKeyEvent,
)
from .hid_line_decoder import TERMINATORS


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def find_git_root(path: Path) -> Path | None:
    candidate = path.expanduser().resolve(strict=False)
    if not candidate.is_dir():
        candidate = candidate.parent
    for parent in (candidate, *candidate.parents):
        if (parent / ".git").exists():
            return parent
    return None


def require_private_path(path: Path, *, label: str) -> Path:
    resolved = path.expanduser().resolve(strict=False)
    git_root = find_git_root(resolved)
    if git_root is not None:
        raise CaptureSafetyError(f"{label} must be outside a Git repository")
    return resolved


def validate_device_path(path: Path) -> Path:
    raw = str(path)
    if (
        not raw.startswith("/dev/input/by-id/")
        or raw == "/dev/input/by-id/"
        or path.parent != Path("/dev/input/by-id")
        or path.name in {"", ".", ".."}
    ):
        raise CaptureSafetyError("device must be an explicit /dev/input/by-id/* path")

    identity = path.name.lower()
    if identity.endswith("-event-kbd"):
        identity = identity[: -len("-event-kbd")]
    identity = re.sub(r"[^a-z0-9]+", "_", identity).strip("_")
    general_keyboard_tokens = (
        "general_keyboard",
        "generic_keyboard",
        "usb_keyboard",
        "magic_keyboard",
        "apple_internal_keyboard",
    )
    if any(token in identity for token in general_keyboard_tokens):
        raise CaptureSafetyError("general-purpose keyboard devices are not allowed")
    return path


def _write_private_json(path: Path, value: dict[str, Any]) -> None:
    temporary = path.with_suffix(f"{path.suffix}.tmp")
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            json.dump(value, stream, ensure_ascii=False, indent=2, sort_keys=True)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        os.chmod(path, 0o600)
    finally:
        if temporary.exists():
            temporary.unlink()


class PrivateCaptureWriter:
    def __init__(self, config: CaptureConfiguration) -> None:
        self.config = config
        self.events_path = config.output / PRIVATE_EVENTS_FILE
        self.manifest_path = config.output / PRIVATE_MANIFEST_FILE
        self._stream: Any | None = None
        self._sequence = 0
        self._frame_no = 1
        self._completed_frames = 0
        self._started_at = _utc_now()

    @property
    def completed_frames(self) -> int:
        return self._completed_frames

    def start(self) -> None:
        if self.config.output.exists():
            raise CaptureSafetyError("capture output directory must not already exist")
        self.config.output.mkdir(parents=True, mode=0o700)
        os.chmod(self.config.output, 0o700)
        descriptor = os.open(self.events_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        self._stream = os.fdopen(descriptor, "w", encoding="utf-8")
        try:
            self._write_manifest("in_progress")
        except Exception:
            self._stream.close()
            self._stream = None
            raise

    def record(self, event: ObservedKeyEvent) -> bool:
        if self._stream is None:
            raise RuntimeError("capture writer has not been started")
        self._sequence += 1
        record = CapturedKeyEvent(
            sequence=self._sequence,
            relative_ns=event.relative_ns,
            frame_no=self._frame_no,
            event_code=event.event_code,
            event_value=event.event_value,
            key_state=event.key_state,
            key_codes=event.key_codes,
        ).to_private_record()
        self._stream.write(json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n")
        self._stream.flush()
        os.fsync(self._stream.fileno())

        if event.key_state == "down" and event.key_codes[0] in TERMINATORS:
            self._completed_frames += 1
            self._frame_no += 1
        return self._completed_frames >= self.config.expected_frames

    def finalize(self, status: str, *, error: str | None = None) -> None:
        if self._stream is not None:
            self._stream.flush()
            os.fsync(self._stream.fileno())
            self._stream.close()
            self._stream = None
        self._write_manifest(status, error=error)

    def _write_manifest(self, status: str, *, error: str | None = None) -> None:
        manifest: dict[str, Any] = {
            "schemaVersion": CAPTURE_SCHEMA_VERSION,
            "status": status,
            "scenario": self.config.scenario,
            "expectedFrames": self.config.expected_frames,
            "capturedFrames": self._completed_frames,
            "eventCount": self._sequence,
            "devicePath": str(self.config.device),
            "firmware": self.config.firmware,
            "outputConfig": self.config.output_config,
            "startedAt": self._started_at,
            "finishedAt": None if status == "in_progress" else _utc_now(),
        }
        if error:
            manifest["error"] = error
        _write_private_json(self.manifest_path, manifest)


async def _consume_events(source: AsyncKeyEventSource, writer: PrivateCaptureWriter) -> None:
    async with source:
        async for event in source:
            if writer.record(event):
                return


async def capture_events(source: AsyncKeyEventSource, config: CaptureConfiguration) -> int:
    validate_device_path(config.device)
    require_private_path(config.output, label="capture output")
    if config.expected_frames < 1:
        raise CaptureSafetyError("expected frames must be greater than zero")
    if config.timeout_seconds <= 0:
        raise CaptureSafetyError("timeout must be greater than zero")

    writer = PrivateCaptureWriter(config)
    writer.start()
    try:
        await asyncio.wait_for(_consume_events(source, writer), timeout=config.timeout_seconds)
    except TimeoutError as error:
        writer.finalize("timeout", error="capture timed out before all expected frames arrived")
        raise CaptureIncompleteError("capture timed out; acquired events were retained") from error
    except asyncio.CancelledError:
        writer.finalize("interrupted", error="capture was interrupted")
        raise
    except CaptureDeviceError as error:
        writer.finalize("device_error", error=str(error))
        raise
    except OSError as error:
        writer.finalize("device_error", error=str(error))
        raise CaptureDeviceError("input device could not be read; stop torque-agent if it owns the device") from error
    except Exception:
        writer.finalize("interrupted", error="capture stopped unexpectedly")
        raise

    if writer.completed_frames < config.expected_frames:
        writer.finalize("interrupted", error="event source ended before all expected frames arrived")
        raise CaptureIncompleteError("event source ended before all expected frames arrived")
    writer.finalize("complete")
    return writer.completed_frames


async def iter_events(events: list[ObservedKeyEvent]) -> AsyncIterator[ObservedKeyEvent]:
    for event in events:
        yield event
