"""Pi5 transport backend for the sealed StoneBase local-Ansible executor."""
from __future__ import annotations

import ipaddress
import json
import re
import shlex
import stat
import subprocess
import time
from pathlib import Path
from typing import Any, Callable, Mapping, Protocol

from ..local_execution import (
    LOCAL_EXECUTOR,
    SCHEMA_VERSION,
    SSH_EXECUTOR,
    STONEBASE_HOST,
    CandidateBinding,
    ExecutorSelection,
    LocalExecutionError,
    build_candidate_artifact,
    select_executor,
    validate_local_result,
)
from ..terminal_preflight_contract import (
    TerminalPreflightContractError,
    build_target_contracts,
    local_direct_ssh_common_args_supported,
)
from ..local_transport_contract import (
    LocalTransportContractError,
    ssh_security_options,
    validate_known_hosts_payload,
)
from . import ansible as ansible_backend

try:
    from terminal_profile_registry import load_registry
except ImportError:
    from scripts.deploy.terminal_profile_registry import load_registry


RUNNER = "/usr/local/libexec/raspi-local-ansible-runner"
ARTIFACT_ROOT = Path("logs/deploy/local-artifacts")
KNOWN_HOSTS_RELATIVE = Path(
    "infrastructure/ansible/files/stonebase-local-ansible/ssh-known-hosts"
)
MAX_CONTROL_OUTPUT_BYTES = 64 * 1024
LOCAL_TIMEOUT_SECONDS = 15 * 60
POLL_SECONDS = 5
_HOST_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,254}$")
_USER_RE = re.compile(r"^[a-z_][a-z0-9_-]{0,31}$")
_SHA256_RE = re.compile(r"^[0-9a-f]{64}$")


class Runtime(Protocol):
    PROJECT: Path
    ANSIBLE_DIRECTORY: Path
    subprocess: Any

    def run(self, command: list[str], **kwargs: Any) -> str: ...


class LocalSubmissionUncertain(RuntimeError):
    """The receiver may have accepted the artifact; reconcile the unit."""


def _normal_inventory_hostvars(
    inventory: str, host: str, *, runtime: Runtime
) -> dict[str, Any]:
    try:
        raw = runtime.run(
            ["ansible-inventory", "-i", inventory, "--host", host],
            cwd=runtime.ANSIBLE_DIRECTORY,
            capture=True,
        )
        value = json.loads(raw)
    except Exception:
        raise LocalExecutionError("StoneBase connection contract is unavailable") from None
    if not isinstance(value, dict):
        raise LocalExecutionError("StoneBase connection contract is malformed")
    return value


def _connection_contract(
    inventory: str, host: str, *, runtime: Runtime
) -> dict[str, Any]:
    if host != STONEBASE_HOST:
        raise LocalExecutionError("local SSH transport is limited to StoneBase")
    values = _normal_inventory_hostvars(inventory, host, runtime=runtime)
    address = values.get("ansible_host", host)
    user = values.get("ansible_user")
    port = values.get("ansible_port", 22)
    key = values.get("ansible_ssh_private_key_file")
    common = values.get("ansible_ssh_common_args")
    if not isinstance(address, str) or not address or len(address) > 255:
        raise LocalExecutionError("StoneBase address is malformed")
    try:
        ipaddress.ip_address(address)
    except ValueError:
        if _HOST_RE.fullmatch(address) is None:
            raise LocalExecutionError("StoneBase address is malformed") from None
    if not isinstance(user, str) or _USER_RE.fullmatch(user) is None:
        raise LocalExecutionError("StoneBase SSH user is malformed")
    if type(port) is not int or not 1 <= port <= 65535:
        raise LocalExecutionError("StoneBase SSH port is malformed")
    if not local_direct_ssh_common_args_supported(common):
        # Arbitrary ssh_common_args cannot be replayed safely through a new
        # direct transport. Keep using the established Ansible executor. The
        # one legacy inventory value accepted by the shared policy is
        # deliberately not replayed: this backend always supplies
        # StrictHostKeyChecking=yes itself.
        raise LocalExecutionError("StoneBase requires unsupported SSH common arguments")
    if key not in {None, ""}:
        # Aggregate preflight deliberately crosses no private-key path. Local
        # therefore uses only the release identity's default SSH key at both
        # proof boundaries.
        raise LocalExecutionError("StoneBase requires an unsupported SSH key path")
    known_hosts = runtime.PROJECT / KNOWN_HOSTS_RELATIVE
    try:
        metadata = known_hosts.lstat()
        if not stat.S_ISREG(metadata.st_mode):
            raise OSError("known-hosts pin is not regular")
        payload = known_hosts.read_bytes()
        validate_known_hosts_payload(payload)
        security_options = ssh_security_options(str(known_hosts))
    except (OSError, LocalTransportContractError):
        raise LocalExecutionError("StoneBase pinned host key is unavailable") from None
    return {
        "address": address,
        "user": user,
        "port": port,
        "knownHostsPath": str(known_hosts),
        "securityOptions": security_options,
    }


def _ssh_command(connection: Mapping[str, Any], remote: list[str]) -> list[str]:
    command = [
        "ssh",
        *connection["securityOptions"],
        "-o",
        "ConnectTimeout=15",
        "-o",
        "ServerAliveInterval=10",
        "-o",
        "ServerAliveCountMax=3",
        "-p",
        str(connection["port"]),
    ]
    command.extend(
        [f"{connection['user']}@{connection['address']}", shlex.join(remote)]
    )
    return command


def _bounded_json(output: Any) -> dict[str, Any]:
    if not isinstance(output, (str, bytes)):
        raise LocalExecutionError("local runner returned no bounded result")
    raw = output.encode("utf-8") if isinstance(output, str) else output
    if len(raw) > MAX_CONTROL_OUTPUT_BYTES:
        raise LocalExecutionError("local runner result is too large")
    candidates: list[dict[str, Any]] = []
    for line in raw.decode("utf-8").splitlines():
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            value = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict):
            candidates.append(value)
    if len(candidates) != 1:
        raise LocalExecutionError("local runner result is malformed")
    return candidates[0]


def _direct_runner(
    inventory: str,
    host: str,
    arguments: list[str],
    *,
    runtime: Runtime,
    input_bytes: bytes | None = None,
) -> dict[str, Any]:
    connection = _connection_contract(inventory, host, runtime=runtime)
    command = _ssh_command(
        connection, ["/usr/bin/sudo", "-n", RUNNER, *arguments]
    )
    try:
        completed = runtime.subprocess.run(
            command,
            check=False,
            input=input_bytes,
            capture_output=True,
            timeout=60 if input_bytes is None else 180,
            env={"PATH": "/usr/bin:/bin:/usr/local/bin", "LANG": "C", "LC_ALL": "C"},
        )
    except (OSError, subprocess.SubprocessError) as error:
        raise LocalSubmissionUncertain("local runner response is unavailable") from error
    if completed.returncode != 0:
        raise LocalExecutionError("local runner rejected the request")
    return _bounded_json(completed.stdout)


def _public_contract(
    inventory: str, target_spec: dict[str, str], *, runtime: Runtime
) -> dict[str, Any]:
    inventory_data = ansible_backend.inventory_json(inventory, runtime=runtime)
    contract = build_target_contracts(inventory_data, [target_spec])[0]
    return {
        "host": contract["host"],
        "profile": contract["profile"],
        "user": contract["user"],
        "repoPath": contract["repoPath"],
        "nfcEnabled": contract["nfcEnabled"],
        "barcodeEnabled": contract["barcodeEnabled"],
        "torqueEnabled": contract["torqueEnabled"],
        "servicesToRestart": contract["servicesToRestart"],
    }


def select_terminal_executor(
    inventory: str,
    target_spec: dict[str, str],
    previous_sha: str,
    candidate_sha: str,
    *,
    runtime: Runtime,
) -> dict[str, Any]:
    host = target_spec.get("host")
    if host != STONEBASE_HOST or target_spec.get("terminalType") != "kiosk":
        raise LocalExecutionError("local executor selection escaped StoneBase")
    public: dict[str, Any] | None
    runner_preflight: dict[str, Any] | None
    eligibility_failure: str | None = None
    try:
        public = _public_contract(inventory, target_spec, runtime=runtime)
    except (
        LocalExecutionError,
        LocalSubmissionUncertain,
        TerminalPreflightContractError,
    ):
        public = None
        runner_preflight = None
        eligibility_failure = "runner-ineligible: local public inventory contract is unavailable"
    else:
        required_agents = [
            agent
            for enabled, agent in (
                (public["nfcEnabled"], "nfc-agent"),
                (public["barcodeEnabled"], "barcode-agent"),
                (public["torqueEnabled"], "torque-agent"),
            )
            if enabled
        ]
        try:
            runner_preflight = _direct_runner(
                inventory,
                host,
                [
                    "preflight",
                    "--expected-user",
                    str(public["user"]),
                    "--expected-client-id",
                    str(target_spec["clientId"]),
                    *[
                        value
                        for agent in required_agents
                        for value in ("--require-agent", agent)
                    ],
                ],
                runtime=runtime,
            )
        except (LocalExecutionError, LocalSubmissionUncertain):
            runner_preflight = None
            eligibility_failure = "runner-ineligible: local direct runner preflight is unavailable"
    selection = select_executor(
        requested_executor=LOCAL_EXECUTOR,
        project=runtime.PROJECT,
        previous_sha=previous_sha,
        candidate_sha=candidate_sha,
        host=host,
        public_contract=public,
        runner_preflight=runner_preflight,
        component_for=load_registry().component_for,
    )
    if (
        eligibility_failure is not None
        and isinstance(selection.fallback_reason, str)
        and selection.fallback_reason.startswith("runner-ineligible:")
    ):
        selection = ExecutorSelection(
            requested_executor=selection.requested_executor,
            effective_executor=selection.effective_executor,
            fallback_reason=eligibility_failure,
            changed_paths=selection.changed_paths,
        )
    return {
        "requestedExecutor": selection.requested_executor,
        "effectiveExecutor": selection.effective_executor,
        "fallbackReason": selection.fallback_reason,
        "changedPaths": list(selection.changed_paths),
        "publicContract": (
            dict(selection.public_contract)
            if selection.public_contract is not None
            else None
        ),
        "runnerPreflight": (
            dict(selection.runner_preflight)
            if selection.runner_preflight is not None
            else None
        ),
    }


def _binding_from_target(
    target_spec: dict[str, str],
    target: dict[str, Any],
    run_id: str,
    maintenance_state_sha256: str,
) -> CandidateBinding:
    manifest = target.get("rollbackManifest")
    runtime_manifest = manifest.get("runtime") if isinstance(manifest, dict) else None
    rollback_sha = manifest.get("manifestSha256") if isinstance(manifest, dict) else None
    runtime_sha = (
        runtime_manifest.get("manifestSha256")
        if isinstance(runtime_manifest, dict)
        else None
    )
    binding = CandidateBinding(
        run_id=run_id,
        previous_sha=target.get("previousSha"),
        candidate_sha=target.get("desiredSha"),
        host=target_spec.get("host"),
        status_client_id=target_spec.get("clientId"),
        rollback_manifest_sha256=rollback_sha,
        runtime_manifest_sha256=runtime_sha,
        maintenance_state_sha256=maintenance_state_sha256,
    )
    binding.validate()
    return binding


def prepare_local_terminal_candidate(
    inventory: str,
    target_spec: dict[str, str],
    target: dict[str, Any],
    run_id: str,
    maintenance_state_sha256: str,
    *,
    runtime: Runtime,
) -> dict[str, Any]:
    del inventory
    if target.get("effectiveExecutor") != LOCAL_EXECUTOR:
        raise LocalExecutionError("local artifact requested for the SSH executor")
    binding = _binding_from_target(
        target_spec, target, run_id, maintenance_state_sha256
    )
    public = target.get("publicContract")
    destination = runtime.PROJECT / ARTIFACT_ROOT / run_id / f"{binding.host}.zip"
    artifact = build_candidate_artifact(
        runtime.PROJECT, destination, binding, public
    )
    return {
        "schemaVersion": SCHEMA_VERSION,
        "runId": run_id,
        "artifactPath": str(artifact.path),
        "artifactSha256": artifact.sha256,
        "payloadSha256": artifact.payload_sha256,
        "artifactSize": artifact.size,
        "previousSha": binding.previous_sha,
        "candidateSha": binding.candidate_sha,
        "rollbackManifestSha256": binding.rollback_manifest_sha256,
        "runtimeManifestSha256": binding.runtime_manifest_sha256,
        "maintenanceStateSha256": binding.maintenance_state_sha256,
        "unitName": binding.unit_name,
    }


def _binding_from_record(
    target_spec: dict[str, str], target: dict[str, Any]
) -> tuple[CandidateBinding, dict[str, Any]]:
    artifact = target.get("localArtifact")
    if not isinstance(artifact, dict):
        raise LocalExecutionError("local artifact record is missing")
    binding = CandidateBinding(
        run_id=(
            artifact.get("runId")
            or target.get("rollbackAuthorityRunId")
            or target.get("runId")
            or ""
        ),
        previous_sha=artifact.get("previousSha"),
        candidate_sha=artifact.get("candidateSha"),
        host=target_spec.get("host"),
        status_client_id=target_spec.get("clientId"),
        rollback_manifest_sha256=artifact.get("rollbackManifestSha256"),
        runtime_manifest_sha256=artifact.get("runtimeManifestSha256"),
        maintenance_state_sha256=artifact.get("maintenanceStateSha256"),
    )
    binding.validate()
    if artifact.get("unitName") != binding.unit_name:
        raise LocalExecutionError("local artifact unit name is malformed")
    return binding, artifact


def _binding_arguments(binding: CandidateBinding) -> list[str]:
    return [
        "--run-id",
        binding.run_id,
        "--previous-sha",
        binding.previous_sha,
        "--candidate-sha",
        binding.candidate_sha,
        "--host",
        binding.host,
        "--status-client-id",
        binding.status_client_id,
        "--rollback-manifest-sha256",
        binding.rollback_manifest_sha256,
        "--runtime-manifest-sha256",
        binding.runtime_manifest_sha256,
        "--maintenance-state-sha256",
        binding.maintenance_state_sha256,
    ]


def _validate_prepared_path(
    prepared: Mapping[str, Any], *, runtime: Runtime, run_id: str
) -> Path:
    raw = prepared.get("artifactPath")
    if not isinstance(raw, str):
        raise LocalExecutionError("local artifact path is missing")
    path = Path(raw)
    expected_parent = (runtime.PROJECT / ARTIFACT_ROOT / run_id).resolve()
    try:
        resolved = path.resolve(strict=True)
        resolved.relative_to(expected_parent)
    except (FileNotFoundError, ValueError, OSError) as error:
        raise LocalExecutionError("local artifact path escaped its run directory") from error
    if not resolved.is_file() or resolved.is_symlink():
        raise LocalExecutionError("local artifact path is unsafe")
    return resolved


def submit_local_terminal_candidate(
    inventory: str,
    target_spec: dict[str, str],
    target: dict[str, Any],
    run_id: str,
    prepared: dict[str, Any],
    *,
    runtime: Runtime,
) -> dict[str, Any]:
    binding = _binding_from_target(
        target_spec, target, run_id, prepared.get("maintenanceStateSha256")
    )
    path = _validate_prepared_path(prepared, runtime=runtime, run_id=run_id)
    digest = prepared.get("artifactSha256")
    size = prepared.get("artifactSize")
    if _SHA256_RE.fullmatch(str(digest or "")) is None or type(size) is not int:
        raise LocalExecutionError("local prepared artifact metadata is malformed")
    receiver = _direct_runner(
        inventory,
        binding.host,
        [
            "receive",
            *_binding_arguments(binding),
            "--artifact-sha256",
            digest,
            "--artifact-size",
            str(size),
        ],
        runtime=runtime,
        input_bytes=path.read_bytes(),
    )
    if (
        receiver.get("submission") != "accepted"
        or receiver.get("runId") != run_id
        or receiver.get("artifactSha256") != digest
        or receiver.get("unitName") != binding.unit_name
    ):
        raise LocalSubmissionUncertain("local receiver acceptance is malformed")
    return receiver


def await_local_terminal_candidate(
    inventory: str,
    target_spec: dict[str, str],
    target: dict[str, Any],
    *,
    runtime: Runtime,
    clock: Callable[[], float] = time.monotonic,
    sleep: Callable[[float], None] = time.sleep,
) -> dict[str, Any]:
    binding, artifact = _binding_from_record(target_spec, target)
    digest = artifact.get("artifactSha256")
    if _SHA256_RE.fullmatch(str(digest or "")) is None:
        raise LocalExecutionError("local artifact digest is malformed")
    deadline = clock() + LOCAL_TIMEOUT_SECONDS
    while clock() < deadline:
        reconciled = reconcile_local_terminal_candidate(
            inventory, target_spec, target, runtime=runtime
        )
        if reconciled.get("quiesced") is True:
            result = reconciled.get("result")
            if not isinstance(result, dict):
                raise LocalExecutionError("local unit stopped without a valid result")
            validated = validate_local_result(
                result, binding=binding, artifact_sha256=digest
            )
            if validated["state"] != "success":
                raise LocalExecutionError("local Ansible execution failed")
            return validated
        sleep(POLL_SECONDS)
    raise LocalSubmissionUncertain("local unit did not become quiescent before timeout")


def reconcile_local_terminal_candidate(
    inventory: str,
    target_spec: dict[str, str],
    target: dict[str, Any],
    *,
    runtime: Runtime,
) -> dict[str, Any]:
    binding, artifact = _binding_from_record(target_spec, target)
    digest = artifact.get("artifactSha256")
    if _SHA256_RE.fullmatch(str(digest or "")) is None:
        raise LocalExecutionError("local artifact digest is malformed")
    try:
        value = _direct_runner(
            inventory,
            binding.host,
            [
                "reconcile",
                *_binding_arguments(binding),
                "--artifact-sha256",
                digest,
            ],
            runtime=runtime,
        )
    except (LocalExecutionError, LocalSubmissionUncertain):
        return {
            "state": "unknown",
            "unitName": binding.unit_name,
            "quiesced": False,
            "result": None,
        }
    if set(value) != {"state", "unitName", "quiesced", "result"}:
        raise LocalExecutionError("local reconciliation is malformed")
    if value.get("unitName") != binding.unit_name or type(value.get("quiesced")) is not bool:
        raise LocalExecutionError("local reconciliation identity is malformed")
    return value


def prove_local_terminal_ready(
    inventory: str,
    target_spec: dict[str, str],
    run_id: str,
    release_sha: str,
    verification_id: str,
    target: dict[str, Any],
    *,
    runtime: Runtime,
) -> None:
    host = target_spec.get("host")
    if host != STONEBASE_HOST:
        raise LocalExecutionError("local ready proof escaped StoneBase")
    binding, artifact = _binding_from_record(target_spec, target)
    if binding.run_id != run_id or binding.candidate_sha != release_sha:
        raise LocalExecutionError("local ready proof does not match the candidate")
    digest = artifact.get("artifactSha256")
    value = _direct_runner(
        inventory,
        host,
        [
            "ack-ready",
            *_binding_arguments(binding),
            "--artifact-sha256",
            str(digest),
            "--verification-id",
            verification_id,
        ],
        runtime=runtime,
    )
    if value != {
        "acknowledged": True,
        "runId": run_id,
        "candidateSha": release_sha,
        "artifactSha256": digest,
        "verificationId": verification_id,
    }:
        raise LocalExecutionError("local candidate ready proof is unavailable")


def cleanup_local_terminal_candidate(
    inventory: str,
    target_spec: dict[str, str],
    target: dict[str, Any],
    *,
    runtime: Runtime,
) -> dict[str, Any]:
    binding, artifact = _binding_from_record(target_spec, target)
    value = _direct_runner(
        inventory,
        binding.host,
        ["cleanup", *_binding_arguments(binding)],
        runtime=runtime,
    )
    if value != {
        "cleaned": True,
        "runId": binding.run_id,
        "unitName": binding.unit_name,
    }:
        raise LocalExecutionError("local residue cleanup is malformed")
    # Keep the sealed Pi5 artifact as bounded run evidence. Only terminal-side
    # execution residue is removed here; run retention owns controller files.
    return value
