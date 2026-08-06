"""One explicit Pi3 display-artifact release scope outside core planning."""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any


RELEASE_SCOPE = "pi3-signage-artifact"
PROFILE_ID = "signage"
TARGET_CLIENT_ID = "raspberrypi3-signage1"
ARTIFACT_REPOSITORY = "ghcr.io/denkoushi/raspisys-pi3-signage"
FULL_SHA_RE = re.compile(r"^[0-9a-f]{40}$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
OCI_DIGEST_RE = re.compile(r"^sha256:[0-9a-f]{64}$")


@dataclass(frozen=True)
class ScopeRequest:
    source_sha: str
    oci_digest: str
    artifact_sha256: str
    manifest_sha256: str
    payload_digest: str

    @property
    def scope(self) -> str:
        return RELEASE_SCOPE

    def planning_options(self) -> dict[str, str]:
        return {
            "release_scope": self.scope,
            "signage_oci_digest": self.oci_digest,
            "signage_artifact_sha256": self.artifact_sha256,
            "signage_manifest_sha256": self.manifest_sha256,
            "signage_payload_digest": self.payload_digest,
        }


def request_from_args(args: Any) -> ScopeRequest | None:
    scope = getattr(args, "release_scope", None)
    if scope is None:
        return None
    values = ScopeRequest(
        source_sha=getattr(args, "signage_source_sha", None),
        oci_digest=getattr(args, "signage_oci_digest", None),
        artifact_sha256=getattr(args, "signage_artifact_sha256", None),
        manifest_sha256=getattr(args, "signage_manifest_sha256", None),
        payload_digest=getattr(args, "signage_payload_digest", None),
    )
    if (
        scope != RELEASE_SCOPE
        or not isinstance(values.source_sha, str)
        or FULL_SHA_RE.fullmatch(values.source_sha) is None
        or not isinstance(values.oci_digest, str)
        or OCI_DIGEST_RE.fullmatch(values.oci_digest) is None
        or any(
            not isinstance(value, str) or SHA256_RE.fullmatch(value) is None
            for value in (
                values.artifact_sha256,
                values.manifest_sha256,
                values.payload_digest,
            )
        )
    ):
        raise RuntimeError("Pi3 artifact release scope input is not authoritative")
    return values


def target_hosts(
    request: ScopeRequest | None, all_hosts: list[dict[str, str]]
) -> list[dict[str, str]]:
    if request is None:
        return all_hosts
    targets = [target for target in all_hosts if target.get("role") == PROFILE_ID]
    if len(targets) != 1 or targets[0].get("clientId") != TARGET_CLIENT_ID:
        raise RuntimeError("Pi3 artifact release scope target is not authoritative")
    return targets


def validate_locked_plan(
    plan: dict[str, Any],
    targets: list[dict[str, str]],
    request: ScopeRequest,
    *,
    coordinator_host: str,
    target_host: str,
) -> dict[str, Any]:
    """Reject identity drift or foreign work before device mutation."""

    desired = plan.get("desiredRelease")
    expected_fields = {
        "releaseScope",
        "sourceSha",
        "exactReference",
        "ociDigest",
        "artifactSha256",
        "manifestSha256",
        "payloadDigest",
        "claimIdentity",
    }
    if (
        plan.get("releaseScope") != request.scope
        or not isinstance(desired, dict)
        or set(desired) != expected_fields
        or desired.get("releaseScope") != request.scope
        or desired.get("sourceSha") != request.source_sha
        or desired.get("ociDigest") != request.oci_digest
        or desired.get("exactReference")
        != f"{ARTIFACT_REPOSITORY}@{request.oci_digest}"
        or desired.get("artifactSha256") != request.artifact_sha256
        or desired.get("manifestSha256") != request.manifest_sha256
        or desired.get("payloadDigest") != request.payload_digest
        or desired.get("claimIdentity")
        != f"git:{request.source_sha}@sha256:{request.artifact_sha256}"
    ):
        raise RuntimeError("locked Pi3 artifact release authority is inconsistent")

    hosts = plan.get("hosts")
    coordinator = plan.get("coordinator")
    if (
        plan.get("pi5Required") is not False
        or not isinstance(hosts, list)
        or len(hosts) != 2
        or {
            (item.get("host"), item.get("role"))
            for item in hosts
            if isinstance(item, dict)
        }
        != {(coordinator_host, "server"), (target_host, PROFILE_ID)}
        or coordinator
        != {
            "host": coordinator_host,
            "role": "acquisition-relay",
            "runtimeMutationRequired": False,
        }
    ):
        raise RuntimeError("locked Pi3 artifact release scope is inconsistent")

    for field in (
        "terminalWork",
        "mutationTargets",
        "activationTargets",
        "verificationTargets",
        "terminalTargets",
    ):
        work = plan.get(field)
        if not isinstance(work, list) or any(
            not isinstance(item, dict)
            or item.get("host") != target_host
            or item.get("role") != PROFILE_ID
            for item in work
        ):
            raise RuntimeError("locked Pi3 artifact release scope generated foreign work")
    if any(
        target.get("host") != target_host or target.get("role") != PROFILE_ID
        for target in targets
    ):
        raise RuntimeError("locked Pi3 artifact release scope generated foreign targets")
    return dict(desired)
