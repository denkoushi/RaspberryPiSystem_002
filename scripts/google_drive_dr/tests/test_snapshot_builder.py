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

from google_drive_dr.command_port import CommandResult, SubprocessCommandPort
from google_drive_dr.snapshot_builder import SnapshotBuilder, SnapshotError

SHA = "0123456789abcdef0123456789abcdef01234567"


class FakeCommands:
    def __init__(self, *, dirty: bool = True) -> None:
        self.calls: list[list[str]] = []
        self.dirty = dirty

    def run(self, argv, *, check=True, stdout=None, input=None, env=None, cwd=None):
        command = [str(item) for item in argv]
        self.calls.append(command)
        if command[:2] == ["git", "-C"] and command[-2:] == ["rev-parse", "HEAD"]:
            return CommandResult(0, f"{SHA}\n".encode())
        if command[:2] == ["git", "-C"] and "status" in command:
            return CommandResult(0, b" M apps/api/src/main.ts\n" if self.dirty else b"")
        if "pg_dump" in command:
            assert stdout is not None
            stdout.write(b"PGDMP\x01test-dump")
            return CommandResult(0)
        if "bundle" in command and "create" in command:
            destination = Path(command[command.index("create") + 1])
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(b"# v2 git bundle\n")
            return CommandResult(0)
        return CommandResult(0)

    def terminate_active(self):
        return None


class SnapshotBuilderTests(unittest.TestCase):
    def test_build_orders_native_dump_git_bundle_and_manifest(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "project"
            (root / "config").mkdir(parents=True)
            (root / "config/backup.json").write_text("{}\n")
            (root / "storage/photos").mkdir(parents=True)
            (root / "storage/photos/primary.jpg").write_bytes(b"image")
            staging = Path(temporary) / "staging"
            commands = FakeCommands(dirty=True)
            builder = SnapshotBuilder(
                commands,
                project_root=root,
                staging_root=staging,
                compose_file=root / "compose.yml",
            )

            artifact = builder.build()

            self.assertTrue(artifact.database_dump.read_bytes().startswith(b"PGDMP"))
            self.assertTrue(artifact.git_bundle.is_file())
            manifest = json.loads(artifact.manifest.read_text())
            self.assertEqual(manifest["role"], "business-pi5")
            self.assertEqual(manifest["repositorySha"], SHA)
            self.assertTrue(manifest["worktreeDirty"])
            self.assertEqual(manifest["database"]["options"], ["-Fc", "--no-owner", "--no-acl"])
            self.assertNotIn("apps/api/src/main.ts", artifact.manifest.read_text())

            dump_index = next(index for index, call in enumerate(commands.calls) if "pg_dump" in call)
            bundle_index = next(index for index, call in enumerate(commands.calls) if "bundle" in call and "create" in call)
            verify_index = next(
                index
                for index, call in enumerate(commands.calls)
                if call[0:2] == ["git", "-C"] and call[-3:-1] == ["bundle", "verify"]
            )
            self.assertLess(dump_index, bundle_index)
            self.assertLess(bundle_index, verify_index)
            dump_call = commands.calls[dump_index]
            self.assertIn("-Fc", dump_call)
            self.assertIn("--no-owner", dump_call)
            self.assertIn("--no-acl", dump_call)
            self.assertEqual(
                commands.calls[verify_index],
                ["git", "-C", str(root.absolute()), "bundle", "verify", commands.calls[verify_index][-1]],
            )

            builder.discard_staging(artifact.staging_dir)
            self.assertFalse(artifact.staging_dir.exists())

    def test_git_clean_state_is_not_reported_as_warning(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "config").mkdir()
            (root / "config/backup.json").write_text("{}\n")
            commands = FakeCommands(dirty=False)
            artifact = SnapshotBuilder(commands, project_root=root, staging_root=root / "staging").build()
            manifest = json.loads(artifact.manifest.read_text())
            self.assertFalse(manifest["worktreeDirty"])
            self.assertIsNone(manifest["warning"])

    def test_stale_cleanup_only_removes_owned_stage(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "config").mkdir()
            (root / "config/backup.json").write_text("{}\n")
            staging = root / "staging"
            builder = SnapshotBuilder(FakeCommands(), project_root=root, staging_root=staging)
            owned = builder.create_staging()
            foreign = staging / "foreign"
            foreign.mkdir(parents=True)
            os.utime(owned, (0, 0))
            os.utime(foreign, (0, 0))

            self.assertEqual(builder.cleanup_stale_staging(older_than_seconds=1), 1)
            self.assertFalse(owned.exists())
            self.assertTrue(foreign.exists())

    def test_empty_database_dump_is_rejected_and_stage_is_removed(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "config").mkdir()
            (root / "config/backup.json").write_text("{}\n")

            class EmptyDump(FakeCommands):
                def run(self, argv, **kwargs):
                    if "pg_dump" in argv:
                        self.calls.append([str(item) for item in argv])
                        return CommandResult(0)
                    return super().run(argv, **kwargs)

            staging = root / "staging"
            with self.assertRaises(SnapshotError):
                SnapshotBuilder(EmptyDump(), project_root=root, staging_root=staging).build()
            self.assertEqual(tuple(staging.iterdir()), ())

    @unittest.skipUnless(shutil.which("git"), "git is required for bundle integration")
    def test_git_bundle_verify_works_from_non_git_working_directory(self) -> None:
        """The service working directory need not be the source checkout."""

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

            bundle = root / "staging" / "repository.bundle"
            non_git_cwd = root / "service-working-directory"
            non_git_cwd.mkdir()
            previous_cwd = Path.cwd()
            try:
                os.chdir(non_git_cwd)
                SnapshotBuilder(
                    SubprocessCommandPort(),
                    project_root=project,
                    staging_root=root / "unused-staging",
                )._create_git_bundle(bundle)
            finally:
                os.chdir(previous_cwd)

            self.assertTrue(bundle.is_file())


if __name__ == "__main__":
    unittest.main()
