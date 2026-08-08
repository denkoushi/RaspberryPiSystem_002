from __future__ import annotations

import ast
import unittest
from pathlib import Path

from scripts.deploy.rolling_release.route_contract import (
    READINESS_GATES,
    ROUTE_STAGES,
    registered_boundary_calls,
    validate_readiness_gates,
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

    def test_every_readiness_gate_has_meaning_and_a_real_test_owner(self):
        validate_readiness_gates()
        self.assertEqual(
            len(READINESS_GATES), len({gate.id for gate in READINESS_GATES})
        )
        self.assertEqual(
            {gate.classification for gate in READINESS_GATES},
            {"safety", "correctness", "warning"},
        )
        for gate in READINESS_GATES:
            relative_path, method = gate.regression_test.split("::", 1)
            path = PROJECT / relative_path
            with self.subTest(gate=gate.id):
                self.assertTrue(path.is_file(), path)
                self.assertIn(method, test_methods(path))

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
        self.assertTrue(set(REHEARSAL_TESTS) <= rehearsal_ids)
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


if __name__ == "__main__":
    unittest.main()
