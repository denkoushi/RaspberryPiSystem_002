#!/usr/bin/env python3
"""Standalone, read-only Pi5 route readiness probe.

The local operator sends this standard-library-only source before a transient
release unit exists.  It checks the exact tools and configuration used by the
later bootstrap/coordinator path, aggregates safe issue codes, and never
checks out source, runs a playbook, builds an image, or changes a service.
"""
from __future__ import annotations

import concurrent.futures
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
VERSION_1_KEYS = frozenset(
    {
        "version",
        "project",
        "runId",
        "sha",
        "inventory",
        "expectedServerClientId",
    }
)
VERSION_2_KEYS = VERSION_1_KEYS | {"requiredExternalDependencies"}
ALLOWED_UNTRACKED = frozenset({"?? power-actions/"})
BUILD_EXTERNAL_DEPENDENCIES = {
    "docker-auth": ("auth.docker.io", 443),
    "docker-registry": ("registry-1.docker.io", 443),
    "github": ("github.com", 443),
    "go-proxy": ("proxy.golang.org", 443),
    "npm-registry": ("registry.npmjs.org", 443),
    "playwright-cdn": ("cdn.playwright.dev", 443),
    "prisma-binaries": ("binaries.prisma.sh", 443),
    "pypi-files": ("files.pythonhosted.org", 443),
    "pypi-index": ("pypi.org", 443),
}
BUILD_EXTERNAL_DEPENDENCY_IDS = tuple(BUILD_EXTERNAL_DEPENDENCIES)
EXTERNAL_TLS_ROUNDS = 3
EXTERNAL_TLS_TIMEOUT_SECONDS = 5
_TLS_PROBE_SOURCE = """\
import socket
import ssl
import sys

host = sys.argv[1]
port = int(sys.argv[2])
timeout = float(sys.argv[3])
with socket.create_connection((host, port), timeout=timeout) as connection:
    connection.settimeout(timeout)
    context = ssl.create_default_context()
    with context.wrap_socket(connection, server_hostname=host):
        pass
"""
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
BACKUP_SSH_DIRECTORY = "secrets/backup-ssh"
BACKUP_SSH_PRIVATE_KEY = f"{BACKUP_SSH_DIRECTORY}/id_ed25519"
BACKUP_SSH_KNOWN_HOSTS = f"{BACKUP_SSH_DIRECTORY}/known_hosts"
OPENSSH_PRIVATE_KEY_LABEL = b"OPENSSH " + b"PRIVATE KEY"
OPENSSH_PRIVATE_KEY_BEGIN = b"-----BEGIN " + OPENSSH_PRIVATE_KEY_LABEL + b"-----\n"
OPENSSH_PRIVATE_KEY_END = b"-----END " + OPENSSH_PRIVATE_KEY_LABEL + b"-----"


class RoutePreflightConfigError(ValueError):
    pass


def parse_spec(raw: str) -> dict[str, Any]:
    try:
        payload = json.loads(raw)
    except (TypeError, json.JSONDecodeError) as error:
        raise RoutePreflightConfigError("route preflight is not valid JSON") from error
    if not isinstance(payload, dict):
        raise RoutePreflightConfigError("route preflight must be an object")
    version = payload.get("version")
    expected_keys = {
        1: VERSION_1_KEYS,
        2: VERSION_2_KEYS,
    }.get(version) if type(version) is int else None
    if expected_keys is None or set(payload) != expected_keys:
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
    if version == 2:
        dependencies = payload.get("requiredExternalDependencies")
        if (
            not isinstance(dependencies, list)
            or any(type(value) is not str for value in dependencies)
            or dependencies != sorted(dependencies)
            or len(dependencies) != len(set(dependencies))
            or any(value not in BUILD_EXTERNAL_DEPENDENCIES for value in dependencies)
        ):
            raise RoutePreflightConfigError(
                "requiredExternalDependencies is malformed"
            )
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


def _secure_authority_file(path: str, *, maximum_bytes: int) -> bytes | None:
    """Read one bounded, owner-only authority file without following links."""

    flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(path, flags)
    except OSError:
        return None
    try:
        metadata = os.fstat(descriptor)
        if (
            not stat.S_ISREG(metadata.st_mode)
            or metadata.st_uid != os.getuid()
            or metadata.st_gid != os.getgid()
            or stat.S_IMODE(metadata.st_mode) != 0o600
            or metadata.st_size < 1
            or metadata.st_size > maximum_bytes
        ):
            return None
        payload = os.read(descriptor, maximum_bytes + 1)
    finally:
        os.close(descriptor)
    if len(payload) != metadata.st_size or len(payload) > maximum_bytes:
        return None
    return payload


def _backup_ssh_authority_issues(project: str) -> list[str]:
    """Validate the exact host files mounted into candidate API containers."""

    issues: list[str] = []
    directory = os.path.join(project, BACKUP_SSH_DIRECTORY)
    try:
        directory_metadata = os.lstat(directory)
        directory_valid = (
            stat.S_ISDIR(directory_metadata.st_mode)
            and directory_metadata.st_uid == os.getuid()
            and directory_metadata.st_gid == os.getgid()
            and stat.S_IMODE(directory_metadata.st_mode) == 0o700
        )
    except OSError:
        directory_valid = False
    if not directory_valid:
        issues.append("pi5.backup-ssh-directory")

    private_key = _secure_authority_file(
        os.path.join(project, BACKUP_SSH_PRIVATE_KEY), maximum_bytes=64 * 1024
    )
    if not (
        private_key is not None
        and private_key.startswith(OPENSSH_PRIVATE_KEY_BEGIN)
        and private_key.rstrip().endswith(OPENSSH_PRIVATE_KEY_END)
    ):
        issues.append("pi5.backup-ssh-private-key")

    known_hosts = _secure_authority_file(
        os.path.join(project, BACKUP_SSH_KNOWN_HOSTS), maximum_bytes=1024 * 1024
    )
    known_hosts_valid = False
    if known_hosts is not None and b"\x00" not in known_hosts:
        try:
            lines = known_hosts.decode("utf-8").splitlines()
        except UnicodeError:
            lines = []
        known_hosts_valid = any(
            line and not line.startswith("#") and len(line.split()) >= 3
            for line in lines
        )
    if not known_hosts_valid:
        issues.append("pi5.backup-ssh-known-hosts")
    return issues


def _probe_external_dependency(dependency_id: str) -> bool:
    """Run one certificate-validating TLS handshake in a time-bounded child."""

    host, port = BUILD_EXTERNAL_DEPENDENCIES[dependency_id]
    try:
        result = subprocess.run(
            [
                sys.executable,
                "-c",
                _TLS_PROBE_SOURCE,
                host,
                str(port),
                str(EXTERNAL_TLS_TIMEOUT_SECONDS),
            ],
            text=True,
            capture_output=True,
            check=False,
            timeout=EXTERNAL_TLS_TIMEOUT_SECONDS + 2,
        )
    except (OSError, subprocess.SubprocessError):
        return False
    return result.returncode == 0


def _probe_external_dependencies(
    dependencies: Sequence[str],
    probe: Callable[[str], bool],
) -> dict[str, int]:
    successes = {dependency_id: 0 for dependency_id in dependencies}
    if not dependencies:
        return successes
    for _round in range(EXTERNAL_TLS_ROUNDS):
        with concurrent.futures.ThreadPoolExecutor(
            max_workers=len(dependencies)
        ) as executor:
            futures = {
                dependency_id: executor.submit(probe, dependency_id)
                for dependency_id in dependencies
            }
            for dependency_id in dependencies:
                try:
                    passed = futures[dependency_id].result()
                except Exception:
                    passed = False
                if passed is True:
                    successes[dependency_id] += 1
    return successes


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


def _safe_json_document(
    path: str, *, maximum_bytes: int = 1024 * 1024
) -> dict[str, Any] | None:
    flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(path, flags)
    try:
        metadata = os.fstat(descriptor)
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_size > maximum_bytes:
            return None
        payload = os.read(descriptor, maximum_bytes + 1)
    finally:
        os.close(descriptor)
    if len(payload) > maximum_bytes:
        return None
    try:
        value = json.loads(payload.decode("utf-8"))
    except (UnicodeError, json.JSONDecodeError):
        return None
    return value if isinstance(value, dict) else None


def _safe_json_object(path: str, *, maximum_bytes: int = 1024 * 1024) -> bool:
    return _safe_json_document(path, maximum_bytes=maximum_bytes) is not None


def _active_run_id(value: Any) -> str | None:
    """Accept the legacy ID or the current validated-summary representation."""

    if isinstance(value, str):
        return value if RUN_ID_RE.fullmatch(value) is not None else None
    if not isinstance(value, dict):
        return None
    run_id = value.get("runId")
    desired_sha = value.get("desiredSha")
    inventory = value.get("inventory")
    started_at = value.get("startedAt")
    kind = value.get("kind")
    if (
        not isinstance(run_id, str)
        or RUN_ID_RE.fullmatch(run_id) is None
        or value.get("status") != "running"
        or not isinstance(desired_sha, str)
        or FULL_SHA_RE.fullmatch(desired_sha) is None
        or not isinstance(inventory, str)
        or not inventory
        or len(inventory) > 1000
        or "\x00" in inventory
        or not isinstance(started_at, str)
        or re.fullmatch(
            r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z",
            started_at,
        )
        is None
        or (kind is not None and kind not in {"release", "pi4-recovery"})
    ):
        return None
    return run_id


def execute(
    spec: Mapping[str, Any],
    *,
    run_command: Callable[..., Any] = _run,
    client_id_reader: Callable[[], str] = _client_id,
    disk_free_reader: Callable[[str], int] = _disk_free_mb,
    memory_available_reader: Callable[[], int] = _memory_available_mb,
    fleet_lock_acquirer: Callable[[str], int] = _acquire_existing_fleet_lock,
    external_dependency_probe: Callable[[str], bool] = _probe_external_dependency,
) -> tuple[int, dict[str, Any]]:
    project = str(spec["project"])
    sha = str(spec["sha"])
    issues: list[str] = []
    proofs: list[str] = []
    warnings: list[str] = []
    fleet_lock_descriptor: int | None = None
    required_external_dependencies = tuple(
        str(value) for value in spec.get("requiredExternalDependencies", [])
    )

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

    backup_ssh_issues = _backup_ssh_authority_issues(project)
    for issue in backup_ssh_issues:
        _add(issues, False, issue)
    if not backup_ssh_issues:
        proofs.append("pi5.backup-ssh-authority")

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

    external_successes = _probe_external_dependencies(
        required_external_dependencies, external_dependency_probe
    )
    for dependency_id in required_external_dependencies:
        _add(
            issues,
            external_successes[dependency_id] == EXTERNAL_TLS_ROUNDS,
            f"pi5.external-tls:{dependency_id}",
        )
    if required_external_dependencies and all(
        count == EXTERNAL_TLS_ROUNDS for count in external_successes.values()
    ):
        proofs.append("pi5.external-server-build-readiness")

    fleet_path = os.path.join(project, "logs", "deploy", "fleet-release-state.json")
    if os.path.exists(fleet_path):
        try:
            fleet = _safe_json_document(fleet_path)
            valid_fleet = fleet is not None
            _add(issues, valid_fleet, "pi5.fleet-state-readable")
            active_run = fleet.get("activeRun") if isinstance(fleet, dict) else None
            if active_run is not None:
                active_run_id = _active_run_id(active_run)
                valid_active_run = active_run_id is not None
                run_path = os.path.join(
                    project,
                    "logs",
                    "deploy",
                    "release-runs",
                    f"{active_run_id}.json" if active_run_id is not None else "invalid",
                )
                readable_authority = False
                if valid_active_run and os.path.exists(run_path):
                    try:
                        authority = _safe_json_document(run_path)
                        readable_authority = (
                            authority is not None
                            and authority.get("runId") == active_run_id
                        )
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
        "version": 2,
        "probe": "route",
        "sha": sha,
        "status": "passed" if not issues else "blocked",
        "proofs": proofs,
        "issues": issues,
        "warnings": warnings,
        "metrics": {"diskFreeMb": free_mb, "memoryAvailableMb": memory_mb},
        "externalDependencies": {
            "required": list(required_external_dependencies),
            "rounds": EXTERNAL_TLS_ROUNDS,
            "successes": external_successes,
        },
    }
    if fleet_lock_descriptor is not None:
        os.close(fleet_lock_descriptor)
    return (EX_OK if not issues else EX_CONFIG), report


def main(argv: Sequence[str] | None = None) -> int:
    arguments = list(sys.argv[1:] if argv is None else argv)
    if len(arguments) != 1:
        print(
            json.dumps(
                {
                    "version": 2,
                    "probe": "route",
                    "status": "incomplete",
                    "proofs": [],
                    "issues": ["route.arguments"],
                    "warnings": [],
                    "metrics": {},
                    "externalDependencies": {
                        "required": [],
                        "rounds": EXTERNAL_TLS_ROUNDS,
                        "successes": {},
                    },
                }
            )
        )
        return EX_SOFTWARE
    try:
        spec = parse_spec(arguments[0])
        code, report = execute(spec)
    except (RoutePreflightConfigError, OSError, subprocess.SubprocessError):
        code = EX_SOFTWARE
        report = {
            "version": 2,
            "probe": "route",
            "status": "incomplete",
            "proofs": [],
            "issues": ["route.internal-error"],
            "warnings": [],
            "metrics": {},
            "externalDependencies": {
                "required": [],
                "rounds": EXTERNAL_TLS_ROUNDS,
                "successes": {},
            },
        }
    print(json.dumps(report, ensure_ascii=True, sort_keys=True, separators=(",", ":")))
    return code


if __name__ == "__main__":
    raise SystemExit(main())
