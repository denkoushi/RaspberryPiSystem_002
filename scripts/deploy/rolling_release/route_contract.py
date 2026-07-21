"""Executable proof ownership for the complete deployment route.

The coordinator still owns I/O, but planner validation, aggregate preflight,
and fault rehearsals consume these closed transitions.  A new external
boundary therefore cannot exist without a durable phase, typed-claim effect,
timeout, response-loss policy, rollback gate, and recovery owner.
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, replace
from typing import Literal


RouteOwner = Literal["local", "pi5", "terminal"]
OperationKind = Literal["read", "mutation", "commit"]


@dataclass(frozen=True)
class RouteStage:
    id: str
    owner: RouteOwner
    operation: OperationKind
    boundary_calls: tuple[str, ...]
    preflight_proof: str
    failure_policy: str
    recovery_owner: str
    rehearsal: str
    required_phases: tuple[str, ...] = ()
    produced_phase: str = ""
    required_claims: tuple[str, ...] = ()
    produced_claims: tuple[str, ...] = ()
    timeout_seconds: int = 0
    response_loss_reconciliation: str = ""
    rollback_eligibility: str = ""


ROUTE_STAGES: tuple[RouteStage, ...] = (
    RouteStage(
        "local.source",
        "local",
        "read",
        ("run",),
        "local.exact-sha-and-clean-worktree",
        "stop-before-ssh",
        "operator",
        "application-contract",
    ),
    RouteStage(
        "local.inventory",
        "local",
        "read",
        ("read_only_inventory_json", "read_only_selected_hosts", "release_hosts"),
        "local.read-only-ansible-config",
        "stop-before-ssh",
        "operator",
        "application-contract",
    ),
    RouteStage(
        "local.remote-identity",
        "local",
        "read",
        (),
        "pi5.public-client-id",
        "stop-before-submission",
        "operator",
        "application-contract",
    ),
    RouteStage(
        "pi5.production-ledger-preflight",
        "pi5",
        "read",
        (),
        "pi5.migration-ledger",
        "aggregate-blocker",
        "operator",
        "migration-preflight-contract",
    ),
    RouteStage(
        "terminal.aggregate-preflight",
        "terminal",
        "read",
        (),
        "terminal.host-and-agent-prerequisites",
        "aggregate-blocker",
        "operator",
        "terminal-preflight-contract",
    ),
    RouteStage(
        "pi5.bootstrap",
        "pi5",
        "mutation",
        (),
        "pi5.bootstrap-readiness",
        "no-coordinator-exec",
        "transient-systemd-bootstrap",
        "bootstrap-before-after-faults",
    ),
    RouteStage(
        "pi5.inventory",
        "pi5",
        "read",
        ("inventory_json", "inventory_server_identity", "selected_hosts"),
        "pi5.normal-ansible-and-vault",
        "stop-before-fleet-write",
        "coordinator",
        "coordinator-entry-contract",
    ),
    RouteStage(
        "pi5.executor-residue-recovery",
        "pi5",
        "mutation",
        ("reconcile_pi5_candidate_workload",),
        "pi5.candidate-residue-readable",
        "retain-prior-authority",
        "pi5-executor",
        "candidate-residue-before-after-faults",
    ),
    RouteStage(
        "pi5.fleet-begin",
        "pi5",
        "commit",
        ("fleet_begin_run", "ReleaseState", "status_file"),
        "pi5.fleet-lock-and-state-readable",
        "retain-active-run",
        "fleet-state-store",
        "fleet-commit-before-after-faults",
    ),
    RouteStage(
        "pi5.interrupted-recovery",
        "pi5",
        "mutation",
        ("read_release_run", "restore_server_config_manifest"),
        "pi5.interrupted-authority-aggregate",
        "retain-active-run",
        "coordinator",
        "interrupted-recovery-before-after-faults",
    ),
    RouteStage(
        "pi5.scope-plan",
        "pi5",
        "read",
        ("build_fleet_scope", "observe_pi5_evidence"),
        "pi5.evidence-and-classification",
        "stop-before-host-mutation",
        "coordinator",
        "scope-success-and-fail-closed",
    ),
    RouteStage(
        "pi5.server-config",
        "pi5",
        "mutation",
        ("capture_server_config_manifest", "converge_server_config"),
        "pi5.server-config-manifest-ready",
        "restore-sealed-manifest",
        "server-config-adapter",
        "server-config-before-after-faults",
    ),
    RouteStage(
        "pi5.blue-green-release",
        "pi5",
        "mutation",
        ("ensure_pi5_release",),
        "pi5.candidate-build-and-switch-readiness",
        "phase3-owned-reconciliation",
        "pi5-backend",
        "pi5-release-before-after-faults",
    ),
    RouteStage(
        "terminal.apply-transport-preflight",
        "terminal",
        "read",
        ("preflight_terminal_ansible_pipelining", "select_terminal_executor"),
        "terminal.ansible-pipelining-and-become",
        "stop-before-terminal-mutation",
        "coordinator",
        "pipelining-preflight-before-terminal-mutation",
    ),
    RouteStage(
        "terminal.baseline-and-manifest",
        "terminal",
        "mutation",
        ("prepare_repository", "capture_manifest"),
        "terminal.rollback-authority-ready",
        "retain-run-manifest",
        "terminal-adapter",
        "terminal-capture-before-after-faults",
    ),
    RouteStage(
        "terminal.notice",
        "terminal",
        "mutation",
        ("deliver_notice",),
        "terminal.status-agent-ready",
        "cleanup-pre-mutation-authority",
        "terminal-adapter",
        "notice-before-after-faults",
    ),
    RouteStage(
        "terminal.maintenance",
        "terminal",
        "mutation",
        ("enter_maintenance", "prestage_maintenance"),
        "terminal.maintenance-and-ack-ready",
        "manifest-rollback",
        "terminal-adapter",
        "maintenance-before-after-faults",
    ),
    RouteStage(
        "terminal.artifact-seal",
        "pi5",
        "mutation",
        ("maintenance_ack_authority_sha256", "prepare"),
        "pi5.fixed-candidate-and-sealed-authority-digests",
        "manifest-rollback-after-maintenance-only",
        "local-executor",
        "local-artifact-seal-faults",
    ),
    RouteStage(
        "terminal.single-transfer",
        "terminal",
        "mutation",
        ("apply",),
        "terminal.exact-artifact-digest-and-unused-receipt",
        "reconcile-deterministic-unit-before-rollback",
        "local-executor",
        "local-single-transfer-response-loss-faults",
    ),
    RouteStage(
        "terminal.local-unit",
        "terminal",
        "mutation",
        ("await_completion", "reconcile"),
        "terminal.deterministic-unit-lock-and-bounded-result",
        "retain-maintenance-while-unit-running-or-unknown",
        "local-executor",
        "local-unit-response-loss-faults",
    ),
    RouteStage(
        "terminal.candidate-ready-ack",
        "terminal",
        "read",
        ("prove_ready", "active_verification_id", "wait_for_ack"),
        "terminal.local-artifact-claim-only",
        "manifest-rollback-after-unit-quiescence",
        "local-executor",
        "local-candidate-ack-identity-faults",
    ),
    RouteStage(
        "terminal.apply",
        "terminal",
        "mutation",
        ("apply",),
        "terminal.candidate-applied-and-local-runtime-observation-bounded-not-trusted",
        "manifest-rollback",
        "terminal-adapter",
        "apply-before-after-faults",
    ),
    RouteStage(
        "terminal.web-activation",
        "terminal",
        "mutation",
        ("activate", "reconcile_activation", "cleanup_activation"),
        "terminal.sealed-runtime-manifest-and-maintenance-ack",
        "reconcile-deterministic-unit-before-rollback",
        "terminal-adapter",
        "web-activation-response-loss-faults",
    ),
    RouteStage(
        "terminal.ready",
        "terminal",
        "read",
        (
            "prove_ready",
            "observe",
            "active_verification_id",
            "wait_for_ack",
            "acknowledgement_record",
        ),
        "terminal.complete-required-typed-claims-and-independent-health",
        "manifest-rollback",
        "terminal-adapter",
        "ready-and-observation-failures",
    ),
    RouteStage(
        "terminal.local-residue-cleanup",
        "terminal",
        "mutation",
        ("cleanup_residue",),
        "terminal.quiesced-unit-and-bound-artifact-receipt",
        "retain-maintenance-and-unknown",
        "local-executor",
        "local-residue-cleanup-faults",
    ),
    RouteStage(
        "terminal.finalize",
        "terminal",
        "commit",
        ("clear_maintenance", "cleanup", "finalize_after_maintenance"),
        "terminal.verified-typed-claims-independent-health-and-cleanup",
        "retain-unknown-if-uncommitted",
        "terminal-adapter",
        "finalization-before-after-faults",
    ),
    RouteStage(
        "terminal.rollback",
        "terminal",
        "mutation",
        ("preflight_rollback", "rollback"),
        "terminal.sealed-rollback-preflight-and-typed-claim-rebind",
        "retain-maintenance-and-unknown",
        "terminal-adapter",
        "rollback-before-after-faults",
    ),
    RouteStage(
        "pi5.canary-approval",
        "pi5",
        "commit",
        ("should_hold_after_canary", "wait_for_canary_hold"),
        "pi5.approval-gate-ready",
        "cancel-or-timeout",
        "coordinator",
        "approval-success-timeout-cancel",
    ),
    RouteStage(
        "pi5.fleet-finalize",
        "pi5",
        "commit",
        ("fleet_mark_unknown", "fleet_mark_verified", "fleet_finish_run", "state_command"),
        "pi5.durable-state-writable",
        "retain-active-or-unknown-authority",
        "fleet-state-store",
        "finalization-before-after-faults",
    ),
    RouteStage(
        "local.status-cancel",
        "local",
        "commit",
        (),
        "pi5.control-and-unit-readable",
        "status-remains-authoritative",
        "remote-run-control",
        "status-approve-cancel-contract",
    ),
)


_PHASE_TRANSITIONS: dict[str, tuple[tuple[str, ...], str]] = {
    "local.source": (("unstarted",), "preflight"),
    "local.inventory": (("preflight",), "preflight"),
    "local.remote-identity": (("preflight",), "preflight"),
    "pi5.production-ledger-preflight": (("preflight",), "preflight"),
    "terminal.aggregate-preflight": (("preflight",), "preflight"),
    "pi5.bootstrap": (("preflight",), "preflight"),
    "pi5.inventory": (("preflight",), "preflight"),
    "pi5.executor-residue-recovery": (("preflight",), "preflight"),
    "pi5.fleet-begin": (("preflight",), "fleet-active"),
    "pi5.interrupted-recovery": (("fleet-active",), "fleet-active"),
    "pi5.scope-plan": (("fleet-active",), "fleet-active"),
    "pi5.server-config": (("fleet-active",), "fleet-active"),
    "pi5.blue-green-release": (("fleet-active",), "fleet-active"),
    "terminal.apply-transport-preflight": (("fleet-active",), "fleet-active"),
    "terminal.baseline-and-manifest": (("fleet-active",), "terminal-prepared"),
    "terminal.notice": (("terminal-prepared",), "terminal-prepared"),
    "terminal.maintenance": (("terminal-prepared",), "maintenance"),
    "terminal.artifact-seal": (("maintenance",), "maintenance"),
    "terminal.single-transfer": (("maintenance",), "maintenance"),
    "terminal.local-unit": (("maintenance",), "applied"),
    "terminal.candidate-ready-ack": (("applied",), "applied"),
    "terminal.apply": (("maintenance",), "applied"),
    "terminal.web-activation": (("maintenance", "applied"), "applied"),
    "terminal.ready": (("maintenance", "applied"), "verified"),
    "terminal.local-residue-cleanup": (("verified",), "verified"),
    "terminal.finalize": (("verified",), "finalized"),
    "terminal.rollback": (("maintenance", "applied", "verified"), "rolled-back"),
    "pi5.canary-approval": (("finalized",), "finalized"),
    "pi5.fleet-finalize": (
        ("fleet-active", "finalized", "rolled-back"),
        "completed",
    ),
    "local.status-cancel": (("any",), "completed"),
}

_REQUIRED_CLAIMS: dict[str, tuple[str, ...]] = {
    "terminal.candidate-ready-ack": ("runtime",),
    "terminal.local-residue-cleanup": ("runtime", "localArtifact"),
    "terminal.finalize": ("profileRequiredClaims", "independentEvidence"),
}

_PRODUCED_CLAIMS: dict[str, tuple[str, ...]] = {
    "pi5.blue-green-release": ("controlPlaneApi", "controlPlaneWeb"),
    "terminal.artifact-seal": ("runtime",),
    "terminal.candidate-ready-ack": ("localArtifact",),
    "terminal.ready": (
        "profileRequiredClaims",
        "terminalRepository",
        "independentEvidence",
    ),
    "terminal.rollback": (
        "profileRequiredClaims",
        "terminalRepository",
        "independentEvidence",
    ),
}

_TIMEOUT_SECONDS = {
    "pi5.production-ledger-preflight": 300,
    "terminal.aggregate-preflight": 300,
    "pi5.bootstrap": 900,
    "pi5.blue-green-release": 1800,
    "terminal.apply": 1800,
    "terminal.local-unit": 1800,
    "terminal.rollback": 1800,
    "terminal.ready": 120,
    "terminal.candidate-ready-ack": 120,
    "pi5.canary-approval": 3600,
}

_RESPONSE_LOSS = {
    "pi5.blue-green-release": "reconcile-phase3-owned-candidate-before-progress",
    "terminal.single-transfer": "reconcile-deterministic-local-unit-before-rollback",
    "terminal.local-unit": "reconcile-deterministic-local-unit-before-rollback",
    "terminal.web-activation": "reconcile-deterministic-activation-unit-before-rollback",
    "terminal.finalize": "reconcile-durable-evidence-before-any-retry",
    "terminal.rollback": "reconcile-sealed-rollback-before-maintenance-clear",
    "pi5.fleet-finalize": "read-durable-fleet-generation-before-retry",
}

_ROLLBACK_ELIGIBILITY = {
    "terminal.maintenance": "sealed-manifest-and-maintenance-ack",
    "terminal.artifact-seal": "sealed-manifest-and-quiesced-local-owner",
    "terminal.single-transfer": "only-after-local-unit-quiescence-reconciliation",
    "terminal.local-unit": "only-after-local-unit-quiescence-reconciliation",
    "terminal.candidate-ready-ack": "sealed-manifest-and-quiesced-local-owner",
    "terminal.apply": "sealed-manifest-and-quiesced-transport",
    "terminal.web-activation": "only-after-activation-unit-reconciliation",
    "terminal.ready": "sealed-manifest-and-quiesced-owner",
    "terminal.local-residue-cleanup": "sealed-manifest-and-quiesced-local-owner",
    "terminal.rollback": "sealed-manifest-only",
    "terminal.finalize": "no-forward-rollback-after-evidence-commit",
}


def _make_executable(stage: RouteStage) -> RouteStage:
    phases = _PHASE_TRANSITIONS.get(stage.id)
    if phases is None:
        raise ValueError(f"route stage has no durable phase transition: {stage.id}")
    default_timeout = 120 if stage.operation == "read" else 900
    if stage.operation == "commit":
        default_timeout = 300
    response_loss = _RESPONSE_LOSS.get(
        stage.id,
        (
            "retry-read-without-state-change"
            if stage.operation == "read"
            else "reconcile-owner-proof-before-retry-or-rollback"
        ),
    )
    rollback = _ROLLBACK_ELIGIBILITY.get(
        stage.id,
        (
            "not-applicable-before-terminal-maintenance"
            if not stage.id.startswith("terminal.")
            or stage.id
            in {
                "terminal.aggregate-preflight",
                "terminal.apply-transport-preflight",
                "terminal.baseline-and-manifest",
                "terminal.notice",
            }
            else "sealed-manifest-and-quiesced-owner"
        ),
    )
    return replace(
        stage,
        required_phases=phases[0],
        produced_phase=phases[1],
        required_claims=_REQUIRED_CLAIMS.get(stage.id, ()),
        produced_claims=_PRODUCED_CLAIMS.get(stage.id, ()),
        timeout_seconds=_TIMEOUT_SECONDS.get(stage.id, default_timeout),
        response_loss_reconciliation=response_loss,
        rollback_eligibility=rollback,
    )


ROUTE_STAGES = tuple(_make_executable(stage) for stage in ROUTE_STAGES)
_STAGES_BY_ID = {stage.id: stage for stage in ROUTE_STAGES}
_STAGE_INDEX = {stage.id: index for index, stage in enumerate(ROUTE_STAGES)}


@dataclass(frozen=True)
class RouteTransitionState:
    phase: str = "unstarted"
    claims: frozenset[str] = frozenset()
    completed: tuple[str, ...] = ()
    maintenance: bool = False
    rollback_sealed: bool = False
    local_unit_state: str = "absent"
    evidence: str = "unknown"


@dataclass(frozen=True)
class RouteFaultResult:
    scenario_id: str
    stage_id: str | None
    boundary: str | None
    state: RouteTransitionState
    outcome: str
    recovery_owner: str | None
    response_loss_reconciliation: str | None
    rollback_eligible: bool


@dataclass(frozen=True)
class RouteScenario:
    id: str
    stages: tuple[str, ...]
    expected_phase: str


_COMMON_PREFIX = (
    "local.source",
    "local.inventory",
    "local.remote-identity",
    "pi5.production-ledger-preflight",
    "terminal.aggregate-preflight",
    "pi5.bootstrap",
    "pi5.inventory",
    "pi5.executor-residue-recovery",
    "pi5.fleet-begin",
    "pi5.interrupted-recovery",
    "pi5.scope-plan",
)

ROUTE_SCENARIOS: tuple[RouteScenario, ...] = (
    RouteScenario(
        "no-op",
        _COMMON_PREFIX + ("pi5.fleet-finalize",),
        "completed",
    ),
    RouteScenario(
        "pi5-and-ssh-success",
        _COMMON_PREFIX
        + (
            "pi5.server-config",
            "pi5.blue-green-release",
            "terminal.apply-transport-preflight",
            "terminal.baseline-and-manifest",
            "terminal.notice",
            "terminal.maintenance",
            "terminal.apply",
            "terminal.web-activation",
            "terminal.ready",
            "terminal.finalize",
            "pi5.canary-approval",
            "pi5.fleet-finalize",
        ),
        "completed",
    ),
    RouteScenario(
        "stale-browser-activation",
        _COMMON_PREFIX
        + (
            "terminal.apply-transport-preflight",
            "terminal.baseline-and-manifest",
            "terminal.notice",
            "terminal.maintenance",
            "terminal.web-activation",
            "terminal.ready",
            "terminal.finalize",
            "pi5.fleet-finalize",
        ),
        "completed",
    ),
    RouteScenario(
        "stonebase-local-success",
        _COMMON_PREFIX
        + (
            "terminal.apply-transport-preflight",
            "terminal.baseline-and-manifest",
            "terminal.notice",
            "terminal.maintenance",
            "terminal.artifact-seal",
            "terminal.single-transfer",
            "terminal.local-unit",
            "terminal.candidate-ready-ack",
            "terminal.ready",
            "terminal.local-residue-cleanup",
            "terminal.finalize",
            "pi5.canary-approval",
            "pi5.fleet-finalize",
        ),
        "completed",
    ),
    RouteScenario(
        "forward-pi5-terminal-rollback",
        _COMMON_PREFIX
        + (
            "pi5.server-config",
            "pi5.blue-green-release",
            "terminal.apply-transport-preflight",
            "terminal.baseline-and-manifest",
            "terminal.notice",
            "terminal.maintenance",
            "terminal.apply",
            "terminal.rollback",
            "pi5.fleet-finalize",
        ),
        "completed",
    ),
    RouteScenario(
        "operator-cancel",
        ("local.source", "local.status-cancel"),
        "completed",
    ),
)
_SCENARIOS_BY_ID = {scenario.id: scenario for scenario in ROUTE_SCENARIOS}


def apply_route_transition(
    state: RouteTransitionState, stage_id: str
) -> RouteTransitionState:
    """Apply one pure route transition after its proof owner succeeded."""

    try:
        stage = _STAGES_BY_ID[stage_id]
    except KeyError as error:
        raise ValueError(f"unknown route stage: {stage_id}") from error
    if "any" not in stage.required_phases and state.phase not in stage.required_phases:
        raise ValueError(
            f"route stage {stage_id} requires {stage.required_phases}, "
            f"found {state.phase}"
        )
    missing = set(stage.required_claims) - state.claims
    if missing:
        raise ValueError(
            f"route stage {stage_id} lacks claims: {sorted(missing)}"
        )
    if stage_id == "terminal.rollback":
        if not state.rollback_sealed:
            raise ValueError("terminal rollback lacks a sealed manifest")
        if state.local_unit_state in {"running", "unknown"}:
            raise ValueError("terminal rollback requires local unit quiescence")

    claims = set(state.claims)
    claims.update(stage.produced_claims)
    maintenance = state.maintenance
    rollback_sealed = state.rollback_sealed
    local_unit_state = state.local_unit_state
    evidence = state.evidence
    if stage_id == "terminal.baseline-and-manifest":
        rollback_sealed = True
    elif stage_id == "terminal.maintenance":
        maintenance = True
    elif stage_id == "terminal.local-unit":
        local_unit_state = "quiesced"
    elif stage_id == "terminal.ready":
        evidence = "verified"
    elif stage_id == "terminal.rollback":
        local_unit_state = "quiesced"
        evidence = "verified"
    elif stage_id == "terminal.finalize":
        maintenance = False

    return RouteTransitionState(
        phase=stage.produced_phase,
        claims=frozenset(claims),
        completed=state.completed + (stage_id,),
        maintenance=maintenance,
        rollback_sealed=rollback_sealed,
        local_unit_state=local_unit_state,
        evidence=evidence,
    )


def _rollback_is_eligible(
    state: RouteTransitionState, stage: RouteStage, *, response_lost: bool
) -> bool:
    if stage.rollback_eligibility.startswith(("not-applicable", "no-forward")):
        return False
    if not state.rollback_sealed:
        return False
    if state.local_unit_state in {"running", "unknown"}:
        return False
    if response_lost and "reconcile" in stage.response_loss_reconciliation:
        return False
    return True


def execute_route_scenario(
    scenario_id: str,
    *,
    fault_stage: str | None = None,
    boundary: Literal["before-call", "after-call", "response-loss"] | None = None,
) -> RouteFaultResult:
    """Execute a normal or fault-injected scenario without performing I/O."""

    try:
        scenario = _SCENARIOS_BY_ID[scenario_id]
    except KeyError as error:
        raise ValueError(f"unknown route scenario: {scenario_id}") from error
    if (fault_stage is None) != (boundary is None):
        raise ValueError("fault stage and boundary must be supplied together")
    if fault_stage is not None and fault_stage not in scenario.stages:
        raise ValueError("fault stage is not part of the selected scenario")

    state = RouteTransitionState()
    for stage_id in scenario.stages:
        stage = _STAGES_BY_ID[stage_id]
        if stage_id == fault_stage and boundary == "before-call":
            return RouteFaultResult(
                scenario.id,
                stage_id,
                boundary,
                state,
                "stopped-before-call",
                stage.recovery_owner,
                None,
                _rollback_is_eligible(state, stage, response_lost=False),
            )
        transitioned = apply_route_transition(state, stage_id)
        if stage_id == fault_stage and boundary in {"after-call", "response-loss"}:
            if boundary == "response-loss":
                # The remote call may have happened, but its response did not.
                # Do not grant produced claims or advance a durable phase until
                # the named recovery owner independently reconciles the effect.
                local_unit_state = state.local_unit_state
                if stage_id in {"terminal.single-transfer", "terminal.local-unit"}:
                    local_unit_state = "unknown"
                transitioned = replace(
                    state,
                    phase="evidence-unknown",
                    evidence="unknown",
                    local_unit_state=local_unit_state,
                    maintenance=(
                        state.maintenance
                        or stage_id == "terminal.maintenance"
                    ),
                )
            return RouteFaultResult(
                scenario.id,
                stage_id,
                boundary,
                transitioned,
                (
                    "response-unknown"
                    if boundary == "response-loss"
                    else "stopped-after-call"
                ),
                stage.recovery_owner,
                (
                    stage.response_loss_reconciliation
                    if boundary == "response-loss"
                    else None
                ),
                _rollback_is_eligible(
                    transitioned, stage, response_lost=boundary == "response-loss"
                ),
            )
        state = transitioned
    if state.phase != scenario.expected_phase:
        raise ValueError(
            f"route scenario {scenario.id} ended at {state.phase}, "
            f"expected {scenario.expected_phase}"
        )
    return RouteFaultResult(
        scenario.id,
        None,
        None,
        state,
        "completed",
        None,
        None,
        False,
    )


def route_contract_receipt(
    plan: dict[str, object],
    *,
    requested_executor: str | None = None,
    effective_executor: str | None = None,
) -> dict[str, object]:
    """Validate a plan against the route and return its deterministic receipt."""

    if not isinstance(plan, dict):
        raise TypeError("route plan must be an object")
    terminal_work = plan.get("terminalWork")
    if not isinstance(terminal_work, list):
        raise ValueError("route plan terminalWork is malformed")
    requested = requested_executor or str(
        plan.get("requestedExecutor") or "ssh-ansible"
    )
    effective = effective_executor or plan.get("effectiveExecutor") or requested
    if requested not in {"ssh-ansible", "stonebase-local-ansible-poc"}:
        raise ValueError("route requested executor is unsupported")
    if effective not in {"ssh-ansible", "stonebase-local-ansible-poc"}:
        raise ValueError("route effective executor is unsupported")
    if requested == "stonebase-local-ansible-poc" and any(
        not isinstance(work, dict)
        or work.get("host") != "raspi4-kensaku-stonebase01"
        for work in terminal_work
    ):
        raise ValueError("Local route is limited to StoneBase terminal work")
    target_fields = (
        "mutationTargets",
        "activationTargets",
        "verificationTargets",
    )
    if any(field in plan for field in target_fields):
        declared_terminal_hosts: set[str] = set()
        target_hosts_by_field: dict[str, set[str]] = {}
        for field in target_fields:
            targets = plan.get(field)
            if not isinstance(targets, list):
                raise ValueError(f"route plan {field} is malformed")
            if any(
                not isinstance(target, dict)
                or not isinstance(target.get("host"), str)
                or not target.get("host")
                for target in targets
            ):
                raise ValueError(f"route plan {field} contains a malformed target")
            terminal_hosts = {
                str(target["host"])
                for target in targets
                if target.get("role") != "server"
            }
            if len(terminal_hosts) != sum(
                1 for target in targets if target.get("role") != "server"
            ):
                raise ValueError(f"route plan {field} contains duplicate targets")
            target_hosts_by_field[field] = terminal_hosts
            declared_terminal_hosts.update(terminal_hosts)
        work_hosts = {
            str(work["host"])
            for work in terminal_work
            if isinstance(work, dict) and isinstance(work.get("host"), str)
        }
        if len(work_hosts) != len(terminal_work):
            raise ValueError("route terminal work contains malformed or duplicate hosts")
        if declared_terminal_hosts != work_hosts:
            raise ValueError("route terminal work does not match typed target sets")
        membership_flags = {
            "mutationTargets": "mutationRequired",
            "activationTargets": "activationRequired",
            "verificationTargets": "verificationRequired",
        }
        for work in terminal_work:
            host = str(work["host"])
            for field, flag in membership_flags.items():
                if (work.get(flag) is True) != (host in target_hosts_by_field[field]):
                    raise ValueError(
                        f"route terminal work {flag} does not match {field}"
                    )

    selected = set(_COMMON_PREFIX)
    if plan.get("pi5Required") is True:
        selected.update({"pi5.server-config", "pi5.blue-green-release"})
    for work in terminal_work:
        if not isinstance(work, dict):
            raise ValueError("route terminal work item is malformed")
        mutation = work.get("mutationRequired") is True
        activation = work.get("activationRequired") is True
        verification = work.get("verificationRequired") is True
        if not any((mutation, activation, verification)):
            raise ValueError("route terminal work has no executable action")
        if (mutation or activation) and not verification:
            raise ValueError("route mutation or activation requires verification")
        selected.update(
            {
                "terminal.apply-transport-preflight",
                "terminal.baseline-and-manifest",
                "terminal.notice",
                "terminal.maintenance",
                "terminal.finalize",
            }
        )
        if mutation and effective == "stonebase-local-ansible-poc":
            selected.update(
                {
                    "terminal.artifact-seal",
                    "terminal.single-transfer",
                    "terminal.local-unit",
                    "terminal.candidate-ready-ack",
                    "terminal.local-residue-cleanup",
                }
            )
        elif mutation:
            selected.add("terminal.apply")
        if activation:
            selected.add("terminal.web-activation")
        if verification:
            selected.add("terminal.ready")
    if terminal_work:
        selected.add("pi5.canary-approval")
    selected.add("pi5.fleet-finalize")
    stage_ids = tuple(sorted(selected, key=_STAGE_INDEX.__getitem__))
    encoded = json.dumps(stage_ids, separators=(",", ":")).encode("ascii")
    scenario = (
        "no-op"
        if not terminal_work and plan.get("pi5Required") is not True
        else (
            "stonebase-local-success"
            if effective == "stonebase-local-ansible-poc"
            and any(
                isinstance(work, dict) and work.get("mutationRequired") is True
                for work in terminal_work
            )
            else (
                "stale-browser-activation"
                if terminal_work
                and all(
                    isinstance(work, dict)
                    and work.get("mutationRequired") is not True
                    for work in terminal_work
                )
                else "pi5-and-ssh-success"
            )
        )
    )
    return {
        "schemaVersion": 1,
        "scenarioId": scenario,
        "requestedExecutor": requested,
        "effectiveExecutor": effective,
        "stageIds": list(stage_ids),
        "stageDigest": "sha256:" + hashlib.sha256(encoded).hexdigest(),
    }


def validate_route_contract(stages: tuple[RouteStage, ...] = ROUTE_STAGES) -> None:
    ids = [stage.id for stage in stages]
    if len(ids) != len(set(ids)):
        raise ValueError("deployment route stage IDs must be unique")
    for stage in stages:
        if not stage.id or not stage.preflight_proof or not stage.failure_policy:
            raise ValueError(f"route stage is incomplete: {stage.id!r}")
        if not stage.recovery_owner or not stage.rehearsal:
            raise ValueError(f"route stage has no recovery proof: {stage.id}")
        if (
            not stage.required_phases
            or not stage.produced_phase
            or stage.timeout_seconds <= 0
            or not stage.response_loss_reconciliation
            or not stage.rollback_eligibility
        ):
            raise ValueError(
                f"route stage has no executable transition contract: {stage.id}"
            )
        if stage.operation in {"mutation", "commit"} and "fault" not in stage.rehearsal and not any(
            token in stage.rehearsal for token in ("contract", "timeout", "cancel")
        ):
            raise ValueError(f"mutating route stage has no fault rehearsal: {stage.id}")
    scenario_stage_ids = {
        stage_id for scenario in ROUTE_SCENARIOS for stage_id in scenario.stages
    }
    missing_scenarios = set(ids) - scenario_stage_ids
    if missing_scenarios:
        raise ValueError(
            "route stages are absent from executable scenarios: "
            + ", ".join(sorted(missing_scenarios))
        )
    for scenario in ROUTE_SCENARIOS:
        execute_route_scenario(scenario.id)


def registered_boundary_calls(owner: RouteOwner | None = None) -> frozenset[str]:
    return frozenset(
        boundary
        for stage in ROUTE_STAGES
        if owner is None or stage.owner == owner
        for boundary in stage.boundary_calls
    )


validate_route_contract()
