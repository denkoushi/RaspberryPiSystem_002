"""Sealed StoneBase local-Ansible candidate and executor contracts.

This module runs on the Pi5 coordinator.  It never reads a secret value into
an artifact: candidate eligibility is decided from the complete Git history
range, the inventory is reconstructed from an explicit public allow-list, and
every archive member is digest-bound to one run, terminal, and pair of sealed
rollback authorities.  Transport and terminal process control are separate
backend boundaries so unit tests do not contact hardware.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import stat
import subprocess
import tempfile
import zipfile
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path, PurePosixPath
from typing import Any, Callable, Mapping, Sequence


SSH_EXECUTOR = "ssh-ansible"
LOCAL_EXECUTOR = "stonebase-local-ansible-poc"
STONEBASE_HOST = "raspi4-kensaku-stonebase01"
STONEBASE_PROFILE = "kiosk"
LOCAL_PLAYBOOK = "infrastructure/ansible/playbooks/deploy-stonebase-local.yml"
SCHEMA_VERSION = 3
MAX_ARTIFACT_BYTES = 128 * 1024 * 1024
MAX_STAGING_BYTES = 256 * 1024 * 1024
MIN_FREE_BYTES = MAX_STAGING_BYTES + MAX_ARTIFACT_BYTES
RUNTIME_ROOT = "/opt/raspi-local-ansible-runtime"
RUNTIME_VERSION = "cpython-3.11.15-20260510-ansible-core-2.19.4-r2"
RUNTIME_BOOTSTRAP_OBSERVATION = "/var/lib/raspi-release/local-runtime-bootstrap.json"
RUNTIME_BOOTSTRAP_LOCK_SHA256 = (
    "sha256:ecde0bbe80d4065f9bb84ecdc9372c08f0530635af459898e6ac8cb233165e5c"
)
RUNTIME_PYTHON = "3.11.15"
RUNTIME_PYTHON_DISTRIBUTION = {
    "version": "3.11.15",
    "filename": (
        "cpython-3.11.15+20260510-aarch64-unknown-linux-gnu-install_only.tar.gz"
    ),
    "source": (
        "https://github.com/astral-sh/python-build-standalone/releases/download/"
        "20260510/cpython-3.11.15%2B20260510-aarch64-unknown-linux-gnu-install_only.tar.gz"
    ),
    "sha256": "0bc1b7acbb888881addf3a1c887a47d510d4300db6e3ad2ba461154b982e456a",
    "size": 48_884_733,
}
RUNTIME_ANSIBLE_CORE = "2.19.4"
RUNTIME_COLLECTIONS = (("community.general", "11.4.1"),)
RUNTIME_ARTIFACT_LOCK_SCHEMA = 4
RUNNER_PREFLIGHT_FAILURE_CODES = frozenset(
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
        "artifact-cache",
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
        "artifact-cache-invalid",
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

_SHA_RE = re.compile(r"^[0-9a-f]{40}$")
_SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
_RUN_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{2,79}$")
_CLIENT_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
_UTC_TIMESTAMP_RE = re.compile(
    r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$"
)
_USER_RE = re.compile(r"^[a-z_][a-z0-9_-]{0,31}$")
_UNIT_RE = re.compile(
    r"^[A-Za-z0-9][A-Za-z0-9_.@:-]{0,126}\.(?:service|timer|socket|path|target|mount)$"
)
_SENSITIVE_COMPONENT_RE = re.compile(
    r"(?:^|[._-])(?:secret|token|password|passwd|credential|private[-_]?key|client[-_]?key)(?:$|[._-])"
)
_NEUTRAL_PREFIXES = (
    "docs/",
    ".cursor/",
    ".agent/",
    ".github/",
    "scripts/deploy/tests/",
)
_LOCAL_MUTATION_PREFIXES = (
    "clients/nfc-agent/",
    "clients/barcode-agent/",
    "clients/torque-agent/",
)
_LOCAL_MUTATION_EXACT = frozenset(
    {
        "infrastructure/docker/Dockerfile.nfc-agent",
        "infrastructure/docker/Dockerfile.barcode-agent",
        "infrastructure/docker/Dockerfile.torque-agent",
        "infrastructure/docker/docker-compose.client.yml",
    }
)
_PAYLOAD_PREFIXES = (
    "infrastructure/ansible/roles/common/",
    "infrastructure/ansible/roles/client/defaults/",
    "infrastructure/ansible/roles/client/handlers/",
)
_PAYLOAD_EXACT = frozenset(
    {
        LOCAL_PLAYBOOK,
        "infrastructure/ansible/roles/client/tasks/local-release.yml",
        "infrastructure/ansible/roles/client/tasks/nfc-agent-lifecycle.yml",
        "infrastructure/ansible/roles/client/tasks/barcode-agent-lifecycle.yml",
        "infrastructure/ansible/roles/client/tasks/torque-agent-lifecycle.yml",
        "infrastructure/ansible/tasks/resource-guard.yml",
    }
)
_PUBLIC_CONTRACT_KEYS = frozenset(
    {
        "host",
        "profile",
        "user",
        "repoPath",
        "nfcEnabled",
        "barcodeEnabled",
        "torqueEnabled",
        "servicesToRestart",
    }
)
_SEALED_INVENTORY_KEYS = frozenset(
    {
        "ansible_connection",
        "ansible_python_interpreter",
        "ansible_user",
        "repo_path",
        "terminal_release_mode",
        "terminal_release_transport",
        "local_execution_mode",
        "local_execution_run_id",
        "local_execution_previous_sha",
        "local_execution_candidate_sha",
        "local_execution_status_client_id",
        "local_execution_bundle_path",
        "local_execution_payload_root",
        "nfc_agent_enabled_local",
        "barcode_agent_enabled",
        "torque_agent_enabled",
        "services_to_restart",
    }
)
_ANSIBLE_CONFIG = (
    b"[defaults]\ninventory = inventory.json\nretry_files_enabled = False\n"
    b"host_key_checking = True\ngathering = explicit\ninterpreter_python = auto_silent\n"
    b"display_args_to_stdout = False\n"
    b"roles_path = payload/infrastructure/ansible/roles\n"
)


class LocalExecutionError(RuntimeError):
    """The local executor could not prove a fail-closed contract."""


@dataclass(frozen=True)
class ExecutorSelection:
    requested_executor: str
    effective_executor: str
    fallback_reason: str | None
    changed_paths: tuple[str, ...] = ()
    public_contract: Mapping[str, Any] | None = None
    runner_preflight: Mapping[str, Any] | None = None


@dataclass(frozen=True)
class CandidateBinding:
    run_id: str
    previous_sha: str
    candidate_sha: str
    host: str
    status_client_id: str
    rollback_manifest_sha256: str
    runtime_manifest_sha256: str
    maintenance_state_sha256: str

    @property
    def unit_name(self) -> str:
        return local_unit_name(self.run_id)

    def validate(self) -> None:
        if _RUN_ID_RE.fullmatch(self.run_id) is None:
            raise LocalExecutionError("local run ID is malformed")
        if _SHA_RE.fullmatch(self.previous_sha) is None:
            raise LocalExecutionError("local previous SHA is malformed")
        if _SHA_RE.fullmatch(self.candidate_sha) is None:
            raise LocalExecutionError("local candidate SHA is malformed")
        if self.host != STONEBASE_HOST:
            raise LocalExecutionError("local executor is limited to StoneBase")
        if _CLIENT_ID_RE.fullmatch(self.status_client_id) is None:
            raise LocalExecutionError("local status identity is malformed")
        for value in (
            self.rollback_manifest_sha256,
            self.runtime_manifest_sha256,
            self.maintenance_state_sha256,
        ):
            if _SHA256_RE.fullmatch(value) is None:
                raise LocalExecutionError("local sealed authority digest is malformed")


@dataclass(frozen=True)
class CandidateArtifact:
    path: Path
    sha256: str
    payload_sha256: str
    size: int
    binding: CandidateBinding


def local_unit_name(run_id: str) -> str:
    if _RUN_ID_RE.fullmatch(run_id) is None:
        raise LocalExecutionError("local run ID is malformed")
    unit = f"raspi-local-ansible-{run_id}.service"
    if len(unit) > 128:
        raise LocalExecutionError("local systemd unit name is too long")
    return unit


def canonical_json(value: Mapping[str, Any]) -> bytes:
    return (
        json.dumps(value, ensure_ascii=True, sort_keys=True, separators=(",", ":"))
        + "\n"
    ).encode("utf-8")


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def authority_digest(value: Mapping[str, Any]) -> str:
    """Digest a bounded public authority record without serialising secrets."""

    return sha256_bytes(canonical_json(value))


def _git(
    project: Path,
    arguments: Sequence[str],
    *,
    run: Callable[..., subprocess.CompletedProcess[Any]] = subprocess.run,
    binary: bool = False,
) -> subprocess.CompletedProcess[Any]:
    command = ["git", "-C", str(project), *arguments]
    completed = run(
        command,
        check=False,
        capture_output=True,
        text=not binary,
        env={
            "PATH": "/usr/bin:/bin:/usr/local/bin",
            "LANG": "C",
            "LC_ALL": "C",
            "GIT_CONFIG_NOSYSTEM": "1",
            "GIT_CONFIG_GLOBAL": "/dev/null",
            "GIT_ATTR_NOSYSTEM": "1",
            "GIT_TERMINAL_PROMPT": "0",
        },
    )
    return completed


def _validated_path(raw: str) -> str:
    if not isinstance(raw, str) or not raw or "\x00" in raw or "\\" in raw:
        raise LocalExecutionError("candidate history returned an unsafe path")
    path = PurePosixPath(raw)
    if path.is_absolute() or any(part in {"", ".", ".."} for part in path.parts):
        raise LocalExecutionError("candidate history returned an unsafe path")
    return path.as_posix()


def path_may_contain_secret(path: str) -> bool:
    path = _validated_path(path)
    lowered = path.lower()
    parts = lowered.split("/")
    if any(part in {"group_vars", "host_vars"} for part in parts):
        return True
    if any(part == ".env" or part.startswith(".env.") for part in parts):
        return True
    if any("vault" in part for part in parts):
        return True
    if lowered.startswith("infrastructure/ansible/inventory"):
        return True
    if lowered.endswith((".pem", ".p12", ".pfx", ".key", "id_rsa", "id_ed25519")):
        return True
    return any(_SENSITIVE_COMPONENT_RE.search(part) is not None for part in parts)


def path_is_local_safe_mutation(path: str) -> bool:
    path = _validated_path(path)
    if path_may_contain_secret(path):
        return False
    return (
        path in _LOCAL_MUTATION_EXACT
        or path.startswith(_LOCAL_MUTATION_PREFIXES)
        or path.startswith(_NEUTRAL_PREFIXES)
        or path in {"AGENTS.md", "README.md"}
    )


def changed_history_paths(
    project: Path,
    previous_sha: str,
    candidate_sha: str,
    *,
    run: Callable[..., subprocess.CompletedProcess[Any]] = subprocess.run,
) -> tuple[str, ...]:
    if _SHA_RE.fullmatch(previous_sha) is None or _SHA_RE.fullmatch(candidate_sha) is None:
        raise LocalExecutionError("candidate history SHA is malformed")
    ancestor = _git(
        project,
        ["merge-base", "--is-ancestor", previous_sha, candidate_sha],
        run=run,
    )
    if ancestor.returncode != 0:
        raise LocalExecutionError("candidate is not a descendant of the terminal SHA")
    if previous_sha == candidate_sha:
        return ()
    history = _git(
        project,
        [
            "log",
            "--format=",
            "--name-only",
            "-z",
            f"{previous_sha}..{candidate_sha}",
        ],
        run=run,
        binary=True,
    )
    if history.returncode != 0 or not isinstance(history.stdout, (bytes, bytearray)):
        raise LocalExecutionError("candidate history paths are unavailable")
    values = {
        _validated_path(raw.decode("utf-8"))
        for raw in bytes(history.stdout).split(b"\0")
        if raw
    }
    return tuple(sorted(values))


def validate_public_contract(value: Mapping[str, Any]) -> dict[str, Any]:
    if not isinstance(value, Mapping) or set(value) != _PUBLIC_CONTRACT_KEYS:
        raise LocalExecutionError("local public inventory contract is malformed")
    result = dict(value)
    if result["host"] != STONEBASE_HOST or result["profile"] != STONEBASE_PROFILE:
        raise LocalExecutionError("local public inventory identity is not StoneBase")
    if not isinstance(result["user"], str) or _USER_RE.fullmatch(result["user"]) is None:
        raise LocalExecutionError("local public inventory user is malformed")
    repo = result["repoPath"]
    if (
        not isinstance(repo, str)
        or repo != "/opt/RaspberryPiSystem_002"
        or str(PurePosixPath(repo)) != repo
    ):
        raise LocalExecutionError("local public inventory repository is malformed")
    for name in ("nfcEnabled", "barcodeEnabled", "torqueEnabled"):
        if type(result[name]) is not bool:
            raise LocalExecutionError("local public inventory feature flag is malformed")
    services = result["servicesToRestart"]
    if (
        not isinstance(services, list)
        or any(not isinstance(unit, str) or _UNIT_RE.fullmatch(unit) is None for unit in services)
        or len(services) != len(set(services))
        or len(services) > 32
    ):
        raise LocalExecutionError("local public inventory service list is malformed")
    if any(path_may_contain_secret(str(key)) for key in result):
        raise LocalExecutionError("local public inventory contains a secret-like key")
    return result


def validate_runner_preflight(value: Mapping[str, Any], *, host: str) -> dict[str, Any]:
    expected = {
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
    }
    if not isinstance(value, Mapping) or set(value) != expected:
        raise LocalExecutionError("local runner preflight is malformed")
    result = dict(value)
    failure_code = result["failureCode"]
    if not isinstance(failure_code, str) or failure_code not in RUNNER_PREFLIGHT_FAILURE_CODES:
        raise LocalExecutionError("local runner preflight failure code is malformed")
    if failure_code != "ready":
        raise LocalExecutionError(f"local runner preflight reports {failure_code}")
    if (
        result["ready"] is not True
        or result["host"] != host
        or result["pythonVersion"] != RUNTIME_PYTHON
        or result["ansibleCoreVersion"] != RUNTIME_ANSIBLE_CORE
        or result["collections"] != dict(RUNTIME_COLLECTIONS)
        or isinstance(result["freeBytes"], bool)
        or not isinstance(result["freeBytes"], int)
        or result["freeBytes"] < MIN_FREE_BYTES
        or result["runnerVersion"] != SCHEMA_VERSION
        or result["configurationReady"] is not True
    ):
        raise LocalExecutionError("local runner/runtime preflight did not match the lock")
    observation = validate_runtime_bootstrap_observation(
        result["bootstrapObservation"]
    )
    if (
        observation["status"] not in {"changed", "current"}
        or observation["phase"] != "complete"
        or observation["cleanup"] != "complete"
        or observation["lockSha256"] != RUNTIME_BOOTSTRAP_LOCK_SHA256
    ):
        raise LocalExecutionError("local runtime bootstrap proof is not ready")
    return result


def select_executor(
    *,
    requested_executor: str,
    project: Path,
    previous_sha: str,
    candidate_sha: str,
    host: str,
    public_contract: Mapping[str, Any] | None,
    runner_preflight: Mapping[str, Any] | None,
    run: Callable[..., subprocess.CompletedProcess[Any]] = subprocess.run,
) -> ExecutorSelection:
    if requested_executor == SSH_EXECUTOR:
        return ExecutorSelection(SSH_EXECUTOR, SSH_EXECUTOR, None)
    if requested_executor != LOCAL_EXECUTOR:
        raise LocalExecutionError("requested executor is unsupported")
    if host != STONEBASE_HOST:
        raise LocalExecutionError("local executor cannot target a non-StoneBase terminal")
    try:
        paths = changed_history_paths(
            Path(project), previous_sha, candidate_sha, run=run
        )
    except LocalExecutionError as error:
        return ExecutorSelection(
            LOCAL_EXECUTOR, SSH_EXECUTOR, f"history-ineligible: {error}"
        )
    secret_paths = [path for path in paths if path_may_contain_secret(path)]
    if secret_paths:
        return ExecutorSelection(
            LOCAL_EXECUTOR,
            SSH_EXECUTOR,
            "candidate-history-touches-secret-path",
            (),
        )
    if any(not path_is_local_safe_mutation(path) for path in paths):
        return ExecutorSelection(
            LOCAL_EXECUTOR,
            SSH_EXECUTOR,
            "candidate-requires-ssh-configuration",
            paths,
        )
    try:
        public = validate_public_contract(public_contract or {})
        preflight = validate_runner_preflight(runner_preflight or {}, host=host)
    except LocalExecutionError as error:
        return ExecutorSelection(
            LOCAL_EXECUTOR,
            SSH_EXECUTOR,
            f"runner-ineligible: {error}",
            paths,
        )
    return ExecutorSelection(
        LOCAL_EXECUTOR,
        LOCAL_EXECUTOR,
        None,
        paths,
        public,
        preflight,
    )


def runtime_prefetch_required(
    *,
    requested_executor: str,
    effective_executor: str,
    fallback_reason: str | None,
    mutation_required: bool,
) -> bool:
    """Select only safe Local-to-SSH bootstrap fallbacks for prefetch."""

    if (
        requested_executor != LOCAL_EXECUTOR
        or effective_executor != SSH_EXECUTOR
        or mutation_required is not True
        or not isinstance(fallback_reason, str)
    ):
        return False
    return (
        fallback_reason == "candidate-requires-ssh-configuration"
        or fallback_reason.startswith("runner-ineligible:")
    )


def runtime_lock_payload() -> dict[str, Any]:
    return {
        "schemaVersion": RUNTIME_ARTIFACT_LOCK_SCHEMA,
        "runtimeVersion": RUNTIME_VERSION,
        "python": RUNTIME_PYTHON,
        "pythonDistribution": dict(RUNTIME_PYTHON_DISTRIBUTION),
        "ansibleCore": RUNTIME_ANSIBLE_CORE,
        "collections": dict(RUNTIME_COLLECTIONS),
        "runtimeRoot": RUNTIME_ROOT,
        "bootstrapLockSha256": RUNTIME_BOOTSTRAP_LOCK_SHA256,
    }


def runtime_claim_identity() -> str:
    """Return the typed sha256 identity of the exact pinned runtime lock."""

    return f"sha256:{sha256_bytes(canonical_json(runtime_lock_payload()))}"


def validate_runtime_bootstrap_observation(value: Any) -> dict[str, Any]:
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
    if not isinstance(value, Mapping) or set(value) != expected:
        raise LocalExecutionError("runtime bootstrap observation is malformed")
    result = dict(value)
    status = result["status"]
    phase = result["phase"]
    failure_code = result["failureCode"]
    lock_sha = result["lockSha256"]
    if (
        result["schemaVersion"] != 1
        or not isinstance(result["attemptId"], str)
        or re.fullmatch(r"[0-9a-f]{32}", result["attemptId"]) is None
        or status not in {"running", "changed", "current", "failed"}
        or phase not in RUNTIME_BOOTSTRAP_PHASES
        or result["cleanup"] not in {"pending", "complete", "failed"}
        or result["runtimeVersion"] != RUNTIME_VERSION
        or not isinstance(result["observedAt"], str)
        or _UTC_TIMESTAMP_RE.fullmatch(result["observedAt"]) is None
        or (
            lock_sha is not None
            and (
                not isinstance(lock_sha, str)
                or re.fullmatch(r"sha256:[0-9a-f]{64}", lock_sha) is None
            )
        )
    ):
        raise LocalExecutionError("runtime bootstrap observation is malformed")
    if status == "failed":
        if (
            failure_code not in RUNTIME_BOOTSTRAP_FAILURE_CODES
            or phase == "complete"
            or result["cleanup"] == "pending"
        ):
            raise LocalExecutionError("runtime bootstrap failure code is malformed")
    elif failure_code is not None:
        raise LocalExecutionError("runtime bootstrap success contains a failure code")
    if status == "running" and result["cleanup"] != "pending":
        raise LocalExecutionError("runtime bootstrap running state is malformed")
    if status in {"changed", "current"} and (
        phase != "complete" or result["cleanup"] != "complete" or lock_sha is None
    ):
        raise LocalExecutionError("runtime bootstrap success is incomplete")
    return result


def _inventory(binding: CandidateBinding, public: Mapping[str, Any]) -> bytes:
    contract = validate_public_contract(public)
    host_vars = {
        "ansible_connection": "local",
        "ansible_python_interpreter": f"{RUNTIME_ROOT}/active/bin/python3",
        "ansible_user": contract["user"],
        "repo_path": contract["repoPath"],
        "terminal_release_mode": "release-only",
        "terminal_release_transport": "local-artifact",
        "local_execution_mode": LOCAL_EXECUTOR,
        "local_execution_run_id": binding.run_id,
        "local_execution_previous_sha": binding.previous_sha,
        "local_execution_candidate_sha": binding.candidate_sha,
        "local_execution_status_client_id": binding.status_client_id,
        "local_execution_bundle_path": "{{ inventory_dir }}/candidate.bundle",
        "local_execution_payload_root": "{{ inventory_dir }}/payload",
        "nfc_agent_enabled_local": contract["nfcEnabled"],
        "barcode_agent_enabled": contract["barcodeEnabled"],
        "torque_agent_enabled": contract["torqueEnabled"],
        "services_to_restart": contract["servicesToRestart"],
    }
    return canonical_json(
        {
            "all": {
                "children": {
                    "stonebase_local": {
                        "hosts": {binding.host: host_vars}
                    }
                }
            }
        }
    )


def _payload_digest(members: Mapping[str, bytes]) -> str:
    digest = hashlib.sha256()
    for name in sorted(members):
        value = members[name]
        digest.update(name.encode("utf-8"))
        digest.update(b"\0")
        digest.update(str(len(value)).encode("ascii"))
        digest.update(b"\0")
        digest.update(value)
        digest.update(b"\0")
    return digest.hexdigest()


def _candidate_payload(
    project: Path,
    candidate_sha: str,
    *,
    run: Callable[..., subprocess.CompletedProcess[Any]] = subprocess.run,
) -> dict[str, bytes]:
    tree = _git(
        project,
        [
            "ls-tree",
            "-r",
            "-z",
            candidate_sha,
            "--",
            *sorted(_PAYLOAD_PREFIXES),
            *sorted(_PAYLOAD_EXACT),
        ],
        run=run,
        binary=True,
    )
    if tree.returncode != 0 or not isinstance(tree.stdout, (bytes, bytearray)):
        raise LocalExecutionError("candidate Ansible payload tree is unavailable")
    result: dict[str, bytes] = {}
    for record in bytes(tree.stdout).split(b"\0"):
        if not record:
            continue
        try:
            metadata, raw_path = record.split(b"\t", 1)
            mode, object_type, _object_id = metadata.decode("ascii").split(" ")
            path = _validated_path(raw_path.decode("utf-8"))
        except (ValueError, UnicodeDecodeError) as error:
            raise LocalExecutionError("candidate Ansible payload tree is malformed") from error
        if object_type != "blob" or mode == "120000" or path_may_contain_secret(path):
            raise LocalExecutionError("candidate Ansible payload member is unsafe")
        if path not in _PAYLOAD_EXACT and not path.startswith(_PAYLOAD_PREFIXES):
            raise LocalExecutionError("candidate Ansible payload escaped its allow-list")
        shown = _git(project, ["show", f"{candidate_sha}:{path}"], run=run, binary=True)
        if shown.returncode != 0 or not isinstance(shown.stdout, (bytes, bytearray)):
            raise LocalExecutionError("candidate Ansible payload blob is unavailable")
        result[f"payload/{path}"] = bytes(shown.stdout)
    required = {f"payload/{path}" for path in _PAYLOAD_EXACT}
    if not required <= set(result):
        raise LocalExecutionError("candidate Ansible payload is incomplete")
    return result


def _create_incremental_bundle(
    project: Path,
    destination: Path,
    binding: CandidateBinding,
    *,
    run: Callable[..., subprocess.CompletedProcess[Any]] = subprocess.run,
) -> bytes | None:
    if binding.previous_sha == binding.candidate_sha:
        return None
    head = _git(project, ["rev-parse", "HEAD"], run=run)
    if head.returncode != 0 or str(head.stdout).strip() != binding.candidate_sha:
        raise LocalExecutionError("Pi5 checkout is not the bound candidate SHA")
    completed = _git(
        project,
        ["bundle", "create", str(destination), "HEAD", f"^{binding.previous_sha}"],
        run=run,
    )
    if completed.returncode != 0 or not destination.is_file():
        raise LocalExecutionError("incremental candidate bundle could not be created")
    payload = destination.read_bytes()
    if not payload or len(payload) > MAX_ARTIFACT_BYTES:
        raise LocalExecutionError("incremental candidate bundle is outside the size limit")
    return payload


def _manifest(binding: CandidateBinding, members: Mapping[str, bytes]) -> dict[str, Any]:
    return {
        "schemaVersion": SCHEMA_VERSION,
        "mode": LOCAL_EXECUTOR,
        "runId": binding.run_id,
        "host": binding.host,
        "profileId": STONEBASE_PROFILE,
        "statusClientId": binding.status_client_id,
        "previousSha": binding.previous_sha,
        "candidateSha": binding.candidate_sha,
        "playbook": f"payload/{LOCAL_PLAYBOOK}",
        "unitName": binding.unit_name,
        "bundleRequired": binding.previous_sha != binding.candidate_sha,
        "runtime": runtime_lock_payload(),
        "rollbackManifestSha256": binding.rollback_manifest_sha256,
        "runtimeManifestSha256": binding.runtime_manifest_sha256,
        "maintenanceStateSha256": binding.maintenance_state_sha256,
        "memberSha256": {name: sha256_bytes(value) for name, value in members.items()},
        "payloadSha256": _payload_digest(members),
    }


def build_candidate_artifact(
    project: Path,
    destination: Path,
    binding: CandidateBinding,
    public_contract: Mapping[str, Any],
    *,
    run: Callable[..., subprocess.CompletedProcess[Any]] = subprocess.run,
) -> CandidateArtifact:
    """Create one incremental, secret-free candidate archive atomically."""

    binding.validate()
    project = Path(project)
    destination = Path(destination)
    if destination.exists() or destination.is_symlink():
        raise LocalExecutionError("local artifact destination already exists")
    destination.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    members: dict[str, bytes] = {
        "ansible.cfg": _ANSIBLE_CONFIG,
        "inventory.json": _inventory(binding, public_contract),
        "runtime-lock.json": canonical_json(runtime_lock_payload()),
    }
    members.update(_candidate_payload(project, binding.candidate_sha, run=run))
    with tempfile.NamedTemporaryFile(
        prefix=".candidate-bundle-", suffix=".bundle", dir=destination.parent, delete=False
    ) as temporary_bundle:
        bundle_path = Path(temporary_bundle.name)
    try:
        bundle = _create_incremental_bundle(
            project, bundle_path, binding, run=run
        )
        if bundle is not None:
            members["candidate.bundle"] = bundle
    finally:
        if bundle_path.exists():
            bundle_path.unlink()
    if any(path_may_contain_secret(name) for name in members):
        raise LocalExecutionError("local artifact member name is secret-like")
    manifest = _manifest(binding, members)
    archive_members = {
        **members,
        "binding-manifest.json": canonical_json(manifest),
    }
    if sum(len(value) for value in archive_members.values()) > MAX_STAGING_BYTES:
        raise LocalExecutionError("local artifact staging payload is too large")
    with tempfile.NamedTemporaryFile(
        prefix=f".{destination.name}.", suffix=".tmp", dir=destination.parent, delete=False
    ) as temporary_archive:
        archive_path = Path(temporary_archive.name)
    try:
        with zipfile.ZipFile(
            archive_path, "w", compression=zipfile.ZIP_DEFLATED, allowZip64=False
        ) as archive:
            for name in sorted(archive_members):
                info = zipfile.ZipInfo(name)
                info.external_attr = (stat.S_IFREG | 0o600) << 16
                archive.writestr(info, archive_members[name])
        if archive_path.stat().st_size > MAX_ARTIFACT_BYTES:
            raise LocalExecutionError("local artifact is larger than 128 MiB")
        archive_path.chmod(0o600)
        os.replace(archive_path, destination)
    finally:
        if archive_path.exists():
            archive_path.unlink()
    result = CandidateArtifact(
        path=destination,
        sha256=sha256_file(destination),
        payload_sha256=manifest["payloadSha256"],
        size=destination.stat().st_size,
        binding=binding,
    )
    inspect_candidate_artifact(destination, result.sha256, binding)
    return result


def _read_archive(path: Path, expected_sha256: str) -> tuple[dict[str, bytes], dict[str, Any]]:
    if _SHA256_RE.fullmatch(expected_sha256) is None:
        raise LocalExecutionError("expected artifact digest is malformed")
    path = Path(path)
    if (
        not path.is_file()
        or path.is_symlink()
        or path.stat().st_size > MAX_ARTIFACT_BYTES
        or sha256_file(path) != expected_sha256
    ):
        raise LocalExecutionError("local artifact digest or file is invalid")
    members: dict[str, bytes] = {}
    total = 0
    try:
        with zipfile.ZipFile(path) as archive:
            infos = archive.infolist()
            if len(infos) != len({info.filename for info in infos}):
                raise LocalExecutionError("local artifact has duplicate members")
            for info in infos:
                name = _validated_path(info.filename)
                mode = info.external_attr >> 16
                total += info.file_size
                if (
                    stat.S_ISLNK(mode)
                    or not stat.S_ISREG(mode)
                    or info.file_size > MAX_ARTIFACT_BYTES
                    or total > MAX_STAGING_BYTES
                ):
                    raise LocalExecutionError("local artifact member is unsafe")
                members[name] = archive.read(info)
    except (OSError, zipfile.BadZipFile) as error:
        raise LocalExecutionError("local artifact is unreadable") from error
    try:
        manifest = json.loads(members.pop("binding-manifest.json").decode("utf-8"))
    except (KeyError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise LocalExecutionError("local binding manifest is malformed") from error
    if not isinstance(manifest, dict):
        raise LocalExecutionError("local binding manifest is malformed")
    return members, manifest


def inspect_candidate_artifact(
    path: Path, expected_sha256: str, binding: CandidateBinding
) -> dict[str, Any]:
    binding.validate()
    members, manifest = _read_archive(path, expected_sha256)
    if any(not _artifact_member_allowed(name) for name in members):
        raise LocalExecutionError("local artifact contains an unexpected member")
    required_payload = {f"payload/{name}" for name in _PAYLOAD_EXACT}
    if not required_payload <= set(members):
        raise LocalExecutionError("local artifact is missing a fixed payload member")
    if members.get("ansible.cfg") != _ANSIBLE_CONFIG:
        raise LocalExecutionError("local Ansible configuration is not fixed")
    if members.get("runtime-lock.json") != canonical_json(runtime_lock_payload()):
        raise LocalExecutionError("local runtime lock does not match the runner")
    _validate_sealed_inventory(members.get("inventory.json"), binding)
    expected = _manifest(binding, members)
    if manifest != expected:
        raise LocalExecutionError("local binding manifest does not match the artifact")
    if set(manifest["memberSha256"]) != set(members):
        raise LocalExecutionError("local artifact member set does not match the seal")
    if any(
        sha256_bytes(value) != manifest["memberSha256"].get(name)
        for name, value in members.items()
    ):
        raise LocalExecutionError("local artifact member digest does not match")
    if manifest["bundleRequired"] != ("candidate.bundle" in members):
        raise LocalExecutionError("local incremental bundle requirement is inconsistent")
    if any(path_may_contain_secret(name) for name in members):
        raise LocalExecutionError("local artifact contains a secret-like member")
    return manifest


def _artifact_member_allowed(name: str) -> bool:
    if name in {
        "ansible.cfg",
        "inventory.json",
        "runtime-lock.json",
        "candidate.bundle",
    }:
        return True
    if not name.startswith("payload/"):
        return False
    repository_path = name.removeprefix("payload/")
    return repository_path in _PAYLOAD_EXACT or repository_path.startswith(
        _PAYLOAD_PREFIXES
    )


def _validate_sealed_inventory(
    raw: bytes | None, binding: CandidateBinding
) -> dict[str, Any]:
    if not isinstance(raw, bytes) or len(raw) > 64 * 1024:
        raise LocalExecutionError("local sealed inventory is malformed")
    try:
        value = json.loads(raw.decode("utf-8"))
        host_vars = value["all"]["children"]["stonebase_local"]["hosts"][
            binding.host
        ]
    except (KeyError, TypeError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise LocalExecutionError("local sealed inventory is malformed") from error
    if (
        not isinstance(value, dict)
        or set(value) != {"all"}
        or not isinstance(value["all"], dict)
        or set(value["all"]) != {"children"}
        or not isinstance(value["all"]["children"], dict)
        or set(value["all"]["children"]) != {"stonebase_local"}
        or not isinstance(value["all"]["children"]["stonebase_local"], dict)
        or set(value["all"]["children"]["stonebase_local"]) != {"hosts"}
        or not isinstance(value["all"]["children"]["stonebase_local"]["hosts"], dict)
        or set(value["all"]["children"]["stonebase_local"]["hosts"])
        != {binding.host}
        or not isinstance(host_vars, dict)
        or set(host_vars) != _SEALED_INVENTORY_KEYS
    ):
        raise LocalExecutionError("local sealed inventory escaped its fixed schema")
    public = {
        "host": binding.host,
        "profile": STONEBASE_PROFILE,
        "user": host_vars.get("ansible_user"),
        "repoPath": host_vars.get("repo_path"),
        "nfcEnabled": host_vars.get("nfc_agent_enabled_local"),
        "barcodeEnabled": host_vars.get("barcode_agent_enabled"),
        "torqueEnabled": host_vars.get("torque_agent_enabled"),
        "servicesToRestart": host_vars.get("services_to_restart"),
    }
    validate_public_contract(public)
    expected = _inventory(binding, public)
    if raw != expected:
        raise LocalExecutionError("local sealed inventory does not match its binding")
    return value


def validate_local_result(
    value: Mapping[str, Any], *, binding: CandidateBinding, artifact_sha256: str
) -> dict[str, Any]:
    expected_keys = {
        "schemaVersion",
        "runId",
        "host",
        "candidateSha",
        "artifactSha256",
        "unitName",
        "state",
        "startedAt",
        "completedAt",
        "returnCode",
    }
    if not isinstance(value, Mapping) or set(value) != expected_keys:
        raise LocalExecutionError("local result is malformed")
    result = dict(value)
    if (
        result["schemaVersion"] != SCHEMA_VERSION
        or result["runId"] != binding.run_id
        or result["host"] != binding.host
        or result["candidateSha"] != binding.candidate_sha
        or result["artifactSha256"] != artifact_sha256
        or result["unitName"] != binding.unit_name
        or result["state"] not in {"success", "failed", "timeout"}
        or not isinstance(result["startedAt"], str)
        or _UTC_TIMESTAMP_RE.fullmatch(result["startedAt"]) is None
        or not isinstance(result["completedAt"], str)
        or _UTC_TIMESTAMP_RE.fullmatch(result["completedAt"]) is None
        or _SHA256_RE.fullmatch(str(artifact_sha256 or "")) is None
        or isinstance(result["returnCode"], bool)
        or not isinstance(result["returnCode"], int)
        or (result["state"] == "success" and result["returnCode"] != 0)
        or (result["state"] != "success" and result["returnCode"] == 0)
    ):
        raise LocalExecutionError("local result does not match the candidate binding")
    try:
        started_at = datetime.fromisoformat(result["startedAt"].replace("Z", "+00:00"))
        completed_at = datetime.fromisoformat(
            result["completedAt"].replace("Z", "+00:00")
        )
    except ValueError as error:
        raise LocalExecutionError(
            "local result does not match the candidate binding"
        ) from error
    if started_at > completed_at:
        raise LocalExecutionError("local result does not match the candidate binding")
    return result
