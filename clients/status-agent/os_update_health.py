#!/usr/bin/env python3
"""Sanitized OS security update health with delivery-aware episode tracking."""
from __future__ import annotations

import datetime as dt
import json
import logging
import os
import re
import tempfile
import uuid
from pathlib import Path
from typing import Mapping, Optional


DEFAULT_STATE_FILE = Path("/var/lib/raspi-os-security-update/state.json")
DEFAULT_HEALTH_STATE_FILE = Path("/run/raspi-status-agent/os-update-health.json")
DEFAULT_STALE_DAYS = 15
RETRY_INTERVAL = dt.timedelta(hours=24)
FAILED_SIGNAL = "os_security_update_failed"
STALE_SIGNAL = "os_security_updates_stale"
REASON_CODE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,79}$")
RESULTS = {"pending", "success", "failed", "skipped_locked", "skipped_window", "skipped_release"}
LogEntry = dict[str, object]


def _timestamp(value: object) -> Optional[dt.datetime]:
    if not isinstance(value, str):
        return None
    try:
        parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed.astimezone(dt.timezone.utc) if parsed.tzinfo else None
    except (ValueError, OverflowError):
        return None


def state_path(config: Mapping[str, str]) -> Path:
    return Path(config.get("OS_SECURITY_UPDATE_HEALTH_STATE_FILE") or str(DEFAULT_HEALTH_STATE_FILE)).expanduser()


def load_state(path: Path) -> dict[str, object]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(value, dict) and value.get("schemaVersion") == 1 and isinstance(value.get("signals"), dict):
            return value
    except (OSError, ValueError, UnicodeError):
        pass
    return {"schemaVersion": 1, "signals": {}}


def save_state(path: Path, state: Mapping[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(state, handle, ensure_ascii=True, sort_keys=True, allow_nan=False)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_name, path)
    finally:
        try:
            os.unlink(temporary_name)
        except FileNotFoundError:
            pass


def _log_entry(signal: str, record: Mapping[str, object], update: Mapping[str, object], observed_at: str, recovery: bool) -> LogEntry:
    action = "recovery" if recovery else "unhealthy"
    last_success = _timestamp(update.get("lastSuccessAt"))
    context: dict[str, object] = {
        "category": "os_update_health",
        "action": action,
        "signal": signal,
        "episodeId": record["episodeId"],
        "observedAt": observed_at,
        "mode": update["mode"],
        "lastSuccessAt": last_success.isoformat() if last_success else None,
    }
    reason = update.get("reason")
    if signal == FAILED_SIGNAL and not recovery and isinstance(reason, str) and REASON_CODE.fullmatch(reason):
        context["reason"] = reason
    return {
        "level": "INFO" if recovery else "WARN",
        "message": f"OS security update {'recovered' if recovery else 'unhealthy'}: {signal}",
        "context": context,
    }


def collect_logs(config: Mapping[str, str], *, now: Optional[dt.datetime] = None) -> list[LogEntry]:
    path = Path(config.get("OS_SECURITY_UPDATE_STATE_FILE") or str(DEFAULT_STATE_FILE)).expanduser()
    try:
        update = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError, UnicodeError):
        logging.debug("OS security update state unavailable")
        return []
    if (
        not isinstance(update, dict)
        or type(update.get("schemaVersion")) is not int
        or update["schemaVersion"] != 1
        or update.get("mode") not in ("apply", "dry-run")
        or not isinstance(update.get("result"), str)
        or update["result"] not in RESULTS
    ):
        return []
    current = now or dt.datetime.now(dt.timezone.utc)
    if current.tzinfo is None:
        current = current.replace(tzinfo=dt.timezone.utc)
    current = current.astimezone(dt.timezone.utc)
    observed_at = current.isoformat()
    try:
        stale_days = int(config.get("OS_SECURITY_UPDATE_STALE_DAYS", str(DEFAULT_STALE_DAYS)))
        if stale_days <= 0:
            stale_days = DEFAULT_STALE_DAYS
    except ValueError:
        stale_days = DEFAULT_STALE_DAYS
    reference = _timestamp(update.get("lastSuccessAt")) or _timestamp(update.get("enabledAt"))
    active = {
        FAILED_SIGNAL: update["result"] == "failed",
        STALE_SIGNAL: reference is not None and (current - reference).total_seconds() > stale_days * 86400,
    }
    marker_path = state_path(config)
    state = load_state(marker_path)
    signals = dict(state["signals"])
    logs: list[LogEntry] = []
    for signal, unhealthy in active.items():
        previous = signals.get(signal)
        record = dict(previous) if isinstance(previous, dict) else {}
        if unhealthy:
            if not record or record.get("recoveryPending"):
                record = {"episodeId": str(uuid.uuid4()), "alertEmitted": False, "recoveryPending": False}
            last_attempt = _timestamp(record.get("lastAttemptAt"))
            if not record.get("alertEmitted") and (last_attempt is None or current - last_attempt >= RETRY_INTERVAL):
                logs.append(_log_entry(signal, record, update, observed_at, False))
                record["lastAttemptAt"] = observed_at
            signals[signal] = record
        elif record.get("alertEmitted"):
            record["recoveryPending"] = True
            signals[signal] = record
            logs.append(_log_entry(signal, record, update, observed_at, True))
        else:
            signals.pop(signal, None)
    updated = {"schemaVersion": 1, "signals": signals}
    if updated != state:
        try:
            save_state(marker_path, updated)
        except OSError:
            logging.debug("OS update health state could not be saved")
            return []
    return logs


def mark_logs_delivered(config: Mapping[str, str], logs: list[object]) -> None:
    path = state_path(config)
    state = load_state(path)
    signals = dict(state["signals"])
    changed = False
    for entry in logs:
        context = entry.get("context") if isinstance(entry, dict) else None
        if not isinstance(context, dict) or context.get("category") != "os_update_health":
            continue
        signal = context.get("signal")
        if signal not in (FAILED_SIGNAL, STALE_SIGNAL):
            continue
        current = signals.get(signal)
        if not isinstance(current, dict) or current.get("episodeId") != context.get("episodeId"):
            continue
        if context.get("action") == "recovery" and current.get("recoveryPending"):
            signals.pop(signal, None)
        elif context.get("action") == "unhealthy" and not current.get("recoveryPending"):
            signals[signal] = {**current, "alertEmitted": True}
        else:
            continue
        changed = True
    if changed:
        try:
            save_state(path, {"schemaVersion": 1, "signals": signals})
        except OSError:
            logging.debug("OS update health delivery state could not be saved")
