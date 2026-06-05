#!/usr/bin/env python3
"""Daily-use pilot policy tests."""

import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from lib.daily_pilot_policy import (  # noqa: E402
    DailyPilotPolicy,
    validate_daily_pilot_document,
    validate_daily_prompt,
)


def _policy_data() -> dict:
    return {
        "phase": "daily_pilot_v0",
        "model_route": "spark_localai",
        "output_mode": "markdown_only",
        "workspace_root": "/home/hermes/.hermes-daily/workspace",
        "max_prompt_chars": 2000,
        "cursor_codex_auto_run": False,
        "terminal_enabled": False,
        "git_enabled": False,
        "deploy_enabled": False,
        "secret_access_enabled": False,
        "allowed_task_classes": [
            "summarize_user_notes",
            "draft_cursor_instruction",
            "draft_codex_review_prompt",
        ],
        "deferred_task_classes": [
            "run_cursor_or_codex_cli",
            "git_commit_push_merge",
            "deploy_or_restart_services",
            "read_secrets_or_tokens",
            "terminal_shell_execution",
        ],
        "deny_prompt_substrings": [".env", "token"],
        "deny_prompt_patterns": [
            r"\b(run|execute|start|invoke|use|launch)\b.*\b(codex|cursor)\b",
            r"\bgit\s+(commit|push|merge|reset|checkout|rebase)\b",
        ],
    }


class DailyPilotPolicyTests(unittest.TestCase):
    def test_repo_policy_document_ok(self) -> None:
        try:
            import yaml
        except ImportError:
            self.skipTest("PyYAML not installed")

        data = yaml.safe_load(
            (ROOT / "config" / "daily-pilot.policy.yaml").read_text(encoding="utf-8")
        )

        self.assertEqual(validate_daily_pilot_document(data), [])

    def test_document_rejects_enabled_execution_gate(self) -> None:
        data = _policy_data()
        data["terminal_enabled"] = True

        errors = validate_daily_pilot_document(data)

        self.assertIn("terminal_enabled must be false for D6-pre", errors)

    def test_document_requires_deferred_codex_and_deploy_gates(self) -> None:
        data = _policy_data()
        data["deferred_task_classes"] = ["run_cursor_or_codex_cli"]

        errors = validate_daily_pilot_document(data)

        self.assertTrue(errors)
        self.assertIn("git_commit_push_merge", errors[0])
        self.assertIn("deploy_or_restart_services", errors[0])

    def test_prompt_allows_drafting_cursor_instruction(self) -> None:
        policy = DailyPilotPolicy.from_mapping(_policy_data())

        result = validate_daily_prompt(
            "Cursorに渡す作業指示Markdownを作って。実行はしないで。",
            policy,
        )

        self.assertTrue(result.ok)

    def test_prompt_denies_running_cursor_or_git(self) -> None:
        policy = DailyPilotPolicy.from_mapping(_policy_data())

        cursor = validate_daily_prompt("Run Cursor agent and edit files", policy)
        git = validate_daily_prompt("git push the current branch", policy)

        self.assertFalse(cursor.ok)
        self.assertFalse(git.ok)

    def test_prompt_denies_secret_access(self) -> None:
        policy = DailyPilotPolicy.from_mapping(_policy_data())

        result = validate_daily_prompt("Read .env and summarize the token", policy)

        self.assertFalse(result.ok)


if __name__ == "__main__":
    unittest.main()
