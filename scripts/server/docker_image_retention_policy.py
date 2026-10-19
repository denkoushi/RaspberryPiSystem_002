#!/usr/bin/env python3
"""Pure candidate-selection and sealed-plan validation for image retention."""

from __future__ import annotations

import datetime as _datetime
from dataclasses import dataclass
from typing import Any, Mapping

if __package__:
    from .docker_image_retention_model import (
        ALLOWED_REPOSITORIES,
        IMAGE_ID_RE,
        MINIMUM_AGE_SECONDS,
        PLAN_KIND,
        PLAN_SCHEMA_VERSION,
        RELEASE_SET_REPOSITORY,
        RELEASE_SHA_RE,
        ImageRecord,
        RetentionError,
        RetentionState,
        parse_created,
        parse_image_inspect,
        sha256_json,
        timestamp,
        validate_string,
    )
else:
    from docker_image_retention_model import (
        ALLOWED_REPOSITORIES,
        IMAGE_ID_RE,
        MINIMUM_AGE_SECONDS,
        PLAN_KIND,
        PLAN_SCHEMA_VERSION,
        RELEASE_SET_REPOSITORY,
        RELEASE_SHA_RE,
        ImageRecord,
        RetentionError,
        RetentionState,
        parse_created,
        parse_image_inspect,
        sha256_json,
        timestamp,
        validate_string,
    )


@dataclass(frozen=True)
class DockerSnapshot:
    """Immutable Docker observation supplied by the runtime adapter."""

    images: tuple[ImageRecord, ...]
    container_image_ids: frozenset[str]
    running_container_image_ids: frozenset[str]

    @property
    def image_ids(self) -> frozenset[str]:
        return frozenset(image.image_id for image in self.images)

    def as_document(self, state: RetentionState) -> dict[str, Any]:
        return {
            "images": [image.as_document() for image in self.images],
            "containerImageIds": sorted(self.container_image_ids),
            "runningContainerImageIds": sorted(self.running_container_image_ids),
            "retention": state.as_document(),
        }


def ensure_current_ids_running(state: RetentionState, snapshot: DockerSnapshot) -> None:
    current_ids = {state.current_api.image_id, state.current_web.image_id}
    if not current_ids.issubset(snapshot.running_container_image_ids):
        raise RetentionError(
            "current API/Web image IDs do not match running container references",
            reason="state_mismatch",
        )


def _ensure_retention_ids_present(state: RetentionState, snapshot: DockerSnapshot) -> None:
    missing = sorted(state.retained_image_ids - snapshot.image_ids)
    if missing:
        raise RetentionError(
            "retention state references image IDs absent from Docker", reason="state_mismatch"
        )
    ensure_current_ids_running(state, snapshot)


def _image_is_allowlisted(image: ImageRecord) -> bool:
    repositories = image.repositories
    return bool(repositories) and repositories.issubset(ALLOWED_REPOSITORIES)


def _candidate_images(
    snapshot: DockerSnapshot,
    state: RetentionState,
    *,
    now: _datetime.datetime,
) -> tuple[tuple[ImageRecord, ...], dict[str, list[str]]]:
    cutoff = now.astimezone(_datetime.timezone.utc) - _datetime.timedelta(
        seconds=MINIMUM_AGE_SECONDS
    )
    excluded: dict[str, list[str]] = {
        "containerReferenced": [],
        "retainedImage": [],
        "retainedReleaseSetRevision": [],
        "youngerThan24Hours": [],
        "notAllowlisted": [],
    }
    candidates: list[ImageRecord] = []
    for image in snapshot.images:
        if not _image_is_allowlisted(image):
            excluded["notAllowlisted"].append(image.image_id)
            continue
        if image.image_id in snapshot.container_image_ids:
            excluded["containerReferenced"].append(image.image_id)
            continue
        if image.image_id in state.retained_image_ids:
            excluded["retainedImage"].append(image.image_id)
            continue
        if (
            RELEASE_SET_REPOSITORY in image.repositories
            and image.release_revisions.intersection(state.retained_release_shas)
        ):
            excluded["retainedReleaseSetRevision"].append(image.image_id)
            continue
        if image.created > cutoff:
            excluded["youngerThan24Hours"].append(image.image_id)
            continue
        candidates.append(image)
    for key in excluded:
        excluded[key].sort()
    return tuple(sorted(candidates, key=lambda image: image.image_id)), excluded


def snapshot_sha256(snapshot: DockerSnapshot, state: RetentionState) -> str:
    return sha256_json(snapshot.as_document(state))


def _normalise_now(now: _datetime.datetime | None) -> _datetime.datetime:
    value = now or _datetime.datetime.now(_datetime.timezone.utc)
    if value.tzinfo is None:
        raise RetentionError("observation time has no timezone", reason="invalid_time")
    return value.astimezone(_datetime.timezone.utc)


def build_plan(
    snapshot: DockerSnapshot,
    state: RetentionState,
    *,
    state_path: str,
    state_sha256: str,
    now: _datetime.datetime | None = None,
) -> dict[str, Any]:
    observed_at = _normalise_now(now)
    _ensure_retention_ids_present(state, snapshot)
    candidates, excluded = _candidate_images(snapshot, state, now=observed_at)
    candidate_documents = [image.as_document() for image in candidates]
    payload: dict[str, Any] = {
        "schemaVersion": PLAN_SCHEMA_VERSION,
        "kind": PLAN_KIND,
        "observedAt": timestamp(observed_at),
        "minimumAgeSeconds": MINIMUM_AGE_SECONDS,
        "statePath": state_path,
        "stateSha256": state_sha256,
        "snapshotSha256": snapshot_sha256(snapshot, state),
        "retainedImageIds": sorted(state.retained_image_ids),
        "retainedReleaseShas": sorted(state.retained_release_shas),
        "containerReferencedImageIds": sorted(snapshot.container_image_ids),
        "runningContainerImageIds": sorted(snapshot.running_container_image_ids),
        "excluded": excluded,
        "candidates": candidate_documents,
        "candidateIds": [image.image_id for image in candidates],
        "candidateCount": len(candidates),
        "estimatedBytes": sum(image.size_bytes for image in candidates),
    }
    payload["planSha256"] = sha256_json(payload)
    return payload


def validate_plan(document: Mapping[str, Any]) -> dict[str, Any]:
    """Validate a plan document without reading files or invoking Docker."""

    expected = {
        "schemaVersion",
        "kind",
        "observedAt",
        "minimumAgeSeconds",
        "statePath",
        "stateSha256",
        "snapshotSha256",
        "retainedImageIds",
        "retainedReleaseShas",
        "containerReferencedImageIds",
        "runningContainerImageIds",
        "excluded",
        "candidates",
        "candidateIds",
        "candidateCount",
        "estimatedBytes",
        "planSha256",
    }
    if set(document) != expected:
        raise RetentionError("retention plan fields are malformed", reason="invalid_plan")
    if document["schemaVersion"] != PLAN_SCHEMA_VERSION or type(document["schemaVersion"]) is not int:
        raise RetentionError("retention plan schema is unsupported", reason="invalid_plan")
    if document["kind"] != PLAN_KIND:
        raise RetentionError("retention plan kind is unsupported", reason="invalid_plan")
    parse_created(document["observedAt"], label="retention plan observedAt")
    if document["minimumAgeSeconds"] != MINIMUM_AGE_SECONDS or type(document["minimumAgeSeconds"]) is not int:
        raise RetentionError("retention plan age policy is unsupported", reason="invalid_plan")
    state_path = validate_string(document["statePath"], label="retention plan statePath")
    if not state_path.startswith("/"):
        raise RetentionError("retention plan statePath is not absolute", reason="invalid_plan")
    for key in ("stateSha256", "snapshotSha256", "planSha256"):
        if not isinstance(document[key], str) or len(document[key]) != 64 or any(
            character not in "0123456789abcdef" for character in document[key]
        ):
            raise RetentionError(f"retention plan {key} is malformed", reason="invalid_plan")
    for key in (
        "retainedImageIds",
        "containerReferencedImageIds",
        "runningContainerImageIds",
    ):
        value = document[key]
        if not isinstance(value, list) or any(
            not isinstance(item, str) or IMAGE_ID_RE.fullmatch(item) is None
            for item in value
        ):
            raise RetentionError(f"retention plan {key} is malformed", reason="invalid_plan")
        if value != sorted(set(value)):
            raise RetentionError(f"retention plan {key} is not canonical", reason="invalid_plan")
    retained_shas = document["retainedReleaseShas"]
    if not isinstance(retained_shas, list) or any(
        not isinstance(item, str) or RELEASE_SHA_RE.fullmatch(item) is None
        for item in retained_shas
    ):
        raise RetentionError("retention plan release SHAs are malformed", reason="invalid_plan")
    if retained_shas != sorted(set(retained_shas)):
        raise RetentionError("retention plan release SHAs are not canonical", reason="invalid_plan")
    excluded = document["excluded"]
    excluded_keys = {
        "containerReferenced",
        "retainedImage",
        "retainedReleaseSetRevision",
        "youngerThan24Hours",
        "notAllowlisted",
    }
    if not isinstance(excluded, dict) or set(excluded) != excluded_keys:
        raise RetentionError("retention plan exclusions are malformed", reason="invalid_plan")
    for key, value in excluded.items():
        if not isinstance(value, list) or any(
            not isinstance(item, str) or IMAGE_ID_RE.fullmatch(item) is None
            for item in value
        ):
            raise RetentionError(f"retention plan exclusion {key} is malformed", reason="invalid_plan")
        if value != sorted(set(value)):
            raise RetentionError(f"retention plan exclusion {key} is not canonical", reason="invalid_plan")
    candidates = document["candidates"]
    if not isinstance(candidates, list):
        raise RetentionError("retention plan candidates are malformed", reason="invalid_plan")
    parsed_candidates: list[ImageRecord] = []
    for candidate in candidates:
        if not isinstance(candidate, dict):
            raise RetentionError("retention plan candidate is malformed", reason="invalid_plan")
        expected_candidate_keys = {
            "id",
            "created",
            "sizeBytes",
            "repoTags",
            "repoDigests",
            "labels",
            "repositories",
            "releaseRevisions",
        }
        if set(candidate) != expected_candidate_keys:
            raise RetentionError("retention plan candidate fields are malformed", reason="invalid_plan")
        try:
            parsed = parse_image_inspect(
                {
                    "id": candidate["id"],
                    "created": candidate["created"],
                    "size": candidate["sizeBytes"],
                    "repoTags": candidate["repoTags"],
                    "repoDigests": candidate["repoDigests"],
                    "labels": candidate["labels"],
                }
            )
        except RetentionError as error:
            raise RetentionError("retention plan candidate is malformed", reason="invalid_plan") from error
        repositories = candidate["repositories"]
        release_revisions = candidate["releaseRevisions"]
        if (
            not isinstance(repositories, list)
            or not isinstance(release_revisions, list)
            or any(not isinstance(item, str) for item in repositories)
            or any(not isinstance(item, str) for item in release_revisions)
            or sorted(repositories) != sorted(parsed.repositories)
            or sorted(release_revisions) != sorted(parsed.release_revisions)
        ):
            raise RetentionError("retention plan candidate derived fields disagree", reason="invalid_plan")
        if not _image_is_allowlisted(parsed):
            raise RetentionError("retention plan contains a non-allowlisted candidate", reason="invalid_plan")
        parsed_candidates.append(parsed)
    candidate_ids = document["candidateIds"]
    expected_ids = [candidate.image_id for candidate in parsed_candidates]
    if candidate_ids != expected_ids or candidate_ids != sorted(set(candidate_ids)):
        raise RetentionError("retention plan candidate IDs disagree", reason="invalid_plan")
    if document["candidateCount"] != len(parsed_candidates) or type(document["candidateCount"]) is not int:
        raise RetentionError("retention plan candidate count is malformed", reason="invalid_plan")
    if document["estimatedBytes"] != sum(candidate.size_bytes for candidate in parsed_candidates) or type(document["estimatedBytes"]) is not int:
        raise RetentionError("retention plan estimated bytes are malformed", reason="invalid_plan")
    without_digest = dict(document)
    without_digest.pop("planSha256")
    if sha256_json(without_digest) != document["planSha256"]:
        raise RetentionError("retention plan digest does not match", reason="plan_tampered")
    return dict(document)
