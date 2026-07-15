import sys
import unittest
from pathlib import Path


DEPLOY_DIRECTORY = Path(__file__).parents[1]
if str(DEPLOY_DIRECTORY) not in sys.path:
    sys.path.insert(0, str(DEPLOY_DIRECTORY))

from rolling_release.models import UnitObservation
from rolling_release.reconcile import reconcile_status


def unit(**changes):
    values = {
        "unit_name": "raspi-release-run-42.service",
        "reachable": True,
        "load_state": "loaded",
        "active_state": "inactive",
        "sub_state": "dead",
        "result": "success",
        "exec_main_code": "exited",
        "exec_main_status": 0,
    }
    values.update(changes)
    return UnitObservation(**values)


class ReleaseStatusReconciliationTest(unittest.TestCase):
    def test_active_unit_never_exposes_premature_success(self):
        result = reconcile_status(
            {
                "runId": "run-42",
                "state": "success",
                "endedAt": "2026-07-15T00:00:00Z",
                "completedAt": "2026-07-15T00:00:00Z",
                "exitCode": 0,
            },
            None,
            unit(active_state="active", sub_state="running"),
        )
        self.assertEqual(result["state"], "running")
        self.assertNotIn("endedAt", result)
        self.assertNotIn("completedAt", result)
        self.assertNotIn("exitCode", result)

    def test_active_unit_with_control_is_cancelling(self):
        result = reconcile_status(
            {"runId": "run-42", "state": "running"},
            {"runId": "run-42", "reason": "safe stop"},
            unit(active_state="active", sub_state="running"),
        )
        self.assertEqual(result["state"], "cancelling")

    def test_success_requires_persisted_success_and_nonconflicting_unit(self):
        self.assertEqual(
            reconcile_status(
                {"runId": "run-42", "state": "success"},
                None,
                unit(load_state="not-found", active_state=None, result=None, exec_main_status=None),
            )["state"],
            "success",
        )
        self.assertEqual(reconcile_status(None, None, unit())["state"], "interrupted")

    def test_failed_unit_overrides_a_conflicting_success_record(self):
        result = reconcile_status(
            {"runId": "run-42", "state": "success"},
            None,
            unit(result="exit-code", exec_main_status=1),
        )
        self.assertEqual(result["state"], "interrupted")
        self.assertEqual(result["exitCode"], 1)

    def test_lock_contention_is_a_failed_run_without_state_mutation(self):
        result = reconcile_status(None, None, unit(result="exit-code", exec_main_status=75))
        self.assertEqual(result["state"], "failed")
        self.assertEqual(result["runId"], "run-42")
        self.assertEqual(result["exitCode"], 75)
        self.assertIn("kernel lock", result["failure"])

    def test_cancel_control_and_exit_130_reconcile_to_cancelled(self):
        result = reconcile_status(
            {"runId": "run-42", "state": "running"},
            {"runId": "run-42", "reason": "safe stop"},
            unit(result="exit-code", exec_main_status=130),
        )
        self.assertEqual(result["state"], "cancelled")
        self.assertEqual(result["exitCode"], 130)

    def test_signal_without_control_is_interrupted(self):
        result = reconcile_status(
            {"runId": "run-42", "state": "running"},
            None,
            unit(result="signal", exec_main_code="killed", exec_main_status=10),
        )
        self.assertEqual(result["state"], "interrupted")
        self.assertEqual(result["exitCode"], 10)

    def test_numeric_systemd_killed_code_is_interrupted(self):
        result = reconcile_status(
            {"runId": "run-42", "state": "running"},
            None,
            unit(result="success", exec_main_code="2", exec_main_status=10),
        )
        self.assertEqual(result["state"], "interrupted")
        self.assertEqual(result["exitCode"], 10)

    def test_unknown_systemd_state_never_returns_persisted_success(self):
        with self.assertRaisesRegex(RuntimeError, "unreachable"):
            reconcile_status(
                {"runId": "run-42", "state": "success"},
                None,
                unit(reachable=False, error="sudo denied"),
            )

    def test_unit_and_records_all_missing_is_not_found(self):
        result = reconcile_status(
            None,
            None,
            unit(load_state="not-found", active_state=None, result=None, exec_main_status=None),
        )
        self.assertEqual(result["state"], "not-found")


if __name__ == "__main__":
    unittest.main()
