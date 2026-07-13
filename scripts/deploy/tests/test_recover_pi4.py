import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).parents[1] / 'recover-pi4.py'
SPEC = importlib.util.spec_from_file_location('recover_pi4', SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


SHA = 'a' * 40


def inventory_payload(*, endpoint='100.80.10.20', target='raspi4-demo', barcode=False):
    return {
        'kiosk': {'hosts': [target]},
        '_meta': {'hostvars': {
            target: {
                'ansible_host': endpoint,
                'ansible_user': 'demo-user',
                'tailscale_enabled': True,
                'manage_kiosk_browser': True,
                'status_agent_client_id': 'demo-status-client',
                'status_agent_client_key': 'status-key-not-written',
                'nfc_agent_client_id': 'demo-nfc-client',
                'nfc_agent_client_secret': 'nfc-secret-not-written',
                'kiosk_url': 'https://100.106.158.2/kiosk?clientKey=status-key-not-written',
                'barcode_agent_enabled': barcode,
            },
        }},
    }


def bluegreen_status(*, consistent=True, active_image_suffix='0123456789ab'):
    candidate = {
        'api': f'registry.example/api:{SHA}-{active_image_suffix}',
        'web': f'registry.example/web:{SHA}-{active_image_suffix}',
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


class FakeRunner:
    def __init__(self, project, inventory, status, *, fail_bootstrap=False):
        self.project = project
        self.inventory = inventory
        self.status = status
        self.fail_bootstrap = fail_bootstrap
        self.commands = []

    def run(self, command, *, capture=True):
        self.commands.append(command)
        if command[0] == 'ansible-inventory':
            return json.dumps(self.inventory)
        if command[0].endswith('pi5-blue-green.sh'):
            return json.dumps(self.status)
        if command[0] == 'ssh':
            return 'demo-user\n'
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
        return temporary, project, inventory_path

    def coordinator(self, project, inventory_path, runner):
        return MODULE.RecoveryCoordinator(
            project=project,
            inventory=inventory_path,
            runner=runner,
            device_model_reader=lambda: 'Raspberry Pi 5 Model B Rev 1.0',
            tcp_reachable=lambda _host, _port: False,
        )

    def test_plan_resolves_existing_pi4_and_immutable_active_release(self):
        temporary, project, inventory_path = self.make_project()
        self.addCleanup(temporary.cleanup)
        runner = FakeRunner(project, inventory_payload(barcode=True), bluegreen_status())

        plan = self.coordinator(project, inventory_path, runner).build_plan('raspi4-demo', '192.168.10.55')

        self.assertEqual(plan.target.user, 'demo-user')
        self.assertEqual(plan.target.original_host, '100.80.10.20')
        self.assertTrue(plan.target.barcode_enabled)
        self.assertEqual(plan.release.sha, SHA)
        self.assertEqual(plan.release.active_slot, 'blue')
        self.assertNotIn('nfc-secret-not-written', json.dumps(plan.public_dict()))

    def test_plan_rejects_non_pi4_target(self):
        temporary, project, inventory_path = self.make_project()
        self.addCleanup(temporary.cleanup)
        inventory = inventory_payload(target='raspberrypi3')
        inventory['kiosk']['hosts'] = ['raspberrypi3']
        runner = FakeRunner(project, inventory, bluegreen_status())

        with self.assertRaisesRegex(MODULE.RecoveryError, 'not a supported'):
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

        with self.assertRaisesRegex(MODULE.RecoveryError, 'recovery command failed'):
            coordinator.execute('raspi4-demo', '192.168.10.55', 'SD failure', 'pi4-recovery-fail')

        self.assertFalse(coordinator.runtime_override_path('raspi4-demo').exists())
        state = json.loads((project / 'logs/recovery/pi4-recovery-fail.json').read_text(encoding='utf-8'))
        self.assertEqual(state['phase'], 'failed')

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
        )

        with self.assertRaisesRegex(MODULE.RecoveryError, 'still accepts TCP/22'):
            coordinator.execute('raspi4-demo', '192.168.10.55', 'SD failure', 'pi4-recovery-online-old')

        self.assertFalse(coordinator.runtime_override_path('raspi4-demo').exists())
        self.assertFalse(any(command[0] == 'ansible-playbook' for command in runner.commands))

    def test_preflight_failure_is_retained_in_secret_free_recovery_state(self):
        temporary, project, inventory_path = self.make_project()
        self.addCleanup(temporary.cleanup)
        (project / 'logs/deploy/pi5-release-current.json').unlink()
        runner = FakeRunner(project, inventory_payload(), bluegreen_status())
        coordinator = self.coordinator(project, inventory_path, runner)

        with self.assertRaisesRegex(MODULE.RecoveryError, 'release marker'):
            coordinator.execute('raspi4-demo', '192.168.10.55', 'SD failure', 'pi4-recovery-preflight-fail')

        state = json.loads((project / 'logs/recovery/pi4-recovery-preflight-fail.json').read_text(encoding='utf-8'))
        self.assertEqual(state['phase'], 'failed')
        self.assertNotIn('secret', json.dumps(state).lower())

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
        runner = FakeRunner(project, inventory_payload(), bluegreen_status())
        coordinator = self.coordinator(project, inventory_path, runner)

        state = coordinator.execute('raspi4-demo', '192.168.10.55', 'SD failure', 'pi4-recovery-ok')

        self.assertEqual(state.payload['phase'], 'completed')
        override = json.loads(coordinator.runtime_override_path('raspi4-demo').read_text(encoding='utf-8'))
        self.assertEqual(override['ansible_host'], '100.100.5.6')
        self.assertTrue(any(command[0] == 'ansible' and command[-2:] == ['-m', 'ping'] for command in runner.commands))
        self.assertTrue(any(command[0] == 'ansible-playbook' and str(command[3]).endswith('recover-pi4-verify.yml') for command in runner.commands))

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
