from pathlib import Path
import shlex
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

    def test_server_replaces_rkhunter_with_package_integrity(self):
        tasks = yaml.safe_load((SERVER_TASKS / 'malware.yml').read_text())
        crons = {task['ansible.builtin.cron']['name']: task for task in tasks
                 if 'ansible.builtin.cron' in task}
        old = crons['Daily rkhunter scan']
        self.assertEqual(old['ansible.builtin.cron'], {
            'name': 'Daily rkhunter scan', 'user': 'root', 'state': 'absent'})
        self.assertNotIn('when', old)
        removal = next(task for task in tasks if task.get('ansible.builtin.file', {}).get('state') == 'absent')
        self.assertEqual(removal['loop'], ['/usr/local/bin/rkhunter-scan.sh', '/etc/rkhunter.conf.local'])
        self.assertNotIn('when', removal)
        package = next(task for task in tasks if task.get('ansible.builtin.apt', {}).get('name') == 'rkhunter')
        self.assertEqual(package['ansible.builtin.apt'], {'name': 'rkhunter', 'state': 'absent', 'purge': False})
        self.assertNotIn('when', package)
        self.assertFalse((ROOT / 'infrastructure/ansible/templates/rkhunter.conf.local.j2').exists())
        deploy = next(task for task in tasks if task.get('ansible.builtin.template', {}).get('dest') == '/usr/local/bin/package-integrity-scan.sh')
        self.assertEqual(deploy['when'], 'package_integrity_enabled | default(false)')
        self.assertEqual(deploy['ansible.builtin.template'], {
            'src': '{{ playbook_dir }}/../templates/package-integrity-scan.sh.j2',
            'dest': '/usr/local/bin/package-integrity-scan.sh', 'owner': 'root', 'group': 'root', 'mode': '0755'})
        cron = crons['Daily package integrity check']
        self.assertEqual(cron['when'], 'package_integrity_enabled | default(false)')
        self.assertEqual(cron['ansible.builtin.cron']['user'], 'root')
        self.assertEqual(cron['ansible.builtin.cron']['job'], '/usr/local/bin/package-integrity-scan.sh >/dev/null 2>&1')
        for index, field in enumerate(('minute', 'hour', 'day', 'month', 'weekday')):
            self.assertEqual(cron['ansible.builtin.cron'][field], '{{ package_integrity_cron.split()[' + str(index) + '] }}')
        self.assertIn('{{ package_integrity_log_dir }}', tasks[0]['loop'])
        self.assertNotIn('{{ rkhunter_log_dir }}', tasks[0]['loop'])

    def test_package_integrity_variables_and_review_source(self):
        ansible = ROOT / 'infrastructure/ansible'
        production = yaml.safe_load((ansible / 'group_vars/all.yml').read_text())
        for group in ('all', 'staging'):
            with self.subTest(group=group):
                variables = yaml.safe_load((ansible / f'group_vars/{group}.yml').read_text())
                self.assertTrue(variables['package_integrity_enabled'])
                self.assertEqual(variables['package_integrity_cron'], '0 4 * * *')
                self.assertEqual(variables['package_integrity_log_file'], 'package-integrity-scan.log')
                self.assertEqual(len(variables['package_integrity_allowed_paths']), 13)
                self.assertEqual(variables['package_integrity_allowed_paths'], production['package_integrity_allowed_paths'])
                for key in ('rkhunter_server_enabled', 'rkhunter_server_cron',
                            'rkhunter_server_allow_dev_files', 'rkhunter_server_allow_hidden_files',
                            'rkhunter_log_dir', 'rkhunter_log_file'):
                    self.assertNotIn(key, variables)
                self.assertTrue(variables['rkhunter_kiosk_enabled'])
        # Staging inherits the review sources from all.yml and supplies its own log directory.
        scans = next(value['scans'] for value in production.values()
                     if isinstance(value, dict) and 'scans' in value)
        source = next(scan for scan in scans if scan['name'] == 'package-integrity')
        self.assertEqual(source, {
            'name': 'package-integrity',
            'paths': ['{{ package_integrity_log_dir }}/{{ package_integrity_log_file }}*'],
            'start': 'Starting package integrity check...', 'end': 'Package integrity check completed.'})
        self.assertNotIn('rkhunter', [scan['name'] for scan in scans])

    def run_package_scan(self, output='', error='', exit_code=0, previous='', allowed=None):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        tmp = Path(directory.name)
        (tmp / 'stdout').write_text(output)
        (tmp / 'stderr').write_text(error)
        dpkg = tmp / 'dpkg'
        dpkg.write_text(f'''#!/bin/bash
[[ "$#" == 1 && "$1" == --verify ]] || exit 99
cat "{tmp}/stdout"
cat "{tmp}/stderr" >&2
exit {exit_code}
''')
        alert = tmp / 'alert'
        alert.write_text(f'''#!/bin/bash
printf '%s\\n' "$1" >> "{tmp}/alerts"
printf '%s' "$2" > "{tmp}/title"
printf '%s' "$3" > "{tmp}/body"
''')
        for executable in (dpkg, alert):
            executable.chmod(0o755)
        log = tmp / 'log/scan.log'
        if previous:
            log.parent.mkdir()
            log.write_text(previous)
        variables = yaml.safe_load((ROOT / 'infrastructure/ansible/group_vars/all.yml').read_text())
        variables.update(package_integrity_log_dir=str(log.parent), package_integrity_log_file=log.name,
                         alert_script_path=str(alert))
        if allowed is not None:
            variables['package_integrity_allowed_paths'] = allowed
        environment = Environment(undefined=StrictUndefined)
        environment.filters['quote'] = shlex.quote
        script = environment.from_string(
            (ROOT / 'infrastructure/ansible/templates/package-integrity-scan.sh.j2').read_text()).render(**variables)
        run = tmp / 'scan.sh'
        run.write_text(script)
        subprocess.run(['bash', '-n', str(run)], check=True, capture_output=True, text=True)
        # Replace only the executable and systemd availability; never run the host's package verifier.
        run.write_text(script.replace('/usr/bin/dpkg', shlex.quote(str(dpkg))).replace('command -v systemd-run', 'false'))
        subprocess.run(['bash', str(run)], check=True, capture_output=True, text=True)
        self.assertIn('Starting package integrity check...', log.read_text())
        self.assertIn('Package integrity check completed.', log.read_text())
        return tmp, log

    def test_allowed_package_differences_and_dpkg_warnings_do_not_alert(self):
        paths = yaml.safe_load((ROOT / 'infrastructure/ansible/group_vars/all.yml').read_text())['package_integrity_allowed_paths']
        output = ''.join(f'??5?????? {"c" if path.startswith("/etc/") else " "} {path}\n' for path in paths)
        warning = 'dpkg: warning: unrelated metadata warning\n'
        tmp, log = self.run_package_scan(output, error=warning)
        self.assertFalse((tmp / 'alerts').exists())
        self.assertIn(output, log.read_text())
        self.assertIn(warning, log.read_text())

    def test_unallowed_differences_and_missing_paths_raise_one_warning(self):
        differences = ['??5??????   /usr/bin/changed program', 'missing     /usr/bin/deleted program',
                       'missing   c /etc/missing config', '??5?????? c /etc/login.defs.extra']
        output = '??5?????? c /etc/login.defs\nmissing   c /etc/skel/.bashrc\n' + '\n'.join(differences) + '\n'
        tmp, _ = self.run_package_scan(output, error='dpkg: warning: ignored\n', exit_code=1)
        self.assertEqual((tmp / 'alerts').read_text().splitlines(), ['package-integrity-warning'])
        self.assertEqual((tmp / 'title').read_text(), 'パッケージの改ざん確認で差分が見つかりました')
        self.assertEqual((tmp / 'body').read_text().splitlines(), differences)

    def test_previous_package_differences_do_not_alert(self):
        tmp, log = self.run_package_scan(previous='[old] Starting package integrity check...\n??5??????   /usr/bin/old\n[old] Package integrity check completed.\n')
        self.assertFalse((tmp / 'alerts').exists())
        self.assertIn('/usr/bin/old', log.read_text())

    def test_failed_package_scan_without_differences_alerts_error(self):
        tmp, log = self.run_package_scan(error='dpkg: error: cannot read database\n', exit_code=2)
        self.assertEqual((tmp / 'alerts').read_text().splitlines(), ['package-integrity-scan-error'])
        self.assertEqual((tmp / 'title').read_text(), 'パッケージの改ざん確認でエラーが発生しました')
        self.assertEqual((tmp / 'body').read_text(), f'詳細ログ: {log}')
        self.assertIn('dpkg: error:', log.read_text())

    def test_allowed_paths_with_spaces_are_literal_and_fully_matched(self):
        allowed = "/opt/config's [x] $(unused)"
        changed = '/opt/config file.extra'
        tmp, _ = self.run_package_scan(
            f'??5?????? c {allowed}\nmissing     /opt/config file\n??5??????   {changed}\n',
            allowed=[allowed, '/opt/config file'])
        self.assertEqual((tmp / 'body').read_text(), f'??5??????   {changed}')

    def test_package_warning_body_is_limited_after_filtering(self):
        differences = [f'??5??????   /usr/bin/changed-{index}' for index in range(55)]
        tmp, _ = self.run_package_scan('??5?????? c /etc/login.defs\n' * 60 + '\n'.join(differences) + '\n')
        self.assertEqual((tmp / 'alerts').read_text().splitlines(), ['package-integrity-warning'])
        self.assertEqual((tmp / 'body').read_text().splitlines(), differences[:50])

    def test_empty_allow_list_still_reports_differences(self):
        tmp, _ = self.run_package_scan('missing     /usr/bin/deleted\n', allowed=[])
        self.assertEqual((tmp / 'alerts').read_text().splitlines(), ['package-integrity-warning'])


if __name__ == '__main__':
    unittest.main()
