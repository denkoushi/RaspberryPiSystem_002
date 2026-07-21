"""Prefetch the exact StoneBase Local runtime before terminal maintenance."""
from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import stat
import time
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Callable, Mapping


LOCK_RELATIVE = Path(
    "infrastructure/ansible/files/stonebase-local-ansible/runtime-lock.json"
)
REQUIREMENTS_RELATIVE = LOCK_RELATIVE.parent / "requirements-aarch64-py311.lock"
DEFAULT_CACHE_ROOT = Path("/var/cache/raspi-release/local-runtime-artifacts")
MAX_MEMBER_BYTES = 64 * 1024 * 1024
MAX_TOTAL_BYTES = 128 * 1024 * 1024
ALLOWED_SOURCE_HOSTS = frozenset(
    {"github.com", "files.pythonhosted.org", "galaxy.ansible.com"}
)
_SHA256 = frozenset("0123456789abcdef")
_REQUIREMENT = re.compile(
    r"^([A-Za-z0-9_.-]+)==([A-Za-z0-9_.+-]+) "
    r"--hash=sha256:([0-9a-f]{64})$"
)
_SAFE_FILENAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._+-]{0,199}$")
_SAFE_PACKAGE_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")


class RuntimeArtifactError(RuntimeError):
    """A bounded, secret-free runtime artifact preparation failure."""


def _canonical_json(value: Any) -> bytes:
    return json.dumps(
        value, ensure_ascii=True, sort_keys=True, separators=(",", ":")
    ).encode("ascii")


def _digest(path: Path) -> tuple[int, str]:
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as stream:
        while block := stream.read(1024 * 1024):
            size += len(block)
            digest.update(block)
    return size, digest.hexdigest()


def _safe_directory(path: Path, *, create: bool = False) -> None:
    if create:
        path.mkdir(mode=0o755, parents=True, exist_ok=True)
    metadata = os.lstat(path)
    if (
        not stat.S_ISDIR(metadata.st_mode)
        or stat.S_ISLNK(metadata.st_mode)
        or metadata.st_uid != os.geteuid()
        or stat.S_IMODE(metadata.st_mode) & 0o022
    ):
        raise RuntimeArtifactError("runtime artifact cache directory is unsafe")


def _member(identifier: str, value: Any) -> dict[str, Any]:
    expected = {"version", "filename", "source", "sha256", "size"}
    if not isinstance(value, Mapping) or set(value) != expected:
        raise RuntimeArtifactError(f"runtime artifact lock member is invalid: {identifier}")
    filename = value.get("filename")
    version = value.get("version")
    source = value.get("source")
    digest = value.get("sha256")
    size = value.get("size")
    parsed = urllib.parse.urlparse(source) if isinstance(source, str) else None
    if (
        not isinstance(filename, str)
        or _SAFE_FILENAME.fullmatch(filename) is None
        or not isinstance(version, str)
        or not version
        or parsed is None
        or parsed.scheme != "https"
        or parsed.hostname not in ALLOWED_SOURCE_HOSTS
        or parsed.username is not None
        or parsed.password is not None
        or not isinstance(digest, str)
        or len(digest) != 64
        or any(character not in _SHA256 for character in digest)
        or type(size) is not int
        or size <= 0
        or size > MAX_MEMBER_BYTES
    ):
        raise RuntimeArtifactError(f"runtime artifact lock member is invalid: {identifier}")
    return {
        "id": identifier,
        "filename": filename,
        "source": source,
        "sha256": digest,
        "size": size,
    }


def load_runtime_artifact_lock(project: Path) -> tuple[dict[str, Any], str, list[dict[str, Any]]]:
    path = project / LOCK_RELATIVE
    if not path.is_file() or path.is_symlink():
        raise RuntimeArtifactError("runtime artifact lock is unavailable")
    raw = path.read_bytes()
    try:
        lock = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise RuntimeArtifactError("runtime artifact lock is malformed") from error
    expected = {
        "schemaVersion",
        "platform",
        "python",
        "pythonDistribution",
        "ansibleCore",
        "pythonPackages",
        "collections",
    }
    if (
        not isinstance(lock, dict)
        or set(lock) != expected
        or lock.get("schemaVersion") != 3
        or lock.get("platform") != "linux-aarch64"
        or lock.get("python") != "3.11.15"
        or lock.get("ansibleCore") != "2.19.4"
        or not isinstance(lock.get("pythonPackages"), list)
        or len(lock["pythonPackages"]) != 9
        or not isinstance(lock.get("collections"), dict)
        or set(lock["collections"]) != {"community.general"}
    ):
        raise RuntimeArtifactError("runtime artifact lock is unsupported")
    members = [_member("python-distribution", lock["pythonDistribution"])]
    if lock["pythonDistribution"].get("version") != lock["python"]:
        raise RuntimeArtifactError("runtime Python distribution version is invalid")
    package_names: set[str] = set()
    for index, package in enumerate(lock["pythonPackages"]):
        if not isinstance(package, Mapping) or set(package) != {
            "name", "version", "filename", "source", "sha256", "size"
        }:
            raise RuntimeArtifactError("runtime Python package lock is invalid")
        name = package.get("name")
        if (
            not isinstance(name, str)
            or _SAFE_PACKAGE_NAME.fullmatch(name) is None
            or name in package_names
        ):
            raise RuntimeArtifactError("runtime Python package lock is invalid")
        package_names.add(name)
        members.append(_member(f"python-package:{index}:{name}", {
            key: package[key] for key in ("version", "filename", "source", "sha256", "size")
        }))
    requirements_path = project / REQUIREMENTS_RELATIVE
    if not requirements_path.is_file() or requirements_path.is_symlink():
        raise RuntimeArtifactError("runtime Python requirements lock is unavailable")
    requirements: set[tuple[str, str, str]] = set()
    for line in requirements_path.read_text(encoding="utf-8").splitlines():
        match = _REQUIREMENT.fullmatch(line)
        if match is None:
            raise RuntimeArtifactError("runtime Python requirements lock is malformed")
        requirements.add(
            (
                match.group(1).lower().replace("_", "-"),
                match.group(2),
                match.group(3),
            )
        )
    package_requirements = {
        (
            str(package["name"]).lower().replace("_", "-"),
            str(package["version"]),
            str(package["sha256"]),
        )
        for package in lock["pythonPackages"]
    }
    if requirements != package_requirements:
        raise RuntimeArtifactError(
            "runtime Python requirements and artifact lock do not match"
        )
    collection = lock["collections"]["community.general"]
    if not isinstance(collection, Mapping) or collection.get("version") != "11.4.1":
        raise RuntimeArtifactError("runtime collection version is invalid")
    members.append(_member("collection:community.general", collection))
    filenames = {member["filename"] for member in members}
    if (
        len(filenames) != len(members)
        or sum(member["size"] for member in members) > MAX_TOTAL_BYTES
    ):
        raise RuntimeArtifactError("runtime artifact lock size or membership is invalid")
    return lock, "sha256:" + hashlib.sha256(raw).hexdigest(), members


def _valid_file(path: Path, member: Mapping[str, Any]) -> bool:
    try:
        metadata = os.lstat(path)
        if (
            not stat.S_ISREG(metadata.st_mode)
            or stat.S_ISLNK(metadata.st_mode)
            or metadata.st_uid != os.geteuid()
            or stat.S_IMODE(metadata.st_mode) & 0o022
            or metadata.st_size != member["size"]
        ):
            return False
        return _digest(path) == (member["size"], member["sha256"])
    except OSError:
        return False


def _download(
    destination: Path,
    member: Mapping[str, Any],
    *,
    opener: Callable[..., Any],
) -> None:
    temporary = destination.parent / (
        f".{destination.name}.{os.getpid()}.{secrets.token_hex(8)}.partial"
    )
    descriptor = os.open(
        temporary,
        os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_CLOEXEC", 0),
        0o600,
    )
    try:
        digest = hashlib.sha256()
        written = 0
        request = urllib.request.Request(
            member["source"], headers={"User-Agent": "raspi-runtime-prefetch/1"}
        )
        with opener(request, timeout=60) as response, os.fdopen(descriptor, "wb") as output:
            descriptor = -1
            while block := response.read(1024 * 1024):
                written += len(block)
                if written > member["size"] or written > MAX_MEMBER_BYTES:
                    raise RuntimeArtifactError("runtime artifact exceeds its fixed size")
                digest.update(block)
                output.write(block)
            output.flush()
            os.fsync(output.fileno())
        if written != member["size"] or digest.hexdigest() != member["sha256"]:
            raise RuntimeArtifactError("runtime artifact digest or size does not match")
        temporary.chmod(0o644)
        os.replace(temporary, destination)
        directory_descriptor = os.open(
            destination.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0)
        )
        try:
            os.fsync(directory_descriptor)
        finally:
            os.close(directory_descriptor)
    finally:
        if descriptor >= 0:
            os.close(descriptor)
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass


def prefetch_runtime_artifacts(
    project: Path,
    *,
    cache_root: Path = DEFAULT_CACHE_ROOT,
    opener: Callable[..., Any] = urllib.request.urlopen,
    retries: int = 3,
) -> dict[str, Any]:
    """Return a private Ansible vars path and a bounded durable receipt."""

    if retries < 1 or retries > 3:
        raise ValueError("runtime artifact retry bound is invalid")
    _lock, lock_sha256, members = load_runtime_artifact_lock(project)
    cache_key = lock_sha256.removeprefix("sha256:")
    _safe_directory(cache_root, create=True)
    cache = cache_root / cache_key
    _safe_directory(cache, create=True)
    downloaded = 0
    hits = 0
    for member in members:
        destination = cache / member["filename"]
        if _valid_file(destination, member):
            hits += 1
            continue
        try:
            metadata = os.lstat(destination)
        except FileNotFoundError:
            metadata = None
        if metadata is not None:
            if (
                not stat.S_ISREG(metadata.st_mode)
                or stat.S_ISLNK(metadata.st_mode)
                or metadata.st_uid != os.geteuid()
                or stat.S_IMODE(metadata.st_mode) & 0o022
            ):
                raise RuntimeArtifactError(
                    f"runtime artifact cache member is unsafe: {member['id']}"
                )
            destination.unlink()
        last_error: Exception | None = None
        for attempt in range(retries):
            try:
                _download(destination, member, opener=opener)
                last_error = None
                break
            except Exception as error:
                last_error = error
                if attempt + 1 < retries:
                    time.sleep(1 << attempt)
        if last_error is not None or not _valid_file(destination, member):
            raise RuntimeArtifactError(
                f"runtime artifact prefetch failed: {member['id']}"
            ) from last_error
        downloaded += 1

    allowed = {member["filename"] for member in members}
    actual = {entry.name for entry in cache.iterdir() if entry.name != "ansible-vars.json"}
    if actual != allowed:
        raise RuntimeArtifactError("runtime artifact cache contains unexpected members")
    ansible_members = [
        {
            "id": member["id"],
            "filename": member["filename"],
            "sourcePath": str(cache / member["filename"]),
            "sha256": member["sha256"],
            "size": member["size"],
        }
        for member in members
    ]
    variable = {
        "stonebase_local_runtime_cache": {
            "schemaVersion": 1,
            "cacheKey": cache_key,
            "lockSha256": lock_sha256,
            "members": ansible_members,
        }
    }
    encoded = _canonical_json(variable) + b"\n"
    manifest_sha256 = "sha256:" + hashlib.sha256(encoded).hexdigest()
    manifest_path = cache / "ansible-vars.json"
    temporary_manifest = cache / f".ansible-vars.{secrets.token_hex(8)}.partial"
    descriptor = os.open(
        temporary_manifest,
        os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_CLOEXEC", 0),
        0o600,
    )
    try:
        with os.fdopen(descriptor, "wb") as stream:
            descriptor = -1
            stream.write(encoded)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary_manifest, manifest_path)
        directory_descriptor = os.open(
            cache, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0)
        )
        try:
            os.fsync(directory_descriptor)
        finally:
            os.close(directory_descriptor)
    finally:
        if descriptor >= 0:
            os.close(descriptor)
        try:
            temporary_manifest.unlink()
        except FileNotFoundError:
            pass
    receipt = {
        "schemaVersion": 1,
        "state": "ready",
        "lockSha256": lock_sha256,
        "manifestSha256": manifest_sha256,
        "memberCount": len(members),
        "totalBytes": sum(member["size"] for member in members),
        "cacheHits": hits,
        "downloaded": downloaded,
    }
    return {"receipt": receipt, "ansibleVarsPath": str(manifest_path)}
