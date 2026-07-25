"""Machine-readable proof ownership for the complete deployment route.

This module deliberately contains metadata only.  The coordinator keeps the
execution logic, while preflight and rehearsal tests consume this one route
inventory so a new external boundary cannot exist without an assigned proof
and recovery owner.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Literal, Mapping


RouteOwner = Literal["local", "pi5", "terminal"]
OperationKind = Literal["read", "mutation", "commit"]
GateClassification = Literal["safety", "correctness", "warning"]


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


@dataclass(frozen=True)
class ReadinessGate:
    """Operator-facing meaning for one aggregate pre-submission decision."""

    id: str
    classification: GateClassification
    protects: str
    failure_impact: str
    observation: str
    applicability: str
    timeout_seconds: int
    recovery: str
    regression_test: str


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
        ("preflight_terminal_ansible_pipelining",),
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
        "terminal.notice-state-writable",
        "observer-warning-or-cleanup-pre-mutation-authority",
        "terminal-adapter",
        "notice-before-after-faults",
    ),
    RouteStage(
        "terminal.maintenance",
        "terminal",
        "mutation",
        ("enter_maintenance", "prestage_maintenance"),
        "terminal.maintenance-state-writable",
        "observer-warning-or-manifest-rollback",
        "terminal-adapter",
        "maintenance-before-after-faults",
    ),
    RouteStage(
        "terminal.apply",
        "terminal",
        "mutation",
        ("apply",),
        "terminal.candidate-and-runtime-ready",
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

READINESS_GATES: tuple[ReadinessGate, ...] = (
    ReadinessGate(
        "local.source-and-scope",
        "safety",
        "an immutable candidate SHA, clean operator checkout, valid inventory, and correct Pi5 identity",
        "the wrong source or host could receive a release",
        "local Git, read-only inventory expansion, target planning, and the public Pi5 client ID",
        "every normal launch and preflight-only run",
        60,
        "correct the local checkout, branch, inventory, or RASPI_SERVER_HOST and rerun",
        "scripts/deploy/tests/test_release_application.py::test_preflight_only_returns_json_when_local_preparation_fails",
    ),
    ReadinessGate(
        "migration.production-ledger",
        "safety",
        "the live production migration ledger and additive migration contract",
        "an unsafe or divergent database migration could make rollback impossible",
        "the sealed production ledger and exact candidate migration files",
        "every normal launch and preflight-only run",
        60,
        "repair the migration contract or ledger evidence without changing production, then rerun",
        "scripts/deploy/tests/test_migration_preflight.py::test_success_requires_sealed_evidence_and_cleans_temporary_directory",
    ),
    ReadinessGate(
        "route.pi5-authority-and-resources",
        "safety",
        "the Pi5 execution identity, fleet lock, recovery authority, tools, configuration, disk, and memory",
        "the coordinator could mutate an unowned or unrecoverable host",
        "the standard-library Pi5 route probe over the canonical SSH transport",
        "every normal launch and preflight-only run",
        60,
        "resolve every reported Pi5 issue while preserving durable fleet authority, then rerun",
        "scripts/deploy/tests/test_route_preflight.py::test_reports_all_detected_issues_in_one_result",
    ),
    ReadinessGate(
        "route.external-server-build",
        "correctness",
        "the outbound TLS routes required to build candidate API and Web images",
        "candidate image creation can stall or fail after a release unit has started",
        "three bounded TLS-handshake rounds from Pi5 to every registered build dependency",
        "only when target planning reports server-app or unknown impact",
        30,
        "restore stable outbound routing or the named dependency, then rerun preflight",
        "scripts/deploy/tests/test_route_preflight.py::test_external_build_dependencies_require_every_tls_round",
    ),
    ReadinessGate(
        "terminal.selected-prerequisites",
        "safety",
        "selected terminal transport, rollback prerequisites, runtime resources, and required agents",
        "a terminal mutation could begin without a usable rollback or verification route",
        "the aggregate terminal preflight using exact candidate-owned probe sources",
        "when one or more terminals are selected for work or verification",
        60,
        "restore the reported terminal prerequisite and rerun before submission",
        "scripts/deploy/tests/test_terminal_preflight.py::test_orchestrator_reports_all_issues_before_any_release_unit",
    ),
    ReadinessGate(
        "architecture.activation-executor",
        "correctness",
        "an implemented executor for every planned terminal activation",
        "the plan could claim work that the selected executor cannot perform",
        "the read-only target plan and activation execution feature state",
        "when target planning contains activation targets",
        1,
        "enable the reviewed activation executor or remove the unsupported target from the design",
        "scripts/deploy/tests/test_release_application.py::test_disabled_activation_blocks_preflight_and_executor_promotion",
    ),
    ReadinessGate(
        "architecture.verification-executor",
        "correctness",
        "an implemented executor for every verification-only target",
        "a release could be reported without executing its required verification",
        "the read-only target plan and verification execution feature state",
        "when target planning contains verification-only targets",
        1,
        "enable the reviewed verification executor or correct the target plan",
        "scripts/deploy/tests/test_release_application.py::test_disabled_activation_blocks_preflight_and_executor_promotion",
    ),
    ReadinessGate(
        "route.interrupted-run-recovery",
        "warning",
        "operator visibility when readable interrupted-run authority requires reconciliation",
        "the next coordinator must reconcile the retained authority before new mutation",
        "the fleet state and matching durable release-run record",
        "when fleet state names a readable interrupted run",
        1,
        "allow the lock-owning coordinator to reconcile it or inspect the durable run state",
        "scripts/deploy/tests/test_route_preflight.py::test_readable_active_run_is_reported_for_recovery_without_blocking",
    ),
)


def validate_route_contract(stages: tuple[RouteStage, ...] = ROUTE_STAGES) -> None:
    ids = [stage.id for stage in stages]
    if len(ids) != len(set(ids)):
        raise ValueError("deployment route stage IDs must be unique")
    for stage in stages:
        if not stage.id or not stage.preflight_proof or not stage.failure_policy:
            raise ValueError(f"route stage is incomplete: {stage.id!r}")
        if not stage.recovery_owner or not stage.rehearsal:
            raise ValueError(f"route stage has no recovery proof: {stage.id}")
        if stage.operation in {"mutation", "commit"} and "fault" not in stage.rehearsal and not any(
            token in stage.rehearsal for token in ("contract", "timeout", "cancel")
        ):
            raise ValueError(f"mutating route stage has no fault rehearsal: {stage.id}")


def validate_readiness_gates(
    gates: tuple[ReadinessGate, ...] = READINESS_GATES,
) -> None:
    ids = [gate.id for gate in gates]
    if len(ids) != len(set(ids)):
        raise ValueError("deployment readiness gate IDs must be unique")
    if not gates:
        raise ValueError("deployment readiness gate registry must not be empty")
    for gate in gates:
        text_fields = (
            gate.id,
            gate.protects,
            gate.failure_impact,
            gate.observation,
            gate.applicability,
            gate.recovery,
            gate.regression_test,
        )
        if any(not value.strip() for value in text_fields):
            raise ValueError(f"readiness gate is incomplete: {gate.id!r}")
        if gate.classification not in {"safety", "correctness", "warning"}:
            raise ValueError(f"readiness gate classification is invalid: {gate.id}")
        if type(gate.timeout_seconds) is not int or not 1 <= gate.timeout_seconds <= 300:
            raise ValueError(f"readiness gate timeout is invalid: {gate.id}")
        if "::test_" not in gate.regression_test:
            raise ValueError(f"readiness gate has no regression test owner: {gate.id}")


def readiness_review_payload(
    applicability: Mapping[str, bool | None] | None = None,
) -> dict[str, object]:
    """Return the validated, deterministic review attached to every preflight."""

    validate_readiness_gates()
    if applicability is not None:
        unknown = set(applicability) - {gate.id for gate in READINESS_GATES}
        if unknown or any(
            value is not None and type(value) is not bool
            for value in applicability.values()
        ):
            raise ValueError("readiness gate applicability is malformed")
    gates = []
    for gate in READINESS_GATES:
        record = asdict(gate)
        record["applies_now"] = (
            None if applicability is None else applicability.get(gate.id)
        )
        gates.append(record)
    return {
        "status": "passed",
        "gateCount": len(READINESS_GATES),
        "classifications": {
            classification: sum(
                gate.classification == classification for gate in READINESS_GATES
            )
            for classification in ("safety", "correctness", "warning")
        },
        "applicableGateCount": sum(
            record["applies_now"] is True for record in gates
        ),
        "indeterminateGateCount": sum(
            record["applies_now"] is None for record in gates
        ),
        "gates": gates,
    }


def registered_boundary_calls(owner: RouteOwner | None = None) -> frozenset[str]:
    return frozenset(
        boundary
        for stage in ROUTE_STAGES
        if owner is None or stage.owner == owner
        for boundary in stage.boundary_calls
    )


validate_route_contract()
validate_readiness_gates()
