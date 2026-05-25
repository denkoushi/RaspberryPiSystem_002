#!/usr/bin/env python3
"""Tool write approval gate tests (Phase D5.1)."""

import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from lib.approval_relay.models import ApprovalChoice  # noqa: E402
from lib.approval_relay.pending_approval import wait_for_discord_approval  # noqa: E402
from lib.approval_relay.store import FileApprovalStore  # noqa: E402
from lib.approval_relay.tool_write_gate import (  # noqa: E402
    build_pre_tool_call_handler,
    summarize_tool_call,
)


class SummarizeToolCallTests(unittest.TestCase):
    def test_write_file_summary(self) -> None:
        command, description = summarize_tool_call(
            "write_file",
            {"path": "/workspace/hello.txt", "content": "test2"},
        )
        self.assertIn("hello.txt", command)
        self.assertIn("test2", command)
        self.assertIn("write file", description)

    def test_patch_summary(self) -> None:
        command, description = summarize_tool_call(
            "patch",
            {"mode": "replace", "path": "/workspace/a.txt"},
        )
        self.assertIn("patch", command)
        self.assertIn("a.txt", description)


class ToolWriteGateHandlerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.store_dir = Path(self.tmp.name)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_blocks_when_denied(self) -> None:
        handler = build_pre_tool_call_handler(
            store_dir=self.store_dir,
            task_id="task-deny",
            request_timeout_seconds=1.0,
            poll_interval_seconds=0.05,
        )

        def _deny() -> None:
            time.sleep(0.05)
            store = FileApprovalStore(self.store_dir, "task-deny")
            store.write_response(ApprovalChoice.DENY)

        threading.Thread(target=_deny, daemon=True).start()
        result = handler("write_file", {"path": "x.txt", "content": "a"})
        self.assertIsNotNone(result)
        assert result is not None
        self.assertEqual(result.get("action"), "block")

    def test_allows_when_approved(self) -> None:
        handler = build_pre_tool_call_handler(
            store_dir=self.store_dir,
            task_id="task-ok",
            request_timeout_seconds=1.0,
            poll_interval_seconds=0.05,
        )

        def _approve() -> None:
            time.sleep(0.05)
            store = FileApprovalStore(self.store_dir, "task-ok")
            store.write_response(ApprovalChoice.ONCE)

        threading.Thread(target=_approve, daemon=True).start()
        result = handler("write_file", {"path": "x.txt", "content": "a"})
        self.assertIsNone(result)

    def test_ignores_read_only_tools(self) -> None:
        handler = build_pre_tool_call_handler(
            store_dir=self.store_dir,
            task_id="task-read",
            request_timeout_seconds=1.0,
            poll_interval_seconds=0.05,
        )
        self.assertIsNone(handler("read_file", {"path": "x.txt"}))


class PendingApprovalTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.store_dir = Path(self.tmp.name)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_wait_ignores_stale_response(self) -> None:
        store = FileApprovalStore(self.store_dir, "task-stale")
        store.write_response(ApprovalChoice.ONCE)

        def _deny() -> None:
            time.sleep(0.05)
            inner = FileApprovalStore(self.store_dir, "task-stale")
            inner.clear_pending_files()
            inner.write_request({"command": "x", "description": "y"})
            inner.write_response(ApprovalChoice.DENY)

        threading.Thread(target=_deny, daemon=True).start()
        choice = wait_for_discord_approval(
            store,
            {"command": "write_file x", "description": "write"},
            timeout_seconds=1.0,
            poll_interval_seconds=0.05,
        )
        self.assertEqual(choice, ApprovalChoice.DENY)

    def test_wait_clears_pending_files(self) -> None:
        store = FileApprovalStore(self.store_dir, "task-clear")

        def _approve() -> None:
            time.sleep(0.05)
            inner = FileApprovalStore(self.store_dir, "task-clear")
            inner.write_response(ApprovalChoice.ONCE)

        threading.Thread(target=_approve, daemon=True).start()
        choice = wait_for_discord_approval(
            store,
            {"command": "write_file x", "description": "write"},
            timeout_seconds=1.0,
            poll_interval_seconds=0.05,
        )
        self.assertEqual(choice, ApprovalChoice.ONCE)
        self.assertFalse((store.task_dir / FileApprovalStore.REQUEST_FILE).is_file())
        self.assertFalse((store.task_dir / FileApprovalStore.RESPONSE_FILE).is_file())


if __name__ == "__main__":
    unittest.main()
