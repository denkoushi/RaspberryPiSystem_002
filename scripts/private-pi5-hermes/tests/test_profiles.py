#!/usr/bin/env python3
"""Hermes profile metadata consistency tests."""

import unittest

from lib.profiles import CHAT_PROFILE, TOOLS_PROFILE, PROFILES_BY_NAME


class HermesProfileSpecTests(unittest.TestCase):
    def test_tools_profile_isolated_layout(self) -> None:
        self.assertEqual(TOOLS_PROFILE.data_dir_name, "hermes-tools")
        self.assertEqual(TOOLS_PROFILE.systemd_unit, "hermes-tools-gateway")
        self.assertFalse(TOOLS_PROFILE.discord_enabled)
        self.assertFalse(TOOLS_PROFILE.tools_enabled)

    def test_chat_profile_discord_without_tools(self) -> None:
        self.assertEqual(CHAT_PROFILE.data_dir_name, "hermes")
        self.assertTrue(CHAT_PROFILE.discord_enabled)
        self.assertFalse(CHAT_PROFILE.tools_enabled)

    def test_profiles_registry(self) -> None:
        self.assertEqual(set(PROFILES_BY_NAME.keys()), {"chat", "tools"})


if __name__ == "__main__":
    unittest.main()
