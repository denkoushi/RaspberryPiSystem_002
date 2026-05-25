#!/usr/bin/env python3
"""Hermes browser adapter tests."""

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from lib.boundary_policy import BoundaryPolicy  # noqa: E402
from lib.hermes_browser_adapter import (  # noqa: E402
    DEFAULT_AGENT_BROWSER_ARGS,
    browser_config_document,
    browser_env_document,
    find_forbidden_cloud_browser_keys,
    hermes_browser_emission,
    normalize_agent_browser_args,
)


class HermesBrowserAdapterTests(unittest.TestCase):
    def test_browser_config_local_defaults(self) -> None:
        doc = browser_config_document()
        self.assertTrue(doc["auto_local_for_private_urls"])
        self.assertEqual(doc["inactivity_timeout"], 120)

    def test_normalize_agent_browser_args_default(self) -> None:
        self.assertEqual(normalize_agent_browser_args(None), DEFAULT_AGENT_BROWSER_ARGS)
        self.assertEqual(normalize_agent_browser_args(""), DEFAULT_AGENT_BROWSER_ARGS)

    def test_browser_env_document(self) -> None:
        doc = browser_env_document("--foo")
        self.assertEqual(doc["AGENT_BROWSER_ARGS"], "--foo")

    def test_hermes_browser_emission(self) -> None:
        policy = BoundaryPolicy(allowed_url_prefixes=("http://100.118.82.72:38081",))
        payload = hermes_browser_emission(policy)
        self.assertIn("browser_config", payload)
        self.assertIn("BROWSERBASE_API_KEY", payload["forbidden_cloud_browser_env_keys"])

    def test_find_forbidden_cloud_keys(self) -> None:
        env = "OPENAI_API_KEY=secret\nBROWSERBASE_API_KEY=bad\n"
        found = find_forbidden_cloud_browser_keys(env)
        self.assertEqual(found, ["BROWSERBASE_API_KEY"])


if __name__ == "__main__":
    unittest.main()
