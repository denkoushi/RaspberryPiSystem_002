from __future__ import annotations

import unittest

from scripts.deploy.deploy_impact import classify_change_records


class DeployImpactHelperTests(unittest.TestCase):
    def test_neutral_ci_and_docs_paths_have_no_runtime_target(self) -> None:
        result = classify_change_records(
            [
                {"status": "M", "path": "docs/guide.md"},
                {"status": "M", "path": "scripts/ci/validate_deploy_impact.py"},
            ]
        )
        self.assertEqual(result["affectedProfiles"], [])
        self.assertFalse(result["server"])
        self.assertFalse(result["kiosk"])
        self.assertFalse(result["signage"])

    def test_server_path_maps_to_pi5(self) -> None:
        result = classify_change_records(
            [{"status": "M", "path": "apps/api/src/routes/example.ts"}]
        )
        self.assertTrue(result["server"])
        self.assertFalse(result["kiosk"])
        self.assertFalse(result["signage"])

    def test_business_hermes_release_paths_are_known_server_paths(self) -> None:
        result = classify_change_records(
            [
                {
                    "status": "M",
                    "path": "infrastructure/ansible/roles/release_pi5/tasks/prepare.yml",
                },
                {
                    "status": "M",
                    "path": "infrastructure/ansible/templates/api.env.j2",
                },
            ]
        )
        self.assertTrue(result["server"])
        self.assertNotIn("unknown", result["components"])
        self.assertFalse(result["kiosk"])
        self.assertFalse(result["signage"])

    def test_status_agent_maps_to_pi4_and_pi3(self) -> None:
        result = classify_change_records(
            [{"status": "M", "path": "clients/status-agent/status-agent.py"}]
        )
        self.assertTrue(result["kiosk"])
        self.assertTrue(result["signage"])

    def test_unknown_and_rename_source_fail_closed(self) -> None:
        result = classify_change_records(
            [
                {
                    "status": "R100",
                    "path": "new/unknown-runtime.sh",
                    "previousPath": "old/unknown-runtime.sh",
                }
            ]
        )
        self.assertTrue(result["server"])
        self.assertTrue(result["kiosk"])
        self.assertTrue(result["signage"])
        self.assertIn("unknown", result["components"])


if __name__ == "__main__":
    unittest.main()
