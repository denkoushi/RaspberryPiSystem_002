import json
import subprocess
import tempfile
import time
import unittest
from datetime import datetime
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

    def test_fail_client_keeps_only_the_failed_terminal_in_maintenance(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'status.json'

            def run(*args):
                subprocess.run(
                    ['python3', str(SCRIPT), '--file', str(path), *args], check=True,
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                )

            run('put', '--run-id', 'release-1', '--clients', 'offline,healthy')
            run('put', '--run-id', 'release-2', '--clients', 'other')
            run(
                'fail-client', '--run-id', 'release-1', '--client', 'offline',
                '--reason', 'SSH connection timed out',
            )
            entries = json.loads(path.read_text())['kioskByClient']
            self.assertEqual(entries['offline']['phase'], 'failed')
            self.assertTrue(entries['offline']['maintenance'])
            self.assertEqual(entries['offline']['failure'], 'SSH connection timed out')
            self.assertEqual(entries['healthy']['phase'], 'preparing')
            self.assertEqual(entries['other']['runId'], 'release-2')

    def test_notice_and_maintenance_acknowledgements_are_phase_scoped(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'status.json'

            def run(*args):
                subprocess.run(
                    ['python3', str(SCRIPT), '--file', str(path), *args], check=True,
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                )

            run(
                'put-notice', '--run-id', 'release-1', '--clients', 'kiosk',
                '--terminal-type', 'kiosk', '--duration-seconds', '60',
            )
            announced = json.loads(path.read_text())['kioskByClient']['kiosk']
            self.assertFalse(announced['maintenance'])
            self.assertEqual(announced['phase'], 'notice')
            self.assertEqual(announced['noticeDurationSeconds'], 60)
            self.assertNotIn('scheduledAt', announced)

            run('ack', '--run-id', 'release-1', '--client', 'kiosk', '--phase', 'notice')
            acknowledged = json.loads(path.read_text())
            scheduled_at = acknowledged['kioskByClient']['kiosk']['scheduledAt']
            record = acknowledged['acknowledgements']['release-1']['kiosk']
            self.assertIn('notice', record)
            self.assertNotIn('maintenance', record)
            acknowledged_at = datetime.fromisoformat(record['notice']['acknowledgedAt'].replace('Z', '+00:00'))
            scheduled_datetime = datetime.fromisoformat(scheduled_at.replace('Z', '+00:00'))
            self.assertEqual((scheduled_datetime - acknowledged_at).total_seconds(), 60)

            # Repeated notice ACKs must not extend the promised minute.
            run('ack', '--run-id', 'release-1', '--client', 'kiosk', '--phase', 'notice')
            self.assertEqual(json.loads(path.read_text())['kioskByClient']['kiosk']['scheduledAt'], scheduled_at)

            run('put', '--run-id', 'release-1', '--clients', 'kiosk', '--terminal-type', 'kiosk')
            run('ack', '--run-id', 'release-1', '--client', 'kiosk', '--phase', 'maintenance')
            final_record = json.loads(path.read_text())['acknowledgements']['release-1']['kiosk']
            self.assertIn('notice', final_record)
            self.assertIn('maintenance', final_record)

            # A cancelled notice must remove only its own terminal entry; an
            # overlapping run must remain visible and acknowledged.
            stored = json.loads(path.read_text())
            stored['kioskByClient']['other-kiosk'] = {
                'maintenance': False,
                'runId': 'release-2',
                'phase': 'notice',
                'noticeDurationSeconds': 60,
            }
            stored['acknowledgements']['release-2'] = {
                'other-kiosk': {'notice': {'acknowledgedAt': 'now'}}
            }
            path.write_text(json.dumps(stored))
            run('remove-client', '--run-id', 'release-1', '--client', 'kiosk')
            after_cancel = json.loads(path.read_text())
            self.assertIn('other-kiosk', after_cancel['kioskByClient'])
            self.assertEqual(after_cancel['kioskByClient']['other-kiosk']['runId'], 'release-2')
            self.assertIn('release-2', after_cancel['acknowledgements'])

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
