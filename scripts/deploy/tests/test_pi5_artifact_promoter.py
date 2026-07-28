from __future__ import annotations

import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from scripts.deploy.pi5_artifact_promoter import (
    CommandResult,
    PromotionDisabled,
    PromotionIntegrityError,
    PromotionInterrupted,
    PromotionUnavailable,
    attestation_command,
    load_config,
    promote,
)


SHA = "a" * 40
CONFIG_HASH = "b" * 64
RUN_ID = "run-123"
API_TAG = f"raspi-system-api:{SHA}-{CONFIG_HASH[:12]}-{'1' * 64}"
WEB_TAG = f"raspi-system-web:{SHA}-{CONFIG_HASH[:12]}-{'1' * 64}"
TOKEN = "test-read-only-package-token"


def config_document(enabled: bool = True) -> dict[str, object]:
    return {
        "enabled": enabled,
        "repository": "denkoushi/RaspberryPiSystem_002",
        "workflow": ".github/workflows/ci.yml",
        "releaseSetRepository": "ghcr.io/denkoushi/raspisys-release-set",
        "username": "denkoushi",
        "token": TOKEN,
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
        self.commands: list[tuple[list[str], str | None, dict[str, str] | None]] = []
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
    ) -> CommandResult:
        argv = list(command)  # type: ignore[arg-type]
        env = dict(environment) if environment is not None else None  # type: ignore[arg-type]
        self.commands.append((argv, input_text, env))
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
        serialized_commands = json.dumps([command for command, _, _ in runner.commands])
        self.assertNotIn(TOKEN, serialized_commands)
        self.assertEqual(
            [input_text for _, input_text, _ in runner.commands if input_text],
            [TOKEN],
        )
        verifier_environments = [
            environment
            for command, _, environment in runner.commands
            if "attestation" in command
        ]
        self.assertTrue(verifier_environments)
        self.assertTrue(all(environment["GH_TOKEN"] == TOKEN for environment in verifier_environments))
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
                for command, _, _ in runner.commands
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
            ) -> CommandResult:
                argv = list(command)  # type: ignore[arg-type]
                if "pull" in argv and "raspisys-api@sha256:" in argv[-1]:
                    raise PromotionInterrupted(15)
                return super().__call__(argv, input_text, environment)

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
            for command, _, _ in runner.commands
            if "image" in command and "rm" in command
        ]
        self.assertTrue(cleanup_commands)
        self.assertTrue(
            any("raspisys-release-set:" in command[-1] for command in cleanup_commands)
        )


if __name__ == "__main__":
    unittest.main()
