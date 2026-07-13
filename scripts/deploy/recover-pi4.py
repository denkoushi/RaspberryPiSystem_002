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
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Protocol


PROJECT = Path(__file__).resolve().parents[2]
ANSIBLE_DIRECTORY = PROJECT / 'infrastructure' / 'ansible'
DEFAULT_INVENTORY = ANSIBLE_DIRECTORY / 'inventory.yml'
FULL_SHA_RE = re.compile(r'^[0-9a-f]{40}$')
PI4_HOST_RE = re.compile(r'^(?:raspberrypi4|raspi4-[a-z0-9-]+)$')
RUN_ID_RE = re.compile(r'^[a-z0-9][a-z0-9-]{2,79}$')


class RecoveryError(RuntimeError):
    """An operator-actionable recovery precondition or validation failure."""


class CommandRunner(Protocol):
    def run(self, command: list[str], *, capture: bool = True) -> str:
        """Run a local Pi5 command and return stdout when requested."""


class SubprocessRunner:
    def __init__(self, project: Path) -> None:
        self.project = project
        self.ansible_directory = project / 'infrastructure' / 'ansible'

    def run(self, command: list[str], *, capture: bool = True) -> str:
        environment = os.environ.copy()
        # Existing deployment wrappers run Ansible from infrastructure/ansible.
        # The recovery coordinator uses absolute paths, so preserve that role and
        # vault resolution explicitly instead of relying on the caller's CWD.
        environment['ANSIBLE_CONFIG'] = str(self.ansible_directory / 'ansible.cfg')
        environment['ANSIBLE_ROLES_PATH'] = str(self.ansible_directory / 'roles')
        completed = subprocess.run(
            command,
            cwd=self.project,
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
    original_host: str
    status_agent_client_id: str
    nfc_enabled: bool
    barcode_enabled: bool
    kiosk_url: str


@dataclass(frozen=True)
class Release:
    sha: str
    active_slot: str


@dataclass(frozen=True)
class RecoveryPlan:
    target: Target
    bootstrap_host: str
    release: Release
    runtime_override_exists: bool

    def public_dict(self) -> dict[str, Any]:
        return {
            'target': {
                'host': self.target.host,
                'user': self.target.user,
                'previousEndpoint': self.target.original_host,
                'statusAgentClientId': self.target.status_agent_client_id,
                'nfcRequired': self.target.nfc_enabled,
                'barcodeRequired': self.target.barcode_enabled,
            },
            'bootstrapHost': self.bootstrap_host,
            'release': asdict(self.release),
            'runtimeOverrideExists': self.runtime_override_exists,
            'initialOsChecklist': [
                'Raspberry Pi OS Desktop (64-bit) を使用する。',
                f'既存端末と同じユーザー名 {self.target.user!r} を設定する。',
                'Pi5 の公開鍵で SSH を有効化する。',
                'sudo のパスワード要求を無効化する。',
                f'Pi5 から到達できる一時LAN IP {self.bootstrap_host} を設定する。',
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


def is_tailscale_ipv4(value: str) -> bool:
    try:
        return parse_ipv4(value, field='Tailscale address') in ipaddress.ip_network('100.64.0.0/10')
    except RecoveryError:
        return False


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
    if not isinstance(image, str):
        return False
    _repository, separator, tag = image.rpartition(':')
    return bool(
        _repository
        and separator
        and re.fullmatch(re.escape(sha) + r'-[0-9a-f]{12}', tag),
    )


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
    ) -> None:
        self.project = project.resolve()
        self.inventory = inventory.resolve()
        self.runner = runner or SubprocessRunner(self.project)
        self.device_model_reader = device_model_reader or self._read_device_model
        self.tcp_reachable = tcp_reachable or self._tcp_reachable

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

    def inventory_data(self) -> dict[str, Any]:
        output = self.runner.run(['ansible-inventory', '-i', str(self.inventory), '--list'])
        try:
            payload = json.loads(output)
        except json.JSONDecodeError as error:
            raise RecoveryError('Ansible inventory output is not valid JSON') from error
        if not isinstance(payload, dict):
            raise RecoveryError('Ansible inventory output is not an object')
        return payload

    def resolve_target(self, target_name: str, inventory: dict[str, Any]) -> tuple[Target, bool]:
        hosts = ((inventory.get('_meta') or {}).get('hostvars') or {})
        values = hosts.get(target_name)
        kiosk_hosts = (inventory.get('kiosk') or {}).get('hosts') or []
        if not isinstance(values, dict) or target_name not in kiosk_hosts or not PI4_HOST_RE.fullmatch(target_name):
            raise RecoveryError(f'{target_name!r} is not a supported, inventory-managed Pi4 kiosk')

        missing = [
            key for key in ('ansible_user', 'ansible_host', 'status_agent_client_id', 'status_agent_client_key',
                            'nfc_agent_client_id', 'nfc_agent_client_secret', 'kiosk_url')
            if not isinstance(values.get(key), str) or not values[key].strip()
        ]
        if missing:
            raise RecoveryError(f'{target_name!r} is missing recovery inventory values: {", ".join(missing)}')
        if values.get('tailscale_enabled') is not True or values.get('manage_kiosk_browser') is not True:
            raise RecoveryError(f'{target_name!r} must have Tailscale and kiosk browser management enabled')

        override = self.load_runtime_override(target_name)
        original_host = values['ansible_host']
        if override is not None:
            metadata = override.get('pi4_recovery')
            previous = metadata.get('original_ansible_host') if isinstance(metadata, dict) else None
            if not isinstance(previous, str) or not previous.strip():
                raise RecoveryError(f'local runtime override for {target_name!r} has no original endpoint')
            original_host = previous
        parse_ipv4(original_host, field='inventory endpoint')
        return Target(
            host=target_name,
            user=values['ansible_user'],
            original_host=original_host,
            status_agent_client_id=values['status_agent_client_id'],
            nfc_enabled=True,
            barcode_enabled=values.get('barcode_agent_enabled') is True,
            kiosk_url=values['kiosk_url'],
        ), override is not None

    def resolve_active_release(self) -> Release:
        try:
            marker = json.loads((self.project / 'logs/deploy/pi5-release-current.json').read_text(encoding='utf-8'))
        except (OSError, json.JSONDecodeError) as error:
            raise RecoveryError('Pi5 release marker is unavailable or invalid') from error
        sha = marker.get('sha') if isinstance(marker, dict) else None
        candidate = marker.get('candidate') if isinstance(marker, dict) else None
        if not isinstance(sha, str) or not FULL_SHA_RE.fullmatch(sha):
            raise RecoveryError('Pi5 release marker has no immutable full SHA')
        if not isinstance(candidate, dict) or not image_matches_sha(candidate.get('api'), sha) or not image_matches_sha(candidate.get('web'), sha):
            raise RecoveryError('Pi5 release marker does not prove immutable API/Web images')

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
            or not isinstance(gateway, dict)
            or gateway.get('mode') != 'application'
            or gateway.get('slot') != active_slot
            or not isinstance(active_images, dict)
            or active_images.get('api') != candidate.get('api')
            or active_images.get('web') != candidate.get('web')
        ):
            raise RecoveryError('Pi5 Blue/Green state does not prove the marker release is active')
        return Release(sha=sha, active_slot=active_slot)

    def build_plan(self, target_name: str, bootstrap_host: str) -> RecoveryPlan:
        bootstrap = parse_ipv4(bootstrap_host, field='bootstrap host')
        if bootstrap in ipaddress.ip_network('100.64.0.0/10'):
            raise RecoveryError('bootstrap host must be a temporary LAN IPv4 address, not a Tailscale address')
        inventory = self.inventory_data()
        target, override_exists = self.resolve_target(target_name, inventory)
        if str(bootstrap) == target.original_host:
            raise RecoveryError('bootstrap host must differ from the stale production endpoint')
        release = self.resolve_active_release()
        return RecoveryPlan(target=target, bootstrap_host=str(bootstrap), release=release, runtime_override_exists=override_exists)

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

    def _ssh_identity(self, host: str, user: str) -> str:
        output = self.runner.run([
            'ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', f'{user}@{host}', 'id', '-un',
        ])
        return output.strip()

    def _run_bootstrap_playbook(self, plan: RecoveryPlan, result_path: Path) -> None:
        self.runner.run([
            'ansible-playbook', '-i', str(self.inventory), str(self.project / 'infrastructure/ansible/playbooks/recover-pi4.yml'),
            '--limit', plan.target.host,
            '-e', 'recovery_authorized=true',
            '-e', f'repo_version={plan.release.sha}',
            '-e', f'ansible_host={plan.bootstrap_host}',
            '-e', f'recovery_result_path={result_path}',
        ], capture=False)

    def _read_result(self, path: Path, plan: RecoveryPlan) -> str:
        try:
            payload = json.loads(path.read_text(encoding='utf-8'))
        except (OSError, json.JSONDecodeError) as error:
            raise RecoveryError('Ansible did not produce a valid recovery result') from error
        address = payload.get('tailscaleIpv4') if isinstance(payload, dict) else None
        if (
            not isinstance(address, str)
            or not is_tailscale_ipv4(address)
            or payload.get('target') != plan.target.host
            or payload.get('releaseSha') != plan.release.sha
        ):
            raise RecoveryError('Ansible recovery result does not prove the expected new Tailscale endpoint')
        return address

    def write_runtime_override(self, plan: RecoveryPlan, run_id: str, tailscale_ip: str) -> Path:
        path = self.runtime_override_path(plan.target.host)
        atomic_json(path, {
            'ansible_host': tailscale_ip,
            'pi4_recovery': {
                'run_id': run_id,
                'recovered_at': utc_now(),
                'release_sha': plan.release.sha,
                'original_ansible_host': plan.target.original_host,
            },
        })
        return path

    def validate_recovered_terminal(self, plan: RecoveryPlan) -> None:
        user = plan.target.user
        if self._ssh_identity(self.runtime_override_endpoint(plan.target.host), user) != user:
            raise RecoveryError('new Tailscale endpoint authenticated as an unexpected user')
        self.runner.run(['ansible', '-i', str(self.inventory), plan.target.host, '-m', 'ping'], capture=False)
        self.runner.run([
            'ansible-playbook', '-i', str(self.inventory), str(self.project / 'infrastructure/ansible/playbooks/recover-pi4-verify.yml'),
            '--limit', plan.target.host, '-e', 'recovery_authorized=true',
        ], capture=False)

    def runtime_override_endpoint(self, target: str) -> str:
        override = self.load_runtime_override(target)
        endpoint = override.get('ansible_host') if isinstance(override, dict) else None
        if not isinstance(endpoint, str) or not is_tailscale_ipv4(endpoint):
            raise RecoveryError(f'local runtime override for {target!r} has no valid Tailscale endpoint')
        return endpoint

    def execute(self, target_name: str, bootstrap_host: str, reason: str, run_id: str | None = None) -> RecoveryState:
        self.assert_pi5()
        generated_run_id = run_id or f"pi4-recovery-{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}-{secrets.token_hex(3)}"
        state = self.create_state(target_name, bootstrap_host, generated_run_id, reason)
        result_path = self.project / 'logs' / 'recovery' / f'{generated_run_id}-ansible-result.json'
        try:
            plan = self.build_plan(target_name, bootstrap_host)
            state.transition('preflight-complete', releaseSha=plan.release.sha)
            if self.tcp_reachable(plan.target.original_host, 22):
                raise RecoveryError('previous production endpoint still accepts TCP/22; refusing possible duplicate terminal')
            if self._ssh_identity(plan.bootstrap_host, plan.target.user) != plan.target.user:
                raise RecoveryError('bootstrap host does not authenticate as the target inventory user')
            state.transition('bootstrap-configuring')
            self._run_bootstrap_playbook(plan, result_path)
            tailscale_ip = self._read_result(result_path, plan)
            state.transition('tailscale-endpoint-observed', tailscaleIpv4=tailscale_ip)
            override_path = self.write_runtime_override(plan, generated_run_id, tailscale_ip)
            state.transition('runtime-endpoint-saved', runtimeOverride=str(override_path))
            state.transition('validating')
            self.validate_recovered_terminal(plan)
            state.transition('completed', completedAt=utc_now())
            return state
        except Exception as error:
            state.transition('failed', failure=redact_error(error))
            if isinstance(error, RecoveryError):
                raise
            raise RecoveryError('recovery command failed; inspect the Pi5 recovery state log') from error


def parser() -> argparse.ArgumentParser:
    command = argparse.ArgumentParser(description=__doc__)
    command.add_argument('--inventory', default=str(DEFAULT_INVENTORY), help='Pi5 Ansible inventory path')
    subcommands = command.add_subparsers(dest='command', required=True)
    for name in ('plan', 'run'):
        subcommand = subcommands.add_parser(name)
        subcommand.add_argument('--target', required=True, help='existing Pi4 inventory hostname')
        subcommand.add_argument('--bootstrap-host', required=True, help='new Pi4 temporary LAN IPv4 address')
    run = subcommands.choices['run']
    run.add_argument('--confirm-recovery', action='store_true', help='required acknowledgement for mutating recovery')
    run.add_argument('--reason', required=True, help='operator incident reference or reason')
    run.add_argument('--run-id', help='optional unique recovery run identifier')
    return command


def main(argv: list[str] | None = None) -> int:
    arguments = parser().parse_args(argv)
    coordinator = RecoveryCoordinator(inventory=Path(arguments.inventory))
    try:
        if arguments.command == 'plan':
            print(json.dumps(coordinator.build_plan(arguments.target, arguments.bootstrap_host).public_dict(), ensure_ascii=False, indent=2))
            return 0
        if not arguments.confirm_recovery:
            raise RecoveryError('run requires --confirm-recovery')
        state = coordinator.execute(arguments.target, arguments.bootstrap_host, arguments.reason, arguments.run_id)
        print(json.dumps(state.payload, ensure_ascii=False, indent=2))
        return 0
    except RecoveryError as error:
        print(json.dumps({'error': str(error)}, ensure_ascii=False), file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
