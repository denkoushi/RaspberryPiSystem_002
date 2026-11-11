from __future__ import annotations

import datetime as dt
from email.message import Message
import io
import importlib.util
import sys
import ssl
import urllib.error
import urllib.request
import urllib.response
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

STATUS_AGENT_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(STATUS_AGENT_DIR))


def load_status_agent(filename="status-agent.py"):
    spec = importlib.util.spec_from_file_location("status_agent_under_test", STATUS_AGENT_DIR / filename)
    if spec is None or spec.loader is None:
        raise RuntimeError("failed to load status-agent.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class StatusAgentTest(unittest.TestCase):
    def test_posts_reject_redirects_without_another_request(self) -> None:
        for filename in ("status-agent.py", "status-agent-macos.py"):
            for code in (301, 302, 303, 307, 308):
                with self.subTest(filename=filename, code=code):
                    agent = load_status_agent(filename)
                    requests = []

                    def respond(request):
                        requests.append(request)
                        headers = Message()
                        headers["Location"] = "http://redirect.test/target"
                        response = urllib.response.addinfourl(
                            io.BytesIO(b"redirect"), headers, request.full_url, code
                        )
                        response.msg = "Redirect"
                        return response

                    config = {"API_BASE_URL": "http://server.test/api", "CLIENT_KEY": "fixture"}
                    with patch.object(urllib.request.HTTPHandler, "http_open", side_effect=respond):
                        with self.assertRaises(urllib.error.HTTPError) as raised:
                            agent.post_payload(config, {})
                    self.assertEqual(raised.exception.code, code)
                    raised.exception.close()
                    self.assertEqual(len(requests), 1)
                    self.assertEqual(requests[0].full_url, "http://server.test/api/clients/status")
                    self.assertEqual(requests[0].get_method(), "POST")

    def test_post_opener_uses_existing_tls_context(self) -> None:
        for filename in ("status-agent.py", "status-agent-macos.py"):
            for skip_verify in ("0", "1"):
                with self.subTest(filename=filename, skip_verify=skip_verify):
                    agent = load_status_agent(filename)
                    context = ssl.create_default_context()
                    config = {"API_BASE_URL": "https://server.test/api", "CLIENT_KEY": "fixture",
                              "TLS_SKIP_VERIFY": skip_verify}
                    factory = "_create_unverified_context" if skip_verify == "1" else "create_default_context"
                    with patch.object(agent.ssl, factory, return_value=context), patch.object(
                        agent.urllib.request, "build_opener"
                    ) as build:
                        build.return_value.open.return_value.__enter__.return_value.getcode.return_value = 200
                        agent.post_payload(config, {})
                    https_handler, redirect_handler = build.call_args.args
                    self.assertIs(https_handler._context, context)
                    self.assertIsInstance(redirect_handler, agent.NoRedirectHandler)
                    self.assertEqual(build.return_value.open.call_args.kwargs, {"timeout": 10.0})

    def test_parse_config_defaults_disable_success_log_and_storage_health(self) -> None:
        status_agent = load_status_agent()
        with tempfile.TemporaryDirectory() as temp_dir:
            config_path = Path(temp_dir) / "status-agent.conf"
            config_path.write_text(
                "\n".join(
                    [
                        'API_BASE_URL="https://example.test/api"',
                        'CLIENT_ID="pi4-test"',
                        'CLIENT_KEY="client-key"',
                    ]
                ),
                encoding="utf-8",
            )

            config = status_agent.parse_config_file(config_path)

        self.assertEqual(config["NETWORK_HEALTH_ENABLED"], "1")
        self.assertEqual(config["STATUS_AGENT_LOG_SUCCESS"], "0")
        self.assertEqual(config["STORAGE_HEALTH_ENABLED"], "0")
        self.assertEqual(config["STORAGE_HEALTH_DISK_WARN_PCT"], "80")
        self.assertEqual(config["STORAGE_HEALTH_DISK_ERROR_PCT"], "90")
        self.assertEqual(config["STORAGE_HEALTH_INTERVAL_SECONDS"], "3600")
        self.assertEqual(config["STORAGE_HEALTH_STATE_FILE"], "/run/raspi-status-agent/storage-health-last-run")
        self.assertEqual(
            config["STORAGE_HEALTH_WEAR_STATE_FILE"], "/run/raspi-status-agent/storage-wear-state.json"
        )
        self.assertEqual(config["STORAGE_HEALTH_WRITE_WARN_GB_PER_DAY"], "10")
        self.assertEqual(config["OS_SECURITY_UPDATE_STATE_FILE"], "/var/lib/raspi-os-security-update/state.json")
        self.assertEqual(config["OS_SECURITY_UPDATE_STALE_DAYS"], "15")
        self.assertEqual(config["OS_SECURITY_UPDATE_HEALTH_STATE_FILE"], "/run/raspi-status-agent/os-update-health.json")
        self.assertEqual(config["TERMINAL_AGENT_HEALTH_NFC_ENABLED"], "0")
        self.assertEqual(config["TERMINAL_AGENT_HEALTH_BARCODE_ENABLED"], "0")
        self.assertEqual(config["TERMINAL_AGENT_HEALTH_TORQUE_ENABLED"], "0")
        self.assertEqual(config["TERMINAL_AGENT_MAINTENANCE_LEASES_JSON"], "{}")
        self.assertEqual(
            config["TERMINAL_AGENT_HEALTH_STATE_FILE"],
            "/run/raspi-status-agent/terminal-agent-health.json",
        )

    def test_storage_health_runs_when_state_file_is_missing(self) -> None:
        status_agent = load_status_agent()
        with tempfile.TemporaryDirectory() as temp_dir:
            config = {
                "STORAGE_HEALTH_INTERVAL_SECONDS": "3600",
                "STORAGE_HEALTH_STATE_FILE": str(Path(temp_dir) / "last-run"),
            }

            self.assertTrue(
                status_agent.should_collect_storage_health(
                    config,
                    now=dt.datetime(2026, 6, 29, 0, 0, tzinfo=dt.timezone.utc),
                )
            )

    def test_storage_health_skips_until_interval_has_elapsed(self) -> None:
        status_agent = load_status_agent()
        now = dt.datetime(2026, 6, 29, 1, 0, tzinfo=dt.timezone.utc)
        with tempfile.TemporaryDirectory() as temp_dir:
            state_path = Path(temp_dir) / "last-run"
            state_path.write_text(str((now - dt.timedelta(minutes=10)).timestamp()), encoding="utf-8")
            config = {
                "STORAGE_HEALTH_INTERVAL_SECONDS": "3600",
                "STORAGE_HEALTH_STATE_FILE": str(state_path),
            }

            self.assertFalse(status_agent.should_collect_storage_health(config, now=now))

    def test_storage_health_runs_after_interval_has_elapsed(self) -> None:
        status_agent = load_status_agent()
        now = dt.datetime(2026, 6, 29, 1, 0, tzinfo=dt.timezone.utc)
        with tempfile.TemporaryDirectory() as temp_dir:
            state_path = Path(temp_dir) / "last-run"
            state_path.write_text(str((now - dt.timedelta(hours=1, seconds=1)).timestamp()), encoding="utf-8")
            config = {
                "STORAGE_HEALTH_INTERVAL_SECONDS": "3600",
                "STORAGE_HEALTH_STATE_FILE": str(state_path),
            }

            self.assertTrue(status_agent.should_collect_storage_health(config, now=now))

    def test_mark_storage_health_checked_writes_tmpfs_state_file(self) -> None:
        status_agent = load_status_agent()
        checked_at = dt.datetime(2026, 6, 29, 1, 0, tzinfo=dt.timezone.utc)
        with tempfile.TemporaryDirectory() as temp_dir:
            state_path = Path(temp_dir) / "nested" / "last-run"
            config = {
                "STORAGE_HEALTH_INTERVAL_SECONDS": "3600",
                "STORAGE_HEALTH_STATE_FILE": str(state_path),
            }

            status_agent.mark_storage_health_checked(config, checked_at=checked_at)

            self.assertEqual(float(state_path.read_text(encoding="utf-8")), checked_at.timestamp())

    def test_success_does_not_write_local_log_when_disabled(self) -> None:
        status_agent = load_status_agent()
        with tempfile.TemporaryDirectory() as temp_dir:
            log_path = Path(temp_dir) / "agent.log"
            config = {
                "API_BASE_URL": "https://example.test/api",
                "CLIENT_ID": "pi4-test",
                "CLIENT_KEY": "client-key",
                "LOG_FILE": str(log_path),
                "STATUS_AGENT_LOG_SUCCESS": "0",
            }

            with patch.object(status_agent, "load_config", return_value=config), patch.object(
                status_agent, "build_payload", return_value={"clientId": "pi4-test", "logs": []}
            ), patch.object(status_agent, "post_payload", return_value=None), patch.object(
                sys, "argv", ["status-agent.py"]
            ):
                exit_code = status_agent.main()

            self.assertEqual(exit_code, 0)
            self.assertFalse(log_path.exists())

    def test_error_still_writes_local_log_when_success_log_disabled(self) -> None:
        status_agent = load_status_agent()
        with tempfile.TemporaryDirectory() as temp_dir:
            log_path = Path(temp_dir) / "agent.log"
            config = {
                "API_BASE_URL": "https://example.test/api",
                "CLIENT_ID": "pi4-test",
                "CLIENT_KEY": "client-key",
                "LOG_FILE": str(log_path),
                "STATUS_AGENT_LOG_SUCCESS": "0",
            }

            with patch.object(status_agent, "load_config", return_value=config), patch.object(
                status_agent, "build_payload", return_value={"clientId": "pi4-test", "logs": []}
            ), patch.object(status_agent, "post_payload", side_effect=RuntimeError("boom")), patch.object(
                sys, "argv", ["status-agent.py"]
            ):
                exit_code = status_agent.main()

            self.assertEqual(exit_code, 2)
            self.assertTrue(log_path.exists())
            content = log_path.read_text(encoding="utf-8")
            self.assertIn("[ERROR] failed to send status: boom", content)

    def test_wear_logs_are_marked_delivered_only_after_post_succeeds(self) -> None:
        status_agent = load_status_agent()
        config = {"API_BASE_URL": "https://example.test/api", "CLIENT_ID": "pi4-test", "CLIENT_KEY": "k"}
        logs = [{"level": "INFO", "message": "m", "context": {"category": "storage_health"}}]

        for post_effect, expected_calls in ((None, 1), (RuntimeError("boom"), 0)):
            with patch.object(status_agent, "load_config", return_value=config), patch.object(
                status_agent, "build_payload", return_value={"clientId": "pi4-test", "logs": logs}
            ), patch.object(status_agent, "post_payload", side_effect=post_effect), patch.object(
                status_agent.storage_health, "mark_wear_logs_delivered"
            ) as mark_delivered, patch.object(sys, "argv", ["status-agent.py"]):
                status_agent.main()

            self.assertEqual(mark_delivered.call_count, expected_calls)
            if expected_calls:
                mark_delivered.assert_called_once_with(config, logs)

    def test_os_update_logs_are_marked_delivered_only_after_post_succeeds(self) -> None:
        status_agent = load_status_agent()
        config = {"CLIENT_ID": "pi4-test"}
        logs = [{"level": "WARN", "message": "m", "context": {"category": "os_update_health"}}]
        for argv, effect, expected in ((["status-agent.py"], None, 1),
                                       (["status-agent.py"], RuntimeError("boom"), 0),
                                       (["status-agent.py", "--dry-run"], None, 0)):
            with patch.object(status_agent, "load_config", return_value=config), patch.object(
                status_agent, "build_payload", return_value={"clientId": "pi4-test", "logs": logs}
            ), patch.object(status_agent, "post_payload", side_effect=effect), patch.object(
                status_agent.os_update_health, "mark_logs_delivered"
            ) as mark_delivered, patch.object(sys, "argv", argv), patch("sys.stdout", new_callable=io.StringIO):
                status_agent.main()
            self.assertEqual(mark_delivered.call_count, expected)
            if expected:
                mark_delivered.assert_called_once_with(config, logs)

    def test_dry_run_forces_storage_health_collection(self) -> None:
        status_agent = load_status_agent()
        config = {
            "API_BASE_URL": "https://example.test/api",
            "CLIENT_ID": "pi4-test",
            "CLIENT_KEY": "client-key",
            "STATUS_AGENT_LOG_SUCCESS": "0",
        }

        with patch.object(status_agent, "load_config", return_value=config), patch.object(
            status_agent, "build_payload", return_value={"clientId": "pi4-test", "logs": []}
        ) as build_payload, patch.object(sys, "argv", ["status-agent.py", "--dry-run"]), patch(
            "sys.stdout",
            new_callable=io.StringIO,
        ):
            exit_code = status_agent.main()

        self.assertEqual(exit_code, 0)
        build_payload.assert_called_once_with(config, force_storage_health=True)


if __name__ == "__main__":
    unittest.main()
