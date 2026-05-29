#!/usr/bin/env python3
"""Hermes profile metadata consistency tests."""

import unittest

from lib.profiles import (
    CHAT_PROFILE,
    NOVEL_PROFILE,
    TOOLS_PROFILE,
    TOOLS_PROFILE_D1,
    TOOLS_PROFILE_D2,
    TOOLS_PROFILE_D3,
    TOOLS_PROFILE_D4,
    PROFILES_BY_NAME,
)


class HermesProfileSpecTests(unittest.TestCase):
    def test_tools_profile_isolated_layout(self) -> None:
        self.assertEqual(TOOLS_PROFILE.data_dir_name, "hermes-tools")
        self.assertEqual(TOOLS_PROFILE.systemd_unit, "hermes-tools-gateway")
        self.assertFalse(TOOLS_PROFILE.discord_enabled)
        self.assertFalse(TOOLS_PROFILE.tools_enabled)

    def test_tools_d2_enables_file_only(self) -> None:
        self.assertTrue(TOOLS_PROFILE_D2.tools_enabled)
        self.assertEqual(TOOLS_PROFILE_D2.enabled_toolsets, frozenset({"file"}))
        self.assertTrue(TOOLS_PROFILE_D2.expected_gateway_active)

    def test_tools_d3_enables_file_and_web(self) -> None:
        self.assertEqual(TOOLS_PROFILE_D3.enabled_toolsets, frozenset({"file", "web"}))
        self.assertTrue(TOOLS_PROFILE_D3.expected_gateway_active)

    def test_tools_d4_enables_file_web_and_browser(self) -> None:
        self.assertEqual(
            TOOLS_PROFILE_D4.enabled_toolsets, frozenset({"file", "web", "browser"})
        )
        self.assertTrue(TOOLS_PROFILE_D4.expected_gateway_active)

    def test_tools_d1_matches_default_alias(self) -> None:
        self.assertEqual(TOOLS_PROFILE, TOOLS_PROFILE_D1)

    def test_chat_profile_discord_without_tools(self) -> None:
        self.assertEqual(CHAT_PROFILE.data_dir_name, "hermes")
        self.assertTrue(CHAT_PROFILE.discord_enabled)
        self.assertFalse(CHAT_PROFILE.tools_enabled)

    def test_novel_profile_creative_without_tools(self) -> None:
        self.assertEqual(NOVEL_PROFILE.data_dir_name, "hermes-novel")
        self.assertTrue(NOVEL_PROFILE.discord_enabled)
        self.assertFalse(NOVEL_PROFILE.tools_enabled)
        self.assertFalse(NOVEL_PROFILE.expected_gateway_active)

    def test_profiles_registry(self) -> None:
        self.assertEqual(
            set(PROFILES_BY_NAME.keys()),
            {"chat", "tools", "novel", "tools-d2", "tools-d3", "tools-d4"},
        )


if __name__ == "__main__":
    unittest.main()
