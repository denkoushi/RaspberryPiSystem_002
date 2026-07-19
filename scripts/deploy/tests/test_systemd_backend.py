#!/usr/bin/env python3
from __future__ import annotations

import base64
import json
import shlex
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path, PurePosixPath

from scripts.deploy.rolling_release import bootstrap
from scripts.deploy.rolling_release import migration_preflight
from scripts.deploy.rolling_release import terminal_preflight
from scripts.deploy.rolling_release.adapter_registry import adapter_for_profile
from scripts.deploy.rolling_release.backends import systemd as backend_module
from scripts.deploy.rolling_release.backends.command import CommandResult, SshTransport
from scripts.deploy.rolling_release.backends.systemd import (
    SystemdBackend,
    validate_current_execution_identity,
)
from scripts.deploy.rolling_release.models import LaunchSpec


RUN_ID = '20260715-123456-a1b2c3'
SHA = 'a' * 40


class FakeRunner:
    def __init__(self, *results: CommandResult) -> None:
        self.results = list(results)
        self.calls = []

    def run(self, argv, *, cwd=None, env=None, input_text=None):
        command = tuple(argv)
        self.calls.append({
            'argv': command,
            'cwd': cwd,
            'env': env,
            'input_text': input_text,
        })
        if self.results:
            scripted = self.results.pop(0)
            return CommandResult(command, scripted.returncode, scripted.stdout, scripted.stderr)
        return CommandResult(command, 0, '', '')


class SystemdBackendTest(unittest.TestCase):
    def spec(self, **overrides):
        values = {
            'run_id': RUN_ID,
            'branch': 'main',
            'sha': SHA,
            'inventory': 'inventory.yml',
            'expected_server_client_id': 'raspberrypi5-server',
        }
        values.update(overrides)
        return LaunchSpec(**values)

    def backend(self, runner=None, *, project='/opt/RaspberryPiSystem_002'):
        runner = runner or FakeRunner()
        transport = SshTransport('operator@pi5.example', runner, ssh_options=('-o', 'BatchMode=yes'))
        return SystemdBackend(
            transport,
            remote_project=PurePosixPath(project),
            bootstrap_source='TRUSTED_BOOTSTRAP_SOURCE',
            migration_preflight_source='TRUSTED_MIGRATION_PREFLIGHT_SOURCE',
            terminal_preflight_source='TRUSTED_TERMINAL_PREFLIGHT_SOURCE',
        ), runner

    def remote_argv(self, runner):
        return shlex.split(runner.calls[-1]['argv'][-1])

    def test_foreground_uses_type_exec_and_wait_without_collect_or_no_block(self):
        backend, runner = self.backend()

        result = backend.start(self.spec(), wait=True)

        self.assertEqual(result.returncode, 0)
        remote = self.remote_argv(runner)
        self.assertEqual(remote[:3], ['/usr/bin/sudo', '-n', '/usr/bin/systemd-run'])
        self.assertIn('--quiet', remote)
        self.assertIn(f'--unit=raspi-release-{RUN_ID}.service', remote)
        self.assertIn('--uid=denkon5sd02', remote)
        self.assertIn('--setenv=HOME=/home/denkon5sd02', remote)
        self.assertIn('--setenv=USER=denkon5sd02', remote)
        self.assertIn('--setenv=LOGNAME=denkon5sd02', remote)
        self.assertIn(
            '--setenv=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
            remote,
        )
        self.assertIn('--property=Type=exec', remote)
        self.assertIn('--property=KillMode=control-group', remote)
        self.assertIn('--property=Restart=no', remote)
        self.assertIn('--property=UMask=0077', remote)
        self.assertIn('--wait', remote)
        self.assertNotIn('--collect', remote)
        self.assertNotIn('--no-block', remote)
        self.assertNotIn('--property=SuccessExitStatus=130', remote)
        self.assertEqual(remote[-5:-3], ['/usr/bin/python3', '-c'])
        self.assertEqual(
            base64.b64decode(remote[-2]).decode('utf-8'),
            'TRUSTED_BOOTSTRAP_SOURCE',
        )
        payload = bootstrap.parse_spec(base64.b64decode(remote[-1]).decode('utf-8'))
        self.assertEqual(payload['runId'], RUN_ID)
        self.assertEqual(payload['sha'], SHA)
        self.assertFalse(payload['fullFleet'])

    def test_full_fleet_survives_the_systemd_bootstrap_contract(self):
        backend, runner = self.backend()

        backend.start(self.spec(full_fleet=True), wait=False)

        remote = self.remote_argv(runner)
        payload = bootstrap.parse_spec(base64.b64decode(remote[-1]).decode('utf-8'))
        self.assertTrue(payload['fullFleet'])
        self.assertIn('--full-fleet', bootstrap.remote_arguments(payload))

    def test_detach_omits_wait_but_still_waits_for_unit_start(self):
        backend, runner = self.backend()

        backend.start(self.spec(), wait=False)

        remote = self.remote_argv(runner)
        self.assertNotIn('--wait', remote)
        self.assertNotIn('--no-block', remote)
        self.assertNotIn('--collect', remote)

    def test_migration_preflight_is_read_only_and_precedes_systemd_submission(self):
        backend, runner = self.backend()

        result = backend.preflight_migrations(self.spec())

        self.assertEqual(result.returncode, 0)
        remote = self.remote_argv(runner)
        self.assertNotIn('/usr/bin/systemd-run', remote)
        self.assertEqual(remote[:3], ['/usr/bin/python3', '-c', backend_module.MIGRATION_PREFLIGHT_LOADER])
        self.assertEqual(
            base64.b64decode(remote[-2]).decode('utf-8'),
            'TRUSTED_MIGRATION_PREFLIGHT_SOURCE',
        )
        payload = migration_preflight.parse_spec(
            base64.b64decode(remote[-1]).decode('utf-8')
        )
        self.assertEqual(payload['sha'], SHA)
        self.assertEqual(payload['runId'], RUN_ID)

    def test_terminal_preflight_is_read_only_and_carries_secret_free_targets(self):
        backend, runner = self.backend()
        target = {
            'version': 1,
            'mode': 'target',
            'host': 'kiosk-a',
            'profile': 'kiosk',
            'address': '100.64.0.10',
            'user': 'kiosk-a',
            'port': 22,
            'repoPath': '/opt/RaspberryPiSystem_002',
            'memoryRequiredMb': 120,
            'tailscaleEnabled': True,
            'servicesToRestart': ['kiosk-browser.service'],
            'manageKioskBrowser': True,
            'kioskBrowserEngine': 'firefox',
            'firefoxMinimizeChrome': True,
            'clamavEnabled': True,
            'clamavLogDir': '/var/log/clamav',
            'clamavCron': '0 3 * * 0',
            'rkhunterEnabled': True,
            'rkhunterLogDir': '/var/log/rkhunter',
            'rkhunterCron': '30 3 * * 0',
            'nfcEnabled': True,
            'nfcContractValid': True,
            'barcodeEnabled': False,
            'barcodeSerialDevice': '/dev/ttyACM0',
            'torqueEnabled': False,
            'torqueContractValid': True,
            'haizenEnabled': False,
            'haizenHidDevice': '/dev/input/event0',
            'haizenInstallEvdev': True,
            'manageSignage': False,
            'inventoryIssues': [],
            'runtimeManifestContract': adapter_for_profile(
                'kiosk', runtime=None
            ).runtime_manifest_contract.as_preflight_payload(),
        }

        result = backend.preflight_terminals(self.spec(), [target])

        self.assertEqual(result.returncode, 0)
        remote = self.remote_argv(runner)
        self.assertNotIn('/usr/bin/systemd-run', remote)
        self.assertEqual(remote[:3], ['/usr/bin/python3', '-c', backend_module.TERMINAL_PREFLIGHT_LOADER])
        self.assertEqual(
            base64.b64decode(remote[-2]).decode('utf-8'),
            'TRUSTED_TERMINAL_PREFLIGHT_SOURCE',
        )
        payload = terminal_preflight.parse_spec(
            base64.b64decode(remote[-1]).decode('utf-8')
        )
        self.assertEqual(payload['targets'], [target])
        self.assertNotIn('clientKey', json.dumps(payload))
        self.assertNotIn('secret', json.dumps(payload).lower())

    def test_exact_multiline_bootstrap_source_survives_ssh_quoting(self):
        runner = FakeRunner()
        transport = SshTransport('operator@pi5.example', runner)
        backend = SystemdBackend(transport)
        expected_source = backend.bootstrap_source

        backend.start(self.spec(), wait=False)

        remote = self.remote_argv(runner)
        decoded_source = base64.b64decode(remote[-2]).decode('utf-8')
        decoded_payload = base64.b64decode(remote[-1]).decode('utf-8')
        self.assertEqual(decoded_source, expected_source)
        self.assertIn('def execute(', decoded_source)
        self.assertEqual(bootstrap.parse_spec(decoded_payload)['runId'], RUN_ID)

    def test_base64_loader_executes_exact_bootstrap_and_control_cancel(self):
        with tempfile.TemporaryDirectory() as temporary:
            project = Path(temporary).resolve()
            (project / '.git').mkdir()
            control = project / f'logs/deploy/release-runs/{RUN_ID}.control.json'
            control.parent.mkdir(parents=True)
            control.write_text('{"cancel":true}\n', encoding='utf-8')
            transport = SshTransport('operator@pi5.example', FakeRunner())
            backend = SystemdBackend(
                transport,
                remote_project=PurePosixPath(str(project)),
            )
            command = backend.build_start_command(self.spec(), wait=False)
            unit_command = command[command.index('--') + 1:]

            completed = subprocess.run(
                [sys.executable, *unit_command[1:]],
                text=True,
                capture_output=True,
                check=False,
            )

        self.assertEqual(completed.returncode, bootstrap.EX_CANCELLED, completed.stderr)

    def test_remote_project_with_spaces_and_operator_text_remain_single_argv(self):
        backend, runner = self.backend(project='/tmp/release checkout')
        marker = '/tmp/must-not-run'
        limit = f"kiosk;touch {marker};$(touch {marker})"
        reason = "operator's reason\n$(touch /tmp/must-not-run) ${HOME} $USER"
        spec = self.spec(
            branch="feature/quote'$value",
            limit=limit,
            emergency_override=True,
            reason=reason,
        )

        backend.start(spec, wait=False)

        remote = self.remote_argv(runner)
        self.assertIn('--property=WorkingDirectory=/tmp/release checkout', remote)
        payload_json = base64.b64decode(remote[-1]).decode('utf-8')
        payload = json.loads(payload_json)
        self.assertEqual(payload['limit'], limit)
        self.assertEqual(payload['reason'], reason)
        self.assertEqual(payload['branch'], "feature/quote'$value")
        self.assertNotIn('touch', remote)
        self.assertFalse(any('$' in argument for argument in remote[-3:]))
        self.assertEqual(
            payload_json,
            json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(',', ':')),
        )

    def test_show_parses_machine_readable_unit_properties(self):
        output = '\n'.join((
            'LoadState=loaded',
            'ActiveState=failed',
            'SubState=failed',
            'Result=exit-code',
            'ExecMainCode=1',
            'ExecMainStatus=75',
            '',
        ))
        runner = FakeRunner(CommandResult((), 0, output, ''))
        backend, _ = self.backend(runner)

        observed = backend.show(RUN_ID)

        self.assertTrue(observed.reachable)
        self.assertEqual(observed.load_state, 'loaded')
        self.assertEqual(observed.active_state, 'failed')
        self.assertEqual(observed.result, 'exit-code')
        self.assertEqual(observed.exec_main_code, '1')
        self.assertEqual(observed.exec_main_status, 75)
        remote = self.remote_argv(runner)
        self.assertEqual(
            remote[:5],
            ['/usr/bin/sudo', '-n', '/usr/bin/systemctl', 'show', '--no-pager'],
        )
        self.assertEqual(remote[-2:], ['--', f'raspi-release-{RUN_ID}.service'])

    def test_show_distinguishes_absent_unit_from_transport_failure(self):
        missing = FakeRunner(CommandResult((), 1, '', f'Unit raspi-release-{RUN_ID}.service could not be found.'))
        missing_backend, _ = self.backend(missing)
        unreachable = FakeRunner(CommandResult((), 255, '', 'ssh: connect to host timed out'))
        unreachable_backend, _ = self.backend(unreachable)

        absent = missing_backend.show(RUN_ID)
        failed = unreachable_backend.show(RUN_ID)

        self.assertTrue(absent.reachable)
        self.assertEqual(absent.load_state, 'not-found')
        self.assertFalse(failed.reachable)
        self.assertIn('timed out', failed.error)

    def test_ssh_host_not_found_is_not_misreported_as_absent_unit(self):
        runner = FakeRunner(CommandResult((), 255, '', 'ssh: host not found'))
        backend, _ = self.backend(runner)

        observed = backend.show(RUN_ID)

        self.assertFalse(observed.reachable)
        self.assertIsNone(observed.load_state)
        self.assertIn('host not found', observed.error)

    def test_transport_failure_with_partial_not_found_output_is_fail_closed(self):
        runner = FakeRunner(CommandResult(
            (),
            255,
            'LoadState=not-found\n',
            'ssh: connection closed',
        ))
        backend, _ = self.backend(runner)

        observed = backend.show(RUN_ID)

        self.assertFalse(observed.reachable)
        self.assertIsNone(observed.load_state)
        self.assertIn('connection closed', observed.error)

    def test_generic_not_loaded_error_is_not_treated_as_absent_unit(self):
        unit = f'raspi-release-{RUN_ID}.service'
        runner = FakeRunner(CommandResult(
            (),
            1,
            '',
            f'Unit {unit} was not loaded because authorization failed',
        ))
        backend, _ = self.backend(runner)

        observed = backend.show(RUN_ID)

        self.assertFalse(observed.reachable)
        self.assertIsNone(observed.load_state)

    def test_signal_cancel_targets_only_systemd_main_process(self):
        backend, runner = self.backend()

        backend.signal_cancel(RUN_ID)

        remote = self.remote_argv(runner)
        self.assertEqual(remote, [
            '/usr/bin/sudo',
            '-n',
            '/usr/bin/systemctl',
            'kill',
            '--kill-whom=main',
            '--signal=SIGUSR1',
            '--',
            f'raspi-release-{RUN_ID}.service',
        ])
        self.assertNotIn('stop', remote)

    def test_start_show_and_cancel_share_noninteractive_system_manager_contract(self):
        backend, runner = self.backend()

        backend.start(self.spec(), wait=False)
        backend.show(RUN_ID)
        backend.signal_cancel(RUN_ID)

        remote_commands = [shlex.split(call['argv'][-1]) for call in runner.calls]
        self.assertEqual(
            [command[:2] for command in remote_commands],
            [['/usr/bin/sudo', '-n']] * 3,
        )
        self.assertEqual(
            [command[2] for command in remote_commands],
            ['/usr/bin/systemd-run', '/usr/bin/systemctl', '/usr/bin/systemctl'],
        )

    def test_custom_execution_identity_is_explicit_and_validated(self):
        runner = FakeRunner()
        transport = SshTransport('release@pi5.example', runner)
        backend = SystemdBackend(
            transport,
            remote_user='release-agent',
            remote_home=PurePosixPath('/srv/release-agent'),
            bootstrap_source='TRUSTED_BOOTSTRAP_SOURCE',
        )

        backend.start(self.spec(), wait=False)

        remote = self.remote_argv(runner)
        self.assertIn('--uid=release-agent', remote)
        self.assertIn('--setenv=HOME=/srv/release-agent', remote)
        self.assertIn('--setenv=USER=release-agent', remote)
        with self.assertRaisesRegex(ValueError, 'identity'):
            SystemdBackend(
                transport,
                remote_user='root;touch /tmp/bad',
                bootstrap_source='TRUSTED_BOOTSTRAP_SOURCE',
            )

    def test_invalid_run_id_is_rejected_before_ssh_or_path_construction(self):
        backend, runner = self.backend()

        for value in ('../escape', 'run.service', '--option', 'run@1'):
            with self.subTest(value=value), self.assertRaises(ValueError):
                backend.show(value)
        self.assertEqual(runner.calls, [])

    def test_state_and_control_paths_are_derived_only_from_validated_id(self):
        backend, _ = self.backend()

        self.assertEqual(
            str(backend.release_state_path(RUN_ID)),
            f'/opt/RaspberryPiSystem_002/logs/deploy/release-runs/{RUN_ID}.json',
        )
        self.assertEqual(
            str(backend.control_path(RUN_ID)),
            f'/opt/RaspberryPiSystem_002/logs/deploy/release-runs/{RUN_ID}.control.json',
        )

    def test_ssh_transport_quotes_every_remote_argument_once(self):
        runner = FakeRunner()
        transport = SshTransport('operator@pi5.example', runner)
        remote = ('command', 'space value', "quote'value", 'semi;colon', 'line\nbreak')

        transport.run(remote)

        local = runner.calls[0]['argv']
        self.assertEqual(local[:4], ('ssh', '--', 'operator@pi5.example', local[-1]))
        self.assertEqual(tuple(shlex.split(local[-1])), remote)

    def test_launch_validation_fails_before_ssh(self):
        backend, runner = self.backend()
        invalid_specs = (
            (self.spec(run_id='run-1'), 'new run ID'),
            (self.spec(reason='unused'), 'only valid with emergency'),
            (self.spec(inventory='x' * 1001), 'inventory'),
        )

        for invalid, message in invalid_specs:
            with self.subTest(message=message), self.assertRaisesRegex(ValueError, message):
                backend.start(invalid, wait=False)
        self.assertEqual(runner.calls, [])

    def test_current_runner_matches_systemd_invocation_and_main_pid(self):
        invocation_id = 'a' * 32
        runner = FakeRunner(
            CommandResult(
                (),
                0,
                f'InvocationID={invocation_id}\nMainPID=4321\n',
                '',
            )
        )

        validate_current_execution_identity(
            RUN_ID, invocation_id, runner=runner, pid=4321
        )

        self.assertEqual(
            runner.calls[0]['argv'][:3],
            ('/usr/bin/sudo', '-n', '/usr/bin/systemctl'),
        )
        self.assertEqual(runner.calls[0]['argv'][-1], f'raspi-release-{RUN_ID}.service')

    def test_forged_systemd_identity_is_rejected(self):
        invocation_id = 'a' * 32
        mismatches = (
            f'InvocationID={"b" * 32}\nMainPID=4321\n',
            f'InvocationID={invocation_id}\nMainPID=9999\n',
        )
        for output in mismatches:
            with self.subTest(output=output):
                runner = FakeRunner(CommandResult((), 0, output, ''))
                with self.assertRaisesRegex(RuntimeError, 'systemd|main process'):
                    validate_current_execution_identity(
                        RUN_ID, invocation_id, runner=runner, pid=4321
                    )


if __name__ == '__main__':
    unittest.main()
