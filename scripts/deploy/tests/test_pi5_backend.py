from __future__ import annotations

import json
from pathlib import Path
import re
import subprocess
import tempfile
import unittest

from scripts.deploy.rolling_release.backends import pi5


class State:
    def __init__(self, run_id: str = "run-123") -> None:
        self.payload = {"runId": run_id}
        self.saved: list[dict[str, object]] = []

    def save(self) -> None:
        self.saved.append(json.loads(json.dumps(self.payload)))


class Runtime:
    FULL_SHA_RE = re.compile(r"^[0-9a-f]{40}$")
    re = re
    json = json

    def __init__(
        self,
        project: Path,
        *,
        candidate_run_id: str = "run-123",
        candidate_metadata: dict[str, object] | None = None,
    ) -> None:
        self.PROJECT = project
        self.CANDIDATE_BUILD = project / "scripts/deploy/pi5-candidate-build.sh"
        self.PHASE3 = project / "scripts/deploy/pi5-blue-green.sh"
        self.commands: list[list[str]] = []
        self.candidate_run_id = candidate_run_id
        self.candidate_metadata = candidate_metadata or {}

    def run(self, command: list[str], **_: object) -> str:
        self.commands.append(command)
        if command[0] == str(self.CANDIDATE_BUILD):
            sha = command[command.index("--ref") + 1]
            evidence = command[command.index("--resource-evidence") + 1]
            tag = f"{sha}-0123456789ab"
            state = {
                "event": "prepared",
                "runId": self.candidate_run_id,
                "desiredSha": sha,
                "candidate": {
                    "api": f"api:{tag}",
                    "web": f"web:{tag}",
                    "imageIds": {
                        "api": "sha256:" + "1" * 64,
                        "web": "sha256:" + "2" * 64,
                    },
                },
                "resourceEvidence": {"path": evidence},
                **self.candidate_metadata,
            }
            path = self.PROJECT / "logs/deploy/pi5-image-deploy-state.json"
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(state), encoding="utf-8")
        return ""


class Pi5BackendTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.project = Path(self.temporary.name)
        self.sha = "a" * 40

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def test_orders_plan_build_prepare_switch_and_binds_evidence(self) -> None:
        runtime = Runtime(self.project)
        state = State()
        pi5.phase3_release(self.sha, state, runtime=runtime)
        self.assertEqual(
            [Path(command[0]).name for command in runtime.commands],
            [
                "pi5-migration-plan.sh",
                "pi5-candidate-build.sh",
                "pi5-blue-green.sh",
                "pi5-blue-green.sh",
            ],
        )
        prepare = runtime.commands[2]
        self.assertEqual(prepare[1], "prepare")
        self.assertEqual(prepare[prepare.index("--run-id") + 1], "run-123")
        self.assertTrue(
            prepare[prepare.index("--migration-plan") + 1].endswith(
                "/logs/deploy/runs/run-123/pi5-migration-plan.json"
            )
        )
        self.assertTrue(
            prepare[prepare.index("--resource-evidence") + 1].endswith(
                "/logs/deploy/runs/run-123/pi5-resource-evidence.json"
            )
        )
        self.assertEqual(state.payload["pi5"]["state"], "stability-monitoring")
        self.assertEqual(
            [saved["pi5"]["state"] for saved in state.saved],
            [
                "migration-planning",
                "migration-plan-ready",
                "candidate-ready",
                "switching",
                "stability-monitoring",
            ],
        )
        self.assertEqual(
            [
                phase["name"]
                for phase in state.payload["telemetry"]["phases"]
            ],
            [
                "pi5-migration-plan",
                "pi5-candidate-build",
                "pi5-inactive-slot-prepare",
                "pi5-traffic-switch",
            ],
        )

    def test_rejects_candidate_state_from_another_run_before_prepare(self) -> None:
        runtime = Runtime(self.project, candidate_run_id="other-run")
        with self.assertRaisesRegex(RuntimeError, "exact release run"):
            pi5.phase3_release(self.sha, State(), runtime=runtime)
        self.assertEqual(len(runtime.commands), 2)

    def test_preserves_verified_artifact_promotion_evidence(self) -> None:
        promotion = {
            "status": "promoted",
            "source": "ghcr",
            "releaseSetDigest": "sha256:" + "3" * 64,
            "workflowRunId": 12345,
            "workflowRunAttempt": 2,
            "pulls": {
                "releaseSet": {
                    "elapsedSeconds": 2.0,
                    "observabilityMode": "engine-api",
                    "progress": {"phase": "complete", "downloadedBytes": 1024},
                },
                "api": {
                    "elapsedSeconds": 60.0,
                    "observabilityMode": "engine-api",
                    "progress": {
                        "phase": "complete",
                        "downloadedBytes": 1_262_151_764,
                    },
                },
                "web": {
                    "elapsedSeconds": 4.0,
                    "observabilityMode": "engine-api",
                    "progress": {"phase": "complete", "downloadedBytes": 43_403_033},
                },
            },
            "images": {
                "api": {
                    "digest": "sha256:" + "4" * 64,
                    "imageId": "sha256:" + "1" * 64,
                },
                "web": {
                    "digest": "sha256:" + "5" * 64,
                    "imageId": "sha256:" + "2" * 64,
                },
            },
        }
        runtime = Runtime(
            self.project,
            candidate_metadata={
                "build": {"mode": "promoted"},
                "artifactPromotion": promotion,
            },
        )
        state = State()

        pi5.phase3_release(self.sha, state, runtime=runtime)

        self.assertEqual(state.payload["pi5"]["build"], {"mode": "promoted"})
        self.assertEqual(state.payload["pi5"]["artifactPromotion"], promotion)
        self.assertEqual(
            state.saved[-3]["pi5"]["artifactPromotion"],
            promotion,
        )

    def test_preserves_unavailable_pull_diagnostics(self) -> None:
        promotion = {
            "status": "unavailable",
            "reason": "api image pull timed out after 600s",
            "reasonCode": "artifact-pull-timeout",
            "stage": "api-image-pull",
            "elapsedSeconds": 600,
            "timeoutSeconds": 600,
            "pullDiagnostics": {
                "phase": "downloading",
                "downloadedBytes": 734_003_200,
                "downloadTotalBytes": 1_262_151_764,
                "bytesAdvancedSinceLastHeartbeat": 0,
                "secondsSinceByteProgress": 94.0,
                "knownLayers": 26,
                "completedLayers": 24,
                "activeLayerIds": ["5c8728e73c4b"],
            },
        }
        runtime = Runtime(
            self.project,
            candidate_metadata={
                "build": {"mode": "local-fallback"},
                "artifactPromotion": promotion,
            },
        )
        state = State()

        pi5.phase3_release(self.sha, state, runtime=runtime)

        self.assertEqual(state.payload["pi5"]["build"], {"mode": "local-fallback"})
        self.assertEqual(state.payload["pi5"]["artifactPromotion"], promotion)
        self.assertEqual(
            state.saved[-3]["pi5"]["artifactPromotion"]["pullDiagnostics"],
            promotion["pullDiagnostics"],
        )

    def test_rejects_promoted_mode_without_promotion_evidence(self) -> None:
        runtime = Runtime(
            self.project,
            candidate_metadata={"build": {"mode": "promoted"}},
        )
        with self.assertRaisesRegex(RuntimeError, "exact release run"):
            pi5.phase3_release(self.sha, State(), runtime=runtime)
        self.assertEqual(len(runtime.commands), 2)

    def test_rejects_malformed_coordinator_run_id(self) -> None:
        runtime = Runtime(self.project)
        with self.assertRaisesRegex(RuntimeError, "run ID"):
            pi5.phase3_release(self.sha, State("bad/run"), runtime=runtime)
        self.assertEqual(runtime.commands, [])

    def test_records_monitor_and_cleanup_as_distinct_phases(self) -> None:
        class StabilityRuntime:
            PHASE3 = Path("/deploy/pi5-blue-green.sh")
            json = json

            class time:
                @staticmethod
                def time() -> int:
                    return 100

            def __init__(self) -> None:
                self.commands: list[list[str]] = []
                self.cleaned = False

            def run(self, command: list[str], **_kwargs: object) -> str:
                self.commands.append(command)
                if command[1] == "status":
                    return json.dumps(
                        {"runtimeStatus": "consistent", "stableUntil": 99}
                    )
                return ""

            def cleanup_after_pi5_stability(self) -> None:
                self.cleaned = True

        runtime = StabilityRuntime()
        state = State()
        state.payload["pi5"] = {"state": "stability-monitoring"}

        pi5.wait_for_pi5_stability(state, runtime=runtime)

        self.assertTrue(runtime.cleaned)
        self.assertEqual(state.payload["pi5"]["state"], "stable")
        self.assertEqual(
            [
                phase["name"]
                for phase in state.payload["telemetry"]["phases"]
            ],
            ["pi5-stability-monitor", "pi5-cleanup"],
        )

    def test_cleanup_stage_failure_never_enters_switchback(self) -> None:
        class CleanupFailureRuntime:
            def __init__(self) -> None:
                self.rollback_accessed = False

            @staticmethod
            def recover_expired_pi5_handoff(_state: State) -> bool:
                return False

            @staticmethod
            def pi5_already_current(_sha: str) -> bool:
                return False

            @staticmethod
            def phase3_release(_sha: str, state: State) -> None:
                state.payload["pi5"] = {"state": "stability-monitoring"}

            @staticmethod
            def wait_for_pi5_stability(state: State) -> None:
                state.payload["pi5"]["state"] = "cleanup"
                state.save()
                raise RuntimeError("resumable cleanup failure")

        runtime = CleanupFailureRuntime()
        state = State()
        with self.assertRaisesRegex(RuntimeError, "resumable cleanup failure"):
            pi5.ensure_pi5_release(self.sha, state, runtime=runtime)
        self.assertEqual(state.payload["pi5"]["state"], "cleanup")


def phase3_payload(event: str) -> dict[str, object]:
    if event in {"switching", "switch-failed"}:
        active, candidate, previous, gateway = "blue", "green", "blue", "blue"
        stable = None
    elif event == "rolled-back":
        active, candidate, previous, gateway = "blue", "green", "green", "blue"
        stable = None
    elif event == "rollback-cleaned":
        active, candidate, previous, gateway = "blue", None, None, "blue"
        stable = None
    else:
        active, candidate, previous, gateway = "green", "blue", "blue", "green"
        stable = 2_000_000_000
    return {
        "version": 2,
        "event": event,
        "runtimeStatus": "consistent",
        "liveHealthStatus": "verified",
        "activeSlot": active,
        "candidateSlot": candidate,
        "previousSlot": previous,
        "stableUntil": stable,
        "gateway": {"mode": "application", "slot": gateway},
        "slots": {
            "blue": {
                "images": {"api": "api:blue", "web": "web:blue"},
                "imageIds": {"api": "sha256:" + "1" * 64, "web": "sha256:" + "2" * 64},
            },
            "green": {
                "images": {"api": "api:green", "web": "web:green"},
                "imageIds": {"api": "sha256:" + "3" * 64, "web": "sha256:" + "4" * 64},
            },
        },
    }


class RollbackRuntime:
    PHASE3 = Path("/deploy/pi5-blue-green.sh")
    json = json
    re = re
    subprocess = subprocess
    os = __import__("os")

    def __init__(self, statuses: list[object], *, rollback_fails: bool = False) -> None:
        self.statuses = list(statuses)
        self.rollback_fails = rollback_fails
        self.commands: list[list[str]] = []

    def run(self, command: list[str], **_: object) -> str:
        self.commands.append(command)
        if command[1] == "status":
            value = self.statuses.pop(0)
            return value if isinstance(value, str) else json.dumps(value)
        if command[1] == "rollback" and self.rollback_fails:
            raise subprocess.CalledProcessError(1, command, stderr="failed")
        return ""


class Pi5CoordinatorRollbackTest(unittest.TestCase):
    def test_switch_and_monitor_failures_each_get_one_verified_switchback(self) -> None:
        for event in ("switch-failed", "monitor-failed"):
            with self.subTest(event=event):
                runtime = RollbackRuntime(
                    [
                        phase3_payload(event),
                        phase3_payload("rolled-back"),
                        phase3_payload("rollback-cleaned"),
                    ]
                )
                state = State()
                state.payload["pi5"] = {"state": "stability-monitoring"}
                self.assertEqual(
                    pi5.rollback_pi5_runtime(state, f"{event} fixture", runtime=runtime),
                    "verified",
                )
                rollback_commands = [c for c in runtime.commands if c[1] == "rollback"]
                self.assertEqual(len(rollback_commands), 1)
                self.assertEqual(state.payload["pi5"]["rollbackEvidence"], "verified")

    def test_failed_switchback_is_attempted_once_and_left_unknown(self) -> None:
        runtime = RollbackRuntime([phase3_payload("monitor-failed")], rollback_fails=True)
        state = State()
        state.payload["pi5"] = {"state": "stability-monitoring"}
        with self.assertRaisesRegex(RuntimeError, "command failed"):
            pi5.rollback_pi5_runtime(state, "monitor failed", runtime=runtime)
        self.assertEqual(len([c for c in runtime.commands if c[1] == "rollback"]), 1)
        self.assertTrue(state.payload["pi5"]["rollbackAttempted"])
        self.assertEqual(state.payload["pi5"]["rollbackEvidence"], "unknown")
        with self.assertRaisesRegex(RuntimeError, "already attempted"):
            pi5.rollback_pi5_runtime(state, "retry", runtime=runtime)
        self.assertEqual(len([c for c in runtime.commands if c[1] == "rollback"]), 1)

    def test_unknown_state_never_grants_switchback_authority(self) -> None:
        runtime = RollbackRuntime(["not-json"])
        state = State()
        state.payload["pi5"] = {"state": "switching"}
        with self.assertRaisesRegex(RuntimeError, "authority is unavailable"):
            pi5.rollback_pi5_runtime(state, "switch failed", runtime=runtime)
        self.assertEqual([c for c in runtime.commands if c[1] == "rollback"], [])
        self.assertEqual(state.payload["pi5"]["rollbackEvidence"], "unknown")

    def test_explicit_pre_cutover_state_does_not_trigger_switchback(self) -> None:
        runtime = RollbackRuntime([phase3_payload("prepared")])
        state = State()
        state.payload["pi5"] = {"state": "switching"}
        self.assertEqual(
            pi5.rollback_pi5_runtime(state, "switch command failed", runtime=runtime),
            "not-required",
        )
        self.assertEqual([c for c in runtime.commands if c[1] == "rollback"], [])


if __name__ == "__main__":
    unittest.main()
