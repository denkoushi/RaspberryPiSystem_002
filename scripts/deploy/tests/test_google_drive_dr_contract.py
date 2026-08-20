from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import yaml

ROOT = Path(__file__).resolve().parents[3]
ANSIBLE_ROOT = ROOT / "infrastructure/ansible"
PLAYBOOK_PATH = ANSIBLE_ROOT / "playbooks/deploy-google-drive-disaster-recovery.yml"
SERVICE_TEMPLATE = ANSIBLE_ROOT / "templates/raspi-google-drive-dr.service.j2"
TIMER_TEMPLATE = ANSIBLE_ROOT / "templates/raspi-google-drive-dr.timer.j2"
ENV_TEMPLATE = ANSIBLE_ROOT / "templates/raspi-google-drive-dr.env.j2"
STANDARD_PLAYBOOK = ANSIBLE_ROOT / "playbooks/deploy-release-standard.yml"
INTEGRATION_SCRIPT = (
    ROOT / "scripts/deploy/tests/test-google-drive-dr-postgres-restic-integration.sh"
)


def _task_values(playbook: dict[str, object]) -> list[dict[str, object]]:
    values: list[dict[str, object]] = []
    for key in ("pre_tasks", "tasks"):
        tasks = playbook[key]
        assert isinstance(tasks, list)
        values.extend(task for task in tasks if isinstance(task, dict))
    return values


class GoogleDriveDisasterRecoveryContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.document = yaml.safe_load(PLAYBOOK_PATH.read_text(encoding="utf-8"))
        assert isinstance(cls.document, list)
        assert len(cls.document) == 1
        cls.play = cls.document[0]
        assert isinstance(cls.play, dict)
        cls.tasks = _task_values(cls.play)

    def test_playbook_is_a_single_exact_pi5_boundary_and_not_a_fleet_role(self) -> None:
        self.assertEqual(self.play["hosts"], "raspberrypi5")
        self.assertNotIn("roles", self.play)
        self.assertNotIn("import_playbook", self.play)
        self.assertNotIn(
            "deploy-google-drive-disaster-recovery.yml",
            STANDARD_PLAYBOOK.read_text(encoding="utf-8"),
        )
        self.assertTrue(
            any(
                task.get("ansible.builtin.assert", {}).get("that")
                and "inventory_hostname == 'raspberrypi5'"
                in task["ansible.builtin.assert"]["that"]
                for task in self.tasks
            )
        )

    def test_required_packages_and_isolated_runner_are_declared(self) -> None:
        package_tasks = [
            task["ansible.builtin.package"]
            for task in self.tasks
            if "ansible.builtin.package" in task
        ]
        self.assertEqual(len(package_tasks), 1)
        self.assertEqual(
            set(package_tasks[0]["name"]), {"python3", "restic", "rclone"}
        )

        copy_tasks = [
            task
            for task in self.tasks
            if "ansible.builtin.copy" in task
        ]
        package_copy_tasks = [
            task
            for task in copy_tasks
            if str(task["ansible.builtin.copy"].get("src", "")).startswith(
                "{{ playbook_dir }}/../../../scripts/google_drive_dr/{{ item }}"
            )
        ]
        self.assertEqual(len(package_copy_tasks), 1)
        self.assertEqual(
            package_copy_tasks[0]["loop"],
            [
                "__init__.py",
                "command_port.py",
                "source_policy.py",
                "snapshot_builder.py",
                "restic_repository.py",
                "restore_validator.py",
                "runner.py",
            ],
        )
        self.assertNotIn("scripts/google_drive_dr/\"", str(package_copy_tasks[0]))
        package_directories = [
            task["ansible.builtin.file"]
            for task in self.tasks
            if "ansible.builtin.file" in task
            and str(task["ansible.builtin.file"].get("path", ""))
            == "{{ google_drive_dr_install_root }}/google_drive_dr"
        ]
        self.assertEqual(len(package_directories), 1)
        self.assertEqual(package_directories[0]["state"], "directory")
        self.assertEqual(package_directories[0]["owner"], "root")
        self.assertEqual(package_directories[0]["group"], "root")
        self.assertEqual(package_directories[0]["mode"], "0755")

    def test_credentials_are_preprovisioned_and_enforced_without_rendering_secrets(
        self,
    ) -> None:
        stat_tasks = [
            task
            for task in self.tasks
            if "ansible.builtin.stat" in task
        ]
        self.assertTrue(
            any(
                {str(path) for path in task.get("loop", [])}
                == {
                    "{{ google_drive_dr_rclone_config }}",
                    "{{ google_drive_dr_restic_password_file }}",
                }
                for task in stat_tasks
            )
        )

        credential_assertions = [
            task["ansible.builtin.assert"]
            for task in self.tasks
            if "ansible.builtin.assert" in task
            and "item.stat.mode" in str(task["ansible.builtin.assert"])
        ]
        self.assertEqual(len(credential_assertions), 1)
        assertion_text = " ".join(
            str(item)
            for item in credential_assertions[0]["that"]
        )
        self.assertIn("item.stat.pw_name", assertion_text)
        self.assertIn("item.stat.gr_name", assertion_text)
        self.assertIn("0600", assertion_text)

        env = ENV_TEMPLATE.read_text(encoding="utf-8")
        self.assertNotRegex(env, re.compile(r"(?i)(password|token|secret)=\s*[^\n{]"))
        self.assertNotIn("vault_", env)
        self.assertIn("RESTIC_PASSWORD_FILE=", env)
        self.assertIn("RCLONE_CONFIG=", env)

    def test_timer_is_disabled_by_default_and_has_the_approved_schedule(self) -> None:
        source = PLAYBOOK_PATH.read_text(encoding="utf-8")
        timer = TIMER_TEMPLATE.read_text(encoding="utf-8")

        self.assertNotIn("timedatectl", source)
        self.assertIn("google_drive_dr_timer_enabled: false", source)
        self.assertIn(
            "enabled: \"{{ google_drive_dr_timer_enabled | bool }}\"", source
        )
        self.assertIn("OnCalendar=*-*-* 21:30:00 Asia/Tokyo", timer)
        self.assertIn("Persistent=false", timer)
        self.assertNotIn("Persistent=true", timer)

    def test_service_is_bounded_oneshot_and_never_uses_runtime_max(self) -> None:
        service = SERVICE_TEMPLATE.read_text(encoding="utf-8")
        self.assertIn("Type=oneshot", service)
        self.assertIn("TimeoutStartSec=9h30m", service)
        self.assertIn("KillMode=control-group", service)
        self.assertNotIn("RuntimeMaxSec", service)
        self.assertIn("ExecStart=/usr/bin/python3", service)
        self.assertIn("-m google_drive_dr.runner backup", service)

    def test_timer_and_service_share_the_dedicated_unit_names(self) -> None:
        service = SERVICE_TEMPLATE.read_text(encoding="utf-8")
        timer = TIMER_TEMPLATE.read_text(encoding="utf-8")
        self.assertIn("google_drive_dr_service_name", timer)
        self.assertIn("google_drive_dr_env_file", service)
        self.assertIn("google_drive_dr_credential_root", ENV_TEMPLATE.read_text(encoding="utf-8"))

    def test_isolated_postgres_restic_harness_has_cleanup_and_restore_boundaries(self) -> None:
        script = INTEGRATION_SCRIPT.read_text(encoding="utf-8")
        for required in (
            "capture_starting_docker_ids",
            "assert_starting_docker_ids_unchanged",
            "assert_run_resources_removed",
            "trap on_exit EXIT",
            "com.raspi-system.temporary=true",
            "pgvector/pgvector:pg15",
            "docker network create --label",
            "docker volume create --label",
            "--label \"$RUN_LABEL\"",
            "prisma migrate deploy",
            "pg_dump -U postgres -d borrow_return -Fc --no-owner --no-acl",
            "run_restic backup --tag business-pi5-dr",
            "run_restic restore latest --tag business-pi5-dr",
            "createdb -U postgres borrow_return_restored",
            "pg_restore",
            "EXPLAIN (ANALYZE, BUFFERS)",
            "git bundle verify",
            "sha256_file",
            "labelled temporary resources=0",
        ):
            with self.subTest(required=required):
                self.assertIn(required, script)
        self.assertIn('local status="${1:-0}" cleanup_status=0', script)
        self.assertIn("assert_starting_docker_ids_unchanged || cleanup_status=1", script)
        self.assertIn('cleanup "$exit_code"', script)
        self.assertIn('RUN_ID="google-drive-dr-', script)
        self.assertNotIn("docker compose -f", script)

    def test_installed_package_shape_reaches_cli_before_credential_failure(self) -> None:
        """The systemd layout must import as a package, not as a loose script."""

        with tempfile.TemporaryDirectory(prefix="google-drive-dr-package-") as directory:
            temporary_root = Path(directory)
            install_root = temporary_root / "opt" / "raspi-google-drive-dr"
            shutil.copytree(ROOT / "scripts/google_drive_dr", install_root / "google_drive_dr")
            project_root = temporary_root / "project"
            credential_root = temporary_root / "etc" / "credentials"
            environment = os.environ.copy()
            environment.update(
                {
                    "PYTHONPATH": str(install_root),
                    "BUSINESS_PI5_PROJECT_ROOT": str(project_root),
                    "BUSINESS_PI5_DR_CREDENTIAL_ROOT": str(credential_root),
                    "BACKUP_STAGING_ROOT": str(temporary_root / "staging"),
                    "RESTIC_REPOSITORY": (
                        "rclone:google-drive:"
                        "RaspberryPiSystem_002/business-pi5"
                    ),
                    "RCLONE_CONFIG": str(credential_root / "rclone.conf"),
                    "RESTIC_PASSWORD_FILE": str(credential_root / "restic-password"),
                    "BUSINESS_PI5_COMPOSE_FILE": str(
                        project_root / "compose.yml"
                    ),
                }
            )
            result = subprocess.run(
                [sys.executable, "-m", "google_drive_dr.runner", "capacity"],
                cwd=temporary_root,
                env=environment,
                capture_output=True,
                text=True,
                check=False,
            )

        output = f"{result.stdout}\n{result.stderr}"
        self.assertNotEqual(result.returncode, 0)
        self.assertNotEqual(result.returncode, 1)
        self.assertIn('"stage":"failed"', result.stdout)
        self.assertIn('"exit_code":20', result.stdout)
        self.assertNotIn("ModuleNotFoundError", output)
        self.assertNotIn("No module named", output)

    def test_runner_config_reads_all_deployed_environment_overrides(self) -> None:
        from scripts.google_drive_dr.runner import RunnerConfig

        with tempfile.TemporaryDirectory(prefix="google-drive-dr-config-") as directory:
            temporary_root = Path(directory)
            project_root = temporary_root / "project"
            credential_root = temporary_root / "credentials"
            staging_root = temporary_root / "staging"
            rclone_config = credential_root / "rclone.conf"
            password_file = credential_root / "restic-password"
            compose_file = project_root / "compose.yml"
            environment = {
                "BUSINESS_PI5_PROJECT_ROOT": str(project_root),
                "BUSINESS_PI5_DR_CREDENTIAL_ROOT": str(credential_root),
                "BACKUP_STAGING_ROOT": str(staging_root),
                "RESTIC_REPOSITORY": (
                    "rclone:google-drive:RaspberryPiSystem_002/business-pi5"
                ),
                "RCLONE_CONFIG": str(rclone_config),
                "RESTIC_PASSWORD_FILE": str(password_file),
                "BUSINESS_PI5_COMPOSE_FILE": str(compose_file),
            }
            with mock.patch.dict(os.environ, environment, clear=False):
                config = RunnerConfig.from_env()

        self.assertEqual(config.project_root, project_root.absolute())
        self.assertEqual(config.credential_root, credential_root.absolute())
        self.assertEqual(config.staging_root, staging_root.absolute())
        self.assertEqual(
            config.repository,
            "rclone:google-drive:RaspberryPiSystem_002/business-pi5",
        )
        self.assertEqual(config.rclone_config, rclone_config.absolute())
        self.assertEqual(config.password_file, password_file.absolute())
        self.assertEqual(config.compose_file, compose_file.absolute())


if __name__ == "__main__":
    unittest.main()
