#!/usr/bin/env python3
"""Verify a live Pi5 API container against effective Compose environment.

The verifier deliberately reports key names only.  Expected and observed
values may contain production secrets and must never be copied into an error,
command argument, or durable deployment state.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path
from typing import Any, Mapping, Sequence


class VerificationError(RuntimeError):
    """A fail-closed runtime configuration verification error."""


def _key_list(keys: set[str] | list[str] | tuple[str, ...]) -> str:
    normalized = sorted({key for key in keys if isinstance(key, str) and key})
    return ",".join(normalized) if normalized else "unknown"


def _environment_mapping(value: Any, *, source: str) -> dict[str, str]:
    if isinstance(value, Mapping):
        result: dict[str, str] = {}
        for raw_key, raw_value in value.items():
            if not isinstance(raw_key, str) or not raw_key:
                raise VerificationError(f"{source} environment has an invalid key")
            if raw_value is None:
                raise VerificationError(
                    f"{source} environment has an unresolved key: {raw_key}"
                )
            if isinstance(raw_value, bool):
                result[raw_key] = "true" if raw_value else "false"
            elif isinstance(raw_value, (str, int, float)):
                result[raw_key] = str(raw_value)
            else:
                raise VerificationError(
                    f"{source} environment has an invalid value for key: {raw_key}"
                )
        return result

    if not isinstance(value, Sequence) or isinstance(value, (str, bytes, bytearray)):
        raise VerificationError(f"{source} environment is malformed")

    result = {}
    duplicates: set[str] = set()
    for item in value:
        if not isinstance(item, str) or "=" not in item:
            raise VerificationError(f"{source} environment is malformed")
        key, item_value = item.split("=", 1)
        if not key:
            raise VerificationError(f"{source} environment has an invalid key")
        if key in result:
            duplicates.add(key)
        result[key] = item_value
    if duplicates:
        raise VerificationError(
            f"{source} environment has duplicate keys: {_key_list(duplicates)}"
        )
    return result


def _compose_environment(value: Any) -> tuple[dict[str, str], set[str]]:
    """Parse Compose environment plus explicit key removals.

    Compose mapping values of ``null`` and list entries without ``=`` mean
    that an unresolved variable is removed from the container environment.
    An explicit empty value remains ``KEY=`` and is therefore distinct.
    """

    if isinstance(value, Mapping):
        removals: set[str] = set()
        concrete: dict[str, Any] = {}
        for raw_key, raw_value in value.items():
            if not isinstance(raw_key, str) or not raw_key:
                raise VerificationError(
                    "effective Compose environment has an invalid key"
                )
            if raw_value is None:
                removals.add(raw_key)
            else:
                concrete[raw_key] = raw_value
        return (
            _environment_mapping(concrete, source="effective Compose"),
            removals,
        )

    if not isinstance(value, Sequence) or isinstance(
        value, (str, bytes, bytearray)
    ):
        raise VerificationError("effective Compose environment is malformed")
    concrete_items: list[str] = []
    removals = set()
    seen: set[str] = set()
    for item in value:
        if not isinstance(item, str):
            raise VerificationError("effective Compose environment is malformed")
        key = item.split("=", 1)[0]
        if not key:
            raise VerificationError(
                "effective Compose environment has an invalid key"
            )
        if key in seen:
            raise VerificationError(
                f"effective Compose environment has duplicate keys: {key}"
            )
        seen.add(key)
        if "=" in item:
            concrete_items.append(item)
        else:
            removals.add(key)
    return (
        _environment_mapping(concrete_items, source="effective Compose"),
        removals,
    )


def expected_environment(
    compose_config: Any, service: str
) -> tuple[dict[str, str], set[str]]:
    if not isinstance(compose_config, Mapping):
        raise VerificationError("effective Compose configuration is malformed")
    services = compose_config.get("services")
    if not isinstance(services, Mapping):
        raise VerificationError("effective Compose services are malformed")
    service_config = services.get(service)
    if not isinstance(service_config, Mapping):
        raise VerificationError(f"effective Compose service is missing: {service}")
    return _compose_environment(service_config.get("environment"))


def observed_environment(inspect_environment: Any) -> dict[str, str]:
    return _environment_mapping(inspect_environment, source="container")


def semantic_missing_keys(environment: Mapping[str, str]) -> set[str]:
    missing: set[str] = set()

    def value(key: str) -> str:
        current = environment.get(key, "")
        return current.strip() if isinstance(current, str) else ""

    if not value("SLACK_KIOSK_SUPPORT_WEBHOOK_URL"):
        missing.add("SLACK_KIOSK_SUPPORT_WEBHOOK_URL")

    if value("ALERTS_DISPATCHER_ENABLED").lower() == "true":
        for key in (
            "ALERTS_SLACK_WEBHOOK_DEPLOY",
            "ALERTS_SLACK_WEBHOOK_OPS",
            "ALERTS_SLACK_WEBHOOK_SECURITY",
            "ALERTS_SLACK_WEBHOOK_SUPPORT",
        ):
            if not value(key):
                missing.add(key)

    local_llm_keys = (
        "LOCAL_LLM_BASE_URL",
        "LOCAL_LLM_SHARED_TOKEN",
        "LOCAL_LLM_MODEL",
    )
    if any(value(key) for key in local_llm_keys):
        missing.update(key for key in local_llm_keys if not value(key))

    if value("PHOTO_TOOL_EMBEDDING_ENABLED").lower() == "true":
        for key in ("PHOTO_TOOL_EMBEDDING_URL", "PHOTO_TOOL_EMBEDDING_MODEL_ID"):
            if not value(key):
                missing.add(key)

    return missing


def effective_environment(
    image_environment: Mapping[str, str],
    compose_environment: Mapping[str, str],
    compose_removals: set[str],
) -> dict[str, str]:
    """Return the exact container environment Docker should materialize."""

    effective = dict(image_environment)
    for key in compose_removals:
        effective.pop(key, None)
    effective.update(compose_environment)
    return effective


def verify_environment(
    expected: Mapping[str, str], observed: Mapping[str, str]
) -> str:
    semantic_missing = semantic_missing_keys(expected)
    if semantic_missing:
        raise VerificationError(
            "effective Compose environment violates required configuration: "
            f"{_key_list(semantic_missing)}"
        )

    missing = {key for key in expected if key not in observed}
    mismatched = {
        key
        for key, expected_value in expected.items()
        if key in observed and observed[key] != expected_value
    }
    unexpected = set(observed) - set(expected)
    if missing or mismatched or unexpected:
        raise VerificationError(
            "runtime API environment does not match effective Compose: "
            f"{_key_list(missing | mismatched | unexpected)}"
        )

    canonical = json.dumps(
        dict(sorted(expected.items())),
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")
    return "sha256:" + hashlib.sha256(canonical).hexdigest()


def verify_payloads(
    compose_config: Any,
    image_environment: Any,
    inspect_environment: Any,
    service: str,
) -> str:
    compose_expected, compose_removals = expected_environment(
        compose_config, service
    )
    image_expected = (
        {}
        if image_environment is None
        else _environment_mapping(image_environment, source="image")
    )
    expected = effective_environment(
        image_expected, compose_expected, compose_removals
    )
    observed = observed_environment(inspect_environment)
    return verify_environment(expected, observed)


def _read_json(path: Path, *, source: str) -> Any:
    try:
        with path.open(encoding="utf-8") as stream:
            return json.load(stream)
    except (OSError, json.JSONDecodeError) as error:
        raise VerificationError(f"{source} JSON is unavailable or malformed") from error


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--service", required=True)
    parser.add_argument("--compose-json", type=Path, required=True)
    parser.add_argument("--image-env-json", type=Path, required=True)
    parser.add_argument("--inspect-json", type=Path, required=True)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        digest = verify_payloads(
            _read_json(args.compose_json, source="effective Compose"),
            _read_json(args.image_env_json, source="image environment"),
            _read_json(args.inspect_json, source="container inspect"),
            args.service,
        )
    except VerificationError as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1
    print(digest)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
