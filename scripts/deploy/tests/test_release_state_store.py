import concurrent.futures
import json
import os
import stat
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch


DEPLOY_DIRECTORY = Path(__file__).parents[1]
sys.path.insert(0, str(DEPLOY_DIRECTORY))

from rolling_release.lock import RunLock, RunLockBusyError  # noqa: E402
from rolling_release.state import (  # noqa: E402
    InvalidRunIdError,
    RunAlreadyTerminalError,
    RunPersistenceError,
    RunRecordCorruptError,
    RunStateStore,
    run_paths,
)
from rolling_release import state as state_module  # noqa: E402


class RunLockTest(unittest.TestCase):
    def test_nonblocking_contender_cannot_enter_held_per_run_lock(self):
        with tempfile.TemporaryDirectory() as directory:
            lock_path = Path(directory) / 'run-1.lock'
            with RunLock(lock_path):
                with self.assertRaises(RunLockBusyError):
                    RunLock(lock_path, blocking=False).acquire()
            with RunLock(lock_path, blocking=False):
                self.assertTrue(lock_path.is_file())

    def test_lock_file_is_retained_but_kernel_ownership_is_released(self):
        with tempfile.TemporaryDirectory() as directory:
            lock_path = Path(directory) / 'run-1.lock'
            lock = RunLock(lock_path).acquire()
            self.assertGreaterEqual(lock.fd, 0)
            lock.release()
            self.assertTrue(lock_path.exists())
            with RunLock(lock_path, blocking=False):
                pass


class RunStateStoreTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name) / 'release-runs'
        self.times = iter(
            f'2026-07-15T00:00:{second:02d}Z' for second in range(60)
        )
        self.store = RunStateStore(self.root, clock=lambda: next(self.times))

    def tearDown(self):
        self.temporary.cleanup()

    def test_invalid_run_ids_are_rejected_before_paths_are_created(self):
        for run_id in ('', 'ab', '../run-1', 'run.1', 'run/1', 'run 1', 'x' * 81):
            with self.subTest(run_id=run_id), self.assertRaises(InvalidRunIdError):
                self.store.paths(run_id)
        self.assertFalse(self.root.exists())

    def test_state_and_control_are_distinct_and_progress_update_keeps_cancel(self):
        self.store.create_state('run-1', {'state': 'running', 'phase': 'planning'})
        cancel = self.store.request_cancel('run-1', ' stop after this phase ')
        updated = self.store.update_state(
            'run-1', lambda state: state.update({'phase': 'phase-complete'}),
        )

        paths = run_paths(self.root, 'run-1')
        self.assertEqual(updated['phase'], 'phase-complete')
        self.assertNotIn('reason', updated)
        self.assertEqual(self.store.read_control('run-1'), cancel.record)
        self.assertEqual(json.loads(paths.control.read_text())['reason'], 'stop after this phase')
        self.assertNotEqual(paths.state, paths.control)

    def test_update_reads_latest_state_instead_of_saving_a_cached_snapshot(self):
        self.store.create_state('run-1', {'state': 'running', 'phase': 'one', 'count': 0})
        stale = self.store.read_state('run-1')
        self.store.update_state('run-1', lambda state: state.update({'phase': 'two'}))
        updated = self.store.update_state('run-1', lambda state: state.update({'count': state['count'] + 1}))

        self.assertEqual(stale['phase'], 'one')
        self.assertEqual(updated['phase'], 'two')
        self.assertEqual(updated['count'], 1)

    def test_first_cancel_reason_is_immutable_and_retries_are_idempotent(self):
        self.store.create_state('run-1', {'state': 'running'})
        first = self.store.request_cancel('run-1', 'first reason', requested_by='operator-a')
        second = self.store.request_cancel('run-1', 'replacement reason', requested_by='operator-b')

        self.assertTrue(first.created)
        self.assertFalse(second.created)
        self.assertEqual(second.record, first.record)
        self.assertEqual(second.record['reason'], 'first reason')
        self.assertEqual(second.record['requestedBy'], 'operator-a')

    def test_cancel_may_precede_initial_state_without_being_lost(self):
        cancel = self.store.request_cancel('run-1', 'cancel before coordinator start')
        state = self.store.create_state('run-1', {'state': 'running'})

        self.assertEqual(state['state'], 'running')
        self.assertEqual(self.store.read_control('run-1'), cancel.record)
        self.assertEqual(self.store.finish_state('run-1', 'success')['state'], 'cancelled')

    def test_cancel_wins_when_it_is_persisted_before_success(self):
        self.store.create_state('run-1', {'state': 'running'})
        self.store.request_cancel('run-1', 'operator stop')

        finished = self.store.finish_state('run-1', 'success')

        self.assertEqual(finished['state'], 'cancelled')
        self.assertEqual(finished['exitCode'], 130)
        self.assertEqual(finished['endedAt'], finished['completedAt'])
        self.assertEqual(self.store.read_state('run-1')['state'], 'cancelled')

    def test_terminal_hook_observes_arbitrated_state_under_the_run_lock(self):
        self.store.create_state('run-1', {'state': 'running'})
        self.store.request_cancel('run-1', 'operator stop')
        observed = []

        def finish_fleet(effective_state):
            observed.append(effective_state)
            return {'fleetGeneration': 9}

        finished = self.store.finish_state(
            'run-1', 'success', before_persist=finish_fleet
        )

        self.assertEqual(observed, ['cancelled'])
        self.assertEqual(finished['state'], 'cancelled')
        self.assertEqual(finished['fleetGeneration'], 9)

    def test_success_wins_when_terminal_state_is_persisted_before_cancel(self):
        self.store.create_state('run-1', {'state': 'running'})
        finished = self.store.finish_state('run-1', 'success')
        self.assertEqual(finished['state'], 'success')
        self.assertEqual(finished['exitCode'], 0)
        self.assertEqual(finished['endedAt'], finished['completedAt'])

        with self.assertRaises(RunAlreadyTerminalError):
            self.store.request_cancel('run-1', 'too late')
        self.assertIsNone(self.store.read_control('run-1'))

    def test_cancel_does_not_mask_a_real_failure(self):
        self.store.create_state('run-1', {'state': 'running'})
        self.store.request_cancel('run-1', 'operator stop')

        finished = self.store.finish_state('run-1', 'failed', changes={'failure': 'playbook failed'})

        self.assertEqual(finished['state'], 'failed')
        self.assertEqual(finished['exitCode'], 1)
        self.assertEqual(finished['failure'], 'playbook failed')
        self.assertEqual(self.store.read_control('run-1')['reason'], 'operator stop')

    def test_terminal_state_is_immutable(self):
        self.store.create_state('run-1', {'state': 'running'})
        self.store.finish_state('run-1', 'failed')

        with self.assertRaises(RunAlreadyTerminalError):
            self.store.update_state('run-1', lambda state: state.update({'phase': 'late'}))
        with self.assertRaises(RunAlreadyTerminalError):
            self.store.finish_state('run-1', 'interrupted')

    def test_terminal_and_cancel_race_has_only_two_linearizable_outcomes(self):
        # Repeat to exercise both fcntl-lock contenders without depending on
        # scheduler order.  Whichever write wins, state/control remain coherent.
        for index in range(12):
            run_id = f'race-{index}'
            self.store.create_state(run_id, {'state': 'running'})
            barrier = threading.Barrier(2)

            def finish():
                barrier.wait()
                return ('finish', self.store.finish_state(run_id, 'success'))

            def cancel():
                barrier.wait()
                try:
                    return ('cancel', self.store.request_cancel(run_id, 'race cancel'))
                except RunAlreadyTerminalError:
                    return ('cancel-late', None)

            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
                results = [future.result() for future in (pool.submit(finish), pool.submit(cancel))]
            final_state = self.store.read_state(run_id)
            control = self.store.read_control(run_id)
            labels = {label for label, _ in results}
            if control is None:
                self.assertEqual(final_state['state'], 'success')
                self.assertEqual(final_state['exitCode'], 0)
                self.assertIn('cancel-late', labels)
            else:
                self.assertEqual(final_state['state'], 'cancelled')
                self.assertEqual(final_state['exitCode'], 130)
                self.assertIn('cancel', labels)

    def test_atomic_write_orders_file_fsync_replace_and_directory_fsync(self):
        events = []
        real_mkstemp = state_module.tempfile.mkstemp
        real_fsync = state_module.os.fsync
        real_replace = state_module.os.replace

        def tracked_mkstemp(*args, **kwargs):
            events.append('mkstemp')
            return real_mkstemp(*args, **kwargs)

        def tracked_fsync(fd):
            events.append('dir-fsync' if stat.S_ISDIR(os.fstat(fd).st_mode) else 'file-fsync')
            return real_fsync(fd)

        def tracked_replace(source, destination):
            events.append('replace')
            return real_replace(source, destination)

        with patch.object(state_module.tempfile, 'mkstemp', side_effect=tracked_mkstemp), \
                patch.object(state_module.os, 'fsync', side_effect=tracked_fsync), \
                patch.object(state_module.os, 'replace', side_effect=tracked_replace):
            self.store.create_state('run-1', {'state': 'running'})

        self.assertEqual(events, ['mkstemp', 'file-fsync', 'replace', 'dir-fsync'])
        mode = stat.S_IMODE(run_paths(self.root, 'run-1').state.stat().st_mode)
        self.assertEqual(mode, 0o600)

    def test_failed_replace_keeps_previous_record_and_removes_temp_file(self):
        self.store.create_state('run-1', {'state': 'running', 'phase': 'before'})
        path = run_paths(self.root, 'run-1').state
        before = path.read_bytes()

        with patch.object(state_module.os, 'replace', side_effect=OSError('replace failed')):
            with self.assertRaisesRegex(OSError, 'replace failed'):
                self.store.update_state('run-1', lambda state: state.update({'phase': 'after'}))

        self.assertEqual(path.read_bytes(), before)
        self.assertEqual(list(self.root.glob('*.tmp')), [])

    def test_corrupt_or_mismatched_records_fail_closed(self):
        self.root.mkdir(parents=True)
        paths = run_paths(self.root, 'run-1')
        paths.state.write_text('{broken', encoding='utf-8')
        with self.assertRaises(RunRecordCorruptError):
            self.store.read_state('run-1')

        paths.state.write_text(
            json.dumps({'version': 1, 'runId': 'run-1', 'state': 'running'}),
            encoding='utf-8',
        )
        paths.control.write_text(
            json.dumps({
                'version': 1,
                'runId': 'run-1',
                'unitName': 'raspi-release-run-1.service',
                'requestedAt': '2026-07-15T00:00:00Z',
                'requestedBy': 'operator-cli',
                'reason': '   ',
            }),
            encoding='utf-8',
        )
        with self.assertRaises(RunRecordCorruptError):
            self.store.read_control('run-1')

        paths.state.write_text(
            json.dumps({'version': 1, 'runId': 'run-2', 'state': 'running'}),
            encoding='utf-8',
        )
        with self.assertRaises(RunRecordCorruptError):
            self.store.read_state('run-1')

    def test_update_cannot_bypass_atomic_terminal_resolution(self):
        self.store.create_state('run-1', {'state': 'running'})
        with self.assertRaisesRegex(RunPersistenceError, 'finish_state'):
            self.store.update_state('run-1', lambda state: state.update({'state': 'success'}))


if __name__ == '__main__':
    unittest.main()
