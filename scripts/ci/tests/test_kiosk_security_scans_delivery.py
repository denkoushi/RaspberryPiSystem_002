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
        self.tasks = yaml.safe_load((ANSIBLE / 'roles/kiosk/tasks/package-integrity.yml').read_text())
        self.clamav = yaml.safe_load((ANSIBLE / 'roles/kiosk/tasks/clamav.yml').read_text())
        self.security = yaml.safe_load((ANSIBLE / 'roles/kiosk/tasks/security.yml').read_text())
        self.variables = yaml.safe_load((ANSIBLE / 'group_vars/all.yml').read_text())

    def test_kiosk_alerts_inbox_cleanup_is_daily_and_bounded(self):
        task = next(task for task in self.tasks
                    if task.get('name') == 'Schedule kiosk alerts inbox cleanup')
        cron = task['ansible.builtin.cron']
        self.assertEqual(cron['user'], 'root')
        self.assertEqual((cron['minute'], cron['hour']), ('25', '4'))
        for field in ('day', 'month', 'weekday'):
            self.assertEqual(cron.get(field, '*'), '*')
        self.assertEqual(task['when'], "terminal_release_mode | default('full') == 'full'")
        self.assertEqual(self.variables['security_review_kiosk_alerts_dir'],
                         '/opt/RaspberryPiSystem_002/alerts')
        environment = Environment(undefined=StrictUndefined)
        environment.filters['quote'] = shlex.quote
        job = environment.from_string(cron['job']).render(**self.variables)
        self.assertEqual(shlex.split(job), [
            'find', '/opt/RaspberryPiSystem_002/alerts', '-maxdepth', '1', '-type', 'f',
            '-name', 'alert-*.json*', '(', '(', '-empty', '-mmin', '+1440', ')',
            '-o', '-mmin', '+43200', ')', '-delete'])

    def test_full_provisioning_imports_package_integrity_after_clamav(self):
        self.assertEqual(self.security[-1], {
            'name': 'Apply kiosk package integrity check',
            'ansible.builtin.import_tasks': 'package-integrity.yml'})
        self.assertEqual(self.security[-2], {
            'name': 'Apply kiosk ClamAV scan', 'ansible.builtin.import_tasks': 'clamav.yml'})
        self.assertEqual(self.clamav[-1]['name'], 'Verify kiosk ClamAV cron entry before release')
        for task in self.clamav[:2]:
            self.assertEqual(task['loop'], ['{{ clamav_kiosk_log_dir }}'])
        self.assertFalse(any('clamav' in str(task).lower() for task in self.tasks))

    def test_kiosk_removes_rkhunter_without_installing_or_scheduling_it(self):
        related = [task for task in self.tasks if 'rkhunter' in str(task)]
        self.assertEqual(len(related), 4)
        self.assertEqual(related[0]['ansible.builtin.cron'], {
            'name': 'Weekly rkhunter scan (kiosk)', 'user': 'root', 'state': 'absent'})
        self.assertEqual(related[1]['ansible.builtin.file'], {
            'path': '/usr/local/bin/rkhunter-kiosk-scan.sh', 'state': 'absent'})
        self.assertEqual(related[2]['ansible.builtin.file'], {
            'path': '/etc/cron.d/rkhunter-kiosk-scan', 'state': 'absent'})
        self.assertEqual(related[3]['ansible.builtin.apt'], {
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
            self.assertEqual(task['loop'], ['{{ package_integrity_log_dir }}'])
        self.assertEqual(self.tasks[0]['when'], "terminal_release_mode | default('full') == 'full'")
        for task in self.tasks[1:3]:
            self.assertEqual(task['when'], "terminal_release_mode | default('full') == 'release-only'")
        self.assertEqual(self.tasks[1]['register'], 'kiosk_package_integrity_log_directories')
        self.assertEqual(self.tasks[2]['loop'],
                         '{{ kiosk_package_integrity_log_directories.results | default([]) }}')
        self.assertEqual(self.tasks[2]['ansible.builtin.assert']['that'],
                         self.clamav[2]['ansible.builtin.assert']['that'])
        self.assertEqual(self.variables['package_integrity_log_dir'], '/var/log/package-integrity')
        self.assertEqual(self.variables['package_integrity_log_file'], 'package-integrity-scan.log')
        deploy = next(task for task in self.tasks if task.get('ansible.builtin.template', {}).get('dest')
                      == '/etc/logrotate.d/raspisys-security')
        self.assertEqual(deploy['ansible.builtin.template'], {
            'src': '{{ playbook_dir }}/../templates/logrotate-security.conf.j2',
            'dest': '/etc/logrotate.d/raspisys-security',
            'owner': 'root', 'group': 'root', 'mode': '0644'})
        rotation = Environment(undefined=StrictUndefined).from_string(
            (ANSIBLE / 'templates/logrotate-security.conf.j2').read_text()).render(**self.variables)
        self.assertIn('/var/log/package-integrity/*.log {', rotation)
        self.assertNotIn('/var/log/clamav', rotation)

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

    def test_clamav_release_convergence_matches_package_integrity(self):
        tasks = yaml.safe_load((ANSIBLE / 'roles/release_kiosk/tasks/main.yml').read_text())
        post_health = tasks[0]['block'][1]['block']
        index = next(i for i, task in enumerate(post_health)
                     if task['name'] == 'Converge the Pi4 kiosk package integrity check')
        expected = yaml.safe_load(yaml.safe_dump(post_health[index])
                                  .replace('package integrity check', 'ClamAV scan')
                                  .replace('Package integrity check', 'ClamAV scan')
                                  .replace('package-integrity', 'clamav'))
        self.assertEqual(post_health[index + 1], expected)
        self.assertEqual(expected['block'][0]['vars'], {'terminal_release_mode': 'full'})
        self.assertEqual(expected['block'][0]['ansible.builtin.include_role'],
                         {'name': 'kiosk', 'tasks_from': 'clamav'})
        self.assertEqual(len(expected['rescue']), 1)
        self.assertIn('ansible.builtin.debug', expected['rescue'][0])

    def test_clamav_removes_legacy_cron_d_copy_before_scheduling(self):
        names = [task['name'] for task in self.clamav]
        legacy = self.clamav[names.index('Remove legacy kiosk ClamAV cron.d entry')]
        self.assertEqual(legacy['ansible.builtin.file'], {
            'path': '/etc/cron.d/clamav-kiosk-scan', 'state': 'absent'})
        self.assertEqual(legacy['when'], "terminal_release_mode | default('full') == 'full'")
        self.assertLess(names.index('Remove legacy kiosk ClamAV cron.d entry'),
                        names.index('Schedule kiosk ClamAV scan'))

    def test_clamav_packages_daemon_and_kiosk_render_vars(self):
        install = next(task for task in self.clamav if 'ansible.builtin.apt' in task)
        self.assertEqual(install['ansible.builtin.apt']['name'], ['clamav', 'clamav-freshclam'])
        stop = next(task for task in self.clamav if 'ansible.builtin.systemd' in task)
        self.assertGreater(self.clamav.index(stop), self.clamav.index(install))
        self.assertEqual(stop['ansible.builtin.systemd'], {
            'name': 'clamav-freshclam.service', 'enabled': False, 'state': 'stopped'})
        self.assertEqual(stop['when'], ["terminal_release_mode | default('full') == 'full'",
                                       'clamav_kiosk_enabled | default(false)'])
        deploy = next(task for task in self.clamav if 'ansible.builtin.template' in task)
        self.assertTrue(deploy['vars']['clamav_update_before_scan'])
        self.assertEqual(deploy['vars']['clamav_scan_paths'], '{{ clamav_kiosk_scan_paths }}')
        self.assertEqual(deploy['when'], 'clamav_kiosk_enabled | default(false)')
        for group in ('all', 'staging'):
            variables = yaml.safe_load((ANSIBLE / f'group_vars/{group}.yml').read_text())
            self.assertEqual(variables['clamav_kiosk_scan_paths'],
                             ['/home', '/tmp', '/var/tmp', '/usr/local/bin'])

    def render_clamav(self, **overrides):
        variables = dict(clamav_log_dir='/var/log/clamav', clamav_log_file='clamav-scan.log',
                         clamav_scan_paths=['/opt/RaspberryPiSystem_002/storage', '/opt/backups'],
                         alert_script_path='/usr/local/bin/generate-alert.sh')
        variables.update(overrides)
        return Environment(undefined=StrictUndefined, trim_blocks=True, lstrip_blocks=True,
                           keep_trailing_newline=True).from_string(
            (ANSIBLE / 'templates/clamav-scan.sh.j2').read_text()).render(**variables)

    def test_pi5_render_is_byte_identical_to_original_golden(self):
        # Captured from the pre-change template using Ansible's whitespace settings.
        golden = (Path(__file__).parent / 'fixtures/clamav-pi5-scan.sh').read_bytes()
        self.assertEqual(self.render_clamav().encode(), golden)
        self.assertEqual(self.render_clamav(clamav_update_before_scan=False).encode(), golden)

    def test_clamav_update_and_missing_targets(self):
        for update_exit, scan_exit, has_target in ((0, 0, True), (7, 0, True),
                                                  (124, 0, True), (0, 1, True),
                                                  (0, 2, True), (7, 0, False)):
            with self.subTest(update_exit=update_exit, scan_exit=scan_exit, has_target=has_target), \
                    tempfile.TemporaryDirectory() as directory:
                tmp = Path(directory)
                target = tmp / 'existing'
                target.mkdir()
                missing = tmp / 'missing'
                commands = {
                    'nice': 'printf "priority:%s\\n" "$*" >> "$TRACE"; shift 2; exec "$@"',
                    'timeout': 'printf "timeout:%s\\n" "$*" >> "$TRACE"; shift; exec "$@"',
                    'freshclam': 'echo "freshclam:$*" >> "$TRACE"; echo update-output; exit "$UPDATE_EXIT"',
                    'clamscan': 'echo "clamscan:$*" >> "$TRACE"; echo "test FOUND"; exit "$SCAN_EXIT"',
                    'alert': 'echo "$1" >> "$ALERTS"',
                }
                for name, body in commands.items():
                    command = tmp / name
                    command.write_text('#!/bin/bash\n' + body + '\n')
                    command.chmod(0o755)
                script = self.render_clamav(
                    clamav_update_before_scan=True, clamav_log_dir=str(tmp), clamav_log_file='scan.log',
                    clamav_scan_paths=([str(target)] if has_target else []) + [str(missing)],
                    alert_script_path=str(tmp / 'alert'))
                # Prevent host cgroup use; replace only the absolute scanner with our stub.
                script = script.replace('command -v systemd-run', 'false')
                script = script.replace('/usr/bin/clamscan', shlex.quote(str(tmp / 'clamscan')))
                subprocess.run(['bash', '-n'], input=script, text=True, check=True, capture_output=True)
                result = subprocess.run(['bash', '-c', script], text=True, capture_output=True, env={
                    'PATH': f'{tmp}{os.pathsep}{os.defpath}', 'TRACE': str(tmp / 'trace'),
                    'ALERTS': str(tmp / 'alerts'), 'UPDATE_EXIT': str(update_exit), 'SCAN_EXIT': str(scan_exit)})
                self.assertEqual(result.returncode, 0, result.stderr)
                trace = (tmp / 'trace').read_text()
                log = (tmp / 'scan.log').read_text()
                self.assertIn('priority:-n 19 timeout 15m freshclam --quiet', trace)
                self.assertIn('timeout:15m freshclam --quiet', trace)
                self.assertIn('update-output', log)
                self.assertIn(f'Skipping missing scan path: {missing}', log)
                if update_exit:
                    self.assertIn(f'Virus database update failed (exit {update_exit}); scanning with the existing database.', log)
                else:
                    self.assertNotIn('Virus database update failed', log)
                if has_target:
                    self.assertIn(f'--max-scansize=400M {target}', trace)
                    self.assertLess(trace.index('freshclam:--quiet'), trace.index('clamscan:'))
                    self.assertNotIn(str(missing), trace)
                else:
                    self.assertNotIn('clamscan:', trace)
                    self.assertIn('No existing scan paths', log)
                alerts = (tmp / 'alerts').read_text().splitlines() if (tmp / 'alerts').exists() else []
                expected = (['clamav-scan-error'] if not has_target or scan_exit > 1 else
                            ['clamav-detection'] if scan_exit == 1 else [])
                self.assertEqual(alerts, expected)


if __name__ == '__main__':
    unittest.main()
