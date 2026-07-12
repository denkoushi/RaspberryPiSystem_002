import json
import subprocess
import tempfile
import time
import unittest
from pathlib import Path

SCRIPT = Path(__file__).parents[1] / 'deploy-status-state.py'


class DeployStatusStateTest(unittest.TestCase):
    def test_run_scoped_merge_failure_and_remove(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'status.json'
            def run(*args):
                subprocess.run(
                    ['python3', str(SCRIPT), '--file', str(path), *args], check=True,
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                )
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
                subprocess.run(
                    ['python3', str(SCRIPT), '--file', str(path), *args], check=True,
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                )

            run('put', '--run-id', 'release-1', '--clients', 'kiosk,signage', '--terminal-type', 'kiosk')
            run('ack', '--run-id', 'release-1', '--client', 'kiosk')
            run('remove-client', '--run-id', 'release-1', '--client', 'kiosk')
            stored = json.loads(path.read_text())
            self.assertEqual(set(stored['kioskByClient']), {'signage'})
            self.assertEqual(stored['kioskByClient']['signage']['runId'], 'release-1')
            self.assertEqual(stored['kioskByClient']['signage']['terminalType'], 'kiosk')
            self.assertNotIn('acknowledgements', stored)

    def test_canary_approval_requires_pending_gate_and_never_uses_generic_ack(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'status.json'

            def run(*args):
                subprocess.run(
                    ['python3', str(SCRIPT), '--file', str(path), *args], check=True,
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                )

            with self.assertRaises(subprocess.CalledProcessError):
                run('approve', '--run-id', 'run-42', '--client', 'operator-canary-approval')
            self.assertFalse(path.exists())

            run(
                'open-canary-hold', '--run-id', 'run-42', '--canary', 'kiosk-canary',
                '--expires-at', str(int(time.time()) + 60),
            )
            # A legacy pre-issued operator acknowledgement is retained as audit
            # data, but it is not the gate the release coordinator consumes.
            legacy = json.loads(path.read_text())
            legacy['acknowledgements'] = {
                'run-42': {'operator-canary-approval': {'acknowledgedAt': 'legacy'}}
            }
            path.write_text(json.dumps(legacy))
            run('approve', '--run-id', 'run-42', '--client', 'operator-canary-approval')
            stored = json.loads(path.read_text())
            self.assertEqual(stored['kioskByClient'], {})
            self.assertEqual(stored['acknowledgements'], legacy['acknowledgements'])
            hold = stored['canaryHolds']['run-42']
            self.assertEqual(hold['state'], 'approved')
            self.assertEqual(hold['approvedBy'], 'operator-canary-approval')
            self.assertIn('approvedAt', hold)

            approved_at = hold['approvedAt']
            run('approve', '--run-id', 'run-42', '--client', 'operator-canary-approval')
            repeated = json.loads(path.read_text())['canaryHolds']['run-42']
            self.assertEqual(repeated['approvedAt'], approved_at)

    def test_expired_canary_hold_rejects_approval_and_expire_is_terminal(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'status.json'

            def run(*args):
                subprocess.run(
                    ['python3', str(SCRIPT), '--file', str(path), *args], check=True,
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                )

            run(
                'open-canary-hold', '--run-id', 'run-42', '--canary', 'kiosk-canary',
                '--expires-at', str(int(time.time()) + 60),
            )
            stored = json.loads(path.read_text())
            stored['canaryHolds']['run-42']['expiresAt'] = 0
            path.write_text(json.dumps(stored))

            with self.assertRaises(subprocess.CalledProcessError):
                run('approve', '--run-id', 'run-42', '--client', 'operator-canary-approval')
            run('expire-canary-hold', '--run-id', 'run-42')
            expired = json.loads(path.read_text())['canaryHolds']['run-42']
            self.assertEqual(expired['state'], 'expired')
            self.assertIn('expiredAt', expired)
            with self.assertRaises(subprocess.CalledProcessError):
                run('approve', '--run-id', 'run-42', '--client', 'operator-canary-approval')


if __name__ == '__main__':
    unittest.main()
