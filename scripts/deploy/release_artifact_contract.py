#!/usr/bin/env python3
"""Strict contract for one attested API/Web OCI release pair."""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass
from typing import Any, Sequence


FULL_SHA_RE = re.compile(r"^[0-9a-f]{40}$")
SHA256_RE = re.compile(r"^sha256:[0-9a-f]{64}$")
CONFIG_HASH_RE = re.compile(r"^[0-9a-f]{64}$")
REPOSITORY_RE = re.compile(
    r"^[A-Za-z0-9](?:[A-Za-z0-9_.-]{0,99})/"
    r"[A-Za-z0-9](?:[A-Za-z0-9_.-]{0,199})$"
)
OCI_REPOSITORY_RE = re.compile(
    r"^ghcr\.io/[a-z0-9](?:[a-z0-9_.-]{0,99})/"
    r"[a-z0-9](?:[a-z0-9_.-]{0,199})$"
)
WORKFLOW_RE = re.compile(r"^\.github/workflows/[A-Za-z0-9_.-]+\.ya?ml$")
MAX_JSON_BYTES = 64 * 1024
EXPECTED_IMAGE_REPOSITORIES = {
    "api": "ghcr.io/denkoushi/raspisys-api",
    "web": "ghcr.io/denkoushi/raspisys-web",
}


class ReleaseArtifactError(ValueError):
    """The release set is malformed or does not match the requested release."""


def _strict_object(items: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in items:
        if key in result:
            raise ReleaseArtifactError(f"duplicate JSON key: {key}")
        result[key] = value
    return result


def _exact_keys(value: object, keys: set[str], label: str) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != keys:
        raise ReleaseArtifactError(f"{label} has unknown or missing fields")
    return value


@dataclass(frozen=True)
class ImageArtifact:
    repository: str
    digest: str


@dataclass(frozen=True)
class WorkflowIdentity:
    path: str
    run_id: int
    run_attempt: int


@dataclass(frozen=True)
class ReleaseSet:
    schema_version: int
    source_repository: str
    source_sha: str
    source_ref: str
    config_hash: str
    operating_system: str
    architecture: str
    api: ImageArtifact
    web: ImageArtifact
    workflow: WorkflowIdentity

    def as_document(self) -> dict[str, object]:
        return {
            "schemaVersion": self.schema_version,
            "source": {
                "repository": self.source_repository,
                "sha": self.source_sha,
                "ref": self.source_ref,
            },
            "configHash": self.config_hash,
            "platform": {
                "os": self.operating_system,
                "architecture": self.architecture,
            },
            "images": {
                "api": {
                    "repository": self.api.repository,
                    "digest": self.api.digest,
                },
                "web": {
                    "repository": self.web.repository,
                    "digest": self.web.digest,
                },
            },
            "workflow": {
                "path": self.workflow.path,
                "runId": self.workflow.run_id,
                "runAttempt": self.workflow.run_attempt,
            },
        }


def _image(value: object, label: str) -> ImageArtifact:
    record = _exact_keys(value, {"repository", "digest"}, label)
    repository = record["repository"]
    digest = record["digest"]
    if (
        not isinstance(repository, str)
        or OCI_REPOSITORY_RE.fullmatch(repository) is None
        or not isinstance(digest, str)
        or SHA256_RE.fullmatch(digest) is None
    ):
        raise ReleaseArtifactError(f"{label} identity is malformed")
    return ImageArtifact(repository, digest)


def parse_release_set(raw: str) -> ReleaseSet:
    if len(raw.encode("utf-8")) > MAX_JSON_BYTES:
        raise ReleaseArtifactError("release set exceeds its size limit")
    try:
        document = json.loads(raw, object_pairs_hook=_strict_object)
    except (json.JSONDecodeError, UnicodeError) as error:
        raise ReleaseArtifactError("release set is not valid JSON") from error
    root = _exact_keys(
        document,
        {
            "schemaVersion",
            "source",
            "configHash",
            "platform",
            "images",
            "workflow",
        },
        "release set",
    )
    if root["schemaVersion"] != 1 or type(root["schemaVersion"]) is not int:
        raise ReleaseArtifactError("unsupported release-set schema version")

    source = _exact_keys(root["source"], {"repository", "sha", "ref"}, "source")
    platform = _exact_keys(root["platform"], {"os", "architecture"}, "platform")
    images = _exact_keys(root["images"], {"api", "web"}, "images")
    workflow = _exact_keys(
        root["workflow"], {"path", "runId", "runAttempt"}, "workflow"
    )

    repository = source["repository"]
    sha = source["sha"]
    ref = source["ref"]
    config_hash = root["configHash"]
    workflow_path = workflow["path"]
    run_id = workflow["runId"]
    run_attempt = workflow["runAttempt"]
    if (
        not isinstance(repository, str)
        or REPOSITORY_RE.fullmatch(repository) is None
        or not isinstance(sha, str)
        or FULL_SHA_RE.fullmatch(sha) is None
        or ref != "refs/heads/main"
        or not isinstance(config_hash, str)
        or CONFIG_HASH_RE.fullmatch(config_hash) is None
        or platform != {"os": "linux", "architecture": "arm64"}
        or not isinstance(workflow_path, str)
        or WORKFLOW_RE.fullmatch(workflow_path) is None
        or type(run_id) is not int
        or run_id <= 0
        or type(run_attempt) is not int
        or run_attempt <= 0
    ):
        raise ReleaseArtifactError("release-set identity is malformed")

    return ReleaseSet(
        schema_version=1,
        source_repository=repository,
        source_sha=sha,
        source_ref=ref,
        config_hash=config_hash,
        operating_system="linux",
        architecture="arm64",
        api=_image(images["api"], "API image"),
        web=_image(images["web"], "Web image"),
        workflow=WorkflowIdentity(workflow_path, run_id, run_attempt),
    )


def validate_release_set(
    release_set: ReleaseSet,
    expected_repository: str,
    expected_sha: str,
    expected_config_hash: str,
    expected_workflow: str,
) -> None:
    mismatches = []
    if release_set.source_repository != expected_repository:
        mismatches.append("source repository")
    if release_set.source_sha != expected_sha:
        mismatches.append("source SHA")
    if release_set.source_ref != "refs/heads/main":
        mismatches.append("source ref")
    if release_set.config_hash != expected_config_hash:
        mismatches.append("configuration hash")
    if release_set.workflow.path != expected_workflow:
        mismatches.append("workflow")
    if release_set.operating_system != "linux" or release_set.architecture != "arm64":
        mismatches.append("platform")
    if release_set.api.repository != EXPECTED_IMAGE_REPOSITORIES["api"]:
        mismatches.append("API image repository")
    if release_set.web.repository != EXPECTED_IMAGE_REPOSITORIES["web"]:
        mismatches.append("Web image repository")
    if mismatches:
        raise ReleaseArtifactError(
            "release set does not match the request: " + ", ".join(mismatches)
        )


def canonical_release_set_json(release_set: ReleaseSet) -> str:
    return json.dumps(
        release_set.as_document(),
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=True,
        allow_nan=False,
    )


def _parse_args(argv: Sequence[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)
    create = subparsers.add_parser("create")
    create.add_argument("--repository", required=True)
    create.add_argument("--sha", required=True)
    create.add_argument("--config-hash", required=True)
    create.add_argument("--api-repository", required=True)
    create.add_argument("--api-digest", required=True)
    create.add_argument("--web-repository", required=True)
    create.add_argument("--web-digest", required=True)
    create.add_argument("--workflow", required=True)
    create.add_argument("--run-id", type=int, required=True)
    create.add_argument("--run-attempt", type=int, required=True)

    verify = subparsers.add_parser("verify")
    verify.add_argument("--repository", required=True)
    verify.add_argument("--sha", required=True)
    verify.add_argument("--config-hash", required=True)
    verify.add_argument("--workflow", required=True)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = _parse_args(argv if argv is not None else sys.argv[1:])
    if args.command == "create":
        candidate = {
            "schemaVersion": 1,
            "source": {
                "repository": args.repository,
                "sha": args.sha,
                "ref": "refs/heads/main",
            },
            "configHash": args.config_hash,
            "platform": {"os": "linux", "architecture": "arm64"},
            "images": {
                "api": {
                    "repository": args.api_repository,
                    "digest": args.api_digest,
                },
                "web": {
                    "repository": args.web_repository,
                    "digest": args.web_digest,
                },
            },
            "workflow": {
                "path": args.workflow,
                "runId": args.run_id,
                "runAttempt": args.run_attempt,
            },
        }
        release_set = parse_release_set(json.dumps(candidate))
    else:
        release_set = parse_release_set(sys.stdin.read())
        validate_release_set(
            release_set,
            args.repository,
            args.sha,
            args.config_hash,
            args.workflow,
        )
    sys.stdout.write(canonical_release_set_json(release_set) + "\n")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ReleaseArtifactError as error:
        print(f"release artifact contract failed: {error}", file=sys.stderr)
        raise SystemExit(78) from error
