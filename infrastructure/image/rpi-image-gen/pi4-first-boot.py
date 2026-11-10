#!/usr/bin/env python3
"""Commission a common Pi4 image; never print bootstrap data or child output."""
import json
import os
from pathlib import Path
import re
import signal
import stat
import subprocess
import sys
import tempfile

ROOT = Path(os.environ.get("PI4_FIRST_BOOT_ROOT", "/"))


def path(name):
    return ROOT / name.lstrip("/")


def command(*args, capture=False):
    return subprocess.run(args, check=True, timeout=90,
                          stdout=subprocess.PIPE if capture else subprocess.DEVNULL,
                          stderr=subprocess.DEVNULL).stdout


def running():
    try:
        return json.loads(command("tailscale", "status", "--json", capture=True)).get(
            "BackendState") == "Running"
    except (subprocess.CalledProcessError, ValueError, AttributeError):
        return False


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate field")
        result[key] = value
    return result


def read_bootstrap(source):
    fd = os.open(source, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, "rb") as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_size > 4096:
            raise ValueError("invalid file")
        data = stream.read(4097)
    if len(data) > 4096:
        raise ValueError("oversize file")
    config = json.loads(data, object_pairs_hook=unique_object)
    if not isinstance(config, dict) or set(config) != {"hostname", "tailscale_auth_key"}:
        raise ValueError("invalid fields")
    hostname, key = config["hostname"], config["tailscale_auth_key"]
    if not isinstance(hostname, str) or not re.fullmatch(
            r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", hostname):
        raise ValueError("invalid hostname")
    if not isinstance(key, str) or not key.startswith("tskey-"):
        raise ValueError("invalid key")
    return hostname, key


def interrupted(signum, frame):
    raise RuntimeError("interrupted")


def main():
    done = path("/var/lib/pi4-first-boot/done")
    if done.exists():
        return
    source = path("/boot/firmware/pi4-bootstrap.json")
    hostname, key = read_bootstrap(source)
    path("/etc/hostname").write_text(hostname + "\n", encoding="utf-8")
    hosts = path("/etc/hosts")
    lines = [line for line in hosts.read_text(encoding="utf-8").splitlines()
             if not re.match(r"^\s*127\.0\.1\.1(?:\s|$)", line)]
    hosts.write_text("\n".join(lines + ["127.0.1.1\t" + hostname]) + "\n",
                     encoding="utf-8")
    command("hostnamectl", "set-hostname", hostname)
    if not running():
        runtime = path("/run/pi4-first-boot")
        runtime.mkdir(mode=0o700, parents=True, exist_ok=True)
        # NamedTemporaryFile creates the file with mode 0600, including on failure.
        with tempfile.NamedTemporaryFile(mode="w", dir=runtime, encoding="utf-8") as auth:
            auth.write(key)
            auth.flush()
            command("tailscale", "up", "--auth-key=file:" + auth.name,
                    "--hostname=" + hostname, "--advertise-tags=tag:kiosk", "--ssh=false")
    if not running():
        raise RuntimeError("join not verified")
    try:
        source.unlink()
        os.sync()
        done.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        done.write_text("commissioned\n", encoding="utf-8")
        os.sync()
        command("systemctl", "disable", "pi4-first-boot.service")
    except Exception:
        # Restore retry input on a finalization error, without overwriting a file.
        if not source.exists():
            fd = os.open(source, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "w", encoding="utf-8") as stream:
                json.dump({"hostname": hostname, "tailscale_auth_key": key}, stream)
        done.unlink(missing_ok=True)
        os.sync()
        raise



if __name__ == "__main__":
    signal.signal(signal.SIGTERM, interrupted)
    try:
        main()
    except Exception:
        print("pi4-first-boot: commissioning failed; check input and connectivity", file=sys.stderr)
        sys.exit(1)
