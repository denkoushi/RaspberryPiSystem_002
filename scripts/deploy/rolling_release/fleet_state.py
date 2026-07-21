"""Durable, generation-checked release evidence for the whole fleet.

The fleet record is the release-decision source of truth.  Detailed per-run
progress and cooperative control remain separate concerns.  Reads are safe to
use from ``--print-plan``: a missing state file returns an in-memory empty state
without creating either the state directory or the lock.  Every mutation is
serialized by one kernel ``flock`` and committed with a synced atomic replace.
"""
from __future__ import annotations

import copy
import errno
import fcntl
import json
import os
import re
import stat
import tempfile
from collections.abc import Callable, Mapping
from datetime import datetime, timezone
from pathlib import Path
from types import TracebackType
from typing import Any

from terminal_profile_registry import RegistryError, load_registry

from .image_refs import image_matches_release
from .activation import validate_activation_capabilities
from .release_claims import (
    ReleaseClaimError,
    validate_host_claim_compatibility,
    validate_release_claims,
)


FULL_SHA_RE = re.compile(r"^[0-9a-f]{40}$")
DIGEST_RE = re.compile(r"^sha256:[0-9a-f]{64}$")
RUN_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{2,79}$")
HOST_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,254}$")
UTC_TIMESTAMP_RE = re.compile(
    r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$"
)

ROOT_FIELDS = frozenset({"generation", "activeRun", "lastRun", "fleet"})
RUN_FIELDS = frozenset(
    {"runId", "status", "desiredSha", "inventory", "startedAt", "endedAt", "kind"}
)
RUN_REQUIRED_FIELDS = frozenset(
    {"runId", "status", "desiredSha", "inventory", "startedAt"}
)
COMMON_HOST_FIELDS = frozenset(
    {
        "role",
        "desiredSha",
        "currentSha",
        "previousSha",
        "evidence",
        "verifiedAt",
        "lastRunId",
    }
)
SERVER_HOST_FIELDS = frozenset(
    {"activeSlot", "apiImage", "webImage", "configDigest", "migrationDigest"}
)
OPTIONAL_HOST_FIELDS = frozenset({"releaseClaims", "activationCapabilities"})
EVIDENCE_VALUES = frozenset({"unknown", "verified"})
TERMINAL_RUN_STATUSES = frozenset({"success", "failed", "cancelled", "interrupted"})
RUN_KINDS = frozenset({"release", "pi4-recovery"})
_UNSET = object()


class FleetStateError(RuntimeError):
    """Base error for durable fleet state."""


class FleetStateCorruptError(FleetStateError):
    """The persisted fleet JSON does not satisfy the strict schema."""


class StaleFleetGenerationError(FleetStateError):
    """A writer attempted to replace a generation it did not read."""

    def __init__(self, expected: int, actual: int) -> None:
        super().__init__(
            f"fleet generation changed before mutation: expected {expected}, found {actual}"
        )
        self.expected = expected
        self.actual = actual


class FleetRunConflictError(FleetStateError):
    """The requested run transition conflicts with the active run."""


class FleetLockError(FleetStateError):
    """Base error for the common fleet kernel lock."""


class FleetLockBusyError(FleetLockError):
    """A non-blocking contender found an existing fleet owner."""


Clock = Callable[[], str]
FleetMutator = Callable[[dict[str, Any]], Mapping[str, Any] | None]


def _release_roles() -> frozenset[str]:
    """Resolve state roles from the same strict registry used by planning."""

    try:
        return frozenset({"server", *load_registry().profile_ids})
    except RegistryError as error:
        raise FleetStateCorruptError(
            "terminal profile registry is unavailable for fleet validation"
        ) from error


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def empty_fleet_state() -> dict[str, Any]:
    return {"generation": 0, "activeRun": None, "lastRun": None, "fleet": {}}


def _validate_timestamp(value: Any, *, field: str, optional: bool = False) -> None:
    if value is None and optional:
        return
    if not isinstance(value, str) or not UTC_TIMESTAMP_RE.fullmatch(value):
        raise FleetStateCorruptError(f"{field} must be a UTC timestamp with second precision")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise FleetStateCorruptError(f"{field} is not a valid timestamp") from error
    if parsed.utcoffset() != timezone.utc.utcoffset(parsed):
        raise FleetStateCorruptError(f"{field} must use UTC")


def _validate_sha(value: Any, *, field: str, optional: bool = False) -> None:
    if value is None and optional:
        return
    if not isinstance(value, str) or not FULL_SHA_RE.fullmatch(value):
        raise FleetStateCorruptError(f"{field} must be a full lowercase Git SHA")


def _validate_run_id(value: Any, *, field: str, optional: bool = False) -> None:
    if value is None and optional:
        return
    if not isinstance(value, str) or not RUN_ID_RE.fullmatch(value):
        raise FleetStateCorruptError(f"{field} is malformed")


def _validate_inventory(value: Any, *, field: str) -> None:
    if (
        not isinstance(value, str)
        or not value
        or len(value) > 1000
        or "\x00" in value
        or any(not character.isprintable() for character in value)
    ):
        raise FleetStateCorruptError(f"{field} is malformed")


def _validate_run_summary(value: Any, *, active: bool, field: str) -> None:
    if value is None:
        return
    if not isinstance(value, dict):
        raise FleetStateCorruptError(f"{field} must be an object or null")
    keys = set(value)
    if not RUN_REQUIRED_FIELDS <= keys or not keys <= RUN_FIELDS:
        raise FleetStateCorruptError(f"{field} fields do not match the fleet schema")
    _validate_run_id(value.get("runId"), field=f"{field}.runId")
    _validate_sha(value.get("desiredSha"), field=f"{field}.desiredSha")
    _validate_inventory(value.get("inventory"), field=f"{field}.inventory")
    _validate_timestamp(value.get("startedAt"), field=f"{field}.startedAt")
    kind = value.get("kind")
    if kind is not None and (not isinstance(kind, str) or kind not in RUN_KINDS):
        raise FleetStateCorruptError(f"{field}.kind is unsupported")
    status = value.get("status")
    if active:
        if status != "running" or "endedAt" in value:
            raise FleetStateCorruptError(f"{field} must describe one running run")
    else:
        if (
            not isinstance(status, str)
            or status not in TERMINAL_RUN_STATUSES
            or "endedAt" not in value
        ):
            raise FleetStateCorruptError(f"{field} must describe one terminal run")
        _validate_timestamp(value.get("endedAt"), field=f"{field}.endedAt")


def _validate_image(value: Any, *, field: str, optional: bool) -> None:
    if value is None and optional:
        return
    if (
        not isinstance(value, str)
        or not value
        or len(value) > 1000
        or "\x00" in value
        or any(not character.isprintable() for character in value)
    ):
        raise FleetStateCorruptError(f"{field} is malformed")


def _validate_digest(value: Any, *, field: str, optional: bool) -> None:
    if value is None and optional:
        return
    if not isinstance(value, str) or not DIGEST_RE.fullmatch(value):
        raise FleetStateCorruptError(f"{field} must be a full sha256 digest")


def _validate_host_record(host: str, value: Any) -> None:
    if not HOST_RE.fullmatch(host):
        raise FleetStateCorruptError(f"fleet host name is malformed: {host!r}")
    if not isinstance(value, dict):
        raise FleetStateCorruptError(f"fleet.{host} must be an object")
    role = value.get("role")
    expected_fields = COMMON_HOST_FIELDS | (SERVER_HOST_FIELDS if role == "server" else set())
    if not expected_fields <= set(value) or not set(value) <= (
        expected_fields | OPTIONAL_HOST_FIELDS
    ):
        raise FleetStateCorruptError(f"fleet.{host} fields do not match role {role!r}")
    if not isinstance(role, str) or role not in _release_roles():
        raise FleetStateCorruptError(f"fleet.{host}.role is unsupported")
    _validate_sha(value.get("desiredSha"), field=f"fleet.{host}.desiredSha", optional=True)
    _validate_sha(value.get("currentSha"), field=f"fleet.{host}.currentSha", optional=True)
    _validate_sha(value.get("previousSha"), field=f"fleet.{host}.previousSha", optional=True)
    _validate_run_id(value.get("lastRunId"), field=f"fleet.{host}.lastRunId", optional=True)
    evidence = value.get("evidence")
    if not isinstance(evidence, str) or evidence not in EVIDENCE_VALUES:
        raise FleetStateCorruptError(f"fleet.{host}.evidence is unsupported")
    _validate_timestamp(
        value.get("verifiedAt"), field=f"fleet.{host}.verifiedAt", optional=True
    )
    if evidence == "verified":
        if value.get("currentSha") is None or value.get("desiredSha") is None:
            raise FleetStateCorruptError(
                f"fleet.{host} verified evidence requires desiredSha and currentSha"
            )
        if value.get("verifiedAt") is None or value.get("lastRunId") is None:
            raise FleetStateCorruptError(
                f"fleet.{host} verified evidence requires verifiedAt and lastRunId"
            )
    elif value.get("verifiedAt") is not None:
        raise FleetStateCorruptError(f"fleet.{host} unknown evidence cannot retain verifiedAt")

    if role == "server":
        slot = value.get("activeSlot")
        if slot is not None and (not isinstance(slot, str) or slot not in {"blue", "green"}):
            raise FleetStateCorruptError(f"fleet.{host}.activeSlot is unsupported")
        verified = evidence == "verified"
        _validate_image(
            value.get("apiImage"), field=f"fleet.{host}.apiImage", optional=not verified
        )
        _validate_image(
            value.get("webImage"), field=f"fleet.{host}.webImage", optional=not verified
        )
        _validate_digest(
            value.get("configDigest"),
            field=f"fleet.{host}.configDigest",
            optional=not verified,
        )
        _validate_digest(
            value.get("migrationDigest"),
            field=f"fleet.{host}.migrationDigest",
            optional=not verified,
        )
        if verified and slot not in {"blue", "green"}:
            raise FleetStateCorruptError(
                f"fleet.{host} verified server evidence requires an active slot"
            )
        if verified:
            current_sha = value["currentSha"]
            for image_field in ("apiImage", "webImage"):
                if not image_matches_release(value[image_field], current_sha):
                    raise FleetStateCorruptError(
                        f"fleet.{host}.{image_field} does not match currentSha"
                    )

    if "releaseClaims" in value:
        try:
            claims = validate_release_claims(
                value["releaseClaims"], field=f"fleet.{host}.releaseClaims"
            )
            validate_host_claim_compatibility(value, claims)
        except ReleaseClaimError as error:
            raise FleetStateCorruptError(
                f"fleet.{host}.releaseClaims is malformed: {error}"
            ) from error
    if "activationCapabilities" in value:
        try:
            validate_activation_capabilities(
                value["activationCapabilities"],
                role=role,
                field=f"fleet.{host}.activationCapabilities",
            )
        except ValueError as error:
            raise FleetStateCorruptError(str(error)) from error


def validate_fleet_state(payload: Any) -> dict[str, Any]:
    """Validate and return a private deep copy of one complete fleet state."""

    if not isinstance(payload, Mapping):
        raise FleetStateCorruptError("fleet state must be an object")
    state = copy.deepcopy(dict(payload))
    if set(state) != ROOT_FIELDS:
        raise FleetStateCorruptError("fleet state root fields do not match the schema")
    generation = state.get("generation")
    if type(generation) is not int or generation < 0:
        raise FleetStateCorruptError("fleet generation must be a non-negative integer")
    _validate_run_summary(state.get("activeRun"), active=True, field="activeRun")
    _validate_run_summary(state.get("lastRun"), active=False, field="lastRun")
    if (
        isinstance(state.get("activeRun"), dict)
        and isinstance(state.get("lastRun"), dict)
        and state["activeRun"].get("runId") == state["lastRun"].get("runId")
    ):
        raise FleetStateCorruptError("activeRun and lastRun cannot name the same run")
    fleet = state.get("fleet")
    if not isinstance(fleet, dict):
        raise FleetStateCorruptError("fleet must be an object")
    for host, record in fleet.items():
        if not isinstance(host, str):
            raise FleetStateCorruptError("fleet host names must be strings")
        _validate_host_record(host, record)
    return state


def _reject_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise FleetStateCorruptError(f"fleet state contains duplicate key {key!r}")
        result[key] = value
    return result


def _reject_non_json_constant(value: str) -> Any:
    raise FleetStateCorruptError(f"fleet state contains non-JSON value {value}")


def parse_fleet_state_json(raw: str, *, source: str = "fleet state") -> dict[str, Any]:
    """Parse strict JSON before applying the fleet schema.

    Keeping this public lets remote read-only adapters reject duplicate keys and
    non-standard JSON constants exactly like local file reads.
    """

    if not isinstance(raw, str):
        raise TypeError("fleet state JSON must be text")
    try:
        payload = json.loads(
            raw,
            object_pairs_hook=_reject_duplicate_keys,
            parse_constant=_reject_non_json_constant,
        )
    except FleetStateCorruptError:
        raise
    except json.JSONDecodeError as error:
        raise FleetStateCorruptError(f"{source} is not valid JSON") from error
    return validate_fleet_state(payload)


def _read_json(path: Path) -> dict[str, Any] | None:
    try:
        flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0)
        flags |= getattr(os, "O_NOFOLLOW", 0)
        descriptor = os.open(path, flags)
    except OSError as error:
        if error.errno == errno.ENOENT:
            return None
        raise FleetStateError(f"fleet state is unreadable: {path}") from error
    try:
        if not stat.S_ISREG(os.fstat(descriptor).st_mode):
            raise FleetStateError(f"fleet state is not a regular file: {path}")
        try:
            with os.fdopen(descriptor, "r", encoding="utf-8", closefd=True) as stream:
                descriptor = -1
                raw = stream.read()
        except (OSError, UnicodeDecodeError) as error:
            raise FleetStateError(f"fleet state is unreadable: {path}") from error
    finally:
        if descriptor >= 0:
            os.close(descriptor)
    return parse_fleet_state_json(raw, source=f"fleet state {path}")


def _atomic_json(path: Path, payload: Mapping[str, Any]) -> None:
    """Commit JSON after syncing the file, replacement, and parent directory."""

    encoded = (
        json.dumps(
            payload,
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
            allow_nan=False,
        )
        + "\n"
    ).encode("utf-8")
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.", suffix=".tmp", dir=path.parent
    )
    temporary = Path(temporary_name)
    replaced = False
    try:
        os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, "wb", closefd=True) as stream:
            descriptor = -1
            stream.write(encoded)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        replaced = True
        flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_CLOEXEC", 0)
        directory_descriptor = os.open(path.parent, flags)
        try:
            if not stat.S_ISDIR(os.fstat(directory_descriptor).st_mode):
                raise FleetStateError(f"fleet state parent is not a directory: {path.parent}")
            os.fsync(directory_descriptor)
        finally:
            os.close(directory_descriptor)
    finally:
        if descriptor >= 0:
            os.close(descriptor)
        if not replaced:
            temporary.unlink(missing_ok=True)


class FleetLease:
    """Proof that a caller owns the common fleet lock's open-file description."""

    def __init__(self, path: Path, descriptor: int, *, close_on_release: bool) -> None:
        self.path = Path(path)
        self._descriptor = descriptor
        self._close_on_release = close_on_release
        self._active = True

    @property
    def fd(self) -> int:
        if not self._active:
            raise FleetLockError(f"fleet lease is no longer active: {self.path}")
        return self._descriptor

    def assert_for(self, path: Path) -> None:
        if not self._active or Path(path) != self.path:
            raise FleetLockError(f"fleet lease does not own {path}")
        try:
            descriptor_status = os.fstat(self._descriptor)
            path_status = os.lstat(self.path)
        except OSError as error:
            raise FleetLockError(f"fleet lease path is unavailable: {self.path}") from error
        if (
            not stat.S_ISREG(descriptor_status.st_mode)
            or not stat.S_ISREG(path_status.st_mode)
            or (descriptor_status.st_dev, descriptor_status.st_ino)
            != (path_status.st_dev, path_status.st_ino)
        ):
            raise FleetLockError(f"fleet lease inode changed: {self.path}")

    def release(self) -> None:
        if not self._active:
            return
        self._active = False
        if self._close_on_release:
            try:
                fcntl.flock(self._descriptor, fcntl.LOCK_UN)
            finally:
                os.close(self._descriptor)


class FleetLock:
    """Acquire one process-safe fleet lock and expose a reusable lease."""

    def __init__(self, path: Path, *, blocking: bool = True) -> None:
        self.path = Path(path)
        self.blocking = blocking
        self._lease: FleetLease | None = None

    def acquire(self) -> FleetLease:
        if self._lease is not None:
            raise FleetLockError(f"fleet lock is already held: {self.path}")
        self.path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        flags = os.O_RDWR | os.O_CREAT | getattr(os, "O_CLOEXEC", 0)
        flags |= getattr(os, "O_NOFOLLOW", 0)
        descriptor = os.open(self.path, flags, 0o600)
        try:
            descriptor_status = os.fstat(descriptor)
            path_status = os.lstat(self.path)
            if (
                not stat.S_ISREG(descriptor_status.st_mode)
                or not stat.S_ISREG(path_status.st_mode)
                or (descriptor_status.st_dev, descriptor_status.st_ino)
                != (path_status.st_dev, path_status.st_ino)
            ):
                raise FleetLockError(f"fleet lock path is not a stable regular file: {self.path}")
            os.fchmod(descriptor, 0o600)
            operation = fcntl.LOCK_EX | (0 if self.blocking else fcntl.LOCK_NB)
            try:
                fcntl.flock(descriptor, operation)
            except OSError as error:
                if not self.blocking and error.errno in (errno.EACCES, errno.EAGAIN):
                    raise FleetLockBusyError(f"fleet lock is already held: {self.path}") from error
                raise
        except BaseException:
            os.close(descriptor)
            raise
        self._lease = FleetLease(self.path, descriptor, close_on_release=True)
        return self._lease

    def release(self) -> None:
        lease = self._lease
        self._lease = None
        if lease is not None:
            lease.release()

    def __enter__(self) -> FleetLease:
        return self.acquire()

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        self.release()


class FleetStateStore:
    """Read or generation-check mutations of one fleet release record."""

    def __init__(
        self,
        state_path: Path,
        *,
        lock_path: Path | None = None,
        clock: Clock = utc_now,
    ) -> None:
        self.state_path = Path(state_path)
        self.lock_path = (
            Path(lock_path)
            if lock_path is not None
            else self.state_path.with_suffix(".lock")
        )
        self._clock = clock

    def read_only(self) -> dict[str, Any]:
        """Read one atomic snapshot without creating any path on a miss."""

        state = _read_json(self.state_path)
        return copy.deepcopy(state if state is not None else empty_fleet_state())

    def mutate(
        self,
        expected_generation: int,
        mutator: FleetMutator,
        *,
        lease: FleetLease | None = None,
    ) -> dict[str, Any]:
        if type(expected_generation) is not int or expected_generation < 0:
            raise ValueError("expected generation must be a non-negative integer")
        if not callable(mutator):
            raise TypeError("fleet mutator must be callable")
        if lease is not None:
            lease.assert_for(self.lock_path)
            return self._mutate_locked(expected_generation, mutator)
        with FleetLock(self.lock_path) as acquired:
            acquired.assert_for(self.lock_path)
            return self._mutate_locked(expected_generation, mutator)

    def _mutate_locked(
        self, expected_generation: int, mutator: FleetMutator
    ) -> dict[str, Any]:
        current = _read_json(self.state_path)
        if current is None:
            current = empty_fleet_state()
        actual_generation = current["generation"]
        if actual_generation != expected_generation:
            raise StaleFleetGenerationError(expected_generation, actual_generation)
        working = copy.deepcopy(current)
        replacement = mutator(working)
        if replacement is not None:
            if not isinstance(replacement, Mapping):
                raise TypeError("fleet mutator replacement must be a mapping or None")
            working = copy.deepcopy(dict(replacement))
        # The store, never a caller callback, owns the generation transition.
        working["generation"] = actual_generation + 1
        validated = validate_fleet_state(working)
        _atomic_json(self.state_path, validated)
        return copy.deepcopy(validated)

    def begin_run(
        self,
        run_id: str,
        desired_sha: str,
        inventory: str,
        *,
        expected_generation: int,
        started_at: str | None = None,
        kind: str | None = None,
        lease: FleetLease | None = None,
    ) -> dict[str, Any]:
        summary: dict[str, Any] = {
            "runId": run_id,
            "status": "running",
            "desiredSha": desired_sha,
            "inventory": inventory,
            "startedAt": self._clock() if started_at is None else started_at,
        }
        if kind is not None:
            summary["kind"] = kind
        # Validate arguments before a mutating call can create the lock path.
        _validate_run_summary(summary, active=True, field="activeRun")

        def begin(state: dict[str, Any]) -> None:
            if state["activeRun"] is not None:
                raise FleetRunConflictError(
                    f"fleet already has active run {state['activeRun'].get('runId')}"
                )
            state["activeRun"] = copy.deepcopy(summary)

        return self.mutate(expected_generation, begin, lease=lease)

    @staticmethod
    def _require_active_run(state: Mapping[str, Any], run_id: str) -> dict[str, Any]:
        active = state.get("activeRun")
        if not isinstance(active, dict) or active.get("runId") != run_id:
            actual = active.get("runId") if isinstance(active, dict) else None
            raise FleetRunConflictError(
                f"fleet active run mismatch: expected {run_id}, found {actual}"
            )
        return active

    def mark_host_unknown(
        self,
        host: str,
        role: str,
        desired_sha: str,
        run_id: str,
        *,
        expected_generation: int,
        lease: FleetLease | None = None,
    ) -> dict[str, Any]:
        if not isinstance(host, str) or not HOST_RE.fullmatch(host):
            raise ValueError("fleet host name is malformed")
        if not isinstance(role, str) or role not in _release_roles():
            raise ValueError("fleet role is unsupported")
        if not isinstance(desired_sha, str) or not FULL_SHA_RE.fullmatch(desired_sha):
            raise ValueError("desired SHA must be a full lowercase Git SHA")
        if not isinstance(run_id, str) or not RUN_ID_RE.fullmatch(run_id):
            raise ValueError("run ID is malformed")

        def unknown(state: dict[str, Any]) -> None:
            self._require_active_run(state, run_id)
            previous_record = state["fleet"].get(host)
            previous_sha = None
            if isinstance(previous_record, dict) and previous_record.get("role") == role:
                current_sha = previous_record.get("currentSha")
                previous_sha = (
                    current_sha
                    if current_sha and current_sha != desired_sha
                    else previous_record.get("previousSha")
                )
            record: dict[str, Any] = {
                "role": role,
                "desiredSha": desired_sha,
                "currentSha": None,
                "previousSha": previous_sha,
                "evidence": "unknown",
                "verifiedAt": None,
                "lastRunId": run_id,
            }
            if role == "server":
                record.update(
                    {
                        "activeSlot": None,
                        "apiImage": None,
                        "webImage": None,
                        "configDigest": None,
                        "migrationDigest": None,
                    }
                )
            if (
                isinstance(previous_record, dict)
                and previous_record.get("role") == role
                and "activationCapabilities" in previous_record
            ):
                record["activationCapabilities"] = copy.deepcopy(
                    previous_record["activationCapabilities"]
                )
            state["fleet"][host] = record

        return self.mutate(expected_generation, unknown, lease=lease)

    def mark_host_verified(
        self,
        host: str,
        role: str,
        desired_sha: str,
        current_sha: str,
        run_id: str,
        *,
        expected_generation: int,
        previous_sha: str | None | object = _UNSET,
        verified_at: str | None = None,
        active_slot: str | None = None,
        api_image: str | None = None,
        web_image: str | None = None,
        config_digest: str | None = None,
        migration_digest: str | None = None,
        activation_capabilities: Mapping[str, Any] | object = _UNSET,
        lease: FleetLease | None = None,
    ) -> dict[str, Any]:
        if not isinstance(host, str) or not HOST_RE.fullmatch(host):
            raise ValueError("fleet host name is malformed")
        if not isinstance(role, str) or role not in _release_roles():
            raise ValueError("fleet role is unsupported")
        if not isinstance(desired_sha, str) or not FULL_SHA_RE.fullmatch(desired_sha):
            raise ValueError("desired SHA must be a full lowercase Git SHA")
        if not isinstance(current_sha, str) or not FULL_SHA_RE.fullmatch(current_sha):
            raise ValueError("current SHA must be a full lowercase Git SHA")
        if (
            previous_sha is not _UNSET
            and previous_sha is not None
            and (
                not isinstance(previous_sha, str)
                or not FULL_SHA_RE.fullmatch(previous_sha)
            )
        ):
            raise ValueError("previous SHA must be null or a full lowercase Git SHA")
        if not isinstance(run_id, str) or not RUN_ID_RE.fullmatch(run_id):
            raise ValueError("run ID is malformed")
        if role != "server" and any(
            value is not None
            for value in (
                active_slot,
                api_image,
                web_image,
                config_digest,
                migration_digest,
            )
        ):
            raise ValueError("Pi5 evidence is valid only for the server role")
        if activation_capabilities is not _UNSET:
            activation_capabilities = validate_activation_capabilities(
                activation_capabilities,
                role=role,
                field=f"fleet.{host}.activationCapabilities",
            )

        timestamp = self._clock() if verified_at is None else verified_at
        supplied_record: dict[str, Any] = {
            "role": role,
            "desiredSha": desired_sha,
            "currentSha": current_sha,
            "previousSha": None if previous_sha is _UNSET else previous_sha,
            "evidence": "verified",
            "verifiedAt": timestamp,
            "lastRunId": run_id,
        }
        if role == "server":
            supplied_record.update(
                {
                    "activeSlot": active_slot,
                    "apiImage": api_image,
                    "webImage": web_image,
                    "configDigest": config_digest,
                    "migrationDigest": migration_digest,
                }
            )
        if activation_capabilities is not _UNSET:
            supplied_record["activationCapabilities"] = copy.deepcopy(
                activation_capabilities
            )
        # Validate every supplied observation before the lock path can be created.
        _validate_host_record(host, supplied_record)

        def verified(state: dict[str, Any]) -> None:
            self._require_active_run(state, run_id)
            record = copy.deepcopy(supplied_record)
            if previous_sha is _UNSET:
                prior = state["fleet"].get(host)
                if isinstance(prior, dict) and prior.get("role") == role:
                    record["previousSha"] = prior.get("currentSha") or prior.get("previousSha")
            prior = state["fleet"].get(host)
            if (
                activation_capabilities is _UNSET
                and isinstance(prior, dict)
                and prior.get("role") == role
                and "activationCapabilities" in prior
            ):
                record["activationCapabilities"] = copy.deepcopy(
                    prior["activationCapabilities"]
                )
            _validate_host_record(host, record)
            state["fleet"][host] = copy.deepcopy(record)

        return self.mutate(expected_generation, verified, lease=lease)

    def finish_run(
        self,
        run_id: str,
        status: str,
        *,
        expected_generation: int,
        ended_at: str | None = None,
        lease: FleetLease | None = None,
    ) -> dict[str, Any]:
        if not isinstance(status, str) or status not in TERMINAL_RUN_STATUSES:
            raise ValueError("fleet run status is not terminal")
        if not isinstance(run_id, str) or not RUN_ID_RE.fullmatch(run_id):
            raise ValueError("run ID is malformed")
        terminal_at = self._clock() if ended_at is None else ended_at
        _validate_timestamp(terminal_at, field="lastRun.endedAt")

        def finish(state: dict[str, Any]) -> None:
            active = self._require_active_run(state, run_id)
            terminal = copy.deepcopy(active)
            terminal.update({"status": status, "endedAt": terminal_at})
            state["lastRun"] = terminal
            state["activeRun"] = None

        return self.mutate(expected_generation, finish, lease=lease)

    def abandon_active_run(
        self,
        run_id: str,
        *,
        expected_generation: int,
        ended_at: str | None = None,
        lease: FleetLease | None = None,
    ) -> dict[str, Any]:
        """Record a lock-orphaned active run as interrupted.

        Hosts already promoted by fresh verification remain verified.  Hosts
        marked unknown for the abandoned run remain unknown; no old observation
        is promoted merely because the previous process disappeared.
        """

        return self.finish_run(
            run_id,
            "interrupted",
            expected_generation=expected_generation,
            ended_at=ended_at,
            lease=lease,
        )


__all__ = [
    "FleetLease",
    "FleetLock",
    "FleetLockBusyError",
    "FleetLockError",
    "FleetRunConflictError",
    "FleetStateCorruptError",
    "FleetStateError",
    "FleetStateStore",
    "StaleFleetGenerationError",
    "empty_fleet_state",
    "parse_fleet_state_json",
    "utc_now",
    "validate_fleet_state",
]
