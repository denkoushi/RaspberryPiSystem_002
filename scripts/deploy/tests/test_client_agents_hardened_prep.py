"""Release-only hardening gates and stopped SQLite queue migration contracts."""
from __future__ import annotations

import io
import json
import os
import subprocess
import tarfile
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

import yaml
from jinja2 import Environment, StrictUndefined

ROOT = Path(__file__).resolve().parents[3]
TASKS = ROOT / 'infrastructure/ansible/roles/release_kiosk/tasks'


class ClientAgentsHardenedPrepTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tasks = yaml.safe_load((TASKS / 'agents_hardened_prep.yml').read_text())
        cls.storage = cls.tasks[1]['block'][0]
        cls.script = cls.storage['ansible.builtin.shell'].split("<<'PY'\n", 1)[1].rsplit('\nPY', 1)[0]

    def test_hardened_includes_and_all_blocks_skip_false_or_missing_flag(self):
        environment = Environment(undefined=StrictUndefined)
        environment.filters['bool'] = lambda value: str(value).lower() in {'true', '1', 'yes', 'on'}
        for filename, phase in [('prepare.yml', 'prepare'), ('switch.yml', 'switch')]:
            tasks = yaml.safe_load((TASKS / filename).read_text())
            includes = [task for task in tasks if task.get('ansible.builtin.include_tasks') == 'agents_hardened_prep.yml']
            self.assertEqual(len(includes), 1)
            self.assertEqual(includes[0]['vars']['release_kiosk_hardened_phase'], phase)
            for task in [includes[0], *self.tasks]:
                conditions = task['when']
                condition = conditions[0] if isinstance(conditions, list) else conditions
                expression = environment.compile_expression(condition)
                for variables in ({}, {'client_agents_hardened': False}, {'client_agents_hardened': 'false'}):
                    self.assertFalse(expression(**variables))
                self.assertTrue(expression(client_agents_hardened=True))

    def test_switch_prep_skips_torque_cutover(self):
        environment = Environment(undefined=StrictUndefined)
        environment.filters['bool'] = lambda value: str(value).lower() in {'true', '1', 'yes', 'on'}
        tasks = yaml.safe_load((TASKS / 'switch.yml').read_text())
        include = next(task for task in tasks if task.get('ansible.builtin.include_tasks') == 'agents_hardened_prep.yml')
        expressions = [environment.compile_expression(condition) for condition in include['when']]

        def runs(**variables):
            return all(expression(**variables) for expression in expressions)

        self.assertTrue(runs(client_agents_hardened=True))
        self.assertTrue(runs(client_agents_hardened=True, release_torque_cutover=False))
        self.assertFalse(runs(client_agents_hardened=True, release_torque_cutover=True))

    def test_inventory_enables_only_the_trial_host(self):
        inventory = yaml.safe_load((ROOT / 'infrastructure/ansible/inventory.yml').read_text())
        enabled = []

        def walk(group):
            for host, variables in (group.get('hosts') or {}).items():
                if variables and variables.get('client_agents_hardened') is True:
                    enabled.append(host)
            for child in (group.get('children') or {}).values():
                walk(child)

        for group in inventory.values():
            walk(group)
        self.assertEqual(enabled, ['raspi4-kensaku-stonebase01'])

    def test_prepare_gate_and_switch_prep_precede_recreation(self):
        prepare = (TASKS / 'prepare.yml').read_text()
        self.assertLess(prepare.index('agents_hardened_prep.yml'), prepare.index('Render the candidate Pi4 Compose'))
        switch = (TASKS / 'switch.yml').read_text()
        for boundary in ('create --force-recreate', 'up -d --no-build'):
            self.assertLess(switch.index('agents_hardened_prep.yml'), switch.index(boundary))
        torque = self.tasks[1]['block'][1]
        self.assertEqual(torque['when'], "'torque-agent' in release_kiosk_services")
        text = yaml.safe_dump(torque)
        for expected in ('torque-bluetooth-guard.service.j2', '99-torque-wrench-hid.rules.j2',
                         'udevadm settle --timeout=30', 'daemon_reload: true'):
            self.assertIn(expected, text)

    def test_group_checks_only_require_enabled_services(self):
        task = self.tasks[0]['block'][1]
        self.assertEqual(task['when'], 'item.services | intersect(release_kiosk_enabled_services) | length > 0')
        self.assertEqual({item['name']: (item['gid'], item['services']) for item in task['loop']}, {
            'plugdev': ('46', ['nfc-agent']), 'dialout': ('20', ['barcode-agent']),
            'input': ('104', ['nfc-agent', 'torque-agent']),
        })

    def run_storage(self, *, volumes=('actual-labeled-volume',), containers=('old-container',),
                    running=True, mounted=False, queue=True, service='nfc-agent',
                    cp_error=None, stray=False):
        calls = []
        archive_buffer = io.BytesIO()
        with tarfile.open(fileobj=archive_buffer, mode='w') as archive:
            for suffix in (('', '-wal', '-shm') if queue else ()):
                content = ('queue' + suffix).encode()
                member = tarfile.TarInfo('data/nfc-agent-queue.db' + suffix)
                member.size = len(content)
                archive.addfile(member, io.BytesIO(content))
            if stray:
                member = tarfile.TarInfo('data/nfc-agent-queue.db-wal')
                member.size = 3
                archive.addfile(member, io.BytesIO(b'wal'))
        archive = archive_buffer.getvalue()

        def run(argv, **kwargs):
            calls.append((argv, kwargs))
            command = argv[1]
            result = b''
            rc = 0
            if command == 'volume':
                result = '\n'.join(volumes).encode()
            elif command == 'ps':
                result = '\n'.join(containers).encode()
            elif command == 'inspect':
                result = json.dumps([{'State': {'Running': running}, 'Mounts':
                    [{'Destination': '/app/nfc-agent/data'}] if mounted else []}]).encode()
            elif command == 'cp':
                result = archive
                rc = 1 if cp_error else 0
            return SimpleNamespace(stdout=result, returncode=rc, args=argv,
                                   stderr=(cp_error or '').encode())

        with mock.patch.dict(os.environ, AGENT_PROJECT='fixture-project', AGENT_SERVICE=service,
                             AGENT_IMAGE='fixture-candidate'), mock.patch('subprocess.run', side_effect=run):
            try:
                exec(compile(self.script, '<hardened-storage-task>', 'exec'), {})
            except SystemExit as error:
                if error.code != 0:
                    raise
        return calls

    def test_absent_volume_does_not_stop_or_create_anything(self):
        calls = self.run_storage(volumes=(), containers=())
        self.assertEqual([argv[1] for argv, _ in calls], ['volume', 'ps'])
        self.assertIn('label=com.docker.compose.project=fixture-project', calls[0][0])
        self.assertIn('label=com.docker.compose.volume=nfc-agent-data', calls[0][0])

    def test_absent_volume_with_existing_container_fails_before_stopping(self):
        with self.assertRaisesRegex(SystemExit, 'no Compose data volume'):
            self.run_storage(volumes=())

    def test_old_data_without_queue_database_fails_before_volume_mutation(self):
        with self.assertRaisesRegex(SystemExit, 'no queue database'):
            self.run_storage(queue=False, stray=True)

    def test_ambiguous_volume_fails_before_stopping_writers(self):
        with self.assertRaisesRegex(SystemExit, 'exactly one Compose data volume'):
            self.run_storage(volumes=('one', 'two'))

    def test_legacy_queue_copy_is_after_stop_and_before_recursive_chown(self):
        calls = self.run_storage()
        commands = [argv[1] for argv, _ in calls]
        self.assertLess(commands.index('stop'), commands.index('cp'))
        maintenance = [(argv, options) for argv, options in calls if argv[1] == 'run']
        self.assertEqual(len(maintenance), 2)
        for argv, _ in maintenance:
            self.assertIn('type=volume,src=actual-labeled-volume,dst=/data', argv)
            self.assertEqual(argv[argv.index('--user') + 1], '0:0')
        self.assertEqual(maintenance[-1][0][-3:], ['-R', '10001:10001', '/data'])
        self.copy_script = maintenance[0][0][-1]
        self.archive = maintenance[0][1]['input']
        # Exercise the actual maintenance program with a temporary volume path.
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory)
            with mock.patch('pathlib.Path', return_value=target), mock.patch('sys.stdin',
                            SimpleNamespace(buffer=io.BytesIO(self.archive))):
                exec(self.copy_script, {})
            for suffix in ('', '-wal', '-shm'):
                self.assertEqual((target / ('nfc-agent-queue.db' + suffix)).read_bytes(), ('queue' + suffix).encode())
            (target / 'nfc-agent-queue.db').write_bytes(b'existing-volume-queue')
            with mock.patch('pathlib.Path', return_value=target), mock.patch('sys.stdin',
                            SimpleNamespace(buffer=io.BytesIO(self.archive))):
                exec(self.copy_script, {})
            self.assertEqual((target / 'nfc-agent-queue.db').read_bytes(), b'existing-volume-queue')

    def test_missing_or_already_hardened_old_queue_only_chowns(self):
        for options in ({'containers': ()}, {'mounted': True},
                        {'service': 'torque-agent'}):
            with self.subTest(options=options):
                calls = self.run_storage(**options)
                self.assertNotIn('cp', [argv[1] for argv, _ in calls])
                maintenance = [argv for argv, _ in calls if argv[1] == 'run']
                self.assertEqual(len(maintenance), 1)
                self.assertIn('chown', maintenance[0])

    def test_stopped_legacy_container_queue_is_also_migrated(self):
        calls = self.run_storage(running=False)
        commands = [argv[1] for argv, _ in calls]
        self.assertNotIn('stop', commands)
        self.assertNotIn('exec', commands)
        self.assertIn('cp', commands)
        self.assertEqual(commands.count('run'), 2)

    def test_missing_queue_or_data_directory_only_chowns(self):
        for running in (False, True):
            for options in ({'queue': False}, {'cp_error':
                    'Error response from daemon: Could not find the file /app/nfc-agent/data/. in container old-container'}):
                with self.subTest(running=running, options=options):
                    calls = self.run_storage(running=running, **options)
                    commands = [argv[1] for argv, _ in calls]
                    self.assertIn('cp', commands)
                    self.assertNotIn('exec', commands)
                    maintenance = [argv for argv, _ in calls if argv[1] == 'run']
                    self.assertEqual(len(maintenance), 1)
                    self.assertIn('chown', maintenance[0])

    def test_other_copy_errors_fail_without_volume_mutation(self):
        for running in (False, True):
            with self.subTest(running=running), self.assertRaises(subprocess.CalledProcessError):
                self.run_storage(running=running, cp_error='Error response from daemon: permission denied')

    def test_prepare_supplies_client_defaults_for_all_host_policy_templates(self):
        task = self.tasks[0]['block'][0]
        self.assertEqual(task['when'], "'torque-agent' in release_kiosk_services")
        defaults = yaml.safe_load((TASKS.parent.parent / 'client/defaults/main.yml').read_text())
        environment = Environment(undefined=StrictUndefined)
        environment.filters['bool'] = bool
        expression = environment.compile_expression(
            task['ansible.builtin.set_fact']['torque_agent_hid_links'][3:-3])
        templates = self.tasks[1]['block'][1]['block'][1]['loop']
        override = [{'vendor_id': '1234', 'product_id': '5678', 'name': 'wrench',
                     'uniq': 'aa:bb', 'link_name': 'torque-wrench'}]
        for variables in ({}, {'torque_agent_hid_links': override}):
            links = expression(**variables)
            self.assertEqual(links, variables.get('torque_agent_hid_links', defaults['torque_agent_hid_links']))
            for template in templates:
                source = (TASKS.parent.parent / 'client/templates' / template['src']).read_text()
                rendered = environment.from_string(source).render(
                    client_agents_hardened=True, torque_agent_hid_links=links)
                if template['src'].endswith('rules.j2') and variables:
                    self.assertIn('input/by-id/torque-wrench', rendered)
