import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


SCRIPT = Path(__file__).parents[1] / 'recover-pi4.py'
SPEC = importlib.util.spec_from_file_location('recover_pi4', SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


SHA = 'a' * 40
PREVIOUS_SHA = 'b' * 40
TIMESTAMP = '2026-07-15T00:00:00Z'


def inventory_payload(
    *, endpoint='100.80.10.20', target='raspi4-demo', barcode=False,
    server='raspberrypi5'
):
    return {
        'server': {'hosts': [server]},
        'kiosk': {'hosts': [target]},
        '_meta': {'hostvars': {
            server: {'status_agent_client_id': 'raspberrypi5-server'},
            target: {
                'ansible_host': endpoint,
                'ansible_user': 'demo-user',
                'tailscale_enabled': True,
                'manage_kiosk_browser': True,
                'pi4_recovery_enabled': True,
                'status_agent_client_id': 'demo-status-client',
                'status_agent_client_key': 'status-key-not-written',
                'nfc_agent_client_id': 'demo-nfc-client',
                'nfc_agent_client_secret': 'nfc-secret-not-written',
                'kiosk_url': 'https://100.106.158.2/kiosk?clientKey=status-key-not-written',
                'barcode_agent_enabled': barcode,
            },
        }},
    }


def bluegreen_status(*, sha=SHA, consistent=True, active_image_suffix='0123456789ab'):
    candidate = {
        'api': f'registry.example/api:{sha}-{active_image_suffix}',
        'web': f'registry.example/web:{sha}-{active_image_suffix}',
    }
    return {
        'runtimeStatus': 'consistent' if consistent else 'stale',
        'activeSlot': 'blue',
        'gateway': {'mode': 'application', 'slot': 'blue'},
        'slots': {
            'blue': {'images': candidate},
            'green': {'images': {'api': 'registry.example/api:old', 'web': 'registry.example/web:old'}},
        },
    }


def host_record(role, sha, run_id='seed-run'):
    record = {
        'role': role,
        'desiredSha': sha,
        'currentSha': sha,
        'previousSha': None,
        'evidence': 'verified',
        'verifiedAt': TIMESTAMP,
        'lastRunId': run_id,
    }
    if role == 'server':
        record.update({
            'activeSlot': 'blue',
            'apiImage': f'registry.example/api:{sha}-0123456789ab',
            'webImage': f'registry.example/web:{sha}-0123456789ab',
            'configDigest': 'sha256:' + 'c' * 64,
            'migrationDigest': 'sha256:' + 'd' * 64,
        })
    return record


def fleet_payload(*, active_run=None, target_sha=None):
    fleet = {'raspberrypi5': host_record('server', SHA)}
    if target_sha is not None:
        fleet['raspi4-demo'] = host_record('kiosk', target_sha)
    return {
        'generation': 1,
        'activeRun': active_run,
        'lastRun': None,
        'fleet': fleet,
    }


def write_fleet_state(project, payload):
    path = project / 'logs/deploy/fleet-release-state.json'
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding='utf-8')
    return path


class FakeRunner:
    def __init__(
        self,
        project,
        inventory,
        status,
        *,
        fail_bootstrap=False,
        fail_service=False,
        remote_sha=SHA,
        require_fleet_lock=False,
    ):
        self.project = project
        self.inventory = inventory
        self.status = status
        self.fail_bootstrap = fail_bootstrap
        self.fail_service = fail_service
        self.remote_sha = remote_sha
        self.require_fleet_lock = require_fleet_lock
        self.commands = []

    def run(self, command, *, capture=True, cwd=None):
        if self.require_fleet_lock:
            contender = MODULE.FleetLock(
                self.project / 'logs/deploy/fleet-release-state.lock',
                blocking=False,
            )
            try:
                contender.acquire()
            except MODULE.FleetLockBusyError:
                pass
            else:
                contender.release()
                raise AssertionError('recovery command ran without the fleet lock')
            compatibility = MODULE.RunLock(
                self.project / '.git/rolling-release.lock', blocking=False
            )
            try:
                compatibility.acquire()
            except MODULE.RunLockBusyError:
                pass
            else:
                compatibility.release()
                raise AssertionError(
                    'recovery command ran without the compatibility lock'
                )
        self.commands.append(command)
        if command[0] == 'ansible-inventory':
            return json.dumps(self.inventory)
        if command[0].endswith('pi5-blue-green.sh'):
            return json.dumps(self.status)
        if command[0] == 'ssh':
            if 'rev-parse' in command:
                return self.remote_sha + '\n'
            return 'demo-user\n'
        if command[0] == 'ansible' and any('systemctl is-active' in value for value in command):
            if self.fail_service:
                raise subprocess.CalledProcessError(3, command)
            return 'active\nactive\n'
        if command[0] == 'ansible-playbook' and str(command[3]).endswith('recover-pi4.yml'):
            if self.fail_bootstrap:
                raise subprocess.CalledProcessError(2, command)
            result_argument = next(value for value in command if value.startswith('recovery_result_path='))
            result_path = Path(result_argument.split('=', 1)[1])
            result_path.parent.mkdir(parents=True, exist_ok=True)
            result_path.write_text(json.dumps({
                'target': 'raspi4-demo',
                'tailscaleIpv4': '100.100.5.6',
                'releaseSha': SHA,
            }), encoding='utf-8')
            return ''
        return ''


class RecoverPi4Test(unittest.TestCase):
    def make_project(self):
        temporary = tempfile.TemporaryDirectory()
        project = Path(temporary.name)
        marker = project / 'logs/deploy/pi5-release-current.json'
        marker.parent.mkdir(parents=True)
        marker.write_text(json.dumps({
            'sha': SHA,
            'candidate': bluegreen_status()['slots']['blue']['images'],
        }), encoding='utf-8')
        inventory_path = project / 'infrastructure/ansible/inventory.yml'
        inventory_path.parent.mkdir(parents=True)
        inventory_path.write_text('all: {}\n', encoding='utf-8')
        write_fleet_state(project, fleet_payload())
        return temporary, project, inventory_path

    def coordinator(self, project, inventory_path, runner):
        return MODULE.RecoveryCoordinator(
            project=project,
            inventory=inventory_path,
            runner=runner,
            device_model_reader=lambda: 'Raspberry Pi 5 Model B Rev 1.0',
            tcp_reachable=lambda _host, _port: False,
            server_client_id_reader=lambda: 'raspberrypi5-server',
        )

    def test_plan_requires_approved_fleet_seed_instead_of_compat_marker(self):
        temporary, project, inventory_path = self.make_project()
        self.addCleanup(temporary.cleanup)
        runner = FakeRunner(project, inventory_payload(barcode=True), bluegreen_status())

        (project / 'logs/deploy/fleet-release-state.json').unlink()
        with self.assertRaisesRegex(MODULE.RecoveryError, 'approved full-fleet release'):
            self.coordinator(project, inventory_path, runner).build_plan(
                'raspi4-demo', '192.168.10.55'
            )
        self.assertFalse((project / 'logs/deploy/fleet-release-state.lock').exists())

    def test_wrong_site_with_stale_active_run_changes_no_authoritative_state(self):
        temporary, project, inventory_path = self.make_project()
        self.addCleanup(temporary.cleanup)
        payload = fleet_payload(active_run={
            'runId': 'stale-release',
            'status': 'running',
            'desiredSha': PREVIOUS_SHA,
            'inventory': str(inventory_path),
            'startedAt': TIMESTAMP,
            'kind': 'release',
        })
        state_path = write_fleet_state(project, payload)
        before = state_path.read_bytes()
        runner = FakeRunner(project, inventory_payload(), bluegreen_status())
        coordinator = MODULE.RecoveryCoordinator(
            project=project,
            inventory=inventory_path,
            runner=runner,
            device_model_reader=lambda: 'Raspberry Pi 5 Model B Rev 1.0',
            tcp_reachable=lambda _host, _port: False,
            server_client_id_reader=lambda: 'talkplaza-pi5-server',
        )

        with self.assertRaisesRegex(MODULE.RecoveryError, 'does not match'):
            coordinator.execute(
                'raspi4-demo',
                '192.168.10.55',
                'wrong site',
                'pi4-recovery-wrong-site',
            )

        self.assertEqual(state_path.read_bytes(), before)
        self.assertEqual(
            [command[0] for command in runner.commands],
            ['ansible-inventory'],
        )
        self.assertFalse((project / 'logs/recovery/pi4-recovery-wrong-site.json').exists())
        self.assertFalse(coordinator.runtime_override_path('raspi4-demo').exists())

    def test_talkplaza_style_kiosk_fails_before_mutation_without_capability(self):
        temporary, project, inventory_path = self.make_project()
        self.addCleanup(temporary.cleanup)
        inventory = inventory_payload(target='talkplaza-pi4')
        inventory['_meta']['hostvars']['talkplaza-pi4'].update({
            'pi4_recovery_enabled': False,
            'tailscale_enabled': False,
        })
        runner = FakeRunner(project, inventory, bluegreen_status())

        with self.assertRaisesRegex(MODULE.RecoveryError, 'does not enable'):
            self.coordinator(project, inventory_path, runner).build_plan(
                'talkplaza-pi4', '192.168.10.55'
            )

        self.assertEqual([command[0] for command in runner.commands], ['ansible-inventory'])

    def test_plan_prefers_verified_fleet_server_over_compat_marker(self):
        temporary, project, inventory_path = self.make_project()
        self.addCleanup(temporary.cleanup)
        marker = project / 'logs/deploy/pi5-release-current.json'
        marker.write_text(json.dumps({
            'sha': PREVIOUS_SHA,
            'candidate': bluegreen_status(sha=PREVIOUS_SHA)['slots']['blue']['images'],
        }), encoding='utf-8')
        write_fleet_state(project, fleet_payload())
        runner = FakeRunner(project, inventory_payload(), bluegreen_status())

        plan = self.coordinator(project, inventory_path, runner).build_plan(
            'raspi4-demo', '192.168.10.55'
        )

        self.assertEqual(plan.release.sha, SHA)
        self.assertEqual(plan.release.source, 'fleet-state')
        self.assertFalse((project / 'logs/deploy/fleet-release-state.lock').exists())

    def test_plan_never_replaces_unknown_fleet_server_with_compat_marker(self):
        temporary, project, inventory_path = self.make_project()
        self.addCleanup(temporary.cleanup)
        payload = fleet_payload()
        payload['fleet']['raspberrypi5'].update({
            'evidence': 'unknown',
            'verifiedAt': None,
            'activeSlot': None,
            'apiImage': None,
            'webImage': None,
            'configDigest': None,
            'migrationDigest': None,
        })
        write_fleet_state(project, payload)
        runner = FakeRunner(project, inventory_payload(), bluegreen_status())

        with self.assertRaisesRegex(MODULE.RecoveryError, 'verified inventory server'):
            self.coordinator(project, inventory_path, runner).build_plan(
                'raspi4-demo', '192.168.10.55'
            )

    def test_plan_rejects_old_verified_and_new_unknown_server_authorities(self):
        temporary, project, inventory_path = self.make_project()
        self.addCleanup(temporary.cleanup)
        payload = fleet_payload()
        payload['fleet']['new-pi5'] = {
            **host_record('server', SHA),
            'evidence': 'unknown',
            'verifiedAt': None,
            'activeSlot': None,
            'apiImage': None,
            'webImage': None,
            'configDigest': None,
            'migrationDigest': None,
        }
        write_fleet_state(project, payload)
        runner = FakeRunner(
            project,
            inventory_payload(server='new-pi5'),
            bluegreen_status(),
        )

        with self.assertRaisesRegex(MODULE.RecoveryError, 'verified inventory server'):
            self.coordinator(project, inventory_path, runner).build_plan(
                'raspi4-demo', '192.168.10.55'
            )

    def test_plan_uses_verified_inventory_server_despite_stale_server_record(self):
        temporary, project, inventory_path = self.make_project()
        self.addCleanup(temporary.cleanup)
        payload = fleet_payload()
        payload['fleet']['old-pi5'] = host_record('server', PREVIOUS_SHA)
        write_fleet_state(project, payload)
        runner = FakeRunner(project, inventory_payload(), bluegreen_status())

        plan = self.coordinator(project, inventory_path, runner).build_plan(
            'raspi4-demo', '192.168.10.55'
        )

        self.assertEqual(plan.release.sha, SHA)
        self.assertEqual(plan.release.source, 'fleet-state')

    def test_plan_accepts_run_scoped_active_pi5_image_tags(self):
        temporary, project, inventory_path = self.make_project()
        self.addCleanup(temporary.cleanup)
        status = bluegreen_status(
            active_image_suffix='0123456789ab-' + '9' * 64
        )
        payload = fleet_payload()
        payload['fleet']['raspberrypi5']['apiImage'] = (
            status['slots']['blue']['images']['api']
        )
        payload['fleet']['raspberrypi5']['webImage'] = (
            status['slots']['blue']['images']['web']
        )
        write_fleet_state(project, payload)
        runner = FakeRunner(project, inventory_payload(), status)

        plan = self.coordinator(project, inventory_path, runner).build_plan(
            'raspi4-demo', '192.168.10.55'
        )

        self.assertEqual(plan.release.sha, SHA)

    def test_plan_rejects_host_without_explicit_recovery_capability(self):
        temporary, project, inventory_path = self.make_project()
        self.addCleanup(temporary.cleanup)
        inventory = inventory_payload(target='raspberrypi3')
        inventory['kiosk']['hosts'] = ['raspberrypi3']
        inventory['_meta']['hostvars']['raspberrypi3'].pop('pi4_recovery_enabled')
        runner = FakeRunner(project, inventory, bluegreen_status())

        with self.assertRaisesRegex(MODULE.RecoveryError, 'does not enable'):
            self.coordinator(project, inventory_path, runner).build_plan('raspberrypi3', '192.168.10.55')

    def test_plan_fails_closed_when_active_slot_images_do_not_match_marker(self):
        temporary, project, inventory_path = self.make_project()
        self.addCleanup(temporary.cleanup)
        stale = bluegreen_status(active_image_suffix='abcdefabcdef')
        runner = FakeRunner(project, inventory_payload(), stale)

        with self.assertRaisesRegex(MODULE.RecoveryError, 'does not prove'):
            self.coordinator(project, inventory_path, runner).build_plan('raspi4-demo', '192.168.10.55')

    def test_runtime_override_keeps_original_endpoint_for_a_retry(self):
        temporary, project, inventory_path = self.make_project()
        self.addCleanup(temporary.cleanup)
        runner = FakeRunner(project, inventory_payload(endpoint='100.100.5.6'), bluegreen_status())
        coordinator = self.coordinator(project, inventory_path, runner)
        initial_plan = MODULE.RecoveryPlan(
            target=MODULE.Target('raspi4-demo', 'demo-user', '100.80.10.20', 'client', True, False, 'https://example/kiosk'),
            bootstrap_host='192.168.10.55',
            release=MODULE.Release(SHA, 'blue'),
            runtime_override_exists=False,
        )
        coordinator.write_runtime_override(initial_plan, 'pi4-recovery-test', '100.100.5.6')

        target, override_exists = coordinator.resolve_target('raspi4-demo', runner.inventory)

        self.assertTrue(override_exists)
        self.assertEqual(target.original_host, '100.80.10.20')
        payload = json.loads(coordinator.runtime_override_path('raspi4-demo').read_text(encoding='utf-8'))
        self.assertEqual(payload['ansible_host'], '100.100.5.6')
        self.assertNotIn('secret', json.dumps(payload).lower())

    def test_failed_bootstrap_never_writes_runtime_override(self):
        temporary, project, inventory_path = self.make_project()
        self.addCleanup(temporary.cleanup)
        runner = FakeRunner(project, inventory_payload(), bluegreen_status(), fail_bootstrap=True)
        coordinator = self.coordinator(project, inventory_path, runner)
        fleet_before_legacy_failure = []
        original_transition = MODULE.RecoveryState.transition

        def observe_terminal_transition(recovery_state, phase, **values):
            if phase == 'failed':
                fleet_before_legacy_failure.append(json.loads(
                    (project / 'logs/deploy/fleet-release-state.json').read_text(encoding='utf-8')
                ))
            return original_transition(recovery_state, phase, **values)

        with mock.patch.object(MODULE.RecoveryState, 'transition', new=observe_terminal_transition):
            with self.assertRaisesRegex(MODULE.RecoveryError, 'recovery command failed'):
                coordinator.execute('raspi4-demo', '192.168.10.55', 'SD failure', 'pi4-recovery-fail')

        self.assertFalse(coordinator.runtime_override_path('raspi4-demo').exists())
        state = json.loads((project / 'logs/recovery/pi4-recovery-fail.json').read_text(encoding='utf-8'))
        self.assertEqual(state['phase'], 'failed')
        self.assertEqual(len(fleet_before_legacy_failure), 1)
        fleet = fleet_before_legacy_failure[0]
        self.assertIsNone(fleet['activeRun'])
        self.assertEqual(fleet['lastRun']['runId'], 'pi4-recovery-fail')
        self.assertEqual(fleet['lastRun']['status'], 'failed')
        self.assertEqual(fleet['fleet']['raspi4-demo']['evidence'], 'unknown')

    def test_online_previous_endpoint_blocks_recovery_before_bootstrap(self):
        temporary, project, inventory_path = self.make_project()
        self.addCleanup(temporary.cleanup)
        runner = FakeRunner(project, inventory_payload(), bluegreen_status())
        coordinator = MODULE.RecoveryCoordinator(
            project=project,
            inventory=inventory_path,
            runner=runner,
            device_model_reader=lambda: 'Raspberry Pi 5 Model B Rev 1.0',
            tcp_reachable=lambda _host, _port: True,
            server_client_id_reader=lambda: 'raspberrypi5-server',
        )

        with self.assertRaisesRegex(MODULE.RecoveryError, 'still accepts TCP/22'):
            coordinator.execute('raspi4-demo', '192.168.10.55', 'SD failure', 'pi4-recovery-online-old')

        self.assertFalse(coordinator.runtime_override_path('raspi4-demo').exists())
        self.assertFalse(any(command[0] == 'ansible-playbook' for command in runner.commands))

    def test_release_resolution_failure_writes_neither_fleet_nor_legacy_state(self):
        temporary, project, inventory_path = self.make_project()
        self.addCleanup(temporary.cleanup)
        (project / 'logs/deploy/fleet-release-state.json').unlink()
        runner = FakeRunner(project, inventory_payload(), bluegreen_status())
        coordinator = self.coordinator(project, inventory_path, runner)

        with self.assertRaisesRegex(MODULE.RecoveryError, 'approved full-fleet release'):
            coordinator.execute('raspi4-demo', '192.168.10.55', 'SD failure', 'pi4-recovery-preflight-fail')

        self.assertFalse((project / 'logs/deploy/fleet-release-state.json').exists())
        self.assertFalse((project / 'logs/recovery/pi4-recovery-preflight-fail.json').exists())

    def test_pi5_hardware_guard_rejects_non_pi5_runner(self):
        temporary, project, inventory_path = self.make_project()
        self.addCleanup(temporary.cleanup)
        runner = FakeRunner(project, inventory_payload(), bluegreen_status())
        coordinator = MODULE.RecoveryCoordinator(
            project=project,
            inventory=inventory_path,
            runner=runner,
            device_model_reader=lambda: 'MacBook Pro',
            tcp_reachable=lambda _host, _port: False,
        )

        with self.assertRaisesRegex(MODULE.RecoveryError, 'must run on Raspberry Pi 5'):
            coordinator.assert_pi5()

    def test_successful_recovery_writes_local_override_then_uses_standard_ansible(self):
        temporary, project, inventory_path = self.make_project()
        self.addCleanup(temporary.cleanup)
        runner = FakeRunner(
            project,
            inventory_payload(),
            bluegreen_status(),
            require_fleet_lock=True,
        )
        coordinator = self.coordinator(project, inventory_path, runner)
        fleet_before_legacy_completion = []
        original_transition = MODULE.RecoveryState.transition

        def observe_terminal_transition(recovery_state, phase, **values):
            if phase == 'completed':
                fleet_before_legacy_completion.append(json.loads(
                    (project / 'logs/deploy/fleet-release-state.json').read_text(encoding='utf-8')
                ))
            return original_transition(recovery_state, phase, **values)

        with mock.patch.object(MODULE.RecoveryState, 'transition', new=observe_terminal_transition):
            state = coordinator.execute(
                'raspi4-demo', '192.168.10.55', 'SD failure', 'pi4-recovery-ok'
            )

        self.assertEqual(state.payload['phase'], 'completed')
        override = json.loads(coordinator.runtime_override_path('raspi4-demo').read_text(encoding='utf-8'))
        self.assertEqual(override['ansible_host'], '100.100.5.6')
        self.assertTrue(any(command[0] == 'ansible' and command[-2:] == ['-m', 'ping'] for command in runner.commands))
        self.assertTrue(any(command[0] == 'ansible-playbook' and str(command[3]).endswith('recover-pi4-verify.yml') for command in runner.commands))
        self.assertTrue(any(command[0] == 'ssh' and 'rev-parse' in command for command in runner.commands))
        service_commands = [
            command
            for command in runner.commands
            if command[0] == 'ansible'
            and any('systemctl is-active' in value for value in command)
        ]
        self.assertEqual(
            [command[-1] for command in service_commands],
            [
                'systemctl is-active --quiet kiosk-browser.service',
                'systemctl is-active --quiet status-agent.timer',
            ],
        )
        self.assertEqual(len(fleet_before_legacy_completion), 1)
        fleet = fleet_before_legacy_completion[0]
        self.assertIsNone(fleet['activeRun'])
        self.assertEqual(fleet['lastRun']['status'], 'success')
        self.assertEqual(fleet['fleet']['raspi4-demo']['evidence'], 'verified')
        self.assertEqual(fleet['fleet']['raspi4-demo']['currentSha'], SHA)

    def test_run_fails_before_preflight_when_common_fleet_lock_is_busy(self):
        temporary, project, inventory_path = self.make_project()
        self.addCleanup(temporary.cleanup)
        runner = FakeRunner(project, inventory_payload(), bluegreen_status())
        coordinator = self.coordinator(project, inventory_path, runner)
        lock = MODULE.FleetLock(
            project / 'logs/deploy/fleet-release-state.lock',
            blocking=False,
        )
        lock.acquire()
        self.addCleanup(lock.release)

        with self.assertRaisesRegex(MODULE.RecoveryError, 'already running'):
            coordinator.execute(
                'raspi4-demo', '192.168.10.55', 'SD failure', 'pi4-recovery-busy'
            )

        self.assertEqual(runner.commands, [])
        self.assertFalse((project / 'logs/recovery/pi4-recovery-busy.json').exists())
        self.assertTrue((project / 'logs/deploy/fleet-release-state.json').exists())

    def test_run_honours_the_compatibility_lock_during_migration(self):
        temporary, project, inventory_path = self.make_project()
        self.addCleanup(temporary.cleanup)
        runner = FakeRunner(project, inventory_payload(), bluegreen_status())
        coordinator = self.coordinator(project, inventory_path, runner)
        compatibility = MODULE.RunLock(
            project / '.git/rolling-release.lock', blocking=False
        )
        compatibility.acquire()
        self.addCleanup(compatibility.release)

        with self.assertRaisesRegex(MODULE.RecoveryError, 'compatibility rolling release'):
            coordinator.execute(
                'raspi4-demo',
                '192.168.10.55',
                'SD failure',
                'pi4-recovery-compat-busy',
            )

        self.assertEqual(runner.commands, [])
        self.assertFalse(
            (project / 'logs/recovery/pi4-recovery-compat-busy.json').exists()
        )
        self.assertTrue((project / 'logs/deploy/fleet-release-state.json').exists())

    def test_stale_run_is_abandoned_and_target_is_unknown_before_legacy_state(self):
        temporary, project, inventory_path = self.make_project()
        self.addCleanup(temporary.cleanup)
        stale_run = {
            'runId': 'stale-release',
            'status': 'running',
            'desiredSha': PREVIOUS_SHA,
            'inventory': str(inventory_path),
            'startedAt': TIMESTAMP,
            'kind': 'release',
        }
        write_fleet_state(
            project,
            fleet_payload(active_run=stale_run, target_sha=PREVIOUS_SHA),
        )
        runner = FakeRunner(project, inventory_payload(), bluegreen_status())
        observed_before_legacy = []

        class InspectingCoordinator(MODULE.RecoveryCoordinator):
            def create_state(self, target_name, bootstrap_host, run_id, reason):
                observed_before_legacy.append(json.loads(
                    self.fleet_state_path().read_text(encoding='utf-8')
                ))
                return super().create_state(target_name, bootstrap_host, run_id, reason)

        coordinator = InspectingCoordinator(
            project=project,
            inventory=inventory_path,
            runner=runner,
            device_model_reader=lambda: 'Raspberry Pi 5 Model B Rev 1.0',
            tcp_reachable=lambda _host, _port: False,
            server_client_id_reader=lambda: 'raspberrypi5-server',
        )

        coordinator.execute(
            'raspi4-demo', '192.168.10.55', 'SD failure', 'pi4-recovery-stale'
        )

        self.assertEqual(len(observed_before_legacy), 1)
        before = observed_before_legacy[0]
        self.assertEqual(before['lastRun']['runId'], 'stale-release')
        self.assertEqual(before['lastRun']['status'], 'interrupted')
        self.assertEqual(before['activeRun']['runId'], 'pi4-recovery-stale')
        self.assertEqual(before['activeRun']['kind'], 'pi4-recovery')
        target = before['fleet']['raspi4-demo']
        self.assertEqual(target['evidence'], 'unknown')
        self.assertIsNone(target['currentSha'])
        self.assertEqual(target['previousSha'], PREVIOUS_SHA)
        final = json.loads(
            (project / 'logs/deploy/fleet-release-state.json').read_text(encoding='utf-8')
        )
        self.assertEqual(final['lastRun']['runId'], 'pi4-recovery-stale')
        self.assertEqual(final['lastRun']['status'], 'success')
        self.assertEqual(final['fleet']['raspi4-demo']['previousSha'], PREVIOUS_SHA)

    def test_remote_head_mismatch_keeps_target_unknown_and_fails_run(self):
        temporary, project, inventory_path = self.make_project()
        self.addCleanup(temporary.cleanup)
        runner = FakeRunner(
            project,
            inventory_payload(),
            bluegreen_status(),
            remote_sha=PREVIOUS_SHA,
        )
        coordinator = self.coordinator(project, inventory_path, runner)

        with self.assertRaisesRegex(MODULE.RecoveryError, 'HEAD does not match'):
            coordinator.execute(
                'raspi4-demo', '192.168.10.55', 'SD failure', 'pi4-recovery-head'
            )

        fleet = json.loads(
            (project / 'logs/deploy/fleet-release-state.json').read_text(encoding='utf-8')
        )
        self.assertEqual(fleet['lastRun']['status'], 'failed')
        self.assertEqual(fleet['fleet']['raspi4-demo']['evidence'], 'unknown')
        self.assertIsNone(fleet['fleet']['raspi4-demo']['currentSha'])

    def test_service_failure_keeps_target_unknown_and_fails_run(self):
        temporary, project, inventory_path = self.make_project()
        self.addCleanup(temporary.cleanup)
        runner = FakeRunner(
            project,
            inventory_payload(),
            bluegreen_status(),
            fail_service=True,
        )
        coordinator = self.coordinator(project, inventory_path, runner)

        with self.assertRaisesRegex(MODULE.RecoveryError, 'recovery command failed'):
            coordinator.execute(
                'raspi4-demo', '192.168.10.55', 'SD failure', 'pi4-recovery-service'
            )

        fleet = json.loads(
            (project / 'logs/deploy/fleet-release-state.json').read_text(encoding='utf-8')
        )
        self.assertEqual(fleet['lastRun']['status'], 'failed')
        self.assertEqual(fleet['fleet']['raspi4-demo']['evidence'], 'unknown')

    def test_success_finalization_failure_demotes_fresh_evidence_to_unknown(self):
        temporary, project, inventory_path = self.make_project()
        self.addCleanup(temporary.cleanup)
        runner = FakeRunner(project, inventory_payload(), bluegreen_status())
        coordinator = self.coordinator(project, inventory_path, runner)
        original_finish = MODULE.FleetStateStore.finish_run

        def fail_success(store, run_id, status, **kwargs):
            if status == 'success':
                raise MODULE.FleetStateError('injected success finalization failure')
            return original_finish(store, run_id, status, **kwargs)

        with mock.patch.object(MODULE.FleetStateStore, 'finish_run', new=fail_success):
            with self.assertRaisesRegex(MODULE.RecoveryError, 'fleet release state update failed'):
                coordinator.execute(
                    'raspi4-demo',
                    '192.168.10.55',
                    'SD failure',
                    'pi4-recovery-finalize',
                )

        fleet = json.loads(
            (project / 'logs/deploy/fleet-release-state.json').read_text(encoding='utf-8')
        )
        self.assertEqual(fleet['lastRun']['status'], 'failed')
        self.assertEqual(fleet['fleet']['raspi4-demo']['evidence'], 'unknown')
        legacy = json.loads(
            (project / 'logs/recovery/pi4-recovery-finalize.json').read_text(encoding='utf-8')
        )
        self.assertEqual(legacy['phase'], 'failed')

    def test_corrupt_fleet_state_does_not_fall_back_to_compat_marker(self):
        temporary, project, inventory_path = self.make_project()
        self.addCleanup(temporary.cleanup)
        state_path = project / 'logs/deploy/fleet-release-state.json'
        state_path.write_text('{"generation": 1}', encoding='utf-8')
        runner = FakeRunner(project, inventory_payload(), bluegreen_status())

        with self.assertRaisesRegex(MODULE.RecoveryError, 'fleet release state'):
            self.coordinator(project, inventory_path, runner).build_plan(
                'raspi4-demo', '192.168.10.55'
            )

        self.assertFalse((project / 'logs/deploy/fleet-release-state.lock').exists())

    def test_redaction_removes_secret_value_from_state_message(self):
        self.assertNotIn('unwanted-value', MODULE.redact_error(RuntimeError('authkey=unwanted-value failed')))
        self.assertIn('authkey=<redacted>', MODULE.redact_error(RuntimeError('authkey=unwanted-value failed')))

    def test_ansible_host_vars_runtime_override_has_precedence(self):
        fixture = Path(__file__).parent / 'fixtures/recovery-runtime-override/inventory.yml'
        completed = subprocess.run(
            ['ansible-inventory', '-i', str(fixture), '--host', 'raspi4-recovery-precedence'],
            check=True,
            text=True,
            capture_output=True,
        )

        self.assertEqual(json.loads(completed.stdout)['ansible_host'], '100.100.5.6')


if __name__ == '__main__':
    unittest.main()
