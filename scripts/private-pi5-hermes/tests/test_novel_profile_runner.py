#!/usr/bin/env python3
"""Novel profile runner tests."""

import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

_BRIDGE_ROOT = Path(__file__).resolve().parents[2] / "private-pi5-stackchan-bridge"
if str(_BRIDGE_ROOT) not in sys.path:
    sys.path.insert(0, str(_BRIDGE_ROOT))

from lib.novel_profile_runner import (
    NovelProfilePaths,
    _dgx_config_from_novel_env,
    _load_dgx_runtime_client,
    render_novel_usage,
    run_novel_profile_prompt,
)


class NovelProfileRunnerTests(unittest.TestCase):
    def test_render_novel_usage(self) -> None:
        self.assertIn("/novel", render_novel_usage())

    def test_load_dgx_runtime_client_uses_keep_warm_dir(self) -> None:
        from dgx_runtime_client import DgxUpstreamClient, DgxUpstreamConfig

        with tempfile.TemporaryDirectory() as tmp:
            keep_warm = Path(tmp) / "dgx-keep-warm"
            keep_warm.mkdir()
            client_src = _BRIDGE_ROOT / "dgx_runtime_client.py"
            (keep_warm / "dgx_runtime_client.py").write_text(
                client_src.read_text(encoding="utf-8"),
                encoding="utf-8",
            )
            client_cls, config_cls = _load_dgx_runtime_client(keep_warm)
        self.assertIs(client_cls, DgxUpstreamClient)
        self.assertIs(config_cls, DgxUpstreamConfig)

    @patch("lib.novel_profile_runner._load_dgx_runtime_client")
    def test_dgx_config_from_novel_env_reads_model_profile_id(
        self, mock_load: object
    ) -> None:
        from dgx_runtime_client import DgxUpstreamConfig

        mock_load.return_value = (object, DgxUpstreamConfig)
        with tempfile.TemporaryDirectory() as tmp:
            env_path = Path(tmp) / ".env"
            env_path.write_text(
                "\n".join(
                    [
                        "OPENAI_API_KEY=test-token",
                        "DGX_RUNTIME_CONTROL_TOKEN=ctrl",
                        "DGX_MODEL_PROFILE_ID=qwen36_35b_uncensored",
                        "DGX_RUNTIME_AUTO_START=true",
                    ]
                ),
                encoding="utf-8",
            )
            config = _dgx_config_from_novel_env(env_path)
            self.assertEqual(config.model_profile_id, "qwen36_35b_uncensored")
            self.assertTrue(config.auto_start)

    def test_run_novel_profile_missing_env(self) -> None:
        paths = NovelProfilePaths(
            hermes_user="hermes",
            hermes_home="/home/hermes",
            novel_data_dir="/home/hermes/.hermes-novel",
            novel_home="/home/hermes/.hermes-novel/home",
            novel_env_path="/home/hermes/.hermes-novel/.env",
            hermes_bin="/home/hermes/.local/bin/hermes",
            dgx_keep_warm_dir="/home/hermes/.hermes/dgx-keep-warm",
        )
        result = run_novel_profile_prompt("hello", paths=paths)
        self.assertFalse(result.ok)
        self.assertIn(".env missing", result.error_hint)

    @patch("lib.novel_profile_runner.ensure_novel_dgx_runtime_ready", return_value=(True, ""))
    @patch("lib.novel_profile_runner.subprocess.run")
    def test_run_novel_profile_success(self, mock_run: object, _mock_ready: object) -> None:
        import subprocess

        mock_run.return_value = subprocess.CompletedProcess(
            args=[],
            returncode=0,
            stdout="Chapter draft",
            stderr="",
        )
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            env_path = base / ".env"
            env_path.write_text("OPENAI_API_KEY=t\nDGX_RUNTIME_CONTROL_TOKEN=c\n", encoding="utf-8")
            bin_path = base / "hermes"
            bin_path.write_text("#!/bin/bash\n", encoding="utf-8")
            paths = NovelProfilePaths(
                hermes_user="hermes",
                hermes_home=str(base / "home"),
                novel_data_dir=str(base),
                novel_home=str(base / "novel-home"),
                novel_env_path=str(env_path),
                hermes_bin=str(bin_path),
                dgx_keep_warm_dir=str(base / "dgx"),
            )
            (base / "novel-home").mkdir(parents=True)
            result = run_novel_profile_prompt("Write a scene", paths=paths)
        self.assertTrue(result.ok)
        self.assertIn("Chapter draft", result.output)


if __name__ == "__main__":
    unittest.main()
