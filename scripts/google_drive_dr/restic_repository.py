"""Generic encrypted restic repository adapter.

The adapter knows how to speak restic and rclone.  It intentionally knows
nothing about PostgreSQL, Docker, Business Pi paths, or the manifest format;
those choices remain in ``snapshot_builder`` and ``runner``.
"""

from __future__ import annotations

import json
import math
import os
import stat as stat_module
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from .command_port import CommandError, CommandPort, CommandResult

GIB = 1024**3
DEFAULT_REPOSITORY = "rclone:google-drive:RaspberryPiSystem_002/business-pi5"
DEFAULT_RESERVE_BYTES = 20 * GIB
DEFAULT_TAG = "business-pi5"
DEFAULT_GROUP_BY = "host,tags"


class ResticRepositoryError(RuntimeError):
    """Raised when a repository operation cannot be completed safely."""


class ResticMaintenanceError(ResticRepositoryError):
    """A snapshot exists, but post-upload verification/retention failed.

    The successful snapshot result is retained so the caller can report the
    durable ID and avoid treating a maintenance failure as an absent upload.
    """

    def __init__(self, result: BackupResult, operation: str):
        self.result = result
        self.operation = operation
        super().__init__(f"restic {operation} maintenance failed")


@dataclass(frozen=True)
class ResticRepositoryConfig:
    repository: str = DEFAULT_REPOSITORY
    rclone_config: Path = Path("/etc/raspi-google-drive-dr/rclone.conf")
    password_file: Path = Path("/etc/raspi-google-drive-dr/restic-password")
    reserve_bytes: int = DEFAULT_RESERVE_BYTES
    tag: str = DEFAULT_TAG
    restic_binary: str = "restic"
    rclone_binary: str = "rclone"
    enforce_google_drive: bool = True

    def __post_init__(self) -> None:
        if self.enforce_google_drive:
            validate_google_drive_repository(self.repository)
        if self.reserve_bytes < 0:
            raise ValueError("reserve_bytes must not be negative")
        if not self.tag or any(character.isspace() for character in self.tag):
            raise ValueError("restic tag must be a non-empty token")

    @property
    def remote_name(self) -> str:
        return self.repository.removeprefix("rclone:").split(":", 1)[0]

    @property
    def remote_root(self) -> str:
        return f"{self.remote_name}:"


@dataclass(frozen=True)
class CapacityReport:
    free_bytes: int
    required_bytes: int
    reserve_bytes: int

    @property
    def sufficient(self) -> bool:
        return self.free_bytes >= self.required_bytes + self.reserve_bytes


@dataclass(frozen=True)
class BackupResult:
    snapshot_id: str
    bytes_processed: int


@dataclass(frozen=True)
class RestoreResult:
    snapshot_id: str
    bytes_restored: int


def validate_google_drive_repository(repository: str) -> None:
    """Reject a wrong remote/path before any cloud write is possible."""

    if repository != DEFAULT_REPOSITORY:
        raise ValueError(
            "RESTIC_REPOSITORY must be rclone:google-drive:RaspberryPiSystem_002/business-pi5"
        )


def _json_records(output: bytes) -> list[dict[str, object]]:
    records: list[dict[str, object]] = []
    for line in output.decode("utf-8", errors="replace").splitlines():
        try:
            parsed = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict):
            records.append(parsed)
    return records


class ResticRepository:
    """Perform restic lifecycle operations through an injected command port."""

    def __init__(self, config: ResticRepositoryConfig, commands: CommandPort) -> None:
        self.config = config
        self.commands = commands

    def environment(self) -> dict[str, str]:
        """Return restic/rclone environment without embedding a password."""

        environment = os.environ.copy()
        # Inline password variables are explicitly ignored.  The only
        # accepted password source is the root-owned password file.
        for key in (
            "RESTIC_PASSWORD",
            "RESTIC_REPOSITORY",
            "RESTIC_PASSWORD_FILE",
            "RCLONE_CONFIG",
            "RESTIC_PROGRESS_FPS",
        ):
            environment.pop(key, None)
        environment.update(
            {
                "RESTIC_REPOSITORY": self.config.repository,
                "RESTIC_PASSWORD_FILE": str(self.config.password_file),
                "RCLONE_CONFIG": str(self.config.rclone_config),
            }
        )
        return environment

    def validate_credentials(self) -> None:
        for path in (self.config.rclone_config, self.config.password_file):
            try:
                metadata = path.stat()
            except FileNotFoundError as error:
                raise ResticRepositoryError("root-owned 0600 backup credentials are required") from error
            if not path.is_file() or metadata.st_uid != 0 or metadata.st_gid != 0:
                raise ResticRepositoryError("backup credential ownership must be root:root")
            if stat_module.S_IMODE(metadata.st_mode) != 0o600:
                raise ResticRepositoryError("backup credentials must have mode 0600")
            if metadata.st_size <= 0:
                raise ResticRepositoryError("backup credential files must not be empty")

    def repository_exists(self) -> bool:
        result = self._run_restic(["cat", "config"], check=False)
        return result.returncode == 0

    def init(self) -> None:
        self._run_restic(["init"])

    def remote_capacity(self, required_bytes: int) -> CapacityReport:
        if required_bytes < 0:
            raise ValueError("required_bytes must not be negative")
        result = self.commands.run(
            [self.config.rclone_binary, "about", self.config.remote_root, "--json"],
            env=self.environment(),
        )
        try:
            payload = json.loads(result.stdout.decode("utf-8"))
            free_bytes = int(payload.get("free", 0))
        except (AttributeError, UnicodeDecodeError, json.JSONDecodeError, TypeError, ValueError) as error:
            raise ResticRepositoryError("Google Drive capacity metadata is invalid") from error
        reserve_bytes = max(
            self.config.reserve_bytes,
            math.ceil(required_bytes * 15 / 100),
        )
        report = CapacityReport(free_bytes, required_bytes, reserve_bytes)
        if not report.sufficient:
            raise ResticRepositoryError("Google Drive capacity is insufficient")
        return report

    def backup(
        self,
        paths: Sequence[Path],
        *,
        excludes: Sequence[str] = (),
        prune: bool = False,
    ) -> BackupResult:
        if not paths:
            raise ResticRepositoryError("at least one source path is required")
        arguments: list[str] = [
            "backup",
            "--json",
            "--quiet",
            "--group-by",
            DEFAULT_GROUP_BY,
            "--tag",
            self.config.tag,
        ]
        for pattern in excludes:
            arguments.extend(("--exclude", pattern))
        arguments.extend(str(Path(path)) for path in paths)
        result = self._run_restic(arguments)
        records = _json_records(result.stdout)
        summary = next(
            (record for record in reversed(records) if record.get("message_type") == "summary"),
            None,
        )
        if summary is None or not summary.get("snapshot_id"):
            raise ResticRepositoryError("restic backup did not return a snapshot id")
        snapshot_id = str(summary["snapshot_id"])
        bytes_processed = int(summary.get("total_bytes_processed", 0) or 0)
        result = BackupResult(snapshot_id=snapshot_id, bytes_processed=bytes_processed)
        try:
            self.check()
        except ResticRepositoryError as error:
            raise ResticMaintenanceError(result, "check") from error
        try:
            self.forget()
        except ResticRepositoryError as error:
            raise ResticMaintenanceError(result, "forget") from error
        if prune:
            try:
                self.prune()
            except ResticRepositoryError as error:
                raise ResticMaintenanceError(result, "prune") from error
        return result

    def check(self) -> None:
        self._run_restic(["check"])

    def forget(self) -> None:
        self._run_restic(
            [
                "forget",
                "--group-by",
                DEFAULT_GROUP_BY,
                "--tag",
                self.config.tag,
                "--keep-daily",
                "7",
                "--keep-weekly",
                "5",
                "--keep-monthly",
                "12",
            ]
        )

    def prune(self) -> None:
        self._run_restic(["prune"])

    def restore_latest(self, target: Path) -> RestoreResult:
        target = Path(target)
        if target.exists():
            raise ResticRepositoryError("restore target must not already exist")
        snapshot_id = self._resolve_latest_snapshot_id()
        target.mkdir(mode=0o700, parents=True)
        result = self._run_restic(
            [
                "restore",
                snapshot_id,
                "--json",
                "--quiet",
                "--target",
                str(target),
            ]
        )
        records = _json_records(result.stdout)
        summary = next(
            (record for record in reversed(records) if record.get("message_type") == "summary"),
            None,
        )
        bytes_restored = int(summary.get("total_bytes", 0) or 0) if summary else 0
        return RestoreResult(snapshot_id=snapshot_id, bytes_restored=bytes_restored)

    def _resolve_latest_snapshot_id(self) -> str:
        result = self._run_restic(
            [
                "snapshots",
                "--json",
                "--tag",
                self.config.tag,
            ]
        )
        try:
            output = result.stdout
            if not isinstance(output, bytes):
                raise TypeError("restic snapshots output is not bytes")
            payload = json.loads(output.decode("utf-8"))
        except (AttributeError, TypeError, UnicodeDecodeError, json.JSONDecodeError) as error:
            raise ResticRepositoryError("restic snapshots returned invalid JSON") from error
        if not isinstance(payload, list):
            raise ResticRepositoryError("restic snapshots JSON must be an array")
        if not payload:
            raise ResticRepositoryError("restic snapshots returned no matching snapshot")
        candidates: list[tuple[datetime, str]] = []
        for snapshot in payload:
            if not isinstance(snapshot, dict):
                raise ResticRepositoryError("restic snapshots returned an invalid snapshot object")
            raw_id = snapshot.get("id")
            if not isinstance(raw_id, str) or not raw_id.strip():
                raise ResticRepositoryError("restic snapshots returned an invalid snapshot id")
            raw_time = snapshot.get("time")
            if not isinstance(raw_time, str) or not raw_time.strip():
                raise ResticRepositoryError("restic snapshots returned an invalid snapshot time")
            try:
                snapshot_time = datetime.fromisoformat(raw_time.strip().replace("Z", "+00:00"))
            except ValueError as error:
                raise ResticRepositoryError("restic snapshots returned an invalid snapshot time") from error
            if snapshot_time.tzinfo is None or snapshot_time.utcoffset() is None:
                raise ResticRepositoryError("restic snapshots returned a timezone-naive snapshot time")
            candidates.append((snapshot_time, raw_id.strip()))
        return max(candidates)[1]

    def _run_restic(
        self,
        arguments: Sequence[str],
        *,
        check: bool = True,
        input: bytes | None = None,
    ) -> CommandResult:
        try:
            return self.commands.run(
                [self.config.restic_binary, *arguments],
                check=check,
                input=input,
                env=self.environment(),
            )
        except CommandError as error:
            raise ResticRepositoryError("restic operation failed") from error
