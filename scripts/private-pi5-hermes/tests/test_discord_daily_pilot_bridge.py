#!/usr/bin/env python3
"""Discord /daily bridge tests."""

import asyncio
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from lib.daily_pilot_policy import DailyPilotPolicy  # noqa: E402
from lib.discord_daily_pilot_bridge import (  # noqa: E402
    render_daily_usage,
    run_daily_pilot_bridge,
    run_daily_pilot_bridge_async,
)


def _policy() -> DailyPilotPolicy:
    return DailyPilotPolicy.from_mapping(
        {
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
    )


class DiscordDailyPilotBridgeTests(unittest.TestCase):
    def test_usage_mentions_daily_command(self) -> None:
        self.assertIn("/daily", render_daily_usage())

    def test_bridge_returns_markdown_handoff_only(self) -> None:
        result = run_daily_pilot_bridge(
            "今日の作業メモを整理してCursor指示書にして",
            _policy(),
        )

        self.assertIn("# Daily Pilot Draft", result)
        self.assertIn("## Cursor Instruction Draft", result)
        self.assertIn("## Codex Review Prompt Draft", result)
        self.assertIn("Markdown only", result)
        self.assertIn("run_cursor_or_codex_cli", result)

    def test_bridge_rejects_execution_prompt(self) -> None:
        result = run_daily_pilot_bridge("Run Cursor and edit files", _policy())

        self.assertIn("daily rejected:", result)
        self.assertIn("/daily", result)

    def test_async_bridge_uses_same_contract(self) -> None:
        result = asyncio.run(
            run_daily_pilot_bridge_async(
                "CI結果を見て次の確認項目を整理して",
                _policy(),
            )
        )

        self.assertIn("## Checks Before Next Step", result)


if __name__ == "__main__":
    unittest.main()
