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

    def test_empty_explicit_selection_never_expands_to_all_terminals(self):
        inventory = {
            'kiosk_canary': {'hosts': ['kiosk-b']},
            '_meta': {'hostvars': {
                'kiosk-a': {'manage_kiosk_browser': True, 'status_agent_client_id': 'a'},
                'kiosk-b': {'manage_kiosk_browser': True, 'status_agent_client_id': 'b'},
                'signage-a': {'manage_signage_lite': True, 'status_agent_client_id': 's'},
            }},
        }
        self.assertEqual(MODULE.release_targets(inventory, []), [])

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

    def marker(self, **overrides):
        candidate = {
            'api': f'registry/api:{self.sha}-0123456789ab',
            'web': f'registry/web:{self.sha}-0123456789ab',
        }
        marker = {'sha': self.sha, 'candidate': candidate}
        marker.update(overrides)
        return marker

    def phase3_status(self, **overrides):
        candidate = self.marker()['candidate']
        status = {
            'runtimeStatus': 'consistent',
            'activeSlot': 'blue',
            'gateway': {'mode': 'application', 'slot': 'blue'},
            'slots': {
                'blue': {'images': candidate},
                'green': {'images': {'api': 'registry/api:previous', 'web': 'registry/web:previous'}},
            },
        }
        status.update(overrides)
        return status

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

    def test_pi5_already_current_requires_exact_marker_candidate_and_live_slot_match(self):
        with patch.object(MODULE, 'read_pi5_release_current', return_value=self.marker()), \
                patch.object(MODULE, 'run', return_value=json.dumps(self.phase3_status())) as command:
            self.assertTrue(MODULE.pi5_already_current(self.sha))
        self.assertEqual(command.call_args.args[0], [str(MODULE.PHASE3), 'status'])

    def test_pi5_already_current_rejects_malformed_marker_without_status_call(self):
        malformed = {'sha': self.sha, 'candidate': {'api': f'registry/api:{self.sha}-0123456789ab'}}
        with patch.object(MODULE, 'read_pi5_release_current', return_value=malformed), \
                patch.object(MODULE, 'run') as command:
            self.assertFalse(MODULE.pi5_already_current(self.sha))
        command.assert_not_called()

    def test_pi5_already_current_rejects_candidate_tag_for_another_sha(self):
        candidate = self.marker()['candidate'].copy()
        candidate['web'] = f"registry/web:{'b' * 40}-0123456789ab"
        with patch.object(MODULE, 'read_pi5_release_current', return_value=self.marker(candidate=candidate)), \
                patch.object(MODULE, 'run') as command:
            self.assertFalse(MODULE.pi5_already_current(self.sha))
        command.assert_not_called()

    def test_pi5_already_current_rejects_active_slot_image_mismatch(self):
        status = self.phase3_status()
        status['slots']['blue']['images']['web'] = 'registry/web:other'
        with patch.object(MODULE, 'read_pi5_release_current', return_value=self.marker()), \
                patch.object(MODULE, 'run', return_value=json.dumps(status)):
            self.assertFalse(MODULE.pi5_already_current(self.sha))

    def test_pi5_already_current_rejects_gateway_slot_mismatch(self):
        status = self.phase3_status()
        status['gateway']['slot'] = 'green'
        with patch.object(MODULE, 'read_pi5_release_current', return_value=self.marker()), \
                patch.object(MODULE, 'run', return_value=json.dumps(status)):
            self.assertFalse(MODULE.pi5_already_current(self.sha))

    def test_pi5_already_current_fail_closed_on_status_error(self):
        with patch.object(MODULE, 'read_pi5_release_current', return_value={'sha': self.sha}), \
                patch.object(MODULE, 'run', side_effect=RuntimeError('status unavailable')):
            self.assertFalse(MODULE.pi5_already_current(self.sha))


class DeployClassificationBaselineTest(unittest.TestCase):
    BASE = 'b' * 40
    TARGET = 'a' * 40

    def test_post_merge_target_uses_persisted_pi5_marker_as_diff_base(self):
        classification = {
            'server': True, 'kiosk': False, 'signage': False, 'migration': False,
            'components': ['server-app'],
        }
        with patch.object(MODULE, 'run', side_effect=['', json.dumps(classification)]) as command:
            result, warnings = MODULE.classify_release_impact(self.TARGET, {'sha': self.BASE})
        self.assertEqual(result, classification)
        self.assertEqual(warnings, [])
        self.assertEqual(
            command.call_args_list[0].args[0],
            ['git', '-C', str(MODULE.PROJECT), 'merge-base', '--is-ancestor', self.BASE, self.TARGET],
        )
        self.assertEqual(command.call_args_list[1].args[0][-4:], ['--base', self.BASE, '--head', self.TARGET])

    def test_missing_or_invalid_marker_fails_closed_before_running_classifier(self):
        for marker in (None, {}, {'sha': 'not-a-sha'}):
            with self.subTest(marker=marker), patch.object(MODULE, 'run') as command:
                classification, warnings = MODULE.classify_release_impact(self.TARGET, marker)
            self.assertIsNone(classification)
            self.assertIn('classification unavailable', warnings[0])
            command.assert_not_called()

    def test_marker_matching_target_fails_closed_for_terminal_retry(self):
        with patch.object(MODULE, 'run') as command:
            classification, warnings = MODULE.classify_release_impact(self.TARGET, {'sha': self.TARGET})
        self.assertIsNone(classification)
        self.assertIn('terminal state is not a safe baseline', warnings[0])
        command.assert_not_called()

    def test_non_ancestor_marker_fails_closed(self):
        with patch.object(MODULE, 'run', side_effect=RuntimeError('not an ancestor')) as command:
            classification, warnings = MODULE.classify_release_impact(self.TARGET, {'sha': self.BASE})
        self.assertIsNone(classification)
        self.assertIn('not an ancestor of target', warnings[0])
        command.assert_called_once_with(
            ['git', '-C', str(MODULE.PROJECT), 'merge-base', '--is-ancestor', self.BASE, self.TARGET],
            capture=True,
        )

    def test_pi5_requirement_is_true_when_marker_is_missing(self):
        with patch.object(MODULE, 'read_pi5_release_current', return_value=None):
            self.assertTrue(MODULE.pi5_release_required(self.TARGET))


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
            'auto_minimize': False,
        }
        values.update(overrides)
        return argparse.Namespace(**values)

    def _run_remote(self, targets, *, wait_for_canary_approval, args=None, played=None):
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
                    patch.object(MODULE, 'wait_for_ack', return_value=True), \
                    patch.object(MODULE, 'wait_for_canary_approval', side_effect=wait_for_canary_approval), \
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

        def wait_for_canary_approval(run_id, timeout):
            hold_calls.append((run_id, timeout))
            return {
                'state': 'approved', 'canary': 'kiosk-canary',
                'approvedAt': '2026-07-12T00:01:00Z',
                'approvedBy': MODULE.OPERATOR_CANARY_APPROVAL_CLIENT,
            }

        result, played, payload = self._run_remote(targets, wait_for_canary_approval=wait_for_canary_approval)
        self.assertEqual(result, 0)
        self.assertEqual(played, ['kiosk-canary', 'kiosk-b'])
        self.assertIn(('run-1', 60), hold_calls)
        self.assertEqual(payload['canaryHold']['state'], 'approved')
        self.assertEqual(payload['canaryHold']['canary'], 'kiosk-canary')
        self.assertEqual(payload['canaryHold']['approvedBy'], MODULE.OPERATOR_CANARY_APPROVAL_CLIENT)
        self.assertEqual(payload['state'], 'success')

    def test_canary_hold_timeout_fails_closed_without_remaining_targets(self):
        targets = [
            {'host': 'kiosk-canary', 'clientId': 'canary', 'terminalType': 'kiosk'},
            {'host': 'kiosk-b', 'clientId': 'b', 'terminalType': 'kiosk'},
        ]

        def wait_for_canary_approval(_run_id, timeout):
            raise RuntimeError(
                f'canary hold timed out after {timeout}s waiting for operator approval '
                f'(client={MODULE.OPERATOR_CANARY_APPROVAL_CLIENT})'
            )

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
                    patch.object(MODULE, 'wait_for_ack', return_value=True), \
                    patch.object(MODULE, 'wait_for_canary_approval', side_effect=wait_for_canary_approval), \
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
        hold_calls = []

        def wait_for_canary_approval(run_id, timeout):
            hold_calls.append((run_id, timeout))
            return {'state': 'approved'}

        result, played, payload = self._run_remote(
            targets,
            wait_for_canary_approval=wait_for_canary_approval,
            args=self._args(skip_canary_hold=True),
        )
        self.assertEqual(result, 0)
        self.assertEqual(played, ['kiosk-canary', 'kiosk-b'])
        self.assertEqual(hold_calls, [])
        self.assertNotIn('canaryHold', payload)

    def test_single_canary_target_skips_hold(self):
        targets = [{'host': 'kiosk-canary', 'clientId': 'canary', 'terminalType': 'kiosk'}]
        hold_calls = []

        def wait_for_canary_approval(run_id, timeout):
            hold_calls.append((run_id, timeout))
            return {'state': 'approved'}

        result, played, payload = self._run_remote(targets, wait_for_canary_approval=wait_for_canary_approval)
        self.assertEqual(result, 0)
        self.assertEqual(played, ['kiosk-canary'])
        self.assertEqual(hold_calls, [])
        self.assertNotIn('canaryHold', payload)

    def test_signage_only_skips_hold(self):
        targets = [
            {'host': 'signage-a', 'clientId': 's1', 'terminalType': 'signage'},
            {'host': 'signage-b', 'clientId': 's2', 'terminalType': 'signage'},
        ]
        hold_calls = []

        def wait_for_canary_approval(run_id, timeout):
            hold_calls.append((run_id, timeout))
            return {'state': 'approved'}

        result, played, payload = self._run_remote(targets, wait_for_canary_approval=wait_for_canary_approval)
        self.assertEqual(result, 0)
        self.assertEqual(played, ['signage-a', 'signage-b'])
        self.assertEqual(hold_calls, [])
        self.assertNotIn('canaryHold', payload)

    def test_expiry_transition_stops_when_expire_wins(self):
        waiting = {'state': 'waiting-verification'}
        expired = {'state': 'expired'}
        with patch.object(MODULE, 'canary_hold_record', side_effect=[waiting, expired]), \
                patch.object(MODULE, 'state_command') as state_command, \
                patch.object(MODULE.time, 'monotonic', side_effect=[0, 60]):
            with self.assertRaisesRegex(RuntimeError, 'canary hold timed out'):
                MODULE.wait_for_canary_approval('run-1', 60)
        state_command.assert_called_once_with('expire-canary-hold', '--run-id', 'run-1')

    def test_expiry_transition_continues_only_when_approval_wins(self):
        waiting = {'state': 'waiting-verification'}
        approved = {'state': 'approved', 'approvedBy': MODULE.OPERATOR_CANARY_APPROVAL_CLIENT}
        with patch.object(MODULE, 'canary_hold_record', side_effect=[waiting, approved]), \
                patch.object(MODULE, 'state_command') as state_command, \
                patch.object(MODULE.time, 'monotonic', side_effect=[0, 60]):
            result = MODULE.wait_for_canary_approval('run-1', 60)
        self.assertEqual(result, approved)
        state_command.assert_called_once_with('expire-canary-hold', '--run-id', 'run-1')

    def test_hold_state_is_saved_before_the_pending_gate_is_opened(self):
        state = MODULE.ReleaseState(Path('/tmp/unused-release-state.json'), {})
        events = []
        state.save = Mock(side_effect=lambda: events.append('release-state-save'))

        def state_command(*arguments):
            events.append(('status-command', arguments))

        with patch.object(MODULE, 'state_command', side_effect=state_command), \
                patch.object(MODULE, 'wait_for_canary_approval', return_value={'state': 'approved'}), \
                patch.object(MODULE.time, 'time', return_value=1_800_000_000):
            MODULE.wait_for_canary_hold(state, 'run-1', 'kiosk-canary', 60)

        self.assertEqual(events[0], 'release-state-save')
        self.assertEqual(
            events[1],
            ('status-command', ('open-canary-hold', '--run-id', 'run-1', '--canary', 'kiosk-canary', '--expires-at', '1800000060')),
        )

    def test_canary_wait_does_not_consume_legacy_generic_acknowledgements(self):
        approved = {'state': 'approved', 'approvedBy': MODULE.OPERATOR_CANARY_APPROVAL_CLIENT}
        with patch.object(MODULE, 'acknowledgement_received', side_effect=AssertionError('legacy ACK must not be read')), \
                patch.object(MODULE, 'canary_hold_record', return_value=approved):
            self.assertEqual(MODULE.wait_for_canary_approval('run-1', 60), approved)

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
            'auto_minimize': False,
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
            'autoMinimize': False,
            'minimized': False,
            'excludedHosts': [],
            'classificationComponents': None,
        })

    def test_zero_match_limit_fails_instead_of_becoming_a_pi5_only_run(self):
        with tempfile.TemporaryDirectory() as temporary:
            run_directory = Path(temporary)
            with patch.object(MODULE, 'RUN_DIRECTORY', run_directory), \
                    patch.object(MODULE, 'inventory_json', return_value={}), \
                    patch.object(MODULE, 'selected_hosts', return_value=[]), \
                    patch.object(MODULE, 'pi5_release_required', return_value=True), \
                    patch.object(MODULE, 'ensure_pi5_release') as ensure:
                with self.assertRaises(RuntimeError) as raised:
                    MODULE._remote_run(self._args(limit='typo-host'))
        self.assertIn('--limit selected no hosts', str(raised.exception))
        ensure.assert_not_called()

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
        self.assertFalse(plan['autoMinimize'])
        self.assertFalse(plan['minimized'])
        self.assertEqual(plan['excludedHosts'], [])
        self.assertIsNone(plan['classificationComponents'])
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
            'components': ['server-app'],
        }
        targets = [
            {'host': 'kiosk-canary', 'clientId': 'canary', 'terminalType': 'kiosk'},
            {'host': 'kiosk-b', 'clientId': 'b', 'terminalType': 'kiosk'},
        ]
        args = MODULE.normalize_arguments(MODULE.parser().parse_args([
            'main', 'infrastructure/ansible/inventory.yml', '--print-plan', '--limit', 'clients',
        ]))
        with patch.object(MODULE, 'resolve_release_sha', return_value=(sha, [])), \
                patch.object(MODULE, 'read_plan_pi5_release_current', return_value=({'sha': 'b' * 40}, [])), \
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
        self.assertFalse(plan['autoMinimize'])
        self.assertFalse(plan['minimized'])
        self.assertEqual(plan['excludedHosts'], [])
        self.assertEqual(plan['classificationComponents'], ['server-app'])
        self.assertEqual(plan['warnings'], [])


class AutoMinimizeTest(unittest.TestCase):
    INVENTORY = {
        'kiosk_canary': {'hosts': ['kiosk-b']},
        '_meta': {'hostvars': {
            'kiosk-a': {'manage_kiosk_browser': True, 'status_agent_client_id': 'a'},
            'kiosk-b': {
                'manage_kiosk_browser': True,
                'status_agent_client_id': 'b',
                'barcode_agent_enabled': True,
            },
            'raspberrypi3': {'manage_signage_lite': True, 'status_agent_client_id': 's'},
        }},
    }

    ALL_TARGETS = [
        {'host': 'kiosk-b', 'clientId': 'b', 'terminalType': 'kiosk'},
        {'host': 'kiosk-a', 'clientId': 'a', 'terminalType': 'kiosk'},
        {'host': 'raspberrypi3', 'clientId': 's', 'terminalType': 'signage'},
    ]

    def _args(self, **overrides):
        values = {
            'inventory': 'inventory.yml',
            'limit': '',
            'run_id': 'run-1',
            'branch': 'main',
            'sha': 'a' * 40,
            'emergency_override': False,
            'reason': None,
            'skip_canary_hold': True,
            'canary_hold_timeout': 60,
            'auto_minimize': True,
        }
        values.update(overrides)
        return argparse.Namespace(**values)

    def _run_remote(self, *, classification, targets=None, inventory=None, args=None):
        targets = targets if targets is not None else list(self.ALL_TARGETS)
        inventory = inventory if inventory is not None else self.INVENTORY
        played = []

        def playbook(_inventory, host, _sha, _run_id, rollback=False):
            played.append(host)

        with tempfile.TemporaryDirectory() as temporary:
            run_directory = Path(temporary)
            with patch.object(MODULE, 'RUN_DIRECTORY', run_directory), \
                    patch.object(MODULE, 'inventory_json', return_value=inventory), \
                    patch.object(MODULE, 'selected_hosts', return_value=None), \
                    patch.object(MODULE, 'release_targets', return_value=targets), \
                    patch.object(MODULE, 'classify_release_impact', return_value=(classification, [])), \
                    patch.object(MODULE, 'pi5_release_required', return_value=False), \
                    patch.object(MODULE, 'ensure_pi5_release') as ensure, \
                    patch.object(MODULE, 'remote_previous_sha', return_value='old-sha'), \
                    patch.object(MODULE, 'wait_for_ack', return_value=True), \
                    patch.object(MODULE, 'state_command'), \
                    patch.object(MODULE, 'prestage_signage_maintenance'), \
                    patch.object(MODULE, 'playbook', side_effect=playbook), \
                    patch.object(MODULE, 'utc_now', return_value='2026-07-12T00:00:00Z'):
                result = MODULE._remote_run(args or self._args())
            payload = json.loads((run_directory / 'run-1.json').read_text(encoding='utf-8'))
        return result, played, payload, ensure

    def test_nfc_agent_excludes_signage_keeps_all_kiosks(self):
        classification = {
            'server': False, 'kiosk': True, 'signage': False, 'migration': False,
            'components': ['nfc-agent'],
        }
        result, played, payload, ensure = self._run_remote(classification=classification)
        self.assertEqual(result, 0)
        ensure.assert_not_called()
        self.assertEqual(played, ['kiosk-b', 'kiosk-a'])
        self.assertEqual(payload['plan']['excludedHosts'], ['raspberrypi3'])
        self.assertTrue(payload['plan']['minimized'])
        self.assertEqual(payload['plan']['classificationComponents'], ['nfc-agent'])
        self.assertTrue(payload['plan']['autoMinimize'])

    def test_barcode_agent_only_keeps_barcode_enabled_hosts(self):
        classification = {
            'server': False, 'kiosk': True, 'signage': False, 'migration': False,
            'components': ['barcode-agent'],
        }
        result, played, payload, _ensure = self._run_remote(classification=classification)
        self.assertEqual(result, 0)
        self.assertEqual(played, ['kiosk-b'])
        self.assertEqual(sorted(payload['plan']['excludedHosts']), ['kiosk-a', 'raspberrypi3'])
        self.assertTrue(payload['plan']['minimized'])

    def test_signage_role_only_excludes_all_kiosks(self):
        classification = {
            'server': False, 'kiosk': False, 'signage': True, 'migration': False,
            'components': ['signage-role'],
        }
        result, played, payload, _ensure = self._run_remote(classification=classification)
        self.assertEqual(result, 0)
        self.assertEqual(played, ['raspberrypi3'])
        self.assertEqual(sorted(payload['plan']['excludedHosts']), ['kiosk-a', 'kiosk-b'])
        self.assertTrue(payload['plan']['minimized'])

    def test_unknown_component_fail_closed_keeps_all_terminals(self):
        classification = {
            'server': True, 'kiosk': True, 'signage': True, 'migration': False,
            'components': ['unknown'],
        }
        result, played, payload, ensure = self._run_remote(classification=classification)
        self.assertEqual(result, 0)
        ensure.assert_called_once()
        self.assertEqual(played, ['kiosk-b', 'kiosk-a', 'raspberrypi3'])
        self.assertEqual(payload['plan']['excludedHosts'], [])
        self.assertFalse(payload['plan']['minimized'])
        self.assertEqual(payload['plan'].get('reason'), 'unknown or global component')

    def test_classification_unavailable_fail_closed_keeps_all_terminals(self):
        result, played, payload, _ensure = self._run_remote(classification=None)
        self.assertEqual(result, 0)
        self.assertEqual(played, ['kiosk-b', 'kiosk-a', 'raspberrypi3'])
        self.assertEqual(payload['plan']['excludedHosts'], [])
        self.assertFalse(payload['plan']['minimized'])
        self.assertEqual(payload['plan'].get('reason'), 'classification unavailable')
        self.assertIsNone(payload['plan']['classificationComponents'])

    def test_server_app_only_runs_pi5_with_zero_terminals(self):
        classification = {
            'server': True, 'kiosk': False, 'signage': False, 'migration': False,
            'components': ['server-app'],
        }
        result, played, payload, ensure = self._run_remote(classification=classification)
        self.assertEqual(result, 0)
        ensure.assert_called_once()
        self.assertEqual(played, [])
        self.assertEqual(payload['targets'], [])
        self.assertEqual(payload['state'], 'success')
        self.assertTrue(payload['plan']['pi5Required'])
        self.assertTrue(payload['plan']['minimized'])
        self.assertEqual(sorted(payload['plan']['excludedHosts']), ['kiosk-a', 'kiosk-b', 'raspberrypi3'])

    def test_without_auto_minimize_keeps_all_terminals(self):
        classification = {
            'server': False, 'kiosk': True, 'signage': False, 'migration': False,
            'components': ['nfc-agent'],
        }
        result, played, payload, ensure = self._run_remote(
            classification=classification,
            args=self._args(auto_minimize=False),
        )
        self.assertEqual(result, 0)
        ensure.assert_not_called()
        self.assertEqual(played, ['kiosk-b', 'kiosk-a', 'raspberrypi3'])
        self.assertFalse(payload['plan']['autoMinimize'])
        self.assertFalse(payload['plan']['minimized'])
        self.assertEqual(payload['plan']['excludedHosts'], [])
        self.assertIsNone(payload['plan']['classificationComponents'])

    def test_auto_minimize_noop_when_no_pi5_and_no_terminals(self):
        classification = {
            'server': False, 'kiosk': False, 'signage': False, 'migration': False,
            'components': ['neutral'],
        }
        with tempfile.TemporaryDirectory() as temporary:
            run_directory = Path(temporary)
            with patch.object(MODULE, 'RUN_DIRECTORY', run_directory), \
                    patch.object(MODULE, 'inventory_json', return_value=self.INVENTORY), \
                    patch.object(MODULE, 'selected_hosts', return_value=None), \
                    patch.object(MODULE, 'release_targets', return_value=list(self.ALL_TARGETS)), \
                    patch.object(MODULE, 'classify_release_impact', return_value=(classification, [])), \
                    patch.object(MODULE, 'ensure_pi5_release') as ensure, \
                    patch.object(MODULE, 'utc_now', return_value='2026-07-12T00:00:00Z'):
                result = MODULE._remote_run(self._args())
            payload = json.loads((run_directory / 'run-1.json').read_text(encoding='utf-8'))
        self.assertEqual(result, 0)
        ensure.assert_not_called()
        self.assertEqual(payload['state'], 'success')
        self.assertEqual(payload['pi5'], {'state': 'not-required'})
        self.assertEqual(payload['targets'], [])
        self.assertFalse(payload['plan']['pi5Required'])

    def test_local_forwards_auto_minimize(self):
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
            'main', 'infrastructure/ansible/inventory.yml', '--auto-minimize',
        ]))
        with patch.object(MODULE, 'run', side_effect=fake_run), \
                patch.object(MODULE.subprocess, 'run', side_effect=fake_subprocess_run), \
                patch.dict(MODULE.os.environ, {'RASPI_SERVER_HOST': 'pi5.example'}):
            MODULE.local_run(args)
        self.assertIn('--auto-minimize', captured['remote'])

    def test_print_plan_auto_minimize_reports_excluded_hosts(self):
        sha = 'a' * 40
        classification = {
            'server': False, 'kiosk': True, 'signage': False, 'migration': False,
            'components': ['nfc-agent'],
        }
        targets = list(self.ALL_TARGETS)
        args = MODULE.normalize_arguments(MODULE.parser().parse_args([
            'main', 'infrastructure/ansible/inventory.yml', '--print-plan', '--auto-minimize',
        ]))
        with patch.object(MODULE, 'resolve_release_sha', return_value=(sha, [])), \
                patch.object(MODULE, 'read_plan_pi5_release_current', return_value=({'sha': 'b' * 40}, [])), \
                patch.object(MODULE, 'classify_release_impact', return_value=(classification, [])), \
                patch.object(MODULE, 'resolve_terminal_targets', return_value=(targets, [])), \
                patch.object(MODULE, 'inventory_json', return_value=self.INVENTORY), \
                patch('builtins.print') as printed:
            self.assertEqual(MODULE.local_run(args), 0)
        plan = json.loads(printed.call_args.args[0])
        self.assertTrue(plan['autoMinimize'])
        self.assertTrue(plan['minimized'])
        self.assertEqual([t['host'] for t in plan['terminalTargets']], ['kiosk-b', 'kiosk-a'])
        self.assertEqual(plan['excludedHosts'], ['raspberrypi3'])
        self.assertEqual(plan['classificationComponents'], ['nfc-agent'])
        self.assertTrue(plan['canaryHold'])


if __name__ == '__main__':
    unittest.main()
