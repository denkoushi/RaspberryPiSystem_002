from __future__ import annotations

import json
import os
import stat
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from scripts.deploy.rolling_release import pi5_performance


def event(
    run_id: str,
    phase: str,
    duration_ms: int,
    *,
    outcome: str = "success",
    status: int | None = 200,
) -> dict[str, object]:
    return {
        "schemaVersion": 1,
        "runId": run_id,
        "timestamp": "2026-07-26T00:00:00.000Z",
        "phase": phase,
        "trigger": "periodic",
        "api": {
            "outcome": outcome,
            "status": status,
            "durationMs": duration_ms,
        },
        "resources": {
            "load1": 1.5,
            "memoryAvailableMb": 2048.0,
            "cpuPressureAvg10": 0.2,
            "ioPressureAvg10": 0.3,
        },
    }


class Pi5PerformanceTest(unittest.TestCase):
    def test_sample_is_fixed_schema_and_discards_probe_details(self) -> None:
        sample = pi5_performance.sample_event(
            "run-123",
            "pi5-candidate-build",
            "phase-start",
            clock=lambda: "now",
            health_probe=lambda: {
                "outcome": "success",
                "status": 200,
                "durationMs": 12,
                "body": {"secret": "must-not-be-recorded"},
                "url": "must-not-be-recorded",
            },
            resource_reader=lambda: {
                "load1": 1,
                "memoryAvailableMb": 2,
                "cpuPressureAvg10": None,
                "ioPressureAvg10": 3,
                "environment": "must-not-be-recorded",
            },
        )

        encoded = json.dumps(sample)
        self.assertEqual(
            set(sample),
            {
                "schemaVersion",
                "runId",
                "timestamp",
                "phase",
                "trigger",
                "api",
                "resources",
            },
        )
        self.assertNotIn("must-not-be-recorded", encoded)
        self.assertNotIn(pi5_performance.HEALTH_URL, encoded)

    def test_probe_and_resource_failures_become_bounded_sample_values(self) -> None:
        def fail() -> dict[str, object]:
            raise RuntimeError("contains secret detail")

        sample = pi5_performance.sample_event(
            "run-123",
            "pi5-traffic-switch",
            "phase-end",
            health_probe=fail,
            resource_reader=fail,
        )

        self.assertEqual(
            sample["api"],
            {"outcome": "network-error", "status": None, "durationMs": 0},
        )
        self.assertTrue(
            all(value is None for value in sample["resources"].values())
        )

    def test_collects_phase_statistics_and_non_authoritative_assessments(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            project = Path(directory)
            raw, summary = pi5_performance.paths(project, "run-123")
            raw.parent.mkdir(parents=True)
            events = [
                event("run-123", "pi5-baseline", 50) for _ in range(10)
            ]
            events.extend(
                [
                    event("run-123", "pi5-candidate-build", 150),
                    event("run-123", "pi5-candidate-build", 160),
                    event(
                        "run-123",
                        "pi5-traffic-switch",
                        10,
                        outcome="http-error",
                        status=503,
                    ),
                ]
            )
            raw.write_text(
                "".join(json.dumps(item) + "\n" for item in events),
                encoding="utf-8",
            )
            raw.chmod(0o600)

            result = pi5_performance.collect(project, "run-123")

            phases = {phase["name"]: phase for phase in result["phases"]}
            assessments = {
                assessment["name"]: assessment
                for assessment in result["assessments"]
            }
            self.assertEqual(phases["pi5-baseline"]["api"]["medianMs"], 50)
            self.assertEqual(phases["pi5-candidate-build"]["api"]["p95Ms"], 160)
            self.assertTrue(assessments["pi5-candidate-build"]["degraded"])
            self.assertTrue(
                assessments["pi5-candidate-build"]["latencyThresholdExceeded"]
            )
            self.assertTrue(assessments["pi5-traffic-switch"]["degraded"])
            self.assertTrue(assessments["pi5-traffic-switch"]["errorsObserved"])
            self.assertEqual(stat.S_IMODE(summary.stat().st_mode), 0o600)

    def test_rejects_extra_fields_invalid_json_and_unsafe_paths(self) -> None:
        with self.assertRaisesRegex(ValueError, "malformed"):
            pi5_performance.paths(Path("/project"), "../../escape")

        with tempfile.TemporaryDirectory() as directory:
            project = Path(directory)
            raw, summary = pi5_performance.paths(project, "run-123")
            raw.parent.mkdir(parents=True)
            unsafe_event = event("run-123", "pi5-baseline", 1)
            unsafe_event["secret"] = "must-not-be-accepted"
            raw.write_text(json.dumps(unsafe_event) + "\n", encoding="utf-8")
            raw.chmod(0o600)
            with self.assertRaisesRegex(ValueError, "schema"):
                pi5_performance.collect(project, "run-123")
            self.assertFalse(summary.exists())

            raw.write_text("{broken\n", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "invalid JSON"):
                pi5_performance.collect(project, "run-123")

    def test_rejects_symlink_and_non_private_artifacts(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            project = Path(directory)
            raw, _summary = pi5_performance.paths(project, "run-123")
            raw.parent.mkdir(parents=True)
            target = Path(directory) / "target"
            target.write_text("", encoding="utf-8")
            raw.symlink_to(target)
            with self.assertRaisesRegex(ValueError, "unsafe"):
                pi5_performance.collect(project, "run-123")
            with self.assertRaisesRegex(ValueError, "unsafe"):
                pi5_performance.Recorder(project, "run-123")

            raw.unlink()
            raw.write_text("", encoding="utf-8")
            os.chmod(raw, 0o644)
            with self.assertRaisesRegex(ValueError, "permissions"):
                pi5_performance.collect(project, "run-123")

    def test_enforces_byte_and_event_limits(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            project = Path(directory)
            raw, _summary = pi5_performance.paths(project, "run-123")
            raw.parent.mkdir(parents=True)
            raw.write_text(
                "".join(
                    json.dumps(event("run-123", "pi5-baseline", index)) + "\n"
                    for index in range(3)
                ),
                encoding="utf-8",
            )
            raw.chmod(0o600)

            with mock.patch.object(pi5_performance, "MAX_EVENTS", 2):
                with self.assertRaisesRegex(ValueError, "event limit"):
                    pi5_performance.collect(project, "run-123")
            with mock.patch.object(pi5_performance, "MAX_BYTES", 1):
                with self.assertRaisesRegex(ValueError, "unsafe"):
                    pi5_performance.collect(project, "run-123")

    def test_recorder_writes_boundary_samples_without_response_bodies(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            project = Path(directory)
            recorder = pi5_performance.Recorder(
                project,
                "run-123",
                interval_seconds=60,
                health_probe=lambda: {
                    "outcome": "timeout",
                    "status": None,
                    "durationMs": 2000,
                },
                resource_reader=lambda: {},
            )
            recorder.baseline(0)
            result = recorder.finish(project)

            raw = Path(result["rawPath"])
            samples = [
                json.loads(line)
                for line in raw.read_text(encoding="utf-8").splitlines()
            ]
            self.assertEqual(
                [sample["trigger"] for sample in samples],
                ["phase-start", "phase-end"],
            )
            self.assertTrue(
                all(sample["api"]["outcome"] == "timeout" for sample in samples)
            )
            self.assertEqual(stat.S_IMODE(raw.stat().st_mode), 0o600)


if __name__ == "__main__":
    unittest.main()
