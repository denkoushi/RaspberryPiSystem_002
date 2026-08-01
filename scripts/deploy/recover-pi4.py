#!/usr/bin/env python3
"""Fail-closed Pi4 SD-card recovery coordinator, executed only on the Pi5.

This command deliberately does not use the rolling-release coordinator.  A
rolling release updates healthy, managed terminals; this command rebuilds one
known Pi4 after the operator has installed Raspberry Pi OS and Wi-Fi on a new
SD card.  It keeps endpoint changes local to the Pi5 and reuses the existing
Ansible roles for all terminal configuration.
"""
from __future__ import annotations

import argparse
import ipaddress
import json
import os
import re
import secrets
import socket
import subprocess
import sys
import tempfile
from contextlib import contextmanager
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Iterator, Protocol

SCRIPT_DIRECTORY = Path(__file__).resolve().parent
if str(SCRIPT_DIRECTORY) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIRECTORY))

from rolling_release.fleet_state import (
    FleetLock,
    FleetLockBusyError,
    FleetStateError,
    FleetStateStore,
)
from rolling_release.bootstrap import read_local_server_client_id
from rolling_release.image_refs import image_matches_release
from recovery.bootstrap import (
    BootstrapIdentity,
    BootstrapIdentityError,
    BootstrapIdentityVerifier,
    FINGERPRINT_RE,
    SshBootstrapIdentityVerifier,
    canonical_hostname,
)
from recovery.inventory import (
    AnsibleRecoveryInventoryResolver,
    RecoveryInventoryError,
    RecoveryInventoryResolver,
    RecoveryNetworkReadiness,
    ResolvedRecoveryContract,
)
from recovery.network import (
    LanRecoveryNetworkProvider,
    RecoveryNetworkError,
    RecoveryNetworkProvider,
)


PROJECT = Path(__file__).resolve().parents[2]
ANSIBLE_DIRECTORY = PROJECT / 'infrastructure' / 'ansible'
DEFAULT_INVENTORY = ANSIBLE_DIRECTORY / 'inventory.yml'
FULL_SHA_RE = re.compile(r'^[0-9a-f]{40}$')
RUN_ID_RE = re.compile(r'^[a-z0-9][a-z0-9-]{2,79}$')


class RecoveryError(RuntimeError):
    """An operator-actionable recovery precondition or validation failure."""


class CommandRunner(Protocol):
    def run(
        self,
        command: list[str],
        *,
        capture: bool = True,
        cwd: Path | None = None,
    ) -> str:
        """Run a local Pi5 command and return stdout when requested."""


class SubprocessRunner:
    def __init__(self, project: Path) -> None:
        self.project = project
        self.ansible_directory = project / 'infrastructure' / 'ansible'

    def run(
        self,
        command: list[str],
        *,
        capture: bool = True,
        cwd: Path | None = None,
    ) -> str:
        environment = os.environ.copy()
        # Existing deployment wrappers run Ansible from infrastructure/ansible.
        # The recovery coordinator uses absolute paths, so preserve that role and
        # vault resolution explicitly instead of relying on the caller's CWD.
        environment['ANSIBLE_CONFIG'] = str(self.ansible_directory / 'ansible.cfg')
        environment['ANSIBLE_ROLES_PATH'] = str(self.ansible_directory / 'roles')
        completed = subprocess.run(
            command,
            cwd=cwd or self.project,
            check=True,
            text=True,
            capture_output=capture,
            env=environment,
        )
        return completed.stdout if capture else ''


@dataclass(frozen=True)
class Target:
    host: str
    user: str
    current_host: str
    original_host: str
    previous_ssh_host_key_fingerprint: str | None
    status_agent_client_id: str
    nfc_enabled: bool
    barcode_enabled: bool


@dataclass(frozen=True)
class Release:
    sha: str
    active_slot: str
    source: str = 'fleet-state'


@dataclass(frozen=True)
class RecoveryPlan:
    target: Target
    bootstrap_host: str
    release: Release
    runtime_override_exists: bool
    recovery_network: RecoveryNetworkReadiness
    bootstrap_identity: BootstrapIdentity

    def public_dict(self) -> dict[str, Any]:
        return {
            'target': {
                'host': self.target.host,
                'user': self.target.user,
                'previousEndpoint': self.target.current_host,
                'statusAgentClientId': self.target.status_agent_client_id,
                'nfcRequired': self.target.nfc_enabled,
                'barcodeRequired': self.target.barcode_enabled,
            },
            'bootstrapHost': self.bootstrap_host,
            'bootstrapIdentity': self.bootstrap_identity.public_dict(),
            'release': asdict(self.release),
            'runtimeOverrideExists': self.runtime_override_exists,
            'inventoryResolved': True,
            'recoveryNetwork': {
                'mode': self.recovery_network.mode,
                'configured': self.recovery_network.configured,
                'serverEndpoint': self.recovery_network.server_endpoint,
            },
            'initialOsChecklist': [
                'Raspberry Pi OS Desktop (64-bit) を使用する。',
                f'既存端末と同じユーザー名 {self.target.user!r} を設定する。',
                'Pi5 の公開鍵で SSH を有効化する。',
                'sudo のパスワード要求を無効化する。',
                f'新OSのホスト名を {self.bootstrap_identity.hostname!r} にして、現在のLAN IP {self.bootstrap_host} を確認する。',
                'planが表示したSSH公開鍵指紋を確認し、runへそのまま渡す。',
                f'Pi4からPi5のLAN IP {self.recovery_network.server_endpoint} へ到達できることを確認する。',
            ],
        }


class RecoveryState:
    """Small, secret-free recovery state persisted under the ignored logs tree."""

    def __init__(self, path: Path, payload: dict[str, Any]) -> None:
        self.path = path
        self.payload = payload

    def transition(self, phase: str, **values: Any) -> None:
        self.payload['phase'] = phase
        self.payload['updatedAt'] = utc_now()
        self.payload.update(values)
        atomic_json(self.path, self.payload, mode=0o600)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')


def atomic_json(path: Path, payload: dict[str, Any], *, mode: int = 0o600) -> None:
    """Atomically replace a JSON-as-YAML runtime file without leaking permissions."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f'.{path.name}.{os.getpid()}.tmp')
    try:
        temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        os.chmod(temporary, mode)
        os.replace(temporary, path)
        os.chmod(path, mode)
    finally:
        if temporary.exists():
            temporary.unlink()


def parse_ipv4(value: str, *, field: str) -> ipaddress.IPv4Address:
    try:
        parsed = ipaddress.ip_address(value)
    except ValueError as error:
        raise RecoveryError(f'{field} must be a literal IPv4 address: {value!r}') from error
    if not isinstance(parsed, ipaddress.IPv4Address):
        raise RecoveryError(f'{field} must be an IPv4 address: {value!r}')
    return parsed


def redact_error(error: Exception) -> str:
    """Keep failure state useful without retaining accidental secret values."""
    message = str(error).replace('\n', ' ').strip()
    message = re.sub(
        r'(?i)(authkey|authorization|password|secret|token)\s*(?:=|:)\s*[^\s,;]+',
        r'\1=<redacted>',
        message,
    )
    return message[:500] or error.__class__.__name__


def image_matches_sha(image: Any, sha: str) -> bool:
    return image_matches_release(image, sha)


class RecoveryCoordinator:
    """Coordinates recovery through narrow adapters instead of shelling everywhere."""

    def __init__(
        self,
        *,
        project: Path = PROJECT,
        inventory: Path = DEFAULT_INVENTORY,
        runner: CommandRunner | None = None,
        device_model_reader: Callable[[], str] | None = None,
        tcp_reachable: Callable[[str, int], bool] | None = None,
        server_client_id_reader: Callable[[], str] | None = None,
        inventory_resolver: RecoveryInventoryResolver | None = None,
        network_provider: RecoveryNetworkProvider | None = None,
        bootstrap_identity_verifier: BootstrapIdentityVerifier | None = None,
    ) -> None:
        self.project = project.resolve()
        self.inventory = inventory.resolve()
        self.runner = runner or SubprocessRunner(self.project)
        self.device_model_reader = device_model_reader or self._read_device_model
        self.tcp_reachable = tcp_reachable or self._tcp_reachable
        self.server_client_id_reader = (
            server_client_id_reader or read_local_server_client_id
        )
        self.inventory_resolver = inventory_resolver or AnsibleRecoveryInventoryResolver(
            project=self.project,
            inventory=self.inventory,
            runner=self.runner,
        )
        self.network_provider = network_provider or LanRecoveryNetworkProvider()
        self.bootstrap_identity_verifier = (
            bootstrap_identity_verifier or SshBootstrapIdentityVerifier(self.runner)
        )

    def _read_device_model(self) -> str:
        try:
            return Path('/proc/device-tree/model').read_text(encoding='utf-8').strip('\x00\n ')
        except OSError as error:
            raise RecoveryError('Pi5 hardware model cannot be read; recovery must run on the Pi5') from error

    @staticmethod
    def _tcp_reachable(host: str, port: int) -> bool:
        try:
            with socket.create_connection((host, port), timeout=5):
                return True
        except OSError:
            return False

    def runtime_override_path(self, target: str) -> Path:
        return self.project / 'infrastructure' / 'ansible' / 'host_vars' / target / 'recovery-runtime.yml'

    def fleet_state_path(self) -> Path:
        return self.project / 'logs' / 'deploy' / 'fleet-release-state.json'

    def fleet_lock_path(self) -> Path:
        return self.project / 'logs' / 'deploy' / 'fleet-release-state.lock'

    def fleet_store(self) -> FleetStateStore:
        return FleetStateStore(self.fleet_state_path(), lock_path=self.fleet_lock_path())

    def load_runtime_override(self, target: str) -> dict[str, Any] | None:
        path = self.runtime_override_path(target)
        if not path.exists():
            return None
        try:
            payload = json.loads(path.read_text(encoding='utf-8'))
        except (OSError, json.JSONDecodeError) as error:
            raise RecoveryError(f'local runtime override is malformed: {path}') from error
        if not isinstance(payload, dict):
            raise RecoveryError(f'local runtime override is malformed: {path}')
        return payload

    def resolve_inventory_contract(self, target_name: str) -> ResolvedRecoveryContract:
        try:
            return self.inventory_resolver.resolve(target_name)
        except RecoveryInventoryError as error:
            raise RecoveryError(str(error)) from error

    def resolve_target(
        self, contract: ResolvedRecoveryContract
    ) -> tuple[Target, bool]:
        values = contract.target
        target_name = values.host
        if not values.required_secrets_configured:
            raise RecoveryError(
                f'{target_name!r} is missing required recovery inventory secrets'
            )
        if not values.recovery_enabled:
            raise RecoveryError(
                f'{target_name!r} does not enable the Pi4 recovery capability'
            )
        if not values.kiosk_managed:
            raise RecoveryError(f'{target_name!r} must have kiosk browser management enabled')
        try:
            self.network_provider.validate_contract(contract)
        except RecoveryNetworkError as error:
            raise RecoveryError(str(error)) from error

        override = self.load_runtime_override(target_name)
        current_host = values.inventory_endpoint
        original_host = values.inventory_endpoint
        previous_fingerprint: str | None = None
        if override is not None:
            current = override.get('ansible_host')
            if not isinstance(current, str) or not self.network_provider.is_managed_endpoint(
                current
            ):
                raise RecoveryError(
                    f'local runtime override for {target_name!r} has no valid current endpoint'
                )
            current_host = current
            metadata = override.get('pi4_recovery')
            previous = metadata.get('original_ansible_host') if isinstance(metadata, dict) else None
            if not isinstance(previous, str) or not previous.strip():
                raise RecoveryError(f'local runtime override for {target_name!r} has no original endpoint')
            original_host = previous
            stored_fingerprint = (
                metadata.get('ssh_host_key_fingerprint')
                if isinstance(metadata, dict)
                else None
            )
            if stored_fingerprint is not None:
                if not isinstance(stored_fingerprint, str) or not FINGERPRINT_RE.fullmatch(
                    stored_fingerprint
                ):
                    raise RecoveryError(
                        f'local runtime override for {target_name!r} has an invalid SSH host-key fingerprint'
                    )
                previous_fingerprint = stored_fingerprint
        parse_ipv4(current_host, field='current endpoint')
        parse_ipv4(original_host, field='inventory endpoint')
        return Target(
            host=target_name,
            user=values.user,
            current_host=current_host,
            original_host=original_host,
            previous_ssh_host_key_fingerprint=previous_fingerprint,
            status_agent_client_id=values.status_agent_client_id,
            nfc_enabled=values.nfc_enabled,
            barcode_enabled=values.barcode_enabled,
        ), override is not None

    def resolve_active_release(self, expected_server_host: str) -> Release:
        try:
            fleet_state = self.fleet_store().read_only()
        except FleetStateError as error:
            raise RecoveryError('fleet release state is unavailable or invalid') from error

        pristine = bool(
            fleet_state.get('generation') == 0
            and fleet_state.get('activeRun') is None
            and fleet_state.get('lastRun') is None
            and not fleet_state.get('fleet')
        )
        if pristine:
            raise RecoveryError(
                'fleet release state is not seeded; run an approved full-fleet release before Pi4 recovery'
            )
        if fleet_state.get('activeRun') is not None:
            raise RecoveryError('fleet release state has an active run; release authority is ambiguous')
        server = fleet_state['fleet'].get(expected_server_host)
        if (
            not isinstance(server, dict)
            or server.get('role') != 'server'
            or server.get('evidence') != 'verified'
        ):
            raise RecoveryError(
                'fleet release state has no verified inventory server evidence'
            )
        sha = server.get('currentSha')
        candidate = {'api': server.get('apiImage'), 'web': server.get('webImage')}
        expected_slot = server.get('activeSlot')
        source = 'fleet-state'
        if (
            not isinstance(sha, str)
            or not FULL_SHA_RE.fullmatch(sha)
            or not image_matches_sha(candidate.get('api'), sha)
            or not image_matches_sha(candidate.get('web'), sha)
            or expected_slot not in {'blue', 'green'}
        ):
            raise RecoveryError('verified fleet server evidence does not prove an immutable release')

        output = self.runner.run([str(self.project / 'scripts/deploy/pi5-blue-green.sh'), 'status'])
        try:
            status = json.loads(output)
        except json.JSONDecodeError as error:
            raise RecoveryError('Pi5 Blue/Green status is not valid JSON') from error
        active_slot = status.get('activeSlot') if isinstance(status, dict) else None
        gateway = status.get('gateway') if isinstance(status, dict) else None
        slots = status.get('slots') if isinstance(status, dict) else None
        active_images = (slots.get(active_slot) or {}).get('images') if isinstance(slots, dict) and active_slot else None
        if (
            status.get('runtimeStatus') != 'consistent'
            or active_slot not in {'blue', 'green'}
            or (expected_slot is not None and active_slot != expected_slot)
            or not isinstance(gateway, dict)
            or gateway.get('mode') != 'application'
            or gateway.get('slot') != active_slot
            or not isinstance(active_images, dict)
            or active_images.get('api') != candidate.get('api')
            or active_images.get('web') != candidate.get('web')
        ):
            raise RecoveryError(f'Pi5 Blue/Green state does not prove the {source} release is active')
        return Release(sha=sha, active_slot=active_slot, source=source)

    def validate_inventory_server_identity(
        self, contract: ResolvedRecoveryContract
    ) -> str:
        server_host = contract.server.host
        expected_client_id = contract.server.status_agent_client_id
        if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._:-]{0,127}', expected_client_id):
            raise RecoveryError('inventory server has no safe status_agent_client_id')
        try:
            actual_client_id = self.server_client_id_reader()
        except (OSError, UnicodeError) as error:
            raise RecoveryError('local Pi5 CLIENT_ID could not be verified') from error
        if actual_client_id != expected_client_id:
            raise RecoveryError('local Pi5 does not match the selected inventory server identity')
        return server_host

    def build_plan(
        self,
        target_name: str,
        bootstrap_host: str,
        bootstrap_hostname: str,
        *,
        expected_bootstrap_fingerprint: str | None = None,
        resolved_contract: ResolvedRecoveryContract | None = None,
    ) -> RecoveryPlan:
        contract = resolved_contract or self.resolve_inventory_contract(target_name)
        try:
            bootstrap = self.network_provider.validate_bootstrap(
                bootstrap_host, contract
            )
        except RecoveryNetworkError as error:
            raise RecoveryError(str(error)) from error
        target, override_exists = self.resolve_target(contract)
        server_host = self.validate_inventory_server_identity(contract)
        release = self.resolve_active_release(server_host)
        bootstrap_identity = self.verify_bootstrap_identity(
            bootstrap,
            target,
            bootstrap_hostname,
            expected_bootstrap_fingerprint,
        )
        return RecoveryPlan(
            target=target,
            bootstrap_host=bootstrap,
            release=release,
            runtime_override_exists=override_exists,
            recovery_network=contract.recovery_network,
            bootstrap_identity=bootstrap_identity,
        )

    def verify_bootstrap_identity(
        self,
        bootstrap_host: str,
        target: Target,
        bootstrap_hostname: str,
        expected_fingerprint: str | None = None,
    ) -> BootstrapIdentity:
        try:
            return self.bootstrap_identity_verifier.verify(
                bootstrap_host,
                target.user,
                bootstrap_hostname,
                expected_fingerprint,
            )
        except BootstrapIdentityError as error:
            raise RecoveryError(str(error)) from error

    def assert_pi5(self) -> None:
        model = self.device_model_reader()
        if 'Raspberry Pi 5' not in model:
            raise RecoveryError(f'recovery must run on Raspberry Pi 5, found {model!r}')

    def create_state(self, target_name: str, bootstrap_host: str, run_id: str, reason: str) -> RecoveryState:
        if not RUN_ID_RE.fullmatch(run_id):
            raise RecoveryError('run ID must contain only lower-case letters, digits, and hyphens')
        path = self.project / 'logs' / 'recovery' / f'{run_id}.json'
        if path.exists():
            raise RecoveryError(f'recovery run already exists: {run_id}')
        state = RecoveryState(path, {
            'runId': run_id,
            'createdAt': utc_now(),
            'phase': 'preflight',
            'target': target_name,
            'bootstrapHost': bootstrap_host,
            'reason': reason,
        })
        state.transition('preflight')
        return state

    @contextmanager
    def _pinned_known_hosts(self, identity: BootstrapIdentity) -> Iterator[Path]:
        with tempfile.TemporaryDirectory(
            prefix='pi4-recovery-pinned-host-'
        ) as directory:
            path = Path(directory) / 'known_hosts'
            path.write_text(identity.known_hosts_entry + '\n', encoding='utf-8')
            os.chmod(path, 0o600)
            yield path

    @staticmethod
    def _ssh_options(known_hosts_path: Path) -> list[str]:
        return [
            '-o',
            'BatchMode=yes',
            '-o',
            'ConnectTimeout=15',
            '-o',
            f'UserKnownHostsFile={known_hosts_path}',
            '-o',
            'StrictHostKeyChecking=yes',
        ]

    @staticmethod
    def _ansible_connection_vars(known_hosts_path: Path) -> dict[str, str]:
        return {
            'ansible_ssh_common_args': (
                '-o BatchMode=yes -o ConnectTimeout=15 '
                f'-o UserKnownHostsFile={known_hosts_path} '
                '-o StrictHostKeyChecking=yes'
            )
        }

    def _run_bootstrap_playbook(
        self, plan: RecoveryPlan, result_path: Path, known_hosts_path: Path
    ) -> None:
        extra_vars: dict[str, object] = {
            'recovery_authorized': True,
            'repo_version': plan.release.sha,
            'ansible_host': plan.bootstrap_host,
            'network_mode': 'local',
            'tailscale_enabled': False,
            'recovery_result_path': str(result_path),
            'recovery_bootstrap_ipv4': plan.bootstrap_host,
            **self._ansible_connection_vars(known_hosts_path),
        }
        self.runner.run([
            'ansible-playbook', '-i', str(self.inventory), str(self.project / 'infrastructure/ansible/playbooks/recover-pi4.yml'),
            '--limit', plan.target.host,
            '-e', json.dumps(extra_vars),
        ], capture=False, cwd=self.project / 'infrastructure' / 'ansible')

    def _read_result(self, path: Path, plan: RecoveryPlan) -> str:
        try:
            payload = json.loads(path.read_text(encoding='utf-8'))
        except (OSError, json.JSONDecodeError) as error:
            raise RecoveryError('Ansible did not produce a valid recovery result') from error
        try:
            return self.network_provider.read_result(
                payload,
                target_host=plan.target.host,
                release_sha=plan.release.sha,
                expected_endpoint=plan.bootstrap_host,
            )
        except RecoveryNetworkError as error:
            raise RecoveryError(str(error)) from error

    def write_runtime_override(self, plan: RecoveryPlan, run_id: str, endpoint: str) -> Path:
        path = self.runtime_override_path(plan.target.host)
        runtime_values = self.network_provider.runtime_host_vars(endpoint)
        atomic_json(path, {
            **runtime_values,
            'pi4_recovery': {
                'run_id': run_id,
                'recovered_at': utc_now(),
                'release_sha': plan.release.sha,
                'original_ansible_host': plan.target.original_host,
                'previous_ansible_host': plan.target.current_host,
                'bootstrap_hostname': plan.bootstrap_identity.hostname,
                'ssh_host_key_fingerprint': (
                    plan.bootstrap_identity.ssh_host_key_fingerprint
                ),
            },
        })
        return path

    def validate_recovered_terminal(
        self, plan: RecoveryPlan, known_hosts_path: Path
    ) -> str:
        user = plan.target.user
        endpoint = self.runtime_override_endpoint(plan.target.host)
        identity_output = self.runner.run(
            [
                'ssh',
                *self._ssh_options(known_hosts_path),
                f'{user}@{endpoint}',
                'id -un && hostname -s',
            ]
        )
        identity_lines = [
            line.strip() for line in identity_output.splitlines() if line.strip()
        ]
        if len(identity_lines) != 2 or identity_lines[0] != user:
            raise RecoveryError('new LAN endpoint authenticated as an unexpected user')
        try:
            observed_hostname = canonical_hostname(identity_lines[1])
        except BootstrapIdentityError as error:
            raise RecoveryError('new LAN endpoint reported an invalid hostname') from error
        if observed_hostname != plan.bootstrap_identity.hostname:
            raise RecoveryError('new LAN endpoint reported an unexpected hostname')
        connection_vars = json.dumps(
            self._ansible_connection_vars(known_hosts_path)
        )
        self.runner.run(
            [
                'ansible',
                '-i',
                str(self.inventory),
                plan.target.host,
                '-m',
                'ping',
                '-e',
                connection_vars,
            ],
            capture=False,
            cwd=self.project / 'infrastructure' / 'ansible',
        )
        self.runner.run([
            'ansible-playbook', '-i', str(self.inventory), str(self.project / 'infrastructure/ansible/playbooks/recover-pi4-verify.yml'),
            '--limit', plan.target.host, '-e', json.dumps({
                'recovery_authorized': True,
                **self._ansible_connection_vars(known_hosts_path),
            }),
        ], capture=False, cwd=self.project / 'infrastructure' / 'ansible')
        observed_sha = self.runner.run([
            'ssh', *self._ssh_options(known_hosts_path), f'{user}@{endpoint}',
            'git -C /opt/RaspberryPiSystem_002 rev-parse HEAD',
        ]).strip()
        if observed_sha != plan.release.sha:
            raise RecoveryError('recovered terminal HEAD does not match the active release SHA')
        for service in ('kiosk-browser.service', 'status-agent.timer'):
            self.runner.run([
                'ansible', '-i', str(self.inventory), plan.target.host, '-b', '-m', 'command',
                '-a', f'systemctl is-active --quiet {service}', '-e', connection_vars,
            ], cwd=self.project / 'infrastructure' / 'ansible')
        return observed_sha

    def runtime_override_endpoint(self, target: str) -> str:
        override = self.load_runtime_override(target)
        endpoint = override.get('ansible_host') if isinstance(override, dict) else None
        if not isinstance(endpoint, str) or not self.network_provider.is_managed_endpoint(endpoint):
            raise RecoveryError(f'local runtime override for {target!r} has no valid LAN endpoint')
        if override.get('network_mode') != 'local' or override.get('tailscale_enabled') is not False:
            raise RecoveryError(f'local runtime override for {target!r} does not enforce LAN mode')
        return endpoint

    def execute(
        self,
        target_name: str,
        bootstrap_host: str,
        bootstrap_hostname: str,
        bootstrap_host_key: str,
        reason: str,
        run_id: str | None = None,
    ) -> RecoveryState:
        generated_run_id = run_id or f"pi4-recovery-{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}-{secrets.token_hex(3)}"
        if not RUN_ID_RE.fullmatch(generated_run_id):
            raise RecoveryError('run ID must contain only lower-case letters, digits, and hyphens')

        fleet_lock = FleetLock(self.fleet_lock_path(), blocking=False)
        try:
            lease = fleet_lock.acquire()
        except FleetLockBusyError as error:
            raise RecoveryError('another fleet release or Pi4 recovery is already running') from error
        except (FleetStateError, OSError) as error:
            raise RecoveryError('fleet release lock is unavailable; recovery did not start') from error

        legacy_state: RecoveryState | None = None
        fleet_state: dict[str, Any] | None = None
        fleet_active = False
        plan: RecoveryPlan | None = None
        store = self.fleet_store()
        try:
            try:
                self.assert_pi5()
                resolved_contract = self.resolve_inventory_contract(target_name)
                self.validate_inventory_server_identity(resolved_contract)
                try:
                    preflight_bootstrap = self.network_provider.validate_bootstrap(
                        bootstrap_host, resolved_contract
                    )
                except RecoveryNetworkError as error:
                    raise RecoveryError(str(error)) from error
                preflight_target, _ = self.resolve_target(resolved_contract)
                self.verify_bootstrap_identity(
                    preflight_bootstrap,
                    preflight_target,
                    bootstrap_hostname,
                    bootstrap_host_key,
                )
                fleet_state = store.read_only()
                stale_run = fleet_state.get('activeRun')
                if isinstance(stale_run, dict):
                    fleet_state = store.abandon_active_run(
                        stale_run['runId'],
                        expected_generation=fleet_state['generation'],
                        lease=lease,
                    )
                plan = self.build_plan(
                    target_name,
                    bootstrap_host,
                    bootstrap_hostname,
                    expected_bootstrap_fingerprint=bootstrap_host_key,
                    resolved_contract=resolved_contract,
                )
                if (
                    plan.target.previous_ssh_host_key_fingerprint
                    == plan.bootstrap_identity.ssh_host_key_fingerprint
                ):
                    raise RecoveryError(
                        'bootstrap SSH identity matches the previously managed OS; refusing duplicate recovery'
                    )
                if (
                    plan.target.current_host != plan.bootstrap_host
                    and self.tcp_reachable(plan.target.current_host, 22)
                ):
                    raise RecoveryError(
                        'previous production endpoint still accepts TCP/22; refusing possible duplicate terminal'
                    )
                fleet_state = store.read_only()
                fleet_state = store.begin_run(
                    generated_run_id,
                    plan.release.sha,
                    str(self.inventory),
                    expected_generation=fleet_state['generation'],
                    kind='pi4-recovery',
                    lease=lease,
                )
                fleet_active = True
                fleet_state = store.mark_host_unknown(
                    plan.target.host,
                    'kiosk',
                    plan.release.sha,
                    generated_run_id,
                    expected_generation=fleet_state['generation'],
                    lease=lease,
                )

                # Compatibility state is deliberately written only after the
                # durable fleet run and target evidence are fail-closed.
                legacy_state = self.create_state(target_name, bootstrap_host, generated_run_id, reason)
                result_path = self.project / 'logs' / 'recovery' / f'{generated_run_id}-ansible-result.json'
                legacy_state.transition(
                    'preflight-complete',
                    releaseSha=plan.release.sha,
                    bootstrapHostname=plan.bootstrap_identity.hostname,
                    sshHostKeyFingerprint=(
                        plan.bootstrap_identity.ssh_host_key_fingerprint
                    ),
                )
                with self._pinned_known_hosts(plan.bootstrap_identity) as known_hosts_path:
                    legacy_state.transition('bootstrap-configuring')
                    self._run_bootstrap_playbook(
                        plan, result_path, known_hosts_path
                    )
                    lan_ip = self._read_result(result_path, plan)
                    legacy_state.transition('lan-endpoint-observed', lanIpv4=lan_ip)
                    override_path = self.write_runtime_override(
                        plan, generated_run_id, lan_ip
                    )
                    legacy_state.transition(
                        'runtime-endpoint-saved', runtimeOverride=str(override_path)
                    )
                    legacy_state.transition('validating')
                    observed_sha = self.validate_recovered_terminal(
                        plan, known_hosts_path
                    )
                fleet_state = store.mark_host_verified(
                    plan.target.host,
                    'kiosk',
                    plan.release.sha,
                    observed_sha,
                    generated_run_id,
                    expected_generation=fleet_state['generation'],
                    lease=lease,
                )
                fleet_state = store.finish_run(
                    generated_run_id,
                    'success',
                    expected_generation=fleet_state['generation'],
                    lease=lease,
                )
                fleet_active = False
                legacy_state.transition('completed', completedAt=utc_now())
                return legacy_state
            except Exception as error:
                if fleet_active:
                    assert fleet_state is not None
                    assert plan is not None
                    try:
                        fleet_state = store.mark_host_unknown(
                            plan.target.host,
                            'kiosk',
                            plan.release.sha,
                            generated_run_id,
                            expected_generation=fleet_state['generation'],
                            lease=lease,
                        )
                        fleet_state = store.finish_run(
                            generated_run_id,
                            'failed',
                            expected_generation=fleet_state['generation'],
                            lease=lease,
                        )
                        fleet_active = False
                    except Exception as finish_error:
                        raise RecoveryError(
                            'fleet release state could not record recovery failure; '
                            'legacy recovery state was left non-terminal'
                        ) from finish_error
                if legacy_state is not None:
                    legacy_state.transition('failed', failure=redact_error(error))
                if isinstance(error, RecoveryError):
                    raise
                if isinstance(error, FleetStateError):
                    raise RecoveryError('fleet release state update failed; recovery did not continue') from error
                raise RecoveryError('recovery command failed; inspect the Pi5 recovery state log') from error
        finally:
            fleet_lock.release()


def parser() -> argparse.ArgumentParser:
    command = argparse.ArgumentParser(description=__doc__)
    command.add_argument('--inventory', default=str(DEFAULT_INVENTORY), help='Pi5 Ansible inventory path')
    subcommands = command.add_subparsers(dest='command', required=True)
    for name in ('plan', 'run'):
        subcommand = subcommands.add_parser(name)
        subcommand.add_argument('--target', required=True, help='existing Pi4 inventory hostname')
        subcommand.add_argument('--bootstrap-host', required=True, help='current private-LAN IPv4 address reported for the replacement OS')
        subcommand.add_argument('--bootstrap-hostname', required=True, help='short hostname configured on the replacement OS')
    run = subcommands.choices['run']
    run.add_argument('--confirm-recovery', action='store_true', help='required acknowledgement for mutating recovery')
    run.add_argument('--bootstrap-host-key', required=True, help='SHA256 SSH host-key fingerprint returned by plan')
    run.add_argument('--reason', required=True, help='operator incident reference or reason')
    run.add_argument('--run-id', help='optional unique recovery run identifier')
    return command


def main(argv: list[str] | None = None) -> int:
    arguments = parser().parse_args(argv)
    coordinator = RecoveryCoordinator(inventory=Path(arguments.inventory))
    try:
        if arguments.command == 'plan':
            print(json.dumps(coordinator.build_plan(
                arguments.target,
                arguments.bootstrap_host,
                arguments.bootstrap_hostname,
            ).public_dict(), ensure_ascii=False, indent=2))
            return 0
        if not arguments.confirm_recovery:
            raise RecoveryError('run requires --confirm-recovery')
        state = coordinator.execute(
            arguments.target,
            arguments.bootstrap_host,
            arguments.bootstrap_hostname,
            arguments.bootstrap_host_key,
            arguments.reason,
            arguments.run_id,
        )
        print(json.dumps(state.payload, ensure_ascii=False, indent=2))
        return 0
    except RecoveryError as error:
        print(json.dumps({'error': str(error)}, ensure_ascii=False), file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
