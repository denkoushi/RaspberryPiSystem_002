#!/usr/bin/env python3
"""
Storage-health checks for Raspberry Pi SD-card clients.

The module keeps decision logic separate from OS command execution so the
status-agent can stay small and the checks can be unit-tested on macOS.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import re
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Dict, List, Mapping, Optional, Sequence, Set, Tuple

DEFAULT_DISK_WARN_PCT = 80.0
DEFAULT_DISK_ERROR_PCT = 90.0
DEFAULT_INTERVAL_SECONDS = 3600
KERNEL_LOG_LOOKBACK_MARGIN_SECONDS = 300
MAX_STORAGE_HEALTH_LOGS = 10
COMMAND_TIMEOUT_SECONDS = 2.0

# Wear tracking. The state lives on tmpfs, so it restarts with every boot just like the kernel
# write counters and the firmware's "since boot" throttle flags it is compared with.
DEFAULT_WEAR_STATE_FILE = Path("/run/raspi-status-agent/storage-wear-state.json")
DEFAULT_WRITE_WARN_GB_PER_DAY = 10.0
WRITE_RATE_WINDOW_SECONDS = 24 * 3600
WRITE_RATE_MIN_SPAN_SECONDS = 12 * 3600
WEAR_REPORT_INTERVAL_SECONDS = 24 * 3600
SECTOR_BYTES = 512
THROTTLED_UNDERVOLTAGE_SINCE_BOOT = 0x10000
SIGNAL_UNDERVOLTAGE_SINCE_BOOT = "power_undervoltage_since_boot"
SIGNAL_WRITE_RATE_HIGH = "storage_write_rate_high"
SIGNAL_WEAR_REPORT = "storage_wear_report"

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


def parse_non_negative_int(value: Optional[object], default: int) -> int:
    try:
        parsed = int(str(value).strip())
    except (TypeError, ValueError):
        return default
    if parsed < 0:
        return default
    return parsed


def read_thresholds(config: Mapping[str, str]) -> Tuple[float, float]:
    warn = parse_percent(config.get("STORAGE_HEALTH_DISK_WARN_PCT"), DEFAULT_DISK_WARN_PCT)
    error = parse_percent(config.get("STORAGE_HEALTH_DISK_ERROR_PCT"), DEFAULT_DISK_ERROR_PCT)
    if error < warn:
        error = warn
    return warn, error


def read_interval_seconds(config: Mapping[str, str]) -> int:
    return parse_non_negative_int(
        config.get("STORAGE_HEALTH_INTERVAL_SECONDS"),
        DEFAULT_INTERVAL_SECONDS,
    )


def kernel_log_since_arg(config: Mapping[str, str]) -> str:
    configured = str(config.get("STORAGE_HEALTH_KERNEL_LOG_SINCE", "")).strip()
    if configured:
        return configured

    interval_seconds = read_interval_seconds(config)
    if interval_seconds <= 0:
        return "-2min"
    return f"-{interval_seconds + KERNEL_LOG_LOOKBACK_MARGIN_SECONDS}s"


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


# Printed on every boot by the Raspberry Pi SD host driver. It only says the
# slot has no write-protect switch; "read-only" in it is not a remount. The
# Pi3 reboots daily, so it raised a false ERROR alert each morning.
KERNEL_BENIGN_PATTERNS = (
    re.compile(r"host does not support reading read-only switch", re.IGNORECASE),
)


def kernel_storage_error_lines(kernel_log: str) -> List[str]:
    matches: List[str] = []
    for line in kernel_log.splitlines():
        if any(pattern.search(line) for pattern in KERNEL_BENIGN_PATTERNS):
            continue
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


def evaluate_throttled(
    raw: str,
    observed_at: Optional[dt.datetime] = None,
    *,
    include_since_boot: bool = False,
) -> List[LogEntry]:
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

    # A dip that ended before this hourly check only shows in the sticky flag.
    if include_since_boot and value & THROTTLED_UNDERVOLTAGE_SINCE_BOOT:
        logs.append(
            build_log_entry(
                "WARN",
                SIGNAL_UNDERVOLTAGE_SINCE_BOOT,
                "Under-voltage has occurred since boot (check the power supply and cable)",
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


def read_kernel_log(
    runner: CommandRunner = run_command,
    timeout: float = COMMAND_TIMEOUT_SECONDS,
    since: str = "-2min",
) -> Tuple[str, str]:
    journal = runner(["journalctl", "-k", "--since", since, "--no-pager"], timeout)
    if journal.returncode == 0 and journal.stdout.strip():
        return journal.stdout, f"journalctl -k --since {since}"

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


def read_write_warn_gb_per_day(config: Mapping[str, str]) -> float:
    try:
        parsed = float(str(config.get("STORAGE_HEALTH_WRITE_WARN_GB_PER_DAY", "")).strip())
    except (TypeError, ValueError):
        return DEFAULT_WRITE_WARN_GB_PER_DAY
    if parsed > 0:
        return parsed
    return DEFAULT_WRITE_WARN_GB_PER_DAY


def wear_state_path(config: Mapping[str, str]) -> Path:
    raw = config.get("STORAGE_HEALTH_WEAR_STATE_FILE") or str(DEFAULT_WEAR_STATE_FILE)
    return Path(raw).expanduser()


def empty_wear_state(boot_id: str) -> Dict[str, object]:
    return {
        "schemaVersion": 1,
        "bootId": boot_id,
        "samples": [],
        "undervoltageSinceBootReported": False,
        "lastWearReportUptime": None,
    }


def load_wear_state(path: Path, boot_id: str) -> Dict[str, object]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, UnicodeError):
        return empty_wear_state(boot_id)
    if (
        not isinstance(value, dict)
        or value.get("schemaVersion") != 1
        or value.get("bootId") != boot_id
        or not isinstance(value.get("samples"), list)
    ):
        return empty_wear_state(boot_id)
    return value


def save_wear_state(path: Path, state: Mapping[str, object]) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        file_descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    except OSError:
        return
    try:
        with os.fdopen(file_descriptor, "w", encoding="utf-8") as handle:
            handle.write(json.dumps(state, sort_keys=True, separators=(",", ":"), allow_nan=False))
        os.replace(temporary_name, path)
    except OSError:
        pass
    finally:
        try:
            os.unlink(temporary_name)
        except FileNotFoundError:
            pass


def read_text_or_none(path: Path) -> Optional[str]:
    try:
        return path.read_text(encoding="utf-8").strip()
    except (OSError, UnicodeError):
        return None


def read_uptime_seconds(path: Path = Path("/proc/uptime")) -> Optional[float]:
    raw = read_text_or_none(path)
    if not raw:
        return None
    try:
        return float(raw.split()[0])
    except (IndexError, ValueError):
        return None


def root_source_from_mounts(mounts_text: str) -> Optional[str]:
    for line in mounts_text.splitlines():
        parts = line.split()
        if len(parts) >= 2 and decode_mount_field(parts[1]) == "/":
            return decode_mount_field(parts[0])
    return None


def split_block_device(source: str) -> Optional[Tuple[str, str]]:
    """Return (disk, partition) for /dev/mmcblk0p2-style sources, or None."""
    name = source.rsplit("/", 1)[-1]
    match = re.fullmatch(r"((?:mmcblk|nvme\d+n)\d+)p\d+", name) or re.fullmatch(r"([a-z]+)\d+", name)
    if not match:
        return None
    return match.group(1), name


def parse_block_write_sectors(stat_text: str) -> Optional[int]:
    fields = stat_text.split()
    if len(fields) < 7:
        return None
    try:
        return int(fields[6])
    except ValueError:
        return None


def update_write_samples(
    samples: Sequence[object],
    uptime: float,
    sectors: int,
) -> List[List[float]]:
    kept: List[List[float]] = []
    for sample in samples:
        if not isinstance(sample, list) or len(sample) != 2:
            continue
        sample_uptime, sample_sectors = sample
        if not isinstance(sample_uptime, (int, float)) or not isinstance(sample_sectors, (int, float)):
            continue
        if sample_uptime > uptime or sample_sectors > sectors:
            # Counters went backwards: the state belongs to an earlier boot.
            return [[uptime, sectors]]
        if uptime - sample_uptime <= WRITE_RATE_WINDOW_SECONDS:
            kept.append([sample_uptime, sample_sectors])
    kept.append([uptime, sectors])
    return kept


def write_gb_per_day(samples: Sequence[Sequence[float]]) -> Optional[Tuple[float, float]]:
    """Return (GB/day, span seconds) over the sample window once it is long enough."""
    if len(samples) < 2:
        return None
    oldest, newest = samples[0], samples[-1]
    span = newest[0] - oldest[0]
    if span < WRITE_RATE_MIN_SPAN_SECONDS:
        return None
    written_bytes = (newest[1] - oldest[1]) * SECTOR_BYTES
    return written_bytes / span * 86400 / 1e9, span


def evaluate_write_rate(
    rate: Optional[Tuple[float, float]],
    warn_gb_per_day: float,
    root_source: str,
    observed_at: Optional[dt.datetime] = None,
) -> List[LogEntry]:
    if rate is None or rate[0] < warn_gb_per_day:
        return []
    gb_per_day, span = rate
    return [
        build_log_entry(
            "WARN",
            SIGNAL_WRITE_RATE_HIGH,
            f"SD write rate is high: {gb_per_day:.1f} GB/day over {span / 3600:.0f}h "
            f"(threshold {warn_gb_per_day:g} GB/day)",
            root_source,
            f"{gb_per_day:.2f}",
            observed_at,
        )
    ]


def build_wear_report(
    *,
    root_source: str,
    rate: Tuple[float, float],
    lifetime_write_kbytes: Optional[int],
    card_size_bytes: Optional[int],
    card_name: Optional[str],
    card_date: Optional[str],
    observed_at: Optional[dt.datetime] = None,
) -> LogEntry:
    gb_per_day, span = rate
    parts = [f"{gb_per_day:.2f} GB/day over {span / 3600:.0f}h"]
    lifetime_gb = None
    card_multiple = None
    if lifetime_write_kbytes is not None:
        lifetime_gb = lifetime_write_kbytes * 1024 / 1e9
        parts.append(f"lifetime {lifetime_gb:.0f} GB written")
        if card_size_bytes:
            card_multiple = lifetime_write_kbytes * 1024 / card_size_bytes
            parts.append(f"{card_multiple:.1f}x card size")
    entry = build_log_entry(
        "INFO",
        SIGNAL_WEAR_REPORT,
        "SD wear report: " + ", ".join(parts),
        root_source,
        f"name={card_name or '-'} date={card_date or '-'}",
        observed_at,
    )
    context = entry["context"]
    assert isinstance(context, dict)
    context.update(
        {
            "writeGbPerDay": round(gb_per_day, 3),
            "lifetimeWriteGb": None if lifetime_gb is None else round(lifetime_gb, 1),
            "cardSizeGb": None if not card_size_bytes else round(card_size_bytes / 1e9, 1),
            "cardWriteMultiple": None if card_multiple is None else round(card_multiple, 2),
            "cardName": card_name,
            "cardDate": card_date,
        }
    )
    return entry


def read_int_or_none(path: Path) -> Optional[int]:
    raw = read_text_or_none(path)
    try:
        return int(raw) if raw else None
    except ValueError:
        return None


def collect_wear_logs(
    config: Mapping[str, str],
    mounts_text: str,
    throttled: Optional[str],
    *,
    sys_root: Path,
    uptime_path: Path,
    boot_id_path: Path,
    observed_at: Optional[dt.datetime] = None,
) -> List[LogEntry]:
    boot_id = read_text_or_none(boot_id_path) or "unknown"
    path = wear_state_path(config)
    state = load_wear_state(path, boot_id)
    logs: List[LogEntry] = []

    if throttled and not state.get("undervoltageSinceBootReported"):
        logs.extend(
            log
            for log in evaluate_throttled(throttled, observed_at, include_since_boot=True)
            if log["context"]["signal"] == SIGNAL_UNDERVOLTAGE_SINCE_BOOT  # type: ignore[index]
        )

    source = root_source_from_mounts(mounts_text)
    device = split_block_device(source) if source else None
    uptime = read_uptime_seconds(uptime_path)
    if source and device and uptime is not None:
        disk, partition = device
        sectors = parse_block_write_sectors(read_text_or_none(sys_root / "block" / disk / "stat") or "")
        if sectors is not None:
            samples = update_write_samples(state.get("samples", []), uptime, sectors)
            state["samples"] = samples
            save_wear_state(path, state)
            rate = write_gb_per_day(samples)
            logs.extend(evaluate_write_rate(rate, read_write_warn_gb_per_day(config), source, observed_at))
            last_report = state.get("lastWearReportUptime")
            report_due = not isinstance(last_report, (int, float)) or (
                uptime - last_report >= WEAR_REPORT_INTERVAL_SECONDS
            )
            if rate is not None and report_due:
                size_sectors = read_int_or_none(sys_root / "block" / disk / "size")
                logs.append(
                    build_wear_report(
                        root_source=source,
                        rate=rate,
                        lifetime_write_kbytes=read_int_or_none(
                            sys_root / "fs" / "ext4" / partition / "lifetime_write_kbytes"
                        ),
                        card_size_bytes=None if size_sectors is None else size_sectors * SECTOR_BYTES,
                        card_name=read_text_or_none(sys_root / "block" / disk / "device" / "name"),
                        card_date=read_text_or_none(sys_root / "block" / disk / "device" / "date"),
                        observed_at=observed_at,
                    )
                )
    return logs


def mark_wear_logs_delivered(
    config: Mapping[str, str],
    logs: Sequence[object],
    *,
    uptime_path: Path = Path("/proc/uptime"),
    boot_id_path: Path = Path("/proc/sys/kernel/random/boot_id"),
) -> None:
    """Record once-per-boot and daily reports only after the API accepted them."""
    signals = set()
    for entry in logs:
        context = entry.get("context") if isinstance(entry, dict) else None
        if isinstance(context, dict) and context.get("category") == "storage_health":
            signals.add(context.get("signal"))
    if not signals & {SIGNAL_UNDERVOLTAGE_SINCE_BOOT, SIGNAL_WEAR_REPORT}:
        return
    path = wear_state_path(config)
    state = load_wear_state(path, read_text_or_none(boot_id_path) or "unknown")
    if SIGNAL_UNDERVOLTAGE_SINCE_BOOT in signals:
        state["undervoltageSinceBootReported"] = True
    if SIGNAL_WEAR_REPORT in signals:
        state["lastWearReportUptime"] = read_uptime_seconds(uptime_path)
    save_wear_state(path, state)


def collect_storage_health_logs(
    config: Mapping[str, str],
    *,
    runner: CommandRunner = run_command,
    mounts_path: Path = Path("/proc/mounts"),
    disk_path: str = "/",
    observed_at: Optional[dt.datetime] = None,
    sys_root: Path = Path("/sys"),
    uptime_path: Path = Path("/proc/uptime"),
    boot_id_path: Path = Path("/proc/sys/kernel/random/boot_id"),
) -> List[LogEntry]:
    observed = observed_at or now_utc()
    warn_pct, error_pct = read_thresholds(config)
    logs: List[LogEntry] = []

    mounts_text = ""
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

    kernel_log, kernel_source = read_kernel_log(runner, since=kernel_log_since_arg(config))
    logs.extend(evaluate_kernel_log(kernel_log, kernel_source, observed))

    throttled = read_throttled(runner)
    if throttled:
        logs.extend(evaluate_throttled(throttled, observed))

    logs.extend(
        collect_wear_logs(
            config,
            mounts_text,
            throttled,
            sys_root=sys_root,
            uptime_path=uptime_path,
            boot_id_path=boot_id_path,
            observed_at=observed,
        )
    )

    return logs[:MAX_STORAGE_HEALTH_LOGS]
