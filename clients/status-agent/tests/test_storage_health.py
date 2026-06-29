from __future__ import annotations

import datetime as dt
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Sequence

STATUS_AGENT_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(STATUS_AGENT_DIR))

import storage_health  # noqa: E402


OBSERVED_AT = dt.datetime(2026, 6, 29, 0, 0, tzinfo=dt.timezone.utc)


class StorageHealthTest(unittest.TestCase):
    def test_root_filesystem_read_only_is_error(self) -> None:
        mounts = "/dev/mmcblk0p2 / ext4 ro,relatime 0 0\n"

        logs = storage_health.evaluate_root_mount(mounts, OBSERVED_AT)

        self.assertEqual(len(logs), 1)
        self.assertEqual(logs[0]["level"], "ERROR")
        context = logs[0]["context"]
        self.assertEqual(context["category"], "storage_health")
        self.assertEqual(context["signal"], "root_filesystem_read_only")
        self.assertEqual(context["rootSource"], "/proc/mounts")

    def test_kernel_mmc_error_is_error(self) -> None:
        kernel_log = "Jun 29 00:00:01 pi kernel: mmc0: error -110 whilst initialising SD card\n"

        logs = storage_health.evaluate_kernel_log(kernel_log, "journalctl -k --since -2min", OBSERVED_AT)

        self.assertEqual(len(logs), 1)
        self.assertEqual(logs[0]["level"], "ERROR")
        context = logs[0]["context"]
        self.assertEqual(context["signal"], "kernel_storage_error")
        self.assertIn("mmc0", context["raw"])

    def test_kernel_log_since_follows_storage_health_interval(self) -> None:
        calls = []

        def runner(args: Sequence[str], timeout: float) -> storage_health.CommandResult:
            calls.append(tuple(args))
            if args[0] == "journalctl":
                return storage_health.CommandResult(tuple(args), 0, "mmc0: error -110 test\n", "")
            return storage_health.CommandResult(tuple(args), 0, "", "")

        with tempfile.TemporaryDirectory() as temp_dir:
            mounts_path = Path(temp_dir) / "mounts"
            mounts_path.write_text("/dev/mmcblk0p2 / ext4 rw,relatime 0 0\n", encoding="utf-8")

            storage_health.collect_storage_health_logs(
                {
                    "STORAGE_HEALTH_INTERVAL_SECONDS": "3600",
                    "STORAGE_HEALTH_DISK_WARN_PCT": "100",
                    "STORAGE_HEALTH_DISK_ERROR_PCT": "100",
                },
                runner=runner,
                mounts_path=mounts_path,
                disk_path=temp_dir,
                observed_at=OBSERVED_AT,
            )

        self.assertIn(("journalctl", "-k", "--since", "-3900s", "--no-pager"), calls)

    def test_disk_and_inode_thresholds(self) -> None:
        warn_logs = storage_health.evaluate_disk_usage(85.0, 80.0, 90.0, OBSERVED_AT)
        error_logs = storage_health.evaluate_disk_usage(92.0, 80.0, 90.0, OBSERVED_AT)
        inode_logs = storage_health.evaluate_inode_usage(90.0, 80.0, 90.0, OBSERVED_AT)

        self.assertEqual(warn_logs[0]["level"], "WARN")
        self.assertEqual(error_logs[0]["level"], "ERROR")
        self.assertEqual(inode_logs[0]["level"], "ERROR")
        self.assertEqual(inode_logs[0]["context"]["signal"], "root_inode_usage_high")

    def test_vcgencmd_current_under_voltage_and_throttle(self) -> None:
        under_voltage_logs = storage_health.evaluate_throttled("throttled=0x1", OBSERVED_AT)
        throttled_logs = storage_health.evaluate_throttled("throttled=0x6", OBSERVED_AT)

        self.assertEqual(under_voltage_logs[0]["level"], "ERROR")
        self.assertEqual(under_voltage_logs[0]["context"]["signal"], "power_undervoltage_current")
        self.assertEqual(throttled_logs[0]["level"], "WARN")
        self.assertEqual(throttled_logs[0]["context"]["signal"], "power_throttled_current")

    def test_command_failures_do_not_raise(self) -> None:
        def failing_runner(args: Sequence[str], timeout: float) -> storage_health.CommandResult:
            return storage_health.CommandResult(tuple(args), 127, "", "not available")

        with tempfile.TemporaryDirectory() as temp_dir:
            mounts_path = Path(temp_dir) / "mounts"
            mounts_path.write_text("/dev/mmcblk0p2 / ext4 rw,relatime 0 0\n", encoding="utf-8")

            logs = storage_health.collect_storage_health_logs(
                {
                    "STORAGE_HEALTH_DISK_WARN_PCT": "100",
                    "STORAGE_HEALTH_DISK_ERROR_PCT": "100",
                },
                runner=failing_runner,
                mounts_path=mounts_path,
                disk_path=temp_dir,
                observed_at=OBSERVED_AT,
            )

        self.assertEqual(logs, [])

    def test_collect_limits_storage_health_logs_to_ten(self) -> None:
        def noisy_runner(args: Sequence[str], timeout: float) -> storage_health.CommandResult:
            if args[0] == "journalctl":
                lines = [f"mmc0: error -110 test line {index}" for index in range(20)]
                return storage_health.CommandResult(tuple(args), 0, "\n".join(lines), "")
            return storage_health.CommandResult(tuple(args), 0, "throttled=0xf", "")

        with tempfile.TemporaryDirectory() as temp_dir:
            mounts_path = Path(temp_dir) / "mounts"
            mounts_path.write_text("/dev/mmcblk0p2 / ext4 ro,relatime 0 0\n", encoding="utf-8")

            logs = storage_health.collect_storage_health_logs(
                {
                    "STORAGE_HEALTH_DISK_WARN_PCT": "0",
                    "STORAGE_HEALTH_DISK_ERROR_PCT": "0",
                },
                runner=noisy_runner,
                mounts_path=mounts_path,
                disk_path=temp_dir,
                observed_at=OBSERVED_AT,
            )

        self.assertLessEqual(len(logs), storage_health.MAX_STORAGE_HEALTH_LOGS)


if __name__ == "__main__":
    unittest.main()
