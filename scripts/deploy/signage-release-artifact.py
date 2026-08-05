#!/usr/bin/env python3
"""Build and locally apply one sealed, profile-owned Pi3 signage artifact."""
from __future__ import annotations

import argparse
import ast
import base64
import hashlib
import io
import json
import os
import re
import runpy
import shutil
import stat
import sys
import tempfile
import zipfile
from pathlib import Path
from types import SimpleNamespace
from typing import Any, NamedTuple


FULL_SHA_RE = re.compile(r"^[0-9a-f]{40}$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
RUN_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{2,79}$")
HOST_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,254}$")
PROFILE_RE = re.compile(r"^[a-z][a-z0-9-]{0,62}$")
REPOSITORY_PREFIX = "/opt/RaspberryPiSystem_002/"
INSTALL_PATH = Path("/usr/local/bin/raspi-signage-status-agent.pyz")
MANIFEST_NAME = "SIGNAGE-RELEASE.json"
MAX_ARTIFACT_BYTES = 1024 * 1024
MAX_SOURCE_PATHS = 32
MAX_SOURCE_BYTES = 512 * 1024
MIN_FREE_SPACE_BYTES = 4 * 1024 * 1024
MARKER_PREFIX = "SIGNAGE_RELEASE_ARTIFACT_RESULT:"
HASH_CHUNK_BYTES = 1024 * 1024
ZIP_TIMESTAMP = (1980, 1, 1, 0, 0, 0)
ZIPAPP_SHEBANG = b"#!/usr/bin/env python3\n"
MIN_PYTHON = (3, 10)


class ArtifactError(RuntimeError):
    """The artifact cannot be proven safe and exact."""


class ProfileClosure(NamedTuple):
    runtime_sources: tuple[str, ...]
    unit_sources: tuple[str, ...]


def _regular_source(root: Path, relative: str) -> Path:
    if not relative or relative.startswith("/") or ".." in Path(relative).parts:
        raise ArtifactError("artifact source path is malformed")
    source = root / relative
    try:
        metadata = source.lstat()
    except FileNotFoundError as error:
        raise ArtifactError("artifact source is missing") from error
    if not stat.S_ISREG(metadata.st_mode) or source.resolve() != source:
        raise ArtifactError("artifact source must be a repository regular file")
    if metadata.st_size > MAX_SOURCE_BYTES:
        raise ArtifactError("artifact source exceeds its fixed size bound")
    return source


def _profile_units(root: Path, profile_id: str) -> tuple[str, ...]:
    if PROFILE_RE.fullmatch(profile_id) is None:
        raise ArtifactError("artifact profile is malformed")
    registry_path = _regular_source(
        root, "scripts/deploy/terminal-profile-registry.json"
    )
    try:
        registry = json.loads(registry_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise ArtifactError("terminal profile registry is malformed") from error
    profiles = registry.get("terminalProfiles") if isinstance(registry, dict) else None
    matches = [
        value for value in profiles or []
        if isinstance(value, dict) and value.get("id") == profile_id
    ]
    if len(matches) != 1:
        raise ArtifactError("artifact profile is unavailable")
    options = matches[0].get("adapterOptions")
    units = options.get("systemdUnits") if isinstance(options, dict) else None
    if not isinstance(units, list) or any(not isinstance(unit, str) for unit in units):
        raise ArtifactError("artifact profile systemd contract is malformed")
    selected = tuple(sorted(unit for unit in units if unit.startswith("status-agent.")))
    if selected != ("status-agent.service", "status-agent.timer"):
        raise ArtifactError("signage status-agent unit contract is incomplete")
    return selected


def _entrypoint_from_service(root: Path, relative: str) -> str:
    service = _regular_source(root, relative).read_text(encoding="utf-8")
    commands = [line[10:].strip() for line in service.splitlines() if line.startswith("ExecStart=")]
    if len(commands) != 1:
        raise ArtifactError("status-agent service entrypoint is ambiguous")
    tokens = commands[0].split()
    candidates = [token for token in tokens if token.startswith(REPOSITORY_PREFIX)]
    if len(candidates) != 1:
        raise ArtifactError("status-agent service repository entrypoint is unavailable")
    return candidates[0][len(REPOSITORY_PREFIX):]


def _local_module(root: Path, name: str) -> str | None:
    if not name or "." in name:
        return None
    candidates = []
    for candidate in root.rglob(f"{name}.py"):
        relative = candidate.relative_to(root)
        if "tests" in relative.parts or "__pycache__" in relative.parts:
            continue
        if candidate.is_symlink() or not candidate.is_file():
            raise ArtifactError("local Python dependency is not a regular file")
        candidates.append(relative.as_posix())
    if not candidates:
        return None
    if len(candidates) != 1:
        raise ArtifactError("local Python dependency is ambiguous")
    return candidates[0]


def _python_imports(root: Path, relative: str) -> tuple[str, ...]:
    source = _regular_source(root, relative)
    try:
        tree = ast.parse(source.read_text(encoding="utf-8"), filename=relative)
    except (OSError, UnicodeError, SyntaxError) as error:
        raise ArtifactError("artifact Python source is malformed") from error
    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            target = node.func
            if (
                isinstance(target, ast.Name)
                and target.id in {"__import__", "import_module"}
            ) or (
                isinstance(target, ast.Attribute)
                and target.attr == "import_module"
            ):
                raise ArtifactError("dynamic Python imports are forbidden")
    names: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names.extend(alias.name.split(".", 1)[0] for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            if node.level:
                raise ArtifactError("relative Python imports are unsupported")
            if node.module:
                names.append(node.module.split(".", 1)[0])
    result: list[str] = []
    stdlib = getattr(sys, "stdlib_module_names", frozenset())
    for name in sorted(set(names)):
        if name in stdlib:
            continue
        local = _local_module(root, name)
        if local is not None:
            result.append(local)
        else:
            raise ArtifactError("unknown or third-party Python dependency is forbidden")
    return tuple(result)


def derive_profile_closure(root: Path, *, profile_id: str) -> ProfileClosure:
    root = root.resolve(strict=True)
    units = _profile_units(root, profile_id)
    unit_sources = tuple(f"clients/status-agent/{unit}" for unit in units)
    for relative in unit_sources:
        _regular_source(root, relative)
    entrypoint = _entrypoint_from_service(root, unit_sources[0])
    pending = [entrypoint]
    runtime: set[str] = set()
    while pending:
        relative = pending.pop()
        if relative in runtime:
            continue
        if len(runtime) >= MAX_SOURCE_PATHS:
            raise ArtifactError("artifact source count exceeds its fixed bound")
        runtime.add(relative)
        pending.extend(_python_imports(root, relative))
    forbidden = ("apps/", "packages/", "infrastructure/docker/", "clients/nfc-agent/", "clients/barcode-agent/", "clients/torque-agent/")
    if any(path.startswith(forbidden) for path in runtime):
        raise ArtifactError("artifact closure crosses the signage profile boundary")
    return ProfileClosure(tuple(sorted(runtime)), tuple(sorted(unit_sources)))


def _sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(HASH_CHUNK_BYTES):
            digest.update(chunk)
    return digest.hexdigest()


def _module_name(relative: str) -> str:
    name = Path(relative).stem.replace("-", "_")
    if not name.isidentifier():
        raise ArtifactError("artifact module name is malformed")
    return name + ".py"


def _zip_entry(archive: zipfile.ZipFile, name: str, payload: bytes, mode: int = 0o644) -> None:
    if not name or name.startswith("/") or ".." in Path(name).parts:
        raise ArtifactError("artifact archive path is malformed")
    info = zipfile.ZipInfo(name, ZIP_TIMESTAMP)
    info.create_system = 3
    info.external_attr = (stat.S_IFREG | mode) << 16
    info.compress_type = zipfile.ZIP_DEFLATED
    archive.writestr(info, payload)


def build_artifact(root: Path, output: Path, *, candidate_sha: str, profile_id: str) -> dict[str, Any]:
    if FULL_SHA_RE.fullmatch(candidate_sha) is None:
        raise ArtifactError("candidate SHA is malformed")
    closure = derive_profile_closure(root, profile_id=profile_id)
    sources = []
    for relative in closure.runtime_sources:
        payload = _regular_source(root, relative).read_bytes()
        sources.append({"path": relative, "sha256": _sha256_bytes(payload), "size": len(payload)})
    path_manifest = json.dumps(sources, sort_keys=True, separators=(",", ":")).encode("utf-8")
    manifest = {
        "schemaVersion": 1,
        "profile": profile_id,
        "sourceSha": candidate_sha,
        "installPath": INSTALL_PATH.as_posix(),
        "pathCount": len(sources),
        "pathManifestSha256": _sha256_bytes(path_manifest),
        "pythonRequires": ">=3.10",
        "sources": sources,
    }
    main = (
        "import json,runpy,sys,zipfile\n"
        f"M={MANIFEST_NAME!r}\n"
        "if len(sys.argv)==2 and sys.argv[1]=='--release-identity':\n"
        " z=zipfile.ZipFile(sys.argv[0]); print(z.read(M).decode('utf-8')); raise SystemExit(0)\n"
        "runpy.run_module('status_agent',run_name='__main__')\n"
    ).encode("utf-8")
    encoded_manifest = json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode("utf-8")
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", allowZip64=False) as archive:
        _zip_entry(archive, "__main__.py", main)
        _zip_entry(archive, MANIFEST_NAME, encoded_manifest)
        for relative in closure.runtime_sources:
            _zip_entry(archive, _module_name(relative), _regular_source(root, relative).read_bytes())
    payload = ZIPAPP_SHEBANG + buffer.getvalue()
    if not 1 <= len(payload) <= MAX_ARTIFACT_BYTES:
        raise ArtifactError("artifact size exceeds its fixed bound")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(payload)
    return {
        "schemaVersion": 1,
        "profile": profile_id,
        "sourceSha": candidate_sha,
        "artifactSha256": _sha256_bytes(payload),
        "pathManifestSha256": manifest["pathManifestSha256"],
        "pathCount": manifest["pathCount"],
        "size": len(payload),
        "installPath": INSTALL_PATH.as_posix(),
    }


def staging_paths(root: Path, run_id: str) -> tuple[Path, Path]:
    if RUN_ID_RE.fullmatch(run_id) is None:
        raise ArtifactError("run ID is malformed")
    final = root / f"raspi-pi3-signage-{run_id}.pyz"
    return root / f"{final.name}.tmp", final


def bound_arguments(reference: dict[str, Any], *, staging_root: Path = Path("/var/tmp"), install_path: Path = INSTALL_PATH) -> SimpleNamespace:
    return SimpleNamespace(**reference, staging_root=staging_root, install_path=install_path)


def _validate_args(args: Any) -> tuple[Path, Path]:
    required = ("schemaVersion", "profile", "sourceSha", "artifactSha256", "pathManifestSha256", "pathCount", "size", "installPath", "runId", "host")
    if any(not hasattr(args, key) for key in required):
        raise ArtifactError("artifact binding is incomplete")
    if args.schemaVersion != 1 or args.profile != "signage":
        raise ArtifactError("artifact profile binding is invalid")
    if FULL_SHA_RE.fullmatch(args.sourceSha) is None or SHA256_RE.fullmatch(args.artifactSha256) is None or SHA256_RE.fullmatch(args.pathManifestSha256) is None:
        raise ArtifactError("artifact digest binding is malformed")
    if HOST_RE.fullmatch(args.host) is None or not 1 <= args.pathCount <= MAX_SOURCE_PATHS:
        raise ArtifactError("artifact host or path-count binding is malformed")
    if not 1 <= args.size <= MAX_ARTIFACT_BYTES:
        raise ArtifactError("artifact size binding is malformed")
    if args.installPath != INSTALL_PATH.as_posix() and Path(args.installPath) != args.install_path:
        raise ArtifactError("artifact install path binding is invalid")
    root = Path(args.staging_root)
    metadata = root.lstat()
    if not root.is_absolute() or not stat.S_ISDIR(metadata.st_mode) or root.resolve() != root:
        raise ArtifactError("artifact staging root is unsafe")
    install_parent = Path(args.install_path).parent
    try:
        install_metadata = install_parent.lstat()
    except FileNotFoundError as error:
        raise ArtifactError("artifact install parent is unavailable") from error
    if (
        not install_parent.is_absolute()
        or not stat.S_ISDIR(install_metadata.st_mode)
        or install_parent.resolve() != install_parent
    ):
        raise ArtifactError("artifact install parent is unsafe")
    return staging_paths(root, args.runId)


def _manifest(path: Path) -> dict[str, Any]:
    try:
        with zipfile.ZipFile(path) as archive:
            names = archive.namelist()
            if len(names) != len(set(names)) or any(name.startswith("/") or ".." in Path(name).parts for name in names):
                raise ArtifactError("artifact archive paths are unsafe")
            if len(names) > MAX_SOURCE_PATHS + 2:
                raise ArtifactError("artifact archive entry count exceeds its bound")
            for entry in archive.infolist():
                entry_mode = entry.external_attr >> 16
                if not stat.S_ISREG(entry_mode) or entry.file_size > MAX_SOURCE_BYTES:
                    raise ArtifactError("artifact archive entry is unsafe")
            raw = archive.read(MANIFEST_NAME)
            value = json.loads(raw.decode("utf-8"))
            if not isinstance(value, dict) or set(value) != {
                "schemaVersion", "profile", "sourceSha", "installPath",
                "pathCount", "pathManifestSha256", "pythonRequires", "sources",
            }:
                raise ArtifactError("artifact manifest fields are malformed")
            sources = value.get("sources")
            if (
                not isinstance(sources, list)
                or len(sources) != value.get("pathCount")
                or not 1 <= len(sources) <= MAX_SOURCE_PATHS
            ):
                raise ArtifactError("artifact path manifest count is malformed")
            seen: set[str] = set()
            expected_entries = {"__main__.py", MANIFEST_NAME}
            for source in sources:
                if not isinstance(source, dict) or set(source) != {"path", "sha256", "size"}:
                    raise ArtifactError("artifact source record is malformed")
                relative = source.get("path")
                if (
                    not isinstance(relative, str)
                    or not relative.endswith(".py")
                    or relative.startswith("/")
                    or ".." in Path(relative).parts
                    or relative in seen
                    or SHA256_RE.fullmatch(str(source.get("sha256") or "")) is None
                    or isinstance(source.get("size"), bool)
                    or not isinstance(source.get("size"), int)
                    or not 0 <= source["size"] <= MAX_SOURCE_BYTES
                ):
                    raise ArtifactError("artifact source record is unsafe")
                seen.add(relative)
                entry_name = _module_name(relative)
                payload = archive.read(entry_name)
                if len(payload) != source["size"] or _sha256_bytes(payload) != source["sha256"]:
                    raise ArtifactError("artifact source bytes disagree with the manifest")
                expected_entries.add(entry_name)
            encoded_sources = json.dumps(
                sources, sort_keys=True, separators=(",", ":")
            ).encode("utf-8")
            if _sha256_bytes(encoded_sources) != value.get("pathManifestSha256"):
                raise ArtifactError("artifact path manifest digest is invalid")
            if set(names) != expected_entries:
                raise ArtifactError("artifact archive contains unexpected entries")
    except (OSError, UnicodeError, KeyError, ValueError, zipfile.BadZipFile, json.JSONDecodeError) as error:
        raise ArtifactError("artifact archive is malformed") from error
    return value


def _require_artifact(
    path: Path, args: Any, *, mode: int, require_owner: bool = False
) -> dict[str, Any]:
    metadata = path.lstat()
    if not stat.S_ISREG(metadata.st_mode) or stat.S_IMODE(metadata.st_mode) != mode:
        raise ArtifactError("artifact must be a regular file with the sealed mode")
    if require_owner and metadata.st_uid != os.geteuid():
        raise ArtifactError("artifact staging owner is invalid")
    if metadata.st_size != args.size or _sha256_file(path) != args.artifactSha256:
        raise ArtifactError("artifact bytes do not match the sealed digest")
    manifest = _manifest(path)
    expected = {
        "schemaVersion": 1,
        "profile": args.profile,
        "sourceSha": args.sourceSha,
        "installPath": INSTALL_PATH.as_posix(),
        "pathCount": args.pathCount,
        "pathManifestSha256": args.pathManifestSha256,
        "pythonRequires": ">=3.10",
    }
    if any(manifest.get(key) != value for key, value in expected.items()):
        raise ArtifactError("artifact manifest does not match its binding")
    return manifest


def _result(args: Any, state: str, **values: Any) -> dict[str, Any]:
    return {key: getattr(args, key) for key in ("schemaVersion", "profile", "sourceSha", "artifactSha256", "pathManifestSha256", "pathCount", "size", "installPath", "runId", "host")} | {"state": state, **values}


def preflight(args: Any) -> dict[str, Any]:
    if sys.version_info < MIN_PYTHON:
        raise ArtifactError("Python >=3.10 is required by the signage artifact")
    temporary, final = _validate_args(args)
    available = os.statvfs(temporary.parent).f_bavail * os.statvfs(temporary.parent).f_frsize
    if available < max(MIN_FREE_SPACE_BYTES, args.size * 3):
        raise ArtifactError("artifact staging capacity is insufficient")
    install_parent = Path(args.install_path).parent
    install_stats = os.statvfs(install_parent)
    install_available = install_stats.f_bavail * install_stats.f_frsize
    if install_available < max(MIN_FREE_SPACE_BYTES, args.size * 2):
        raise ArtifactError("artifact install capacity is insufficient")
    existing = [path for path in (temporary, final) if path.exists() or path.is_symlink()]
    if len(existing) > 1:
        raise ArtifactError("artifact staging residue is ambiguous")
    if existing:
        _require_artifact(existing[0], args, mode=0o600, require_owner=True)
    state = "empty" if not existing else ("temporary-ready" if existing[0] == temporary else "ready")
    return _result(args, state)


def promote(args: Any) -> dict[str, Any]:
    temporary, final = _validate_args(args)
    if final.exists() and not temporary.exists():
        _require_artifact(final, args, mode=0o600, require_owner=True)
        return _result(args, "ready", alreadyReady=True)
    if final.exists() or final.is_symlink():
        raise ArtifactError("artifact final staging path is occupied")
    _require_artifact(temporary, args, mode=0o600, require_owner=True)
    os.replace(temporary, final)
    _fsync_directory(final.parent)
    _require_artifact(final, args, mode=0o600, require_owner=True)
    return _result(args, "ready", alreadyReady=False)


def verify(args: Any) -> dict[str, Any]:
    _temporary, final = _validate_args(args)
    _require_artifact(final, args, mode=0o600, require_owner=True)
    return _result(args, "ready")


def _fsync_directory(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def consume(args: Any) -> dict[str, Any]:
    _temporary, final = _validate_args(args)
    _require_artifact(final, args, mode=0o600)
    install = Path(args.install_path)
    if not install.is_absolute() or ".." in install.parts:
        raise ArtifactError("artifact install path is unsafe")
    parent = install.parent
    if not parent.is_dir() or parent.is_symlink():
        raise ArtifactError("artifact install parent is unsafe")
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{install.name}.", dir=parent)
    temporary = Path(temporary_name)
    replaced = False
    try:
        with os.fdopen(descriptor, "wb") as output, final.open("rb") as source:
            shutil.copyfileobj(source, output, HASH_CHUNK_BYTES)
            output.flush()
            os.fsync(output.fileno())
        temporary.chmod(0o755)
        if _sha256_file(temporary) != args.artifactSha256:
            raise ArtifactError("installed artifact copy digest changed")
        os.replace(temporary, install)
        replaced = True
        _fsync_directory(parent)
    finally:
        if not replaced:
            temporary.unlink(missing_ok=True)
    _require_artifact(install, args, mode=0o755)
    final.unlink()
    _fsync_directory(final.parent)
    return _result(args, "consumed", residue=False)


def installed_identity(path: Path = INSTALL_PATH) -> dict[str, str]:
    metadata = path.lstat()
    if not stat.S_ISREG(metadata.st_mode) or metadata.st_size > MAX_ARTIFACT_BYTES:
        raise ArtifactError("installed signage artifact is unsafe")
    manifest = _manifest(path)
    source = manifest.get("sourceSha")
    if FULL_SHA_RE.fullmatch(source or "") is None or manifest.get("profile") != "signage":
        raise ArtifactError("installed signage artifact identity is malformed")
    if (
        manifest.get("schemaVersion") != 1
        or manifest.get("installPath") != INSTALL_PATH.as_posix()
        or manifest.get("pythonRequires") != ">=3.10"
    ):
        raise ArtifactError("installed signage artifact contract is malformed")
    digest = _sha256_file(path)
    return {
        "sourceSha": source,
        "artifactSha256": digest,
        "identity": f"git:{source}@sha256:{digest}",
    }


def baseline(path: Path = INSTALL_PATH) -> dict[str, Any]:
    try:
        path.lstat()
    except FileNotFoundError:
        return {"schemaVersion": 1, "state": "absent", "profile": "signage"}
    return {"schemaVersion": 1, "state": "installed", "profile": "signage", **installed_identity(path)}


def cleanup(args: Any) -> dict[str, Any]:
    temporary, final = _validate_args(args)
    removed = 0
    for path in (temporary, final):
        try:
            metadata = path.lstat()
        except FileNotFoundError:
            continue
        if not stat.S_ISREG(metadata.st_mode):
            raise ArtifactError("artifact cleanup refuses a non-regular file")
        path.unlink()
        removed += 1
    _fsync_directory(temporary.parent)
    return _result(args, "clean", removed=removed, residue=False)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "action",
        choices=("baseline", "preflight", "promote", "verify", "consume", "cleanup"),
    )
    parser.add_argument("--install-path", type=Path, default=INSTALL_PATH)
    parser.add_argument("--staging-root", type=Path, default=Path("/var/tmp"))
    parser.add_argument("--schema-version", type=int, default=1)
    parser.add_argument("--profile", default="signage")
    parser.add_argument("--source-sha")
    parser.add_argument("--artifact-sha256")
    parser.add_argument("--path-manifest-sha256")
    parser.add_argument("--path-count", type=int)
    parser.add_argument("--size", type=int)
    parser.add_argument("--run-id")
    parser.add_argument("--host")
    parser.add_argument("--ansible-marker", action="store_true")
    args = parser.parse_args(argv)
    try:
        if args.action == "baseline":
            result = baseline(args.install_path)
        else:
            args.schemaVersion = args.schema_version
            args.sourceSha = args.source_sha
            args.artifactSha256 = args.artifact_sha256
            args.pathManifestSha256 = args.path_manifest_sha256
            args.pathCount = args.path_count
            args.installPath = INSTALL_PATH.as_posix()
            result = {
                "preflight": preflight,
                "promote": promote,
                "verify": verify,
                "consume": consume,
                "cleanup": cleanup,
            }[args.action](args)
        encoded = json.dumps(result, sort_keys=True, separators=(",", ":"))
        if args.ansible_marker:
            print(MARKER_PREFIX + base64.urlsafe_b64encode(encoded.encode("utf-8")).decode("ascii"))
        else:
            print(encoded)
    except (ArtifactError, OSError) as error:
        print(f"signage release artifact failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
