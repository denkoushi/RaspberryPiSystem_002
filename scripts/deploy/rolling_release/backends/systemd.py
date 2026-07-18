"""Transient-systemd execution backend for one remote release identity."""
from __future__ import annotations

import base64
import json
import os
import re
from pathlib import Path, PurePosixPath
from typing import Iterable

from .. import bootstrap, migration_preflight, terminal_preflight
from ..models import LaunchSpec, UnitObservation, unit_name_for, validate_lookup_run_id
from .command import CommandResult, SshTransport, SubprocessRunner


DEFAULT_REMOTE_PROJECT = PurePosixPath('/opt/RaspberryPiSystem_002')
DEFAULT_REMOTE_USER = 'denkon5sd02'
DEFAULT_REMOTE_HOME = PurePosixPath('/home/denkon5sd02')
DEFAULT_REMOTE_PATH = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
SUDO = '/usr/bin/sudo'
SYSTEMD_RUN = '/usr/bin/systemd-run'
SYSTEMCTL = '/usr/bin/systemctl'
REMOTE_PYTHON = '/usr/bin/python3'
BOOTSTRAP_LOADER = (
    "import base64,sys;source,payload=sys.argv[1:];"
    "sys.argv=['rolling-release-bootstrap',base64.b64decode(payload).decode('utf-8')];"
    "exec(compile(base64.b64decode(source),'<rolling-release-bootstrap>','exec'),"
    "{'__name__':'__main__'})"
)
MIGRATION_PREFLIGHT_LOADER = (
    "import base64,sys;source,payload=sys.argv[1:];"
    "sys.argv=['migration-preflight',base64.b64decode(payload).decode('utf-8')];"
    "exec(compile(base64.b64decode(source),'<migration-preflight>','exec'),"
    "{'__name__':'__main__'})"
)
TERMINAL_PREFLIGHT_LOADER = (
    "import base64,sys;source,payload=sys.argv[1:];"
    "decoded=base64.b64decode(source).decode('utf-8');"
    "sys.argv=['terminal-preflight',base64.b64decode(payload).decode('utf-8')];"
    "exec(compile(decoded,'<terminal-preflight>','exec'),"
    "{'__name__':'__main__','EMBEDDED_TERMINAL_PREFLIGHT_SOURCE':decoded})"
)
_USER_RE = re.compile(r'^[a-z_][a-z0-9_-]{0,30}$')
SHOW_PROPERTIES = (
    'LoadState',
    'ActiveState',
    'SubState',
    'Result',
    'ExecMainCode',
    'ExecMainStatus',
)
IDENTITY_PROPERTIES = ('InvocationID', 'MainPID')


def _load_bootstrap_source() -> str:
    source_path = Path(bootstrap.__file__ or '')
    if not source_path.is_file():
        raise RuntimeError('standalone rolling-release bootstrap source is unavailable')
    return source_path.read_text(encoding='utf-8')


def _load_migration_preflight_source() -> str:
    source_path = Path(migration_preflight.__file__ or '')
    if not source_path.is_file():
        raise RuntimeError('standalone migration preflight source is unavailable')
    return source_path.read_text(encoding='utf-8')


def _load_terminal_preflight_source() -> str:
    source_path = Path(terminal_preflight.__file__ or '')
    if not source_path.is_file():
        raise RuntimeError('standalone terminal preflight source is unavailable')
    return source_path.read_text(encoding='utf-8')


def _parse_properties(lines: Iterable[str]) -> dict[str, str]:
    properties: dict[str, str] = {}
    for raw in lines:
        key, separator, value = raw.partition('=')
        if separator and key in SHOW_PROPERTIES:
            properties[key] = value
    return properties


def _integer(value: str | None) -> int | None:
    if value is None or value == '':
        return None
    try:
        return int(value)
    except ValueError:
        return None


def _encode_argument(value: str) -> str:
    return base64.b64encode(value.encode('utf-8')).decode('ascii')


def _reports_missing_unit(output: str, unit_name: str) -> bool:
    expected = f'unit {unit_name} could not be found.'.casefold()
    return any(line.strip().casefold() == expected for line in output.splitlines())


def validate_current_execution_identity(
    run_id: str,
    invocation_id: str,
    *,
    runner=None,
    pid: int | None = None,
) -> None:
    """Prove the remote runner is the main process of its named systemd unit."""
    validate_lookup_run_id(run_id)
    if not isinstance(invocation_id, str) or not re.fullmatch(r'[0-9a-fA-F]{32}', invocation_id):
        raise RuntimeError('systemd invocation identity is missing or malformed')
    command_runner = runner or SubprocessRunner()
    current_pid = os.getpid() if pid is None else pid
    unit_name = unit_name_for(run_id)
    command = [SUDO, '-n', SYSTEMCTL, 'show', '--no-pager']
    command.extend(f'--property={name}' for name in IDENTITY_PROPERTIES)
    command.extend(['--', unit_name])
    result = command_runner.run(command)
    if result.returncode != 0:
        raise RuntimeError(
            (result.stderr or result.stdout or 'systemctl could not verify release identity').strip()
        )
    properties: dict[str, str] = {}
    for line in result.stdout.splitlines():
        key, separator, value = line.partition('=')
        if separator and key in IDENTITY_PROPERTIES:
            properties[key] = value
    if properties.get('InvocationID', '').casefold() != invocation_id.casefold():
        raise RuntimeError('systemd invocation does not match the release unit')
    if properties.get('MainPID') != str(current_pid):
        raise RuntimeError('release coordinator is not the systemd unit main process')


class SystemdBackend:
    def __init__(
        self,
        transport: SshTransport,
        *,
        remote_project: PurePosixPath = DEFAULT_REMOTE_PROJECT,
        remote_user: str = DEFAULT_REMOTE_USER,
        remote_home: PurePosixPath = DEFAULT_REMOTE_HOME,
        bootstrap_source: str | None = None,
        migration_preflight_source: str | None = None,
        terminal_preflight_source: str | None = None,
    ) -> None:
        project = str(remote_project)
        if (
            not remote_project.is_absolute()
            or '..' in remote_project.parts
            or '\x00' in project
            or str(PurePosixPath(project)) != project
        ):
            raise ValueError('remote project must be a normalized absolute POSIX path')
        home = str(remote_home)
        if (
            not isinstance(remote_user, str)
            or not _USER_RE.fullmatch(remote_user)
            or not remote_home.is_absolute()
            or '..' in remote_home.parts
            or '\x00' in home
            or str(PurePosixPath(home)) != home
        ):
            raise ValueError('remote execution identity is malformed')
        self.transport = transport
        self.remote_project = remote_project
        self.remote_user = remote_user
        self.remote_home = remote_home
        self.bootstrap_source = bootstrap_source if bootstrap_source is not None else _load_bootstrap_source()
        if not self.bootstrap_source.strip():
            raise ValueError('bootstrap source must not be empty')
        self.migration_preflight_source = (
            migration_preflight_source
            if migration_preflight_source is not None
            else _load_migration_preflight_source()
        )
        if not self.migration_preflight_source.strip():
            raise ValueError('migration preflight source must not be empty')
        self.terminal_preflight_source = (
            terminal_preflight_source
            if terminal_preflight_source is not None
            else _load_terminal_preflight_source()
        )
        if not self.terminal_preflight_source.strip():
            raise ValueError('terminal preflight source must not be empty')

    def release_state_path(self, run_id: str) -> PurePosixPath:
        validate_lookup_run_id(run_id)
        return self.remote_project / 'logs/deploy/release-runs' / f'{run_id}.json'

    def control_path(self, run_id: str) -> PurePosixPath:
        validate_lookup_run_id(run_id)
        return self.remote_project / 'logs/deploy/release-runs' / f'{run_id}.control.json'

    def build_start_command(self, spec: LaunchSpec, *, wait: bool) -> tuple[str, ...]:
        if type(wait) is not bool:
            raise TypeError('wait must be boolean')
        spec.validate()
        payload = spec.bootstrap_payload(str(self.remote_project))
        serialized_payload = json.dumps(
            payload,
            ensure_ascii=False,
            sort_keys=True,
            separators=(',', ':'),
        )
        command = [
            SUDO,
            '-n',
            SYSTEMD_RUN,
            '--quiet',
            f'--unit={spec.unit_name}',
            f'--uid={self.remote_user}',
            f'--setenv=HOME={self.remote_home}',
            f'--setenv=USER={self.remote_user}',
            f'--setenv=LOGNAME={self.remote_user}',
            f'--setenv=PATH={DEFAULT_REMOTE_PATH}',
            '--property=Type=exec',
            f'--property=WorkingDirectory={self.remote_project}',
            '--property=KillMode=control-group',
            '--property=Restart=no',
            '--property=UMask=0077',
            '--property=StandardOutput=journal',
            '--property=StandardError=journal',
        ]
        if wait:
            command.append('--wait')
        command.extend([
            '--',
            REMOTE_PYTHON,
            '-c',
            BOOTSTRAP_LOADER,
            _encode_argument(self.bootstrap_source),
            _encode_argument(serialized_payload),
        ])
        return tuple(command)

    def start(self, spec: LaunchSpec, *, wait: bool) -> CommandResult:
        """Submit the unit; foreground uses systemd-run's service wait contract."""
        return self.transport.run(self.build_start_command(spec, wait=wait))

    def build_migration_preflight_command(self, spec: LaunchSpec) -> tuple[str, ...]:
        """Build the read-only gate that must pass before a release unit exists."""
        spec.validate()
        payload = {
            'version': 1,
            'project': str(self.remote_project),
            'runId': spec.run_id,
            'branch': spec.branch,
            'sha': spec.sha,
            'expectedServerClientId': spec.expected_server_client_id,
        }
        serialized = json.dumps(
            payload,
            ensure_ascii=False,
            sort_keys=True,
            separators=(',', ':'),
        )
        return (
            REMOTE_PYTHON,
            '-c',
            MIGRATION_PREFLIGHT_LOADER,
            _encode_argument(self.migration_preflight_source),
            _encode_argument(serialized),
        )

    def preflight_migrations(self, spec: LaunchSpec) -> CommandResult:
        """Read the live ledger and reject unsafe SQL before unit submission."""
        return self.transport.run(self.build_migration_preflight_command(spec))

    def build_terminal_preflight_command(
        self, spec: LaunchSpec, targets: list[dict[str, object]]
    ) -> tuple[str, ...]:
        """Build the aggregate read-only terminal gate run before submission."""
        spec.validate()
        payload = {
            'version': 1,
            'mode': 'orchestrator',
            'project': str(self.remote_project),
            'runId': spec.run_id,
            'sha': spec.sha,
            'expectedServerClientId': spec.expected_server_client_id,
            'targets': targets,
        }
        serialized = json.dumps(
            payload,
            ensure_ascii=False,
            sort_keys=True,
            separators=(',', ':'),
        )
        # Parse locally before SSH so malformed or secret-bearing contracts
        # cannot reach Pi5.
        terminal_preflight.parse_spec(serialized)
        return (
            REMOTE_PYTHON,
            '-c',
            TERMINAL_PREFLIGHT_LOADER,
            _encode_argument(self.terminal_preflight_source),
            _encode_argument(serialized),
        )

    def preflight_terminals(
        self, spec: LaunchSpec, targets: list[dict[str, object]]
    ) -> CommandResult:
        return self.transport.run(self.build_terminal_preflight_command(spec, targets))

    def show(self, run_id: str) -> UnitObservation:
        unit_name = unit_name_for(run_id)
        command = [SUDO, '-n', SYSTEMCTL, 'show', '--no-pager']
        command.extend(f'--property={name}' for name in SHOW_PROPERTIES)
        command.extend(['--', unit_name])
        result = self.transport.run(command)
        properties = _parse_properties(result.stdout.splitlines())

        combined = f'{result.stdout}\n{result.stderr}'.lower()
        explicitly_missing = result.returncode != 255 and (
            properties.get('LoadState') == 'not-found'
            or _reports_missing_unit(combined, unit_name)
        )
        if explicitly_missing:
            return UnitObservation(
                unit_name=unit_name,
                reachable=True,
                load_state='not-found',
                active_state=properties.get('ActiveState'),
                sub_state=properties.get('SubState'),
                result=properties.get('Result'),
                exec_main_code=properties.get('ExecMainCode'),
                exec_main_status=_integer(properties.get('ExecMainStatus')),
            )
        if result.returncode != 0:
            return UnitObservation(
                unit_name=unit_name,
                reachable=False,
                error=(result.stderr or result.stdout or 'systemctl show failed').strip(),
            )
        if 'LoadState' not in properties:
            return UnitObservation(
                unit_name=unit_name,
                reachable=False,
                error='systemctl show returned no LoadState property',
            )
        return UnitObservation(
            unit_name=unit_name,
            reachable=True,
            load_state=properties.get('LoadState'),
            active_state=properties.get('ActiveState'),
            sub_state=properties.get('SubState'),
            result=properties.get('Result'),
            exec_main_code=properties.get('ExecMainCode'),
            exec_main_status=_integer(properties.get('ExecMainStatus')),
        )

    def signal_cancel(self, run_id: str) -> CommandResult:
        """Wake only the main process after the state owner records a reason."""
        unit_name = unit_name_for(run_id)
        return self.transport.run([
            SUDO,
            '-n',
            SYSTEMCTL,
            'kill',
            '--kill-whom=main',
            '--signal=SIGUSR1',
            '--',
            unit_name,
        ])
