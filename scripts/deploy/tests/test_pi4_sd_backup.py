from __future__ import annotations

import datetime as dt
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts"))

from pi4_sd_backup import plan, runner  # noqa: E402

# Captured read-only from raspi4-kensaku-02 on 2026-09-30.
SFDISK_DUMP = """label: dos
label-id: 0x8d29df8b
device: /dev/mmcblk0
unit: sectors
sector-size: 512

/dev/mmcblk0p1 : start=       16384, size=     1048576, type=c
/dev/mmcblk0p2 : start=     1064960, size=    60011520, type=83
"""
FSTAB = """proc            /proc           proc    defaults          0       0
PARTUUID=8d29df8b-01  /boot/firmware  vfat    defaults          0       2
PARTUUID=8d29df8b-02  /               ext4    defaults,noatime  0       1
"""
CMDLINE = "console=tty1 root=PARTUUID=8d29df8b-02 rootfstype=ext4 fsck.repair=yes rootwait quiet\n"

TARGET = plan.Target(host="raspi4-kensaku-02", address="192.168.10.50", user="tools05")


def snapshot(snapshot_id: str, host: str, part: str, run_id: str, size: int = 0) -> dict[str, object]:
    return {
        "id": snapshot_id,
        "hostname": host,
        "tags": [plan.BACKUP_TAG, f"part:{part}", f"run:{run_id}"],
        "summary": {"total_bytes_processed": size},
    }


def full_run(host: str, run_id: str, prefix: str) -> list[dict[str, object]]:
    return [snapshot(f"{prefix}-{part}", host, part, run_id, 1_000) for part in plan.PARTS]


class TargetsTest(unittest.TestCase):
    def test_loads_valid_targets(self) -> None:
        raw = json.dumps([{"host": "raspi4-a", "address": "192.168.10.5", "user": "tools03"}])
        self.assertEqual(plan.load_targets(raw), [plan.Target("raspi4-a", "192.168.10.5", "tools03")])

    def test_rejects_shell_metacharacters_and_duplicates(self) -> None:
        for record in (
            {"host": "raspi4;rm", "address": "1.2.3.4", "user": "u"},
            {"host": "raspi4-a", "address": "1.2.3.4 -oProxyCommand=x", "user": "u"},
            {"host": "raspi4-a", "address": "1.2.3.4", "user": "u$(id)"},
        ):
            with self.assertRaises(plan.PlanError):
                plan.load_targets(json.dumps([record]))
        duplicate = {"host": "raspi4-a", "address": "1.2.3.4", "user": "u"}
        with self.assertRaises(plan.PlanError):
            plan.load_targets(json.dumps([duplicate, duplicate]))


class BackupCommandTest(unittest.TestCase):
    def test_root_backup_streams_over_ssh_as_the_pi5_deploy_user(self) -> None:
        args = plan.backup_args(TARGET, "root", "20260930T120000Z", ssh_user="denkon5sd02")

        self.assertEqual(args[:2], ["backup", "--quiet"])
        self.assertIn("--stdin-from-command", args)
        self.assertEqual(args[args.index("--host") + 1], "raspi4-kensaku-02")
        self.assertIn("run:20260930T120000Z", args)
        command = args[args.index("--") + 1:]
        self.assertEqual(command[:4], ["runuser", "-u", "denkon5sd02", "--"])
        self.assertIn("tools05@192.168.10.50", command)
        remote = command[-1]
        self.assertTrue(remote.startswith("sudo -n sh -c "))
        self.assertIn("--one-file-system", remote)
        self.assertIn("./var/log/journal", remote)

    def test_changed_files_do_not_fail_but_errors_do(self) -> None:
        for exit_code, expected in ((0, 0), (1, 0), (2, 2)):
            script = f"(exit {exit_code}); {plan.TOLERATE_CHANGED_FILES}"
            self.assertEqual(subprocess.run(["sh", "-c", script], check=False).returncode, expected)
        self.assertIn(plan.TOLERATE_CHANGED_FILES, plan.remote_script("root"))
        self.assertIn(plan.TOLERATE_CHANGED_FILES, plan.remote_script("boot"))

    def test_table_part_dumps_the_root_disk(self) -> None:
        self.assertIn("sfdisk --dump", plan.remote_script("table"))
        with self.assertRaises(plan.PlanError):
            plan.remote_script("home")


class RetentionTest(unittest.TestCase):
    def test_latest_complete_run_ignores_partial_runs(self) -> None:
        snapshots = full_run("raspi4-a", "20260920T030000Z", "old") + [
            snapshot("new-table", "raspi4-a", "table", "20260927T030000Z"),
            snapshot("new-boot", "raspi4-a", "boot", "20260927T030000Z"),
        ]
        run = plan.latest_complete_run(snapshots, "raspi4-a")
        self.assertEqual(run.run_id, "20260920T030000Z")
        self.assertEqual(run.snapshot_ids["root"], "old-root")
        with self.assertRaises(plan.PlanError):
            plan.latest_complete_run(snapshots, "raspi4-b")

    def test_keeps_four_weeks_and_six_months_per_host(self) -> None:
        start = dt.datetime(2026, 1, 4, 3, 0)
        snapshots = []
        run_ids = []
        for week in range(40):
            run_id = (start + dt.timedelta(weeks=week)).strftime("%Y%m%dT%H%M%SZ")
            run_ids.append(run_id)
            snapshots += full_run("raspi4-a", run_id, run_id)
        forgotten = set(plan.snapshots_to_forget(snapshots))
        kept_runs = {run for run in run_ids if f"{run}-root" not in forgotten}

        self.assertTrue(set(run_ids[-4:]) <= kept_runs)
        self.assertLessEqual(len(kept_runs), 4 + 6)
        self.assertGreaterEqual(len(kept_runs), 6)
        for run in kept_runs:
            self.assertNotIn(f"{run}-table", forgotten)
            self.assertNotIn(f"{run}-boot", forgotten)

    def test_partial_run_newer_than_complete_is_kept_older_is_dropped(self) -> None:
        snapshots = (
            [snapshot("stale-table", "raspi4-a", "table", "20260901T030000Z")]
            + full_run("raspi4-a", "20260920T030000Z", "good")
            + [snapshot("fresh-table", "raspi4-a", "table", "20260927T030000Z")]
        )
        self.assertEqual(plan.snapshots_to_forget(snapshots), ["stale-table"])


class RestoreTest(unittest.TestCase):
    def test_table_keeps_label_id_and_fills_the_card(self) -> None:
        table = plan.fill_card_table(SFDISK_DUMP)

        self.assertIn("label-id: 0x8d29df8b", table)
        self.assertNotIn("device:", table)
        self.assertIn("start=       16384, size=     1048576", table)
        root_line = [line for line in table.splitlines() if "start=     1064960" in line][0]
        self.assertNotIn("size=", root_line)

    def test_table_must_have_two_partitions_and_label_id(self) -> None:
        with self.assertRaises(plan.PlanError):
            plan.fill_card_table(SFDISK_DUMP.replace("label-id: 0x8d29df8b\n", ""))
        with self.assertRaises(plan.PlanError):
            plan.fill_card_table(SFDISK_DUMP.replace("/dev/mmcblk0p2", "#"))

    def test_partuuids_referenced_at_boot(self) -> None:
        self.assertEqual(plan.referenced_partuuids(FSTAB, CMDLINE), {"8d29df8b-01", "8d29df8b-02"})

    def test_partition_names(self) -> None:
        self.assertEqual(plan.partition_path("/dev/sdb", 2), "/dev/sdb2")
        self.assertEqual(plan.partition_path("/dev/mmcblk1", 1), "/dev/mmcblk1p1")

    def test_device_safety(self) -> None:
        good = plan.DeviceFacts("/dev/sdb", 32_000_000_000, True, "usb", [], False)
        plan.check_restore_device(good, required_bytes=10_000_000_000)
        refusals = [
            plan.DeviceFacts("/dev/sdb1", 32_000_000_000, True, "usb", [], False),
            plan.DeviceFacts("/dev/sda", 1_000_000_000_000, False, "usb", [], True),
            plan.DeviceFacts("/dev/sdb", 32_000_000_000, False, "sata", [], False),
            plan.DeviceFacts("/dev/sdb", 32_000_000_000, True, "usb", ["/media/x"], False),
            plan.DeviceFacts("/dev/sdb", 8_000_000_000, True, "usb", [], False),
        ]
        for facts in refusals:
            with self.assertRaises(plan.PlanError):
                plan.check_restore_device(facts, required_bytes=10_000_000_000)


class FakeRestic(runner.Restic):
    def __init__(self, snapshots: list[dict[str, object]], fail_hosts: set[str] = frozenset()) -> None:
        settings = runner.Settings("rclone:google-drive:x", "/pw", "/rc", "/targets", "denkon5sd02")
        super().__init__(settings)
        self.calls: list[list[str]] = []
        self.stored = snapshots
        self.fail_hosts = fail_hosts

    def __call__(self, args, *, check=True, capture=True):  # type: ignore[override]
        self.calls.append(list(args))
        code = 0
        if args[0] == "backup":
            host = args[args.index("--host") + 1]
            code = 1 if host in self.fail_hosts else 0
        if args[0] == "snapshots":
            return subprocess.CompletedProcess(args, 0, json.dumps(self.stored).encode(), b"")
        return subprocess.CompletedProcess(args, code, b"", b"")


class BackupRunTest(unittest.TestCase):
    def run_backup(self, restic: FakeRestic, hosts: list[str]) -> int:
        with tempfile.TemporaryDirectory() as directory:
            targets = Path(directory) / "targets.json"
            targets.write_text(
                json.dumps(
                    [
                        {"host": "raspi4-a", "address": "10.0.0.1", "user": "tools01"},
                        {"host": "raspi4-b", "address": "10.0.0.2", "user": "tools02"},
                    ]
                ),
                encoding="utf-8",
            )
            settings = runner.Settings("rclone:google-drive:x", "/pw", "/rc", str(targets), "denkon5sd02")
            return runner.cmd_backup(settings, restic, hosts, dt.datetime(2026, 10, 4, 3, 0, tzinfo=dt.timezone.utc))

    def test_backs_up_three_parts_per_host_and_reports_failures(self) -> None:
        restic = FakeRestic([], fail_hosts={"raspi4-b"})
        exit_code = self.run_backup(restic, [])

        self.assertEqual(exit_code, 1)
        backups = [call for call in restic.calls if call[0] == "backup"]
        a_parts = [call[call.index("--stdin-filename") + 1] for call in backups if "raspi4-a" in call]
        self.assertEqual(a_parts, ["partition-table.sfdisk", "boot.tar", "root.tar"])
        # The failing host stops after its first part.
        self.assertEqual(len([call for call in backups if "raspi4-b" in call]), 1)
        self.assertTrue(all("run:20261004T030000Z" in call for call in backups))

    def test_forgets_and_prunes_only_when_something_expired(self) -> None:
        restic = FakeRestic(full_run("raspi4-a", "20260101T030000Z", "ancient")
                            + [snapshot("orphan", "raspi4-a", "table", "20251201T030000Z")]
                            + full_run("raspi4-a", "20260927T030000Z", "recent"))
        self.assertEqual(self.run_backup(restic, ["raspi4-a"]), 0)
        forget = [call for call in restic.calls if call[0] == "forget"]
        self.assertEqual(forget, [["forget", "--quiet", "orphan"]])
        self.assertIn(["prune", "--quiet"], restic.calls)

    def test_unknown_host_is_refused(self) -> None:
        with self.assertRaises(plan.PlanError):
            self.run_backup(FakeRestic([]), ["raspi4-z"])


if __name__ == "__main__":
    unittest.main()
