#!/usr/bin/env python3
"""Fail-closed local peripheral health collection with episode state.

Only sanitized health facts cross this module boundary. Agent responses,
endpoint URLs, NFC identifiers, and credentials are never persisted or sent.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import tempfile
import urllib.error
import urllib.request
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Dict, Mapping, Optional


DEFAULT_STATE_FILE = Path("/run/raspi-status-agent/terminal-agent-health.json")
DEFAULT_TIMEOUT_SECONDS = 3.0
FAILURE_THRESHOLD = 2


@dataclass(frozen=True)
class SignalObservation:
    agent: str
    signal: str
    healthy: bool
    severity: str
    queue_size: Optional[int] = None


@dataclass(frozen=True)
class AgentSpec:
    enabled_key: str
    endpoint: str
    signals: tuple[str, ...]


AGENTS: Mapping[str, AgentSpec] = {
    "nfc": AgentSpec(
        "TERMINAL_AGENT_HEALTH_NFC_ENABLED",
        "http://127.0.0.1:7071/api/agent/status",
        ("endpoint", "reader", "queue"),
    ),
    "barcode": AgentSpec(
        "TERMINAL_AGENT_HEALTH_BARCODE_ENABLED",
        "http://127.0.0.1:7072/api/agent/status",
        ("endpoint", "reader"),
    ),
    "torque": AgentSpec(
        "TERMINAL_AGENT_HEALTH_TORQUE_ENABLED",
        "http://127.0.0.1:7073/health",
        ("endpoint", "runtime"),
    ),
}

LogEntry = Dict[str, object]
Probe = Callable[[str, float], Mapping[str, object]]


def is_truthy(value: object) -> bool:
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}


def observed_at_iso(now: Optional[dt.datetime] = None) -> str:
    current = now or dt.datetime.now(dt.timezone.utc)
    if current.tzinfo is None:
        current = current.replace(tzinfo=dt.timezone.utc)
    return current.astimezone(dt.timezone.utc).isoformat()


def state_path(config: Mapping[str, str]) -> Path:
    return Path(
        config.get("TERMINAL_AGENT_HEALTH_STATE_FILE") or str(DEFAULT_STATE_FILE)
    ).expanduser()


def load_state(path: Path) -> dict[str, object]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, UnicodeError):
        return {"schemaVersion": 1, "signals": {}}
    if (
        not isinstance(value, dict)
        or value.get("schemaVersion") != 1
        or not isinstance(value.get("signals"), dict)
    ):
        return {"schemaVersion": 1, "signals": {}}
    return value


def save_state(path: Path, state: Mapping[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(
        state, ensure_ascii=True, sort_keys=True, separators=(",", ":"), allow_nan=False
    )
    file_descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.", dir=path.parent
    )
    try:
        with os.fdopen(file_descriptor, "w", encoding="utf-8") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_name, path)
    finally:
        try:
            os.unlink(temporary_name)
        except FileNotFoundError:
            pass


def _http_probe(endpoint: str, timeout: float) -> Mapping[str, object]:
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    request = urllib.request.Request(
        endpoint, headers={"Accept": "application/json"}, method="GET"
    )
    with opener.open(request, timeout=timeout) as response:
        if response.status != 200:
            raise RuntimeError("agent endpoint returned a non-success status")
        body = response.read(64 * 1024 + 1)
    if len(body) > 64 * 1024:
        raise RuntimeError("agent endpoint response is too large")
    value = json.loads(body.decode("utf-8"))
    if not isinstance(value, dict):
        raise RuntimeError("agent endpoint response is malformed")
    return value


def evaluate_agent(agent: str, payload: Mapping[str, object]) -> list[SignalObservation]:
    if agent == "nfc":
        reader_healthy = payload.get("readerConnected") is True
        queue_size = payload.get("queueSize")
        queue_healthy = (
            not isinstance(queue_size, bool)
            and isinstance(queue_size, int)
            and queue_size == 0
        )
        return [
            SignalObservation(agent, "endpoint", True, "ERROR"),
            SignalObservation(agent, "reader", reader_healthy, "ERROR"),
            SignalObservation(
                agent,
                "queue",
                queue_healthy,
                "WARN",
                queue_size if isinstance(queue_size, int) and not isinstance(queue_size, bool) else None,
            ),
        ]
    if agent == "barcode":
        return [
            SignalObservation(agent, "endpoint", True, "ERROR"),
            SignalObservation(
                agent, "reader", payload.get("readerConnected") is True, "ERROR"
            ),
        ]
    if agent == "torque":
        return [
            SignalObservation(agent, "endpoint", True, "ERROR"),
            SignalObservation(agent, "runtime", payload.get("ok") is True, "ERROR"),
        ]
    raise ValueError("unknown terminal agent")


def probe_agent(
    agent: str,
    *,
    probe: Probe = _http_probe,
    timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS,
) -> list[SignalObservation]:
    spec = AGENTS[agent]
    try:
        payload = probe(spec.endpoint, timeout_seconds)
        return evaluate_agent(agent, payload)
    except (OSError, TimeoutError, ValueError, RuntimeError, urllib.error.URLError):
        return [SignalObservation(agent, "endpoint", False, "ERROR")]


def _signal_key(observation: SignalObservation) -> str:
    return f"{observation.agent}:{observation.signal}"


def _log_entry(
    observation: SignalObservation,
    *,
    episode_id: str,
    observed_at: str,
    consecutive_failures: int,
    recovery: bool,
) -> LogEntry:
    severity = "INFO" if recovery else observation.severity
    action = "recovery" if recovery else "unhealthy"
    context: Dict[str, object] = {
        "category": "terminal_agent_health",
        "agent": observation.agent,
        "signal": observation.signal,
        "severity": severity,
        "episodeId": episode_id,
        "observedAt": observed_at,
        "consecutiveFailures": consecutive_failures,
        "action": action,
    }
    if observation.signal == "queue" and observation.queue_size is not None:
        context["queueSize"] = observation.queue_size
    return {
        "level": severity,
        "message": (
            f"Terminal agent recovered: {observation.agent}/{observation.signal}"
            if recovery
            else f"Terminal agent unhealthy: {observation.agent}/{observation.signal}"
        ),
        "context": context,
    }


def collect_logs(
    config: Mapping[str, str],
    *,
    probe: Probe = _http_probe,
    now: Optional[dt.datetime] = None,
) -> list[LogEntry]:
    if not any(
        is_truthy(config.get(spec.enabled_key)) for spec in AGENTS.values()
    ):
        return []
    path = state_path(config)
    state = load_state(path)
    signals = dict(state["signals"])
    logs: list[LogEntry] = []
    observed_at = observed_at_iso(now)

    for agent, spec in AGENTS.items():
        if not is_truthy(config.get(spec.enabled_key)):
            continue
        for observation in probe_agent(agent, probe=probe):
            key = _signal_key(observation)
            previous = signals.get(key)
            previous_record = previous if isinstance(previous, dict) else {}
            previous_count = int(previous_record.get("consecutiveFailures", 0))
            episode_id = str(previous_record.get("episodeId") or uuid.uuid4())
            alert_emitted = previous_record.get("alertEmitted") is True
            recovery_pending = previous_record.get("recoveryPending") is True

            if observation.healthy:
                if recovery_pending:
                    logs.append(
                        _log_entry(
                            observation,
                            episode_id=episode_id,
                            observed_at=observed_at,
                            consecutive_failures=previous_count,
                            recovery=True,
                        )
                    )
                    continue
                if previous_count > 0 and alert_emitted:
                    signals[key] = {
                        "episodeId": episode_id,
                        "consecutiveFailures": previous_count,
                        "alertEmitted": True,
                        "recoveryPending": True,
                    }
                    logs.append(
                        _log_entry(
                            observation,
                            episode_id=episode_id,
                            observed_at=observed_at,
                            consecutive_failures=previous_count,
                            recovery=True,
                        )
                    )
                else:
                    signals.pop(key, None)
                continue

            count = previous_count + 1
            signals[key] = {
                "episodeId": episode_id,
                "consecutiveFailures": count,
                "alertEmitted": alert_emitted,
                "recoveryPending": False,
            }
            if count >= FAILURE_THRESHOLD and not alert_emitted:
                logs.append(
                    _log_entry(
                        observation,
                        episode_id=episode_id,
                        observed_at=observed_at,
                        consecutive_failures=count,
                        recovery=False,
                    )
                )

    save_state(path, {"schemaVersion": 1, "signals": signals})
    return logs


def mark_logs_delivered(config: Mapping[str, str], logs: list[object]) -> None:
    path = state_path(config)
    state = load_state(path)
    signals = dict(state["signals"])
    changed = False
    for entry in logs:
        if not isinstance(entry, dict):
            continue
        context = entry.get("context")
        if not isinstance(context, dict) or context.get("category") != "terminal_agent_health":
            continue
        agent = context.get("agent")
        signal = context.get("signal")
        episode_id = context.get("episodeId")
        action = context.get("action")
        if not all(isinstance(value, str) for value in (agent, signal, episode_id, action)):
            continue
        key = f"{agent}:{signal}"
        current = signals.get(key)
        if not isinstance(current, dict) or current.get("episodeId") != episode_id:
            continue
        if action == "recovery":
            signals.pop(key, None)
        elif action == "unhealthy":
            current = dict(current)
            current["alertEmitted"] = True
            signals[key] = current
        else:
            continue
        changed = True
    if changed:
        save_state(path, {"schemaVersion": 1, "signals": signals})
