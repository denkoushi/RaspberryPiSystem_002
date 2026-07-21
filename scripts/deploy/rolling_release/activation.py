"""Closed activation identities shared by coordinator and terminal adapters."""
from __future__ import annotations

import copy
import re
from collections.abc import Mapping
from datetime import datetime, timezone
from typing import Any


KIOSK_WEB_ACTIVATION_STRATEGY = "kiosk-web-activation-v1"
KIOSK_WEB_ACTIVATION_TARGET_UNIT = "kiosk-browser.service"
KIOSK_WEB_STEADY_STATE_MODE = "steady-state-browser-reload"
KIOSK_WEB_MIGRATION_MODE = "one-time-service-activation"
KIOSK_WEB_CAPABILITY_AUTHORITY = "kiosk-compiled-web-ready"

# Core planning and coordination consume capability semantics, not a concrete
# terminal profile. Profile-specific adapters may retain the historical names.
WEB_CONSUMER_ACTIVATION_STRATEGY = KIOSK_WEB_ACTIVATION_STRATEGY
WEB_CONSUMER_ACTIVATION_TARGET_UNIT = KIOSK_WEB_ACTIVATION_TARGET_UNIT
WEB_CONSUMER_STEADY_STATE_MODE = KIOSK_WEB_STEADY_STATE_MODE
WEB_CONSUMER_MIGRATION_MODE = KIOSK_WEB_MIGRATION_MODE
WEB_CONSUMER_CAPABILITY_AUTHORITY = KIOSK_WEB_CAPABILITY_AUTHORITY

_SHA_RE = re.compile(r"^[0-9a-f]{40}$")
_RUN_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{2,79}$")
_VERIFICATION_ID_RE = re.compile(r"^[0-9a-f]{32}$")
_UTC_RE = re.compile(
    r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$"
)


class ActivationUncertainError(RuntimeError):
    """An activation operation is not yet proven quiescent.

    Callers must retain maintenance and must not begin rollback while this
    error remains unresolved.
    """


def validate_activation_capabilities(
    value: Any, *, role: str, field: str
) -> dict[str, dict[str, str]]:
    if not isinstance(value, Mapping):
        raise ValueError(f"{field} must be an object")
    capabilities = copy.deepcopy(dict(value))
    if set(capabilities) - {KIOSK_WEB_ACTIVATION_STRATEGY}:
        raise ValueError(f"{field} contains an unsupported strategy")
    if capabilities and role != "kiosk":
        raise ValueError(f"{field} is valid only for the Kiosk profile")
    proof = capabilities.get(KIOSK_WEB_ACTIVATION_STRATEGY)
    if proof is None:
        return capabilities
    if not isinstance(proof, dict) or set(proof) != {
        "strategyId",
        "releaseSha",
        "verificationId",
        "proofAuthority",
        "verifiedAt",
        "lastRunId",
    }:
        raise ValueError(f"{field}.{KIOSK_WEB_ACTIVATION_STRATEGY} is malformed")
    if (
        proof.get("strategyId") != KIOSK_WEB_ACTIVATION_STRATEGY
        or not isinstance(proof.get("releaseSha"), str)
        or _SHA_RE.fullmatch(proof["releaseSha"]) is None
        or not isinstance(proof.get("verificationId"), str)
        or _VERIFICATION_ID_RE.fullmatch(proof["verificationId"]) is None
        or proof.get("proofAuthority") != KIOSK_WEB_CAPABILITY_AUTHORITY
        or not isinstance(proof.get("verifiedAt"), str)
        or _UTC_RE.fullmatch(proof["verifiedAt"]) is None
        or not isinstance(proof.get("lastRunId"), str)
        or _RUN_ID_RE.fullmatch(proof["lastRunId"]) is None
    ):
        raise ValueError(f"{field}.{KIOSK_WEB_ACTIVATION_STRATEGY} identity is malformed")
    try:
        parsed = datetime.fromisoformat(proof["verifiedAt"].replace("Z", "+00:00"))
    except ValueError as error:
        raise ValueError(
            f"{field}.{KIOSK_WEB_ACTIVATION_STRATEGY}.verifiedAt is invalid"
        ) from error
    if parsed.utcoffset() != timezone.utc.utcoffset(parsed):
        raise ValueError(
            f"{field}.{KIOSK_WEB_ACTIVATION_STRATEGY}.verifiedAt must use UTC"
        )
    return capabilities


__all__ = [
    "ActivationUncertainError",
    "KIOSK_WEB_ACTIVATION_STRATEGY",
    "KIOSK_WEB_ACTIVATION_TARGET_UNIT",
    "KIOSK_WEB_CAPABILITY_AUTHORITY",
    "KIOSK_WEB_MIGRATION_MODE",
    "KIOSK_WEB_STEADY_STATE_MODE",
    "WEB_CONSUMER_ACTIVATION_STRATEGY",
    "WEB_CONSUMER_ACTIVATION_TARGET_UNIT",
    "WEB_CONSUMER_CAPABILITY_AUTHORITY",
    "WEB_CONSUMER_MIGRATION_MODE",
    "WEB_CONSUMER_STEADY_STATE_MODE",
    "validate_activation_capabilities",
]
