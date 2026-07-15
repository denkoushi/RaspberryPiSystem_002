#!/usr/bin/env python3
"""Capture and restore fail-closed, per-run terminal rollback payloads.

The helper deliberately has no general-purpose copy or delete interface.
``capture`` records one explicit source/destination pair under a run/host
directory. ``restore`` accepts only that run/host identity and mutates only
the destinations sealed into its manifest.
"""
from __future__ import annotations

import argparse
import fcntl
import hashlib
import hmac
import json
import os
import re
import secrets
import stat
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Mapping


MANIFEST_VERSION = 1
RUN_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{2,79}$")
HOST_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,254}$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
PAYLOAD_RE = re.compile(r"^payload/[0-9]{6}\.bin$")
EMPTY_SHA256 = hashlib.sha256(b"").hexdigest()
MAX_MANIFEST_BYTES = 1024 * 1024
MAX_PAYLOAD_BYTES = 64 * 1024 * 1024
MAX_ENTRIES = 4096
CHUNK_SIZE = 1024 * 1024


class ManifestError(RuntimeError):
    """Raised when capture or restore cannot prove its safety contract."""


@dataclass(frozen=True)
class ManifestContext:
    storage_root: Path
    run_directory: Path
    host_directory: Path
    payload_directory: Path
    manifest_path: Path
    lock_path: Path
    filesystem_root: Path
    run_id: str
    host: str


def _validate_identity(value: str, pattern: re.Pattern[str], label: str) -> str:
    if not isinstance(value, str) or pattern.fullmatch(value) is None:
        raise ManifestError(f"{label} is malformed")
    return value


def _normalise_absolute(value: os.PathLike[str] | str, label: str) -> Path:
    try:
        raw = os.fspath(value)
    except TypeError as error:
        raise ManifestError(f"{label} is malformed") from error
    if not isinstance(raw, str) or not raw or "\x00" in raw:
        raise ManifestError(f"{label} is malformed")
    if not os.path.isabs(raw):
        raise ManifestError(f"{label} must be absolute")
    if ".." in Path(raw).parts:
        raise ManifestError(f"{label} contains traversal")
    normalised = Path(os.path.normpath(raw))
    if not normalised.is_absolute():
        raise ManifestError(f"{label} must remain absolute after normalisation")
    return normalised


def _is_within(path: Path, root: Path) -> bool:
    try:
        return os.path.commonpath((os.fspath(path), os.fspath(root))) == os.fspath(root)
    except ValueError:
        return False


def _lstat(path: Path) -> os.stat_result | None:
    try:
        return path.lstat()
    except FileNotFoundError:
        return None


def _require_secure_directory(path: Path, *, create: bool) -> None:
    if create:
        try:
            path.mkdir(mode=0o700, parents=True, exist_ok=True)
        except FileExistsError as error:
            raise ManifestError(f"secure directory is not a directory: {path}") from error
    metadata = _lstat(path)
    if metadata is None:
        raise ManifestError(f"secure directory is missing: {path}")
    if not stat.S_ISDIR(metadata.st_mode):
        raise ManifestError(f"secure directory is not a real directory: {path}")
    if metadata.st_uid != os.geteuid():
        raise ManifestError(f"secure directory has a different owner: {path}")
    if stat.S_IMODE(metadata.st_mode) & 0o077:
        raise ManifestError(f"secure directory is accessible outside its owner: {path}")


def _build_context(
    *,
    root: os.PathLike[str] | str,
    run_id: str,
    host: str,
    filesystem_root: os.PathLike[str] | str = "/",
    create: bool,
) -> ManifestContext:
    safe_run = _validate_identity(run_id, RUN_ID_RE, "run ID")
    safe_host = _validate_identity(host, HOST_RE, "host")
    storage_root = _normalise_absolute(root, "manifest root")
    managed_root = _normalise_absolute(filesystem_root, "filesystem root")

    managed_metadata = _lstat(managed_root)
    if managed_metadata is None or not stat.S_ISDIR(managed_metadata.st_mode):
        raise ManifestError("filesystem root must be a real existing directory")

    run_directory = storage_root / safe_run
    host_directory = run_directory / safe_host
    payload_directory = host_directory / "payload"
    for path in (run_directory, host_directory, payload_directory):
        if not _is_within(path, storage_root):
            raise ManifestError("run/host storage escaped the manifest root")

    _require_secure_directory(storage_root, create=create)
    _require_secure_directory(run_directory, create=create)
    _require_secure_directory(host_directory, create=create)
    _require_secure_directory(payload_directory, create=create)
    return ManifestContext(
        storage_root=storage_root,
        run_directory=run_directory,
        host_directory=host_directory,
        payload_directory=payload_directory,
        manifest_path=host_directory / "manifest.json",
        lock_path=host_directory / ".lock",
        filesystem_root=managed_root,
        run_id=safe_run,
        host=safe_host,
    )


def _require_parent_within_filesystem(path: Path, context: ManifestContext) -> None:
    parent = path.parent
    metadata = _lstat(parent)
    if metadata is None or not stat.S_ISDIR(metadata.st_mode):
        raise ManifestError(f"managed path parent is not a real directory: {parent}")
    resolved_parent = Path(os.path.realpath(parent))
    resolved_root = Path(os.path.realpath(context.filesystem_root))
    if not _is_within(resolved_parent, resolved_root):
        raise ManifestError(f"managed path parent escapes the filesystem root: {path}")


def _normalise_managed_path(
    value: os.PathLike[str] | str,
    *,
    label: str,
    context: ManifestContext,
    require_parent: bool,
) -> Path:
    path = _normalise_absolute(value, label)
    if path == context.filesystem_root or not _is_within(path, context.filesystem_root):
        raise ManifestError(f"{label} escapes the filesystem root")
    if _is_within(path, context.storage_root):
        raise ManifestError(f"{label} overlaps rollback manifest storage")
    if not path.name:
        raise ManifestError(f"{label} does not name a restorable object")
    if require_parent:
        _require_parent_within_filesystem(path, context)
    return path


class _HostLock:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.descriptor: int | None = None

    def __enter__(self) -> "_HostLock":
        existing = _lstat(self.path)
        if existing is not None and not stat.S_ISREG(existing.st_mode):
            raise ManifestError("rollback manifest lock is not a regular file")
        flags = os.O_RDWR | os.O_CREAT | getattr(os, "O_CLOEXEC", 0)
        flags |= getattr(os, "O_NOFOLLOW", 0)
        descriptor = os.open(self.path, flags, 0o600)
        metadata = os.fstat(descriptor)
        if not stat.S_ISREG(metadata.st_mode):
            os.close(descriptor)
            raise ManifestError("rollback manifest lock is not a regular file")
        if metadata.st_uid != os.geteuid():
            os.close(descriptor)
            raise ManifestError("rollback manifest lock has a different owner")
        if metadata.st_nlink != 1:
            os.close(descriptor)
            raise ManifestError("rollback manifest lock must not have additional hard links")
        os.fchmod(descriptor, 0o600)
        fcntl.flock(descriptor, fcntl.LOCK_EX)
        self.descriptor = descriptor
        return self

    def __exit__(self, *_exc: object) -> None:
        if self.descriptor is None:
            return
        try:
            fcntl.flock(self.descriptor, fcntl.LOCK_UN)
        finally:
            os.close(self.descriptor)
            self.descriptor = None


def _fsync_directory(path: Path) -> None:
    flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_CLOEXEC", 0)
    descriptor = os.open(path, flags)
    try:
        if not stat.S_ISDIR(os.fstat(descriptor).st_mode):
            raise ManifestError(f"cannot sync a non-directory: {path}")
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _secure_file_metadata(path: Path, label: str) -> os.stat_result:
    metadata = _lstat(path)
    if metadata is None:
        raise ManifestError(f"{label} is missing")
    if not stat.S_ISREG(metadata.st_mode):
        raise ManifestError(f"{label} must be a regular file, never a symlink")
    if metadata.st_uid != os.geteuid():
        raise ManifestError(f"{label} has a different owner")
    if stat.S_IMODE(metadata.st_mode) & 0o077:
        raise ManifestError(f"{label} is accessible outside its owner")
    if metadata.st_nlink != 1:
        raise ManifestError(f"{label} must not have additional hard links")
    return metadata


def _read_secure_file(path: Path, *, label: str, maximum: int) -> bytes:
    before = _secure_file_metadata(path, label)
    flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(path, flags)
    try:
        opened = os.fstat(descriptor)
        if (opened.st_dev, opened.st_ino) != (before.st_dev, before.st_ino):
            raise ManifestError(f"{label} changed while opening")
        if (
            not stat.S_ISREG(opened.st_mode)
            or opened.st_uid != os.geteuid()
            or stat.S_IMODE(opened.st_mode) & 0o077
            or opened.st_nlink != 1
        ):
            raise ManifestError(f"{label} became unsafe while opening")
        chunks: list[bytes] = []
        size = 0
        while True:
            chunk = os.read(descriptor, min(CHUNK_SIZE, maximum + 1 - size))
            if not chunk:
                break
            chunks.append(chunk)
            size += len(chunk)
            if size > maximum:
                raise ManifestError(f"{label} exceeds its size limit")
        after = os.fstat(descriptor)
        if (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns) != (
            opened.st_dev,
            opened.st_ino,
            opened.st_size,
            opened.st_mtime_ns,
        ):
            raise ManifestError(f"{label} changed while reading")
        if (
            not stat.S_ISREG(after.st_mode)
            or after.st_uid != os.geteuid()
            or stat.S_IMODE(after.st_mode) & 0o077
            or after.st_nlink != 1
        ):
            raise ManifestError(f"{label} became unsafe while reading")
        return b"".join(chunks)
    finally:
        os.close(descriptor)


def _canonical_json(value: Mapping[str, Any]) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=True,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def _manifest_digest(value: Mapping[str, Any]) -> str:
    core = {key: item for key, item in value.items() if key != "manifestSha256"}
    return hashlib.sha256(_canonical_json(core)).hexdigest()


def _seal_manifest(value: Mapping[str, Any]) -> dict[str, Any]:
    sealed = dict(value)
    sealed["manifestSha256"] = _manifest_digest(sealed)
    return sealed


def _json_object_without_duplicates(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ManifestError(f"manifest contains duplicate JSON key: {key}")
        result[key] = value
    return result


def _decode_manifest(raw: bytes) -> dict[str, Any]:
    try:
        value = json.loads(
            raw.decode("utf-8"), object_pairs_hook=_json_object_without_duplicates
        )
    except ManifestError:
        raise
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ManifestError("manifest JSON is malformed") from error
    if not isinstance(value, dict):
        raise ManifestError("manifest must be a JSON object")
    return value


def _new_manifest(context: ManifestContext) -> dict[str, Any]:
    return {
        "version": MANIFEST_VERSION,
        "runId": context.run_id,
        "host": context.host,
        "filesystemRoot": os.fspath(context.filesystem_root),
        "entries": [],
    }


def _validate_integer(value: Any, label: str, *, maximum: int | None = None) -> int:
    if type(value) is not int or value < 0 or (maximum is not None and value > maximum):
        raise ManifestError(f"{label} is malformed")
    return value


def _validate_symlink_target(
    target: bytes, *, destination_parent: Path, context: ManifestContext
) -> None:
    if not target or b"\x00" in target:
        raise ManifestError("symlink payload is malformed")
    target_text = os.fsdecode(target)
    candidate = (
        Path(os.path.normpath(target_text))
        if os.path.isabs(target_text)
        else Path(os.path.normpath(os.path.join(destination_parent, target_text)))
    )
    resolved_candidate = Path(os.path.realpath(candidate))
    resolved_root = Path(os.path.realpath(context.filesystem_root))
    if (
        not candidate.is_absolute()
        or not _is_within(candidate, context.filesystem_root)
        or not _is_within(resolved_candidate, resolved_root)
    ):
        raise ManifestError("symlink target escapes the filesystem root")


def _validate_entry(
    value: Any, *, index: int, context: ManifestContext
) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ManifestError("manifest entry must be an object")
    expected_keys = {
        "source",
        "destination",
        "previousState",
        "payload",
        "sha256",
        "size",
        "mode",
        "uid",
        "gid",
    }
    if set(value) != expected_keys:
        raise ManifestError("manifest entry fields are malformed")
    source = _normalise_managed_path(
        value.get("source"), label="manifest source", context=context, require_parent=False
    )
    destination = _normalise_managed_path(
        value.get("destination"),
        label="manifest destination",
        context=context,
        require_parent=True,
    )
    if os.fspath(source) != value["source"] or os.fspath(destination) != value["destination"]:
        raise ManifestError("manifest paths are not normalised")
    previous_state = value.get("previousState")
    if previous_state not in {"regular", "symlink", "absent"}:
        raise ManifestError("manifest previous state is malformed")
    checksum = value.get("sha256")
    if not isinstance(checksum, str) or SHA256_RE.fullmatch(checksum) is None:
        raise ManifestError("manifest checksum is malformed")
    size = _validate_integer(value.get("size"), "manifest payload size", maximum=MAX_PAYLOAD_BYTES)
    payload = value.get("payload")
    if previous_state == "absent":
        if payload is not None or checksum != EMPTY_SHA256 or size != 0:
            raise ManifestError("absent entry must not contain a payload")
        if any(value.get(field) is not None for field in ("mode", "uid", "gid")):
            raise ManifestError("absent entry must not contain file metadata")
    else:
        expected_payload = f"payload/{index:06d}.bin"
        if payload != expected_payload or PAYLOAD_RE.fullmatch(payload or "") is None:
            raise ManifestError("manifest payload path is malformed")
        _validate_integer(value.get("mode"), "manifest mode", maximum=0o7777)
        _validate_integer(value.get("uid"), "manifest uid")
        _validate_integer(value.get("gid"), "manifest gid")
    return dict(value)


def _payload_path(context: ManifestContext, relative: str) -> Path:
    candidate = context.host_directory / relative
    if not _is_within(candidate, context.payload_directory):
        raise ManifestError("payload path escaped its run/host directory")
    return candidate


def _validate_payload_directory(
    context: ManifestContext, entries: Iterable[Mapping[str, Any]]
) -> dict[str, bytes]:
    expected: set[str] = set()
    payloads: dict[str, bytes] = {}
    for entry in entries:
        relative = entry.get("payload")
        if relative is None:
            continue
        expected.add(Path(relative).name)
        payload_path = _payload_path(context, relative)
        payload = _read_secure_file(
            payload_path, label=f"rollback payload {relative}", maximum=MAX_PAYLOAD_BYTES
        )
        if len(payload) != entry.get("size"):
            raise ManifestError("rollback payload size does not match its manifest")
        if not hmac.compare_digest(hashlib.sha256(payload).hexdigest(), entry.get("sha256", "")):
            raise ManifestError("rollback payload checksum does not match its manifest")
        if entry.get("previousState") == "symlink":
            _validate_symlink_target(
                payload,
                destination_parent=Path(entry["destination"]).parent,
                context=context,
            )
        payloads[relative] = payload

    actual: set[str] = set()
    for child in context.payload_directory.iterdir():
        actual.add(child.name)
        if child.name not in expected:
            raise ManifestError("rollback payload directory contains an unsealed object")
    if actual != expected:
        raise ManifestError("rollback payload set does not match its manifest")
    return payloads


def _validate_manifest(value: dict[str, Any], context: ManifestContext) -> dict[str, Any]:
    expected_keys = {
        "version",
        "runId",
        "host",
        "filesystemRoot",
        "entries",
        "manifestSha256",
    }
    if set(value) != expected_keys:
        raise ManifestError("manifest fields are malformed")
    if value.get("version") != MANIFEST_VERSION:
        raise ManifestError("manifest version is unsupported")
    if value.get("runId") != context.run_id or value.get("host") != context.host:
        raise ManifestError("manifest identity does not match its run/host path")
    if value.get("filesystemRoot") != os.fspath(context.filesystem_root):
        raise ManifestError("manifest filesystem root does not match the invocation")
    digest = value.get("manifestSha256")
    if not isinstance(digest, str) or SHA256_RE.fullmatch(digest) is None:
        raise ManifestError("manifest integrity checksum is malformed")
    if not hmac.compare_digest(digest, _manifest_digest(value)):
        raise ManifestError("manifest integrity checksum does not match")
    raw_entries = value.get("entries")
    if not isinstance(raw_entries, list) or len(raw_entries) > MAX_ENTRIES:
        raise ManifestError("manifest entries are malformed")
    entries = [
        _validate_entry(entry, index=index, context=context)
        for index, entry in enumerate(raw_entries)
    ]
    destinations: set[str] = set()
    for entry in entries:
        destination = entry["destination"]
        if destination in destinations:
            raise ManifestError("manifest contains a duplicate destination")
        destinations.add(destination)
    _validate_payload_directory(context, entries)
    return {**value, "entries": entries}


def _load_manifest(
    context: ManifestContext, *, required: bool
) -> tuple[dict[str, Any], dict[str, bytes]]:
    metadata = _lstat(context.manifest_path)
    if metadata is None:
        if required:
            raise ManifestError("rollback manifest does not exist")
        if any(context.payload_directory.iterdir()):
            raise ManifestError("rollback payload exists without a manifest")
        return _new_manifest(context), {}
    raw = _read_secure_file(
        context.manifest_path, label="rollback manifest", maximum=MAX_MANIFEST_BYTES
    )
    manifest = _validate_manifest(_decode_manifest(raw), context)
    payloads = _validate_payload_directory(context, manifest["entries"])
    return manifest, payloads


def _atomic_write(path: Path, content: bytes, *, mode: int = 0o600) -> None:
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.", suffix=".tmp", dir=path.parent
    )
    temporary = Path(temporary_name)
    replaced = False
    try:
        os.fchmod(descriptor, mode)
        with os.fdopen(descriptor, "wb", closefd=True) as stream:
            descriptor = -1
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        existing = _lstat(path)
        if existing is not None and not stat.S_ISREG(existing.st_mode):
            raise ManifestError(f"refusing to replace a non-regular secure file: {path}")
        os.replace(temporary, path)
        replaced = True
        _fsync_directory(path.parent)
    finally:
        if descriptor >= 0:
            os.close(descriptor)
        if not replaced:
            try:
                temporary.unlink()
            except FileNotFoundError:
                pass


def _write_manifest(context: ManifestContext, value: Mapping[str, Any]) -> dict[str, Any]:
    sealed = _seal_manifest(value)
    encoded = (
        json.dumps(sealed, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    ).encode("utf-8")
    if len(encoded) > MAX_MANIFEST_BYTES:
        raise ManifestError("rollback manifest exceeds its size limit")
    _atomic_write(context.manifest_path, encoded)
    metadata = _secure_file_metadata(context.manifest_path, "rollback manifest")
    if stat.S_IMODE(metadata.st_mode) != 0o600:
        raise ManifestError("rollback manifest was not persisted with mode 0600")
    return sealed


def _read_source(path: Path, context: ManifestContext) -> tuple[str, bytes | None, dict[str, int | None]]:
    metadata = _lstat(path)
    if metadata is None:
        return "absent", None, {"mode": None, "uid": None, "gid": None}
    common_metadata: dict[str, int | None] = {
        "mode": stat.S_IMODE(metadata.st_mode),
        "uid": metadata.st_uid,
        "gid": metadata.st_gid,
    }
    if stat.S_ISREG(metadata.st_mode):
        payload = _read_regular_source(path, metadata)
        return "regular", payload, common_metadata
    if stat.S_ISLNK(metadata.st_mode):
        before_identity = (metadata.st_dev, metadata.st_ino, metadata.st_ctime_ns)
        payload = os.readlink(os.fsencode(path))
        after = path.lstat()
        if (after.st_dev, after.st_ino, after.st_ctime_ns) != before_identity:
            raise ManifestError("source symlink changed while capturing")
        if len(payload) > MAX_PAYLOAD_BYTES:
            raise ManifestError("source symlink target exceeds its size limit")
        _validate_symlink_target(payload, destination_parent=path.parent, context=context)
        return "symlink", payload, common_metadata
    raise ManifestError("source must be a regular file, symlink, or absent")


def _read_regular_source(path: Path, before: os.stat_result) -> bytes:
    flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(path, flags)
    try:
        opened = os.fstat(descriptor)
        if not stat.S_ISREG(opened.st_mode) or (opened.st_dev, opened.st_ino) != (
            before.st_dev,
            before.st_ino,
        ):
            raise ManifestError("source changed while opening")
        chunks: list[bytes] = []
        size = 0
        while True:
            chunk = os.read(descriptor, min(CHUNK_SIZE, MAX_PAYLOAD_BYTES + 1 - size))
            if not chunk:
                break
            chunks.append(chunk)
            size += len(chunk)
            if size > MAX_PAYLOAD_BYTES:
                raise ManifestError("source exceeds the rollback payload size limit")
        after = os.fstat(descriptor)
        if (after.st_size, after.st_mtime_ns, after.st_ctime_ns) != (
            opened.st_size,
            opened.st_mtime_ns,
            opened.st_ctime_ns,
        ):
            raise ManifestError("source changed while capturing")
        return b"".join(chunks)
    finally:
        os.close(descriptor)


def capture(
    *,
    root: os.PathLike[str] | str,
    run_id: str,
    host: str,
    source: os.PathLike[str] | str,
    destination: os.PathLike[str] | str,
    filesystem_root: os.PathLike[str] | str = "/",
) -> dict[str, Any]:
    context = _build_context(
        root=root,
        run_id=run_id,
        host=host,
        filesystem_root=filesystem_root,
        create=True,
    )
    source_path = _normalise_managed_path(
        source, label="source", context=context, require_parent=True
    )
    destination_path = _normalise_managed_path(
        destination, label="destination", context=context, require_parent=True
    )
    with _HostLock(context.lock_path):
        manifest, _payloads = _load_manifest(context, required=False)
        if any(entry["destination"] == os.fspath(destination_path) for entry in manifest["entries"]):
            raise ManifestError("destination is already sealed into this manifest")
        if len(manifest["entries"]) >= MAX_ENTRIES:
            raise ManifestError("rollback manifest entry limit reached")

        previous_state, payload, metadata = _read_source(source_path, context)
        if previous_state == "symlink" and payload is not None:
            _validate_symlink_target(
                payload,
                destination_parent=destination_path.parent,
                context=context,
            )
        index = len(manifest["entries"])
        relative_payload: str | None = None
        payload_path: Path | None = None
        checksum = EMPTY_SHA256
        size = 0
        if payload is not None:
            relative_payload = f"payload/{index:06d}.bin"
            payload_path = _payload_path(context, relative_payload)
            if _lstat(payload_path) is not None:
                raise ManifestError("rollback payload destination already exists")
            _atomic_write(payload_path, payload)
            payload_metadata = _secure_file_metadata(payload_path, "rollback payload")
            if stat.S_IMODE(payload_metadata.st_mode) != 0o600:
                raise ManifestError("rollback payload was not persisted with mode 0600")
            checksum = hashlib.sha256(payload).hexdigest()
            size = len(payload)

        entry = {
            "source": os.fspath(source_path),
            "destination": os.fspath(destination_path),
            "previousState": previous_state,
            "payload": relative_payload,
            "sha256": checksum,
            "size": size,
            "mode": metadata["mode"],
            "uid": metadata["uid"],
            "gid": metadata["gid"],
        }
        updated = {key: value for key, value in manifest.items() if key != "manifestSha256"}
        updated["entries"] = [*manifest["entries"], entry]
        try:
            sealed_manifest = _write_manifest(context, updated)
        except BaseException:
            if payload_path is not None:
                try:
                    payload_path.unlink()
                    _fsync_directory(context.payload_directory)
                except FileNotFoundError:
                    pass
            raise
        return {
            "captured": True,
            "manifest": os.fspath(context.manifest_path),
            "destination": entry["destination"],
            "previousState": previous_state,
            "sha256": checksum,
            "manifestSha256": sealed_manifest["manifestSha256"],
        }


def _preflight_destinations(entries: Iterable[Mapping[str, Any]], context: ManifestContext) -> None:
    for entry in entries:
        destination = Path(entry["destination"])
        _require_parent_within_filesystem(destination, context)
        metadata = _lstat(destination)
        if metadata is not None and not (
            stat.S_ISREG(metadata.st_mode) or stat.S_ISLNK(metadata.st_mode)
        ):
            raise ManifestError("restore destination became a special file or directory")


def _set_owner_if_needed(path: Path, uid: int, gid: int, *, symlink: bool) -> None:
    metadata = path.lstat() if symlink else path.stat()
    if (metadata.st_uid, metadata.st_gid) == (uid, gid):
        return
    os.chown(path, uid, gid, follow_symlinks=not symlink)


def _restore_regular(entry: Mapping[str, Any], payload: bytes, context: ManifestContext) -> None:
    destination = Path(entry["destination"])
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{destination.name}.rollback.", dir=destination.parent
    )
    temporary = Path(temporary_name)
    replaced = False
    try:
        with os.fdopen(descriptor, "wb", closefd=True) as stream:
            descriptor = -1
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        _set_owner_if_needed(temporary, entry["uid"], entry["gid"], symlink=False)
        os.chmod(temporary, entry["mode"], follow_symlinks=True)
        sync_descriptor = os.open(
            temporary,
            os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0),
        )
        try:
            os.fsync(sync_descriptor)
        finally:
            os.close(sync_descriptor)
        metadata = temporary.stat()
        if (
            not stat.S_ISREG(metadata.st_mode)
            or stat.S_IMODE(metadata.st_mode) != entry["mode"]
            or (metadata.st_uid, metadata.st_gid) != (entry["uid"], entry["gid"])
        ):
            raise ManifestError("temporary regular-file metadata does not match the manifest")
        current = _lstat(destination)
        if current is not None and not (
            stat.S_ISREG(current.st_mode) or stat.S_ISLNK(current.st_mode)
        ):
            raise ManifestError("restore destination became unsafe")
        os.replace(temporary, destination)
        replaced = True
        _fsync_directory(destination.parent)
    finally:
        if descriptor >= 0:
            os.close(descriptor)
        if not replaced:
            try:
                temporary.unlink()
            except FileNotFoundError:
                pass


def _temporary_symlink(destination: Path, target: bytes) -> Path:
    for _attempt in range(128):
        temporary = destination.parent / (
            f".{destination.name}.rollback.{secrets.token_hex(8)}.tmp"
        )
        try:
            os.symlink(target, os.fsencode(temporary))
            return temporary
        except FileExistsError:
            continue
    raise ManifestError("could not allocate an atomic symlink restore path")


def _restore_symlink(entry: Mapping[str, Any], payload: bytes, context: ManifestContext) -> None:
    destination = Path(entry["destination"])
    _validate_symlink_target(payload, destination_parent=destination.parent, context=context)
    temporary = _temporary_symlink(destination, payload)
    replaced = False
    try:
        _set_owner_if_needed(temporary, entry["uid"], entry["gid"], symlink=True)
        metadata = temporary.lstat()
        if (
            not stat.S_ISLNK(metadata.st_mode)
            or stat.S_IMODE(metadata.st_mode) != entry["mode"]
            or (metadata.st_uid, metadata.st_gid) != (entry["uid"], entry["gid"])
            or os.readlink(os.fsencode(temporary)) != payload
        ):
            raise ManifestError("temporary symlink metadata does not match the manifest")
        current = _lstat(destination)
        if current is not None and not (
            stat.S_ISREG(current.st_mode) or stat.S_ISLNK(current.st_mode)
        ):
            raise ManifestError("restore destination became unsafe")
        os.replace(temporary, destination)
        replaced = True
        _fsync_directory(destination.parent)
    finally:
        if not replaced:
            try:
                temporary.unlink()
            except FileNotFoundError:
                pass


def _restore_absent(entry: Mapping[str, Any]) -> None:
    destination = Path(entry["destination"])
    metadata = _lstat(destination)
    if metadata is None:
        return
    if not (stat.S_ISREG(metadata.st_mode) or stat.S_ISLNK(metadata.st_mode)):
        raise ManifestError("absent restore destination became unsafe")
    destination.unlink()
    _fsync_directory(destination.parent)


def _verify_restored_entries(
    entries: Iterable[Mapping[str, Any]], payloads: Mapping[str, bytes]
) -> None:
    """Prove every manifest destination after the restore mutations finish."""

    for entry in entries:
        destination = Path(entry["destination"])
        metadata = _lstat(destination)
        previous_state = entry["previousState"]
        if previous_state == "absent":
            if metadata is not None:
                raise ManifestError("post-restore absent destination still exists")
            continue
        if metadata is None:
            raise ManifestError("post-restore destination is missing")
        if (
            stat.S_IMODE(metadata.st_mode) != entry["mode"]
            or metadata.st_uid != entry["uid"]
            or metadata.st_gid != entry["gid"]
        ):
            raise ManifestError("post-restore destination metadata does not match")
        expected_payload = payloads[entry["payload"]]
        if previous_state == "regular":
            if not stat.S_ISREG(metadata.st_mode):
                raise ManifestError("post-restore destination is not a regular file")
            actual_payload = _read_regular_source(destination, metadata)
        else:
            if not stat.S_ISLNK(metadata.st_mode):
                raise ManifestError("post-restore destination is not a symlink")
            actual_payload = os.readlink(os.fsencode(destination))
        if not hmac.compare_digest(
            hashlib.sha256(actual_payload).hexdigest(), entry["sha256"]
        ) or not hmac.compare_digest(actual_payload, expected_payload):
            raise ManifestError("post-restore destination checksum does not match")


def restore(
    *,
    root: os.PathLike[str] | str,
    run_id: str,
    host: str,
    expected_manifest_sha256: str,
    filesystem_root: os.PathLike[str] | str = "/",
) -> dict[str, Any]:
    if (
        not isinstance(expected_manifest_sha256, str)
        or SHA256_RE.fullmatch(expected_manifest_sha256) is None
    ):
        raise ManifestError("expected manifest checksum is malformed")
    context = _build_context(
        root=root,
        run_id=run_id,
        host=host,
        filesystem_root=filesystem_root,
        create=False,
    )
    with _HostLock(context.lock_path):
        manifest, payloads = _load_manifest(context, required=True)
        if not hmac.compare_digest(
            manifest["manifestSha256"], expected_manifest_sha256
        ):
            raise ManifestError("manifest checksum does not match the expected sealed digest")
        entries = manifest["entries"]
        _preflight_destinations(entries, context)
        for entry in reversed(entries):
            previous_state = entry["previousState"]
            if previous_state == "regular":
                _restore_regular(entry, payloads[entry["payload"]], context)
            elif previous_state == "symlink":
                _restore_symlink(entry, payloads[entry["payload"]], context)
            else:
                _restore_absent(entry)
        _verify_restored_entries(entries, payloads)
        return {
            "restored": True,
            "manifest": os.fspath(context.manifest_path),
            "manifestSha256": manifest["manifestSha256"],
            "count": len(entries),
            "destinations": [entry["destination"] for entry in entries],
        }


def _add_common_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--host", required=True)
    parser.add_argument("--filesystem-root", type=Path, default=Path("/"))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    capture_parser = subparsers.add_parser("capture")
    _add_common_arguments(capture_parser)
    capture_parser.add_argument("--source", type=Path, required=True)
    capture_parser.add_argument("--destination", type=Path, required=True)
    restore_parser = subparsers.add_parser("restore")
    _add_common_arguments(restore_parser)
    restore_parser.add_argument("--expected-manifest-sha256", required=True)
    args = parser.parse_args(argv)
    try:
        if args.command == "capture":
            result = capture(
                root=args.root,
                run_id=args.run_id,
                host=args.host,
                source=args.source,
                destination=args.destination,
                filesystem_root=args.filesystem_root,
            )
        else:
            result = restore(
                root=args.root,
                run_id=args.run_id,
                host=args.host,
                expected_manifest_sha256=args.expected_manifest_sha256,
                filesystem_root=args.filesystem_root,
            )
    except (ManifestError, OSError) as error:
        print(f"rollback manifest failed: {error}", file=sys.stderr)
        return 1
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
