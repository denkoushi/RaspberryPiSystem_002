import json
from pathlib import Path
import unittest

import yaml
from jinja2 import Environment, StrictUndefined

ROOT = Path(__file__).resolve().parents[3]
ANSIBLE = ROOT / 'infrastructure/ansible'
START = '{{ playbook_dir }}/../tasks/os-security-update-release-start.yml'
END = '{{ playbook_dir }}/../tasks/os-security-update-release-end.yml'
POLICY = '{{ playbook_dir }}/../tasks/os-security-update.yml'


def tasks(path):
    return yaml.safe_load((ANSIBLE / path).read_text())


def walk(nodes):
    for task in nodes:
        yield task
        for section in ('block', 'rescue', 'always'):
            yield from walk(task.get(section, []))


class OSUpdateUnitTests(unittest.TestCase):
    def setUp(self):
        self.variables = tasks('group_vars/all.yml')
        self.environment = Environment(undefined=StrictUndefined)
        self.environment.filters['to_json'] = json.dumps
        self.environment.filters['to_nice_json'] = json.dumps
        self.environment.filters['bool'] = bool

    def render(self, name, variables):
        return self.environment.from_string((ANSIBLE / f'templates/{name}.j2').read_text()).render(**variables)

    def test_all_groups_render_strict_service_timer_and_config(self):
        for group, time, delay, browser in [('server', '02:00:00', '0', ''),
                                           ('kiosk', '01:00:00', '90min', 'kiosk-browser.service'),
                                           ('signage', '01:30:00', '30min', '')]:
            with self.subTest(group=group):
                variables = {**self.variables}
                if group != 'server':
                    variables.update(tasks(f'group_vars/{group}.yml'))
                timer = self.render('raspi-os-security-update.timer', variables)
                for line in (f'OnCalendar=Sun *-*-* {time} Asia/Tokyo', f'RandomizedDelaySec={delay}',
                             'FixedRandomDelay=true', 'Persistent=true', 'WantedBy=timers.target'):
                    self.assertIn(line, timer.splitlines())
                service = self.render('raspi-os-security-update.service', variables)
                for line in ('Type=oneshot', 'ExecStart=/usr/local/sbin/raspi-os-security-update',
                             'Nice=10', 'IOSchedulingClass=idle', 'TimeoutStartSec=2h'):
                    self.assertIn(line, service.splitlines())
                config = json.loads(self.render('raspi-os-security-update.conf', variables))
                self.assertEqual(config['mode'], 'dry-run')
                self.assertEqual(config['browserUnit'], browser)
                self.assertEqual(config['blacklist'], self.variables['os_security_update_package_blacklist'])
                self.assertEqual(config['allowlist'], ['^chromium', '^rpi-chromium-mods$'])
                self.assertEqual(config['windowStartHour'], 0)
                self.assertEqual(config['windowEndHour'], 5)
                self.assertEqual(config['releaseMarker'], '/run/raspi-release/active')
                self.assertEqual(config['releaseMarkerMaxAgeSeconds'], 14400)
                self.assertEqual(config['lockPath'], '/run/lock/raspi-os-security-update.lock')
                self.assertEqual(config['stateDir'], '/var/lib/raspi-os-security-update')

    def test_every_host_is_enabled_and_only_the_canary_applies(self):
        self.assertTrue(self.variables['os_security_update_enabled'])
        self.assertEqual(self.variables['os_security_update_mode'], 'dry-run')
        self.assertNotIn('unattended_upgrades_enabled', self.variables)
        apply_hosts = []

        def visit(group):
            for name, variables in group.get('hosts', {}).items():
                variables = variables or {}
                self.assertNotIn('unattended_upgrades_enabled', variables)
                if variables.get('os_security_update_mode', self.variables['os_security_update_mode']) == 'apply':
                    apply_hosts.append(name)
            for child in group.get('children', {}).values():
                visit(child)

        visit(tasks('inventory.yml')['all'])
        self.assertEqual(apply_hosts, ['raspi4-assembly-02'])

    def test_shared_policy_import_is_nonfatal_and_post_health_in_every_role(self):
        for role, entry in [('release_pi5', 'main'), ('release_kiosk', 'main'), ('release_signage', 'health')]:
            with self.subTest(role=role):
                source = tasks(f'roles/{role}/tasks/{entry}.yml')
                containers = [task for task in walk(source)
                              if any(child.get('ansible.builtin.import_tasks') == POLICY for child in task.get('block', []))]
                self.assertEqual(len(containers), 1)
                policy = containers[0]
                self.assertEqual(len(policy['rescue']), 1)
                self.assertEqual(set(policy['rescue'][0]), {'name', 'ansible.builtin.debug'})
                self.assertNotIn('always', policy)
                if role == 'release_pi5':
                    body = source[0]['block']
                    lifecycle = body[1]
                    self.assertEqual(lifecycle['block'][-1]['ansible.builtin.import_tasks'], 'commit.yml')
                    self.assertGreater(body.index(policy), body.index(lifecycle))
                elif role == 'release_kiosk':
                    body = source[0]['block'][1]['block']
                    boundary = next(task for task in body if task['name'] == 'Switch and verify one Pi4 kiosk')
                    self.assertEqual(boundary['block'][1]['ansible.builtin.import_tasks'], 'health.yml')
                    self.assertGreater(body.index(policy), body.index(boundary))
                else:
                    self.assertEqual(source[0]['ansible.builtin.import_tasks'], 'health_checks.yml')
                    self.assertGreater(source.index(policy), next(i for i, task in enumerate(source)
                                     if task.get('ansible.builtin.import_tasks') == 'host-status-agent-storage.yml'))

    def test_kiosk_package_integrity_is_nonfatal_after_health_and_os_policy(self):
        source = tasks('roles/release_kiosk/tasks/main.yml')
        body = source[0]['block'][1]['block']
        health = next(task for task in body if task['name'] == 'Switch and verify one Pi4 kiosk')
        os_policy = next(task for task in body
                         if task['name'] == 'Converge the Pi4 kiosk weekly OS security update policy')
        policy = next(task for task in body
                      if task['name'] == 'Converge the Pi4 kiosk package integrity check')
        self.assertEqual(health['block'][1]['ansible.builtin.import_tasks'], 'health.yml')
        self.assertGreater(body.index(policy), body.index(health))
        self.assertEqual(body.index(policy), body.index(os_policy) + 1)
        self.assertEqual(policy.get('when'), os_policy.get('when'))
        self.assertEqual(len(policy['block']), 1)
        include = policy['block'][0]
        self.assertEqual(include['ansible.builtin.include_role'], {
            'name': 'kiosk', 'tasks_from': 'package-integrity'})
        self.assertEqual(include['vars'], {'terminal_release_mode': 'full'})
        self.assertNotIn('when', include)
        self.assertEqual(len(policy['rescue']), 1)
        self.assertEqual(set(policy['rescue'][0]), {'name', 'ansible.builtin.debug'})
        message = policy['rescue'][0]['ansible.builtin.debug']['msg']
        self.assertIn('the release continues.', message)
        self.assertIn("(ansible_failed_result.msg | default('unknown') | string)[:300]", message)
        self.assertNotIn('always', policy)

    def assert_guard(self, source):
        self.assertEqual(len(source), 1)
        guard = source[0]
        self.assertEqual(guard['block'][0]['ansible.builtin.import_tasks'], START)
        self.assertEqual(guard['always'], [{
            'name': guard['always'][0]['name'], 'ansible.builtin.import_tasks': END}])
        self.assertNotIn('rescue', guard)  # timeout must propagate, not start rollback mutations
        self.assertNotIn('when', guard['always'][0])
        self.assertGreater(len(guard['block']), 1)

    def test_guard_precedes_first_mutation_and_outlives_all_cleanup_paths(self):
        for role in ('release_pi5', 'release_kiosk', 'release_signage'):
            with self.subTest(role=role):
                self.assert_guard(tasks(f'roles/{role}/tasks/main.yml'))
        # PREPARED, QUIESCED and FINALIZE bypass main; cover their rescue too.
        plays = tasks('playbooks/deploy-release-standard.yml')
        guarded = [play for play in plays if 'tasks' in play]
        self.assertEqual(len(guarded), 8)
        for play in guarded:
            with self.subTest(play=play['name']):
                self.assert_guard(play['tasks'])
        start = tasks('tasks/os-security-update-release-start.yml')
        self.assertEqual(start[0]['ansible.builtin.file']['mode'], '0755')
        marker = start[1]['ansible.builtin.copy']
        self.assertEqual(marker['dest'], '{{ os_security_update_release_marker }}')
        self.assertEqual(marker['owner'], 'root')
        self.assertIn('release_run_id', marker['content'])
        self.assertIn('now(', marker['content'])  # retries must refresh the stale-marker clock
        self.assertEqual(start[2]['ansible.builtin.command']['argv'],
                         ['flock', '-w', '1800', '{{ os_security_update_lock_path }}', 'true'])
        self.assertEqual(start[3]['ansible.builtin.assert']['that'], ['os_security_update_release_lock.rc == 0'])
        self.assertIn('1800', start[3]['ansible.builtin.assert']['fail_msg'])
        end = tasks('tasks/os-security-update-release-end.yml')
        self.assertEqual(end[0]['ansible.builtin.file'], {'path': '{{ os_security_update_release_marker }}', 'state': 'absent'})

    def test_seed_is_pending_once_and_precedes_timer_start(self):
        policy = tasks('tasks/os-security-update.yml')
        enabled = next(task for task in policy if 'block' in task)
        self.assertEqual(enabled['when'], 'os_security_update_enabled | bool')
        body = enabled['block']
        seed = next(task for task in body if 'ansible.builtin.copy' in task
                    and task['ansible.builtin.copy']['dest'].endswith('/state.json'))
        self.assertFalse(seed['ansible.builtin.copy']['force'])
        self.assertEqual(seed['when'], 'not os_security_update_state.stat.exists')
        self.assertEqual(seed['ansible.builtin.copy']['mode'], '0644')
        rendered = self.environment.from_string(seed['ansible.builtin.copy']['content']).render(
            os_security_update_mode='dry-run', os_security_update_enabled_at={'stdout': '2026-10-23T10:00:00+09:00'})
        self.assertEqual(json.loads(rendered), {
            'schemaVersion': 1, 'mode': 'dry-run', 'result': 'pending', 'reason': None,
            'lastRunAt': None, 'lastSuccessAt': None, 'lastFailureAt': None,
            'enabledAt': '2026-10-23T10:00:00+09:00', 'installed': [], 'selected': [],
            'heldBack': [], 'browserRestarted': False})
        timer = next(task for task in body if task.get('ansible.builtin.systemd', {}).get('enabled'))
        self.assertLess(body.index(seed), body.index(timer))
        self.assertEqual(timer['ansible.builtin.systemd']['name'], 'raspi-os-security-update.timer')
        self.assertTrue(timer['ansible.builtin.systemd']['daemon_reload'])

    def test_disable_preserves_files_and_only_stops_existing_timer(self):
        policy = tasks('tasks/os-security-update.yml')
        disable = policy[-1]
        self.assertEqual(disable['ansible.builtin.systemd'], {
            'name': 'raspi-os-security-update.timer', 'enabled': False, 'state': 'stopped'})
        self.assertIn('not (os_security_update_enabled | bool)', disable['when'])
        self.assertIn('os_security_update_disabled_timer.stat.exists', disable['when'])
        self.assertFalse(any(task.get('ansible.builtin.file', {}).get('state') == 'absent' for task in walk(policy)))
        rotation = self.render('raspi-os-security-update.logrotate', {})
        self.assertIn('/var/log/raspi-os-security-update.log', rotation)
        self.assertIn('rotate 12', rotation)


if __name__ == '__main__':
    unittest.main()
