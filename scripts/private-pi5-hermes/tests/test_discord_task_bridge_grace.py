#!/usr/bin/env python3
"""Grace-period gating for /task completion."""

import sys
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from lib.approval_relay.coordinator import DiscordApprovalRelayCoordinator  # noqa: E402
from lib.approval_relay.models import TaskRunContext  # noqa: E402
from lib.approval_relay.policy import ApprovalRelayPolicy  # noqa: E402
from lib.approval_relay.store import FileApprovalStore  # noqa: E402
from lib.discord_task_bridge import (  # noqa: E402
    APPROVAL_EXPIRED_USER_MESSAGE,
    _compose_task_response,
    run_task_bridge_async,
    should_enter_approval_grace,
)
from lib.task_bridge_policy import TaskBridgePolicy  # noqa: E402
from lib.task_request import TaskRequest  # noqa: E402
from lib.tools_profile_runner import ToolsProfileRunResult  # noqa: E402


class ShouldEnterApprovalGraceTests(unittest.TestCase):
    def test_successful_task_does_not_enter_grace(self) -> None:
        ctx = TaskRunContext(task_id="t1", approval_prompt_delivered=True)
        self.assertFalse(should_enter_approval_grace(ctx))

    def test_timeout_flag_enters_grace(self) -> None:
        ctx = TaskRunContext(task_id="t1", approval_timed_out=True)
        self.assertTrue(should_enter_approval_grace(ctx))

    def test_delivery_error_does_not_enter_grace(self) -> None:
        ctx = TaskRunContext(
            task_id="t1",
            approval_timed_out=True,
            approval_delivery_error="DISCORD_BOT_TOKEN is not set",
        )
        self.assertFalse(should_enter_approval_grace(ctx))

    def test_compose_timeout_sets_flag_even_when_user_message_is_japanese(self) -> None:
        ctx = TaskRunContext(task_id="t1")
        message = _compose_task_response(
            "BLOCKED: File write approval timed out.",
            task_context=ctx,
            ok=False,
            error_hint="operation may require manual approval",
        )
        self.assertEqual(message, APPROVAL_EXPIRED_USER_MESSAGE)
        self.assertTrue(ctx.approval_timed_out)
        self.assertTrue(should_enter_approval_grace(ctx))
        self.assertFalse(
            should_enter_approval_grace(
                TaskRunContext(task_id="t2", approval_timed_out=False)
            )
        )


class RunTaskBridgeAsyncGraceIntegrationTests(unittest.IsolatedAsyncioTestCase):
    async def test_async_path_enters_grace_after_compose_replaces_message(self) -> None:
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            store_dir = Path(tmp)
            relay = ApprovalRelayPolicy(
                enabled=True,
                store_dir=str(store_dir),
                request_timeout_seconds=30,
                poll_interval_seconds=0.05,
                approval_grace_seconds=60,
            )
            policy = TaskBridgePolicy(
                require_tools_phase="d4",
                allowed_toolsets=("file",),
                deny_prompt_substrings=(),
                max_prompt_chars=4000,
                max_output_chars=8000,
                runner_timeout_seconds=600,
                bridge_executable_basename="discord-task-bridge",
                approval_relay=relay,
            )
            coord = DiscordApprovalRelayCoordinator(relay)

            timeout_result = ToolsProfileRunResult(
                ok=False,
                exit_code=1,
                output="BLOCKED: File write approval timed out.",
                error_hint="operation may require manual approval",
                task_id="deadbeef",
            )

            with mock.patch(
                "lib.discord_task_bridge.load_task_bridge_policy",
                return_value=policy,
            ), mock.patch(
                "lib.discord_task_bridge.read_gateway_session_context",
                return_value=("user-1", "chan-1"),
            ), mock.patch(
                "lib.discord_task_bridge.run_tools_profile_prompt",
                return_value=timeout_result,
            ):
                message = await run_task_bridge_async(
                    TaskRequest.from_text("write test.txt"),
                    policy,
                )

            self.assertEqual(message, APPROVAL_EXPIRED_USER_MESSAGE)
            self.assertTrue(FileApprovalStore.in_approval_grace(store_dir, "user-1"))
            self.assertIsNone(FileApprovalStore.running_task_id(store_dir, "user-1"))
            retry = coord.new_task_context(discord_user_id="user-1")
            self.assertTrue(retry.task_id)


if __name__ == "__main__":
    unittest.main()
