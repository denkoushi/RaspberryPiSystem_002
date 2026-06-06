#!/usr/bin/env python3
"""Discord Life Pilot bridge tests."""

import asyncio
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from lib.discord_life_pilot_bridge import (  # noqa: E402
    render_memo_usage,
    run_life_digest_bridge,
    run_life_digest_bridge_async,
    run_life_memo_bridge,
    run_life_recommend_bridge,
    run_life_remind_bridge,
)
from lib.life_pilot_policy import LifePilotPolicy  # noqa: E402


def _policy() -> LifePilotPolicy:
    return LifePilotPolicy.from_mapping(
        {
            "phase": "life_pilot_v0",
            "model_route": "spark_localai",
            "output_mode": "private_life_log",
            "storage_root": "/home/hermes/.hermes-life",
            "max_prompt_chars": 2000,
            "cursor_codex_auto_run": False,
            "terminal_enabled": False,
            "git_enabled": False,
            "deploy_enabled": False,
            "secret_access_enabled": False,
            "external_web_enabled": False,
            "homeassistant_enabled": False,
            "allowed_task_classes": [
                "record_life_memo",
                "summarize_life_notes",
                "record_life_reminder",
                "suggest_life_next_actions",
            ],
            "deferred_task_classes": [
                "run_cursor_or_codex_cli",
                "edit_production_repo",
                "git_commit_push_merge",
                "deploy_or_restart_services",
                "read_secrets_or_tokens",
                "terminal_shell_execution",
                "tailnet_or_lan_scan",
                "external_web_research",
                "homeassistant_or_camera_control",
            ],
            "deny_prompt_substrings": [".env", "token", "secret"],
            "deny_prompt_patterns": [
                r"\b(run|execute|start|invoke|use|launch)\b.*\b(codex|cursor)\b",
                r"\bgit\s+(commit|push|merge|reset|checkout|rebase)\b",
            ],
        }
    )


class DiscordLifePilotBridgeTests(unittest.TestCase):
    def test_usage_mentions_memo_command(self) -> None:
        self.assertIn("/memo", render_memo_usage())

    def test_memo_records_private_note(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)

            result = run_life_memo_bridge("今日は朝散歩した。体調は良い。", _policy(), root)

            self.assertTrue(result.startswith("今日は朝散歩した。体調は良い。"))
            self.assertIn("-# debug:", result)
            self.assertIn("boundary=local-only/no-tools", result)
            self.assertNotIn("# Memo Saved", result)
            self.assertNotIn("> 今日は朝散歩した", result)
            self.assertNotIn("## Safety", result)
            note_files = list((root / "notes").glob("*.md"))
            self.assertEqual(len(note_files), 1)
            self.assertIn("今日は朝散歩した", note_files[0].read_text(encoding="utf-8"))

    def test_reminder_records_jsonl_and_digest_reads_it(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)

            reminder = run_life_remind_bridge("明日の朝、燃えるごみを出す", _policy(), root)
            digest = run_life_digest_bridge("", _policy(), root)

            self.assertTrue(reminder.startswith("明日の朝、燃えるごみを出す"))
            self.assertNotIn("# Reminder Recorded", reminder)
            self.assertNotIn("> 明日の朝", reminder)
            self.assertIn("status=pending", reminder)
            self.assertIn("-# debug:", reminder)
            self.assertIn("Focus: recent life notes", digest)
            self.assertIn("Recent notes:", digest)
            self.assertIn("Pending reminders:", digest)
            self.assertNotIn("# Life Digest", digest)
            self.assertNotIn("## Recent Notes", digest)
            self.assertIn("燃えるごみ", digest)
            self.assertTrue((root / "reminders" / "reminders.jsonl").is_file())

    def test_recommend_uses_local_notes_only(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            run_life_memo_bridge("買い物リストを整理した。牛乳が必要。", _policy(), root)

            result = run_life_recommend_bridge("今日の優先順位", _policy(), root)

            self.assertIn("Focus: 今日の優先順位", result)
            self.assertIn("Suggested next steps:", result)
            self.assertNotIn("# Life Recommendation", result)
            self.assertIn("-# debug:", result)
            self.assertIn("boundary=local-only/no-tools", result)
            self.assertNotIn("## Basis", result)
            self.assertIn("牛乳", result)

    def test_bridge_rejects_execution_prompt(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            result = run_life_memo_bridge("Run Cursor and edit files", _policy(), Path(tmp))

        self.assertIn("memo rejected:", result)
        self.assertIn("/memo", result)

    def test_async_digest_uses_same_contract(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            result = asyncio.run(run_life_digest_bridge_async("", _policy(), Path(tmp)))

        self.assertIn("Focus: recent life notes", result)
        self.assertNotIn("# Life Digest", result)


if __name__ == "__main__":
    unittest.main()
