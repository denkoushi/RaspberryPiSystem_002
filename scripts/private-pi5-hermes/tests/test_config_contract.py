#!/usr/bin/env python3
"""Hermes tools config / boundary alignment tests."""

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from lib.boundary_policy import BoundaryPolicy  # noqa: E402
from lib.config_contract import (  # noqa: E402
    config_declares_file_toolset_enabled,
    config_disables_file_toolset,
    docker_volume_mount,
    validate_tools_config_alignment,
    workspace_mounts_from_policy,
)


class ConfigContractTests(unittest.TestCase):
    def test_workspace_mount_from_policy(self) -> None:
        policy = BoundaryPolicy(
            allowed_fs_prefixes=("/home/hermes/.hermes-tools/workspace",),
        )
        self.assertEqual(
            workspace_mounts_from_policy(policy),
            ("/home/hermes/.hermes-tools/workspace:/workspace",),
        )

    def test_docker_volume_mount_helper(self) -> None:
        self.assertEqual(
            docker_volume_mount("/home/hermes/.hermes-tools/workspace"),
            "/home/hermes/.hermes-tools/workspace:/workspace",
        )

    def test_d2_config_alignment(self) -> None:
        policy = BoundaryPolicy(
            allowed_fs_prefixes=("/home/hermes/.hermes-tools/workspace",),
        )
        config = """
terminal:
  backend: docker
  docker_mount_cwd_to_workspace: false
  docker_volumes:
    - "/home/hermes/.hermes-tools/workspace:/workspace"
agent:
  disabled_toolsets:
    - web
    - terminal
"""
        errors = validate_tools_config_alignment(
            config, policy, file_toolset_enabled=True
        )
        self.assertEqual(errors, [])

    def test_d1_config_requires_file_disabled(self) -> None:
        policy = BoundaryPolicy(
            allowed_fs_prefixes=("/home/hermes/.hermes-tools/workspace",),
        )
        config = """
agent:
  disabled_toolsets:
    - file
    - web
"""
        errors = validate_tools_config_alignment(
            config, policy, file_toolset_enabled=False
        )
        self.assertEqual(errors, [])

    def test_config_disables_file_toolset(self) -> None:
        self.assertTrue(
            config_disables_file_toolset("agent:\n  disabled_toolsets:\n    - file\n")
        )
        self.assertFalse(
            config_disables_file_toolset("agent:\n  disabled_toolsets:\n    - web\n")
        )
        self.assertTrue(
            config_declares_file_toolset_enabled("agent:\n  disabled_toolsets:\n    - web\n")
        )


if __name__ == "__main__":
    unittest.main()
