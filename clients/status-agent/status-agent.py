#!/usr/bin/env python3
"""
Lightweight status agent for Raspberry Pi clients.

Collects basic system metrics and posts them to /api/clients/status with x-client-key authentication.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import socket
import ssl
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Dict, Optional
import shutil

SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_CONFIG_PATHS = [
    os.environ.get("STATUS_AGENT_CONFIG"),
    SCRIPT_DIR / "status-agent.conf",
    SCRIPT_DIR / "status-agent.conf.example",
    Path("/etc/raspi-status-agent.conf"),
]


def load_config() -> Dict[str, str]:
    for candidate in DEFAULT_CONFIG_PATHS:
        if not candidate:
            continue
        path = Path(candidate).expanduser()
        if path.is_file():
            return parse_config_file(path)
    raise FileNotFoundError(
        "status-agent configuration file not found. "
        "Set STATUS_AGENT_CONFIG or create /etc/raspi-status-agent.conf"
    )


def parse_config_file(path: Path) -> Dict[str, str]:
    config: Dict[str, str] = {}
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" not in line:
                continue
            key, value = line.split("=", 1)
            config[key.strip()] = value.strip().strip('\'"')

    required = ["API_BASE_URL", "CLIENT_ID", "CLIENT_KEY"]
    missing = [key for key in required if not config.get(key)]
    if missing:
        raise ValueError(f"Missing required config keys: {', '.join(missing)}")
    config.setdefault("REQUEST_TIMEOUT", "10")
    config.setdefault("TLS_SKIP_VERIFY", "0")
    return config


def log(message: str, level: str = "INFO", log_file: Optional[Path] = None) -> None:
    timestamp = dt.datetime.now().isoformat(timespec="seconds")
    formatted = f"[{timestamp}] [{level}] {message}"
    if log_file:
        try:
            log_file.parent.mkdir(parents=True, exist_ok=True)
            with log_file.open("a", encoding="utf-8") as f:
                f.write(formatted + "\n")
            return
        except OSError as exc:
            print(f"[status-agent] log file write failed ({exc}); fallback to stdout", file=sys.stderr)
    print(formatted)


def read_cpu_usage() -> float:
    def read_cpu_times():
        with open("/proc/stat", "r", encoding="utf-8") as f:
            parts = f.readline().strip().split()
        values = list(map(int, parts[1:]))
        idle = values[3]
        total = sum(values)
        return idle, total

    idle1, total1 = read_cpu_times()
    time.sleep(0.5)
    idle2, total2 = read_cpu_times()

    delta_idle = idle2 - idle1
    delta_total = total2 - total1
    if delta_total <= 0:
        return 0.0
    usage = (1.0 - (delta_idle / delta_total)) * 100
    return max(0.0, min(usage, 100.0))


def read_memory_usage() -> float:
    mem_total = 0
    mem_available = 0
    with open("/proc/meminfo", "r", encoding="utf-8") as f:
        for line in f:
            if line.startswith("MemTotal"):
                mem_total = int(line.split()[1])
            elif line.startswith("MemAvailable"):
                mem_available = int(line.split()[1])
            if mem_total and mem_available:
                break
    if mem_total == 0:
        return 0.0
    usage = (1 - (mem_available / mem_total)) * 100
    return max(0.0, min(usage, 100.0))


def read_disk_usage() -> float:
    usage = shutil.disk_usage("/")
    percent = (usage.used / usage.total) * 100
    return round(percent, 1)


def read_temperature(config: Dict[str, str]) -> Optional[float]:
    candidate_paths = [
        config.get("TEMPERATURE_FILE"),
        "/sys/class/thermal/thermal_zone0/temp",
        "/sys/class/thermal/thermal_zone1/temp",
    ]
    for candidate in candidate_paths:
        if not candidate:
            continue
        path = Path(candidate)
        if path.is_file():
            try:
                raw = path.read_text(encoding="utf-8").strip()
                value = float(raw) / 1000.0 if len(raw) > 3 else float(raw)
                return round(value, 2)
            except Exception:
                continue
    return None


def read_uptime() -> float:
    with open("/proc/uptime", "r", encoding="utf-8") as f:
        return float(f.readline().split()[0])


def get_ip_address() -> str:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            return s.getsockname()[0]
    except OSError:
        # fallback to hostname -I
        try:
            output = subprocess.check_output(["hostname", "-I"]).decode().strip()
            return output.split()[0]
        except Exception:
            return "127.0.0.1"


def build_payload(config: Dict[str, str]) -> Dict[str, object]:
    required_paths = [Path("/proc/stat"), Path("/proc/meminfo")]
    for required in required_paths:
        if not required.exists():
            raise RuntimeError(f"{required} not found. status-agentはLinux上で実行してください。")

    hostname = socket.gethostname()
    ip_address = get_ip_address()
    cpu_usage = round(read_cpu_usage(), 1)
    memory_usage = round(read_memory_usage(), 1)
    disk_usage = round(read_disk_usage(), 1)
    uptime_seconds = int(read_uptime())
    last_boot = dt.datetime.now(dt.timezone.utc) - dt.timedelta(seconds=uptime_seconds)

    payload: Dict[str, object] = {
        "clientId": config["CLIENT_ID"],
        "hostname": hostname,
        "ipAddress": ip_address,
        "cpuUsage": cpu_usage,
        "memoryUsage": memory_usage,
        "diskUsage": disk_usage,
        "uptimeSeconds": uptime_seconds,
        "lastBoot": last_boot.isoformat(),
    }

    temperature = read_temperature(config)
    if temperature is not None:
        payload["temperature"] = temperature
    payload["logs"] = []

    return payload


def post_payload(config: Dict[str, str], payload: Dict[str, object]) -> None:
    api_base = config["API_BASE_URL"].rstrip("/")
    url = f"{api_base}/clients/status"
    data = json.dumps(payload).encode("utf-8")
    headers = {
        "Content-Type": "application/json",
        "x-client-key": config["CLIENT_KEY"],
    }
    request = urllib.request.Request(url, data=data, headers=headers, method="POST")

    timeout = float(config.get("REQUEST_TIMEOUT", "10"))
    skip_verify = config.get("TLS_SKIP_VERIFY", "0").lower() in ("1", "true", "yes")
    context = ssl._create_unverified_context() if skip_verify else ssl.create_default_context()

    with urllib.request.urlopen(request, timeout=timeout, context=context) as response:
        body = response.read().decode("utf-8")
        return_code = response.getcode()
        if return_code >= 300:
            raise RuntimeError(f"HTTP {return_code}: {body}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Raspberry Pi status agent")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Collect metrics and print payload without calling the API",
    )
    args = parser.parse_args()

    try:
        config = load_config()
    except Exception as exc:
        print(f"[status-agent] failed to load config: {exc}", file=sys.stderr)
        return 1

    log_file = Path(config["LOG_FILE"]).expanduser() if config.get("LOG_FILE") else None

    try:
        payload = build_payload(config)
        if args.dry_run:
            print(json.dumps(payload, ensure_ascii=False, indent=2))
            log("status heartbeat dry-run (no HTTP request)", "INFO", log_file)
            return 0

        post_payload(config, payload)
        location = config.get("LOCATION")
        suffix = f" ({location})" if location else ""
        log(f"status heartbeat sent{suffix}", "INFO", log_file)
        return 0
    except (urllib.error.URLError, RuntimeError, TimeoutError) as exc:
        log(f"failed to send status: {exc}", "ERROR", log_file)
        return 2
    except Exception as exc:  # pragma: no cover
        log(f"unexpected error: {exc}", "ERROR", log_file)
        return 3


if __name__ == "__main__":
    sys.exit(main())

