from __future__ import annotations

import json
import os
from pathlib import Path
import signal
import stat
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from scripts.deploy.pi5_artifact_promoter import (
    _config_metadata_is_safe,
    _run_command,
    CommandExecution,
    CommandResult,
    CommandTimedOut,
    DEFAULT_TIMING_POLICY,
    PUBLIC_OCI_VERIFICATION_TOKEN,
    PromotionBudget,
    PromotionDisabled,
    PromotionIntegrityError,
    PromotionInterrupted,
    PromotionTimingPolicy,
    PromotionUnavailable,
    attestation_command,
    load_config,
    main,
    promote,
)


SHA = "a" * 40
CONFIG_HASH = "b" * 64
RUN_ID = "run-123"
API_TAG = f"raspi-system-api:{SHA}-{CONFIG_HASH[:12]}-{'1' * 64}"
WEB_TAG = f"raspi-system-web:{SHA}-{CONFIG_HASH[:12]}-{'1' * 64}"
TOKEN = "test-read-only-package-token"


def config_document(
    enabled: bool = True, token: str = TOKEN
) -> dict[str, object]:
    return {
        "enabled": enabled,
        "repository": "denkoushi/RaspberryPiSystem_002",
        "workflow": ".github/workflows/ci.yml",
        "releaseSetRepository": "ghcr.io/denkoushi/raspisys-release-set",
        "username": "denkoushi",
        "token": token,
    }


def release_set_document() -> dict[str, object]:
    return {
        "schemaVersion": 1,
        "source": {
            "repository": "denkoushi/RaspberryPiSystem_002",
            "sha": SHA,
            "ref": "refs/heads/main",
        },
        "configHash": CONFIG_HASH,
        "platform": {"os": "linux", "architecture": "arm64"},
        "images": {
            "api": {
                "repository": "ghcr.io/denkoushi/raspisys-api",
                "digest": "sha256:" + "2" * 64,
            },
            "web": {
                "repository": "ghcr.io/denkoushi/raspisys-web",
                "digest": "sha256:" + "3" * 64,
            },
        },
        "workflow": {
            "path": ".github/workflows/ci.yml",
            "runId": 9876,
            "runAttempt": 2,
        },
    }


class FakeRunner:
    def __init__(
        self,
        *,
        release_pull_code: int = 0,
        attestation_code: int = 0,
        verifier_help: str | None = None,
    ):
        self.commands: list[
            tuple[
                list[str],
                str | None,
                dict[str, str] | None,
                CommandExecution,
            ]
        ] = []
        self.release_pull_code = release_pull_code
        self.attestation_code = attestation_code
        self.verifier_help = verifier_help or " ".join(
            (
                "--bundle-from-oci",
                "--deny-self-hosted-runners",
                "--signer-workflow",
                "--source-digest",
                "--source-ref",
            )
        )

    def __call__(
        self,
        command: object,
        input_text: str | None,
        environment: object,
        execution: CommandExecution,
    ) -> CommandResult:
        argv = list(command)  # type: ignore[arg-type]
        env = dict(environment) if environment is not None else None  # type: ignore[arg-type]
        self.commands.append((argv, input_text, env, execution))
        if argv[-1:] == ["--help"] and "attestation" in argv:
            return CommandResult(0, self.verifier_help, "")
        if "attestation" in argv:
            return CommandResult(self.attestation_code, "", "")
        if "pull" in argv and "raspisys-release-set:" in argv[-1]:
            return CommandResult(self.release_pull_code, "", "")
        if argv[-3:-1] == ["--format", "{{json .RepoDigests}}"]:
            return CommandResult(
                0,
                json.dumps(
                    [
                        "ghcr.io/denkoushi/raspisys-release-set@sha256:"
                        + "1" * 64
                    ]
                ),
                "",
            )
        if argv[1:3] == ["image", "inspect"]:
            reference = argv[-1]
            if "raspisys-api" in reference:
                image_id = "sha256:" + "4" * 64
            elif "raspisys-web" in reference:
                image_id = "sha256:" + "5" * 64
            else:
                image_id = "sha256:" + "6" * 64
            return CommandResult(
                0,
                json.dumps(
                    [
                        {
                            "Id": image_id,
                            "Os": "linux",
                            "Architecture": "arm64",
                            "Config": {
                                "Labels": {
                                    "org.opencontainers.image.revision": SHA,
                                    "org.opencontainers.image.config-hash": CONFIG_HASH,
                                }
                            },
                        }
                    ]
                ),
                "",
            )
        if "cp" in argv:
            Path(argv[-1]).write_text(
                json.dumps(release_set_document()), encoding="utf-8"
            )
        return CommandResult(0, "container-id\n", "")


class Pi5ArtifactPromoterTests(unittest.TestCase):
    def write_config(self, directory: str, value: dict[str, object]) -> Path:
        path = Path(directory) / "artifact-promotion.json"
        path.write_text(json.dumps(value), encoding="utf-8")
        path.chmod(0o600)
        return path

    def test_disabled_or_missing_config_never_attempts_network(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(PromotionDisabled):
                load_config(Path(directory) / "missing.json")
            path = self.write_config(directory, config_document(False))
            with self.assertRaises(PromotionDisabled):
                load_config(path)

    def test_default_timing_policy_keeps_large_pulls_and_total_budget_bounded(
        self,
    ) -> None:
        self.assertEqual(
            DEFAULT_TIMING_POLICY,
            PromotionTimingPolicy(
                release_set_pull_timeout_seconds=120,
                image_pull_timeout_seconds=600,
                command_timeout_seconds=300,
                total_timeout_seconds=900,
                heartbeat_seconds=30,
                cleanup_timeout_seconds=30,
            ),
        )
        clock = Mock(side_effect=[0.0, 850.0])
        budget = PromotionBudget(DEFAULT_TIMING_POLICY, clock=clock)
        execution = budget.execution(
            "api-image-pull",
            DEFAULT_TIMING_POLICY.image_pull_timeout_seconds,
        )
        self.assertEqual(execution.timeout_seconds, 50)
        self.assertEqual(execution.heartbeat_seconds, 30)

        exhausted_clock = Mock(side_effect=[0.0, 901.0])
        exhausted = PromotionBudget(DEFAULT_TIMING_POLICY, clock=exhausted_clock)
        with self.assertRaises(PromotionUnavailable) as raised:
            exhausted.execution("web-image-pull", 600)
        self.assertEqual(raised.exception.reason_code, "promotion-budget-exhausted")
        self.assertEqual(raised.exception.stage, "web-image-pull")
        self.assertEqual(raised.exception.elapsed_seconds, 901)
        self.assertEqual(raised.exception.timeout_seconds, 900)

    def test_real_runner_emits_safe_heartbeat_and_stops_timed_out_child(
        self,
    ) -> None:
        execution = CommandExecution(
            stage="api-image-pull",
            timeout_seconds=0.12,
            heartbeat_seconds=0.03,
        )
        with patch("builtins.print") as output:
            with self.assertRaises(CommandTimedOut) as raised:
                _run_command(
                    [
                        sys.executable,
                        "-c",
                        "import sys,time; sys.stdin.read(); time.sleep(5)",
                    ],
                    TOKEN,
                    None,
                    execution,
                )
        self.assertEqual(raised.exception.stage, "api-image-pull")
        self.assertEqual(raised.exception.timeout_seconds, 0.12)
        serialized = repr(output.call_args_list)
        self.assertIn('"state":"heartbeat"', serialized)
        self.assertIn('"state":"timeout"', serialized)
        self.assertNotIn(TOKEN, serialized)
        self.assertNotIn(sys.executable, serialized)

    def test_real_runner_labels_success_and_nonzero_completion(self) -> None:
        execution = CommandExecution(
            stage="release-set-pull",
            timeout_seconds=1,
            heartbeat_seconds=1,
        )
        with patch("builtins.print") as output:
            success = _run_command(
                [sys.executable, "-c", "raise SystemExit(0)"],
                execution=execution,
            )
            result = _run_command(
                [sys.executable, "-c", "raise SystemExit(7)"],
                execution=execution,
            )
        self.assertEqual(success.returncode, 0)
        self.assertEqual(result.returncode, 7)
        serialized = repr(output.call_args_list)
        self.assertIn('"state":"failed"', serialized)
        self.assertIn('"state":"success"', serialized)

    @patch("scripts.deploy.pi5_artifact_promoter.shutil.which")
    def test_image_pull_timeout_is_structured_unavailable_and_cleans_partial_work(
        self, which: object
    ) -> None:
        which.side_effect = lambda name: f"/usr/bin/{name}"  # type: ignore[attr-defined]

        class TimedOutRunner(FakeRunner):
            def __call__(
                self,
                command: object,
                input_text: str | None,
                environment: object,
                execution: CommandExecution,
            ) -> CommandResult:
                argv = list(command)  # type: ignore[arg-type]
                if "pull" in argv and "raspisys-api@sha256:" in argv[-1]:
                    raise CommandTimedOut(
                        execution.stage,
                        elapsed_seconds=600,
                        timeout_seconds=execution.timeout_seconds,
                    )
                return super().__call__(
                    argv,
                    input_text,
                    environment,
                    execution,
                )

        with tempfile.TemporaryDirectory() as directory:
            config = self.write_config(directory, config_document())
            runner = TimedOutRunner()
            with self.assertRaises(PromotionUnavailable) as raised:
                promote(
                    config_path=config,
                    sha=SHA,
                    config_hash=CONFIG_HASH,
                    run_id=RUN_ID,
                    api_tag=API_TAG,
                    web_tag=WEB_TAG,
                    runner=runner,
                )

        self.assertEqual(raised.exception.reason_code, "artifact-pull-timeout")
        self.assertEqual(raised.exception.stage, "api-image-pull")
        self.assertEqual(raised.exception.elapsed_seconds, 600)
        self.assertEqual(raised.exception.timeout_seconds, 600)
        cleanup_commands = [
            command
            for command, _, _, _ in runner.commands
            if "image" in command and "rm" in command
        ]
        self.assertTrue(
            any("raspisys-release-set:" in command[-1] for command in cleanup_commands)
        )

    def test_main_serializes_structured_timeout_without_secret_detail(self) -> None:
        error = PromotionUnavailable(
            "api image pull timed out",
            reason_code="artifact-pull-timeout",
            stage="api-image-pull",
            elapsed_seconds=600,
            timeout_seconds=600,
        )
        with tempfile.TemporaryDirectory() as directory:
            result_path = Path(directory) / "result.json"
            with patch(
                "scripts.deploy.pi5_artifact_promoter.promote",
                side_effect=error,
            ):
                result = main(
                    [
                        "--config",
                        str(Path(directory) / "config.json"),
                        "--sha",
                        SHA,
                        "--config-hash",
                        CONFIG_HASH,
                        "--run-id",
                        RUN_ID,
                        "--api-tag",
                        API_TAG,
                        "--web-tag",
                        WEB_TAG,
                        "--result",
                        str(result_path),
                    ]
                )
            document = json.loads(result_path.read_text(encoding="utf-8"))
        self.assertEqual(result, 75)
        self.assertEqual(
            document,
            {
                "status": "unavailable",
                "reason": "api image pull timed out",
                "reasonCode": "artifact-pull-timeout",
                "stage": "api-image-pull",
                "elapsedSeconds": 600,
                "timeoutSeconds": 600,
            },
        )
        self.assertNotIn(TOKEN, json.dumps(document))

    def test_main_maps_sigterm_to_interrupted_result_and_restores_handler(self) -> None:
        previous = signal.getsignal(signal.SIGTERM)

        def terminate_during_promotion(**_kwargs: object) -> dict[str, object]:
            os.kill(os.getpid(), signal.SIGTERM)
            self.fail("SIGTERM handler did not interrupt promotion")

        with tempfile.TemporaryDirectory() as directory:
            result_path = Path(directory) / "result.json"
            with patch(
                "scripts.deploy.pi5_artifact_promoter.promote",
                side_effect=terminate_during_promotion,
            ):
                result = main(
                    [
                        "--config",
                        str(Path(directory) / "config.json"),
                        "--sha",
                        SHA,
                        "--config-hash",
                        CONFIG_HASH,
                        "--run-id",
                        RUN_ID,
                        "--api-tag",
                        API_TAG,
                        "--web-tag",
                        WEB_TAG,
                        "--result",
                        str(result_path),
                    ]
                )
            document = json.loads(result_path.read_text(encoding="utf-8"))

        self.assertEqual(result, 128 + signal.SIGTERM)
        self.assertEqual(
            document,
            {"status": "interrupted", "signal": signal.SIGTERM},
        )
        self.assertIs(signal.getsignal(signal.SIGTERM), previous)

    def test_config_rejects_unsafe_permissions_and_unknown_fields(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = self.write_config(directory, config_document())
            path.chmod(0o644)
            with self.assertRaisesRegex(PromotionIntegrityError, "permissions"):
                load_config(path)
            value = config_document()
            value["extra"] = "forbidden"
            path = self.write_config(directory, value)
            with self.assertRaisesRegex(PromotionIntegrityError, "fields"):
                load_config(path)

    def test_config_accepts_root_owned_release_runner_group_read(self) -> None:
        metadata = SimpleNamespace(
            st_mode=stat.S_IFREG | 0o640,
            st_size=512,
            st_uid=0,
            st_gid=2000,
        )
        self.assertTrue(
            _config_metadata_is_safe(
                metadata,  # type: ignore[arg-type]
                effective_uid=1000,
                effective_gid=2000,
                supplementary_groups=(),
            )
        )
        self.assertFalse(
            _config_metadata_is_safe(
                metadata,  # type: ignore[arg-type]
                effective_uid=1001,
                effective_gid=2001,
                supplementary_groups=(2002,),
            )
        )

    @patch("scripts.deploy.pi5_artifact_promoter.Path.lstat")
    def test_inaccessible_config_is_available_for_local_fallback(
        self, lstat: object
    ) -> None:
        lstat.side_effect = PermissionError("denied")  # type: ignore[attr-defined]
        with self.assertRaises(PromotionUnavailable):
            load_config(Path("/etc/raspi-release/artifact-promotion.json"))

    @patch("scripts.deploy.pi5_artifact_promoter.shutil.which")
    def test_promotes_exact_pair_without_serializing_token(self, which: object) -> None:
        which.side_effect = lambda name: f"/usr/bin/{name}"  # type: ignore[attr-defined]
        with tempfile.TemporaryDirectory() as directory:
            config = self.write_config(directory, config_document())
            runner = FakeRunner()
            result = promote(
                config_path=config,
                sha=SHA,
                config_hash=CONFIG_HASH,
                run_id=RUN_ID,
                api_tag=API_TAG,
                web_tag=WEB_TAG,
                runner=runner,
            )
        self.assertEqual(result["status"], "promoted")
        self.assertEqual(result["workflowRunId"], 9876)
        serialized_commands = json.dumps(
            [command for command, _, _, _ in runner.commands]
        )
        self.assertNotIn(TOKEN, serialized_commands)
        self.assertEqual(
            [
                input_text
                for _, input_text, _, _ in runner.commands
                if input_text
            ],
            [TOKEN],
        )
        verifier_environments = [
            environment
            for command, _, environment, _ in runner.commands
            if "attestation" in command
        ]
        self.assertTrue(verifier_environments)
        self.assertTrue(
            all(
                environment["GH_TOKEN"] == TOKEN
                for environment in verifier_environments
            )
        )
        self.assertTrue(
            all(
                environment["GH_CONFIG_DIR"].endswith("/gh")
                for environment in verifier_environments
            )
        )
        self.assertNotIn(TOKEN, json.dumps(result))
        self.assertTrue(
            any(
                command[1:]
                == [
                    "image",
                    "tag",
                    "ghcr.io/denkoushi/raspisys-api@sha256:" + "2" * 64,
                    API_TAG,
                ]
                for command, _, _, _ in runner.commands
            )
        )

    @patch("scripts.deploy.pi5_artifact_promoter.shutil.which")
    def test_public_release_uses_isolated_verifier_without_registry_login(
        self, which: object
    ) -> None:
        which.side_effect = lambda name: f"/usr/bin/{name}"  # type: ignore[attr-defined]
        with tempfile.TemporaryDirectory() as directory:
            config = self.write_config(directory, config_document(token=""))
            runner = FakeRunner()
            result = promote(
                config_path=config,
                sha=SHA,
                config_hash=CONFIG_HASH,
                run_id=RUN_ID,
                api_tag=API_TAG,
                web_tag=WEB_TAG,
                runner=runner,
            )

        self.assertEqual(result["status"], "promoted")
        self.assertFalse(
            any("login" in command for command, _, _, _ in runner.commands)
        )
        verifier_environments = [
            environment
            for command, _, environment, _ in runner.commands
            if "attestation" in command
        ]
        self.assertTrue(verifier_environments)
        self.assertTrue(
            all(
                environment["GH_TOKEN"] == PUBLIC_OCI_VERIFICATION_TOKEN
                for environment in verifier_environments
            )
        )
        self.assertTrue(
            all(
                environment["GH_CONFIG_DIR"].endswith("/gh")
                for environment in verifier_environments
            )
        )

    @patch("scripts.deploy.pi5_artifact_promoter.shutil.which")
    def test_missing_release_set_is_available_for_local_fallback(self, which: object) -> None:
        which.side_effect = lambda name: f"/usr/bin/{name}"  # type: ignore[attr-defined]
        with tempfile.TemporaryDirectory() as directory:
            config = self.write_config(directory, config_document())
            with self.assertRaises(PromotionUnavailable):
                promote(
                    config_path=config,
                    sha=SHA,
                    config_hash=CONFIG_HASH,
                    run_id=RUN_ID,
                    api_tag=API_TAG,
                    web_tag=WEB_TAG,
                    runner=FakeRunner(release_pull_code=1),
                )

    @patch("scripts.deploy.pi5_artifact_promoter.shutil.which")
    def test_old_attestation_verifier_is_available_for_local_fallback(
        self, which: object
    ) -> None:
        which.side_effect = lambda name: f"/usr/bin/{name}"  # type: ignore[attr-defined]
        with tempfile.TemporaryDirectory() as directory:
            config = self.write_config(directory, config_document())
            with self.assertRaisesRegex(PromotionUnavailable, "too old"):
                promote(
                    config_path=config,
                    sha=SHA,
                    config_hash=CONFIG_HASH,
                    run_id=RUN_ID,
                    api_tag=API_TAG,
                    web_tag=WEB_TAG,
                    runner=FakeRunner(verifier_help="--source-digest"),
                )

    @patch("scripts.deploy.pi5_artifact_promoter.shutil.which")
    def test_attestation_failure_is_terminal_not_fallback(self, which: object) -> None:
        which.side_effect = lambda name: f"/usr/bin/{name}"  # type: ignore[attr-defined]
        with tempfile.TemporaryDirectory() as directory:
            config = self.write_config(directory, config_document())
            with self.assertRaises(PromotionIntegrityError):
                promote(
                    config_path=config,
                    sha=SHA,
                    config_hash=CONFIG_HASH,
                    run_id=RUN_ID,
                    api_tag=API_TAG,
                    web_tag=WEB_TAG,
                    runner=FakeRunner(attestation_code=1),
                )

    def test_attestation_command_binds_workflow_source_and_runner(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            config = load_config(self.write_config(directory, config_document()))
        command = attestation_command(
            "/usr/bin/gh",
            "ghcr.io/denkoushi/raspisys-api@sha256:" + "2" * 64,
            config,
            SHA,
        )
        self.assertIn("denkoushi/RaspberryPiSystem_002/.github/workflows/ci.yml", command)
        self.assertIn("--source-digest", command)
        self.assertIn(SHA, command)
        self.assertIn("--source-ref", command)
        self.assertIn("refs/heads/main", command)
        self.assertIn("--deny-self-hosted-runners", command)
        self.assertIn("--bundle-from-oci", command)

    @patch("scripts.deploy.pi5_artifact_promoter.shutil.which")
    def test_interruption_cleans_partial_tags_and_pulled_images(
        self, which: object
    ) -> None:
        which.side_effect = lambda name: f"/usr/bin/{name}"  # type: ignore[attr-defined]

        class InterruptedRunner(FakeRunner):
            def __call__(
                self,
                command: object,
                input_text: str | None,
                environment: object,
                execution: CommandExecution,
            ) -> CommandResult:
                argv = list(command)  # type: ignore[arg-type]
                if "pull" in argv and "raspisys-api@sha256:" in argv[-1]:
                    raise PromotionInterrupted(15)
                return super().__call__(argv, input_text, environment, execution)

        with tempfile.TemporaryDirectory() as directory:
            config = self.write_config(directory, config_document())
            runner = InterruptedRunner()
            with self.assertRaises(PromotionInterrupted):
                promote(
                    config_path=config,
                    sha=SHA,
                    config_hash=CONFIG_HASH,
                    run_id=RUN_ID,
                    api_tag=API_TAG,
                    web_tag=WEB_TAG,
                    runner=runner,
                )

        cleanup_commands = [
            command
            for command, _, _, _ in runner.commands
            if "image" in command and "rm" in command
        ]
        self.assertTrue(cleanup_commands)
        self.assertTrue(
            any("raspisys-release-set:" in command[-1] for command in cleanup_commands)
        )

    @patch("scripts.deploy.pi5_artifact_promoter.shutil.which")
    def test_cleanup_failure_does_not_hide_timeout_or_stop_later_cleanup(
        self, which: object
    ) -> None:
        which.side_effect = lambda name: f"/usr/bin/{name}"  # type: ignore[attr-defined]

        class CleanupFailureRunner(FakeRunner):
            def __init__(self) -> None:
                super().__init__()
                self.cleanup_attempts: list[list[str]] = []

            def __call__(
                self,
                command: object,
                input_text: str | None,
                environment: object,
                execution: CommandExecution,
            ) -> CommandResult:
                argv = list(command)  # type: ignore[arg-type]
                if "pull" in argv and "raspisys-api@sha256:" in argv[-1]:
                    raise CommandTimedOut(
                        execution.stage,
                        elapsed_seconds=600,
                        timeout_seconds=execution.timeout_seconds,
                    )
                if "rm" in argv:
                    self.cleanup_attempts.append(argv)
                    raise CommandTimedOut(
                        execution.stage,
                        elapsed_seconds=30,
                        timeout_seconds=execution.timeout_seconds,
                    )
                return super().__call__(argv, input_text, environment, execution)

        with tempfile.TemporaryDirectory() as directory:
            config = self.write_config(directory, config_document())
            runner = CleanupFailureRunner()
            with patch("builtins.print"):
                with self.assertRaises(PromotionUnavailable) as raised:
                    promote(
                        config_path=config,
                        sha=SHA,
                        config_hash=CONFIG_HASH,
                        run_id=RUN_ID,
                        api_tag=API_TAG,
                        web_tag=WEB_TAG,
                        runner=runner,
                    )

        self.assertEqual(raised.exception.reason_code, "artifact-pull-timeout")
        self.assertGreaterEqual(len(runner.cleanup_attempts), 2)
        self.assertTrue(
            any(
                "raspisys-release-set:" in command[-1]
                for command in runner.cleanup_attempts
            )
        )


if __name__ == "__main__":
    unittest.main()
