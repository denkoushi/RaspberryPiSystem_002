import importlib.util
import json
import sys
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


if __name__ == '__main__':
    unittest.main()
