from pathlib import Path
import re
import subprocess
import tempfile
import unittest

from jinja2 import Environment, StrictUndefined
import yaml


ROOT = Path(__file__).resolve().parents[3]
DELIVERY_PLAYBOOK = ROOT / 'infrastructure/ansible/playbooks/prepare-pi5-security-scans.yml'
SERVER_TASKS = ROOT / 'infrastructure/ansible/roles/server/tasks'


class Pi5SecurityScansDeliveryTest(unittest.TestCase):
    def test_delivery_playbook_applies_only_malware_tasks_to_pi5(self):
        delivery = DELIVERY_PLAYBOOK.read_text()
        self.assertRegex(delivery, r'hosts:\s*raspberrypi5\n')
        self.assertIn('tasks_from: malware.yml', delivery)
        self.assertEqual(delivery.count('tasks_from:'), 1)
        self.assertNotIn('server_release_mode', delivery)

    def test_standard_release_still_skips_malware_tasks(self):
        self.assertRegex(
            (SERVER_TASKS / 'main.yml').read_text(),
            r"import_tasks: malware\.yml\n\s+when: server_release_mode == 'full'")
        self.assertNotIn('server_release_mode', (SERVER_TASKS / 'malware.yml').read_text())

    def test_server_manages_rkhunter_allow_list(self):
        ansible = ROOT / 'infrastructure/ansible'
        tasks = yaml.safe_load((SERVER_TASKS / 'malware.yml').read_text())
        task = next(task for task in tasks
                    if task.get('ansible.builtin.template', {}).get('dest') == '/etc/rkhunter.conf.local')
        self.assertEqual(task['when'], 'rkhunter_server_enabled | default(false)')
        self.assertEqual(task['ansible.builtin.template'], {
            'src': '{{ playbook_dir }}/../templates/rkhunter.conf.local.j2',
            'dest': '/etc/rkhunter.conf.local', 'owner': 'root', 'group': 'root', 'mode': '0644'
        })
        template = Environment(undefined=StrictUndefined).from_string(
            (ansible / 'templates/rkhunter.conf.local.j2').read_text())
        for group in ('all', 'staging'):
            with self.subTest(group=group):
                variables = yaml.safe_load((ansible / f'group_vars/{group}.yml').read_text())
                self.assertEqual([line for line in template.render(**variables).splitlines() if line and not line.startswith('#')], [
                    'ALLOWDEVFILE=/dev/shm/lttng-ust-wait-*', 'ALLOWHIDDENFILE=/etc/.updated'
                ])

    def test_rkhunter_alerts_only_on_warnings_from_the_current_run(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            (tmp / 'warn').write_text('Warning: Hidden file found: /etc/evil\n')
            rkhunter = tmp / 'rkhunter'
            rkhunter.write_text(f'#!/bin/bash\n[[ "$1" == --check ]] && cat "{tmp}/warn"\nexit 0\n')
            alert = tmp / 'alert'
            alert.write_text(f'#!/bin/bash\necho "$1" >> "{tmp}/alerts"\n')
            for script in (rkhunter, alert):
                script.chmod(0o755)
            script = Environment(undefined=StrictUndefined).from_string(
                (ROOT / 'infrastructure/ansible/templates/rkhunter-scan.sh.j2').read_text()).render(
                rkhunter_log_dir=str(tmp / 'log'), rkhunter_log_file='scan.log',
                rkhunter_ignore_patterns=[], alert_script_path=str(alert))
            script = script.replace('/usr/bin/rkhunter', str(rkhunter)).replace('command -v systemd-run', 'false')
            run = tmp / 'scan.sh'
            run.write_text(script)
            subprocess.run(['bash', str(run)], check=True)
            (tmp / 'warn').write_text('')
            subprocess.run(['bash', str(run)], check=True)
            self.assertEqual((tmp / 'alerts').read_text().splitlines(), ['rkhunter-warning'])


if __name__ == '__main__':
    unittest.main()
