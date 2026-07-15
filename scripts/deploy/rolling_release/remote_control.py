#!/usr/bin/env python3
"""Standalone remote reader and cooperative-cancel writer.

The controller sends this trusted source to ``python3 -c``.  It therefore uses
only the standard library and never assumes that the Pi5 checkout already
contains PR 4 before a just-submitted unit reaches checkout.
"""
from __future__ import annotations

import fcntl
import json
import os
import re
import stat
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence


RUN_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{2,79}$")
TERMINAL_STATES = frozenset({"success", "failed", "cancelled", "interrupted"})
UNIT_PREFIX = "raspi-release-"
UNIT_SUFFIX = ".service"
OPERATOR_CANARY_APPROVAL_CLIENT = "operator-canary-approval"
SUDO = "/usr/bin/sudo"
SYSTEMCTL = "/usr/bin/systemctl"
PYTHON = "/usr/bin/python3"


class RemoteControlError(RuntimeError):
    pass


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def validate_project(value: str) -> Path:
    if not isinstance(value, str) or not os.path.isabs(value) or os.path.normpath(value) != value:
        raise RemoteControlError("project must be a normalized absolute path")
    if "\x00" in value:
        raise RemoteControlError("project contains NUL")
    return Path(value)


def validate_run_id(value: str) -> str:
    if not isinstance(value, str) or not RUN_ID_RE.fullmatch(value):
        raise RemoteControlError("run ID contains unsupported characters")
    return value


def unit_name(run_id: str) -> str:
    return f"{UNIT_PREFIX}{validate_run_id(run_id)}{UNIT_SUFFIX}"


def paths(project: Path, run_id: str) -> tuple[Path, Path, Path]:
    directory = project / "logs/deploy/release-runs"
    return (
        directory / f"{run_id}.json",
        directory / f"{run_id}.control.json",
        directory / f"{run_id}.lock",
    )


def legacy_shell_state_path(project: Path, run_id: str) -> Path:
    return project / "logs/deploy" / f"ansible-update-{validate_run_id(run_id)}.status.json"


def read_legacy_state(path: Path, *, run_id: str, source: str) -> dict[str, Any] | None:
    state = read_json(path, run_id=run_id)
    if state is None:
        return None
    result = dict(state)
    compatibility = dict(result.get("compatibility") or {})
    compatibility.update({"legacyRunFormat": True, "source": source})
    result["compatibility"] = compatibility
    return result


def read_json(path: Path, *, run_id: str) -> dict[str, Any] | None:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return None
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise RemoteControlError(f"run record is unreadable: {path.name}") from error
    if not isinstance(payload, dict) or payload.get("runId") != run_id:
        raise RemoteControlError(f"run record identity is invalid: {path.name}")
    return payload


def read_current_state(path: Path, *, run_id: str) -> dict[str, Any] | None:
    state = read_json(path, run_id=run_id)
    if state is None:
        return None
    if state.get("version") != 1 or not isinstance(state.get("state"), str) or not state["state"]:
        raise RemoteControlError(f"current run state is malformed: {path.name}")
    return state


def read_current_control(path: Path, *, run_id: str) -> dict[str, Any] | None:
    control = read_json(path, run_id=run_id)
    if control is None:
        return None
    required = ("unitName", "requestedAt", "requestedBy", "reason")
    if (
        control.get("version") != 1
        or control.get("unitName") != unit_name(run_id)
        or any(not isinstance(control.get(field), str) or not control[field] for field in required)
        or len(control["reason"]) > 1024
        or "\x00" in control["reason"]
    ):
        raise RemoteControlError(f"current control record is malformed: {path.name}")
    return control


def atomic_json(path: Path, payload: Mapping[str, Any]) -> None:
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.", suffix=".tmp", dir=path.parent
    )
    temporary = Path(temporary_name)
    replaced = False
    try:
        os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8", closefd=True) as stream:
            descriptor = -1
            json.dump(payload, stream, ensure_ascii=False, indent=2, sort_keys=True)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        replaced = True
        flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_CLOEXEC", 0)
        directory_descriptor = os.open(path.parent, flags)
        try:
            if not stat.S_ISDIR(os.fstat(directory_descriptor).st_mode):
                raise RemoteControlError("release-run parent is not a directory")
            os.fsync(directory_descriptor)
        finally:
            os.close(directory_descriptor)
    finally:
        if descriptor >= 0:
            os.close(descriptor)
        if not replaced:
            temporary.unlink(missing_ok=True)


def open_lock(path: Path) -> int:
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    flags = os.O_RDWR | os.O_CREAT | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(path, flags, 0o600)
    if not stat.S_ISREG(os.fstat(descriptor).st_mode):
        os.close(descriptor)
        raise RemoteControlError("run lock is not a regular file")
    fcntl.flock(descriptor, fcntl.LOCK_EX)
    return descriptor


def default_run(argv: Sequence[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(list(argv), check=False, text=True, capture_output=True)


def unit_is_active(
    run_id: str,
    *,
    run_command: Callable[[Sequence[str]], Any] = default_run,
) -> bool:
    result = run_command(
        [
            SUDO,
            "-n",
            SYSTEMCTL,
            "show",
            "--no-pager",
            "--property=LoadState",
            "--property=ActiveState",
            "--",
            unit_name(run_id),
        ]
    )
    if getattr(result, "returncode", 1) != 0:
        return False
    properties: dict[str, str] = {}
    for line in str(getattr(result, "stdout", "")).splitlines():
        key, separator, value = line.partition("=")
        if separator:
            properties[key] = value
    return properties.get("LoadState") == "loaded" and properties.get("ActiveState") in {
        "active",
        "activating",
        "reloading",
        "deactivating",
    }


def snapshot(project: Path, run_id: str) -> dict[str, Any]:
    state_path, control_path, lock_path = paths(project, run_id)
    legacy_shell_path = legacy_shell_state_path(project, run_id)
    if not state_path.exists() and not control_path.exists() and not lock_path.exists():
        return {
            "state": read_legacy_state(
                legacy_shell_path,
                run_id=run_id,
                source="ansible-update-status",
            ),
            "control": None,
        }
    if not lock_path.exists():
        if control_path.exists():
            raise RemoteControlError("control record exists without its per-run lock")
        return {
            "state": read_legacy_state(
                state_path,
                run_id=run_id,
                source="unlocked-release-run-state",
            ),
            "control": None,
        }
    descriptor = open_lock(lock_path)
    try:
        return {
            "state": read_current_state(state_path, run_id=run_id),
            "control": read_current_control(control_path, run_id=run_id),
        }
    finally:
        os.close(descriptor)


def request_cancel(
    project: Path,
    run_id: str,
    reason: str,
    *,
    run_command: Callable[[Sequence[str]], Any] = default_run,
    clock: Callable[[], str] = utc_now,
) -> dict[str, Any]:
    if not isinstance(reason, str) or not reason.strip() or len(reason) > 1024 or "\x00" in reason:
        raise RemoteControlError("cancel reason must be 1-1024 non-NUL characters")
    if not unit_is_active(run_id, run_command=run_command):
        raise RemoteControlError("release unit is not active; cancellation was not recorded")

    state_path, control_path, lock_path = paths(project, run_id)
    descriptor = open_lock(lock_path)
    try:
        state = read_current_state(state_path, run_id=run_id)
        existing = read_current_control(control_path, run_id=run_id)
        if state is not None and state.get("state") in TERMINAL_STATES:
            raise RemoteControlError(
                f"release is already terminal as {state.get('state')}; cancellation was not recorded"
            )
        if existing is not None:
            return {"record": existing, "created": False}
        # Re-observe under the per-run lock so a unit that ended while the
        # request waited cannot gain a late control record.
        if not unit_is_active(run_id, run_command=run_command):
            raise RemoteControlError("release unit ended before cancellation could be recorded")
        record = {
            "version": 1,
            "runId": run_id,
            "unitName": unit_name(run_id),
            "requestedAt": clock(),
            "requestedBy": "operator-cli",
            "reason": reason.strip(),
        }
        atomic_json(control_path, record)
        return {"record": record, "created": True}
    finally:
        os.close(descriptor)


def approve(
    project: Path,
    run_id: str,
    client: str,
    *,
    run_command: Callable[[Sequence[str]], Any] = default_run,
) -> dict[str, Any]:
    """Linearize operator approval against the cooperative cancel record."""
    if client != OPERATOR_CANARY_APPROVAL_CLIENT:
        raise RemoteControlError("canary approval client is not allowed")
    if not unit_is_active(run_id, run_command=run_command):
        raise RemoteControlError("release unit is not active; approval was not recorded")

    state_path, control_path, lock_path = paths(project, run_id)
    descriptor = open_lock(lock_path)
    try:
        state = read_current_state(state_path, run_id=run_id)
        control = read_current_control(control_path, run_id=run_id)
        if state is not None and state.get("state") in TERMINAL_STATES:
            raise RemoteControlError(
                f"release is already terminal as {state.get('state')}; approval was not recorded"
            )
        if control is not None:
            raise RemoteControlError("release cancellation is already recorded; approval was not recorded")
        if not unit_is_active(run_id, run_command=run_command):
            raise RemoteControlError("release unit ended before approval could be recorded")
        result = run_command(
            [
                PYTHON,
                str(project / "scripts/deploy/deploy-status-state.py"),
                "--file",
                str(project / "config/deploy-status.json"),
                "approve",
                "--run-id",
                run_id,
                "--client",
                client,
            ]
        )
        if getattr(result, "returncode", 1) != 0:
            detail = str(getattr(result, "stderr", "") or getattr(result, "stdout", "")).strip()
            raise RemoteControlError(detail or "canary approval failed")
        return {"runId": run_id, "approved": True}
    finally:
        os.close(descriptor)


def parse_request(raw: str) -> dict[str, Any]:
    try:
        value = json.loads(raw)
    except (TypeError, json.JSONDecodeError) as error:
        raise RemoteControlError("request is not valid JSON") from error
    if not isinstance(value, dict) or value.get("action") not in {"snapshot", "cancel", "approve"}:
        raise RemoteControlError("request action is unsupported")
    allowed = {"action", "project", "runId"}
    if value["action"] == "cancel":
        allowed.add("reason")
    elif value["action"] == "approve":
        allowed.add("client")
    if set(value) != allowed:
        raise RemoteControlError("request fields are invalid")
    validate_project(value["project"])
    validate_run_id(value["runId"])
    if value["action"] == "cancel" and not isinstance(value.get("reason"), str):
        raise RemoteControlError("cancel reason is required")
    if value["action"] == "approve" and value.get("client") != OPERATOR_CANARY_APPROVAL_CLIENT:
        raise RemoteControlError("canary approval client is not allowed")
    return value


def main(argv: Sequence[str] | None = None) -> int:
    arguments = list(sys.argv[1:] if argv is None else argv)
    if len(arguments) != 1:
        print("[ERROR] remote control requires one JSON request", file=sys.stderr)
        return 78
    try:
        request = parse_request(arguments[0])
        project = validate_project(request["project"])
        run_id = validate_run_id(request["runId"])
        if request["action"] == "snapshot":
            result = snapshot(project, run_id)
        elif request["action"] == "cancel":
            result = request_cancel(project, run_id, request["reason"])
        else:
            result = approve(project, run_id, request["client"])
        print(json.dumps(result, ensure_ascii=False, sort_keys=True))
        return 0
    except RemoteControlError as error:
        print(f"[ERROR] {error}", file=sys.stderr)
        return 78


if __name__ == "__main__":
    raise SystemExit(main())
