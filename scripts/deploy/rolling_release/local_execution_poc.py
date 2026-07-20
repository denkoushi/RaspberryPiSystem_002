"""Non-live StoneBase local-Ansible candidate artifact proof of concept.

This module intentionally has no coordinator, SSH, or fleet-state integration.
It makes the new trust boundary executable in temporary directories before any
hardware approval: only a fixed StoneBase identity, a fixed candidate SHA,
and a digest-verified no-mutation playbook can reach ``ansible-playbook -c
local``.  A future coordinator integration must retain its existing sealed
manifest, maintenance, acknowledgement, and independent evidence flow.
"""
from __future__ import annotations

import fcntl
import hashlib
import json
import os
import re
import stat
import subprocess
import tempfile
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Mapping


SCHEMA_VERSION = 1
MODE = "stonebase-local-ansible-poc"
STONEBASE_HOST = "raspi4-kensaku-stonebase01"
PROFILE_ID = "kiosk"
PLAYBOOK_PATH = "playbooks/stonebase-local-poc.yml"
_RUN_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{2,79}$")
_SHA_RE = re.compile(r"^[0-9a-f]{40}$")
_SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
_CLIENT_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
_VERSION_RE = re.compile(r"^[0-9]+\.[0-9]+\.[0-9]+$")
_COLLECTION_RE = re.compile(r"^[a-z][a-z0-9_]{0,62}\.[a-z][a-z0-9_]{0,62}$")
_MEMBERS = frozenset(
    {
        "ansible.cfg",
        "inventory.yml",
        "manifest.json",
        PLAYBOOK_PATH,
    }
)
_MAX_MEMBER_BYTES = 64 * 1024
_MAX_ARCHIVE_BYTES = 256 * 1024


class LocalExecutionPocError(RuntimeError):
    """The local execution proof could not establish a safe boundary."""


@dataclass(frozen=True)
class CandidateBinding:
    """Identity data Pi5 must bind before transferring one candidate artifact."""

    run_id: str
    candidate_sha: str
    host: str
    status_client_id: str
    ansible_core_version: str
    collection_versions: tuple[tuple[str, str], ...]
    rollback_manifest_sha256: str
    runtime_manifest_sha256: str
    maintenance_state_sha256: str

    def validate(self) -> None:
        if _RUN_ID_RE.fullmatch(self.run_id) is None:
            raise LocalExecutionPocError("local candidate run ID is malformed")
        if _SHA_RE.fullmatch(self.candidate_sha) is None:
            raise LocalExecutionPocError("local candidate SHA is malformed")
        if self.host != STONEBASE_HOST:
            raise LocalExecutionPocError("local execution POC is limited to StoneBase")
        if _CLIENT_ID_RE.fullmatch(self.status_client_id) is None:
            raise LocalExecutionPocError("local candidate status identity is malformed")
        if _VERSION_RE.fullmatch(self.ansible_core_version) is None:
            raise LocalExecutionPocError("local candidate Ansible version is malformed")
        collections = dict(self.collection_versions)
        if not collections or len(collections) != len(self.collection_versions):
            raise LocalExecutionPocError("local candidate collections are malformed")
        for collection, version in collections.items():
            if (
                _COLLECTION_RE.fullmatch(collection) is None
                or _VERSION_RE.fullmatch(version) is None
            ):
                raise LocalExecutionPocError("local candidate collections are malformed")
        for authority in (
            self.rollback_manifest_sha256,
            self.runtime_manifest_sha256,
            self.maintenance_state_sha256,
        ):
            if _SHA256_RE.fullmatch(authority) is None:
                raise LocalExecutionPocError("local candidate sealed authority is malformed")


@dataclass(frozen=True)
class CandidateArtifact:
    """Pi5-owned artifact metadata safe to persist in a future run record."""

    path: Path
    sha256: str
    payload_sha256: str
    binding: CandidateBinding


@dataclass(frozen=True)
class LocalExecutionResult:
    """Bounded result; never contains subprocess stdout, stderr, or secrets."""

    command: tuple[str, ...]
    returncode: int
    artifact_sha256: str
    candidate_sha: str
    host: str


def _canonical_json(value: Mapping[str, Any]) -> bytes:
    return (
        json.dumps(value, ensure_ascii=True, sort_keys=True, separators=(",", ":"))
        + "\n"
    ).encode("utf-8")


def _sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(64 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _payload_digest(members: Mapping[str, bytes]) -> str:
    digest = hashlib.sha256()
    for name in sorted(members):
        value = members[name]
        digest.update(name.encode("ascii"))
        digest.update(b"\0")
        digest.update(str(len(value)).encode("ascii"))
        digest.update(b"\0")
        digest.update(value)
        digest.update(b"\0")
    return digest.hexdigest()


def _manifest(binding: CandidateBinding, payload: Mapping[str, bytes]) -> dict[str, Any]:
    return {
        "ansibleCoreVersion": binding.ansible_core_version,
        "candidateSha": binding.candidate_sha,
        "collections": dict(binding.collection_versions),
        "host": binding.host,
        "memberSha256": {name: _sha256_bytes(value) for name, value in payload.items()},
        "mode": MODE,
        "maintenanceStateSha256": binding.maintenance_state_sha256,
        "payloadSha256": _payload_digest(payload),
        "playbook": PLAYBOOK_PATH,
        "profileId": PROFILE_ID,
        "rollbackManifestSha256": binding.rollback_manifest_sha256,
        "runId": binding.run_id,
        "runtimeManifestSha256": binding.runtime_manifest_sha256,
        "schemaVersion": SCHEMA_VERSION,
        "statusClientId": binding.status_client_id,
    }


def _poc_playbook() -> bytes:
    return b"""---
# Non-mutating local execution boundary rehearsal.  A production artifact must
# replace this with a candidate-owned, manifest-sealed release playbook only
# after coordinator route-contract and live approval work is complete.
- name: Verify sealed StoneBase local execution candidate
  hosts: stonebase_local
  gather_facts: false
  become: false
  tasks:
    - name: Require the sealed candidate binding
      ansible.builtin.assert:
        that:
          - local_execution_mode == 'stonebase-local-ansible-poc'
          - local_execution_candidate_sha is match('^[0-9a-f]{40}$')
          - local_execution_run_id is match('^[A-Za-z0-9][A-Za-z0-9_-]{2,79}$')
          - local_execution_status_client_id | length > 0
        quiet: true
"""


def _artifact_payload(binding: CandidateBinding) -> dict[str, bytes]:
    return {
        "ansible.cfg": b"""[defaults]
inventory = inventory.yml
retry_files_enabled = False
host_key_checking = True
gathering = explicit
interpreter_python = /usr/bin/python3
""",
        "inventory.yml": _canonical_json(
            {
                "all": {
                    "children": {
                        "stonebase_local": {
                            "hosts": {
                                STONEBASE_HOST: {
                                    "ansible_connection": "local",
                                    "local_execution_candidate_sha": binding.candidate_sha,
                                    "local_execution_mode": MODE,
                                    "local_execution_run_id": binding.run_id,
                                    "local_execution_status_client_id": binding.status_client_id,
                                }
                            }
                        }
                    }
                }
            }
        ),
        PLAYBOOK_PATH: _poc_playbook(),
    }


def build_candidate_artifact(destination: Path, binding: CandidateBinding) -> CandidateArtifact:
    """Create a one-file, no-secret, StoneBase-only PoC candidate artifact."""

    binding.validate()
    destination = Path(destination)
    if destination.exists() or destination.is_symlink():
        raise LocalExecutionPocError("local candidate artifact destination is unavailable")
    destination.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    payload = _artifact_payload(binding)
    manifest = _manifest(binding, payload)
    members = {**payload, "manifest.json": _canonical_json(manifest)}
    if set(members) != _MEMBERS:
        raise LocalExecutionPocError("local candidate artifact member set is invalid")
    with tempfile.NamedTemporaryFile(
        prefix=f".{destination.name}.", suffix=".tmp", dir=destination.parent, delete=False
    ) as stream:
        temporary = Path(stream.name)
    try:
        with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for name in sorted(members):
                info = zipfile.ZipInfo(name)
                info.external_attr = (stat.S_IFREG | 0o600) << 16
                archive.writestr(info, members[name])
        temporary.chmod(0o600)
        os.replace(temporary, destination)
    finally:
        if temporary.exists():
            temporary.unlink()
    digest = _sha256_file(destination)
    return CandidateArtifact(
        path=destination,
        sha256=digest,
        payload_sha256=manifest["payloadSha256"],
        binding=binding,
    )


def _read_artifact(artifact_path: Path, expected_sha256: str) -> tuple[dict[str, bytes], dict[str, Any]]:
    if _SHA256_RE.fullmatch(expected_sha256) is None:
        raise LocalExecutionPocError("expected local artifact digest is malformed")
    artifact_path = Path(artifact_path)
    if (
        not artifact_path.is_file()
        or artifact_path.is_symlink()
        or artifact_path.stat().st_size > _MAX_ARCHIVE_BYTES
    ):
        raise LocalExecutionPocError("local candidate artifact is unavailable or unsafe")
    if _sha256_file(artifact_path) != expected_sha256:
        raise LocalExecutionPocError("local candidate artifact digest does not match")
    try:
        with zipfile.ZipFile(artifact_path) as archive:
            infos = archive.infolist()
            names = [info.filename for info in infos]
            if len(names) != len(set(names)) or set(names) != _MEMBERS:
                raise LocalExecutionPocError("local candidate artifact member set is invalid")
            members: dict[str, bytes] = {}
            for info in infos:
                mode = info.external_attr >> 16
                if stat.S_ISLNK(mode) or info.file_size > _MAX_MEMBER_BYTES:
                    raise LocalExecutionPocError("local candidate artifact member is unsafe")
                members[info.filename] = archive.read(info)
    except (OSError, zipfile.BadZipFile) as error:
        raise LocalExecutionPocError("local candidate artifact is unreadable") from error
    try:
        manifest = json.loads(members["manifest.json"].decode("utf-8"))
    except (KeyError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise LocalExecutionPocError("local candidate manifest is malformed") from error
    if not isinstance(manifest, dict):
        raise LocalExecutionPocError("local candidate manifest is malformed")
    return members, manifest


def _validate_manifest(manifest: Mapping[str, Any], binding: CandidateBinding, payload: Mapping[str, bytes]) -> None:
    expected_keys = {
        "ansibleCoreVersion",
        "candidateSha",
        "collections",
        "host",
        "memberSha256",
        "mode",
        "maintenanceStateSha256",
        "payloadSha256",
        "playbook",
        "profileId",
        "rollbackManifestSha256",
        "runId",
        "runtimeManifestSha256",
        "schemaVersion",
        "statusClientId",
    }
    if set(manifest) != expected_keys:
        raise LocalExecutionPocError("local candidate manifest fields are invalid")
    binding.validate()
    expected = _manifest(binding, payload)
    if dict(manifest) != expected:
        raise LocalExecutionPocError("local candidate manifest does not match its binding")


def inspect_candidate_artifact(
    artifact_path: Path, expected_sha256: str, binding: CandidateBinding
) -> None:
    """Verify archive digest, exact members, and every candidate binding."""

    members, manifest = _read_artifact(artifact_path, expected_sha256)
    payload = {name: value for name, value in members.items() if name != "manifest.json"}
    _validate_manifest(manifest, binding, payload)


def stage_candidate_artifact(
    artifact_path: Path,
    expected_sha256: str,
    binding: CandidateBinding,
    destination: Path,
) -> Path:
    """Validate before writing an exact temporary local execution directory."""

    members, manifest = _read_artifact(artifact_path, expected_sha256)
    payload = {name: value for name, value in members.items() if name != "manifest.json"}
    _validate_manifest(manifest, binding, payload)
    destination = Path(destination)
    if destination.exists() or destination.is_symlink():
        raise LocalExecutionPocError("local candidate staging destination is unavailable")
    destination.mkdir(mode=0o700, parents=True)
    try:
        for name, value in members.items():
            target = destination / name
            target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            target.write_bytes(value)
            target.chmod(0o600)
    except BaseException:
        # The caller's release failure path must preserve unknown evidence. The
        # temporary directory has no fleet or manifest authority and can be
        # safely discarded by its owner.
        for path in sorted(destination.rglob("*"), reverse=True):
            if path.is_file() or path.is_symlink():
                path.unlink()
            elif path.is_dir():
                path.rmdir()
        destination.rmdir()
        raise
    return destination


def _read_staged_candidate(staged_directory: Path) -> tuple[dict[str, bytes], dict[str, Any]]:
    files = [path for path in staged_directory.rglob("*") if path.is_file() or path.is_symlink()]
    members: dict[str, bytes] = {}
    for path in files:
        relative = path.relative_to(staged_directory).as_posix()
        if path.is_symlink() or relative not in _MEMBERS:
            raise LocalExecutionPocError("staged local candidate member is unsafe")
        if path.stat().st_size > _MAX_MEMBER_BYTES:
            raise LocalExecutionPocError("staged local candidate member is unsafe")
        members[relative] = path.read_bytes()
    if set(members) != _MEMBERS:
        raise LocalExecutionPocError("staged local candidate member set is invalid")
    try:
        manifest = json.loads(members["manifest.json"].decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise LocalExecutionPocError("staged local candidate manifest is malformed") from error
    if not isinstance(manifest, dict):
        raise LocalExecutionPocError("staged local candidate manifest is malformed")
    return members, manifest


def run_staged_candidate(
    staged_directory: Path,
    *,
    artifact_sha256: str,
    binding: CandidateBinding,
    observed_hostname: str,
    observed_ansible_core_version: str,
    observed_collection_versions: Mapping[str, str],
    lock_directory: Path,
    run: Callable[..., subprocess.CompletedProcess[Any]] = subprocess.run,
) -> LocalExecutionResult:
    """Run the no-mutation PoC through one non-blocking per-run local lock.

    ``run`` is injectable so tests never invoke Ansible. A future trusted
    terminal bootstrapper must collect the observed hostname and runtime
    versions itself; this function refuses to infer either from artifact data.
    """

    binding.validate()
    if _SHA256_RE.fullmatch(artifact_sha256) is None:
        raise LocalExecutionPocError("local candidate artifact digest is malformed")
    if observed_hostname != binding.host:
        raise LocalExecutionPocError("local candidate terminal identity does not match")
    if observed_ansible_core_version != binding.ansible_core_version:
        raise LocalExecutionPocError("local Ansible version does not match the candidate")
    if dict(observed_collection_versions) != dict(binding.collection_versions):
        raise LocalExecutionPocError("local Ansible collections do not match the candidate")
    staged_directory = Path(staged_directory)
    members, manifest = _read_staged_candidate(staged_directory)
    _validate_manifest(
        manifest,
        binding,
        {name: value for name, value in members.items() if name != "manifest.json"},
    )
    lock_directory = Path(lock_directory)
    lock_directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    lock_path = lock_directory / f"{binding.run_id}-{binding.host}.lock"
    descriptor = os.open(
        lock_path,
        os.O_CREAT | os.O_RDWR | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0),
        0o600,
    )
    try:
        os.fchmod(descriptor, 0o600)
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise LocalExecutionPocError("local candidate execution is already running") from error
        command = (
            "ansible-playbook",
            "-c",
            "local",
            "-i",
            str(staged_directory / "inventory.yml"),
            str(staged_directory / PLAYBOOK_PATH),
        )
        environment = {
            "ANSIBLE_CONFIG": str(staged_directory / "ansible.cfg"),
            "LANG": "C",
            "LC_ALL": "C",
            "PATH": "/usr/bin:/bin",
        }
        try:
            completed = run(
                command,
                cwd=staged_directory,
                env=environment,
                capture_output=True,
                check=False,
                text=True,
            )
        except (OSError, subprocess.SubprocessError) as error:
            raise LocalExecutionPocError("local candidate invocation did not return") from error
        returncode = getattr(completed, "returncode", None)
        if type(returncode) is not int:
            raise LocalExecutionPocError("local candidate result is malformed")
        if returncode != 0:
            raise LocalExecutionPocError(
                f"local candidate Ansible failed with status {returncode}"
            )
        return LocalExecutionResult(
            command=command,
            returncode=returncode,
            artifact_sha256=artifact_sha256,
            candidate_sha=binding.candidate_sha,
            host=binding.host,
        )
    finally:
        os.close(descriptor)
