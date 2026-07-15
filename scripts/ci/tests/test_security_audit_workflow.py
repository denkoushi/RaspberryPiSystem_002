#!/usr/bin/env python3
from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
WORKFLOW = ROOT / ".github/workflows/ci.yml"


class SecurityAuditWorkflowTests(unittest.TestCase):
    def test_bulk_audit_uses_an_isolated_pinned_client_without_fail_open(self) -> None:
        text = WORKFLOW.read_text(encoding="utf-8")

        self.assertIn("node-version: '22'", text)
        self.assertIn("AUDIT_PNPM_VERSION: '11.4.0'", text)
        self.assertIn("cd /tmp", text)
        self.assertIn(
            'npx --yes "pnpm@${AUDIT_PNPM_VERSION}" with "${AUDIT_PNPM_VERSION}"',
            text,
        )
        self.assertIn("run_audit --audit-level=critical", text)
        self.assertIn("pnpm bulk audit (critical+) failed after retries", text)
        self.assertNotIn("--ignore-registry-errors", text)
        self.assertNotIn("pnpm audit --audit-level=critical", text)

        build_web = text.index("- name: Build Web")
        setup_bulk_audit = text.index("- name: Setup Node.js for bulk advisory audit")
        run_bulk_audit = text.index("- name: Security scan (pnpm bulk audit)")
        self.assertLess(build_web, setup_bulk_audit)
        self.assertLess(setup_bulk_audit, run_bulk_audit)


if __name__ == "__main__":
    unittest.main()
