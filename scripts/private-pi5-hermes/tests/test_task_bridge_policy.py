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
            "allowed_task_classes": ["read_workspace"],
            "deferred_task_classes": ["codex_or_cursor_worker_execution"],
            "deny_prompt_substrings": ["rm -rf"],
            "deny_prompt_patterns": [r"\bgit\s+push\b"],
            "bridge_executable_basename": "hermes-discord-task-bridge",
            "approval_relay": {
                "enabled": True,
                "store_dir": "/tmp/hermes-task-bridge-approvals",
                "request_timeout_seconds": 300,
                "poll_interval_seconds": 0.5,
            },
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
            "approval_relay": {
                "enabled": False,
                "store_dir": "/tmp/hermes-task-bridge-approvals",
                "request_timeout_seconds": 300,
                "poll_interval_seconds": 0.5,
            },
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
                "deny_prompt_patterns": [r"\bgit\s+push\b"],
                "bridge_executable_basename": "hermes-discord-task-bridge",
                "approval_relay": {
                    "enabled": True,
                    "store_dir": "/tmp/hermes-task-bridge-approvals",
                    "request_timeout_seconds": 300,
                    "poll_interval_seconds": 0.5,
                },
            }
        )
        result = validate_task_prompt("List workspace files", policy)
        self.assertTrue(result.ok)

    def test_validate_prompt_denies_deferred_worker_task(self) -> None:
        policy = TaskBridgePolicy.from_mapping(
            {
                "require_tools_phase": "d4",
                "max_prompt_chars": 200,
                "max_output_chars": 200,
                "runner_timeout_seconds": 60,
                "allowed_toolsets": ["file", "web", "browser"],
                "deny_prompt_substrings": [],
                "deny_prompt_patterns": [
                    r"\b(codex|cursor)\b.*\b(run|execute|start|invoke|use|launch)\b",
                    r"\b(run|execute|start|invoke|use|launch)\b.*\b(codex|cursor)\b",
                    r"\bgit\s+(commit|push|merge|reset|checkout|rebase)\b",
                ],
                "bridge_executable_basename": "hermes-discord-task-bridge",
                "approval_relay": {
                    "enabled": False,
                    "store_dir": "/tmp/hermes-task-bridge-approvals",
                    "request_timeout_seconds": 300,
                    "poll_interval_seconds": 0.5,
                },
            }
        )

        codex = validate_task_prompt("Run Codex against this repo", policy)
        git_push = validate_task_prompt("git push the current branch", policy)

        self.assertFalse(codex.ok)
        self.assertFalse(git_push.ok)

    def test_validate_document_rejects_invalid_deferred_pattern(self) -> None:
        data = {
            "require_tools_phase": "d4",
            "max_prompt_chars": 100,
            "max_output_chars": 200,
            "runner_timeout_seconds": 60,
            "allowed_toolsets": ["file", "web", "browser"],
            "deny_prompt_substrings": [],
            "deny_prompt_patterns": ["["],
            "bridge_executable_basename": "hermes-discord-task-bridge",
            "approval_relay": {
                "enabled": False,
                "store_dir": "/tmp/hermes-task-bridge-approvals",
                "request_timeout_seconds": 300,
                "poll_interval_seconds": 0.5,
            },
        }

        errors = validate_task_bridge_document(data)

        self.assertTrue(errors)
        self.assertIn("invalid deny_prompt_patterns entry", errors[0])

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
                "approval_relay": {
                    "enabled": False,
                    "store_dir": "/tmp/hermes-task-bridge-approvals",
                    "request_timeout_seconds": 300,
                    "poll_interval_seconds": 0.5,
                },
            }
        )
        result = validate_task_prompt("fetch https://evil.example", policy)
        self.assertFalse(result.ok)


if __name__ == "__main__":
    unittest.main()
