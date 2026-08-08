#!/usr/bin/env python3
from __future__ import annotations

import json
import importlib.util
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from infrastructure.ansible.callback_plugins.rolling_release_timing import CallbackModule
from scripts.deploy.rolling_release import telemetry


class TimingCollectionTest(unittest.TestCase):
    def test_diagnostic_operation_registry_matches_the_helper(self):
        helper_path = (
            Path(__file__).resolve().parents[1] / "terminal-source-bundle.py"
        )
        spec = importlib.util.spec_from_file_location(
            "terminal_source_bundle_diagnostic_contract", helper_path
        )
        self.assertIsNotNone(spec)
        self.assertIsNotNone(spec.loader)
        helper = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(helper)
        self.assertEqual(
            telemetry.safe_diagnostics.REGISTERED_GIT_OPERATIONS,
            frozenset(helper.GIT_OPERATIONS),
        )

    def test_callback_records_outcomes_without_result_payloads(self):
        class Host:
            @staticmethod
            def get_name():
                return "stonebase"

        class Play:
            @staticmethod
            def get_name():
                return "deploy"

        class Parent:
            _play = Play()

        class Task:
            _parent = Parent()

            def __init__(self, task_uuid, name):
                self._uuid = task_uuid
                self._name = name

            def get_name(self):
                return self._name

        class Result:
            _host = Host()

            def __init__(self, task, *, changed=False):
                self._task = task
                self._result = {
                    "changed": changed,
                    "stdout": "must-not-be-recorded",
                    "invocation": {"secret": "must-not-be-recorded"},
                }

        with tempfile.TemporaryDirectory() as directory:
            raw = Path(directory) / "timing.jsonl"
            environment = {
                "RUN_ID": "run-123",
                "ROLLING_RELEASE_TIMING_SCOPE": "terminal-apply",
                "ROLLING_RELEASE_TIMING_HOST": "stonebase",
                "ROLLING_RELEASE_TIMING_PATH": str(raw),
            }
            with mock.patch.dict(os.environ, environment, clear=False):
                callback = CallbackModule()
                invocations = (
                    ("ok", callback.v2_runner_on_ok, False),
                    ("changed", callback.v2_runner_on_ok, True),
                    ("skipped", callback.v2_runner_on_skipped, False),
                    ("failed", callback.v2_runner_on_failed, False),
                    ("unreachable", callback.v2_runner_on_unreachable, False),
                )
                for index, (_outcome, handler, changed) in enumerate(invocations):
                    task = Task(str(index), f"task-{index}")
                    result = Result(task, changed=changed)
                    callback.v2_runner_on_start(result._host, task)
                    handler(result)

            content = raw.read_text(encoding="utf-8")
            events = [json.loads(line) for line in content.splitlines()]

        self.assertEqual(
            [event["outcome"] for event in events],
            ["ok", "changed", "skipped", "failed", "unreachable"],
        )
        self.assertNotIn("must-not-be-recorded", content)
        self.assertTrue(all(set(event) == {
            "schemaVersion", "runId", "scope", "host", "play", "task",
            "outcome", "startedAt", "endedAt", "durationMs",
        } for event in events))

    def test_registered_failure_diagnostic_is_bound_and_raw_result_is_discarded(self):
        class Host:
            @staticmethod
            def get_name():
                return "raspberrypi3"

        class Play:
            @staticmethod
            def get_name():
                return "deploy signage"

        class Parent:
            _play = Play()

        class Task:
            _parent = Parent()
            _uuid = "task-uuid"

            @staticmethod
            def get_name():
                return "Import and reset Pi3 repository from the verified local bundle"

        class Result:
            _host = Host()
            _task = Task()
            _result = {
                "stderr": (
                    "terminal source bundle failed: local bundle Git operation failed "
                    "(operation=repository-reset, rc=128, stderr=Permission denied)"
                ),
                "stdout": "https://operator:secret@example.invalid/private.git",
                "invocation": {"module_args": {"token": "ghp_must_not_persist"}},
            }

        with tempfile.TemporaryDirectory() as directory:
            raw = Path(directory) / "timing.jsonl"
            environment = {
                "RUN_ID": "run-123",
                "ROLLING_RELEASE_TIMING_SCOPE": "terminal-apply",
                "ROLLING_RELEASE_TIMING_HOST": "raspberrypi3",
                "ROLLING_RELEASE_TIMING_PATH": str(raw),
            }
            with mock.patch.dict(os.environ, environment, clear=False):
                callback = CallbackModule()
                callback.v2_runner_on_start(Result._host, Result._task)
                callback.v2_runner_on_failed(Result())
            content = raw.read_text(encoding="utf-8")
            event = json.loads(content)

        self.assertEqual(event["runId"], "run-123")
        self.assertEqual(event["host"], "raspberrypi3")
        self.assertEqual(event["task"], Task.get_name())
        self.assertEqual(
            event["diagnostic"],
            {
                "kind": "registered-operation",
                "operation": "repository-reset",
                "rc": 128,
                "stderr": "Permission denied",
            },
        )
        for forbidden in ("operator", "secret", "private.git", "ghp_must_not_persist", "module_args"):
            self.assertNotIn(forbidden, content)

    def test_malformed_diagnostic_falls_back_to_generic_and_foreign_host_is_rejected(self):
        class Host:
            def __init__(self, name):
                self._name = name

            def get_name(self):
                return self._name

        class Play:
            @staticmethod
            def get_name():
                return "deploy signage"

        class Parent:
            _play = Play()

        class Task:
            _parent = Parent()
            _uuid = "task-uuid"

            @staticmethod
            def get_name():
                return "Import and reset Pi3 repository from the verified local bundle"

        class Result:
            _task = Task()

            def __init__(self, host):
                self._host = host
                self._result = {
                    "stderr": (
                        "local bundle Git operation failed "
                        "(operation=not-registered, rc=9999, "
                        "stderr=https://secret.example.invalid/token)"
                    )
                }

        with tempfile.TemporaryDirectory() as directory:
            raw = Path(directory) / "timing.jsonl"
            environment = {
                "RUN_ID": "run-123",
                "ROLLING_RELEASE_TIMING_SCOPE": "terminal-apply",
                "ROLLING_RELEASE_TIMING_HOST": "raspberrypi3",
                "ROLLING_RELEASE_TIMING_PATH": str(raw),
            }
            with mock.patch.dict(os.environ, environment, clear=False):
                callback = CallbackModule()
                expected = Host("raspberrypi3")
                callback.v2_runner_on_start(expected, Result._task)
                callback.v2_runner_on_failed(Result(expected))
            content = raw.read_text(encoding="utf-8")
            event = json.loads(content)
            self.assertEqual(
                event["diagnostic"],
                {"kind": "generic", "code": "malformed-safe-diagnostic"},
            )
            self.assertNotIn("secret.example.invalid", content)

            raw.unlink()
            with mock.patch.dict(os.environ, environment, clear=False):
                callback = CallbackModule()
                foreign = Host("other-host")
                callback.v2_runner_on_start(foreign, Result._task)
                callback.v2_runner_on_failed(Result(foreign))
            self.assertFalse(raw.exists())

    def test_collects_and_sorts_secret_free_task_summary(self):
        with tempfile.TemporaryDirectory() as directory:
            project = Path(directory)
            raw, summary = telemetry.paths(project, "run-123")
            raw.parent.mkdir(parents=True)
            raw.write_text(
                "\n".join(
                    json.dumps(event)
                    for event in (
                        {
                            "schemaVersion": 1, "runId": "run-123", "scope": "terminal-apply",
                            "host": "stonebase", "play": "deploy", "task": "slow", "outcome": "skipped", "startedAt": "2026-07-20T00:00:00Z", "endedAt": "2026-07-20T00:00:01Z", "durationMs": 900,
                        },
                        {
                            "schemaVersion": 1, "runId": "run-123", "scope": "terminal-apply",
                            "host": "stonebase", "play": "deploy", "task": "slow", "outcome": "ok", "startedAt": "2026-07-20T00:00:01Z", "endedAt": "2026-07-20T00:00:02Z", "durationMs": 100,
                        },
                        {
                            "schemaVersion": 1, "runId": "run-123", "scope": "server-config",
                            "host": "pi5", "play": "config", "task": "fast", "outcome": "changed", "startedAt": "2026-07-20T00:00:02Z", "endedAt": "2026-07-20T00:00:03Z", "durationMs": 30,
                        },
                    )
                ) + "\n",
                encoding="utf-8",
            )
            collected = telemetry.collect(project, "run-123")

            self.assertEqual(collected["state"], "collected")
            self.assertEqual(collected["eventCount"], 3)
            self.assertEqual(collected["slowTasks"][0]["task"], "slow")
            self.assertEqual(collected["slowTasks"][0]["durationMs"], 1000)
            self.assertEqual(collected["slowTasks"][0]["outcomes"], {"skipped": 1, "ok": 1})
            self.assertTrue(summary.is_file())

    def test_collect_projects_only_schema_valid_bound_diagnostics(self):
        with tempfile.TemporaryDirectory() as directory:
            project = Path(directory)
            raw, _summary = telemetry.paths(project, "run-123")
            raw.parent.mkdir(parents=True)
            event = {
                "schemaVersion": 1,
                "runId": "run-123",
                "scope": "terminal-apply",
                "host": "raspberrypi3",
                "play": "deploy signage",
                "task": "Import and reset Pi3 repository from the verified local bundle",
                "outcome": "failed",
                "startedAt": "2026-08-05T00:00:00Z",
                "endedAt": "2026-08-05T00:00:01Z",
                "durationMs": 1000,
                "diagnostic": {
                    "kind": "registered-operation",
                    "operation": "repository-reset",
                    "rc": 128,
                    "stderr": "Permission denied",
                },
            }
            raw.write_text(json.dumps(event) + "\n", encoding="utf-8")
            collected = telemetry.collect(project, "run-123")

        self.assertEqual(
            collected["diagnostics"],
            [{
                "runId": "run-123",
                "scope": "terminal-apply",
                "host": "raspberrypi3",
                "play": "deploy signage",
                "task": event["task"],
                "kind": "registered-operation",
                "operation": "repository-reset",
                "rc": 128,
                "stderr": "Permission denied",
            }],
        )

    def test_rejects_invalid_or_foreign_event_without_summary(self):
        with tempfile.TemporaryDirectory() as directory:
            project = Path(directory)
            raw, summary = telemetry.paths(project, "run-123")
            raw.parent.mkdir(parents=True)
            raw.write_text('{"schemaVersion":1,"runId":"foreign"}\n', encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "schema"):
                telemetry.collect(project, "run-123")
            self.assertFalse(summary.exists())

    def test_environment_has_no_target_selection_or_secret_values(self):
        environment = telemetry.environment(Path("/project"), "run-123", "stonebase", "terminal-apply")
        self.assertEqual(environment["ROLLING_RELEASE_TIMING_SCOPE"], "terminal-apply")
        self.assertEqual(environment["ROLLING_RELEASE_TIMING_HOST"], "stonebase")
        self.assertNotIn("ANSIBLE_INVENTORY", environment)

    def test_paths_reject_path_traversal_run_id(self):
        with self.assertRaisesRegex(ValueError, "malformed"):
            telemetry.paths(Path("/project"), "../../fjv")


if __name__ == "__main__":
    unittest.main()
