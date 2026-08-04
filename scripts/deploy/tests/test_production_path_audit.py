from __future__ import annotations

import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[3]
MODULE_PATH = ROOT / "scripts/deploy/production_path_audit.py"
SPEC = importlib.util.spec_from_file_location("production_path_audit", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
AUDIT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(AUDIT)


class ProductionPathAuditTest(unittest.TestCase):
    def setUp(self) -> None:
        self.matrix = AUDIT.load_matrix(AUDIT.DEFAULT_MATRIX)

    def test_repository_matrix_covers_every_route_phase_and_incident(self) -> None:
        validated = AUDIT.validate_matrix(self.matrix)
        self.assertEqual(validated["routeStageCount"], 25)
        self.assertEqual(validated["pi5PhaseCount"], 13)
        self.assertEqual(validated["incidentCount"], 11)
        self.assertEqual(validated["uncovered"], [])

    def test_missing_route_or_incident_fails_closed(self) -> None:
        broken = copy.deepcopy(self.matrix)
        for scenario in broken["scenarios"]:
            scenario["routeStages"] = [
                route for route in scenario["routeStages"] if route != "terminal.rollback"
            ]
            scenario["incidents"] = [
                incident
                for incident in scenario["incidents"]
                if incident != "migration-gateway-image"
            ]
        with self.assertRaisesRegex(AUDIT.AuditError, "coverage is incomplete"):
            AUDIT.validate_matrix(broken)

    def test_static_only_mutation_evidence_is_rejected(self) -> None:
        broken = copy.deepcopy(self.matrix)
        for scenario in broken["scenarios"]:
            if "terminal.rollback" in scenario["routeStages"]:
                scenario["executionLevel"] = "static"
        with self.assertRaisesRegex(AUDIT.AuditError, "lack behavioral evidence"):
            AUDIT.validate_matrix(broken)

    def test_unknown_fields_duplicate_keys_and_missing_tests_are_rejected(self) -> None:
        broken = copy.deepcopy(self.matrix)
        broken["scenarios"][0]["unexpected"] = True
        with self.assertRaisesRegex(AUDIT.AuditError, "fields are incomplete or unknown"):
            AUDIT.validate_matrix(broken)

        with tempfile.TemporaryDirectory() as raw:
            path = Path(raw) / "duplicate.json"
            path.write_text('{"schemaVersion":1,"schemaVersion":1}', encoding="utf-8")
            with self.assertRaisesRegex(AUDIT.AuditError, "duplicate JSON key"):
                AUDIT.load_matrix(path)

        broken = copy.deepcopy(self.matrix)
        broken["scenarios"][0]["testOwner"] = "missing.py::test_missing"
        with self.assertRaisesRegex(AUDIT.AuditError, "test owner is unavailable"):
            AUDIT.validate_matrix(broken)

    def test_matrix_json_never_contains_secret_values_or_production_output(self) -> None:
        serialized = json.dumps(self.matrix, ensure_ascii=False).lower()
        for forbidden in (
            "jwt_access_secret=",
            "jwt_refresh_secret=",
            "postgresql://postgres:",
            "private key-----",
            "rawstdout",
            "rawstderr",
        ):
            self.assertNotIn(forbidden, serialized)


if __name__ == "__main__":
    unittest.main()
