#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from infrastructure.ansible.callback_plugins.rolling_release_timing import CallbackModule
from scripts.deploy.rolling_release import telemetry
from scripts.deploy.rolling_release.coordinator import _collect_ansible_timing, _measure_phase


class TimingCollectionTest(unittest.TestCase):
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

    def test_phase_measurement_and_collection_fail_closed_from_telemetry(self):
        class State:
            payload = {}

        class Runtime:
            @staticmethod
            def utc_now():
                return "2026-07-20T00:00:00Z"

            @staticmethod
            def collect_ansible_timing(_run_id):
                raise ValueError("malformed timing")

        state = State()
        with _measure_phase(state, Runtime(), "terminal-ready-ack", host="stonebase"):
            pass
        _collect_ansible_timing(state, Runtime(), "run-123")

        phase = state.payload["telemetry"]["phases"][0]
        self.assertEqual(phase["name"], "terminal-ready-ack")
        self.assertEqual(phase["outcome"], "success")
        self.assertEqual(state.payload["telemetry"]["ansible"], {"state": "unavailable", "error": "ValueError"})


if __name__ == "__main__":
    unittest.main()
