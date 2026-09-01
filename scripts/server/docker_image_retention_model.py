#!/usr/bin/env python3
"""Pure data model and parsers for Pi5 Docker image retention.

This module deliberately has no filesystem, subprocess, or Docker I/O.  It
contains only the immutable state/image values and validation needed by the
policy and runtime layers.
"""

from __future__ import annotations

import datetime as _datetime
import hashlib
import json
import re
from dataclasses import dataclass
from typing import Any, Mapping


RETENTION_SCHEMA_VERSION = 1
PLAN_SCHEMA_VERSION = 1
PLAN_KIND = "pi5-docker-image-retention-plan"
SUMMARY_KIND = "pi5-docker-image-retention-summary"
MINIMUM_AGE_SECONDS = 24 * 60 * 60

# Keep this list literal and reviewable.  In particular, do not derive it from
# the retention file, Docker labels, an environment variable, or Compose.
API_REPOSITORIES = frozenset(
    {
        "ghcr.io/denkoushi/raspisys-api",
        "raspi-system-api",
        "docker-api",
    }
)
WEB_REPOSITORIES = frozenset(
    {
        "ghcr.io/denkoushi/raspisys-web",
        "raspi-system-web",
        "docker-web",
    }
)
RELEASE_SET_REPOSITORY = "ghcr.io/denkoushi/raspisys-release-set"
ALLOWED_REPOSITORIES = frozenset(
    {*API_REPOSITORIES, *WEB_REPOSITORIES, RELEASE_SET_REPOSITORY}
)
RELEASE_SHA_RE = re.compile(r"^[0-9a-f]{40}$")
IMAGE_ID_RE = re.compile(r"^sha256:[0-9a-f]{64}$")
CONTAINER_ID_RE = re.compile(r"^[0-9a-f]{12,64}$")
REFERENCE_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,254}$")
IMMUTABLE_REFERENCE_RE = re.compile(
    r"^(?P<repository>[A-Za-z0-9][A-Za-z0-9._/-]{0,253}):"
    r"(?P<tag>[0-9a-f]{40}(?:-[0-9a-f]{16})?)@sha256:[0-9a-f]{64}$"
)
REVISION_IN_REFERENCE_RE = re.compile(r"(?<![0-9a-f])([0-9a-f]{40})(?![0-9a-f])")
ISO_CREATED_RE = re.compile(
    r"^(?P<date>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})"
    r"(?:\.(?P<fraction>\d+))?(?P<zone>Z|[+-]\d{2}:\d{2})$"
)


class RetentionError(RuntimeError):
    """Raised when the retention contract cannot be proven safe."""

    def __init__(self, message: str, *, reason: str = "contract") -> None:
        super().__init__(message)
        self.reason = reason


def strict_object(items: list[tuple[str, Any]]) -> dict[str, Any]:
    """Build a JSON object while rejecting duplicate keys."""

    value: dict[str, Any] = {}
    for key, item in items:
        if key in value:
            raise RetentionError(f"duplicate JSON key: {key}", reason="invalid_json")
        value[key] = item
    return value


def canonical_json(value: Any) -> str:
    try:
        return json.dumps(
            value,
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=True,
            allow_nan=False,
        )
    except (TypeError, ValueError) as error:
        raise RetentionError("JSON value is not canonicalizable", reason="invalid_json") from error


def sha256_json(value: Any) -> str:
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def validate_string(
    value: Any,
    *,
    label: str,
    pattern: re.Pattern[str] | None = None,
) -> str:
    if not isinstance(value, str) or "\x00" in value or "\r" in value or "\n" in value:
        raise RetentionError(f"{label} is malformed", reason="invalid_state")
    if len(value.encode("utf-8")) > 4096:
        raise RetentionError(f"{label} is too long", reason="invalid_state")
    if pattern is not None and pattern.fullmatch(value) is None:
        raise RetentionError(f"{label} is malformed", reason="invalid_state")
    return value


def validate_image_id(value: Any, *, label: str = "image ID") -> str:
    return validate_string(value, label=label, pattern=IMAGE_ID_RE)


def validate_release_sha(value: Any, *, label: str) -> str:
    return validate_string(value, label=label, pattern=RELEASE_SHA_RE)


def validate_reference(value: Any, *, label: str) -> str:
    return validate_string(value, label=label, pattern=REFERENCE_RE)


def repository_from_reference(reference: str) -> str:
    # A tagged immutable reference has the form ``repo:tag@sha256:digest``;
    # strip the digest before looking for the tag separator.  A RepoDigest
    # (``repo@sha256:digest``) consequently has no tag colon left to strip.
    name = reference.split("@", 1)[0]
    colon = name.rfind(":")
    slash = name.rfind("/")
    return name[:colon] if colon > slash else name


def reference_revisions(reference: str) -> set[str]:
    repository = repository_from_reference(reference)
    if repository not in ALLOWED_REPOSITORIES:
        return set()
    tag_or_digest = reference.split("@", 1)[0]
    colon = tag_or_digest.rfind(":")
    if colon > tag_or_digest.rfind("/"):
        tag_or_digest = tag_or_digest[colon + 1 :]
    return set(REVISION_IN_REFERENCE_RE.findall(tag_or_digest))


def parse_created(value: Any, *, label: str) -> _datetime.datetime:
    raw = validate_string(value, label=label)
    matched = ISO_CREATED_RE.fullmatch(raw)
    if matched is None:
        raise RetentionError(f"{label} is not an RFC3339 timestamp", reason="invalid_docker")
    fraction = matched.group("fraction") or ""
    # Docker can emit nanoseconds; datetime accepts microseconds only.  The
    # discarded precision cannot change a 24-hour boundary decision.
    fraction = (fraction + "000000")[:6]
    zone = matched.group("zone")
    normalized = f"{matched.group('date')}.{fraction}{'+00:00' if zone == 'Z' else zone}"
    try:
        parsed = _datetime.datetime.fromisoformat(normalized)
    except ValueError as error:
        raise RetentionError(f"{label} is not a valid timestamp", reason="invalid_docker") from error
    if parsed.tzinfo is None:
        raise RetentionError(f"{label} has no timezone", reason="invalid_docker")
    return parsed.astimezone(_datetime.timezone.utc)


def timestamp(value: _datetime.datetime) -> str:
    utc = value.astimezone(_datetime.timezone.utc)
    return utc.isoformat(timespec="microseconds").replace("+00:00", "Z")


def validate_labels(value: Any) -> dict[str, str]:
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise RetentionError("Docker image labels are malformed", reason="invalid_docker")
    labels: dict[str, str] = {}
    for key, item in value.items():
        key = validate_string(key, label="Docker image label key")
        item = validate_string(item, label=f"Docker image label {key}")
        labels[key] = item
    return labels


def normalise_references(value: Any, *, label: str) -> tuple[str, ...]:
    if value is None:
        return ()
    if not isinstance(value, list):
        raise RetentionError(f"{label} is malformed", reason="invalid_docker")
    result: set[str] = set()
    for item in value:
        if item == "<none>:<none>":
            continue
        reference = validate_reference(item, label=label)
        # Docker uses this pseudo-reference for dangling images.  It carries no
        # repository identity and must not make a dangling layer eligible.
        result.add(reference)
    return tuple(sorted(result))


def validate_container_id(value: Any) -> str:
    return validate_string(value, label="Docker container ID", pattern=CONTAINER_ID_RE)


@dataclass(frozen=True)
class RetentionEntry:
    reference: str
    image_id: str
    release_sha: str
    service: str

    def as_document(self) -> dict[str, str]:
        return {
            "reference": self.reference,
            "imageId": self.image_id,
            "releaseSha": self.release_sha,
        }


@dataclass(frozen=True)
class RetentionState:
    current_api: RetentionEntry
    current_web: RetentionEntry
    previous_api: RetentionEntry
    previous_web: RetentionEntry

    @property
    def entries(self) -> tuple[RetentionEntry, ...]:
        return (self.current_api, self.current_web, self.previous_api, self.previous_web)

    @property
    def retained_image_ids(self) -> frozenset[str]:
        return frozenset(entry.image_id for entry in self.entries)

    @property
    def retained_release_shas(self) -> frozenset[str]:
        return frozenset(entry.release_sha for entry in self.entries)

    def as_document(self) -> dict[str, Any]:
        return {
            "schemaVersion": RETENTION_SCHEMA_VERSION,
            "current": {
                "api": self.current_api.as_document(),
                "web": self.current_web.as_document(),
            },
            "previous": {
                "api": self.previous_api.as_document(),
                "web": self.previous_web.as_document(),
            },
        }


def parse_retention_entry(value: Any, *, service: str, generation: str) -> RetentionEntry:
    if not isinstance(value, dict) or set(value) != {"reference", "imageId", "releaseSha"}:
        raise RetentionError(
            f"{generation} {service} retention entry is malformed", reason="invalid_state"
        )
    reference = validate_reference(value["reference"], label=f"{generation} {service} reference")
    image_id = validate_image_id(value["imageId"], label=f"{generation} {service} image ID")
    release_sha = validate_release_sha(
        value["releaseSha"], label=f"{generation} {service} release SHA"
    )
    repository = repository_from_reference(reference)
    expected_repositories = API_REPOSITORIES if service == "api" else WEB_REPOSITORIES
    if repository not in expected_repositories:
        raise RetentionError(
            f"{generation} {service} reference repository is not allowlisted",
            reason="invalid_state",
        )
    matched = IMMUTABLE_REFERENCE_RE.fullmatch(reference)
    if matched is None or matched.group("repository") != repository:
        raise RetentionError(
            f"{generation} {service} reference is not an immutable release reference",
            reason="invalid_state",
        )
    tag_release_sha = matched.group("tag").split("-", 1)[0]
    if tag_release_sha != release_sha:
        raise RetentionError(
            f"{generation} {service} reference tag does not match release SHA",
            reason="invalid_state",
        )
    return RetentionEntry(reference, image_id, release_sha, service)


def parse_retention_state(document: Mapping[str, Any]) -> RetentionState:
    if set(document) != {"schemaVersion", "current", "previous"}:
        raise RetentionError("retention state fields are malformed", reason="invalid_state")
    if document["schemaVersion"] != RETENTION_SCHEMA_VERSION or type(document["schemaVersion"]) is not int:
        raise RetentionError("retention state schema is unsupported", reason="invalid_state")
    parsed: dict[str, RetentionEntry] = {}
    for generation in ("current", "previous"):
        group = document[generation]
        if not isinstance(group, dict) or set(group) != {"api", "web"}:
            raise RetentionError(f"{generation} retention entries are malformed", reason="invalid_state")
        for service in ("api", "web"):
            parsed[f"{generation}_{service}"] = parse_retention_entry(
                group[service], service=service, generation=generation
            )
        if parsed[f"{generation}_api"].release_sha != parsed[f"{generation}_web"].release_sha:
            raise RetentionError(
                f"{generation} API/Web release SHA values differ", reason="invalid_state"
            )
    return RetentionState(
        current_api=parsed["current_api"],
        current_web=parsed["current_web"],
        previous_api=parsed["previous_api"],
        previous_web=parsed["previous_web"],
    )


@dataclass(frozen=True)
class ImageRecord:
    image_id: str
    created: _datetime.datetime
    size_bytes: int
    repo_tags: tuple[str, ...]
    repo_digests: tuple[str, ...]
    labels: Mapping[str, str]

    @property
    def references(self) -> tuple[str, ...]:
        return tuple(sorted(set(self.repo_tags) | set(self.repo_digests)))

    @property
    def repositories(self) -> frozenset[str]:
        return frozenset(repository_from_reference(reference) for reference in self.references)

    @property
    def release_revisions(self) -> frozenset[str]:
        revisions: set[str] = set()
        for reference in self.references:
            revisions.update(reference_revisions(reference))
        revision_label = self.labels.get("org.opencontainers.image.revision")
        if revision_label is not None and RELEASE_SHA_RE.fullmatch(revision_label):
            revisions.add(revision_label)
        return frozenset(revisions)

    def as_document(self) -> dict[str, Any]:
        return {
            "id": self.image_id,
            "created": timestamp(self.created),
            "sizeBytes": self.size_bytes,
            "repoTags": list(self.repo_tags),
            "repoDigests": list(self.repo_digests),
            "labels": dict(sorted(self.labels.items())),
            "repositories": sorted(self.repositories),
            "releaseRevisions": sorted(self.release_revisions),
        }


def parse_image_inspect(document: Mapping[str, Any]) -> ImageRecord:
    expected = {"id", "created", "size", "repoTags", "repoDigests", "labels"}
    if set(document) != expected:
        raise RetentionError("Docker image inspect fields are malformed", reason="invalid_docker")
    image_id = validate_image_id(document["id"], label="Docker inspected image ID")
    created = parse_created(document["created"], label="Docker image Created")
    size = document["size"]
    if type(size) is not int or size < 0 or size > 2**63 - 1:
        raise RetentionError("Docker image size is malformed", reason="invalid_docker")
    repo_tags = normalise_references(document["repoTags"], label="Docker RepoTags")
    repo_digests = normalise_references(document["repoDigests"], label="Docker RepoDigests")
    labels = validate_labels(document["labels"])
    return ImageRecord(image_id, created, size, repo_tags, repo_digests, labels)
