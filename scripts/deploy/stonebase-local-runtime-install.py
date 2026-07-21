#!/usr/bin/env python3
"""Install the pinned StoneBase Ansible runtime behind an atomic symlink."""
from __future__ import annotations

import hashlib
import json
import os
import platform
import shutil
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path
from typing import Any


ROOT = Path("/opt/raspi-local-ansible-runtime")
VERSION = "ansible-core-2.19.4-py3.11"
LOCK = Path("/usr/local/libexec/raspi-local-runtime-lock.json")
REQUIREMENTS = Path(
    "/usr/local/libexec/raspi-local-requirements-aarch64-py311.lock"
)
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
    expected = {"schemaVersion", "platform", "python", "ansibleCore", "collections"}
    if not isinstance(value, dict) or set(value) != expected:
        raise InstallError("runtime lock is malformed")
    collection = value.get("collections", {}).get("community.general")
    if (
        value["schemaVersion"] != 1
        or value["platform"] != "linux-aarch64"
        or value["python"] != "3.11"
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
        and (python.stdout or python.stderr).strip().startswith("Python 3.11.")
        and ansible.returncode == 0
        and "[core 2.19.4]" in ansible.stdout.splitlines()[0]
        and _collection_version(runtime) == "11.4.1"
    )


def _download_collection(destination: Path, metadata: dict[str, str]) -> None:
    request = urllib.request.Request(metadata["source"], headers={"User-Agent": "raspi-runtime-bootstrap/1"})
    digest = hashlib.sha256()
    written = 0
    with urllib.request.urlopen(request, timeout=60) as response, destination.open("wb") as output:
        while True:
            block = response.read(1024 * 1024)
            if not block:
                break
            written += len(block)
            if written > MAX_COLLECTION_BYTES:
                raise InstallError("collection archive exceeds the size bound")
            digest.update(block)
            output.write(block)
    if written == 0 or digest.hexdigest() != metadata["sha256"]:
        raise InstallError("collection archive digest does not match")


def install() -> bool:
    if os.geteuid() != 0 or platform.machine() not in {"aarch64", "arm64"}:
        raise InstallError("runtime installer requires root on aarch64")
    lock = _load_lock()
    if not REQUIREMENTS.is_file():
        raise InstallError("runtime requirements lock is unavailable")
    python = Path("/usr/bin/python3.11")
    if not python.is_file():
        raise InstallError("Python 3.11 is unavailable")
    versions = ROOT / "versions"
    versions.mkdir(mode=0o755, parents=True, exist_ok=True)
    destination = versions / VERSION
    if not _valid(destination):
        temporary = Path(tempfile.mkdtemp(prefix=f".{VERSION}.", dir=versions))
        try:
            if _run([str(python), "-m", "venv", str(temporary)]).returncode != 0:
                raise InstallError("runtime virtual environment creation failed")
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
            archive = temporary / "community-general-11.4.1.tar.gz"
            _download_collection(archive, collection)
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
            if temporary.exists():
                shutil.rmtree(temporary)
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
