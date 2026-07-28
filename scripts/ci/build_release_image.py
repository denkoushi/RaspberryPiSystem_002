#!/usr/bin/env python3
"""Build one exact ARM64 release image from a sealed build contract."""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Sequence

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.deploy.release_build_contract import (
    BuildContractError,
    build_config_hash,
    parse_contract_json,
)


CONFIG_HASH_RE = re.compile(r"^[0-9a-f]{64}$")
OCI_REPOSITORY_RE = re.compile(
    r"^ghcr\.io/[a-z0-9](?:[a-z0-9_.-]{0,99})/"
    r"[a-z0-9](?:[a-z0-9_.-]{0,199})$"
)
SERVICE_DOCKERFILES = {
    "api": "infrastructure/docker/Dockerfile.api",
    "web": "infrastructure/docker/Dockerfile.web",
}
SERVICE_REPOSITORIES = {
    "api": "ghcr.io/denkoushi/raspisys-api",
    "web": "ghcr.io/denkoushi/raspisys-web",
}
MAX_METADATA_BYTES = 1024 * 1024


class ReleaseImageBuildError(ValueError):
    pass


def build_command(
    *,
    root: Path,
    contract_path: Path,
    service: str,
    release_sha: str,
    expected_config_hash: str,
    repository: str,
    metadata_path: Path,
) -> list[str]:
    try:
        contract = parse_contract_json(
            contract_path.read_text(encoding="utf-8"), release_sha
        )
    except (OSError, UnicodeError, BuildContractError) as error:
        raise ReleaseImageBuildError("sealed build contract is unavailable") from error
    observed_hash = build_config_hash(contract)
    if (
        CONFIG_HASH_RE.fullmatch(expected_config_hash) is None
        or observed_hash != expected_config_hash
    ):
        raise ReleaseImageBuildError("sealed build contract hash does not match")
    if service not in SERVICE_DOCKERFILES:
        raise ReleaseImageBuildError("release image service is unsupported")
    if (
        OCI_REPOSITORY_RE.fullmatch(repository) is None
        or repository != SERVICE_REPOSITORIES[service]
    ):
        raise ReleaseImageBuildError("release image repository is not allowlisted")
    if not root.is_dir() or root.is_symlink():
        raise ReleaseImageBuildError("repository root is malformed")
    dockerfile = root / SERVICE_DOCKERFILES[service]
    if not dockerfile.is_file() or dockerfile.is_symlink():
        raise ReleaseImageBuildError("release Dockerfile is unavailable")
    if not metadata_path.is_absolute() or "\x00" in str(metadata_path):
        raise ReleaseImageBuildError("Buildx metadata path is malformed")

    tag = f"{repository}:{release_sha}-{expected_config_hash[:16]}"
    command = [
        "docker",
        "buildx",
        "build",
        "--platform",
        "linux/arm64",
        "--file",
        str(dockerfile),
        "--tag",
        tag,
        "--push",
        "--provenance=mode=min",
        "--sbom=true",
        "--cache-from",
        f"type=gha,scope=release-{service}-arm64",
        "--cache-to",
        f"type=gha,mode=max,scope=release-{service}-arm64",
        "--metadata-file",
        str(metadata_path),
        "--build-arg",
        f"BUILD_COMMIT={release_sha}",
        "--build-arg",
        f"BUILD_CONFIG_HASH={expected_config_hash}",
    ]
    for key, value in contract.service_arguments(service).items():
        command.extend(("--build-arg", f"{key}={value}"))
    command.append(str(root))
    return command


def read_built_digest(metadata_path: Path) -> str:
    try:
        if metadata_path.stat().st_size > MAX_METADATA_BYTES:
            raise ReleaseImageBuildError("Buildx metadata exceeds its size limit")
        document = json.loads(metadata_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise ReleaseImageBuildError("Buildx metadata is unavailable") from error
    digest = (
        document.get("containerimage.digest") if isinstance(document, dict) else None
    )
    if not isinstance(digest, str) or re.fullmatch(r"sha256:[0-9a-f]{64}", digest) is None:
        raise ReleaseImageBuildError("Buildx did not report an immutable image digest")
    return digest


def _parse_args(argv: Sequence[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument("--contract", type=Path, required=True)
    parser.add_argument("--service", choices=tuple(SERVICE_DOCKERFILES), required=True)
    parser.add_argument("--sha", required=True)
    parser.add_argument("--config-hash", required=True)
    parser.add_argument("--repository", required=True)
    parser.add_argument("--metadata-file", type=Path, required=True)
    parser.add_argument("--print-command-json", action="store_true")
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = _parse_args(argv if argv is not None else sys.argv[1:])
    command = build_command(
        root=args.root.resolve(),
        contract_path=args.contract.resolve(),
        service=args.service,
        release_sha=args.sha,
        expected_config_hash=args.config_hash,
        repository=args.repository,
        metadata_path=args.metadata_file,
    )
    if args.print_command_json:
        json.dump(command, sys.stdout, separators=(",", ":"))
        sys.stdout.write("\n")
        return 0
    environment = os.environ.copy()
    subprocess.run(command, cwd=args.root, env=environment, check=True)
    sys.stdout.write(read_built_digest(args.metadata_file) + "\n")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ReleaseImageBuildError, subprocess.CalledProcessError) as error:
        print(f"release image build failed: {error}", file=sys.stderr)
        raise SystemExit(1) from error
