#!/usr/bin/env python3
"""Approval relay runner tests (Phase D5.1)."""

import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from lib.approval_relay.models import ApprovalChoice  # noqa: E402
from lib.approval_relay.runner import (  # noqa: E402
    _poll_responses_until_stop,
    _poll_thread_should_consume_response,
)
from lib.approval_relay.store import FileApprovalStore  # noqa: E402


class PollThreadConsumeTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.store_dir = Path(self.tmp.name)
        self.store = FileApprovalStore(self.store_dir, "task-poll")

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_tool_write_request_not_consumed_by_poll_thread(self) -> None:
        self.store.write_request(
            {
                "command": "write_file path=/workspace/x.txt",
                "description": "write file: /workspace/x.txt",
                "pattern_key": "tool:write_file",
                "pattern_keys": ["tool:write_file"],
            }
        )
        self.assertFalse(_poll_thread_should_consume_response(self.store))

    def test_shell_request_consumed_by_poll_thread(self) -> None:
        self.store.write_request(
            {
                "command": "rm -rf /tmp/x",
                "description": "dangerous command",
                "pattern_key": "exec",
            }
        )
        self.assertTrue(_poll_thread_should_consume_response(self.store))

    def test_orphan_response_without_request_not_consumed(self) -> None:
        self.store.write_response(ApprovalChoice.ONCE, discord_user_id="user-1")
        self.assertFalse(_poll_thread_should_consume_response(self.store))


class PollThreadRaceTests(unittest.TestCase):
    def test_tool_write_response_survives_for_waiter(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            store_dir = Path(tmp)
            task_id = "task-race"
            store = FileApprovalStore(store_dir, task_id)
            store.write_request(
                {
                    "command": "write_file path=/workspace/x.txt",
                    "description": "write",
                    "pattern_key": "tool:write_file",
                    "pattern_keys": ["tool:write_file"],
                }
            )

            stop = threading.Event()
            fake_approval = mock.MagicMock()

            def _run_poll() -> None:
                with mock.patch.dict(
                    sys.modules,
                    {"tools.approval": fake_approval},
                ):
                    _poll_responses_until_stop(
                        store_dir=store_dir,
                        task_id=task_id,
                        session_key="task-bridge:task-race",
                        poll_interval_seconds=0.05,
                        stop_event=stop,
                    )

            thread = threading.Thread(target=_run_poll, daemon=True)
            thread.start()
            time.sleep(0.15)
            store.write_response(ApprovalChoice.ONCE, discord_user_id="user-1")
            time.sleep(0.2)
            stop.set()
            thread.join(timeout=2.0)

            response = store.read_response()
            self.assertIsNotNone(response)
            assert response is not None
            self.assertEqual(response.choice, ApprovalChoice.ONCE)
            fake_approval.resolve_gateway_approval.assert_not_called()


if __name__ == "__main__":
    unittest.main()
