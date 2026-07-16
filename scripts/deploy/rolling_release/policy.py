"""Pure rollout policy decisions.

This module deliberately performs no filesystem, subprocess, network, or
clock access.  Callers supply observed inventory and classification data and
receive deterministic targets plus auditable reasons.
"""
from __future__ import annotations

import re
from collections.abc import Mapping
from typing import Any, Iterable

try:  # Normal package import.
    from .image_refs import image_matches_release
except ImportError:  # Direct pure-module contract tests load this file by path.
    from rolling_release.image_refs import image_matches_release


# Kiosk-scoped components used by the existing opt-in minimization policy.
# Default minimization and durable fleet evidence belong to PR 5; PR 4 only
# moves the accepted behavior behind an explicit pure boundary.
KIOSK_SCOPE_COMPONENTS = frozenset({
    'nfc-agent',
    'barcode-agent',
    'status-agent',
    'kiosk-role',
    'client-role',
})
RELEASE_ROLES = frozenset({'server', 'kiosk', 'signage'})
FULL_SHA_RE = re.compile(r'^[0-9a-f]{40}$')
SHA256_RE = re.compile(r'^sha256:[0-9a-f]{64}$')

REASON_FULL_FLEET = 'full fleet requested'
REASON_STATE_MISSING = 'fleet record missing'
REASON_ROLE_MISMATCH = 'fleet role mismatch'
REASON_EVIDENCE_UNKNOWN = 'evidence unknown'
REASON_EVIDENCE_INCOMPLETE = 'verified evidence incomplete'
REASON_CLASSIFICATION_UNAVAILABLE = 'classification unavailable'
REASON_DESIRED_STALE = 'desired SHA differs from role-specific plan'
REASON_VERIFIED_DESIRED = 'verified at desired SHA'


def _group_hosts(
    inventory: dict[str, Any],
    group: str,
    *,
    exactly_one: bool = False,
) -> list[str]:
    group_data = inventory.get(group, {})
    if not isinstance(group_data, dict):
        raise RuntimeError(f'inventory {group} group is malformed')
    values = group_data.get('hosts', [])
    if (
        not isinstance(values, list)
        or any(not isinstance(host, str) or not host for host in values)
        or len(values) != len(set(values))
    ):
        raise RuntimeError(f'inventory {group} group is malformed')
    if exactly_one and len(values) != 1:
        raise RuntimeError(f'inventory {group} group must contain exactly one host')
    return values


def server_identity(inventory: dict[str, Any]) -> dict[str, str]:
    """Return the immutable inventory identity of the one Pi5 authority."""

    if not isinstance(inventory, dict):
        raise RuntimeError('inventory is malformed')
    metadata = inventory.get('_meta', {})
    hostvars = metadata.get('hostvars', {}) if isinstance(metadata, dict) else {}
    if not isinstance(hostvars, dict):
        raise RuntimeError('inventory hostvars are malformed')
    hosts = _group_hosts(inventory, 'server', exactly_one=True)
    host = hosts[0]
    values = hostvars.get(host)
    client_id = values.get('status_agent_client_id') if isinstance(values, dict) else None
    if not isinstance(client_id, str) or not re.fullmatch(
        r'[A-Za-z0-9][A-Za-z0-9._:-]{0,127}', client_id
    ):
        raise RuntimeError(f'server host {host} is missing a safe status_agent_client_id')
    return {'host': host, 'clientId': client_id}


def release_hosts(
    inventory: dict[str, Any],
    selected: Iterable[str] | None = None,
) -> list[dict[str, str]]:
    """Return the strict full release inventory in execution order.

    The server is deliberately separate from terminal execution, but it is a
    first-class planning target.  Requiring exactly one server prevents a
    terminal-only selection from hiding an ambiguous Pi5 authority.
    """
    terminal_targets = release_targets(inventory)
    metadata = inventory.get('_meta', {}) if isinstance(inventory, dict) else {}
    hostvars = metadata.get('hostvars', {}) if isinstance(metadata, dict) else {}
    server_hosts = _group_hosts(inventory, 'server', exactly_one=True)
    server_host = server_hosts[0]
    if server_host not in hostvars:
        raise RuntimeError(f'server host {server_host} is missing inventory hostvars')

    terminal_hosts = {target['host'] for target in terminal_targets}
    if server_host in terminal_hosts:
        raise RuntimeError('server, kiosk and signage groups must be disjoint')

    all_hosts: list[dict[str, str]] = [
        {'host': server_host, 'role': 'server'},
        *(
            {
                **target,
                'role': target['terminalType'],
            }
            for target in terminal_targets
        ),
    ]
    if selected is None:
        return all_hosts

    selected_values = list(selected)
    if (
        any(not isinstance(host, str) or not host for host in selected_values)
        or len(selected_values) != len(set(selected_values))
    ):
        raise RuntimeError('selected release hosts are malformed or duplicated')
    known = {target['host'] for target in all_hosts}
    unexpected = sorted(set(selected_values) - known)
    if unexpected:
        raise RuntimeError(
            'selected hosts are not release targets: ' + ', '.join(unexpected)
        )
    selected_set = set(selected_values)
    return [target for target in all_hosts if target['host'] in selected_set]


def _valid_sha(value: Any) -> str | None:
    return value if isinstance(value, str) and FULL_SHA_RE.fullmatch(value) else None


def _valid_classification(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        return None
    boolean_fields = ('server', 'kiosk', 'signage', 'migration')
    if any(type(value.get(field)) is not bool for field in boolean_fields):
        return None
    components = value.get('components')
    if (
        not isinstance(components, list)
        or any(not isinstance(component, str) or not component for component in components)
    ):
        return None
    return value


def _role_impacted(
    role: str,
    host: str,
    classification: dict[str, Any] | None,
    inventory: dict[str, Any],
) -> bool:
    normalized = _valid_classification(classification)
    if normalized is None:
        return True
    components = set(normalized['components'])
    if components & {'unknown', 'global'}:
        return True
    if role == 'server':
        return normalized['server'] or normalized['migration']
    if role == 'signage':
        return normalized['signage']
    if role != 'kiosk':
        return True
    if not normalized['kiosk']:
        return False

    kiosk_components = components & KIOSK_SCOPE_COMPONENTS
    if kiosk_components != {'barcode-agent'}:
        return True
    metadata = inventory.get('_meta', {}) if isinstance(inventory, dict) else {}
    hostvars = metadata.get('hostvars', {}) if isinstance(metadata, dict) else {}
    values = hostvars.get(host) if isinstance(hostvars, dict) else None
    # A missing ownership fact can never justify excluding the kiosk.
    return not isinstance(values, dict) or values.get('barcode_agent_enabled') is True


def _impact_reason(role: str, classification: dict[str, Any] | None) -> str:
    normalized = _valid_classification(classification)
    if normalized is None:
        return REASON_CLASSIFICATION_UNAVAILABLE
    components = sorted(set(normalized['components']))
    if 'unknown' in components:
        return 'unknown release impact'
    if 'global' in components:
        return 'global release impact'
    if role == 'server' and normalized['migration']:
        return 'server impact: migration'
    relevant = ','.join(component for component in components if component != 'neutral')
    return f'{role} impact: {relevant or "classified change"}'


def _server_evidence_complete(record: Mapping[str, Any]) -> bool:
    current = _valid_sha(record.get('currentSha'))

    def image_matches(value: Any) -> bool:
        return bool(current and image_matches_release(value, current))

    return bool(
        record.get('activeSlot') in {'blue', 'green'}
        and image_matches(record.get('apiImage'))
        and image_matches(record.get('webImage'))
        and isinstance(record.get('configDigest'), str)
        and SHA256_RE.fullmatch(record['configDigest'])
        and isinstance(record.get('migrationDigest'), str)
        and SHA256_RE.fullmatch(record['migrationDigest'])
    )


def _observed_host(
    record: Any,
    role: str,
) -> tuple[str | None, str | None, str, str | None]:
    """Return current, recorded desired, public evidence, and unsafe reason."""
    if not isinstance(record, Mapping):
        return None, None, 'unknown', REASON_STATE_MISSING
    current = _valid_sha(record.get('currentSha'))
    desired = _valid_sha(record.get('desiredSha'))
    if record.get('role') != role:
        return current, desired, 'unknown', REASON_ROLE_MISMATCH
    if record.get('evidence') != 'verified':
        return current, desired, 'unknown', REASON_EVIDENCE_UNKNOWN
    complete = bool(
        current
        and desired
        and isinstance(record.get('verifiedAt'), str)
        and record['verifiedAt']
        and isinstance(record.get('lastRunId'), str)
        and record['lastRunId']
    )
    if role == 'server':
        complete = complete and _server_evidence_complete(record)
    if not complete:
        return current, desired, 'unknown', REASON_EVIDENCE_INCOMPLETE
    return current, desired, 'verified', None


def plan_target_decisions(
    targets: list[dict[str, Any]],
    fleet: Mapping[str, Any],
    release_sha: str,
    classifications_by_sha: Mapping[str, dict[str, Any] | None],
    inventory: dict[str, Any],
    *,
    full_fleet: bool = False,
) -> list[dict[str, Any]]:
    """Decide one ordered fleet scope using only supplied, durable evidence.

    Classifications are keyed by each verified host's current SHA.  Callers can
    therefore memoize one Git diff for hosts that share a baseline, while a
    partial release with divergent host SHAs remains safe and deterministic.
    """
    if _valid_sha(release_sha) is None:
        raise ValueError('release SHA must be 40 lowercase hexadecimal characters')
    if type(full_fleet) is not bool:
        raise TypeError('full_fleet must be boolean')
    fleet_records: Mapping[str, Any] = fleet if isinstance(fleet, Mapping) else {}
    classifications: Mapping[str, Any] = (
        classifications_by_sha if isinstance(classifications_by_sha, Mapping) else {}
    )

    decisions: list[dict[str, Any]] = []
    seen: set[str] = set()
    for target in targets:
        if not isinstance(target, dict):
            raise RuntimeError('release target is malformed')
        host = target.get('host')
        role = target.get('role')
        if (
            not isinstance(host, str)
            or not host
            or role not in RELEASE_ROLES
            or host in seen
        ):
            raise RuntimeError('release target identity is malformed or duplicated')
        seen.add(host)

        current, recorded_desired, evidence, unsafe_reason = _observed_host(
            fleet_records.get(host), role
        )
        if full_fleet:
            desired = release_sha
            targeted = True
            reason = REASON_FULL_FLEET
        elif evidence != 'verified' or current is None or recorded_desired is None:
            desired = release_sha
            targeted = True
            reason = unsafe_reason or REASON_EVIDENCE_UNKNOWN
        elif current == release_sha:
            desired = release_sha
            targeted = recorded_desired != desired
            reason = REASON_DESIRED_STALE if targeted else REASON_VERIFIED_DESIRED
        else:
            classification = classifications.get(current)
            impacted = _role_impacted(role, host, classification, inventory)
            desired = release_sha if impacted else current
            if current != desired:
                targeted = True
                reason = _impact_reason(role, classification)
            elif recorded_desired != desired:
                targeted = True
                reason = REASON_DESIRED_STALE
            else:
                targeted = False
                reason = f'verified; no {role}-impacting changes'

        decisions.append({
            'host': host,
            'role': role,
            'desiredSha': desired,
            'currentSha': current,
            'evidence': evidence,
            'targetReason': reason,
            'targeted': targeted,
        })
    return decisions


def release_targets(
    inventory: dict[str, Any],
    selected: Iterable[str] | None = None,
) -> list[dict[str, str]]:
    """Return canary kiosk, remaining kiosks, then signage in inventory order."""
    if not isinstance(inventory, dict):
        raise RuntimeError('inventory is malformed')
    metadata = inventory.get('_meta', {})
    if not isinstance(metadata, dict):
        raise RuntimeError('inventory metadata are malformed')
    hosts = metadata.get('hostvars', {})
    if not isinstance(hosts, dict):
        raise RuntimeError('inventory hostvars are malformed')
    if any(not isinstance(values, dict) for values in hosts.values()):
        raise RuntimeError('inventory host variables are malformed')

    group_hosts: dict[str, list[str]] = {}
    for group in ('kiosk', 'signage'):
        group_data = inventory.get(group, {})
        if not isinstance(group_data, dict):
            raise RuntimeError(f'inventory {group} group is malformed')
        values = group_data.get('hosts', [])
        if not isinstance(values, list) or any(not isinstance(host, str) for host in values):
            raise RuntimeError(f'inventory {group} group is malformed')
        if len(values) != len(set(values)):
            raise RuntimeError(f'inventory {group} group contains duplicate hosts')
        group_hosts[group] = values

    kiosk_group = set(group_hosts['kiosk'])
    signage_group = set(group_hosts['signage'])
    if kiosk_group & signage_group:
        raise RuntimeError('kiosk and signage groups must be disjoint')
    claimed_kiosks = {host for host, values in hosts.items() if values.get('manage_kiosk_browser') is True}
    claimed_signage = {host for host, values in hosts.items() if values.get('manage_signage_lite') is True}
    if kiosk_group != claimed_kiosks:
        raise RuntimeError('kiosk group does not match manage_kiosk_browser role claims')
    if signage_group != claimed_signage:
        raise RuntimeError('signage group does not match manage_signage_lite role claims')

    canary_group = inventory.get('kiosk_canary', {})
    if not isinstance(canary_group, dict):
        raise RuntimeError('inventory kiosk_canary group is malformed')
    canary_values = canary_group.get('hosts', [])
    if not isinstance(canary_values, list) or any(not isinstance(host, str) for host in canary_values):
        raise RuntimeError('inventory kiosk_canary group is malformed')
    if len(canary_values) != len(set(canary_values)):
        raise RuntimeError('inventory kiosk_canary group contains duplicate hosts')
    canary_hosts = set(canary_values)
    if not canary_hosts <= kiosk_group:
        raise RuntimeError('kiosk_canary hosts must belong to the kiosk group')

    # ``None`` means no --limit.  An explicit empty selection is meaningful:
    # it must never widen a Pi5-only or zero-match limit into a fleet rollout.
    selected_set = set(hosts if selected is None else selected)
    all_targets: dict[str, list[dict[str, str]]] = {'kiosk': [], 'signage': []}
    client_ids: set[str] = set()
    for group in ('kiosk', 'signage'):
        for host in group_hosts[group]:
            values = hosts.get(host)
            client_id = values.get('status_agent_client_id') if isinstance(values, dict) else None
            if not isinstance(client_id, str) or not client_id:
                raise RuntimeError(f'{group} host {host} is missing status_agent_client_id')
            if client_id in client_ids:
                raise RuntimeError(f'duplicate status_agent_client_id in release targets: {client_id}')
            client_ids.add(client_id)
            all_targets[group].append({'host': host, 'clientId': client_id, 'terminalType': group})

    targets = {
        group: [target for target in all_targets[group] if target['host'] in selected_set]
        for group in ('kiosk', 'signage')
    }
    kiosks = targets['kiosk']
    return [item for item in kiosks if item['host'] in canary_hosts] + [
        item for item in kiosks if item['host'] not in canary_hosts
    ] + targets['signage']


def should_hold_after_canary(
    targets: list[dict[str, str]],
    index: int,
    *,
    skip: bool,
) -> bool:
    """Hold only after the first target when later hosts remain and kiosks are in scope."""
    if skip or index != 0 or index + 1 >= len(targets):
        return False
    return any(target.get('terminalType') == 'kiosk' for target in targets)


def requires_pi5_release(classification: dict[str, Any] | None) -> bool:
    """Require Pi5 for server/migration impact and for unknown classification."""
    if classification is None:
        return True
    return bool(classification.get('server') or classification.get('migration'))
