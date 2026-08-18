#!/usr/bin/env python3
"""Create the signed adoption predicate for an existing torque-agent image.

This predicate deliberately describes adoption, not build provenance. The CI
caller must run the fixed Trivy gates before invoking this program.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from collections.abc import Callable, Sequence
from pathlib import Path

try:
    from .release_artifact_contract import (
        FULL_SHA_RE,
        SHA256_RE,
        TORQUE_ADOPTED_SOURCE_SHA,
        TORQUE_ADOPTION_PREDICATE_TYPE,
        TORQUE_ORIGINAL_JOB_ID,
        TORQUE_ORIGINAL_RUN_ID,
        TORQUE_ORIGINAL_WORKFLOW,
        WORKFLOW_RE,
    )
except ImportError:  # Direct script execution from scripts/deploy.
    from release_artifact_contract import (
        FULL_SHA_RE,
        SHA256_RE,
        TORQUE_ADOPTED_SOURCE_SHA,
        TORQUE_ADOPTION_PREDICATE_TYPE,
        TORQUE_ORIGINAL_JOB_ID,
        TORQUE_ORIGINAL_RUN_ID,
        TORQUE_ORIGINAL_WORKFLOW,
        WORKFLOW_RE,
    )


MAX_INDEX_BYTES = 256 * 1024
SOURCE_CLOSURE = (
    "clients/torque-agent",
    "infrastructure/docker/Dockerfile.torque-agent",
)
ORIGINAL_SOURCE_SHA = TORQUE_ADOPTED_SOURCE_SHA
ORIGINAL_WORKFLOW = TORQUE_ORIGINAL_WORKFLOW
ORIGINAL_RUN_ID = TORQUE_ORIGINAL_RUN_ID
ORIGINAL_JOB_ID = TORQUE_ORIGINAL_JOB_ID
INDEX_DIGEST = "sha256:810d4c17e581faa352c57ce6930f251d2f9ecb5f7839b1b29ae128f6d3c6c443"
ARM64_DIGEST = "sha256:4a086be9b7a5b2f5b35b6418a708de36bc3465387dda944a2f62e9bf3c2ebc7c"
ARMV7_DIGEST = "sha256:5f63ea8ae48c446751279756b4b49572fe5b19150aa215a15bbc0a5fe6d24737"


class AdoptionError(ValueError):
    """The adoption evidence is incomplete or does not match the fixed image."""


def _positive_int(value: object) -> bool:
    return type(value) is int and value > 0


def verify_source_closure(
    repository: Path,
    source_sha: str,
    adoption_sha: str,
    *,
    run: Callable[..., subprocess.CompletedProcess[str]] = subprocess.run,
) -> None:
    if (
        FULL_SHA_RE.fullmatch(source_sha) is None
        or FULL_SHA_RE.fullmatch(adoption_sha) is None
    ):
        raise AdoptionError("source identity is malformed")
    ancestor = run(
        ["git", "merge-base", "--is-ancestor", source_sha, adoption_sha],
        cwd=repository,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if ancestor.returncode != 0:
        raise AdoptionError(
            "original torque source is not an ancestor of adoption source"
        )
    closure = run(
        ["git", "diff", "--quiet", source_sha, adoption_sha, "--", *SOURCE_CLOSURE],
        cwd=repository,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if closure.returncode != 0:
        raise AdoptionError(
            "torque-agent source closure changed after the original build"
        )


def platform_digests(index_raw: bytes) -> dict[str, str]:
    if len(index_raw) > MAX_INDEX_BYTES:
        raise AdoptionError("OCI index exceeds its size limit")
    try:
        value = json.loads(index_raw)
    except (json.JSONDecodeError, UnicodeError) as error:
        raise AdoptionError("OCI index is not valid JSON") from error
    if not isinstance(value, dict) or not isinstance(value.get("manifests"), list):
        raise AdoptionError("OCI index has no manifest list")
    result: dict[str, str] = {}
    for descriptor in value["manifests"]:
        if not isinstance(descriptor, dict) or not isinstance(
            descriptor.get("platform"), dict
        ):
            continue
        platform = descriptor["platform"]
        operating_system = platform.get("os")
        architecture = platform.get("architecture")
        variant = platform.get("variant")
        key = None
        if operating_system == "linux" and architecture == "arm64" and variant is None:
            key = "linux/arm64"
        elif operating_system == "linux" and architecture == "arm" and variant == "v7":
            key = "linux/arm/v7"
        if key is None:
            continue
        digest = descriptor.get("digest")
        if (
            not isinstance(digest, str)
            or SHA256_RE.fullmatch(digest) is None
            or key in result
        ):
            raise AdoptionError("OCI platform descriptor is malformed or duplicated")
        result[key] = digest
    expected = {"linux/arm64": ARM64_DIGEST, "linux/arm/v7": ARMV7_DIGEST}
    if result != expected:
        raise AdoptionError(
            "OCI index does not contain the fixed torque platform digests"
        )
    return result


def adoption_predicate(
    *,
    adoption_sha: str,
    workflow: str,
    run_id: int,
    run_attempt: int,
    index_raw: bytes,
) -> dict[str, object]:
    if (
        FULL_SHA_RE.fullmatch(adoption_sha) is None
        or WORKFLOW_RE.fullmatch(workflow) is None
        or not _positive_int(run_id)
        or not _positive_int(run_attempt)
    ):
        raise AdoptionError("adoption workflow identity is malformed")
    platforms = platform_digests(index_raw)
    return {
        "schemaVersion": 1,
        "predicateType": TORQUE_ADOPTION_PREDICATE_TYPE,
        "component": "torque-agent",
        "subject": {
            "repository": "ghcr.io/denkoushi/raspisys-torque-agent",
            "indexDigest": INDEX_DIGEST,
            "platforms": [
                {"platform": name, "digest": digest}
                for name, digest in platforms.items()
            ],
        },
        "originalBuild": {
            "sourceSha": ORIGINAL_SOURCE_SHA,
            "workflow": ORIGINAL_WORKFLOW,
            "runId": ORIGINAL_RUN_ID,
            "jobId": ORIGINAL_JOB_ID,
        },
        "adoption": {
            "sourceSha": adoption_sha,
            "workflow": workflow,
            "runId": run_id,
            "runAttempt": run_attempt,
            "sourceClosure": list(SOURCE_CLOSURE),
            "sourceClosureUnchanged": True,
        },
        "securityScan": {
            "tool": "trivy",
            "policy": {
                "ignoreUnfixed": True,
                "severity": ["HIGH", "CRITICAL"],
                "scanners": ["vuln", "secret"],
            },
            "results": [
                {"platform": name, "digest": digest, "result": "passed"}
                for name, digest in platforms.items()
            ],
        },
    }


def validate_adoption_predicate(
    value: object,
    *,
    adoption_sha: str,
    workflow: str,
    run_id: int,
    run_attempt: int,
) -> None:
    expected = adoption_predicate(
        adoption_sha=adoption_sha,
        workflow=workflow,
        run_id=run_id,
        run_attempt=run_attempt,
        index_raw=json.dumps(
            {
                "manifests": [
                    {
                        "digest": ARM64_DIGEST,
                        "platform": {"os": "linux", "architecture": "arm64"},
                    },
                    {
                        "digest": ARMV7_DIGEST,
                        "platform": {
                            "os": "linux",
                            "architecture": "arm",
                            "variant": "v7",
                        },
                    },
                ]
            }
        ).encode(),
    )
    if value != expected:
        raise AdoptionError(
            "signed adoption predicate does not match the fixed evidence"
        )


def canonical_json(value: object) -> str:
    return json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=True,
        allow_nan=False,
    )


def _parse_args(argv: Sequence[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repository-root", type=Path, required=True)
    parser.add_argument("--adoption-sha", required=True)
    parser.add_argument("--workflow", required=True)
    parser.add_argument("--run-id", type=int, required=True)
    parser.add_argument("--run-attempt", type=int, required=True)
    parser.add_argument("--index-json", type=Path, required=True)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = _parse_args(argv if argv is not None else sys.argv[1:])
    verify_source_closure(args.repository_root, ORIGINAL_SOURCE_SHA, args.adoption_sha)
    predicate = adoption_predicate(
        adoption_sha=args.adoption_sha,
        workflow=args.workflow,
        run_id=args.run_id,
        run_attempt=args.run_attempt,
        index_raw=args.index_json.read_bytes(),
    )
    sys.stdout.write(canonical_json(predicate) + "\n")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (AdoptionError, OSError) as error:
        print(f"torque component adoption failed: {error}", file=sys.stderr)
        raise SystemExit(78) from error
