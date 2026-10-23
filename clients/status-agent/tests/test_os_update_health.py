from __future__ import annotations

import datetime as dt
import json
import sys
import tempfile
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import os_update_health as health  # noqa: E402

NOW = dt.datetime(2026, 10, 25, tzinfo=dt.timezone.utc)


class OsUpdateHealthTest(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.path = Path(directory.name) / "update.json"
        self.marker = Path(directory.name) / "health.json"
        self.config = {
            "OS_SECURITY_UPDATE_STATE_FILE": str(self.path),
            "OS_SECURITY_UPDATE_HEALTH_STATE_FILE": str(self.marker),
        }

    def write_update(self, **overrides) -> None:
        self.path.write_text(json.dumps({
            "schemaVersion": 1, "mode": "apply", "result": "pending",
            "enabledAt": NOW.isoformat(), "lastSuccessAt": None,
            "reason": None, **overrides,
        }), encoding="utf-8")

    def collect(self, now=NOW):
        return health.collect_logs(self.config, now=now)

    def test_missing_file_reports_nothing_and_creates_no_marker(self):
        self.assertEqual(self.collect(), [])
        self.assertFalse(self.marker.exists())

    def test_pending_seed_fresh_and_exactly_fifteen_days_are_not_stale(self):
        self.write_update()
        self.assertEqual(self.collect(), [])
        self.assertEqual(self.collect(NOW + dt.timedelta(days=15)), [])

    def test_old_pending_seed_is_stale(self):
        self.write_update(enabledAt=(NOW - dt.timedelta(days=15, seconds=1)).isoformat())
        logs = self.collect()
        self.assertEqual(len(logs), 1)
        self.assertEqual(logs[0]["level"], "WARN")
        self.assertEqual(logs[0]["context"]["signal"], health.STALE_SIGNAL)

    def test_failed_signal_is_sanitized(self):
        self.write_update(result="failed", reason="apt_update_failed", installed=[{"name": "do-not-send"}], selected=["do-not-send"], heldBack=["do-not-send"])
        logs = self.collect()
        self.assertEqual(logs[0]["level"], "WARN")
        context = logs[0]["context"]
        self.assertEqual(context, {
            "category": "os_update_health", "action": "unhealthy", "signal": health.FAILED_SIGNAL,
            "episodeId": context["episodeId"], "observedAt": NOW.isoformat(), "mode": "apply",
            "reason": "apt_update_failed", "lastSuccessAt": None,
        })
        self.assertEqual(uuid.UUID(context["episodeId"]).version, 4)
        self.assertNotIn("do-not-send", json.dumps(logs))

    def test_invalid_reason_is_dropped(self):
        for reason in ("free text", "apt_failed\n", "x" * 81, {"raw": "text"}, ["text"]):
            with self.subTest(reason=reason):
                self.write_update(result="failed", reason=reason)
                self.marker.unlink(missing_ok=True)
                self.assertNotIn("reason", self.collect()[0]["context"])

    def test_success_after_failed_recovers_same_episode_and_recurrence_gets_new_id(self):
        self.write_update(result="failed")
        failed = self.collect()
        episode = failed[0]["context"]["episodeId"]
        health.mark_logs_delivered(self.config, failed)
        self.write_update(result="success", lastSuccessAt=NOW.isoformat())
        recovery = self.collect()
        self.assertEqual(recovery[0]["level"], "INFO")
        self.assertEqual(recovery[0]["context"]["action"], "recovery")
        self.assertEqual(recovery[0]["context"]["episodeId"], episode)
        self.assertEqual(self.collect(), recovery)  # Recovery retries until POST succeeds.
        health.mark_logs_delivered(self.config, recovery)
        self.assertEqual(self.collect(), [])
        self.write_update(result="failed")
        self.assertNotEqual(self.collect()[0]["context"]["episodeId"], episode)

    def test_skips_do_not_reset_stale_clock_and_success_recovers(self):
        old = (NOW - dt.timedelta(days=16)).isoformat()
        for result in ("skipped_locked", "skipped_window", "skipped_release"):
            with self.subTest(result=result):
                self.marker.unlink(missing_ok=True)
                self.write_update(result=result, lastRunAt=NOW.isoformat(), lastSuccessAt=old)
                stale = self.collect()
                self.assertEqual(stale[0]["context"]["signal"], health.STALE_SIGNAL)
                health.mark_logs_delivered(self.config, stale)
                self.write_update(result="success", lastSuccessAt=NOW.isoformat())
                self.assertEqual(self.collect()[0]["context"]["action"], "recovery")

    def test_both_signals_are_independent(self):
        old = (NOW - dt.timedelta(days=16)).isoformat()
        self.write_update(result="failed", lastSuccessAt=old, reason="apt_install_failed")
        logs = self.collect()
        self.assertEqual({entry["context"]["signal"] for entry in logs}, {health.FAILED_SIGNAL, health.STALE_SIGNAL})
        self.assertNotIn("reason", logs[1]["context"])
        health.mark_logs_delivered(self.config, logs)
        self.write_update(result="skipped_locked", lastSuccessAt=old)
        recovery = self.collect()
        self.assertEqual(len(recovery), 1)
        self.assertEqual(recovery[0]["context"]["signal"], health.FAILED_SIGNAL)

    def test_undelivered_active_retries_only_after_twenty_four_hours(self):
        self.write_update(result="failed")
        first = self.collect()
        self.assertEqual(self.collect(), [])
        self.assertEqual(self.collect(NOW + dt.timedelta(hours=24, seconds=-1)), [])
        retried = self.collect(NOW + dt.timedelta(hours=24))
        self.assertEqual(retried[0]["context"]["episodeId"], first[0]["context"]["episodeId"])
        health.mark_logs_delivered(self.config, retried)
        self.assertEqual(self.collect(NOW + dt.timedelta(days=2)), [])

    def test_unreported_failure_does_not_emit_recovery(self):
        self.write_update(result="failed")
        self.collect()
        self.write_update(result="success", lastSuccessAt=NOW.isoformat())
        self.assertEqual(self.collect(), [])

    def test_invalid_dates_do_not_raise_stale_and_valid_enabled_at_is_fallback(self):
        self.write_update(enabledAt=None, lastSuccessAt="invalid")
        self.assertEqual(self.collect(), [])
        self.write_update(enabledAt="invalid", lastSuccessAt=None)
        self.assertEqual(self.collect(), [])
        self.write_update(enabledAt=(NOW - dt.timedelta(days=16)).isoformat(), lastSuccessAt="invalid")
        self.assertEqual(self.collect()[0]["context"]["signal"], health.STALE_SIGNAL)

    def test_stale_days_can_be_configured_and_dates_use_offsets(self):
        self.config["OS_SECURITY_UPDATE_STALE_DAYS"] = "2"
        self.write_update(enabledAt="2026-10-23T09:00:00+09:00")
        self.assertEqual(self.collect(), [])
        self.assertEqual(self.collect(NOW + dt.timedelta(seconds=1))[0]["context"]["signal"], health.STALE_SIGNAL)

    def test_malformed_or_unreadable_state_never_recovers_an_active_signal(self):
        self.write_update(result="failed")
        health.mark_logs_delivered(self.config, self.collect())
        marker = self.marker.read_text()
        for raw in ('{', '[]', 'null', '{}', '{"schemaVersion": 1, "mode": "apply", "result": []}', '\ufffd'):
            self.path.write_text(raw, encoding="utf-8")
            self.assertEqual(self.collect(), [])
            self.assertEqual(self.marker.read_text(), marker)
        with patch.object(Path, "read_text", side_effect=PermissionError):
            self.assertEqual(self.collect(), [])

    def test_delivery_of_old_episode_cannot_acknowledge_new_episode(self):
        self.write_update(result="failed")
        old = self.collect()
        self.write_update(result="success", lastSuccessAt=NOW.isoformat())
        self.collect()
        self.write_update(result="failed")
        new = self.collect()
        health.mark_logs_delivered(self.config, old)
        self.assertNotEqual(old[0]["context"]["episodeId"], new[0]["context"]["episodeId"])
        self.assertEqual(len(self.collect(NOW + dt.timedelta(days=1))), 1)


if __name__ == "__main__":
    unittest.main()
