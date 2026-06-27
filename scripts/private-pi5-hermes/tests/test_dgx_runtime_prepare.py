#!/usr/bin/env python3
"""Tests for shared DGX runtime preparation."""

import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
_BRIDGE_ROOT = Path(__file__).resolve().parents[2] / "private-pi5-stackchan-bridge"
sys.path.insert(0, str(ROOT))

from lib.dgx_runtime_prepare import (  # noqa: E402
    dgx_config_from_env_file,
    ensure_dgx_runtime_ready,
    verify_dgx_runtime_profile,
)
from lib.tools_profile_constants import TOOLS_BUSINESS_MODEL_PROFILE_ID  # noqa: E402


class DgxRuntimePrepareTests(unittest.TestCase):
    def test_dgx_config_from_env_file_uses_default_profile_id(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            keep_warm = Path(tmp) / "dgx-keep-warm"
            keep_warm.mkdir()
            client_src = _BRIDGE_ROOT / "dgx_runtime_client.py"
            (keep_warm / "dgx_runtime_client.py").write_text(
                client_src.read_text(encoding="utf-8"),
                encoding="utf-8",
            )
            env_path = Path(tmp) / ".env"
            env_path.write_text(
                "\n".join(
                    [
                        "OPENAI_API_KEY=token",
                        "DGX_RUNTIME_CONTROL_TOKEN=ctrl",
                        "DGX_RUNTIME_AUTO_START=true",
                    ]
                ),
                encoding="utf-8",
            )
            config = dgx_config_from_env_file(
                env_path,
                keep_warm_dir=keep_warm,
                default_model_profile_id=TOOLS_BUSINESS_MODEL_PROFILE_ID,
            )
            self.assertEqual(config.model_profile_id, TOOLS_BUSINESS_MODEL_PROFILE_ID)

    def test_dgx_config_from_env_file_prefers_env_profile_id(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            keep_warm = Path(tmp) / "dgx-keep-warm"
            keep_warm.mkdir()
            client_src = _BRIDGE_ROOT / "dgx_runtime_client.py"
            (keep_warm / "dgx_runtime_client.py").write_text(
                client_src.read_text(encoding="utf-8"),
                encoding="utf-8",
            )
            env_path = Path(tmp) / ".env"
            env_path.write_text(
                "\n".join(
                    [
                        "OPENAI_API_KEY=token",
                        "DGX_RUNTIME_CONTROL_TOKEN=ctrl",
                        "DGX_RUNTIME_AUTO_START=true",
                        "DGX_MODEL_PROFILE_ID=business_ornith_35b_nvfp4",
                    ]
                ),
                encoding="utf-8",
            )
            config = dgx_config_from_env_file(
                env_path,
                keep_warm_dir=keep_warm,
                default_model_profile_id=TOOLS_BUSINESS_MODEL_PROFILE_ID,
            )
            self.assertEqual(config.model_profile_id, "business_ornith_35b_nvfp4")

    def test_ensure_dgx_runtime_ready_missing_env(self) -> None:
        ok, hint = ensure_dgx_runtime_ready(
            Path("/tmp/nonexistent-hermes-tools.env"),
            default_model_profile_id=TOOLS_BUSINESS_MODEL_PROFILE_ID,
        )
        self.assertFalse(ok)
        self.assertIn(".env missing", hint)

    @patch("lib.dgx_runtime_prepare.load_dgx_runtime_client")
    def test_ensure_dgx_runtime_ready_uses_warm_runtime(self, mock_load) -> None:
        from dgx_runtime_client import DgxUpstreamConfig

        client_cls = mock_load.return_value[0]
        mock_load.return_value = (client_cls, DgxUpstreamConfig)
        client = client_cls.return_value
        client.warm_runtime.return_value = (True, {"phase": "already_target_profile"})
        with tempfile.TemporaryDirectory() as tmp:
            env_path = Path(tmp) / ".env"
            env_path.write_text(
                "\n".join(
                    [
                        "OPENAI_API_KEY=token",
                        "DGX_RUNTIME_CONTROL_TOKEN=ctrl",
                        "DGX_RUNTIME_AUTO_START=true",
                    ]
                ),
                encoding="utf-8",
            )
            ok, hint = ensure_dgx_runtime_ready(
                env_path,
                default_model_profile_id=TOOLS_BUSINESS_MODEL_PROFILE_ID,
            )

        self.assertTrue(ok)
        self.assertEqual(hint, "")
        client.warm_runtime.assert_called_once_with()

    @patch("lib.dgx_runtime_prepare.load_dgx_runtime_client")
    def test_verify_dgx_runtime_profile_checks_active_id(self, mock_load) -> None:
        from dgx_runtime_client import DgxUpstreamConfig

        client_cls = mock_load.return_value[0]
        mock_load.return_value = (client_cls, DgxUpstreamConfig)
        client = client_cls.return_value
        client.probe_runtime_ready.return_value = (True, {"status": 200})
        client.fetch_active_model_profile.return_value = (
            True,
            {"modelProfileId": TOOLS_BUSINESS_MODEL_PROFILE_ID},
        )
        with tempfile.TemporaryDirectory() as tmp:
            env_path = Path(tmp) / ".env"
            env_path.write_text("OPENAI_API_KEY=token\n", encoding="utf-8")
            ok, hint = verify_dgx_runtime_profile(
                env_path,
                expected_model_profile_id=TOOLS_BUSINESS_MODEL_PROFILE_ID,
            )
        self.assertTrue(ok)
        self.assertEqual(hint, "")

    @patch("lib.dgx_runtime_prepare.load_dgx_runtime_client")
    def test_verify_dgx_runtime_profile_rejects_mismatch(self, mock_load) -> None:
        from dgx_runtime_client import DgxUpstreamConfig

        client_cls = mock_load.return_value[0]
        mock_load.return_value = (client_cls, DgxUpstreamConfig)
        client = client_cls.return_value
        client.probe_runtime_ready.return_value = (True, {"status": 200})
        client.fetch_active_model_profile.return_value = (
            True,
            {"modelProfileId": "qwen36_35b_uncensored"},
        )
        with tempfile.TemporaryDirectory() as tmp:
            env_path = Path(tmp) / ".env"
            env_path.write_text("OPENAI_API_KEY=token\n", encoding="utf-8")
            ok, hint = verify_dgx_runtime_profile(
                env_path,
                expected_model_profile_id=TOOLS_BUSINESS_MODEL_PROFILE_ID,
            )
        self.assertFalse(ok)
        self.assertIn("mismatch", hint)


if __name__ == "__main__":
    unittest.main()
