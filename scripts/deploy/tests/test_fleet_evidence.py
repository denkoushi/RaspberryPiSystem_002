#!/usr/bin/env python3
from __future__ import annotations

import re
import subprocess
import tempfile
import unittest
from pathlib import Path

from scripts.deploy.rolling_release.backends import evidence


SHA = "a" * 40


class TerminalRuntime:
    FULL_SHA_RE = re.compile(r"^[0-9a-f]{40}$")
    ANSIBLE_DIRECTORY = Path('/ansible')

    def __init__(self, *, sha=SHA, failure=None):
        self.sha = sha
        self.failure = failure
        self.calls = []

    def remote_previous_sha(self, inventory, host):
        self.calls.append(("head", inventory, host))
        return self.sha

    def run(self, command, **kwargs):
        self.calls.append(("run", command, kwargs))
        if self.failure is not None:
            raise self.failure
        return "active\nactive\n"

    def probe_terminal_identity(self, inventory, host, client_id):
        self.calls.append(("identity", inventory, host, client_id))
        return {"authenticated": True, "statusClientId": client_id}


class TerminalEvidenceTest(unittest.TestCase):
    def test_kiosk_requires_exact_head_and_required_services(self):
        runtime = TerminalRuntime()
        observed = evidence.observe_terminal(
            "inventory.yml", "kiosk-a", "kiosk", "client-a", runtime=runtime
        )

        self.assertEqual(observed["currentSha"], SHA)
        self.assertEqual(
            observed["services"],
            ["lightdm.service", "kiosk-browser.service", "status-agent.timer"],
        )
        self.assertTrue(observed["authenticatedEndpoint"])
        self.assertEqual(observed["statusClientId"], "client-a")
        self.assertEqual(observed["oneshotServices"], ["status-agent.service"])
        self.assertTrue(
            all(
                call[2]['cwd'] == runtime.ANSIBLE_DIRECTORY
                for call in runtime.calls
                if call[0] == 'run'
            )
        )
        commands = [call[1] for call in runtime.calls if call[0] == "run"]
        self.assertEqual(len(commands), 4)
        self.assertTrue(
            all(command[:4] == ["ansible", "-i", "inventory.yml", "kiosk-a"] for command in commands)
        )
        self.assertEqual(
            [command[-1] for command in commands],
            [
                "systemctl is-active --quiet lightdm.service",
                "systemctl is-active --quiet kiosk-browser.service",
                "systemctl is-active --quiet status-agent.timer",
                'test "$(systemctl show --property=Result --value '
                'status-agent.service)" = success',
            ],
        )

    def test_signage_requires_display_and_every_operational_timer(self):
        runtime = TerminalRuntime()
        observed = evidence.observe_terminal(
            "inventory.yml", "signage-a", "signage", "client-s", runtime=runtime
        )

        self.assertEqual(
            observed["services"],
            [
                "lightdm.service",
                "signage-lite.service",
                "signage-lite-update.timer",
                "signage-lite-watchdog.timer",
                "signage-daily-reboot.timer",
                "status-agent.timer",
            ],
        )
        commands = [call[1] for call in runtime.calls if call[0] == "run"]
        self.assertEqual(
            [command[-1] for command in commands[:-1]],
            [f"systemctl is-active --quiet {service}" for service in observed["services"]],
        )

    def test_each_required_service_must_succeed_independently(self):
        runtime = TerminalRuntime()
        original_run = runtime.run
        service_calls = 0

        def fail_second_service(command, **kwargs):
            nonlocal service_calls
            service_calls += 1
            if service_calls == 2:
                raise subprocess.CalledProcessError(3, command)
            return original_run(command, **kwargs)

        runtime.run = fail_second_service
        with self.assertRaises(subprocess.CalledProcessError):
            evidence.observe_terminal(
                "inventory.yml", "kiosk-a", "kiosk", "client-a", runtime=runtime
            )
        self.assertEqual(service_calls, 2)

    def test_status_agent_oneshot_result_must_be_success(self):
        runtime = TerminalRuntime()
        original_run = runtime.run

        def fail_oneshot(command, **kwargs):
            if command[5:7] == ["-m", "shell"]:
                raise subprocess.CalledProcessError(1, command)
            return original_run(command, **kwargs)

        runtime.run = fail_oneshot
        with self.assertRaises(subprocess.CalledProcessError):
            evidence.observe_terminal(
                "inventory.yml", "kiosk-a", "kiosk", "client-a", runtime=runtime
            )

    def test_signage_service_failure_and_non_sha_head_fail_closed(self):
        runtime = TerminalRuntime(
            failure=subprocess.CalledProcessError(1, ["ansible"])
        )
        with self.assertRaises(subprocess.CalledProcessError):
            evidence.observe_terminal(
                "inventory.yml", "signage-a", "signage", "client-s", runtime=runtime
            )

        malformed = TerminalRuntime(sha="main")
        with self.assertRaisesRegex(RuntimeError, "not immutable"):
            evidence.observe_terminal(
                "inventory.yml", "kiosk-a", "kiosk", "client-a", runtime=malformed
            )
        self.assertEqual(malformed.calls, [("head", "inventory.yml", "kiosk-a")])

    def test_authenticated_endpoint_must_return_the_expected_identity(self):
        runtime = TerminalRuntime()
        runtime.probe_terminal_identity = lambda *_args: {
            "authenticated": True,
            "statusClientId": "other-client",
        }
        with self.assertRaisesRegex(RuntimeError, "not authenticated"):
            evidence.observe_terminal(
                "inventory.yml", "kiosk-a", "kiosk", "client-a", runtime=runtime
            )


class Pi5Runtime:
    FULL_SHA_RE = re.compile(r"^[0-9a-f]{40}$")

    def __init__(
        self,
        project: Path,
        *,
        sha=SHA,
        image_sha=SHA,
        runtime_config_status="verified",
        runtime_config_digest="sha256:" + "f" * 64,
    ):
        self.PROJECT = project
        self.sha = sha
        self.image_sha = image_sha
        self.runtime_config_status = runtime_config_status
        self.runtime_config_digest = runtime_config_digest
        self.calls = []

    def run(self, command, **kwargs):
        self.calls.append((command, kwargs))
        if command[0] == "git":
            return self.sha + "\n"
        return "active\n"

    def phase3_status(self):
        suffix = "-0123456789ab"
        return {
            "runtimeStatus": "consistent",
            "runtimeConfigStatus": self.runtime_config_status,
            "runtimeConfigDigest": self.runtime_config_digest,
            "activeSlot": "green",
            "previousSlot": None,
            "candidateSlot": None,
            "stableUntil": None,
            "gateway": {"mode": "application", "slot": "green"},
            "monitor": {"activeSlot": None, "rollbackSlot": None},
            "slots": {
                "green": {
                    "images": {
                        "api": "raspi/api:" + self.image_sha + suffix,
                        "web": "raspi/web:" + self.image_sha + suffix,
                    }
                }
            },
        }

    @staticmethod
    def normalized_pi5_phase3_state(phase3):
        return phase3.get("runtimeStatus") == "consistent"

    @staticmethod
    def candidate_image_matches_sha(image, sha):
        return isinstance(image, str) and image.split(":", 1)[1].startswith(sha + "-")


class Pi5EvidenceTest(unittest.TestCase):
    CONFIG_FILES = (
        "infrastructure/docker/.env",
        "infrastructure/docker/docker-compose.phase3.yml",
        "infrastructure/docker/Caddyfile.gateway.template",
        "infrastructure/docker/Caddyfile.gateway.maintenance.template",
        "infrastructure/docker/Caddyfile.slot.template",
    )

    def project(self, root: Path):
        for name in self.CONFIG_FILES:
            path = root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(name + "\n", encoding="utf-8")
        migration = root / "apps/api/prisma/migrations/202607150001_test/migration.sql"
        migration.parent.mkdir(parents=True)
        migration.write_text("SELECT 1;\n", encoding="utf-8")

    def test_verified_observation_contains_runtime_and_content_digests(self):
        with tempfile.TemporaryDirectory() as temporary:
            project = Path(temporary)
            self.project(project)
            runtime = Pi5Runtime(project)

            observed = evidence.observe_pi5(SHA, runtime=runtime)

        self.assertEqual(observed["currentSha"], SHA)
        self.assertEqual(observed["activeSlot"], "green")
        self.assertTrue(observed["apiImage"].startswith("raspi/api:" + SHA))
        self.assertRegex(observed["configDigest"], r"^sha256:[0-9a-f]{64}$")
        self.assertEqual(observed["runtimeConfigDigest"], "sha256:" + "f" * 64)
        self.assertRegex(observed["migrationDigest"], r"^sha256:[0-9a-f]{64}$")
        self.assertIn(
            (["systemctl", "is-active", "status-agent.timer"], {"capture": True}),
            runtime.calls,
        )

    def test_expected_head_and_image_identity_are_mandatory(self):
        with tempfile.TemporaryDirectory() as temporary:
            project = Path(temporary)
            self.project(project)
            with self.assertRaisesRegex(RuntimeError, "desired release"):
                evidence.observe_pi5("b" * 40, runtime=Pi5Runtime(project))
            with self.assertRaisesRegex(RuntimeError, "API image"):
                evidence.observe_pi5(
                    SHA, runtime=Pi5Runtime(project, image_sha="b" * 40)
                )

    def test_baseline_rejects_digests_from_a_different_checkout_release(self):
        with tempfile.TemporaryDirectory() as temporary:
            project = Path(temporary)
            self.project(project)
            old_sha = "b" * 40

            with self.assertRaisesRegex(RuntimeError, "cannot be attributed"):
                evidence.observe_pi5(
                    None, runtime=Pi5Runtime(project, sha=SHA, image_sha=old_sha)
                )

    def test_runtime_configuration_must_be_live_verified(self):
        with tempfile.TemporaryDirectory() as temporary:
            project = Path(temporary)
            self.project(project)
            with self.assertRaisesRegex(RuntimeError, "environment is not verified"):
                evidence.observe_pi5(
                    SHA,
                    runtime=Pi5Runtime(
                        project,
                        runtime_config_status="mismatch",
                        runtime_config_digest=None,
                    ),
                )
            with self.assertRaisesRegex(RuntimeError, "digest is malformed"):
                evidence.observe_pi5(
                    SHA,
                    runtime=Pi5Runtime(
                        project,
                        runtime_config_status="verified",
                        runtime_config_digest="sha256:not-a-digest",
                    ),
                )


if __name__ == "__main__":
    unittest.main()
