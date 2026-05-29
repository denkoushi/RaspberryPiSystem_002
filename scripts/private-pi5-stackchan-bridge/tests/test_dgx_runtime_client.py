#!/usr/bin/env python3
"""Unit tests for dgx_runtime_client."""

from __future__ import annotations

import io
import unittest
from unittest.mock import patch

from dgx_runtime_client import DgxUpstreamClient, DgxUpstreamConfig


def _config(**overrides: object) -> DgxUpstreamConfig:
    base = dict(
        base_url="http://dgx.example:38081",
        llm_shared_token="llm-token",
        runtime_control_token="ctrl-token",
        auto_start=True,
    )
    base.update(overrides)
    return DgxUpstreamConfig(**base)


class TestDgxRuntimeClient(unittest.TestCase):
    def test_probe_runtime_ready_success(self):
        client = DgxUpstreamClient(_config())

        class FakeResp:
            def __enter__(self):
                return self

            def __exit__(self, *args: object) -> None:
                return None

            def getcode(self) -> int:
                return 200

            def read(self) -> bytes:
                return b'{"data":[]}'

        with patch("dgx_runtime_client.urlopen", return_value=FakeResp()):
            ok, details = client.probe_runtime_ready()

        self.assertTrue(ok)
        self.assertEqual(details["status"], 200)

    def test_warm_runtime_if_needed_skips_start_when_warm(self):
        client = DgxUpstreamClient(_config())

        with patch.object(client, "probe_runtime_ready", return_value=(True, {"status": 200})):
            with patch.object(client, "ensure_runtime_ready") as ensure:
                ok, details = client.warm_runtime_if_needed()

        ensure.assert_not_called()
        self.assertTrue(ok)
        self.assertEqual(details["phase"], "already_warm")

    def test_warm_runtime_if_needed_calls_start_when_cold(self):
        client = DgxUpstreamClient(_config())

        with patch.object(client, "probe_runtime_ready", return_value=(False, {"status": 503})):
            with patch.object(
                client,
                "ensure_runtime_ready",
                return_value=(True, {"start": {"status": 200}}),
            ) as ensure:
                ok, details = client.warm_runtime_if_needed()

        ensure.assert_called_once()
        self.assertTrue(ok)
        self.assertEqual(details["phase"], "started")

    def test_ensure_runtime_ready_disabled_without_auto_start(self):
        client = DgxUpstreamClient(_config(auto_start=False))
        ok, details = client.ensure_runtime_ready()
        self.assertFalse(ok)
        self.assertIn("disabled", details["message"])

    def test_warm_runtime_with_profile_always_ensures(self):
        client = DgxUpstreamClient(_config(model_profile_id="business_qwen36_27b_nvfp4"))

        with patch.object(
            client,
            "fetch_active_model_profile",
            return_value=(False, {"status": 503}),
        ):
            with patch.object(
                client,
                "ensure_runtime_ready",
                return_value=(True, {"start": {"status": 200}}),
            ) as ensure:
                ok, details = client.warm_runtime()

        ensure.assert_called_once()
        self.assertTrue(ok)
        self.assertEqual(details["phase"], "profile_ensure")

    def test_warm_runtime_with_profile_skips_start_when_already_active(self):
        client = DgxUpstreamClient(_config(model_profile_id="business_qwen36_27b_nvfp4"))

        with patch.object(
            client,
            "fetch_active_model_profile",
            return_value=(True, {"modelProfileId": "business_qwen36_27b_nvfp4"}),
        ):
            with patch.object(client, "ensure_runtime_ready") as ensure:
                ok, details = client.warm_runtime()

        ensure.assert_not_called()
        self.assertTrue(ok)
        self.assertEqual(details["phase"], "already_target_profile")

    def test_warm_runtime_without_profile_delegates_to_if_needed(self):
        client = DgxUpstreamClient(_config())

        with patch.object(
            client,
            "warm_runtime_if_needed",
            return_value=(True, {"phase": "already_warm"}),
        ) as warm_if_needed:
            ok, details = client.warm_runtime()

        warm_if_needed.assert_called_once()
        self.assertTrue(ok)
        self.assertEqual(details["phase"], "already_warm")

    def test_ensure_runtime_ready_sends_model_profile_id(self):
        client = DgxUpstreamClient(
            _config(model_profile_id="qwen36_35b_uncensored")
        )
        captured: dict[str, bytes] = {}

        class FakeResp:
            def __enter__(self):
                return self

            def __exit__(self, *args: object) -> None:
                return None

            def getcode(self) -> int:
                return 200

            def read(self) -> bytes:
                return b'{"data":[]}'

        def fake_urlopen(req: object, timeout: float = 0) -> FakeResp:
            del timeout
            request = req  # type: ignore[assignment]
            if getattr(request, "method", "") == "POST":
                captured["body"] = getattr(request, "data", b"")
            return FakeResp()

        with patch("dgx_runtime_client.urlopen", side_effect=fake_urlopen):
            ok, _details = client.ensure_runtime_ready()

        self.assertTrue(ok)
        self.assertIn(b"qwen36_35b_uncensored", captured.get("body", b""))


if __name__ == "__main__":
    unittest.main()
