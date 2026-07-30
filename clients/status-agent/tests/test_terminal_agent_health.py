from __future__ import annotations

import datetime as dt
import sys
import tempfile
import unittest
from pathlib import Path


STATUS_AGENT_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(STATUS_AGENT_DIR))

import terminal_agent_health as health  # noqa: E402


NOW = dt.datetime(2026, 7, 29, 0, 0, tzinfo=dt.timezone.utc)


class TerminalAgentHealthTest(unittest.TestCase):
    def config(self, directory: str) -> dict[str, str]:
        return {
            "TERMINAL_AGENT_HEALTH_NFC_ENABLED": "1",
            "TERMINAL_AGENT_HEALTH_BARCODE_ENABLED": "0",
            "TERMINAL_AGENT_HEALTH_TORQUE_ENABLED": "0",
            "TERMINAL_AGENT_HEALTH_STATE_FILE": str(Path(directory) / "health.json"),
        }

    @staticmethod
    def nfc_payload(reader: bool = True, queue_size: int = 0):
        def probe(_endpoint: str, _timeout: float):
            return {
                "readerConnected": reader,
                "queueSize": queue_size,
                "lastEvent": {"uid": "must-never-leave-agent"},
                "token": "must-never-leave-agent",
            }

        return probe

    def test_second_failure_emits_once_and_successful_delivery_suppresses_duplicates(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            config = self.config(directory)
            first = health.collect_logs(config, probe=self.nfc_payload(False), now=NOW)
            second = health.collect_logs(config, probe=self.nfc_payload(False), now=NOW)
            self.assertEqual(first, [])
            self.assertEqual(len(second), 1)
            self.assertEqual(second[0]["level"], "ERROR")
            context = second[0]["context"]
            self.assertEqual(context["consecutiveFailures"], 2)

            health.mark_logs_delivered(config, second)
            third = health.collect_logs(config, probe=self.nfc_payload(False), now=NOW)
            self.assertEqual(third, [])

    def test_failed_post_retries_same_episode_without_leaking_raw_agent_data(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            config = self.config(directory)
            health.collect_logs(config, probe=self.nfc_payload(False), now=NOW)
            second = health.collect_logs(config, probe=self.nfc_payload(False), now=NOW)
            third = health.collect_logs(config, probe=self.nfc_payload(False), now=NOW)
            self.assertEqual(
                second[0]["context"]["episodeId"],
                third[0]["context"]["episodeId"],
            )
            serialized = str(third)
            self.assertNotIn("uid", serialized.lower())
            self.assertNotIn("token", serialized.lower())
            self.assertNotIn("7071", serialized)

    def test_queue_is_warn_and_recovery_allows_new_episode(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            config = self.config(directory)
            health.collect_logs(config, probe=self.nfc_payload(True, 3), now=NOW)
            unhealthy = health.collect_logs(config, probe=self.nfc_payload(True, 3), now=NOW)
            self.assertEqual(len(unhealthy), 1)
            self.assertEqual(unhealthy[0]["level"], "WARN")
            self.assertEqual(unhealthy[0]["context"]["queueSize"], 3)
            old_episode = unhealthy[0]["context"]["episodeId"]
            health.mark_logs_delivered(config, unhealthy)

            recovered = health.collect_logs(config, probe=self.nfc_payload(True, 0), now=NOW)
            self.assertEqual(recovered[0]["level"], "INFO")
            health.mark_logs_delivered(config, recovered)

            health.collect_logs(config, probe=self.nfc_payload(True, 1), now=NOW)
            recurrence = health.collect_logs(config, probe=self.nfc_payload(True, 1), now=NOW)
            self.assertNotEqual(recurrence[0]["context"]["episodeId"], old_episode)

    def test_disabled_collector_does_not_touch_state(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "health.json"
            logs = health.collect_logs(
                {
                    "TERMINAL_AGENT_HEALTH_NFC_ENABLED": "0",
                    "TERMINAL_AGENT_HEALTH_STATE_FILE": str(path),
                }
            )
            self.assertEqual(logs, [])
            self.assertFalse(path.exists())

    def test_barcode_and_torque_require_usable_runtime_state(self) -> None:
        barcode = health.evaluate_agent(
            "barcode", {"readerConnected": False, "restPort": 7072}
        )
        torque = health.evaluate_agent("torque", {"ok": False})

        self.assertTrue(barcode[0].healthy)
        self.assertFalse(barcode[1].healthy)
        self.assertTrue(torque[0].healthy)
        self.assertFalse(torque[1].healthy)

    def test_endpoint_failure_is_error_without_raw_endpoint_in_log(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            config = self.config(directory)

            def unavailable(_endpoint: str, _timeout: float):
                raise TimeoutError("http://127.0.0.1:7071 leaked")

            self.assertEqual(health.collect_logs(config, probe=unavailable, now=NOW), [])
            logs = health.collect_logs(config, probe=unavailable, now=NOW)

            self.assertEqual(logs[0]["level"], "ERROR")
            self.assertEqual(logs[0]["context"]["signal"], "endpoint")
            self.assertNotIn("7071", str(logs))


if __name__ == "__main__":
    unittest.main()
