#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import subprocess
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
            "version": 2,
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
                due_management_password_reader=lambda: True,
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
                due_management_password_reader=lambda: True,
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
                    due_management_password_reader=lambda: True,
                )
            finally:
                os.close(descriptor)

        self.assertEqual(outcome, migration_preflight.EX_TEMPFAIL)
        self.assertEqual(calls, [])

    def test_candidate_fetch_timeout_is_retried_with_a_finite_timeout(self):
        with tempfile.TemporaryDirectory() as temporary:
            project = Path(temporary).resolve()
            (project / "logs/deploy").mkdir(parents=True)
            fetch_timeouts: list[int | None] = []
            sleeps: list[float] = []

            def run(argv, **options):
                command = tuple(argv)
                if command[1:3] == ("fetch", "--no-tags"):
                    fetch_timeouts.append(options.get("timeout"))
                    if len(fetch_timeouts) == 1:
                        raise subprocess.TimeoutExpired(command, options["timeout"])
                if "pi5-migration-plan.sh" in command[0]:
                    output = Path(command[command.index("--output") + 1])
                    output.write_text('{"sealed":true}\n', encoding="utf-8")
                return SimpleNamespace(returncode=0, stdout="", stderr="")

            outcome = migration_preflight.execute(
                self.spec(project),
                run_command=run,
                server_client_id_reader=lambda: "raspberrypi5-server",
                due_management_password_reader=lambda: True,
                sleep=sleeps.append,
            )

        self.assertEqual(outcome, migration_preflight.EX_OK)
        self.assertEqual(
            fetch_timeouts,
            [
                migration_preflight.GIT_FETCH_TIMEOUT_SECONDS,
                migration_preflight.GIT_FETCH_TIMEOUT_SECONDS,
            ],
        )
        self.assertEqual(sleeps, [migration_preflight.GIT_FETCH_RETRY_DELAY_SECONDS])

    def test_candidate_fetch_exhaustion_fails_closed_before_candidate_inspection(self):
        with tempfile.TemporaryDirectory() as temporary:
            project = Path(temporary).resolve()
            (project / "logs/deploy").mkdir(parents=True)
            calls: list[tuple[str, ...]] = []

            def run(argv, **_options):
                command = tuple(argv)
                calls.append(command)
                return SimpleNamespace(
                    returncode=1 if command[1:3] == ("fetch", "--no-tags") else 0,
                    stdout="",
                    stderr="network unavailable",
                )

            outcome = migration_preflight.execute(
                self.spec(project),
                run_command=run,
                server_client_id_reader=lambda: "raspberrypi5-server",
                due_management_password_reader=lambda: True,
                sleep=lambda _seconds: None,
            )

        self.assertEqual(outcome, migration_preflight.EX_SOFTWARE)
        self.assertEqual(
            sum(command[1:3] == ("fetch", "--no-tags") for command in calls),
            migration_preflight.GIT_FETCH_ATTEMPTS,
        )
        self.assertFalse(any(command[1:3] == ("cat-file", "-e") for command in calls))

    def test_missing_due_management_password_stops_before_checkout_or_fetch(self):
        with tempfile.TemporaryDirectory() as temporary:
            project = Path(temporary).resolve()
            (project / "logs/deploy").mkdir(parents=True)
            calls: list[tuple[str, ...]] = []

            outcome = migration_preflight.execute(
                self.spec(project),
                run_command=lambda argv, **_options: calls.append(tuple(argv)),
                server_client_id_reader=lambda: "raspberrypi5-server",
                due_management_password_reader=lambda: False,
            )

        self.assertEqual(outcome, migration_preflight.EX_CONFIG)
        self.assertEqual(calls, [])

    def test_due_management_readiness_failure_is_incomplete(self):
        with tempfile.TemporaryDirectory() as temporary:
            project = Path(temporary).resolve()
            (project / "logs/deploy").mkdir(parents=True)

            def unavailable() -> bool:
                raise RuntimeError("database unavailable")

            outcome = migration_preflight.execute(
                self.spec(project),
                run_command=lambda *_args, **_options: None,
                server_client_id_reader=lambda: "raspberrypi5-server",
                due_management_password_reader=unavailable,
            )

        self.assertEqual(outcome, migration_preflight.EX_TEMPFAIL)


if __name__ == "__main__":
    unittest.main()
