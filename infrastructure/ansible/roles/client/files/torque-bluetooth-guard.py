#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import signal
import subprocess
import time
from pathlib import Path
from typing import Any


def atomic_json(path: Path, payload: dict[str, object]) -> None:
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    try:
        temporary.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
        os.chmod(temporary, 0o644)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def valid_intent(intent_path: Path, boot_id: str, monotonic_now: float) -> tuple[bool, str]:
    try:
        payload: Any = json.loads(intent_path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return False, "INTENT_MISSING"
    except (OSError, ValueError, TypeError):
        return False, "INTENT_INVALID_JSON"
    if not isinstance(payload, dict) or payload.get("version") != 1:
        return False, "INTENT_INVALID_VERSION"
    if payload.get("bootId") != boot_id:
        return False, "INTENT_BOOT_MISMATCH"
    if not isinstance(payload.get("leaseId"), str) or not payload["leaseId"]:
        return False, "INTENT_INVALID_LEASE"
    generation = payload.get("generation")
    if not isinstance(generation, int) or isinstance(generation, bool) or generation <= 0:
        return False, "INTENT_INVALID_GENERATION"
    deadline = payload.get("validUntilMonotonic")
    if not isinstance(deadline, (int, float)) or isinstance(deadline, bool):
        return False, "INTENT_INVALID_DEADLINE"
    if float(deadline) <= monotonic_now:
        return False, "INTENT_EXPIRED"
    return True, "LEASE_INTENT_VALID"


class Guard:
    def __init__(
        self,
        *,
        helper: Path,
        runtime_directory: Path,
        boot_id_path: Path,
        poll_seconds: float,
        command_timeout_seconds: float,
    ) -> None:
        self.helper = helper
        self.runtime_directory = runtime_directory
        self.intent_path = runtime_directory / "intent.json"
        self.status_path = runtime_directory / "status.json"
        self.boot_id = boot_id_path.read_text(encoding="utf-8").strip()
        self.poll_seconds = poll_seconds
        self.command_timeout_seconds = command_timeout_seconds
        self.running = True
        if not self.boot_id:
            raise ValueError("kernel boot ID is unavailable")

    def stop(self, _signum: int, _frame: object) -> None:
        self.running = False

    def helper_json(self, operation: str) -> dict[str, Any]:
        completed = subprocess.run(
            [str(self.helper), operation],
            text=True,
            capture_output=True,
            check=False,
            timeout=self.command_timeout_seconds,
        )
        if completed.returncode != 0:
            detail = " ".join(completed.stderr.split())[:240]
            raise RuntimeError(f"{operation} failed ({completed.returncode}): {detail}")
        status = subprocess.run(
            [str(self.helper), "--status"],
            text=True,
            capture_output=True,
            check=False,
            timeout=self.command_timeout_seconds,
        )
        if status.returncode != 0:
            detail = " ".join(status.stderr.split())[:240]
            raise RuntimeError(f"--status failed ({status.returncode}): {detail}")
        payload = json.loads(status.stdout)
        if not isinstance(payload, dict) or not isinstance(payload.get("controller"), str):
            raise RuntimeError("--status returned an invalid payload")
        return payload

    def apply(self, powered: bool, reason: str) -> bool | None:
        actual_powered: bool | None = None
        try:
            status = self.helper_json("--power-on" if powered else "--power-off")
            actual_powered = status.get("powered") is True
            if actual_powered != powered:
                raise RuntimeError("controller power did not reach the requested fail-closed state")
            payload: dict[str, object] = {
                "version": 1,
                "bootId": self.boot_id,
                "powered": actual_powered,
                "controller": status["controller"],
                "reason": reason,
                "updatedAtMonotonic": time.monotonic(),
            }
        except (OSError, ValueError, RuntimeError, subprocess.TimeoutExpired) as error:
            payload = {
                "version": 1,
                "bootId": self.boot_id,
                "powered": False,
                "controller": None,
                "reason": "HELPER_FAILURE",
                "error": str(error)[:500],
                "updatedAtMonotonic": time.monotonic(),
            }
        atomic_json(self.status_path, payload)
        return actual_powered

    def reconcile(self, current_powered: bool | None, monotonic_now: float) -> bool | None:
        allowed, reason = valid_intent(self.intent_path, self.boot_id, monotonic_now)
        if current_powered is None or allowed != current_powered:
            return self.apply(allowed, reason)
        return current_powered

    def run(self) -> None:
        self.runtime_directory.mkdir(parents=True, exist_ok=True)
        os.chmod(self.runtime_directory, 0o755)
        current_powered = self.apply(False, "GUARD_STARTUP")
        while self.running:
            current_powered = self.reconcile(current_powered, time.monotonic())
            time.sleep(self.poll_seconds)
        self.apply(False, "GUARD_STOPPED")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--helper", type=Path, default=Path("/usr/local/libexec/torque-bluetooth-adapter"))
    parser.add_argument("--runtime-directory", type=Path, default=Path("/run/torque-bluetooth-guard"))
    parser.add_argument("--boot-id", type=Path, default=Path("/proc/sys/kernel/random/boot_id"))
    parser.add_argument("--poll-seconds", type=float, default=1.0)
    parser.add_argument("--command-timeout-seconds", type=float, default=8.0)
    args = parser.parse_args()
    if args.poll_seconds <= 0 or args.poll_seconds > 1:
        raise SystemExit("poll interval must be in (0, 1]")
    guard = Guard(
        helper=args.helper,
        runtime_directory=args.runtime_directory,
        boot_id_path=args.boot_id,
        poll_seconds=args.poll_seconds,
        command_timeout_seconds=args.command_timeout_seconds,
    )
    signal.signal(signal.SIGTERM, guard.stop)
    signal.signal(signal.SIGINT, guard.stop)
    guard.run()


if __name__ == "__main__":
    main()
