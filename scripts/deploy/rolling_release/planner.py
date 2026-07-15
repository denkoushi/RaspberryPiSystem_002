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
