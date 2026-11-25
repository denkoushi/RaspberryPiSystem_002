from __future__ import annotations

import os
import json
import re
import shlex
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
ALERT_TEMPLATE = ANSIBLE_ROOT / "templates/raspi-google-drive-dr-alert.service.j2"
TIMER_TEMPLATE = ANSIBLE_ROOT / "templates/raspi-google-drive-dr.timer.j2"
ENV_TEMPLATE = ANSIBLE_ROOT / "templates/raspi-google-drive-dr.env.j2"
COPY_CHECK_SERVICE = ANSIBLE_ROOT / "templates/offline-dr-copy-check.service.j2"
COPY_CHECK_TIMER = ANSIBLE_ROOT / "templates/offline-dr-copy-check.timer.j2"
ORACLE_COPY_SCRIPT = ROOT / "scripts/google_drive_dr/oracle-dr-copy.sh"
ORACLE_COPY_SERVICE = ANSIBLE_ROOT / "templates/oracle-dr-copy.service.j2"
ORACLE_COPY_TIMER = ANSIBLE_ROOT / "templates/oracle-dr-copy.timer.j2"
ORACLE_COPY_ALERT = ANSIBLE_ROOT / "templates/oracle-dr-copy-alert.service.j2"
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
            if task["ansible.builtin.copy"].get("src")
            == "{{ playbook_dir }}/../../../scripts/google_drive_dr/{{ item }}"
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

    def test_timer_state_comes_from_inventory_with_a_disabled_fallback(self) -> None:
        self.assertNotIn("google_drive_dr_timer_enabled", self.play["vars"])
        timer_tasks = [
            task["ansible.builtin.systemd"]
            for task in self.tasks
            if task.get("ansible.builtin.systemd", {}).get("name")
            == "{{ google_drive_dr_timer_name }}"
        ]
        self.assertEqual(len(timer_tasks), 1)
        self.assertEqual(
            timer_tasks[0]["enabled"],
            "{{ google_drive_dr_timer_enabled | default(false) | bool }}",
        )
        self.assertEqual(
            timer_tasks[0]["state"],
            "{{ 'started' if (google_drive_dr_timer_enabled | default(false) | bool) else 'stopped' }}",
        )

    def test_production_pi5_inventory_enables_the_timer(self) -> None:
        inventory = yaml.safe_load((ANSIBLE_ROOT / "inventory.yml").read_text(encoding="utf-8"))
        pi5 = inventory["all"]["children"]["server"]["hosts"]["raspberrypi5"]
        self.assertIs(pi5["google_drive_dr_timer_enabled"], True)

    def test_timer_setting_is_undefined_outside_the_production_pi5(self) -> None:
        inventory = yaml.safe_load((ANSIBLE_ROOT / "inventory.yml").read_text(encoding="utf-8"))
        setting_paths = []

        def find_settings(node: dict, path: tuple[str, ...] = ()) -> None:
            for key, value in node.items():
                if key == "google_drive_dr_timer_enabled":
                    setting_paths.append(path)
                elif isinstance(value, dict):
                    find_settings(value, (*path, key))

        find_settings(inventory)
        self.assertEqual(
            setting_paths,
            [("all", "children", "server", "hosts", "raspberrypi5")],
        )
        for path in [
            *ANSIBLE_ROOT.glob("inventory-*.yml"),
            ANSIBLE_ROOT / "group_vars/staging.yml",
        ]:
            with self.subTest(path=path.name):
                self.assertNotIn(
                    "google_drive_dr_timer_enabled", path.read_text(encoding="utf-8")
                )

    def test_timer_has_the_approved_schedule(self) -> None:
        source = PLAYBOOK_PATH.read_text(encoding="utf-8")
        timer = TIMER_TEMPLATE.read_text(encoding="utf-8")

        self.assertNotIn("timedatectl", source)
        self.assertIn("OnCalendar=*-*-* 23:00:00 Asia/Tokyo", timer)
        self.assertIn("Persistent=false", timer)
        self.assertNotIn("Persistent=true", timer)

    def test_service_is_bounded_oneshot_and_never_uses_runtime_max(self) -> None:
        service = SERVICE_TEMPLATE.read_text(encoding="utf-8")
        self.assertIn("Type=oneshot", service)
        self.assertIn("TimeoutStartSec=8h", service)
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

    def test_service_failure_queues_one_alert_through_the_existing_script(self) -> None:
        service = SERVICE_TEMPLATE.read_text(encoding="utf-8")
        unit, _ = service.split("[Service]", 1)
        self.assertIn("OnFailure=raspi-google-drive-dr-alert.service", unit)
        alert = ALERT_TEMPLATE.read_text(encoding="utf-8")
        self.assertIn("Type=oneshot", alert)
        self.assertEqual(alert.count("ExecStart="), 1)
        self.assertIn(
            "ExecStart=/bin/bash {{ google_drive_dr_project_root }}/scripts/generate-alert.sh "
            "storage-backup-google-drive-dr-failed", alert
        )
        self.assertIn("Environment=WEBHOOK_URL=", alert)
        self.assertNotIn("EnvironmentFile=", alert)
        self.assertNotIn("journalctl", alert)
        self.assertNotIn("google_drive_dr_repository", alert)
        self.assertNotIn("OnFailure=", alert)
        tasks = [task for task in self.tasks if task.get("ansible.builtin.template", {}).get("src")
                 == "{{ playbook_dir }}/../templates/raspi-google-drive-dr-alert.service.j2"]
        self.assertEqual(len(tasks), 1)
        self.assertEqual(tasks[0]["ansible.builtin.template"]["dest"],
                         "/etc/systemd/system/raspi-google-drive-dr-alert.service")
        self.assertEqual(tasks[0]["notify"], "Reload systemd units")

    def test_failure_handler_generates_one_non_secret_alert_file(self) -> None:
        with tempfile.TemporaryDirectory(prefix="google-drive-dr-alert-") as directory:
            project_root = Path(directory)
            (project_root / "scripts").mkdir()
            shutil.copyfile(ROOT / "scripts/generate-alert.sh", project_root / "scripts/generate-alert.sh")
            unit = ALERT_TEMPLATE.read_text(encoding="utf-8").replace(
                "{{ google_drive_dr_project_root }}", str(project_root)
            )
            command = next(line.removeprefix("ExecStart=") for line in unit.splitlines()
                           if line.startswith("ExecStart="))
            result = subprocess.run(shlex.split(command), env={"PATH": os.defpath, "WEBHOOK_URL": ""},
                                    capture_output=True, text=True, check=False)
            self.assertEqual(result.returncode, 0, result.stderr)
            files = list((project_root / "alerts").glob("alert-*.json"))
            self.assertEqual(len(files), 1)
            alert = json.loads(files[0].read_text(encoding="utf-8"))
            self.assertEqual(alert["type"], "storage-backup-google-drive-dr-failed")
            self.assertEqual(alert["message"], "Google Drive DR backup failed")
            self.assertEqual(alert["details"], "service=raspi-google-drive-dr;failureType=service-failed")
            self.assertFalse(alert["acknowledged"])
            self.assertNotIn(str(project_root), json.dumps(alert))

    def test_template_tasks_resolve_the_shared_ansible_template_directory(self) -> None:
        template_sources = {
            task["ansible.builtin.template"]["src"]
            for task in self.tasks
            if "ansible.builtin.template" in task
        }
        expected_sources = {
            "{{ playbook_dir }}/../templates/raspi-google-drive-dr.env.j2",
            "{{ playbook_dir }}/../templates/raspi-google-drive-dr.service.j2",
            "{{ playbook_dir }}/../templates/raspi-google-drive-dr-alert.service.j2",
            "{{ playbook_dir }}/../templates/raspi-google-drive-dr.timer.j2",
            "{{ playbook_dir }}/../templates/offline-dr-copy-check.{{ item }}.j2",
            "{{ playbook_dir }}/../templates/oracle-dr-copy{{ item }}.j2",
        }
        self.assertEqual(template_sources, expected_sources)
        for template_path in (
            ENV_TEMPLATE, SERVICE_TEMPLATE, ALERT_TEMPLATE, TIMER_TEMPLATE,
            COPY_CHECK_SERVICE, COPY_CHECK_TIMER,
            ORACLE_COPY_SERVICE, ORACLE_COPY_TIMER, ORACLE_COPY_ALERT,
        ):
            with self.subTest(template_path=template_path):
                self.assertTrue(template_path.is_file())

    def test_offline_copy_scripts_units_and_independent_timer_are_installed(self) -> None:
        script_copy = {
            "src": "{{ playbook_dir }}/../../../scripts/google_drive_dr/{{ item }}.sh",
            "dest": "{{ google_drive_dr_install_root }}/{{ item }}.sh",
            "owner": "root", "group": "root", "mode": "0755",
        }
        task = next(task for task in self.tasks if task.get("ansible.builtin.copy") == script_copy)
        self.assertEqual(task["loop"], ["offline-dr-copy", "offline-dr-copy-check", "oracle-dr-copy"])
        for script in task["loop"]:
            self.assertTrue((ROOT / f"scripts/google_drive_dr/{script}.sh").is_file())

        unit_install = {
            "src": "{{ playbook_dir }}/../templates/offline-dr-copy-check.{{ item }}.j2",
            "dest": "/etc/systemd/system/offline-dr-copy-check.{{ item }}",
            "owner": "root", "group": "root", "mode": "0644",
        }
        task = next(task for task in self.tasks if task.get("ansible.builtin.template") == unit_install)
        self.assertEqual(task["loop"], ["service", "timer"])
        self.assertEqual(task["notify"], "Reload systemd units")
        timer_task = next(task for task in self.tasks if task.get("ansible.builtin.systemd", {}).get("name")
                          == "offline-dr-copy-check.timer")
        self.assertEqual(timer_task["ansible.builtin.systemd"], {
            "name": "offline-dr-copy-check.timer", "enabled": True, "state": "started",
        })
        self.assertNotIn("when", timer_task)
        self.assertGreater(self.tasks.index(timer_task), self.tasks.index(task))
        timer = COPY_CHECK_TIMER.read_text(encoding="utf-8").splitlines()
        for directive in (
            "OnCalendar=*-*-* 09:00:00 Asia/Tokyo", "Persistent=true",
            "Unit=offline-dr-copy-check.service", "WantedBy=timers.target",
        ):
            self.assertIn(directive, timer)

    def test_offline_copy_check_service_queues_an_overdue_alert(self) -> None:
        service = COPY_CHECK_SERVICE.read_text(encoding="utf-8")
        for directive in (
            "Type=oneshot", "User=root", "Group=root", "Environment=WEBHOOK_URL=",
            "TimeoutStartSec=30s", "NoNewPrivileges=true", "PrivateTmp=true",
            "StandardOutput=journal", "StandardError=journal",
        ):
            self.assertIn(directive, service.splitlines())
        with tempfile.TemporaryDirectory(prefix="offline-copy-check-") as directory:
            project_root = Path(directory)
            (project_root / "scripts").mkdir()
            shutil.copyfile(ROOT / "scripts/generate-alert.sh", project_root / "scripts/generate-alert.sh")
            unit = (service.replace("{{ google_drive_dr_project_root }}", str(project_root))
                    .replace("{{ google_drive_dr_install_root }}", str(ROOT / "scripts/google_drive_dr")))
            environment = {
                "PATH": os.defpath,
                "OFFLINE_DR_LOG_DIR": str(project_root / "missing-logs"),
            }
            for line in unit.splitlines():
                if line.startswith("Environment="):
                    assignment, = shlex.split(line.removeprefix("Environment="))
                    key, value = assignment.split("=", 1)
                    environment[key] = value
            command, = [line.removeprefix("ExecStart=") for line in unit.splitlines()
                        if line.startswith("ExecStart=")]
            result = subprocess.run(shlex.split(command), env=environment,
                                    capture_output=True, text=True, check=False)
            self.assertEqual(result.returncode, 0, result.stderr)
            alert_file, = (project_root / "alerts").glob("alert-*.json")
            alert = json.loads(alert_file.read_text(encoding="utf-8"))
            self.assertEqual(alert["type"], "offline-dr-copy-overdue")
            self.assertEqual(alert["details"], "lastOk=none;days=-1")

    def test_oracle_copy_uses_the_pinned_arm64_rclone(self) -> None:
        installer, = [
            task for task in self.play["tasks"]
            if any("ansible.builtin.get_url" in step for step in task.get("block", []))
        ]
        self.assertEqual(installer["when"], "not oracle_dr_rclone_binary.stat.exists")
        download, = [step["ansible.builtin.get_url"] for step in installer["block"]
                     if "ansible.builtin.get_url" in step]
        self.assertEqual(
            download["url"],
            "https://downloads.rclone.org/v1.76.0/rclone-v1.76.0-linux-arm64.zip",
        )
        self.assertEqual(
            download["checksum"],
            "sha256:ee169016675e23a69d77240565133ff7dbc9b33d16fa8f7053d4af39f1eaeb78",
        )
        extract, = [step["ansible.builtin.command"] for step in installer["block"]
                    if "ansible.builtin.command" in step]
        self.assertIn('archive.open("rclone-v1.76.0-linux-arm64/rclone")', extract["argv"][2])
        self.assertEqual(extract["creates"], "{{ oracle_dr_rclone_root }}/rclone")
        # check mode does not create the directory, so steps that write into it must be skipped.
        for step in installer["block"][1:]:
            with self.subTest(step=step["name"]):
                self.assertEqual(step.get("when"), "not ansible_check_mode")

    def test_oracle_copy_only_lists_copies_verifies_and_measures(self) -> None:
        script = ORACLE_COPY_SCRIPT.read_text(encoding="utf-8")
        commands = re.findall(r'"\$RCLONE"\s+--config\s+"\$CONF"\s+(\w+)', script)
        self.assertEqual(commands, ["lsf", "copy", "check", "size"])
        self.assertNotRegex(script, r"\b(?:sync|delete|purge|move)\b")
        for flag in ('--immutable', '--exclude "locks/**"', '--oos-no-check-bucket', '--fast-list'):
            self.assertIn(flag, script)

    def test_oracle_copy_units_fail_loudly_and_queue_failure_alerts(self) -> None:
        service = ORACLE_COPY_SERVICE.read_text(encoding="utf-8").splitlines()
        self.assertIn("OnFailure=oracle-dr-copy-alert.service", service)
        # a skipped unit raises no alert, so missing files must fail inside the script instead
        self.assertFalse([line for line in service if line.startswith("ConditionPathExists=")])
        self.assertIn("TimeoutStartSec=6h", service)
        alert = ORACLE_COPY_ALERT.read_text(encoding="utf-8").splitlines()
        self.assertIn(
            "ExecStart=/bin/bash {{ google_drive_dr_project_root }}/scripts/generate-alert.sh "
            'storage-backup-oracle-dr-copy-failed "Oracle DR copy failed" '
            '"service=oracle-dr-copy;failureType=service-failed"',
            alert,
        )
        timer = ORACLE_COPY_TIMER.read_text(encoding="utf-8").splitlines()
        for directive in ("Unit=oracle-dr-copy.service", "OnCalendar=*-*-* 04:30:00 Asia/Tokyo",
                          "Persistent=false", "WantedBy=timers.target"):
            self.assertIn(directive, timer)

        credentials, = [
            task for task in self.tasks if task.get("register") == "oracle_dr_credential_stats"
        ]
        self.assertEqual(credentials["loop"], ["pi5-dr-writer.pem", "config", "oracle.env"])
        self.assertIs(credentials["no_log"], True)
        self.assertIs(credentials["ansible.builtin.stat"]["get_checksum"], False)
        self.assertIs(credentials["ansible.builtin.stat"]["get_mime"], False)
        timer_task, = [
            task["ansible.builtin.systemd"] for task in self.tasks
            if task.get("ansible.builtin.systemd", {}).get("name") == "oracle-dr-copy.timer"
        ]
        self.assertEqual(timer_task["enabled"], "{{ oracle_dr_credentials_ready | bool }}")
        self.assertEqual(
            timer_task["state"],
            "{{ 'started' if (oracle_dr_credentials_ready | bool) else 'stopped' }}",
        )

    def test_oracle_copy_files_do_not_contain_oracle_identifiers(self) -> None:
        for path in (
            PLAYBOOK_PATH, ORACLE_COPY_SCRIPT, ORACLE_COPY_SERVICE, ORACLE_COPY_TIMER,
            ORACLE_COPY_ALERT, Path(__file__), Path(__file__).with_name("test_oracle_dr_copy.py"),
            ROOT / "docs/knowledge-base/KB-416-outside-intrusion-resilience-2026-10.md",
        ):
            with self.subTest(path=path):
                self.assertNotIn(b"ocid1" + b".", path.read_bytes().lower())

    def test_isolated_postgres_restic_harness_has_cleanup_and_restore_boundaries(self) -> None:
        script = INTEGRATION_SCRIPT.read_text(encoding="utf-8")
        for required in (
            "capture_starting_docker_ids",
            "assert_starting_docker_ids_unchanged",
            "assert_run_resources_removed",
            "trap on_exit EXIT",
            "com.raspi-system.temporary=true",
            "pgvector/pgvector:pg18",
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
