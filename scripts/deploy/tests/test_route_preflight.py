from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from scripts.deploy.rolling_release import route_preflight


SHA = "a" * 40


def spec(project: str) -> dict[str, object]:
    return {
        "version": 1,
        "project": project,
        "runId": "20260719-010203-a1b2c3",
        "sha": SHA,
        "inventory": "inventory.yml",
        "expectedServerClientId": "raspberrypi5-server",
    }


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

    def test_success_aggregates_exact_route_readiness_without_mutation(self):
        with tempfile.TemporaryDirectory() as temporary:
            project = Path(temporary)
            ansible = project / "infrastructure/ansible"
            ansible.mkdir(parents=True)
            lock = project / "logs/deploy/fleet-release-state.lock"
            lock.parent.mkdir(parents=True)
            lock.write_text("", encoding="utf-8")
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
            flattened = "\n".join(" ".join(command) for command in commands)
            for forbidden in ("checkout", "playbook", "systemctl start", "systemctl stop"):
                self.assertNotIn(forbidden, flattened)

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
            self.assertNotIn("secret must not escape", json.dumps(report))

    def test_readable_active_run_is_reported_for_recovery_without_blocking(self):
        with tempfile.TemporaryDirectory() as temporary:
            project = Path(temporary)
            ansible = project / "infrastructure/ansible"
            ansible.mkdir(parents=True)
            lock = project / "logs/deploy/fleet-release-state.lock"
            lock.parent.mkdir(parents=True)
            lock.write_text("", encoding="utf-8")
            active_run = "20260719-010203-a1b2c3"
            (project / "logs/deploy/fleet-release-state.json").write_text(
                json.dumps({"activeRun": active_run}), encoding="utf-8"
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
