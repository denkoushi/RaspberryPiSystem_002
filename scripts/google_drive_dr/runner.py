#!/usr/bin/env python3
"""CLI orchestration for the Business Pi 5 encrypted DR snapshot lane."""

from __future__ import annotations

import argparse
import fcntl
import json
import os
import shutil
import signal
import sys
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Self
from zoneinfo import ZoneInfo

try:  # Direct systemd execution has no package context.
    from .command_port import CommandError, CommandPort, SubprocessCommandPort
    from .restic_repository import (
        DEFAULT_REPOSITORY,
        DEFAULT_RESERVE_BYTES,
        CapacityReport,
        ResticMaintenanceError,
        ResticRepository,
        ResticRepositoryConfig,
        ResticRepositoryError,
        RestoreResult,
    )
    from .restore_validator import RestoreValidationError, RestoreValidator
    from .snapshot_builder import SnapshotArtifact, SnapshotBuilder, SnapshotError
    from .source_policy import (
        DEFAULT_CREDENTIAL_ROOT,
        DEFAULT_PROJECT_ROOT,
        DEFAULT_STAGING_ROOT,
        SourcePolicyError,
        default_policy,
        path_usage,
        resolve,
        restic_excludes,
    )
except ImportError:  # pragma: no cover - exercised by the installed script.
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from google_drive_dr.command_port import (
        CommandError,
        CommandPort,
        SubprocessCommandPort,
    )
    from google_drive_dr.restic_repository import (
        DEFAULT_REPOSITORY,
        DEFAULT_RESERVE_BYTES,
        CapacityReport,
        ResticMaintenanceError,
        ResticRepository,
        ResticRepositoryConfig,
        ResticRepositoryError,
        RestoreResult,
    )
    from google_drive_dr.restore_validator import (
        RestoreValidationError,
        RestoreValidator,
    )
    from google_drive_dr.snapshot_builder import (
        SnapshotArtifact,
        SnapshotBuilder,
        SnapshotError,
    )
    from google_drive_dr.source_policy import (
        DEFAULT_CREDENTIAL_ROOT,
        DEFAULT_PROJECT_ROOT,
        DEFAULT_STAGING_ROOT,
        SourcePolicyError,
        default_policy,
        path_usage,
        resolve,
        restic_excludes,
    )


GIB = 1024**3
DEFAULT_GIT_BUNDLE_ESTIMATE_BYTES = 128 * 1024 * 1024
DEFAULT_MANIFEST_OVERHEAD_BYTES = 16 * 1024 * 1024
EXIT_CAPACITY = 20
EXIT_SNAPSHOT = 21
EXIT_RESTORE = 22
EXIT_SIGTERM = 143
EXIT_SIGINT = 130


class RunnerError(RuntimeError):
    """A safe, category-coded operational failure."""

    def __init__(self, category: str, exit_code: int):
        self.category = category
        self.exit_code = exit_code
        super().__init__(category)


@dataclass(frozen=True)
class RunnerConfig:
    project_root: Path = DEFAULT_PROJECT_ROOT
    staging_root: Path = DEFAULT_STAGING_ROOT
    credential_root: Path = DEFAULT_CREDENTIAL_ROOT
    repository: str = DEFAULT_REPOSITORY
    rclone_config: Path = DEFAULT_CREDENTIAL_ROOT / "rclone.conf"
    password_file: Path = DEFAULT_CREDENTIAL_ROOT / "restic-password"
    compose_file: Path = DEFAULT_PROJECT_ROOT / "infrastructure/docker/docker-compose.server.yml"
    lock_file: Path = Path("/run/lock/raspi-google-drive-dr.lock")
    reserve_bytes: int = DEFAULT_RESERVE_BYTES
    database_estimate_bytes: int = 512 * 1024 * 1024
    git_bundle_estimate_bytes: int = DEFAULT_GIT_BUNDLE_ESTIMATE_BYTES
    manifest_overhead_bytes: int = DEFAULT_MANIFEST_OVERHEAD_BYTES
    restic_binary: str = "restic"
    rclone_binary: str = "rclone"

    @classmethod
    def from_env(cls) -> RunnerConfig:
        project_root = Path(os.environ.get("BUSINESS_PI5_PROJECT_ROOT", str(DEFAULT_PROJECT_ROOT))).absolute()
        credential_root = Path(
            os.environ.get("BUSINESS_PI5_DR_CREDENTIAL_ROOT", str(DEFAULT_CREDENTIAL_ROOT))
        ).absolute()
        repository = os.environ.get("RESTIC_REPOSITORY", DEFAULT_REPOSITORY)
        if repository != DEFAULT_REPOSITORY:
            raise RunnerError("repository policy", EXIT_SNAPSHOT)
        try:
            reserve_bytes = int(os.environ.get("BACKUP_RESERVE_BYTES", str(DEFAULT_RESERVE_BYTES)))
            database_estimate_bytes = int(
                os.environ.get("BACKUP_DATABASE_ESTIMATE_BYTES", str(512 * 1024 * 1024))
            )
            git_bundle_estimate_bytes = int(
                os.environ.get("BACKUP_GIT_BUNDLE_ESTIMATE_BYTES", str(DEFAULT_GIT_BUNDLE_ESTIMATE_BYTES))
            )
            manifest_overhead_bytes = int(
                os.environ.get("BACKUP_MANIFEST_OVERHEAD_BYTES", str(DEFAULT_MANIFEST_OVERHEAD_BYTES))
            )
        except ValueError as error:
            raise RunnerError("numeric configuration is invalid", EXIT_SNAPSHOT) from error
        if (
            reserve_bytes < 0
            or database_estimate_bytes < 0
            or git_bundle_estimate_bytes < 0
            or manifest_overhead_bytes < 0
        ):
            raise RunnerError("numeric configuration is invalid", EXIT_SNAPSHOT)
        return cls(
            project_root=project_root,
            staging_root=Path(
                os.environ.get("BACKUP_STAGING_ROOT", str(DEFAULT_STAGING_ROOT))
            ).absolute(),
            credential_root=credential_root,
            repository=repository,
            rclone_config=Path(
                os.environ.get("RCLONE_CONFIG", str(credential_root / "rclone.conf"))
            ).absolute(),
            password_file=Path(
                os.environ.get("RESTIC_PASSWORD_FILE", str(credential_root / "restic-password"))
            ).absolute(),
            compose_file=Path(
                os.environ.get(
                    "BUSINESS_PI5_COMPOSE_FILE",
                    str(project_root / "infrastructure/docker/docker-compose.server.yml"),
                )
            ).absolute(),
            lock_file=Path(
                os.environ.get(
                    "BUSINESS_PI5_DR_LOCK_FILE",
                    "/run/lock/raspi-google-drive-dr.lock",
                )
            ).absolute(),
            reserve_bytes=reserve_bytes,
            database_estimate_bytes=database_estimate_bytes,
            git_bundle_estimate_bytes=git_bundle_estimate_bytes,
            manifest_overhead_bytes=manifest_overhead_bytes,
            restic_binary=os.environ.get("RESTIC_BINARY", "restic"),
            rclone_binary=os.environ.get("RCLONE_BINARY", "rclone"),
        )


def emit(
    stage: str,
    *,
    repository_sha: str | None = None,
    total_bytes: int | None = None,
    snapshot_id: str | None = None,
    warning_count: int | None = None,
    exit_code: int | None = None,
) -> None:
    """Emit only the public operational fields allowed by the contract."""

    payload: dict[str, object] = {"stage": stage}
    if repository_sha is not None:
        payload["sha"] = repository_sha
    if total_bytes is not None:
        payload["bytes"] = int(total_bytes)
    if snapshot_id is not None:
        payload["snapshot_id"] = snapshot_id
    if warning_count is not None:
        payload["warning_count"] = int(warning_count)
    if exit_code is not None:
        payload["exit_code"] = int(exit_code)
    print(json.dumps(payload, sort_keys=True, separators=(",", ":")), flush=True)


class RunLock:
    """A small host lock that prevents overlapping manual and timer runs."""

    def __init__(self, path: Path, fallback_directory: Path) -> None:
        self.path = path
        self.fallback_directory = fallback_directory
        self.handle: object | None = None

    def __enter__(self) -> Self:
        path = self.path
        try:
            path.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
        except OSError:
            path = self.fallback_directory / ".raspi-google-drive-dr.lock"
            path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        handle = path.open("a+")
        try:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            handle.close()
            raise RunnerError("another backup is already running", EXIT_SNAPSHOT) from error
        self.path = path
        self.handle = handle
        return self

    def __exit__(self, _type: object, _value: object, _traceback: object) -> None:
        if self.handle is not None:
            fcntl.flock(self.handle.fileno(), fcntl.LOCK_UN)
            self.handle.close()
            self.handle = None


class Runner:
    """Coordinate policy, snapshot construction, and generic restic I/O."""

    def __init__(
        self,
        config: RunnerConfig,
        *,
        commands: CommandPort | None = None,
        repository: ResticRepository | None = None,
        builder: SnapshotBuilder | None = None,
        validator: RestoreValidator | None = None,
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        self.config = config
        self.commands = commands or SubprocessCommandPort()
        self.repository = repository or ResticRepository(
            ResticRepositoryConfig(
                repository=config.repository,
                rclone_config=config.rclone_config,
                password_file=config.password_file,
                reserve_bytes=config.reserve_bytes,
                restic_binary=config.restic_binary,
                rclone_binary=config.rclone_binary,
            ),
            self.commands,
        )
        self.builder = builder or SnapshotBuilder(
            self.commands,
            project_root=config.project_root,
            staging_root=config.staging_root,
            policy=default_policy(config.project_root, config.credential_root),
            compose_file=config.compose_file,
            clock=clock or datetime.now,
        )
        self.validator = validator or RestoreValidator(
            self.commands,
            project_root=config.project_root,
            compose_file=config.compose_file,
            staging_root=config.staging_root,
            credential_root=config.credential_root,
        )
        self.clock = clock or datetime.now
        self._signal_exit: int | None = None
        self._old_signal_handlers: dict[int, object] = {}

    def execute(self, command: str, *, target: Path | None = None) -> int:
        self._install_signal_handlers()
        try:
            if command == "capacity":
                self.capacity()
            elif command == "backup":
                self.backup()
            elif command == "restore-check":
                if target is None:
                    raise RunnerError("restore target is required", EXIT_RESTORE)
                self.restore_check(target)
            else:
                raise RunnerError("unknown command", EXIT_SNAPSHOT)
            if self._signal_exit is not None:
                emit("interrupted", exit_code=self._signal_exit)
                return self._signal_exit
            return 0
        except RunnerError as error:
            code = self._signal_exit or error.exit_code
            emit("failed", exit_code=code)
            return code
        except (
            CommandError,
            ResticRepositoryError,
            RestoreValidationError,
            SnapshotError,
            SourcePolicyError,
            OSError,
            ValueError,
        ):
            code = self._signal_exit or EXIT_SNAPSHOT
            emit("failed", exit_code=code)
            return code
        finally:
            self._restore_signal_handlers()

    def capacity(self) -> CapacityReport:
        try:
            self.repository.validate_credentials()
        except ResticRepositoryError as error:
            raise RunnerError("backup credentials are unavailable", EXIT_CAPACITY) from error
        try:
            selection = resolve(self.builder.policy)
        except SourcePolicyError as error:
            raise RunnerError("required recovery source is unavailable", EXIT_CAPACITY) from error
        source_paths = tuple(
            source.path
            for source in selection.included
            if source.spec.category != "project-root"
        )
        primary_bytes = path_usage(source_paths)
        local_required = (
            self.config.database_estimate_bytes
            + self.config.git_bundle_estimate_bytes
            + self.config.manifest_overhead_bytes
        )
        remote_required = primary_bytes + local_required
        local_margin = max(1 * GIB, (local_required * 5 + 99) // 100)
        staging_parent = self.config.staging_root
        while not staging_parent.exists() and staging_parent != staging_parent.parent:
            staging_parent = staging_parent.parent
        if shutil.disk_usage(staging_parent).free < local_required + local_margin:
            raise RunnerError("local staging capacity is insufficient", EXIT_CAPACITY)
        try:
            report = self.repository.remote_capacity(remote_required)
        except ResticRepositoryError as error:
            raise RunnerError("Google Drive capacity is insufficient", EXIT_CAPACITY) from error
        emit(
            "capacity_ok",
            total_bytes=remote_required,
            warning_count=len(selection.missing_optional),
        )
        return report

    def backup(self) -> SnapshotArtifact:
        try:
            self.repository.validate_credentials()
        except ResticRepositoryError as error:
            raise RunnerError("backup credentials are unavailable", EXIT_SNAPSHOT) from error
        with RunLock(self.config.lock_file, self.config.staging_root):
            self.builder.cleanup_stale_staging()
            artifact = self.builder.build()
            upload_started = False
            try:
                self._raise_if_interrupted()
                # A new repository needs room for the complete first
                # snapshot.  Once it exists, restic deduplicates the primary
                # roots; only this run's freshly generated dump, Git bundle,
                # and manifest are a meaningful preflight estimate.  Keep
                # this probe before capacity and use its result exactly once
                # so a transient repository read cannot change the decision
                # between the gate and initialization.
                repository_already_exists = self.repository.repository_exists()
                required_bytes = (
                    path_usage((artifact.staging_dir,))
                    if repository_already_exists
                    else artifact.total_bytes
                )
                try:
                    self.repository.remote_capacity(required_bytes)
                except ResticRepositoryError as error:
                    raise RunnerError("Google Drive capacity is insufficient", EXIT_CAPACITY) from error
                self._raise_if_interrupted()
                if not repository_already_exists:
                    self.repository.init()
                upload_started = True
                self._raise_if_interrupted()
                result = self.repository.backup(
                    artifact.upload_paths,
                    excludes=restic_excludes(self.builder.policy),
                    prune=self._is_sunday(),
                )
                self.builder.discard_staging(artifact.staging_dir)
                emit(
                    "backup_complete",
                    repository_sha=artifact.repository_sha,
                    total_bytes=result.bytes_processed or artifact.total_bytes,
                    snapshot_id=result.snapshot_id,
                )
                return artifact
            except ResticMaintenanceError as error:
                # The snapshot is durable even though a follow-up check or
                # retention operation failed.  A failed repository check
                # leaves the local marked stage available for inspection and
                # a later recovery attempt; forget/prune failures happen
                # after check succeeded, so their stage is no longer needed.
                # In every case expose the durable ID so operators do not
                # reclassify the run as an absent upload.
                if error.operation != "check":
                    self.builder.discard_staging(artifact.staging_dir)
                emit(
                    "backup_snapshot_created",
                    repository_sha=artifact.repository_sha,
                    total_bytes=error.result.bytes_processed or artifact.total_bytes,
                    snapshot_id=error.result.snapshot_id,
                )
                emit(
                    "backup_maintenance_failed",
                    total_bytes=error.result.bytes_processed or artifact.total_bytes,
                    snapshot_id=error.result.snapshot_id,
                    exit_code=EXIT_SNAPSHOT,
                )
                raise RunnerError("restic maintenance failed", EXIT_SNAPSHOT) from error
            except RunnerError:
                if not upload_started:
                    self.builder.discard_staging(artifact.staging_dir)
                raise
            except (ResticRepositoryError, CommandError, OSError) as error:
                # Once restic has been invoked, retain only this owned stage;
                # already-uploaded blobs are safe for a later fresh snapshot.
                if not upload_started:
                    self.builder.discard_staging(artifact.staging_dir)
                raise RunnerError("restic backup failed", EXIT_SNAPSHOT) from error

    def restore_check(self, target: Path) -> RestoreResult:
        target = Path(target)
        try:
            self.validator.preflight_target(target)
            self.repository.validate_credentials()
            result = self.repository.restore_latest(target)
            self.validator.validate(target)
        except ResticRepositoryError as error:
            raise RunnerError("restore failed", EXIT_RESTORE) from error
        except (CommandError, OSError, RestoreValidationError, ValueError) as error:
            raise RunnerError("restored payload validation failed", EXIT_RESTORE) from error
        emit(
            "restore_check_complete",
            total_bytes=result.bytes_restored,
            snapshot_id=result.snapshot_id,
        )
        return result

    def _raise_if_interrupted(self) -> None:
        if self._signal_exit is not None:
            raise RunnerError("backup interrupted", self._signal_exit)

    def _is_sunday(self) -> bool:
        try:
            return self.clock().astimezone(ZoneInfo("Asia/Tokyo")).weekday() == 6
        except (AttributeError, ValueError):
            return self.clock().weekday() == 6

    def _install_signal_handlers(self) -> None:
        for number, code in ((signal.SIGTERM, EXIT_SIGTERM), (signal.SIGINT, EXIT_SIGINT)):
            self._old_signal_handlers[number] = signal.getsignal(number)

            def handler(
                _signum: int,
                _frame: object,
                *,
                _code: int = code,
            ) -> None:
                self._signal_exit = _code
                terminate = getattr(self.commands, "terminate_active", None)
                if terminate is not None:
                    terminate()

            signal.signal(number, handler)

    def _restore_signal_handlers(self) -> None:
        for number, previous in self._old_signal_handlers.items():
            signal.signal(number, previous)
        self._old_signal_handlers.clear()


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="raspi-google-drive-dr")
    subcommands = parser.add_subparsers(dest="command", required=True)
    subcommands.add_parser("capacity")
    subcommands.add_parser("backup")
    restore = subcommands.add_parser("restore-check")
    restore.add_argument("--target", type=Path, required=True)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        config = RunnerConfig.from_env()
        runner = Runner(config)
        return runner.execute(args.command, target=getattr(args, "target", None))
    except RunnerError as error:
        emit("failed", exit_code=error.exit_code)
        return error.exit_code
    except (OSError, ValueError):
        emit("failed", exit_code=EXIT_SNAPSHOT)
        return EXIT_SNAPSHOT


if __name__ == "__main__":
    sys.exit(main())
