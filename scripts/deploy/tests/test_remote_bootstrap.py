#!/usr/bin/env python3
from __future__ import annotations

import fcntl
import io
import json
import os
import signal
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.deploy.rolling_release import bootstrap
from scripts.deploy.rolling_release.models import LaunchSpec


SHA = 'a' * 40
RUN_ID = '20260715-123456-a1b2c3'


class ExecIntercept(Exception):
    pass


class RecordingRun:
    def __init__(self, project: Path, *, head: str = SHA, dirty: str = '') -> None:
        self.project = project
        self.head = head
        self.dirty = dirty
        self.calls: list[tuple[tuple[str, ...], str, bool]] = []
        self.fleet_lock_was_held: list[bool] = []
        self.after_call = None

    def __call__(self, argv, *, cwd, capture_output=False):
        command = tuple(argv)
        self.calls.append((command, cwd, capture_output))
        fleet_descriptor = os.open(
            self.project / 'logs/deploy/fleet-release-state.lock', os.O_WRONLY
        )
        fleet_blocked = False
        try:
            try:
                fcntl.flock(fleet_descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                fleet_blocked = True
            else:
                fcntl.flock(fleet_descriptor, fcntl.LOCK_UN)
        finally:
            os.close(fleet_descriptor)
        self.fleet_lock_was_held.append(fleet_blocked)
        if self.after_call is not None:
            self.after_call(command)
        if command[1:3] == ('rev-parse', 'HEAD'):
            stdout = f'{self.head}\n'
        elif command[1] == 'status':
            stdout = self.dirty
        else:
            stdout = ''
        return subprocess.CompletedProcess(command, 0, stdout=stdout, stderr='')


class RemoteBootstrapTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.project = Path(self.temporary.name)
        (self.project / '.git').mkdir()
        protocol = self.project / bootstrap.PROTOCOL_PATH
        protocol.parent.mkdir(parents=True)
        protocol.write_text(bootstrap.PROTOCOL_VALUE, encoding='utf-8')
        self.original_cwd = Path.cwd()
        self.identity_patch = patch.object(
            bootstrap,
            'read_local_server_client_id',
            return_value='raspberrypi5-server',
        )
        self.identity_patch.start()

    def tearDown(self) -> None:
        self.identity_patch.stop()
        os.chdir(self.original_cwd)
        self.temporary.cleanup()

    def spec(self, **overrides):
        values = {
            'run_id': RUN_ID,
            'branch': 'main',
            'sha': SHA,
            'inventory': 'inventory.yml',
            'expected_server_client_id': 'raspberrypi5-server',
            'limit': '',
        }
        values.update(overrides)
        launch = LaunchSpec(**values)
        return launch.bootstrap_payload(str(self.project))

    def test_fleet_lock_precedes_every_git_command_and_fd_is_inherited_by_exec(self):
        runner = RecordingRun(self.project)
        invoked = {}
        original_handler = signal.getsignal(signal.SIGUSR1)

        def fake_exec(path, argv, environment):
            invoked.update(path=path, argv=list(argv), environment=dict(environment), cwd=Path.cwd())
            invoked['sigusr1_handler'] = signal.getsignal(signal.SIGUSR1)
            fleet_descriptor = int(environment['ROLLING_RELEASE_FLEET_LOCK_FD'])
            self.assertTrue(os.get_inheritable(fleet_descriptor))
            self.assertEqual(
                os.fstat(fleet_descriptor).st_ino,
                os.stat(self.project / 'logs/deploy/fleet-release-state.lock').st_ino,
            )
            self.assertEqual(
                os.stat(self.project / 'logs/deploy/fleet-release-state.lock').st_mode & 0o777,
                0o600,
            )
            raise ExecIntercept

        with self.assertRaises(ExecIntercept):
            bootstrap.execute(
                self.spec(),
                run_command=runner,
                execve=fake_exec,
                environ={'BASE': '1'},
                server_client_id_reader=lambda: 'raspberrypi5-server',
            )

        self.assertEqual(
            [call[0][1:3] for call in runner.calls],
            [
                ('status', '--porcelain=v1'),
                ('fetch', '--no-tags'),
                ('cat-file', '-e'),
                ('checkout', '--detach'),
                ('rev-parse', 'HEAD'),
                ('status', '--porcelain=v1'),
            ],
        )
        self.assertEqual(runner.fleet_lock_was_held, [True] * 6)
        self.assertEqual(invoked['path'], '/usr/bin/python3')
        self.assertIs(invoked['sigusr1_handler'], signal.SIG_IGN)
        self.assertIs(signal.getsignal(signal.SIGUSR1), original_handler)
        self.assertEqual(invoked['cwd'].resolve(), self.project.resolve())
        self.assertEqual(Path.cwd().resolve(), self.original_cwd.resolve())
        self.assertNotIn('ROLLING_RELEASE_LOCK_HELD', invoked['environment'])
        self.assertEqual(invoked['environment']['ROLLING_RELEASE_PROTOCOL'], '2')
        self.assertNotIn('ROLLING_RELEASE_LOCK_PATH', invoked['environment'])
        self.assertNotIn('ROLLING_RELEASE_LOCK_FD', invoked['environment'])
        self.assertEqual(
            invoked['environment']['ROLLING_RELEASE_FLEET_LOCK_PATH'],
            str(self.project / 'logs/deploy/fleet-release-state.lock'),
        )
        self.assertEqual(
            invoked['environment']['ROLLING_RELEASE_CONTROL_FILE'],
            str(self.project / f'logs/deploy/release-runs/{RUN_ID}.control.json'),
        )
        self.assertIn('--remote-run', invoked['argv'])
        self.assertIn('--run-id', invoked['argv'])
        self.assertEqual(invoked['argv'][invoked['argv'].index('--run-id') + 1], RUN_ID)

    def test_fleet_lock_contender_cannot_fetch_checkout_exec_or_create_run_state(self):
        lock_path = self.project / 'logs/deploy/fleet-release-state.lock'
        lock_path.parent.mkdir(parents=True)
        descriptor = os.open(lock_path, os.O_WRONLY | os.O_CREAT, 0o600)
        runner = RecordingRun(self.project)
        executed = []
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
            result = bootstrap.execute(
                self.spec(),
                run_command=runner,
                execve=lambda *arguments: executed.append(arguments),
            )
        finally:
            fcntl.flock(descriptor, fcntl.LOCK_UN)
            os.close(descriptor)

        self.assertEqual(result, bootstrap.EX_TEMPFAIL)
        self.assertEqual(runner.calls, [])
        self.assertEqual(executed, [])
        self.assertTrue((self.project / 'logs/deploy/fleet-release-state.lock').is_file())
        self.assertFalse((self.project / 'logs/deploy/fleet-release-state.json').exists())
        self.assertFalse((self.project / 'logs/deploy/release-runs').exists())

    def test_fleet_lock_contender_stops_before_git(self):
        fleet_lock = self.project / 'logs/deploy/fleet-release-state.lock'
        fleet_lock.parent.mkdir(parents=True)
        descriptor = os.open(fleet_lock, os.O_WRONLY | os.O_CREAT, 0o600)
        runner = RecordingRun(self.project)
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
            result = bootstrap.execute(self.spec(), run_command=runner)
        finally:
            fcntl.flock(descriptor, fcntl.LOCK_UN)
            os.close(descriptor)

        self.assertEqual(result, bootstrap.EX_TEMPFAIL)
        self.assertEqual(runner.calls, [])
        self.assertFalse((self.project / 'logs/deploy/fleet-release-state.json').exists())

    def test_fleet_lock_symlink_fails_before_git_without_modifying_target(self):
        lock_path = self.project / 'logs/deploy/fleet-release-state.lock'
        lock_path.parent.mkdir(parents=True)
        target = self.project / 'must-not-open'
        target.write_text('unchanged\n', encoding='utf-8')
        lock_path.symlink_to(target)
        runner = RecordingRun(self.project)

        result = bootstrap.execute(self.spec(), run_command=runner)

        self.assertEqual(result, bootstrap.EX_TEMPFAIL)
        self.assertEqual(runner.calls, [])
        self.assertEqual(target.read_text(encoding='utf-8'), 'unchanged\n')

    def test_existing_cancel_control_stops_before_fetch(self):
        control = Path(bootstrap.control_file(self.spec()))
        control.parent.mkdir(parents=True)
        control.write_text('{"cancel":true}\n', encoding='utf-8')
        runner = RecordingRun(self.project)

        result = bootstrap.execute(self.spec(), run_command=runner)

        self.assertEqual(result, bootstrap.EX_CANCELLED)
        self.assertEqual(runner.calls, [])

    def test_exact_source_runs_standalone_and_honours_cancel_before_git(self):
        spec = self.spec()
        control = Path(bootstrap.control_file(spec))
        control.parent.mkdir(parents=True)
        control.write_text('{"cancel":true}\n', encoding='utf-8')
        source = Path(bootstrap.__file__).read_text(encoding='utf-8')

        completed = subprocess.run(
            [sys.executable, '-c', source, json.dumps(spec)],
            text=True,
            capture_output=True,
            check=False,
        )

        self.assertEqual(completed.returncode, bootstrap.EX_CANCELLED, completed.stderr)

    def test_exact_source_runs_standalone_and_fleet_lock_contention_precedes_git(self):
        lock_path = self.project / 'logs/deploy/fleet-release-state.lock'
        lock_path.parent.mkdir(parents=True)
        descriptor = os.open(lock_path, os.O_WRONLY | os.O_CREAT, 0o600)
        source = Path(bootstrap.__file__).read_text(encoding='utf-8')
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
            completed = subprocess.run(
                [sys.executable, '-c', source, json.dumps(self.spec())],
                text=True,
                capture_output=True,
                check=False,
            )
        finally:
            fcntl.flock(descriptor, fcntl.LOCK_UN)
            os.close(descriptor)

        self.assertEqual(completed.returncode, bootstrap.EX_TEMPFAIL, completed.stderr)
        self.assertTrue((self.project / 'logs/deploy/fleet-release-state.lock').is_file())
        self.assertFalse((self.project / 'logs/deploy/fleet-release-state.json').exists())
        self.assertFalse((self.project / 'logs/deploy/release-runs').exists())

    def test_cancel_arriving_during_fetch_stops_before_commit_or_checkout(self):
        spec = self.spec()
        control = Path(bootstrap.control_file(spec))
        runner = RecordingRun(self.project)

        def after_call(command):
            if command[1] == 'fetch':
                control.parent.mkdir(parents=True)
                control.write_text('{"cancel":true}\n', encoding='utf-8')

        runner.after_call = after_call
        result = bootstrap.execute(spec, run_command=runner)

        self.assertEqual(result, bootstrap.EX_CANCELLED)
        self.assertEqual([call[0][1] for call in runner.calls], ['status', 'fetch'])

    def test_signal_without_control_is_only_a_wakeup_and_does_not_cancel(self):
        requested = {'value': False}
        runner = RecordingRun(self.project)
        invoked = []

        def after_call(command):
            if command[1] == 'cat-file':
                requested['value'] = True

        def fake_exec(*arguments):
            invoked.append(arguments)
            raise ExecIntercept

        runner.after_call = after_call
        with self.assertRaises(ExecIntercept):
            bootstrap.execute(
                self.spec(),
                run_command=runner,
                signal_requested=lambda: requested['value'],
                execve=fake_exec,
            )

        self.assertEqual(
            [call[0][1] for call in runner.calls],
            ['status', 'fetch', 'cat-file', 'checkout', 'rev-parse', 'status'],
        )
        self.assertEqual(len(invoked), 1)

    def test_signal_with_control_stops_at_next_checkpoint(self):
        requested = {'value': False}
        spec = self.spec()
        control = Path(bootstrap.control_file(spec))
        runner = RecordingRun(self.project)

        def after_call(command):
            if command[1] == 'cat-file':
                requested['value'] = True
                control.parent.mkdir(parents=True)
                control.write_text('{"cancel":true}\n', encoding='utf-8')

        runner.after_call = after_call
        result = bootstrap.execute(
            spec,
            run_command=runner,
            signal_requested=lambda: requested['value'],
        )

        self.assertEqual(result, bootstrap.EX_CANCELLED)
        self.assertEqual([call[0][1] for call in runner.calls], ['status', 'fetch', 'cat-file'])

    def test_cancel_after_checkout_prevents_coordinator_exec(self):
        spec = self.spec()
        control = Path(bootstrap.control_file(spec))
        runner = RecordingRun(self.project)
        executed = []

        def after_call(command):
            if command[1] == 'checkout':
                control.parent.mkdir(parents=True)
                control.write_text('{"cancel":true}\n', encoding='utf-8')

        runner.after_call = after_call
        result = bootstrap.execute(
            spec,
            run_command=runner,
            execve=lambda *arguments: executed.append(arguments),
        )

        self.assertEqual(result, bootstrap.EX_CANCELLED)
        self.assertEqual(
            [call[0][1] for call in runner.calls],
            ['status', 'fetch', 'cat-file', 'checkout'],
        )
        self.assertEqual(executed, [])

    def test_head_mismatch_fails_closed_after_checkout(self):
        runner = RecordingRun(self.project, head='b' * 40)
        executed = []

        result = bootstrap.execute(
            self.spec(),
            run_command=runner,
            execve=lambda *arguments: executed.append(arguments),
        )

        self.assertEqual(result, bootstrap.EX_CONFIG)
        self.assertEqual(executed, [])

    def test_target_without_current_protocol_cannot_exec_an_old_coordinator(self):
        (self.project / bootstrap.PROTOCOL_PATH).write_text(
            'raspi-rolling-release-v1\n', encoding='utf-8'
        )
        runner = RecordingRun(self.project)
        executed = []

        result = bootstrap.execute(
            self.spec(),
            run_command=runner,
            execve=lambda *arguments: executed.append(arguments),
        )

        self.assertEqual(result, bootstrap.EX_CONFIG)
        self.assertEqual(executed, [])

    def test_dirty_remote_worktree_fails_before_fetch_without_cleaning_it(self):
        runner_path = self.project / 'scripts/deploy/rolling-release.py'
        runner_path.parent.mkdir(parents=True, exist_ok=True)
        runner_path.write_text('tampered coordinator\n', encoding='utf-8')
        runner = RecordingRun(
            self.project,
            dirty=' M scripts/deploy/rolling-release.py\n',
        )
        executed = []

        result = bootstrap.execute(
            self.spec(),
            run_command=runner,
            execve=lambda *arguments: executed.append(arguments),
        )

        self.assertEqual(result, bootstrap.EX_CONFIG)
        self.assertEqual([call[0][1] for call in runner.calls], ['status'])
        self.assertEqual(executed, [])
        self.assertEqual(runner_path.read_text(encoding='utf-8'), 'tampered coordinator\n')

    def test_real_git_detects_dirty_coordinator_before_fetch_or_exec(self):
        with tempfile.TemporaryDirectory() as directory:
            project = Path(directory)
            subprocess.run(['/usr/bin/git', 'init', '-q', '-b', 'main'], cwd=project, check=True)
            subprocess.run(
                ['/usr/bin/git', 'config', 'user.email', 'test@example.invalid'],
                cwd=project,
                check=True,
            )
            subprocess.run(
                ['/usr/bin/git', 'config', 'user.name', 'Test'],
                cwd=project,
                check=True,
            )
            protocol = project / bootstrap.PROTOCOL_PATH
            protocol.parent.mkdir(parents=True)
            protocol.write_text(bootstrap.PROTOCOL_VALUE, encoding='utf-8')
            runner_path = project / 'scripts/deploy/rolling-release.py'
            runner_path.write_text('trusted\n', encoding='utf-8')
            subprocess.run(['/usr/bin/git', 'add', '.'], cwd=project, check=True)
            subprocess.run(['/usr/bin/git', 'commit', '-q', '-m', 'fixture'], cwd=project, check=True)
            sha = subprocess.run(
                ['/usr/bin/git', 'rev-parse', 'HEAD'],
                cwd=project,
                check=True,
                text=True,
                capture_output=True,
            ).stdout.strip()
            runner_path.write_text('tampered\n', encoding='utf-8')
            spec = LaunchSpec(
                run_id=RUN_ID,
                branch='main',
                sha=sha,
                inventory='inventory.yml',
                expected_server_client_id='raspberrypi5-server',
            ).bootstrap_payload(str(project))
            executed = []

            result = bootstrap.execute(
                spec,
                execve=lambda *arguments: executed.append(arguments),
                server_client_id_reader=lambda: 'raspberrypi5-server',
            )

            self.assertEqual(result, bootstrap.EX_CONFIG)
            self.assertEqual(executed, [])
            self.assertEqual(runner_path.read_text(encoding='utf-8'), 'tampered\n')

    def test_argv_preserves_shell_metacharacters_without_execution(self):
        marker = self.project / 'must-not-exist'
        branch = "feature/quote'$value"
        limit = f"kiosk;touch {marker};$(touch {marker})"
        reason = "operator's reason\n$(touch must-not-exist)"
        runner = RecordingRun(self.project)
        invoked = {}

        def fake_exec(_path, argv, _environment):
            invoked['argv'] = list(argv)
            raise ExecIntercept

        with self.assertRaises(ExecIntercept):
            bootstrap.execute(
                self.spec(
                    branch=branch,
                    limit=limit,
                    emergency_override=True,
                    reason=reason,
                ),
                run_command=runner,
                execve=fake_exec,
            )

        fetch = next(call[0] for call in runner.calls if call[0][1] == 'fetch')
        self.assertEqual(fetch[-1], branch)
        arguments = invoked['argv']
        self.assertEqual(arguments[arguments.index('--limit') + 1], limit)
        self.assertEqual(arguments[arguments.index('--reason') + 1], reason)
        self.assertFalse(marker.exists())
        self.assertFalse((self.project / 'must-not-exist').exists())

    def test_parse_spec_rejects_unknown_fields_and_path_traversal(self):
        valid = self.spec()
        unknown = {**valid, 'unexpected': True}
        traversing = {**valid, 'inventory': '../inventory.yml'}
        unused_reason = {**valid, 'reason': 'not an emergency'}
        long_inventory = {**valid, 'inventory': 'x' * 1001}

        for invalid in (unknown, traversing, unused_reason, long_inventory):
            with self.subTest(invalid=invalid), self.assertRaises(bootstrap.BootstrapConfigError):
                bootstrap.parse_spec(json.dumps(invalid))
        self.assertEqual(bootstrap.main(['{}']), bootstrap.EX_CONFIG)

    def test_wrong_server_identity_stops_before_every_git_command(self):
        runner = RecordingRun(self.project)

        result = bootstrap.execute(
            self.spec(),
            run_command=runner,
            server_client_id_reader=lambda: 'talkplaza-pi5-server',
        )

        self.assertEqual(result, bootstrap.EX_CONFIG)
        self.assertEqual(runner.calls, [])

    def test_client_key_in_config_is_never_emitted(self):
        config = self.project / 'raspi-status-agent.conf'
        secret = 'must-never-appear-client-key'
        config.write_text(
            'CLIENT_ID="raspberrypi5-server"\n'
            f'CLIENT_KEY="{secret}"\n',
            encoding='utf-8',
        )
        self.assertEqual(
            bootstrap.read_local_server_client_id(str(config)),
            'raspberrypi5-server',
        )
        stderr = io.StringIO()
        with patch('sys.stderr', stderr):
            result = bootstrap.execute(
                self.spec(),
                run_command=RecordingRun(self.project),
                server_client_id_reader=lambda: 'talkplaza-pi5-server',
            )
        self.assertEqual(result, bootstrap.EX_CONFIG)
        self.assertNotIn(secret, stderr.getvalue())


if __name__ == '__main__':
    unittest.main()
