"""Pure rollout policy decisions.

This module deliberately performs no filesystem, subprocess, network, or
clock access.  Callers supply observed inventory and classification data and
receive deterministic targets plus auditable reasons.
"""
from __future__ import annotations

from typing import Any, Iterable


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


def apply_auto_minimize(
    targets: list[dict[str, str]],
    inventory: dict[str, Any],
    classification: dict[str, Any] | None,
) -> tuple[list[dict[str, str]], dict[str, Any]]:
    """Narrow terminal targets from classification; on doubt, keep or widen scope."""
    if classification is None:
        return targets, {
            'autoMinimize': True,
            'minimized': False,
            'excludedHosts': [],
            'classificationComponents': None,
            'reason': 'classification unavailable',
        }

    components = list(classification.get('components') or [])
    components_set = set(components)
    if 'unknown' in components_set or 'global' in components_set:
        # Fail-closed: unknown/global impact must touch every terminal.
        return targets, {
            'autoMinimize': True,
            'minimized': False,
            'excludedHosts': [],
            'classificationComponents': sorted(components_set),
            'reason': 'unknown or global component',
        }

    include_kiosk = bool(classification.get('kiosk'))
    include_signage = bool(classification.get('signage'))
    kiosk_components = components_set & KIOSK_SCOPE_COMPONENTS
    barcode_only = include_kiosk and kiosk_components == {'barcode-agent'}
    hostvars = (inventory.get('_meta') or {}).get('hostvars')
    # Missing hostvars cannot safely decide barcode ownership, so keep all
    # kiosks selected by the classification.
    if barcode_only and not isinstance(hostvars, dict):
        barcode_only = False

    filtered: list[dict[str, str]] = []
    for target in targets:
        terminal_type = target.get('terminalType')
        if terminal_type == 'kiosk':
            if not include_kiosk:
                continue
            if barcode_only:
                values = hostvars.get(target['host']) if isinstance(hostvars, dict) else None
                if not isinstance(values, dict):
                    # Per-host vars missing: fail-closed and keep the kiosk.
                    filtered.append(target)
                    continue
                if values.get('barcode_agent_enabled') is True:
                    filtered.append(target)
                continue
            filtered.append(target)
        elif terminal_type == 'signage':
            if include_signage:
                filtered.append(target)
        else:
            # An unexpected terminal type cannot be safely excluded.
            filtered.append(target)

    kept = {target['host'] for target in filtered}
    excluded = [target['host'] for target in targets if target['host'] not in kept]
    return filtered, {
        'autoMinimize': True,
        'minimized': bool(excluded),
        'excludedHosts': excluded,
        'classificationComponents': sorted(components_set),
    }
