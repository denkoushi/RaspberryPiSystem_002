#!/usr/bin/env python3
"""Task bridge policy tests."""

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from lib.task_bridge_policy import (  # noqa: E402
    TaskBridgePolicy,
    validate_task_bridge_document,
    validate_task_prompt,
)


class TaskBridgePolicyTests(unittest.TestCase):
    def test_validate_document_ok(self) -> None:
        data = {
            "require_tools_phase": "d4",
            "max_prompt_chars": 100,
            "max_output_chars": 200,
            "runner_timeout_seconds": 60,
            "allowed_toolsets": ["file", "web", "browser"],
            "deny_prompt_substrings": ["rm -rf"],
            "bridge_executable_basename": "hermes-discord-task-bridge",
        }
        self.assertEqual(validate_task_bridge_document(data), [])

    def test_reject_wrong_toolsets(self) -> None:
        data = {
            "require_tools_phase": "d4",
            "max_prompt_chars": 100,
            "max_output_chars": 200,
            "runner_timeout_seconds": 60,
            "allowed_toolsets": ["file"],
            "deny_prompt_substrings": [],
            "bridge_executable_basename": "hermes-discord-task-bridge",
        }
        self.assertTrue(validate_task_bridge_document(data))

    def test_validate_prompt_ok(self) -> None:
        policy = TaskBridgePolicy.from_mapping(
            {
                "require_tools_phase": "d4",
                "max_prompt_chars": 200,
                "max_output_chars": 200,
                "runner_timeout_seconds": 60,
                "allowed_toolsets": ["file", "web", "browser"],
                "deny_prompt_substrings": ["rm -rf"],
                "bridge_executable_basename": "hermes-discord-task-bridge",
            }
        )
        result = validate_task_prompt("List workspace files", policy)
        self.assertTrue(result.ok)

    def test_validate_prompt_denies_url(self) -> None:
        policy = TaskBridgePolicy.from_mapping(
            {
                "require_tools_phase": "d4",
                "max_prompt_chars": 200,
                "max_output_chars": 200,
                "runner_timeout_seconds": 60,
                "allowed_toolsets": ["file", "web", "browser"],
                "deny_prompt_substrings": [],
                "bridge_executable_basename": "hermes-discord-task-bridge",
            }
        )
        result = validate_task_prompt("fetch https://evil.example", policy)
        self.assertFalse(result.ok)


if __name__ == "__main__":
    unittest.main()
