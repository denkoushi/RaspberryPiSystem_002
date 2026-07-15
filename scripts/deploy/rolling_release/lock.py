"""Process-safe per-run locks for deployment state and control records."""

from __future__ import annotations

import errno
import fcntl
import os
import stat
from pathlib import Path
from types import TracebackType

from .fleet_state import FleetLease


class RunLockError(RuntimeError):
    """Base error for a per-run persistence lock."""


class RunLockBusyError(RunLockError):
    """Raised when a non-blocking lock is already owned by another opener."""


class InheritedReleaseLockError(RunLockError):
    """Raised before state mutation when the transient unit lock is invalid."""


def _validate_inherited_lock(
    expected_path: Path,
    *,
    descriptor_variable: str,
    path_variable: str,
    label: str,
) -> int:
    """Validate one bootstrap-owned kernel lock descriptor.

    The descriptor and path must name the same regular inode.  Re-acquiring an
    exclusive non-waiting lock on that descriptor is safe for an inherited
    open-file description and also makes a directly opened-but-unlocked
    descriptor fail closed against a real owner.  The caller keeps the returned
    descriptor open for the entire coordinator lifetime.
    """

    supplied_path = os.environ.get(path_variable)
    supplied_fd = os.environ.get(descriptor_variable)
    if supplied_fd is None or not supplied_fd.isascii() or not supplied_fd.isdigit():
        raise InheritedReleaseLockError(f'{label} descriptor is missing or malformed')
    if supplied_path != str(expected_path):
        raise InheritedReleaseLockError(f'{label} path does not match the project checkout')
    descriptor = int(supplied_fd)
    if descriptor < 3:
        raise InheritedReleaseLockError(f'{label} descriptor cannot use standard input/output')
    try:
        descriptor_status = os.fstat(descriptor)
        path_status = os.lstat(expected_path)
    except OSError as error:
        raise InheritedReleaseLockError(f'{label} descriptor or path is unavailable') from error
    if not stat.S_ISREG(descriptor_status.st_mode) or not stat.S_ISREG(path_status.st_mode):
        raise InheritedReleaseLockError(f'{label} descriptor and path must be regular files')
    if (descriptor_status.st_dev, descriptor_status.st_ino) != (path_status.st_dev, path_status.st_ino):
        raise InheritedReleaseLockError(f'{label} descriptor does not match the lock path')
    # First prove that a separate open-file description cannot acquire the
    # inode.  Then re-lock the supplied descriptor: success means this exact
    # inherited open-file description is the owner; failure means another
    # process owns it.  Either check alone is insufficient.
    try:
        child = os.fork()
    except OSError as error:
        raise InheritedReleaseLockError(f'{label} ownership probe could not start') from error
    if child == 0:  # pragma: no cover - outcome is asserted in the parent
        try:
            os.close(descriptor)
            probe = os.open(
                expected_path,
                os.O_RDWR | getattr(os, 'O_CLOEXEC', 0) | getattr(os, 'O_NOFOLLOW', 0),
            )
            try:
                try:
                    fcntl.flock(probe, fcntl.LOCK_EX | fcntl.LOCK_NB)
                except OSError as error:
                    os._exit(75 if error.errno in (errno.EACCES, errno.EAGAIN) else 70)
                os._exit(0)
            finally:
                os.close(probe)
        except BaseException:
            os._exit(70)
    _pid, wait_status = os.waitpid(child, 0)
    probe_status = os.waitstatus_to_exitcode(wait_status)
    if probe_status == 0:
        raise InheritedReleaseLockError(f'{label} descriptor is not already locked')
    if probe_status != 75:
        raise InheritedReleaseLockError(f'{label} ownership probe failed')
    try:
        final_path_status = os.lstat(expected_path)
    except OSError as error:
        raise InheritedReleaseLockError(f'{label} path changed during validation') from error
    if (
        not stat.S_ISREG(final_path_status.st_mode)
        or (descriptor_status.st_dev, descriptor_status.st_ino)
        != (final_path_status.st_dev, final_path_status.st_ino)
    ):
        raise InheritedReleaseLockError(f'{label} path changed during validation')
    try:
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError as error:
        if error.errno in (errno.EACCES, errno.EAGAIN):
            raise InheritedReleaseLockError(f'another process owns the {label}') from error
        raise InheritedReleaseLockError(f'{label} descriptor could not be validated') from error
    os.set_inheritable(descriptor, False)
    return descriptor


def validate_inherited_release_lock(project: Path) -> int:
    """Validate the compatibility .git lock inherited from the bootstrap."""

    return _validate_inherited_lock(
        Path(project) / '.git/rolling-release.lock',
        descriptor_variable='ROLLING_RELEASE_LOCK_FD',
        path_variable='ROLLING_RELEASE_LOCK_PATH',
        label='release lock',
    )


def validate_inherited_fleet_lock(project: Path) -> FleetLease:
    """Return the inherited fleet lease used by all authoritative state writes."""

    expected = Path(project) / 'logs/deploy/fleet-release-state.lock'
    descriptor = _validate_inherited_lock(
        expected,
        descriptor_variable='ROLLING_RELEASE_FLEET_LOCK_FD',
        path_variable='ROLLING_RELEASE_FLEET_LOCK_PATH',
        label='fleet lock',
    )
    return FleetLease(expected, descriptor, close_on_release=True)


class RunLock:
    """Own an exclusive kernel ``flock`` for one release run.

    Lock files are deliberately retained after use.  Ownership comes from the
    open file descriptor and the kernel lock, never from deleting a path.
    """

    def __init__(self, path: Path, *, blocking: bool = True) -> None:
        self.path = Path(path)
        self.blocking = blocking
        self._fd: int | None = None

    @property
    def fd(self) -> int:
        if self._fd is None:
            raise RunLockError(f'run lock is not held: {self.path}')
        return self._fd

    def acquire(self) -> "RunLock":
        if self._fd is not None:
            raise RunLockError(f'run lock is already held: {self.path}')

        self.path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        flags = os.O_RDWR | os.O_CREAT | getattr(os, 'O_CLOEXEC', 0)
        flags |= getattr(os, 'O_NOFOLLOW', 0)
        fd = os.open(self.path, flags, 0o600)
        try:
            if not stat.S_ISREG(os.fstat(fd).st_mode):
                raise RunLockError(f'run lock path is not a regular file: {self.path}')
            operation = fcntl.LOCK_EX
            if not self.blocking:
                operation |= fcntl.LOCK_NB
            try:
                fcntl.flock(fd, operation)
            except OSError as error:
                if not self.blocking and error.errno in (errno.EACCES, errno.EAGAIN):
                    raise RunLockBusyError(f'run lock is already held: {self.path}') from error
                raise
        except BaseException:
            os.close(fd)
            raise
        self._fd = fd
        return self

    def release(self) -> None:
        fd = self._fd
        if fd is None:
            return
        self._fd = None
        try:
            fcntl.flock(fd, fcntl.LOCK_UN)
        finally:
            os.close(fd)

    def __enter__(self) -> "RunLock":
        return self.acquire()

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        self.release()
