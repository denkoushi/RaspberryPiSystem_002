"""CLI for the Pi4 SD backup: ``backup``, ``list`` and ``restore``.

Runs on the Business Pi5 as root. Secrets are read from files by path only
and never printed.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Mapping, Sequence

from . import plan

DEFAULT_REPOSITORY = "rclone:google-drive:RaspberryPiSystem_002/pi4-sd"
DEFAULT_TARGETS_FILE = "/etc/raspi-pi4-sd-backup/targets.json"
# The Business Pi5 DR lane already keeps these under offline custody; the Pi4
# lane is a separate repository that reuses them rather than adding new secrets.
DEFAULT_PASSWORD_FILE = "/etc/raspi-google-drive-dr/restic-password"
DEFAULT_RCLONE_CONFIG = "/etc/raspi-google-drive-dr/rclone.conf"
RESTORE_MARGIN = 1.15


def log(event: str, **fields: object) -> None:
    record = {"time": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"), "event": event, **fields}
    print(json.dumps(record, ensure_ascii=False), flush=True)


@dataclass(frozen=True)
class Settings:
    repository: str
    password_file: str
    rclone_config: str
    targets_file: str
    ssh_user: str

    @classmethod
    def from_env(cls, env: Mapping[str, str]) -> "Settings":
        return cls(
            repository=env.get("PI4_SD_BACKUP_REPOSITORY", DEFAULT_REPOSITORY),
            password_file=env.get("PI4_SD_BACKUP_PASSWORD_FILE", DEFAULT_PASSWORD_FILE),
            rclone_config=env.get("PI4_SD_BACKUP_RCLONE_CONFIG", DEFAULT_RCLONE_CONFIG),
            targets_file=env.get("PI4_SD_BACKUP_TARGETS", DEFAULT_TARGETS_FILE),
            ssh_user=env.get("PI4_SD_BACKUP_PI5_SSH_USER", ""),
        )

    def restic_env(self) -> dict[str, str]:
        env = {
            key: value
            for key, value in os.environ.items()
            if key not in {"RESTIC_PASSWORD", "RESTIC_PASSWORD_COMMAND", "RESTIC_PROGRESS_FPS"}
        }
        env.update(
            {
                "RESTIC_REPOSITORY": self.repository,
                "RESTIC_PASSWORD_FILE": self.password_file,
                "RCLONE_CONFIG": self.rclone_config,
            }
        )
        return env


Run = Callable[..., subprocess.CompletedProcess]


class Restic:
    def __init__(self, settings: Settings, run: Run = subprocess.run) -> None:
        self.settings = settings
        self.run = run

    def __call__(self, args: Sequence[str], *, check: bool = True, capture: bool = True) -> subprocess.CompletedProcess:
        return self.run(
            ["restic", *args],
            env=self.settings.restic_env(),
            check=check,
            stdout=subprocess.PIPE if capture else None,
            stderr=subprocess.PIPE if capture else None,
        )

    def ensure_repository(self) -> None:
        if self(["cat", "config"], check=False).returncode != 0:
            log("repository_init", repository=self.settings.repository)
            self(["init"])

    def snapshots(self) -> list[dict[str, object]]:
        result = self(["snapshots", "--json", "--tag", plan.BACKUP_TAG])
        records = json.loads(result.stdout or b"[]")
        return records if isinstance(records, list) else []


def load_targets(settings: Settings) -> list[plan.Target]:
    return plan.load_targets(Path(settings.targets_file).read_text(encoding="utf-8"))


def cmd_backup(settings: Settings, restic: Restic, hosts: Sequence[str], now: dt.datetime) -> int:
    if not settings.ssh_user:
        raise plan.PlanError("PI4_SD_BACKUP_PI5_SSH_USER is not set")
    targets = load_targets(settings)
    if hosts:
        unknown = set(hosts) - {target.host for target in targets}
        if unknown:
            raise plan.PlanError(f"unknown host(s): {', '.join(sorted(unknown))}")
        targets = [target for target in targets if target.host in hosts]
    run_id = now.strftime("%Y%m%dT%H%M%SZ")
    restic.ensure_repository()

    failed: list[str] = []
    for target in targets:
        log("host_start", host=target.host, run_id=run_id)
        for part in plan.PARTS:
            result = restic(plan.backup_args(target, part, run_id, ssh_user=settings.ssh_user), check=False)
            if result.returncode != 0:
                # restic leaves no snapshot when the reading command fails, so an
                # offline or broken kiosk cannot produce a partial "latest" run.
                log("part_failed", host=target.host, part=part, exit_code=result.returncode)
                failed.append(target.host)
                break
            log("part_done", host=target.host, part=part)
        else:
            log("host_done", host=target.host, run_id=run_id)

    forget = plan.snapshots_to_forget(restic.snapshots())
    if forget:
        restic(["forget", "--quiet", *forget])
        restic(["prune", "--quiet"])
    log("retention", forgotten_snapshots=len(forget))
    log("backup_finished", run_id=run_id, failed_hosts=failed)
    return 1 if failed else 0


def cmd_list(restic: Restic) -> int:
    snapshots = restic.snapshots()
    hosts = sorted({str(s.get("hostname")) for s in snapshots})
    for host in hosts:
        try:
            run = plan.latest_complete_run(snapshots, host)
        except plan.PlanError:
            print(f"{host}\t(no complete backup)")
            continue
        size = _restore_bytes(snapshots, run)
        print(f"{host}\t{run.run_id}\t{size / 1e9:.1f} GB")
    return 0


def _restore_bytes(snapshots: Sequence[Mapping[str, object]], run: plan.CompleteRun) -> int:
    total = 0
    wanted = set(run.snapshot_ids.values())
    for snapshot in snapshots:
        if snapshot.get("id") in wanted:
            summary = snapshot.get("summary") or {}
            if isinstance(summary, dict):
                total += int(summary.get("total_bytes_processed") or 0)
    return total


def _device_facts(device: str, run: Run) -> plan.DeviceFacts:
    listing = json.loads(
        run(
            ["lsblk", "--json", "--bytes", "--output", "PATH,SIZE,RM,TRAN,MOUNTPOINTS", device],
            check=True,
            stdout=subprocess.PIPE,
        ).stdout
    )
    disk = listing["blockdevices"][0]
    mounted = [
        mount
        for node in [disk, *disk.get("children", [])]
        for mount in (node.get("mountpoints") or [])
        if mount
    ]
    root_source = run(["findmnt", "-no", "SOURCE", "/"], check=True, stdout=subprocess.PIPE).stdout.decode().strip()
    root_disk = run(["lsblk", "-no", "PKNAME", root_source], check=True, stdout=subprocess.PIPE).stdout.decode().strip()
    return plan.DeviceFacts(
        device=device,
        size_bytes=int(disk.get("size") or 0),
        removable=bool(disk.get("rm")),
        transport=str(disk.get("tran") or ""),
        mounted_paths=mounted,
        holds_system_root=bool(root_disk) and device == f"/dev/{root_disk}",
    )


def _dump_into(restic: Restic, snapshot_id: str, filename: str, directory: str) -> None:
    dump = subprocess.Popen(
        ["restic", "dump", snapshot_id, f"/{filename}"],
        env=restic.settings.restic_env(),
        stdout=subprocess.PIPE,
    )
    assert dump.stdout is not None
    extract = subprocess.run(plan.restore_tar_args(directory), stdin=dump.stdout, check=False)
    dump.stdout.close()
    if dump.wait() != 0 or extract.returncode != 0:
        raise plan.PlanError(f"restoring {filename} failed (restic {dump.returncode}, tar {extract.returncode})")


def cmd_restore(settings: Settings, restic: Restic, host: str, device: str, confirm_host: str, run: Run) -> int:
    if confirm_host != host:
        raise plan.PlanError("--confirm-host must repeat --host exactly")
    snapshots = restic.snapshots()
    backup = plan.latest_complete_run(snapshots, host)
    required = int(_restore_bytes(snapshots, backup) * RESTORE_MARGIN)
    plan.check_restore_device(_device_facts(device, run), required_bytes=required)
    log("restore_start", host=host, run_id=backup.run_id, device=device)

    table = restic(["dump", backup.snapshot_ids["table"], f"/{plan.STDIN_FILENAMES['table']}"]).stdout.decode()
    run(["wipefs", "--all", device], check=True)
    run(["sfdisk", "--wipe", "always", "--wipe-partitions", "always", device],
        input=plan.fill_card_table(table).encode(), check=True)
    run(["partprobe", device], check=True)
    run(["udevadm", "settle"], check=True)
    boot_part, root_part = plan.partition_path(device, 1), plan.partition_path(device, 2)
    run(["mkfs.vfat", "-F", "32", "-n", "bootfs", boot_part], check=True)
    run(["mkfs.ext4", "-F", "-q", "-L", "rootfs", root_part], check=True)

    with tempfile.TemporaryDirectory(prefix="pi4-sd-restore-") as work:
        root_dir = Path(work) / "root"
        root_dir.mkdir()
        run(["mount", root_part, str(root_dir)], check=True)
        try:
            _dump_into(restic, backup.snapshot_ids["root"], plan.STDIN_FILENAMES["root"], str(root_dir))
            boot_dir = root_dir / "boot" / "firmware"
            boot_dir.mkdir(parents=True, exist_ok=True)
            run(["mount", boot_part, str(boot_dir)], check=True)
            try:
                _dump_into(restic, backup.snapshot_ids["boot"], plan.STDIN_FILENAMES["boot"], str(boot_dir))
                _verify_partuuids(root_dir, boot_dir, [boot_part, root_part], run)
            finally:
                run(["umount", str(boot_dir)], check=True)
        finally:
            run(["sync"], check=False)
            run(["umount", str(root_dir)], check=True)
    log("restore_done", host=host, run_id=backup.run_id, device=device)
    return 0


def _verify_partuuids(root_dir: Path, boot_dir: Path, partitions: Sequence[str], run: Run) -> None:
    actual = {
        run(["blkid", "-s", "PARTUUID", "-o", "value", part], check=True, stdout=subprocess.PIPE)
        .stdout.decode()
        .strip()
        .lower()
        for part in partitions
    }
    referenced = plan.referenced_partuuids(
        (root_dir / "etc" / "fstab").read_text(encoding="utf-8"),
        (boot_dir / "cmdline.txt").read_text(encoding="utf-8"),
    )
    missing = referenced - actual
    if missing:
        raise plan.PlanError(f"restored card does not provide PARTUUID(s) {sorted(missing)}; it would not boot")


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="pi4_sd_backup")
    sub = parser.add_subparsers(dest="command", required=True)
    backup = sub.add_parser("backup", help="back up every target (or --host) to Google Drive")
    backup.add_argument("--host", action="append", default=[])
    sub.add_parser("list", help="show the newest complete backup per host")
    restore = sub.add_parser("restore", help="write a host's newest backup onto a new card")
    restore.add_argument("--host", required=True)
    restore.add_argument("--device", required=True, help="whole card device in the USB reader, e.g. /dev/sdb")
    restore.add_argument("--confirm-host", required=True, help="repeat --host to confirm")
    args = parser.parse_args(argv)

    settings = Settings.from_env(os.environ)
    restic = Restic(settings)
    try:
        if args.command == "backup":
            return cmd_backup(settings, restic, args.host, dt.datetime.now(dt.timezone.utc))
        if args.command == "list":
            return cmd_list(restic)
        return cmd_restore(settings, restic, args.host, args.device, args.confirm_host, subprocess.run)
    except plan.PlanError as exc:
        log("refused", reason=str(exc))
        return 2
    except subprocess.CalledProcessError as exc:
        log("command_failed", command=str(exc.cmd[0]), exit_code=exc.returncode)
        return 3


if __name__ == "__main__":
    sys.exit(main())
