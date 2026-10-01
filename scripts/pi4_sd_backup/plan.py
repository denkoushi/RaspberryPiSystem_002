"""Pure decisions for the Pi4 SD backup: commands, snapshot choice, and restore safety.

Nothing here runs a process, so every rule can be unit-tested on a Mac.
"""

from __future__ import annotations

import datetime as dt
import json
import re
import shlex
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Mapping, Sequence

BACKUP_TAG = "pi4-sd"
PARTS = ("table", "boot", "root")
STDIN_FILENAMES = {"table": "partition-table.sfdisk", "boot": "boot.tar", "root": "root.tar"}
KEEP_WEEKLY = 4
KEEP_MONTHLY = 6

HOST_PATTERN = re.compile(r"^[a-z0-9][a-z0-9-]{0,62}$")
USER_PATTERN = re.compile(r"^[a-z_][a-z0-9_-]{0,31}$")
ADDRESS_PATTERN = re.compile(r"^[A-Za-z0-9.:-]{1,253}$")
RUN_ID_PATTERN = re.compile(r"^\d{8}T\d{6}Z$")

# Paths that are rebuilt at boot, are caches, or would hold another card's swap.
# Mount points of other filesystems (/proc, /sys, /dev, /run, /tmp, /boot/firmware)
# are skipped by --one-file-system, but their empty directories are kept.
ROOT_EXCLUDES = (
    "./var/log/journal",
    "./var/cache/apt/archives",
    "./var/tmp",
    "./home/*/.cache",
    "./root/.cache",
    "./swapfile",
    "./var/swap",
    "./lost+found",
)

TAR_CREATE = (
    "tar --create --file=- --numeric-owner --xattrs --xattrs-include='*' --acls "
    "--one-file-system --warning=no-file-changed --warning=no-file-removed"
)
# GNU tar exits 1 when a file changed while it was read. A kiosk keeps running
# during the backup, so that is expected; anything above 1 is a real failure.
TOLERATE_CHANGED_FILES = 'rc=$?; [ "$rc" -le 1 ] || exit "$rc"'


class PlanError(ValueError):
    """An input that must stop the operation before anything is written."""


@dataclass(frozen=True)
class Target:
    host: str
    address: str
    user: str


def load_targets(raw: str) -> list[Target]:
    try:
        records = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise PlanError("targets file is not valid JSON") from exc
    if not isinstance(records, list):
        raise PlanError("targets file must be a JSON list")
    targets: list[Target] = []
    seen: set[str] = set()
    for record in records:
        if not isinstance(record, dict):
            raise PlanError("each target must be an object")
        host, address, user = (str(record.get(key, "")) for key in ("host", "address", "user"))
        if not HOST_PATTERN.match(host):
            raise PlanError(f"invalid host name: {host!r}")
        if not ADDRESS_PATTERN.match(address):
            raise PlanError(f"invalid address for {host}")
        if not USER_PATTERN.match(user):
            raise PlanError(f"invalid SSH user for {host}")
        if host in seen:
            raise PlanError(f"duplicate host: {host}")
        seen.add(host)
        targets.append(Target(host=host, address=address, user=user))
    return targets


def remote_script(part: str) -> str:
    """Shell run with sudo on the Pi4 that writes one part to stdout."""

    if part == "table":
        return (
            'disk="$(lsblk -no PKNAME "$(findmnt -no SOURCE /)")" && '
            '[ -n "$disk" ] && sfdisk --dump "/dev/$disk"'
        )
    if part == "boot":
        return f"{TAR_CREATE} --directory=/boot/firmware .; {TOLERATE_CHANGED_FILES}"
    if part == "root":
        excludes = " ".join(f"--exclude={shlex.quote(path)}" for path in ROOT_EXCLUDES)
        return f"{TAR_CREATE} {excludes} --directory=/ .; {TOLERATE_CHANGED_FILES}"
    raise PlanError(f"unknown part: {part}")


def ssh_command(target: Target, part: str, *, ssh_user: str) -> list[str]:
    """Command restic runs to read one part; SSH runs as the Pi5 deploy user."""

    if not USER_PATTERN.match(ssh_user):
        raise PlanError("invalid Pi5 SSH user")
    remote = "sudo -n sh -c " + shlex.quote(remote_script(part))
    return [
        "runuser",
        "-u",
        ssh_user,
        "--",
        "ssh",
        "-o",
        "BatchMode=yes",
        "-o",
        "ConnectTimeout=20",
        "-o",
        "ServerAliveInterval=30",
        "-o",
        "ServerAliveCountMax=4",
        "-o",
        "StrictHostKeyChecking=accept-new",
        f"{target.user}@{target.address}",
        remote,
    ]


def backup_args(target: Target, part: str, run_id: str, *, ssh_user: str) -> list[str]:
    if not RUN_ID_PATTERN.match(run_id):
        raise PlanError("invalid run id")
    return [
        "backup",
        "--quiet",
        "--json",
        "--host",
        target.host,
        "--tag",
        BACKUP_TAG,
        "--tag",
        f"part:{part}",
        "--tag",
        f"run:{run_id}",
        "--stdin-filename",
        STDIN_FILENAMES[part],
        "--stdin-from-command",
        "--",
        *ssh_command(target, part, ssh_user=ssh_user),
    ]


@dataclass(frozen=True)
class CompleteRun:
    run_id: str
    snapshot_ids: Mapping[str, str]


def _tag_value(tags: Iterable[str], prefix: str) -> str | None:
    for tag in tags:
        if tag.startswith(prefix):
            return tag[len(prefix):]
    return None


def latest_complete_run(snapshots: Sequence[Mapping[str, object]], host: str) -> CompleteRun:
    """Pick the newest run for which all three parts of ``host`` exist."""

    runs = _runs_by_host(snapshots).get(host, {})
    complete = sorted(run for run, parts in runs.items() if set(parts) == set(PARTS))
    if not complete:
        raise PlanError(f"no complete backup (table, boot and root from one run) for {host}")
    newest = complete[-1]
    return CompleteRun(run_id=newest, snapshot_ids=runs[newest])


def _runs_by_host(snapshots: Sequence[Mapping[str, object]]) -> dict[str, dict[str, dict[str, str]]]:
    """host -> run id -> part -> snapshot id."""

    hosts: dict[str, dict[str, dict[str, str]]] = {}
    for snapshot in snapshots:
        host = snapshot.get("hostname")
        tags = snapshot.get("tags") or []
        snapshot_id = snapshot.get("id")
        if not isinstance(host, str) or not isinstance(tags, list) or not isinstance(snapshot_id, str):
            continue
        if BACKUP_TAG not in tags:
            continue
        run_id = _tag_value(tags, "run:")
        part = _tag_value(tags, "part:")
        if not run_id or part not in PARTS:
            continue
        hosts.setdefault(host, {}).setdefault(run_id, {})[part] = snapshot_id
    return hosts


def _run_time(run_id: str) -> dt.datetime:
    return dt.datetime.strptime(run_id, "%Y%m%dT%H%M%SZ")


def snapshots_to_forget(snapshots: Sequence[Mapping[str, object]]) -> list[str]:
    """Per host, keep the newest complete run of each of the last weeks and months.

    restic's own ``forget --group-by`` cannot keep the three parts of one run
    together, so retention is decided here per run. Incomplete runs are kept
    only while they are newer than the newest complete run (a run in progress).
    """

    forget: list[str] = []
    for runs in _runs_by_host(snapshots).values():
        complete = sorted((run for run, parts in runs.items() if set(parts) == set(PARTS)), reverse=True)
        keep: set[str] = set()
        weeks: list[tuple[int, int]] = []
        months: list[tuple[int, int]] = []
        for run in complete:
            when = _run_time(run)
            week = when.isocalendar()[:2]
            month = (when.year, when.month)
            if week not in weeks and len(weeks) < KEEP_WEEKLY:
                weeks.append(week)
                keep.add(run)
            if month not in months and len(months) < KEEP_MONTHLY:
                months.append(month)
                keep.add(run)
        newest_complete = complete[0] if complete else ""
        for run, parts in runs.items():
            if run in keep or run > newest_complete:
                continue
            forget.extend(parts.values())
    return sorted(forget)


def fill_card_table(sfdisk_dump: str) -> str:
    """Keep the disk identifier and partition starts, but let the last partition fill the card.

    Keeping ``label-id`` keeps every PARTUUID, which ``/etc/fstab`` and
    ``cmdline.txt`` refer to, so the restored card boots without edits.
    """

    lines = []
    partition_lines = []
    for line in sfdisk_dump.splitlines():
        stripped = line.strip()
        if stripped.startswith(("last-lba:", "device:", "first-lba:")):
            continue
        if stripped.startswith("/dev/"):
            partition_lines.append(len(lines))
        lines.append(line)
    if len(partition_lines) != 2:
        raise PlanError("expected exactly two partitions (boot and root) in the saved table")
    if not any(line.strip().startswith("label-id:") for line in lines):
        raise PlanError("saved partition table has no label-id")
    last = partition_lines[-1]
    lines[last] = re.sub(r",\s*size=\s*\d+", "", lines[last])
    return "\n".join(lines) + "\n"


def partition_path(device: str, number: int) -> str:
    suffix = f"p{number}" if re.search(r"\d$", device) else str(number)
    return f"{device}{suffix}"


DEVICE_PATTERN = re.compile(r"^/dev/(sd[a-z]|mmcblk\d+)$")


@dataclass(frozen=True)
class DeviceFacts:
    device: str
    size_bytes: int
    removable: bool
    transport: str
    mounted_paths: Sequence[str]
    holds_system_root: bool


def check_restore_device(facts: DeviceFacts, *, required_bytes: int) -> None:
    """Refuse anything that is not an unmounted removable card large enough."""

    if not DEVICE_PATTERN.match(facts.device):
        raise PlanError(f"{facts.device} is not a whole-disk /dev/sdX or /dev/mmcblkN device")
    if facts.holds_system_root:
        raise PlanError(f"{facts.device} holds the running system; refusing")
    if not (facts.removable or facts.transport == "usb"):
        raise PlanError(f"{facts.device} is neither removable nor on USB; refusing")
    if facts.mounted_paths:
        raise PlanError(f"{facts.device} has mounted partitions: {', '.join(facts.mounted_paths)}")
    if facts.size_bytes < required_bytes:
        raise PlanError(
            f"{facts.device} is {facts.size_bytes / 1e9:.1f} GB; the backup needs "
            f"at least {required_bytes / 1e9:.1f} GB"
        )


def restore_tar_args(archive: Path | str) -> list[str]:
    return [
        "tar",
        "--extract",
        "--file=-",
        "--preserve-permissions",
        "--numeric-owner",
        "--xattrs",
        "--xattrs-include=*",
        "--acls",
        f"--directory={archive}",
    ]


PARTUUID_PATTERN = re.compile(r"PARTUUID=([0-9A-Fa-f-]+)")


def referenced_partuuids(fstab: str, cmdline: str) -> set[str]:
    """PARTUUIDs the restored system will look for at boot."""

    found = set(PARTUUID_PATTERN.findall(cmdline))
    for line in fstab.splitlines():
        if line.strip().startswith("#"):
            continue
        found.update(PARTUUID_PATTERN.findall(line))
    return {value.lower() for value in found}
