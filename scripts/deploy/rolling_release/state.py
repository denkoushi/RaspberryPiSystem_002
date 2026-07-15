"""Durable per-run release state and cooperative control persistence.

Run progress and operator control intentionally live in different JSON files.
The coordinator is the sole state writer, while ``--cancel`` may write the
control record concurrently.  A shared per-run ``flock`` linearizes terminal
state and cancellation without letting a cached progress payload erase an
operator request.
"""

from __future__ import annotations

import copy
import json
import os
import stat
import tempfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Mapping

from .lock import RunLock
from .models import unit_name_for, validate_lookup_run_id


TERMINAL_STATES = frozenset({'success', 'failed', 'cancelled', 'interrupted'})
TERMINAL_EXIT_CODES = {
    'success': 0,
    'failed': 1,
    'cancelled': 130,
    'interrupted': 1,
}
STATE_VERSION = 1
CONTROL_VERSION = 1


class RunPersistenceError(RuntimeError):
    """Base error for durable run records."""


class InvalidRunIdError(ValueError):
    """Raised before an unsafe run ID can become part of a path or unit name."""


class RunRecordCorruptError(RunPersistenceError):
    """Raised when an existing state or control record violates its contract."""


class RunStateNotFoundError(RunPersistenceError):
    """Raised when an operation requires state that does not exist."""


class RunStateExistsError(RunPersistenceError):
    """Raised when a coordinator tries to recreate an existing run."""


class RunAlreadyTerminalError(RunPersistenceError):
    """Raised when an operation would mutate an immutable terminal run."""


@dataclass(frozen=True)
class RunPaths:
    state: Path
    control: Path
    lock: Path


@dataclass(frozen=True)
class RunSnapshot:
    state: dict[str, Any] | None
    control: dict[str, Any] | None


@dataclass(frozen=True)
class CancelRequestResult:
    record: dict[str, Any]
    created: bool


StateMutator = Callable[[dict[str, Any]], Mapping[str, Any] | None]
TerminalHook = Callable[[str], Mapping[str, Any] | None]
Clock = Callable[[], str]


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')


def validate_run_id(run_id: str) -> str:
    try:
        return validate_lookup_run_id(run_id)
    except ValueError as error:
        raise InvalidRunIdError(
            'run ID must be 3-80 characters using only letters, digits, underscore, or hyphen',
        ) from error


def systemd_unit_name(run_id: str) -> str:
    return unit_name_for(validate_run_id(run_id))


def run_paths(root: Path, run_id: str) -> RunPaths:
    safe_id = validate_run_id(run_id)
    directory = Path(root)
    return RunPaths(
        state=directory / f'{safe_id}.json',
        control=directory / f'{safe_id}.control.json',
        lock=directory / f'{safe_id}.lock',
    )


def _atomic_json(path: Path, payload: Mapping[str, Any]) -> None:
    """Persist JSON with a synced file and synced atomic directory update."""

    encoded = (json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + '\n').encode('utf-8')
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    fd, temporary_name = tempfile.mkstemp(
        prefix=f'.{path.name}.', suffix='.tmp', dir=path.parent,
    )
    temporary = Path(temporary_name)
    replaced = False
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, 'wb', closefd=True) as stream:
            fd = -1
            stream.write(encoded)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        replaced = True
        directory_flags = os.O_RDONLY | getattr(os, 'O_DIRECTORY', 0) | getattr(os, 'O_CLOEXEC', 0)
        directory_fd = os.open(path.parent, directory_flags)
        try:
            if not stat.S_ISDIR(os.fstat(directory_fd).st_mode):
                raise RunPersistenceError(f'run directory is not a directory: {path.parent}')
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    finally:
        if fd >= 0:
            os.close(fd)
        if not replaced:
            temporary.unlink(missing_ok=True)


def _read_json(path: Path) -> dict[str, Any] | None:
    try:
        raw = path.read_text(encoding='utf-8')
    except FileNotFoundError:
        return None
    try:
        payload = json.loads(raw)
    except (json.JSONDecodeError, UnicodeDecodeError) as error:
        raise RunRecordCorruptError(f'invalid JSON in {path}') from error
    if not isinstance(payload, dict):
        raise RunRecordCorruptError(f'run record must be a JSON object: {path}')
    return payload


def _validate_record_identity(
    payload: Mapping[str, Any], *, run_id: str, version: int, path: Path,
) -> None:
    if payload.get('version') != version:
        raise RunRecordCorruptError(f'unsupported record version in {path}')
    if payload.get('runId') != run_id:
        raise RunRecordCorruptError(f'run ID does not match record path: {path}')


class RunStateStore:
    """Read and atomically mutate one directory of per-run records."""

    def __init__(self, root: Path, *, clock: Clock = utc_now) -> None:
        self.root = Path(root)
        self._clock = clock

    def paths(self, run_id: str) -> RunPaths:
        return run_paths(self.root, run_id)

    def read_state(self, run_id: str) -> dict[str, Any] | None:
        paths = self.paths(run_id)
        return self._read_state(paths, run_id)

    def read_control(self, run_id: str) -> dict[str, Any] | None:
        paths = self.paths(run_id)
        return self._read_control(paths, run_id)

    def read_snapshot(self, run_id: str) -> RunSnapshot:
        paths = self.paths(run_id)
        with RunLock(paths.lock):
            return RunSnapshot(
                state=self._read_state(paths, run_id),
                control=self._read_control(paths, run_id),
            )

    def create_state(self, run_id: str, payload: Mapping[str, Any]) -> dict[str, Any]:
        paths = self.paths(run_id)
        with RunLock(paths.lock):
            if paths.state.exists():
                raise RunStateExistsError(f'run state already exists: {run_id}')
            state = self._normalize_state(run_id, payload, paths.state)
            control = self._read_control(paths, run_id)
            if state['state'] == 'success' and control is not None:
                state['state'] = 'cancelled'
            timestamp = self._clock()
            state['updatedAt'] = timestamp
            if state['state'] in TERMINAL_STATES:
                state.setdefault('completedAt', timestamp)
                state.setdefault('endedAt', timestamp)
                state['exitCode'] = TERMINAL_EXIT_CODES[state['state']]
            _atomic_json(paths.state, state)
            return copy.deepcopy(state)

    def update_state(self, run_id: str, mutator: StateMutator) -> dict[str, Any]:
        """Update freshly-read nonterminal state under the per-run lock.

        The callback may mutate its private copy in place and return ``None``,
        or return a replacement mapping.  Terminal transitions must use
        :meth:`finish_state` so cancellation can be resolved atomically.
        """

        paths = self.paths(run_id)
        with RunLock(paths.lock):
            current = self._require_state(paths, run_id)
            if current.get('state') in TERMINAL_STATES:
                raise RunAlreadyTerminalError(f'run is already terminal: {run_id}')
            working = copy.deepcopy(current)
            replacement = mutator(working)
            if replacement is not None:
                working = dict(replacement)
            state = self._normalize_state(run_id, working, paths.state)
            if state['state'] in TERMINAL_STATES:
                raise RunPersistenceError('terminal transitions must use finish_state()')
            state['updatedAt'] = self._clock()
            _atomic_json(paths.state, state)
            return copy.deepcopy(state)

    def finish_state(
        self,
        run_id: str,
        terminal_state: str,
        *,
        changes: Mapping[str, Any] | None = None,
        before_persist: TerminalHook | None = None,
    ) -> dict[str, Any]:
        """Make a terminal transition that cannot race past cancellation.

        A cancellation written before a proposed ``success`` wins and the run
        becomes ``cancelled``.  A terminal state written first is immutable, so
        a later cancellation request is rejected without creating control.
        Failures and interruptions remain failures or interruptions: the
        presence of a control record alone must not hide a real failure.
        """

        if terminal_state not in TERMINAL_STATES:
            raise ValueError(f'not a terminal run state: {terminal_state}')
        paths = self.paths(run_id)
        with RunLock(paths.lock):
            current = self._require_state(paths, run_id)
            current_state = current.get('state')
            if current_state in TERMINAL_STATES:
                if current_state == terminal_state:
                    return copy.deepcopy(current)
                if current_state == 'cancelled' and terminal_state == 'success':
                    return copy.deepcopy(current)
                raise RunAlreadyTerminalError(
                    f'run is already terminal as {current_state}: {run_id}',
                )
            control = self._read_control(paths, run_id)
            effective_state = 'cancelled' if terminal_state == 'success' and control is not None else terminal_state
            state = copy.deepcopy(current)
            if changes is not None:
                state.update(copy.deepcopy(dict(changes)))
            # This hook runs under the same per-run lock used by cancel. The
            # authoritative fleet state can therefore use the already
            # arbitrated effective state before this compatibility snapshot is
            # persisted, without a success/cancel split between the stores.
            if before_persist is not None:
                hook_changes = before_persist(effective_state)
                if hook_changes is not None:
                    state.update(copy.deepcopy(dict(hook_changes)))
            state['state'] = effective_state
            state = self._normalize_state(run_id, state, paths.state)
            timestamp = self._clock()
            state['updatedAt'] = timestamp
            state['completedAt'] = timestamp
            state['endedAt'] = timestamp
            # Resolve metadata only after cancellation arbitration.  A cancel
            # record that wins over proposed success must never leave the
            # public status as ``cancelled`` with exit code zero.
            state['exitCode'] = TERMINAL_EXIT_CODES[effective_state]
            _atomic_json(paths.state, state)
            return copy.deepcopy(state)

    def request_cancel(
        self,
        run_id: str,
        reason: str,
        *,
        requested_by: str = 'operator-cli',
    ) -> CancelRequestResult:
        """Write one immutable cooperative-cancel request.

        Repeated calls return the first request unchanged.  State is optional
        because systemd may accept a unit before its coordinator creates the
        run JSON; the backend must establish that the unit exists first.
        """

        safe_id = validate_run_id(run_id)
        normalized_reason = self._validate_reason(reason)
        normalized_actor = self._validate_requested_by(requested_by)
        paths = self.paths(safe_id)
        with RunLock(paths.lock):
            existing = self._read_control(paths, safe_id)
            if existing is not None:
                return CancelRequestResult(copy.deepcopy(existing), False)
            state = self._read_state(paths, safe_id)
            if state is not None and state.get('state') in TERMINAL_STATES:
                raise RunAlreadyTerminalError(
                    f'cannot cancel terminal run {safe_id}: {state.get("state")}',
                )
            record: dict[str, Any] = {
                'version': CONTROL_VERSION,
                'runId': safe_id,
                'unitName': systemd_unit_name(safe_id),
                'requestedAt': self._clock(),
                'requestedBy': normalized_actor,
                'reason': normalized_reason,
            }
            _atomic_json(paths.control, record)
            return CancelRequestResult(copy.deepcopy(record), True)

    def _require_state(self, paths: RunPaths, run_id: str) -> dict[str, Any]:
        state = self._read_state(paths, run_id)
        if state is None:
            raise RunStateNotFoundError(f'run state not found: {run_id}')
        return state

    @staticmethod
    def _normalize_state(
        run_id: str, payload: Mapping[str, Any], path: Path,
    ) -> dict[str, Any]:
        if not isinstance(payload, Mapping):
            raise TypeError('run state must be a mapping')
        state = copy.deepcopy(dict(payload))
        supplied_version = state.setdefault('version', STATE_VERSION)
        supplied_run_id = state.setdefault('runId', run_id)
        if supplied_version != STATE_VERSION:
            raise RunRecordCorruptError(f'unsupported state version for {run_id}')
        if supplied_run_id != run_id:
            raise RunRecordCorruptError(f'run ID does not match state path: {path}')
        if not isinstance(state.get('state'), str) or not state['state']:
            raise RunRecordCorruptError(f'run state is missing a state value: {path}')
        return state

    @staticmethod
    def _validate_reason(reason: str) -> str:
        if not isinstance(reason, str):
            raise ValueError('cancel reason must be text')
        normalized = reason.strip()
        if not normalized:
            raise ValueError('cancel reason must not be empty')
        if len(normalized) > 1024 or '\x00' in normalized:
            raise ValueError('cancel reason must be at most 1024 characters and contain no NUL')
        return normalized

    @staticmethod
    def _validate_requested_by(requested_by: str) -> str:
        if not isinstance(requested_by, str):
            raise ValueError('cancel requester must be text')
        normalized = requested_by.strip()
        if not normalized or len(normalized) > 128 or any(not char.isprintable() for char in normalized):
            raise ValueError('cancel requester must be 1-128 printable characters')
        return normalized

    @staticmethod
    def _read_state(paths: RunPaths, run_id: str) -> dict[str, Any] | None:
        state = _read_json(paths.state)
        if state is None:
            return None
        _validate_record_identity(
            state, run_id=run_id, version=STATE_VERSION, path=paths.state,
        )
        if not isinstance(state.get('state'), str) or not state['state']:
            raise RunRecordCorruptError(f'run state is missing a state value: {paths.state}')
        return state

    @staticmethod
    def _read_control(paths: RunPaths, run_id: str) -> dict[str, Any] | None:
        control = _read_json(paths.control)
        if control is None:
            return None
        _validate_record_identity(
            control, run_id=run_id, version=CONTROL_VERSION, path=paths.control,
        )
        expected_unit = systemd_unit_name(run_id)
        required_strings = ('unitName', 'requestedAt', 'requestedBy', 'reason')
        if any(not isinstance(control.get(field), str) or not control[field] for field in required_strings):
            raise RunRecordCorruptError(f'cancel control record is incomplete: {paths.control}')
        if control['unitName'] != expected_unit:
            raise RunRecordCorruptError(f'cancel control unit does not match run ID: {paths.control}')
        try:
            RunStateStore._validate_reason(control['reason'])
            RunStateStore._validate_requested_by(control['requestedBy'])
        except ValueError as error:
            raise RunRecordCorruptError(f'cancel control record is malformed: {paths.control}') from error
        return control
