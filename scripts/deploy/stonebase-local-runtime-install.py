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
import urllib.request
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
PYTHON_VERSION = "3.11.15"
PYTHON_SOURCE = (
    "https://github.com/astral-sh/python-build-standalone/releases/download/"
    "20260510/cpython-3.11.15%2B20260510-aarch64-unknown-linux-gnu-install_only.tar.gz"
)
PYTHON_SHA256 = "0bc1b7acbb888881addf3a1c887a47d510d4300db6e3ad2ba461154b982e456a"
COLLECTION_SOURCE = (
    "https://galaxy.ansible.com/api/v3/plugin/ansible/content/published/"
    "collections/artifacts/community-general-11.4.1.tar.gz"
)
COLLECTION_SHA256 = "618b2cad75706f2939a5607271bfdcf4a10d3b6f3fe792e1569910c270485399"
MAX_PYTHON_ARCHIVE_BYTES = 64 * 1024 * 1024
MAX_PYTHON_EXTRACTED_BYTES = 512 * 1024 * 1024
MAX_PYTHON_ARCHIVE_MEMBERS = 20_000
MAX_COLLECTION_BYTES = 64 * 1024 * 1024
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
        "collections",
    }
    if not isinstance(value, dict) or set(value) != expected:
        raise InstallError("runtime lock is malformed")
    python_distribution = value.get("pythonDistribution")
    collection = value.get("collections", {}).get("community.general")
    if (
        value["schemaVersion"] != 2
        or value["platform"] != "linux-aarch64"
        or value["python"] != PYTHON_VERSION
        or not isinstance(python_distribution, dict)
        or set(python_distribution) != {"version", "source", "sha256"}
        or python_distribution["version"] != PYTHON_VERSION
        or python_distribution["source"] != PYTHON_SOURCE
        or python_distribution["sha256"] != PYTHON_SHA256
        or value["ansibleCore"] != "2.19.4"
        or not isinstance(collection, dict)
        or set(collection) != {"version", "source", "sha256"}
        or collection["version"] != "11.4.1"
        or collection["source"] != COLLECTION_SOURCE
        or collection["sha256"] != COLLECTION_SHA256
    ):
        raise InstallError("runtime lock does not match the supported runtime")
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


def _download_file(
    destination: Path,
    metadata: dict[str, str],
    *,
    maximum_bytes: int,
) -> None:
    request = urllib.request.Request(
        metadata["source"], headers={"User-Agent": "raspi-runtime-bootstrap/1"}
    )
    digest = hashlib.sha256()
    written = 0
    with urllib.request.urlopen(request, timeout=60) as response, destination.open("wb") as output:
        while True:
            block = response.read(1024 * 1024)
            if not block:
                break
            written += len(block)
            if written > maximum_bytes:
                raise InstallError("runtime dependency exceeds the size bound")
            digest.update(block)
            output.write(block)
    if written == 0 or digest.hexdigest() != metadata["sha256"]:
        raise InstallError("runtime dependency digest does not match")


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


def install(observation: Observation) -> bool:
    observation.phase("host-preflight")
    if os.geteuid() != 0 or platform.machine() not in {"aarch64", "arm64"}:
        raise InstallFailure("host-preflight", "host-ineligible")
    lock, lock_sha256 = _phase(
        observation, "lock-validate", "lock-invalid", _load_lock
    )
    observation.lock_sha256 = lock_sha256
    if not REQUIREMENTS.is_file():
        raise InstallFailure("lock-validate", "requirements-missing")
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
            python_archive = temporary_root / "python.tar.gz"
            _phase(
                observation,
                "python-download",
                "python-download-failed",
                lambda: _download_file(
                    python_archive,
                    lock["pythonDistribution"],
                    maximum_bytes=MAX_PYTHON_ARCHIVE_BYTES,
                ),
            )
            extract_root = temporary_root / "extract"
            temporary = _phase(
                observation,
                "python-extract",
                "python-extract-failed",
                lambda: _extract_python_distribution(python_archive, extract_root),
            )
            try:
                python_archive.unlink()
            except OSError:
                pass
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
            archive = temporary_root / "community-general-11.4.1.tar.gz"
            _phase(
                observation,
                "collection-download",
                "collection-download-failed",
                lambda: _download_file(
                    archive,
                    collection,
                    maximum_bytes=MAX_COLLECTION_BYTES,
                ),
            )
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
            try:
                archive.unlink()
            except OSError:
                pass
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
        changed = install(observation)
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
