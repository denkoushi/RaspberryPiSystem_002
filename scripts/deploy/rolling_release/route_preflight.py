#!/usr/bin/env python3
"""Standalone, read-only Pi5 route readiness probe.

The local operator sends this standard-library-only source before a transient
release unit exists.  It checks the exact tools and configuration used by the
later bootstrap/coordinator path, aggregates safe issue codes, and never
checks out source, runs a playbook, builds an image, or changes a service.
"""
from __future__ import annotations

import json
import fcntl
import os
import re
import stat
import subprocess
import sys
from pathlib import Path, PurePosixPath
from typing import Any, Callable, Mapping, Sequence


EX_OK = 0
EX_SOFTWARE = 70
EX_CONFIG = 78
FULL_SHA_RE = re.compile(r"^[0-9a-f]{40}$")
RUN_ID_RE = re.compile(r"^[0-9]{8}-[0-9]{6}-[0-9a-f]{6}$")
EXPECTED_KEYS = frozenset(
    {
        "version",
        "project",
        "runId",
        "sha",
        "inventory",
        "expectedServerClientId",
    }
)
ALLOWED_UNTRACKED = frozenset({"?? power-actions/"})
REQUIRED_CANDIDATE_ARTIFACTS = (
    "scripts/deploy/rolling_release/PROTOCOL",
    "scripts/deploy/rolling-release.py",
    "scripts/deploy/rolling_release/coordinator.py",
    "scripts/deploy/rolling_release/bootstrap.py",
    "scripts/deploy/rolling_release/route_contract.py",
    "scripts/deploy/rolling_release/route_preflight.py",
    "scripts/deploy/rolling_release/backends/ansible.py",
    "scripts/deploy/rolling_release/backends/pi5.py",
    "scripts/deploy/terminal-profile-registry.json",
    "scripts/deploy/pi5-blue-green.sh",
    "infrastructure/ansible/ansible.cfg",
)
REQUIRED_EXECUTABLES = (
    "/usr/bin/git",
    "/usr/bin/python3",
    "/usr/bin/sudo",
    "/usr/bin/systemctl",
    "/usr/bin/systemd-run",
)


class RoutePreflightConfigError(ValueError):
    pass


def parse_spec(raw: str) -> dict[str, Any]:
    try:
        payload = json.loads(raw)
    except (TypeError, json.JSONDecodeError) as error:
        raise RoutePreflightConfigError("route preflight is not valid JSON") from error
    if not isinstance(payload, dict) or set(payload) != EXPECTED_KEYS:
        raise RoutePreflightConfigError("route preflight fields do not match version 1")
    if payload.get("version") != 1 or type(payload.get("version")) is not int:
        raise RoutePreflightConfigError("unsupported route preflight version")
    project = payload.get("project")
    run_id = payload.get("runId")
    sha = payload.get("sha")
    inventory = payload.get("inventory")
    client_id = payload.get("expectedServerClientId")
    if (
        not isinstance(project, str)
        or not os.path.isabs(project)
        or os.path.normpath(project) != project
        or "\x00" in project
    ):
        raise RoutePreflightConfigError("project is malformed")
    if not isinstance(run_id, str) or RUN_ID_RE.fullmatch(run_id) is None:
        raise RoutePreflightConfigError("runId is malformed")
    if not isinstance(sha, str) or FULL_SHA_RE.fullmatch(sha) is None:
        raise RoutePreflightConfigError("sha is malformed")
    if not isinstance(inventory, str) or len(inventory) > 1000 or "\x00" in inventory:
        raise RoutePreflightConfigError("inventory is malformed")
    inventory_path = PurePosixPath(inventory)
    if (
        inventory_path.is_absolute()
        or str(inventory_path) != inventory
        or any(part in {"", ".", ".."} for part in inventory_path.parts)
    ):
        raise RoutePreflightConfigError("inventory must be a normalized relative path")
    if not isinstance(client_id, str) or re.fullmatch(
        r"[A-Za-z0-9][A-Za-z0-9._:-]{0,127}", client_id
    ) is None:
        raise RoutePreflightConfigError("expectedServerClientId is malformed")
    return payload


def _run(
    argv: Sequence[str],
    *,
    cwd: str,
    env: Mapping[str, str] | None = None,
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        list(argv),
        cwd=cwd,
        env=dict(env) if env is not None else None,
        text=True,
        capture_output=True,
        check=False,
        timeout=60,
    )


def _client_id(path: str = "/etc/raspi-status-agent.conf") -> str:
    flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(path, flags)
    try:
        if not stat.S_ISREG(os.fstat(descriptor).st_mode):
            raise OSError("not regular")
        payload = os.read(descriptor, 65537)
    finally:
        os.close(descriptor)
    if len(payload) > 65536:
        raise OSError("too large")
    pattern = re.compile(
        r'''^[ \t]*CLIENT_ID[ \t]*=[ \t]*(?:"([A-Za-z0-9][A-Za-z0-9._:-]{0,127})"|'([A-Za-z0-9][A-Za-z0-9._:-]{0,127})'|([A-Za-z0-9][A-Za-z0-9._:-]{0,127}))[ \t]*(?:#.*)?$'''
    )
    values = [
        next(value for value in match.groups() if value is not None)
        for line in payload.decode("utf-8").splitlines()
        if (match := pattern.fullmatch(line)) is not None
    ]
    if len(values) != 1:
        raise OSError("CLIENT_ID unavailable")
    return values[0]


def _add(issues: list[str], condition: bool, code: str) -> None:
    if not condition and code not in issues:
        issues.append(code)


def _disk_free_mb(path: str) -> int:
    statvfs = os.statvfs(path)
    return statvfs.f_bavail * statvfs.f_frsize // (1024 * 1024)


def _memory_available_mb() -> int:
    memory_text = Path("/proc/meminfo").read_text(encoding="utf-8")
    match = re.search(r"^MemAvailable:\s+(\d+)\s+kB$", memory_text, re.MULTILINE)
    return int(match.group(1)) // 1024 if match else 0


def _acquire_existing_fleet_lock(project: str) -> int:
    path = os.path.join(project, "logs", "deploy", "fleet-release-state.lock")
    flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(path, flags)
    try:
        if not stat.S_ISREG(os.fstat(descriptor).st_mode):
            raise OSError("fleet lock is not regular")
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except (BlockingIOError, OSError):
        os.close(descriptor)
        raise
    return descriptor


def _safe_json_object(path: str, *, maximum_bytes: int = 1024 * 1024) -> bool:
    flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(path, flags)
    try:
        metadata = os.fstat(descriptor)
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_size > maximum_bytes:
            return False
        payload = os.read(descriptor, maximum_bytes + 1)
    finally:
        os.close(descriptor)
    if len(payload) > maximum_bytes:
        return False
    try:
        return isinstance(json.loads(payload.decode("utf-8")), dict)
    except (UnicodeError, json.JSONDecodeError):
        return False


def execute(
    spec: Mapping[str, Any],
    *,
    run_command: Callable[..., Any] = _run,
    client_id_reader: Callable[[], str] = _client_id,
    disk_free_reader: Callable[[str], int] = _disk_free_mb,
    memory_available_reader: Callable[[], int] = _memory_available_mb,
    fleet_lock_acquirer: Callable[[str], int] = _acquire_existing_fleet_lock,
) -> tuple[int, dict[str, Any]]:
    project = str(spec["project"])
    sha = str(spec["sha"])
    issues: list[str] = []
    proofs: list[str] = []
    warnings: list[str] = []
    fleet_lock_descriptor: int | None = None

    _add(issues, os.path.isdir(project), "pi5.project-directory")
    if os.path.isdir(project):
        try:
            fleet_lock_descriptor = fleet_lock_acquirer(project)
            proofs.append("pi5.fleet-lock-held")
        except (BlockingIOError, OSError):
            _add(issues, False, "pi5.fleet-lock")
    for executable in REQUIRED_EXECUTABLES:
        _add(issues, os.path.isfile(executable) and os.access(executable, os.X_OK), f"pi5.executable:{executable}")

    try:
        _add(issues, client_id_reader() == spec["expectedServerClientId"], "pi5.identity")
    except (OSError, UnicodeError):
        _add(issues, False, "pi5.identity")

    if os.path.isdir(project):
        status = run_command(
            ["/usr/bin/git", "status", "--porcelain=v1", "--untracked-files=normal"],
            cwd=project,
        )
        clean = getattr(status, "returncode", 1) == 0 and all(
            not line or line in ALLOWED_UNTRACKED
            for line in str(getattr(status, "stdout", "")).splitlines()
        )
        _add(issues, clean, "pi5.clean-checkout")
        commit = run_command(
            ["/usr/bin/git", "cat-file", "-e", f"{sha}^{{commit}}"], cwd=project
        )
        _add(issues, getattr(commit, "returncode", 1) == 0, "pi5.candidate-commit")
        for artifact in REQUIRED_CANDIDATE_ARTIFACTS:
            result = run_command(
                ["/usr/bin/git", "cat-file", "-e", f"{sha}:{artifact}"], cwd=project
            )
            _add(
                issues,
                getattr(result, "returncode", 1) == 0,
                f"pi5.candidate-artifact:{artifact}",
            )
        protocol = run_command(
            ["/usr/bin/git", "show", f"{sha}:scripts/deploy/rolling_release/PROTOCOL"],
            cwd=project,
        )
        _add(
            issues,
            getattr(protocol, "returncode", 1) == 0
            and str(getattr(protocol, "stdout", "")) == "raspi-rolling-release-v2\n",
            "pi5.candidate-protocol",
        )

    sudo = run_command(
        ["/usr/bin/sudo", "-n", "-l", "/usr/bin/systemd-run"], cwd=project
    ) if os.path.isdir(project) and os.path.isfile("/usr/bin/sudo") else None
    _add(issues, sudo is not None and getattr(sudo, "returncode", 1) == 0, "pi5.systemd-run-sudo")

    ansible_directory = os.path.join(project, "infrastructure", "ansible")
    config = os.path.join(ansible_directory, "ansible.cfg")
    vault = os.path.join(ansible_directory, ".vault-pass")
    inventory = os.path.join(ansible_directory, str(spec["inventory"]))
    _add(issues, os.path.isfile(config), "pi5.ansible-config")
    _add(issues, os.path.isfile(vault) and not os.path.islink(vault), "pi5.ansible-vault")
    _add(issues, os.path.isfile(inventory), "pi5.inventory-file")
    ansible_inventory = "/usr/bin/ansible-inventory"
    _add(issues, os.path.isfile(ansible_inventory) and os.access(ansible_inventory, os.X_OK), "pi5.ansible-inventory")
    if all(os.path.isfile(path) for path in (config, vault, inventory, ansible_inventory)):
        environment = os.environ.copy()
        environment["ANSIBLE_CONFIG"] = config
        expanded = run_command(
            [ansible_inventory, "-i", inventory, "--list"],
            cwd=ansible_directory,
            env=environment,
        )
        valid_inventory = False
        if getattr(expanded, "returncode", 1) == 0:
            try:
                valid_inventory = isinstance(json.loads(str(expanded.stdout)), dict)
            except (TypeError, json.JSONDecodeError):
                valid_inventory = False
        _add(issues, valid_inventory, "pi5.normal-inventory-and-vault")

    docker = run_command(["/usr/bin/docker", "info", "--format", "{{json .ServerVersion}}"], cwd=project) if os.path.isfile("/usr/bin/docker") and os.path.isdir(project) else None
    _add(issues, docker is not None and getattr(docker, "returncode", 1) == 0, "pi5.docker")
    compose = run_command(["/usr/bin/docker", "compose", "version"], cwd=project) if docker is not None and getattr(docker, "returncode", 1) == 0 else None
    _add(issues, compose is not None and getattr(compose, "returncode", 1) == 0, "pi5.docker-compose")

    try:
        free_mb = disk_free_reader(project)
    except (OSError, ValueError):
        free_mb = 0
    _add(issues, free_mb >= 4096, "pi5.disk-free")
    try:
        memory_mb = memory_available_reader()
    except (OSError, ValueError):
        memory_mb = 0
    _add(issues, memory_mb >= 512, "pi5.memory-available")

    fleet_path = os.path.join(project, "logs", "deploy", "fleet-release-state.json")
    if os.path.exists(fleet_path):
        try:
            valid_fleet = _safe_json_object(fleet_path)
            fleet = (
                json.loads(Path(fleet_path).read_text(encoding="utf-8"))
                if valid_fleet
                else None
            )
            _add(issues, valid_fleet, "pi5.fleet-state-readable")
            active_run = fleet.get("activeRun") if isinstance(fleet, dict) else None
            if active_run is not None:
                valid_active_run = (
                    isinstance(active_run, str)
                    and RUN_ID_RE.fullmatch(active_run) is not None
                )
                run_path = os.path.join(
                    project,
                    "logs",
                    "deploy",
                    "release-runs",
                    f"{active_run}.json" if valid_active_run else "invalid",
                )
                readable_authority = False
                if valid_active_run and os.path.exists(run_path):
                    try:
                        readable_authority = _safe_json_object(run_path)
                    except OSError:
                        readable_authority = False
                _add(
                    issues,
                    valid_active_run and readable_authority,
                    "pi5.interrupted-run-authority",
                )
                if valid_active_run and readable_authority:
                    proofs.append("pi5.interrupted-run-authority-readable")
                    warnings.append("pi5.interrupted-run-recovery-required")
        except (OSError, json.JSONDecodeError, UnicodeError):
            _add(issues, False, "pi5.fleet-state-readable")
    else:
        proofs.append("pi5.fleet-state-not-initialized")

    for name, path in (
        (
            "pi5.blue-green-state-readable",
            os.path.join(project, "logs", "deploy", "pi5-blue-green-state.json"),
        ),
        (
            "pi5.deploy-status-readable",
            os.path.join(project, "config", "deploy-status.json"),
        ),
    ):
        if os.path.exists(path):
            try:
                _add(issues, _safe_json_object(path), name)
            except OSError:
                _add(issues, False, name)
        else:
            proofs.append(f"{name}:not-initialized")

    if not issues:
        proofs.extend(
            [
                "pi5.bootstrap-readiness",
                "pi5.normal-ansible-and-vault",
                "pi5.candidate-object-readiness",
                "pi5.host-resource-readiness",
            ]
        )
    report = {
        "version": 1,
        "probe": "route",
        "sha": sha,
        "status": "passed" if not issues else "blocked",
        "proofs": proofs,
        "issues": issues,
        "warnings": warnings,
        "metrics": {"diskFreeMb": free_mb, "memoryAvailableMb": memory_mb},
    }
    if fleet_lock_descriptor is not None:
        os.close(fleet_lock_descriptor)
    return (EX_OK if not issues else EX_CONFIG), report


def main(argv: Sequence[str] | None = None) -> int:
    arguments = list(sys.argv[1:] if argv is None else argv)
    if len(arguments) != 1:
        print(json.dumps({"version": 1, "probe": "route", "status": "incomplete", "proofs": [], "issues": ["route.arguments"], "warnings": [], "metrics": {}}))
        return EX_SOFTWARE
    try:
        spec = parse_spec(arguments[0])
        code, report = execute(spec)
    except (RoutePreflightConfigError, OSError, subprocess.SubprocessError):
        code = EX_SOFTWARE
        report = {
            "version": 1,
            "probe": "route",
            "status": "incomplete",
            "proofs": [],
            "issues": ["route.internal-error"],
            "warnings": [],
            "metrics": {},
        }
    print(json.dumps(report, ensure_ascii=True, sort_keys=True, separators=(",", ":")))
    return code


if __name__ == "__main__":
    raise SystemExit(main())
