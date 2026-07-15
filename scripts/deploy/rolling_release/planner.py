"""Pure composition of observable rolling-release plans."""
from __future__ import annotations

from collections.abc import Callable
from typing import Any


Target = dict[str, str]
MinimizePolicy = Callable[
    [list[Target], dict[str, Any], dict[str, Any] | None],
    tuple[list[Target], dict[str, Any]],
]
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
) -> dict[str, Any]:
    """Compose the fleet-aware public and persisted planning snapshot.

    ``decisions`` is already ordered by policy.  This function never re-sorts
    hosts, so the same inventory, evidence and classifications produce byte-
    stable target and explanation order at both print-plan and run time.
    """
    if type(full_fleet) is not bool:
        raise TypeError('full_fleet must be boolean')
    if not isinstance(decisions, list):
        raise TypeError('decisions must be a list')

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
        if role not in {'server', 'kiosk', 'signage'}:
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
            if role in {'kiosk', 'signage'}:
                terminal_targets.append({'host': host, 'terminalType': role})
        else:
            excluded.append(public)
    if decisions and server_count != 1:
        raise ValueError('fleet plan must contain exactly one server decision')

    canary_hold = (
        False
        if not terminal_targets
        else canary_hold_policy(terminal_targets, 0, skip=False)
    )
    return {
        'desiredSha': release_sha,
        'fullFleet': full_fleet,
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


def plan_terminal_scope(
    terminal_targets: list[Target] | None,
    inventory: dict[str, Any],
    classification: dict[str, Any] | None,
    *,
    auto_minimize: bool,
    minimize_policy: MinimizePolicy,
    canary_hold_policy: CanaryHoldPolicy,
) -> dict[str, Any]:
    """Return the deterministic terminal portion of a print plan.

    The policy callables are injected by the compatibility facade.  Besides
    keeping this module free of I/O, that preserves existing tests and callers
    that patch facade attributes while the monolith is split incrementally.
    """
    planned_targets = terminal_targets
    minimized = False
    excluded_hosts: list[str] = []
    classification_components = (
        list(classification.get('components') or []) if classification is not None else None
    )

    if auto_minimize and planned_targets is not None:
        planned_targets, minimize_meta = minimize_policy(
            planned_targets,
            inventory,
            classification,
        )
        excluded_hosts = list(minimize_meta.get('excludedHosts') or [])
        minimized = bool(minimize_meta.get('minimized'))
        classification_components = minimize_meta.get('classificationComponents')

    canary_hold = (
        None
        if planned_targets is None
        else canary_hold_policy(planned_targets, 0, skip=False)
    )
    return {
        'terminalTargets': planned_targets,
        'canaryHold': canary_hold,
        'autoMinimize': auto_minimize,
        'minimized': minimized,
        'excludedHosts': excluded_hosts,
        'classificationComponents': classification_components,
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
