#!/usr/bin/env python3
from __future__ import annotations

import base64
import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from scripts.deploy.rolling_release.backends import ansible


class Runtime:
    ANSIBLE_DIRECTORY = Path('/ansible')
    PROJECT = Path('/project')
    def __init__(self, result):
        self.result = result
        self.calls = []
        self.state_calls = []

    def run(self, command, **kwargs):
        self.calls.append((command, kwargs))
        result = self.result.pop(0) if isinstance(self.result, list) else self.result
        if isinstance(result, BaseException):
            raise result
        return result

    def state_command(self, *arguments):
        self.state_calls.append(arguments)


def manifest_marker(value):
    encoded = base64.urlsafe_b64encode(
        json.dumps(value, sort_keys=True).encode("utf-8")
    ).decode("ascii")
    return f"ROLLBACK_MANIFEST_RESULT:{encoded}"


def baseline_marker(value):
    encoded = base64.urlsafe_b64encode(
        json.dumps(value, sort_keys=True).encode("utf-8")
    ).decode("ascii")
    return f"TERMINAL_REPOSITORY_BASELINE_RESULT:{encoded}"


def runtime_marker(value):
    encoded = base64.urlsafe_b64encode(
        json.dumps(value, sort_keys=True).encode("utf-8")
    ).decode("ascii")
    return f"TERMINAL_RUNTIME_MANIFEST_RESULT:{encoded}"


class SelectedHostsTest(unittest.TestCase):
    def test_empty_limit_skips_ansible(self):
        runtime = Runtime("unused")
        self.assertIsNone(ansible.selected_hosts("inventory.yml", "", runtime=runtime))
        self.assertEqual(runtime.calls, [])

    def test_zero_match_is_an_explicit_empty_selection(self):
        error = subprocess.CalledProcessError(
            1,
            ["ansible"],
            output="  hosts (0):\n",
            stderr="[WARNING]: No hosts matched\n",
        )
        runtime = Runtime(error)

        self.assertEqual(
            ansible.selected_hosts(
                "inventory.yml", "missing-host", runtime=runtime
            ),
            [],
        )

    def test_non_zero_match_failure_is_not_hidden(self):
        error = subprocess.CalledProcessError(
            2,
            ["ansible"],
            output="",
            stderr="inventory could not be parsed",
        )
        runtime = Runtime(error)

        with self.assertRaises(subprocess.CalledProcessError):
            ansible.selected_hosts(
                "inventory.yml", "kiosk", runtime=runtime
            )

    def test_successful_output_preserves_inventory_order(self):
        runtime = Runtime("  hosts (2):\n    kiosk-b\n    kiosk-a\n")
        selected = ansible.selected_hosts(
            "inventory.yml", "kiosk", runtime=runtime
        )
        self.assertEqual(selected, ["kiosk-b", "kiosk-a"])
        self.assertEqual(runtime.calls[0][1]['cwd'], runtime.ANSIBLE_DIRECTORY)


class TerminalRepositoryBaselineAdapterTest(unittest.TestCase):
    def test_clean_and_legacy_repaired_results_are_strictly_forwarded(self):
        for repaired, count in ((False, 0), (True, 17)):
            with self.subTest(repaired=repaired):
                result = {
                    "head": "a" * 40,
                    "repairedLegacyDocs": repaired,
                    "count": count,
                }
                runtime = Runtime(baseline_marker(result) + "\n" + baseline_marker(result))

                self.assertEqual(
                    ansible.prepare_terminal_repository(
                        "inventory.yml", "kiosk-a", runtime=runtime
                    ),
                    result,
                )

                command, options = runtime.calls[0]
                self.assertEqual(
                    command[:5], ["ansible", "-i", "inventory.yml", "kiosk-a", "-m"]
                )
                self.assertNotIn("-b", command)
                self.assertIn(
                    "/project/scripts/deploy/terminal-repository-baseline.py",
                    command[-1],
                )
                self.assertIn(
                    "--repository /opt/RaspberryPiSystem_002", command[-1]
                )
                self.assertTrue(options["capture"])

    def test_malformed_or_disagreeing_result_fails_closed(self):
        bad_results = (
            {"head": "main", "repairedLegacyDocs": False, "count": 0},
            {"head": "a" * 40, "repairedLegacyDocs": True, "count": 0},
            {"head": "a" * 40, "repairedLegacyDocs": False, "count": 1},
            {
                "head": "a" * 40,
                "repairedLegacyDocs": False,
                "count": 0,
                "extra": True,
            },
        )
        for result in bad_results:
            with self.subTest(result=result), self.assertRaisesRegex(
                RuntimeError, "baseline result is invalid"
            ):
                ansible.prepare_terminal_repository(
                    "inventory.yml", "kiosk-a", runtime=Runtime(baseline_marker(result))
                )

        with self.assertRaisesRegex(RuntimeError, "callback results disagree"):
            ansible._repository_baseline_marker(
                baseline_marker(
                    {"head": "a" * 40, "repairedLegacyDocs": False, "count": 0}
                )
                + "\n"
                + baseline_marker(
                    {"head": "b" * 40, "repairedLegacyDocs": False, "count": 0}
                )
            )

    def test_invalid_host_is_rejected_before_remote_execution(self):
        runtime = Runtime("unused")
        with self.assertRaises(ValueError):
            ansible.prepare_terminal_repository(
                "inventory.yml", "bad host", runtime=runtime
            )
        self.assertEqual(runtime.calls, [])


class RollbackManifestAdapterTest(unittest.TestCase):
    RUN_ID = "run-123"
    HOST = "kiosk-a"
    PREVIOUS_SHA = "a" * 40
    DIGEST = "c" * 64
    RUNTIME_DIGEST = "d" * 64

    def _capture_result(self, terminal_type="kiosk"):
        user = "tools03" if terminal_type == "kiosk" else "signageras3"
        home = f"/home/{user}"
        paths = ansible._terminal_manifest_paths(
            terminal_type, user, home, self.RUN_ID
        )
        return paths, {
            "captured": True,
            "manifest": (
                "/var/lib/raspi-release/rollback-manifests/"
                f"{self.RUN_ID}/{self.HOST}/manifest.json"
            ),
            "manifestSha256": self.DIGEST,
            "count": len(paths),
            "destinations": paths,
            "repository": {
                "path": "/opt/RaspberryPiSystem_002",
                "head": self.PREVIOUS_SHA,
            },
        }

    def _runtime_capture_result(self, terminal_type="kiosk"):
        units, docker_services = ansible._terminal_runtime_contract(terminal_type)
        return {
            "captured": True,
            "manifest": (
                "/var/lib/raspi-release/rollback-runtime/"
                f"{self.RUN_ID}/{self.HOST}/manifest.json"
            ),
            "manifestSha256": self.RUNTIME_DIGEST,
            "unitCount": len(units),
            "dockerCount": len(docker_services),
            "rollbackTags": [
                f"raspi-rollback/{self.RUN_ID}/{self.HOST}/{service}"
                for service in docker_services
            ],
        }

    def test_capture_seals_explicit_kiosk_paths_and_repository_head(self):
        paths, result = self._capture_result()
        self.assertTrue(
            {
                "/etc/sudoers.d/tools03",
                "/etc/sudoers.d/tools03-client-services",
                "/home/tools03/.config/autostart/ibus.desktop",
                "/home/tools03/.config/autostart/ibus-owner.desktop",
                "/home/tools03/.config/autostart/ibus-engine.desktop",
                "/home/tools03/.config/autostart/im-launch.desktop",
                "/home/tools03/.mozilla/firefox/kiosk-system/chrome/userChrome.css",
                "/home/tools03/.mozilla/firefox/kiosk-system/user.js",
                "/home/tools03/.config/labwc/rc.xml",
            }.issubset(paths)
        )
        identity = (
            "ROLLBACK_REMOTE_IDENTITY:tools03:/home/tools03\n"
            "ROLLBACK_REMOTE_IDENTITY:tools03:/home/tools03\n"
        )
        runtime_result = self._runtime_capture_result()
        runtime = Runtime(
            [identity, manifest_marker(result), runtime_marker(runtime_result)]
        )

        reference = ansible.capture_terminal_manifest(
            "inventory.yml",
            {"host": self.HOST, "terminalType": "kiosk"},
            self.RUN_ID,
            self.PREVIOUS_SHA,
            runtime=runtime,
        )

        self.assertEqual(
            reference,
            {
                "path": result["manifest"],
                "manifestSha256": self.DIGEST,
                "count": len(paths),
                "runtime": {
                    "path": runtime_result["manifest"],
                    "manifestSha256": self.RUNTIME_DIGEST,
                    "unitCount": runtime_result["unitCount"],
                    "dockerCount": runtime_result["dockerCount"],
                },
            },
        )
        identity_command = runtime.calls[0][0]
        self.assertNotIn("-b", identity_command)
        self.assertIn("ansible_become=false", identity_command)
        self.assertIn("ROLLBACK_REMOTE_IDENTITY", identity_command[-1])
        command, options = runtime.calls[1]
        self.assertEqual(command[0:7], [
            "ansible", "-i", "inventory.yml", self.HOST, "-b", "-m", "script"
        ])
        action = command[-1]
        self.assertIn("/project/scripts/deploy/rollback-manifest.py", action)
        self.assertIn("capture-set", action)
        self.assertIn("--repository /opt/RaspberryPiSystem_002", action)
        self.assertIn(f"--expected-head {self.PREVIOUS_SHA}", action)
        for path in paths:
            self.assertIn(f"--path {path}", action)
        self.assertNotIn("client-key", action)
        self.assertTrue(options["capture"])
        runtime_action = runtime.calls[2][0][-1]
        self.assertIn(
            "/project/scripts/deploy/terminal-runtime-manifest.py", runtime_action
        )
        self.assertIn(" capture ", f" {runtime_action} ")
        self.assertIn("--docker-service nfc-agent", runtime_action)
        self.assertIn("--docker-service barcode-agent", runtime_action)
        for unit in ansible._terminal_restart_on_restore_contract("kiosk"):
            self.assertIn(
                f"--restart-on-restore-unit {unit}", runtime_action
            )
        self.assertIn(
            "--compose-working-directory "
            "/opt/RaspberryPiSystem_002/infrastructure/docker",
            runtime_action,
        )
        self.assertIn(
            "--compose-config-file "
            "/opt/RaspberryPiSystem_002/infrastructure/docker/"
            "docker-compose.client.yml",
            runtime_action,
        )

    def test_capture_uses_signage_only_paths_and_run_scoped_prestage_file(self):
        paths, result = self._capture_result("signage")
        runtime = Runtime([
            "ROLLBACK_REMOTE_IDENTITY:signageras3:/home/signageras3\n",
            manifest_marker(result),
            runtime_marker(self._runtime_capture_result("signage")),
        ])

        ansible.capture_terminal_manifest(
            "inventory.yml",
            {"host": self.HOST, "terminalType": "signage"},
            self.RUN_ID,
            self.PREVIOUS_SHA,
            runtime=runtime,
        )
        runtime_action = runtime.calls[2][0][-1]
        for unit in ansible._terminal_restart_on_restore_contract("signage"):
            self.assertIn(
                f"--restart-on-restore-unit {unit}", runtime_action
            )

        action = runtime.calls[1][0][-1]
        self.assertIn(
            f"--path /run/signage/release-{self.RUN_ID}-maintenance.svg", action
        )
        self.assertIn("--path /etc/systemd/system/signage-lite.service", action)
        self.assertNotIn("--path /etc/systemd/system/kiosk-browser.service", action)
        runtime_action = runtime.calls[2][0][-1]
        self.assertIn("--unit signage-lite.service", runtime_action)
        self.assertIn("--unit signage-daily-reboot.timer", runtime_action)
        self.assertNotIn("--docker-service", runtime_action)

    def test_capture_rejects_malformed_identity_before_helper_execution(self):
        runtime = Runtime("ROLLBACK_REMOTE_IDENTITY:root:/root\n")
        with self.assertRaisesRegex(RuntimeError, "could not be resolved"):
            ansible.capture_terminal_manifest(
                "inventory.yml",
                {"host": self.HOST, "terminalType": "kiosk"},
                self.RUN_ID,
                self.PREVIOUS_SHA,
                runtime=runtime,
            )
        self.assertEqual(len(runtime.calls), 1)

    def test_capture_rejects_invalid_run_host_sha_without_remote_call(self):
        invalid_cases = (
            ({"host": "bad host", "terminalType": "kiosk"}, self.RUN_ID, self.PREVIOUS_SHA),
            ({"host": self.HOST, "terminalType": "other"}, self.RUN_ID, self.PREVIOUS_SHA),
            ({"host": self.HOST, "terminalType": "kiosk"}, "x", self.PREVIOUS_SHA),
            ({"host": self.HOST, "terminalType": "kiosk"}, self.RUN_ID, "main"),
        )
        for target_spec, run_id, sha in invalid_cases:
            with self.subTest(target_spec=target_spec, run_id=run_id, sha=sha):
                runtime = Runtime("unused")
                with self.assertRaises(ValueError):
                    ansible.capture_terminal_manifest(
                        "inventory.yml",
                        target_spec,
                        run_id,
                        sha,
                        runtime=runtime,
                    )
                self.assertEqual(runtime.calls, [])

    def test_marker_allows_identical_callback_duplicates_only(self):
        marker = manifest_marker({"restored": True})
        self.assertEqual(
            ansible._manifest_marker(f"{marker}\n{marker}\n"),
            {"restored": True},
        )
        with self.assertRaisesRegex(RuntimeError, "disagree"):
            ansible._manifest_marker(
                marker + "\n" + manifest_marker({"restored": False})
            )

    def test_marker_rejects_noncanonical_base64_and_duplicate_json_keys(self):
        malformed = "ROLLBACK_MANIFEST_RESULT:AAAA=A=="
        with self.assertRaisesRegex(RuntimeError, "malformed"):
            ansible._manifest_marker(malformed)
        duplicate_json = base64.urlsafe_b64encode(b'{"a":1,"a":2}').decode("ascii")
        with self.assertRaisesRegex(RuntimeError, "malformed"):
            ansible._manifest_marker(
                "ROLLBACK_MANIFEST_RESULT:" + duplicate_json
            )

    def test_capture_rejects_wrong_repository_proof(self):
        _paths, result = self._capture_result()
        result["repository"]["head"] = "b" * 40
        runtime = Runtime([
            "ROLLBACK_REMOTE_IDENTITY:tools03:/home/tools03\n",
            manifest_marker(result),
        ])
        with self.assertRaisesRegex(RuntimeError, "capture result is invalid"):
            ansible.capture_terminal_manifest(
                "inventory.yml",
                {"host": self.HOST, "terminalType": "kiosk"},
                self.RUN_ID,
                self.PREVIOUS_SHA,
                runtime=runtime,
            )

    def test_capture_rejects_malformed_runtime_result_without_type_confusion(self):
        _paths, result = self._capture_result()
        runtime_result = self._runtime_capture_result()
        runtime_result["rollbackTags"] = [{"not": "a string"}]
        runtime = Runtime([
            "ROLLBACK_REMOTE_IDENTITY:tools03:/home/tools03\n",
            manifest_marker(result),
            runtime_marker(runtime_result),
        ])
        with self.assertRaisesRegex(RuntimeError, "runtime manifest capture result"):
            ansible.capture_terminal_manifest(
                "inventory.yml",
                {"host": self.HOST, "terminalType": "kiosk"},
                self.RUN_ID,
                self.PREVIOUS_SHA,
                runtime=runtime,
            )

    def _rollback_target(self, count=2):
        return {
            "state": "rolling-back",
            "previousSha": self.PREVIOUS_SHA,
            "rollbackManifest": {
                "path": (
                    "/var/lib/raspi-release/rollback-manifests/"
                    f"{self.RUN_ID}/{self.HOST}/manifest.json"
                ),
                "manifestSha256": self.DIGEST,
                "count": count,
                "runtime": {
                    "path": (
                        "/var/lib/raspi-release/rollback-runtime/"
                        f"{self.RUN_ID}/{self.HOST}/manifest.json"
                    ),
                    "manifestSha256": self.RUNTIME_DIGEST,
                    "unitCount": len(
                        ansible._terminal_runtime_contract("kiosk")[0]
                    ),
                    "dockerCount": len(
                        ansible._terminal_runtime_contract("kiosk")[1]
                    ),
                },
            },
        }

    def _restore_result(self):
        return {
            "restored": True,
            "manifest": (
                "/var/lib/raspi-release/rollback-manifests/"
                f"{self.RUN_ID}/{self.HOST}/manifest.json"
            ),
            "manifestSha256": self.DIGEST,
            "count": 2,
            "destinations": ["/etc/one", "/etc/two"],
            "repository": {
                "path": "/opt/RaspberryPiSystem_002",
                "head": self.PREVIOUS_SHA,
            },
        }

    def _runtime_restore_result(self, terminal_type="kiosk"):
        units, docker_services = ansible._terminal_runtime_contract(terminal_type)
        return {
            "restored": True,
            "manifestSha256": self.RUNTIME_DIGEST,
            "unitCount": len(units),
            "dockerCount": len(docker_services),
        }

    def test_rollback_restores_exact_file_and_runtime_manifests_without_playbook(self):
        runtime = Runtime([
            manifest_marker(self._restore_result()),
            self.PREVIOUS_SHA + "\n",
            runtime_marker(self._runtime_restore_result()),
        ])
        target = self._rollback_target()

        self.assertTrue(
            ansible.rollback_terminal(
                "inventory.yml",
                {"host": self.HOST, "terminalType": "kiosk"},
                target,
                self.RUN_ID,
                runtime=runtime,
            )
        )

        self.assertEqual(target["rollback"], "success")
        restore_action = runtime.calls[0][0][-1]
        self.assertIn(" restore ", f" {restore_action} ")
        self.assertIn(
            f"--expected-manifest-sha256 {self.DIGEST}", restore_action
        )
        self.assertNotIn("ansible-playbook", " ".join(runtime.calls[0][0]))
        self.assertIn("rev-parse HEAD", runtime.calls[1][0][-1])
        runtime_restore = runtime.calls[2][0][-1]
        self.assertIn("terminal-runtime-manifest.py", runtime_restore)
        self.assertIn(" restore ", f" {runtime_restore} ")
        self.assertIn(
            f"--expected-manifest-sha256 {self.RUNTIME_DIGEST}",
            runtime_restore,
        )

    def test_signage_rollback_uses_the_exact_signage_runtime_manifest(self):
        target = self._rollback_target()
        units, docker_services = ansible._terminal_runtime_contract("signage")
        target["rollbackManifest"]["runtime"]["unitCount"] = len(units)
        target["rollbackManifest"]["runtime"]["dockerCount"] = len(
            docker_services
        )
        runtime = Runtime([
            manifest_marker(self._restore_result()),
            self.PREVIOUS_SHA + "\n",
            runtime_marker(self._runtime_restore_result("signage")),
        ])
        self.assertTrue(
            ansible.rollback_terminal(
                "inventory.yml",
                {"host": self.HOST, "terminalType": "signage"},
                target,
                self.RUN_ID,
                runtime=runtime,
            )
        )
        self.assertIn("terminal-runtime-manifest.py", runtime.calls[2][0][-1])

    def test_rollback_rejects_tampered_reference_without_remote_mutation(self):
        for field in ("file", "runtime"):
            with self.subTest(field=field):
                target = self._rollback_target()
                if field == "file":
                    target["rollbackManifest"]["path"] = "/tmp/other/manifest.json"
                else:
                    target["rollbackManifest"]["runtime"]["path"] = (
                        "/tmp/other-runtime/manifest.json"
                    )
                runtime = Runtime("unused")
                self.assertFalse(
                    ansible.rollback_terminal(
                        "inventory.yml",
                        {"host": self.HOST, "terminalType": "kiosk"},
                        target,
                        self.RUN_ID,
                        runtime=runtime,
                    )
                )
                self.assertEqual(runtime.calls, [])
                self.assertIn("failed:", target["rollback"])

    def test_rollback_rejects_runtime_restore_result_mismatch(self):
        runtime_result = self._runtime_restore_result()
        runtime_result["unitCount"] += 1
        runtime = Runtime([
            manifest_marker(self._restore_result()),
            self.PREVIOUS_SHA + "\n",
            runtime_marker(runtime_result),
        ])
        target = self._rollback_target()
        self.assertFalse(
            ansible.rollback_terminal(
                "inventory.yml",
                {"host": self.HOST, "terminalType": "kiosk"},
                target,
                self.RUN_ID,
                runtime=runtime,
            )
        )
        self.assertIn("runtime restore result is invalid", target["rollback"])

    def test_rollback_fails_closed_when_restored_head_does_not_match(self):
        runtime = Runtime([
            manifest_marker(self._restore_result()),
            "b" * 40 + "\n",
        ])
        target = self._rollback_target()
        self.assertFalse(
            ansible.rollback_terminal(
                "inventory.yml",
                {"host": self.HOST, "terminalType": "kiosk"},
                target,
                self.RUN_ID,
                runtime=runtime,
            )
        )
        self.assertEqual(len(runtime.calls), 2)
        self.assertIn("HEAD was not restored", target["rollback"])

    def test_cleanup_removes_only_the_sealed_runtime_tags(self):
        target = self._rollback_target()
        result = {
            "cleaned": True,
            "alreadyClean": False,
            "manifestSha256": self.RUNTIME_DIGEST,
            "tagCount": 2,
            "outcome": "committed",
        }
        runtime = Runtime(runtime_marker(result))

        self.assertEqual(
            ansible.cleanup_terminal_rollback(
                "inventory.yml",
                {"host": self.HOST, "terminalType": "kiosk"},
                target,
                self.RUN_ID,
                "committed",
                runtime=runtime,
            ),
            result,
        )
        action = runtime.calls[0][0][-1]
        self.assertIn("terminal-runtime-manifest.py", action)
        self.assertIn(" cleanup ", f" {action} ")
        self.assertIn("--outcome committed", action)
        self.assertIn(
            f"--expected-manifest-sha256 {self.RUNTIME_DIGEST}", action
        )

    def test_cleanup_rejects_bad_reference_and_bad_result(self):
        target = self._rollback_target()
        target["rollbackManifest"]["runtime"]["path"] = "/tmp/runtime.json"
        runtime = Runtime("unused")
        with self.assertRaisesRegex(RuntimeError, "runtime manifest identity"):
            ansible.cleanup_terminal_rollback(
                "inventory.yml",
                {"host": self.HOST, "terminalType": "kiosk"},
                target,
                self.RUN_ID,
                "committed",
                runtime=runtime,
            )
        self.assertEqual(runtime.calls, [])

        target = self._rollback_target()
        malformed = {
            "cleaned": True,
            "alreadyClean": True,
            "manifestSha256": self.RUNTIME_DIGEST,
            "tagCount": 1,
            "outcome": "restored",
        }
        with self.assertRaisesRegex(RuntimeError, "cleanup result is invalid"):
            ansible.cleanup_terminal_rollback(
                "inventory.yml",
                {"host": self.HOST, "terminalType": "kiosk"},
                target,
                self.RUN_ID,
                "restored",
                runtime=Runtime(runtime_marker(malformed)),
            )


class ServerConfigManifestAdapterTest(unittest.TestCase):
    HOST = "pi5"
    RUN_ID = "run-server-config"
    DIGEST = "a" * 64

    def _reference(self):
        return {
            "path": (
                "/var/lib/raspi-release/rollback-manifests/"
                f"{self.RUN_ID}/{self.HOST}/manifest.json"
            ),
            "manifestSha256": self.DIGEST,
            "count": len(ansible._SERVER_CONFIG_PATHS),
        }

    def _capture_result(self):
        reference = self._reference()
        return {
            "captured": True,
            "manifest": reference["path"],
            "manifestSha256": reference["manifestSha256"],
            "count": reference["count"],
            "destinations": list(ansible._SERVER_CONFIG_PATHS),
            "repository": None,
        }

    def _restore_result(self):
        reference = self._reference()
        return {
            "restored": True,
            "manifest": reference["path"],
            "manifestSha256": reference["manifestSha256"],
            "count": reference["count"],
            "destinations": list(ansible._SERVER_CONFIG_PATHS),
            "repository": None,
        }

    def test_capture_seals_only_the_three_server_environment_files(self):
        runtime = Runtime(manifest_marker(self._capture_result()))

        self.assertEqual(
            ansible.capture_server_config_manifest(
                "inventory.yml",
                self.HOST,
                self.RUN_ID,
                runtime=runtime,
            ),
            self._reference(),
        )

        command, options = runtime.calls[0]
        self.assertEqual(
            command[:7],
            [
                "ansible",
                "-i",
                "inventory.yml",
                self.HOST,
                "-b",
                "-m",
                "script",
            ],
        )
        action = command[-1]
        self.assertIn("rollback-manifest.py", action)
        self.assertIn(" capture-set ", f" {action} ")
        for path in ansible._SERVER_CONFIG_PATHS:
            self.assertIn(f"--path {path}", action)
        self.assertNotIn("--repository", action)
        self.assertNotIn("terminal-runtime-manifest.py", action)
        self.assertTrue(options["capture"])

    def test_restore_accepts_only_the_exact_run_scoped_reference(self):
        runtime = Runtime(manifest_marker(self._restore_result()))

        result = ansible.restore_server_config_manifest(
            "inventory.yml",
            self.HOST,
            self.RUN_ID,
            self._reference(),
            runtime=runtime,
        )

        self.assertTrue(result["restored"])
        action = runtime.calls[0][0][-1]
        self.assertIn(" restore ", f" {action} ")
        self.assertIn(
            f"--expected-manifest-sha256 {self.DIGEST}", action
        )
        self.assertNotIn("terminal-runtime-manifest.py", action)

    def test_restore_rejects_tampered_reference_before_remote_mutation(self):
        invalid = self._reference()
        invalid["path"] = "/tmp/manifest.json"
        runtime = Runtime("unused")

        with self.assertRaisesRegex(RuntimeError, "identity is invalid"):
            ansible.restore_server_config_manifest(
                "inventory.yml",
                self.HOST,
                self.RUN_ID,
                invalid,
                runtime=runtime,
            )

        self.assertEqual(runtime.calls, [])

    def test_capture_and_restore_fail_closed_on_changed_destination_set(self):
        capture = self._capture_result()
        capture["destinations"] = list(reversed(capture["destinations"]))
        with self.assertRaisesRegex(RuntimeError, "capture result is invalid"):
            ansible.capture_server_config_manifest(
                "inventory.yml",
                self.HOST,
                self.RUN_ID,
                runtime=Runtime(manifest_marker(capture)),
            )

        restored = self._restore_result()
        restored["destinations"] = restored["destinations"][:-1]
        with self.assertRaisesRegex(RuntimeError, "restore result is invalid"):
            ansible.restore_server_config_manifest(
                "inventory.yml",
                self.HOST,
                self.RUN_ID,
                self._reference(),
                runtime=Runtime(manifest_marker(restored)),
            )


class ServerConfigConvergenceTest(unittest.TestCase):
    def _manifest(self):
        return {
            "path": (
                "/var/lib/raspi-release/rollback-manifests/"
                "run-1/pi5/manifest.json"
            ),
            "manifestSha256": "b" * 64,
            "count": len(ansible._SERVER_CONFIG_PATHS),
        }

    def _restore_result(self):
        manifest = self._manifest()
        return {
            "restored": True,
            "manifest": manifest["path"],
            "manifestSha256": manifest["manifestSha256"],
            "count": manifest["count"],
            "destinations": list(ansible._SERVER_CONFIG_PATHS),
            "repository": None,
        }

    def test_uses_host_config_only_mode_and_immutable_revision(self):
        runtime = Runtime("")

        ansible.converge_server_config(
            "inventory.yml",
            "pi5",
            "a" * 40,
            "run-1",
            self._manifest(),
            runtime=runtime,
        )

        command, options = runtime.calls[0]
        self.assertEqual(
            command,
            [
                "ansible-playbook",
                "-i",
                "inventory.yml",
                "/ansible/playbooks/server-config-release.yml",
                "--limit",
                "pi5",
                "-e",
                "release_orchestrated=true release_rollback=false "
                "server_release_mode=host-config-only",
            ],
        )
        self.assertEqual(options["cwd"], runtime.ANSIBLE_DIRECTORY)
        self.assertEqual(options["env"]["ANSIBLE_REPO_VERSION"], "a" * 40)
        self.assertEqual(options["env"]["RUN_ID"], "run-1")
        self.assertEqual(options["env"]["RELEASE_ORCHESTRATED"], "1")

    def test_failure_is_returned_to_the_coordinator_without_hidden_restore(self):
        failure = subprocess.CalledProcessError(2, ["ansible-playbook"])
        runtime = Runtime(failure)

        with self.assertRaises(subprocess.CalledProcessError):
            ansible.converge_server_config(
                "inventory.yml",
                "pi5",
                "a" * 40,
                "run-1",
                self._manifest(),
                runtime=runtime,
            )

        self.assertEqual(runtime.calls[0][0][0], "ansible-playbook")
        self.assertEqual(len(runtime.calls), 1)

    def test_requires_sealed_manifest_before_execution(self):
        runtime = Runtime("")

        with self.assertRaises(TypeError):
            ansible.converge_server_config(
                "inventory.yml",
                "pi5",
                "a" * 40,
                "run-1",
                runtime=runtime,
            )

        self.assertEqual(runtime.calls, [])

    def test_rejects_mutable_revision_and_malformed_identity_without_execution(self):
        for host, revision, run_id in (
            ("bad host", "a" * 40, "run-1"),
            ("pi5", "main", "run-1"),
            ("pi5", "a" * 40, "x"),
        ):
            with self.subTest(host=host, revision=revision, run_id=run_id):
                runtime = Runtime("")
                with self.assertRaises(ValueError):
                    ansible.converge_server_config(
                        "inventory.yml",
                        host,
                        revision,
                        run_id,
                        self._manifest(),
                        runtime=runtime,
                    )
                self.assertEqual(runtime.calls, [])


class TerminalReleasePlaybookTest(unittest.TestCase):
    def test_terminal_playbook_uses_release_only_mutation_profile(self):
        runtime = Runtime("")
        ansible.playbook(
            "inventory.yml",
            "kiosk-a",
            "a" * 40,
            "run-123",
            runtime=runtime,
        )
        command, options = runtime.calls[0]
        self.assertIn(
            "release_orchestrated=true release_rollback=false "
            "terminal_release_mode=release-only",
            command,
        )
        self.assertEqual(options["env"]["ANSIBLE_REPO_VERSION"], "a" * 40)

    def test_terminal_playbook_rejects_legacy_rollback_mode_without_execution(self):
        runtime = Runtime("")
        with self.assertRaisesRegex(ValueError, "sealed manifest"):
            ansible.playbook(
                "inventory.yml",
                "kiosk-a",
                "a" * 40,
                "run-123",
                rollback=True,
                runtime=runtime,
            )
        self.assertEqual(runtime.calls, [])


class SignageMaintenancePrestageTest(unittest.TestCase):
    def test_prestage_is_runtime_only_and_requires_existing_renderer(self):
        runtime = Runtime(["", "", "", "SIGNAGE_MAINTENANCE_SEALED:" + "a" * 64, ""])
        ansible.prestage_signage_maintenance(
            "inventory.yml",
            "signage-a",
            "run-123",
            "terminal-a",
            runtime=runtime,
        )

        self.assertEqual(len(runtime.calls), 5)
        probe = runtime.calls[0][0]
        self.assertEqual(probe[5:7], ["-m", "shell"])
        self.assertIn("command -v rsvg-convert", probe[-1])
        copy = runtime.calls[1][0]
        self.assertEqual(copy[5:7], ["-m", "copy"])
        self.assertIn(
            "dest=/run/signage/release-run-123-maintenance.svg", copy[-1]
        )
        render = runtime.calls[2][0]
        self.assertIn("/run/signage/current.tmp.jpg", render[-1])
        self.assertNotIn("cat /run/signage/current.tmp.jpg", render[-1])
        seal = runtime.calls[3][0]
        self.assertEqual(seal[5:7], ["-m", "script"])
        self.assertIn("/project/scripts/deploy/signage-runtime-proof.py", seal[-1])
        self.assertIn("--run-id run-123", seal[-1])
        self.assertIn(
            "--seal-maintenance-image /run/signage/current.tmp.jpg", seal[-1]
        )
        self.assertTrue(runtime.calls[3][1]["capture"])
        install = runtime.calls[4][0]
        self.assertIn("cat /run/signage/current.tmp.jpg", install[-1])
        all_commands = "\n".join(
            " ".join(command) for command, _options in runtime.calls
        )
        self.assertNotIn("-m apt", all_commands)
        self.assertNotIn("dest=/usr/local/share", all_commands)
        self.assertEqual(
            runtime.state_calls,
            [("ack", "--run-id", "run-123", "--client", "terminal-a")],
        )

    def test_prestage_rejects_invalid_identity_before_mutation(self):
        runtime = Runtime("")
        with self.assertRaises(ValueError):
            ansible.prestage_signage_maintenance(
                "inventory.yml",
                "signage-a",
                "bad run",
                "terminal-a",
                runtime=runtime,
            )
        self.assertEqual(runtime.calls, [])


class TerminalHealthAdapterTest(unittest.TestCase):
    def test_identity_probe_executes_on_terminal_without_key_in_command(self):
        runtime = Runtime(
            'host | CHANGED => {"stdout":"TERMINAL_IDENTITY_OK:terminal-a",'
            '"stdout_lines":["TERMINAL_IDENTITY_OK:terminal-a"]}\n'
        )

        result = ansible.probe_terminal_identity(
            "inventory.yml", "kiosk-a", "terminal-a", runtime=runtime
        )

        self.assertEqual(
            result, {"authenticated": True, "statusClientId": "terminal-a"}
        )
        command, options = runtime.calls[0]
        self.assertEqual(command[0:5], ["ansible", "-i", "inventory.yml", "kiosk-a", "-b"])
        self.assertEqual(command[5:7], ["-m", "script"])
        self.assertIn("/project/scripts/deploy/terminal-identity-probe.py", command[-1])
        self.assertIn("--expected-client-id terminal-a", command[-1])
        self.assertNotIn("CLIENT_KEY", " ".join(command))
        self.assertTrue(options["capture"])

    def test_wrong_or_missing_identity_marker_fails_closed(self):
        for output in ("", "TERMINAL_IDENTITY_OK:other\n"):
            with self.subTest(output=output):
                with self.assertRaisesRegex(RuntimeError, "could not be verified"):
                    ansible.probe_terminal_identity(
                        "inventory.yml",
                        "kiosk-a",
                        "terminal-a",
                        runtime=Runtime(output),
                    )

    def test_signage_endpoint_and_refresh_proofs_keep_key_on_terminal(self):
        endpoint_runtime = Runtime(
            "SIGNAGE_ENDPOINT_PROOF_OK:" + "a" * 64 + "\n"
        )
        endpoint = ansible.probe_signage_endpoints(
            "inventory.yml", "signage-a", runtime=endpoint_runtime
        )
        self.assertEqual(
            endpoint,
            {
                "signageEndpointAuthenticated": True,
                "signageImageSha256": "a" * 64,
            },
        )
        action = endpoint_runtime.calls[0][0][-1]
        self.assertIn("--check-endpoints", action)
        self.assertNotIn("client-key", action)
        self.assertNotIn("signage_client_key", action)

        refresh_runtime = Runtime(
            "SIGNAGE_RUNTIME_PROOF_OK:" + "b" * 64 + "\n"
        )
        refreshed = ansible.refresh_signage_after_maintenance(
            "inventory.yml",
            "signage-a",
            "run-123",
            runtime=refresh_runtime,
        )
        self.assertEqual(
            refreshed,
            {
                "signageEndpointAuthenticated": True,
                "signageImageSha256": "b" * 64,
                "maintenanceArtifactReplaced": True,
            },
        )
        refresh_action = refresh_runtime.calls[0][0][-1]
        self.assertIn("--run-id run-123 --refresh-image", refresh_action)
        self.assertNotIn("client-key", refresh_action)

    def test_signage_endpoint_proof_rejects_missing_or_conflicting_markers(self):
        for output in (
            "",
            "SIGNAGE_ENDPOINT_PROOF_OK:" + "a" * 64
            + "\nSIGNAGE_ENDPOINT_PROOF_OK:"
            + "b" * 64,
        ):
            with self.subTest(output=output):
                with self.assertRaisesRegex(RuntimeError, "could not be verified"):
                    ansible.probe_signage_endpoints(
                        "inventory.yml", "signage-a", runtime=Runtime(output)
                    )

    def test_kiosk_agent_proof_follows_resolved_inventory_without_secrets(self):
        runtime = Runtime(
            [
                json.dumps(
                    {
                        "nfc_agent_client_id": "kiosk-a",
                        "nfc_agent_client_secret": "nfc-secret-never-forwarded",
                        "barcode_agent_enabled": True,
                        "barcode_agent_rest_port": 7072,
                    }
                ),
                "TERMINAL_AGENT_HEALTH_OK:nfc-agent:7071\n",
                "TERMINAL_AGENT_HEALTH_OK:barcode-agent:7072\n",
            ]
        )

        proof = ansible.probe_kiosk_agents(
            "inventory.yml", "kiosk-a", runtime=runtime
        )

        self.assertEqual(
            proof,
            {
                "agentContainers": ["nfc-agent", "barcode-agent"],
                "authenticatedAgentEndpoints": [
                    {"agent": "nfc-agent", "port": 7071},
                    {"agent": "barcode-agent", "port": 7072},
                ],
                "pcscdRequired": True,
            },
        )
        self.assertEqual(
            runtime.calls[0][0],
            ["ansible-inventory", "-i", "inventory.yml", "--host", "kiosk-a"],
        )
        nfc_action = runtime.calls[1][0][-1]
        barcode_action = runtime.calls[2][0][-1]
        self.assertIn("--agent nfc-agent --port 7071", nfc_action)
        self.assertIn("--require-pcscd", nfc_action)
        self.assertIn("--agent barcode-agent --port 7072", barcode_action)
        self.assertNotIn("--require-pcscd", barcode_action)
        all_commands = " ".join(
            " ".join(command) for command, _options in runtime.calls
        )
        self.assertNotIn("nfc-secret-never-forwarded", all_commands)

    def test_kiosk_agent_death_or_bad_inventory_fails_closed(self):
        with self.assertRaisesRegex(RuntimeError, "could not be verified"):
            ansible.probe_kiosk_agents(
                "inventory.yml",
                "kiosk-a",
                runtime=Runtime(
                    [
                        json.dumps({"nfc_agent_client_id": "kiosk-a"}),
                        "",
                    ]
                ),
            )
        with self.assertRaisesRegex(RuntimeError, "port is malformed"):
            ansible.probe_kiosk_agents(
                "inventory.yml",
                "kiosk-a",
                runtime=Runtime(
                    json.dumps(
                        {
                            "barcode_agent_enabled": True,
                            "barcode_agent_rest_port": "7072",
                        }
                    )
                ),
            )

    def test_signage_ready_proof_binds_exact_cycle_without_key_in_argv(self):
        sha = "a" * 40
        verification_id = "b" * 32
        runtime = Runtime(
            f"TERMINAL_READY_OK:{sha}\nTERMINAL_READY_OK:{sha}\n"
        )
        ansible.prove_signage_ready(
            "inventory.yml",
            "signage-a",
            "run-123",
            "terminal-a",
            sha,
            verification_id,
            runtime=runtime,
        )
        command, options = runtime.calls[0]
        self.assertEqual(command[0:7], [
            "ansible", "-i", "inventory.yml", "signage-a", "-b", "-m", "script"
        ])
        action = command[-1]
        self.assertIn("/project/scripts/deploy/terminal-ready-probe.py", action)
        self.assertIn("--run-id run-123", action)
        self.assertIn(f"--release-sha {sha}", action)
        self.assertIn(f"--verification-id {verification_id}", action)
        self.assertIn("--expected-client-id terminal-a", action)
        self.assertIn("--repo /opt/RaspberryPiSystem_002", action)
        self.assertNotIn("CLIENT_KEY", action)
        self.assertNotIn("client-key", action)
        self.assertEqual(options["cwd"], runtime.ANSIBLE_DIRECTORY)
        self.assertTrue(options["capture"])

    def test_signage_ready_proof_rejects_wrong_or_missing_marker(self):
        sha = "a" * 40
        for output in ("", "TERMINAL_READY_OK:" + "c" * 40):
            with self.subTest(output=output):
                with self.assertRaisesRegex(RuntimeError, "could not be verified"):
                    ansible.prove_signage_ready(
                        "inventory.yml",
                        "signage-a",
                        "run-123",
                        "terminal-a",
                        sha,
                        "b" * 32,
                        runtime=Runtime(output),
                    )

    def test_signage_ready_proof_validates_all_public_identifiers(self):
        invalid = (
            ("bad host", "run-123", "terminal-a", "a" * 40, "b" * 32),
            ("signage-a", "x", "terminal-a", "a" * 40, "b" * 32),
            ("signage-a", "run-123", "bad client!", "a" * 40, "b" * 32),
            ("signage-a", "run-123", "terminal-a", "main", "b" * 32),
            ("signage-a", "run-123", "terminal-a", "a" * 40, "bad"),
        )
        for host, run_id, client_id, sha, verification_id in invalid:
            with self.subTest(host=host, run_id=run_id, client_id=client_id):
                runtime = Runtime("unused")
                with self.assertRaises(ValueError):
                    ansible.prove_signage_ready(
                        "inventory.yml",
                        host,
                        run_id,
                        client_id,
                        sha,
                        verification_id,
                        runtime=runtime,
                    )
                self.assertEqual(runtime.calls, [])


class AnsibleConfigResolutionTest(unittest.TestCase):
    @unittest.skipUnless(
        shutil.which('ansible-inventory') and shutil.which('ansible-vault'),
        'Ansible executables are required',
    )
    def test_encrypted_inventory_resolves_vault_password_from_ansible_cwd(self):
        with tempfile.TemporaryDirectory() as directory:
            ansible_directory = Path(directory) / 'ansible'
            ansible_directory.mkdir()
            password = ansible_directory / '.vault-pass'
            password.write_text('test-vault-password\n', encoding='utf-8')
            (ansible_directory / 'ansible.cfg').write_text(
                '[defaults]\n'
                'vault_password_file = .vault-pass\n',
                encoding='utf-8',
            )
            group_vars = ansible_directory / 'group_vars'
            group_vars.mkdir()
            encrypted_vars = group_vars / 'all.yml'
            encrypted_vars.write_text('vault_probe: resolved-secret\n', encoding='utf-8')
            subprocess.run(
                [
                    'ansible-vault',
                    'encrypt',
                    str(encrypted_vars),
                ],
                cwd=ansible_directory,
                check=True,
                text=True,
                capture_output=True,
            )
            inventory = ansible_directory / 'inventory.yml'
            inventory.write_text(
                'all:\n  hosts:\n    local-test:\n      ansible_connection: local\n',
                encoding='utf-8',
            )

            class RealRuntime:
                ANSIBLE_DIRECTORY = ansible_directory

                @staticmethod
                def run(command, **kwargs):
                    completed = subprocess.run(
                        command,
                        cwd=kwargs.get('cwd'),
                        check=True,
                        text=True,
                        capture_output=kwargs.get('capture', False),
                    )
                    return completed.stdout if kwargs.get('capture', False) else ''

            payload = ansible.inventory_json(str(inventory), runtime=RealRuntime())

        self.assertEqual(
            json.loads(json.dumps(payload))['_meta']['hostvars']['local-test']['vault_probe'],
            'resolved-secret',
        )


if __name__ == "__main__":
    unittest.main()
