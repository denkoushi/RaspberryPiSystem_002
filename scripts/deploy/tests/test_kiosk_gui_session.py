"""Render compatibility and reversible desktop account contracts (no target hosts)."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import unittest

import yaml
from jinja2 import ChainableUndefined, Environment, StrictUndefined

ROOT = Path(__file__).resolve().parents[3]
ANSIBLE = ROOT / 'infrastructure/ansible'
BASELINE = json.loads((Path(__file__).parent / 'fixtures/kiosk-session/disabled-baseline.json').read_text())


def environment():
    env = Environment(undefined=StrictUndefined, keep_trailing_newline=True)
    env.filters.update(
        bool=lambda value: str(value).lower() in ('true', '1', 'yes', 'on'),
        regex_replace=lambda value, pattern, replacement: re.sub(pattern, replacement, value),
    )
    return env


def tasks(items):
    for task in items:
        yield task
        for section in ('block', 'rescue', 'always'):
            yield from tasks(task.get(section, []))


def leaves(value, path=()):
    if isinstance(value, dict):
        for key, child in value.items():
            yield from leaves(child, path + (str(key),))
    elif isinstance(value, list):
        for index, child in enumerate(value):
            yield from leaves(child, path + (str(index),))
    elif isinstance(value, str):
        yield '.'.join(path), value


def load(path):
    return yaml.safe_load((ANSIBLE / path).read_text())


# Hosts allowed to enable the dedicated GUI account during the trial.
TRIAL_HOSTS = {
    'raspi4-kensaku-stonebase01',
    'raspi4-kensaku-02',
    'raspi4-sessaku-01',
    'raspi4-fjv60-80',
    'raspi4-robodrill01',
}


class KioskGuiSessionTests(unittest.TestCase):
    def context(self, user, flag=None):
        context = dict(release_kiosk_previous_gui_owner={}, ansible_user=user, item='fixture.desktop', group_names=['kiosk'],
                       getent_passwd={user: ['x', '1000', '1000', '', '/home/' + user, '/bin/bash']})
        if flag is not None:
            context['kiosk_unprivileged_session_enabled'] = flag
        if flag:
            context['getent_passwd']['kiosk-display'] = ['x', '1007', '1007', '', '/home/kiosk-display', '/bin/bash']
        defaults = load('group_vars/all.yml')
        env = environment()
        context['kiosk_unprivileged_session_user'] = defaults['kiosk_unprivileged_session_user']
        # Missing flags exercise the template/task fallbacks used by older callers.
        if flag is not None:
            for key in ('kiosk_gui_user', 'kiosk_gui_home', 'kiosk_gui_uid'):
                if key == 'kiosk_gui_uid' and not flag:
                    continue
                context[key] = env.from_string(defaults[key]).render(**context)
        return context

    def test_disabled_templates_match_prechange_for_every_kiosk_host(self):
        inventory = load('inventory.yml')['all']['children']['clients']['children']['kiosk']['hosts']
        self.assertEqual(set(inventory), set(BASELINE['hosts']))
        self.assertIs(load('group_vars/all.yml')['kiosk_unprivileged_session_enabled'], False)
        enabled = {host for host, values in inventory.items()
                   if values.get('kiosk_unprivileged_session_enabled', False)}
        self.assertEqual(enabled, TRIAL_HOSTS)
        env = environment()
        for host, host_context in BASELINE['hosts'].items():
            for flag in (None, False):
                context = host_context | self.context(host_context['ansible_user'], flag)
                for path, hashes in BASELINE['templates'].items():
                    with self.subTest(host=host, flag=flag, path=path):
                        rendered = env.from_string((ANSIBLE / path).read_text()).render(**context)
                        self.assertEqual(hashlib.sha256(rendered.encode()).hexdigest(), hashes[host])

    def test_disabled_existing_task_arguments_match_prechange_for_every_host(self):
        env = environment()
        for host, host_context in BASELINE['hosts'].items():
            for flag in (None, False):
                context = self.context(host_context['ansible_user'], flag)
                for path, expected_tasks in BASELINE['tasks'].items():
                    current = {task['name']: task for task in tasks(load(path))}
                    for name, expected_fields in expected_tasks.items():
                        actual_fields = dict(leaves(current[name]))
                        for field, expected in expected_fields.items():
                            with self.subTest(host=host, flag=flag, task=name, field=field):
                                extra = {'distrusted_nss_user': context['ansible_user']}
                                actual = env.from_string(actual_fields[field]).render(**(context | extra))
                                self.assertEqual(actual, expected.replace('fixture-deployer', context['ansible_user']))

    def test_enabled_templates_use_dedicated_home_uid_and_user(self):
        env = environment()
        context = BASELINE['hosts'][next(iter(BASELINE['hosts']))] | self.context('deployer', True)
        context['release_kiosk_user_uid'] = {'stdout': '1007'}
        browser = env.from_string((ANSIBLE / 'templates/kiosk-browser.service.j2').read_text()).render(**context)
        launcher = env.from_string((ANSIBLE / 'templates/kiosk-launch.sh.j2').read_text()).render(**context)
        hotcorner = env.from_string((ANSIBLE / 'roles/release_kiosk/templates/kiosk-hotcorner.service.j2').read_text()).render(**context)
        for rendered in (browser, hotcorner):
            self.assertIn('User=kiosk-display\n', rendered)
            self.assertIn('XAUTHORITY=/home/kiosk-display/.Xauthority', rendered)
            self.assertIn('XDG_RUNTIME_DIR=/run/user/1007', rendered)
            self.assertIn('DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1007/bus', rendered)
            self.assertNotIn('deployer', rendered)
        self.assertIn('FF_PROFILE="/home/kiosk-display/', launcher)
        self.assertIn('export XAUTHORITY=/home/kiosk-display/.Xauthority', launcher)
        self.assertLess(launcher.index('for attempt in'), launcher.index('exec "${BROWSER_BIN}"'))
        self.assertIn('xset q', launcher)
        self.assertIn('dbus-send --session', launcher)
        for source in ('templates/kiosk-browser.service.j2', 'roles/release_kiosk/templates/kiosk-hotcorner.service.j2',
                       'templates/kiosk-gui-session.conf.j2'):
            self.assertNotIn('sudo', (ANSIBLE / source).read_text().lower())

    def test_deployment_power_and_status_contracts_remain_unchanged(self):
        for path, expected in BASELINE['protected'].items():
            self.assertEqual(hashlib.sha256((ANSIBLE / path).read_bytes()).hexdigest(), expected, path)
            self.assertNotIn('kiosk_gui_', (ANSIBLE / path).read_text())

    def test_user_creation_is_locked_and_does_not_grant_administrative_groups(self):
        account = load('tasks/kiosk-gui-user.yml')[0]
        self.assertIn('kiosk_unprivileged_session_enabled', account['when'])
        user = next(t['ansible.builtin.user'] for t in account['block'] if 'ansible.builtin.user' in t)
        self.assertTrue(user['password_lock'])
        self.assertFalse(user['generate_ssh_key'])
        self.assertFalse(user['append'])
        self.assertEqual(load('group_vars/all.yml')['kiosk_unprivileged_session_groups'], [])
        guard = account['block'][0]['ansible.builtin.assert']['that']
        self.assertTrue(any("'sudo'" in expression and "'docker'" in expression for expression in guard))
        self.assertTrue(any('kiosk_unprivileged_session_user not in' in expression and "'sudo'" in expression for expression in guard))
        self.assertNotIn('sudoers', (ANSIBLE / 'tasks/kiosk-gui-user.yml').read_text())

    def test_gui_task_arguments_select_dedicated_account_and_nss_is_kiosk_only(self):
        env = environment()
        context = self.context('deployer', True)
        context['distrusted_nss_user'] = 'kiosk-display'
        for path, expected_tasks in BASELINE['tasks'].items():
            if path.endswith('rollback.yml'):
                continue  # Rollback deliberately uses the captured previous account.
            current = {task['name']: task for task in tasks(load(path))}
            for name, fields in expected_tasks.items():
                actual = dict(leaves(current[name]))
                for field, old in fields.items():
                    if field.endswith('.group') and 'getent_passwd' in actual[field]:
                        continue
                    rendered = env.from_string(actual[field]).render(**context)
                    self.assertNotIn('deployer', rendered, (path, name, field))
        policy = load('roles/common/tasks/distrusted-intermediates.yml')[0]
        for groups, expected in ((['kiosk'], 'kiosk-display'), (['signage'], 'deployer'), (['server'], 'deployer')):
            rendered = env.from_string(policy['vars']['distrusted_nss_user']).render(**(context | {'group_names': groups}))
            self.assertEqual(rendered, expected)
        self.assertEqual(policy['vars']['distrusted_nss_home'], '{{ getent_passwd[distrusted_nss_user][4] }}')

    def test_first_install_guard_is_before_preflight_and_mutation(self):
        first = load('roles/release_kiosk/tasks/first_install_preflight.yml')[0]
        condition = first['ansible.builtin.assert']['that']
        evaluate = environment().compile_expression(condition)
        self.assertFalse(evaluate(kiosk_unprivileged_session_enabled=True))
        self.assertTrue(evaluate(kiosk_unprivileged_session_enabled=False))
        self.assertTrue(evaluate())
        account_guard = load('tasks/kiosk-gui-user.yml')[0]['block'][0]['ansible.builtin.assert']
        self.assertIn('not (release_kiosk_first_install | default(false) | bool)', account_guard['that'])
        self.assertIn('first-install', account_guard['fail_msg'])

    def test_browser_only_transitions_still_deliver_matching_units(self):
        transaction = next(t['ansible.builtin.set_fact']['release_kiosk_files']
                           for t in load('roles/release_kiosk/tasks/prepare.yml')
                           if t['name'] == 'Define the Pi4 staged file transaction')
        context = dict(release_kiosk_services=[], release_kiosk_stage_dir='/stage',
                       manage_kiosk_browser=True, release_torque_cutover=False)
        for transition in (False, True):
            rendered = environment().from_string(transaction).render(
                **context, release_kiosk_gui_session_files_required=transition)
            self.assertEqual("'/etc/systemd/system/kiosk-browser.service'" in rendered, transition)
            self.assertEqual("'/usr/local/bin/kiosk-launch.sh'" in rendered, transition)
        ime = next(t for t in load('roles/release_kiosk/tasks/health.yml')
                   if t['name'] == 'Verify Japanese input in the dedicated GUI session')
        self.assertIn('kiosk_unprivileged_session_enabled', str(ime['when']))
        self.assertEqual(environment().from_string(ime['become_user']).render(
            **self.context('deployer', True)), 'kiosk-display')

    def test_release_ime_configures_user_without_package_operations(self):
        config = load('tasks/kiosk-gui-session-config.yml')[0]
        self.assertIn('kiosk_unprivileged_session_enabled', config['when'])
        keyboard = next(t for t in config['block'] if t['name'] == 'Apply the OS keyboard layout to the dedicated labwc session')
        self.assertEqual(keyboard['ansible.builtin.copy']['dest'], '{{ kiosk_gui_home }}/.config/labwc/environment')
        self.assertIn('XKB_DEFAULT_', keyboard['ansible.builtin.copy']['content'])
        ime = next(t for t in config['block'] if t['name'] == 'Prepare Japanese input for the dedicated GUI session')
        self.assertEqual(ime['ansible.builtin.include_role']['name'], 'kiosk')
        self.assertEqual(ime['ansible.builtin.include_role']['tasks_from'], '{{ item }}')
        self.assertEqual(ime['loop'], ['ibus-process-owner', 'ibus-settings'])
        self.assertEqual(ime['vars']['terminal_release_mode'], 'full')
        self.assertFalse(ime['vars']['ibus_reconcile_on_deploy'])
        included = [t for name in ime['loop'] for t in tasks(load('roles/kiosk/tasks/' + name + '.yml'))]
        self.assertTrue(any('ibus.desktop' in str(t) for t in included))
        self.assertTrue(any('ibus-engine.desktop' in str(t) for t in included))
        self.assertTrue(any(t['name'] == 'Persist IBus engine order and hotkey for kiosk user' for t in included))
        for task in included:
            self.assertFalse(any(key in task for key in ('ansible.builtin.apt', 'ansible.builtin.package',
                                                         'ansible.builtin.import_tasks', 'ansible.builtin.include_tasks',
                                                         'ansible.builtin.include_role')))
            self.assertNotIn('update_cache', str(task))
            self.assertNotIn('dpkg-query', str(task))

    def test_rollback_session_operations_require_candidate_dropin_change(self):
        rollback = load('roles/release_kiosk/tasks/rollback_gui_session.yml')[0]['block']
        operations = rollback[2:]
        self.assertEqual(len(operations), 3)
        env = environment()
        env.undefined = ChainableUndefined  # Ansible permits default on nested undefined values.
        for task in operations:
            evaluate = env.compile_expression(task['when'])
            for install in (None, False, True):
                for remove in (None, False, True):
                    context = {}
                    if install is not None:
                        context['kiosk_gui_autologin_install'] = {'changed': install}
                    if remove is not None:
                        context['kiosk_gui_autologin_remove'] = {'changed': remove}
                    with self.subTest(task=task['name'], install=install, remove=remove):
                        self.assertEqual(bool(evaluate(**context)), bool(install or remove))
        self.assertEqual(rollback[0]['when'], 'release_kiosk_gui_autologin_original.stat.exists')
        self.assertEqual(rollback[1]['when'], 'not release_kiosk_gui_autologin_original.stat.exists')

    def test_release_wait_and_rollback_order(self):
        switch = load('roles/release_kiosk/tasks/switch.yml')
        names = [t['name'] for t in switch]
        self.assertLess(names.index('Install the staged Pi4 release files with standard backups'),
                        names.index('Switch the GUI autologin account before starting the browser'))
        self.assertLess(names.index('Switch the GUI autologin account before starting the browser'),
                        names.index('Restart the kiosk browser to apply the exact release SHA'))
        rollback = load('roles/release_kiosk/tasks/rollback.yml')
        names = [t['name'] for t in rollback]
        self.assertLess(names.index('Restore backed-up Pi4 release files'),
                        names.index('Restore the previous GUI session before restarting display services'))
        self.assertLess(names.index('Restore the previous GUI session before restarting display services'),
                        names.index('Restart restored Pi4 display unit'))
        session_switch = [t['name'] for t in load('tasks/kiosk-gui-session-switch.yml')]
        self.assertLess(session_switch.index('Stop the browser before restarting its GUI session'),
                        session_switch.index('Restart LightDM after changing the GUI autologin account'))
        wait = load('tasks/kiosk-gui-session-wait.yml')[0]
        for required in ('test -S /tmp/.X11-unix/X0', 'test -S "${XDG_RUNTIME_DIR}/bus"', 'pgrep -u', 'xset q', 'dbus-send --session'):
            self.assertIn(required, wait['ansible.builtin.shell'])
        for path in ('tasks/kiosk-gui-user.yml', 'tasks/kiosk-gui-session-config.yml', 'tasks/kiosk-gui-session-wait.yml',
                     'roles/release_kiosk/tasks/prepare.yml'):
            self.assertIn('LC_ALL: C.UTF-8', (ANSIBLE / path).read_text())
        for task in load('tasks/kiosk-gui-session-config.yml')[0]['block']:
            if 'ansible.builtin.include_role' in task:
                self.assertEqual(task['ansible.builtin.include_role']['apply']['environment']['LC_ALL'], 'C.UTF-8')

class GuiSessionTransactionTests(unittest.TestCase):
    @unittest.skipUnless(shutil.which('ansible-playbook'), 'Ansible is required')
    def test_dropin_enable_idempotence_unset_and_both_rollback_directions(self):
        # Real Ansible file/template/copy/stat modules in a temporary directory;
        # systemd and session readiness are the only mocked host operations.
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            dropin = root / 'lightdm/99-kiosk-gui-session.conf'
            stage = root / 'stage'
            stage.mkdir()
            lightdm_path = '/etc/lightdm/lightdm.conf.d'

            def sandbox(items):
                result = []
                for source in items:
                    task = json.loads(json.dumps(source))
                    for section in ('block', 'rescue', 'always'):
                        if section in task:
                            task[section] = sandbox(task[section])
                    if 'ansible.builtin.systemd' in task:
                        unit = task.pop('ansible.builtin.systemd')
                        task['ansible.builtin.debug'] = {'msg': 'LIGHTDM_RESTART' if unit['name'] == 'lightdm.service' else 'BROWSER_STOP'}
                    if 'ansible.builtin.import_tasks' in task:
                        task.pop('ansible.builtin.import_tasks')
                        task.pop('vars', None)
                        task['ansible.builtin.debug'] = {'msg': 'SESSION_READY'}
                    for module in ('file', 'copy', 'template', 'stat'):
                        args = task.get('ansible.builtin.' + module)
                        if not args:
                            continue
                        for key in ('owner', 'group'):
                            args.pop(key, None)
                        for key in ('path', 'src', 'dest'):
                            if key in args:
                                args[key] = args[key].replace(lightdm_path, str(dropin.parent))
                        if module == 'template':
                            args['src'] = str(ANSIBLE / 'templates/kiosk-gui-session.conf.j2')
                    result.append(task)
                return result

            prepare = load('roles/release_kiosk/tasks/prepare_gui_session.yml')
            prepare = [t for t in prepare if t['name'] in (
                'Capture the original GUI autologin drop-in metadata',
                'Back up the original GUI autologin drop-in')]
            for name, contents in (
                ('prepare', sandbox(prepare)),
                ('switch', sandbox(load('tasks/kiosk-gui-session-switch.yml'))),
                ('rollback', sandbox(load('roles/release_kiosk/tasks/rollback_gui_session.yml'))),
            ):
                (root / (name + '.yml')).write_text(yaml.safe_dump(contents, sort_keys=False))

            def include(name, flag=None):
                task = {'ansible.builtin.include_tasks': str(root / (name + '.yml'))}
                if flag is not None:
                    task['vars'] = {'kiosk_unprivileged_session_enabled': flag}
                return task

            def verify(content):
                if content is None:
                    return [{'ansible.builtin.stat': {'path': str(dropin)}, 'register': 'verified'},
                            {'ansible.builtin.assert': {'that': 'not verified.stat.exists'}}]
                return [{'ansible.builtin.slurp': {'src': str(dropin)}, 'register': 'verified'},
                        {'ansible.builtin.assert': {'that': "(verified.content | b64decode) == expected_content"},
                         'vars': {'expected_content': content}}]

            enabled = environment().from_string((ANSIBLE / 'templates/kiosk-gui-session.conf.j2').read_text()).render(kiosk_gui_user='kiosk-display')
            # Rollback before either switch result exists must leave the session alone.
            steps = [{'ansible.builtin.set_fact': {'kiosk_gui_autologin_attempted': True}},
                     include('prepare'), include('rollback', True)] + verify(None)
            steps += [include('switch')] + verify(None)
            steps += [include('prepare'), include('switch', True)] + verify(enabled)
            # Roll back an enabling candidate to the originally absent drop-in.
            steps += [include('rollback', True)] + verify(None)
            steps += [include('switch', True), include('switch', True)] + verify(enabled)
            # An unchanged enabled candidate must also roll back without a session restart.
            steps += [include('prepare'), include('rollback', True)] + verify(enabled)
            steps += [include('prepare'), include('switch')] + verify(None)
            # Roll back flag removal to the captured dedicated autologin.
            steps += [include('rollback')] + verify(enabled)
            steps += [include('switch')] + verify(None)
            play = [{'hosts': 'localhost', 'gather_facts': False, 'connection': 'local',
                     'vars': {'ansible_python_interpreter': shutil.which('python3'), 'ansible_user': 'fixture-deployer',
                              'release_kiosk_stage_dir': str(stage),
                              'kiosk_gui_user': "{{ 'kiosk-display' if (kiosk_unprivileged_session_enabled | default(false) | bool) else ansible_user }}"},
                     'tasks': steps}]
            (root / 'play.yml').write_text(yaml.safe_dump(play, sort_keys=False))
            (root / 'ansible.cfg').write_text('[defaults]\nretry_files_enabled = False\n')
            result = subprocess.run(['ansible-playbook', '-i', 'localhost,', str(root / 'play.yml')],
                                    text=True, capture_output=True, timeout=120,
                                    env={**os.environ, 'ANSIBLE_CONFIG': str(root / 'ansible.cfg'),
                                         'ANSIBLE_LOCAL_TEMP': str(root / 'local'), 'ANSIBLE_REMOTE_TEMP': str(root / 'remote')})
            output = result.stdout + result.stderr
            self.assertEqual(result.returncode, 0, output[-8000:])
            self.assertFalse(dropin.exists())
            # Six changes: enable, rollback enable, enable, unset, rollback unset, unset.
            self.assertEqual(output.count('"msg": "LIGHTDM_RESTART"'), 6, output[-8000:])
            self.assertEqual(output.count('"msg": "BROWSER_STOP"'), 6, output[-8000:])
            self.assertEqual(output.count('"msg": "SESSION_READY"'), 7, output[-8000:])


if __name__ == '__main__':
    unittest.main()
