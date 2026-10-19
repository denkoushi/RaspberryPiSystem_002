from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from google_drive_dr.command_port import CommandError, CommandResult
from google_drive_dr.restic_repository import (
    DEFAULT_REPOSITORY,
    ResticMaintenanceError,
    ResticRepository,
    ResticRepositoryConfig,
    ResticRepositoryError,
)


class FakeCommands:
    def __init__(
        self,
        *,
        fail_operation: str | None = None,
        snapshots_output: bytes | None = None,
        restore_output: bytes | None = None,
    ) -> None:
        self.calls: list[tuple[list[str], dict[str, object]]] = []
        self.fail_operation = fail_operation
        self.snapshots_output = snapshots_output
        self.restore_output = restore_output

    def run(self, argv, *, check=True, stdout=None, input=None, env=None, cwd=None):
        command = [str(item) for item in argv]
        self.calls.append((command, {"env": env, "input": input}))
        if self.fail_operation and self.fail_operation in command:
            if check:
                raise CommandError(command, 1)
            return CommandResult(1)
        if command[0] == "rclone":
            return CommandResult(0, json.dumps({"free": 100 * 1024**3}).encode())
        if "backup" in command:
            return CommandResult(
                0,
                b'{"message_type":"summary","snapshot_id":"abc123","total_bytes_processed":42}\n',
            )
        if "snapshots" in command:
            return CommandResult(
                0,
                self.snapshots_output
                if self.snapshots_output is not None
                else b'[{"id":"resolved-snapshot-id","time":"2026-08-20T12:00:00Z","tags":["business-pi5"]}]',
            )
        if "restore" in command:
            return CommandResult(
                0,
                self.restore_output
                if self.restore_output is not None
                else b'{"message_type":"summary","total_bytes":42}\n',
            )
        return CommandResult(0)

    def terminate_active(self):
        return None


class ResticRepositoryTests(unittest.TestCase):
    def config(self, temporary: str) -> ResticRepositoryConfig:
        return ResticRepositoryConfig(
            repository=DEFAULT_REPOSITORY,
            rclone_config=Path(temporary) / "rclone.conf",
            password_file=Path(temporary) / "restic-password",
        )

    def test_capacity_uses_google_drive_remote_and_reserve(self) -> None:
        commands = FakeCommands()
        with tempfile.TemporaryDirectory() as temporary:
            repository = ResticRepository(self.config(temporary), commands)
            report = repository.remote_capacity(10)
            self.assertEqual(report.free_bytes, 100 * 1024**3)
            self.assertGreaterEqual(report.reserve_bytes, 20 * 1024**3)
            self.assertEqual(commands.calls[0][0], ["rclone", "about", "google-drive:", "--json"])

    def test_backup_order_and_sunday_prune_contract(self) -> None:
        commands = FakeCommands()
        with tempfile.TemporaryDirectory() as temporary:
            repository = ResticRepository(self.config(temporary), commands)
            result = repository.backup((Path(temporary) / "source",), excludes=("**/cache/**",), prune=True)
            self.assertEqual(result.snapshot_id, "abc123")
            operations = [call[0][1] for call in commands.calls if call[0][0] == "restic"]
            self.assertEqual(operations, ["backup", "check", "forget", "prune"])
            backup = next(call for call, _meta in commands.calls if call[1] == "backup")
            self.assertEqual(
                backup,
                [
                    "restic",
                    "backup",
                    "--json",
                    "--quiet",
                    "--group-by",
                    "host,tags",
                    "--tag",
                    "business-pi5",
                    "--exclude",
                    "**/cache/**",
                    str(Path(temporary) / "source"),
                ],
            )
            forget = next(call for call, _meta in commands.calls if call[1] == "forget")
            self.assertIn("--group-by", forget)
            self.assertIn("host,tags", forget)
            self.assertIn("--keep-daily", forget)
            self.assertIn("7", forget)
            self.assertIn("--keep-weekly", forget)
            self.assertIn("5", forget)
            self.assertIn("--keep-monthly", forget)
            self.assertIn("12", forget)

    def test_maintenance_failure_retains_created_snapshot_id(self) -> None:
        commands = FakeCommands(fail_operation="check")
        with tempfile.TemporaryDirectory() as temporary:
            repository = ResticRepository(self.config(temporary), commands)
            with self.assertRaises(ResticMaintenanceError) as caught:
                repository.backup((Path(temporary) / "source",))
            self.assertEqual(caught.exception.result.snapshot_id, "abc123")
            self.assertEqual(caught.exception.operation, "check")

    def test_credentials_are_file_based_and_inline_password_is_removed(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            config = self.config(temporary)
            (config.rclone_config).write_text("[google-drive]\n")
            (config.password_file).write_text("test-only\n")
            os.chmod(config.rclone_config, 0o600)
            os.chmod(config.password_file, 0o600)
            with mock.patch.dict(os.environ, {"RESTIC_PROGRESS_FPS": "10"}, clear=False):
                repository = ResticRepository(config, FakeCommands())
                environment = repository.environment()
            environment["RESTIC_PASSWORD"] = "not-used"
            self.assertEqual(environment["RESTIC_PASSWORD_FILE"], str(config.password_file))
            self.assertNotIn("RESTIC_PROGRESS_FPS", environment)
            with self.assertRaises(ResticRepositoryError):
                repository.validate_credentials()

    def test_restore_requires_new_target(self) -> None:
        commands = FakeCommands()
        with tempfile.TemporaryDirectory() as temporary:
            repository = ResticRepository(self.config(temporary), commands)
            target = Path(temporary) / "target"
            target.mkdir()
            with self.assertRaises(ResticRepositoryError):
                repository.restore_latest(target)

            result = repository.restore_latest(Path(temporary) / "new-target")
            self.assertEqual(result.snapshot_id, "resolved-snapshot-id")
            restic_calls = [call[0] for call in commands.calls if call[0][0] == "restic"]
            self.assertEqual(
                restic_calls,
                [
                    [
                        "restic",
                        "snapshots",
                        "--json",
                        "--tag",
                        "business-pi5",
                    ],
                    [
                        "restic",
                        "restore",
                        "resolved-snapshot-id",
                        "--json",
                        "--quiet",
                        "--target",
                        str(Path(temporary) / "new-target"),
                    ],
                ],
            )

    def test_restore_snapshot_resolution_rejects_empty_or_invalid_candidates(self) -> None:
        cases = (
            (b"[]", "no matching snapshot"),
            (b"not-json", "invalid JSON"),
            (b"{}", "must be an array"),
            (b"[{}]", "invalid snapshot id"),
            (b'[{"id":"","time":"2026-08-20T12:00:00Z"}]', "invalid snapshot id"),
            (b'[{"id":"id"}]', "invalid snapshot time"),
            (b'[{"id":"id","time":"not-time"}]', "invalid snapshot time"),
            (b'[{"id":"id","time":"2026-08-20T12:00:00"}]', "timezone-naive"),
        )
        for output, message in cases:
            with self.subTest(output=output), tempfile.TemporaryDirectory() as temporary:
                commands = FakeCommands(snapshots_output=output)
                repository = ResticRepository(self.config(temporary), commands)
                target = Path(temporary) / "new-target"
                with self.assertRaisesRegex(ResticRepositoryError, message):
                    repository.restore_latest(target)
                self.assertFalse(target.exists())
                restic_calls = [call[0] for call in commands.calls if call[0][0] == "restic"]
                self.assertEqual(len(restic_calls), 1)

    def test_restore_selects_newest_snapshot_across_hosts(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            commands = FakeCommands(
                snapshots_output=(
                    b'['
                    b'{"id":"old-pi","time":"2026-08-20T12:00:00+09:00","hostname":"old-pi"},'
                    b'{"id":"new-pi","time":"2026-08-20T04:00:01Z","hostname":"replacement-pi"}'
                    b']'
                )
            )
            repository = ResticRepository(self.config(temporary), commands)

            result = repository.restore_latest(Path(temporary) / "restore")

            self.assertEqual(result.snapshot_id, "new-pi")

    def test_restore_tie_breaks_by_snapshot_id(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            commands = FakeCommands(
                snapshots_output=(
                    b'['
                    b'{"id":"snapshot-a","time":"2026-08-20T12:00:00Z"},'
                    b'{"id":"snapshot-b","time":"2026-08-20T12:00:00+00:00"}'
                    b']'
                )
            )
            repository = ResticRepository(self.config(temporary), commands)

            result = repository.restore_latest(Path(temporary) / "restore")

            self.assertEqual(result.snapshot_id, "snapshot-b")

    def test_restore_uses_resolved_id_when_summary_omits_snapshot_id(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            commands = FakeCommands(
                restore_output=b'{"message_type":"summary","total_bytes":99}\n'
            )
            repository = ResticRepository(self.config(temporary), commands)

            result = repository.restore_latest(Path(temporary) / "restore")

            self.assertEqual(result.snapshot_id, "resolved-snapshot-id")
            self.assertEqual(result.bytes_restored, 99)

    def test_wrong_remote_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            ResticRepositoryConfig(repository="rclone:drive:wrong/path")


if __name__ == "__main__":
    unittest.main()
