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
    config_disables_web_toolset,
    docker_volume_mount,
    validate_tools_config_alignment,
    website_blocklist_domains_from_policy,
    workspace_mounts_from_policy,
)
from lib.hermes_security_adapter import hermes_security_blocklist_document  # noqa: E402


class ConfigContractTests(unittest.TestCase):
    def setUp(self) -> None:
        self.policy = BoundaryPolicy(
            allowed_url_prefixes=("http://100.118.82.72:38081",),
            allowed_fs_prefixes=("/home/hermes/.hermes-tools/workspace",),
            denied_url_prefixes=(
                "http://127.0.0.1",
                "http://localhost",
                "https://",
            ),
            denied_host_patterns=("regex:^192\\.168\\.",),
        )

    def test_workspace_mount_from_policy(self) -> None:
        self.assertEqual(
            workspace_mounts_from_policy(self.policy),
            ("/home/hermes/.hermes-tools/workspace:/workspace",),
        )

    def test_docker_volume_mount_helper(self) -> None:
        self.assertEqual(
            docker_volume_mount("/home/hermes/.hermes-tools/workspace"),
            "/home/hermes/.hermes-tools/workspace:/workspace",
        )

    def _d2_config(self) -> str:
        return """
terminal:
  backend: docker
  docker_mount_cwd_to_workspace: false
  docker_volumes:
    - "/home/hermes/.hermes-tools/workspace:/workspace"
model:
  base_url: http://100.118.82.72:38081/v1
custom_providers:
  - base_url: http://100.118.82.72:38081/v1
agent:
  disabled_toolsets:
    - web
    - terminal
"""

    def _d3_config(self) -> str:
        blocklist = hermes_security_blocklist_document(self.policy)
        domains_yaml = "\n".join(f"      - \"{domain}\"" for domain in blocklist["domains"])
        return f"""
terminal:
  backend: docker
  docker_volumes:
    - "/home/hermes/.hermes-tools/workspace:/workspace"
model:
  base_url: http://100.118.82.72:38081/v1
custom_providers:
  - base_url: http://100.118.82.72:38081/v1
agent:
  disabled_toolsets:
    - terminal
security:
  allow_private_urls: true
  website_blocklist:
    enabled: true
    domains:
{domains_yaml}
    shared_files: []
"""

    def test_d2_config_alignment(self) -> None:
        errors = validate_tools_config_alignment(
            self._d2_config(), self.policy, file_toolset_enabled=True, web_toolset_enabled=False
        )
        self.assertEqual(errors, [])

    def test_d3_config_alignment(self) -> None:
        errors = validate_tools_config_alignment(
            self._d3_config(), self.policy, file_toolset_enabled=True, web_toolset_enabled=True
        )
        self.assertEqual(errors, [])

    def test_d1_config_requires_file_disabled(self) -> None:
        config = """
agent:
  disabled_toolsets:
    - file
    - web
"""
        errors = validate_tools_config_alignment(
            config, self.policy, file_toolset_enabled=False, web_toolset_enabled=False
        )
        self.assertEqual(errors, [])

    def test_config_disables_toolsets(self) -> None:
        self.assertTrue(
            config_disables_file_toolset("agent:\n  disabled_toolsets:\n    - file\n")
        )
        self.assertTrue(config_disables_web_toolset("agent:\n  disabled_toolsets:\n    - web\n"))
        self.assertTrue(
            config_declares_file_toolset_enabled("agent:\n  disabled_toolsets:\n    - web\n")
        )

    def test_d3_requires_file_when_web_enabled(self) -> None:
        config = """
agent:
  disabled_toolsets:
    - file
    - terminal
security:
  website_blocklist:
    enabled: true
    domains:
      - localhost
model:
  base_url: http://100.118.82.72:38081/v1
"""
        errors = validate_tools_config_alignment(
            config, self.policy, file_toolset_enabled=False, web_toolset_enabled=True
        )
        self.assertTrue(any("requires file" in err for err in errors))

    def test_blocklist_domains_from_policy_non_empty(self) -> None:
        domains = website_blocklist_domains_from_policy(self.policy)
        self.assertIn("localhost", domains)

    def test_d3_rejects_duplicate_security_blocks(self) -> None:
        config = f"""
security:
  allow_private_urls: true
security:
  website_blocklist:
    enabled: true
    domains:
      - "localhost"
model:
  base_url: http://100.118.82.72:38081/v1
custom_providers:
  - base_url: http://100.118.82.72:38081/v1
agent:
  disabled_toolsets:
    - terminal
terminal:
  docker_volumes:
    - "/home/hermes/.hermes-tools/workspace:/workspace"
"""
        errors = validate_tools_config_alignment(
            config, self.policy, file_toolset_enabled=True, web_toolset_enabled=True
        )
        self.assertTrue(any("exactly one security block" in err for err in errors))


if __name__ == "__main__":
    unittest.main()
