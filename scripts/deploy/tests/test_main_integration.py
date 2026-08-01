#!/usr/bin/env python3
from __future__ import annotations

import unittest

from scripts.deploy.rolling_release.main_integration import (
    build_main_integration_audit,
)


SOURCE = "a" * 40
MAIN = "b" * 40
PRODUCTION_A = "c" * 40
PRODUCTION_B = "d" * 40


class MainIntegrationAuditTest(unittest.TestCase):
    def test_integrated_source_and_production_are_completion_eligible(self):
        audit = build_main_integration_audit(
            source_sha=SOURCE,
            origin_main_sha=MAIN,
            production_shas=[PRODUCTION_A, PRODUCTION_A],
            is_ancestor=lambda _candidate, _main: True,
        )

        self.assertEqual(audit["status"], "integrated")
        self.assertTrue(audit["sourceShaIsInMain"])
        self.assertEqual(audit["productionSha"], PRODUCTION_A)
        self.assertEqual(audit["productionShas"], [PRODUCTION_A])
        self.assertTrue(audit["productionShaIsInMain"])
        self.assertFalse(audit["integrationPending"])
        self.assertTrue(audit["completionEligible"])
        self.assertEqual(audit["issues"], [])

    def test_feature_branch_source_blocks_completion_without_blocking_release(self):
        audit = build_main_integration_audit(
            source_sha=SOURCE,
            origin_main_sha=MAIN,
            production_shas=[PRODUCTION_A],
            is_ancestor=lambda candidate, _main: candidate == PRODUCTION_A,
        )

        self.assertEqual(audit["status"], "pending")
        self.assertFalse(audit["sourceShaIsInMain"])
        self.assertTrue(audit["productionShaIsInMain"])
        self.assertTrue(audit["integrationPending"])
        self.assertFalse(audit["completionEligible"])

    def test_mixed_production_shas_remain_visible_and_can_all_be_integrated(self):
        audit = build_main_integration_audit(
            source_sha=SOURCE,
            origin_main_sha=MAIN,
            production_shas=[PRODUCTION_B, PRODUCTION_A],
            is_ancestor=lambda _candidate, _main: True,
        )

        self.assertIsNone(audit["productionSha"])
        self.assertEqual(
            audit["productionShas"], [PRODUCTION_A, PRODUCTION_B]
        )
        self.assertTrue(audit["productionShaIsInMain"])
        self.assertTrue(audit["completionEligible"])

    def test_one_unmerged_production_sha_blocks_completion(self):
        audit = build_main_integration_audit(
            source_sha=SOURCE,
            origin_main_sha=MAIN,
            production_shas=[PRODUCTION_A, PRODUCTION_B],
            is_ancestor=lambda candidate, _main: candidate != PRODUCTION_B,
        )

        self.assertEqual(audit["status"], "pending")
        self.assertFalse(audit["productionShaIsInMain"])
        self.assertTrue(audit["integrationPending"])

    def test_missing_or_malformed_evidence_fails_closed(self):
        for values in (
            {"source_sha": "bad", "origin_main_sha": MAIN, "production_shas": [PRODUCTION_A]},
            {"source_sha": SOURCE, "origin_main_sha": None, "production_shas": [PRODUCTION_A]},
            {"source_sha": SOURCE, "origin_main_sha": MAIN, "production_shas": []},
            {"source_sha": SOURCE, "origin_main_sha": MAIN, "production_shas": [None]},
        ):
            with self.subTest(values=values):
                audit = build_main_integration_audit(
                    **values,
                    is_ancestor=lambda _candidate, _main: True,
                )
            self.assertEqual(audit["status"], "unavailable")
            self.assertTrue(audit["integrationPending"])
            self.assertFalse(audit["completionEligible"])
            self.assertTrue(audit["issues"])

    def test_non_authoritative_main_fallback_fails_closed(self):
        audit = build_main_integration_audit(
            source_sha=SOURCE,
            origin_main_sha=MAIN,
            production_shas=[PRODUCTION_A],
            is_ancestor=lambda _candidate, _main: True,
            origin_main_authoritative=False,
        )

        self.assertIsNone(audit["originMainSha"])
        self.assertEqual(audit["status"], "unavailable")
        self.assertIn("origin-main.sha-unavailable", audit["issues"])

    def test_ancestry_errors_and_non_boolean_results_fail_closed(self):
        def unavailable(_candidate: str, _main: str) -> bool:
            raise RuntimeError("git unavailable")

        for predicate in (unavailable, lambda _candidate, _main: 1):
            with self.subTest(predicate=predicate):
                audit = build_main_integration_audit(
                    source_sha=SOURCE,
                    origin_main_sha=MAIN,
                    production_shas=[PRODUCTION_A],
                    is_ancestor=predicate,
                )
            self.assertEqual(audit["status"], "unavailable")
            self.assertFalse(audit["completionEligible"])
            self.assertTrue(
                any(issue.endswith(("ancestry-unavailable", "ancestry-malformed")) for issue in audit["issues"])
            )


if __name__ == "__main__":
    unittest.main()
