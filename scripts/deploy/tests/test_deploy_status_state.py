import json
import subprocess
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).parents[1] / 'deploy-status-state.py'


class DeployStatusStateTest(unittest.TestCase):
    def test_run_scoped_merge_failure_and_remove(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'status.json'
            def run(*args):
                subprocess.run(['python3', str(SCRIPT), '--file', str(path), *args], check=True)
            run('put', '--run-id', 'a', '--clients', 'one,two')
            run('put', '--run-id', 'b', '--clients', 'three')
            stored = json.loads(path.read_text())
            stored['acknowledgements'] = {'a': {'one': {'acknowledgedAt': 'now'}}, 'b': {'three': {'acknowledgedAt': 'now'}}}
            path.write_text(json.dumps(stored))
            run('set-phase', '--run-id', 'a', '--phase', 'failed')
            data = json.loads(path.read_text())['kioskByClient']
            self.assertEqual(data['one']['phase'], 'failed')
            self.assertEqual(data['three']['phase'], 'preparing')
            run('remove-run', '--run-id', 'a')
            data = json.loads(path.read_text())['kioskByClient']
            self.assertEqual(set(data), {'three'})
            stored = json.loads(path.read_text())
            self.assertNotIn('a', stored['acknowledgements'])
            self.assertIn('b', stored['acknowledgements'])

    def test_remove_client_keeps_other_targets_in_the_same_run(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'status.json'

            def run(*args):
                subprocess.run(['python3', str(SCRIPT), '--file', str(path), *args], check=True)

            run('put', '--run-id', 'release-1', '--clients', 'kiosk,signage', '--terminal-type', 'kiosk')
            run('ack', '--run-id', 'release-1', '--client', 'kiosk')
            run('remove-client', '--run-id', 'release-1', '--client', 'kiosk')
            stored = json.loads(path.read_text())
            self.assertEqual(set(stored['kioskByClient']), {'signage'})
            self.assertEqual(stored['kioskByClient']['signage']['runId'], 'release-1')
            self.assertEqual(stored['kioskByClient']['signage']['terminalType'], 'kiosk')
            self.assertNotIn('acknowledgements', stored)

    def test_approve_records_operator_ack_without_maintenance_entry(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'status.json'

            def run(*args):
                subprocess.run(['python3', str(SCRIPT), '--file', str(path), *args], check=True)

            run('approve', '--run-id', 'run-42', '--client', 'operator-canary-approval')
            stored = json.loads(path.read_text())
            self.assertEqual(stored['kioskByClient'], {})
            ack = stored['acknowledgements']['run-42']['operator-canary-approval']
            self.assertEqual(ack['source'], 'operator')
            self.assertIn('acknowledgedAt', ack)


if __name__ == '__main__':
    unittest.main()
