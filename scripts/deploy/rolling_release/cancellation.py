"""Cooperative cancellation checkpoints for the remote coordinator."""
from __future__ import annotations

import json
import os
import signal
import time
from pathlib import Path
from types import FrameType
from typing import Callable

from .models import validate_lookup_run_id


class CancellationRequested(RuntimeError):
    def __init__(self, reason: str, checkpoint: str) -> None:
        super().__init__(f"release cancellation requested at {checkpoint}: {reason}")
        self.reason = reason
        self.checkpoint = checkpoint


class CancellationToken:
    """Read the durable control record at safe phase boundaries.

    SIGUSR1 only wakes the process and sets a latch.  A signal without the
    matching control JSON never authorizes cancellation.
    """

    def __init__(self, run_id: str, control_path: Path) -> None:
        self.run_id = validate_lookup_run_id(run_id)
        self.control_path = Path(control_path)
        self.signal_seen = False
        self._previous_handler = None

    def _handle_signal(self, _signum: int, _frame: FrameType | None) -> None:
        self.signal_seen = True

    def install(self) -> None:
        if self._previous_handler is not None:
            return
        self._previous_handler = signal.getsignal(signal.SIGUSR1)
        signal.signal(signal.SIGUSR1, self._handle_signal)

    def restore(self) -> None:
        if self._previous_handler is None:
            return
        signal.signal(signal.SIGUSR1, self._previous_handler)
        self._previous_handler = None

    def __enter__(self) -> "CancellationToken":
        self.install()
        return self

    def __exit__(self, *_args: object) -> None:
        self.restore()

    def record(self) -> dict[str, object] | None:
        if not os.path.lexists(self.control_path):
            return None
        try:
            payload = json.loads(self.control_path.read_text(encoding="utf-8"))
        except Exception as error:
            raise CancellationRequested("control record is unreadable", "control-read") from error
        if (
            not isinstance(payload, dict)
            or payload.get("version") != 1
            or payload.get("runId") != self.run_id
            or not isinstance(payload.get("reason"), str)
            or not payload["reason"].strip()
        ):
            raise CancellationRequested("control record is malformed", "control-read")
        return payload

    def checkpoint(self, name: str) -> None:
        record = self.record()
        if record is not None:
            raise CancellationRequested(str(record["reason"]), name)

    def wait(
        self,
        seconds: float,
        checkpoint: str,
        *,
        sleep: Callable[[float], None] = time.sleep,
        quantum: float = 1.0,
    ) -> None:
        deadline = time.monotonic() + max(0.0, seconds)
        while True:
            self.checkpoint(checkpoint)
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return
            sleep(min(quantum, remaining))


def token_from_environment(project: Path, run_id: str) -> CancellationToken:
    expected = Path(project) / "logs/deploy/release-runs" / f"{validate_lookup_run_id(run_id)}.control.json"
    supplied = os.environ.get("ROLLING_RELEASE_CONTROL_FILE")
    if supplied != str(expected):
        raise RuntimeError("release control path does not match the run identity")
    return CancellationToken(run_id, expected)
