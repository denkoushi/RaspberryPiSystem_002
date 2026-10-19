#!/usr/bin/env python3
"""Canonical non-secret Docker build contract shared by CI and Pi5.

The module is deliberately independent from Docker, GitHub, Ansible, and the
filesystem. Adapters may feed it a rendered Compose document, but only the
explicit build argument allow-list can cross this boundary.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from dataclasses import dataclass
from typing import Any, Mapping, Sequence

try:
    from .production_config_contract import WEB_IMAGE_ARGUMENT_KEYS
except ImportError:  # direct script execution from scripts/deploy
    from production_config_contract import WEB_IMAGE_ARGUMENT_KEYS


FULL_SHA_RE = re.compile(r"^[0-9a-f]{40}$")
API_BUILD_ARGUMENT_KEYS = ("INSTALL_PLAYWRIGHT_CHROMIUM",)
WEB_BUILD_ARGUMENT_KEYS = WEB_IMAGE_ARGUMENT_KEYS
SERVICE_KEYS = {
    "api": API_BUILD_ARGUMENT_KEYS,
    "web": WEB_BUILD_ARGUMENT_KEYS,
}
MAX_ARGUMENT_BYTES = 4096


class BuildContractError(ValueError):
    """The rendered build input is not the exact non-secret release contract."""


def _strict_object(items: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in items:
        if key in result:
            raise BuildContractError(f"duplicate JSON key: {key}")
        result[key] = value
    return result


def _validate_release_sha(release_sha: object) -> str:
    if not isinstance(release_sha, str) or FULL_SHA_RE.fullmatch(release_sha) is None:
        raise BuildContractError("release SHA must be 40 lowercase hexadecimal characters")
    return release_sha


def _normalize_service(
    service: str,
    arguments: Mapping[str, object],
) -> tuple[tuple[str, str], ...]:
    expected = SERVICE_KEYS[service]
    if set(arguments) != set(expected):
        raise BuildContractError(
            f"{service} build arguments differ from the exact allow-list"
        )
    normalized: list[tuple[str, str]] = []
    for key in expected:
        value = arguments[key]
        if (
            not isinstance(value, str)
            or "\x00" in value
            or "\r" in value
            or "\n" in value
            or len(value.encode("utf-8")) > MAX_ARGUMENT_BYTES
        ):
            raise BuildContractError(f"{service} build argument {key} is malformed")
        normalized.append((key, value))
    return tuple(normalized)


@dataclass(frozen=True)
class BuildContract:
    """An immutable, canonical API/Web build-argument pair."""

    release_sha: str
    api: tuple[tuple[str, str], ...]
    web: tuple[tuple[str, str], ...]

    def service_arguments(self, service: str) -> dict[str, str]:
        if service == "api":
            return dict(self.api)
        if service == "web":
            return dict(self.web)
        raise BuildContractError(f"unknown service: {service}")

    def as_document(self) -> dict[str, dict[str, str]]:
        return {
            "api": self.service_arguments("api"),
            "web": self.service_arguments("web"),
        }


def normalize_build_arguments(
    api: Mapping[str, object],
    web: Mapping[str, object],
    release_sha: str,
) -> BuildContract:
    """Validate and normalize the exact API/Web release build arguments."""

    validated_sha = _validate_release_sha(release_sha)
    normalized_api = _normalize_service("api", api)
    normalized_web = _normalize_service("web", web)
    if dict(normalized_web)["VITE_RELEASE_SHA"] != validated_sha:
        raise BuildContractError("VITE_RELEASE_SHA does not match the release SHA")
    return BuildContract(validated_sha, normalized_api, normalized_web)


def canonical_contract_json(contract: BuildContract) -> str:
    """Return the byte-for-byte configuration identity used by image labels."""

    return json.dumps(
        contract.as_document(),
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=True,
        allow_nan=False,
    )


def build_config_hash(contract: BuildContract) -> str:
    return hashlib.sha256(canonical_contract_json(contract).encode("utf-8")).hexdigest()


def parse_contract_json(raw: str, release_sha: str) -> BuildContract:
    try:
        document = json.loads(raw, object_pairs_hook=_strict_object)
    except (json.JSONDecodeError, UnicodeError) as error:
        raise BuildContractError("build contract is not valid JSON") from error
    if not isinstance(document, dict) or set(document) != set(SERVICE_KEYS):
        raise BuildContractError("build contract must contain exactly api and web")
    api = document["api"]
    web = document["web"]
    if not isinstance(api, dict) or not isinstance(web, dict):
        raise BuildContractError("service build arguments must be objects")
    return normalize_build_arguments(api, web, release_sha)


def contract_from_compose_json(raw: str, release_sha: str) -> BuildContract:
    """Extract the allowlisted contract from ``docker compose config`` JSON."""

    try:
        document = json.loads(raw, object_pairs_hook=_strict_object)
    except (json.JSONDecodeError, UnicodeError) as error:
        raise BuildContractError("Compose output is not valid JSON") from error
    services = document.get("services") if isinstance(document, dict) else None
    if not isinstance(services, dict):
        raise BuildContractError("effective Compose services are missing")
    extracted: dict[str, Mapping[str, object]] = {}
    for service in SERVICE_KEYS:
        record = services.get(service)
        build = record.get("build") if isinstance(record, dict) else None
        arguments = build.get("args") if isinstance(build, dict) else None
        if not isinstance(arguments, dict):
            raise BuildContractError(
                f"effective {service} build arguments are missing"
            )
        extracted[service] = arguments
    return normalize_build_arguments(
        extracted["api"], extracted["web"], release_sha
    )


def _parse_args(argv: Sequence[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)
    for command in ("sanitize-compose", "validate", "hash"):
        subparser = subparsers.add_parser(command)
        subparser.add_argument("--release-sha", required=True)
    emit = subparsers.add_parser("emit-build-args")
    emit.add_argument("--release-sha", required=True)
    emit.add_argument("--service", choices=tuple(SERVICE_KEYS), required=True)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = _parse_args(argv if argv is not None else sys.argv[1:])
    raw = sys.stdin.read()
    if args.command == "sanitize-compose":
        contract = contract_from_compose_json(raw, args.release_sha)
    else:
        contract = parse_contract_json(raw, args.release_sha)

    if args.command in {"sanitize-compose", "validate"}:
        sys.stdout.write(canonical_contract_json(contract) + "\n")
    elif args.command == "hash":
        sys.stdout.write(build_config_hash(contract) + "\n")
    else:
        for key, value in contract.service_arguments(args.service).items():
            sys.stdout.buffer.write(
                b"--build-arg\0" + f"{key}={value}".encode("utf-8") + b"\0"
            )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except BuildContractError as error:
        print(f"release build contract failed: {error}", file=sys.stderr)
        raise SystemExit(78) from error
