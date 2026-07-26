"""Best-effort Pi5 release performance sampling and aggregation.

The sampler is deliberately non-authoritative.  It records only a fixed local
health probe and bounded host resource counters; failures never participate in
release health, rollback, or completion decisions.
"""
from __future__ import annotations

import json
import math
import os
import queue
import re
import socket
import ssl
import stat
import tempfile
import threading
import time
import urllib.error
import urllib.request
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from statistics import fmean, median
from typing import Any, Callable, Iterator


HEALTH_URL = "https://127.0.0.1/api/system/health"
SAMPLE_INTERVAL_SECONDS = 2.0
HEALTH_TIMEOUT_SECONDS = 2.0
BASELINE_SECONDS = 30.0
MAX_EVENTS = 10_000
MAX_BYTES = 10 * 1024 * 1024
PHASES = (
    "pi5-baseline",
    "server-config-apply",
    "pi5-migration-plan",
    "pi5-candidate-build",
    "pi5-inactive-slot-prepare",
    "pi5-traffic-switch",
    "pi5-stability-monitor",
    "pi5-cleanup",
    "pi5-evidence",
)
_PHASE_SET = frozenset((*PHASES, "unclassified"))
_TRIGGERS = frozenset({"periodic", "phase-start", "phase-end"})
_OUTCOMES = frozenset({"success", "http-error", "timeout", "network-error"})
_RUN_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{2,79}$")
_STOP = object()


def _utc_now() -> str:
    return (
        datetime.now(timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )


def paths(project: Path, run_id: str) -> tuple[Path, Path]:
    if not isinstance(run_id, str) or _RUN_ID_RE.fullmatch(run_id) is None:
        raise ValueError("Pi5 performance run ID is malformed")
    root = Path(project) / "logs/deploy/release-runs"
    return (
        root / f"{run_id}.pi5-performance.jsonl",
        root / f"{run_id}.pi5-performance-summary.json",
    )


def _safe_number(value: Any, *, minimum: float = 0.0) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    number = float(value)
    if not math.isfinite(number) or number < minimum:
        return None
    return round(number, 3)


def _read_load1() -> float | None:
    try:
        value = Path("/proc/loadavg").read_text(encoding="ascii").split()[0]
        return _safe_number(float(value))
    except (OSError, ValueError, IndexError):
        return None


def _read_available_memory_mb() -> float | None:
    try:
        for line in Path("/proc/meminfo").read_text(encoding="ascii").splitlines():
            if line.startswith("MemAvailable:"):
                kibibytes = float(line.split()[1])
                return _safe_number(kibibytes / 1024)
    except (OSError, ValueError, IndexError):
        pass
    return None


def _read_pressure_avg10(resource: str) -> float | None:
    try:
        lines = (
            Path("/proc/pressure") / resource
        ).read_text(encoding="ascii").splitlines()
        some = next(line for line in lines if line.startswith("some "))
        field = next(item for item in some.split() if item.startswith("avg10="))
        return _safe_number(float(field.split("=", 1)[1]))
    except (OSError, StopIteration, ValueError, IndexError):
        return None


def read_resources() -> dict[str, float | None]:
    return {
        "load1": _read_load1(),
        "memoryAvailableMb": _read_available_memory_mb(),
        "cpuPressureAvg10": _read_pressure_avg10("cpu"),
        "ioPressureAvg10": _read_pressure_avg10("io"),
    }


def probe_health() -> dict[str, Any]:
    started = time.monotonic()
    request = urllib.request.Request(
        HEALTH_URL,
        headers={"Accept": "application/json"},
        method="GET",
    )
    context = ssl.create_default_context()
    context.check_hostname = False
    context.verify_mode = ssl.CERT_NONE
    status: int | None = None
    outcome = "network-error"
    try:
        with urllib.request.urlopen(
            request,
            timeout=HEALTH_TIMEOUT_SECONDS,
            context=context,
        ) as response:
            status = int(response.status)
            while response.read(64 * 1024):
                pass
            outcome = "success" if status == 200 else "http-error"
    except urllib.error.HTTPError as error:
        status = int(error.code)
        outcome = "http-error"
    except (TimeoutError, socket.timeout):
        outcome = "timeout"
    except (OSError, urllib.error.URLError, ValueError):
        outcome = "network-error"
    return {
        "outcome": outcome,
        "status": status,
        "durationMs": max(0, round((time.monotonic() - started) * 1000)),
    }


def sample_event(
    run_id: str,
    phase: str,
    trigger: str,
    *,
    clock: Callable[[], str] = _utc_now,
    health_probe: Callable[[], dict[str, Any]] = probe_health,
    resource_reader: Callable[[], dict[str, float | None]] = read_resources,
) -> dict[str, Any]:
    if _RUN_ID_RE.fullmatch(run_id) is None:
        raise ValueError("Pi5 performance run ID is malformed")
    if phase not in _PHASE_SET or trigger not in _TRIGGERS:
        raise ValueError("Pi5 performance sample labels are malformed")
    try:
        api = health_probe()
    except Exception:
        api = {"outcome": "network-error", "status": None, "durationMs": 0}
    try:
        resources = resource_reader()
    except Exception:
        resources = {}
    outcome = api.get("outcome")
    status_value = api.get("status")
    status = (
        status_value
        if isinstance(status_value, int)
        and not isinstance(status_value, bool)
        and 100 <= status_value <= 599
        else None
    )
    duration_value = api.get("durationMs")
    duration = (
        duration_value
        if isinstance(duration_value, int)
        and not isinstance(duration_value, bool)
        and 0 <= duration_value <= 60_000
        else 0
    )
    if outcome not in _OUTCOMES:
        outcome = "network-error"
        status = None
    return {
        "schemaVersion": 1,
        "runId": run_id,
        "timestamp": clock(),
        "phase": phase,
        "trigger": trigger,
        "api": {
            "outcome": outcome,
            "status": status,
            "durationMs": duration,
        },
        "resources": {
            field: _safe_number(resources.get(field))
            for field in (
                "load1",
                "memoryAvailableMb",
                "cpuPressureAvg10",
                "ioPressureAvg10",
            )
        },
    }


def _prepare_raw_path(project: Path, run_id: str) -> tuple[int, Path, Path]:
    raw, summary = paths(project, run_id)
    root = raw.parent
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    if root.is_symlink() or not root.is_dir():
        raise ValueError("Pi5 performance artifact directory is unsafe")
    for target in (raw, summary):
        if target.is_symlink():
            raise ValueError("Pi5 performance artifact path is unsafe")
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(raw, flags, 0o600)
    os.fchmod(descriptor, 0o600)
    return descriptor, raw, summary


class Recorder:
    """Background sampler with non-blocking phase-boundary requests."""

    def __init__(
        self,
        project: Path,
        run_id: str,
        *,
        interval_seconds: float = SAMPLE_INTERVAL_SECONDS,
        health_probe: Callable[[], dict[str, Any]] = probe_health,
        resource_reader: Callable[[], dict[str, float | None]] = read_resources,
        clock: Callable[[], str] = _utc_now,
    ) -> None:
        if interval_seconds <= 0:
            raise ValueError("Pi5 performance sample interval must be positive")
        self.run_id = run_id
        self._descriptor, self.raw_path, self.summary_path = _prepare_raw_path(
            project, run_id
        )
        self._interval = interval_seconds
        self._health_probe = health_probe
        self._resource_reader = resource_reader
        self._clock = clock
        self._phase = "unclassified"
        self._phase_lock = threading.Lock()
        self._write_lock = threading.Lock()
        self._requests: queue.Queue[object] = queue.Queue()
        self._event_count = 0
        self._byte_count = 0
        self._sampling_error: str | None = None
        self._thread = threading.Thread(
            target=self._run,
            name=f"pi5-performance-{run_id}",
            daemon=True,
        )
        try:
            self._thread.start()
        except BaseException:
            os.close(self._descriptor)
            raise

    def _current_phase(self) -> str:
        with self._phase_lock:
            return self._phase

    def _request(self, phase: str, trigger: str) -> None:
        self._requests.put((phase, trigger))

    def _write_sample(self, phase: str, trigger: str) -> None:
        if self._sampling_error is not None:
            return
        event = sample_event(
            self.run_id,
            phase,
            trigger,
            clock=self._clock,
            health_probe=self._health_probe,
            resource_reader=self._resource_reader,
        )
        encoded = (
            json.dumps(event, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
            + "\n"
        ).encode("utf-8")
        with self._write_lock:
            if self._event_count >= MAX_EVENTS:
                self._sampling_error = "EventLimitExceeded"
                return
            if self._byte_count + len(encoded) > MAX_BYTES:
                self._sampling_error = "ByteLimitExceeded"
                return
            try:
                remaining = memoryview(encoded)
                while remaining:
                    written = os.write(self._descriptor, remaining)
                    if written <= 0:
                        raise OSError("short Pi5 performance artifact write")
                    remaining = remaining[written:]
            except OSError:
                self._sampling_error = "WriteError"
                return
            self._event_count += 1
            self._byte_count += len(encoded)

    def _run(self) -> None:
        deadline = time.monotonic() + self._interval
        try:
            while True:
                timeout = max(0.0, deadline - time.monotonic())
                try:
                    request = self._requests.get(timeout=timeout)
                except queue.Empty:
                    self._write_sample(self._current_phase(), "periodic")
                    deadline += self._interval
                    if deadline <= time.monotonic():
                        deadline = time.monotonic() + self._interval
                    continue
                if request is _STOP:
                    return
                phase, trigger = request
                self._write_sample(str(phase), str(trigger))
        except Exception:
            self._sampling_error = "SamplerError"

    @contextmanager
    def phase(self, name: str) -> Iterator[None]:
        if name not in PHASES:
            raise ValueError("Pi5 performance phase is malformed")
        with self._phase_lock:
            previous = self._phase
            self._phase = name
        self._request(name, "phase-start")
        try:
            yield
        finally:
            self._request(name, "phase-end")
            with self._phase_lock:
                self._phase = previous

    def baseline(self, seconds: float = BASELINE_SECONDS) -> None:
        if seconds < 0:
            raise ValueError("Pi5 performance baseline duration is malformed")
        with self.phase("pi5-baseline"):
            time.sleep(seconds)

    def finish(self, project: Path) -> dict[str, Any]:
        self._requests.put(_STOP)
        self._thread.join(timeout=HEALTH_TIMEOUT_SECONDS + 10)
        if self._thread.is_alive():
            self._sampling_error = "SamplerStopTimeout"
        try:
            os.fsync(self._descriptor)
        finally:
            os.close(self._descriptor)
        result = collect(project, self.run_id)
        if self._sampling_error is not None:
            result["samplingError"] = self._sampling_error
        return result


def _valid_api(value: Any) -> bool:
    if not isinstance(value, dict) or set(value) != {
        "outcome",
        "status",
        "durationMs",
    }:
        return False
    status = value["status"]
    return (
        value["outcome"] in _OUTCOMES
        and (
            status is None
            or (
                isinstance(status, int)
                and not isinstance(status, bool)
                and 100 <= status <= 599
            )
        )
        and isinstance(value["durationMs"], int)
        and not isinstance(value["durationMs"], bool)
        and 0 <= value["durationMs"] <= 60_000
    )


def _valid_resources(value: Any) -> bool:
    expected = {
        "load1",
        "memoryAvailableMb",
        "cpuPressureAvg10",
        "ioPressureAvg10",
    }
    return (
        isinstance(value, dict)
        and set(value) == expected
        and all(item is None or _safe_number(item) is not None for item in value.values())
    )


def _valid_event(event: Any, run_id: str) -> bool:
    return (
        isinstance(event, dict)
        and set(event)
        == {
            "schemaVersion",
            "runId",
            "timestamp",
            "phase",
            "trigger",
            "api",
            "resources",
        }
        and event.get("schemaVersion") == 1
        and event.get("runId") == run_id
        and isinstance(event.get("timestamp"), str)
        and event.get("phase") in _PHASE_SET
        and event.get("trigger") in _TRIGGERS
        and _valid_api(event.get("api"))
        and _valid_resources(event.get("resources"))
    )


def _nearest_rank(values: list[int], percentile: float) -> int | None:
    if not values:
        return None
    ordered = sorted(values)
    rank = max(1, math.ceil(percentile * len(ordered)))
    return ordered[rank - 1]


def _number_stats(values: list[float]) -> dict[str, float | None]:
    if not values:
        return {"average": None, "minimum": None, "maximum": None}
    return {
        "average": round(fmean(values), 3),
        "minimum": round(min(values), 3),
        "maximum": round(max(values), 3),
    }


def _phase_summary(name: str, events: list[dict[str, Any]]) -> dict[str, Any]:
    durations = [event["api"]["durationMs"] for event in events]
    successful = [
        event
        for event in events
        if event["api"]["outcome"] == "success" and event["api"]["status"] == 200
    ]
    return {
        "name": name,
        "sampleCount": len(events),
        "api": {
            "successCount": len(successful),
            "errorCount": len(events) - len(successful),
            "medianMs": round(median(durations), 3) if durations else None,
            "p95Ms": _nearest_rank(durations, 0.95),
            "maxMs": max(durations) if durations else None,
        },
        "resources": {
            field: _number_stats(
                [
                    event["resources"][field]
                    for event in events
                    if event["resources"][field] is not None
                ]
            )
            for field in (
                "load1",
                "memoryAvailableMb",
                "cpuPressureAvg10",
                "ioPressureAvg10",
            )
        },
    }


def _assessment(
    baseline: dict[str, Any] | None,
    phase: dict[str, Any],
) -> dict[str, Any]:
    baseline_api = baseline.get("api") if isinstance(baseline, dict) else None
    phase_api = phase["api"]
    if (
        not isinstance(baseline_api, dict)
        or baseline_api.get("successCount", 0) < 10
        or baseline_api.get("p95Ms") is None
        or phase["sampleCount"] == 0
        or phase_api["p95Ms"] is None
    ):
        return {"state": "insufficient-data", "degraded": None}
    baseline_p95 = baseline_api["p95Ms"]
    phase_p95 = phase_api["p95Ms"]
    latency_degraded = (
        phase_p95 >= baseline_p95 * 2 and phase_p95 - baseline_p95 >= 100
    )
    errors = phase_api["errorCount"] > 0
    return {
        "state": "evaluated",
        "degraded": latency_degraded or errors,
        "latencyThresholdExceeded": latency_degraded,
        "errorsObserved": errors,
        "baselineP95Ms": baseline_p95,
        "phaseP95Ms": phase_p95,
    }


def _write_summary(path: Path, payload: dict[str, Any]) -> None:
    if path.is_symlink():
        raise ValueError("Pi5 performance summary path is unsafe")
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.",
        suffix=".tmp",
        dir=path.parent,
    )
    try:
        os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            descriptor = -1
            json.dump(payload, stream, ensure_ascii=False, sort_keys=True)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary_name, path)
        mode = stat.S_IMODE(path.stat().st_mode)
        if mode != 0o600:
            raise ValueError("Pi5 performance summary permissions are unsafe")
    finally:
        if descriptor >= 0:
            os.close(descriptor)
        if os.path.exists(temporary_name):
            os.unlink(temporary_name)


def collect(project: Path, run_id: str) -> dict[str, Any]:
    raw, summary_path = paths(project, run_id)
    if raw.is_symlink() or not raw.is_file() or raw.stat().st_size > MAX_BYTES:
        raise ValueError("Pi5 performance artifact is unavailable or unsafe")
    if stat.S_IMODE(raw.stat().st_mode) != 0o600:
        raise ValueError("Pi5 performance artifact permissions are unsafe")
    events: list[dict[str, Any]] = []
    with raw.open(encoding="utf-8") as stream:
        for line in stream:
            if len(events) >= MAX_EVENTS:
                raise ValueError("Pi5 performance artifact exceeds event limit")
            try:
                event = json.loads(line)
            except json.JSONDecodeError as error:
                raise ValueError(
                    "Pi5 performance artifact contains invalid JSON"
                ) from error
            if not _valid_event(event, run_id):
                raise ValueError("Pi5 performance artifact violates its schema")
            events.append(event)
    grouped = {
        phase: [event for event in events if event["phase"] == phase]
        for phase in PHASES
    }
    phases = [_phase_summary(phase, grouped[phase]) for phase in PHASES]
    baseline = next(phase for phase in phases if phase["name"] == "pi5-baseline")
    assessments = [
        {"name": phase["name"], **_assessment(baseline, phase)}
        for phase in phases
        if phase["name"] != "pi5-baseline"
    ]
    payload = {
        "schemaVersion": 1,
        "runId": run_id,
        "sampleIntervalSeconds": SAMPLE_INTERVAL_SECONDS,
        "eventCount": len(events),
        "phases": phases,
        "assessments": assessments,
    }
    _write_summary(summary_path, payload)
    return {
        "state": "collected",
        "rawPath": str(raw),
        "summaryPath": str(summary_path),
        "eventCount": len(events),
        "phases": phases,
        "assessments": assessments,
    }
