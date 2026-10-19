from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from google_drive_dr.command_port import (
    CommandError,
    CommandResult,
    SubprocessCommandPort,
)
from google_drive_dr.restore_validator import RestoreValidationError, RestoreValidator


class RecordingCommands:
    def __init__(self, *, fail_host_pg_restore: bool = False) -> None:
        self.calls: list[tuple[list[str], dict[str, object]]] = []
        self.fail_host_pg_restore = fail_host_pg_restore

    def run(self, argv, **kwargs):
        command = [str(item) for item in argv]
        self.calls.append((command, kwargs))
        if self.fail_host_pg_restore and command[0] == "pg_restore":
            raise CommandError(command, 127)
        return CommandResult(0)

    def terminate_active(self):
        return None


def make_restore_tree(root: Path, *, include_optional: bool = True) -> Path:
    target = root / "restore"
    payload = target / "var/backups/raspi-google-drive-dr-staging/business-pi5-run"
    project = target / "opt/business-pi"
    (payload / "database").mkdir(parents=True)
    (payload / "git").mkdir()
    (project / "config").mkdir(parents=True)
    (project / "storage/photos").mkdir(parents=True)
    (payload / "database/borrow_return.dump").write_bytes(b"PGDMPtest")
    (payload / "git/repository.bundle").write_bytes(b"bundle")
    (payload / ".raspi-google-drive-dr-stage").write_text("business-pi5\n")
    (project / "config/backup.json").write_text("{}\n")
    if include_optional:
        (project / "storage/photos/primary.jpg").write_bytes(b"photo")
    manifest = {
        "schemaVersion": 1,
        "role": "business-pi5",
        "repositorySha": "a" * 40,
        "database": {"dump": "database/borrow_return.dump"},
        "git": {"bundle": "git/repository.bundle"},
        "sources": [
            {"path": "config/backup.json", "required": True},
            {"path": "storage/photos", "required": False},
        ],
    }
    (payload / "manifest.json").write_text(json.dumps(manifest))
    return target


class RestoreValidatorTests(unittest.TestCase):
    def validator(self, commands: RecordingCommands) -> RestoreValidator:
        return RestoreValidator(
            commands,
            project_root=Path("/opt/business-pi"),
            compose_file=Path("/opt/business-pi/compose.yml"),
            staging_root=Path("/var/backups/raspi-google-drive-dr-staging"),
        )

    def test_validate_checks_every_recorded_source_even_when_required_false(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            target = make_restore_tree(root)
            validator = self.validator(RecordingCommands())

            result = validator.validate(target)
            self.assertEqual(result.repository_sha, "a" * 40)
            self.assertEqual(len(result.source_paths), 2)

            (target / "opt/business-pi/storage/photos/primary.jpg").unlink()
            (target / "opt/business-pi/storage/photos").rmdir()
            with self.assertRaises(RestoreValidationError):
                validator.validate(target)

    def test_primary_data_manifest_does_not_collide_with_owned_dr_manifest(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            target = make_restore_tree(root)
            primary_manifest = target / "opt/business-pi/storage/photos/manifest.json"
            primary_manifest.write_text("ordinary business manifest\n")

            result = self.validator(RecordingCommands()).validate(target)

            self.assertTrue(result.manifest_path.parts[-2].startswith("business-pi5-"))
            self.assertNotEqual(result.manifest_path, primary_manifest)

    def test_zero_or_multiple_owned_stages_are_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            target = make_restore_tree(root)
            stage = target / "var/backups/raspi-google-drive-dr-staging/business-pi5-run"
            marker = stage / ".raspi-google-drive-dr-stage"
            validator = self.validator(RecordingCommands())

            marker.unlink()
            with self.assertRaises(RestoreValidationError):
                validator.validate(target)

            marker.write_text("business-pi5\n")
            second = target / "var/backups/raspi-google-drive-dr-staging/business-pi5-second"
            second.mkdir()
            (second / ".raspi-google-drive-dr-stage").write_text("business-pi5\n")
            with self.assertRaises(RestoreValidationError):
                validator.validate(target)

    def test_dump_fallback_streams_a_large_file_without_reading_it_into_memory(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            target = make_restore_tree(root)
            dump = target / (
                "var/backups/raspi-google-drive-dr-staging/business-pi5-run/"
                "database/borrow_return.dump"
            )
            with dump.open("wb") as output:
                output.write(b"PGDMP")
                output.truncate(5 * 1024**3)
            commands = RecordingCommands(fail_host_pg_restore=True)

            self.validator(commands).validate(target)

            self.assertEqual(
                commands.calls[0][0],
                [
                    "git",
                    "-c",
                    "safe.directory=/opt/business-pi",
                    "-C",
                    "/opt/business-pi",
                    "bundle",
                    "verify",
                    str(
                        (
                            target
                            / "var/backups/raspi-google-drive-dr-staging/business-pi5-run"
                            / "git/repository.bundle"
                        ).resolve()
                    ),
                ],
            )
            fallback_command, fallback_kwargs = commands.calls[-1]
            self.assertEqual(
                fallback_command,
                [
                    "docker",
                    "compose",
                    "-f",
                    "/opt/business-pi/compose.yml",
                    "exec",
                    "-T",
                    "db",
                    "pg_restore",
                    "--list",
                ],
            )
            self.assertEqual(Path(fallback_kwargs["input_file"]).resolve(), dump.resolve())
            self.assertIsNone(fallback_kwargs.get("input"))

    def test_invalid_dump_header_fails_before_host_or_docker_validation(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            target = make_restore_tree(root)
            dump = target / (
                "var/backups/raspi-google-drive-dr-staging/business-pi5-run/"
                "database/borrow_return.dump"
            )
            dump.write_bytes(b"not-a-custom-format-dump")
            commands = RecordingCommands(fail_host_pg_restore=True)

            with self.assertRaisesRegex(RestoreValidationError, "custom format"):
                self.validator(commands).validate(target)

            self.assertEqual(len(commands.calls), 1)
            self.assertEqual(commands.calls[0][0][0], "git")

    def test_manifest_artifact_traversal_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            target = make_restore_tree(root)
            manifest_path = target / (
                "var/backups/raspi-google-drive-dr-staging/business-pi5-run/manifest.json"
            )
            payload = json.loads(manifest_path.read_text())
            payload["database"]["dump"] = "../../outside.dump"
            manifest_path.write_text(json.dumps(payload))

            with self.assertRaises(RestoreValidationError):
                self.validator(RecordingCommands()).validate(target)

    def test_excluded_credentials_and_escaping_symlink_are_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            target = make_restore_tree(root)
            (target / "opt/business-pi/rclone.conf").write_text("oauth")
            with self.assertRaises(RestoreValidationError):
                self.validator(RecordingCommands()).validate(target)

            (target / "opt/business-pi/rclone.conf").unlink()
            outside = root / "outside"
            outside.write_text("outside")
            (target / "opt/business-pi/escape").symlink_to(outside)
            with self.assertRaises(RestoreValidationError):
                self.validator(RecordingCommands()).validate(target)

    @unittest.skipUnless(shutil.which("git"), "git is required for bundle integration")
    def test_git_bundle_verify_works_from_non_git_working_directory(self) -> None:
        """Restore-check verifies bundles from the configured source checkout."""

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            project = root / "project"
            project.mkdir()
            subprocess.run(
                ["git", "-C", str(project), "init", "--quiet"],
                check=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            subprocess.run(
                ["git", "-C", str(project), "config", "user.email", "dr-test@example.invalid"],
                check=True,
            )
            subprocess.run(
                ["git", "-C", str(project), "config", "user.name", "DR test"],
                check=True,
            )
            (project / "README").write_text("bundle fixture\n")
            subprocess.run(["git", "-C", str(project), "add", "README"], check=True)
            subprocess.run(
                ["git", "-C", str(project), "commit", "--quiet", "-m", "fixture"],
                check=True,
                stdout=subprocess.DEVNULL,
            )
            bundle = root / "repository.bundle"
            subprocess.run(
                ["git", "-C", str(project), "bundle", "create", str(bundle), "HEAD"],
                check=True,
                stdout=subprocess.DEVNULL,
            )

            non_git_cwd = root / "service-working-directory"
            non_git_cwd.mkdir()
            previous_cwd = Path.cwd()
            try:
                os.chdir(non_git_cwd)
                RestoreValidator(
                    SubprocessCommandPort(),
                    project_root=project,
                    compose_file=project / "compose.yml",
                    staging_root=root / "staging",
                )._verify_git_bundle(bundle)
            finally:
                os.chdir(previous_cwd)


if __name__ == "__main__":
    unittest.main()
