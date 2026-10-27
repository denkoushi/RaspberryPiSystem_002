"""Fail closed until the OS reports NTP synchronization."""

import subprocess
import time
from pathlib import Path


_cached_result = False
_cache_until = 0.0


def is_synchronized():
    global _cached_result, _cache_until
    if Path("/run/systemd/timesync/synchronized").exists():
        return True
    if time.monotonic() < _cache_until:
        return _cached_result
    try:
        result = subprocess.run(
            ["timedatectl", "show", "-p", "NTPSynchronized", "--value"],
            capture_output=True, text=True, timeout=2, check=False,
        )
        _cached_result = result.returncode == 0 and result.stdout.strip() == "yes"
    except (OSError, subprocess.SubprocessError):
        _cached_result = False
    _cache_until = time.monotonic() + (60 if _cached_result else 5)
    return _cached_result
