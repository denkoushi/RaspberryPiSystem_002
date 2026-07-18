#!/usr/bin/env python3
"""Read-only, aggregate terminal preflight before release-unit submission.

The operator sends this standard-library-only source to Pi5.  Pi5 holds the
fleet lock and invokes the same source on every selected terminal over SSH.
Each target reports every known provisioning/runtime prerequisite in one
machine-readable result.  No checkout, maintenance notice, config write,
service transition, container mutation, or release unit exists at this point.
"""
from __future__ import annotations

import base64
import binascii
import fcntl
import ipaddress
import json
import os
import pwd
import re
import shlex
import shutil
import stat
import subprocess
import sys
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence


EX_OK = 0
EX_SOFTWARE = 70
EX_TEMPFAIL = 75
EX_CONFIG = 78
FULL_SHA_RE = re.compile(r"^[0-9a-f]{40}$")
RUN_ID_RE = re.compile(r"^[0-9]{8}-[0-9]{6}-[0-9a-f]{6}$")
HOST_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,254}$")
USER_RE = re.compile(r"^[a-z_][a-z0-9_-]{0,31}$")
UNIT_RE = re.compile(
    r"^[A-Za-z0-9][A-Za-z0-9_.@:-]{0,126}\.(?:service|timer|socket|path|target|mount)$"
)
TARGET_MARKER_RE = re.compile(
    r"TERMINAL_PREFLIGHT_RESULT:([A-Za-z0-9_-]+={0,2})(?![A-Za-z0-9_=-])"
)
ALLOWED_UNTRACKED = frozenset({"power-actions"})
_BASE_CANDIDATE_ARTIFACTS = (
    ("infrastructure/ansible/playbooks/deploy-staged.yml", "blob"),
    ("infrastructure/ansible/roles/common/tasks/main.yml", "blob"),
    ("scripts/deploy/rollback-manifest.py", "blob"),
    ("scripts/deploy/terminal-runtime-manifest.py", "blob"),
    ("scripts/deploy/terminal-agent-health-probe.py", "blob"),
)
_PROFILE_CANDIDATE_ARTIFACTS = {
    "kiosk": (
        ("infrastructure/ansible/roles/client/tasks/main.yml", "blob"),
    ),
    "signage": (
        ("infrastructure/ansible/roles/signage/tasks/main.yml", "blob"),
    ),
}
_FEATURE_CANDIDATE_ARTIFACTS = {
    "nfcEnabled": (
        ("clients/nfc-agent", "tree"),
        ("infrastructure/ansible/roles/client/tasks/nfc-agent.yml", "blob"),
        ("infrastructure/ansible/roles/client/tasks/nfc-agent-lifecycle.yml", "blob"),
        ("infrastructure/ansible/templates/nfc-agent.env.j2", "blob"),
        ("infrastructure/docker/Dockerfile.nfc-agent", "blob"),
        ("infrastructure/docker/docker-compose.client.yml", "blob"),
    ),
    "barcodeEnabled": (
        ("clients/barcode-agent", "tree"),
        ("infrastructure/ansible/roles/client/tasks/barcode-agent.yml", "blob"),
        ("infrastructure/ansible/roles/client/tasks/barcode-agent-lifecycle.yml", "blob"),
        ("infrastructure/ansible/templates/barcode-agent.env.j2", "blob"),
        ("infrastructure/docker/Dockerfile.barcode-agent", "blob"),
        ("infrastructure/docker/docker-compose.client.yml", "blob"),
    ),
    "torqueEnabled": (
        ("clients/torque-agent", "tree"),
        ("infrastructure/ansible/roles/client/tasks/torque-agent.yml", "blob"),
        ("infrastructure/ansible/roles/client/tasks/torque-agent-lifecycle.yml", "blob"),
        ("infrastructure/ansible/templates/torque-agent.env.j2", "blob"),
        ("infrastructure/docker/Dockerfile.torque-agent", "blob"),
        ("infrastructure/docker/docker-compose.client.yml", "blob"),
    ),
    "haizenEnabled": (
        ("clients/haizen-agent", "tree"),
        ("infrastructure/ansible/roles/client/tasks/haizen-agent.yml", "blob"),
    ),
}
TARGET_LOADER = (
    "import base64,sys;source,payload=sys.argv[1:];"
    "sys.argv=['terminal-preflight',base64.b64decode(payload).decode('utf-8')];"
    "exec(compile(base64.b64decode(source),'<terminal-preflight>','exec'),"
    "{'__name__':'__main__','EMBEDDED_TERMINAL_PREFLIGHT_SOURCE':base64.b64decode(source).decode('utf-8')})"
)


class TerminalPreflightConfigError(ValueError):
    """The preflight contract is malformed or unsafe."""


def _safe_path(value: Any, *, name: str) -> str:
    if (
        not isinstance(value, str)
        or not value.startswith("/")
        or os.path.normpath(value) != value
        or "\x00" in value
        or len(value) > 4096
    ):
        raise TerminalPreflightConfigError(f"{name} is not a normalized absolute path")
    return value


def _require_bool(payload: Mapping[str, Any], key: str) -> bool:
    value = payload.get(key)
    if type(value) is not bool:
        raise TerminalPreflightConfigError(f"{key} must be boolean")
    return value


def parse_spec(raw: str) -> dict[str, Any]:
    try:
        payload = json.loads(raw)
    except (TypeError, json.JSONDecodeError) as error:
        raise TerminalPreflightConfigError("terminal preflight is not valid JSON") from error
    if not isinstance(payload, dict) or payload.get("version") != 1:
        raise TerminalPreflightConfigError("unsupported terminal preflight version")
    mode = payload.get("mode")
    if mode == "orchestrator":
        expected = {
            "version",
            "mode",
            "project",
            "runId",
            "sha",
            "expectedServerClientId",
            "targets",
        }
        if set(payload) != expected:
            raise TerminalPreflightConfigError("orchestrator fields do not match version 1")
        _safe_path(payload.get("project"), name="project")
        if not isinstance(payload.get("runId"), str) or RUN_ID_RE.fullmatch(payload["runId"]) is None:
            raise TerminalPreflightConfigError("runId is malformed")
        if not isinstance(payload.get("sha"), str) or FULL_SHA_RE.fullmatch(payload["sha"]) is None:
            raise TerminalPreflightConfigError("sha is malformed")
        if not isinstance(payload.get("expectedServerClientId"), str) or re.fullmatch(
            r"[A-Za-z0-9][A-Za-z0-9._:-]{0,127}", payload["expectedServerClientId"]
        ) is None:
            raise TerminalPreflightConfigError("expectedServerClientId is malformed")
        targets = payload.get("targets")
        if not isinstance(targets, list) or len(targets) > 100:
            raise TerminalPreflightConfigError("targets must be a bounded list")
        for target in targets:
            _validate_target(target, routing=True)
        return payload
    if mode == "target":
        _validate_target(payload, routing=False)
        return payload
    raise TerminalPreflightConfigError("terminal preflight mode is unsupported")


def _validate_target(payload: Any, *, routing: bool) -> None:
    expected = {
        "version",
        "mode",
        "host",
        "profile",
        "address",
        "user",
        "port",
        "repoPath",
        "memoryRequiredMb",
        "tailscaleEnabled",
        "servicesToRestart",
        "manageKioskBrowser",
        "kioskBrowserEngine",
        "firefoxMinimizeChrome",
        "clamavEnabled",
        "clamavLogDir",
        "clamavCron",
        "rkhunterEnabled",
        "rkhunterLogDir",
        "rkhunterCron",
        "nfcEnabled",
        "nfcContractValid",
        "barcodeEnabled",
        "barcodeSerialDevice",
        "torqueEnabled",
        "torqueContractValid",
        "haizenEnabled",
        "haizenHidDevice",
        "haizenInstallEvdev",
        "manageSignage",
        "inventoryIssues",
    }
    if not isinstance(payload, dict) or set(payload) != expected:
        raise TerminalPreflightConfigError("target fields do not match version 1")
    if payload.get("version") != 1 or payload.get("mode") != "target":
        raise TerminalPreflightConfigError("target mode is malformed")
    if not isinstance(payload.get("host"), str) or HOST_RE.fullmatch(payload["host"]) is None:
        raise TerminalPreflightConfigError("host is malformed")
    address = payload.get("address")
    if not isinstance(address, str):
        raise TerminalPreflightConfigError("address is malformed")
    try:
        parsed_address = ipaddress.ip_address(address)
    except ValueError:
        if HOST_RE.fullmatch(address) is None or re.fullmatch(r"[0-9.]+", address):
            raise TerminalPreflightConfigError("address is malformed") from None
    else:
        # IPv6 is intentionally unsupported until the SSH command contract
        # carries bracketed-address handling and dedicated tests.
        if parsed_address.version != 4:
            raise TerminalPreflightConfigError("address is malformed")
    if payload.get("profile") not in {"kiosk", "signage"}:
        raise TerminalPreflightConfigError("profile is unsupported")
    if not isinstance(payload.get("user"), str) or USER_RE.fullmatch(payload["user"]) is None:
        raise TerminalPreflightConfigError("user is malformed")
    if type(payload.get("port")) is not int or not 1 <= payload["port"] <= 65535:
        raise TerminalPreflightConfigError("port is malformed")
    _safe_path(payload.get("repoPath"), name="repoPath")
    for key in ("clamavLogDir", "rkhunterLogDir", "barcodeSerialDevice", "haizenHidDevice"):
        _safe_path(payload.get(key), name=key)
    if type(payload.get("memoryRequiredMb")) is not int or not 1 <= payload["memoryRequiredMb"] <= 65536:
        raise TerminalPreflightConfigError("memoryRequiredMb is malformed")
    for key in (
        "tailscaleEnabled",
        "manageKioskBrowser",
        "firefoxMinimizeChrome",
        "clamavEnabled",
        "rkhunterEnabled",
        "nfcEnabled",
        "nfcContractValid",
        "barcodeEnabled",
        "torqueEnabled",
        "torqueContractValid",
        "haizenEnabled",
        "haizenInstallEvdev",
        "manageSignage",
    ):
        _require_bool(payload, key)
    services = payload.get("servicesToRestart")
    if not isinstance(services, list) or any(
        not isinstance(unit, str) or UNIT_RE.fullmatch(unit) is None for unit in services
    ):
        raise TerminalPreflightConfigError("servicesToRestart is malformed")
    issues = payload.get("inventoryIssues")
    if not isinstance(issues, list) or any(
        not isinstance(issue, str) or re.fullmatch(r"[a-z0-9.-]{1,100}", issue) is None
        for issue in issues
    ):
        raise TerminalPreflightConfigError("inventoryIssues is malformed")
    for key in ("kioskBrowserEngine", "clamavCron", "rkhunterCron"):
        value = payload.get(key)
        if not isinstance(value, str) or not value or "\x00" in value or len(value) > 512:
            raise TerminalPreflightConfigError(f"{key} is malformed")
    if routing and payload.get("mode") != "target":
        raise TerminalPreflightConfigError("routing target mode is malformed")


def _read_server_client_id(path: str = "/etc/raspi-status-agent.conf") -> str:
    flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(path, flags)
    try:
        if not stat.S_ISREG(os.fstat(descriptor).st_mode):
            raise OSError("status-agent config is not a regular file")
        payload = os.read(descriptor, 65537)
    finally:
        os.close(descriptor)
    if len(payload) > 65536:
        raise OSError("status-agent config is too large")
    pattern = re.compile(
        r'''^[ \t]*CLIENT_ID[ \t]*=[ \t]*(?:"([A-Za-z0-9][A-Za-z0-9._:-]{0,127})"|'([A-Za-z0-9][A-Za-z0-9._:-]{0,127})'|([A-Za-z0-9][A-Za-z0-9._:-]{0,127}))[ \t]*(?:#.*)?$'''
    )
    values = [
        next(value for value in match.groups() if value is not None)
        for line in payload.decode("utf-8").splitlines()
        if (match := pattern.fullmatch(line)) is not None
    ]
    if len(values) != 1:
        raise OSError("status-agent CLIENT_ID is missing or duplicated")
    return values[0]


def _default_run(argv: Sequence[str], *, timeout: int = 20) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        list(argv), text=True, capture_output=True, check=False, timeout=timeout
    )


def _command(argv: Sequence[str], *, timeout: int = 10) -> subprocess.CompletedProcess[str]:
    try:
        return _default_run(argv, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as error:
        return subprocess.CompletedProcess(list(argv), 127, "", str(error))


def _candidate_artifact_contract(
    targets: Sequence[Mapping[str, Any]],
) -> tuple[tuple[str, str], ...]:
    """Return candidate-owned paths needed by the selected release graph."""

    artifacts = set(_BASE_CANDIDATE_ARTIFACTS)
    for target in targets:
        artifacts.update(_PROFILE_CANDIDATE_ARTIFACTS[target["profile"]])
        for flag, required in _FEATURE_CANDIDATE_ARTIFACTS.items():
            if target[flag]:
                artifacts.update(required)
    return tuple(sorted(artifacts))


def _candidate_artifact_issues(
    spec: Mapping[str, Any],
    *,
    run_command: Callable[..., Any] = _default_run,
) -> list[dict[str, str]]:
    """Validate candidate-owned artifacts on Pi5 without checking them out."""

    project = str(spec["project"])
    sha = str(spec["sha"])
    try:
        commit = run_command(
            ["/usr/bin/git", "-C", project, "cat-file", "-e", f"{sha}^{{commit}}"],
            timeout=20,
        )
    except (OSError, subprocess.TimeoutExpired):
        return [
            {
                "code": "candidate.inspect",
                "message": "immutable candidate commit could not be inspected on Pi5",
            }
        ]
    if getattr(commit, "returncode", 1) != 0:
        return [
            {
                "code": "candidate.commit",
                "message": "immutable candidate commit is unavailable on Pi5",
            }
        ]

    issues: list[dict[str, str]] = []
    for path, expected_type in _candidate_artifact_contract(spec["targets"]):
        try:
            result = run_command(
                ["/usr/bin/git", "-C", project, "cat-file", "-t", f"{sha}:{path}"],
                timeout=20,
            )
        except (OSError, subprocess.TimeoutExpired):
            _issue(
                issues,
                "candidate.artifact-read",
                f"candidate artifact could not be inspected: {path}",
            )
            continue
        observed_type = str(getattr(result, "stdout", "")).strip()
        if getattr(result, "returncode", 1) != 0:
            _issue(
                issues,
                "candidate.artifact-missing",
                f"required candidate artifact is missing: {path}",
            )
        elif observed_type != expected_type:
            _issue(
                issues,
                "candidate.artifact-type",
                f"candidate artifact must be a Git {expected_type}: {path}",
            )
    return issues


def _issue(issues: list[dict[str, str]], code: str, message: str) -> None:
    issues.append({"code": code, "message": message})


def _require_command(issues: list[dict[str, str]], name: str) -> None:
    if shutil.which(name) is None:
        _issue(issues, f"command.{name}", f"required command is missing: {name}")


def _require_packages(issues: list[dict[str, str]], names: Sequence[str]) -> None:
    for name in names:
        result = _command(["/usr/bin/dpkg-query", "-W", "-f=${Status}", name])
        if result.returncode != 0 or result.stdout.strip() != "install ok installed":
            _issue(issues, f"package.{name}", f"required package is not installed: {name}")


def _require_directory(
    issues: list[dict[str, str]],
    path: str,
    code: str,
    *,
    owner: str | None = None,
    mode: int | None = None,
) -> None:
    try:
        current = os.stat(path, follow_symlinks=False)
    except OSError:
        _issue(issues, code, f"required directory is missing: {path}")
        return
    if not stat.S_ISDIR(current.st_mode):
        _issue(issues, code, f"required path is not a directory: {path}")
        return
    if owner is not None:
        try:
            expected_uid = pwd.getpwnam(owner).pw_uid
        except KeyError:
            _issue(issues, f"identity.{owner}", f"required user is missing: {owner}")
        else:
            if current.st_uid != expected_uid:
                _issue(issues, code, f"directory owner is not {owner}: {path}")
    if mode is not None and stat.S_IMODE(current.st_mode) != mode:
        _issue(issues, code, f"directory mode must be {mode:04o}: {path}")


def _require_file(issues: list[dict[str, str]], path: str, code: str) -> None:
    try:
        current = os.stat(path, follow_symlinks=False)
    except OSError:
        _issue(issues, code, f"required file is missing: {path}")
        return
    if not stat.S_ISREG(current.st_mode):
        _issue(issues, code, f"required path is not a regular file: {path}")


def _systemctl_value(*arguments: str) -> subprocess.CompletedProcess[str]:
    return _command(["/usr/bin/systemctl", *arguments])


def _require_unit(
    issues: list[dict[str, str]],
    unit: str,
    *,
    loaded: bool = False,
    active: bool = False,
    enabled: bool = False,
) -> None:
    if loaded:
        result = _systemctl_value("show", "--property=LoadState", "--value", unit)
        if result.returncode != 0 or result.stdout.strip() != "loaded":
            _issue(issues, f"unit.{unit}.loaded", f"systemd unit is not loaded: {unit}")
    if active:
        result = _systemctl_value("is-active", unit)
        if result.returncode != 0 or result.stdout.strip() != "active":
            _issue(issues, f"unit.{unit}.active", f"systemd unit is not active: {unit}")
    if enabled:
        result = _systemctl_value("is-enabled", unit)
        if result.returncode != 0 or result.stdout.strip() != "enabled":
            _issue(issues, f"unit.{unit}.enabled", f"systemd unit is not enabled: {unit}")


def _unit_exists(unit: str) -> bool:
    result = _systemctl_value("show", "--property=LoadState", "--value", unit)
    return result.returncode == 0 and result.stdout.strip() == "loaded"


def _check_repository(spec: Mapping[str, Any], issues: list[dict[str, str]]) -> None:
    repo = str(spec["repoPath"])
    _require_directory(issues, repo, "repo.directory")
    _require_directory(issues, os.path.join(repo, ".git"), "repo.git")
    if any(issue["code"] in {"repo.directory", "repo.git"} for issue in issues):
        return
    commands = (
        ["/usr/bin/git", "-c", f"safe.directory={repo}", "-C", repo, "diff", "--quiet"],
        ["/usr/bin/git", "-c", f"safe.directory={repo}", "-C", repo, "diff", "--cached", "--quiet"],
        ["/usr/bin/git", "-c", f"safe.directory={repo}", "-C", repo, "ls-files", "-u"],
    )
    for command in commands:
        result = _command(command)
        if result.returncode != 0 or (command[-2:] == ["ls-files", "-u"] and result.stdout):
            _issue(issues, "repo.index", "terminal repository index is not clean")
            break
    status_result = _command(
        [
            "/usr/bin/git",
            "-c",
            f"safe.directory={repo}",
            "-C",
            repo,
            "status",
            "--porcelain=v1",
            "--untracked-files=all",
        ]
    )
    if status_result.returncode != 0:
        _issue(issues, "repo.status", "terminal repository status cannot be read")
    else:
        blocking = []
        for line in status_result.stdout.splitlines():
            if not line:
                continue
            path = line[3:] if len(line) > 3 else ""
            if line.startswith("?? ") and path.split("/", 1)[0] in ALLOWED_UNTRACKED:
                continue
            blocking.append(line[:2])
        if blocking:
            _issue(issues, "repo.dirty", "terminal repository contains tracked or unapproved untracked changes")
    head = _command(
        ["/usr/bin/git", "-c", f"safe.directory={repo}", "-C", repo, "rev-parse", "--verify", "HEAD"]
    )
    if head.returncode != 0 or FULL_SHA_RE.fullmatch(head.stdout.strip()) is None:
        _issue(issues, "repo.head", "terminal repository HEAD is not an immutable commit")


def _check_network(spec: Mapping[str, Any], issues: list[dict[str, str]]) -> None:
    _require_command(issues, "nmcli")
    _require_unit(issues, "NetworkManager.service", active=True)
    path = "/etc/NetworkManager/NetworkManager.conf"
    try:
        lines = Path(path).read_text(encoding="utf-8").splitlines()
    except (OSError, UnicodeError):
        _issue(issues, "networkmanager.policy", "NetworkManager policy cannot be read")
    else:
        main_count = 0
        auth_count = 0
        desired_count = 0
        in_main = False
        for raw in lines:
            line = raw.strip()
            if line == "[main]":
                main_count += 1
                in_main = True
                continue
            if line.startswith("["):
                in_main = False
            if line.startswith("auth-polkit="):
                auth_count += 1
                if in_main and line == "auth-polkit=false":
                    desired_count += 1
        if (main_count, auth_count, desired_count) != (1, 1, 1):
            _issue(issues, "networkmanager.policy", "NetworkManager auth-polkit baseline is not provisioned")
    if spec["tailscaleEnabled"]:
        _require_unit(issues, "tailscaled.service", active=True)
        _require_command(issues, "tailscale")
        status_result = _command(["/usr/bin/tailscale", "status", "--json"])
        try:
            running = json.loads(status_result.stdout).get("BackendState") == "Running"
        except (json.JSONDecodeError, AttributeError):
            running = False
        if status_result.returncode != 0 or not running:
            _issue(issues, "tailscale.backend", "Tailscale backend is not Running")
        interface = _command(["/usr/sbin/ip", "-brief", "addr", "show", "tailscale0"])
        if interface.returncode != 0:
            _issue(issues, "tailscale.interface", "tailscale0 interface is missing")


def _check_resources(spec: Mapping[str, Any], issues: list[dict[str, str]]) -> None:
    try:
        memory = Path("/proc/meminfo").read_text(encoding="ascii")
        available_kib = int(re.search(r"^MemAvailable:\s+(\d+)\s+kB$", memory, re.MULTILINE).group(1))
    except (OSError, AttributeError, ValueError):
        _issue(issues, "resource.memory-read", "available memory cannot be determined")
    else:
        if available_kib // 1024 < spec["memoryRequiredMb"]:
            _issue(
                issues,
                "resource.memory",
                f"available memory is below {spec['memoryRequiredMb']} MB",
            )
    try:
        disk = shutil.disk_usage("/opt")
        used_percent = int((disk.used * 100) / disk.total)
    except (OSError, ZeroDivisionError):
        _issue(issues, "resource.disk-read", "/opt disk usage cannot be determined")
    else:
        if used_percent >= 90:
            _issue(issues, "resource.disk", "/opt disk usage is 90 percent or higher")


def _check_cron(
    issues: list[dict[str, str]], *, code: str, label: str, schedule: str, executable: str
) -> None:
    result = _command(["/usr/bin/crontab", "-u", "root", "-l"])
    expected_comment = f"#Ansible: {label}"
    expected_job = f"{schedule} {executable} >/dev/null 2>&1"
    lines = result.stdout.splitlines() if result.returncode == 0 else []
    if (
        lines.count(expected_comment) != 1
        or lines.count(expected_job) != 1
        or sum(executable in line for line in lines) != 1
    ):
        _issue(issues, code, f"provisioned cron entry is missing or duplicated: {label}")


def run_target_probe(spec: Mapping[str, Any]) -> dict[str, Any]:
    issues: list[dict[str, str]] = []
    for code in spec["inventoryIssues"]:
        _issue(issues, code, "inventory contract is incomplete or invalid")
    _check_repository(spec, issues)
    _require_unit(issues, "lightdm.service", loaded=True, active=True)
    _check_network(spec, issues)
    _check_resources(spec, issues)
    _require_unit(issues, "status-agent.timer", enabled=True)
    _require_directory(issues, "/etc/polkit-1/rules.d", "polkit.directory")
    for unit in spec["servicesToRestart"]:
        if _unit_exists(unit):
            _require_unit(issues, unit, enabled=True)

    docker_required = False
    if spec["nfcEnabled"]:
        _require_packages(issues, ("pcscd", "pcsc-tools"))
        # Debian/Raspberry Pi OS uses socket activation.  pcscd.service is
        # expected to be indirect and may be inactive while the enabled socket
        # and communication endpoint are healthy.
        _require_unit(issues, "pcscd.socket", loaded=True, active=True, enabled=True)
        try:
            socket_state = os.stat("/run/pcscd/pcscd.comm")
        except OSError:
            _issue(issues, "nfc.pcsc-socket", "PC/SC communication socket is missing")
        else:
            if not stat.S_ISSOCK(socket_state.st_mode):
                _issue(issues, "nfc.pcsc-socket", "PC/SC communication path is not a socket")
        docker_required = True
    if spec["barcodeEnabled"]:
        docker_required = True
    if spec["torqueEnabled"]:
        _require_directory(issues, "/usr/local/libexec", "torque.helper-directory")
        docker_required = True
    if docker_required:
        _require_command(issues, "docker")
        _require_unit(issues, "docker.service", active=True)
        docker = _command(["/usr/bin/docker", "info"], timeout=15)
        if docker.returncode != 0:
            _issue(issues, "docker.runtime", "Docker daemon is unavailable to the release user")

    if spec["haizenEnabled"]:
        if spec["haizenInstallEvdev"] and spec["haizenHidDevice"]:
            _require_packages(issues, ("python3-evdev",))
        _require_unit(issues, "haizen-agent.service", loaded=True, enabled=True)

    if spec["profile"] == "kiosk" and spec["manageKioskBrowser"]:
        engine = spec["kioskBrowserEngine"]
        if engine == "chromium":
            _require_file(issues, "/usr/bin/chromium", "kiosk.chromium")
            try:
                target = os.readlink("/usr/bin/chromium-browser")
            except OSError:
                _issue(issues, "kiosk.chromium-link", "chromium-browser compatibility link is missing")
            else:
                if target != "/usr/bin/chromium":
                    _issue(issues, "kiosk.chromium-link", "chromium-browser link has the wrong target")
        elif engine == "firefox":
            if not (os.path.isfile("/usr/bin/firefox-esr") or os.path.isfile("/usr/bin/firefox")):
                _issue(issues, "kiosk.firefox", "Firefox kiosk executable is missing")
            if spec["firefoxMinimizeChrome"]:
                profile = f"/home/{spec['user']}/.mozilla/firefox/kiosk-system"
                _require_directory(issues, profile, "kiosk.firefox-profile")
                _require_directory(issues, f"{profile}/chrome", "kiosk.firefox-chrome")
        else:
            _issue(issues, "inventory.kiosk-browser-engine", "unsupported kiosk browser engine")
        labwc = f"/home/{spec['user']}/.config/labwc"
        _require_directory(issues, labwc, "kiosk.labwc-directory")
        _require_file(issues, f"{labwc}/rc.xml", "kiosk.labwc-config")

    if spec["profile"] == "kiosk":
        _require_directory(issues, spec["clamavLogDir"], "kiosk.clamav-log", owner="root", mode=0o755)
        _require_directory(issues, spec["rkhunterLogDir"], "kiosk.rkhunter-log", owner="root", mode=0o755)
        if spec["clamavEnabled"]:
            _require_packages(issues, ("clamav", "clamav-freshclam"))
            _check_cron(
                issues,
                code="kiosk.clamav-cron",
                label="Weekly ClamAV scan (kiosk)",
                schedule=spec["clamavCron"],
                executable="/usr/local/bin/clamav-kiosk-scan.sh",
            )
        if spec["rkhunterEnabled"]:
            _require_packages(issues, ("rkhunter",))
            _check_cron(
                issues,
                code="kiosk.rkhunter-cron",
                label="Weekly rkhunter scan (kiosk)",
                schedule=spec["rkhunterCron"],
                executable="/usr/local/bin/rkhunter-kiosk-scan.sh",
            )

    if spec["profile"] == "signage" and spec["manageSignage"]:
        _require_command(issues, "rsvg-convert")
        _require_directory(
            issues, "/run/signage", "signage.runtime-directory", owner=spec["user"], mode=0o755
        )
        for unit in (
            "signage-lite.service",
            "signage-lite-update.timer",
            "signage-lite-watchdog.timer",
            "signage-daily-reboot.timer",
        ):
            _require_unit(issues, unit, loaded=True, enabled=True)

    return {
        "version": 1,
        "host": spec["host"],
        "profile": spec["profile"],
        "ready": not issues,
        "issues": issues,
    }


def _encode_marker(payload: Mapping[str, Any]) -> str:
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii")


def _decode_marker(output: str) -> dict[str, Any]:
    matches = TARGET_MARKER_RE.findall(output)
    if not matches:
        raise ValueError("terminal preflight result marker is missing")
    results: list[dict[str, Any]] = []
    for encoded in matches:
        try:
            raw = base64.b64decode(encoded, altchars=b"-_", validate=True)
            if base64.urlsafe_b64encode(raw).decode("ascii") != encoded:
                raise ValueError("non-canonical marker")
            value = json.loads(raw.decode("utf-8"))
        except (binascii.Error, UnicodeError, json.JSONDecodeError) as error:
            raise ValueError("terminal preflight result marker is malformed") from error
        if not isinstance(value, dict):
            raise ValueError("terminal preflight result is not an object")
        results.append(value)
    if any(value != results[0] for value in results[1:]):
        raise ValueError("terminal preflight result markers disagree")
    return results[0]


def _source_text() -> str:
    embedded = globals().get("EMBEDDED_TERMINAL_PREFLIGHT_SOURCE")
    if isinstance(embedded, str) and embedded.strip():
        return embedded
    source_path = Path(__file__)
    return source_path.read_text(encoding="utf-8")


def _remote_probe_command(target: Mapping[str, Any], source: str) -> list[str]:
    serialized = json.dumps(target, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    remote = shlex.join(
        [
            "/usr/bin/sudo",
            "-n",
            "/usr/bin/python3",
            "-c",
            TARGET_LOADER,
            base64.b64encode(source.encode("utf-8")).decode("ascii"),
            base64.b64encode(serialized.encode("utf-8")).decode("ascii"),
        ]
    )
    return [
        "/usr/bin/ssh",
        "-o",
        "BatchMode=yes",
        "-o",
        "ConnectTimeout=12",
        "-o",
        "ServerAliveInterval=5",
        "-o",
        "ServerAliveCountMax=2",
        "-o",
        "StrictHostKeyChecking=no",
        "-o",
        "UserKnownHostsFile=/dev/null",
        "-p",
        str(target["port"]),
        "--",
        f"{target['user']}@{target['address']}",
        remote,
    ]


def execute_orchestrator(
    spec: Mapping[str, Any],
    *,
    run_command: Callable[..., Any] = _default_run,
    candidate_run_command: Callable[..., Any] = _default_run,
    server_client_id_reader: Callable[[], str] | None = None,
    source: str | None = None,
) -> int:
    project = str(spec["project"])
    lock_path = os.path.join(project, "logs", "deploy", "fleet-release-state.lock")
    descriptor: int | None = None
    try:
        flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0)
        flags |= getattr(os, "O_NOFOLLOW", 0)
        try:
            descriptor = os.open(lock_path, flags)
            if not stat.S_ISREG(os.fstat(descriptor).st_mode):
                raise OSError("fleet lock is not a regular file")
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except (BlockingIOError, OSError) as error:
            print(f"[ERROR] terminal preflight could not acquire the fleet lock: {error}", file=sys.stderr)
            return EX_TEMPFAIL
        try:
            client_id = (server_client_id_reader or _read_server_client_id)()
        except (OSError, UnicodeError) as error:
            print(f"[ERROR] terminal preflight could not verify Pi5 identity: {error}", file=sys.stderr)
            return EX_CONFIG
        if client_id != spec["expectedServerClientId"]:
            print("[ERROR] terminal preflight Pi5 identity mismatch", file=sys.stderr)
            return EX_CONFIG

        probe_source = source or _source_text()
        candidate_issues = _candidate_artifact_issues(
            spec, run_command=candidate_run_command
        )
        results: list[dict[str, Any]] = []
        for target in spec["targets"]:
            command = _remote_probe_command(target, probe_source)
            try:
                completed = run_command(command, timeout=60)
            except (OSError, subprocess.TimeoutExpired) as error:
                results.append(
                    {
                        "version": 1,
                        "host": target["host"],
                        "profile": target["profile"],
                        "ready": False,
                        "issues": [
                            {
                                "code": "transport.failed",
                                "message": f"terminal preflight transport failed: {type(error).__name__}",
                            }
                        ],
                    }
                )
                continue
            output = f"{getattr(completed, 'stdout', '')}\n{getattr(completed, 'stderr', '')}"
            try:
                result = _decode_marker(output)
            except ValueError as error:
                result = {
                    "version": 1,
                    "host": target["host"],
                    "profile": target["profile"],
                    "ready": False,
                    "issues": [{"code": "transport.result", "message": str(error)}],
                }
            results.append(result)

        failures = [result for result in results if result.get("ready") is not True]
        if candidate_issues or failures:
            print("[ERROR] aggregate terminal preflight rejected the release:", file=sys.stderr)
            for issue in candidate_issues:
                print(
                    f"- candidate: {issue.get('code')}: {issue.get('message')}",
                    file=sys.stderr,
                )
            for result in failures:
                for issue in result.get("issues") or []:
                    print(
                        f"- {result.get('host')}: {issue.get('code')}: {issue.get('message')}",
                        file=sys.stderr,
                    )
            issue_count = len(candidate_issues) + sum(
                len(result.get("issues") or []) for result in failures
            )
            scopes = (
                f"candidate and {len(failures)} terminal(s)"
                if candidate_issues
                else f"{len(failures)} terminal(s)"
            )
            print(
                f"[ERROR] {issue_count} issue(s) across {scopes}; "
                "no release unit was submitted",
                file=sys.stderr,
            )
            return EX_CONFIG
        print(
            f"terminal preflight passed for {len(results)} selected terminal(s) at {spec['sha']}"
        )
        return EX_OK
    finally:
        if descriptor is not None:
            os.close(descriptor)


def main(argv: Sequence[str] | None = None) -> int:
    arguments = list(sys.argv[1:] if argv is None else argv)
    if len(arguments) != 1:
        print("[ERROR] terminal preflight requires exactly one JSON specification", file=sys.stderr)
        return EX_CONFIG
    try:
        spec = parse_spec(arguments[0])
    except TerminalPreflightConfigError as error:
        print(f"[ERROR] {error}", file=sys.stderr)
        return EX_CONFIG
    if spec["mode"] == "target":
        result = run_target_probe(spec)
        print(f"TERMINAL_PREFLIGHT_RESULT:{_encode_marker(result)}")
        return EX_OK if result["ready"] else EX_CONFIG
    return execute_orchestrator(spec)


if __name__ == "__main__":
    raise SystemExit(main())
