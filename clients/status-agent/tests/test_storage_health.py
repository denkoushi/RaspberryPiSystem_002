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

    def test_boot_time_write_protect_notice_is_not_a_storage_error(self) -> None:
        # Seen on the Pi3 at its daily 03:00 reboot on 2026-10-02.
        kernel_log = (
            "10月 02 03:00:17 raspberrypi kernel: mmc0: host does not support reading "
            "read-only switch, assuming write-enable\n"
            "10月 02 09:27:58 raspberrypi kernel: mmc1: Controller never released inhibit bit(s).\n"
        )
        self.assertEqual(storage_health.evaluate_kernel_log(kernel_log, "journalctl -k", OBSERVED_AT), [])

        remount = "Oct 02 03:10:00 pi kernel: EXT4-fs (mmcblk0p2): Remounting filesystem read-only\n"
        logs = storage_health.evaluate_kernel_log(kernel_log + remount, "journalctl -k", OBSERVED_AT)
        self.assertEqual(len(logs), 1)
        self.assertIn("Remounting filesystem read-only", logs[0]["context"]["raw"])
        self.assertNotIn("read-only switch", logs[0]["context"]["raw"])

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


GB = 1_000_000_000
HOUR = 3600.0


class StorageWearTest(unittest.TestCase):
    """Sticky under-voltage and SD write-rate signals, driven through a fake /proc and /sys."""

    def setUp(self) -> None:
        self._temp = tempfile.TemporaryDirectory()
        self.root = Path(self._temp.name)
        self.mounts_path = self.root / "mounts"
        self.mounts_path.write_text("/dev/mmcblk0p2 / ext4 rw,relatime 0 0\n", encoding="utf-8")
        self.sys_root = self.root / "sys"
        disk = self.sys_root / "block" / "mmcblk0"
        (disk / "device").mkdir(parents=True)
        (disk / "size").write_text(str(32 * GB // 512), encoding="utf-8")
        (disk / "device" / "name").write_text("SD32G\n", encoding="utf-8")
        (disk / "device" / "date").write_text("07/2022\n", encoding="utf-8")
        ext4 = self.sys_root / "fs" / "ext4" / "mmcblk0p2"
        ext4.mkdir(parents=True)
        (ext4 / "lifetime_write_kbytes").write_text(str(320 * GB // 1024), encoding="utf-8")
        self.uptime_path = self.root / "uptime"
        self.boot_id_path = self.root / "boot_id"
        self.boot_id_path.write_text("boot-a\n", encoding="utf-8")
        self.config = {
            "STORAGE_HEALTH_DISK_WARN_PCT": "100",
            "STORAGE_HEALTH_DISK_ERROR_PCT": "100",
            "STORAGE_HEALTH_WEAR_STATE_FILE": str(self.root / "run" / "wear.json"),
        }
        self.throttled = "throttled=0x0"

    def tearDown(self) -> None:
        self._temp.cleanup()

    def runner(self, args: Sequence[str], timeout: float) -> storage_health.CommandResult:
        if args[0] == "vcgencmd":
            return storage_health.CommandResult(tuple(args), 0, self.throttled, "")
        return storage_health.CommandResult(tuple(args), 1, "", "")

    def collect(self, uptime: float, written_bytes: float) -> list:
        self.uptime_path.write_text(f"{uptime} 0\n", encoding="utf-8")
        sectors = int(written_bytes // 512)
        (self.sys_root / "block" / "mmcblk0" / "stat").write_text(
            f"100 0 200 0 50 0 {sectors} 0 0 0 0\n", encoding="utf-8"
        )
        return storage_health.collect_storage_health_logs(
            self.config,
            runner=self.runner,
            mounts_path=self.mounts_path,
            disk_path=str(self.root),
            observed_at=OBSERVED_AT,
            sys_root=self.sys_root,
            uptime_path=self.uptime_path,
            boot_id_path=self.boot_id_path,
        )

    def deliver(self, logs: list) -> None:
        storage_health.mark_wear_logs_delivered(
            self.config, logs, uptime_path=self.uptime_path, boot_id_path=self.boot_id_path
        )

    @staticmethod
    def signals(logs: list) -> list:
        return [log["context"]["signal"] for log in logs]

    def test_undervoltage_since_boot_is_reported_once_per_boot_after_delivery(self) -> None:
        self.throttled = "throttled=0x50000"

        first = self.collect(HOUR, 0)
        self.assertIn("power_undervoltage_since_boot", self.signals(first))
        self.assertNotIn("power_undervoltage_current", self.signals(first))
        warn = next(log for log in first if log["context"]["signal"] == "power_undervoltage_since_boot")
        self.assertEqual(warn["level"], "WARN")

        # Not delivered yet (POST failed or dry-run): it must be sent again.
        self.assertIn("power_undervoltage_since_boot", self.signals(self.collect(2 * HOUR, 0)))

        self.deliver(first)
        self.assertNotIn("power_undervoltage_since_boot", self.signals(self.collect(3 * HOUR, 0)))

        # A new boot clears the firmware flag and our memory of it.
        self.boot_id_path.write_text("boot-b\n", encoding="utf-8")
        self.assertIn("power_undervoltage_since_boot", self.signals(self.collect(HOUR, 0)))

    def test_write_rate_needs_twelve_hours_of_samples(self) -> None:
        self.assertEqual(self.collect(HOUR, 0), [])
        # A burst in the first hours (boot, deploy) is not judged on its own.
        self.assertEqual(self.collect(2 * HOUR, 50 * GB), [])

    def test_high_write_rate_warns_and_daily_report_follows_delivery(self) -> None:
        self.collect(HOUR, 0)
        logs = self.collect(13 * HOUR, 12 * GB)  # 12 GB over 12h = 24 GB/day

        self.assertEqual(self.signals(logs), ["storage_write_rate_high", "storage_wear_report"])
        warn, report = logs
        self.assertEqual(warn["level"], "WARN")
        self.assertIn("24.0 GB/day", warn["message"])
        self.assertEqual(report["level"], "INFO")
        context = report["context"]
        self.assertEqual(context["writeGbPerDay"], 24.0)
        self.assertEqual(context["lifetimeWriteGb"], 320.0)
        self.assertEqual(context["cardWriteMultiple"], 10.0)
        self.assertEqual(context["cardName"], "SD32G")

        self.deliver(logs)
        later = self.collect(14 * HOUR, 12.5 * GB)
        self.assertEqual(self.signals(later), ["storage_write_rate_high"])

        # One day after the delivered report the next one is due.
        next_day = self.collect(38 * HOUR, 20 * GB)
        self.assertIn("storage_wear_report", self.signals(next_day))

    def test_normal_write_rate_only_reports(self) -> None:
        self.collect(HOUR, 0)
        logs = self.collect(25 * HOUR, 1 * GB)

        self.assertEqual(self.signals(logs), ["storage_wear_report"])
        self.assertEqual(logs[0]["context"]["writeGbPerDay"], 1.0)

    def test_write_warn_threshold_is_configurable(self) -> None:
        self.config["STORAGE_HEALTH_WRITE_WARN_GB_PER_DAY"] = "0.5"
        self.collect(HOUR, 0)
        logs = self.collect(25 * HOUR, 1 * GB)

        self.assertIn("storage_write_rate_high", self.signals(logs))

    def test_window_keeps_only_the_last_day(self) -> None:
        samples: list = []
        for hour in range(0, 40):
            samples = storage_health.update_write_samples(samples, hour * HOUR, hour * 1000)
        self.assertEqual(samples[0][0], 15 * HOUR)
        self.assertEqual(samples[-1][0], 39 * HOUR)

    def test_counter_going_backwards_restarts_the_window(self) -> None:
        samples = storage_health.update_write_samples([[HOUR, 5000]], 2 * HOUR, 10)
        self.assertEqual(samples, [[2 * HOUR, 10]])

    def test_missing_block_device_skips_wear_signals(self) -> None:
        self.mounts_path.write_text("/dev/root / ext4 rw 0 0\n", encoding="utf-8")
        self.assertEqual(self.collect(HOUR, 0), [])
        self.assertEqual(self.collect(30 * HOUR, 100 * GB), [])

    def test_split_block_device(self) -> None:
        self.assertEqual(storage_health.split_block_device("/dev/mmcblk0p2"), ("mmcblk0", "mmcblk0p2"))
        self.assertEqual(storage_health.split_block_device("/dev/nvme0n1p2"), ("nvme0n1", "nvme0n1p2"))
        self.assertEqual(storage_health.split_block_device("/dev/sda2"), ("sda", "sda2"))
        self.assertIsNone(storage_health.split_block_device("/dev/root"))


if __name__ == "__main__":
    unittest.main()
