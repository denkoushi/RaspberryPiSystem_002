#!/usr/bin/env python3
"""Root-owned receiver and transient-unit worker for StoneBase local Ansible.

Only this installed runner accepts candidate bytes.  It validates the complete
seal before submission, executes one fixed local playbook with output sent to
``/dev/null``, and persists a bounded result without stdout, stderr, inventory,
or credential values.
"""
from __future__ import annotations

import argparse
import fcntl
import hashlib
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
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, BinaryIO, Callable, Mapping, Sequence

try:
    from raspi_local_execution import (  # type: ignore[import-not-found]
        MAX_ARTIFACT_BYTES,
        MAX_STAGING_BYTES,
        MIN_FREE_BYTES,
        RUNTIME_ANSIBLE_CORE,
        RUNTIME_BOOTSTRAP_OBSERVATION,
        RUNTIME_COLLECTIONS,
        RUNTIME_PYTHON,
        RUNTIME_ROOT,
        RUNTIME_VERSION,
        SCHEMA_VERSION,
        STONEBASE_HOST,
        CandidateBinding,
        LocalExecutionError,
        inspect_candidate_artifact,
        local_unit_name,
        sha256_file,
        validate_local_result,
        validate_runtime_bootstrap_observation,
    )
except ModuleNotFoundError:
    from rolling_release.local_execution import (
        MAX_ARTIFACT_BYTES,
        MAX_STAGING_BYTES,
        MIN_FREE_BYTES,
        RUNTIME_ANSIBLE_CORE,
        RUNTIME_BOOTSTRAP_OBSERVATION,
        RUNTIME_COLLECTIONS,
        RUNTIME_PYTHON,
        RUNTIME_ROOT,
        RUNTIME_VERSION,
        SCHEMA_VERSION,
        STONEBASE_HOST,
        CandidateBinding,
        LocalExecutionError,
        inspect_candidate_artifact,
        local_unit_name,
        sha256_file,
        validate_local_result,
        validate_runtime_bootstrap_observation,
    )


STATE_ROOT = Path("/var/lib/raspi-local-release")
RUNNER_PATH = Path("/usr/local/libexec/raspi-local-ansible-runner")
ACTIVE_RUNTIME = Path(RUNTIME_ROOT) / "active"
RUNTIME_LOCK_PATH = Path("/usr/local/libexec/raspi-local-runtime-lock.json")
BOOTSTRAP_OBSERVATION_PATH = Path(RUNTIME_BOOTSTRAP_OBSERVATION)
MAINTENANCE_PROBE = Path("/usr/local/libexec/raspi-terminal-maintenance-probe")
READY_PROBE = Path("/usr/local/libexec/raspi-terminal-ready-probe")
LOCAL_PLAYBOOK_MEMBER = Path(
    "payload/infrastructure/ansible/playbooks/deploy-stonebase-local.yml"
)
EXECUTION_TIMEOUT_SECONDS = 15 * 60
MAX_RESULT_BYTES = 16 * 1024
VERIFICATION_ID_RE = re.compile(r"^[0-9a-f]{32}$")
USER_RE = re.compile(r"^[a-z_][a-z0-9_-]{0,31}$")
CLIENT_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
AGENT_ENVIRONMENTS = {
    "nfc-agent": Path("/opt/RaspberryPiSystem_002/clients/nfc-agent/.env"),
    "barcode-agent": Path("/opt/RaspberryPiSystem_002/clients/barcode-agent/.env"),
    "torque-agent": Path("/opt/RaspberryPiSystem_002/clients/torque-agent/.env"),
}


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _atomic_json(path: Path, value: Mapping[str, Any]) -> None:
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.", suffix=".tmp", dir=path.parent
    )
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            json.dump(value, stream, ensure_ascii=True, sort_keys=True, separators=(",", ":"))
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        temporary.chmod(0o600)
        os.replace(temporary, path)
    finally:
        if temporary.exists():
            temporary.unlink()


def _directories(root: Path, run_id: str) -> dict[str, Path]:
    return {
        "artifacts": root / "artifacts",
        "staging": root / "staging" / run_id,
        "results": root / "results",
        "locks": root / "locks",
        "receipts": root / "receipts",
    }


def _artifact_path(root: Path, binding: CandidateBinding) -> Path:
    return _directories(root, binding.run_id)["artifacts"] / f"{binding.run_id}.zip"


def _result_path(root: Path, binding: CandidateBinding) -> Path:
    return _directories(root, binding.run_id)["results"] / f"{binding.run_id}.json"


def _submission_lock_path(root: Path, binding: CandidateBinding) -> Path:
    return _directories(root, binding.run_id)["locks"] / f"{binding.run_id}.submission.lock"


def _receipt_path(root: Path, binding: CandidateBinding) -> Path:
    return _directories(root, binding.run_id)["receipts"] / f"{binding.run_id}.json"


def _open_lock(path: Path, *, contention: str) -> int:
    descriptor = os.open(
        path,
        os.O_CREAT
        | os.O_RDWR
        | getattr(os, "O_CLOEXEC", 0)
        | getattr(os, "O_NOFOLLOW", 0),
        0o600,
    )
    try:
        os.fchmod(descriptor, 0o600)
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BaseException as error:
        os.close(descriptor)
        if isinstance(error, BlockingIOError):
            raise LocalExecutionError(contention) from error
        raise
    return descriptor


def _submission_is_quiesced(root: Path, binding: CandidateBinding) -> bool:
    path = _submission_lock_path(root, binding)
    try:
        descriptor = _open_lock(
            path, contention="candidate receiver is still running"
        )
    except (OSError, LocalExecutionError):
        return False
    os.close(descriptor)
    return True


def _binding_from_manifest(path: Path) -> CandidateBinding:
    if not path.is_file() or path.is_symlink() or path.stat().st_size > MAX_ARTIFACT_BYTES:
        raise LocalExecutionError("candidate artifact is unavailable")
    try:
        with zipfile.ZipFile(path) as archive:
            info = archive.getinfo("binding-manifest.json")
            if info.file_size > MAX_RESULT_BYTES:
                raise LocalExecutionError("candidate binding manifest is too large")
            value = json.loads(archive.read(info).decode("utf-8"))
    except (KeyError, OSError, UnicodeDecodeError, json.JSONDecodeError, zipfile.BadZipFile) as error:
        raise LocalExecutionError("candidate binding manifest is malformed") from error
    if not isinstance(value, dict):
        raise LocalExecutionError("candidate binding manifest is malformed")
    try:
        binding = CandidateBinding(
            run_id=value["runId"],
            previous_sha=value["previousSha"],
            candidate_sha=value["candidateSha"],
            host=value["host"],
            status_client_id=value["statusClientId"],
            rollback_manifest_sha256=value["rollbackManifestSha256"],
            runtime_manifest_sha256=value["runtimeManifestSha256"],
            maintenance_state_sha256=value["maintenanceStateSha256"],
        )
    except (KeyError, TypeError) as error:
        raise LocalExecutionError("candidate binding manifest is incomplete") from error
    binding.validate()
    return binding


def _require_expected_binding(
    observed: CandidateBinding, expected: CandidateBinding
) -> None:
    if observed != expected:
        raise LocalExecutionError("candidate artifact does not match receiver arguments")


def _require_root() -> None:
    if os.geteuid() != 0:
        raise LocalExecutionError("local runner must run as root")


def _require_status_identity(expected_client_id: str) -> None:
    if (
        CLIENT_ID_RE.fullmatch(expected_client_id) is None
        or _configured_status_client_id() != expected_client_id
    ):
        raise LocalExecutionError("local status configuration identity does not match")


def _read_exact(stream: BinaryIO, size: int) -> bytes:
    if isinstance(size, bool) or not 0 < size <= MAX_ARTIFACT_BYTES:
        raise LocalExecutionError("candidate transfer size is outside the bound")
    chunks: list[bytes] = []
    remaining = size
    while remaining:
        block = stream.read(min(1024 * 1024, remaining))
        if not block:
            raise LocalExecutionError("candidate transfer ended early")
        chunks.append(block)
        remaining -= len(block)
    if stream.read(1):
        raise LocalExecutionError("candidate transfer exceeded the sealed size")
    return b"".join(chunks)


def receive_and_submit(
    binding: CandidateBinding,
    *,
    artifact_sha256: str,
    artifact_size: int,
    stream: BinaryIO,
    root: Path = STATE_ROOT,
    run: Callable[..., subprocess.CompletedProcess[Any]] = subprocess.run,
) -> dict[str, Any]:
    """Receive the candidate once, validate it, then submit one unit."""

    _require_root()
    binding.validate()
    # ``binding.host`` is a coordinator identity, not a mutable OS hostname.
    # The locally configured status client ID is the terminal-held identity
    # that is sealed into the artifact and independently verified by Pi5.
    _require_status_identity(binding.status_client_id)
    paths = _directories(root, binding.run_id)
    for name in ("artifacts", "results", "locks", "receipts"):
        paths[name].mkdir(mode=0o700, parents=True, exist_ok=True)
        paths[name].chmod(0o700)
    submission_descriptor = _open_lock(
        _submission_lock_path(root, binding),
        contention="candidate run is already being received",
    )
    try:
        destination = _artifact_path(root, binding)
        result_path = _result_path(root, binding)
        receipt_path = _receipt_path(root, binding)
        if (
            destination.exists()
            or destination.is_symlink()
            or result_path.exists()
            or receipt_path.exists()
            or receipt_path.is_symlink()
        ):
            raise LocalExecutionError("candidate run has already been received")
        payload = _read_exact(stream, artifact_size)
        descriptor, temporary_name = tempfile.mkstemp(
            prefix=f".{destination.name}.", suffix=".tmp", dir=destination.parent
        )
        temporary = Path(temporary_name)
        try:
            with os.fdopen(descriptor, "wb") as output:
                output.write(payload)
                output.flush()
                os.fsync(output.fileno())
            temporary.chmod(0o600)
            if sha256_file(temporary) != artifact_sha256:
                raise LocalExecutionError("received candidate digest does not match")
            observed = _binding_from_manifest(temporary)
            _require_expected_binding(observed, binding)
            inspect_candidate_artifact(temporary, artifact_sha256, binding)
            os.replace(temporary, destination)
            _atomic_json(
                receipt_path,
                {
                    "schemaVersion": SCHEMA_VERSION,
                    "runId": binding.run_id,
                    "host": binding.host,
                    "candidateSha": binding.candidate_sha,
                    "artifactSha256": artifact_sha256,
                    "unitName": binding.unit_name,
                    "receivedAt": _utc_now(),
                },
            )
        finally:
            if temporary.exists():
                temporary.unlink()

        command = [
            "/usr/bin/systemd-run",
            "--quiet",
            "--no-block",
            f"--unit={binding.unit_name}",
            "--property=Type=exec",
            "--property=KillMode=control-group",
            "--property=Restart=no",
            "--property=UMask=0077",
            "--property=StandardOutput=null",
            "--property=StandardError=null",
            "--",
            str(RUNNER_PATH),
            "execute",
            "--artifact",
            str(destination),
            "--artifact-sha256",
            artifact_sha256,
        ]
        submitted = run(
            command,
            check=False,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            env={"PATH": "/usr/bin:/bin", "LANG": "C", "LC_ALL": "C"},
        )
        if submitted.returncode != 0:
            raise LocalExecutionError("local transient unit submission failed")
        return {
            "schemaVersion": SCHEMA_VERSION,
            "runId": binding.run_id,
            "host": binding.host,
            "candidateSha": binding.candidate_sha,
            "artifactSha256": artifact_sha256,
            "unitName": binding.unit_name,
            "submission": "accepted",
        }
    finally:
        os.close(submission_descriptor)


def _runtime_observation(
    *,
    runtime: Path = ACTIVE_RUNTIME,
    run: Callable[..., subprocess.CompletedProcess[Any]] = subprocess.run,
) -> dict[str, Any]:
    python = runtime / "bin/python3"
    ansible = runtime / "bin/ansible"
    galaxy = runtime / "bin/ansible-galaxy"
    commands = (
        ("python", [str(python), "--version"]),
        ("ansible", [str(ansible), "--version"]),
        ("collections", [str(galaxy), "collection", "list", "--format", "json"]),
    )
    results: dict[str, subprocess.CompletedProcess[Any]] = {}
    for name, command in commands:
        results[name] = run(
            command,
            check=False,
            capture_output=True,
            text=True,
            env={
                "PATH": f"{runtime / 'bin'}:/usr/bin:/bin",
                "LANG": "C",
                "LC_ALL": "C",
                "ANSIBLE_COLLECTIONS_PATH": str(runtime / "collections"),
            },
        )
        if results[name].returncode != 0:
            raise LocalExecutionError("local runtime command failed")
    python_version = (results["python"].stdout or results["python"].stderr).strip()
    ansible_first = (results["ansible"].stdout or "").splitlines()
    try:
        collections_payload = json.loads(results["collections"].stdout)
    except json.JSONDecodeError as error:
        raise LocalExecutionError("local collection inventory is malformed") from error
    observed_collections: dict[str, str] = {}
    if isinstance(collections_payload, dict):
        for installed in collections_payload.values():
            if not isinstance(installed, dict):
                continue
            for name, metadata in installed.items():
                if name in dict(RUNTIME_COLLECTIONS) and isinstance(metadata, dict):
                    version = metadata.get("version")
                    if isinstance(version, str):
                        observed_collections[name] = version
    return {
        "pythonVersion": python_version.removeprefix("Python "),
        "ansibleCoreVersion": (
            ansible_first[0].split("core ", 1)[1].split("]", 1)[0]
            if ansible_first and "core " in ansible_first[0]
            else ""
        ),
        "collections": observed_collections,
    }


def _configured_status_client_id() -> str:
    path = Path("/etc/raspi-status-agent.conf")
    descriptor = os.open(
        path,
        os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0),
    )
    try:
        metadata = os.fstat(descriptor)
        if (
            not stat.S_ISREG(metadata.st_mode)
            or metadata.st_uid != 0
            or stat.S_IMODE(metadata.st_mode) != 0o644
            or metadata.st_size > 64 * 1024
        ):
            raise LocalExecutionError("status configuration metadata is unsafe")
        raw = os.read(descriptor, 64 * 1024 + 1)
    finally:
        os.close(descriptor)
    if len(raw) > 64 * 1024:
        raise LocalExecutionError("status configuration is too large")
    values: list[str] = []
    for raw_line in raw.decode("utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        key, separator, value = line.partition("=")
        if not separator or key.strip() != "CLIENT_ID":
            continue
        parsed = shlex.split(value, comments=True, posix=True)
        if len(parsed) == 1 and CLIENT_ID_RE.fullmatch(parsed[0]) is not None:
            values.append(parsed[0])
    if len(values) != 1:
        raise LocalExecutionError("status client identity is unavailable")
    return values[0]


def _require_existing_agent_environments(user: str, agents: Sequence[str]) -> None:
    if USER_RE.fullmatch(user) is None:
        raise LocalExecutionError("local environment owner is malformed")
    try:
        expected_uid = pwd.getpwnam(user).pw_uid
    except KeyError as error:
        raise LocalExecutionError("local environment owner is unavailable") from error
    if len(agents) != len(set(agents)) or any(
        agent not in AGENT_ENVIRONMENTS for agent in agents
    ):
        raise LocalExecutionError("local required agent set is malformed")
    for agent in agents:
        metadata = os.lstat(AGENT_ENVIRONMENTS[agent])
        if (
            not stat.S_ISREG(metadata.st_mode)
            or stat.S_ISLNK(metadata.st_mode)
            or metadata.st_uid != expected_uid
            or stat.S_IMODE(metadata.st_mode) != 0o600
            or metadata.st_size > 1024 * 1024
        ):
            raise LocalExecutionError("local agent environment metadata is unsafe")


def _runtime_bootstrap_observation(
    path: Path = BOOTSTRAP_OBSERVATION_PATH,
    lock_path: Path = RUNTIME_LOCK_PATH,
) -> tuple[dict[str, Any], bool]:
    metadata = os.lstat(path)
    if (
        not stat.S_ISREG(metadata.st_mode)
        or stat.S_ISLNK(metadata.st_mode)
        or metadata.st_uid != 0
        or stat.S_IMODE(metadata.st_mode) not in {0o600, 0o644}
        or metadata.st_size > 4096
    ):
        raise LocalExecutionError("runtime bootstrap observation metadata is unsafe")
    value = validate_runtime_bootstrap_observation(
        json.loads(path.read_text(encoding="utf-8"))
    )
    if (
        value["status"] not in {"changed", "current"}
        or value["phase"] != "complete"
        or value["cleanup"] != "complete"
        or value["runtimeVersion"] != RUNTIME_VERSION
    ):
        return value, False
    lock_metadata = os.lstat(lock_path)
    if (
        not stat.S_ISREG(lock_metadata.st_mode)
        or stat.S_ISLNK(lock_metadata.st_mode)
        or lock_metadata.st_uid != 0
        or stat.S_IMODE(lock_metadata.st_mode) not in {0o600, 0o644}
        or lock_metadata.st_size > 1024 * 1024
    ):
        raise LocalExecutionError("runtime lock metadata is unsafe")
    expected_lock = "sha256:" + hashlib.sha256(lock_path.read_bytes()).hexdigest()
    return value, value["lockSha256"] == expected_lock


def preflight(
    expected_user: str,
    expected_client_id: str,
    required_agents: Sequence[str],
    *,
    root: Path = STATE_ROOT,
    runtime: Path = ACTIVE_RUNTIME,
    run: Callable[..., subprocess.CompletedProcess[Any]] = subprocess.run,
) -> dict[str, Any]:
    # This is a public, bounded observation.  It must be well-formed even if
    # a bootstrap is incomplete, so the coordinator records an ineligible
    # Local executor instead of classifying the runner response as malformed.
    configuration_ready = True
    try:
        _require_root()
        _require_status_identity(expected_client_id)
        _require_existing_agent_environments(expected_user, required_agents)
    except (KeyError, OSError, UnicodeError, ValueError, LocalExecutionError):
        configuration_ready = False
    runtime_available = True
    try:
        observation = _runtime_observation(runtime=runtime, run=run)
    except (OSError, LocalExecutionError):
        runtime_available = False
        observation = {
            "pythonVersion": "",
            "ansibleCoreVersion": "",
            "collections": {},
        }
    try:
        free_bytes = shutil.disk_usage(root.parent if not root.exists() else root).free
    except OSError:
        free_bytes = 0
    runtime_matches = (
        observation["pythonVersion"] == RUNTIME_PYTHON
        and observation["ansibleCoreVersion"] == RUNTIME_ANSIBLE_CORE
        and observation["collections"] == dict(RUNTIME_COLLECTIONS)
    )
    bootstrap_ready = False
    try:
        bootstrap_observation, bootstrap_ready = _runtime_bootstrap_observation()
    except (OSError, UnicodeError, ValueError, LocalExecutionError):
        bootstrap_observation = None
    if not configuration_ready:
        failure_code = "configuration-unavailable"
    elif not runtime_available:
        failure_code = "runtime-unavailable"
    elif not runtime_matches:
        failure_code = "runtime-lock-mismatch"
    elif not bootstrap_ready:
        failure_code = "bootstrap-observation-unavailable"
    elif free_bytes < MIN_FREE_BYTES:
        failure_code = "storage-unavailable"
    else:
        failure_code = "ready"
    return {
        "ready": (
            configuration_ready
            and runtime_matches
            and bootstrap_ready
            and free_bytes >= MIN_FREE_BYTES
        ),
        "host": STONEBASE_HOST,
        **observation,
        "freeBytes": free_bytes,
        "runnerVersion": SCHEMA_VERSION,
        "configurationReady": configuration_ready,
        "failureCode": failure_code,
        "bootstrapObservation": bootstrap_observation,
    }


def _extract_verified(artifact: Path, stage: Path) -> None:
    if stage.exists() or stage.is_symlink():
        raise LocalExecutionError("candidate staging directory already exists")
    stage.mkdir(mode=0o700, parents=True)
    total = 0
    try:
        with zipfile.ZipFile(artifact) as archive:
            for info in archive.infolist():
                total += info.file_size
                if total > MAX_STAGING_BYTES:
                    raise LocalExecutionError("candidate staging size exceeds the bound")
                target = stage / info.filename
                target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                descriptor = os.open(
                    target,
                    os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0),
                    0o600,
                )
                try:
                    with os.fdopen(descriptor, "wb", closefd=False) as output:
                        output.write(archive.read(info))
                        output.flush()
                        os.fsync(output.fileno())
                finally:
                    os.close(descriptor)
    except BaseException:
        shutil.rmtree(stage, ignore_errors=True)
        raise


def _verify_staging(stage: Path, manifest: Mapping[str, Any]) -> None:
    """Reject any staging change between sealed extraction and Ansible."""

    member_hashes = manifest.get("memberSha256")
    if not isinstance(member_hashes, dict) or any(
        not isinstance(name, str) or not isinstance(digest, str)
        for name, digest in member_hashes.items()
    ):
        raise LocalExecutionError("candidate staging seal is malformed")
    expected = set(member_hashes) | {"binding-manifest.json"}
    observed: set[str] = set()
    total = 0
    for path in stage.rglob("*"):
        if path.is_symlink():
            raise LocalExecutionError("candidate staging contains a symlink")
        if path.is_dir():
            continue
        if not path.is_file():
            raise LocalExecutionError("candidate staging contains a special file")
        name = path.relative_to(stage).as_posix()
        observed.add(name)
        total += path.stat().st_size
        if total > MAX_STAGING_BYTES:
            raise LocalExecutionError("candidate staging size exceeds the bound")
    if observed != expected:
        raise LocalExecutionError("candidate staging member set changed after extraction")
    for name, digest in member_hashes.items():
        if sha256_file(stage / name) != digest:
            raise LocalExecutionError("candidate staging member digest changed after extraction")
    if (stage / "binding-manifest.json").read_bytes() != json.dumps(
        manifest,
        ensure_ascii=True,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8") + b"\n":
        raise LocalExecutionError("candidate staging manifest changed after extraction")


def execute_candidate(
    artifact: Path,
    artifact_sha256: str,
    *,
    root: Path = STATE_ROOT,
    runtime: Path = ACTIVE_RUNTIME,
    run: Callable[..., subprocess.CompletedProcess[Any]] = subprocess.run,
    now: Callable[[], str] = _utc_now,
) -> dict[str, Any]:
    """Execute the sealed command under one non-blocking global lock."""

    _require_root()
    binding = _binding_from_manifest(artifact)
    _require_status_identity(binding.status_client_id)
    if artifact != _artifact_path(root, binding):
        raise LocalExecutionError("local worker artifact path is not canonical")
    manifest = inspect_candidate_artifact(artifact, artifact_sha256, binding)
    paths = _directories(root, binding.run_id)
    paths["locks"].mkdir(mode=0o700, parents=True, exist_ok=True)
    lock_path = paths["locks"] / "executor.lock"
    descriptor = os.open(
        lock_path,
        os.O_CREAT | os.O_RDWR | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0),
        0o600,
    )
    started_at = now()
    state = "failed"
    return_code = 70
    try:
        os.fchmod(descriptor, 0o600)
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise LocalExecutionError("another local candidate is running") from error
        observation = _runtime_observation(runtime=runtime, run=run)
        if (
            observation["pythonVersion"] != RUNTIME_PYTHON
            or observation["ansibleCoreVersion"] != RUNTIME_ANSIBLE_CORE
            or observation["collections"] != dict(RUNTIME_COLLECTIONS)
        ):
            raise LocalExecutionError("local runtime changed after preflight")
        maintenance = run(
            [
                str(MAINTENANCE_PROBE),
                "--run-id",
                binding.run_id,
                "--expected-client-id",
                binding.status_client_id,
            ],
            check=False,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=60,
            env={"PATH": "/usr/bin:/bin", "LANG": "C", "LC_ALL": "C"},
        )
        if maintenance.returncode != 0:
            raise LocalExecutionError("active terminal maintenance could not be verified")
        stage = paths["staging"]
        _extract_verified(artifact, stage)
        _verify_staging(stage, manifest)
        command = [
            str(runtime / "bin/ansible-playbook"),
            "-c",
            "local",
            "-i",
            str(stage / "inventory.json"),
            str(stage / LOCAL_PLAYBOOK_MEMBER),
        ]
        try:
            completed = run(
                command,
                check=False,
                cwd=stage,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=EXECUTION_TIMEOUT_SECONDS,
                env={
                    "PATH": f"{runtime / 'bin'}:/usr/bin:/bin",
                    "LANG": "C",
                    "LC_ALL": "C",
                    "ANSIBLE_CONFIG": str(stage / "ansible.cfg"),
                    "PYTHONNOUSERSITE": "1",
                    "ANSIBLE_COLLECTIONS_PATH": str(runtime / "collections"),
                },
            )
            return_code = completed.returncode if type(completed.returncode) is int else 70
            state = "success" if return_code == 0 else "failed"
        except subprocess.TimeoutExpired:
            state = "timeout"
            return_code = 124
        result = {
            "schemaVersion": SCHEMA_VERSION,
            "runId": binding.run_id,
            "host": binding.host,
            "candidateSha": binding.candidate_sha,
            "artifactSha256": artifact_sha256,
            "unitName": binding.unit_name,
            "state": state,
            "startedAt": started_at,
            "completedAt": now(),
            "returnCode": return_code,
        }
        validate_local_result(result, binding=binding, artifact_sha256=artifact_sha256)
        _atomic_json(_result_path(root, binding), result)
        return result
    finally:
        os.close(descriptor)


def reconcile(
    binding: CandidateBinding,
    artifact_sha256: str,
    *,
    root: Path = STATE_ROOT,
    run: Callable[..., subprocess.CompletedProcess[Any]] = subprocess.run,
) -> dict[str, Any]:
    binding.validate()
    completed = run(
        [
            "/usr/bin/systemctl",
            "show",
            binding.unit_name,
            "--property=LoadState",
            "--property=ActiveState",
            "--property=SubState",
            "--property=Result",
            "--property=ExecMainStatus",
        ],
        check=False,
        capture_output=True,
        text=True,
        env={"PATH": "/usr/bin:/bin", "LANG": "C", "LC_ALL": "C"},
    )
    properties: dict[str, str] = {}
    for line in (completed.stdout or "").splitlines():
        key, separator, value = line.partition("=")
        if separator:
            properties[key] = value
    active = properties.get("ActiveState")
    load = properties.get("LoadState")
    if (
        load == "not-found"
        and active == "inactive"
        and _submission_is_quiesced(root, binding)
    ):
        return {
            "state": "not-submitted",
            "unitName": binding.unit_name,
            "quiesced": True,
            "result": None,
        }
    if completed.returncode != 0 or active not in {"active", "activating", "inactive", "failed"}:
        return {
            "state": "unknown",
            "unitName": binding.unit_name,
            "quiesced": False,
            "result": None,
        }
    if active in {"active", "activating"}:
        return {
            "state": "running",
            "unitName": binding.unit_name,
            "quiesced": False,
            "result": None,
        }
    result_path = _result_path(root, binding)
    try:
        raw = result_path.read_bytes()
        if len(raw) > MAX_RESULT_BYTES:
            raise LocalExecutionError("local result is too large")
        value = json.loads(raw.decode("utf-8"))
        result = validate_local_result(
            value, binding=binding, artifact_sha256=artifact_sha256
        )
    except (OSError, UnicodeDecodeError, json.JSONDecodeError, LocalExecutionError):
        result = None
    return {
        "state": "stopped",
        "unitName": binding.unit_name,
        "quiesced": True,
        "result": result,
    }


def acknowledge_ready(
    binding: CandidateBinding,
    artifact_sha256: str,
    verification_id: str,
    *,
    root: Path = STATE_ROOT,
    run: Callable[..., subprocess.CompletedProcess[Any]] = subprocess.run,
) -> dict[str, Any]:
    """Reprove the sealed success, then send one credential-local ready ACK."""

    _require_root()
    binding.validate()
    _require_status_identity(binding.status_client_id)
    if VERIFICATION_ID_RE.fullmatch(verification_id) is None:
        raise LocalExecutionError("local ready verification ID is malformed")
    artifact = _artifact_path(root, binding)
    inspect_candidate_artifact(artifact, artifact_sha256, binding)
    result_path = _result_path(root, binding)
    try:
        raw = result_path.read_bytes()
        if len(raw) > MAX_RESULT_BYTES:
            raise LocalExecutionError("local result is too large")
        result = validate_local_result(
            json.loads(raw.decode("utf-8")),
            binding=binding,
            artifact_sha256=artifact_sha256,
        )
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise LocalExecutionError("local successful result is unavailable") from error
    if result["state"] != "success":
        raise LocalExecutionError("local ready acknowledgement requires successful Ansible")
    completed = run(
        [
            str(READY_PROBE),
            "--run-id",
            binding.run_id,
            "--release-sha",
            binding.candidate_sha,
            "--verification-id",
            verification_id,
            "--expected-client-id",
            binding.status_client_id,
            "--repo",
            "/opt/RaspberryPiSystem_002",
        ],
        check=False,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        timeout=60,
        env={"PATH": "/usr/bin:/bin", "LANG": "C", "LC_ALL": "C"},
    )
    if completed.returncode != 0:
        raise LocalExecutionError("local candidate ready acknowledgement failed")
    return {
        "acknowledged": True,
        "runId": binding.run_id,
        "candidateSha": binding.candidate_sha,
        "artifactSha256": artifact_sha256,
        "verificationId": verification_id,
    }


def cleanup(binding: CandidateBinding, *, root: Path = STATE_ROOT) -> dict[str, Any]:
    binding.validate()
    paths = _directories(root, binding.run_id)
    paths["locks"].mkdir(mode=0o700, parents=True, exist_ok=True)
    submission_lock = _submission_lock_path(root, binding)
    if submission_lock.is_symlink():
        raise LocalExecutionError("local cleanup encountered a symlink")
    submission_descriptor = _open_lock(
        submission_lock, contention="candidate receiver is still running"
    )
    execution_descriptor: int | None = None
    try:
        execution_descriptor = _open_lock(
            paths["locks"] / "executor.lock",
            contention="local candidate execution is still running",
        )
        try:
            artifact = _artifact_path(root, binding)
            result = _result_path(root, binding)
            stage = paths["staging"]
            for path in (artifact, result):
                if path.is_symlink():
                    raise LocalExecutionError("local cleanup encountered a symlink")
                if path.exists():
                    path.unlink()
            if stage.is_symlink():
                raise LocalExecutionError("local cleanup encountered a symlink")
            if stage.exists():
                shutil.rmtree(stage)
            submission_lock.unlink()
        finally:
            os.close(execution_descriptor)
            execution_descriptor = None
    finally:
        if execution_descriptor is not None:
            os.close(execution_descriptor)
        os.close(submission_descriptor)
    return {"cleaned": True, "runId": binding.run_id, "unitName": binding.unit_name}


def _binding_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--previous-sha", required=True)
    parser.add_argument("--candidate-sha", required=True)
    parser.add_argument("--host", required=True)
    parser.add_argument("--status-client-id", required=True)
    parser.add_argument("--rollback-manifest-sha256", required=True)
    parser.add_argument("--runtime-manifest-sha256", required=True)
    parser.add_argument("--maintenance-state-sha256", required=True)


def _binding(args: argparse.Namespace) -> CandidateBinding:
    return CandidateBinding(
        run_id=args.run_id,
        previous_sha=args.previous_sha,
        candidate_sha=args.candidate_sha,
        host=args.host,
        status_client_id=args.status_client_id,
        rollback_manifest_sha256=args.rollback_manifest_sha256,
        runtime_manifest_sha256=args.runtime_manifest_sha256,
        maintenance_state_sha256=args.maintenance_state_sha256,
    )


def parser() -> argparse.ArgumentParser:
    value = argparse.ArgumentParser()
    subparsers = value.add_subparsers(dest="action", required=True)
    preflight_parser = subparsers.add_parser("preflight")
    preflight_parser.add_argument("--expected-user", required=True)
    preflight_parser.add_argument("--expected-client-id", required=True)
    preflight_parser.add_argument(
        "--require-agent",
        action="append",
        default=[],
        choices=sorted(AGENT_ENVIRONMENTS),
    )
    receive = subparsers.add_parser("receive")
    _binding_arguments(receive)
    receive.add_argument("--artifact-sha256", required=True)
    receive.add_argument("--artifact-size", required=True, type=int)
    execute = subparsers.add_parser("execute")
    execute.add_argument("--artifact", required=True, type=Path)
    execute.add_argument("--artifact-sha256", required=True)
    reconcile_parser = subparsers.add_parser("reconcile")
    _binding_arguments(reconcile_parser)
    reconcile_parser.add_argument("--artifact-sha256", required=True)
    ready_parser = subparsers.add_parser("ack-ready")
    _binding_arguments(ready_parser)
    ready_parser.add_argument("--artifact-sha256", required=True)
    ready_parser.add_argument("--verification-id", required=True)
    cleanup_parser = subparsers.add_parser("cleanup")
    _binding_arguments(cleanup_parser)
    return value


def main(argv: Sequence[str] | None = None) -> int:
    args = parser().parse_args(argv)
    try:
        if args.action == "preflight":
            result = preflight(
                args.expected_user,
                args.expected_client_id,
                args.require_agent,
            )
        elif args.action == "receive":
            result = receive_and_submit(
                _binding(args),
                artifact_sha256=args.artifact_sha256,
                artifact_size=args.artifact_size,
                stream=sys.stdin.buffer,
            )
        elif args.action == "execute":
            result = execute_candidate(args.artifact, args.artifact_sha256)
        elif args.action == "reconcile":
            result = reconcile(
                _binding(args), args.artifact_sha256
            )
        elif args.action == "ack-ready":
            result = acknowledge_ready(
                _binding(args), args.artifact_sha256, args.verification_id
            )
        elif args.action == "cleanup":
            result = cleanup(_binding(args))
        else:  # pragma: no cover - argparse owns this branch
            raise LocalExecutionError("unsupported runner action")
    except Exception:
        # Never serialize exception details; subprocess and configuration
        # failures can contain endpoint or credential context.
        print(json.dumps({"ok": False, "error": "local-runner-failed"}))
        return 1
    print(json.dumps(result, ensure_ascii=True, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
