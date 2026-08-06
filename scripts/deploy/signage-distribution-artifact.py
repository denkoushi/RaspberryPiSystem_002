#!/usr/bin/env python3
"""Build and verify the complete immutable Pi3 signage distribution artifact."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import io
import json
import os
import re
import stat
import sys
import tarfile
import tempfile
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Sequence


SCHEMA_VERSION = 1
ARTIFACT_KIND = "pi3-signage-release"
MANIFEST_NAME = "SIGNAGE-ARTIFACT.json"
STATUS_AGENT_MANIFEST = "SIGNAGE-RELEASE.json"
FULL_SHA_RE = re.compile(r"^[0-9a-f]{40}$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
MAX_FILES = 32
MAX_FILE_BYTES = 2 * 1024 * 1024
MAX_ARTIFACT_BYTES = 8 * 1024 * 1024
HASH_CHUNK_BYTES = 1024 * 1024
ZIP_TIMESTAMP = (1980, 1, 1, 0, 0, 0)
ZIPAPP_SHEBANG = b"#!/usr/bin/env python3\n"


class ArtifactError(RuntimeError):
    """The distribution artifact cannot be proven complete and exact."""


@dataclass(frozen=True)
class PayloadSpec:
    archive_path: str
    install_path: str
    source_path: str
    kind: str
    templated: bool
    mode: int


_EXPECTED_PAYLOAD_SPECS = (
    PayloadSpec(
        "bin/raspi-signage-status-agent.pyz",
        "/usr/local/bin/raspi-signage-status-agent.pyz",
        "generated:signage-status-agent-zipapp",
        "status-agent-zipapp",
        False,
        0o755,
    ),
    PayloadSpec("bin/signage-display.sh", "/usr/local/bin/signage-display.sh", "infrastructure/ansible/roles/signage/templates/signage-display.sh.j2", "runtime-script", True, 0o755),
    PayloadSpec("bin/signage-lite-watchdog.sh", "/usr/local/bin/signage-lite-watchdog.sh", "infrastructure/ansible/roles/signage/templates/signage-lite-watchdog.sh.j2", "runtime-script", False, 0o755),
    PayloadSpec("bin/signage-stop.sh", "/usr/local/bin/signage-stop.sh", "infrastructure/ansible/roles/signage/templates/signage-stop.sh.j2", "runtime-script", False, 0o755),
    PayloadSpec("bin/signage-update.sh", "/usr/local/bin/signage-update.sh", "infrastructure/ansible/roles/signage/templates/signage-update.sh.j2", "runtime-script", True, 0o755),
    PayloadSpec("share/signage-maintenance.svg", "/usr/local/share/signage-maintenance.svg", "infrastructure/ansible/roles/signage/templates/signage-maintenance.svg.j2", "static-asset", False, 0o644),
    PayloadSpec("systemd/signage-daily-reboot.service", "/etc/systemd/system/signage-daily-reboot.service", "infrastructure/ansible/roles/signage/templates/signage-daily-reboot.service.j2", "systemd-unit", False, 0o644),
    PayloadSpec("systemd/signage-daily-reboot.timer", "/etc/systemd/system/signage-daily-reboot.timer", "infrastructure/ansible/roles/signage/templates/signage-daily-reboot.timer.j2", "systemd-unit", False, 0o644),
    PayloadSpec("systemd/signage-lite-update.service", "/etc/systemd/system/signage-lite-update.service", "infrastructure/ansible/roles/signage/templates/signage-lite-update.service.j2", "systemd-unit", True, 0o644),
    PayloadSpec("systemd/signage-lite-update.timer", "/etc/systemd/system/signage-lite-update.timer", "infrastructure/ansible/roles/signage/templates/signage-lite-update.timer.j2", "systemd-unit", True, 0o644),
    PayloadSpec("systemd/signage-lite-watchdog.service", "/etc/systemd/system/signage-lite-watchdog.service", "infrastructure/ansible/roles/signage/templates/signage-lite-watchdog.service.j2", "systemd-unit", True, 0o644),
    PayloadSpec("systemd/signage-lite-watchdog.timer", "/etc/systemd/system/signage-lite-watchdog.timer", "infrastructure/ansible/roles/signage/templates/signage-lite-watchdog.timer.j2", "systemd-unit", False, 0o644),
    PayloadSpec("systemd/signage-lite.service", "/etc/systemd/system/signage-lite.service", "infrastructure/ansible/roles/signage/templates/signage-lite.service.j2", "systemd-unit", True, 0o644),
    PayloadSpec("systemd/status-agent.service", "/etc/systemd/system/status-agent.service", "infrastructure/ansible/roles/signage/templates/status-agent-artifact.service.j2", "systemd-unit", False, 0o644),
    PayloadSpec("systemd/status-agent.timer", "/etc/systemd/system/status-agent.timer", "infrastructure/ansible/roles/signage/templates/status-agent-artifact.timer.j2", "systemd-unit", False, 0o644),
    PayloadSpec("tmpfiles/signage-lite.conf", "/etc/tmpfiles.d/signage-lite.conf", "infrastructure/ansible/roles/signage/templates/signage-lite.tmpfiles.conf.j2", "tmpfiles-config", True, 0o644),
)
PAYLOAD_SPECS = _EXPECTED_PAYLOAD_SPECS


def _canonical_bytes(value: Any, *, newline: bool = False) -> bytes:
    payload = json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return payload + (b"\n" if newline else b"")


def _sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(HASH_CHUNK_BYTES):
            digest.update(chunk)
    return digest.hexdigest()


def _safe_archive_path(value: str) -> bool:
    path = Path(value)
    return bool(value) and not value.startswith("/") and ".." not in path.parts


def _regular_source(root: Path, relative: str) -> Path:
    if not _safe_archive_path(relative):
        raise ArtifactError("artifact source path is unsafe")
    source = root / relative
    try:
        metadata = source.lstat()
    except FileNotFoundError as error:
        raise ArtifactError(f"artifact source is missing: {relative}") from error
    if not stat.S_ISREG(metadata.st_mode) or source.resolve() != source:
        raise ArtifactError(f"artifact source is not a repository regular file: {relative}")
    if metadata.st_size > MAX_FILE_BYTES:
        raise ArtifactError(f"artifact source exceeds its size bound: {relative}")
    return source


def _validate_specs(specs: Sequence[PayloadSpec]) -> None:
    if tuple(specs) != _EXPECTED_PAYLOAD_SPECS:
        raise ArtifactError("artifact payload differs from the fixed Signage allowlist")
    if not 1 <= len(specs) <= MAX_FILES:
        raise ArtifactError("artifact payload count is out of bounds")
    archive_paths = [spec.archive_path for spec in specs]
    install_paths = [spec.install_path for spec in specs]
    if len(set(archive_paths)) != len(archive_paths) or len(set(install_paths)) != len(install_paths):
        raise ArtifactError("artifact paths are not unique")
    for spec in specs:
        if not _safe_archive_path(spec.archive_path):
            raise ArtifactError("artifact archive path is unsafe")
        if not spec.install_path.startswith("/") or ".." in Path(spec.install_path).parts:
            raise ArtifactError("artifact install path is unsafe")
        if spec.mode not in {0o644, 0o755}:
            raise ArtifactError("artifact mode is outside the fixed policy")
        if spec.source_path != "generated:signage-status-agent-zipapp":
            lowered = spec.source_path.lower()
            if any(token in lowered for token in ("/.env", "inventory", "host_vars", "group_vars", "vault", "secret", "credential")):
                raise ArtifactError("secret or host-specific artifact source is forbidden")


def _load_status_agent_builder(root: Path):
    path = _regular_source(root, "scripts/deploy/signage-release-artifact.py")
    spec = importlib.util.spec_from_file_location("_signage_status_agent_builder", path)
    if spec is None or spec.loader is None:
        raise ArtifactError("status-agent artifact builder cannot be loaded")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _status_agent_payload(root: Path, source_sha: str, directory: Path) -> bytes:
    output = directory / "raspi-signage-status-agent.pyz"
    builder = _load_status_agent_builder(root)
    try:
        result = builder.build_artifact(
            root,
            output,
            candidate_sha=source_sha,
            profile_id="signage",
        )
    except Exception as error:
        raise ArtifactError("status-agent zipapp build failed") from error
    built_payload = output.read_bytes()
    if result.get("sourceSha") != source_sha or result.get("artifactSha256") != _sha256_bytes(built_payload):
        raise ArtifactError("status-agent zipapp identity is inconsistent")
    try:
        with zipfile.ZipFile(io.BytesIO(built_payload)) as source:
            names = source.namelist()
            if names != list(dict.fromkeys(names)) or any(
                not _safe_archive_path(name) for name in names
            ):
                raise ArtifactError("status-agent zipapp entries are unsafe")
            entries = {name: source.read(name) for name in names}
    except (OSError, KeyError, ValueError, zipfile.BadZipFile) as error:
        raise ArtifactError("status-agent zipapp normalization failed") from error
    normalized = io.BytesIO()
    with zipfile.ZipFile(normalized, "w", allowZip64=False) as archive:
        for name in sorted(entries):
            info = zipfile.ZipInfo(name, ZIP_TIMESTAMP)
            info.create_system = 3
            info.external_attr = (stat.S_IFREG | 0o644) << 16
            info.compress_type = zipfile.ZIP_STORED
            archive.writestr(info, entries[name])
    return ZIPAPP_SHEBANG + normalized.getvalue()


def _payloads(root: Path, source_sha: str) -> tuple[dict[str, bytes], list[dict[str, Any]]]:
    _validate_specs(PAYLOAD_SPECS)
    payloads: dict[str, bytes] = {}
    records: list[dict[str, Any]] = []
    with tempfile.TemporaryDirectory(prefix="signage-status-agent-") as temporary:
        status_payload = _status_agent_payload(root, source_sha, Path(temporary))
        for spec in PAYLOAD_SPECS:
            if spec.source_path == "generated:signage-status-agent-zipapp":
                payload = status_payload
            else:
                payload = _regular_source(root, spec.source_path).read_bytes()
                has_jinja = b"{{" in payload or b"{%" in payload
                if has_jinja != spec.templated:
                    raise ArtifactError(
                        f"artifact template classification drifted: {spec.source_path}"
                    )
            if not 1 <= len(payload) <= MAX_FILE_BYTES:
                raise ArtifactError(f"artifact payload size is out of bounds: {spec.archive_path}")
            payloads[spec.archive_path] = payload
            records.append(
                {
                    "installPath": spec.install_path,
                    "kind": spec.kind,
                    "mode": f"{spec.mode:04o}",
                    "path": spec.archive_path,
                    "sha256": _sha256_bytes(payload),
                    "size": len(payload),
                    "sourcePath": spec.source_path,
                    "templated": spec.templated,
                }
            )
    records.sort(key=lambda item: item["path"])
    return payloads, records


def _tar_info(name: str, size: int, mode: int) -> tarfile.TarInfo:
    info = tarfile.TarInfo(name)
    info.type = tarfile.REGTYPE
    info.size = size
    info.mode = mode
    info.mtime = 0
    info.uid = 0
    info.gid = 0
    info.uname = ""
    info.gname = ""
    return info


def _atomic_write(path: Path, payload: bytes, *, mode: int = 0o644) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        temporary.chmod(mode)
        os.replace(temporary, path)
        directory = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        temporary.unlink(missing_ok=True)


def build_artifact(
    root: Path,
    output: Path,
    descriptor: Path,
    *,
    source_sha: str,
) -> dict[str, Any]:
    if FULL_SHA_RE.fullmatch(source_sha) is None:
        raise ArtifactError("source SHA must be one lowercase full Git SHA")
    root = root.resolve(strict=True)
    payloads, records = _payloads(root, source_sha)
    payload_digest = _sha256_bytes(_canonical_bytes(records))
    manifest = {
        "artifactKind": ARTIFACT_KIND,
        "files": records,
        "payloadDigest": payload_digest,
        "schemaVersion": SCHEMA_VERSION,
        "sourceSha": source_sha,
    }
    manifest_bytes = _canonical_bytes(manifest, newline=True)
    entries = {**payloads, MANIFEST_NAME: manifest_bytes}
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w", format=tarfile.USTAR_FORMAT) as archive:
        for name in sorted(entries):
            payload = entries[name]
            mode = 0o644 if name == MANIFEST_NAME else next(
                spec.mode for spec in PAYLOAD_SPECS if spec.archive_path == name
            )
            archive.addfile(_tar_info(name, len(payload), mode), io.BytesIO(payload))
    artifact_bytes = buffer.getvalue()
    if not 1 <= len(artifact_bytes) <= MAX_ARTIFACT_BYTES:
        raise ArtifactError("distribution artifact exceeds its size bound")
    result = {
        "artifactKind": ARTIFACT_KIND,
        "artifactSha256": _sha256_bytes(artifact_bytes),
        "artifactSize": len(artifact_bytes),
        "fileCount": len(records),
        "manifestPath": MANIFEST_NAME,
        "manifestSha256": _sha256_bytes(manifest_bytes),
        "payloadDigest": payload_digest,
        "schemaVersion": SCHEMA_VERSION,
        "sourceSha": source_sha,
    }
    _atomic_write(output, artifact_bytes)
    _atomic_write(descriptor, _canonical_bytes(result, newline=True))
    return result


def _read_descriptor(path: Path) -> dict[str, Any]:
    try:
        raw = path.read_bytes()
        value = json.loads(raw.decode("utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise ArtifactError("artifact descriptor is malformed") from error
    expected = {
        "artifactKind", "artifactSha256", "artifactSize", "fileCount",
        "manifestPath", "manifestSha256", "payloadDigest", "schemaVersion", "sourceSha",
    }
    if not isinstance(value, dict) or set(value) != expected or raw != _canonical_bytes(value, newline=True):
        raise ArtifactError("artifact descriptor is not canonical schema v1")
    if (
        value["schemaVersion"] != SCHEMA_VERSION
        or value["artifactKind"] != ARTIFACT_KIND
        or value["manifestPath"] != MANIFEST_NAME
        or FULL_SHA_RE.fullmatch(str(value["sourceSha"])) is None
        or SHA256_RE.fullmatch(str(value["artifactSha256"])) is None
        or SHA256_RE.fullmatch(str(value["manifestSha256"])) is None
        or SHA256_RE.fullmatch(str(value["payloadDigest"])) is None
        or isinstance(value["artifactSize"], bool)
        or not isinstance(value["artifactSize"], int)
        or not 1 <= value["artifactSize"] <= MAX_ARTIFACT_BYTES
        or value["fileCount"] != len(_EXPECTED_PAYLOAD_SPECS)
    ):
        raise ArtifactError("artifact descriptor values are invalid")
    return value


def _validate_member(member: tarfile.TarInfo) -> None:
    if (
        not _safe_archive_path(member.name)
        or not member.isreg()
        or member.mtime != 0
        or member.uid != 0
        or member.gid != 0
        or member.uname != ""
        or member.gname != ""
        or stat.S_IMODE(member.mode) not in {0o644, 0o755}
        or not 1 <= member.size <= MAX_FILE_BYTES
    ):
        raise ArtifactError(f"artifact member metadata is unsafe: {member.name}")


def _validate_status_agent(payload: bytes, source_sha: str) -> None:
    try:
        with zipfile.ZipFile(io.BytesIO(payload)) as archive:
            names = archive.namelist()
            if names != sorted(names) or len(names) != len(set(names)):
                raise ArtifactError("embedded status-agent entries are not canonical")
            for entry in archive.infolist():
                if (
                    entry.date_time != ZIP_TIMESTAMP
                    or entry.compress_type != zipfile.ZIP_STORED
                    or entry.create_system != 3
                    or entry.external_attr >> 16 != stat.S_IFREG | 0o644
                ):
                    raise ArtifactError("embedded status-agent metadata is not canonical")
            identity = json.loads(archive.read(STATUS_AGENT_MANIFEST).decode("utf-8"))
    except (KeyError, UnicodeError, ValueError, zipfile.BadZipFile, json.JSONDecodeError) as error:
        raise ArtifactError("embedded status-agent zipapp is malformed") from error
    if identity.get("profile") != "signage" or identity.get("sourceSha") != source_sha:
        raise ArtifactError("embedded status-agent source identity does not match")


def verify_artifact(
    artifact: Path,
    descriptor: Path,
    *,
    expected_source_sha: str | None = None,
) -> dict[str, Any]:
    binding = _read_descriptor(descriptor)
    if expected_source_sha is not None:
        if FULL_SHA_RE.fullmatch(expected_source_sha) is None or binding["sourceSha"] != expected_source_sha:
            raise ArtifactError("artifact source SHA does not match the expected exact source")
    try:
        metadata = artifact.lstat()
    except FileNotFoundError as error:
        raise ArtifactError("distribution artifact is missing") from error
    if not stat.S_ISREG(metadata.st_mode) or artifact.is_symlink():
        raise ArtifactError("distribution artifact must be a regular file")
    if metadata.st_size != binding["artifactSize"] or _sha256_file(artifact) != binding["artifactSha256"]:
        raise ArtifactError("distribution artifact bytes do not match the descriptor")

    try:
        with tarfile.open(artifact, "r:") as archive:
            members = archive.getmembers()
            names = [member.name for member in members]
            if names != sorted(names) or len(names) != len(set(names)) or len(names) != binding["fileCount"] + 1:
                raise ArtifactError("artifact member order or count is invalid")
            payloads: dict[str, bytes] = {}
            for member in members:
                _validate_member(member)
                extracted = archive.extractfile(member)
                if extracted is None:
                    raise ArtifactError("artifact member cannot be read")
                payloads[member.name] = extracted.read()
    except (OSError, tarfile.TarError) as error:
        raise ArtifactError("distribution artifact tar is malformed") from error

    manifest_bytes = payloads.get(MANIFEST_NAME)
    manifest_member = next((item for item in members if item.name == MANIFEST_NAME), None)
    if manifest_member is None or stat.S_IMODE(manifest_member.mode) != 0o644:
        raise ArtifactError("artifact manifest mode is invalid")
    if manifest_bytes is None or _sha256_bytes(manifest_bytes) != binding["manifestSha256"]:
        raise ArtifactError("artifact manifest digest does not match")
    try:
        manifest = json.loads(manifest_bytes.decode("utf-8"))
    except (UnicodeError, json.JSONDecodeError) as error:
        raise ArtifactError("artifact manifest is malformed") from error
    if manifest_bytes != _canonical_bytes(manifest, newline=True) or not isinstance(manifest, dict) or set(manifest) != {
        "artifactKind", "files", "payloadDigest", "schemaVersion", "sourceSha"
    }:
        raise ArtifactError("artifact manifest is not canonical schema v1")
    if (
        manifest["schemaVersion"] != SCHEMA_VERSION
        or manifest["artifactKind"] != ARTIFACT_KIND
        or manifest["sourceSha"] != binding["sourceSha"]
        or manifest["payloadDigest"] != binding["payloadDigest"]
        or not isinstance(manifest["files"], list)
        or len(manifest["files"]) != binding["fileCount"]
        or _sha256_bytes(_canonical_bytes(manifest["files"])) != manifest["payloadDigest"]
    ):
        raise ArtifactError("artifact manifest binding is invalid")

    _validate_specs(PAYLOAD_SPECS)
    expected_by_path = {spec.archive_path: spec for spec in PAYLOAD_SPECS}
    if set(payloads) != {MANIFEST_NAME, *expected_by_path}:
        raise ArtifactError("artifact contains missing or unexpected payloads")
    seen: set[str] = set()
    for record in manifest["files"]:
        if not isinstance(record, dict) or set(record) != {
            "installPath", "kind", "mode", "path", "sha256", "size", "sourcePath", "templated"
        }:
            raise ArtifactError("artifact file record is malformed")
        path = record.get("path")
        if not isinstance(path, str) or path in seen or path not in expected_by_path:
            raise ArtifactError("artifact file path is invalid")
        seen.add(path)
        spec = expected_by_path[path]
        expected_record = {
            "installPath": spec.install_path,
            "kind": spec.kind,
            "mode": f"{spec.mode:04o}",
            "path": spec.archive_path,
            "sha256": _sha256_bytes(payloads[path]),
            "size": len(payloads[path]),
            "sourcePath": spec.source_path,
            "templated": spec.templated,
        }
        if record != expected_record:
            raise ArtifactError(f"artifact payload disagrees with its manifest: {path}")
        member = next(item for item in members if item.name == path)
        if stat.S_IMODE(member.mode) != spec.mode:
            raise ArtifactError(f"artifact payload mode disagrees with its manifest: {path}")
    _validate_status_agent(payloads[_EXPECTED_PAYLOAD_SPECS[0].archive_path], binding["sourceSha"])
    return {"descriptor": binding, "manifest": manifest}


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="action", required=True)
    build = subparsers.add_parser("build")
    build.add_argument("--root", type=Path, default=Path.cwd())
    build.add_argument("--output", type=Path, required=True)
    build.add_argument("--descriptor", type=Path, required=True)
    build.add_argument("--source-sha", required=True)
    for action in ("verify", "inspect"):
        command = subparsers.add_parser(action)
        command.add_argument("--artifact", type=Path, required=True)
        command.add_argument("--descriptor", type=Path, required=True)
        command.add_argument("--expected-source-sha")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        if args.action == "build":
            result = build_artifact(
                args.root,
                args.output,
                args.descriptor,
                source_sha=args.source_sha,
            )
        else:
            verified = verify_artifact(
                args.artifact,
                args.descriptor,
                expected_source_sha=args.expected_source_sha,
            )
            result = verified if args.action == "inspect" else verified["descriptor"]
    except ArtifactError as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 2
    print(json.dumps(result, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
