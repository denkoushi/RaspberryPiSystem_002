#!/usr/bin/env python3
"""Fail-closed compressed-size policy for an exact ARM64 API OCI image."""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass
from typing import Any, Sequence


OCI_INDEX_MEDIA_TYPE = "application/vnd.oci.image.index.v1+json"
OCI_MANIFEST_MEDIA_TYPE = "application/vnd.oci.image.manifest.v1+json"
OCI_CONFIG_MEDIA_TYPE = "application/vnd.oci.image.config.v1+json"
ALLOWED_LAYER_MEDIA_TYPES = {
    "application/vnd.oci.image.layer.v1.tar+gzip",
    "application/vnd.oci.image.layer.v1.tar+zstd",
}
DIGEST_RE = re.compile(r"^sha256:[0-9a-f]{64}$")
MAX_DOCUMENT_BYTES = 1024 * 1024


class ImageBudgetError(ValueError):
    """An OCI document is malformed or exceeds the reviewed API budget."""


@dataclass(frozen=True)
class ImageBudget:
    max_total_bytes: int
    max_layer_bytes: int
    max_layers: int


@dataclass(frozen=True)
class ImageBudgetResult:
    layer_count: int
    total_bytes: int
    largest_layer_bytes: int


API_IMAGE_BUDGET = ImageBudget(
    max_total_bytes=1_400_000_000,
    max_layer_bytes=850_000_000,
    max_layers=40,
)


def _strict_object(items: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in items:
        if key in result:
            raise ImageBudgetError(f"duplicate JSON key: {key}")
        result[key] = value
    return result


def _load(raw: str) -> dict[str, Any]:
    if len(raw.encode("utf-8")) > MAX_DOCUMENT_BYTES:
        raise ImageBudgetError("OCI document exceeds its size limit")
    try:
        value = json.loads(raw, object_pairs_hook=_strict_object)
    except (json.JSONDecodeError, UnicodeError) as error:
        raise ImageBudgetError("OCI document is not valid JSON") from error
    if not isinstance(value, dict):
        raise ImageBudgetError("OCI document must be an object")
    return value


def _exact_keys(
    value: object,
    expected: set[str],
    label: str,
    *,
    optional: set[str] | None = None,
) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ImageBudgetError(f"{label} must be an object")
    optional_keys = optional or set()
    if not expected.issubset(value) or not set(value).issubset(expected | optional_keys):
        raise ImageBudgetError(f"{label} has unknown or missing fields")
    return value


def _descriptor(
    value: object,
    label: str,
    *,
    expected_media_type: str,
) -> dict[str, Any]:
    record = _exact_keys(
        value,
        {"mediaType", "digest", "size"},
        label,
        optional={"annotations", "platform"},
    )
    if record["mediaType"] != expected_media_type:
        raise ImageBudgetError(f"{label} media type is unsupported")
    digest = record["digest"]
    size = record["size"]
    if not isinstance(digest, str) or DIGEST_RE.fullmatch(digest) is None:
        raise ImageBudgetError(f"{label} digest is malformed")
    if type(size) is not int or size <= 0:
        raise ImageBudgetError(f"{label} size is malformed")
    return record


def select_linux_arm64_manifest(raw: str) -> str:
    document = _exact_keys(
        _load(raw),
        {"schemaVersion", "mediaType", "manifests"},
        "OCI image index",
    )
    if (
        document["schemaVersion"] != 2
        or type(document["schemaVersion"]) is not int
        or document["mediaType"] != OCI_INDEX_MEDIA_TYPE
        or not isinstance(document["manifests"], list)
    ):
        raise ImageBudgetError("OCI image index is malformed")

    selected: list[str] = []
    for index, value in enumerate(document["manifests"]):
        descriptor = _descriptor(
            value,
            f"manifest descriptor {index}",
            expected_media_type=OCI_MANIFEST_MEDIA_TYPE,
        )
        platform = descriptor.get("platform")
        if not isinstance(platform, dict):
            continue
        platform_record = _exact_keys(
            platform,
            {"architecture", "os"},
            f"manifest descriptor {index} platform",
            optional={"variant", "os.version", "os.features"},
        )
        if (
            platform_record["architecture"] == "arm64"
            and platform_record["os"] == "linux"
        ):
            selected.append(descriptor["digest"])
    if len(selected) != 1:
        raise ImageBudgetError(
            "OCI image index must contain exactly one linux/arm64 image manifest"
        )
    return selected[0]


def validate_api_image_manifest(
    raw: str,
    *,
    budget: ImageBudget = API_IMAGE_BUDGET,
) -> ImageBudgetResult:
    document = _exact_keys(
        _load(raw),
        {"schemaVersion", "mediaType", "config", "layers"},
        "OCI image manifest",
    )
    if (
        document["schemaVersion"] != 2
        or type(document["schemaVersion"]) is not int
        or document["mediaType"] != OCI_MANIFEST_MEDIA_TYPE
        or not isinstance(document["layers"], list)
    ):
        raise ImageBudgetError("OCI image manifest is malformed")
    _descriptor(
        document["config"],
        "image config descriptor",
        expected_media_type=OCI_CONFIG_MEDIA_TYPE,
    )
    layers = document["layers"]
    if len(layers) == 0:
        raise ImageBudgetError("OCI image manifest has no filesystem layers")
    if len(layers) > budget.max_layers:
        raise ImageBudgetError(
            f"API image layer count exceeds budget: {len(layers)} > {budget.max_layers}"
        )

    sizes: list[int] = []
    for index, value in enumerate(layers):
        record = _exact_keys(
            value,
            {"mediaType", "digest", "size"},
            f"layer descriptor {index}",
        )
        if record["mediaType"] not in ALLOWED_LAYER_MEDIA_TYPES:
            raise ImageBudgetError(
                f"layer descriptor {index} media type is unsupported"
            )
        digest = record["digest"]
        size = record["size"]
        if not isinstance(digest, str) or DIGEST_RE.fullmatch(digest) is None:
            raise ImageBudgetError(f"layer descriptor {index} digest is malformed")
        if type(size) is not int or size <= 0:
            raise ImageBudgetError(f"layer descriptor {index} size is malformed")
        sizes.append(size)

    total = sum(sizes)
    largest = max(sizes)
    if largest > budget.max_layer_bytes:
        raise ImageBudgetError(
            "API image single layer exceeds budget: "
            f"{largest} > {budget.max_layer_bytes}"
        )
    if total > budget.max_total_bytes:
        raise ImageBudgetError(
            f"API image compressed total exceeds budget: {total} > {budget.max_total_bytes}"
        )
    return ImageBudgetResult(
        layer_count=len(sizes),
        total_bytes=total,
        largest_layer_bytes=largest,
    )


def _parse_args(argv: Sequence[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "command",
        choices=("select-linux-arm64", "validate-api"),
    )
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = _parse_args(argv if argv is not None else sys.argv[1:])
    raw = sys.stdin.read()
    if args.command == "select-linux-arm64":
        sys.stdout.write(select_linux_arm64_manifest(raw) + "\n")
    else:
        result = validate_api_image_manifest(raw)
        sys.stdout.write(
            "release image budget ok: "
            f"layers={result.layer_count} "
            f"totalBytes={result.total_bytes} "
            f"largestLayerBytes={result.largest_layer_bytes}\n"
        )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ImageBudgetError as error:
        print(f"release image budget failed: {error}", file=sys.stderr)
        raise SystemExit(78) from error
