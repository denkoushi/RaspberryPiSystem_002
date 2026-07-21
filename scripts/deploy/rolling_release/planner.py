"""Pure composition of observable rolling-release plans."""
from __future__ import annotations

import re
from collections.abc import Callable
from typing import Any, Iterable

try:
    from terminal_profile_registry import load_registry
except ImportError:
    from scripts.deploy.terminal_profile_registry import load_registry

try:
    from rolling_release.release_claims import ClaimKind, release_claims_for_host
except ImportError:
    from .release_claims import ClaimKind, release_claims_for_host


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
TARGET_ARCHITECTURE_VERSION = 1
SSH_ANSIBLE_EXECUTOR = 'ssh-ansible'


def required_claim_kinds(role: str) -> tuple[ClaimKind, ...]:
    if role == 'server':
        return (
            ClaimKind.CONTROL_PLANE_API,
            ClaimKind.CONTROL_PLANE_WEB,
        )
    try:
        profile = load_registry().profile(role)
    except KeyError:
        return (ClaimKind.TERMINAL_REPOSITORY,)
    return tuple(
        ClaimKind(kind) for kind in profile.adapter_options.required_claims
    )


def activation_strategy_for_role(role: str) -> str | None:
    if role == 'server':
        return None
    try:
        profile = load_registry().profile(role)
    except KeyError:
        return None
    return profile.adapter_options.activation_strategy_id


def _expected_claim_identity(
    kind: ClaimKind,
    decision: dict[str, Any],
    *,
    control_plane_web_sha: str,
) -> str:
    if kind is ClaimKind.CONTROL_PLANE_WEB and decision['role'] != 'server':
        return control_plane_web_sha
    return decision['desiredSha']


def _claim_requirement(
    kind: ClaimKind,
    *,
    expected_identity: str,
    claims: dict[str, dict[str, Any]],
) -> dict[str, str]:
    claim = claims.get(kind.value)
    if claim is None:
        status = 'missing'
    elif (
        claim.get('state') == 'verified'
        and claim.get('expectedIdentity') == expected_identity
        and claim.get('observedIdentity') == expected_identity
    ):
        status = 'current'
    else:
        status = 'stale-or-unverified'
    return {
        'kind': kind.value,
        'expectedIdentity': expected_identity,
        'status': status,
    }


def _target_entry(
    work: dict[str, Any], *, reason: str
) -> dict[str, Any]:
    return {
        'host': work['host'],
        'role': work['role'],
        'requiredClaims': [
            requirement['kind'] for requirement in work['claimRequirements']
        ],
        'claimRequirements': [
            dict(requirement) for requirement in work['claimRequirements']
        ],
        'reason': reason,
    }


def build_target_architecture(
    *,
    decisions: list[dict[str, Any]],
    fleet_records: dict[str, Any] | None,
    typed_target_planning: bool,
    activation_execution_enabled: bool,
    verification_only_execution_enabled: bool,
    claim_scope_hosts: Iterable[str] | None,
) -> dict[str, Any]:
    """Build ordered action sets without executing or selecting a transport.

    The legacy mutation decision stays authoritative until the repository flag
    enables typed target planning.  Even while disabled, the output shape is
    complete and gives the coordinator one stable terminal-work order.
    """
    if type(typed_target_planning) is not bool:
        raise TypeError('typed_target_planning must be boolean')
    if type(activation_execution_enabled) is not bool:
        raise TypeError('activation_execution_enabled must be boolean')
    if type(verification_only_execution_enabled) is not bool:
        raise TypeError('verification_only_execution_enabled must be boolean')
    claim_scope = None if claim_scope_hosts is None else frozenset(claim_scope_hosts)
    if claim_scope is not None and any(
        not isinstance(host, str) or not host for host in claim_scope
    ):
        raise ValueError('claim_scope_hosts contains a malformed host')
    records = fleet_records if isinstance(fleet_records, dict) else {}
    server = next(
        (decision for decision in decisions if decision['role'] == 'server'),
        None,
    )
    control_plane_web_sha = (
        server['desiredSha'] if isinstance(server, dict) else ''
    )

    mutation_targets: list[dict[str, Any]] = []
    activation_targets: list[dict[str, Any]] = []
    verification_targets: list[dict[str, Any]] = []
    terminal_work: list[dict[str, Any]] = []
    for decision in decisions:
        host = decision['host']
        if claim_scope is not None and host not in claim_scope:
            continue
        role = decision['role']
        activation_strategy_id = activation_strategy_for_role(role)
        record = records.get(host)
        claims = (
            release_claims_for_host(record)
            if isinstance(record, dict)
            else {}
        )
        requirements = [
            _claim_requirement(
                kind,
                expected_identity=_expected_claim_identity(
                    kind,
                    decision,
                    control_plane_web_sha=control_plane_web_sha,
                ),
                claims=claims,
            )
            for kind in required_claim_kinds(role)
        ]
        non_current = [
            requirement
            for requirement in requirements
            if requirement['status'] != 'current'
        ]
        mutation_required = bool(decision['targeted'])
        activation_required = bool(
            typed_target_planning
            and activation_strategy_id is not None
            and any(
                requirement['kind'] == ClaimKind.CONTROL_PLANE_WEB.value
                and requirement['status'] != 'current'
                for requirement in requirements
            )
        )
        verification_required = bool(
            mutation_required
            or activation_required
            or (typed_target_planning and non_current)
        )
        work = {
            'host': host,
            'role': role,
            'mutationRequired': mutation_required,
            'activationRequired': activation_required,
            'verificationRequired': verification_required,
            'activationStrategyId': activation_strategy_id,
            'claimRequirements': requirements,
        }
        if mutation_required:
            mutation_targets.append(
                _target_entry(work, reason=decision['targetReason'])
            )
        if activation_required:
            web_status = next(
                requirement['status']
                for requirement in requirements
                if requirement['kind'] == ClaimKind.CONTROL_PLANE_WEB.value
            )
            activation_target = _target_entry(
                work,
                reason=f'controlPlaneWeb claim is {web_status}',
            )
            activation_target['activationStrategyId'] = activation_strategy_id
            activation_targets.append(activation_target)
        if verification_required:
            if non_current:
                detail = ', '.join(
                    f"{requirement['kind']}={requirement['status']}"
                    for requirement in non_current
                )
                reason = f'required claims not current: {detail}'
            else:
                reason = 'post-mutation independent verification required'
            verification_targets.append(_target_entry(work, reason=reason))
        if role != 'server' and (
            mutation_required or activation_required or verification_required
        ):
            terminal_work.append(work)

    return {
        'targetArchitectureVersion': TARGET_ARCHITECTURE_VERSION,
        'typedTargetPlanningEnabled': typed_target_planning,
        'activationExecutionEnabled': activation_execution_enabled,
        'verificationOnlyExecutionEnabled': verification_only_execution_enabled,
        'mutationTargets': mutation_targets,
        'activationTargets': activation_targets,
        'verificationTargets': verification_targets,
        'terminalWork': terminal_work,
    }


def executor_selection(*, preflight_passed: bool) -> dict[str, Any]:
    """Expose the SSH default without overstating preflight authority."""
    if type(preflight_passed) is not bool:
        raise TypeError('preflight_passed must be boolean')
    return {
        'requestedExecutor': SSH_ANSIBLE_EXECUTOR,
        'provisionalExecutor': SSH_ANSIBLE_EXECUTOR,
        'effectiveExecutor': SSH_ANSIBLE_EXECUTOR if preflight_passed else None,
        'fallbackReason': None,
    }


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
    fleet_records: dict[str, Any] | None = None,
    typed_target_planning: bool = False,
    activation_execution_enabled: bool = False,
    verification_only_execution_enabled: bool = False,
    claim_scope_hosts: Iterable[str] | None = None,
    executor_preflight_passed: bool = False,
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

    target_architecture = build_target_architecture(
        decisions=hosts,
        fleet_records=fleet_records,
        typed_target_planning=typed_target_planning,
        activation_execution_enabled=activation_execution_enabled,
        verification_only_execution_enabled=verification_only_execution_enabled,
        claim_scope_hosts=claim_scope_hosts,
    )
    canary_candidates = (
        [
            {
                'host': work['host'],
                'terminalType': work['role'],
            }
            for work in target_architecture['terminalWork']
        ]
        if typed_target_planning
        else terminal_targets
    )
    canary_hold = any(
        canary_hold_policy(canary_candidates, index, skip=False)
        for index in range(len(canary_candidates))
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
        **target_architecture,
        **executor_selection(preflight_passed=executor_preflight_passed),
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
