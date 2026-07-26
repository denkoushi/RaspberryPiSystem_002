#!/usr/bin/env python3
from __future__ import annotations

import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
WORKFLOW = ROOT / ".github/workflows/ci.yml"
AUDIT_RUNNER = ROOT / "scripts/ci/run-pnpm-bulk-audit.mjs"


class SecurityAuditWorkflowTests(unittest.TestCase):
    def test_bulk_audit_uses_an_isolated_pinned_client_without_fail_open(self) -> None:
        text = WORKFLOW.read_text(encoding="utf-8")

        self.assertIn("node-version: '22'", text)
        self.assertIn("AUDIT_PNPM_VERSION: '11.4.0'", text)
        self.assertIn("node scripts/ci/run-pnpm-bulk-audit.mjs", text)
        self.assertNotIn("--ignore-registry-errors", text)
        self.assertNotIn("pnpm audit --audit-level=critical", text)

        shared_tests = text.index("- name: Run shelf-layout-core tests")
        setup_bulk_audit = text.index("- name: Setup Node.js for bulk advisory audit")
        run_bulk_audit = text.index("- name: Security scan (pnpm bulk audit)")
        self.assertLess(shared_tests, setup_bulk_audit)
        self.assertLess(setup_bulk_audit, run_bulk_audit)

    def test_bulk_audit_proxy_preserves_fail_closed_contract(self) -> None:
        text = AUDIT_RUNNER.read_text(encoding="utf-8")

        self.assertIn("'accept-encoding': 'identity'", text)
        self.assertIn("pnpm bulk audit (critical+) failed after retries", text)
        self.assertIn("auditLevel: 'critical'", text)
        self.assertIn("auditLevel: 'high'", text)
        self.assertNotIn("--ignore-registry-errors", text)
        subprocess.run(
            ["node", str(AUDIT_RUNNER), "--self-test"],
            cwd=ROOT,
            check=True,
            capture_output=True,
            text=True,
        )


if __name__ == "__main__":
    unittest.main()
