#!/usr/bin/env python3
"""Tools profile phase expectation tests."""

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from lib.profile_phase import ProfilePhase, expectation_for_phase  # noqa: E402
from lib.profiles import TOOLS_PROFILE_D1, TOOLS_PROFILE_D2  # noqa: E402


class ProfilePhaseTests(unittest.TestCase):
    def test_from_tools_flags(self) -> None:
        self.assertIsNone(
            ProfilePhase.from_tools_flags(
                tools_profile_enabled=False,
                tools_file_enabled=False,
            )
        )
        self.assertEqual(
            ProfilePhase.from_tools_flags(
                tools_profile_enabled=True,
                tools_file_enabled=False,
            ),
            ProfilePhase.D1_SKELETON,
        )
        self.assertEqual(
            ProfilePhase.from_tools_flags(
                tools_profile_enabled=True,
                tools_file_enabled=True,
            ),
            ProfilePhase.D2_FILE_ONLY,
        )

    def test_d1_expectation(self) -> None:
        exp = expectation_for_phase(ProfilePhase.D1_SKELETON)
        self.assertEqual(exp.profile, TOOLS_PROFILE_D1)
        self.assertFalse(exp.require_tools_gateway_active)
        self.assertTrue(exp.config_must_disable_file_toolset)

    def test_d2_expectation(self) -> None:
        exp = expectation_for_phase(ProfilePhase.D2_FILE_ONLY)
        self.assertEqual(exp.profile, TOOLS_PROFILE_D2)
        self.assertTrue(exp.require_tools_gateway_active)
        self.assertTrue(exp.require_workspace_docker_mount)
        self.assertFalse(exp.config_must_disable_file_toolset)
        self.assertEqual(exp.profile.enabled_toolsets, frozenset({"file"}))


if __name__ == "__main__":
    unittest.main()
