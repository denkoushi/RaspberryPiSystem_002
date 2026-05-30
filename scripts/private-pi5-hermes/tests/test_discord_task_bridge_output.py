#!/usr/bin/env python3
"""Discord /task response composition tests."""

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from lib.approval_relay.models import TaskRunContext  # noqa: E402
from lib.discord_task_bridge import _compose_task_response  # noqa: E402


class DiscordTaskBridgeOutputTests(unittest.TestCase):
    def test_timeout_does_not_append_approval_prompt(self) -> None:
        ctx = TaskRunContext(
            task_id="t1",
            intermediate_messages=[
                "⚠️ **承認が必要です** (task approval required)\n- 理由: write",
                "progress line",
            ],
        )
        message = _compose_task_response(
            "BLOCKED: File write approval timed out.",
            task_context=ctx,
            ok=False,
            error_hint="operation may require manual approval",
        )
        self.assertEqual(message, "承認期限切れ。もう一度 `/task` を実行してください。")
        self.assertNotIn("yes", message)

    def test_delivery_failure_surfaces_immediately(self) -> None:
        ctx = TaskRunContext(
            task_id="t2",
            approval_delivery_error="DISCORD_BOT_TOKEN is not set",
        )
        message = _compose_task_response(
            "",
            task_context=ctx,
            ok=False,
            error_hint="tools profile run failed",
        )
        self.assertIn("承認通知を Discord に送れませんでした", message)


if __name__ == "__main__":
    unittest.main()
