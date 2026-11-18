#!/usr/bin/env python3
"""Sanitized OS security update health with delivery-aware episode tracking."""
from __future__ import annotations

import datetime as dt
import json
import logging
import os
import re
import subprocess
import tempfile
import uuid
from pathlib import Path
from typing import Mapping, Optional


DEFAULT_STATE_FILE = Path("/var/lib/raspi-os-security-update/state.json")
DEFAULT_UPDATER_CONFIG = Path("/etc/raspi-os-security-update.conf")
DEFAULT_HEALTH_STATE_FILE = Path("/run/raspi-status-agent/os-update-health.json")
DEFAULT_STALE_DAYS = 15
RETRY_INTERVAL = dt.timedelta(hours=24)
FAILED_SIGNAL = "os_security_update_failed"
STALE_SIGNAL = "os_security_updates_stale"
REASON_CODE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,79}$")
PACKAGE_NAME = re.compile(r"[a-z0-9][a-z0-9+.-]*(?::[a-z0-9][a-z0-9-]*)?")
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


def save_state(path: Path, state: Mapping[str, object], *, mode: Optional[int] = None) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            if mode is not None:
                os.fchmod(handle.fileno(), mode)
            json.dump(state, handle, ensure_ascii=True, sort_keys=True, allow_nan=False)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_name, path)
    finally:
        try:
            os.unlink(temporary_name)
        except FileNotFoundError:
            pass


def early_update_state_dir(config: Mapping[str, str]) -> Optional[Path]:
    try:
        path = Path(config.get("OS_SECURITY_UPDATE_CONFIG_FILE") or DEFAULT_UPDATER_CONFIG).expanduser()
        updater = json.loads(path.read_text(encoding="utf-8"))
        if updater.get("earlyEnabled") is True:
            return Path(updater.get("stateDir", DEFAULT_STATE_FILE.parent))
    except FileNotFoundError:
        pass
    except Exception:
        logging.warning("OS security update configuration could not be read")
    return None


def _read_early_json(path: Path) -> dict:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            return data
        raise ValueError("expected an object")
    except FileNotFoundError:
        pass
    except (OSError, ValueError):
        logging.warning("OS security update %s could not be read", path.name)
    return {}


def _stored_requests(path: Path) -> list[dict]:
    requests = _read_early_json(path).get("requests")
    if not isinstance(requests, list):
        return []
    return [
        request for request in requests
        if isinstance(request, dict) and isinstance(request.get("id"), str)
        and _timestamp(request.get("expiresAt")) and _timestamp(request.get("receivedAt"))
        and isinstance(request.get("baseline"), dict)
    ]


def add_early_update_report(state_dir: Path, payload: dict) -> None:
    try:
        now = dt.datetime.now(dt.timezone.utc)
        requests = []
        for request in _stored_requests(state_dir / "request.json"):
            expiry = _timestamp(request["expiresAt"])
            if expiry and expiry > now:
                requests.append({key: request[key] for key in ("id", "receivedAt", "baseline")})
        check = _read_early_json(state_dir / "state.json").get("check")
        payload["osSecurityUpdate"] = {"earlyEnabled": True, "requests": requests,
                                       "check": check if isinstance(check, dict) else None}
    except Exception:
        logging.warning("OS security update report could not be collected")


def _measure_baseline(name: str) -> dict:
    try:
        result = subprocess.run(
            ["dpkg-query", "-W", "-f=${db:Status-Status}\t${db:Status-Eflag}\t${Version}\n", "--", name],
            env={**os.environ, "LC_ALL": "C.UTF-8", "LANGUAGE": ""},
            capture_output=True, encoding="utf-8", timeout=10, check=False,
        )
    except (OSError, ValueError, subprocess.TimeoutExpired):
        logging.warning("OS security update baseline package probe failed")
        return {"state": "unmeasured", "version": None}
    if (result.returncode == 1 and not result.stdout.strip()
            and result.stderr.strip() == f"dpkg-query: no packages found matching {name}"):
        return {"state": "absent", "version": None}
    if result.returncode == 0:
        fields = result.stdout.rstrip("\n").split("\t")
        if len(fields) == 3 and fields[1] == "ok":
            status, _, version = fields
            if status == "installed" and re.fullmatch(r"[0-9][0-9A-Za-z.+:~\-]*", version):
                return {"state": "installed", "version": version}
            if status in {"not-installed", "config-files"}:
                return {"state": "absent", "version": None}
    return {"state": "unmeasured", "version": None}


def receive_early_update_requests(state_dir: Path, response) -> None:
    try:
        body = json.loads(response.read().decode("utf-8"))
        if not isinstance(body, dict) or "osSecurityUpdateRequests" not in body:
            return
        requests = body["osSecurityUpdateRequests"]
        if not isinstance(requests, list):
            raise ValueError("expected a request list")
        now = dt.datetime.now(dt.timezone.utc)
        active = {}
        seen = set()
        for request in requests:
            request_id, packages, expires_at = (request[key] for key in ("id", "packages", "expiresAt"))
            expiry = _timestamp(expires_at)
            if (not isinstance(request_id, str) or not request_id or request_id in seen
                    or not isinstance(packages, list) or not packages or expiry is None
                    or not all(isinstance(name, str) and PACKAGE_NAME.fullmatch(name) for name in packages)):
                raise ValueError("invalid update request")
            seen.add(request_id)
            if expiry > now:
                active[request_id] = {"id": request_id, "packages": packages, "expiresAt": expires_at}

        path = state_dir / "request.json"
        stored = _stored_requests(path)
        previous = {request["id"]: request for request in stored}
        for request_id, request in active.items():
            if request_id in previous:
                request["receivedAt"] = previous[request_id]["receivedAt"]
                request["baseline"] = previous[request_id]["baseline"]
            else:
                request["receivedAt"] = now.isoformat()
                request["baseline"] = {name: _measure_baseline(name) for name in dict.fromkeys(request["packages"])}
        updated = list(active.values())
        if updated != stored:
            save_state(path, {"requests": updated}, mode=0o644)
    except Exception:
        logging.warning("OS security update requests could not be received")


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
