#!/usr/bin/env python3
"""Install the pinned StoneBase Ansible runtime behind an atomic symlink."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import posixpath
import shutil
import secrets
import stat
import subprocess
import sys
import tarfile
import tempfile
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any


ROOT = Path("/opt/raspi-local-ansible-runtime")
VERSION = "cpython-3.11.15-20260510-ansible-core-2.19.4"
OBSERVATION = Path("/var/lib/raspi-release/local-runtime-bootstrap.json")
LOCK = Path("/usr/local/libexec/raspi-local-runtime-lock.json")
REQUIREMENTS = Path(
    "/usr/local/libexec/raspi-local-requirements-aarch64-py311.lock"
)
CACHE_BASE = Path("/var/cache/raspi-local-ansible-artifacts")
PYTHON_VERSION = "3.11.15"
PYTHON_FILENAME = (
    "cpython-3.11.15+20260510-aarch64-unknown-linux-gnu-install_only.tar.gz"
)
PYTHON_SOURCE = (
    "https://github.com/astral-sh/python-build-standalone/releases/download/"
    "20260510/cpython-3.11.15%2B20260510-aarch64-unknown-linux-gnu-install_only.tar.gz"
)
PYTHON_SHA256 = "0bc1b7acbb888881addf3a1c887a47d510d4300db6e3ad2ba461154b982e456a"
PYTHON_SIZE = 48_884_733
COLLECTION_FILENAME = "community-general-11.4.1.tar.gz"
COLLECTION_SOURCE = (
    "https://galaxy.ansible.com/api/v3/plugin/ansible/content/published/"
    "collections/artifacts/community-general-11.4.1.tar.gz"
)
COLLECTION_SHA256 = "618b2cad75706f2939a5607271bfdcf4a10d3b6f3fe792e1569910c270485399"
COLLECTION_SIZE = 2_701_594
MAX_PYTHON_EXTRACTED_BYTES = 512 * 1024 * 1024
MAX_PYTHON_ARCHIVE_MEMBERS = 20_000
ANSIBLE_LOCALE = "C.UTF-8"


class InstallError(RuntimeError):
    pass


class InstallFailure(InstallError):
    def __init__(self, phase: str, code: str, *, cleanup: str = "complete"):
        super().__init__(f"{phase}:{code}")
        self.phase = phase
        self.code = code
        self.cleanup = cleanup


class Observation:
    def __init__(self, path: Path | None = None):
        self.path = OBSERVATION if path is None else path
        self.attempt_id = secrets.token_hex(16)
        self.lock_sha256: str | None = None

    @staticmethod
    def _utc_now() -> str:
        return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

    def write(
        self,
        *,
        status: str,
        phase: str,
        failure_code: str | None = None,
        cleanup: str = "pending",
    ) -> dict[str, Any]:
        value = {
            "schemaVersion": 1,
            "attemptId": self.attempt_id,
            "status": status,
            "phase": phase,
            "failureCode": failure_code,
            "cleanup": cleanup,
            "runtimeVersion": VERSION,
            "lockSha256": self.lock_sha256,
            "observedAt": self._utc_now(),
        }
        self.path.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
        parent_metadata = os.lstat(self.path.parent)
        if (
            not self.path.parent.is_dir()
            or self.path.parent.is_symlink()
            or parent_metadata.st_uid != os.getuid()
            or stat.S_IMODE(parent_metadata.st_mode) & 0o022
        ):
            raise InstallError("runtime bootstrap observation directory is unsafe")
        temporary = self.path.parent / (
            f".{self.path.name}.{self.attempt_id}.{secrets.token_hex(8)}"
        )
        descriptor = os.open(
            temporary,
            os.O_CREAT | os.O_EXCL | os.O_WRONLY | getattr(os, "O_CLOEXEC", 0),
            0o600,
        )
        try:
            with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
                descriptor = -1
                json.dump(value, stream, ensure_ascii=True, sort_keys=True, separators=(",", ":"))
                stream.write("\n")
                stream.flush()
                os.fsync(stream.fileno())
            temporary.chmod(0o644)
            os.replace(temporary, self.path)
            directory_descriptor = os.open(
                self.path.parent,
                os.O_RDONLY | getattr(os, "O_DIRECTORY", 0),
            )
            try:
                os.fsync(directory_descriptor)
            finally:
                os.close(directory_descriptor)
        finally:
            if descriptor >= 0:
                os.close(descriptor)
            if temporary.exists():
                temporary.unlink()
        return value

    def phase(self, phase: str) -> None:
        self.write(status="running", phase=phase)


def _runtime_environment(
    runtime: Path | None = None, *, collections: bool = False
) -> dict[str, str]:
    path = "/usr/bin:/bin:/usr/local/bin"
    if runtime is not None:
        path = f"{runtime / 'bin'}:{path}"
    environment = {
        "PATH": path,
        "LANG": ANSIBLE_LOCALE,
        "LC_ALL": ANSIBLE_LOCALE,
    }
    if collections:
        if runtime is None:
            raise InstallError("runtime is required for the collection environment")
        environment["ANSIBLE_COLLECTIONS_PATH"] = str(runtime / "collections")
    return environment


def _run(
    arguments: list[str],
    *,
    cwd: Path | None = None,
    runtime: Path | None = None,
    collections: bool = False,
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        arguments,
        cwd=cwd,
        check=False,
        text=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        env=_runtime_environment(runtime, collections=collections),
    )


def _load_lock() -> tuple[dict[str, Any], str]:
    raw = LOCK.read_bytes()
    value = json.loads(raw.decode("utf-8"))
    expected = {
        "schemaVersion",
        "platform",
        "python",
        "pythonDistribution",
        "ansibleCore",
        "pythonPackages",
        "collections",
    }
    if not isinstance(value, dict) or set(value) != expected:
        raise InstallError("runtime lock is malformed")
    python_distribution = value.get("pythonDistribution")
    collection = value.get("collections", {}).get("community.general")
    if (
        value["schemaVersion"] != 3
        or value["platform"] != "linux-aarch64"
        or value["python"] != PYTHON_VERSION
        or not isinstance(python_distribution, dict)
        or set(python_distribution)
        != {"version", "filename", "source", "sha256", "size"}
        or python_distribution["version"] != PYTHON_VERSION
        or python_distribution["filename"] != PYTHON_FILENAME
        or python_distribution["source"] != PYTHON_SOURCE
        or python_distribution["sha256"] != PYTHON_SHA256
        or python_distribution["size"] != PYTHON_SIZE
        or value["ansibleCore"] != "2.19.4"
        or not isinstance(value["pythonPackages"], list)
        or len(value["pythonPackages"]) != 9
        or not isinstance(collection, dict)
        or set(collection) != {"version", "filename", "source", "sha256", "size"}
        or collection["version"] != "11.4.1"
        or collection["filename"] != COLLECTION_FILENAME
        or collection["source"] != COLLECTION_SOURCE
        or collection["sha256"] != COLLECTION_SHA256
        or collection["size"] != COLLECTION_SIZE
    ):
        raise InstallError("runtime lock does not match the supported runtime")
    packages = value["pythonPackages"]
    names: set[str] = set()
    filenames: set[str] = {PYTHON_FILENAME, COLLECTION_FILENAME}
    for package in packages:
        if (
            not isinstance(package, dict)
            or set(package)
            != {"name", "version", "filename", "source", "sha256", "size"}
            or not isinstance(package["name"], str)
            or not package["name"]
            or package["name"] in names
            or not isinstance(package["version"], str)
            or not package["version"]
            or not isinstance(package["filename"], str)
            or not package["filename"].endswith(".whl")
            or "/" in package["filename"]
            or "\\" in package["filename"]
            or package["filename"] in filenames
            or not isinstance(package["source"], str)
            or not package["source"].startswith("https://files.pythonhosted.org/")
            or not isinstance(package["sha256"], str)
            or len(package["sha256"]) != 64
            or any(character not in "0123456789abcdef" for character in package["sha256"])
            or type(package["size"]) is not int
            or package["size"] <= 0
            or package["size"] > 64 * 1024 * 1024
        ):
            raise InstallError("runtime Python package lock is malformed")
        names.add(package["name"])
        filenames.add(package["filename"])
    return value, "sha256:" + hashlib.sha256(raw).hexdigest()


def _collection_version(runtime: Path) -> str | None:
    try:
        completed = subprocess.run(
            [
                str(runtime / "bin/ansible-galaxy"),
                "collection",
                "list",
                "--format",
                "json",
            ],
            check=False,
            capture_output=True,
            text=True,
            env=_runtime_environment(runtime, collections=True),
        )
    except OSError:
        return None
    if completed.returncode != 0:
        return None
    try:
        value = json.loads(completed.stdout)
    except json.JSONDecodeError:
        return None
    if not isinstance(value, dict):
        return None
    for installed in value.values():
        if not isinstance(installed, dict):
            continue
        metadata = installed.get("community.general")
        if isinstance(metadata, dict) and isinstance(metadata.get("version"), str):
            return metadata["version"]
    return None


def _valid(runtime: Path) -> bool:
    if not runtime.is_dir():
        return False
    try:
        python = subprocess.run(
            [str(runtime / "bin/python3"), "--version"],
            check=False,
            capture_output=True,
            text=True,
            env=_runtime_environment(runtime),
        )
        ansible = subprocess.run(
            [str(runtime / "bin/ansible"), "--version"],
            check=False,
            capture_output=True,
            text=True,
            env=_runtime_environment(runtime),
        )
    except OSError:
        return False
    return (
        python.returncode == 0
        and (python.stdout or python.stderr).strip() == f"Python {PYTHON_VERSION}"
        and ansible.returncode == 0
        and "[core 2.19.4]" in ansible.stdout.splitlines()[0]
        and _collection_version(runtime) == "11.4.1"
    )


def _file_digest(path: Path) -> tuple[int, str]:
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as stream:
        while block := stream.read(1024 * 1024):
            size += len(block)
            digest.update(block)
    return size, digest.hexdigest()


def _validated_cache(
    lock: dict[str, Any], lock_sha256: str, cache_root: Path | None
) -> Path:
    expected_root = CACHE_BASE / lock_sha256.removeprefix("sha256:")
    selected = expected_root if cache_root is None else cache_root
    if selected != expected_root:
        raise InstallError("runtime artifact cache identity does not match")
    metadata = os.lstat(selected)
    if (
        not stat.S_ISDIR(metadata.st_mode)
        or stat.S_ISLNK(metadata.st_mode)
        or metadata.st_uid != os.geteuid()
        or stat.S_IMODE(metadata.st_mode) & 0o022
    ):
        raise InstallError("runtime artifact cache is unsafe")
    members = [
        lock["pythonDistribution"],
        *lock["pythonPackages"],
        lock["collections"]["community.general"],
    ]
    expected_names = {member["filename"] for member in members}
    actual_names = {entry.name for entry in selected.iterdir()}
    if actual_names != expected_names:
        raise InstallError("runtime artifact cache membership does not match")
    for member in members:
        path = selected / member["filename"]
        file_metadata = os.lstat(path)
        if (
            not stat.S_ISREG(file_metadata.st_mode)
            or stat.S_ISLNK(file_metadata.st_mode)
            or file_metadata.st_uid != os.geteuid()
            or stat.S_IMODE(file_metadata.st_mode) & 0o022
            or _file_digest(path) != (member["size"], member["sha256"])
        ):
            raise InstallError("runtime artifact cache member does not match")
    return selected


def _safe_archive_path(name: str) -> PurePosixPath:
    if not isinstance(name, str) or not name or "\x00" in name:
        raise InstallError("Python distribution member is malformed")
    normalized = posixpath.normpath(name)
    path = PurePosixPath(normalized)
    if (
        normalized in {"", ".", ".."}
        or path.is_absolute()
        or any(part in {"", ".", ".."} for part in path.parts)
        or not path.parts
        or path.parts[0] != "python"
    ):
        raise InstallError("Python distribution member escaped its root")
    return path


def _safe_link_target(member: tarfile.TarInfo, path: PurePosixPath) -> None:
    if not (member.issym() or member.islnk()):
        return
    raw_target = member.linkname
    if not isinstance(raw_target, str) or not raw_target or "\x00" in raw_target:
        raise InstallError("Python distribution link is malformed")
    combined = raw_target if member.islnk() else str(path.parent / raw_target)
    target = PurePosixPath(posixpath.normpath(combined))
    if (
        target.is_absolute()
        or any(part in {"", ".", ".."} for part in target.parts)
        or not target.parts
        or target.parts[0] != "python"
    ):
        raise InstallError("Python distribution link escaped its root")


def _extract_python_distribution(archive_path: Path, destination: Path) -> Path:
    destination.mkdir(mode=0o700)
    extracted_bytes = 0
    try:
        with tarfile.open(archive_path, mode="r:gz") as archive:
            members = archive.getmembers()
            if not members or len(members) > MAX_PYTHON_ARCHIVE_MEMBERS:
                raise InstallError("Python distribution member count is invalid")
            for member in members:
                path = _safe_archive_path(member.name)
                _safe_link_target(member, path)
                if member.isdev() or member.isfifo():
                    raise InstallError("Python distribution contains a special file")
                if member.isfile():
                    extracted_bytes += member.size
                    if extracted_bytes > MAX_PYTHON_EXTRACTED_BYTES:
                        raise InstallError("Python distribution exceeds the extracted size bound")
            archive.extractall(destination, members=members, filter="data")
    except (OSError, tarfile.TarError) as error:
        raise InstallError("Python distribution is unreadable") from error
    runtime = destination / "python"
    if not runtime.is_dir() or runtime.is_symlink():
        raise InstallError("Python distribution root is unavailable")
    return runtime


def _phase(observation: Observation, phase: str, code: str, action: Any) -> Any:
    observation.phase(phase)
    try:
        return action()
    except InstallFailure:
        raise
    except Exception as error:
        raise InstallFailure(phase, code) from error


def install(observation: Observation, *, cache_root: Path | None = None) -> bool:
    observation.phase("host-preflight")
    if os.geteuid() != 0 or platform.machine() not in {"aarch64", "arm64"}:
        raise InstallFailure("host-preflight", "host-ineligible")
    lock, lock_sha256 = _phase(
        observation, "lock-validate", "lock-invalid", _load_lock
    )
    observation.lock_sha256 = lock_sha256
    if not REQUIREMENTS.is_file():
        raise InstallFailure("lock-validate", "requirements-missing")
    cache = _phase(
        observation,
        "artifact-cache",
        "artifact-cache-invalid",
        lambda: _validated_cache(lock, lock_sha256, cache_root),
    )
    versions = ROOT / "versions"
    _phase(
        observation,
        "staging-prepare",
        "staging-preparation-failed",
        lambda: versions.mkdir(mode=0o755, parents=True, exist_ok=True),
    )
    destination = versions / VERSION
    if not _valid(destination):
        temporary_root = _phase(
            observation,
            "staging-prepare",
            "staging-preparation-failed",
            lambda: Path(tempfile.mkdtemp(prefix=f".{VERSION}.", dir=versions)),
        )
        failure: BaseException | None = None
        try:
            python_archive = cache / lock["pythonDistribution"]["filename"]
            extract_root = temporary_root / "extract"
            temporary = _phase(
                observation,
                "python-extract",
                "python-extract-failed",
                lambda: _extract_python_distribution(python_archive, extract_root),
            )
            observation.phase("python-packages")
            try:
                package_result = _run(
                    [
                        str(temporary / "bin/python3"),
                        "-m",
                        "pip",
                        "install",
                        "--disable-pip-version-check",
                        "--no-input",
                        "--no-index",
                        "--find-links",
                        str(cache),
                        "--only-binary=:all:",
                        "--require-hashes",
                        "-r",
                        str(REQUIREMENTS),
                    ],
                    runtime=temporary,
                )
            except Exception as error:
                raise InstallFailure("python-packages", "python-packages-failed") from error
            if package_result.returncode != 0:
                raise InstallFailure("python-packages", "python-packages-failed")
            collection = lock["collections"]["community.general"]
            archive = cache / collection["filename"]
            observation.phase("collection-install")
            try:
                collection_result = _run(
                    [
                        str(temporary / "bin/ansible-galaxy"),
                        "collection",
                        "install",
                        str(archive),
                        "--collections-path",
                        str(temporary / "collections"),
                        "--no-deps",
                        "--force",
                    ],
                    runtime=temporary,
                    collections=True,
                )
            except Exception as error:
                raise InstallFailure(
                    "collection-install", "collection-install-failed"
                ) from error
            if collection_result.returncode != 0:
                raise InstallFailure(
                    "collection-install", "collection-install-failed"
                )
            observation.phase("runtime-verify")
            if not _valid(temporary):
                raise InstallFailure(
                    "runtime-verify", "runtime-verification-failed"
                )
            observation.phase("runtime-publish")
            if destination.exists():
                raise InstallFailure(
                    "runtime-publish", "runtime-publish-conflict"
                )
            try:
                os.replace(temporary, destination)
            except OSError as error:
                raise InstallFailure(
                    "runtime-publish", "runtime-publish-conflict"
                ) from error
        except BaseException as error:
            failure = error
        if temporary_root.exists():
            observation.phase("cleanup")
            try:
                shutil.rmtree(temporary_root)
            except OSError:
                if isinstance(failure, InstallFailure):
                    failure.cleanup = "failed"
                elif failure is None:
                    failure = InstallFailure(
                        "cleanup", "cleanup-failed", cleanup="failed"
                    )
        if failure is not None:
            raise failure
    observation.phase("active-link")
    active = ROOT / "active"
    link = ROOT / f".active.{observation.attempt_id}.{secrets.token_hex(8)}"
    try:
        if active.is_symlink() and active.resolve() == destination.resolve():
            return False
        if active.exists() and not active.is_symlink():
            raise InstallFailure("active-link", "active-link-failed")
        link.symlink_to(Path("versions") / VERSION)
        os.replace(link, active)
    except InstallFailure:
        raise
    except OSError as error:
        if link.is_symlink():
            link.unlink()
        raise InstallFailure("active-link", "active-link-failed") from error
    return True


def _validated_observation(path: Path | None = None) -> dict[str, Any]:
    try:
        from raspi_local_execution import validate_runtime_bootstrap_observation
    except ModuleNotFoundError:
        try:
            from rolling_release.local_execution import (
                validate_runtime_bootstrap_observation,
            )
        except ModuleNotFoundError:
            from scripts.deploy.rolling_release.local_execution import (
                validate_runtime_bootstrap_observation,
            )

    path = OBSERVATION if path is None else path
    metadata = os.lstat(path)
    if (
        not stat.S_ISREG(metadata.st_mode)
        or stat.S_ISLNK(metadata.st_mode)
        or metadata.st_uid != os.getuid()
        or stat.S_IMODE(metadata.st_mode) not in {0o600, 0o644}
        or metadata.st_size > 4096
    ):
        raise InstallError("runtime bootstrap observation is unavailable")
    return validate_runtime_bootstrap_observation(
        json.loads(path.read_text(encoding="utf-8"))
    )


def _marker(value: dict[str, Any]) -> str:
    failure = value["failureCode"] or "none"
    lock_sha = value["lockSha256"] or "none"
    return ":".join(
        (
            "RUNTIME_INSTALL_OBSERVATION",
            value["status"],
            value["phase"],
            failure,
            value["cleanup"],
            value["attemptId"],
            lock_sha,
        )
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("action", nargs="?", choices=("install", "status"), default="install")
    parser.add_argument("--cache-root", type=Path)
    args = parser.parse_args(argv)
    if args.action == "status":
        try:
            print(_marker(_validated_observation()))
        except Exception:
            print("RUNTIME_INSTALL_OBSERVATION:unavailable")
            return 1
        return 0

    observation = Observation()
    try:
        observation.phase("initializing")
        changed = install(observation, cache_root=args.cache_root)
        observation.write(
            status="changed" if changed else "current",
            phase="complete",
            cleanup="complete",
        )
    except InstallFailure as error:
        try:
            observation.write(
                status="failed",
                phase=error.phase,
                failure_code=error.code,
                cleanup=error.cleanup,
            )
        except Exception:
            print("RUNTIME_INSTALL_FAILED:observation-unavailable", file=sys.stderr)
            return 1
        print(f"RUNTIME_INSTALL_FAILED:{error.code}", file=sys.stderr)
        return 1
    except Exception:
        try:
            observation.write(
                status="failed",
                phase="internal",
                failure_code="internal-error",
                cleanup="failed",
            )
        except Exception:
            pass
        print("RUNTIME_INSTALL_FAILED:internal-error", file=sys.stderr)
        return 1
    print("RUNTIME_INSTALL_CHANGED" if changed else "RUNTIME_INSTALL_CURRENT")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
