"""Pure composition of observable rolling-release plans."""
from __future__ import annotations

import re
from collections.abc import Callable
from typing import Any, Iterable

from terminal_profile_registry import load_registry


Target = dict[str, str]
CanaryHoldPolicy = Callable[..., bool]
HOST_DECISION_FIELDS = (
    'host',
    'role',
    'desiredSha',
    'currentSha',
    'evidence',
    'targetReason',
    'targeted',
)
PROFILE_ID_RE = re.compile(r'^[a-z][a-z0-9-]{0,62}$')


def _public_host_decision(decision: dict[str, Any]) -> dict[str, Any]:
    return {
        'host': decision['host'],
        'role': decision['role'],
        'desiredSha': decision['desiredSha'],
        'currentSha': decision['currentSha'],
        'evidence': decision['evidence'],
        'reason': decision['targetReason'],
    }


def build_fleet_plan_payload(
    *,
    release_sha: str,
    decisions: list[dict[str, Any]],
    full_fleet: bool,
    limit: str,
    canary_hold_policy: CanaryHoldPolicy,
    profile_ids: Iterable[str] | None = None,
    reverify_selected: bool = False,
) -> dict[str, Any]:
    """Compose the fleet-aware public and persisted planning snapshot.

    ``decisions`` is already ordered by policy.  This function never re-sorts
    hosts, so the same inventory, evidence and classifications produce byte-
    stable target and explanation order at both print-plan and run time.
    """
    if type(full_fleet) is not bool:
        raise TypeError('full_fleet must be boolean')
    if type(reverify_selected) is not bool:
        raise TypeError('reverify_selected must be boolean')
    if not isinstance(decisions, list):
        raise TypeError('decisions must be a list')

    registered_profiles = frozenset(
        load_registry().profile_ids if profile_ids is None else profile_ids
    )
    if any(
        not isinstance(profile_id, str)
        or PROFILE_ID_RE.fullmatch(profile_id) is None
        or profile_id == 'server'
        for profile_id in registered_profiles
    ):
        raise ValueError('registered profile IDs are malformed')

    hosts: list[dict[str, Any]] = []
    targeted: list[dict[str, Any]] = []
    excluded: list[dict[str, Any]] = []
    terminal_targets: list[dict[str, str]] = []
    seen: set[str] = set()
    server_count = 0
    for original in decisions:
        if not isinstance(original, dict):
            raise ValueError('host decision is malformed')
        if not set(HOST_DECISION_FIELDS) <= set(original):
            raise ValueError('host decision is incomplete')
        host = original['host']
        role = original['role']
        if not isinstance(host, str) or not host or host in seen:
            raise ValueError('host decision identity is malformed or duplicated')
        if role != 'server' and role not in registered_profiles:
            raise ValueError('host decision role is unsupported')
        if type(original['targeted']) is not bool:
            raise ValueError('host decision target flag must be boolean')
        seen.add(host)
        server_count += int(role == 'server')

        decision = {key: original[key] for key in HOST_DECISION_FIELDS}
        hosts.append(decision)
        public = _public_host_decision(decision)
        if decision['targeted']:
            targeted.append(public)
            if role != 'server':
                terminal_targets.append({'host': host, 'terminalType': role})
        else:
            excluded.append(public)
    if decisions and server_count != 1:
        raise ValueError('fleet plan must contain exactly one server decision')

    canary_hold = any(
        canary_hold_policy(terminal_targets, index, skip=False)
        for index in range(len(terminal_targets))
    )
    return {
        'desiredSha': release_sha,
        'fullFleet': full_fleet,
        'reverifySelected': reverify_selected,
        'limit': limit or None,
        'pi5Required': any(
            decision['role'] == 'server' and decision['targeted']
            for decision in hosts
        ),
        'targets': targeted,
        'excluded': excluded,
        'hosts': hosts,
        'targetHosts': [decision['host'] for decision in targeted],
        'excludedHosts': [decision['host'] for decision in excluded],
        'minimized': bool(excluded),
        'canaryHold': canary_hold,
    }


def build_print_plan_payload(
    *,
    branch: str,
    inventory: str,
    limit: str,
    sha: str | None,
    classification: dict[str, Any] | None,
    pi5_required: bool | None,
    terminal_scope: dict[str, Any],
    warnings: list[str],
) -> dict[str, Any]:
    """Assemble the stable public print-plan payload without side effects."""
    return {
        'mode': 'rolling-release',
        'branch': branch,
        'inventory': inventory,
        'limit': limit or None,
        'sha': sha,
        'classification': classification,
        'pi5Required': pi5_required,
        **terminal_scope,
        'warnings': list(warnings),
    }


def build_execution_plan_payload(
    *,
    pi5_required: bool,
    targets: list[Target],
    limit: str,
    minimize_metadata: dict[str, Any],
) -> dict[str, Any]:
    """Assemble the persisted per-run plan without executing any action."""
    return {
        'pi5Required': pi5_required,
        'targets': [target['host'] for target in targets],
        'limit': limit or None,
        **minimize_metadata,
    }
