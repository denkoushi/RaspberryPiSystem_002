#!/usr/bin/env python3
"""Strict contract for one attested API/Web release and optional components."""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

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
TORQUE_AGENT_REPOSITORY = "ghcr.io/denkoushi/raspisys-torque-agent"
TORQUE_PROTOCOL_NAME = "torque-ownership"
TORQUE_PROTOCOL_VERSION = 1
TORQUE_ADOPTED_SOURCE_SHA = "3464256da11ee77bebfceb4fafcff4524f5ac8ca"
TORQUE_ORIGINAL_WORKFLOW = ".github/workflows/ci.yml"
TORQUE_ORIGINAL_RUN_ID = 32093659078
TORQUE_ORIGINAL_JOB_ID = 95581851495
TORQUE_ADOPTION_PREDICATE_TYPE = (
    "https://github.com/denkoushi/RaspberryPiSystem_002/"
    "attestations/torque-agent-component-adoption/v1"
)
TORQUE_PROTOCOL_SOURCE_CLOSURE = (
    "packages/shared-types/src/torque-wrenches",
    "apps/api/src/routes/torque-wrenches",
    "apps/api/src/routes/torque-training",
    "apps/api/src/services/torque-wrenches",
    "apps/api/src/services/torque-training",
    "apps/web/src/features/torque-wrench-connection",
    "clients/torque-agent/torque_agent/connection_lease.py",
    "clients/torque-agent/torque_agent/main.py",
    "clients/torque-agent/torque_agent/ingestor.py",
    "clients/torque-agent/torque_agent/api_client.py",
    "infrastructure/docker/Dockerfile.torque-agent",
)
TORQUE_REHEARSAL_CONTRACTS = (
    "api-usage-lease-policy",
    "api-confirmation-fencing-policy",
    "api-assembly-route-postgresql",
    "api-training-route-postgresql",
    "web-transport-controller-presentation",
    "agent-global-ownership-recovery",
)


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
class OriginalWorkflowIdentity:
    path: str
    run_id: int
    job_id: int


@dataclass(frozen=True)
class PlatformArtifact:
    operating_system: str
    architecture: str
    variant: str | None
    digest: str

    def as_document(self) -> dict[str, str]:
        result = {
            "os": self.operating_system,
            "architecture": self.architecture,
            "digest": self.digest,
        }
        if self.variant is not None:
            result["variant"] = self.variant
        return result


@dataclass(frozen=True)
class ComponentAdoption:
    predicate_type: str
    original_workflow: OriginalWorkflowIdentity

    def as_document(self) -> dict[str, object]:
        return {
            "predicateType": self.predicate_type,
            "originalWorkflow": {
                "path": self.original_workflow.path,
                "runId": self.original_workflow.run_id,
                "jobId": self.original_workflow.job_id,
            },
        }


@dataclass(frozen=True)
class TorqueAgentComponent:
    repository: str
    index_digest: str
    source_sha: str
    platforms: tuple[PlatformArtifact, ...]
    adoption: ComponentAdoption

    def as_document(self) -> dict[str, object]:
        return {
            "repository": self.repository,
            "indexDigest": self.index_digest,
            "sourceSha": self.source_sha,
            "platforms": [item.as_document() for item in self.platforms],
            "adoption": self.adoption.as_document(),
        }


@dataclass(frozen=True)
class CompatibilityRehearsal:
    workflow: WorkflowIdentity
    job: str
    result: str
    evidence_digest: str
    contracts: tuple[str, ...]

    def as_document(self) -> dict[str, object]:
        return {
            "workflow": {
                "path": self.workflow.path,
                "runId": self.workflow.run_id,
                "runAttempt": self.workflow.run_attempt,
            },
            "job": self.job,
            "result": self.result,
            "evidenceDigest": self.evidence_digest,
            "contracts": list(self.contracts),
        }


@dataclass(frozen=True)
class TorqueCompatibility:
    protocol_name: str
    protocol_version: int
    api_digest: str
    web_digest: str
    torque_agent_digest: str
    baseline_sha: str
    release_sha: str
    source_closure: tuple[str, ...]
    rehearsal: CompatibilityRehearsal

    def as_document(self) -> dict[str, object]:
        return {
            "protocol": {
                "name": self.protocol_name,
                "version": self.protocol_version,
            },
            "components": {
                "api": self.api_digest,
                "web": self.web_digest,
                "torqueAgent": self.torque_agent_digest,
            },
            "sourceClosure": {
                "baselineSha": self.baseline_sha,
                "releaseSha": self.release_sha,
                "paths": list(self.source_closure),
                "unchanged": True,
            },
            "rehearsal": self.rehearsal.as_document(),
        }


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
    torque_agent: TorqueAgentComponent | None = None
    torque_compatibility: TorqueCompatibility | None = None

    def as_document(self) -> dict[str, object]:
        document: dict[str, object] = {
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
        if self.schema_version == 2:
            if self.torque_agent is None or self.torque_compatibility is None:
                raise ReleaseArtifactError(
                    "release-set v2 is missing torque component data"
                )
            document["components"] = {
                "torqueAgent": self.torque_agent.as_document(),
            }
            document["compatibility"] = {
                "torqueOwnership": self.torque_compatibility.as_document(),
            }
        return document


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


def _positive_int(value: object) -> bool:
    return type(value) is int and value > 0


def _workflow(value: object, label: str) -> WorkflowIdentity:
    record = _exact_keys(value, {"path", "runId", "runAttempt"}, label)
    path = record["path"]
    run_id = record["runId"]
    run_attempt = record["runAttempt"]
    if (
        not isinstance(path, str)
        or WORKFLOW_RE.fullmatch(path) is None
        or not _positive_int(run_id)
        or not _positive_int(run_attempt)
    ):
        raise ReleaseArtifactError(f"{label} identity is malformed")
    return WorkflowIdentity(path, run_id, run_attempt)


def _platform_component(value: object, label: str) -> PlatformArtifact:
    if not isinstance(value, dict):
        raise ReleaseArtifactError(f"{label} identity is malformed")
    expected = {"os", "architecture", "digest"}
    if "variant" in value:
        expected.add("variant")
    record = _exact_keys(value, expected, label)
    operating_system = record["os"]
    architecture = record["architecture"]
    digest = record["digest"]
    variant = record.get("variant")
    if (
        operating_system != "linux"
        or architecture not in {"arm64", "arm"}
        or (architecture == "arm64" and variant is not None)
        or (architecture == "arm" and variant != "v7")
        or not isinstance(digest, str)
        or SHA256_RE.fullmatch(digest) is None
    ):
        raise ReleaseArtifactError(f"{label} identity is malformed")
    return PlatformArtifact(operating_system, architecture, variant, digest)


def _torque_component(value: object) -> TorqueAgentComponent:
    record = _exact_keys(
        value,
        {"repository", "indexDigest", "sourceSha", "platforms", "adoption"},
        "torque-agent component",
    )
    repository = record["repository"]
    index_digest = record["indexDigest"]
    source_sha = record["sourceSha"]
    platforms_value = record["platforms"]
    if (
        repository != TORQUE_AGENT_REPOSITORY
        or not isinstance(index_digest, str)
        or SHA256_RE.fullmatch(index_digest) is None
        or source_sha != TORQUE_ADOPTED_SOURCE_SHA
        or not isinstance(platforms_value, list)
        or len(platforms_value) != 2
    ):
        raise ReleaseArtifactError("torque-agent component identity is malformed")
    platforms = tuple(
        _platform_component(item, f"torque-agent platform {index}")
        for index, item in enumerate(platforms_value)
    )
    platform_keys = {
        (item.operating_system, item.architecture, item.variant) for item in platforms
    }
    if platform_keys != {("linux", "arm64", None), ("linux", "arm", "v7")}:
        raise ReleaseArtifactError(
            "torque-agent platforms are incomplete or duplicated"
        )

    adoption = _exact_keys(
        record["adoption"], {"predicateType", "originalWorkflow"}, "torque adoption"
    )
    predicate_type = adoption["predicateType"]
    original = _exact_keys(
        adoption["originalWorkflow"], {"path", "runId", "jobId"}, "original workflow"
    )
    if predicate_type != TORQUE_ADOPTION_PREDICATE_TYPE or original != {
        "path": TORQUE_ORIGINAL_WORKFLOW,
        "runId": TORQUE_ORIGINAL_RUN_ID,
        "jobId": TORQUE_ORIGINAL_JOB_ID,
    }:
        raise ReleaseArtifactError("torque adoption identity is malformed")
    return TorqueAgentComponent(
        repository=repository,
        index_digest=index_digest,
        source_sha=source_sha,
        platforms=platforms,
        adoption=ComponentAdoption(
            predicate_type=predicate_type,
            original_workflow=OriginalWorkflowIdentity(
                path=original["path"],
                run_id=original["runId"],
                job_id=original["jobId"],
            ),
        ),
    )


def _torque_compatibility(
    value: object,
    *,
    api_digest: str,
    web_digest: str,
    torque_digest: str,
    torque_source_sha: str,
    release_source_sha: str,
    release_workflow: WorkflowIdentity,
) -> TorqueCompatibility:
    record = _exact_keys(
        value,
        {"protocol", "components", "sourceClosure", "rehearsal"},
        "torque compatibility",
    )
    protocol = _exact_keys(record["protocol"], {"name", "version"}, "torque protocol")
    components = _exact_keys(
        record["components"], {"api", "web", "torqueAgent"}, "compatible components"
    )
    source_closure = _exact_keys(
        record["sourceClosure"],
        {"baselineSha", "releaseSha", "paths", "unchanged"},
        "protocol source closure",
    )
    rehearsal = _exact_keys(
        record["rehearsal"],
        {"workflow", "job", "result", "evidenceDigest", "contracts"},
        "rehearsal",
    )
    workflow = _workflow(rehearsal["workflow"], "rehearsal workflow")
    job = rehearsal["job"]
    evidence_digest = rehearsal["evidenceDigest"]
    if (
        protocol != {"name": TORQUE_PROTOCOL_NAME, "version": TORQUE_PROTOCOL_VERSION}
        or components
        != {"api": api_digest, "web": web_digest, "torqueAgent": torque_digest}
        or not isinstance(job, str)
        or job != "torque-release-compatibility"
        or rehearsal["result"] != "passed"
        or not isinstance(evidence_digest, str)
        or SHA256_RE.fullmatch(evidence_digest) is None
        or rehearsal["contracts"] != list(TORQUE_REHEARSAL_CONTRACTS)
        or workflow != release_workflow
        or source_closure
        != {
            "baselineSha": torque_source_sha,
            "releaseSha": release_source_sha,
            "paths": list(TORQUE_PROTOCOL_SOURCE_CLOSURE),
            "unchanged": True,
        }
    ):
        raise ReleaseArtifactError(
            "torque compatibility tuple is malformed or mismatched"
        )
    return TorqueCompatibility(
        protocol_name=TORQUE_PROTOCOL_NAME,
        protocol_version=TORQUE_PROTOCOL_VERSION,
        api_digest=api_digest,
        web_digest=web_digest,
        torque_agent_digest=torque_digest,
        baseline_sha=torque_source_sha,
        release_sha=release_source_sha,
        source_closure=TORQUE_PROTOCOL_SOURCE_CLOSURE,
        rehearsal=CompatibilityRehearsal(
            workflow=workflow,
            job=job,
            result="passed",
            evidence_digest=evidence_digest,
            contracts=TORQUE_REHEARSAL_CONTRACTS,
        ),
    )


def parse_release_set(raw: str) -> ReleaseSet:
    if len(raw.encode("utf-8")) > MAX_JSON_BYTES:
        raise ReleaseArtifactError("release set exceeds its size limit")
    try:
        document = json.loads(raw, object_pairs_hook=_strict_object)
    except (json.JSONDecodeError, UnicodeError) as error:
        raise ReleaseArtifactError("release set is not valid JSON") from error
    if not isinstance(document, dict) or type(document.get("schemaVersion")) is not int:
        raise ReleaseArtifactError("unsupported release-set schema version")
    schema_version = document["schemaVersion"]
    if schema_version not in {1, 2}:
        raise ReleaseArtifactError("unsupported release-set schema version")
    root_keys = {
        "schemaVersion",
        "source",
        "configHash",
        "platform",
        "images",
        "workflow",
    }
    if schema_version == 2:
        root_keys.update({"components", "compatibility"})
    root = _exact_keys(document, root_keys, "release set")

    source = _exact_keys(root["source"], {"repository", "sha", "ref"}, "source")
    platform = _exact_keys(root["platform"], {"os", "architecture"}, "platform")
    images = _exact_keys(root["images"], {"api", "web"}, "images")
    workflow_identity = _workflow(root["workflow"], "workflow")

    repository = source["repository"]
    sha = source["sha"]
    ref = source["ref"]
    config_hash = root["configHash"]
    if (
        not isinstance(repository, str)
        or REPOSITORY_RE.fullmatch(repository) is None
        or not isinstance(sha, str)
        or FULL_SHA_RE.fullmatch(sha) is None
        or ref != "refs/heads/main"
        or not isinstance(config_hash, str)
        or CONFIG_HASH_RE.fullmatch(config_hash) is None
        or platform != {"os": "linux", "architecture": "arm64"}
    ):
        raise ReleaseArtifactError("release-set identity is malformed")

    api = _image(images["api"], "API image")
    web = _image(images["web"], "Web image")
    torque_agent = None
    torque_compatibility = None
    if schema_version == 2:
        components = _exact_keys(root["components"], {"torqueAgent"}, "components")
        compatibility = _exact_keys(
            root["compatibility"], {"torqueOwnership"}, "compatibility"
        )
        torque_agent = _torque_component(components["torqueAgent"])
        torque_compatibility = _torque_compatibility(
            compatibility["torqueOwnership"],
            api_digest=api.digest,
            web_digest=web.digest,
            torque_digest=torque_agent.index_digest,
            torque_source_sha=torque_agent.source_sha,
            release_source_sha=sha,
            release_workflow=workflow_identity,
        )

    return ReleaseSet(
        schema_version=schema_version,
        source_repository=repository,
        source_sha=sha,
        source_ref=ref,
        config_hash=config_hash,
        operating_system="linux",
        architecture="arm64",
        api=api,
        web=web,
        workflow=workflow_identity,
        torque_agent=torque_agent,
        torque_compatibility=torque_compatibility,
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
    create.add_argument("--torque-repository")
    create.add_argument("--torque-index-digest")
    create.add_argument("--torque-source-sha")
    create.add_argument("--torque-arm64-digest")
    create.add_argument("--torque-armv7-digest")
    create.add_argument("--torque-adoption-predicate-type")
    create.add_argument("--torque-origin-workflow")
    create.add_argument("--torque-origin-run-id", type=int)
    create.add_argument("--torque-origin-job-id", type=int)
    create.add_argument("--torque-rehearsal-job")
    create.add_argument("--torque-rehearsal-evidence-digest")

    verify = subparsers.add_parser("verify")
    verify.add_argument("--repository", required=True)
    verify.add_argument("--sha", required=True)
    verify.add_argument("--config-hash", required=True)
    verify.add_argument("--workflow", required=True)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = _parse_args(argv if argv is not None else sys.argv[1:])
    if args.command == "create":
        torque_values = (
            args.torque_repository,
            args.torque_index_digest,
            args.torque_source_sha,
            args.torque_arm64_digest,
            args.torque_armv7_digest,
            args.torque_adoption_predicate_type,
            args.torque_origin_workflow,
            args.torque_origin_run_id,
            args.torque_origin_job_id,
            args.torque_rehearsal_job,
            args.torque_rehearsal_evidence_digest,
        )
        if any(value is not None for value in torque_values) and not all(
            value is not None for value in torque_values
        ):
            raise ReleaseArtifactError("release-set v2 torque inputs are incomplete")
        schema_version = 2 if all(value is not None for value in torque_values) else 1
        candidate = {
            "schemaVersion": schema_version,
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
        if schema_version == 2:
            candidate["components"] = {
                "torqueAgent": {
                    "repository": args.torque_repository,
                    "indexDigest": args.torque_index_digest,
                    "sourceSha": args.torque_source_sha,
                    "platforms": [
                        {
                            "os": "linux",
                            "architecture": "arm64",
                            "digest": args.torque_arm64_digest,
                        },
                        {
                            "os": "linux",
                            "architecture": "arm",
                            "variant": "v7",
                            "digest": args.torque_armv7_digest,
                        },
                    ],
                    "adoption": {
                        "predicateType": args.torque_adoption_predicate_type,
                        "originalWorkflow": {
                            "path": args.torque_origin_workflow,
                            "runId": args.torque_origin_run_id,
                            "jobId": args.torque_origin_job_id,
                        },
                    },
                }
            }
            candidate["compatibility"] = {
                "torqueOwnership": {
                    "protocol": {
                        "name": TORQUE_PROTOCOL_NAME,
                        "version": TORQUE_PROTOCOL_VERSION,
                    },
                    "components": {
                        "api": args.api_digest,
                        "web": args.web_digest,
                        "torqueAgent": args.torque_index_digest,
                    },
                    "sourceClosure": {
                        "baselineSha": args.torque_source_sha,
                        "releaseSha": args.sha,
                        "paths": list(TORQUE_PROTOCOL_SOURCE_CLOSURE),
                        "unchanged": True,
                    },
                    "rehearsal": {
                        "workflow": {
                            "path": args.workflow,
                            "runId": args.run_id,
                            "runAttempt": args.run_attempt,
                        },
                        "job": args.torque_rehearsal_job,
                        "result": "passed",
                        "evidenceDigest": args.torque_rehearsal_evidence_digest,
                        "contracts": list(TORQUE_REHEARSAL_CONTRACTS),
                    },
                }
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
