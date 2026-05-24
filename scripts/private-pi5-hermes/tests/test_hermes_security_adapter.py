#!/usr/bin/env python3
"""Hermes security adapter tests."""

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from lib.boundary_policy import BoundaryPolicy  # noqa: E402
from lib.hermes_security_adapter import (  # noqa: E402
    expected_llm_base_url_from_policy,
    hermes_security_blocklist_document,
    website_blocklist_domains_from_policy,
)


class HermesSecurityAdapterTests(unittest.TestCase):
    def setUp(self) -> None:
        self.policy = BoundaryPolicy(
            allowed_url_prefixes=("http://100.118.82.72:38081",),
            denied_url_prefixes=(
                "http://127.0.0.1",
                "http://localhost",
                "http://192.168.128.",
                "https://",
            ),
            denied_host_patterns=(
                "regex:^10\\.",
                "regex:^172\\.(1[6-9]|2[0-9]|3[0-1])\\.",
                "regex:^192\\.168\\.",
            ),
        )

    def test_expected_llm_base_url(self) -> None:
        self.assertEqual(
            expected_llm_base_url_from_policy(self.policy),
            "http://100.118.82.72:38081",
        )

    def test_website_blocklist_includes_static_and_denied_hosts(self) -> None:
        domains = website_blocklist_domains_from_policy(self.policy)
        self.assertIn("localhost", domains)
        self.assertIn("127.0.0.1", domains)
        self.assertIn("*.local", domains)
        self.assertNotIn("*.192.168.*", domains)
        self.assertIn("192.168.128.", domains)

    def test_blocklist_document_shape(self) -> None:
        doc = hermes_security_blocklist_document(self.policy)
        self.assertTrue(doc["enabled"])
        self.assertIsInstance(doc["domains"], list)
        self.assertGreater(len(doc["domains"]), 0)


if __name__ == "__main__":
    unittest.main()
