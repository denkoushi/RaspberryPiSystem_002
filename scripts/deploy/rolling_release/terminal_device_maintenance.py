"""Pure contract for short-lived terminal peripheral maintenance leases."""
from __future__ import annotations

import datetime as dt
import json
import re
from dataclasses import dataclass
from typing import Mapping


AGENTS = ("nfc-agent", "barcode-agent", "torque-agent")
STATUS_AGENT_NAMES = {
    "nfc": "nfc-agent",
    "barcode": "barcode-agent",
    "torque": "torque-agent",
}
MAX_REMAINING = dt.timedelta(days=7)
_REASON_CODE_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")
_UTC_TIMESTAMP_RE = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$")


class MaintenanceLeaseError(ValueError):
    """The inventory lease cannot safely suppress a required health proof."""


@dataclass(frozen=True)
class MaintenanceLease:
    agent: str
    reason_code: str
    expires_at: dt.datetime

    def evidence(self) -> dict[str, str]:
        return {
            "agent": self.agent,
            "reasonCode": self.reason_code,
            "expiresAt": self.expires_at.strftime("%Y-%m-%dT%H:%M:%SZ"),
        }


def _utc_now(now: dt.datetime | None) -> dt.datetime:
    current = now or dt.datetime.now(dt.timezone.utc)
    if current.tzinfo is None:
        raise MaintenanceLeaseError("maintenance lease clock must be timezone-aware")
    return current.astimezone(dt.timezone.utc)


def _expiry(value: object) -> dt.datetime:
    if not isinstance(value, str) or _UTC_TIMESTAMP_RE.fullmatch(value) is None:
        raise MaintenanceLeaseError("maintenance lease expiry must be strict UTC")
    try:
        return dt.datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(
            tzinfo=dt.timezone.utc
        )
    except ValueError as error:
        raise MaintenanceLeaseError("maintenance lease expiry is invalid") from error


def parse_active_leases(
    value: object,
    *,
    now: dt.datetime | None = None,
) -> dict[str, MaintenanceLease]:
    """Validate all leases and return only those whose expiry is still future."""

    if value is None:
        return {}
    if not isinstance(value, Mapping):
        raise MaintenanceLeaseError("terminal maintenance leases must be an object")
    unknown_agents = set(value) - set(AGENTS)
    if unknown_agents:
        raise MaintenanceLeaseError("terminal maintenance lease agent is unknown")

    current = _utc_now(now)
    active: dict[str, MaintenanceLease] = {}
    for agent in AGENTS:
        if agent not in value:
            continue
        raw = value[agent]
        if not isinstance(raw, Mapping) or set(raw) != {"reasonCode", "expiresAt"}:
            raise MaintenanceLeaseError("maintenance lease fields are malformed")
        reason = raw.get("reasonCode")
        if not isinstance(reason, str) or _REASON_CODE_RE.fullmatch(reason) is None:
            raise MaintenanceLeaseError("maintenance lease reason code is malformed")
        expires_at = _expiry(raw.get("expiresAt"))
        if expires_at <= current:
            continue
        if expires_at - current > MAX_REMAINING:
            raise MaintenanceLeaseError("maintenance lease exceeds seven days")
        active[agent] = MaintenanceLease(agent, reason, expires_at)
    return active


def parse_active_leases_json(
    raw: object,
    *,
    now: dt.datetime | None = None,
) -> dict[str, MaintenanceLease]:
    if not isinstance(raw, str):
        raise MaintenanceLeaseError("terminal maintenance lease JSON must be a string")
    try:
        value = json.loads(
            raw,
            object_pairs_hook=_reject_duplicate_keys,
            parse_constant=lambda constant: (_ for _ in ()).throw(
                ValueError(f"invalid JSON constant: {constant}")
            ),
        )
    except (json.JSONDecodeError, ValueError) as error:
        raise MaintenanceLeaseError("terminal maintenance lease JSON is malformed") from error
    return parse_active_leases(value, now=now)


def _reject_duplicate_keys(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON key")
        result[key] = value
    return result
