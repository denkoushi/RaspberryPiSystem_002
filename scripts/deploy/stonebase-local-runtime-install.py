#!/usr/bin/env python3
"""Install the pinned StoneBase Ansible runtime behind an atomic symlink."""
from __future__ import annotations

import hashlib
import json
import os
import platform
import posixpath
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
from pathlib import Path, PurePosixPath
from typing import Any


ROOT = Path("/opt/raspi-local-ansible-runtime")
VERSION = "cpython-3.11.15-20260510-ansible-core-2.19.4"
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
MAX_PYTHON_ARCHIVE_BYTES = 64 * 1024 * 1024
MAX_PYTHON_EXTRACTED_BYTES = 512 * 1024 * 1024
MAX_PYTHON_ARCHIVE_MEMBERS = 20_000
MAX_COLLECTION_BYTES = 64 * 1024 * 1024


class InstallError(RuntimeError):
    pass


def _run(arguments: list[str], *, cwd: Path | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        arguments,
        cwd=cwd,
        check=False,
        text=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        env={"PATH": "/usr/bin:/bin:/usr/local/bin", "LANG": "C", "LC_ALL": "C"},
    )


def _load_lock() -> dict[str, Any]:
    value = json.loads(LOCK.read_text(encoding="utf-8"))
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
        or not str(collection["source"]).startswith("https://galaxy.ansible.com/")
        or len(str(collection["sha256"])) != 64
    ):
        raise InstallError("runtime lock does not match the supported runtime")
    return value


def _collection_version(runtime: Path) -> str | None:
    completed = subprocess.run(
        [str(runtime / "bin/ansible-galaxy"), "collection", "list", "--format", "json"],
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
    python = subprocess.run(
        [str(runtime / "bin/python3"), "--version"],
        check=False,
        capture_output=True,
        text=True,
        env={"PATH": f"{runtime / 'bin'}:/usr/bin:/bin", "LANG": "C", "LC_ALL": "C"},
    )
    ansible = subprocess.run(
        [str(runtime / "bin/ansible"), "--version"],
        check=False,
        capture_output=True,
        text=True,
        env={"PATH": f"{runtime / 'bin'}:/usr/bin:/bin", "LANG": "C", "LC_ALL": "C"},
    )
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


def install() -> bool:
    if os.geteuid() != 0 or platform.machine() not in {"aarch64", "arm64"}:
        raise InstallError("runtime installer requires root on aarch64")
    lock = _load_lock()
    if not REQUIREMENTS.is_file():
        raise InstallError("runtime requirements lock is unavailable")
    versions = ROOT / "versions"
    versions.mkdir(mode=0o755, parents=True, exist_ok=True)
    destination = versions / VERSION
    if not _valid(destination):
        temporary_root = Path(tempfile.mkdtemp(prefix=f".{VERSION}.", dir=versions))
        try:
            python_archive = temporary_root / "python.tar.gz"
            _download_file(
                python_archive,
                lock["pythonDistribution"],
                maximum_bytes=MAX_PYTHON_ARCHIVE_BYTES,
            )
            extract_root = temporary_root / "extract"
            temporary = _extract_python_distribution(python_archive, extract_root)
            python_archive.unlink()
            if _run(
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
                ]
            ).returncode != 0:
                raise InstallError("hash-locked runtime package installation failed")
            collection = lock["collections"]["community.general"]
            archive = temporary_root / "community-general-11.4.1.tar.gz"
            _download_file(
                archive,
                collection,
                maximum_bytes=MAX_COLLECTION_BYTES,
            )
            if _run(
                [
                    str(temporary / "bin/ansible-galaxy"),
                    "collection",
                    "install",
                    str(archive),
                    "--collections-path",
                    str(temporary / "collections"),
                    "--no-deps",
                ]
            ).returncode != 0:
                raise InstallError("locked collection installation failed")
            archive.unlink()
            if not _valid(temporary):
                raise InstallError("installed runtime did not match the lock")
            if destination.exists():
                raise InstallError("invalid versioned runtime already exists")
            os.replace(temporary, destination)
        finally:
            if temporary_root.exists():
                shutil.rmtree(temporary_root)
    active = ROOT / "active"
    if active.is_symlink() and active.resolve() == destination.resolve():
        return False
    if active.exists() and not active.is_symlink():
        raise InstallError("active runtime path is not a symlink")
    link = ROOT / f".active.{os.getpid()}"
    link.symlink_to(Path("versions") / VERSION)
    os.replace(link, active)
    return True


def main() -> int:
    try:
        changed = install()
    except Exception:
        print("RUNTIME_INSTALL_FAILED", file=sys.stderr)
        return 1
    print("RUNTIME_INSTALL_CHANGED" if changed else "RUNTIME_INSTALL_CURRENT")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
