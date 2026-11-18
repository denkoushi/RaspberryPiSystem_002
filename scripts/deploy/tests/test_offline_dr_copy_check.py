from __future__ import annotations

import os
import subprocess
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

CHECK_SCRIPT = Path(__file__).resolve().parents[3] / "scripts/google_drive_dr/offline-dr-copy-check.sh"
NOW = datetime(2026, 11, 18, 9, tzinfo=timezone(timedelta(hours=9)))


class OfflineDrCopyCheckTests(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        root = Path(directory.name)
        self.log_dir = root / "logs"
        self.log_dir.mkdir()
        self.calls = root / "alert-arguments"
        alert_script = root / "generate-alert.sh"
        alert_script.write_text('printf "%s\\n" "$@" > "$ALERT_CALLS"\n', encoding="utf-8")
        self.env = {
            "PATH": os.defpath,
            "TZ": "Asia/Tokyo",
            "OFFLINE_DR_LOG_DIR": str(self.log_dir),
            "OFFLINE_DR_NOW_EPOCH": str(int(NOW.timestamp())),
            "OFFLINE_DR_ALERT_SCRIPT": str(alert_script),
            "ALERT_CALLS": str(self.calls),
        }

    def write_log(self, days_ago: int, contents: str, seconds_ago: int = 0) -> str:
        stamp = NOW - timedelta(days=days_ago, seconds=seconds_ago)
        path = self.log_dir / f"copy-{stamp:%Y%m%d-%H%M%S}.log"
        path.write_text(contents, encoding="utf-8")
        return stamp.date().isoformat()

    def run_check(self) -> None:
        result = subprocess.run(["/bin/bash", str(CHECK_SCRIPT)], env=self.env,
                                capture_output=True, text=True, check=False)
        self.assertEqual(result.returncode, 0, result.stderr)

    def assert_alert(self, details: str) -> None:
        alert_type, message, actual_details = self.calls.read_text(encoding="utf-8").splitlines()
        self.assertEqual(alert_type, "offline-dr-copy-overdue")
        self.assertTrue(message)
        self.assertEqual(actual_details, details)

    def test_29_day_old_success_does_not_alert(self) -> None:
        self.write_log(29, "started\nRESULT=OK\n")
        self.run_check()
        self.assertFalse(self.calls.exists())

    def test_31_day_old_success_alerts(self) -> None:
        day = self.write_log(31, "RESULT=OK\n")
        self.run_check()
        self.assert_alert(f"lastOk={day};days=31")

    def test_failed_copy_without_success_alerts_with_no_last_ok(self) -> None:
        self.write_log(1, "RESULT=FAILED: verification failed\n")
        self.run_check()
        self.assert_alert("lastOk=none;days=-1")

    def test_newer_failed_copy_does_not_hide_old_success(self) -> None:
        self.write_log(40, "RESULT=OK\n")
        day = self.write_log(31, "RESULT=OK\n")
        self.write_log(1, "RESULT=OK\nRESULT=FAILED: verification failed\n")
        self.run_check()
        self.assert_alert(f"lastOk={day};days=31")

    def test_exact_threshold_does_not_alert(self) -> None:
        self.write_log(30, "RESULT=OK\n")
        self.run_check()
        self.assertFalse(self.calls.exists())

    def test_one_second_beyond_overridden_threshold_alerts(self) -> None:
        self.env["OFFLINE_DR_MAX_DAYS"] = "2"
        day = self.write_log(2, "RESULT=OK\n", seconds_ago=1)
        self.run_check()
        self.assert_alert(f"lastOk={day};days=2")


if __name__ == "__main__":
    unittest.main()
