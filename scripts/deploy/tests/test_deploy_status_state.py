import importlib.util
import json
import os
import stat
import subprocess
import sys
import tempfile
import time
import unittest
from datetime import datetime
from pathlib import Path
from unittest import mock

SCRIPT = Path(__file__).parents[1] / 'deploy-status-state.py'
SPEC = importlib.util.spec_from_file_location('deploy_status_state', SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)

DESIRED_RELEASE_SHA = 'a' * 40
OTHER_RELEASE_SHA = 'b' * 40


class DeployStatusStateTest(unittest.TestCase):
    def test_kernel_lock_serializes_contenders_and_persists_safe_mode(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'status.json'
            inherited_umask = os.umask(0o077)
            try:
                with MODULE.StatusLock(path):
                    with self.assertRaises(TimeoutError):
                        with MODULE.StatusLock(path, timeout_seconds=0.05):
                            pass
            finally:
                os.umask(inherited_umask)
            with MODULE.StatusLock(path, timeout_seconds=0.05):
                pass
            lock = Path(f'{path}.lock')
            self.assertTrue(lock.is_file())
            self.assertEqual(lock.stat().st_mode & 0o777, 0o644)

    def test_sigkill_releases_kernel_lock_without_cleanup_or_stale_reclaim(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'status.json'
            child = subprocess.Popen(
                [
                    sys.executable,
                    '-c',
                    (
                        'import runpy,time; '
                        f'm=runpy.run_path({str(SCRIPT)!r}); '
                        f'l=m["StatusLock"]({str(path)!r}); '
                        'l.__enter__(); print("locked", flush=True); time.sleep(60)'
                    ),
                ],
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
            self.addCleanup(lambda: child.poll() is None and child.kill())
            self.assertEqual(child.stdout.readline().strip(), 'locked')
            child.kill()
            child.wait(timeout=5)
            child.stdout.close()
            child.stderr.close()

            with MODULE.StatusLock(path, timeout_seconds=0.2):
                pass

    def test_save_fsyncs_file_replace_and_parent_directory_in_order(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'status.json'
            events = []
            real_fsync = MODULE.os.fsync
            real_replace = MODULE.os.replace

            def tracked_fsync(descriptor):
                events.append(
                    'dir-fsync'
                    if stat.S_ISDIR(os.fstat(descriptor).st_mode)
                    else 'file-fsync'
                )
                return real_fsync(descriptor)

            def tracked_replace(source, destination):
                events.append('replace')
                return real_replace(source, destination)

            with mock.patch.object(MODULE.os, 'fsync', side_effect=tracked_fsync), \
                    mock.patch.object(MODULE.os, 'replace', side_effect=tracked_replace):
                MODULE.save(path, {'version': 2, 'kioskByClient': {}})

        self.assertEqual(events, ['file-fsync', 'replace', 'dir-fsync'])

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
            stored['canaryHolds'] = {
                'a': {'state': 'waiting-verification'},
                'b': {'state': 'approved'},
            }
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
            self.assertNotIn('a', stored['canaryHolds'])
            self.assertIn('b', stored['canaryHolds'])

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

    def test_notice_ack_rejects_malformed_duration_without_changing_state(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'status.json'
            cases = [
                ('missing', None, False),
                ('null', None, True),
                ('zero', 0, True),
                ('negative', -1, True),
                ('fractional', 1.5, True),
                ('string', '60', True),
                ('boolean', True, True),
            ]
            for name, duration, include_duration in cases:
                with self.subTest(name=name):
                    entry = {
                        'maintenance': False,
                        'runId': 'release-invalid',
                        'phase': 'notice',
                    }
                    if include_duration:
                        entry['noticeDurationSeconds'] = duration
                    original = {'version': 2, 'kioskByClient': {'kiosk': entry}}
                    path.write_text(json.dumps(original), encoding='utf-8')

                    completed = subprocess.run(
                        [
                            'python3', str(SCRIPT), '--file', str(path), 'ack',
                            '--run-id', 'release-invalid', '--client', 'kiosk',
                            '--phase', 'notice',
                        ],
                        text=True,
                        capture_output=True,
                    )

                    self.assertNotEqual(completed.returncode, 0)
                    self.assertEqual(json.loads(path.read_text(encoding='utf-8')), original)

    def test_ready_ack_requires_matching_immutable_release_without_changing_invalid_state(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'status.json'

            def run(*args, check=True):
                return subprocess.run(
                    ['python3', str(SCRIPT), '--file', str(path), *args],
                    check=check,
                    text=True,
                    capture_output=True,
                )

            run('put', '--run-id', 'release-1', '--clients', 'kiosk,other', '--terminal-type', 'kiosk')

            for name, arguments in (
                (
                    'missing exact client',
                    (
                        'set-phase', '--run-id', 'release-1', '--phase', 'verifying',
                        '--desired-release-sha', DESIRED_RELEASE_SHA,
                    ),
                ),
                ('missing desired SHA', ('set-phase', '--run-id', 'release-1', '--client', 'kiosk', '--phase', 'verifying')),
                (
                    'uppercase desired SHA',
                    (
                        'set-phase', '--run-id', 'release-1', '--client', 'kiosk', '--phase', 'verifying',
                        '--desired-release-sha', DESIRED_RELEASE_SHA.upper(),
                    ),
                ),
            ):
                with self.subTest(name=name):
                    before = path.read_bytes()
                    completed = run(*arguments, check=False)
                    self.assertNotEqual(completed.returncode, 0)
                    self.assertEqual(path.read_bytes(), before)

            run(
                'set-phase', '--run-id', 'release-1', '--client', 'kiosk', '--phase', 'verifying',
                '--desired-release-sha', DESIRED_RELEASE_SHA,
            )
            verifying = json.loads(path.read_text(encoding='utf-8'))
            entry = verifying['kioskByClient']['kiosk']
            self.assertTrue(entry['maintenance'])
            self.assertEqual(entry['phase'], 'verifying')
            self.assertEqual(entry['desiredReleaseSha'], DESIRED_RELEASE_SHA)
            other = verifying['kioskByClient']['other']
            self.assertEqual(other['phase'], 'preparing')
            self.assertNotIn('desiredReleaseSha', other)

            # The desired SHA is immutable once the run enters verification.
            # Re-entering with the same SHA is idempotent; changing it is a
            # byte-preserving failure before any acknowledgement exists.
            before = path.read_bytes()
            run(
                'set-phase', '--run-id', 'release-1', '--client', 'kiosk', '--phase', 'verifying',
                '--desired-release-sha', DESIRED_RELEASE_SHA,
            )
            self.assertEqual(path.read_bytes(), before)
            completed = run(
                'set-phase', '--run-id', 'release-1', '--client', 'kiosk', '--phase', 'verifying',
                '--desired-release-sha', OTHER_RELEASE_SHA,
                check=False,
            )
            self.assertNotEqual(completed.returncode, 0)
            self.assertEqual(path.read_bytes(), before)

            # Retrying the pre-verification put for the same run/client must
            # preserve the immutable binding rather than permit SHA rebinding.
            run('put', '--run-id', 'release-1', '--clients', 'kiosk', '--terminal-type', 'kiosk')
            rebound = json.loads(path.read_text(encoding='utf-8'))['kioskByClient']['kiosk']
            self.assertEqual(rebound['desiredReleaseSha'], DESIRED_RELEASE_SHA)
            before = path.read_bytes()
            completed = run(
                'set-phase', '--run-id', 'release-1', '--client', 'kiosk', '--phase', 'verifying',
                '--desired-release-sha', OTHER_RELEASE_SHA,
                check=False,
            )
            self.assertNotEqual(completed.returncode, 0)
            self.assertEqual(path.read_bytes(), before)
            run(
                'set-phase', '--run-id', 'release-1', '--client', 'kiosk', '--phase', 'verifying',
                '--desired-release-sha', DESIRED_RELEASE_SHA,
            )
            verification_id = json.loads(
                path.read_text(encoding='utf-8')
            )['kioskByClient']['kiosk']['verificationId']

            invalid_ready_cases = (
                ('missing SHA', ('ack', '--run-id', 'release-1', '--client', 'kiosk', '--phase', 'ready')),
                (
                    'short SHA',
                    (
                        'ack', '--run-id', 'release-1', '--client', 'kiosk', '--phase', 'ready',
                        '--release-sha', 'abc123',
                        '--verification-id', verification_id,
                    ),
                ),
                (
                    'uppercase SHA',
                    (
                        'ack', '--run-id', 'release-1', '--client', 'kiosk', '--phase', 'ready',
                        '--release-sha', DESIRED_RELEASE_SHA.upper(),
                        '--verification-id', verification_id,
                    ),
                ),
                (
                    'mismatched SHA',
                    (
                        'ack', '--run-id', 'release-1', '--client', 'kiosk', '--phase', 'ready',
                        '--release-sha', OTHER_RELEASE_SHA,
                        '--verification-id', verification_id,
                    ),
                ),
                (
                    'missing verification ID',
                    (
                        'ack', '--run-id', 'release-1', '--client', 'kiosk', '--phase', 'ready',
                        '--release-sha', DESIRED_RELEASE_SHA,
                    ),
                ),
                (
                    'mismatched verification ID',
                    (
                        'ack', '--run-id', 'release-1', '--client', 'kiosk', '--phase', 'ready',
                        '--release-sha', DESIRED_RELEASE_SHA,
                        '--verification-id', 'f' * 32,
                    ),
                ),
            )
            for name, arguments in invalid_ready_cases:
                with self.subTest(name=name):
                    before = path.read_bytes()
                    completed = run(*arguments, check=False)
                    self.assertNotEqual(completed.returncode, 0)
                    self.assertEqual(path.read_bytes(), before)

            acknowledged = run(
                'ack', '--run-id', 'release-1', '--client', 'kiosk', '--phase', 'ready',
                '--release-sha', DESIRED_RELEASE_SHA,
                '--verification-id', verification_id,
            )
            self.assertEqual(
                json.loads(acknowledged.stdout),
                {
                    'acknowledged': True,
                    'runId': 'release-1',
                    'phase': 'ready',
                    'releaseSha': DESIRED_RELEASE_SHA,
                    'verificationId': verification_id,
                },
            )
            ready = json.loads(path.read_text(encoding='utf-8'))['acknowledgements']['release-1']['kiosk']['ready']
            self.assertEqual(ready['releaseSha'], DESIRED_RELEASE_SHA)
            self.assertEqual(ready['verificationId'], verification_id)
            self.assertEqual(ready['source'], 'controller')
            self.assertIsInstance(ready['acknowledgedAt'], str)

            # An accepted ready ACK cannot be rebound to a different release.
            before = path.read_bytes()
            completed = run(
                'set-phase', '--run-id', 'release-1', '--client', 'kiosk', '--phase', 'verifying',
                '--desired-release-sha', OTHER_RELEASE_SHA,
                check=False,
            )
            self.assertNotEqual(completed.returncode, 0)
            self.assertEqual(path.read_bytes(), before)

            repeated = run(
                'ack', '--run-id', 'release-1', '--client', 'kiosk', '--phase', 'ready',
                '--release-sha', DESIRED_RELEASE_SHA,
                '--verification-id', verification_id,
            )
            self.assertEqual(json.loads(repeated.stdout), json.loads(acknowledged.stdout))
            repeated_ready = json.loads(
                path.read_text(encoding='utf-8')
            )['acknowledgements']['release-1']['kiosk']['ready']
            self.assertEqual(repeated_ready, ready)

            # A valid release SHA is still not ready evidence outside the
            # verifying phase, and the failed attempt must be side-effect free.
            run('set-phase', '--run-id', 'release-1', '--phase', 'failed')
            failed = json.loads(path.read_text(encoding='utf-8'))
            self.assertEqual(
                failed['kioskByClient']['kiosk']['desiredReleaseSha'],
                DESIRED_RELEASE_SHA,
            )
            before = path.read_bytes()
            completed = run(
                'ack', '--run-id', 'release-1', '--client', 'kiosk', '--phase', 'ready',
                '--release-sha', DESIRED_RELEASE_SHA,
                '--verification-id', verification_id,
                check=False,
            )
            self.assertNotEqual(completed.returncode, 0)
            self.assertEqual(path.read_bytes(), before)

            # Retrying the same run creates a new verification cycle.  The
            # previous ready record must not satisfy it without a fresh ACK.
            run('put', '--run-id', 'release-1', '--clients', 'kiosk', '--terminal-type', 'kiosk')
            run(
                'set-phase', '--run-id', 'release-1', '--client', 'kiosk', '--phase', 'verifying',
                '--desired-release-sha', DESIRED_RELEASE_SHA,
            )
            retried = json.loads(path.read_text(encoding='utf-8'))
            retried_verification_id = retried['kioskByClient']['kiosk']['verificationId']
            self.assertNotEqual(retried_verification_id, verification_id)
            self.assertNotIn(
                'ready',
                retried.get('acknowledgements', {}).get('release-1', {}).get('kiosk', {}),
            )
            fresh = run(
                'ack', '--run-id', 'release-1', '--client', 'kiosk', '--phase', 'ready',
                '--release-sha', DESIRED_RELEASE_SHA,
                '--verification-id', retried_verification_id,
            )
            self.assertEqual(json.loads(fresh.stdout)['releaseSha'], DESIRED_RELEASE_SHA)

    def test_rollback_verification_rebinds_sha_without_exposing_the_client(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'status.json'

            def run(*args, check=True):
                return subprocess.run(
                    ['python3', str(SCRIPT), '--file', str(path), *args],
                    check=check,
                    text=True,
                    capture_output=True,
                )

            run('put', '--run-id', 'release-1', '--clients', 'signage', '--terminal-type', 'signage')
            run(
                'set-phase', '--run-id', 'release-1', '--client', 'signage',
                '--phase', 'deploying',
            )
            run(
                'set-phase', '--run-id', 'release-1', '--client', 'signage',
                '--phase', 'verifying', '--desired-release-sha', DESIRED_RELEASE_SHA,
            )
            forward_verification_id = json.loads(
                path.read_text(encoding='utf-8')
            )['kioskByClient']['signage']['verificationId']
            run(
                'ack', '--run-id', 'release-1', '--client', 'signage',
                '--phase', 'ready', '--release-sha', DESIRED_RELEASE_SHA,
                '--verification-id', forward_verification_id,
            )

            run(
                'set-phase', '--run-id', 'release-1', '--client', 'signage',
                '--phase', 'verifying', '--desired-release-sha', OTHER_RELEASE_SHA,
                '--rollback',
            )
            state = json.loads(path.read_text(encoding='utf-8'))
            entry = state['kioskByClient']['signage']
            self.assertTrue(entry['maintenance'])
            self.assertEqual(entry['phase'], 'verifying')
            self.assertEqual(entry['verificationMode'], 'rollback')
            self.assertEqual(entry['desiredReleaseSha'], OTHER_RELEASE_SHA)
            rollback_verification_id = entry['verificationId']
            self.assertNotEqual(rollback_verification_id, forward_verification_id)
            self.assertNotIn(
                'ready',
                state.get('acknowledgements', {}).get('release-1', {}).get('signage', {}),
            )

            # Once rollback verification is active, its mode, SHA and nonce
            # are immutable. A delayed forward command or a second rollback
            # targeting another SHA must be a byte-preserving failure.
            immutable_rollback = path.read_bytes()
            for arguments in (
                (
                    'set-phase', '--run-id', 'release-1', '--client', 'signage',
                    '--phase', 'verifying', '--desired-release-sha', OTHER_RELEASE_SHA,
                ),
                (
                    'set-phase', '--run-id', 'release-1', '--client', 'signage',
                    '--phase', 'verifying', '--desired-release-sha', DESIRED_RELEASE_SHA,
                    '--rollback',
                ),
            ):
                rejected_rebind = run(*arguments, check=False)
                self.assertNotEqual(rejected_rebind.returncode, 0)
                self.assertEqual(path.read_bytes(), immutable_rollback)

            # Retrying the exact rollback command is idempotent and preserves
            # the active challenge.
            run(
                'set-phase', '--run-id', 'release-1', '--client', 'signage',
                '--phase', 'verifying', '--desired-release-sha', OTHER_RELEASE_SHA,
                '--rollback',
            )
            self.assertEqual(path.read_bytes(), immutable_rollback)

            before = path.read_bytes()
            rejected = run(
                'ack', '--run-id', 'release-1', '--client', 'signage',
                '--phase', 'ready', '--release-sha', DESIRED_RELEASE_SHA,
                '--verification-id', rollback_verification_id,
                check=False,
            )
            self.assertNotEqual(rejected.returncode, 0)
            self.assertEqual(path.read_bytes(), before)
            delayed_forward = run(
                'ack', '--run-id', 'release-1', '--client', 'signage',
                '--phase', 'ready', '--release-sha', OTHER_RELEASE_SHA,
                '--verification-id', forward_verification_id,
                check=False,
            )
            self.assertNotEqual(delayed_forward.returncode, 0)
            self.assertEqual(path.read_bytes(), before)
            accepted = run(
                'ack', '--run-id', 'release-1', '--client', 'signage',
                '--phase', 'ready', '--release-sha', OTHER_RELEASE_SHA,
                '--verification-id', rollback_verification_id,
            )
            self.assertEqual(json.loads(accepted.stdout)['releaseSha'], OTHER_RELEASE_SHA)

            # Kiosk rollback can target the same Pi5 Web SHA as the failed
            # forward cycle. The explicit mode change must still invalidate
            # the former ACK so the browser proves readiness again.
            run('put', '--run-id', 'release-3', '--clients', 'kiosk', '--terminal-type', 'kiosk')
            run(
                'set-phase', '--run-id', 'release-3', '--client', 'kiosk',
                '--phase', 'deploying',
            )
            run(
                'set-phase', '--run-id', 'release-3', '--client', 'kiosk',
                '--phase', 'verifying', '--desired-release-sha', DESIRED_RELEASE_SHA,
            )
            kiosk_forward_id = json.loads(
                path.read_text(encoding='utf-8')
            )['kioskByClient']['kiosk']['verificationId']
            run(
                'ack', '--run-id', 'release-3', '--client', 'kiosk',
                '--phase', 'ready', '--release-sha', DESIRED_RELEASE_SHA,
                '--verification-id', kiosk_forward_id,
            )
            run(
                'set-phase', '--run-id', 'release-3', '--client', 'kiosk',
                '--phase', 'verifying', '--desired-release-sha', DESIRED_RELEASE_SHA,
                '--rollback',
            )
            same_sha_rollback = json.loads(path.read_text(encoding='utf-8'))
            self.assertEqual(
                same_sha_rollback['kioskByClient']['kiosk']['verificationMode'],
                'rollback',
            )
            kiosk_rollback_id = same_sha_rollback['kioskByClient']['kiosk']['verificationId']
            self.assertNotEqual(kiosk_rollback_id, kiosk_forward_id)
            self.assertNotIn(
                'ready',
                same_sha_rollback.get('acknowledgements', {}).get('release-3', {}).get('kiosk', {}),
            )
            before = path.read_bytes()
            delayed_forward = run(
                'ack', '--run-id', 'release-3', '--client', 'kiosk',
                '--phase', 'ready', '--release-sha', DESIRED_RELEASE_SHA,
                '--verification-id', kiosk_forward_id,
                check=False,
            )
            self.assertNotEqual(delayed_forward.returncode, 0)
            self.assertEqual(path.read_bytes(), before)

            run('put', '--run-id', 'release-2', '--clients', 'pending', '--terminal-type', 'signage')
            before = path.read_bytes()
            rejected = run(
                'set-phase', '--run-id', 'release-2', '--client', 'pending',
                '--phase', 'verifying', '--desired-release-sha', OTHER_RELEASE_SHA,
                '--rollback', check=False,
            )
            self.assertNotEqual(rejected.returncode, 0)
            self.assertEqual(path.read_bytes(), before)

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
