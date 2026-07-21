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
import tempfile
import types
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence


EX_OK = 0
EX_SOFTWARE = 70
EX_TEMPFAIL = 75
EX_CONFIG = 78
LOCAL_RUNNER_FAILURE_CODES = frozenset(
    {
        "ready",
        "configuration-unavailable",
        "runtime-unavailable",
        "runtime-lock-mismatch",
        "bootstrap-observation-unavailable",
        "storage-unavailable",
    }
)
RUNTIME_BOOTSTRAP_PHASES = frozenset(
    {
        "initializing",
        "host-preflight",
        "lock-validate",
        "staging-prepare",
        "python-download",
        "python-extract",
        "python-packages",
        "collection-download",
        "collection-install",
        "runtime-verify",
        "runtime-publish",
        "active-link",
        "cleanup",
        "complete",
        "internal",
    }
)
RUNTIME_BOOTSTRAP_FAILURE_CODES = frozenset(
    {
        "host-ineligible",
        "lock-invalid",
        "requirements-missing",
        "staging-preparation-failed",
        "python-download-failed",
        "python-extract-failed",
        "python-packages-failed",
        "collection-download-failed",
        "collection-install-failed",
        "runtime-verification-failed",
        "runtime-publish-conflict",
        "active-link-failed",
        "cleanup-failed",
        "internal-error",
    }
)
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
RUNTIME_RESULT_MARKER_RE = re.compile(
    r"TERMINAL_RUNTIME_MANIFEST_RESULT:"
    r"([A-Za-z0-9_-]+={0,2})(?![A-Za-z0-9_=-])"
)
RUNTIME_ERROR_MARKER_RE = re.compile(
    r"TERMINAL_RUNTIME_MANIFEST_ERROR:"
    r"([A-Za-z0-9_-]+={0,2})(?![A-Za-z0-9_=-])"
)
AGENT_HEALTH_MARKER_RE = re.compile(
    r"TERMINAL_AGENT_HEALTH_OK:"
    r"(nfc-agent|barcode-agent|torque-agent):([0-9]{1,5})"
    r"(?![A-Za-z0-9_:-])"
)
ALLOWED_UNTRACKED = frozenset({"power-actions"})
_BASE_CANDIDATE_ARTIFACTS = (
    ("infrastructure/ansible/playbooks/deploy-staged.yml", "blob"),
    ("infrastructure/ansible/roles/common/tasks/main.yml", "blob"),
    ("scripts/deploy/rollback-manifest.py", "blob"),
    ("scripts/deploy/rolling_release/terminal_manifest_capture.py", "blob"),
    ("scripts/deploy/rolling_release/terminal_release_evidence.py", "blob"),
    ("scripts/deploy/terminal-identity-probe.py", "blob"),
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
        ("infrastructure/ansible/roles/client/templates/torque-bluetooth-adapter.sh.j2", "blob"),
        ("infrastructure/ansible/roles/client/templates/torque-bluetooth-adapter@.service.j2", "blob"),
        ("infrastructure/ansible/roles/client/templates/90-torque-bluetooth-adapter.rules.j2", "blob"),
        ("infrastructure/ansible/roles/client/templates/99-torque-wrench-hid.rules.j2", "blob"),
        ("infrastructure/ansible/templates/torque-agent.env.j2", "blob"),
        ("infrastructure/docker/Dockerfile.torque-agent", "blob"),
        ("infrastructure/docker/docker-compose.client.yml", "blob"),
    ),
    "haizenEnabled": (
        ("clients/haizen-agent", "tree"),
        ("infrastructure/ansible/roles/client/tasks/haizen-agent.yml", "blob"),
    ),
}
_TORQUE_BLUETOOTH_DEPLOYMENT_ARTIFACTS = (
    "infrastructure/ansible/roles/client/templates/torque-bluetooth-adapter.sh.j2",
    "infrastructure/ansible/roles/client/templates/torque-bluetooth-adapter@.service.j2",
    "infrastructure/ansible/roles/client/templates/90-torque-bluetooth-adapter.rules.j2",
    "infrastructure/ansible/roles/client/tasks/torque-agent.yml",
)
_TORQUE_HELPER_ARTIFACT = _TORQUE_BLUETOOTH_DEPLOYMENT_ARTIFACTS[0]
_TORQUE_UNIT_ARTIFACT = _TORQUE_BLUETOOTH_DEPLOYMENT_ARTIFACTS[1]
_TORQUE_UDEV_ARTIFACT = _TORQUE_BLUETOOTH_DEPLOYMENT_ARTIFACTS[2]
_TORQUE_TASKS_ARTIFACT = _TORQUE_BLUETOOTH_DEPLOYMENT_ARTIFACTS[3]
TARGET_INPUT_MAX_BYTES = 3 * 1024 * 1024
SSH_EXECUTOR = "ssh-ansible"
LOCAL_EXECUTOR = "stonebase-local-ansible-poc"
STONEBASE_HOST = "raspi4-kensaku-stonebase01"
LOCAL_RUNNER = "/usr/local/libexec/raspi-local-ansible-runner"
LOCAL_TRANSPORT_SOURCE = "scripts/deploy/rolling_release/local_transport_contract.py"
LOCAL_KNOWN_HOSTS = (
    "infrastructure/ansible/files/stonebase-local-ansible/ssh-known-hosts"
)
MAX_LOCAL_RUNNER_RESULT_BYTES = 64 * 1024
TARGET_LOADER = (
    "import json,sys;"
    "fail=lambda:(_ for _ in ()).throw(SystemExit(78));"
    f"raw=sys.stdin.buffer.read({TARGET_INPUT_MAX_BYTES + 1});"
    f"fail() if len(raw)>{TARGET_INPUT_MAX_BYTES} else None;"
    "envelope=json.loads(raw.decode('utf-8'));"
    "fail() if not isinstance(envelope,dict) or "
    "set(envelope)!={'preflightSource','runtimeManifestSource','agentHealthSource','torqueHelperTemplateSource','spec'} else None;"
    "source=envelope['preflightSource'];runtime=envelope['runtimeManifestSource'];"
    "health=envelope['agentHealthSource'];"
    "torque=envelope['torqueHelperTemplateSource'];"
    "fail() if not isinstance(source,str) or not isinstance(runtime,str) "
    "or not isinstance(health,str) or not isinstance(torque,str) else None;"
    "sys.argv=['terminal-preflight',json.dumps(envelope['spec'],separators=(',',':'))];"
    "exec(compile(source,'<terminal-preflight>','exec'),"
    "{'__name__':'__main__','EMBEDDED_TERMINAL_PREFLIGHT_SOURCE':source,"
    "'EMBEDDED_RUNTIME_MANIFEST_SOURCE':runtime,"
    "'EMBEDDED_AGENT_HEALTH_SOURCE':health,"
    "'EMBEDDED_TORQUE_HELPER_TEMPLATE_SOURCE':torque})"
)


class TerminalPreflightConfigError(ValueError):
    """The preflight contract is malformed or unsafe."""


def _reject_duplicate_json_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"duplicate JSON key: {key}")
        result[key] = value
    return result


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
        payload = json.loads(
            raw,
            object_pairs_hook=_reject_duplicate_json_keys,
            parse_constant=lambda constant: (_ for _ in ()).throw(
                ValueError(f"invalid JSON constant: {constant}")
            ),
        )
    except (TypeError, json.JSONDecodeError, ValueError) as error:
        raise TerminalPreflightConfigError("terminal preflight is not valid JSON") from error
    if not isinstance(payload, dict) or payload.get("version") != 1:
        raise TerminalPreflightConfigError("unsupported terminal preflight version")
    mode = payload.get("mode")
    if mode == "orchestrator":
        required = {
            "version",
            "mode",
            "project",
            "runId",
            "sha",
            "expectedServerClientId",
            "targets",
        }
        if set(payload) not in {frozenset(required), frozenset(required | {"requestedExecutor"})}:
            raise TerminalPreflightConfigError("orchestrator fields do not match version 1")
        payload.setdefault("requestedExecutor", SSH_EXECUTOR)
        _safe_path(payload.get("project"), name="project")
        if not isinstance(payload.get("runId"), str) or RUN_ID_RE.fullmatch(payload["runId"]) is None:
            raise TerminalPreflightConfigError("runId is malformed")
        if not isinstance(payload.get("sha"), str) or FULL_SHA_RE.fullmatch(payload["sha"]) is None:
            raise TerminalPreflightConfigError("sha is malformed")
        if not isinstance(payload.get("expectedServerClientId"), str) or re.fullmatch(
            r"[A-Za-z0-9][A-Za-z0-9._:-]{0,127}", payload["expectedServerClientId"]
        ) is None:
            raise TerminalPreflightConfigError("expectedServerClientId is malformed")
        if payload.get("requestedExecutor") not in {SSH_EXECUTOR, LOCAL_EXECUTOR}:
            raise TerminalPreflightConfigError("requestedExecutor is unsupported")
        targets = payload.get("targets")
        if not isinstance(targets, list) or len(targets) > 100:
            raise TerminalPreflightConfigError("targets must be a bounded list")
        for target in targets:
            _validate_target(target, routing=True)
            if target.get("requestedExecutor", SSH_EXECUTOR) != payload["requestedExecutor"]:
                raise TerminalPreflightConfigError(
                    "orchestrator and target executors do not match"
                )
        if payload["requestedExecutor"] == LOCAL_EXECUTOR and (
            len(targets) != 1 or targets[0]["host"] != STONEBASE_HOST
        ):
            raise TerminalPreflightConfigError(
                "local executor preflight must target StoneBase only"
            )
        return payload
    if mode == "target":
        _validate_target(payload, routing=False)
        return payload
    raise TerminalPreflightConfigError("terminal preflight mode is unsupported")


def _validate_target(payload: Any, *, routing: bool) -> None:
    required = {
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
        "torqueUsbVendorId",
        "torqueUsbProductId",
        "haizenEnabled",
        "haizenHidDevice",
        "haizenInstallEvdev",
        "manageSignage",
        "inventoryIssues",
        "runtimeManifestContract",
    }
    optional = {"statusClientId", "requestedExecutor"}
    if (
        not isinstance(payload, dict)
        or not required <= set(payload)
        or set(payload) - required - optional
    ):
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
    requested_executor = payload.get("requestedExecutor", SSH_EXECUTOR)
    if requested_executor not in {SSH_EXECUTOR, LOCAL_EXECUTOR}:
        raise TerminalPreflightConfigError("requestedExecutor is unsupported")
    if (
        requested_executor == LOCAL_EXECUTOR
        and (
            payload["host"] != STONEBASE_HOST
            or not isinstance(payload.get("statusClientId"), str)
            or re.fullmatch(
                r"[A-Za-z0-9][A-Za-z0-9._:-]{0,127}",
                payload["statusClientId"],
            )
            is None
        )
    ):
        raise TerminalPreflightConfigError(
            "local target identity escaped StoneBase"
        )
    for key in ("torqueUsbVendorId", "torqueUsbProductId"):
        value = payload.get(key)
        if not isinstance(value, str) or (
            value and re.fullmatch(r"[0-9a-f]{4}", value) is None
        ):
            raise TerminalPreflightConfigError(f"{key} is malformed")
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
    _validate_runtime_manifest_contract(payload.get("runtimeManifestContract"))
    if routing and payload.get("mode") != "target":
        raise TerminalPreflightConfigError("routing target mode is malformed")


def _validate_runtime_manifest_contract(value: Any) -> None:
    if not isinstance(value, dict) or set(value) != {
        "systemdUnits",
        "dockerServices",
        "restartOnRestoreUnits",
        "compose",
    }:
        raise TerminalPreflightConfigError("runtime manifest contract is malformed")
    units = value.get("systemdUnits")
    services = value.get("dockerServices")
    restart_units = value.get("restartOnRestoreUnits")
    if (
        not isinstance(units, list)
        or not units
        or any(not isinstance(unit, str) or UNIT_RE.fullmatch(unit) is None for unit in units)
        or len(units) != len(set(units))
        or not isinstance(services, list)
        or any(service not in {"nfc-agent", "barcode-agent", "torque-agent"} for service in services)
        or len(services) != len(set(services))
        or not isinstance(restart_units, list)
        or any(unit not in units for unit in restart_units)
        or len(restart_units) != len(set(restart_units))
    ):
        raise TerminalPreflightConfigError("runtime manifest contract is malformed")
    compose = value.get("compose")
    if services:
        if not isinstance(compose, dict) or set(compose) != {
            "project",
            "workingDirectory",
            "configFiles",
        }:
            raise TerminalPreflightConfigError("runtime Compose contract is malformed")
        project = compose.get("project")
        if not isinstance(project, str) or re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,62}", project) is None:
            raise TerminalPreflightConfigError("runtime Compose project is malformed")
        _safe_path(compose.get("workingDirectory"), name="runtime Compose working directory")
        config_files = compose.get("configFiles")
        if (
            not isinstance(config_files, list)
            or not config_files
            or len(config_files) != len(set(config_files))
        ):
            raise TerminalPreflightConfigError("runtime Compose config files are malformed")
        for path in config_files:
            _safe_path(path, name="runtime Compose config file")
    elif compose is not None:
        raise TerminalPreflightConfigError(
            "runtime Compose contract was supplied without Docker services"
        )


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


def _default_run(
    argv: Sequence[str],
    *,
    timeout: int = 20,
    input_text: str | None = None,
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        list(argv),
        text=True,
        input=input_text,
        capture_output=True,
        check=False,
        timeout=timeout,
    )


def _command(
    argv: Sequence[str],
    *,
    timeout: int = 10,
    input_text: str | None = None,
) -> subprocess.CompletedProcess[str]:
    try:
        return _default_run(argv, timeout=timeout, input_text=input_text)
    except (OSError, subprocess.TimeoutExpired) as error:
        return subprocess.CompletedProcess(list(argv), 127, "", str(error))


def _candidate_artifact_contract(
    targets: Sequence[Mapping[str, Any]],
) -> tuple[tuple[str, str], ...]:
    """Return candidate-owned paths needed by the selected release graph."""

    artifacts = set(_BASE_CANDIDATE_ARTIFACTS)
    for target in targets:
        if target.get("requestedExecutor", SSH_EXECUTOR) == LOCAL_EXECUTOR:
            artifacts.add(
                ("scripts/deploy/rolling_release/local_execution.py", "blob")
            )
            artifacts.add((LOCAL_TRANSPORT_SOURCE, "blob"))
            artifacts.add((LOCAL_KNOWN_HOSTS, "blob"))
            artifacts.add(("scripts/deploy/terminal_profile_registry.py", "blob"))
            artifacts.add(("scripts/deploy/terminal-profile-registry.json", "blob"))
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


def _candidate_helper_source(
    spec: Mapping[str, Any],
    *,
    relative_path: str,
    issue_scope: str,
    run_command: Callable[..., Any] = _default_run,
) -> tuple[str | None, list[dict[str, str]]]:
    """Read one exact candidate blob from the immutable candidate on Pi5."""

    object_name = f"{spec['sha']}:{relative_path}"
    try:
        result = run_command(
            [
                "/usr/bin/git",
                "-C",
                str(spec["project"]),
                "cat-file",
                "blob",
                object_name,
            ],
            timeout=20,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None, [
            {
                "code": f"candidate.{issue_scope}-helper-read",
                "message": f"candidate {issue_scope} artifact could not be read on Pi5",
            }
        ]
    source = getattr(result, "stdout", "")
    if (
        getattr(result, "returncode", 1) != 0
        or not isinstance(source, str)
        or not source.strip()
        or len(source.encode("utf-8")) > 2 * 1024 * 1024
        or "\x00" in source
    ):
        return None, [
            {
                "code": f"candidate.{issue_scope}-helper-invalid",
                "message": f"candidate {issue_scope} artifact is unavailable or malformed",
            }
        ]
    return source, []


def _candidate_registry_component_for(
    registry_source: str | None,
    registry_payload: str | None,
    *,
    repository_root: Path,
) -> Callable[[str], str]:
    """Load the exact candidate path classifier without ambient imports."""

    if (
        not isinstance(registry_source, str)
        or not registry_source.strip()
        or not isinstance(registry_payload, str)
        or not registry_payload.strip()
    ):
        raise TerminalPreflightConfigError(
            "candidate terminal impact registry is unavailable"
        )
    module_name = "_raspi_candidate_terminal_profile_registry"
    module = types.ModuleType(module_name)
    module.__file__ = "<candidate-terminal-profile-registry>"
    sys.modules[module_name] = module
    try:
        exec(
            compile(
                registry_source,
                "<candidate-terminal-profile-registry>",
                "exec",
            ),
            module.__dict__,
        )
        with tempfile.TemporaryDirectory(prefix="raspi-terminal-registry-") as root:
            registry_path = Path(root) / "terminal-profile-registry.json"
            registry_path.write_text(registry_payload, encoding="utf-8")
            registry = module.load_registry(
                registry_path,
                repository_root=repository_root,
            )
    except Exception as error:
        raise TerminalPreflightConfigError(
            "candidate terminal impact registry failed closed"
        ) from error
    finally:
        sys.modules.pop(module_name, None)
    return registry.component_for


def _candidate_local_transport_options(
    transport_source: str | None,
    known_hosts_payload: str | None,
    *,
    known_hosts_path: Path,
) -> tuple[str, ...]:
    """Seal candidate host trust and return its exact strict SSH options."""

    if (
        not isinstance(transport_source, str)
        or not transport_source.strip()
        or not isinstance(known_hosts_payload, str)
        or not known_hosts_payload.strip()
        or len(known_hosts_payload.encode("utf-8")) > 1024
        or "\x00" in known_hosts_payload
    ):
        raise TerminalPreflightConfigError(
            "candidate Local transport contract is unavailable"
        )
    module_name = "_raspi_candidate_local_transport_contract"
    module = types.ModuleType(module_name)
    module.__file__ = "<candidate-local-transport-contract>"
    sys.modules[module_name] = module
    try:
        exec(
            compile(
                transport_source,
                "<candidate-local-transport-contract>",
                "exec",
            ),
            module.__dict__,
        )
        normalized = module.validate_known_hosts_payload(known_hosts_payload)
        if normalized != known_hosts_payload:
            raise ValueError("known-hosts payload is not canonical")
        descriptor = os.open(
            known_hosts_path,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
            0o600,
        )
        try:
            payload = normalized.encode("ascii")
            written = os.write(descriptor, payload)
            if written != len(payload):
                raise OSError("short known-hosts write")
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
        options = tuple(module.ssh_security_options(str(known_hosts_path)))
        expected = (
            "-o",
            "BatchMode=yes",
            "-o",
            "StrictHostKeyChecking=yes",
            "-o",
            f"UserKnownHostsFile={known_hosts_path}",
            "-o",
            "GlobalKnownHostsFile=/dev/null",
            "-o",
            "UpdateHostKeys=no",
            "-o",
            "HostKeyAlgorithms=ssh-ed25519",
        )
        if options != expected:
            raise ValueError("candidate Local SSH options are not strict")
        metadata = known_hosts_path.lstat()
        if not stat.S_ISREG(metadata.st_mode) or stat.S_IMODE(metadata.st_mode) != 0o600:
            raise OSError("known-hosts staging is not a private regular file")
        return options
    except Exception as error:
        raise TerminalPreflightConfigError(
            "candidate Local transport contract failed closed"
        ) from error
    finally:
        sys.modules.pop(module_name, None)


def _candidate_runtime_manifest_source(
    spec: Mapping[str, Any],
    *,
    run_command: Callable[..., Any] = _default_run,
) -> tuple[str | None, list[dict[str, str]]]:
    return _candidate_helper_source(
        spec,
        relative_path="scripts/deploy/terminal-runtime-manifest.py",
        issue_scope="runtime",
        run_command=run_command,
    )


def _candidate_agent_health_source(
    spec: Mapping[str, Any],
    *,
    run_command: Callable[..., Any] = _default_run,
) -> tuple[str | None, list[dict[str, str]]]:
    return _candidate_helper_source(
        spec,
        relative_path="scripts/deploy/terminal-agent-health-probe.py",
        issue_scope="agent-health",
        run_command=run_command,
    )


def _candidate_torque_helper_template_source(
    spec: Mapping[str, Any],
    *,
    run_command: Callable[..., Any] = _default_run,
) -> tuple[str | None, list[dict[str, str]]]:
    sources, issues = _candidate_torque_bluetooth_sources(
        spec, run_command=run_command
    )
    return sources.get(_TORQUE_HELPER_ARTIFACT, ""), issues


def _candidate_torque_bluetooth_sources(
    spec: Mapping[str, Any],
    *,
    run_command: Callable[..., Any] = _default_run,
) -> tuple[dict[str, str], list[dict[str, str]]]:
    """Read every exact artifact that controls torque Bluetooth ownership."""

    if not any(target["torqueEnabled"] for target in spec["targets"]):
        return {}, []
    sources: dict[str, str] = {}
    issues: list[dict[str, str]] = []
    for path in _TORQUE_BLUETOOTH_DEPLOYMENT_ARTIFACTS:
        source, source_issues = _candidate_helper_source(
            spec,
            relative_path=path,
            issue_scope="torque-bluetooth",
            run_command=run_command,
        )
        issues.extend(source_issues)
        if source is not None:
            sources[path] = source
    return sources, issues


def _candidate_torque_bluetooth_contract_issues(
    sources: Mapping[str, str],
) -> list[dict[str, str]]:
    """Reject a candidate that reintroduces unsafe Bluetooth ownership."""

    if set(sources) != set(_TORQUE_BLUETOOTH_DEPLOYMENT_ARTIFACTS):
        return []
    issues: list[dict[str, str]] = []
    helper = sources.get(_TORQUE_HELPER_ARTIFACT, "")
    unit = sources.get(_TORQUE_UNIT_ARTIFACT, "")
    rule = sources.get(_TORQUE_UDEV_ARTIFACT, "")
    tasks = sources.get(_TORQUE_TASKS_ARTIFACT, "")

    if (
        "udevadm trigger --subsystem-match=bluetooth"
        in tasks
        or "state: restarted" in tasks
        or "state: started" not in tasks
    ):
        _issue(
            issues,
            "candidate.torque-bluetooth-ownership",
            "candidate torque Bluetooth tasks must use one synchronous start owner",
        )
    if not all(
        fragment in tasks
        for fragment in (
            "rescue:",
            "systemctl show",
            "journalctl",
            "--lines=80",
            "--output=short-iso",
        )
    ):
        _issue(
            issues,
            "candidate.torque-bluetooth-failure-evidence",
            "candidate torque Bluetooth tasks must retain bounded unit and journal evidence",
        )
    if not all(
        fragment in unit
        for fragment in (
            "After=bluetooth.service systemd-rfkill.service",
            "Requires=bluetooth.service",
            "ExecStart=/usr/local/libexec/torque-bluetooth-adapter %I",
            "TimeoutStartSec=90",
            "TimeoutStopSec=10",
        )
    ):
        _issue(
            issues,
            "candidate.torque-bluetooth-unit",
            "candidate torque Bluetooth unit lacks bounded controller preparation",
        )
    if not all(
        fragment in rule
        for fragment in (
            'ACTION=="add", SUBSYSTEM=="bluetooth", ENV{DEVTYPE}=="host"',
            'ATTRS{idVendor}=="{{ torque_agent_bluetooth_adapter.usb_vendor_id }}"',
            'ATTRS{idProduct}=="{{ torque_agent_bluetooth_adapter.usb_product_id }}"',
            "ENV{SYSTEMD_WANTS}+=\"torque-bluetooth-adapter@%k.service\"",
        )
    ):
        _issue(
            issues,
            "candidate.torque-bluetooth-udev",
            "candidate torque Bluetooth udev rule does not target the exact controller",
        )
    probe_start = helper.find("probe_exact_controller()")
    probe_end = helper.find("\n}\n", probe_start)
    probe_source = helper[probe_start:probe_end] if probe_start >= 0 and probe_end >= 0 else ""
    if (
        "run_btmgmt()" not in helper
        or 'mkfifo -m 600 "${stdin_fifo}"' not in helper
        or '<&9 2>&1' not in helper
        or "torque-bluetooth operation=%s result=%s status=%s" not in helper
        or "for _ in {1..3}" not in helper
        or "--kill-after=1" not in helper
        or "cut -c1-240" not in helper
        or "power on" in probe_source
        or "2>/dev/null || true" in helper
    ):
        _issue(
            issues,
            "candidate.torque-bluetooth-diagnostics",
            "candidate torque Bluetooth helper lacks bounded management diagnostics",
        )
    return issues


_TORQUE_VENDOR_PLACEHOLDER = (
    "{{ torque_agent_bluetooth_adapter.usb_vendor_id }}"
)
_TORQUE_PRODUCT_PLACEHOLDER = (
    "{{ torque_agent_bluetooth_adapter.usb_product_id }}"
)


def _render_candidate_torque_helper(
    spec: Mapping[str, Any], template_source: str
) -> str:
    """Render the two-value helper template without evaluating arbitrary Jinja."""

    if not spec["torqueEnabled"]:
        return ""
    vendor = spec["torqueUsbVendorId"]
    product = spec["torqueUsbProductId"]
    if (
        re.fullmatch(r"[0-9a-f]{4}", vendor) is None
        or re.fullmatch(r"[0-9a-f]{4}", product) is None
        or template_source.count(_TORQUE_VENDOR_PLACEHOLDER) != 1
        or template_source.count(_TORQUE_PRODUCT_PLACEHOLDER) != 1
    ):
        raise TerminalPreflightConfigError(
            "candidate torque Bluetooth helper contract is malformed"
        )
    rendered = template_source.replace(_TORQUE_VENDOR_PLACEHOLDER, vendor).replace(
        _TORQUE_PRODUCT_PLACEHOLDER, product
    )
    if (
        not rendered.strip()
        or "\x00" in rendered
        or len(rendered.encode("utf-8")) > 2 * 1024 * 1024
        or any(token in rendered for token in ("{{", "{%", "{#"))
    ):
        raise TerminalPreflightConfigError(
            "candidate torque Bluetooth helper rendering is incomplete"
        )
    return rendered


def _probe_candidate_torque_helper(
    spec: Mapping[str, Any], template_source: str
) -> dict[str, str] | None:
    if not spec["torqueEnabled"]:
        return None
    try:
        rendered = _render_candidate_torque_helper(spec, template_source)
    except TerminalPreflightConfigError:
        return {
            "code": "torque.candidate-helper-contract",
            "message": "candidate torque Bluetooth helper could not be rendered safely",
        }
    completed = _command(
        ["/usr/bin/bash", "-s", "--", "--probe"],
        timeout=20,
        input_text=rendered,
    )
    if completed.returncode != 0:
        return {
            "code": "torque.candidate-helper-probe",
            "message": (
                "candidate torque Bluetooth helper did not pass its exact "
                "read-only live probe"
            ),
        }
    return None


def _probe_local_runner(
    spec: Mapping[str, Any],
) -> tuple[dict[str, Any] | None, str | None]:
    """Return only the runner's bounded public runtime observation."""

    if spec.get("requestedExecutor", SSH_EXECUTOR) != LOCAL_EXECUTOR:
        return None, None
    required_agents = [
        name
        for enabled, name in (
            (spec["nfcEnabled"], "nfc-agent"),
            (spec["barcodeEnabled"], "barcode-agent"),
            (spec["torqueEnabled"], "torque-agent"),
        )
        if enabled
    ]
    command = [
        LOCAL_RUNNER,
        "preflight",
        "--expected-user",
        str(spec["user"]),
        "--expected-client-id",
        str(spec["statusClientId"]),
        *[
            value
            for agent in required_agents
            for value in ("--require-agent", agent)
        ],
    ]
    completed = _command(command, timeout=60)
    if completed.returncode != 0:
        return None, "runner-command-unavailable"
    raw = completed.stdout.encode("utf-8")
    if len(raw) > MAX_LOCAL_RUNNER_RESULT_BYTES:
        return None, "runner-result-too-large"
    values: list[dict[str, Any]] = []
    for line in completed.stdout.splitlines():
        if not line.strip().startswith("{"):
            continue
        try:
            value = json.loads(
                line,
                object_pairs_hook=_reject_duplicate_json_keys,
                parse_constant=lambda constant: (_ for _ in ()).throw(
                    ValueError(f"invalid JSON constant: {constant}")
                ),
            )
        except (json.JSONDecodeError, ValueError):
            continue
        if isinstance(value, dict):
            values.append(value)
    if len(values) != 1:
        return None, "runner-result-malformed"
    return values[0], None


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


def _check_repository(
    spec: Mapping[str, Any], issues: list[dict[str, str]]
) -> str | None:
    repo = str(spec["repoPath"])
    _require_directory(issues, repo, "repo.directory")
    _require_directory(issues, os.path.join(repo, ".git"), "repo.git")
    if any(issue["code"] in {"repo.directory", "repo.git"} for issue in issues):
        return None
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
        return None
    return head.stdout.strip()


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


def _runtime_probe_arguments(spec: Mapping[str, Any]) -> list[str]:
    contract = spec["runtimeManifestContract"]
    arguments = [
        "probe-capture",
        "--run-id",
        str(spec.get("runtimeProbeRunId") or "preflight-probe"),
        "--host",
        str(spec["host"]),
        "--ansible-marker",
    ]
    for unit in contract["systemdUnits"]:
        arguments.extend(("--unit", unit))
    for unit in contract["restartOnRestoreUnits"]:
        arguments.extend(("--restart-on-restore-unit", unit))
    for service in contract["dockerServices"]:
        arguments.extend(("--docker-service", service))
    compose = contract["compose"]
    if compose is not None:
        arguments.extend(
            (
                "--compose-project",
                compose["project"],
                "--compose-working-directory",
                compose["workingDirectory"],
            )
        )
        for path in compose["configFiles"]:
            arguments.extend(("--compose-config-file", path))
    return arguments


def _decode_unique_runtime_marker(
    output: str, pattern: re.Pattern[str], *, label: str
) -> dict[str, Any]:
    matches = pattern.findall(output)
    if not matches:
        raise ValueError(f"{label} marker is missing")
    decoded: list[dict[str, Any]] = []
    for encoded in matches:
        if len(encoded) > 65536:
            raise ValueError(f"{label} marker is too large")
        try:
            raw = base64.b64decode(encoded, altchars=b"-_", validate=True)
            if base64.urlsafe_b64encode(raw).decode("ascii") != encoded:
                raise ValueError("non-canonical marker")
            value = json.loads(
                raw.decode("utf-8"),
                object_pairs_hook=_reject_duplicate_json_keys,
                parse_constant=lambda constant: (_ for _ in ()).throw(
                    ValueError(f"invalid JSON constant: {constant}")
                ),
            )
        except (binascii.Error, UnicodeError, json.JSONDecodeError, ValueError) as error:
            raise ValueError(f"{label} marker is malformed") from error
        if not isinstance(value, dict):
            raise ValueError(f"{label} marker is not an object")
        decoded.append(value)
    if any(value != decoded[0] for value in decoded[1:]):
        raise ValueError(f"{label} markers disagree")
    return decoded[0]


def _probe_runtime_capture(
    spec: Mapping[str, Any], runtime_manifest_source: str
) -> dict[str, str] | None:
    completed = _command(
        [
            "/usr/bin/python3",
            "-",
            *_runtime_probe_arguments(spec),
        ],
        timeout=60,
        input_text=runtime_manifest_source,
    )
    output = f"{completed.stdout}\n{completed.stderr}"
    if completed.returncode != 0:
        try:
            payload = _decode_unique_runtime_marker(
                output, RUNTIME_ERROR_MARKER_RE, label="runtime capture error"
            )
        except ValueError:
            return {
                "code": "runtime.capture-probe",
                "message": "runtime capture compatibility probe failed without safe evidence",
            }
        if (
            set(payload) != {"version", "code", "message"}
            or payload.get("version") != 1
            or not isinstance(payload.get("code"), str)
            or re.fullmatch(r"[a-z0-9.-]{1,100}", payload["code"]) is None
            or not isinstance(payload.get("message"), str)
            or not payload["message"]
            or len(payload["message"]) > 512
        ):
            return {
                "code": "runtime.capture-probe",
                "message": "runtime capture compatibility returned malformed safe evidence",
            }
        return {"code": payload["code"], "message": payload["message"]}
    try:
        payload = _decode_unique_runtime_marker(
            output, RUNTIME_RESULT_MARKER_RE, label="runtime capture result"
        )
    except ValueError as error:
        return {"code": "runtime.capture-probe", "message": str(error)}
    contract = spec["runtimeManifestContract"]
    if (
        set(payload)
        != {"compatible", "unitCount", "dockerCount", "presentDockerCount"}
        or payload.get("compatible") is not True
        or payload.get("unitCount") != len(contract["systemdUnits"])
        or payload.get("dockerCount") != len(contract["dockerServices"])
        or type(payload.get("presentDockerCount")) is not int
        or not 0 <= payload["presentDockerCount"] <= payload["dockerCount"]
    ):
        return {
            "code": "runtime.capture-probe",
            "message": "runtime capture compatibility result is invalid",
        }
    return None


def _enabled_agent_health_specs(
    spec: Mapping[str, Any],
) -> tuple[tuple[str, bool], ...]:
    if spec["profile"] != "kiosk":
        return ()
    return tuple(
        (agent, require_pcscd)
        for flag, agent, require_pcscd in (
            ("nfcEnabled", "nfc-agent", True),
            ("barcodeEnabled", "barcode-agent", False),
            ("torqueEnabled", "torque-agent", False),
        )
        if spec[flag]
    )


def _probe_live_agent_health(
    spec: Mapping[str, Any], agent_health_source: str
) -> list[dict[str, str]]:
    """Run the exact candidate health proof against every live enabled agent."""

    selected = _enabled_agent_health_specs(spec)
    if not selected:
        return []
    contract = spec["runtimeManifestContract"]
    compose = contract.get("compose")
    config_files = compose.get("configFiles") if isinstance(compose, dict) else None
    if not isinstance(config_files, list) or len(config_files) != 1:
        return [
            {
                "code": "agent.health-contract",
                "message": "kiosk agent health Compose contract is malformed",
            }
        ]
    issues: list[dict[str, str]] = []
    for agent, require_pcscd in selected:
        arguments = [
            "/usr/bin/python3",
            "-",
            "--agent",
            agent,
            "--repository",
            spec["repoPath"],
            "--compose-file",
            config_files[0],
            *(["--require-pcscd"] if require_pcscd else []),
            "--ansible-marker",
        ]
        completed = _command(
            arguments,
            timeout=20,
            input_text=agent_health_source,
        )
        output = f"{completed.stdout}\n{completed.stderr}"
        markers = AGENT_HEALTH_MARKER_RE.findall(output)
        if (
            completed.returncode != 0
            or not markers
            or any(marker != markers[0] for marker in markers[1:])
            or markers[0][0] != agent
        ):
            _issue(
                issues,
                f"agent.{agent}.health",
                f"{agent} did not pass the stable live health contract",
            )
            continue
        port = int(markers[0][1])
        if not 1 <= port <= 65535:
            _issue(
                issues,
                f"agent.{agent}.health",
                f"{agent} returned a malformed live health result",
            )
    return issues


def run_target_probe(
    spec: Mapping[str, Any],
    *,
    runtime_manifest_source: str | None = None,
    agent_health_source: str | None = None,
    torque_helper_template_source: str | None = None,
) -> dict[str, Any]:
    issues: list[dict[str, str]] = []
    for code in spec["inventoryIssues"]:
        _issue(issues, code, "inventory contract is incomplete or invalid")
    repository_head = _check_repository(spec, issues)
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

    if runtime_manifest_source is not None:
        runtime_issue = _probe_runtime_capture(spec, runtime_manifest_source)
        if runtime_issue is not None:
            issues.append(runtime_issue)
    if agent_health_source is not None:
        issues.extend(_probe_live_agent_health(spec, agent_health_source))
    if torque_helper_template_source is not None:
        torque_helper_issue = _probe_candidate_torque_helper(
            spec, torque_helper_template_source
        )
        if torque_helper_issue is not None:
            issues.append(torque_helper_issue)

    local_runner_preflight, local_runner_issue = _probe_local_runner(spec)

    return {
        "version": 1,
        "host": spec["host"],
        "profile": spec["profile"],
        "ready": not issues,
        "issues": issues,
        "repositoryHead": repository_head,
        "localRunnerPreflight": local_runner_preflight,
        "localRunnerIssue": local_runner_issue,
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
            value = json.loads(
                raw.decode("utf-8"),
                object_pairs_hook=_reject_duplicate_json_keys,
                parse_constant=lambda constant: (_ for _ in ()).throw(
                    ValueError(f"invalid JSON constant: {constant}")
                ),
            )
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


def _remote_probe_command(
    target: Mapping[str, Any],
    *,
    transport_security_options: Sequence[str] | None = None,
) -> list[str]:
    remote = shlex.join(
        [
            "/usr/bin/sudo",
            "-n",
            "/usr/bin/python3",
            "-c",
            TARGET_LOADER,
        ]
    )
    if transport_security_options is None:
        security_options = (
            "-o",
            "BatchMode=yes",
            "-o",
            "StrictHostKeyChecking=no",
            "-o",
            "UserKnownHostsFile=/dev/null",
        )
    else:
        security_options = tuple(transport_security_options)
    return [
        "/usr/bin/ssh",
        *security_options,
        "-o",
        "ConnectTimeout=12",
        "-o",
        "ServerAliveInterval=5",
        "-o",
        "ServerAliveCountMax=2",
        "-p",
        str(target["port"]),
        "--",
        f"{target['user']}@{target['address']}",
        remote,
    ]


def _remote_probe_input(
    target: Mapping[str, Any],
    source: str,
    runtime_manifest_source: str,
    agent_health_source: str = "",
    torque_helper_template_source: str = "",
) -> str:
    if (
        not source.strip()
        or "\x00" in source
        or "\x00" in runtime_manifest_source
        or "\x00" in agent_health_source
        or "\x00" in torque_helper_template_source
    ):
        raise TerminalPreflightConfigError("terminal probe source is malformed")
    serialized = json.dumps(
        {
            "preflightSource": source,
            "runtimeManifestSource": runtime_manifest_source,
            "agentHealthSource": agent_health_source,
            "torqueHelperTemplateSource": torque_helper_template_source,
            "spec": target,
        },
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    if len(serialized.encode("utf-8")) > TARGET_INPUT_MAX_BYTES:
        raise TerminalPreflightConfigError("terminal probe input exceeds its safety limit")
    return serialized


def _bootstrap_evidence(
    value: Any, *, runtime_version: str
) -> dict[str, Any] | None:
    expected = {
        "schemaVersion",
        "attemptId",
        "status",
        "phase",
        "failureCode",
        "cleanup",
        "runtimeVersion",
        "lockSha256",
        "observedAt",
    }
    if not isinstance(value, dict) or set(value) != expected:
        return None
    status = value.get("status")
    phase = value.get("phase")
    failure_code = value.get("failureCode")
    cleanup = value.get("cleanup")
    lock_sha = value.get("lockSha256")
    if (
        value.get("schemaVersion") != 1
        or not isinstance(value.get("attemptId"), str)
        or re.fullmatch(r"[0-9a-f]{32}", value["attemptId"]) is None
        or status not in {"running", "changed", "current", "failed"}
        or phase not in RUNTIME_BOOTSTRAP_PHASES
        or cleanup not in {"pending", "complete", "failed"}
        or value.get("runtimeVersion") != runtime_version
        or not isinstance(value.get("observedAt"), str)
        or re.fullmatch(
            r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}"
            r"(?:\.[0-9]{1,6})?Z",
            value["observedAt"],
        )
        is None
        or (
            lock_sha is not None
            and (
                not isinstance(lock_sha, str)
                or re.fullmatch(r"sha256:[0-9a-f]{64}", lock_sha) is None
            )
        )
    ):
        return None
    if status == "failed":
        if (
            failure_code not in RUNTIME_BOOTSTRAP_FAILURE_CODES
            or phase == "complete"
            or cleanup == "pending"
        ):
            return None
    elif failure_code is not None:
        return None
    if status == "running" and cleanup != "pending":
        return None
    if status in {"changed", "current"} and (
        phase != "complete" or cleanup != "complete" or lock_sha is None
    ):
        return None
    return dict(value)


def _runtime_evidence(
    value: Any, *, runtime_identity: str, runtime_version: str
) -> dict[str, Any] | None:
    if not isinstance(value, dict) or set(value) != {
        "ready",
        "host",
        "pythonVersion",
        "ansibleCoreVersion",
        "collections",
        "freeBytes",
        "runnerVersion",
        "configurationReady",
        "failureCode",
        "bootstrapObservation",
    }:
        return None
    collections = value.get("collections")
    if (
        not isinstance(collections, dict)
        or any(
            not isinstance(name, str)
            or re.fullmatch(r"[a-z0-9_]+(?:\.[a-z0-9_]+)+", name) is None
            or not isinstance(version, str)
            or re.fullmatch(r"[0-9]+(?:\.[0-9]+){1,3}", version) is None
            for name, version in collections.items()
        )
        or len(collections) > 16
    ):
        return None
    python_version = value.get("pythonVersion")
    ansible_core = value.get("ansibleCoreVersion")
    runner_version = value.get("runnerVersion")
    failure_code = value.get("failureCode")
    bootstrap = _bootstrap_evidence(
        value.get("bootstrapObservation"), runtime_version=runtime_version
    )
    if (
        value.get("ready") is not True
        or value.get("host") != STONEBASE_HOST
        or value.get("configurationReady") is not True
        or not isinstance(python_version, str)
        or re.fullmatch(r"[0-9]+(?:\.[0-9]+){1,3}", python_version) is None
        or not isinstance(ansible_core, str)
        or re.fullmatch(r"[0-9]+(?:\.[0-9]+){1,3}", ansible_core) is None
        or type(runner_version) is not int
        or not 1 <= runner_version <= 100
        or failure_code != "ready"
        or failure_code not in LOCAL_RUNNER_FAILURE_CODES
        or re.fullmatch(r"sha256:[0-9a-f]{64}", runtime_identity) is None
        or bootstrap is None
        or bootstrap["status"] not in {"changed", "current"}
    ):
        return None
    return {
        "identity": runtime_identity,
        "python": python_version,
        "ansibleCore": ansible_core,
        "collections": collections,
        "runnerVersion": runner_version,
        "bootstrapObservation": bootstrap,
    }


def _executor_evidence(
    spec: Mapping[str, Any],
    results: Sequence[Mapping[str, Any]],
    local_execution_source: str | None,
    *,
    registry_source: str | None = None,
    registry_payload: str | None = None,
    component_for: Callable[[str], str] | None = None,
    selection_run: Callable[..., Any] | None = None,
) -> dict[str, Any]:
    requested = str(spec.get("requestedExecutor", SSH_EXECUTOR))
    if requested == SSH_EXECUTOR:
        return {
            "requestedExecutor": SSH_EXECUTOR,
            "effectiveExecutor": SSH_EXECUTOR,
            "fallbackReason": None,
            "runtime": None,
            "bootstrapObservation": None,
        }
    if len(results) != 1 or spec["targets"][0]["host"] != STONEBASE_HOST:
        raise TerminalPreflightConfigError(
            "local executor evidence escaped StoneBase"
        )
    if not isinstance(local_execution_source, str) or not local_execution_source.strip():
        raise TerminalPreflightConfigError(
            "candidate local executor source is unavailable"
        )
    if component_for is None:
        component_for = _candidate_registry_component_for(
            registry_source,
            registry_payload,
            repository_root=Path(str(spec["project"])),
        )

    target = spec["targets"][0]
    result = results[0]
    previous_sha = result.get("repositoryHead")
    runner_preflight = result.get("localRunnerPreflight")
    public_contract = {
        "host": target["host"],
        "profile": target["profile"],
        "user": target["user"],
        "repoPath": target["repoPath"],
        "nfcEnabled": target["nfcEnabled"],
        "barcodeEnabled": target["barcodeEnabled"],
        "torqueEnabled": target["torqueEnabled"],
        "servicesToRestart": target["servicesToRestart"],
    }
    module_name = "_raspi_candidate_local_execution_preflight"
    module = types.ModuleType(module_name)
    module.__file__ = "<candidate-local-execution>"
    sys.modules[module_name] = module
    try:
        exec(
            compile(
                local_execution_source,
                "<candidate-local-execution>",
                "exec",
            ),
            module.__dict__,
        )
        arguments: dict[str, Any] = {
            "requested_executor": requested,
            "project": Path(str(spec["project"])),
            "previous_sha": previous_sha,
            "candidate_sha": spec["sha"],
            "host": target["host"],
            "public_contract": public_contract,
            "runner_preflight": runner_preflight,
            "component_for": component_for,
        }
        if selection_run is not None:
            arguments["run"] = selection_run
        selection = module.select_executor(**arguments)
        runtime_identity = module.runtime_claim_identity()
        runtime_version = module.RUNTIME_VERSION
    except Exception as error:
        raise TerminalPreflightConfigError(
            "candidate local executor selection failed closed"
        ) from error
    finally:
        sys.modules.pop(module_name, None)
    fallback_reason = selection.fallback_reason
    if fallback_reason is not None and (
        not isinstance(fallback_reason, str)
        or not fallback_reason
        or len(fallback_reason) > 256
        or any(
            ord(character) < 32 or ord(character) == 127
            for character in fallback_reason
        )
    ):
        raise TerminalPreflightConfigError(
            "candidate local executor fallback reason is malformed"
        )
    runtime = _runtime_evidence(
        runner_preflight,
        runtime_identity=runtime_identity,
        runtime_version=runtime_version,
    )
    bootstrap = _bootstrap_evidence(
        (
            runner_preflight.get("bootstrapObservation")
            if isinstance(runner_preflight, dict)
            else None
        ),
        runtime_version=runtime_version,
    )
    if selection.effective_executor == LOCAL_EXECUTOR and runtime is None:
        raise TerminalPreflightConfigError(
            "effective local executor has no runtime identity proof"
        )
    return {
        "requestedExecutor": selection.requested_executor,
        "effectiveExecutor": selection.effective_executor,
        "fallbackReason": fallback_reason,
        "runtime": runtime,
        "bootstrapObservation": bootstrap,
    }


def _terminal_report(
    *,
    status: str,
    issues: Sequence[str],
    executor: Mapping[str, Any],
    target_count: int,
) -> dict[str, Any]:
    return {
        "version": 1,
        "probe": "terminal",
        "status": status,
        "issues": [value[:256] for value in issues[:100]],
        "executor": dict(executor),
        "targetCount": target_count,
    }


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
        runtime_manifest_source, runtime_source_issues = (
            _candidate_runtime_manifest_source(
                spec, run_command=candidate_run_command
            )
        )
        candidate_issues.extend(runtime_source_issues)
        agent_health_source, agent_health_source_issues = (
            _candidate_agent_health_source(
                spec, run_command=candidate_run_command
            )
        )
        candidate_issues.extend(agent_health_source_issues)
        torque_bluetooth_sources, torque_helper_source_issues = (
            _candidate_torque_bluetooth_sources(
                spec, run_command=candidate_run_command
            )
        )
        candidate_issues.extend(torque_helper_source_issues)
        candidate_issues.extend(
            _candidate_torque_bluetooth_contract_issues(torque_bluetooth_sources)
        )
        torque_helper_template_source = torque_bluetooth_sources.get(
            _TORQUE_HELPER_ARTIFACT, ""
        )
        local_execution_source: str | None = None
        local_registry_source: str | None = None
        local_registry_payload: str | None = None
        local_transport_source: str | None = None
        local_known_hosts_payload: str | None = None
        local_transport_options: tuple[str, ...] | None = None
        local_transport_blocked = False
        local_transport_staging: tempfile.TemporaryDirectory[str] | None = None
        if spec.get("requestedExecutor", SSH_EXECUTOR) == LOCAL_EXECUTOR:
            local_execution_source, local_source_issues = _candidate_helper_source(
                spec,
                relative_path="scripts/deploy/rolling_release/local_execution.py",
                issue_scope="local-execution",
                run_command=candidate_run_command,
            )
            candidate_issues.extend(local_source_issues)
            local_registry_source, registry_source_issues = _candidate_helper_source(
                spec,
                relative_path="scripts/deploy/terminal_profile_registry.py",
                issue_scope="terminal-impact-registry-source",
                run_command=candidate_run_command,
            )
            candidate_issues.extend(registry_source_issues)
            local_registry_payload, registry_payload_issues = _candidate_helper_source(
                spec,
                relative_path="scripts/deploy/terminal-profile-registry.json",
                issue_scope="terminal-impact-registry-payload",
                run_command=candidate_run_command,
            )
            candidate_issues.extend(registry_payload_issues)
            local_transport_source, transport_source_issues = _candidate_helper_source(
                spec,
                relative_path=LOCAL_TRANSPORT_SOURCE,
                issue_scope="local-transport-source",
                run_command=candidate_run_command,
            )
            candidate_issues.extend(transport_source_issues)
            local_known_hosts_payload, known_hosts_issues = _candidate_helper_source(
                spec,
                relative_path=LOCAL_KNOWN_HOSTS,
                issue_scope="local-known-hosts",
                run_command=candidate_run_command,
            )
            candidate_issues.extend(known_hosts_issues)
            if not transport_source_issues and not known_hosts_issues:
                try:
                    local_transport_staging = tempfile.TemporaryDirectory(
                        prefix="raspi-local-known-hosts-"
                    )
                    local_transport_options = _candidate_local_transport_options(
                        local_transport_source,
                        local_known_hosts_payload,
                        known_hosts_path=(
                            Path(local_transport_staging.name) / "stonebase-known-hosts"
                        ),
                    )
                except (OSError, TerminalPreflightConfigError):
                    candidate_issues.append(
                        {
                            "code": "candidate.local-transport-contract",
                            "message": "candidate Local transport trust failed closed",
                        }
                    )
                    local_transport_blocked = True
            else:
                local_transport_blocked = True
        results: list[dict[str, Any]] = []
        try:
            for target in spec["targets"]:
                if local_transport_blocked:
                    results.append(
                        {
                            "version": 1,
                            "host": target["host"],
                            "profile": target["profile"],
                            "ready": False,
                            "issues": [
                                {
                                    "code": "transport.pinned-host-key",
                                    "message": "Local pinned host trust is unavailable",
                                }
                            ],
                        }
                    )
                    continue
                command = _remote_probe_command(
                    target,
                    transport_security_options=local_transport_options,
                )
                try:
                    probe_input = _remote_probe_input(
                        target,
                        probe_source,
                        runtime_manifest_source or "",
                        agent_health_source or "",
                        torque_helper_template_source or "",
                    )
                except TerminalPreflightConfigError as error:
                    results.append(
                        {
                            "version": 1,
                            "host": target["host"],
                            "profile": target["profile"],
                            "ready": False,
                            "issues": [
                                {
                                    "code": "transport.input",
                                    "message": str(error),
                                }
                            ],
                        }
                    )
                    continue
                try:
                    completed = run_command(
                        command, timeout=60, input_text=probe_input
                    )
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
        finally:
            if local_transport_staging is not None:
                try:
                    local_transport_staging.cleanup()
                except OSError:
                    candidate_issues.append(
                        {
                            "code": "candidate.local-transport-cleanup",
                            "message": "candidate Local transport staging cleanup failed",
                        }
                    )

        failures = [result for result in results if result.get("ready") is not True]
        try:
            executor = _executor_evidence(
                spec,
                results,
                local_execution_source,
                registry_source=local_registry_source,
                registry_payload=local_registry_payload,
            )
        except TerminalPreflightConfigError:
            candidate_issues.append(
                {
                    "code": "candidate.local-executor-selection",
                    "message": "candidate local executor selection failed closed",
                }
            )
            executor = {
                "requestedExecutor": spec.get(
                    "requestedExecutor", SSH_EXECUTOR
                ),
                "effectiveExecutor": SSH_EXECUTOR,
                "fallbackReason": "executor-preflight-unavailable",
                "runtime": None,
            }
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
            report_issues = [
                f"candidate.{issue.get('code')}" for issue in candidate_issues
            ]
            report_issues.extend(
                f"{result.get('host')}.{issue.get('code')}"
                for result in failures
                for issue in (result.get("issues") or [])
            )
            print(
                json.dumps(
                    _terminal_report(
                        status="blocked",
                        issues=report_issues,
                        executor=executor,
                        target_count=len(results),
                    ),
                    ensure_ascii=True,
                    sort_keys=True,
                    separators=(",", ":"),
                )
            )
            return EX_CONFIG
        print(
            json.dumps(
                _terminal_report(
                    status="passed",
                    issues=[],
                    executor=executor,
                    target_count=len(results),
                ),
                ensure_ascii=True,
                sort_keys=True,
                separators=(",", ":"),
            )
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
        runtime_source = globals().get("EMBEDDED_RUNTIME_MANIFEST_SOURCE")
        agent_health_source = globals().get("EMBEDDED_AGENT_HEALTH_SOURCE")
        torque_helper_template_source = globals().get(
            "EMBEDDED_TORQUE_HELPER_TEMPLATE_SOURCE"
        )
        result = run_target_probe(
            spec,
            runtime_manifest_source=(
                runtime_source
                if isinstance(runtime_source, str) and runtime_source.strip()
                else None
            ),
            agent_health_source=(
                agent_health_source
                if isinstance(agent_health_source, str)
                and agent_health_source.strip()
                else None
            ),
            torque_helper_template_source=(
                torque_helper_template_source
                if isinstance(torque_helper_template_source, str)
                and torque_helper_template_source.strip()
                else None
            ),
        )
        print(f"TERMINAL_PREFLIGHT_RESULT:{_encode_marker(result)}")
        return EX_OK if result["ready"] else EX_CONFIG
    return execute_orchestrator(spec)


if __name__ == "__main__":
    raise SystemExit(main())
