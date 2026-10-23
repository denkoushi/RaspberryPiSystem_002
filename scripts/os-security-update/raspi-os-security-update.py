#!/usr/bin/python3
"""Weekly Raspberry Pi security updates; configuration is a JSON object.

Manual use: raspi-os-security-update --force bypasses ONLY the night window.
The release marker, exclusive lock, blacklist and simulation gate still apply.
"""

import argparse
from datetime import datetime
import fcntl
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time


DEFAULT_BLACKLIST = [
    r"^docker-ce$", r"^docker-ce-cli$", r"^docker-ce-rootless-extras$",
    r"^containerd[.]io$", r"^docker-buildx-plugin$", r"^docker-compose-plugin$",
    r"^tailscale$", r"^linux-image", r"^linux-headers", r"^linux-kbuild",
    r"^raspi-firmware$", r"^raspberrypi-(kernel|bootloader)", r"^rpi-eeprom",
    r"^firmware-", r"^initramfs-tools",
]
DEFAULTS = {
    "mode": "dry-run",
    "blacklist": DEFAULT_BLACKLIST,
    "allowlist": [r"^chromium", r"^rpi-chromium-mods$"],
    "browserUnit": "",
    "stateDir": "/var/lib/raspi-os-security-update",
    "windowStartHour": 0,
    "windowEndHour": 5,
    "releaseMarker": "/run/raspi-release/active",
    "releaseMarkerMaxAgeSeconds": 4 * 3600,
    "lockPath": "/run/lock/raspi-os-security-update.lock",
}
LOG_PATH = Path("/var/log/raspi-os-security-update.log")
APT_ENV = {
    "LC_ALL": "C",
    "DEBIAN_FRONTEND": "noninteractive",
    "NEEDRESTART_MODE": "l",
    "NEEDRESTART_SUSPEND": "1",
    "APT_LISTCHANGES_FRONTEND": "none",
}


def matches(name, patterns):
    # apt may qualify dependency names with :arm64 in its simulation output.
    return any(re.search(pattern, name.split(":", 1)[0]) for pattern in patterns)


def security_origin(version):
    return any(origin["origin"] == "Debian" and origin["label"] == "Debian-Security"
               for origin in version["origins"])


def rpi_origin(version):
    return any(origin["origin"] == "Raspberry Pi Foundation" for origin in version["origins"])


def without_epoch(version):
    return version.split(":", 1)[-1]


def eligible_candidate(name, candidate, versions, allowlist):
    if security_origin(candidate):
        return True
    if not rpi_origin(candidate):
        return False
    if matches(name, allowlist):
        return True
    upstream = re.sub(r"\+rpt[0-9]+$", "", without_epoch(candidate["version"]))
    return any(security_origin(version) and upstream == without_epoch(version["version"])
               for version in versions)


def select_updates(packages, blacklist, allowlist, version_compare):
    """Pure selector. Each package has name, installed, candidate and versions."""
    selected, held_back = [], []
    for package in packages:
        candidate = package["candidate"]
        installed = package["installed"]
        if not installed or not candidate or version_compare(candidate["version"], installed) <= 0:
            continue
        name = package["name"]
        if matches(name, blacklist):
            held_back.append(name)
        elif eligible_candidate(name, candidate, package["versions"], allowlist):
            selected.append({"name": name, "from": installed, "to": candidate["version"]})
    return sorted(selected, key=lambda item: item["name"]), sorted(held_back)


def simulation_failure(output, blacklist):
    for line in output.splitlines():
        if line.startswith("Remv "):
            return "would_remove_packages"
    for line in output.splitlines():
        if line.startswith("Inst ") and matches(line.split()[1], blacklist):
            return "blocked_by_protected_package"
    return None


def in_night_window(hour, start, end):
    if start <= end:
        return start <= hour < end
    return hour >= start or hour < end


def release_is_active(mtime, now, max_age):
    # A future timestamp is conservative too (clock corrections).
    return mtime is not None and now - mtime < max_age


def next_state(previous, mode, result, now, reason=None, selected=None,
               installed=None, held_back=None, browser_restarted=False):
    state = {
        "schemaVersion": 1, "mode": mode, "result": result, "reason": reason,
        "lastRunAt": now, "lastSuccessAt": previous.get("lastSuccessAt"),
        "lastFailureAt": previous.get("lastFailureAt"),
        "enabledAt": previous.get("enabledAt") or now,
        "installed": installed or [], "selected": selected or [],
        "heldBack": held_back or [], "browserRestarted": browser_restarted,
    }
    if result.startswith("skipped_"):
        # Preserve the previous report as well as success/failure timestamps.
        for key in state:
            if key not in {"result", "lastRunAt", "reason"} and key in previous:
                state[key] = previous[key]
        state["reason"] = None
    elif result == "success":
        state["lastSuccessAt"] = now
    elif result == "failed":
        state["lastFailureAt"] = now
    return state


def read_state(path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {}


def write_state(path, state):
    path.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=".state-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            os.fchmod(stream.fileno(), 0o644)
            json.dump(state, stream, ensure_ascii=False)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def command(argv):
    return subprocess.run(argv, env={**os.environ, **APT_ENV}, text=True,
                          stdout=subprocess.PIPE, stderr=subprocess.STDOUT, check=False)


def apt_selection(config):
    # Import lazily: pure functions and guard tests do not require python3-apt.
    import apt
    import apt_pkg

    def version_data(version):
        return {"version": version.version,
                "origins": [{"origin": origin.origin, "label": origin.label}
                            for origin in version.origins]}

    with apt.Cache() as cache:
        packages = ({"name": package.name,
                     "installed": package.installed.version if package.installed else None,
                     "candidate": version_data(package.candidate) if package.candidate else None,
                     "versions": [version_data(version) for version in package.versions]}
                    for package in cache if package.is_installed)
        return select_updates(packages, config["blacklist"], config["allowlist"], apt_pkg.version_compare)


def chromium_version():
    result = command(["dpkg-query", "-W", "-f=${Version}", "chromium"])
    return result.stdout.strip() if result.returncode == 0 else ""


def run(config, force=False):
    path = Path(config["stateDir"]) / "state.json"
    selected, installed, held_back = [], [], []
    browser_restarted = False

    def finish(result, reason=None):
        now = datetime.now().astimezone().isoformat(timespec="seconds")
        path.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
        # A skipped_locked run can report concurrently with the updater that
        # owns the execution lock. Serialize read/replace so it cannot erase a
        # success timestamp written between its read and atomic rename.
        with (path.parent / ".state.lock").open("a") as state_lock:
            fcntl.flock(state_lock, fcntl.LOCK_EX)
            state = next_state(read_state(path), config["mode"], result, now, reason,
                               selected, installed, held_back, browser_restarted)
            write_state(path, state)
        with LOG_PATH.open("a", encoding="utf-8") as stream:
            stream.write(f"{now} mode={config['mode']} result={result} reason={reason or '-'} "
                         f"selected={len(selected)} installed={len(installed)} "
                         f"heldBack={','.join(held_back) or '-'} browserRestarted={browser_restarted}\n")
        return 1 if result == "failed" else 0

    with open(config["lockPath"], "a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return finish("skipped_locked")
        try:
            if not force and not in_night_window(datetime.now().astimezone().hour,
                                                  config["windowStartHour"], config["windowEndHour"]):
                return finish("skipped_window")
            try:
                mtime = Path(config["releaseMarker"]).stat().st_mtime
            except FileNotFoundError:
                mtime = None
            if release_is_active(mtime, time.time(), config["releaseMarkerMaxAgeSeconds"]):
                return finish("skipped_release")
            if command(["apt-get", "update", "-o", "DPkg::Lock::Timeout=600",
                        "-o", "APT::Update::Error-Mode=any"]).returncode:
                return finish("failed", "apt_update_failed")
            selected, held_back = apt_selection(config)
            if selected:
                packages = [f"{item['name']}={item['to']}" for item in selected]
                options = ["install", "--only-upgrade", "--no-install-recommends"]
                simulation = command(["apt-get", "-s", *options, *packages])
                reason = simulation_failure(simulation.stdout, config["blacklist"])
                if reason:
                    return finish("failed", reason)
                if simulation.returncode:
                    return finish("failed", "apt_simulation_failed")
                if config["mode"] == "apply":
                    before = chromium_version()
                    result = command(["apt-get", *options, "-y",
                                      "-o", "Dpkg::Options::=--force-confdef",
                                      "-o", "Dpkg::Options::=--force-confold",
                                      "-o", "DPkg::Lock::Timeout=600", *packages])
                    if result.returncode:
                        return finish("failed", "apt_install_failed")
                    installed = list(selected)
                    after = chromium_version()
                    unit = config["browserUnit"]
                    if before != after and unit and command(["systemctl", "is-active", unit]).returncode == 0:
                        if command(["systemctl", "restart", unit]).returncode:
                            return finish("failed", "browser_restart_failed")
                        browser_restarted = True
            return finish("success")
        except (OSError, ValueError, RuntimeError, ImportError) as error:
            print(f"OS security update failed: {error}", flush=True)
            return finish("failed", "updater_error")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", default="/etc/raspi-os-security-update.conf")
    parser.add_argument("--force", action="store_true", help="bypass only the local night window")
    args = parser.parse_args()
    config = {**DEFAULTS, **json.loads(Path(args.config).read_text())}
    if config["mode"] not in {"apply", "dry-run"}:
        parser.error("mode must be apply or dry-run")
    if not (0 <= config["windowStartHour"] <= 23 and 0 <= config["windowEndHour"] <= 24):
        parser.error("invalid night window hours")
    for pattern in config["blacklist"] + config["allowlist"]:
        re.compile(pattern)
    return run(config, args.force)


if __name__ == "__main__":
    raise SystemExit(main())
