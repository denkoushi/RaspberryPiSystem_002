"""Best-effort parsing and aggregation for rolling-release timing artifacts."""
from __future__ import annotations

import json
import os
import re
import tempfile
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

from . import safe_diagnostics

_OUTCOMES = frozenset({"ok", "changed", "skipped", "failed", "unreachable"})
_MAX_EVENTS = 10_000
_MAX_DIAGNOSTICS = 100
_MAX_BYTES = 10 * 1024 * 1024
_RUN_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{2,79}$")


def _utc_now(runtime: Any) -> str:
    clock = getattr(runtime, "utc_now", None)
    if callable(clock):
        try:
            value = clock()
            if isinstance(value, str):
                return value
        except Exception:
            pass
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


@contextmanager
def measure_phase(
    state: Any,
    runtime: Any,
    name: str,
    *,
    host: str | None = None,
    performance: bool = False,
) -> Iterator[None]:
    """Append non-authoritative timing and optional Pi5 sample boundaries."""

    performance_manager: Any = None
    if performance:
        provider = getattr(runtime, "pi5_performance_phase", None)
        if callable(provider):
            try:
                performance_manager = provider(name)
                performance_manager.__enter__()
            except Exception:
                performance_manager = None
    started_at = _utc_now(runtime)
    started = time.monotonic()
    outcome = "success"
    try:
        yield
    except BaseException as error:
        outcome = type(error).__name__
        raise
    finally:
        if performance_manager is not None:
            try:
                performance_manager.__exit__(None, None, None)
            except Exception:
                pass
        try:
            telemetry = state.payload.setdefault("telemetry", {})
            phases = telemetry.setdefault("phases", [])
            event = {
                "name": name,
                "startedAt": started_at,
                "endedAt": _utc_now(runtime),
                "durationMs": round((time.monotonic() - started) * 1000),
                "outcome": outcome,
            }
            if host is not None:
                event["host"] = host
            phases.append(event)
        except Exception:
            # Metrics must never change a release outcome.
            pass


def paths(project: Path, run_id: str) -> tuple[Path, Path]:
    if not isinstance(run_id, str) or _RUN_ID_RE.fullmatch(run_id) is None:
        raise ValueError("timing run ID is malformed")
    root = Path(project) / "logs/deploy/release-runs"
    return root / f"{run_id}.ansible-timing.jsonl", root / f"{run_id}.ansible-timing-summary.json"


def environment(project: Path, run_id: str, host: str, scope: str) -> dict[str, str]:
    raw, _summary = paths(project, run_id)
    return {
        "ROLLING_RELEASE_TIMING_PATH": str(raw),
        "ROLLING_RELEASE_TIMING_SCOPE": scope,
        "ROLLING_RELEASE_TIMING_HOST": host,
    }


def _valid_event(event: Any, run_id: str) -> bool:
    allowed_fields = {
        "schemaVersion",
        "runId",
        "scope",
        "host",
        "play",
        "task",
        "outcome",
        "startedAt",
        "endedAt",
        "durationMs",
    }
    if isinstance(event, dict) and "diagnostic" in event:
        allowed_fields.add("diagnostic")
    valid = (
        isinstance(event, dict)
        and set(event) == allowed_fields
        and event.get("schemaVersion") == 1
        and event.get("runId") == run_id
        and isinstance(event.get("scope"), str)
        and isinstance(event.get("host"), str)
        and isinstance(event.get("play"), str)
        and isinstance(event.get("task"), str)
        and event.get("outcome") in _OUTCOMES
        and isinstance(event.get("startedAt"), str)
        and isinstance(event.get("endedAt"), str)
        and isinstance(event.get("durationMs"), int)
        and 0 <= event["durationMs"] <= 24 * 60 * 60 * 1000
    )
    if not valid:
        return False
    for field in ("scope", "host", "play", "task"):
        if not safe_diagnostics.valid_binding_text(
            event.get(field), allow_empty=field == "play"
        ):
            return False
    diagnostic = event.get("diagnostic")
    return diagnostic is None or (
        event.get("outcome") == "failed"
        and safe_diagnostics.valid_diagnostic(diagnostic)
    )


def collect(project: Path, run_id: str) -> dict[str, Any]:
    raw, summary_path = paths(project, run_id)
    if not raw.is_file() or raw.is_symlink() or raw.stat().st_size > _MAX_BYTES:
        raise ValueError("timing artifact is unavailable or unsafe")
    events: list[dict[str, Any]] = []
    with raw.open(encoding="utf-8") as stream:
        for line in stream:
            if len(events) >= _MAX_EVENTS:
                raise ValueError("timing artifact exceeds event limit")
            try:
                event = json.loads(line)
            except json.JSONDecodeError as error:
                raise ValueError("timing artifact contains invalid JSON") from error
            if not _valid_event(event, run_id):
                raise ValueError("timing artifact violates its schema")
            events.append(event)
    grouped: dict[tuple[str, str, str, str], dict[str, Any]] = {}
    for event in events:
        key = (event["scope"], event["host"], event["play"], event["task"])
        record = grouped.setdefault(
            key,
            {
                "scope": key[0],
                "host": key[1],
                "play": key[2],
                "task": key[3],
                "count": 0,
                "durationMs": 0,
                "outcomes": {},
            },
        )
        record["count"] += 1
        record["durationMs"] += event["durationMs"]
        record["outcomes"][event["outcome"]] = record["outcomes"].get(event["outcome"], 0) + 1
    tasks = sorted(grouped.values(), key=lambda item: item["durationMs"], reverse=True)
    diagnostics = [
        safe_diagnostics.project_event(event, run_id)
        for event in events
        if "diagnostic" in event
    ]
    if len(diagnostics) > _MAX_DIAGNOSTICS:
        raise ValueError("timing artifact exceeds diagnostic limit")
    payload = {
        "schemaVersion": 1,
        "runId": run_id,
        "eventCount": len(events),
        "tasks": tasks,
        "diagnostics": diagnostics,
    }
    summary_path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{summary_path.name}.", suffix=".tmp", dir=summary_path.parent)
    try:
        os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            descriptor = -1
            json.dump(payload, stream, ensure_ascii=False, sort_keys=True)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary_name, summary_path)
    finally:
        if descriptor >= 0:
            os.close(descriptor)
        if os.path.exists(temporary_name):
            os.unlink(temporary_name)
    return {
        "state": "collected",
        "rawPath": str(raw),
        "summaryPath": str(summary_path),
        "eventCount": len(events),
        "slowTasks": tasks[:20],
        "diagnostics": diagnostics,
    }
