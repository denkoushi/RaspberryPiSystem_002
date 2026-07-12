import argparse
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch


SCRIPT = Path(__file__).parents[1] / 'rolling-release.py'
SPEC = importlib.util.spec_from_file_location('rolling_release', SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class RollingReleaseTargetOrderTest(unittest.TestCase):
    def test_canary_then_remaining_kiosks_then_signage(self):
        inventory = {
            'kiosk_canary': {'hosts': ['kiosk-b']},
            '_meta': {'hostvars': {
                'kiosk-a': {'manage_kiosk_browser': True, 'status_agent_client_id': 'a'},
                'kiosk-b': {'manage_kiosk_browser': True, 'status_agent_client_id': 'b'},
                'signage-a': {'manage_signage_lite': True, 'status_agent_client_id': 's'},
                'server': {},
            }},
        }
        self.assertEqual(
            [target['host'] for target in MODULE.release_targets(inventory)],
            ['kiosk-b', 'kiosk-a', 'signage-a'],
        )

    def test_limit_never_reintroduces_non_selected_terminal(self):
        inventory = {
            'kiosk_canary': {'hosts': ['kiosk-b']},
            '_meta': {'hostvars': {
                'kiosk-a': {'manage_kiosk_browser': True, 'status_agent_client_id': 'a'},
                'kiosk-b': {'manage_kiosk_browser': True, 'status_agent_client_id': 'b'},
                'signage-a': {'manage_signage_lite': True, 'status_agent_client_id': 's'},
            }},
        }
        self.assertEqual([item['host'] for item in MODULE.release_targets(inventory, ['signage-a'])], ['signage-a'])

    def test_remote_runner_accepts_named_branch_and_inventory(self):
        args = MODULE.normalize_arguments(MODULE.parser().parse_args([
            '--remote-run', '--branch', 'main', '--inventory', 'inventory.yml',
            '--sha', 'a' * 40, '--run-id', 'run-1',
        ]))
        self.assertEqual(args.branch, 'main')
        self.assertEqual(args.inventory, 'inventory.yml')


class Pi5StabilityMonitorTest(unittest.TestCase):
    def test_waits_for_monitor_then_runs_cleanup_before_terminal_rollout(self):
        state = MODULE.ReleaseState(Path('/tmp/unused-release-state.json'), {'pi5': {'state': 'stability-monitoring'}})
        state.save = Mock()
        future = 1_800_000_005
        with patch.object(MODULE, 'run', side_effect=[
            json.dumps({'runtimeStatus': 'consistent', 'stableUntil': future}),
            json.dumps({'runtimeStatus': 'consistent', 'stableUntil': future}),
            '',
        ]) as command, patch.object(MODULE.time, 'time', side_effect=[1_800_000_000, 1_800_000_000, future]), patch.object(MODULE.time, 'sleep') as sleep:
            MODULE.wait_for_pi5_stability(state)
        sleep.assert_called_once_with(5)
        self.assertEqual(command.call_args_list[-1].args[0][1], 'cleanup')
        self.assertEqual(state.payload['pi5']['state'], 'stable')
        state.save.assert_called_once()


class RollbackStateTest(unittest.TestCase):
    def test_successful_rollback_clears_only_the_recovered_terminal(self):
        target = {'state': 'rolling-back', 'previousSha': 'old-sha'}
        target_spec = {'host': 'kiosk-a', 'clientId': 'client-a', 'terminalType': 'kiosk'}
        with patch.object(MODULE, 'playbook') as playbook, patch.object(MODULE, 'state_command') as command:
            self.assertTrue(MODULE.rollback_terminal('inventory.yml', target_spec, target, 'run-1'))
        playbook.assert_called_once_with('inventory.yml', 'kiosk-a', 'old-sha', 'run-1', rollback=True)
        command.assert_called_once_with('remove-client', '--run-id', 'run-1', '--client', 'client-a')
        self.assertEqual(target['rollback'], 'success')
        self.assertIn('maintenanceClearedAt', target)

    def test_failed_rollback_keeps_only_the_failed_terminal_in_maintenance(self):
        target = {'state': 'rolling-back', 'previousSha': 'old-sha'}
        target_spec = {'host': 'kiosk-a', 'clientId': 'client-a', 'terminalType': 'kiosk'}
        with patch.object(MODULE, 'playbook', side_effect=RuntimeError('rollback unavailable')), patch.object(MODULE, 'state_command') as command:
            self.assertFalse(MODULE.rollback_terminal('inventory.yml', target_spec, target, 'run-1'))
        command.assert_called_once_with('set-phase', '--run-id', 'run-1', '--phase', 'failed')
        self.assertEqual(target['rollback'], 'failed: rollback unavailable')
        self.assertNotIn('maintenanceClearedAt', target)


class Pi5IdempotentSkipTest(unittest.TestCase):
    def setUp(self):
        self.sha = 'a' * 40
        self.state = MODULE.ReleaseState(Path('/tmp/unused-release-state.json'), {})
        self.state.save = Mock()

    def test_marker_match_and_consistent_skips_with_already_current_state(self):
        with patch.object(MODULE, 'pi5_already_current', return_value=True) as already, \
                patch.object(MODULE, 'phase3_release') as release, \
                patch.object(MODULE, 'wait_for_pi5_stability') as wait, \
                patch.object(MODULE, 'record_pi5_release_current') as record:
            MODULE.ensure_pi5_release(self.sha, self.state)
        already.assert_called_once_with(self.sha)
        release.assert_not_called()
        wait.assert_not_called()
        record.assert_not_called()
        self.assertEqual(self.state.payload['pi5'], {'state': 'already-current', 'sha': self.sha})
        self.state.save.assert_called_once()

    def test_marker_mismatch_runs_blue_green(self):
        with patch.object(MODULE, 'read_pi5_release_current', return_value={'sha': 'b' * 40}), \
                patch.object(MODULE, 'run') as command, \
                patch.object(MODULE, 'phase3_release') as release, \
                patch.object(MODULE, 'wait_for_pi5_stability') as wait, \
                patch.object(MODULE, 'record_pi5_release_current') as record:
            self.state.payload['pi5'] = {'candidate': {'api': 'api:tag', 'web': 'web:tag'}, 'state': 'stable'}
            MODULE.ensure_pi5_release(self.sha, self.state)
        command.assert_not_called()
        release.assert_called_once_with(self.sha, self.state)
        wait.assert_called_once_with(self.state)
        record.assert_called_once_with(self.sha, {'api': 'api:tag', 'web': 'web:tag'})

    def test_missing_marker_runs_blue_green(self):
        with patch.object(MODULE, 'read_pi5_release_current', return_value=None), \
                patch.object(MODULE, 'phase3_release') as release, \
                patch.object(MODULE, 'wait_for_pi5_stability') as wait, \
                patch.object(MODULE, 'record_pi5_release_current') as record:
            self.state.payload['pi5'] = {'candidate': {'api': 'api:tag'}, 'state': 'stable'}
            MODULE.ensure_pi5_release(self.sha, self.state)
        release.assert_called_once_with(self.sha, self.state)
        wait.assert_called_once_with(self.state)
        record.assert_called_once_with(self.sha, {'api': 'api:tag'})

    def test_inconsistent_status_runs_blue_green(self):
        with patch.object(MODULE, 'read_pi5_release_current', return_value={'sha': self.sha}), \
                patch.object(MODULE, 'run', return_value=json.dumps({'runtimeStatus': 'stale'})), \
                patch.object(MODULE, 'phase3_release') as release, \
                patch.object(MODULE, 'wait_for_pi5_stability') as wait, \
                patch.object(MODULE, 'record_pi5_release_current') as record:
            self.state.payload['pi5'] = {'candidate': {'api': 'api:tag'}, 'state': 'stable'}
            MODULE.ensure_pi5_release(self.sha, self.state)
        release.assert_called_once_with(self.sha, self.state)
        wait.assert_called_once_with(self.state)
        record.assert_called_once_with(self.sha, {'api': 'api:tag'})

    def test_pi5_already_current_requires_marker_and_consistent_status(self):
        with patch.object(MODULE, 'read_pi5_release_current', return_value={'sha': self.sha}), \
                patch.object(MODULE, 'run', return_value=json.dumps({'runtimeStatus': 'consistent'})) as command:
            self.assertTrue(MODULE.pi5_already_current(self.sha))
        self.assertEqual(command.call_args.args[0], [str(MODULE.PHASE3), 'status'])

    def test_pi5_already_current_fail_closed_on_status_error(self):
        with patch.object(MODULE, 'read_pi5_release_current', return_value={'sha': self.sha}), \
                patch.object(MODULE, 'run', side_effect=RuntimeError('status unavailable')):
            self.assertFalse(MODULE.pi5_already_current(self.sha))


class CanaryHoldTest(unittest.TestCase):
    def _args(self, **overrides):
        values = {
            'inventory': 'inventory.yml',
            'limit': '',
            'run_id': 'run-1',
            'branch': 'main',
            'sha': 'a' * 40,
            'emergency_override': False,
            'reason': None,
            'skip_canary_hold': False,
            'canary_hold_timeout': 60,
        }
        values.update(overrides)
        return argparse.Namespace(**values)

    def _run_remote(self, targets, *, wait_for_ack, args=None, played=None):
        played = played if played is not None else []

        def playbook(_inventory, host, _sha, _run_id, rollback=False):
            played.append(host)

        with tempfile.TemporaryDirectory() as temporary:
            run_directory = Path(temporary)
            with patch.object(MODULE, 'RUN_DIRECTORY', run_directory), \
                    patch.object(MODULE, 'inventory_json', return_value={}), \
                    patch.object(MODULE, 'selected_hosts', return_value=None), \
                    patch.object(MODULE, 'release_targets', return_value=targets), \
                    patch.object(MODULE, 'pi5_release_required', return_value=False), \
                    patch.object(MODULE, 'remote_previous_sha', return_value='old-sha'), \
                    patch.object(MODULE, 'wait_for_ack', side_effect=wait_for_ack), \
                    patch.object(MODULE, 'state_command'), \
                    patch.object(MODULE, 'prestage_signage_maintenance'), \
                    patch.object(MODULE, 'playbook', side_effect=playbook), \
                    patch.object(MODULE, 'utc_now', return_value='2026-07-12T00:00:00Z'):
                result = MODULE._remote_run(args or self._args())
            state_path = run_directory / 'run-1.json'
            payload = json.loads(state_path.read_text(encoding='utf-8')) if state_path.exists() else None
        return result, played, payload

    def test_canary_hold_continues_after_operator_ack(self):
        targets = [
            {'host': 'kiosk-canary', 'clientId': 'canary', 'terminalType': 'kiosk'},
            {'host': 'kiosk-b', 'clientId': 'b', 'terminalType': 'kiosk'},
        ]
        hold_calls = []

        def wait_for_ack(run_id, client_id, timeout=30):
            hold_calls.append((client_id, timeout))
            return True

        result, played, payload = self._run_remote(targets, wait_for_ack=wait_for_ack)
        self.assertEqual(result, 0)
        self.assertEqual(played, ['kiosk-canary', 'kiosk-b'])
        self.assertIn((MODULE.OPERATOR_CANARY_APPROVAL_CLIENT, 60), hold_calls)
        self.assertEqual(payload['canaryHold']['state'], 'approved')
        self.assertEqual(payload['canaryHold']['canary'], 'kiosk-canary')
        self.assertEqual(payload['state'], 'success')

    def test_canary_hold_timeout_fails_closed_without_remaining_targets(self):
        targets = [
            {'host': 'kiosk-canary', 'clientId': 'canary', 'terminalType': 'kiosk'},
            {'host': 'kiosk-b', 'clientId': 'b', 'terminalType': 'kiosk'},
        ]

        def wait_for_ack(_run_id, client_id, timeout=30):
            return client_id != MODULE.OPERATOR_CANARY_APPROVAL_CLIENT

        played = []

        def playbook(_inventory, host, _sha, _run_id, rollback=False):
            played.append(host)

        with tempfile.TemporaryDirectory() as temporary:
            run_directory = Path(temporary)
            with patch.object(MODULE, 'RUN_DIRECTORY', run_directory), \
                    patch.object(MODULE, 'inventory_json', return_value={}), \
                    patch.object(MODULE, 'selected_hosts', return_value=None), \
                    patch.object(MODULE, 'release_targets', return_value=targets), \
                    patch.object(MODULE, 'pi5_release_required', return_value=False), \
                    patch.object(MODULE, 'remote_previous_sha', return_value='old-sha'), \
                    patch.object(MODULE, 'wait_for_ack', side_effect=wait_for_ack), \
                    patch.object(MODULE, 'state_command'), \
                    patch.object(MODULE, 'playbook', side_effect=playbook), \
                    patch.object(MODULE, 'utc_now', return_value='2026-07-12T00:00:00Z'):
                with self.assertRaises(RuntimeError) as raised:
                    MODULE._remote_run(self._args())
            payload = json.loads((run_directory / 'run-1.json').read_text(encoding='utf-8'))
        self.assertIn('canary hold timed out', str(raised.exception))
        self.assertEqual(played, ['kiosk-canary'])
        self.assertEqual(payload['canaryHold']['state'], 'waiting-verification')
        self.assertEqual(payload['state'], 'failed')

    def test_skip_canary_hold_rolls_out_all_targets(self):
        targets = [
            {'host': 'kiosk-canary', 'clientId': 'canary', 'terminalType': 'kiosk'},
            {'host': 'kiosk-b', 'clientId': 'b', 'terminalType': 'kiosk'},
        ]
        hold_clients = []

        def wait_for_ack(_run_id, client_id, timeout=30):
            hold_clients.append(client_id)
            return True

        result, played, payload = self._run_remote(
            targets,
            wait_for_ack=wait_for_ack,
            args=self._args(skip_canary_hold=True),
        )
        self.assertEqual(result, 0)
        self.assertEqual(played, ['kiosk-canary', 'kiosk-b'])
        self.assertNotIn(MODULE.OPERATOR_CANARY_APPROVAL_CLIENT, hold_clients)
        self.assertNotIn('canaryHold', payload)

    def test_single_canary_target_skips_hold(self):
        targets = [{'host': 'kiosk-canary', 'clientId': 'canary', 'terminalType': 'kiosk'}]
        hold_clients = []

        def wait_for_ack(_run_id, client_id, timeout=30):
            hold_clients.append(client_id)
            return True

        result, played, payload = self._run_remote(targets, wait_for_ack=wait_for_ack)
        self.assertEqual(result, 0)
        self.assertEqual(played, ['kiosk-canary'])
        self.assertNotIn(MODULE.OPERATOR_CANARY_APPROVAL_CLIENT, hold_clients)
        self.assertNotIn('canaryHold', payload)

    def test_signage_only_skips_hold(self):
        targets = [
            {'host': 'signage-a', 'clientId': 's1', 'terminalType': 'signage'},
            {'host': 'signage-b', 'clientId': 's2', 'terminalType': 'signage'},
        ]
        hold_clients = []

        def wait_for_ack(_run_id, client_id, timeout=30):
            hold_clients.append(client_id)
            return True

        result, played, payload = self._run_remote(targets, wait_for_ack=wait_for_ack)
        self.assertEqual(result, 0)
        self.assertEqual(played, ['signage-a', 'signage-b'])
        self.assertNotIn(MODULE.OPERATOR_CANARY_APPROVAL_CLIENT, hold_clients)
        self.assertNotIn('canaryHold', payload)

    def test_local_forwards_canary_hold_flags(self):
        captured = {}

        def fake_run(command, **_kwargs):
            if command[:3] == ['git', '-C', str(MODULE.PROJECT)] and 'rev-parse' in command:
                return 'a' * 40 + '\n'
            return ''

        def fake_subprocess_run(command, **_kwargs):
            if command[:2] == ['git', '-C']:
                return Mock(returncode=0)
            if command[0] == 'ssh':
                captured['remote'] = command[2]
                return Mock(returncode=0)
            return Mock(returncode=0)

        args = MODULE.normalize_arguments(MODULE.parser().parse_args([
            'main', 'infrastructure/ansible/inventory.yml',
            '--skip-canary-hold', '--canary-hold-timeout', '90',
        ]))
        with patch.object(MODULE, 'run', side_effect=fake_run), \
                patch.object(MODULE.subprocess, 'run', side_effect=fake_subprocess_run), \
                patch.dict(MODULE.os.environ, {'RASPI_SERVER_HOST': 'pi5.example'}):
            MODULE.local_run(args)
        self.assertIn('--canary-hold-timeout 90', captured['remote'])
        self.assertIn('--skip-canary-hold', captured['remote'])

    def test_local_approve_sshes_like_status(self):
        captured = {}

        def fake_subprocess_run(command, **_kwargs):
            captured['command'] = command
            return Mock(returncode=0)

        with patch.object(MODULE.subprocess, 'run', side_effect=fake_subprocess_run), \
                patch.dict(MODULE.os.environ, {'RASPI_SERVER_HOST': 'pi5.example'}), \
                patch('builtins.print') as printed:
            self.assertEqual(MODULE.local_approve('run-42'), 0)
        self.assertEqual(captured['command'][0], 'ssh')
        self.assertEqual(captured['command'][1], 'pi5.example')
        remote = captured['command'][2]
        self.assertIn('deploy-status-state.py', remote)
        self.assertIn('approve', remote)
        self.assertIn('--run-id run-42', remote)
        self.assertIn('--client operator-canary-approval', remote)
        printed.assert_called_once_with(json.dumps({'runId': 'run-42', 'approved': True}, ensure_ascii=False))


class Pi5OnlyRemoteRunTest(unittest.TestCase):
    def _args(self, **overrides):
        values = {
            'inventory': 'inventory.yml',
            'limit': 'raspberrypi5',
            'run_id': 'run-1',
            'branch': 'main',
            'sha': 'a' * 40,
            'emergency_override': False,
            'reason': None,
            'skip_canary_hold': False,
            'canary_hold_timeout': 60,
        }
        values.update(overrides)
        return argparse.Namespace(**values)

    def test_empty_targets_with_limit_runs_pi5_only_when_required(self):
        with tempfile.TemporaryDirectory() as temporary:
            run_directory = Path(temporary)
            with patch.object(MODULE, 'RUN_DIRECTORY', run_directory), \
                    patch.object(MODULE, 'inventory_json', return_value={}), \
                    patch.object(MODULE, 'selected_hosts', return_value=['raspberrypi5']), \
                    patch.object(MODULE, 'release_targets', return_value=[]), \
                    patch.object(MODULE, 'pi5_release_required', return_value=True), \
                    patch.object(MODULE, 'ensure_pi5_release') as ensure, \
                    patch.object(MODULE, 'utc_now', return_value='2026-07-12T00:00:00Z'):
                result = MODULE._remote_run(self._args())
            payload = json.loads((run_directory / 'run-1.json').read_text(encoding='utf-8'))
        self.assertEqual(result, 0)
        ensure.assert_called_once()
        self.assertEqual(payload['targets'], [])
        self.assertEqual(payload['state'], 'success')
        self.assertEqual(payload['plan'], {
            'pi5Required': True,
            'targets': [],
            'limit': 'raspberrypi5',
        })

    def test_empty_targets_with_limit_fails_when_pi5_not_required(self):
        with tempfile.TemporaryDirectory() as temporary:
            run_directory = Path(temporary)
            with patch.object(MODULE, 'RUN_DIRECTORY', run_directory), \
                    patch.object(MODULE, 'inventory_json', return_value={}), \
                    patch.object(MODULE, 'selected_hosts', return_value=['raspberrypi5']), \
                    patch.object(MODULE, 'release_targets', return_value=[]), \
                    patch.object(MODULE, 'pi5_release_required', return_value=False), \
                    patch.object(MODULE, 'ensure_pi5_release') as ensure:
                with self.assertRaises(RuntimeError) as raised:
                    MODULE._remote_run(self._args())
            self.assertFalse((run_directory / 'run-1.json').exists())
        self.assertIn('no kiosk or signage targets selected', str(raised.exception))
        ensure.assert_not_called()

    def test_empty_targets_without_limit_fails_closed(self):
        with tempfile.TemporaryDirectory() as temporary:
            run_directory = Path(temporary)
            with patch.object(MODULE, 'RUN_DIRECTORY', run_directory), \
                    patch.object(MODULE, 'inventory_json', return_value={}), \
                    patch.object(MODULE, 'selected_hosts', return_value=None), \
                    patch.object(MODULE, 'release_targets', return_value=[]), \
                    patch.object(MODULE, 'pi5_release_required') as required:
                with self.assertRaises(RuntimeError) as raised:
                    MODULE._remote_run(self._args(limit=''))
            self.assertFalse((run_directory / 'run-1.json').exists())
        self.assertIn('no kiosk or signage targets selected', str(raised.exception))
        required.assert_not_called()


class PrintPlanShadowTest(unittest.TestCase):
    def test_print_plan_fail_open_with_warnings(self):
        args = MODULE.normalize_arguments(MODULE.parser().parse_args([
            'main', 'infrastructure/ansible/inventory.yml', '--print-plan',
        ]))
        with patch.object(MODULE, 'resolve_release_sha', return_value=(None, ['could not resolve SHA for branch main'])), \
                patch.object(MODULE, 'resolve_terminal_targets', return_value=(None, ['ansible-inventory unavailable'])), \
                patch('builtins.print') as printed:
            self.assertEqual(MODULE.local_run(args), 0)
        plan = json.loads(printed.call_args.args[0])
        self.assertEqual(plan['mode'], 'rolling-release')
        self.assertEqual(plan['branch'], 'main')
        self.assertEqual(plan['inventory'], 'infrastructure/ansible/inventory.yml')
        self.assertIsNone(plan['limit'])
        self.assertIsNone(plan['sha'])
        self.assertIsNone(plan['classification'])
        self.assertIsNone(plan['pi5Required'])
        self.assertIsNone(plan['terminalTargets'])
        self.assertIsNone(plan['canaryHold'])
        self.assertIn('could not resolve SHA for branch main', plan['warnings'])
        self.assertIn('ansible-inventory unavailable', plan['warnings'])

    def test_print_plan_includes_resolved_targets_and_classification(self):
        sha = 'a' * 40
        classification = {
            'server': True,
            'kiosk': False,
            'signage': False,
            'migration': False,
            'paths': ['apps/api/src/index.ts'],
        }
        targets = [
            {'host': 'kiosk-canary', 'clientId': 'canary', 'terminalType': 'kiosk'},
            {'host': 'kiosk-b', 'clientId': 'b', 'terminalType': 'kiosk'},
        ]
        args = MODULE.normalize_arguments(MODULE.parser().parse_args([
            'main', 'infrastructure/ansible/inventory.yml', '--print-plan', '--limit', 'clients',
        ]))
        with patch.object(MODULE, 'resolve_release_sha', return_value=(sha, [])), \
                patch.object(MODULE, 'classify_release_impact', return_value=(classification, [])), \
                patch.object(MODULE, 'resolve_terminal_targets', return_value=(targets, [])), \
                patch('builtins.print') as printed:
            self.assertEqual(MODULE.local_run(args), 0)
        plan = json.loads(printed.call_args.args[0])
        self.assertEqual(plan['sha'], sha)
        self.assertEqual(plan['classification'], classification)
        self.assertTrue(plan['pi5Required'])
        self.assertEqual(plan['terminalTargets'], targets)
        self.assertTrue(plan['canaryHold'])
        self.assertEqual(plan['limit'], 'clients')
        self.assertEqual(plan['warnings'], [])


if __name__ == '__main__':
    unittest.main()
