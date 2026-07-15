#!/usr/bin/env python3
from __future__ import annotations

import contextlib
import importlib.util
import io
import json
import tempfile
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).parents[1] / "pi5-runtime-config-verifier.py"
SPEC = importlib.util.spec_from_file_location("pi5_runtime_config_verifier", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
VERIFIER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(VERIFIER)


class RuntimeConfigVerifierTest(unittest.TestCase):
    service = "api-green"

    @staticmethod
    def valid_environment() -> dict[str, str]:
        return {
            "SLACK_KIOSK_SUPPORT_WEBHOOK_URL": "https://secret.example/kiosk",
            "ALERTS_DISPATCHER_ENABLED": "true",
            "ALERTS_SLACK_WEBHOOK_DEPLOY": "https://secret.example/deploy",
            "ALERTS_SLACK_WEBHOOK_OPS": "https://secret.example/ops",
            "ALERTS_SLACK_WEBHOOK_SECURITY": "https://secret.example/security",
            "ALERTS_SLACK_WEBHOOK_SUPPORT": "https://secret.example/support",
            "LOCAL_LLM_BASE_URL": "https://llm.example",
            "LOCAL_LLM_SHARED_TOKEN": "top-secret-token",
            "LOCAL_LLM_MODEL": "model-a",
            "PHOTO_TOOL_EMBEDDING_ENABLED": "true",
            "PHOTO_TOOL_EMBEDDING_URL": "https://embedding.example",
            "PHOTO_TOOL_EMBEDDING_MODEL_ID": "embedding-a",
        }

    def compose(self, environment: dict[str, str]) -> dict[str, object]:
        return {"services": {self.service: {"environment": environment}}}

    @staticmethod
    def inspect(environment: dict[str, str], *extras: str) -> list[str]:
        return [*(f"{key}={value}" for key, value in environment.items()), *extras]

    def test_compose_overrides_image_defaults_and_exact_runtime_matches(self):
        environment = self.valid_environment()
        image_environment = {
            "PATH": "/usr/local/bin",
            "NODE_VERSION": "22",
            "LOCAL_LLM_MODEL": "image-default-overridden-by-compose",
        }
        observed = {**image_environment, **environment}
        digest = VERIFIER.verify_payloads(
            self.compose(environment),
            self.inspect(image_environment),
            self.inspect(observed),
            self.service,
        )
        self.assertRegex(digest, r"^sha256:[0-9a-f]{64}$")

    def test_removed_compose_key_retained_by_old_container_fails(self):
        environment = self.valid_environment()
        observed = {**environment, "REMOVED_FEATURE_FLAG": "still-present"}
        with self.assertRaisesRegex(
            VERIFIER.VerificationError, "REMOVED_FEATURE_FLAG"
        ):
            VERIFIER.verify_payloads(
                self.compose(environment),
                [],
                self.inspect(observed),
                self.service,
            )

    def test_compose_null_removes_an_image_default_instead_of_setting_empty(self):
        compose_environment = self.valid_environment()
        compose_environment["IMAGE_OPTIONAL"] = None  # type: ignore[assignment]
        image_environment = {
            "PATH": "/usr/local/bin",
            "IMAGE_OPTIONAL": "image-default",
        }
        expected = {**image_environment, **self.valid_environment()}
        expected.pop("IMAGE_OPTIONAL")

        digest = VERIFIER.verify_payloads(
            self.compose(compose_environment),
            self.inspect(image_environment),
            self.inspect(expected),
            self.service,
        )

        self.assertRegex(digest, r"^sha256:[0-9a-f]{64}$")

    def test_explicit_empty_compose_value_is_not_an_unset(self):
        environment = self.valid_environment()
        environment["OPTIONAL_EMPTY"] = ""
        observed = dict(environment)

        digest = VERIFIER.verify_payloads(
            self.compose(environment), [], self.inspect(observed), self.service
        )

        self.assertRegex(digest, r"^sha256:[0-9a-f]{64}$")

    def test_missing_or_mismatched_keys_fail_without_secret_values(self):
        expected = self.valid_environment()
        observed = dict(expected)
        secret = observed.pop("LOCAL_LLM_SHARED_TOKEN")
        observed["ALERTS_SLACK_WEBHOOK_DEPLOY"] = "different-secret-value"

        with self.assertRaises(VERIFIER.VerificationError) as raised:
            VERIFIER.verify_payloads(
                self.compose(expected), [], self.inspect(observed), self.service
            )

        message = str(raised.exception)
        self.assertIn("LOCAL_LLM_SHARED_TOKEN", message)
        self.assertIn("ALERTS_SLACK_WEBHOOK_DEPLOY", message)
        self.assertNotIn(secret, message)
        self.assertNotIn(expected["ALERTS_SLACK_WEBHOOK_DEPLOY"], message)
        self.assertNotIn(observed["ALERTS_SLACK_WEBHOOK_DEPLOY"], message)

    def test_semantic_requirements_are_preserved(self):
        cases = {
            "kiosk support": (
                {"SLACK_KIOSK_SUPPORT_WEBHOOK_URL": ""},
                "SLACK_KIOSK_SUPPORT_WEBHOOK_URL",
            ),
            "dispatcher": (
                {
                    "SLACK_KIOSK_SUPPORT_WEBHOOK_URL": "configured",
                    "ALERTS_DISPATCHER_ENABLED": "true",
                },
                "ALERTS_SLACK_WEBHOOK_DEPLOY",
            ),
            "local llm": (
                {
                    "SLACK_KIOSK_SUPPORT_WEBHOOK_URL": "configured",
                    "LOCAL_LLM_BASE_URL": "configured",
                },
                "LOCAL_LLM_SHARED_TOKEN",
            ),
            "embedding": (
                {
                    "SLACK_KIOSK_SUPPORT_WEBHOOK_URL": "configured",
                    "PHOTO_TOOL_EMBEDDING_ENABLED": "true",
                },
                "PHOTO_TOOL_EMBEDDING_URL",
            ),
        }
        for name, (environment, missing_key) in cases.items():
            with self.subTest(name=name), self.assertRaisesRegex(
                VERIFIER.VerificationError, missing_key
            ):
                VERIFIER.verify_payloads(
                    self.compose(environment), [], self.inspect(environment), self.service
                )

    def test_duplicate_container_key_fails_closed(self):
        environment = self.valid_environment()
        with self.assertRaisesRegex(VERIFIER.VerificationError, "duplicate keys"):
            VERIFIER.verify_payloads(
                self.compose(environment),
                [],
                self.inspect(environment, "LOCAL_LLM_MODEL=duplicate"),
                self.service,
            )

    def test_cli_malformed_input_does_not_echo_input_bytes(self):
        secret = "do-not-echo-this-secret"
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            compose_path = root / "compose.json"
            image_path = root / "image.json"
            inspect_path = root / "inspect.json"
            compose_path.write_text(secret, encoding="utf-8")
            image_path.write_text(json.dumps([]), encoding="utf-8")
            inspect_path.write_text(json.dumps([]), encoding="utf-8")
            stdout = io.StringIO()
            stderr = io.StringIO()
            with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
                result = VERIFIER.main(
                    [
                        "--service",
                        self.service,
                        "--compose-json",
                        str(compose_path),
                        "--image-env-json",
                        str(image_path),
                        "--inspect-json",
                        str(inspect_path),
                    ]
                )

        self.assertEqual(result, 1)
        self.assertEqual(stdout.getvalue(), "")
        self.assertNotIn(secret, stderr.getvalue())


if __name__ == "__main__":
    unittest.main()
