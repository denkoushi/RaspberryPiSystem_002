#!/usr/bin/env python3
"""
Storage-health checks for Raspberry Pi SD-card clients.

The module keeps decision logic separate from OS command execution so the
status-agent can stay small and the checks can be unit-tested on macOS.
"""
from __future__ import annotations

import datetime as dt
import os
import re
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Dict, List, Mapping, Optional, Sequence, Set, Tuple

DEFAULT_DISK_WARN_PCT = 80.0
DEFAULT_DISK_ERROR_PCT = 90.0
MAX_STORAGE_HEALTH_LOGS = 10
COMMAND_TIMEOUT_SECONDS = 2.0

LogEntry = Dict[str, object]


@dataclass(frozen=True)
class CommandResult:
    args: Tuple[str, ...]
    returncode: int
    stdout: str = ""
    stderr: str = ""


CommandRunner = Callable[[Sequence[str], float], CommandResult]


def is_truthy(value: Optional[object], default: bool = False) -> bool:
    if value is None:
        return default
    normalized = str(value).strip().lower()
    if normalized in ("1", "true", "yes", "y", "on"):
        return True
    if normalized in ("0", "false", "no", "n", "off"):
        return False
    return default


def parse_percent(value: Optional[object], default: float) -> float:
    try:
        parsed = float(str(value).strip())
    except (TypeError, ValueError):
        return default
    if 0 <= parsed <= 100:
        return parsed
    return default


def read_thresholds(config: Mapping[str, str]) -> Tuple[float, float]:
    warn = parse_percent(config.get("STORAGE_HEALTH_DISK_WARN_PCT"), DEFAULT_DISK_WARN_PCT)
    error = parse_percent(config.get("STORAGE_HEALTH_DISK_ERROR_PCT"), DEFAULT_DISK_ERROR_PCT)
    if error < warn:
        error = warn
    return warn, error


def now_utc() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def observed_at_iso(observed_at: Optional[dt.datetime] = None) -> str:
    value = observed_at or now_utc()
    if value.tzinfo is None:
        value = value.replace(tzinfo=dt.timezone.utc)
    return value.astimezone(dt.timezone.utc).isoformat()


def compact_raw(raw: object, max_length: int = 500) -> str:
    text = str(raw).strip()
    if len(text) <= max_length:
        return text
    return text[: max_length - 3] + "..."


def build_log_entry(
    level: str,
    signal: str,
    message: str,
    root_source: str,
    raw: object,
    observed_at: Optional[dt.datetime] = None,
) -> LogEntry:
    return {
        "level": level,
        "message": message,
        "context": {
            "category": "storage_health",
            "signal": signal,
            "rootSource": root_source,
            "raw": compact_raw(raw),
            "observedAt": observed_at_iso(observed_at),
        },
    }


def decode_mount_field(value: str) -> str:
    return (
        value.replace("\\040", " ")
        .replace("\\011", "\t")
        .replace("\\012", "\n")
        .replace("\\134", "\\")
    )


def find_root_mount_options(mounts_text: str) -> Optional[Set[str]]:
    for line in mounts_text.splitlines():
        parts = line.split()
        if len(parts) < 4:
            continue
        if decode_mount_field(parts[1]) == "/":
            return set(parts[3].split(","))
    return None


def evaluate_root_mount(mounts_text: str, observed_at: Optional[dt.datetime] = None) -> List[LogEntry]:
    options = find_root_mount_options(mounts_text)
    if options and "ro" in options:
        return [
            build_log_entry(
                "ERROR",
                "root_filesystem_read_only",
                "Root filesystem is mounted read-only",
                "/proc/mounts",
                ",".join(sorted(options)),
                observed_at,
            )
        ]
    return []


def severity_for_percent(percent: float, warn_pct: float, error_pct: float) -> Optional[str]:
    if percent >= error_pct:
        return "ERROR"
    if percent >= warn_pct:
        return "WARN"
    return None


def evaluate_disk_usage(
    percent: float,
    warn_pct: float,
    error_pct: float,
    observed_at: Optional[dt.datetime] = None,
) -> List[LogEntry]:
    severity = severity_for_percent(percent, warn_pct, error_pct)
    if not severity:
        return []
    return [
        build_log_entry(
            severity,
            "root_disk_usage_high",
            f"Root disk usage is high: {percent:.1f}%",
            "/",
            f"{percent:.1f}",
            observed_at,
        )
    ]


def evaluate_inode_usage(
    percent: float,
    warn_pct: float,
    error_pct: float,
    observed_at: Optional[dt.datetime] = None,
) -> List[LogEntry]:
    severity = severity_for_percent(percent, warn_pct, error_pct)
    if not severity:
        return []
    return [
        build_log_entry(
            severity,
            "root_inode_usage_high",
            f"Root inode usage is high: {percent:.1f}%",
            "/",
            f"{percent:.1f}",
            observed_at,
        )
    ]


KERNEL_STORAGE_PATTERNS = (
    re.compile(r"\bi/o error\b", re.IGNORECASE),
    re.compile(r"\bext4-fs error\b", re.IGNORECASE),
    re.compile(r"\bbuffer i/o error\b", re.IGNORECASE),
    re.compile(r"\bremounting filesystem read-only\b", re.IGNORECASE),
    re.compile(r"\bmmc\w*.*\b(error|fail|failed|timeout|crc|reset|read-only)\b", re.IGNORECASE),
)


def kernel_storage_error_lines(kernel_log: str) -> List[str]:
    matches: List[str] = []
    for line in kernel_log.splitlines():
        if any(pattern.search(line) for pattern in KERNEL_STORAGE_PATTERNS):
            matches.append(line.strip())
    return matches


def evaluate_kernel_log(
    kernel_log: str,
    root_source: str,
    observed_at: Optional[dt.datetime] = None,
) -> List[LogEntry]:
    matches = kernel_storage_error_lines(kernel_log)
    if not matches:
        return []
    raw = "\n".join(matches[:5])
    return [
        build_log_entry(
            "ERROR",
            "kernel_storage_error",
            f"Storage-related kernel error detected ({len(matches)} line(s))",
            root_source,
            raw,
            observed_at,
        )
    ]


def parse_throttled_value(raw: str) -> Optional[int]:
    match = re.search(r"0x[0-9a-fA-F]+|\d+", raw)
    if not match:
        return None
    try:
        return int(match.group(0), 0)
    except ValueError:
        return None


def evaluate_throttled(raw: str, observed_at: Optional[dt.datetime] = None) -> List[LogEntry]:
    value = parse_throttled_value(raw)
    if value is None:
        return []

    logs: List[LogEntry] = []
    if value & 0x1:
        logs.append(
            build_log_entry(
                "ERROR",
                "power_undervoltage_current",
                "Current under-voltage detected by Raspberry Pi firmware",
                "vcgencmd get_throttled",
                raw,
                observed_at,
            )
        )

    current_throttle_mask = 0x2 | 0x4 | 0x8
    if value & current_throttle_mask:
        logs.append(
            build_log_entry(
                "WARN",
                "power_throttled_current",
                "Current throttling or temperature limit detected by Raspberry Pi firmware",
                "vcgencmd get_throttled",
                raw,
                observed_at,
            )
        )
    return logs


def run_command(args: Sequence[str], timeout: float = COMMAND_TIMEOUT_SECONDS) -> CommandResult:
    try:
        completed = subprocess.run(
            list(args),
            capture_output=True,
            check=False,
            text=True,
            timeout=timeout,
        )
        return CommandResult(tuple(args), completed.returncode, completed.stdout or "", completed.stderr or "")
    except (OSError, subprocess.SubprocessError) as exc:
        return CommandResult(tuple(args), 127, "", str(exc))


def read_kernel_log(runner: CommandRunner = run_command, timeout: float = COMMAND_TIMEOUT_SECONDS) -> Tuple[str, str]:
    journal = runner(["journalctl", "-k", "--since", "-2min", "--no-pager"], timeout)
    if journal.returncode == 0 and journal.stdout.strip():
        return journal.stdout, "journalctl -k --since -2min"

    dmesg = runner(["dmesg"], timeout)
    if dmesg.returncode == 0 and dmesg.stdout.strip():
        return dmesg.stdout, "dmesg"

    return "", "journalctl/dmesg"


def read_throttled(runner: CommandRunner = run_command, timeout: float = COMMAND_TIMEOUT_SECONDS) -> Optional[str]:
    result = runner(["vcgencmd", "get_throttled"], timeout)
    if result.returncode != 0:
        return None
    raw = result.stdout.strip()
    return raw or None


def read_root_disk_usage_percent(path: str = "/") -> float:
    usage = shutil.disk_usage(path)
    return (usage.used / usage.total) * 100


def read_inode_usage_percent(path: str = "/") -> Optional[float]:
    stat = os.statvfs(path)
    total = stat.f_files
    if total <= 0:
        return None
    available = stat.f_favail if stat.f_favail >= 0 else stat.f_ffree
    used = max(total - available, 0)
    return (used / total) * 100


def collect_storage_health_logs(
    config: Mapping[str, str],
    *,
    runner: CommandRunner = run_command,
    mounts_path: Path = Path("/proc/mounts"),
    disk_path: str = "/",
    observed_at: Optional[dt.datetime] = None,
) -> List[LogEntry]:
    observed = observed_at or now_utc()
    warn_pct, error_pct = read_thresholds(config)
    logs: List[LogEntry] = []

    try:
        mounts_text = mounts_path.read_text(encoding="utf-8")
        logs.extend(evaluate_root_mount(mounts_text, observed))
    except OSError:
        pass

    try:
        disk_pct = read_root_disk_usage_percent(disk_path)
        logs.extend(evaluate_disk_usage(disk_pct, warn_pct, error_pct, observed))
    except OSError:
        pass

    try:
        inode_pct = read_inode_usage_percent(disk_path)
        if inode_pct is not None:
            logs.extend(evaluate_inode_usage(inode_pct, warn_pct, error_pct, observed))
    except OSError:
        pass

    kernel_log, kernel_source = read_kernel_log(runner)
    logs.extend(evaluate_kernel_log(kernel_log, kernel_source, observed))

    throttled = read_throttled(runner)
    if throttled:
        logs.extend(evaluate_throttled(throttled, observed))

    return logs[:MAX_STORAGE_HEALTH_LOGS]
