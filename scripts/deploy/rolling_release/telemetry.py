"""Best-effort parsing and aggregation for rolling-release timing artifacts."""
from __future__ import annotations

import json
import os
import re
import tempfile
from pathlib import Path
from typing import Any

_OUTCOMES = frozenset({"ok", "changed", "skipped", "failed", "unreachable"})
_MAX_EVENTS = 10_000
_MAX_BYTES = 10 * 1024 * 1024
_RUN_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{2,79}$")
_BOOTSTRAP_STATUSES = frozenset({"running", "changed", "current", "failed"})
_BOOTSTRAP_CLEANUP = frozenset({"pending", "complete", "failed"})
_BOOTSTRAP_PHASES = frozenset(
    {
        "initializing",
        "host-preflight",
        "lock-validate",
        "staging-prepare",
        "python-download",
        "python-extract",
        "python-packages",
        "collection-download",
        "collection-install",
        "runtime-verify",
        "runtime-publish",
        "active-link",
        "cleanup",
        "complete",
        "internal",
    }
)
_BOOTSTRAP_FAILURES = frozenset(
    {
        "host-ineligible",
        "lock-invalid",
        "requirements-missing",
        "staging-preparation-failed",
        "python-download-failed",
        "python-extract-failed",
        "python-packages-failed",
        "collection-download-failed",
        "collection-install-failed",
        "runtime-verification-failed",
        "runtime-publish-conflict",
        "active-link-failed",
        "cleanup-failed",
        "internal-error",
    }
)
_ATTEMPT_RE = re.compile(r"^[0-9a-f]{32}$")
_SHA256_RE = re.compile(r"^sha256:[0-9a-f]{64}$")


def _valid_bootstrap_observation(value: Any) -> bool:
    return (
        isinstance(value, dict)
        and set(value)
        == {"status", "phase", "failureCode", "cleanup", "attemptId", "lockSha256"}
        and value.get("status") in _BOOTSTRAP_STATUSES
        and value.get("phase") in _BOOTSTRAP_PHASES
        and (
            value.get("failureCode") is None
            or (
                value.get("failureCode") in _BOOTSTRAP_FAILURES
            )
        )
        and value.get("cleanup") in _BOOTSTRAP_CLEANUP
        and isinstance(value.get("attemptId"), str)
        and _ATTEMPT_RE.fullmatch(value["attemptId"]) is not None
        and (
            value.get("lockSha256") is None
            or (
                isinstance(value.get("lockSha256"), str)
                and _SHA256_RE.fullmatch(value["lockSha256"]) is not None
            )
        )
        and (
            value.get("status") == "failed"
            if value.get("failureCode") is not None
            else value.get("status") != "failed"
        )
        and (
            value.get("cleanup") != "pending"
            if value.get("status") == "failed"
            else True
        )
        and not (
            value.get("status") == "failed" and value.get("phase") == "complete"
        )
        and (
            value.get("phase") == "complete"
            and value.get("cleanup") == "complete"
            and value.get("lockSha256") is not None
            if value.get("status") in {"changed", "current"}
            else True
        )
        and (
            value.get("cleanup") == "pending"
            if value.get("status") == "running"
            else True
        )
    )


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
    return (
        isinstance(event, dict)
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
        and (
            "bootstrapObservation" not in event
            or _valid_bootstrap_observation(event["bootstrapObservation"])
        )
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
    bootstrap_observations: list[dict[str, Any]] = []
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
        if "bootstrapObservation" in event:
            bootstrap_observations.append(
                {
                    "scope": event["scope"],
                    "host": event["host"],
                    **event["bootstrapObservation"],
                }
            )
    tasks = sorted(grouped.values(), key=lambda item: item["durationMs"], reverse=True)
    payload = {
        "schemaVersion": 1,
        "runId": run_id,
        "eventCount": len(events),
        "tasks": tasks,
        "bootstrapObservations": bootstrap_observations,
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
        "bootstrapObservations": bootstrap_observations,
    }
