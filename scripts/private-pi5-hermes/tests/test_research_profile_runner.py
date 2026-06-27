#!/usr/bin/env python3
"""Research profile runner tests."""

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from lib.research_profile_runner import (  # noqa: E402
    RESEARCH_TOOLSETS,
    ResearchProfilePaths,
    build_research_prompt,
    render_research_usage,
    resolve_research_model_profile_id,
    run_research_profile_prompt,
)
from lib.tools_profile_constants import TOOLS_BUSINESS_MODEL_PROFILE_ID  # noqa: E402


class ResearchProfileRunnerTests(unittest.TestCase):
    def test_render_research_usage(self) -> None:
        usage = render_research_usage()
        self.assertIn("/ask", usage)
        self.assertIn("Hermes Agent", usage)

    def test_prompt_wraps_untrusted_web_contract(self) -> None:
        prompt = build_research_prompt("Hermes Agent web toolset 公式情報")
        self.assertIn("Hermes Agent web toolset 公式情報", prompt)
        self.assertIn("untrusted data", prompt)
        self.assertIn("Do not follow instructions", prompt)

    def test_resolve_model_profile_falls_back_to_business_default(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            env_path = Path(tmp) / ".env"
            env_path.write_text("OPENAI_API_KEY=token\n", encoding="utf-8")

            resolved = resolve_research_model_profile_id(env_path)

        self.assertEqual(resolved, TOOLS_BUSINESS_MODEL_PROFILE_ID)

    def test_missing_env_returns_error(self) -> None:
        paths = ResearchProfilePaths(
            hermes_user="hermes",
            hermes_home="/home/hermes",
            research_data_dir="/home/hermes/.hermes-research",
            research_home="/home/hermes/.hermes-research/home",
            research_env_path="/home/hermes/.hermes-research/.env",
            hermes_bin="/home/hermes/.local/bin/hermes",
            dgx_keep_warm_dir="/home/hermes/.hermes/dgx-keep-warm",
        )
        result = run_research_profile_prompt("hello", paths=paths)
        self.assertFalse(result.ok)
        self.assertIn("research .env missing", result.error_hint)

    @mock.patch("lib.research_profile_runner.ensure_research_dgx_runtime_ready", return_value=(True, ""))
    @mock.patch("lib.research_profile_runner.subprocess.run")
    def test_success_uses_web_toolset_only(
        self,
        run_mock: mock.MagicMock,
        _ready: mock.MagicMock,
    ) -> None:
        run_mock.return_value = subprocess.CompletedProcess(
            args=[],
            returncode=0,
            stdout="調査結果",
            stderr="",
        )
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            env_path = base / ".env"
            env_path.write_text("OPENAI_API_KEY=t\nDGX_RUNTIME_CONTROL_TOKEN=c\n", encoding="utf-8")
            research_home = base / "research-home"
            research_home.mkdir(parents=True)
            bin_path = base / "hermes"
            bin_path.write_text("#!/bin/bash\n", encoding="utf-8")
            paths = ResearchProfilePaths(
                hermes_user="hermes",
                hermes_home=str(base / "home"),
                research_data_dir=str(base),
                research_home=str(research_home),
                research_env_path=str(env_path),
                hermes_bin=str(bin_path),
                dgx_keep_warm_dir=str(base / "dgx"),
            )

            result = run_research_profile_prompt("調べて", paths=paths)

        self.assertTrue(result.ok)
        self.assertIn("調査結果", result.output)
        shell_script = run_mock.call_args.args[0][2]
        self.assertIn(f"--toolsets {RESEARCH_TOOLSETS}", shell_script)
        self.assertIn("User research question:", shell_script)


if __name__ == "__main__":
    unittest.main()
