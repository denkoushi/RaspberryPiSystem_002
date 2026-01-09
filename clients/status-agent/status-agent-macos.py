#!/usr/bin/env python3
"""
Lightweight status agent for macOS clients.

Collects basic system metrics and posts them to /api/clients/status with x-client-key authentication.
This is a macOS-compatible version of status-agent.py.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import socket
import ssl
import subprocess
import sys
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
    Path.home() / ".status-agent.conf",  # Mac-specific fallback
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
        "Set STATUS_AGENT_CONFIG or create ~/.status-agent.conf"
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


def read_cpu_usage_macos() -> float:
    """Read CPU usage on macOS using top command."""
    try:
        output = subprocess.check_output(
            ["top", "-l", "1", "-n", "0"],
            stderr=subprocess.DEVNULL,
            timeout=5
        ).decode("utf-8")
        
        for line in output.split("\n"):
            if "CPU usage" in line:
                # Example: "CPU usage: 10.0% user, 5.0% sys, 85.0% idle"
                match = re.search(r'(\d+\.?\d*)%\s+idle', line)
                if match:
                    idle = float(match.group(1))
                    return round(100.0 - idle, 1)
        return 0.0
    except Exception:
        return 0.0


def read_memory_usage_macos() -> float:
    """Read memory usage on macOS using vm_stat command."""
    try:
        output = subprocess.check_output(["vm_stat"], timeout=5).decode("utf-8")
        page_size = 4096  # Default page size on macOS
        
        stats = {}
        for line in output.split("\n"):
            if ":" in line:
                key, value = line.split(":", 1)
                key = key.strip()
                value = value.strip().rstrip(".")
                try:
                    stats[key] = int(value)
                except ValueError:
                    pass
        
        # Get physical memory size
        mem_output = subprocess.check_output(["sysctl", "-n", "hw.memsize"], timeout=5).decode("utf-8")
        total_memory = int(mem_output.strip())
        
        # Calculate used memory
        pages_active = stats.get("Pages active", 0)
        pages_wired = stats.get("Pages wired down", 0)
        pages_compressed = stats.get("Pages stored in compressor", 0)
        
        used_memory = (pages_active + pages_wired + pages_compressed) * page_size
        usage = (used_memory / total_memory) * 100
        return round(max(0.0, min(usage, 100.0)), 1)
    except Exception:
        return 0.0


def read_disk_usage() -> float:
    usage = shutil.disk_usage("/")
    percent = (usage.used / usage.total) * 100
    return round(percent, 1)


def read_temperature_macos() -> Optional[float]:
    """Read CPU temperature on macOS (requires osx-cpu-temp or similar tool)."""
    # macOS doesn't provide easy access to CPU temperature without third-party tools
    # Return None if not available
    try:
        # Try osx-cpu-temp if installed (brew install osx-cpu-temp)
        output = subprocess.check_output(["osx-cpu-temp"], timeout=5, stderr=subprocess.DEVNULL).decode("utf-8")
        match = re.search(r'(\d+\.?\d*)', output)
        if match:
            return round(float(match.group(1)), 2)
    except Exception:
        pass
    return None


def read_uptime_macos() -> int:
    """Read system uptime on macOS."""
    try:
        output = subprocess.check_output(["sysctl", "-n", "kern.boottime"], timeout=5).decode("utf-8")
        # Example: "{ sec = 1736390400, usec = 0 } Thu Jan  9 00:00:00 2026"
        match = re.search(r'sec\s*=\s*(\d+)', output)
        if match:
            boot_time = int(match.group(1))
            uptime = int(dt.datetime.now().timestamp() - boot_time)
            return max(0, uptime)
    except Exception:
        pass
    return 0


def get_ip_address() -> str:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"


def build_payload(config: Dict[str, str]) -> Dict[str, object]:
    hostname = socket.gethostname()
    ip_address = get_ip_address()
    cpu_usage = read_cpu_usage_macos()
    memory_usage = read_memory_usage_macos()
    disk_usage = read_disk_usage()
    uptime_seconds = read_uptime_macos()
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

    temperature = read_temperature_macos()
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
    parser = argparse.ArgumentParser(description="macOS status agent")
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
