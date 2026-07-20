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

    def probe_signage_endpoints(self, inventory, host):
        self.calls.append(("signage-endpoints", inventory, host))
        return {
            "signageEndpointAuthenticated": True,
            "signageImageSha256": "b" * 64,
        }

    def probe_kiosk_agents(self, inventory, host):
        self.calls.append(("kiosk-agents", inventory, host))
        return {
            "agentContainers": ["nfc-agent"],
            "authenticatedAgentEndpoints": [
                {"agent": "nfc-agent", "port": 7071}
            ],
            "pcscdRequired": True,
        }

    def probe_terminal_release_evidence(
        self,
        inventory,
        host,
        client_id,
        services,
        *,
        expected_agents=None,
        check_status_agent_result=True,
    ):
        self.calls.append(
            (
                "release-evidence",
                inventory,
                host,
                client_id,
                list(services),
                expected_agents,
                check_status_agent_result,
            )
        )
        if self.failure is not None:
            raise self.failure
        return {
            "currentSha": self.sha,
            "services": list(services),
            "oneshotServices": (
                ["status-agent.service"] if check_status_agent_result else []
            ),
            "authenticatedEndpoint": True,
            "statusClientId": client_id,
            "agentContainers": ["nfc-agent"],
            "authenticatedAgentEndpoints": [
                {"agent": "nfc-agent", "port": 7071}
            ],
            "pcscdRequired": True,
        }


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
        self.assertEqual(observed["agentContainers"], ["nfc-agent"])
        self.assertTrue(observed["pcscdRequired"])
        self.assertEqual(
            runtime.calls,
            [
                (
                    "release-evidence",
                    "inventory.yml",
                    "kiosk-a",
                    "client-a",
                    [
                        "lightdm.service",
                        "kiosk-browser.service",
                        "status-agent.timer",
                    ],
                    None,
                    True,
                )
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
        self.assertTrue(observed["signageEndpointAuthenticated"])
        self.assertEqual(observed["signageImageSha256"], "b" * 64)

    def test_signage_specific_credential_failure_is_not_hidden_by_status_identity(self):
        runtime = TerminalRuntime()
        runtime.probe_signage_endpoints = lambda *_args: (_ for _ in ()).throw(
            RuntimeError("signage key rejected")
        )

        with self.assertRaisesRegex(RuntimeError, "signage key rejected"):
            evidence.observe_terminal(
                "inventory.yml", "signage-a", "signage", "client-s", runtime=runtime
            )

    def test_each_required_service_must_succeed_independently(self):
        failure = subprocess.CalledProcessError(3, ["terminal-release-evidence"])
        runtime = TerminalRuntime(failure=failure)
        with self.assertRaises(subprocess.CalledProcessError):
            evidence.observe_terminal(
                "inventory.yml", "kiosk-a", "kiosk", "client-a", runtime=runtime
            )
        self.assertEqual(runtime.calls[0][0], "release-evidence")

    def test_status_agent_oneshot_result_must_be_success(self):
        runtime = TerminalRuntime(
            failure=subprocess.CalledProcessError(
                1, ["terminal-release-evidence"]
            )
        )
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
        with self.assertRaisesRegex(RuntimeError, "release evidence is malformed"):
            evidence.observe_terminal(
                "inventory.yml", "kiosk-a", "kiosk", "client-a", runtime=malformed
            )
        self.assertEqual(malformed.calls[0][0], "release-evidence")

    def test_authenticated_endpoint_must_return_the_expected_identity(self):
        runtime = TerminalRuntime()
        original = runtime.probe_terminal_release_evidence

        def wrong_identity(*args, **kwargs):
            result = original(*args, **kwargs)
            result["statusClientId"] = "other-client"
            return result

        runtime.probe_terminal_release_evidence = wrong_identity
        with self.assertRaisesRegex(RuntimeError, "release evidence is malformed"):
            evidence.observe_terminal(
                "inventory.yml", "kiosk-a", "kiosk", "client-a", runtime=runtime
            )

    def test_agent_failure_after_playbook_fails_final_kiosk_observation(self):
        runtime = TerminalRuntime()
        runtime.probe_terminal_release_evidence = lambda *_args, **_kwargs: (_ for _ in ()).throw(
            RuntimeError("nfc-agent died after playbook")
        )

        with self.assertRaisesRegex(RuntimeError, "died after playbook"):
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
        live_health_status="verified",
        migration_status="applied",
        migration_sha=None,
        live_migration_digest="sha256:" + "e" * 64,
        migration_error=None,
        run_scoped=False,
    ):
        self.PROJECT = project
        self.sha = sha
        self.image_sha = image_sha
        self.runtime_config_status = runtime_config_status
        self.runtime_config_digest = runtime_config_digest
        self.live_health_status = live_health_status
        self.migration_status = migration_status
        self.migration_sha = migration_sha or image_sha
        self.live_migration_digest = live_migration_digest
        self.migration_error = migration_error
        self.run_scoped = run_scoped
        self.calls = []

    def run(self, command, **kwargs):
        self.calls.append((command, kwargs))
        if command[0] == "git":
            return self.sha + "\n"
        return "active\n"

    def phase3_status(self):
        suffix = "-0123456789ab"
        if self.run_scoped:
            suffix += "-" + "9" * 64
        return {
            "runtimeStatus": "consistent",
            "liveHealthStatus": self.live_health_status,
            "runtimeConfigStatus": self.runtime_config_status,
            "runtimeConfigDigest": self.runtime_config_digest,
            "activeSlot": "green",
            "previousSlot": None,
            "candidateSlot": None,
            "stableUntil": None,
            "gateway": {"mode": "application", "slot": "green"},
            "monitor": {"activeSlot": None, "rollbackSlot": None},
            "migration": {
                "status": self.migration_status,
                "candidateCommit": self.migration_sha,
                "appliedAt": "2026-07-15T00:00:00Z",
            },
            "slots": {
                "green": {
                    "images": {
                        "api": "raspi/api:" + self.image_sha + suffix,
                        "web": "raspi/web:" + self.image_sha + suffix,
                    },
                    "imageIds": {
                        "api": "sha256:" + "1" * 64,
                        "web": "sha256:" + "2" * 64,
                    },
                }
            },
        }

    @staticmethod
    def normalized_pi5_phase3_state(phase3):
        return (
            phase3.get("runtimeStatus") == "consistent"
            and phase3.get("liveHealthStatus") == "verified"
        )

    @staticmethod
    def candidate_image_matches_sha(image, sha):
        return isinstance(image, str) and image.split(":", 1)[1].startswith(sha + "-")

    def verify_pi5_live_migrations(self, sha):
        self.calls.append((["verify-pi5-live-migrations", sha], {"capture": True}))
        if self.migration_error is not None:
            raise RuntimeError(self.migration_error)
        return self.live_migration_digest


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
        self.assertEqual(observed["apiImageId"], "sha256:" + "1" * 64)
        self.assertEqual(observed["webImageId"], "sha256:" + "2" * 64)
        self.assertRegex(observed["configDigest"], r"^sha256:[0-9a-f]{64}$")
        self.assertEqual(observed["runtimeConfigDigest"], "sha256:" + "f" * 64)
        self.assertEqual(observed["migrationDigest"], "sha256:" + "e" * 64)
        self.assertIn(
            (["systemctl", "is-active", "status-agent.timer"], {"capture": True}),
            runtime.calls,
        )

    def test_observation_accepts_legacy_and_run_scoped_immutable_tags(self):
        with tempfile.TemporaryDirectory() as temporary:
            project = Path(temporary)
            self.project(project)
            for run_scoped in (False, True):
                with self.subTest(run_scoped=run_scoped):
                    observed = evidence.observe_pi5(
                        SHA,
                        runtime=Pi5Runtime(project, run_scoped=run_scoped),
                    )
                    self.assertEqual(observed["currentSha"], SHA)

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

    def test_live_api_web_health_must_be_verified(self):
        with tempfile.TemporaryDirectory() as temporary:
            project = Path(temporary)
            self.project(project)
            with self.assertRaisesRegex(RuntimeError, "not normalized"):
                evidence.observe_pi5(
                    SHA,
                    runtime=Pi5Runtime(project, live_health_status="failed"),
                )

    def test_live_migration_ledger_is_required_even_when_no_new_migration_exists(self):
        with tempfile.TemporaryDirectory() as temporary:
            project = Path(temporary)
            self.project(project)
            observed = evidence.observe_pi5(SHA, runtime=Pi5Runtime(project))
            self.assertEqual(observed["migrationDigest"], "sha256:" + "e" * 64)

            for message in (
                "candidate migration is not applied: missing",
                "applied migration checksum mismatch: changed",
            ):
                with self.subTest(message=message), self.assertRaisesRegex(
                    RuntimeError, re.escape(message)
                ):
                    evidence.observe_pi5(
                        SHA,
                        runtime=Pi5Runtime(project, migration_error=message),
                    )

    def test_phase3_migration_state_must_match_the_active_release(self):
        with tempfile.TemporaryDirectory() as temporary:
            project = Path(temporary)
            self.project(project)
            for runtime in (
                Pi5Runtime(project, migration_status="checked"),
                Pi5Runtime(project, migration_sha="b" * 40),
            ):
                with self.subTest(
                    status=runtime.migration_status, sha=runtime.migration_sha
                ), self.assertRaisesRegex(RuntimeError, "not applied"):
                    evidence.observe_pi5(SHA, runtime=runtime)


if __name__ == "__main__":
    unittest.main()
