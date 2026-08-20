from __future__ import annotations

import contextlib
import io
import json
import signal
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from google_drive_dr.command_port import CommandError, CommandResult
from google_drive_dr.restic_repository import (
    BackupResult,
    CapacityReport,
    ResticMaintenanceError,
    ResticRepositoryError,
    RestoreResult,
)
from google_drive_dr.restore_validator import RestoreValidator
from google_drive_dr.runner import (
    EXIT_CAPACITY,
    Runner,
    RunnerConfig,
    RunnerError,
)


class FakeRepository:
    def __init__(self) -> None:
        self.required_bytes: int | None = None

    def validate_credentials(self):
        return None

    def remote_capacity(self, required_bytes):
        self.required_bytes = required_bytes
        return CapacityReport(100 * 1024**3, required_bytes, 20 * 1024**3)


class BackupRepository:
    def __init__(self, *, exists: bool, free_bytes: int) -> None:
        self.exists = exists
        self.free_bytes = free_bytes
        self.repository_exists_calls = 0
        self.capacity_requests: list[int] = []
        self.init_calls = 0

    def validate_credentials(self):
        return None

    def repository_exists(self):
        self.repository_exists_calls += 1
        return self.exists

    def remote_capacity(self, required_bytes):
        self.capacity_requests.append(required_bytes)
        report = CapacityReport(self.free_bytes, required_bytes, 0)
        if not report.sufficient:
            raise ResticRepositoryError("test capacity gate")
        return report

    def init(self):
        self.init_calls += 1

    def backup(self, _paths, *, excludes=(), prune=False):
        return BackupResult(snapshot_id="abc123", bytes_processed=123)


class RecordingCommands:
    def __init__(self, *, fail_host_pg_restore: bool = False) -> None:
        self.calls: list[tuple[list[str], dict[str, object]]] = []
        self.fail_host_pg_restore = fail_host_pg_restore
        self.terminated = False

    def run(self, argv, **kwargs):
        command = [str(item) for item in argv]
        self.calls.append((command, kwargs))
        if self.fail_host_pg_restore and command[0] == "pg_restore":
            raise CommandError(command, 127)
        return CommandResult(0)

    def terminate_active(self):
        self.terminated = True


class RunnerTests(unittest.TestCase):
    def test_capacity_does_not_require_full_primary_data_in_local_staging(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "project"
            (root / "config").mkdir(parents=True)
            (root / "config/backup.json").write_text("{}\n")
            photos = root / "storage/photos"
            photos.mkdir(parents=True)
            with (photos / "large-primary.bin").open("wb") as output:
                output.truncate(5 * 1024**3)
            config = RunnerConfig(
                project_root=root,
                staging_root=Path(temporary) / "staging",
                credential_root=Path(temporary) / "credentials",
                compose_file=root / "compose.yml",
                lock_file=Path(temporary) / "lock",
                database_estimate_bytes=128 * 1024**2,
                git_bundle_estimate_bytes=32 * 1024**2,
                manifest_overhead_bytes=4 * 1024**2,
            )
            repository = FakeRepository()
            runner = Runner(config, repository=repository)
            fake_usage = mock.Mock(free=2 * 1024**3)
            with mock.patch("google_drive_dr.runner.shutil.disk_usage", return_value=fake_usage):
                report = runner.capacity()

            self.assertIsNotNone(report)
            self.assertEqual(repository.required_bytes, 5 * 1024**3 + 164 * 1024**2 + 3)

    def test_capacity_auth_failure_happens_before_cloud_read(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "project"
            (root / "config").mkdir(parents=True)
            (root / "config/backup.json").write_text("{}\n")
            repository = mock.Mock()
            repository.validate_credentials.side_effect = ResticRepositoryError("secret password")
            config = RunnerConfig(
                project_root=root,
                staging_root=Path(temporary) / "staging",
                credential_root=Path(temporary) / "credentials",
                compose_file=root / "compose.yml",
                lock_file=Path(temporary) / "lock",
            )
            runner = Runner(config, repository=repository)
            # This fake is intentionally a generic failure: the execute path
            # still emits only a code and never the exception text.
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                code = runner.execute("capacity")
            self.assertEqual(code, EXIT_CAPACITY)
            self.assertNotIn("secret password", output.getvalue())
            repository.remote_capacity.assert_not_called()

    def _backup_artifact(self, root: Path, *, primary_bytes: int) -> tuple[SimpleNamespace, mock.Mock]:
        stage = root / "staging" / "business-pi5-run"
        (stage / "database").mkdir(parents=True)
        (stage / "git").mkdir()
        (stage / "database/app.dump").write_bytes(b"d" * 128)
        (stage / "git/repository.bundle").write_bytes(b"g" * 64)
        (stage / "manifest.json").write_bytes(b"m" * 16)
        artifact = SimpleNamespace(
            staging_dir=stage,
            upload_paths=(stage,),
            total_bytes=primary_bytes + 128 + 64 + 16,
            repository_sha="a" * 40,
        )
        builder = mock.Mock()
        builder.build.return_value = artifact
        builder.policy = SimpleNamespace(
            project_root=root,
            credential_root=root / "credentials",
        )
        return artifact, builder

    def test_existing_repository_capacity_uses_only_new_staging_bytes(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            artifact, builder = self._backup_artifact(root, primary_bytes=5 * 1024**3)
            repository = BackupRepository(exists=True, free_bytes=2 * 1024**3)
            runner = Runner(
                RunnerConfig(
                    project_root=root,
                    staging_root=root / "staging",
                    credential_root=root / "credentials",
                    lock_file=root / "runner.lock",
                ),
                repository=repository,
                builder=builder,
            )

            with mock.patch("google_drive_dr.runner.restic_excludes", return_value=()):
                runner.backup()

            self.assertEqual(repository.repository_exists_calls, 1)
            self.assertEqual(repository.init_calls, 0)
            self.assertEqual(repository.capacity_requests, [208])
            builder.discard_staging.assert_called_once_with(artifact.staging_dir)

    def test_new_repository_capacity_uses_complete_first_snapshot_estimate(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            artifact, builder = self._backup_artifact(root, primary_bytes=5 * 1024**3)
            repository = BackupRepository(exists=False, free_bytes=6 * 1024**3)
            runner = Runner(
                RunnerConfig(
                    project_root=root,
                    staging_root=root / "staging",
                    credential_root=root / "credentials",
                    lock_file=root / "runner.lock",
                ),
                repository=repository,
                builder=builder,
            )

            with mock.patch("google_drive_dr.runner.restic_excludes", return_value=()):
                runner.backup()

            self.assertEqual(repository.repository_exists_calls, 1)
            self.assertEqual(repository.init_calls, 1)
            self.assertEqual(repository.capacity_requests, [artifact.total_bytes])
            builder.discard_staging.assert_called_once_with(artifact.staging_dir)

    def test_event_payload_does_not_contain_paths_or_secret_values(self) -> None:
        config = RunnerConfig()
        runner = Runner(config)
        with mock.patch.object(runner, "capacity", side_effect=RunnerError("db password", 21)):
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                code = runner.execute("capacity")
        event = json.loads(output.getvalue())
        self.assertEqual(code, 21)
        self.assertEqual(event, {"exit_code": 21, "stage": "failed"})
        self.assertNotIn("db password", output.getvalue())

    def test_sigterm_handler_terminates_active_child_with_signal_callback_signature(self) -> None:
        commands = RecordingCommands()
        runner = Runner(RunnerConfig(), commands=commands)
        installed: dict[int, object] = {}

        def record_handler(number, handler):
            installed[number] = handler

        with (
            mock.patch("google_drive_dr.runner.signal.getsignal", return_value=signal.SIG_DFL),
            mock.patch("google_drive_dr.runner.signal.signal", side_effect=record_handler),
        ):
            runner._install_signal_handlers()
            handler = installed[signal.SIGTERM]
            self.assertTrue(callable(handler))
            handler(signal.SIGTERM, None)
            runner._restore_signal_handlers()

        self.assertTrue(commands.terminated)
        self.assertEqual(runner._signal_exit, 143)

    def _run_maintenance_failure(self, operation: str) -> tuple[list[dict[str, object]], mock.Mock, Path]:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            stage = root / "staging/run"
            artifact = SimpleNamespace(
                staging_dir=stage,
                upload_paths=(stage,),
                total_bytes=42,
                repository_sha="a" * 40,
            )
            builder = mock.Mock()
            builder.build.return_value = artifact
            builder.policy = SimpleNamespace(credential_root=root / "credentials")
            repository = mock.Mock()
            repository.repository_exists.return_value = True
            result = BackupResult(snapshot_id="abc123", bytes_processed=42)
            repository.backup.side_effect = ResticMaintenanceError(result, operation)
            runner = Runner(
                RunnerConfig(
                    project_root=root,
                    staging_root=root / "staging",
                    credential_root=root / "credentials",
                    lock_file=root / "runner.lock",
                ),
                repository=repository,
                builder=builder,
            )

            output = io.StringIO()
            with (
                contextlib.redirect_stdout(output),
                self.assertRaises(RunnerError),
            ):
                runner.backup()

            events = [json.loads(line) for line in output.getvalue().splitlines()]
            return events, builder, stage

    def test_check_failure_keeps_marked_stage_for_inspection(self) -> None:
        events, builder, _stage = self._run_maintenance_failure("check")

        self.assertEqual(events[0]["stage"], "backup_snapshot_created")
        self.assertEqual(events[0]["snapshot_id"], "abc123")
        self.assertEqual(events[1]["stage"], "backup_maintenance_failed")
        self.assertEqual(events[1]["snapshot_id"], "abc123")
        builder.discard_staging.assert_not_called()

    def test_forget_failure_discards_stage_after_verified_snapshot(self) -> None:
        events, builder, stage = self._run_maintenance_failure("forget")

        self.assertEqual(events[0]["stage"], "backup_snapshot_created")
        self.assertEqual(events[0]["snapshot_id"], "abc123")
        self.assertEqual(events[1]["stage"], "backup_maintenance_failed")
        self.assertEqual(events[1]["snapshot_id"], "abc123")
        builder.discard_staging.assert_called_once_with(stage)

    def test_prune_failure_discards_stage_after_verified_snapshot(self) -> None:
        events, builder, stage = self._run_maintenance_failure("prune")

        self.assertEqual(events[0]["stage"], "backup_snapshot_created")
        self.assertEqual(events[0]["snapshot_id"], "abc123")
        self.assertEqual(events[1]["stage"], "backup_maintenance_failed")
        self.assertEqual(events[1]["snapshot_id"], "abc123")
        builder.discard_staging.assert_called_once_with(stage)

    def test_restore_validator_is_injected_at_the_runner_boundary(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary) / "restore"
            repository = mock.Mock()
            repository.restore_latest.return_value = RestoreResult("abc123", 42)
            validator = mock.Mock()
            runner = Runner(
                RunnerConfig(lock_file=Path(temporary) / "lock"),
                repository=repository,
                validator=validator,
            )

            result = runner.restore_check(target)

            self.assertEqual(result.snapshot_id, "abc123")
            validator.preflight_target.assert_called_once_with(target)
            validator.validate.assert_called_once_with(target)

    def test_restore_rejects_protected_roots_before_restic(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            config = RunnerConfig(
                project_root=root / "project",
                credential_root=root / "credentials",
                staging_root=root / "staging",
                compose_file=root / "project/compose.yml",
                lock_file=root / "runner.lock",
            )
            for protected in (
                config.project_root,
                config.credential_root,
                config.staging_root,
            ):
                protected.mkdir(parents=True)
            repository = mock.Mock()
            validator = RestoreValidator(
                RecordingCommands(),
                project_root=config.project_root,
                credential_root=config.credential_root,
                staging_root=config.staging_root,
                compose_file=config.compose_file,
            )
            runner = Runner(config, repository=repository, validator=validator)

            for protected in (
                config.project_root,
                config.credential_root,
                config.staging_root,
            ):
                for target in (protected, protected / "nested"):
                    with self.subTest(target=target):
                        with self.assertRaises(RunnerError):
                            runner.restore_check(target)
                        repository.restore_latest.assert_not_called()

    def test_restore_rejects_symlink_parent_to_live_root_before_restic(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            project_root = root / "project"
            credential_root = root / "credentials"
            staging_root = root / "staging"
            project_root.mkdir()
            credential_root.mkdir()
            staging_root.mkdir()
            alias = root / "restore-parent"
            alias.symlink_to(project_root, target_is_directory=True)
            config = RunnerConfig(
                project_root=project_root,
                credential_root=credential_root,
                staging_root=staging_root,
                compose_file=project_root / "compose.yml",
                lock_file=root / "runner.lock",
            )
            repository = mock.Mock()
            validator = RestoreValidator(
                RecordingCommands(),
                project_root=project_root,
                credential_root=credential_root,
                staging_root=staging_root,
                compose_file=config.compose_file,
            )
            runner = Runner(config, repository=repository, validator=validator)

            with self.assertRaises(RunnerError):
                runner.restore_check(alias / "new-restore")

            repository.restore_latest.assert_not_called()

    def test_restore_allows_new_isolated_target_after_preflight(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            config = RunnerConfig(
                project_root=root / "project",
                credential_root=root / "credentials",
                staging_root=root / "staging",
                compose_file=root / "project/compose.yml",
                lock_file=root / "runner.lock",
            )
            for protected in (
                config.project_root,
                config.credential_root,
                config.staging_root,
            ):
                protected.mkdir(parents=True)
            target = root / "var/tmp/restore"
            target.parent.mkdir(parents=True)
            repository = mock.Mock()
            repository.restore_latest.return_value = RestoreResult("abc123", 42)
            policy_validator = RestoreValidator(
                RecordingCommands(),
                project_root=config.project_root,
                credential_root=config.credential_root,
                staging_root=config.staging_root,
                compose_file=config.compose_file,
            )
            validator = mock.Mock()
            validator.preflight_target.side_effect = policy_validator.preflight_target
            runner = Runner(config, repository=repository, validator=validator)

            result = runner.restore_check(target)

            self.assertEqual(result.snapshot_id, "abc123")
            validator.preflight_target.assert_called_once_with(target)
            repository.restore_latest.assert_called_once_with(target)
            validator.validate.assert_called_once_with(target)


if __name__ == "__main__":
    unittest.main()
