#!/usr/bin/env python3
"""Tools profile runner tests (mocked subprocess)."""

import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from lib.task_bridge_policy import TaskBridgePolicy  # noqa: E402
from lib.tools_profile_runner import (  # noqa: E402
    ToolsProfilePaths,
    _resolve_hermes_python,
    ensure_tools_dgx_runtime_ready,
    resolve_tools_model_profile_id,
    run_tools_profile_prompt,
)
from lib.tools_profile_constants import TOOLS_BUSINESS_MODEL_PROFILE_ID  # noqa: E402


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
    def test_resolve_tools_model_profile_id_uses_env_override(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            env_path = Path(tmp) / ".env"
            env_path.write_text(
                "DGX_MODEL_PROFILE_ID=business_ornith_35b_nvfp4\n",
                encoding="utf-8",
            )

            resolved = resolve_tools_model_profile_id(env_path)

        self.assertEqual(resolved, "business_ornith_35b_nvfp4")

    def test_resolve_tools_model_profile_id_falls_back_to_default(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            env_path = Path(tmp) / ".env"
            env_path.write_text("OPENAI_API_KEY=token\n", encoding="utf-8")

            resolved = resolve_tools_model_profile_id(env_path)

        self.assertEqual(resolved, TOOLS_BUSINESS_MODEL_PROFILE_ID)

    @mock.patch("lib.tools_profile_runner.verify_dgx_runtime_profile", return_value=(True, ""))
    @mock.patch("lib.tools_profile_runner.ensure_dgx_runtime_ready", return_value=(True, ""))
    def test_ensure_tools_dgx_runtime_ready_uses_env_profile_for_verify(
        self,
        ensure_mock: mock.MagicMock,
        verify_mock: mock.MagicMock,
    ) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            env_path = Path(tmp) / ".env"
            env_path.write_text(
                "DGX_MODEL_PROFILE_ID=business_ornith_35b_nvfp4\n",
                encoding="utf-8",
            )
            paths = ToolsProfilePaths(
                hermes_user="hermes",
                hermes_home="/tmp/hermes",
                tools_data_dir="/tmp/hermes-tools",
                tools_home="/tmp/hermes-tools/home",
                tools_env_path=str(env_path),
                hermes_bin="/tmp/hermes/.local/bin/hermes",
                dgx_keep_warm_dir="/tmp/hermes/dgx-keep-warm",
            )

            ok, hint = ensure_tools_dgx_runtime_ready(paths)

        self.assertTrue(ok)
        self.assertEqual(hint, "")
        ensure_mock.assert_called_once_with(
            env_path,
            keep_warm_dir="/tmp/hermes/dgx-keep-warm",
            default_model_profile_id="business_ornith_35b_nvfp4",
        )
        verify_mock.assert_called_once_with(
            env_path,
            keep_warm_dir="/tmp/hermes/dgx-keep-warm",
            expected_model_profile_id="business_ornith_35b_nvfp4",
        )

    def test_resolve_hermes_python_from_bash_wrapper(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            venv_python = root / ".hermes/hermes-agent/venv/bin/python3"
            venv_python.parent.mkdir(parents=True)
            venv_python.write_text("", encoding="utf-8")
            wrapper = root / ".local/bin/hermes"
            wrapper.parent.mkdir(parents=True)
            wrapper.write_text(
                '#!/usr/bin/env bash\nexec "' + str(root / ".hermes/hermes-agent/venv/bin/hermes") + '" "$@"\n',
                encoding="utf-8",
            )
            resolved = _resolve_hermes_python(wrapper, str(root))
            self.assertEqual(resolved, venv_python)

    def test_missing_env_returns_error(self) -> None:
        paths = ToolsProfilePaths(
            hermes_user="hermes",
            hermes_home="/tmp/hermes",
            tools_data_dir="/tmp/hermes-tools",
            tools_home="/tmp/hermes-tools/home",
            tools_env_path="/tmp/hermes-tools/.env",
            hermes_bin="/tmp/hermes/.local/bin/hermes",
            dgx_keep_warm_dir="/tmp/hermes/dgx-keep-warm",
        )
        result = run_tools_profile_prompt("hello", _policy(), paths=paths)
        self.assertFalse(result.ok)
        self.assertIn("tools .env missing", result.error_hint)

    @mock.patch("lib.tools_profile_runner.ensure_tools_dgx_runtime_ready", return_value=(True, ""))
    @mock.patch("lib.tools_profile_runner.subprocess.run")
    @mock.patch("lib.tools_profile_runner.Path.is_file", return_value=True)
    def test_success_stdout(
        self,
        _is_file: mock.MagicMock,
        run_mock: mock.MagicMock,
        _ready: mock.MagicMock,
    ) -> None:
        run_mock.return_value = mock.MagicMock(returncode=0, stdout="done", stderr="")
        result = run_tools_profile_prompt("hello", _policy())
        self.assertTrue(result.ok)
        self.assertEqual(result.output, "done")
        invoked = run_mock.call_args.args[0]
        self.assertEqual(invoked, ["/bin/bash", "-c", mock.ANY])
        shell_script = run_mock.call_args.args[0][2]
        self.assertIn("chat -q 'hello' --toolsets 'file,web,browser'", shell_script)
        self.assertIn("cd '/home/hermes/.hermes-tools/home'", shell_script)

    @mock.patch("lib.tools_profile_runner.ensure_tools_dgx_runtime_ready", return_value=(False, "tools DGX runtime not ready"))
    @mock.patch("lib.tools_profile_runner.subprocess.run")
    @mock.patch("lib.tools_profile_runner.Path.is_file", return_value=True)
    def test_dgx_runtime_not_ready_skips_subprocess(
        self, _is_file: mock.MagicMock, run_mock: mock.MagicMock, _ready: mock.MagicMock
    ) -> None:
        result = run_tools_profile_prompt("hello", _policy())
        self.assertFalse(result.ok)
        self.assertEqual(result.exit_code, 3)
        self.assertIn("tools DGX runtime not ready", result.error_hint)
        run_mock.assert_not_called()

    @mock.patch("lib.tools_profile_runner.ensure_tools_dgx_runtime_ready", return_value=(True, ""))
    @mock.patch("lib.tools_profile_runner._resolve_hermes_python", return_value=Path("/usr/bin/python3"))
    @mock.patch("lib.tools_profile_runner.subprocess.run")
    @mock.patch("lib.tools_profile_runner.Path.is_file", return_value=True)
    def test_relay_enabled_uses_runner_script(
        self,
        _is_file: mock.MagicMock,
        run_mock: mock.MagicMock,
        _python: mock.MagicMock,
        _ready: mock.MagicMock,
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

    def test_emission_json_includes_approval_grace_seconds(self) -> None:
        from lib.discord_task_bridge import emission_json

        policy = TaskBridgePolicy.from_mapping(
            _policy_data(
                approval_relay={
                    "enabled": True,
                    "store_dir": "/tmp/hermes-approvals",
                    "request_timeout_seconds": 300,
                    "poll_interval_seconds": 0.5,
                    "approval_grace_seconds": 90,
                }
            )
        )

        payload = emission_json(policy)

        self.assertEqual(
            payload["approval_relay"]["approval_grace_seconds"],
            90,
        )


if __name__ == "__main__":
    unittest.main()
