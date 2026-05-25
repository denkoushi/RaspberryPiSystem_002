#!/usr/bin/env python3
"""Tools profile runner tests (mocked subprocess)."""

import sys
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from lib.task_bridge_policy import TaskBridgePolicy  # noqa: E402
from lib.tools_profile_runner import ToolsProfilePaths, run_tools_profile_prompt  # noqa: E402


def _policy_data(**overrides: object) -> dict:
    data = {
        "require_tools_phase": "d4",
        "max_prompt_chars": 500,
        "max_output_chars": 1000,
        "runner_timeout_seconds": 30,
        "allowed_toolsets": ["file", "web", "browser"],
        "deny_prompt_substrings": [],
        "bridge_executable_basename": "hermes-discord-task-bridge",
        "approval_relay": {
            "enabled": False,
            "store_dir": "/tmp/hermes-approvals",
            "request_timeout_seconds": 300,
            "poll_interval_seconds": 0.5,
        },
    }
    data.update(overrides)
    return data


def _policy() -> TaskBridgePolicy:
    return TaskBridgePolicy.from_mapping(_policy_data())


class ToolsProfileRunnerTests(unittest.TestCase):
    def test_missing_env_returns_error(self) -> None:
        paths = ToolsProfilePaths(
            hermes_user="hermes",
            hermes_home="/tmp/hermes",
            tools_data_dir="/tmp/hermes-tools",
            tools_home="/tmp/hermes-tools/home",
            tools_env_path="/tmp/hermes-tools/.env",
            hermes_bin="/tmp/hermes/.local/bin/hermes",
        )
        result = run_tools_profile_prompt("hello", _policy(), paths=paths)
        self.assertFalse(result.ok)
        self.assertIn("tools .env missing", result.error_hint)

    @mock.patch("lib.tools_profile_runner.subprocess.run")
    @mock.patch("lib.tools_profile_runner.Path.is_file", return_value=True)
    def test_success_stdout(self, _is_file: mock.MagicMock, run_mock: mock.MagicMock) -> None:
        run_mock.return_value = mock.MagicMock(returncode=0, stdout="done", stderr="")
        result = run_tools_profile_prompt("hello", _policy())
        self.assertTrue(result.ok)
        self.assertEqual(result.output, "done")
        invoked = run_mock.call_args.args[0]
        self.assertEqual(invoked, ["/bin/bash", "-c", mock.ANY])
        shell_script = run_mock.call_args.args[0][2]
        self.assertIn("chat -q 'hello' --toolsets 'file,web,browser'", shell_script)
        self.assertIn("cd '/home/hermes/.hermes-tools/home'", shell_script)

    @mock.patch("lib.tools_profile_runner._resolve_hermes_python", return_value=Path("/usr/bin/python3"))
    @mock.patch("lib.tools_profile_runner.subprocess.run")
    @mock.patch("lib.tools_profile_runner.Path.is_file", return_value=True)
    def test_relay_enabled_uses_runner_script(
        self, _is_file: mock.MagicMock, run_mock: mock.MagicMock, _python: mock.MagicMock
    ) -> None:
        run_mock.return_value = mock.MagicMock(returncode=0, stdout="done", stderr="")
        relay_policy = _policy_data(
            approval_relay={
                "enabled": True,
                "store_dir": "/tmp/hermes-approvals",
                "request_timeout_seconds": 300,
                "poll_interval_seconds": 0.5,
            }
        )
        policy = TaskBridgePolicy.from_mapping(relay_policy)
        result = run_tools_profile_prompt("hello", policy, task_id="task-123")
        self.assertTrue(result.ok)
        argv = run_mock.call_args.args[0]
        self.assertTrue(str(argv[1]).endswith("approval_relay/runner.py"))
        self.assertIn("--task-id", argv)
        self.assertIn("task-123", argv)
        self.assertIn("--request-timeout", argv)
        self.assertIn("300", argv)


if __name__ == "__main__":
    unittest.main()
