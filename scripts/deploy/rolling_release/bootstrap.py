#!/usr/bin/env python3
"""Standalone pre-checkout bootstrap for a transient release unit.

This file intentionally imports only the Python standard library and does not
use ``__file__``.  The local systemd adapter sends this exact trusted source to
the Pi5 as ``python3 -c`` so the first release containing this package does not
depend on the Pi5's old checkout already having the module.
"""
from __future__ import annotations

import fcntl
import json
import os
import re
import signal
import stat
import subprocess
import sys
from pathlib import Path, PurePosixPath
from typing import Any, Callable, Mapping, Sequence


EX_OK = 0
EX_SOFTWARE = 70
EX_TEMPFAIL = 75
EX_CONFIG = 78
EX_CANCELLED = 130
PROTOCOL_PATH = Path("scripts/deploy/rolling_release/PROTOCOL")
PROTOCOL_VALUE = "raspi-rolling-release-v2\n"
ALLOWED_PRECHECK_UNTRACKED = frozenset({'?? power-actions/'})
NEW_RUN_ID_RE = re.compile(r'^[0-9]{8}-[0-9]{6}-[0-9a-f]{6}$')
FULL_SHA_RE = re.compile(r'^[0-9a-f]{40}$')
UNIT_PREFIX = 'raspi-release-'
UNIT_SUFFIX = '.service'
EXPECTED_KEYS = frozenset({
    'version',
    'project',
    'runId',
    'unitName',
    'branch',
    'sha',
    'inventory',
    'expectedServerClientId',
    'limit',
    'canaryHoldTimeout',
    'emergencyOverride',
    'reason',
    'skipCanaryHold',
    'fullFleet',
})
FORBIDDEN_REF_CHARACTERS = frozenset(' ~^:?*[\\')


class BootstrapConfigError(ValueError):
    """The controller supplied a malformed or unsafe bootstrap contract."""


def has_blocking_precheckout_changes(raw_status: str) -> bool:
    """Allow only the known Pi5 runtime queue while the old checkout is active."""

    return any(
        line not in ALLOWED_PRECHECK_UNTRACKED
        for line in raw_status.splitlines()
        if line
    )


class CancellationLatch:
    """A signal-safe flag; the control file remains cancellation authority."""

    def __init__(self) -> None:
        self.requested = False

    def handle(self, _signum: int, _frame: Any) -> None:
        self.requested = True


def _require_string(
    payload: Mapping[str, Any],
    key: str,
    *,
    maximum: int,
    allow_empty: bool = False,
) -> str:
    value = payload.get(key)
    if not isinstance(value, str) or '\x00' in value or len(value) > maximum:
        raise BootstrapConfigError(f'{key} is malformed or too long')
    if not allow_empty and not value:
        raise BootstrapConfigError(f'{key} is required')
    return value


def _valid_branch(branch: str) -> bool:
    if not branch or branch.startswith(('-', '/', '.')) or branch.endswith(('/', '.')):
        return False
    if branch == '@' or '..' in branch or '//' in branch or '@{' in branch:
        return False
    if any(component.endswith('.lock') or component.startswith('.') for component in branch.split('/')):
        return False
    if any(ord(character) < 32 or ord(character) == 127 for character in branch):
        return False
    return not any(character in FORBIDDEN_REF_CHARACTERS for character in branch)


def parse_spec(raw: str) -> dict[str, Any]:
    try:
        payload = json.loads(raw)
    except (TypeError, json.JSONDecodeError) as error:
        raise BootstrapConfigError('bootstrap specification is not valid JSON') from error
    if not isinstance(payload, dict) or set(payload) != EXPECTED_KEYS:
        raise BootstrapConfigError('bootstrap specification fields do not match version 2')
    if payload.get('version') != 2 or type(payload.get('version')) is not int:
        raise BootstrapConfigError('unsupported bootstrap specification version')

    project = _require_string(payload, 'project', maximum=4096)
    if not os.path.isabs(project) or os.path.normpath(project) != project:
        raise BootstrapConfigError('project must be a normalized absolute path')
    run_id = _require_string(payload, 'runId', maximum=80)
    if not NEW_RUN_ID_RE.fullmatch(run_id):
        raise BootstrapConfigError('runId must use YYYYMMDD-HHMMSS-<6 lowercase hex>')
    unit_name = _require_string(payload, 'unitName', maximum=128)
    if unit_name != f'{UNIT_PREFIX}{run_id}{UNIT_SUFFIX}':
        raise BootstrapConfigError('unitName does not match runId')
    branch = _require_string(payload, 'branch', maximum=255)
    if not _valid_branch(branch):
        raise BootstrapConfigError('branch is not a valid Git ref')
    sha = _require_string(payload, 'sha', maximum=40)
    if not FULL_SHA_RE.fullmatch(sha):
        raise BootstrapConfigError('sha must be 40 lowercase hexadecimal characters')

    inventory = _require_string(payload, 'inventory', maximum=1000)
    inventory_path = PurePosixPath(inventory)
    if (
        inventory_path.is_absolute()
        or str(inventory_path) != inventory
        or any(part in ('', '.', '..') for part in inventory_path.parts)
    ):
        raise BootstrapConfigError('inventory must be a normalized relative path')
    _require_string(payload, 'limit', maximum=1000, allow_empty=True)
    server_client_id = _require_string(payload, 'expectedServerClientId', maximum=128)
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._:-]{0,127}', server_client_id):
        raise BootstrapConfigError('expectedServerClientId is malformed')

    timeout = payload.get('canaryHoldTimeout')
    if type(timeout) is not int or timeout <= 0:
        raise BootstrapConfigError('canaryHoldTimeout must be a positive integer')
    for key in ('emergencyOverride', 'skipCanaryHold', 'fullFleet'):
        if type(payload.get(key)) is not bool:
            raise BootstrapConfigError(f'{key} must be boolean')
    if payload['fullFleet'] and payload['limit']:
        raise BootstrapConfigError('fullFleet cannot be combined with limit')
    reason = payload.get('reason')
    if reason is not None:
        if not isinstance(reason, str) or '\x00' in reason or len(reason) > 1000:
            raise BootstrapConfigError('reason is malformed or too long')
        if not payload['emergencyOverride']:
            raise BootstrapConfigError('reason is only valid with emergencyOverride')
    if payload['emergencyOverride'] and not (reason and reason.strip()):
        raise BootstrapConfigError('emergencyOverride requires a reason')
    if payload['skipCanaryHold'] and not (
        payload['emergencyOverride'] and reason and reason.strip()
    ):
        raise BootstrapConfigError(
            'skipCanaryHold requires emergencyOverride and a reason'
        )
    return payload


def control_file(spec: Mapping[str, Any]) -> str:
    return os.path.join(
        str(spec['project']),
        'logs',
        'deploy',
        'release-runs',
        f'{spec["runId"]}.control.json',
    )


def fleet_lock_file(spec: Mapping[str, Any]) -> str:
    return os.path.join(
        str(spec['project']), 'logs', 'deploy', 'fleet-release-state.lock'
    )


def _open_nonblocking_lock(path: str) -> int:
    os.makedirs(os.path.dirname(path), mode=0o700, exist_ok=True)
    flags = os.O_WRONLY | os.O_CREAT | getattr(os, 'O_CLOEXEC', 0)
    flags |= getattr(os, 'O_NOFOLLOW', 0)
    descriptor = os.open(path, flags, 0o600)
    try:
        if not stat.S_ISREG(os.fstat(descriptor).st_mode):
            raise OSError(f'lock path is not a regular file: {path}')
        os.fchmod(descriptor, 0o600)
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BaseException:
        os.close(descriptor)
        raise
    return descriptor


def remote_arguments(spec: Mapping[str, Any]) -> list[str]:
    arguments = [
        '/usr/bin/python3',
        os.path.join(str(spec['project']), 'scripts', 'deploy', 'rolling-release.py'),
        '--remote-run',
        '--branch',
        str(spec['branch']),
        '--sha',
        str(spec['sha']),
        '--inventory',
        str(spec['inventory']),
        '--run-id',
        str(spec['runId']),
        '--expected-server-client-id',
        str(spec['expectedServerClientId']),
        '--limit',
        str(spec['limit']),
        '--canary-hold-timeout',
        str(spec['canaryHoldTimeout']),
    ]
    if spec['emergencyOverride']:
        arguments.extend(['--emergency-override', '--reason', str(spec['reason'])])
    if spec['skipCanaryHold']:
        arguments.append('--skip-canary-hold')
    if spec['fullFleet']:
        arguments.append('--full-fleet')
    return arguments


def read_local_server_client_id(
    path: str = '/etc/raspi-status-agent.conf',
) -> str:
    """Read one non-secret identity without following a substituted config."""

    flags = os.O_RDONLY | getattr(os, 'O_CLOEXEC', 0) | getattr(os, 'O_NOFOLLOW', 0)
    descriptor = os.open(path, flags)
    try:
        if not stat.S_ISREG(os.fstat(descriptor).st_mode):
            raise OSError('status-agent config is not a regular file')
        payload = os.read(descriptor, 65537)
    finally:
        os.close(descriptor)
    if len(payload) > 65536:
        raise OSError('status-agent config is too large')
    text = payload.decode('utf-8')
    pattern = re.compile(
        r'''^[ \t]*CLIENT_ID[ \t]*=[ \t]*(?:"([A-Za-z0-9][A-Za-z0-9._:-]{0,127})"|'([A-Za-z0-9][A-Za-z0-9._:-]{0,127})'|([A-Za-z0-9][A-Za-z0-9._:-]{0,127}))[ \t]*(?:#.*)?$'''
    )
    values = [
        next(value for value in match.groups() if value is not None)
        for line in text.splitlines()
        if (match := pattern.fullmatch(line)) is not None
    ]
    if len(values) != 1:
        raise OSError('status-agent CLIENT_ID is missing or duplicated')
    return values[0]


def _default_run(
    argv: Sequence[str],
    *,
    cwd: str,
    capture_output: bool = False,
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        list(argv),
        cwd=cwd,
        text=True,
        capture_output=capture_output,
        check=False,
    )


def _exit_code(completed: Any) -> int:
    value = getattr(completed, 'returncode', None)
    return value if type(value) is int and 0 < value <= 255 else 1


def execute(
    spec: Mapping[str, Any],
    *,
    run_command: Callable[..., Any] = _default_run,
    execve: Callable[[str, Sequence[str], Mapping[str, str]], Any] = os.execve,
    signal_requested: Callable[[], bool] = lambda: False,
    environ: Mapping[str, str] | None = None,
    server_client_id_reader: Callable[[], str] | None = None,
) -> int:
    """Own the kernel lock before every fetch, checkout, or coordinator write."""
    project = str(spec['project'])
    cancellation_path = control_file(spec)
    fleet_lock_path = fleet_lock_file(spec)
    fleet_lock_fd: int | None = None
    original_cwd = os.getcwd()
    changed_directory = False
    pre_exec_signal_handler: Any = None
    signal_ignored_for_exec = False

    def cancelled() -> bool:
        # lexists also stops for a broken or malicious symlink: malformed
        # cancellation state can never make a release continue.
        # SIGUSR1 is deliberately only a wake-up hint.  The durable control
        # record is the sole authority, so a stray signal cannot cancel a run.
        signal_requested()
        return os.path.lexists(cancellation_path)

    try:
        try:
            fleet_lock_fd = _open_nonblocking_lock(fleet_lock_path)
        except (BlockingIOError, OSError) as error:
            print(f'[ERROR] could not acquire fleet release lock: {error}', file=sys.stderr)
            return EX_TEMPFAIL

        if cancelled():
            return EX_CANCELLED

        try:
            server_client_id = (
                server_client_id_reader or read_local_server_client_id
            )()
        except (OSError, UnicodeError) as error:
            print(f'[ERROR] remote Pi5 identity is unavailable: {error}', file=sys.stderr)
            return EX_CONFIG
        if server_client_id != spec['expectedServerClientId']:
            print('[ERROR] remote Pi5 identity does not match the selected inventory', file=sys.stderr)
            return EX_CONFIG

        before = run_command(
            ['/usr/bin/git', 'status', '--porcelain=v1', '--untracked-files=normal'],
            cwd=project,
            capture_output=True,
        )
        if getattr(before, 'returncode', 1) != 0:
            return _exit_code(before)
        if has_blocking_precheckout_changes(str(getattr(before, 'stdout', ''))):
            print('[ERROR] remote worktree is not clean; refusing release checkout', file=sys.stderr)
            return EX_CONFIG
        if cancelled():
            return EX_CANCELLED

        fetch = run_command(
            ['/usr/bin/git', 'fetch', '--no-tags', 'origin', str(spec['branch'])],
            cwd=project,
            capture_output=False,
        )
        if getattr(fetch, 'returncode', 1) != 0:
            return _exit_code(fetch)
        if cancelled():
            return EX_CANCELLED

        commit = run_command(
            ['/usr/bin/git', 'cat-file', '-e', f'{spec["sha"]}^{{commit}}'],
            cwd=project,
            capture_output=False,
        )
        if getattr(commit, 'returncode', 1) != 0:
            return _exit_code(commit)
        if cancelled():
            return EX_CANCELLED

        checkout = run_command(
            ['/usr/bin/git', 'checkout', '--detach', str(spec['sha'])],
            cwd=project,
            capture_output=False,
        )
        if getattr(checkout, 'returncode', 1) != 0:
            return _exit_code(checkout)
        if cancelled():
            return EX_CANCELLED

        head = run_command(
            ['/usr/bin/git', 'rev-parse', 'HEAD'],
            cwd=project,
            capture_output=True,
        )
        if getattr(head, 'returncode', 1) != 0:
            return _exit_code(head)
        if str(getattr(head, 'stdout', '')).strip() != spec['sha']:
            print('[ERROR] checked-out HEAD does not match the immutable release SHA', file=sys.stderr)
            return EX_CONFIG
        if cancelled():
            return EX_CANCELLED

        after = run_command(
            ['/usr/bin/git', 'status', '--porcelain=v1', '--untracked-files=normal'],
            cwd=project,
            capture_output=True,
        )
        if getattr(after, 'returncode', 1) != 0:
            return _exit_code(after)
        if str(getattr(after, 'stdout', '')).strip():
            print('[ERROR] checked-out release worktree is not clean', file=sys.stderr)
            return EX_CONFIG
        if cancelled():
            return EX_CANCELLED

        try:
            protocol = (Path(project) / PROTOCOL_PATH).read_text(encoding='utf-8')
        except (OSError, UnicodeError):
            protocol = ''
        if protocol != PROTOCOL_VALUE:
            print(
                '[ERROR] target release does not support the fleet-state rolling-release v2 protocol',
                file=sys.stderr,
            )
            return EX_CONFIG
        if cancelled():
            return EX_CANCELLED

        os.set_inheritable(fleet_lock_fd, True)
        environment = dict(os.environ if environ is None else environ)
        environment.update({
            'ROLLING_RELEASE_FLEET_LOCK_FD': str(fleet_lock_fd),
            'ROLLING_RELEASE_FLEET_LOCK_PATH': fleet_lock_path,
            'ROLLING_RELEASE_CONTROL_FILE': cancellation_path,
            'ROLLING_RELEASE_UNIT': str(spec['unitName']),
            'ROLLING_RELEASE_PROTOCOL': '2',
        })
        arguments = remote_arguments(spec)
        os.chdir(project)
        changed_directory = True
        # A caught signal disposition is reset to the default across execve.
        # Ignore SIGUSR1 during the tiny exec-to-coordinator-handler window;
        # ignored dispositions survive execve, and the coordinator replaces it
        # with its cooperative handler before its first control checkpoint.
        pre_exec_signal_handler = signal.getsignal(signal.SIGUSR1)
        signal.signal(signal.SIGUSR1, signal.SIG_IGN)
        signal_ignored_for_exec = True
        execve(arguments[0], arguments, environment)
        return EX_SOFTWARE
    finally:
        # Reached only when an injected/failing execve did not replace us.
        if signal_ignored_for_exec:
            signal.signal(signal.SIGUSR1, pre_exec_signal_handler)
        if changed_directory:
            os.chdir(original_cwd)
        if fleet_lock_fd is not None:
            try:
                os.close(fleet_lock_fd)
            except OSError:
                pass


def main(argv: Sequence[str] | None = None) -> int:
    arguments = list(sys.argv[1:] if argv is None else argv)
    if len(arguments) != 1:
        print('[ERROR] bootstrap requires exactly one JSON specification', file=sys.stderr)
        return EX_CONFIG
    try:
        spec = parse_spec(arguments[0])
    except BootstrapConfigError as error:
        print(f'[ERROR] {error}', file=sys.stderr)
        return EX_CONFIG

    latch = CancellationLatch()
    previous = signal.getsignal(signal.SIGUSR1)
    signal.signal(signal.SIGUSR1, latch.handle)
    try:
        return execute(spec, signal_requested=lambda: latch.requested)
    finally:
        signal.signal(signal.SIGUSR1, previous)


if __name__ == '__main__':
    raise SystemExit(main())
