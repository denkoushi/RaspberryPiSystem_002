"""Closed, strictly validated release identities for durable deploy state.

Legacy fleet fields remain the mutation-decision authority during the staged
migration.  This module validates typed records, projects independently
verified legacy evidence, and keeps each ACK authority bound to one identity
kind.  SSH finalization may persist a complete claim set while older records
continue through the compatibility adapter.
"""

from __future__ import annotations

import copy
import re
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime, timezone
from enum import Enum
from typing import Any

from .image_refs import image_matches_release


FULL_SHA_RE = re.compile(r"^[0-9a-f]{40}$")
DIGEST_RE = re.compile(r"^sha256:[0-9a-f]{64}$")
VERIFICATION_ID_RE = re.compile(r"^[0-9a-f]{32}$")
RUN_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{2,79}$")
UTC_TIMESTAMP_RE = re.compile(
    r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$"
)


class ReleaseClaimError(ValueError):
    """A release claim violates the closed durable-state contract."""


class ClaimKind(str, Enum):
    CONTROL_PLANE_API = "controlPlaneApi"
    CONTROL_PLANE_WEB = "controlPlaneWeb"
    TERMINAL_REPOSITORY = "terminalRepository"
    LOCAL_ARTIFACT = "localArtifact"
    RUNTIME = "runtime"


class IdentityDomain(str, Enum):
    GIT_SHA = "gitSha"
    SHA256 = "sha256"


class ClaimAuthority(str, Enum):
    PI5_API_IMAGE = "pi5-api-image"
    PI5_WEB_IMAGE = "pi5-web-image"
    KIOSK_COMPILED_WEB_READY = "kiosk-compiled-web-ready"
    TERMINAL_REPOSITORY_PROBE = "terminal-repository-probe"
    SIGNAGE_READY = "signage-ready"
    LOCAL_RUNNER_READY = "local-runner-ready"
    LOCAL_RUNTIME_PREFLIGHT = "local-runtime-preflight"


class ClaimState(str, Enum):
    UNKNOWN = "unknown"
    VERIFIED = "verified"


CLAIM_FIELDS = frozenset(
    {
        "expectedIdentity",
        "observedIdentity",
        "authority",
        "verificationId",
        "state",
        "observedAt",
        "lastRunId",
    }
)

_IDENTITY_DOMAIN_BY_KIND = {
    ClaimKind.CONTROL_PLANE_API: IdentityDomain.GIT_SHA,
    ClaimKind.CONTROL_PLANE_WEB: IdentityDomain.GIT_SHA,
    ClaimKind.TERMINAL_REPOSITORY: IdentityDomain.GIT_SHA,
    ClaimKind.LOCAL_ARTIFACT: IdentityDomain.SHA256,
    ClaimKind.RUNTIME: IdentityDomain.SHA256,
}

_KINDS_BY_AUTHORITY = {
    ClaimAuthority.PI5_API_IMAGE: frozenset({ClaimKind.CONTROL_PLANE_API}),
    ClaimAuthority.PI5_WEB_IMAGE: frozenset({ClaimKind.CONTROL_PLANE_WEB}),
    ClaimAuthority.KIOSK_COMPILED_WEB_READY: frozenset(
        {ClaimKind.CONTROL_PLANE_WEB}
    ),
    ClaimAuthority.TERMINAL_REPOSITORY_PROBE: frozenset(
        {ClaimKind.TERMINAL_REPOSITORY}
    ),
    ClaimAuthority.SIGNAGE_READY: frozenset({ClaimKind.TERMINAL_REPOSITORY}),
    ClaimAuthority.LOCAL_RUNNER_READY: frozenset({ClaimKind.LOCAL_ARTIFACT}),
    ClaimAuthority.LOCAL_RUNTIME_PREFLIGHT: frozenset({ClaimKind.RUNTIME}),
}

_ACK_AUTHORITIES = frozenset(
    {
        ClaimAuthority.KIOSK_COMPILED_WEB_READY,
        ClaimAuthority.SIGNAGE_READY,
        ClaimAuthority.LOCAL_RUNNER_READY,
    }
)


def _enum_value(enum_type: type[Enum], value: Any, *, field: str) -> Enum:
    try:
        return enum_type(value)
    except (TypeError, ValueError) as error:
        raise ReleaseClaimError(f"{field} is unsupported") from error


def _validate_identity(value: Any, domain: IdentityDomain, *, field: str) -> str:
    pattern = FULL_SHA_RE if domain is IdentityDomain.GIT_SHA else DIGEST_RE
    if not isinstance(value, str) or pattern.fullmatch(value) is None:
        expected = (
            "a full lowercase Git SHA"
            if domain is IdentityDomain.GIT_SHA
            else "a full sha256 digest"
        )
        raise ReleaseClaimError(f"{field} must be {expected}")
    return value


def _validate_timestamp(value: Any, *, field: str) -> str:
    if not isinstance(value, str) or UTC_TIMESTAMP_RE.fullmatch(value) is None:
        raise ReleaseClaimError(
            f"{field} must be a UTC timestamp with second precision"
        )
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise ReleaseClaimError(f"{field} is not a valid timestamp") from error
    if parsed.utcoffset() != timezone.utc.utcoffset(parsed):
        raise ReleaseClaimError(f"{field} must use UTC")
    return value


@dataclass(frozen=True)
class ReleaseClaim:
    """One expected identity and the authority permitted to observe it."""

    kind: ClaimKind
    expected_identity: str
    observed_identity: str | None
    authority: ClaimAuthority
    verification_id: str | None
    state: ClaimState
    observed_at: str | None
    last_run_id: str | None

    def __post_init__(self) -> None:
        kind = _enum_value(ClaimKind, self.kind, field="claim kind")
        authority = _enum_value(
            ClaimAuthority, self.authority, field="claim authority"
        )
        state = _enum_value(ClaimState, self.state, field="claim state")
        object.__setattr__(self, "kind", kind)
        object.__setattr__(self, "authority", authority)
        object.__setattr__(self, "state", state)

        if kind not in _KINDS_BY_AUTHORITY[authority]:
            raise ReleaseClaimError(
                f"authority {authority.value!r} cannot observe {kind.value!r}"
            )
        domain = _IDENTITY_DOMAIN_BY_KIND[kind]
        _validate_identity(
            self.expected_identity, domain, field=f"{kind.value}.expectedIdentity"
        )
        if self.observed_identity is not None:
            _validate_identity(
                self.observed_identity,
                domain,
                field=f"{kind.value}.observedIdentity",
            )

        if self.verification_id is not None and (
            not isinstance(self.verification_id, str)
            or VERIFICATION_ID_RE.fullmatch(self.verification_id) is None
        ):
            raise ReleaseClaimError(
                f"{kind.value}.verificationId must be 32 lowercase hex"
            )
        if authority in _ACK_AUTHORITIES:
            if self.observed_identity is not None and self.verification_id is None:
                raise ReleaseClaimError(
                    f"{kind.value} ACK observation requires verificationId"
                )
        elif self.verification_id is not None:
            raise ReleaseClaimError(
                f"{kind.value} non-ACK authority cannot retain verificationId"
            )

        if self.observed_at is not None:
            _validate_timestamp(
                self.observed_at, field=f"{kind.value}.observedAt"
            )
            if self.observed_identity is None:
                raise ReleaseClaimError(
                    f"{kind.value}.observedAt requires observedIdentity"
                )
        elif self.observed_identity is not None:
            raise ReleaseClaimError(
                f"{kind.value}.observedIdentity requires observedAt"
            )

        if self.last_run_id is not None and (
            not isinstance(self.last_run_id, str)
            or RUN_ID_RE.fullmatch(self.last_run_id) is None
        ):
            raise ReleaseClaimError(f"{kind.value}.lastRunId is malformed")

        if state is ClaimState.VERIFIED:
            if self.observed_identity != self.expected_identity:
                raise ReleaseClaimError(
                    f"{kind.value} verified identity must match expectedIdentity"
                )
            if self.observed_at is None or self.last_run_id is None:
                raise ReleaseClaimError(
                    f"{kind.value} verified claim requires observedAt and lastRunId"
                )

    @property
    def identity_domain(self) -> IdentityDomain:
        return _IDENTITY_DOMAIN_BY_KIND[self.kind]

    @classmethod
    def from_record(
        cls, kind: ClaimKind | str, payload: Mapping[str, Any]
    ) -> ReleaseClaim:
        if not isinstance(payload, Mapping):
            raise ReleaseClaimError("release claim must be an object")
        record = copy.deepcopy(dict(payload))
        if set(record) != CLAIM_FIELDS:
            raise ReleaseClaimError("release claim fields do not match the schema")
        return cls(
            kind=kind,
            expected_identity=record["expectedIdentity"],
            observed_identity=record["observedIdentity"],
            authority=record["authority"],
            verification_id=record["verificationId"],
            state=record["state"],
            observed_at=record["observedAt"],
            last_run_id=record["lastRunId"],
        )

    def to_record(self) -> dict[str, Any]:
        return {
            "expectedIdentity": self.expected_identity,
            "observedIdentity": self.observed_identity,
            "authority": self.authority.value,
            "verificationId": self.verification_id,
            "state": self.state.value,
            "observedAt": self.observed_at,
            "lastRunId": self.last_run_id,
        }


def validate_release_claims(
    payload: Any, *, field: str = "releaseClaims"
) -> dict[str, dict[str, Any]]:
    """Validate one bounded kind-keyed claim object and return a deep copy."""

    if not isinstance(payload, Mapping):
        raise ReleaseClaimError(f"{field} must be an object")
    if len(payload) > len(ClaimKind):
        raise ReleaseClaimError(f"{field} exceeds the closed claim-kind bound")
    claims: dict[str, dict[str, Any]] = {}
    for raw_kind, raw_claim in payload.items():
        if not isinstance(raw_kind, str):
            raise ReleaseClaimError(f"{field} keys must be strings")
        kind = _enum_value(ClaimKind, raw_kind, field=f"{field} claim kind")
        claim = ReleaseClaim.from_record(kind, raw_claim)
        claims[kind.value] = claim.to_record()
    return claims


def project_legacy_host_claims(record: Mapping[str, Any]) -> dict[str, dict[str, Any]]:
    """Project only evidence the legacy host record already proved directly.

    A terminal record proves its repository HEAD, not the Web bundle held by a
    Kiosk browser. A verified Pi5 record proves its two immutable images. No
    projection is made from unknown evidence, and rollback drift remains an
    unknown expected claim with its independently observed identity retained.
    """

    if not isinstance(record, Mapping) or record.get("evidence") != "verified":
        return {}
    desired = record.get("desiredSha")
    current = record.get("currentSha")
    observed_at = record.get("verifiedAt")
    last_run_id = record.get("lastRunId")
    if not all(
        isinstance(value, str)
        for value in (desired, current, observed_at, last_run_id)
    ):
        return {}
    state = ClaimState.VERIFIED if desired == current else ClaimState.UNKNOWN

    def projected(kind: ClaimKind, authority: ClaimAuthority) -> dict[str, Any]:
        return ReleaseClaim(
            kind=kind,
            expected_identity=desired,
            observed_identity=current,
            authority=authority,
            verification_id=None,
            state=state,
            observed_at=observed_at,
            last_run_id=last_run_id,
        ).to_record()

    role = record.get("role")
    if role == "server":
        if (
            record.get("activeSlot") not in {"blue", "green"}
            or not image_matches_release(record.get("apiImage"), current)
            or not image_matches_release(record.get("webImage"), current)
            or not isinstance(record.get("configDigest"), str)
            or DIGEST_RE.fullmatch(record["configDigest"]) is None
            or not isinstance(record.get("migrationDigest"), str)
            or DIGEST_RE.fullmatch(record["migrationDigest"]) is None
        ):
            return {}
        return {
            ClaimKind.CONTROL_PLANE_API.value: projected(
                ClaimKind.CONTROL_PLANE_API, ClaimAuthority.PI5_API_IMAGE
            ),
            ClaimKind.CONTROL_PLANE_WEB.value: projected(
                ClaimKind.CONTROL_PLANE_WEB, ClaimAuthority.PI5_WEB_IMAGE
            ),
        }
    if not isinstance(role, str) or not role:
        return {}
    return {
        ClaimKind.TERMINAL_REPOSITORY.value: projected(
            ClaimKind.TERMINAL_REPOSITORY,
            ClaimAuthority.TERMINAL_REPOSITORY_PROBE,
        )
    }


def release_claims_for_host(record: Mapping[str, Any]) -> dict[str, dict[str, Any]]:
    """Read explicit claims or adapt one legacy host record without mutation."""

    if not isinstance(record, Mapping):
        raise ReleaseClaimError("host record must be an object")
    if "releaseClaims" in record:
        claims = validate_release_claims(record["releaseClaims"])
        validate_host_claim_compatibility(record, claims)
        return claims
    return project_legacy_host_claims(record)


def validate_host_claim_compatibility(
    record: Mapping[str, Any], claims: Mapping[str, Mapping[str, Any]]
) -> None:
    """Reject mixed records that disagree with overlapping legacy identities."""

    role = record.get("role")
    overlapping = (
        (ClaimKind.CONTROL_PLANE_API, ClaimKind.CONTROL_PLANE_WEB)
        if role == "server"
        else (ClaimKind.TERMINAL_REPOSITORY,)
    )
    for kind in overlapping:
        claim = claims.get(kind.value)
        if claim is None:
            continue
        expected_identity = claim.get("expectedIdentity")
        legacy_desired = record.get("desiredSha")
        rollback_expected = (
            role != "server"
            and kind is ClaimKind.TERMINAL_REPOSITORY
            and claim.get("observedIdentity") == expected_identity
            and expected_identity == record.get("previousSha")
        )
        if expected_identity != legacy_desired and not rollback_expected:
            raise ReleaseClaimError(
                f"{kind.value}.expectedIdentity disagrees with legacy desiredSha"
            )
        legacy_current = record.get("currentSha")
        if (
            legacy_current is not None
            and claim.get("observedIdentity") != legacy_current
        ):
            raise ReleaseClaimError(
                f"{kind.value}.observedIdentity disagrees with legacy currentSha"
            )
