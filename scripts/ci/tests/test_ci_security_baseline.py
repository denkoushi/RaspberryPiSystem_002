from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]


class CiSecurityBaselineContracts(unittest.TestCase):
    def read(self, relative: str) -> str:
        return (ROOT / relative).read_text(encoding="utf-8")

    def test_authentication_browser_paths_cannot_be_skipped_in_ci(self) -> None:
        auth = self.read("e2e/auth.spec.ts")
        mfa = self.read("e2e/smoke/mfa-remember-smoke.spec.ts")
        self.assertNotIn("test.skip", auth)
        self.assertNotIn("test.skip", mfa)
        self.assertIn("E2E_ADMIN_USERNAME", auth)
        self.assertIn("E2E_ADMIN_PASSWORD", auth)
        self.assertIn("waitForResponse", auth)

    def test_ci_generates_test_credentials_and_runs_all_new_gates(self) -> None:
        workflow = self.read(".github/workflows/ci.yml")
        self.assertIn('E2E_ADMIN_PASSWORD=$(openssl rand -hex 24)', workflow)
        self.assertIn("poetry run pytest tests", workflow)
        self.assertIn("poetry run ruff check torque_agent tests", workflow)
        self.assertIn("pnpm --filter @raspi-system/web test:coverage", workflow)
        self.assertIn("COVERAGE_ENFORCE_THRESHOLDS:", workflow)
        self.assertIn("validate_dependency_exceptions.py", workflow)
        self.assertIn("validate_production_secret_structure.py", workflow)

    def test_db_infra_production_api_uses_the_dedicated_application_role(self) -> None:
        workflow = self.read(".github/workflows/ci.yml")
        bootstrap = workflow.index(
            "Prepare least-privilege roles for production-mode API"
        )
        start = workflow.index("Start API server for monitoring tests")
        cleanup = workflow.index("Cleanup DB/infra services")
        self.assertLess(bootstrap, start)
        start_block = workflow[start:cleanup]
        self.assertIn("scripts/deploy/postgres-role-bootstrap.sql", workflow)
        self.assertIn("postgresql://raspi_app:${CI_APP_DB_PASSWORD}", start_block)
        self.assertNotIn("postgresql://postgres:postgres", start_block)

    def test_coverage_floors_match_measured_baselines(self) -> None:
        api = self.read("apps/api/vitest.config.ts")
        web = self.read("apps/web/vite.config.ts")
        for fragment in ("statements: 69", "branches: 57", "functions: 76", "lines: 71"):
            self.assertIn(fragment, api)
        self.assertIn("COVERAGE_ENFORCE_THRESHOLDS", api)
        for fragment in ("statements: 61", "branches: 58", "functions: 55", "lines: 63"):
            self.assertIn(fragment, web)

    def test_dependabot_covers_selected_ecosystems(self) -> None:
        dependabot = self.read(".github/dependabot.yml")
        for ecosystem in ("npm", "github-actions", "docker", "pip"):
            self.assertIn(f"package-ecosystem: {ecosystem}", dependabot)
        self.assertEqual(dependabot.count("interval: weekly"), 4)


if __name__ == "__main__":
    unittest.main()
