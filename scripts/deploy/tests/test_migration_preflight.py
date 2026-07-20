#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from scripts.deploy.rolling_release import migration_preflight


RUN_ID = "20260718-120000-a1b2c3"
SHA = "a" * 40


class MigrationPreflightTest(unittest.TestCase):
    def spec(self, project: Path) -> dict[str, object]:
        return {
            "version": 1,
            "project": str(project),
            "runId": RUN_ID,
            "branch": "feat/safe-migration",
            "sha": SHA,
            "expectedServerClientId": "raspberrypi5-server",
        }

    def test_contract_rejects_unknown_fields_and_unsafe_refs(self):
        with tempfile.TemporaryDirectory() as temporary:
            valid = self.spec(Path(temporary).resolve())
            self.assertEqual(
                migration_preflight.parse_spec(json.dumps(valid))["sha"], SHA
            )
            unknown = {**valid, "skip": True}
            with self.assertRaises(migration_preflight.MigrationPreflightConfigError):
                migration_preflight.parse_spec(json.dumps(unknown))
            unsafe = {**valid, "branch": "feat/ok;touch /tmp/no"}
            with self.assertRaises(migration_preflight.MigrationPreflightConfigError):
                migration_preflight.parse_spec(json.dumps(unsafe))

    def test_planner_failure_returns_config_without_checkout_or_migration(self):
        with tempfile.TemporaryDirectory() as temporary:
            project = Path(temporary).resolve()
            (project / "logs/deploy").mkdir(parents=True)
            calls: list[tuple[str, ...]] = []

            def run(argv, **_options):
                command = tuple(argv)
                calls.append(command)
                if "pi5-migration-plan.sh" in command[0]:
                    return SimpleNamespace(returncode=1, stdout="", stderr="disallowed SQL")
                return SimpleNamespace(returncode=0, stdout="", stderr="")

            outcome = migration_preflight.execute(
                self.spec(project),
                run_command=run,
                server_client_id_reader=lambda: "raspberrypi5-server",
            )

        self.assertEqual(outcome, migration_preflight.EX_CONFIG)
        flattened = "\n".join(" ".join(command) for command in calls)
        self.assertIn("git fetch --no-tags origin feat/safe-migration", flattened)
        self.assertIn("git cat-file -e", flattened)
        self.assertIn("pi5-migration-plan.sh", flattened)
        self.assertNotIn("checkout", flattened)
        self.assertNotIn("migrate deploy", flattened)

    def test_success_requires_sealed_evidence_and_cleans_temporary_directory(self):
        with tempfile.TemporaryDirectory() as temporary:
            project = Path(temporary).resolve()
            (project / "logs/deploy").mkdir(parents=True)
            created: list[Path] = []

            def run(argv, **_options):
                command = tuple(argv)
                if "pi5-migration-plan.sh" in command[0]:
                    output = Path(command[command.index("--output") + 1])
                    output.write_text('{"sealed":true}\n', encoding="utf-8")
                    created.append(output.parent)
                return SimpleNamespace(returncode=0, stdout="", stderr="")

            outcome = migration_preflight.execute(
                self.spec(project),
                run_command=run,
                server_client_id_reader=lambda: "raspberrypi5-server",
            )

            self.assertEqual(outcome, migration_preflight.EX_OK)
            self.assertTrue(created)
            self.assertTrue(all(not path.exists() for path in created))

    def test_busy_fleet_lock_stops_before_fetch(self):
        with tempfile.TemporaryDirectory() as temporary:
            project = Path(temporary).resolve()
            lock = project / "logs/deploy/fleet-release-state.lock"
            lock.parent.mkdir(parents=True)
            descriptor = os.open(lock, os.O_WRONLY | os.O_CREAT, 0o600)
            calls: list[object] = []
            try:
                import fcntl

                fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
                outcome = migration_preflight.execute(
                    self.spec(project),
                    run_command=lambda *args, **kwargs: calls.append((args, kwargs)),
                    server_client_id_reader=lambda: "raspberrypi5-server",
                )
            finally:
                os.close(descriptor)

        self.assertEqual(outcome, migration_preflight.EX_TEMPFAIL)
        self.assertEqual(calls, [])


if __name__ == "__main__":
    unittest.main()
