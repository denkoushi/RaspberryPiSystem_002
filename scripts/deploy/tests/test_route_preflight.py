from __future__ import annotations

import json
import tempfile
import unittest
from collections import defaultdict
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from scripts.deploy.rolling_release import route_preflight


SHA = "a" * 40


def spec(
    project: str, dependencies: tuple[str, ...] = ()
) -> dict[str, object]:
    return {
        "version": 2,
        "project": project,
        "runId": "20260719-010203-a1b2c3",
        "sha": SHA,
        "inventory": "inventory.yml",
        "expectedServerClientId": "raspberrypi5-server",
        "requiredExternalDependencies": list(dependencies),
    }


def create_backup_ssh_authority(project: Path) -> None:
    directory = project / "secrets/backup-ssh"
    directory.mkdir(parents=True)
    directory.chmod(0o700)
    private_key = directory / "id_ed25519"
    private_key_label = "OPENSSH " + "PRIVATE KEY"
    private_key.write_text(
        f"-----BEGIN {private_key_label}-----\nfixture\n"
        f"-----END {private_key_label}-----\n",
        encoding="utf-8",
    )
    private_key.chmod(0o600)
    known_hosts = directory / "known_hosts"
    known_hosts.write_text("example ssh-ed25519 fixture\n", encoding="utf-8")
    known_hosts.chmod(0o600)


class RoutePreflightTest(unittest.TestCase):
    def test_parse_rejects_unknown_fields_and_unsafe_inventory(self):
        value = spec("/opt/RaspberryPiSystem_002")
        value["unknown"] = True
        with self.assertRaises(route_preflight.RoutePreflightConfigError):
            route_preflight.parse_spec(json.dumps(value))
        value = spec("/opt/RaspberryPiSystem_002")
        value["inventory"] = "../inventory.yml"
        with self.assertRaises(route_preflight.RoutePreflightConfigError):
            route_preflight.parse_spec(json.dumps(value))
        value = spec("/opt/RaspberryPiSystem_002")
        value["requiredExternalDependencies"] = ["unknown-service"]
        with self.assertRaises(route_preflight.RoutePreflightConfigError):
            route_preflight.parse_spec(json.dumps(value))
        value = spec("/opt/RaspberryPiSystem_002")
        value["requiredExternalDependencies"] = ["docker-auth", "docker-auth"]
        with self.assertRaises(route_preflight.RoutePreflightConfigError):
            route_preflight.parse_spec(json.dumps(value))

    def test_success_aggregates_exact_route_readiness_without_mutation(self):
        with tempfile.TemporaryDirectory() as temporary:
            project = Path(temporary)
            ansible = project / "infrastructure/ansible"
            ansible.mkdir(parents=True)
            lock = project / "logs/deploy/fleet-release-state.lock"
            lock.parent.mkdir(parents=True)
            lock.write_text("", encoding="utf-8")
            create_backup_ssh_authority(project)
            for name, content in (
                ("ansible.cfg", "[defaults]\n"),
                (".vault-pass", "secret\n"),
                ("inventory.yml", "all:\n  hosts: {}\n"),
            ):
                (ansible / name).write_text(content, encoding="utf-8")

            commands: list[tuple[str, ...]] = []

            def run(argv, **_kwargs):
                commands.append(tuple(argv))
                if "status" in argv:
                    return SimpleNamespace(returncode=0, stdout="", stderr="")
                if "show" in argv:
                    return SimpleNamespace(
                        returncode=0,
                        stdout="raspi-rolling-release-v2\n",
                        stderr="",
                    )
                if "ansible-inventory" in argv[0]:
                    return SimpleNamespace(returncode=0, stdout="{}", stderr="")
                return SimpleNamespace(returncode=0, stdout="ok\n", stderr="")

            real_isfile = route_preflight.os.path.isfile
            with patch.object(
                route_preflight.os.path,
                "isfile",
                side_effect=lambda path: str(path).startswith("/usr/bin/")
                or real_isfile(path),
            ), patch.object(route_preflight.os, "access", return_value=True):
                code, report = route_preflight.execute(
                    spec(str(project)),
                    run_command=run,
                    client_id_reader=lambda: "raspberrypi5-server",
                    disk_free_reader=lambda _path: 8192,
                    memory_available_reader=lambda: 2048,
                )

            self.assertEqual(code, 0)
            self.assertEqual(report["status"], "passed")
            self.assertEqual(report["issues"], [])
            self.assertIn("pi5.fleet-lock-held", report["proofs"])
            self.assertIn("pi5.backup-ssh-authority", report["proofs"])
            flattened = "\n".join(" ".join(command) for command in commands)
            for forbidden in ("checkout", "playbook", "systemctl start", "systemctl stop"):
                self.assertNotIn(forbidden, flattened)
            self.assertEqual(
                report["externalDependencies"],
                {"required": [], "rounds": 3, "successes": {}},
            )

    def test_external_build_dependencies_require_every_tls_round(self):
        with tempfile.TemporaryDirectory() as temporary:
            project = Path(temporary)
            ansible = project / "infrastructure/ansible"
            ansible.mkdir(parents=True)
            lock = project / "logs/deploy/fleet-release-state.lock"
            lock.parent.mkdir(parents=True)
            lock.write_text("", encoding="utf-8")
            create_backup_ssh_authority(project)
            for name, content in (
                ("ansible.cfg", "[defaults]\n"),
                (".vault-pass", "secret\n"),
                ("inventory.yml", "all:\n  hosts: {}\n"),
            ):
                (ansible / name).write_text(content, encoding="utf-8")

            def run(argv, **_kwargs):
                if "status" in argv:
                    return SimpleNamespace(returncode=0, stdout="", stderr="")
                if "show" in argv:
                    return SimpleNamespace(
                        returncode=0,
                        stdout="raspi-rolling-release-v2\n",
                        stderr="",
                    )
                if "ansible-inventory" in argv[0]:
                    return SimpleNamespace(returncode=0, stdout="{}", stderr="")
                return SimpleNamespace(returncode=0, stdout="ok\n", stderr="")

            calls: defaultdict[str, int] = defaultdict(int)

            def external_probe(dependency_id: str) -> bool:
                calls[dependency_id] += 1
                return not (
                    dependency_id == "npm-registry"
                    and calls[dependency_id] == 2
                )

            real_isfile = route_preflight.os.path.isfile
            with patch.object(
                route_preflight.os.path,
                "isfile",
                side_effect=lambda path: str(path).startswith("/usr/bin/")
                or real_isfile(path),
            ), patch.object(route_preflight.os, "access", return_value=True):
                code, report = route_preflight.execute(
                    spec(
                        str(project),
                        ("docker-auth", "npm-registry"),
                    ),
                    run_command=run,
                    client_id_reader=lambda: "raspberrypi5-server",
                    disk_free_reader=lambda _path: 8192,
                    memory_available_reader=lambda: 2048,
                    external_dependency_probe=external_probe,
                )

            self.assertEqual(code, 78)
            self.assertEqual(report["status"], "blocked")
            self.assertEqual(
                report["issues"], ["pi5.external-tls:npm-registry"]
            )
            self.assertEqual(
                report["externalDependencies"],
                {
                    "required": ["docker-auth", "npm-registry"],
                    "rounds": 3,
                    "successes": {"docker-auth": 3, "npm-registry": 2},
                },
            )
            self.assertEqual(calls, {"docker-auth": 3, "npm-registry": 3})
            self.assertNotIn("external-server-build-readiness", report["proofs"])

    def test_external_build_dependency_total_failure_is_bounded_and_counted(self):
        calls = 0

        def failed_probe(_dependency_id: str) -> bool:
            nonlocal calls
            calls += 1
            return False

        successes = route_preflight._probe_external_dependencies(
            ("docker-auth",), failed_probe
        )

        self.assertEqual(successes, {"docker-auth": 0})
        self.assertEqual(calls, route_preflight.EXTERNAL_TLS_ROUNDS)

    def test_reports_all_detected_issues_in_one_result(self):
        with tempfile.TemporaryDirectory() as temporary:
            def failed(argv, **_kwargs):
                return SimpleNamespace(returncode=1, stdout="", stderr="secret must not escape")

            with patch.object(route_preflight.os.path, "isfile", return_value=False):
                code, report = route_preflight.execute(
                    spec(temporary),
                    run_command=failed,
                    client_id_reader=lambda: "wrong-server",
                    fleet_lock_acquirer=lambda _project: (_ for _ in ()).throw(
                        BlockingIOError("busy")
                    ),
                )

            self.assertEqual(code, 78)
            self.assertEqual(report["status"], "blocked")
            self.assertGreater(len(report["issues"]), 5)
            self.assertIn("pi5.fleet-lock", report["issues"])
            self.assertIn("pi5.backup-ssh-directory", report["issues"])
            self.assertIn("pi5.backup-ssh-private-key", report["issues"])
            self.assertIn("pi5.backup-ssh-known-hosts", report["issues"])
            self.assertNotIn("secret must not escape", json.dumps(report))

    def test_backup_ssh_authority_requires_owner_only_regular_files(self):
        with tempfile.TemporaryDirectory() as temporary:
            project = Path(temporary)
            create_backup_ssh_authority(project)

            self.assertEqual(route_preflight._backup_ssh_authority_issues(temporary), [])

            private_key = project / "secrets/backup-ssh/id_ed25519"
            private_key.chmod(0o644)
            known_hosts = project / "secrets/backup-ssh/known_hosts"
            known_hosts.unlink()
            known_hosts.symlink_to(private_key)

            self.assertEqual(
                route_preflight._backup_ssh_authority_issues(temporary),
                ["pi5.backup-ssh-private-key", "pi5.backup-ssh-known-hosts"],
            )

    def test_readable_active_run_is_reported_for_recovery_without_blocking(self):
        with tempfile.TemporaryDirectory() as temporary:
            project = Path(temporary)
            ansible = project / "infrastructure/ansible"
            ansible.mkdir(parents=True)
            lock = project / "logs/deploy/fleet-release-state.lock"
            lock.parent.mkdir(parents=True)
            lock.write_text("", encoding="utf-8")
            create_backup_ssh_authority(project)
            active_run = "20260719-010203-a1b2c3"
            (project / "logs/deploy/fleet-release-state.json").write_text(
                json.dumps(
                    {
                        "activeRun": {
                            "runId": active_run,
                            "status": "running",
                            "desiredSha": "a" * 40,
                            "inventory": "inventory.yml",
                            "startedAt": "2026-07-19T01:02:03Z",
                            "kind": "release",
                        }
                    }
                ),
                encoding="utf-8",
            )
            run_path = project / f"logs/deploy/release-runs/{active_run}.json"
            run_path.parent.mkdir(parents=True)
            run_path.write_text(json.dumps({"runId": active_run}), encoding="utf-8")
            for name in ("ansible.cfg", ".vault-pass", "inventory.yml"):
                (ansible / name).write_text("{}\n", encoding="utf-8")

            def run(argv, **_kwargs):
                if "status" in argv:
                    return SimpleNamespace(returncode=0, stdout="", stderr="")
                if "show" in argv:
                    return SimpleNamespace(
                        returncode=0,
                        stdout="raspi-rolling-release-v2\n",
                        stderr="",
                    )
                if "ansible-inventory" in argv[0]:
                    return SimpleNamespace(returncode=0, stdout="{}", stderr="")
                return SimpleNamespace(returncode=0, stdout="ok\n", stderr="")

            real_isfile = route_preflight.os.path.isfile
            with patch.object(
                route_preflight.os.path,
                "isfile",
                side_effect=lambda path: str(path).startswith("/usr/bin/")
                or real_isfile(path),
            ), patch.object(route_preflight.os, "access", return_value=True):
                code, report = route_preflight.execute(
                    spec(str(project)),
                    run_command=run,
                    client_id_reader=lambda: "raspberrypi5-server",
                    disk_free_reader=lambda _path: 8192,
                    memory_available_reader=lambda: 2048,
                )

            self.assertEqual(code, 0)
            self.assertIn(
                "pi5.interrupted-run-recovery-required", report["warnings"]
            )
            self.assertIn(
                "pi5.interrupted-run-authority-readable", report["proofs"]
            )

    def test_typed_failed_run_requires_strict_recovery_admission(self):
        with tempfile.TemporaryDirectory() as temporary:
            project = Path(temporary)
            lock = project / "logs/deploy/fleet-release-state.lock"
            lock.parent.mkdir(parents=True)
            lock.write_text("", encoding="utf-8")
            create_backup_ssh_authority(project)
            active_run = "20260807-010203-a1b2c3"
            (project / "logs/deploy/fleet-release-state.json").write_text(
                json.dumps(
                    {
                        "activeRun": {
                            "runId": active_run,
                            "status": "running",
                            "desiredSha": "a" * 40,
                            "inventory": "inventory.yml",
                            "startedAt": "2026-08-07T01:02:03Z",
                            "kind": "pi3-signage-artifact",
                        }
                    }
                ),
                encoding="utf-8",
            )
            run_path = project / f"logs/deploy/release-runs/{active_run}.json"
            run_path.parent.mkdir(parents=True)
            run_path.write_text(
                json.dumps(
                    {
                        "runId": active_run,
                        "state": "failed",
                        "phase": "completed",
                        "failure": "terminal pre-mutation cleanup failed",
                        "releaseScope": "pi3-signage-artifact",
                        "desiredRelease": {
                            "sourceSha": "b" * 40,
                            "exactReference": "ghcr.io/example/signage@sha256:" + "c" * 64,
                            "ociDigest": "sha256:" + "c" * 64,
                            "artifactSha256": "d" * 64,
                            "manifestSha256": "e" * 64,
                            "payloadDigest": "f" * 64,
                        },
                        "targets": [
                            {
                                "host": "raspberrypi3",
                                "role": "signage",
                                "terminalType": "signage",
                                "clientId": "raspberrypi3-signage1",
                                "rollbackAuthorityRunId": active_run,
                                "rollbackManifest": {"schemaVersion": 1},
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )
            for name in ("ansible.cfg", ".vault-pass", "inventory.yml"):
                ansible = project / "infrastructure/ansible"
                ansible.mkdir(parents=True, exist_ok=True)
                (ansible / name).write_text("{}\n", encoding="utf-8")

            def run(argv, **_kwargs):
                if "status" in argv:
                    return SimpleNamespace(returncode=0, stdout="", stderr="")
                if "show" in argv:
                    return SimpleNamespace(
                        returncode=0,
                        stdout="raspi-rolling-release-v2\n",
                        stderr="",
                    )
                if "ansible-inventory" in argv[0]:
                    return SimpleNamespace(returncode=0, stdout="{}", stderr="")
                return SimpleNamespace(returncode=0, stdout="ok\n", stderr="")

            real_isfile = route_preflight.os.path.isfile
            with patch.object(
                route_preflight.os.path,
                "isfile",
                side_effect=lambda path: str(path).startswith("/usr/bin/")
                or real_isfile(path),
            ), patch.object(route_preflight.os, "access", return_value=True):
                code, report = route_preflight.execute(
                    spec(str(project)),
                    run_command=run,
                    client_id_reader=lambda: "raspberrypi5-server",
                    disk_free_reader=lambda _path: 8192,
                    memory_available_reader=lambda: 2048,
                )

            self.assertEqual(code, 0)
            self.assertIn("pi5.interrupted-run-recovery-admitted", report["proofs"])
            self.assertEqual(
                report["recoveryAdmission"]["releaseScope"],
                "pi3-signage-artifact",
            )
            self.assertEqual(
                report["recoveryAdmission"]["targets"], ["raspberrypi3"]
            )

    def test_typed_failed_run_without_sealed_baseline_stays_blocked(self):
        with tempfile.TemporaryDirectory() as temporary:
            project = Path(temporary)
            lock = project / "logs/deploy/fleet-release-state.lock"
            lock.parent.mkdir(parents=True)
            lock.write_text("", encoding="utf-8")
            (project / "logs/deploy/fleet-release-state.json").write_text(
                json.dumps(
                    {
                        "activeRun": {
                            "runId": "20260807-010203-a1b2c3",
                            "status": "running",
                            "desiredSha": "a" * 40,
                            "inventory": "inventory.yml",
                            "startedAt": "2026-08-07T01:02:03Z",
                            "kind": "pi3-signage-artifact",
                        }
                    }
                ),
                encoding="utf-8",
            )
            run_path = project / "logs/deploy/release-runs/20260807-010203-a1b2c3.json"
            run_path.parent.mkdir(parents=True)
            run_path.write_text(
                json.dumps(
                    {
                        "runId": "20260807-010203-a1b2c3",
                        "state": "failed",
                        "phase": "completed",
                        "failure": "failed",
                        "releaseScope": "pi3-signage-artifact",
                        "targets": [{"host": "raspberrypi3", "role": "signage"}],
                    }
                ),
                encoding="utf-8",
            )
            with patch.object(route_preflight.os.path, "isfile", return_value=False):
                code, report = route_preflight.execute(
                    spec(str(project)),
                    run_command=lambda *_args, **_kwargs: SimpleNamespace(
                        returncode=1, stdout="", stderr=""
                    ),
                    client_id_reader=lambda: "raspberrypi5-server",
                    disk_free_reader=lambda _path: 8192,
                    memory_available_reader=lambda: 2048,
                )

            self.assertEqual(code, 78)
            self.assertIn("pi5.interrupted-run-authority", report["issues"])
            self.assertNotIn("recoveryAdmission", report)

    def test_typed_recovery_admission_requires_matching_digest_reference(self):
        authority = {
            "runId": "20260807-010203-a1b2c3",
            "state": "failed",
            "phase": "completed",
            "failure": "terminal pre-mutation cleanup failed",
            "releaseScope": "pi3-signage-artifact",
            "desiredRelease": {
                "sourceSha": "b" * 40,
                "exactReference": "ghcr.io/example/signage@sha256:" + "d" * 64,
                "ociDigest": "sha256:" + "c" * 64,
                "artifactSha256": "d" * 64,
                "manifestSha256": "e" * 64,
                "payloadDigest": "f" * 64,
            },
            "targets": [
                {
                    "host": "raspberrypi3",
                    "role": "signage",
                    "terminalType": "signage",
                    "clientId": "raspberrypi3-signage1",
                    "rollbackAuthorityRunId": "20260807-010203-a1b2c3",
                    "rollbackManifest": {"schemaVersion": 1},
                }
            ],
        }

        self.assertIsNone(
            route_preflight._recovery_admission(
                authority,
                run_id="20260807-010203-a1b2c3",
                kind="pi3-signage-artifact",
            )
        )

    def test_current_active_run_summary_must_match_its_authority(self):
        with tempfile.TemporaryDirectory() as temporary:
            project = Path(temporary)
            lock = project / "logs/deploy/fleet-release-state.lock"
            lock.parent.mkdir(parents=True)
            lock.write_text("", encoding="utf-8")
            active_run = "20260719-010203-a1b2c3"
            (project / "logs/deploy/fleet-release-state.json").write_text(
                json.dumps(
                    {
                        "activeRun": {
                            "runId": active_run,
                            "status": "running",
                            "desiredSha": "a" * 40,
                            "inventory": "inventory.yml",
                            "startedAt": "2026-07-19T01:02:03Z",
                        }
                    }
                ),
                encoding="utf-8",
            )
            run_path = project / f"logs/deploy/release-runs/{active_run}.json"
            run_path.parent.mkdir(parents=True)
            run_path.write_text(
                json.dumps({"runId": "different-run"}), encoding="utf-8"
            )

            with patch.object(route_preflight.os.path, "isfile", return_value=False):
                _code, report = route_preflight.execute(
                    spec(str(project)),
                    run_command=lambda *_args, **_kwargs: SimpleNamespace(
                        returncode=1, stdout="", stderr=""
                    ),
                    client_id_reader=lambda: "raspberrypi5-server",
                    disk_free_reader=lambda _path: 8192,
                    memory_available_reader=lambda: 2048,
                )

            self.assertIn("pi5.interrupted-run-authority", report["issues"])
            self.assertNotIn(
                "pi5.interrupted-run-authority-readable", report["proofs"]
            )

    def test_active_run_without_durable_authority_is_a_blocker(self):
        with tempfile.TemporaryDirectory() as temporary:
            project = Path(temporary)
            lock = project / "logs/deploy/fleet-release-state.lock"
            lock.parent.mkdir(parents=True)
            lock.write_text("", encoding="utf-8")
            (project / "logs/deploy/fleet-release-state.json").write_text(
                json.dumps({"activeRun": "20260719-010203-a1b2c3"}),
                encoding="utf-8",
            )

            with patch.object(route_preflight.os.path, "isfile", return_value=False):
                code, report = route_preflight.execute(
                    spec(str(project)),
                    run_command=lambda *_args, **_kwargs: SimpleNamespace(
                        returncode=1, stdout="", stderr=""
                    ),
                    client_id_reader=lambda: "raspberrypi5-server",
                    disk_free_reader=lambda _path: 8192,
                    memory_available_reader=lambda: 2048,
                )

            self.assertEqual(code, 78)
            self.assertIn("pi5.interrupted-run-authority", report["issues"])
            self.assertNotIn(
                "pi5.interrupted-run-recovery-required", report["warnings"]
            )


if __name__ == "__main__":
    unittest.main()
