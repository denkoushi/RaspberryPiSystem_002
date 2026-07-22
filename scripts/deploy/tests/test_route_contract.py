from __future__ import annotations

import ast
import unittest
from pathlib import Path

from scripts.deploy.rolling_release.route_contract import (
    ROUTE_STAGES,
    registered_boundary_calls,
    validate_route_contract,
)


PROJECT = Path(__file__).resolve().parents[3]


REHEARSAL_TESTS = {
    "application-contract": (
        "scripts/deploy/tests/test_release_application.py",
        "test_local_launch_uses_only_read_only_inventory_adapters",
    ),
    "migration-preflight-contract": (
        "scripts/deploy/tests/test_migration_preflight.py",
        "test_success_requires_sealed_evidence_and_cleans_temporary_directory",
    ),
    "terminal-preflight-contract": (
        "scripts/deploy/tests/test_terminal_preflight.py",
        "test_orchestrator_reports_all_issues_before_any_release_unit",
    ),
    "bootstrap-before-after-faults": (
        "scripts/deploy/tests/test_remote_bootstrap.py",
        "test_cancel_after_checkout_prevents_coordinator_exec",
    ),
    "coordinator-entry-contract": (
        "scripts/deploy/tests/test_fleet_coordinator_transitions.py",
        "test_target_inventory_identity_mismatch_precedes_fleet_and_devices",
    ),
    "candidate-residue-before-after-faults": (
        "scripts/deploy/tests/test_fleet_coordinator_transitions.py",
        "test_candidate_reconcile_failure_precedes_fleet_state_and_noop_planning",
    ),
    "fleet-commit-before-after-faults": (
        "scripts/deploy/tests/test_fleet_coordinator_transitions.py",
        "test_noop_finishes_fleet_before_legacy_success",
    ),
    "interrupted-recovery-before-after-faults": (
        "scripts/deploy/tests/test_fleet_coordinator_transitions.py",
        "test_new_run_restores_interrupted_terminal_before_planning",
    ),
    "scope-success-and-fail-closed": (
        "scripts/deploy/tests/test_rolling_release.py",
        "test_limit_cannot_exclude_an_unknown_terminal",
    ),
    "server-config-before-after-faults": (
        "scripts/deploy/tests/test_fleet_coordinator_transitions.py",
        "test_pi5_host_config_restore_failure_retains_active_recovery_authority",
    ),
    "pi5-release-before-after-faults": (
        "scripts/deploy/tests/test_rolling_release.py",
        "test_interrupted_candidate_preparation_boundaries_are_discarded",
    ),
    "pipelining-preflight-before-terminal-mutation": (
        "scripts/deploy/tests/test_fleet_coordinator_transitions.py",
        "test_pipelining_preflight_failure_precedes_every_terminal_mutation",
    ),
    "terminal-capture-before-after-faults": (
        "scripts/deploy/tests/test_fleet_coordinator_transitions.py",
        "test_manifest_capture_failure_precedes_every_terminal_mutation",
    ),
    "notice-before-after-faults": (
        "scripts/deploy/tests/test_fleet_coordinator_transitions.py",
        "test_pre_mutation_recovery_removes_notice_on_either_side_of_notice_put",
    ),
    "maintenance-before-after-faults": (
        "scripts/deploy/tests/test_fleet_coordinator_transitions.py",
        "test_maintenance_ack_timeout_is_a_warning_before_terminal_apply",
    ),
    "apply-before-after-faults": (
        "scripts/deploy/tests/test_fleet_coordinator_transitions.py",
        "test_full_signage_failure_matrix_recovers_before_next_plan",
    ),
    "web-activation-response-loss-faults": (
        "scripts/deploy/tests/test_fleet_coordinator_transitions.py",
        "test_uncertain_kiosk_web_activation_retains_maintenance_without_rollback",
    ),
    "ready-and-observation-failures": (
        "scripts/deploy/tests/test_fleet_coordinator_transitions.py",
        "test_kiosk_agent_death_after_playbook_is_caught_by_final_observation",
    ),
    "finalization-before-after-faults": (
        "scripts/deploy/tests/test_fleet_coordinator_transitions.py",
        "test_forward_runtime_cleanup_failure_stays_unknown_without_rollback",
    ),
    "rollback-before-after-faults": (
        "scripts/deploy/tests/test_fleet_coordinator_transitions.py",
        "test_unverifiable_rollback_remains_unknown",
    ),
    "approval-success-timeout-cancel": (
        "scripts/deploy/tests/test_rolling_release.py",
        "test_canary_hold_timeout_fails_closed_without_remaining_targets",
    ),
    "status-approve-cancel-contract": (
        "scripts/deploy/tests/test_release_application.py",
        "test_cancel_records_control_before_signalling",
    ),
}


def attribute_calls(path: Path, receiver: str) -> set[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    return {
        node.func.attr
        for node in ast.walk(tree)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and isinstance(node.func.value, ast.Name)
        and node.func.value.id == receiver
    }


def test_methods(path: Path) -> set[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    return {
        node.name
        for node in ast.walk(tree)
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
        and node.name.startswith("test_")
    }


class RouteContractTest(unittest.TestCase):
    def test_route_contract_is_complete_and_unique(self):
        validate_route_contract()
        self.assertEqual(len(ROUTE_STAGES), len({stage.id for stage in ROUTE_STAGES}))
        self.assertTrue(all(stage.preflight_proof for stage in ROUTE_STAGES))
        self.assertTrue(all(stage.recovery_owner for stage in ROUTE_STAGES))

    def test_terminal_commit_boundaries_name_typed_claim_proofs(self):
        stages = {stage.id: stage for stage in ROUTE_STAGES}

        self.assertEqual(
            stages["terminal.ready"].preflight_proof,
            "terminal.complete-required-typed-claims-and-independent-health",
        )
        self.assertEqual(
            stages["terminal.finalize"].preflight_proof,
            "terminal.verified-typed-claims-independent-health-and-cleanup",
        )
        self.assertEqual(
            stages["terminal.rollback"].preflight_proof,
            "terminal.sealed-rollback-preflight-and-typed-claim-rebind",
        )

    def test_every_route_rehearsal_resolves_to_an_existing_test(self):
        rehearsal_ids = {stage.rehearsal for stage in ROUTE_STAGES}
        self.assertEqual(rehearsal_ids, set(REHEARSAL_TESTS))
        for rehearsal_id, (relative_path, method) in REHEARSAL_TESTS.items():
            path = PROJECT / relative_path
            with self.subTest(rehearsal=rehearsal_id):
                self.assertTrue(path.is_file(), path)
                self.assertIn(method, test_methods(path))

    def test_local_application_runtime_boundaries_are_registered(self):
        calls = attribute_calls(
            PROJECT / "scripts/deploy/rolling_release/application.py", "runtime"
        )
        benign = {"release_hosts"}
        self.assertEqual(calls - benign - registered_boundary_calls(), set())

    def test_coordinator_runtime_and_adapter_boundaries_are_registered(self):
        path = PROJECT / "scripts/deploy/rolling_release/coordinator.py"
        runtime_calls = attribute_calls(path, "runtime")
        benign = {"utc_now"}
        adapter_calls = attribute_calls(path, "adapter")
        pure_adapter_policy = {
            "expected_ready_sha",
            "expected_rollback_ready_sha",
            "interrupted_rollback_ready_sha",
            "notice_skip_reason",
            "ready_claim_kind",
            "release_claim_authority",
            "should_issue_notice",
        }
        self.assertEqual(
            runtime_calls - benign - registered_boundary_calls(), set()
        )
        self.assertEqual(
            adapter_calls - pure_adapter_policy - registered_boundary_calls(), set()
        )


if __name__ == "__main__":
    unittest.main()
