import base64
import hashlib
import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from dataclasses import asdict
from pathlib import Path
from unittest import mock

import yaml


SCRIPT = Path(__file__).parents[1] / 'recover-pi4.py'
SPEC = importlib.util.spec_from_file_location('recover_pi4', SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


SHA = 'a' * 40
PREVIOUS_SHA = 'b' * 40
TIMESTAMP = '2026-07-15T00:00:00Z'
LAN_TARGET = '192.168.10.55'
LAN_SERVER = '192.168.10.230'
BOOTSTRAP_HOSTNAME = 'fresh-pi4'
SSH_KEY_BLOB = base64.b64encode(b'recovery-test-ed25519-host-key').decode('ascii')
SSH_FINGERPRINT = 'SHA256:' + base64.b64encode(
    hashlib.sha256(base64.b64decode(SSH_KEY_BLOB)).digest()
).decode('ascii').rstrip('=')


def inventory_payload(
    *, endpoint='100.80.10.20', target='raspi4-demo', barcode=False,
    server='raspberrypi5'
):
    return {
        'server': {'hosts': [server]},
        'kiosk': {'hosts': [target]},
        '_meta': {'hostvars': {
            server: {
                'status_agent_client_id': 'raspberrypi5-server',
                'lan_endpoint': LAN_SERVER,
            },
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


def recovery_contract_payload(inventory, target):
    server_hosts = (inventory.get('server') or {}).get('hosts') or []
    hostvars = ((inventory.get('_meta') or {}).get('hostvars') or {})
    target_values = hostvars.get(target)
    if len(server_hosts) != 1 or not isinstance(target_values, dict):
        raise subprocess.CalledProcessError(2, ['ansible-playbook'])
    server = server_hosts[0]
    server_values = hostvars.get(server) or {}
    return {
        'schemaVersion': 3,
        'target': {
            'host': target,
            'inventoryEndpoint': target_values.get('ansible_host', ''),
            'user': target_values.get('ansible_user', ''),
            'statusAgentClientId': target_values.get('status_agent_client_id', ''),
            'recoveryEnabled': target_values.get('pi4_recovery_enabled') is True,
            'kioskManaged': target_values.get('manage_kiosk_browser') is True,
            'nfcEnabled': bool(target_values.get('nfc_agent_client_id')),
            'barcodeEnabled': target_values.get('barcode_agent_enabled') is True,
            'requiredSecretsConfigured': all(
                bool(target_values.get(key))
                for key in (
                    'status_agent_client_key',
                    'nfc_agent_client_secret',
                    'kiosk_url',
                )
            ),
        },
        'server': {
            'host': server,
            'statusAgentClientId': server_values.get('status_agent_client_id', ''),
        },
        'recoveryNetwork': {
            'mode': 'lan',
            'configured': bool(server_values.get('lan_endpoint')),
            'serverEndpoint': server_values.get('lan_endpoint', ''),
        },
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
        result_lan=LAN_TARGET,
        bootstrap_hostname=BOOTSTRAP_HOSTNAME,
        bootstrap_user='demo-user',
        ssh_key_blob=SSH_KEY_BLOB,
        ssh_keyscan_output=None,
    ):
        self.project = project
        self.inventory = inventory
        self.status = status
        self.fail_bootstrap = fail_bootstrap
        self.fail_service = fail_service
        self.remote_sha = remote_sha
        self.require_fleet_lock = require_fleet_lock
        self.result_lan = result_lan
        self.bootstrap_hostname = bootstrap_hostname
        self.bootstrap_user = bootstrap_user
        self.ssh_key_blob = ssh_key_blob
        self.ssh_keyscan_output = ssh_keyscan_output
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
        self.commands.append(command)
        if command[0] == 'ansible-inventory':
            return json.dumps(self.inventory)
        if command[0].endswith('pi5-blue-green.sh'):
            return json.dumps(self.status)
        if command[0] == 'ssh-keyscan':
            if self.ssh_keyscan_output is not None:
                return self.ssh_keyscan_output
            return f"{command[-1]} ssh-ed25519 {self.ssh_key_blob}\n"
        if command[0] == 'ssh':
            if any('rev-parse' in value for value in command):
                return self.remote_sha + '\n'
            return f'{self.bootstrap_user}\n{self.bootstrap_hostname}\n'
        if command[0] == 'ansible' and any('systemctl is-active' in value for value in command):
            if self.fail_service:
                raise subprocess.CalledProcessError(3, command)
            return 'active\nactive\n'
        if command[0] == 'ansible-playbook' and str(command[3]).endswith('resolve-pi4-recovery-contract.yml'):
            target = command[command.index('--limit') + 1]
            output_argument = next(
                value for value in command if value.startswith('recovery_contract_output_path=')
            )
            output_path = Path(output_argument.split('=', 1)[1])
            output_path.write_text(
                json.dumps(recovery_contract_payload(self.inventory, target)),
                encoding='utf-8',
            )
            return ''
        if command[0] == 'ansible-playbook' and str(command[3]).endswith('recover-pi4.yml'):
            if self.fail_bootstrap:
                raise subprocess.CalledProcessError(2, command)
            extra_vars = json.loads(command[command.index('-e') + 1])
            result_path = Path(extra_vars['recovery_result_path'])
            result_path.parent.mkdir(parents=True, exist_ok=True)
            result_path.write_text(json.dumps({
                'target': 'raspi4-demo',
                'lanIpv4': self.result_lan,
                'releaseSha': SHA,
            }), encoding='utf-8')
            return ''
        return ''


class RecoverPi4Test(unittest.TestCase):
    def make_project(self):
        temporary = tempfile.TemporaryDirectory()
        project = Path(temporary.name)
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

    def seed_runtime_override(
        self,
        coordinator,
        *,
        endpoint=LAN_TARGET,
        fingerprint=SSH_FINGERPRINT,
        original_endpoint='100.80.10.20',
    ):
        payload = {
            'ansible_host': endpoint,
            'network_mode': 'local',
            'tailscale_enabled': False,
            'pi4_recovery': {
                'run_id': 'pi4-recovery-previous',
                'recovered_at': TIMESTAMP,
                'release_sha': PREVIOUS_SHA,
                'original_ansible_host': original_endpoint,
                'previous_ansible_host': original_endpoint,
                'bootstrap_hostname': 'previous-pi4',
            },
        }
        if fingerprint is not None:
            payload['pi4_recovery']['ssh_host_key_fingerprint'] = fingerprint
        MODULE.atomic_json(coordinator.runtime_override_path('raspi4-demo'), payload)

    def test_plan_requires_approved_fleet_seed(self):
        temporary, project, inventory_path = self.make_project()
        self.addCleanup(temporary.cleanup)
        runner = FakeRunner(project, inventory_payload(barcode=True), bluegreen_status())

        (project / 'logs/deploy/fleet-release-state.json').unlink()
        with self.assertRaisesRegex(MODULE.RecoveryError, 'approved full-fleet release'):
            self.coordinator(project, inventory_path, runner).build_plan(
                'raspi4-demo', '192.168.10.55', BOOTSTRAP_HOSTNAME
            )
        self.assertFalse((project / 'logs/deploy/fleet-release-state.lock').exists())

    def test_production_inventory_enables_exactly_five_dynamic_lan_targets(self):
        project = Path(__file__).parents[3]
        inventory = yaml.safe_load(
            (project / 'infrastructure/ansible/inventory.yml').read_text(
                encoding='utf-8'
            )
        )
        hosts = inventory['all']['children']['clients']['children']['kiosk']['hosts']
        enabled = {
            host
            for host, values in hosts.items()
            if values.get('pi4_recovery_enabled') is True
        }

        self.assertEqual(
            enabled,
            {
                'raspberrypi4',
                'raspi4-robodrill01',
                'raspi4-fjv60-80',
                'raspi4-kensaku-stonebase01',
                'raspi4-sessaku-01',
            },
        )
        for values in hosts.values():
            self.assertNotIn('pi4_recovery_lan_endpoint', values)
        self.assertNotIn('pi4_recovery_enabled', hosts['raspi4-assembly-01'])

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
                BOOTSTRAP_HOSTNAME,
                SSH_FINGERPRINT,
                'wrong site',
                'pi4-recovery-wrong-site',
            )

        self.assertEqual(state_path.read_bytes(), before)
        self.assertEqual(
            [command[0] for command in runner.commands],
            ['ansible-playbook'],
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
                'talkplaza-pi4', '192.168.10.55', BOOTSTRAP_HOSTNAME
            )

        self.assertEqual([command[0] for command in runner.commands], ['ansible-playbook'])

    def test_plan_uses_verified_fleet_server(self):
        temporary, project, inventory_path = self.make_project()
        self.addCleanup(temporary.cleanup)
        write_fleet_state(project, fleet_payload())
        runner = FakeRunner(project, inventory_payload(), bluegreen_status())

        plan = self.coordinator(project, inventory_path, runner).build_plan(
            'raspi4-demo', '192.168.10.55', BOOTSTRAP_HOSTNAME
        )

        self.assertEqual(plan.release.sha, SHA)
        self.assertEqual(plan.release.source, 'fleet-state')
        self.assertFalse((project / 'logs/deploy/fleet-release-state.lock').exists())

    def test_plan_changes_no_fleet_state_runtime_override_or_recovery_log(self):
        temporary, project, inventory_path = self.make_project()
        self.addCleanup(temporary.cleanup)
        coordinator = self.coordinator(
            project,
            inventory_path,
            FakeRunner(project, inventory_payload(), bluegreen_status()),
        )
        fleet_path = project / 'logs/deploy/fleet-release-state.json'
        before = fleet_path.read_bytes()

        coordinator.build_plan('raspi4-demo', LAN_TARGET, BOOTSTRAP_HOSTNAME)

        self.assertEqual(fleet_path.read_bytes(), before)
        self.assertFalse(coordinator.runtime_override_path('raspi4-demo').exists())
        self.assertFalse((project / 'logs/recovery').exists())

    def test_plan_verifies_user_hostname_and_removes_temporary_known_hosts(self):
        temporary, project, inventory_path = self.make_project()
        self.addCleanup(temporary.cleanup)
        runner = FakeRunner(project, inventory_payload(), bluegreen_status())

        plan = self.coordinator(project, inventory_path, runner).build_plan(
            'raspi4-demo', LAN_TARGET, BOOTSTRAP_HOSTNAME
        )

        self.assertEqual(plan.bootstrap_identity.hostname, BOOTSTRAP_HOSTNAME)
        self.assertEqual(plan.bootstrap_identity.user, 'demo-user')
        self.assertEqual(
            plan.bootstrap_identity.ssh_host_key_fingerprint, SSH_FINGERPRINT
        )
        identity_command = next(
            command
            for command in runner.commands
            if command[0] == 'ssh' and 'id -un && hostname -s' in command
        )
        known_hosts_option = next(
            value
            for value in identity_command
            if value.startswith('UserKnownHostsFile=')
        )
        self.assertFalse(Path(known_hosts_option.split('=', 1)[1]).exists())
        self.assertIn('StrictHostKeyChecking=yes', identity_command)

    def test_plan_rejects_wrong_bootstrap_user_or_hostname(self):
        cases = (
            ({'bootstrap_user': 'other-user'}, 'unexpected user'),
            ({'bootstrap_hostname': 'other-pi4'}, 'different hostname'),
        )
        for runner_values, expected_error in cases:
            with self.subTest(runner_values=runner_values):
                temporary, project, inventory_path = self.make_project()
                self.addCleanup(temporary.cleanup)
                runner = FakeRunner(
                    project,
                    inventory_payload(),
                    bluegreen_status(),
                    **runner_values,
                )

                with self.assertRaisesRegex(MODULE.RecoveryError, expected_error):
                    self.coordinator(project, inventory_path, runner).build_plan(
                        'raspi4-demo', LAN_TARGET, BOOTSTRAP_HOSTNAME
                    )

    def test_plan_rejects_missing_or_multiple_ed25519_host_keys(self):
        other_key = base64.b64encode(b'other-ed25519-key').decode('ascii')
        scans = (
            '',
            (
                f'{LAN_TARGET} ssh-ed25519 {SSH_KEY_BLOB}\n'
                f'{LAN_TARGET} ssh-ed25519 {other_key}\n'
            ),
        )
        for scan in scans:
            with self.subTest(scan=scan):
                temporary, project, inventory_path = self.make_project()
                self.addCleanup(temporary.cleanup)
                runner = FakeRunner(
                    project,
                    inventory_payload(),
                    bluegreen_status(),
                    ssh_keyscan_output=scan,
                )

                with self.assertRaisesRegex(MODULE.RecoveryError, 'exactly one'):
                    self.coordinator(project, inventory_path, runner).build_plan(
                        'raspi4-demo', LAN_TARGET, BOOTSTRAP_HOSTNAME
                    )

    def test_run_rejects_host_key_different_from_reviewed_plan_before_mutation(self):
        temporary, project, inventory_path = self.make_project()
        self.addCleanup(temporary.cleanup)
        runner = FakeRunner(project, inventory_payload(), bluegreen_status())
        coordinator = self.coordinator(project, inventory_path, runner)
        fleet_path = coordinator.fleet_state_path()
        before = fleet_path.read_bytes()

        with self.assertRaisesRegex(MODULE.RecoveryError, 'changed after plan'):
            coordinator.execute(
                'raspi4-demo',
                LAN_TARGET,
                BOOTSTRAP_HOSTNAME,
                'SHA256:' + 'A' * 43,
                'SD failure',
                'pi4-recovery-key-drift',
            )

        self.assertEqual(fleet_path.read_bytes(), before)
        self.assertFalse(
            (project / 'logs/recovery/pi4-recovery-key-drift.json').exists()
        )
        self.assertFalse(coordinator.runtime_override_path('raspi4-demo').exists())

    def test_plan_rejects_unknown_fleet_server(self):
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
                'raspi4-demo', '192.168.10.55', BOOTSTRAP_HOSTNAME
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
                'raspi4-demo', '192.168.10.55', BOOTSTRAP_HOSTNAME
            )

    def test_plan_uses_verified_inventory_server_despite_stale_server_record(self):
        temporary, project, inventory_path = self.make_project()
        self.addCleanup(temporary.cleanup)
        payload = fleet_payload()
        payload['fleet']['old-pi5'] = host_record('server', PREVIOUS_SHA)
        write_fleet_state(project, payload)
        runner = FakeRunner(project, inventory_payload(), bluegreen_status())

        plan = self.coordinator(project, inventory_path, runner).build_plan(
            'raspi4-demo', '192.168.10.55', BOOTSTRAP_HOSTNAME
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
            'raspi4-demo', '192.168.10.55', BOOTSTRAP_HOSTNAME
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
            self.coordinator(project, inventory_path, runner).build_plan(
                'raspberrypi3', '192.168.10.55', BOOTSTRAP_HOSTNAME
            )

    def test_plan_keeps_assembly_disabled_until_hardware_acceptance(self):
        temporary, project, inventory_path = self.make_project()
        self.addCleanup(temporary.cleanup)
        inventory = inventory_payload(target='raspi4-assembly-01')
        inventory['_meta']['hostvars']['raspi4-assembly-01'][
            'pi4_recovery_enabled'
        ] = False
        runner = FakeRunner(project, inventory, bluegreen_status())

        with self.assertRaisesRegex(MODULE.RecoveryError, 'does not enable'):
            self.coordinator(project, inventory_path, runner).build_plan(
                'raspi4-assembly-01', '192.168.10.55', BOOTSTRAP_HOSTNAME
            )

    def test_plan_rejects_unresolved_or_non_ipv4_inventory_endpoint(self):
        for endpoint in ('{{ current_network.raspi4_ip }}', 'fd7a:115c:a1e0::1'):
            with self.subTest(endpoint=endpoint):
                temporary, project, inventory_path = self.make_project()
                self.addCleanup(temporary.cleanup)
                runner = FakeRunner(
                    project,
                    inventory_payload(endpoint=endpoint),
                    bluegreen_status(),
                )

                with self.assertRaisesRegex(MODULE.RecoveryError, 'IPv4 address'):
                    self.coordinator(project, inventory_path, runner).build_plan(
                        'raspi4-demo', '192.168.10.55', BOOTSTRAP_HOSTNAME
                    )

    def test_plan_rejects_non_rfc1918_recovery_endpoints(self):
        for endpoint in ('100.100.5.6', '8.8.8.8', '127.0.0.1', 'fd7a:115c:a1e0::1'):
            with self.subTest(endpoint=endpoint):
                temporary, project, inventory_path = self.make_project()
                self.addCleanup(temporary.cleanup)
                inventory = inventory_payload()
                runner = FakeRunner(project, inventory, bluegreen_status())

                with self.assertRaisesRegex(MODULE.RecoveryError, 'RFC1918'):
                    self.coordinator(project, inventory_path, runner).build_plan(
                        'raspi4-demo', endpoint, BOOTSTRAP_HOSTNAME
                    )

    def test_plan_accepts_dynamic_bootstrap_address_different_from_inventory(self):
        temporary, project, inventory_path = self.make_project()
        self.addCleanup(temporary.cleanup)
        runner = FakeRunner(project, inventory_payload(), bluegreen_status())

        plan = self.coordinator(project, inventory_path, runner).build_plan(
            'raspi4-demo', '192.168.10.56', BOOTSTRAP_HOSTNAME
        )

        self.assertEqual(plan.bootstrap_host, '192.168.10.56')
        self.assertEqual(plan.target.current_host, '100.80.10.20')

    def test_plan_rejects_missing_required_secret_readiness(self):
        temporary, project, inventory_path = self.make_project()
        self.addCleanup(temporary.cleanup)
        inventory = inventory_payload()
        inventory['_meta']['hostvars']['raspi4-demo']['nfc_agent_client_secret'] = ''
        runner = FakeRunner(project, inventory, bluegreen_status())

        with self.assertRaisesRegex(MODULE.RecoveryError, 'required recovery inventory secrets'):
            self.coordinator(project, inventory_path, runner).build_plan(
                'raspi4-demo', '192.168.10.55', BOOTSTRAP_HOSTNAME
            )

    def test_resolver_rejects_multiple_inventory_servers(self):
        temporary, project, inventory_path = self.make_project()
        self.addCleanup(temporary.cleanup)
        inventory = inventory_payload()
        inventory['server']['hosts'].append('second-pi5')
        inventory['_meta']['hostvars']['second-pi5'] = {
            'status_agent_client_id': 'second-pi5-server'
        }
        runner = FakeRunner(project, inventory, bluegreen_status())

        with self.assertRaisesRegex(MODULE.RecoveryError, 'could not resolve'):
            self.coordinator(project, inventory_path, runner).build_plan(
                'raspi4-demo', '192.168.10.55', BOOTSTRAP_HOSTNAME
            )

    def test_plan_fails_closed_when_active_slot_images_do_not_match_marker(self):
        temporary, project, inventory_path = self.make_project()
        self.addCleanup(temporary.cleanup)
        stale = bluegreen_status(active_image_suffix='abcdefabcdef')
        runner = FakeRunner(project, inventory_payload(), stale)

        with self.assertRaisesRegex(MODULE.RecoveryError, 'does not prove'):
            self.coordinator(project, inventory_path, runner).build_plan(
                'raspi4-demo', '192.168.10.55', BOOTSTRAP_HOSTNAME
            )

    def test_runtime_override_keeps_original_endpoint_for_a_retry(self):
        temporary, project, inventory_path = self.make_project()
        self.addCleanup(temporary.cleanup)
        runner = FakeRunner(project, inventory_payload(endpoint='100.100.5.6'), bluegreen_status())
        coordinator = self.coordinator(project, inventory_path, runner)
        initial_plan = MODULE.RecoveryPlan(
            target=MODULE.Target(
                host='raspi4-demo',
                user='demo-user',
                current_host='100.80.10.20',
                original_host='100.80.10.20',
                previous_ssh_host_key_fingerprint=None,
                status_agent_client_id='client',
                nfc_enabled=True,
                barcode_enabled=False,
            ),
            bootstrap_host=LAN_TARGET,
            release=MODULE.Release(SHA, 'blue'),
            runtime_override_exists=False,
            recovery_network=MODULE.RecoveryNetworkReadiness(
                'lan', True, LAN_SERVER
            ),
            bootstrap_identity=MODULE.BootstrapIdentity(
                BOOTSTRAP_HOSTNAME,
                'demo-user',
                SSH_FINGERPRINT,
                f'{LAN_TARGET} ssh-ed25519 {SSH_KEY_BLOB}',
            ),
        )
        coordinator.write_runtime_override(initial_plan, 'pi4-recovery-test', LAN_TARGET)

        contract = coordinator.resolve_inventory_contract('raspi4-demo')
        target, override_exists = coordinator.resolve_target(contract)

        self.assertTrue(override_exists)
        self.assertEqual(target.current_host, LAN_TARGET)
        self.assertEqual(target.original_host, '100.80.10.20')
        payload = json.loads(coordinator.runtime_override_path('raspi4-demo').read_text(encoding='utf-8'))
        self.assertEqual(payload['ansible_host'], LAN_TARGET)
        self.assertEqual(payload['network_mode'], 'local')
        self.assertIs(payload['tailscale_enabled'], False)
        self.assertNotIn('secret', json.dumps(payload).lower())

    def test_run_rejects_previously_managed_ssh_identity_at_another_ip(self):
        temporary, project, inventory_path = self.make_project()
        self.addCleanup(temporary.cleanup)
        runner = FakeRunner(project, inventory_payload(), bluegreen_status())
        coordinator = self.coordinator(project, inventory_path, runner)
        self.seed_runtime_override(coordinator, endpoint='192.168.10.54')
        fleet_before = coordinator.fleet_state_path().read_bytes()

        with self.assertRaisesRegex(MODULE.RecoveryError, 'previously managed OS'):
            coordinator.execute(
                'raspi4-demo', LAN_TARGET, BOOTSTRAP_HOSTNAME,
                SSH_FINGERPRINT, 'SD failure', 'pi4-recovery-moved-old-os'
            )

        self.assertEqual(coordinator.fleet_state_path().read_bytes(), fleet_before)
        self.assertFalse(
            (project / 'logs/recovery/pi4-recovery-moved-old-os.json').exists()
        )

    def test_run_allows_new_ssh_identity_when_dhcp_reuses_previous_ip(self):
        temporary, project, inventory_path = self.make_project()
        self.addCleanup(temporary.cleanup)
        new_key_blob = base64.b64encode(b'fresh-replacement-ed25519-key').decode(
            'ascii'
        )
        new_fingerprint = 'SHA256:' + base64.b64encode(
            hashlib.sha256(base64.b64decode(new_key_blob)).digest()
        ).decode('ascii').rstrip('=')
        runner = FakeRunner(
            project,
            inventory_payload(),
            bluegreen_status(),
            ssh_key_blob=new_key_blob,
        )
        coordinator = self.coordinator(project, inventory_path, runner)
        self.seed_runtime_override(coordinator, endpoint=LAN_TARGET)

        state = coordinator.execute(
            'raspi4-demo', LAN_TARGET, BOOTSTRAP_HOSTNAME,
            new_fingerprint, 'SD failure', 'pi4-recovery-reused-ip'
        )

        self.assertEqual(state.payload['phase'], 'completed')
        override = json.loads(
            coordinator.runtime_override_path('raspi4-demo').read_text(
                encoding='utf-8'
            )
        )
        metadata = override['pi4_recovery']
        self.assertEqual(metadata['original_ansible_host'], '100.80.10.20')
        self.assertEqual(metadata['previous_ansible_host'], LAN_TARGET)
        self.assertEqual(metadata['bootstrap_hostname'], BOOTSTRAP_HOSTNAME)
        self.assertEqual(metadata['ssh_host_key_fingerprint'], new_fingerprint)

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
                coordinator.execute(
                    'raspi4-demo', '192.168.10.55', BOOTSTRAP_HOSTNAME,
                    SSH_FINGERPRINT, 'SD failure', 'pi4-recovery-fail'
                )

        self.assertFalse(coordinator.runtime_override_path('raspi4-demo').exists())
        state = json.loads((project / 'logs/recovery/pi4-recovery-fail.json').read_text(encoding='utf-8'))
        self.assertEqual(state['phase'], 'failed')
        self.assertEqual(len(fleet_before_legacy_failure), 1)
        fleet = fleet_before_legacy_failure[0]
        self.assertIsNone(fleet['activeRun'])
        self.assertEqual(fleet['lastRun']['runId'], 'pi4-recovery-fail')
        self.assertEqual(fleet['lastRun']['status'], 'failed')
        self.assertEqual(fleet['fleet']['raspi4-demo']['evidence'], 'unknown')

    def test_observed_lan_mismatch_never_writes_runtime_override(self):
        temporary, project, inventory_path = self.make_project()
        self.addCleanup(temporary.cleanup)
        runner = FakeRunner(
            project,
            inventory_payload(),
            bluegreen_status(),
            result_lan='192.168.10.56',
        )
        coordinator = self.coordinator(project, inventory_path, runner)

        with self.assertRaisesRegex(MODULE.RecoveryError, 'different LAN endpoint'):
            coordinator.execute(
                'raspi4-demo', LAN_TARGET, BOOTSTRAP_HOSTNAME,
                SSH_FINGERPRINT, 'SD failure', 'pi4-recovery-lan-mismatch'
            )

        self.assertFalse(coordinator.runtime_override_path('raspi4-demo').exists())
        state = json.loads(
            (project / 'logs/recovery/pi4-recovery-lan-mismatch.json').read_text(
                encoding='utf-8'
            )
        )
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
            server_client_id_reader=lambda: 'raspberrypi5-server',
        )

        with self.assertRaisesRegex(MODULE.RecoveryError, 'still accepts TCP/22'):
            coordinator.execute(
                'raspi4-demo', '192.168.10.55', BOOTSTRAP_HOSTNAME,
                SSH_FINGERPRINT, 'SD failure', 'pi4-recovery-online-old'
            )

        self.assertFalse(coordinator.runtime_override_path('raspi4-demo').exists())
        self.assertFalse(any(
            command[0] == 'ansible-playbook'
            and str(command[3]).endswith('recover-pi4.yml')
            for command in runner.commands
        ))

    def test_release_resolution_failure_writes_neither_fleet_nor_legacy_state(self):
        temporary, project, inventory_path = self.make_project()
        self.addCleanup(temporary.cleanup)
        (project / 'logs/deploy/fleet-release-state.json').unlink()
        runner = FakeRunner(project, inventory_payload(), bluegreen_status())
        coordinator = self.coordinator(project, inventory_path, runner)

        with self.assertRaisesRegex(MODULE.RecoveryError, 'approved full-fleet release'):
            coordinator.execute(
                'raspi4-demo', '192.168.10.55', BOOTSTRAP_HOSTNAME,
                SSH_FINGERPRINT, 'SD failure', 'pi4-recovery-preflight-fail'
            )

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
                'raspi4-demo', '192.168.10.55', BOOTSTRAP_HOSTNAME,
                SSH_FINGERPRINT, 'SD failure', 'pi4-recovery-ok'
            )

        self.assertEqual(state.payload['phase'], 'completed')
        override = json.loads(coordinator.runtime_override_path('raspi4-demo').read_text(encoding='utf-8'))
        self.assertEqual(override['ansible_host'], LAN_TARGET)
        self.assertEqual(override['network_mode'], 'local')
        self.assertIs(override['tailscale_enabled'], False)
        self.assertEqual(
            coordinator.runtime_override_path('raspi4-demo').stat().st_mode & 0o777,
            0o600,
        )
        self.assertEqual(
            override['pi4_recovery']['bootstrap_hostname'], BOOTSTRAP_HOSTNAME
        )
        self.assertEqual(
            override['pi4_recovery']['ssh_host_key_fingerprint'], SSH_FINGERPRINT
        )
        recovery_command = next(
            command
            for command in runner.commands
            if command[0] == 'ansible-playbook'
            and str(command[3]).endswith('recover-pi4.yml')
        )
        recovery_vars = json.loads(
            recovery_command[recovery_command.index('-e') + 1]
        )
        self.assertEqual(recovery_vars['recovery_bootstrap_ipv4'], LAN_TARGET)
        self.assertIn(
            'StrictHostKeyChecking=yes', recovery_vars['ansible_ssh_common_args']
        )
        pinned_path = Path(
            next(
                item.split('=', 1)[1]
                for item in recovery_vars['ansible_ssh_common_args'].split()
                if item.startswith('UserKnownHostsFile=')
            )
        )
        self.assertFalse(pinned_path.exists())
        self.assertNotIn('secret', json.dumps(recovery_vars).lower())
        self.assertTrue(any(
            command[0] == 'ansible'
            and '-m' in command
            and command[command.index('-m') + 1] == 'ping'
            for command in runner.commands
        ))
        self.assertTrue(any(command[0] == 'ansible-playbook' and str(command[3]).endswith('recover-pi4-verify.yml') for command in runner.commands))
        self.assertTrue(any(
            command[0] == 'ssh'
            and any('rev-parse' in value for value in command)
            for command in runner.commands
        ))
        service_commands = [
            command
            for command in runner.commands
            if command[0] == 'ansible'
            and any('systemctl is-active' in value for value in command)
        ]
        self.assertEqual(
            [command[command.index('-a') + 1] for command in service_commands],
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
                'raspi4-demo', '192.168.10.55', BOOTSTRAP_HOSTNAME,
                SSH_FINGERPRINT, 'SD failure', 'pi4-recovery-busy'
            )

        self.assertEqual(runner.commands, [])
        self.assertFalse((project / 'logs/recovery/pi4-recovery-busy.json').exists())
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
            'raspi4-demo', '192.168.10.55', BOOTSTRAP_HOSTNAME,
            SSH_FINGERPRINT, 'SD failure', 'pi4-recovery-stale'
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
                'raspi4-demo', '192.168.10.55', BOOTSTRAP_HOSTNAME,
                SSH_FINGERPRINT, 'SD failure', 'pi4-recovery-head'
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
                'raspi4-demo', '192.168.10.55', BOOTSTRAP_HOSTNAME,
                SSH_FINGERPRINT, 'SD failure', 'pi4-recovery-service'
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
                    BOOTSTRAP_HOSTNAME,
                    SSH_FINGERPRINT,
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
                'raspi4-demo', '192.168.10.55', BOOTSTRAP_HOSTNAME
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

        values = json.loads(completed.stdout)
        self.assertEqual(values['ansible_host'], LAN_TARGET)
        self.assertEqual(values['network_mode'], 'local')
        self.assertIs(values['tailscale_enabled'], False)
        evaluated = subprocess.run(
            [
                'ansible',
                '-i',
                str(fixture),
                'raspi4-recovery-precedence',
                '-m',
                'debug',
                '-a',
                'var=server_base_url',
            ],
            check=True,
            text=True,
            capture_output=True,
        )
        self.assertIn('server_base_url', evaluated.stdout)
        self.assertIn(f'https://{LAN_SERVER}', evaluated.stdout)

    def test_recovery_playbook_enforces_lan_and_observes_the_address(self):
        playbook = (
            Path(__file__).parents[3]
            / 'infrastructure/ansible/playbooks/recover-pi4.yml'
        ).read_text(encoding='utf-8')

        self.assertIn("network_mode | default('') == 'local'", playbook)
        self.assertIn('not (tailscale_enabled | default(true) | bool)', playbook)
        self.assertIn('ip -o -4 address show scope global', playbook)
        self.assertNotIn('tailscale status', playbook)

    def test_ansible_resolver_evaluates_templated_inventory_without_exporting_secrets(self):
        project = Path(__file__).parents[3]
        fixture = Path(__file__).parent / 'fixtures/recovery-contract-inventory.yml'
        runner = MODULE.SubprocessRunner(project)
        resolver = MODULE.AnsibleRecoveryInventoryResolver(
            project=project,
            inventory=fixture,
            runner=runner,
        )

        with tempfile.TemporaryDirectory() as directory:
            vault_password_path = Path(directory) / 'vault-password'
            vault_password_path.write_text(
                'recovery-resolver-test-only\n', encoding='utf-8'
            )
            with mock.patch.dict(
                MODULE.os.environ,
                {'ANSIBLE_VAULT_PASSWORD_FILE': str(vault_password_path)},
            ):
                contract = resolver.resolve('raspi4-template')

        self.assertEqual(contract.target.inventory_endpoint, '100.90.80.70')
        self.assertEqual(contract.target.user, 'template-user')
        self.assertTrue(contract.target.barcode_enabled)
        self.assertEqual(contract.recovery_network.server_endpoint, LAN_SERVER)
        self.assertTrue(contract.recovery_network.configured)
        serialized = json.dumps(asdict(contract), sort_keys=True)
        self.assertNotIn('sentinel-', serialized)
        self.assertNotIn('clientKey', serialized)

    def test_plan_reports_secret_free_resolver_and_lan_readiness(self):
        temporary, project, inventory_path = self.make_project()
        self.addCleanup(temporary.cleanup)
        runner = FakeRunner(project, inventory_payload(), bluegreen_status())

        public_plan = self.coordinator(project, inventory_path, runner).build_plan(
            'raspi4-demo', '192.168.10.55', BOOTSTRAP_HOSTNAME
        ).public_dict()

        self.assertTrue(public_plan['inventoryResolved'])
        self.assertEqual(
            public_plan['recoveryNetwork'],
            {
                'mode': 'lan',
                'configured': True,
                'serverEndpoint': LAN_SERVER,
            },
        )
        self.assertEqual(
            public_plan['bootstrapIdentity']['sshHostKeyFingerprint'],
            SSH_FINGERPRINT,
        )
        self.assertNotIn('secret', json.dumps(public_plan).lower())

    def test_plan_fails_closed_when_lan_contract_is_missing(self):
        temporary, project, inventory_path = self.make_project()
        self.addCleanup(temporary.cleanup)
        inventory = inventory_payload()
        inventory['_meta']['hostvars']['raspberrypi5']['lan_endpoint'] = ''
        runner = FakeRunner(project, inventory, bluegreen_status())

        with self.assertRaisesRegex(MODULE.RecoveryError, 'LAN recovery is not configured'):
            self.coordinator(project, inventory_path, runner).build_plan(
                'raspi4-demo', '192.168.10.55', BOOTSTRAP_HOSTNAME
            )


if __name__ == '__main__':
    unittest.main()
