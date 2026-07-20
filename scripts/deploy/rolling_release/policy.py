"""Pure rollout policy decisions.

Apart from loading the strict terminal-profile registry when callers do not
inject one, this module performs no subprocess, network, or clock access.
Callers supply observed inventory and classification data and receive
deterministic targets plus auditable reasons.
"""
from __future__ import annotations

import re
from collections.abc import Mapping
from typing import Any, Iterable

from terminal_profile_registry import TerminalProfileRegistry, load_registry

try:  # Normal package import.
    from .adapter_registry import registered_adapter_ids, validate_adapter_profiles
    from .image_refs import image_matches_release
except ImportError:  # Direct pure-module contract tests load this file by path.
    from rolling_release.adapter_registry import (
        registered_adapter_ids,
        validate_adapter_profiles,
    )
    from rolling_release.image_refs import image_matches_release


FULL_SHA_RE = re.compile(r'^[0-9a-f]{40}$')
SHA256_RE = re.compile(r'^sha256:[0-9a-f]{64}$')
CLIENT_ID_RE = re.compile(r'^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$')

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


def _group_children(inventory: dict[str, Any], group: str) -> list[str]:
    group_data = inventory.get(group, {})
    if not isinstance(group_data, dict):
        raise RuntimeError(f'inventory {group} group is malformed')
    values = group_data.get('children', [])
    if (
        not isinstance(values, list)
        or any(not isinstance(child, str) or not child for child in values)
        or len(values) != len(set(values))
    ):
        raise RuntimeError(f'inventory {group} group is malformed')
    return values


def _registry(value: TerminalProfileRegistry | None) -> TerminalProfileRegistry:
    return load_registry() if value is None else value


def _release_topology(
    inventory: dict[str, Any],
    *,
    registry: TerminalProfileRegistry | None = None,
    adapter_ids: Iterable[str] | None = None,
) -> tuple[dict[str, str], list[dict[str, str]]]:
    """Validate and return the control plane plus ordered terminal targets."""

    if not isinstance(inventory, dict):
        raise RuntimeError('inventory is malformed')
    profiles = _registry(registry)
    available_adapters = frozenset(
        registered_adapter_ids() if adapter_ids is None else adapter_ids
    )
    if any(not isinstance(adapter_id, str) for adapter_id in available_adapters):
        raise RuntimeError('terminal adapter registry is malformed')
    missing_adapters = [
        profile.adapter_id
        for profile in profiles.profiles
        if profile.adapter_id not in available_adapters
    ]
    if missing_adapters:
        raise RuntimeError(
            'terminal profiles reference unavailable adapters: '
            + ', '.join(sorted(set(missing_adapters)))
        )
    validate_adapter_profiles(profiles.profiles)

    metadata = inventory.get('_meta', {})
    if not isinstance(metadata, dict):
        raise RuntimeError('inventory metadata are malformed')
    hostvars = metadata.get('hostvars', {})
    if not isinstance(hostvars, dict):
        raise RuntimeError('inventory hostvars are malformed')
    if any(
        not isinstance(host, str) or not host or not isinstance(values, dict)
        for host, values in hostvars.items()
    ):
        raise RuntimeError('inventory host variables are malformed')

    profile_groups = [profile.inventory_group for profile in profiles.profiles]
    client_children = _group_children(inventory, 'clients')
    direct_clients = _group_hosts(inventory, 'clients')
    if direct_clients:
        raise RuntimeError(
            'clients hosts must belong to exactly one terminal profile group: '
            + ', '.join(direct_clients)
        )
    unexpected = sorted(set(client_children) - set(profile_groups))
    if unexpected:
        raise RuntimeError(
            'inventory clients groups do not match terminal profiles: '
            + 'unregistered '
            + ', '.join(unexpected)
        )

    control_plane_group = profiles.pi5_control_plane.inventory_group
    server_hosts = _group_hosts(inventory, control_plane_group, exactly_one=True)
    server_host = server_hosts[0]
    server_values = hostvars.get(server_host)
    if not isinstance(server_values, dict):
        raise RuntimeError(f'server host {server_host} is missing inventory hostvars')
    server_client_id = server_values.get('status_agent_client_id')
    if not isinstance(server_client_id, str) or CLIENT_ID_RE.fullmatch(server_client_id) is None:
        raise RuntimeError(
            f'server host {server_host} is missing a safe status_agent_client_id'
        )

    group_hosts: dict[str, list[str]] = {}
    memberships: dict[str, list[str]] = {}
    canaries: dict[str, str] = {}
    for profile in profiles.profiles:
        values = _group_hosts(inventory, profile.inventory_group)
        group_hosts[profile.id] = values
        for host in values:
            memberships.setdefault(host, []).append(profile.id)

        canary_values = _group_hosts(inventory, profile.canary_group)
        if values and len(canary_values) != 1:
            raise RuntimeError(
                f'inventory {profile.canary_group} group must contain exactly one host'
            )
        if not values and canary_values:
            raise RuntimeError(
                f'{profile.canary_group} cannot contain hosts without '
                f'{profile.inventory_group}'
            )
        if not values:
            continue
        canary_host = canary_values[0]
        if canary_host not in set(values):
            raise RuntimeError(
                f'{profile.canary_group} host must belong to {profile.inventory_group}'
            )
        canaries[profile.id] = canary_host

    present_groups = {
        profile.inventory_group
        for profile in profiles.profiles
        if group_hosts[profile.id]
    }
    missing_children = sorted(present_groups - set(client_children))
    empty_children = sorted(set(client_children) - present_groups)
    if missing_children or empty_children:
        details = []
        if missing_children:
            details.append('missing ' + ', '.join(missing_children))
        if empty_children:
            details.append('empty ' + ', '.join(empty_children))
        raise RuntimeError(
            'inventory clients groups do not match terminal profiles: '
            + '; '.join(details)
        )

    duplicate_memberships = sorted(
        host for host, profile_ids in memberships.items() if len(profile_ids) != 1
    )
    if duplicate_memberships:
        raise RuntimeError(
            'clients hosts must belong to exactly one terminal profile group: '
            + ', '.join(duplicate_memberships)
        )
    if server_host in memberships:
        raise RuntimeError('server and terminal profile groups must be disjoint')

    client_ids = {server_client_id}
    targets: list[dict[str, str]] = []
    for profile in profiles.profiles:
        if not group_hosts[profile.id]:
            continue
        canary_host = canaries[profile.id]
        ordered_hosts = [canary_host] + [
            host for host in group_hosts[profile.id] if host != canary_host
        ]
        for host in ordered_hosts:
            values = hostvars.get(host)
            if not isinstance(values, dict):
                raise RuntimeError(
                    f'{profile.inventory_group} host {host} is missing inventory hostvars'
                )
            client_id = values.get('status_agent_client_id')
            if not isinstance(client_id, str) or CLIENT_ID_RE.fullmatch(client_id) is None:
                raise RuntimeError(
                    f'{profile.inventory_group} host {host} is missing a safe '
                    'status_agent_client_id'
                )
            if client_id in client_ids:
                raise RuntimeError(
                    f'duplicate status_agent_client_id in release inventory: {client_id}'
                )
            client_ids.add(client_id)
            targets.append(
                {'host': host, 'clientId': client_id, 'terminalType': profile.id}
            )
    return {'host': server_host, 'clientId': server_client_id}, targets


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
    *,
    registry: TerminalProfileRegistry | None = None,
    adapter_ids: Iterable[str] | None = None,
) -> list[dict[str, str]]:
    """Return the strict full release inventory in execution order.

    The server is deliberately separate from terminal execution, but it is a
    first-class planning target.  Requiring exactly one server prevents a
    terminal-only selection from hiding an ambiguous Pi5 authority.
    """
    identity, terminal_targets = _release_topology(
        inventory, registry=registry, adapter_ids=adapter_ids
    )
    server_host = identity['host']

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
    boolean_fields = ('server', 'migration')
    if any(type(value.get(field)) is not bool for field in boolean_fields):
        return None
    components = value.get('components')
    if (
        not isinstance(components, list)
        or any(not isinstance(component, str) or not component for component in components)
    ):
        return None
    affected_profiles = value.get('affectedProfiles')
    if affected_profiles is not None and (
        not isinstance(affected_profiles, list)
        or any(
            not isinstance(profile_id, str) or not profile_id
            for profile_id in affected_profiles
        )
        or len(affected_profiles) != len(set(affected_profiles))
    ):
        return None
    return value


def _role_impacted(
    role: str,
    host: str,
    classification: dict[str, Any] | None,
    inventory: dict[str, Any],
    registry: TerminalProfileRegistry,
) -> bool:
    profile_ids = frozenset(registry.profile_ids)
    normalized = _valid_classification(classification)
    if normalized is None:
        return True
    components = set(normalized['components'])
    if components & {'unknown', 'global'}:
        return True
    if role == 'server':
        return normalized['server'] or normalized['migration']
    if role not in profile_ids:
        return True
    affected_profiles = normalized.get('affectedProfiles')
    if affected_profiles is None:
        legacy_impact = normalized.get(role)
        if type(legacy_impact) is not bool:
            return True
        impacted = legacy_impact
    else:
        if any(profile_id not in profile_ids for profile_id in affected_profiles):
            return True
        impacted = role in affected_profiles
    if not impacted:
        return False

    component_profiles = dict(registry.component_profiles)
    runtime_components = {
        component
        for component in components
        if role in component_profiles.get(component, ())
    }
    # An impacted role without a matching runtime component is internally
    # inconsistent classification evidence and can never justify exclusion.
    if not runtime_components:
        return True
    metadata = inventory.get('_meta', {}) if isinstance(inventory, dict) else {}
    hostvars = metadata.get('hostvars', {}) if isinstance(metadata, dict) else {}
    values = hostvars.get(host) if isinstance(hostvars, dict) else None
    return registry.components_apply_to_host(runtime_components, values)


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
    registry: TerminalProfileRegistry | None = None,
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
    registry_value = _registry(registry)
    profile_ids = frozenset(registry_value.profile_ids)
    release_roles = profile_ids | {'server'}

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
            or role not in release_roles
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
            impacted = _role_impacted(
                role, host, classification, inventory, registry_value
            )
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
    *,
    registry: TerminalProfileRegistry | None = None,
    adapter_ids: Iterable[str] | None = None,
) -> list[dict[str, str]]:
    """Return profile/canary/inventory ordered targets from validated topology."""

    _identity, all_targets = _release_topology(
        inventory, registry=registry, adapter_ids=adapter_ids
    )
    if selected is None:
        return all_targets
    selected_set = set(selected)
    return [target for target in all_targets if target['host'] in selected_set]


def should_hold_after_canary(
    targets: list[dict[str, str]],
    index: int,
    *,
    skip: bool,
    registry: TerminalProfileRegistry | None = None,
) -> bool:
    """Gate the first targeted host of every human-approved profile."""
    if skip or index < 0 or index >= len(targets) or index + 1 >= len(targets):
        return False
    terminal_type = targets[index].get('terminalType')
    if any(
        target.get('terminalType') == terminal_type
        for target in targets[:index]
    ):
        return False
    try:
        return _registry(registry).profile(terminal_type).approval_policy == 'human'
    except (KeyError, TypeError):
        return True


def requires_pi5_release(classification: dict[str, Any] | None) -> bool:
    """Require Pi5 for server/migration impact and for unknown classification."""
    if classification is None:
        return True
    return bool(classification.get('server') or classification.get('migration'))
