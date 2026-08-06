#!/usr/bin/env python3
"""Acquire, verify, transfer, atomically stage, and optionally clean one Pi3 Signage artifact."""

from __future__ import annotations

import base64
import binascii
import gzip
import hashlib
import ipaddress
import io
import json
import os
import pwd
import re
import shlex
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
import types
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path, PurePosixPath
from typing import Any, Mapping, Protocol, Sequence


SCHEMA_VERSION = 1
OPERATION = "pi3-signage-acquire-and-stage"
ARTIFACT_REPOSITORY = "ghcr.io/denkoushi/raspisys-pi3-signage"
PREDICATE_TYPE = (
    "https://github.com/denkoushi/RaspberryPiSystem_002/"
    "attestations/pi3-signage-release/v1"
)
SOURCE_REPOSITORY = "denkoushi/RaspberryPiSystem_002"
SIGNER_WORKFLOW = "denkoushi/RaspberryPiSystem_002/.github/workflows/ci.yml"
DEFAULT_STAGING_ROOT = Path("/var/tmp/raspisystem-signage-stage")
DEFAULT_CONFIG_PATH = Path("/etc/raspi-release/artifact-promotion.json")
ARTIFACT_NAME = "signage-release.tar"
DESCRIPTOR_NAME = "signage-release-descriptor.json"
RUN_ID_RE = re.compile(r"^[0-9]{8}-[0-9]{6}-[0-9a-f]{6}$")
FULL_SHA_RE = re.compile(r"^[0-9a-f]{40}$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
HOST_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,254}$")
USER_RE = re.compile(r"^[a-z_][a-z0-9_-]{0,31}$")
ARTIFACT_REF_RE = re.compile(
    r"^ghcr\.io/denkoushi/raspisys-pi3-signage:([0-9a-f]{40})$"
)
MAX_OCI_DOCUMENT_BYTES = 2 * 1024 * 1024
MAX_OCI_LAYER_BYTES = 16 * 1024 * 1024
MAX_ATTESTATION_BYTES = 4 * 1024 * 1024
TARGET_MARKER_RE = re.compile(
    r"SIGNAGE_ARTIFACT_STAGE_RESULT:([A-Za-z0-9_-]+={0,2})"
    r"(?![A-Za-z0-9_=-])"
)


class StageError(RuntimeError):
    """One bounded Stage 2 phase failed with a stable public classification."""

    def __init__(
        self,
        code: str,
        stage: str,
        status: str,
        message: str,
        *,
        primary: Mapping[str, str] | None = None,
    ):
        super().__init__(message)
        self.code = code
        self.stage = stage
        self.status = status
        self.primary = dict(primary) if primary is not None else None


class Acquisition(Protocol):
    def acquire(self, artifact_ref: str, directory: Path) -> Mapping[str, Any]: ...


class DigestPinnedAcquisition:
    """Reject mutable-tag drift before the first target-side operation."""

    def __init__(self, acquisition: Acquisition, expected_digest: str) -> None:
        if (
            not isinstance(expected_digest, str)
            or not expected_digest.startswith("sha256:")
            or SHA256_RE.fullmatch(expected_digest.removeprefix("sha256:")) is None
        ):
            raise StageError(
                "request-validation",
                "request",
                "blocked",
                "expected OCI digest is malformed",
            )
        self.acquisition = acquisition
        self.expected_digest = expected_digest

    def acquire(self, artifact_ref: str, directory: Path) -> Mapping[str, Any]:
        result = self.acquisition.acquire(artifact_ref, directory)
        if not isinstance(result, Mapping) or result.get("ociDigest") != self.expected_digest:
            raise StageError(
                "oci-digest-mismatch",
                "acquisition",
                "blocked",
                "resolved OCI digest does not match the exact preflight input",
            )
        return result


class Attestor(Protocol):
    def verify(
        self, artifact_ref: str, exact_reference: str, source_sha: str
    ) -> Mapping[str, Any]: ...


class TargetTransport(Protocol):
    allowed_staging_root: Path

    def prepare(self, request: Mapping[str, Any]) -> Mapping[str, Any]: ...
    def copy(self, source: Path, name: str, request: Mapping[str, Any]) -> None: ...
    def verify_temporary(self, request: Mapping[str, Any]) -> Mapping[str, Any]: ...
    def promote(self, request: Mapping[str, Any]) -> Mapping[str, Any]: ...
    def verify_ready(self, request: Mapping[str, Any]) -> Mapping[str, Any]: ...
    def cleanup(self, request: Mapping[str, Any]) -> Mapping[str, Any]: ...


def _canonical_json(value: Any, *, newline: bool = False) -> bytes:
    payload = json.dumps(
        value, ensure_ascii=True, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    return payload + (b"\n" if newline else b"")


def _sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _strict_json_bytes(
    raw: bytes,
    *,
    label: str,
    max_bytes: int,
    code: str = "artifact-verification",
    stage_name: str = "controller-verification",
    status: str = "blocked",
) -> Any:
    if not 1 <= len(raw) <= max_bytes:
        raise StageError(
            code, stage_name, status,
            f"{label} size is outside its bound",
        )
    try:
        return json.loads(
            raw.decode("utf-8"),
            object_pairs_hook=_reject_duplicate_keys,
            parse_constant=lambda value: (_ for _ in ()).throw(
                ValueError(f"invalid JSON constant: {value}")
            ),
        )
    except (UnicodeError, ValueError, json.JSONDecodeError) as error:
        raise StageError(
            code, stage_name, status,
            f"{label} is malformed",
        ) from error


def _reject_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"duplicate JSON key: {key}")
        result[key] = value
    return result


def _artifact_source_sha(artifact_ref: str) -> str:
    if not isinstance(artifact_ref, str):
        raise StageError(
            "request-validation", "request", "blocked", "artifact reference is malformed"
        )
    match = ARTIFACT_REF_RE.fullmatch(artifact_ref)
    if match is None:
        raise StageError(
            "request-validation", "request", "blocked",
            "artifact reference is not the exact Signage source tag",
        )
    return match.group(1)


def _validated_target(value: Mapping[str, Any]) -> dict[str, Any]:
    expected = {"host", "profile", "address", "user", "port"}
    if not isinstance(value, Mapping) or set(value) != expected:
        raise StageError(
            "request-validation", "request", "blocked", "target fields are malformed"
        )
    host = value.get("host")
    address = value.get("address")
    user = value.get("user")
    port = value.get("port")
    address_valid = False
    if isinstance(address, str):
        try:
            address_valid = ipaddress.ip_address(address).version == 4
        except ValueError:
            address_valid = HOST_RE.fullmatch(address) is not None and not bool(
                re.fullmatch(r"[0-9.]+", address)
            )
    if (
        not isinstance(host, str)
        or HOST_RE.fullmatch(host) is None
        or value.get("profile") != "signage"
        or not address_valid
        or not isinstance(user, str)
        or USER_RE.fullmatch(user) is None
        or isinstance(port, bool)
        or not isinstance(port, int)
        or not 1 <= port <= 65535
    ):
        raise StageError(
            "request-validation", "request", "blocked", "target values are malformed"
        )
    return {key: value[key] for key in sorted(expected)}


def _validated_root(value: Path | str, *, allowed: Path | str) -> Path:
    root = Path(value)
    policy = Path(allowed)
    if (
        not root.is_absolute()
        or root != policy
        or ".." in root.parts
        or "\x00" in os.fspath(root)
    ):
        raise StageError(
            "request-validation", "request", "blocked", "staging root is outside the allowlist"
        )
    return root


def _validated_run_id(value: str) -> str:
    if not isinstance(value, str) or RUN_ID_RE.fullmatch(value) is None:
        raise StageError(
            "request-validation", "request", "blocked", "run ID is malformed"
        )
    return value


def _stage_paths(root: Path, run_id: str) -> dict[str, Path]:
    run_path = root / run_id
    return {
        "root": root,
        "run": run_path,
        "incoming": run_path / "incoming",
        "ready": run_path / "ready",
        "incomingArtifact": run_path / "incoming" / ARTIFACT_NAME,
        "incomingDescriptor": run_path / "incoming" / DESCRIPTOR_NAME,
        "readyArtifact": run_path / "ready" / ARTIFACT_NAME,
        "readyDescriptor": run_path / "ready" / DESCRIPTOR_NAME,
    }


def _load_verifier(source: str):
    if (
        not isinstance(source, str)
        or not source.strip()
        or "\x00" in source
        or len(source.encode("utf-8")) > 1024 * 1024
    ):
        raise StageError(
            "artifact-verification", "controller-verification", "blocked",
            "embedded Stage 1 verifier source is malformed",
        )
    name = f"_embedded_signage_distribution_{hashlib.sha256(source.encode()).hexdigest()[:16]}"
    module = types.ModuleType(name)
    module.__file__ = "<embedded-signage-distribution-artifact>"
    sys.modules[name] = module
    try:
        exec(compile(source, module.__file__, "exec"), module.__dict__)
    except Exception as error:
        raise StageError(
            "artifact-verification", "controller-verification", "blocked",
            "embedded Stage 1 verifier could not load",
        ) from error
    finally:
        sys.modules.pop(name, None)
    if not callable(getattr(module, "verify_artifact", None)):
        raise StageError(
            "artifact-verification", "controller-verification", "blocked",
            "embedded Stage 1 verifier contract is unavailable",
        )
    return module


def _descriptor(verifier: Any, path: Path) -> dict[str, Any]:
    try:
        value = verifier._read_descriptor(path)
    except Exception as error:
        raise StageError(
            "artifact-verification", "controller-verification", "blocked",
            "Stage 1 artifact descriptor verification failed",
        ) from error
    return dict(value)


def _exact_reference(artifact_ref: str, digest: str) -> str:
    if not isinstance(digest, str) or not digest.startswith("sha256:") or SHA256_RE.fullmatch(digest[7:]) is None:
        raise StageError(
            "oci-resolution", "acquisition", "incomplete", "exact OCI digest is malformed"
        )
    repository = artifact_ref.rsplit(":", 1)[0]
    if repository != ARTIFACT_REPOSITORY:
        raise StageError(
            "oci-resolution", "acquisition", "blocked", "OCI repository is not allowlisted"
        )
    return f"{repository}@{digest}"


def verify_attestation_statement(
    statement: Mapping[str, Any],
    *,
    exact_reference: str,
    descriptor: Mapping[str, Any],
) -> None:
    expected_subject = {
        "name": ARTIFACT_REPOSITORY,
        "digest": {"sha256": exact_reference.rsplit("@sha256:", 1)[1]},
    }
    expected_predicate = {
        "schemaVersion": SCHEMA_VERSION,
        "artifactKind": "pi3-signage-release",
        "sourceSha": descriptor.get("sourceSha"),
        "artifactSha256": descriptor.get("artifactSha256"),
        "manifestSha256": descriptor.get("manifestSha256"),
    }
    if (
        not isinstance(statement, Mapping)
        or set(statement) != {"subject", "predicateType", "predicate"}
        or statement.get("subject") != [expected_subject]
        or statement.get("predicateType") != PREDICATE_TYPE
        or statement.get("predicate") != expected_predicate
    ):
        raise StageError(
            "attestation-verification", "attestation", "blocked",
            "Signage attestation does not bind the exact OCI and artifact identities",
        )


def _verify_artifact(
    artifact: Path,
    descriptor_path: Path,
    source_sha: str,
    verifier_source: str,
) -> tuple[dict[str, Any], dict[str, Any]]:
    verifier = _load_verifier(verifier_source)
    descriptor = _descriptor(verifier, descriptor_path)
    try:
        result = verifier.verify_artifact(
            artifact, descriptor_path, expected_source_sha=source_sha
        )
    except Exception as error:
        raise StageError(
            "artifact-verification", "controller-verification", "blocked",
            "Stage 1 artifact verification failed",
        ) from error
    return descriptor, dict(result["manifest"])


def target_request(
    target: Mapping[str, Any],
    run_id: str,
    staging_root: Path | str,
    descriptor: Mapping[str, Any],
    oci_digest: str,
) -> dict[str, Any]:
    validated_target = _validated_target(target)
    validated_run = _validated_run_id(run_id)
    root = Path(staging_root)
    if not root.is_absolute() or ".." in root.parts:
        raise StageError(
            "request-validation", "request", "blocked", "staging root is malformed"
        )
    required_descriptor = {
        "artifactSha256", "artifactSize", "manifestSha256", "payloadDigest", "sourceSha"
    }
    if not required_descriptor <= set(descriptor):
        raise StageError(
            "request-validation", "request", "blocked", "artifact identity is incomplete"
        )
    identity = {key: descriptor[key] for key in sorted(required_descriptor)}
    if (
        SHA256_RE.fullmatch(str(identity["artifactSha256"])) is None
        or SHA256_RE.fullmatch(str(identity["manifestSha256"])) is None
        or SHA256_RE.fullmatch(str(identity["payloadDigest"])) is None
        or FULL_SHA_RE.fullmatch(str(identity["sourceSha"])) is None
        or isinstance(identity["artifactSize"], bool)
        or not isinstance(identity["artifactSize"], int)
        or not 1 <= identity["artifactSize"] <= 8 * 1024 * 1024
        or not isinstance(oci_digest, str)
        or not oci_digest.startswith("sha256:")
        or SHA256_RE.fullmatch(oci_digest[7:]) is None
    ):
        raise StageError(
            "request-validation", "request", "blocked", "artifact identity is malformed"
        )
    return {
        "schemaVersion": SCHEMA_VERSION,
        "runId": validated_run,
        "target": validated_target,
        "stagingRoot": os.fspath(root),
        "artifact": {**identity, "ociDigest": oci_digest},
    }


def _validate_target_request(
    request: Mapping[str, Any], *, allowed_staging_root: Path | str
) -> tuple[dict[str, Any], Path, dict[str, Path]]:
    if not isinstance(request, Mapping) or set(request) != {
        "schemaVersion", "runId", "target", "stagingRoot", "artifact"
    } or request.get("schemaVersion") != SCHEMA_VERSION:
        raise StageError(
            "request-validation", "request", "blocked", "target request is malformed"
        )
    target = _validated_target(request["target"])
    run_id = _validated_run_id(request["runId"])
    root = _validated_root(request["stagingRoot"], allowed=allowed_staging_root)
    artifact = request.get("artifact")
    if not isinstance(artifact, Mapping) or set(artifact) != {
        "artifactSha256", "artifactSize", "manifestSha256", "ociDigest", "payloadDigest", "sourceSha"
    }:
        raise StageError(
            "request-validation", "request", "blocked", "target artifact identity is malformed"
        )
    target_request(target, run_id, root, artifact, artifact["ociDigest"])
    return target, root, _stage_paths(root, run_id)


def _lstat(path: Path) -> os.stat_result | None:
    try:
        return path.lstat()
    except FileNotFoundError:
        return None


def _require_directory(path: Path, *, code: str, mode: int = 0o700) -> None:
    metadata = _lstat(path)
    if (
        metadata is None
        or not stat.S_ISDIR(metadata.st_mode)
        or stat.S_ISLNK(metadata.st_mode)
        or stat.S_IMODE(metadata.st_mode) != mode
    ):
        raise StageError(code, "target-staging", "blocked", "staging directory is unsafe")


def _require_regular(path: Path, *, mode: int = 0o600) -> None:
    metadata = _lstat(path)
    if (
        metadata is None
        or not stat.S_ISREG(metadata.st_mode)
        or stat.S_ISLNK(metadata.st_mode)
        or stat.S_IMODE(metadata.st_mode) != mode
    ):
        raise StageError(
            "target-verification", "target-verification", "blocked",
            "transferred artifact file is unsafe",
        )


def target_prepare(
    request: Mapping[str, Any], *, allowed_staging_root: Path | str, set_owner: bool = False
) -> dict[str, Any]:
    target, root, paths = _validate_target_request(
        request, allowed_staging_root=allowed_staging_root
    )
    root_state = _lstat(root)
    owner = None
    if set_owner:
        try:
            owner = pwd.getpwnam(target["user"])
        except KeyError as error:
            raise StageError(
                "staging-path", "target-prepare", "blocked",
                "target staging owner is unavailable",
            ) from error
    if root_state is None:
        root.mkdir(mode=0o711, parents=False)
    elif (
        not stat.S_ISDIR(root_state.st_mode)
        or stat.S_ISLNK(root_state.st_mode)
        or stat.S_IMODE(root_state.st_mode) != 0o711
    ):
        raise StageError(
            "staging-path", "target-prepare", "blocked", "staging root is unsafe"
        )
    try:
        if any(root.iterdir()):
            raise StageError(
                "staging-path", "target-prepare", "blocked",
                "staging root contains an existing run",
            )
    except OSError as error:
        raise StageError(
            "staging-path", "target-prepare", "incomplete",
            "staging root could not be inspected",
        ) from error
    if _lstat(paths["run"]) is not None:
        raise StageError(
            "staging-path", "target-prepare", "blocked", "run staging path already exists"
        )
    created: list[Path] = []
    try:
        paths["run"].mkdir(mode=0o700)
        created.append(paths["run"])
        paths["incoming"].mkdir(mode=0o700)
        created.append(paths["incoming"])
        if owner is not None:
            os.chown(paths["run"], owner.pw_uid, owner.pw_gid)
            os.chown(paths["incoming"], owner.pw_uid, owner.pw_gid)
    except OSError as error:
        for path in reversed(created):
            try:
                path.rmdir()
            except OSError:
                pass
        raise StageError(
            "staging-path", "target-prepare", "incomplete",
            "target staging path could not be prepared",
        ) from error
    return {
        "schemaVersion": SCHEMA_VERSION,
        "state": "prepared",
        "runPath": os.fspath(paths["run"]),
        "incomingPath": os.fspath(paths["incoming"]),
        "readyPath": os.fspath(paths["ready"]),
    }


def _target_verify(
    request: Mapping[str, Any],
    *,
    location: str,
    allowed_staging_root: Path | str,
    verifier_source: str,
) -> dict[str, Any]:
    _target, _root, paths = _validate_target_request(
        request, allowed_staging_root=allowed_staging_root
    )
    directory = paths[location]
    _require_directory(directory, code="target-verification")
    artifact = paths[f"{location}Artifact"]
    descriptor_path = paths[f"{location}Descriptor"]
    _require_regular(artifact)
    _require_regular(descriptor_path)
    if {entry.name for entry in directory.iterdir()} != {ARTIFACT_NAME, DESCRIPTOR_NAME}:
        raise StageError(
            "target-verification", "target-verification", "blocked",
            "staging directory contains unexpected entries",
        )
    expected = request["artifact"]
    try:
        descriptor, _manifest = _verify_artifact(
            artifact, descriptor_path, expected["sourceSha"], verifier_source
        )
    except StageError as error:
        raise StageError(
            "target-verification", "target-verification", error.status,
            "target Stage 1 artifact verification failed",
        ) from error
    for key in (
        "artifactSha256", "artifactSize", "manifestSha256", "payloadDigest", "sourceSha"
    ):
        if descriptor.get(key) != expected.get(key):
            raise StageError(
                "target-verification", "target-verification", "blocked",
                "target artifact identity changed after transfer",
            )
    return {
        "schemaVersion": SCHEMA_VERSION,
        "state": "temporary-verified" if location == "incoming" else "ready",
        "path": os.fspath(directory),
        "artifactSha256": descriptor["artifactSha256"],
        "manifestSha256": descriptor["manifestSha256"],
        "payloadDigest": descriptor["payloadDigest"],
    }


def target_verify_temporary(
    request: Mapping[str, Any], *, allowed_staging_root: Path | str, verifier_source: str
) -> dict[str, Any]:
    return _target_verify(
        request,
        location="incoming",
        allowed_staging_root=allowed_staging_root,
        verifier_source=verifier_source,
    )


def target_promote(
    request: Mapping[str, Any], *, allowed_staging_root: Path | str
) -> dict[str, Any]:
    _target, _root, paths = _validate_target_request(
        request, allowed_staging_root=allowed_staging_root
    )
    _require_directory(paths["incoming"], code="atomic-promote")
    if _lstat(paths["ready"]) is not None:
        raise StageError(
            "atomic-promote", "atomic-promote", "blocked", "ready path already exists"
        )
    try:
        os.rename(paths["incoming"], paths["ready"])
    except OSError as error:
        raise StageError(
            "atomic-promote", "atomic-promote", "incomplete", "atomic promote failed"
        ) from error
    return {
        "schemaVersion": SCHEMA_VERSION,
        "state": "promoted",
        "readyPath": os.fspath(paths["ready"]),
    }


def target_verify_ready(
    request: Mapping[str, Any], *, allowed_staging_root: Path | str, verifier_source: str
) -> dict[str, Any]:
    return _target_verify(
        request,
        location="ready",
        allowed_staging_root=allowed_staging_root,
        verifier_source=verifier_source,
    )


def _cleanup_receipt(
    request: Mapping[str, Any],
    paths: Mapping[str, Path],
    *,
    removed: Sequence[str],
    checked: Sequence[str],
    residue_paths: Sequence[str],
    residue: bool | None,
    status: str,
) -> dict[str, Any]:
    return {
        "schemaVersion": SCHEMA_VERSION,
        "runId": request["runId"],
        "host": request["target"]["host"],
        "artifactDigest": request["artifact"]["artifactSha256"],
        "stagingPath": os.fspath(paths["run"]),
        "checkedPaths": list(checked),
        "removedPaths": list(removed),
        "residuePaths": list(residue_paths),
        "residue": residue,
        "status": status,
    }


def target_cleanup(
    request: Mapping[str, Any], *, allowed_staging_root: Path | str
) -> dict[str, Any]:
    _target, _root, paths = _validate_target_request(
        request, allowed_staging_root=allowed_staging_root
    )
    ordered = (
        paths["incomingArtifact"],
        paths["incomingDescriptor"],
        paths["readyArtifact"],
        paths["readyDescriptor"],
        paths["incoming"],
        paths["ready"],
        paths["run"],
        paths["root"],
    )
    checked: list[str] = []
    removed: list[str] = []
    unsafe: list[str] = []
    try:
        for path in ordered[:4]:
            checked.append(os.fspath(path))
            metadata = _lstat(path)
            if metadata is None:
                continue
            if not stat.S_ISREG(metadata.st_mode) or stat.S_ISLNK(metadata.st_mode):
                unsafe.append(os.fspath(path))
                continue
            path.unlink()
            removed.append(os.fspath(path))
        for path in ordered[4:]:
            checked.append(os.fspath(path))
            metadata = _lstat(path)
            if metadata is None:
                continue
            if not stat.S_ISDIR(metadata.st_mode) or stat.S_ISLNK(metadata.st_mode):
                unsafe.append(os.fspath(path))
                continue
            try:
                path.rmdir()
            except OSError:
                unsafe.append(os.fspath(path))
            else:
                removed.append(os.fspath(path))
    except OSError:
        return _cleanup_receipt(
            request, paths, removed=removed, checked=checked, residue_paths=unsafe,
            residue=None, status="failed",
        )
    residue_paths = [
        os.fspath(path) for path in ordered if _lstat(path) is not None
    ]
    if unsafe:
        residue_paths = list(dict.fromkeys([*unsafe, *residue_paths]))
    passed = bool(removed) and not residue_paths and _lstat(paths["run"]) is None
    return _cleanup_receipt(
        request,
        paths,
        removed=removed,
        checked=checked,
        residue_paths=residue_paths,
        residue=False if passed else bool(residue_paths),
        status="passed" if passed else "failed",
    )


class LocalFilesystemTransport:
    """Real helper path for E2E; only the SSH byte transport is replaced."""

    def __init__(
        self,
        *,
        allowed_staging_root: Path,
        verifier_source: str,
        fail_copy_after: int | None = None,
        corrupt_copy_name: str | None = None,
        fail_promote: bool = False,
        fail_cleanup: bool = False,
    ) -> None:
        self.allowed_staging_root = Path(allowed_staging_root)
        self.verifier_source = verifier_source
        self.fail_copy_after = fail_copy_after
        self.corrupt_copy_name = corrupt_copy_name
        self.fail_promote = fail_promote
        self.fail_cleanup = fail_cleanup
        self.copy_count = 0
        self.events: list[str] = []

    def prepare(self, request: Mapping[str, Any]) -> Mapping[str, Any]:
        self.events.append("prepare")
        return target_prepare(request, allowed_staging_root=self.allowed_staging_root)

    def copy(self, source: Path, name: str, request: Mapping[str, Any]) -> None:
        self.events.append(f"copy:{name}")
        self.copy_count += 1
        if self.fail_copy_after is not None and self.copy_count > self.fail_copy_after:
            raise StageError(
                "transfer-copy", "transfer", "incomplete", "artifact transfer was interrupted"
            )
        _target, _root, paths = _validate_target_request(
            request, allowed_staging_root=self.allowed_staging_root
        )
        destination = paths["incoming"] / name
        if name not in {ARTIFACT_NAME, DESCRIPTOR_NAME} or _lstat(destination) is not None:
            raise StageError(
                "transfer-copy", "transfer", "blocked", "transfer destination is unsafe"
            )
        shutil.copyfile(source, destination)
        if name == self.corrupt_copy_name:
            destination.write_bytes(destination.read_bytes() + b"corrupt-in-transfer")
        destination.chmod(0o600)

    def verify_temporary(self, request: Mapping[str, Any]) -> Mapping[str, Any]:
        self.events.append("verify-temporary")
        return target_verify_temporary(
            request,
            allowed_staging_root=self.allowed_staging_root,
            verifier_source=self.verifier_source,
        )

    def promote(self, request: Mapping[str, Any]) -> Mapping[str, Any]:
        self.events.append("promote")
        if self.fail_promote:
            raise StageError(
                "atomic-promote", "atomic-promote", "incomplete", "atomic promote failed"
            )
        return target_promote(request, allowed_staging_root=self.allowed_staging_root)

    def verify_ready(self, request: Mapping[str, Any]) -> Mapping[str, Any]:
        self.events.append("verify-ready")
        return target_verify_ready(
            request,
            allowed_staging_root=self.allowed_staging_root,
            verifier_source=self.verifier_source,
        )

    def cleanup(self, request: Mapping[str, Any]) -> Mapping[str, Any]:
        self.events.append("cleanup")
        if self.fail_cleanup:
            _target, _root, paths = _validate_target_request(
                request, allowed_staging_root=self.allowed_staging_root
            )
            return _cleanup_receipt(
                request,
                paths,
                removed=(),
                checked=(os.fspath(paths["run"]),),
                residue_paths=(os.fspath(paths["run"]),),
                residue=True,
                status="failed",
            )
        return target_cleanup(request, allowed_staging_root=self.allowed_staging_root)


def _empty_report(
    artifact_ref: str,
    target: Mapping[str, Any] | None,
    run_id: str,
    staging_root: Path | str,
    retain: bool,
) -> dict[str, Any]:
    host = target.get("host") if isinstance(target, Mapping) else None
    root = Path(staging_root)
    run_path = root / run_id if isinstance(run_id, str) else root
    return {
        "schemaVersion": SCHEMA_VERSION,
        "operation": OPERATION,
        "status": "incomplete",
        "retain": retain if type(retain) is bool else None,
        "runId": run_id if isinstance(run_id, str) else None,
        "host": host if isinstance(host, str) else None,
        "artifact": {"reference": artifact_ref} if isinstance(artifact_ref, str) else None,
        "staging": {
            "root": os.fspath(root),
            "runPath": os.fspath(run_path),
            "temporaryPath": os.fspath(run_path / "incoming"),
            "readyPath": os.fspath(run_path / "ready"),
        },
        "lifecycle": [],
        "cleanupReceipt": None,
        "failure": None,
    }


def _failure(report: dict[str, Any], error: StageError) -> dict[str, Any]:
    report["status"] = error.status
    report["failure"] = {
        "stage": error.stage,
        "code": error.code,
        **({"primary": error.primary} if error.primary is not None else {}),
    }
    return report


def parse_stage_report(
    raw: str,
    *,
    run_id: str,
    host: str,
    retain: bool,
) -> dict[str, Any]:
    """Validate the bounded report returned across the operator-to-Pi5 boundary."""

    try:
        value = json.loads(raw, object_pairs_hook=_reject_duplicate_keys)
    except (ValueError, json.JSONDecodeError) as error:
        raise StageError(
            "stage-report", "report", "incomplete", "Stage 2 report is malformed"
        ) from error
    expected = {
        "schemaVersion", "operation", "status", "retain", "runId", "host",
        "artifact", "staging", "lifecycle", "cleanupReceipt", "failure",
    }
    if (
        not isinstance(value, dict)
        or set(value) != expected
        or value.get("schemaVersion") != SCHEMA_VERSION
        or value.get("operation") != OPERATION
        or value.get("status") not in {"passed", "blocked", "incomplete"}
        or value.get("retain") is not retain
        or value.get("runId") != run_id
        or value.get("host") != host
        or not isinstance(value.get("lifecycle"), list)
        or not isinstance(value.get("staging"), dict)
    ):
        raise StageError(
            "stage-report", "report", "incomplete", "Stage 2 report fields are invalid"
        )
    if value["status"] == "passed":
        if not isinstance(value.get("artifact"), dict) or value.get("failure") is not None:
            raise StageError(
                "stage-report", "report", "incomplete", "passing Stage 2 report has no identity"
            )
        if retain:
            if value.get("cleanupReceipt") is not None:
                raise StageError(
                    "stage-report", "report", "incomplete", "retained Stage 2 report cleaned its path"
                )
        else:
            request = {
                "runId": run_id,
                "target": {"host": host},
                "artifact": {"artifactSha256": value["artifact"].get("artifactSha256")},
                "stagingRoot": value["staging"].get("root"),
            }
            _validated_cleanup_receipt(value.get("cleanupReceipt"), request)
    elif not isinstance(value.get("failure"), dict):
        raise StageError(
            "stage-report", "report", "incomplete", "failed Stage 2 report has no failure"
        )
    elif value.get("cleanupReceipt") is not None and isinstance(value.get("artifact"), dict):
        request = {
            "runId": run_id,
            "target": {"host": host},
            "artifact": {"artifactSha256": value["artifact"].get("artifactSha256")},
            "stagingRoot": value["staging"].get("root"),
        }
        _validated_cleanup_receipt(value["cleanupReceipt"], request)
    return value


def _validated_cleanup_receipt(
    value: Mapping[str, Any], request: Mapping[str, Any]
) -> dict[str, Any]:
    expected = {
        "schemaVersion", "runId", "host", "artifactDigest", "stagingPath",
        "checkedPaths", "removedPaths", "residuePaths", "residue", "status",
    }
    if (
        not isinstance(value, Mapping)
        or set(value) != expected
        or value.get("schemaVersion") != SCHEMA_VERSION
        or value.get("runId") != request["runId"]
        or value.get("host") != request["target"]["host"]
        or value.get("artifactDigest") != request["artifact"]["artifactSha256"]
        or value.get("stagingPath")
        != os.fspath(Path(request["stagingRoot"]) / request["runId"])
        or not isinstance(value.get("checkedPaths"), list)
        or not isinstance(value.get("removedPaths"), list)
        or not isinstance(value.get("residuePaths"), list)
        or value.get("status") not in {"passed", "failed"}
    ):
        raise StageError(
            "cleanup-verification", "cleanup", "incomplete", "cleanup receipt is malformed"
        )
    result = dict(value)
    paths = _stage_paths(Path(request["stagingRoot"]), request["runId"])
    expected_checked = {
        os.fspath(paths[key])
        for key in (
            "incomingArtifact", "incomingDescriptor", "readyArtifact",
            "readyDescriptor", "incoming", "ready", "run", "root",
        )
    }
    checked = result["checkedPaths"]
    removed = result["removedPaths"]
    residue_paths = result["residuePaths"]
    if (
        any(not isinstance(path, str) for path in [*checked, *removed, *residue_paths])
        or len(checked) != len(set(checked))
        or len(removed) != len(set(removed))
        or len(residue_paths) != len(set(residue_paths))
        or not checked
        or not set(checked) <= expected_checked
        or not set(removed) <= expected_checked
        or not set(residue_paths) <= expected_checked
        or (result["status"] == "passed" and set(checked) != expected_checked)
    ):
        raise StageError(
            "cleanup-verification", "cleanup", "incomplete",
            "cleanup receipt paths do not match the run allowlist",
        )
    if result["status"] == "passed" and (
        result["residue"] is not False
        or not result["removedPaths"]
        or result["residuePaths"]
        or not result["checkedPaths"]
    ):
        raise StageError(
            "cleanup-verification", "cleanup", "incomplete",
            "cleanup receipt does not prove zero residue",
        )
    return result


def acquire_and_stage(
    artifact_ref: str,
    target: Mapping[str, Any],
    run_id: str,
    staging_root: Path | str,
    retain: bool,
    *,
    acquisition: Acquisition,
    attestor: Attestor,
    transport: TargetTransport,
    verifier_source: str,
    controller_root: Path | None = None,
) -> dict[str, Any]:
    """Execute the one Stage 2 lifecycle and always return a secret-free report."""

    report = _empty_report(artifact_ref, target, run_id, staging_root, retain)
    request: dict[str, Any] | None = None
    prepared = False
    try:
        source_sha = _artifact_source_sha(artifact_ref)
        validated_target = _validated_target(target)
        validated_run = _validated_run_id(run_id)
        if type(retain) is not bool:
            raise StageError(
                "request-validation", "request", "blocked", "retain must be boolean"
            )
        root = _validated_root(staging_root, allowed=transport.allowed_staging_root)
        temporary_parent = Path(controller_root) if controller_root is not None else None
        if temporary_parent is not None:
            parent_state = _lstat(temporary_parent)
            if parent_state is None or not stat.S_ISDIR(parent_state.st_mode) or stat.S_ISLNK(parent_state.st_mode):
                raise StageError(
                    "request-validation", "request", "blocked", "controller root is unsafe"
                )
        with tempfile.TemporaryDirectory(
            prefix=f"signage-stage-{validated_run}-", dir=temporary_parent
        ) as temporary:
            acquired = acquisition.acquire(artifact_ref, Path(temporary))
            if not isinstance(acquired, Mapping) or set(acquired) != {
                "artifactPath", "descriptorPath", "ociDigest"
            }:
                raise StageError(
                    "oci-resolution", "acquisition", "incomplete", "OCI acquisition result is malformed"
                )
            artifact_path = Path(acquired["artifactPath"])
            descriptor_path = Path(acquired["descriptorPath"])
            acquired_root = Path(temporary).resolve(strict=True)
            for path, expected_name in (
                (artifact_path, ARTIFACT_NAME),
                (descriptor_path, DESCRIPTOR_NAME),
            ):
                try:
                    metadata = path.lstat()
                    resolved_parent = path.parent.resolve(strict=True)
                except OSError as error:
                    raise StageError(
                        "oci-resolution", "acquisition", "blocked",
                        "acquired OCI payload path is unavailable",
                    ) from error
                if (
                    path.name != expected_name
                    or resolved_parent != acquired_root
                    or not stat.S_ISREG(metadata.st_mode)
                    or stat.S_ISLNK(metadata.st_mode)
                ):
                    raise StageError(
                        "oci-resolution", "acquisition", "blocked",
                        "acquired OCI payload path is unsafe",
                    )
            exact_reference = _exact_reference(artifact_ref, acquired["ociDigest"])
            report["lifecycle"].append("acquired")

            verifier = _load_verifier(verifier_source)
            descriptor = _descriptor(verifier, descriptor_path)
            try:
                statement = attestor.verify(artifact_ref, exact_reference, source_sha)
            except StageError:
                raise
            except Exception as error:
                raise StageError(
                    "attestation-verification", "attestation", "incomplete",
                    "Signage attestation verification did not complete",
                ) from error
            verify_attestation_statement(
                statement, exact_reference=exact_reference, descriptor=descriptor
            )
            report["lifecycle"].append("attested")

            descriptor, _manifest = _verify_artifact(
                artifact_path, descriptor_path, source_sha, verifier_source
            )
            report["lifecycle"].append("controller-verified")
            report["artifact"] = {
                "reference": artifact_ref,
                "exactReference": exact_reference,
                "ociDigest": acquired["ociDigest"],
                "sourceSha": descriptor["sourceSha"],
                "artifactSha256": descriptor["artifactSha256"],
                "manifestSha256": descriptor["manifestSha256"],
                "payloadDigest": descriptor["payloadDigest"],
            }
            request = target_request(
                validated_target, validated_run, root, descriptor, acquired["ociDigest"]
            )

            transport.prepare(request)
            prepared = True
            report["lifecycle"].append("target-prepared")
            try:
                transport.copy(artifact_path, ARTIFACT_NAME, request)
                transport.copy(descriptor_path, DESCRIPTOR_NAME, request)
            except StageError:
                raise
            except Exception as error:
                raise StageError(
                    "transfer-copy", "transfer", "incomplete", "artifact transfer failed"
                ) from error
            report["lifecycle"].append("transferred")

            transport.verify_temporary(request)
            report["lifecycle"].append("temporary-verified")
            transport.promote(request)
            report["lifecycle"].append("atomically-promoted")
            transport.verify_ready(request)
            report["lifecycle"].append("ready-verified")

            if not retain:
                receipt = _validated_cleanup_receipt(transport.cleanup(request), request)
                report["cleanupReceipt"] = receipt
                if receipt["status"] != "passed":
                    raise StageError(
                        "cleanup-verification", "cleanup", "incomplete",
                        "target cleanup did not prove zero residue",
                    )
                report["lifecycle"].append("cleaned")
            report["status"] = "passed"
            return report
    except StageError as error:
        if prepared and request is not None and report.get("cleanupReceipt") is None:
            try:
                receipt = _validated_cleanup_receipt(transport.cleanup(request), request)
            except Exception:
                receipt = None
            report["cleanupReceipt"] = receipt
            if receipt is None or receipt.get("status") != "passed":
                error = StageError(
                    "cleanup-verification", "cleanup", "incomplete",
                    "failure cleanup could not be proven",
                    primary={"stage": error.stage, "code": error.code},
                )
        return _failure(report, error)
    except Exception:
        if prepared and request is not None:
            try:
                report["cleanupReceipt"] = _validated_cleanup_receipt(
                    transport.cleanup(request), request
                )
            except Exception:
                report["cleanupReceipt"] = None
        return _failure(
            report,
            StageError(
                "internal-stage-error", "internal", "incomplete",
                "Stage 2 raised an unexpected internal error",
            ),
        )


def load_registry_config(path: Path = DEFAULT_CONFIG_PATH) -> dict[str, str]:
    """Read only the existing Pi5 release-runner GHCR trust policy."""

    try:
        metadata = path.lstat()
        raw = path.read_bytes()
    except OSError as error:
        raise StageError(
            "oci-resolution", "acquisition", "incomplete", "GHCR policy is unavailable"
        ) from error
    if (
        not stat.S_ISREG(metadata.st_mode)
        or path.is_symlink()
        or not 1 <= len(raw) <= 64 * 1024
    ):
        raise StageError(
            "oci-resolution", "acquisition", "blocked", "GHCR policy file is unsafe"
        )
    value = _strict_json_bytes(
        raw, label="GHCR policy", max_bytes=64 * 1024,
        code="oci-resolution", stage_name="acquisition",
    )
    expected = {
        "enabled", "repository", "workflow", "releaseSetRepository", "username", "token"
    }
    if (
        not isinstance(value, dict)
        or set(value) != expected
        or value.get("enabled") is not True
        or value.get("repository") != SOURCE_REPOSITORY
        or value.get("workflow") != ".github/workflows/ci.yml"
        or value.get("releaseSetRepository")
        != "ghcr.io/denkoushi/raspisys-release-set"
        or not isinstance(value.get("username"), str)
        or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,99}", value["username"])
        or not isinstance(value.get("token"), str)
        or any(character in value["token"] for character in "\x00\r\n")
    ):
        raise StageError(
            "oci-resolution", "acquisition", "blocked", "GHCR policy is malformed"
        )
    return {"username": value["username"], "token": value["token"]}


class GhcrAcquisition:
    """Resolve and download the exact Signage OCI payload without Docker state."""

    _INDEX_MEDIA_TYPES = {
        "application/vnd.oci.image.index.v1+json",
        "application/vnd.docker.distribution.manifest.list.v2+json",
    }
    _MANIFEST_MEDIA_TYPES = {
        "application/vnd.oci.image.manifest.v1+json",
        "application/vnd.docker.distribution.manifest.v2+json",
    }
    _LAYER_MEDIA_TYPES = {
        "application/vnd.oci.image.layer.v1.tar+gzip",
        "application/vnd.docker.image.rootfs.diff.tar.gzip",
        "application/vnd.oci.image.layer.v1.tar",
    }

    def __init__(
        self,
        config: Mapping[str, str],
        *,
        opener: Any = urllib.request.urlopen,
    ) -> None:
        self.username = config.get("username", "")
        self.token = config.get("token", "")
        self.opener = opener
        self._bearer: str | None = None

    def _request(
        self,
        url: str,
        *,
        accept: str | None = None,
        max_bytes: int,
        authorize: bool = True,
    ) -> tuple[bytes, Mapping[str, str]]:
        headers = {"User-Agent": "raspisystem-pi3-signage-stage/1"}
        if accept:
            headers["Accept"] = accept
        if authorize:
            if self._bearer is None:
                self._bearer = self._registry_token()
            headers["Authorization"] = f"Bearer {self._bearer}"
        request = urllib.request.Request(url, headers=headers)
        try:
            with self.opener(request, timeout=60) as response:
                payload = response.read(max_bytes + 1)
                response_headers = dict(response.headers.items())
        except (OSError, urllib.error.URLError, urllib.error.HTTPError) as error:
            raise StageError(
                "oci-resolution", "acquisition", "incomplete", "GHCR request failed"
            ) from error
        if not 1 <= len(payload) <= max_bytes:
            raise StageError(
                "oci-resolution", "acquisition", "blocked", "GHCR payload exceeds its bound"
            )
        return payload, response_headers

    def _registry_token(self) -> str:
        query = urllib.parse.urlencode(
            {
                "service": "ghcr.io",
                "scope": "repository:denkoushi/raspisys-pi3-signage:pull",
            }
        )
        headers = {"User-Agent": "raspisystem-pi3-signage-stage/1"}
        if self.token:
            credentials = base64.b64encode(
                f"{self.username}:{self.token}".encode("utf-8")
            ).decode("ascii")
            headers["Authorization"] = f"Basic {credentials}"
        request = urllib.request.Request(f"https://ghcr.io/token?{query}", headers=headers)
        try:
            with self.opener(request, timeout=30) as response:
                raw = response.read(64 * 1024 + 1)
        except (OSError, urllib.error.URLError, urllib.error.HTTPError) as error:
            raise StageError(
                "oci-resolution", "acquisition", "incomplete", "GHCR token request failed"
            ) from error
        value = _strict_json_bytes(
            raw, label="registry JSON response", max_bytes=64 * 1024,
            code="oci-resolution", stage_name="acquisition",
        )
        bearer = value.get("token") if isinstance(value, dict) else None
        if (
            not isinstance(bearer, str)
            or not bearer
            or len(bearer) > 16 * 1024
            or any(character in bearer for character in "\x00\r\n")
        ):
            raise StageError(
                "oci-resolution", "acquisition", "blocked", "GHCR token is malformed"
            )
        return bearer

    def _manifest(self, reference: str) -> tuple[dict[str, Any], str, bytes]:
        accept = ", ".join(sorted(self._INDEX_MEDIA_TYPES | self._MANIFEST_MEDIA_TYPES))
        encoded = urllib.parse.quote(reference, safe=":")
        raw, headers = self._request(
            "https://ghcr.io/v2/denkoushi/raspisys-pi3-signage/manifests/" + encoded,
            accept=accept,
            max_bytes=MAX_OCI_DOCUMENT_BYTES,
        )
        value = _strict_json_bytes(
            raw, label="OCI manifest", max_bytes=MAX_OCI_DOCUMENT_BYTES,
            code="oci-resolution", stage_name="acquisition",
        )
        if not isinstance(value, dict):
            raise StageError(
                "oci-resolution", "acquisition", "blocked", "OCI manifest is malformed"
            )
        calculated = "sha256:" + _sha256_bytes(raw)
        header_digest = headers.get("Docker-Content-Digest") or headers.get(
            "docker-content-digest"
        )
        if header_digest is not None and header_digest != calculated:
            raise StageError(
                "oci-resolution", "acquisition", "blocked", "OCI manifest digest disagrees"
            )
        if reference.startswith("sha256:") and reference != calculated:
            raise StageError(
                "oci-resolution", "acquisition", "blocked", "OCI digest reference changed"
            )
        return value, calculated, raw

    @staticmethod
    def _descriptor_digest(value: Any, *, label: str) -> str:
        if (
            not isinstance(value, Mapping)
            or not isinstance(value.get("digest"), str)
            or not value["digest"].startswith("sha256:")
            or SHA256_RE.fullmatch(value["digest"][7:]) is None
            or isinstance(value.get("size"), bool)
            or not isinstance(value.get("size"), int)
            or not 1 <= value["size"] <= MAX_OCI_LAYER_BYTES
        ):
            raise StageError(
                "oci-resolution", "acquisition", "blocked", f"{label} descriptor is malformed"
            )
        return value["digest"]

    def _blob(self, digest: str, *, max_bytes: int) -> bytes:
        raw, _headers = self._request(
            "https://ghcr.io/v2/denkoushi/raspisys-pi3-signage/blobs/" + digest,
            max_bytes=max_bytes,
        )
        if "sha256:" + _sha256_bytes(raw) != digest:
            raise StageError(
                "oci-resolution", "acquisition", "blocked", "OCI blob digest disagrees"
            )
        return raw

    @staticmethod
    def _layer_payload(raw: bytes, media_type: str) -> bytes:
        if media_type.endswith("+gzip") or media_type.endswith(".gzip"):
            try:
                with gzip.GzipFile(fileobj=io.BytesIO(raw)) as stream:
                    payload = stream.read(MAX_OCI_LAYER_BYTES + 1)
            except (OSError, EOFError) as error:
                raise StageError(
                    "oci-resolution", "acquisition", "blocked", "OCI layer gzip is malformed"
                ) from error
        else:
            payload = raw
        if not 1 <= len(payload) <= MAX_OCI_LAYER_BYTES:
            raise StageError(
                "oci-resolution", "acquisition", "blocked", "OCI layer expands beyond its bound"
            )
        return payload

    @staticmethod
    def _extract_layer(payload: bytes, found: dict[str, bytes]) -> None:
        try:
            with tarfile.open(fileobj=io.BytesIO(payload), mode="r:") as archive:
                for member in archive.getmembers():
                    raw_name = member.name.removeprefix("./")
                    path = PurePosixPath(raw_name)
                    if (
                        not raw_name
                        or raw_name.startswith("/")
                        or ".." in path.parts
                        or "\x00" in raw_name
                    ):
                        raise StageError(
                            "oci-resolution", "acquisition", "blocked", "OCI layer path is unsafe"
                        )
                    if member.isdir():
                        continue
                    if not member.isreg() or raw_name not in {ARTIFACT_NAME, DESCRIPTOR_NAME}:
                        raise StageError(
                            "oci-resolution", "acquisition", "blocked", "OCI layer member is unexpected"
                        )
                    if raw_name in found:
                        raise StageError(
                            "oci-resolution", "acquisition", "blocked", "OCI payload member is duplicated"
                        )
                    stream = archive.extractfile(member)
                    if stream is None:
                        raise StageError(
                            "oci-resolution", "acquisition", "blocked", "OCI payload member is unreadable"
                        )
                    value = stream.read(8 * 1024 * 1024 + 1)
                    if not 1 <= len(value) <= 8 * 1024 * 1024:
                        raise StageError(
                            "oci-resolution", "acquisition", "blocked", "OCI payload member is too large"
                        )
                    found[raw_name] = value
        except StageError:
            raise
        except (OSError, tarfile.TarError) as error:
            raise StageError(
                "oci-resolution", "acquisition", "blocked", "OCI layer tar is malformed"
            ) from error

    def acquire(self, artifact_ref: str, directory: Path) -> Mapping[str, Any]:
        source_sha = _artifact_source_sha(artifact_ref)
        index, exact_digest, _raw = self._manifest(source_sha)
        media_type = index.get("mediaType")
        if media_type not in self._INDEX_MEDIA_TYPES:
            raise StageError(
                "oci-resolution", "acquisition", "blocked", "Signage OCI index is unavailable"
            )
        candidates = [
            item
            for item in index.get("manifests", [])
            if isinstance(item, Mapping)
            and item.get("platform")
            == {"architecture": "arm", "os": "linux", "variant": "v7"}
        ]
        if len(candidates) != 1:
            raise StageError(
                "oci-resolution", "acquisition", "blocked", "Signage ARMv7 OCI manifest is ambiguous"
            )
        manifest_digest = self._descriptor_digest(candidates[0], label="platform manifest")
        manifest, _calculated, _manifest_raw = self._manifest(manifest_digest)
        if manifest.get("mediaType") not in self._MANIFEST_MEDIA_TYPES:
            raise StageError(
                "oci-resolution", "acquisition", "blocked", "platform OCI manifest is malformed"
            )
        layers = manifest.get("layers")
        if not isinstance(layers, list) or not 1 <= len(layers) <= 8:
            raise StageError(
                "oci-resolution", "acquisition", "blocked", "OCI layer list is malformed"
            )
        found: dict[str, bytes] = {}
        for layer in layers:
            digest = self._descriptor_digest(layer, label="layer")
            media = layer.get("mediaType")
            if media not in self._LAYER_MEDIA_TYPES:
                raise StageError(
                    "oci-resolution", "acquisition", "blocked", "OCI layer media type is unsupported"
                )
            self._extract_layer(
                self._layer_payload(self._blob(digest, max_bytes=MAX_OCI_LAYER_BYTES), media),
                found,
            )
        if set(found) != {ARTIFACT_NAME, DESCRIPTOR_NAME}:
            raise StageError(
                "oci-resolution", "acquisition", "blocked", "OCI payload is incomplete"
            )
        artifact = directory / ARTIFACT_NAME
        descriptor = directory / DESCRIPTOR_NAME
        artifact.write_bytes(found[ARTIFACT_NAME])
        descriptor.write_bytes(found[DESCRIPTOR_NAME])
        artifact.chmod(0o600)
        descriptor.chmod(0o600)
        return {
            "artifactPath": artifact,
            "descriptorPath": descriptor,
            "ociDigest": exact_digest,
        }


class GhAttestor:
    """Invoke the existing pinned verifier and return its one verified statement."""

    def __init__(self, config: Mapping[str, str], *, gh: str | None = None) -> None:
        self.token = config.get("token", "")
        self.gh = gh or shutil.which("gh") or ""

    def verify(
        self, artifact_ref: str, exact_reference: str, source_sha: str
    ) -> Mapping[str, Any]:
        del artifact_ref
        if not self.gh:
            raise StageError(
                "attestation-verification", "attestation", "incomplete",
                "GitHub attestation verifier is unavailable",
            )
        with tempfile.TemporaryDirectory(prefix="signage-stage-gh-") as directory:
            environment = os.environ.copy()
            environment["GH_CONFIG_DIR"] = directory
            environment["GH_TOKEN"] = self.token or "public-oci-attestation-verification"
            environment.pop("GITHUB_TOKEN", None)
            command = [
                self.gh,
                "attestation",
                "verify",
                f"oci://{exact_reference}",
                "--bundle-from-oci",
                "--repo",
                SOURCE_REPOSITORY,
                "--signer-workflow",
                SIGNER_WORKFLOW,
                "--source-digest",
                source_sha,
                "--source-ref",
                "refs/heads/main",
                "--deny-self-hosted-runners",
                "--predicate-type",
                PREDICATE_TYPE,
                "--format",
                "json",
            ]
            try:
                completed = subprocess.run(
                    command,
                    stdin=subprocess.DEVNULL,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.DEVNULL,
                    text=True,
                    env=environment,
                    timeout=120,
                    check=False,
                )
            except (OSError, subprocess.TimeoutExpired) as error:
                raise StageError(
                    "attestation-verification", "attestation", "incomplete",
                    "Signage attestation verification could not complete",
                ) from error
        if completed.returncode != 0 or len(completed.stdout.encode("utf-8")) > MAX_ATTESTATION_BYTES:
            raise StageError(
                "attestation-verification", "attestation", "blocked",
                "Signage attestation signature verification failed",
            )
        value = _strict_json_bytes(
            completed.stdout.encode("utf-8"),
            label="attestation verification result",
            max_bytes=MAX_ATTESTATION_BYTES,
            code="attestation-verification",
            stage_name="attestation",
        )
        statements = [
            item.get("verificationResult", {}).get("statement")
            for item in value
            if isinstance(item, Mapping)
            and isinstance(item.get("verificationResult"), Mapping)
        ] if isinstance(value, list) else []
        if len(statements) != 1 or not isinstance(statements[0], Mapping):
            raise StageError(
                "attestation-verification", "attestation", "blocked",
                "verified Signage attestation statement is ambiguous",
            )
        return statements[0]


def _source_text() -> str:
    embedded = globals().get("EMBEDDED_SIGNAGE_STAGE_SOURCE")
    if isinstance(embedded, str) and embedded.strip():
        return embedded
    return Path(__file__).read_text(encoding="utf-8")


def _verifier_source() -> str:
    embedded = globals().get("EMBEDDED_DISTRIBUTION_VERIFIER_SOURCE")
    if isinstance(embedded, str) and embedded.strip():
        return embedded
    return Path(__file__).resolve().parents[1].joinpath(
        "signage-distribution-artifact.py"
    ).read_text(encoding="utf-8")


def _encode_marker(value: Mapping[str, Any]) -> str:
    return base64.urlsafe_b64encode(_canonical_json(value)).decode("ascii")


def _decode_marker(output: str) -> dict[str, Any]:
    values = TARGET_MARKER_RE.findall(output)
    if not values:
        raise StageError(
            "target-verification", "target-helper", "incomplete",
            "target helper result marker is missing",
        )
    decoded: list[dict[str, Any]] = []
    for value in values:
        try:
            raw = base64.b64decode(value, altchars=b"-_", validate=True)
            if base64.urlsafe_b64encode(raw).decode("ascii") != value:
                raise ValueError("noncanonical")
            document = _strict_json_bytes(
                raw, label="target helper result", max_bytes=1024 * 1024,
                code="target-verification", stage_name="target-helper",
                status="incomplete",
            )
        except (binascii.Error, ValueError) as error:
            raise StageError(
                "target-verification", "target-helper", "incomplete",
                "target helper result marker is malformed",
            ) from error
        if not isinstance(document, dict):
            raise StageError(
                "target-verification", "target-helper", "incomplete",
                "target helper result is malformed",
            )
        decoded.append(document)
    if any(value != decoded[0] for value in decoded[1:]):
        raise StageError(
            "target-verification", "target-helper", "incomplete",
            "target helper results disagree",
        )
    return decoded[0]


def target_dispatch(
    action: str,
    request: Mapping[str, Any],
    *,
    allowed_staging_root: Path | str,
    verifier_source: str,
    name: str | None = None,
) -> dict[str, Any]:
    try:
        if action == "prepare":
            result = target_prepare(
                request, allowed_staging_root=allowed_staging_root, set_owner=True
            )
        elif action == "seal":
            if name not in {ARTIFACT_NAME, DESCRIPTOR_NAME}:
                raise StageError(
                    "transfer-copy", "transfer", "blocked", "transfer file name is malformed"
                )
            _target, _root, paths = _validate_target_request(
                request, allowed_staging_root=allowed_staging_root
            )
            path = paths["incoming"] / name
            metadata = _lstat(path)
            if metadata is None or not stat.S_ISREG(metadata.st_mode) or stat.S_ISLNK(metadata.st_mode):
                raise StageError(
                    "transfer-copy", "transfer", "blocked", "transferred file is unsafe"
                )
            path.chmod(0o600)
            result = {"schemaVersion": SCHEMA_VERSION, "state": "sealed", "name": name}
        elif action == "verify-temporary":
            result = target_verify_temporary(
                request,
                allowed_staging_root=allowed_staging_root,
                verifier_source=verifier_source,
            )
        elif action == "promote":
            result = target_promote(request, allowed_staging_root=allowed_staging_root)
        elif action == "verify-ready":
            result = target_verify_ready(
                request,
                allowed_staging_root=allowed_staging_root,
                verifier_source=verifier_source,
            )
        elif action == "cleanup":
            result = target_cleanup(request, allowed_staging_root=allowed_staging_root)
        else:
            raise StageError(
                "request-validation", "target-helper", "blocked", "target helper action is unsupported"
            )
        return {"ok": True, "result": result, "failure": None}
    except StageError as error:
        return {
            "ok": False,
            "result": None,
            "failure": {"code": error.code, "stage": error.stage, "status": error.status},
        }


TARGET_LOADER = (
    "import json,sys;"
    "raw=sys.stdin.buffer.read(2097153);"
    "fail=lambda:(_ for _ in ()).throw(SystemExit(78));"
    "fail() if len(raw)>2097152 else None;"
    "e=json.loads(raw.decode('utf-8'));"
    "fail() if not isinstance(e,dict) or set(e)!={'stageSource','verifierSource','allowedRoot','action','request','name'} else None;"
    "ns={'__name__':'_embedded_signage_stage','EMBEDDED_SIGNAGE_STAGE_SOURCE':e['stageSource'],'EMBEDDED_DISTRIBUTION_VERIFIER_SOURCE':e['verifierSource']};"
    "exec(compile(e['stageSource'],'<signage-artifact-stage>','exec'),ns);"
    "r=ns['target_dispatch'](e['action'],e['request'],allowed_staging_root=e['allowedRoot'],verifier_source=e['verifierSource'],name=e['name']);"
    "print('SIGNAGE_ARTIFACT_STAGE_RESULT:'+ns['_encode_marker'](r))"
)


class SshTargetTransport:
    """The sole production transport; every target operation runs the shared helper."""

    def __init__(
        self,
        target: Mapping[str, Any],
        *,
        stage_source: str,
        verifier_source: str,
        allowed_staging_root: Path = DEFAULT_STAGING_ROOT,
    ) -> None:
        self.target = _validated_target(target)
        self.stage_source = stage_source
        self.verifier_source = verifier_source
        self.allowed_staging_root = Path(allowed_staging_root)

    def _ssh_prefix(self) -> list[str]:
        return [
            "/usr/bin/ssh",
            "-o", "Compression=yes",
            "-o", "BatchMode=yes",
            "-o", "ConnectTimeout=12",
            "-o", "ServerAliveInterval=5",
            "-o", "ServerAliveCountMax=2",
            "-o", "StrictHostKeyChecking=no",
            "-o", "UserKnownHostsFile=/dev/null",
            "-p", str(self.target["port"]),
            "--", f"{self.target['user']}@{self.target['address']}",
        ]

    def _helper(
        self, action: str, request: Mapping[str, Any], *, name: str | None = None
    ) -> Mapping[str, Any]:
        envelope = _canonical_json(
            {
                "stageSource": self.stage_source,
                "verifierSource": self.verifier_source,
                "allowedRoot": os.fspath(self.allowed_staging_root),
                "action": action,
                "request": request,
                "name": name,
            }
        )
        remote = shlex.join(
            ["/usr/bin/sudo", "-n", "/usr/bin/python3", "-c", TARGET_LOADER]
        )
        try:
            completed = subprocess.run(
                [*self._ssh_prefix(), remote],
                input=envelope,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                timeout=180,
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired) as error:
            code = "cleanup-verification" if action == "cleanup" else (
                "atomic-promote" if action == "promote" else "target-verification"
            )
            raise StageError(code, action, "incomplete", "target helper transport failed") from error
        try:
            output = completed.stdout.decode("utf-8")
        except UnicodeError as error:
            raise StageError(
                "target-verification", action, "incomplete", "target helper output is malformed"
            ) from error
        value = _decode_marker(output)
        if completed.returncode != 0 or value.get("ok") is not True:
            failure = value.get("failure") if isinstance(value, Mapping) else None
            if isinstance(failure, Mapping):
                raise StageError(
                    str(failure.get("code")), str(failure.get("stage")),
                    str(failure.get("status")), "target helper rejected the operation",
                )
            raise StageError(
                "target-verification", action, "incomplete", "target helper rejected the operation"
            )
        result = value.get("result")
        if not isinstance(result, Mapping):
            raise StageError(
                "target-verification", action, "incomplete", "target helper result is missing"
            )
        return result

    def prepare(self, request: Mapping[str, Any]) -> Mapping[str, Any]:
        return self._helper("prepare", request)

    def copy(self, source: Path, name: str, request: Mapping[str, Any]) -> None:
        if name not in {ARTIFACT_NAME, DESCRIPTOR_NAME}:
            raise StageError(
                "transfer-copy", "transfer", "blocked", "transfer file name is malformed"
            )
        destination = PurePosixPath(request["stagingRoot"]) / request["runId"] / "incoming" / name
        command = [
            "/usr/bin/scp",
            "-q", "-C",
            "-o", "BatchMode=yes",
            "-o", "ConnectTimeout=12",
            "-o", "StrictHostKeyChecking=no",
            "-o", "UserKnownHostsFile=/dev/null",
            "-P", str(self.target["port"]),
            "--", os.fspath(source),
            f"{self.target['user']}@{self.target['address']}:{destination}",
        ]
        try:
            completed = subprocess.run(
                command,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=180,
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired) as error:
            raise StageError(
                "transfer-copy", "transfer", "incomplete", "SCP transfer did not complete"
            ) from error
        if completed.returncode != 0:
            raise StageError(
                "transfer-copy", "transfer", "incomplete", "SCP transfer failed"
            )
        self._helper("seal", request, name=name)

    def verify_temporary(self, request: Mapping[str, Any]) -> Mapping[str, Any]:
        return self._helper("verify-temporary", request)

    def promote(self, request: Mapping[str, Any]) -> Mapping[str, Any]:
        return self._helper("promote", request)

    def verify_ready(self, request: Mapping[str, Any]) -> Mapping[str, Any]:
        return self._helper("verify-ready", request)

    def cleanup(self, request: Mapping[str, Any]) -> Mapping[str, Any]:
        return self._helper("cleanup", request)


def parse_preflight_spec(raw: str) -> dict[str, Any]:
    try:
        value = json.loads(raw, object_pairs_hook=_reject_duplicate_keys)
    except (ValueError, json.JSONDecodeError) as error:
        raise StageError(
            "request-validation", "request", "blocked", "preflight stage request is malformed"
        ) from error
    common = {
        "version", "mode", "artifactRef", "runId", "stagingRoot", "retain", "target", "configPath"
    }
    mode = value.get("mode") if isinstance(value, dict) else None
    expected = (
        common
        if mode == "preflight"
        else common | {"expectedOciDigest"}
        if mode == "artifact-preflight"
        else set()
    )
    if (
        not isinstance(value, dict)
        or set(value) != expected
        or value.get("version") != SCHEMA_VERSION
        or mode not in {"preflight", "artifact-preflight"}
        or value.get("retain") is not False
        or value.get("stagingRoot") != os.fspath(DEFAULT_STAGING_ROOT)
        or value.get("configPath") != os.fspath(DEFAULT_CONFIG_PATH)
    ):
        raise StageError(
            "request-validation", "request", "blocked", "preflight stage fields are invalid"
        )
    _artifact_source_sha(value["artifactRef"])
    _validated_run_id(value["runId"])
    _validated_target(value["target"])
    if mode == "artifact-preflight":
        digest = value.get("expectedOciDigest")
        if (
            not isinstance(digest, str)
            or not digest.startswith("sha256:")
            or SHA256_RE.fullmatch(digest.removeprefix("sha256:")) is None
        ):
            raise StageError(
                "request-validation",
                "request",
                "blocked",
                "exact OCI digest is malformed",
            )
    return value


def execute_preflight(spec: Mapping[str, Any]) -> tuple[int, dict[str, Any]]:
    config = load_registry_config(Path(spec["configPath"]))
    verifier_source = _verifier_source()
    acquisition: Acquisition = GhcrAcquisition(config)
    if spec.get("mode") == "artifact-preflight":
        acquisition = DigestPinnedAcquisition(
            acquisition, str(spec["expectedOciDigest"])
        )
    report = acquire_and_stage(
        spec["artifactRef"],
        spec["target"],
        spec["runId"],
        Path(spec["stagingRoot"]),
        False,
        acquisition=acquisition,
        attestor=GhAttestor(config),
        transport=SshTargetTransport(
            spec["target"],
            stage_source=_source_text(),
            verifier_source=verifier_source,
        ),
        verifier_source=verifier_source,
    )
    code = 0 if report["status"] == "passed" else (
        78 if report["status"] == "blocked" else 70
    )
    return code, report


def main(argv: Sequence[str] | None = None) -> int:
    arguments = list(sys.argv[1:] if argv is None else argv)
    if len(arguments) != 1:
        report = _failure(
            _empty_report("", None, "", DEFAULT_STAGING_ROOT, False),
            StageError(
                "request-validation", "request", "blocked", "one preflight stage request is required"
            ),
        )
        print(json.dumps(report, sort_keys=True, separators=(",", ":")))
        return 78
    spec: dict[str, Any] | None = None
    try:
        spec = parse_preflight_spec(arguments[0])
        code, report = execute_preflight(spec)
    except StageError as error:
        artifact_ref = spec["artifactRef"] if spec is not None else ""
        target = spec["target"] if spec is not None else None
        run_id = spec["runId"] if spec is not None else ""
        staging_root = (
            spec["stagingRoot"] if spec is not None else DEFAULT_STAGING_ROOT
        )
        report = _failure(
            _empty_report(
                artifact_ref, target, run_id, staging_root, False
            ),
            error,
        )
        code = 78 if error.status == "blocked" else 70
    print(json.dumps(report, sort_keys=True, separators=(",", ":")))
    return code


if __name__ == "__main__":
    raise SystemExit(main())
