"""Resolve the approved GitHub CLI used by controller-side attestation checks."""

from __future__ import annotations

import hashlib
import hmac
import platform
import re
import shutil
import subprocess
import tempfile
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import NamedTuple
from urllib import request as urllib_request
from zipfile import ZipFile


SHA256 = re.compile(r"^[0-9a-f]{64}$")
VERSION = re.compile(r"^[0-9]+\.[0-9]+\.[0-9]+$")
REQUIRED_ATTESTATION_OPTIONS = (
    "--bundle-from-oci",
    "--deny-self-hosted-runners",
    "--source-digest",
    "--source-ref",
)
ASSET_URL = (
    "https://github.com/cli/cli/releases/download/v{version}/"
    "gh_{version}_macOS_arm64.zip"
)


class GitHubVerifierConfig(NamedTuple):
    version: str
    linux_arm64_sha256: str
    macos_arm64_sha256: str


def _config_value(document: str, key: str) -> str:
    match = re.search(
        rf"(?m)^\s*{re.escape(key)}:\s*(?:\"([^\"]+)\"|'([^']+)'|([^#\s]+))\s*(?:#.*)?$",
        document,
    )
    if not match:
        raise RuntimeError(f"release artifact configuration is missing {key}")
    return next(value for value in match.groups() if value is not None)


def read_config(config_path: Path) -> GitHubVerifierConfig:
    """Read the shared Ansible verifier pins without adding a YAML dependency."""
    document = config_path.read_text(encoding="utf-8")
    version = _config_value(document, "pi5_artifact_gh_version")
    linux_sha256 = _config_value(document, "pi5_artifact_gh_arm64_sha256")
    macos_sha256 = _config_value(document, "pi5_artifact_gh_macos_arm64_sha256")
    if not VERSION.fullmatch(version):
        raise RuntimeError("pinned GitHub attestation verifier version is malformed")
    if not SHA256.fullmatch(linux_sha256):
        raise RuntimeError("pinned Linux ARM64 GitHub verifier checksum is malformed")
    if not SHA256.fullmatch(macos_sha256):
        raise RuntimeError("pinned macOS ARM64 GitHub verifier checksum is malformed")
    return GitHubVerifierConfig(version, linux_sha256, macos_sha256)


def _version_matches(
    result: subprocess.CompletedProcess[str], expected: str
) -> bool:
    first_line = result.stdout.splitlines()[0] if result.stdout else ""
    match = re.match(r"^gh version ([0-9]+\.[0-9]+\.[0-9]+)(?:\s|$)", first_line)
    return result.returncode == 0 and bool(match) and match.group(1) == expected


def _validate(
    gh: str,
    environment: dict[str, str],
    config: GitHubVerifierConfig,
    runner: Callable[..., subprocess.CompletedProcess[str]],
    *,
    require_capability: bool,
    source: str,
) -> None:
    version = runner([gh, "--version"], env=environment, check=False)
    if not _version_matches(version, config.version):
        raise RuntimeError(
            f"{source} GitHub attestation verifier is not the pinned "
            f"{config.version} release"
        )
    if not require_capability:
        return
    capability = runner(
        [gh, "attestation", "verify", "--help"],
        env=environment,
        check=False,
    )
    help_text = f"{capability.stdout}\n{capability.stderr}"
    if capability.returncode != 0 or any(
        option not in help_text for option in REQUIRED_ATTESTATION_OPTIONS
    ):
        raise RuntimeError(
            f"{source} GitHub CLI cannot enforce the release attestation policy"
        )


def _download(url: str, destination: Path) -> None:
    with urllib_request.urlopen(url, timeout=30) as response, destination.open(
        "wb"
    ) as output:
        while chunk := response.read(1024 * 1024):
            output.write(chunk)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _extract(archive: Path, directory: Path, version: str) -> Path:
    expected_member = f"gh_{version}_macOS_arm64/bin/gh"
    with ZipFile(archive) as package:
        members = [
            member
            for member in package.infolist()
            if member.filename == expected_member and not member.is_dir()
        ]
        if len(members) != 1:
            raise RuntimeError("official macOS ARM64 GitHub CLI archive is malformed")
        binary = directory / "gh"
        with package.open(members[0]) as source, binary.open("wb") as output:
            for chunk in iter(lambda: source.read(1024 * 1024), b""):
                output.write(chunk)
    binary.chmod(0o700)
    return binary


def _macos_arm64() -> bool:
    return platform.system() == "Darwin" and platform.machine() == "arm64"


@contextmanager
def resolve_attestation_verifier(
    environment: dict[str, str],
    config_path: Path,
    *,
    runner: Callable[..., subprocess.CompletedProcess[str]],
    which: Callable[[str], str | None] | None = None,
) -> Iterator[str]:
    """Yield an approved gh path, bootstrapping only on Apple Silicon macOS."""
    which = which or shutil.which
    config = read_config(config_path)
    existing = which("gh")
    if not _macos_arm64():
        if existing is None:
            raise RuntimeError("GitHub attestation verifier is unavailable")
        _validate(
            existing,
            environment,
            config,
            runner,
            require_capability=False,
            source="GitHub",
        )
        yield existing
        return
    if existing is not None:
        try:
            _validate(
                existing,
                environment,
                config,
                runner,
                require_capability=True,
                source="PATH",
            )
        except (OSError, RuntimeError):
            existing = None
        else:
            yield existing
            return
    with tempfile.TemporaryDirectory(prefix="standard-release-gh-") as directory:
        temporary = Path(directory)
        archive = temporary / f"gh_{config.version}_macOS_arm64.zip"
        _download(ASSET_URL.format(version=config.version), archive)
        if not hmac.compare_digest(_sha256(archive), config.macos_arm64_sha256):
            raise RuntimeError(
                "downloaded macOS ARM64 GitHub CLI checksum does not match the "
                "repository pin"
            )
        downloaded = _extract(archive, temporary, config.version)
        _validate(
            str(downloaded),
            environment,
            config,
            runner,
            require_capability=True,
            source="downloaded",
        )
        yield str(downloaded)
