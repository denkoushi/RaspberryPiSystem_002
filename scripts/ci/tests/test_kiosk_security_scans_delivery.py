from pathlib import Path
import os
import shlex
import subprocess
import tempfile
import unittest

from jinja2 import Environment, StrictUndefined
import yaml


ROOT = Path(__file__).resolve().parents[3]
ANSIBLE = ROOT / 'infrastructure/ansible'


class KioskSecurityScansDeliveryTest(unittest.TestCase):
    def setUp(self):
        self.tasks = yaml.safe_load((ANSIBLE / 'roles/kiosk/tasks/security.yml').read_text())
        self.variables = yaml.safe_load((ANSIBLE / 'group_vars/all.yml').read_text())

    def test_kiosk_removes_rkhunter_without_installing_or_scheduling_it(self):
        related = [task for task in self.tasks if 'rkhunter' in str(task)]
        self.assertEqual(len(related), 3)
        self.assertEqual(related[0]['ansible.builtin.cron'], {
            'name': 'Weekly rkhunter scan (kiosk)', 'user': 'root', 'state': 'absent'})
        self.assertEqual(related[1]['ansible.builtin.file'], {
            'path': '/usr/local/bin/rkhunter-kiosk-scan.sh', 'state': 'absent'})
        self.assertEqual(related[2]['ansible.builtin.apt'], {
            'name': 'rkhunter', 'state': 'absent', 'purge': True})
        for task in related:
            self.assertNotIn('when', task)
        self.assertFalse((ANSIBLE / 'templates/rkhunter-scan.sh.j2').exists())

    def test_kiosk_deploys_shared_script_with_kiosk_only_allowances(self):
        deploy = next(task for task in self.tasks if task.get('ansible.builtin.template', {}).get('dest')
                      == '/usr/local/bin/package-integrity-scan.sh')
        self.assertEqual(deploy['ansible.builtin.template'], {
            'src': '{{ playbook_dir }}/../templates/package-integrity-scan.sh.j2',
            'dest': '/usr/local/bin/package-integrity-scan.sh',
            'owner': 'root', 'group': 'root', 'mode': '0755'})
        self.assertEqual(deploy['when'], 'package_integrity_enabled | default(false)')
        self.assertEqual(deploy['vars'], {
            'package_integrity_scan_allowed_paths':
                '{{ package_integrity_allowed_paths + package_integrity_kiosk_extra_allowed_paths }}',
            'package_integrity_expected_contents': [
                {'path': '/etc/sudoers.d/010_pi-nopasswd',
                 'content': '{{ ansible_user }} ALL=(ALL) NOPASSWD: ALL\n'}]})
        environment = Environment(undefined=StrictUndefined)
        environment.filters['quote'] = shlex.quote
        template = environment.from_string((ANSIBLE / 'templates/package-integrity-scan.sh.j2').read_text())
        for group in ('all', 'staging'):
            with self.subTest(group=group):
                variables = self.variables | yaml.safe_load((ANSIBLE / f'group_vars/{group}.yml').read_text())
                self.assertEqual(variables['package_integrity_kiosk_cron'], '30 2 * * 0')
                self.assertEqual(variables['package_integrity_kiosk_extra_allowed_paths'],
                                 ['/etc/NetworkManager/NetworkManager.conf'])
                self.assertEqual(len(variables['package_integrity_allowed_paths']), 13)
                self.assertNotIn('/etc/NetworkManager/NetworkManager.conf', variables['package_integrity_allowed_paths'])
                server_script = template.render(**variables)
                self.assertNotIn('/etc/NetworkManager/NetworkManager.conf', server_script)
                self.assertNotIn('/etc/sudoers.d/010_pi-nopasswd', server_script)
                expression = deploy['vars']['package_integrity_scan_allowed_paths'][3:-3]
                variables['package_integrity_scan_allowed_paths'] = environment.compile_expression(expression)(**variables)
                variables['package_integrity_expected_contents'] = yaml.safe_load(
                    environment.from_string(yaml.safe_dump(deploy['vars']['package_integrity_expected_contents']))
                    .render(ansible_user='operator'))
                self.assertNotIn('/etc/sudoers.d/010_pi-nopasswd', variables['package_integrity_scan_allowed_paths'])
                script = template.render(**variables)
                self.assertIn('/etc/NetworkManager/NetworkManager.conf', script)
                self.assertIn("operator ALL=(ALL) NOPASSWD: ALL\n", script)
                subprocess.run(['bash', '-n'], input=script, text=True, check=True, capture_output=True)

    def test_kiosk_creates_and_checks_log_directory_and_deploys_rotation(self):
        for task in self.tasks[:2]:
            self.assertIn('{{ package_integrity_log_dir }}', task['loop'])
        self.assertEqual(self.variables['package_integrity_log_dir'], '/var/log/package-integrity')
        self.assertEqual(self.variables['package_integrity_log_file'], 'package-integrity-scan.log')
        deploy = next(task for task in self.tasks if task.get('ansible.builtin.template', {}).get('dest')
                      == '/etc/logrotate.d/raspisys-security')
        self.assertEqual(deploy['ansible.builtin.template'], {
            'src': '{{ playbook_dir }}/../templates/logrotate-security.conf.j2',
            'dest': '/etc/logrotate.d/raspisys-security',
            'owner': 'root', 'group': 'root', 'mode': '0644'})

    def test_weekly_cron_and_release_verification_reject_missing_or_duplicate_lines(self):
        cron = next(task for task in self.tasks if task.get('ansible.builtin.cron', {}).get('name')
                    == 'Package integrity check (kiosk)')
        self.assertEqual(cron['when'], ["terminal_release_mode | default('full') == 'full'",
                                       'package_integrity_enabled | default(false)'])
        self.assertEqual(cron['ansible.builtin.cron']['user'], 'root')
        self.assertEqual(cron['ansible.builtin.cron']['job'], '/usr/local/bin/package-integrity-scan.sh >/dev/null 2>&1')
        for index, field in enumerate(('minute', 'hour', 'day', 'month', 'weekday')):
            self.assertEqual(cron['ansible.builtin.cron'][field], '{{ package_integrity_kiosk_cron.split()[' + str(index) + '] }}')
        verify = next(task for task in self.tasks if task['name'] == 'Verify kiosk package integrity cron entry before release')
        self.assertFalse(verify['changed_when'])
        self.assertEqual(verify['when'], ["terminal_release_mode | default('full') == 'release-only'",
                                         'package_integrity_enabled | default(false)'])
        script = Environment(undefined=StrictUndefined).from_string(verify['ansible.builtin.shell']).render(**self.variables)
        marker = '#Ansible: Package integrity check (kiosk)\n'
        line = '30 2 * * 0 /usr/local/bin/package-integrity-scan.sh >/dev/null 2>&1\n'
        cases = ((marker + line, True), ('', False), (marker, False), (line, False),
                 (marker + line * 2, False), (marker * 2 + line, False),
                 (marker + line + line.replace('30 2', '0 3'), False))
        with tempfile.TemporaryDirectory() as directory:
            tmp = Path(directory)
            crontab = tmp / 'crontab'
            crontab.write_text(f'#!/bin/bash\ncat {shlex.quote(str(tmp / "cron"))}\n')
            crontab.chmod(0o755)
            for content, succeeds in cases:
                with self.subTest(content=content):
                    (tmp / 'cron').write_text(content)
                    result = subprocess.run(['bash', '-c', script], capture_output=True, text=True,
                                            env={'PATH': f'{tmp}{os.pathsep}{os.defpath}'})
                    self.assertEqual(result.returncode == 0, succeeds, result.stderr)


if __name__ == '__main__':
    unittest.main()
