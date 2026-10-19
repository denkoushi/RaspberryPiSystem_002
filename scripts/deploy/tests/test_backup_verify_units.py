import json
import os
import pathlib
import re
import shlex
import shutil
import subprocess
import tempfile
import unittest

import yaml
from jinja2 import Environment, StrictUndefined


ROOT = pathlib.Path(__file__).resolve().parents[3]
GROUP_VARS = ROOT / "infrastructure/ansible/group_vars/all.yml"
WRAPPER = ROOT / "scripts/server/run-in-active-api.sh"
SERVICE_TEMPLATES = {
    "monthly": ROOT / "infrastructure/ansible/templates/backup-verify-monthly.service.j2",
    "quarterly": ROOT / "infrastructure/ansible/templates/backup-verify-quarterly.service.j2",
}
ALERT_TEMPLATE = ROOT / "infrastructure/ansible/templates/backup-verify-alert@.service.j2"
MONITORING_TASKS = ROOT / "infrastructure/ansible/roles/server/tasks/monitoring.yml"


def group_var(name: str) -> str:
    match = re.search(rf'^{name}:\s*"([^"]+)"\s*$', GROUP_VARS.read_text(encoding="utf-8"), re.M)
    if match is None:
        raise AssertionError(f"{name} is not defined")
    return match.group(1)


class BackupVerifyUnitTests(unittest.TestCase):
    def test_calendars_select_the_first_sunday_not_only_sunday_the_first(self) -> None:
        # "Sun *-*-01" matches only months whose 1st is a Sunday (2-3 times a year).
        self.assertEqual(group_var("backup_verify_monthly_oncalendar"), "Sun *-*-01..07 03:30:00")
        self.assertEqual(
            group_var("backup_verify_quarterly_oncalendar"), "Sun *-01,04,07,10-01..07 04:00:00"
        )

    def test_services_run_inside_the_active_blue_green_api(self) -> None:
        for mode, template in SERVICE_TEMPLATES.items():
            with self.subTest(mode=mode):
                text = template.read_text(encoding="utf-8")
                self.assertNotIn("docker-compose.server.yml exec -T api ", text)
                self.assertIn(
                    "ExecStart={{ project_root }}/scripts/server/run-in-active-api.sh node "
                    "/app/apps/api/dist/scripts/verify-backups.js "
                    f"--mode={mode} ",
                    text,
                )
                self.assertIn("Environment=PROJECT_DIR={{ project_root }}", text)

    def test_wrapper_resolves_the_slot_from_the_canonical_gateway(self) -> None:
        text = WRAPPER.read_text(encoding="utf-8")
        self.assertTrue(WRAPPER.stat().st_mode & 0o111, "wrapper must be executable")
        self.assertIn('ACTIVE_API_RESOLVER="${PROJECT_DIR}/scripts/server/resolve-active-backup-api.py"', text)
        self.assertIn("api-blue|api-green) ;;", text)
        self.assertIn('exec -T "${ACTIVE_API_SERVICE}" "$@"', text)

    def test_each_service_failure_starts_its_own_alert_instance(self) -> None:
        for mode, template in SERVICE_TEMPLATES.items():
            with self.subTest(mode=mode):
                unit, _ = template.read_text(encoding="utf-8").split("[Service]", 1)
                self.assertEqual(unit.count("OnFailure="), 1)
                self.assertIn(f"OnFailure=backup-verify-alert@backup-verify-{mode}.service", unit)

    def test_alert_unit_is_deployed_before_verification_and_reloaded_on_change(self) -> None:
        tasks = yaml.safe_load(MONITORING_TASKS.read_text(encoding="utf-8"))
        alert_tasks = [task for task in tasks if task.get("ansible.builtin.template", {}).get("dest")
                       == "/etc/systemd/system/backup-verify-alert@.service"]
        self.assertEqual(len(alert_tasks), 1)
        alert_task = alert_tasks[0]
        self.assertEqual(alert_task["ansible.builtin.template"]["src"],
                         "{{ playbook_dir }}/../templates/backup-verify-alert@.service.j2")
        self.assertEqual(alert_task["ansible.builtin.template"]["mode"], "0644")
        self.assertEqual(alert_task["vars"], {"project_root": "{{ repo_path }}"})
        self.assertEqual(alert_task["when"], "backup_verify_enabled | default(true)")
        reload_task = next(task for task in tasks
                           if task["name"] == "Reload systemd daemon if backup verification units changed")
        self.assertTrue(reload_task["ansible.builtin.systemd"]["daemon_reload"])
        self.assertIn(f'({alert_task["register"]} is changed)', reload_task["when"][1])
        for mode in SERVICE_TEMPLATES:
            service_task = next(task for task in tasks
                                if task.get("ansible.builtin.template", {}).get("dest")
                                == f"/etc/systemd/system/backup-verify-{mode}.service")
            self.assertLess(tasks.index(alert_task), tasks.index(service_task))
        self.assertLess(tasks.index(alert_task), tasks.index(reload_task))

    def test_failure_handler_generates_one_non_secret_alert_file_per_instance(self) -> None:
        source = ALERT_TEMPLATE.read_text(encoding="utf-8")
        self.assertIn("Type=oneshot", source)
        self.assertIn("Environment=WEBHOOK_URL=", source)
        self.assertNotIn("EnvironmentFile=", source)
        self.assertNotIn("OnFailure=", source)
        self.assertNotIn("journalctl", source)
        self.assertEqual(source.count("ExecStart="), 1)
        for mode in SERVICE_TEMPLATES:
            with self.subTest(mode=mode), tempfile.TemporaryDirectory(prefix="backup-verify-alert-") as directory:
                project_root = pathlib.Path(directory)
                (project_root / "scripts").mkdir()
                shutil.copyfile(ROOT / "scripts/generate-alert.sh", project_root / "scripts/generate-alert.sh")
                unit = Environment(undefined=StrictUndefined).from_string(source).render(
                    project_root=str(project_root)
                ).replace("%i", f"backup-verify-{mode}")
                command = next(line.removeprefix("ExecStart=") for line in unit.splitlines()
                               if line.startswith("ExecStart="))
                result = subprocess.run(shlex.split(command), env={"PATH": os.defpath, "WEBHOOK_URL": ""},
                                        capture_output=True, text=True, check=False, timeout=10)
                self.assertEqual(result.returncode, 0, result.stderr)
                files = list((project_root / "alerts").glob("alert-*.json"))
                self.assertEqual(len(files), 1)
                alert = json.loads(files[0].read_text(encoding="utf-8"))
                self.assertEqual(alert["type"], "storage-backup-verify-failed")
                self.assertEqual(alert["message"], "バックアップ点検が失敗しました")
                self.assertEqual(alert["details"], f"service=backup-verify-{mode};failureType=service-failed")
                self.assertFalse(alert["acknowledged"])
                self.assertNotIn(str(project_root), json.dumps(alert))


if __name__ == "__main__":
    unittest.main()
