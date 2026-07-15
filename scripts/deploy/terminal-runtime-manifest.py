#!/usr/bin/env python3
"""Seal and restore terminal systemd and Docker runtime state.

This helper intentionally exposes only three operations: capture an explicit
allowlist, restore the sealed state, and remove the run-scoped image-retention
tags after either a verified restore or an explicitly coordinator-committed
forward success. It never fetches, builds, prunes, or removes volumes, and it
never serializes container environment variables.
"""
from __future__ import annotations

import argparse
import base64
import fcntl
import hashlib
import hmac
import json
import os
import posixpath
import re
import stat
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping, Sequence


MANIFEST_VERSION = 2
RECEIPT_VERSION = 1
MARKER_PREFIX = "TERMINAL_RUNTIME_MANIFEST_RESULT:"
MAX_JSON_BYTES = 1024 * 1024
MAX_COMMAND_OUTPUT = 1024 * 1024
COMMAND_TIMEOUT_SECONDS = 60
SAFE_COMMAND_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

RUN_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{2,79}$")
HOST_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,254}$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
IMAGE_ID_RE = re.compile(r"^sha256:[0-9a-f]{64}$")
CONTAINER_ID_RE = re.compile(r"^[0-9a-f]{12,64}$")
PROJECT_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,62}$")
VOLUME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,254}$")
IMAGE_REFERENCE_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/-]{0,254}$")

ALLOWED_UNITS = frozenset(
    {
        "lightdm.service",
        "kiosk-browser.service",
        "status-agent.service",
        "status-agent.timer",
        "signage-lite.service",
        "signage-lite-update.service",
        "signage-lite-update.timer",
        "signage-lite-watchdog.service",
        "signage-lite-watchdog.timer",
        "signage-daily-reboot.service",
        "signage-daily-reboot.timer",
        "haizen-agent.service",
    }
)
TRANSIENT_ONESHOT_UNITS = frozenset(
    {
        "status-agent.service",
        "signage-lite-update.service",
        "signage-lite-watchdog.service",
        "signage-daily-reboot.service",
    }
)
RESTART_ON_RESTORE_UNITS = frozenset(
    {
        "kiosk-browser.service",
        "signage-lite.service",
        "haizen-agent.service",
    }
)
ALLOWED_DOCKER_SERVICES = frozenset({"nfc-agent", "barcode-agent"})
ALLOWED_LOAD_STATES = frozenset({"loaded", "masked", "not-found"})
ALLOWED_UNIT_FILE_STATES = frozenset(
    {
        "enabled",
        "enabled-runtime",
        "linked",
        "linked-runtime",
        "alias",
        "masked",
        "masked-runtime",
        "static",
        "disabled",
        "indirect",
        "generated",
        "transient",
        "not-found",
    }
)
ALLOWED_ACTIVE_STATES = frozenset({"active", "inactive"})
ALLOWED_RESTART_POLICIES = frozenset(
    {"no", "always", "unless-stopped", "on-failure"}
)
ALLOWED_MOUNT_PROPAGATION = frozenset(
    {"", "private", "rprivate", "shared", "rshared", "slave", "rslave", "unbindable", "runbindable"}
)

CONTAINER_INSPECT_TEMPLATE = (
    '{"id":{{json .Id}},"imageId":{{json .Image}},'
    '"imageReference":{{json .Config.Image}},"running":{{json .State.Running}},'
    '"containerConfig":{{json .Config}},'
    '"hostConfig":{{json .HostConfig}},'
    '"restartPolicy":{{json .HostConfig.RestartPolicy}},'
    '"mounts":{{json .Mounts}},'
    '"privileged":{{json .HostConfig.Privileged}},'
    '"devices":{{json .HostConfig.Devices}},'
    '"networkMode":{{json .HostConfig.NetworkMode}},'
    '"user":{{json .Config.User}},'
    '"command":{{json .Config.Cmd}},'
    '"entrypoint":{{json .Config.Entrypoint}},'
    '"capAdd":{{json .HostConfig.CapAdd}},'
    '"capDrop":{{json .HostConfig.CapDrop}},'
    '"securityOpt":{{json .HostConfig.SecurityOpt}},'
    '"readOnlyRootfs":{{json .HostConfig.ReadonlyRootfs}},'
    '"project":{{json (index .Config.Labels "com.docker.compose.project")}},'
    '"service":{{json (index .Config.Labels "com.docker.compose.service")}},'
    '"workingDirectory":{{json (index .Config.Labels "com.docker.compose.project.working_dir")}},'
    '"configFiles":{{json (index .Config.Labels "com.docker.compose.project.config_files")}}}'
)

MAX_ENVIRONMENT_ENTRIES = 4096
MAX_ENVIRONMENT_BYTES = 512 * 1024
MAX_RUNTIME_CONFIG_DEPTH = 32
MAX_RUNTIME_CONFIG_ITEMS = 16384
MAX_RUNTIME_CONFIG_STRING_BYTES = 512 * 1024
ENVIRONMENT_KEY_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


class RuntimeManifestError(RuntimeError):
    """Raised when the helper cannot prove its fail-closed contract."""


@dataclass(frozen=True)
class CommandResult:
    returncode: int
    stdout: str


@dataclass(frozen=True)
class ManifestContext:
    root: Path
    run_directory: Path
    host_directory: Path
    manifest_path: Path
    restored_path: Path
    cleanup_path: Path
    cleanup_started_path: Path
    lock_path: Path
    run_id: str
    host: str


@dataclass(frozen=True)
class SystemdObservation:
    state: dict[str, Any]
    needs_daemon_reload: bool


def _run_command(
    argv: Sequence[str], *, allowed_exit_codes: tuple[int, ...] = (0,)
) -> CommandResult:
    """Run one fixed argv command while discarding sensitive stderr."""

    if not argv or any(not isinstance(value, str) or "\x00" in value for value in argv):
        raise RuntimeManifestError("command argv is malformed")
    # Runtime state must never depend on caller-controlled Docker/Compose/systemd
    # routing or interpolation variables.  In particular, inheriting DOCKER_HOST,
    # COMPOSE_FILE, or DBUS_SYSTEM_BUS_ADDRESS could silently inspect or mutate a
    # different runtime than the one the coordinator approved.
    environment = {
        "PATH": SAFE_COMMAND_PATH,
        "LANG": "C",
        "LC_ALL": "C",
    }
    try:
        with tempfile.TemporaryFile() as output:
            completed = subprocess.run(
                list(argv),
                stdin=subprocess.DEVNULL,
                stdout=output,
                stderr=subprocess.DEVNULL,
                env=environment,
                timeout=COMMAND_TIMEOUT_SECONDS,
                check=False,
            )
            size = output.tell()
            if size > MAX_COMMAND_OUTPUT:
                raise RuntimeManifestError("command output exceeded its safety limit")
            output.seek(0)
            raw = output.read()
    except (OSError, subprocess.TimeoutExpired) as error:
        raise RuntimeManifestError("runtime command could not complete") from error
    if completed.returncode not in allowed_exit_codes:
        operation = " ".join(argv[:2])
        raise RuntimeManifestError(f"runtime command failed: {operation}")
    try:
        decoded = raw.decode("utf-8", errors="strict")
    except UnicodeDecodeError as error:
        raise RuntimeManifestError("runtime command output is not UTF-8") from error
    return CommandResult(completed.returncode, decoded.strip())


def _validate_identity(value: str, pattern: re.Pattern[str], label: str) -> str:
    if not isinstance(value, str) or pattern.fullmatch(value) is None:
        raise RuntimeManifestError(f"{label} is malformed")
    return value


def _normalise_absolute(value: os.PathLike[str] | str, label: str) -> Path:
    try:
        raw = os.fspath(value)
    except TypeError as error:
        raise RuntimeManifestError(f"{label} is malformed") from error
    if not isinstance(raw, str) or not raw or "\x00" in raw:
        raise RuntimeManifestError(f"{label} is malformed")
    if not os.path.isabs(raw):
        raise RuntimeManifestError(f"{label} must be absolute")
    if ".." in Path(raw).parts:
        raise RuntimeManifestError(f"{label} contains traversal")
    path = Path(os.path.normpath(raw))
    if not path.is_absolute():
        raise RuntimeManifestError(f"{label} must remain absolute")
    return path


def _require_real_directory(path: Path, label: str) -> None:
    try:
        metadata = path.lstat()
    except FileNotFoundError as error:
        raise RuntimeManifestError(f"{label} is missing") from error
    if not stat.S_ISDIR(metadata.st_mode):
        raise RuntimeManifestError(f"{label} must be a real directory")


def _require_real_regular_file(path: Path, label: str) -> None:
    try:
        metadata = path.lstat()
    except FileNotFoundError as error:
        raise RuntimeManifestError(f"{label} is missing") from error
    if not stat.S_ISREG(metadata.st_mode):
        raise RuntimeManifestError(f"{label} must be a real regular file")


def _require_secure_directory(path: Path, *, create: bool) -> None:
    if create:
        try:
            path.mkdir(mode=0o700, parents=True, exist_ok=True)
        except FileExistsError as error:
            raise RuntimeManifestError("runtime manifest directory is not a directory") from error
    try:
        metadata = path.lstat()
    except FileNotFoundError as error:
        raise RuntimeManifestError("runtime manifest directory is missing") from error
    if not stat.S_ISDIR(metadata.st_mode):
        raise RuntimeManifestError("runtime manifest directory must be a real directory")
    if metadata.st_uid != os.geteuid():
        raise RuntimeManifestError("runtime manifest directory has a different owner")
    if stat.S_IMODE(metadata.st_mode) & 0o077:
        raise RuntimeManifestError("runtime manifest directory is accessible outside its owner")


def _build_context(
    *, root: os.PathLike[str] | str, run_id: str, host: str, create: bool
) -> ManifestContext:
    safe_run = _validate_identity(run_id, RUN_ID_RE, "run ID")
    safe_host = _validate_identity(host, HOST_RE, "host")
    safe_root = _normalise_absolute(root, "runtime manifest root")
    run_directory = safe_root / safe_run
    host_directory = run_directory / safe_host
    for directory in (safe_root, run_directory, host_directory):
        _require_secure_directory(directory, create=create)
    return ManifestContext(
        root=safe_root,
        run_directory=run_directory,
        host_directory=host_directory,
        manifest_path=host_directory / "manifest.json",
        restored_path=host_directory / "restored.json",
        cleanup_path=host_directory / "cleanup.json",
        cleanup_started_path=host_directory / "cleanup-started.json",
        lock_path=host_directory / ".lock",
        run_id=safe_run,
        host=safe_host,
    )


class _HostLock:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.descriptor: int | None = None

    def __enter__(self) -> "_HostLock":
        existing = None
        try:
            existing = self.path.lstat()
        except FileNotFoundError:
            pass
        if existing is not None and not stat.S_ISREG(existing.st_mode):
            raise RuntimeManifestError("runtime manifest lock is not a regular file")
        flags = os.O_RDWR | os.O_CREAT | getattr(os, "O_CLOEXEC", 0)
        flags |= getattr(os, "O_NOFOLLOW", 0)
        descriptor = os.open(self.path, flags, 0o600)
        metadata = os.fstat(descriptor)
        if (
            not stat.S_ISREG(metadata.st_mode)
            or metadata.st_uid != os.geteuid()
            or metadata.st_nlink != 1
        ):
            os.close(descriptor)
            raise RuntimeManifestError("runtime manifest lock is unsafe")
        os.fchmod(descriptor, 0o600)
        fcntl.flock(descriptor, fcntl.LOCK_EX)
        self.descriptor = descriptor
        return self

    def __exit__(self, *_exc: object) -> None:
        if self.descriptor is None:
            return
        try:
            fcntl.flock(self.descriptor, fcntl.LOCK_UN)
        finally:
            os.close(self.descriptor)
            self.descriptor = None


def _canonical_json(value: Mapping[str, Any]) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=True,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")


def _digest(value: Mapping[str, Any], digest_key: str) -> str:
    core = {key: item for key, item in value.items() if key != digest_key}
    return hashlib.sha256(_canonical_json(core)).hexdigest()


def _seal(value: Mapping[str, Any], digest_key: str) -> dict[str, Any]:
    sealed = dict(value)
    sealed[digest_key] = _digest(sealed, digest_key)
    return sealed


def _duplicate_safe_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise RuntimeManifestError(f"JSON contains duplicate key: {key}")
        result[key] = value
    return result


def _reject_json_constant(value: str) -> None:
    raise RuntimeManifestError(f"JSON contains non-finite constant: {value}")


def _decode_json(raw: bytes, label: str) -> dict[str, Any]:
    try:
        value = json.loads(
            raw.decode("utf-8"),
            object_pairs_hook=_duplicate_safe_object,
            parse_constant=_reject_json_constant,
        )
    except RuntimeManifestError:
        raise
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise RuntimeManifestError(f"{label} JSON is malformed") from error
    if not isinstance(value, dict):
        raise RuntimeManifestError(f"{label} must be a JSON object")
    return value


def _secure_file(path: Path, label: str) -> os.stat_result:
    try:
        metadata = path.lstat()
    except FileNotFoundError as error:
        raise RuntimeManifestError(f"{label} is missing") from error
    if (
        not stat.S_ISREG(metadata.st_mode)
        or metadata.st_uid != os.geteuid()
        or stat.S_IMODE(metadata.st_mode) & 0o077
        or metadata.st_nlink != 1
    ):
        raise RuntimeManifestError(f"{label} is not an owner-only regular file")
    return metadata


def _read_secure_json(path: Path, label: str) -> dict[str, Any]:
    before = _secure_file(path, label)
    flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(path, flags)
    try:
        opened = os.fstat(descriptor)
        if (opened.st_dev, opened.st_ino) != (before.st_dev, before.st_ino):
            raise RuntimeManifestError(f"{label} changed while opening")
        raw = os.read(descriptor, MAX_JSON_BYTES + 1)
        if len(raw) > MAX_JSON_BYTES or os.read(descriptor, 1):
            raise RuntimeManifestError(f"{label} exceeds its size limit")
        after = os.fstat(descriptor)
        if (
            after.st_size != opened.st_size
            or after.st_mtime_ns != opened.st_mtime_ns
            or after.st_nlink != 1
        ):
            raise RuntimeManifestError(f"{label} changed while reading")
    finally:
        os.close(descriptor)
    return _decode_json(raw, label)


def _fsync_directory(path: Path) -> None:
    descriptor = os.open(
        path,
        os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_CLOEXEC", 0),
    )
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _atomic_json(path: Path, value: Mapping[str, Any]) -> None:
    encoded = (
        json.dumps(
            value,
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
            allow_nan=False,
        )
        + "\n"
    ).encode("utf-8")
    if len(encoded) > MAX_JSON_BYTES:
        raise RuntimeManifestError("runtime manifest JSON exceeds its size limit")
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
        try:
            existing = path.lstat()
        except FileNotFoundError:
            existing = None
        if existing is not None and not stat.S_ISREG(existing.st_mode):
            raise RuntimeManifestError("refusing to replace a non-regular state file")
        os.replace(temporary, path)
        replaced = True
        _fsync_directory(path.parent)
    finally:
        if descriptor >= 0:
            os.close(descriptor)
        if not replaced:
            try:
                temporary.unlink()
            except FileNotFoundError:
                pass


def _parse_key_values(raw: str, expected: set[str], label: str) -> dict[str, str]:
    values: dict[str, str] = {}
    for line in raw.splitlines():
        if "=" not in line:
            raise RuntimeManifestError(f"{label} output is malformed")
        key, value = line.split("=", 1)
        if key in values or key not in expected:
            raise RuntimeManifestError(f"{label} output fields are malformed")
        values[key] = value
    if set(values) != expected:
        raise RuntimeManifestError(f"{label} output is incomplete")
    return values


def _validate_unit_name(value: Any) -> str:
    if not isinstance(value, str) or value not in ALLOWED_UNITS:
        raise RuntimeManifestError("systemd unit is not allowlisted")
    return value


def _systemd_observation(
    unit: str, *, allow_current_failed: bool = False
) -> SystemdObservation:
    safe_unit = _validate_unit_name(unit)
    properties = [
        "--property=LoadState",
        "--property=UnitFileState",
        "--property=ActiveState",
        "--property=NeedDaemonReload",
    ]
    expected = {"LoadState", "UnitFileState", "ActiveState", "NeedDaemonReload"}
    if safe_unit.endswith(".timer"):
        properties.append("--property=Persistent")
        expected.add("Persistent")
    result = _run_command(
        [
            "systemctl",
            "show",
            "--no-page",
            *properties,
            safe_unit,
        ]
    )
    values = _parse_key_values(result.stdout, expected, "systemctl show")
    needs_daemon_reload = values["NeedDaemonReload"]
    if needs_daemon_reload not in {"yes", "no"}:
        raise RuntimeManifestError("systemd daemon-reload state is malformed")
    if safe_unit.endswith(".timer"):
        persistent_value = values["Persistent"]
        if persistent_value not in {"yes", "no"}:
            raise RuntimeManifestError("systemd timer persistence is malformed")
        persistent: bool | None = persistent_value == "yes"
    else:
        persistent = None
    state = {
        "name": safe_unit,
        "loadState": values["LoadState"],
        "unitFileState": values["UnitFileState"],
        "activeState": values["ActiveState"],
        "persistent": persistent,
    }
    return SystemdObservation(
        state=_validate_unit_record(
            state,
            allow_current_failed=allow_current_failed,
            allow_transient_oneshot_active=True,
        ),
        needs_daemon_reload=needs_daemon_reload == "yes",
    )


def _systemd_state(
    unit: str, *, allow_current_failed: bool = False
) -> dict[str, Any]:
    observation = _systemd_observation(
        unit, allow_current_failed=allow_current_failed
    )
    if observation.needs_daemon_reload:
        raise RuntimeManifestError(
            "systemd unit requires daemon-reload before its state is stable"
        )
    return observation.state


def _capturable_systemd_state(unit: str) -> dict[str, Any]:
    state = _systemd_state(unit)
    if (
        state["name"] in TRANSIENT_ONESHOT_UNITS
        and state["activeState"] == "active"
    ):
        raise RuntimeManifestError(
            "transient oneshot unit is active during runtime capture"
        )
    return state


def _validate_unit_record(
    value: Any,
    *,
    allow_current_failed: bool = False,
    allow_transient_oneshot_active: bool = False,
) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != {
        "name",
        "loadState",
        "unitFileState",
        "activeState",
        "persistent",
    }:
        raise RuntimeManifestError("systemd record fields are malformed")
    name = _validate_unit_name(value.get("name"))
    load = value.get("loadState")
    unit_file = value.get("unitFileState")
    active = value.get("activeState")
    persistent = value.get("persistent")
    if name.endswith(".timer"):
        if type(persistent) is not bool:
            raise RuntimeManifestError("systemd timer persistence is malformed")
    elif persistent is not None:
        raise RuntimeManifestError("non-timer systemd unit has timer persistence")
    if load not in ALLOWED_LOAD_STATES:
        raise RuntimeManifestError("systemd load state is unsupported")
    if unit_file not in ALLOWED_UNIT_FILE_STATES:
        raise RuntimeManifestError("systemd unit-file state is unsupported")
    if active not in ALLOWED_ACTIVE_STATES and not (
        allow_current_failed and active == "failed"
    ):
        raise RuntimeManifestError("systemd unit is not in a stable active/inactive state")
    if (
        name in TRANSIENT_ONESHOT_UNITS
        and active == "active"
        and not allow_transient_oneshot_active
    ):
        raise RuntimeManifestError(
            "transient oneshot unit cannot be sealed as active runtime state"
        )
    if load == "not-found" and (unit_file != "not-found" or active != "inactive"):
        raise RuntimeManifestError("not-found systemd state is inconsistent")
    if unit_file in {"masked", "masked-runtime"}:
        if load != "masked" or active != "inactive":
            raise RuntimeManifestError("masked systemd state is inconsistent")
    elif load == "masked":
        raise RuntimeManifestError("masked systemd load state lacks a mask")
    elif load != "not-found" and unit_file == "not-found":
        raise RuntimeManifestError("loaded systemd state is inconsistent")
    return {
        "name": name,
        "loadState": load,
        "unitFileState": unit_file,
        "activeState": active,
        "persistent": persistent,
    }


def _validate_service(value: Any) -> str:
    if not isinstance(value, str) or value not in ALLOWED_DOCKER_SERVICES:
        raise RuntimeManifestError("Docker Compose service is not allowlisted")
    return value


def _validate_project(value: Any) -> str:
    if not isinstance(value, str) or PROJECT_RE.fullmatch(value) is None:
        raise RuntimeManifestError("Compose project is malformed")
    return value


def _validate_image_id(value: Any, label: str = "Docker image ID") -> str:
    if not isinstance(value, str) or IMAGE_ID_RE.fullmatch(value) is None:
        raise RuntimeManifestError(f"{label} is malformed")
    return value


def _validate_image_reference(value: Any) -> str:
    if (
        not isinstance(value, str)
        or IMAGE_REFERENCE_RE.fullmatch(value) is None
        or "@" in value
        or ".." in value.split("/")
    ):
        raise RuntimeManifestError("Docker image reference is unsafe")
    return value


def _validate_compose_context(value: Any, *, require_files: bool) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != {
        "project",
        "workingDirectory",
        "configFiles",
    }:
        raise RuntimeManifestError("Compose context fields are malformed")
    project = _validate_project(value.get("project"))
    working = _normalise_absolute(value.get("workingDirectory"), "Compose working directory")
    configs = value.get("configFiles")
    if not isinstance(configs, list) or not configs:
        raise RuntimeManifestError("Compose config file set is malformed")
    normalised_configs = [
        _normalise_absolute(item, "Compose config file") for item in configs
    ]
    if len({os.fspath(path) for path in normalised_configs}) != len(normalised_configs):
        raise RuntimeManifestError("Compose config file set contains duplicates")
    if os.fspath(working) != value["workingDirectory"] or [
        os.fspath(path) for path in normalised_configs
    ] != configs:
        raise RuntimeManifestError("Compose paths are not normalized")
    if require_files:
        _require_real_directory(working, "Compose working directory")
        for path in normalised_configs:
            _require_real_regular_file(path, "Compose config file")
    return {
        "project": project,
        "workingDirectory": os.fspath(working),
        "configFiles": [os.fspath(path) for path in normalised_configs],
    }


def _normalise_container_path(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value.startswith("/") or "\x00" in value:
        raise RuntimeManifestError(f"{label} is malformed")
    if ".." in value.split("/"):
        raise RuntimeManifestError(f"{label} contains traversal")
    normalised = posixpath.normpath(value)
    if not normalised.startswith("/"):
        raise RuntimeManifestError(f"{label} is malformed")
    return normalised


def _normalise_mount(value: Any, *, require_sources: bool) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise RuntimeManifestError("Docker mount is malformed")
    mount_type = value.get("Type", value.get("type"))
    source = value.get("Source", value.get("source"))
    destination = value.get("Destination", value.get("destination"))
    name = value.get("Name", value.get("name"))
    propagation = value.get("Propagation", value.get("propagation", ""))
    if "RW" in value:
        read_only = not value["RW"] if type(value["RW"]) is bool else None
    else:
        read_only = value.get("readOnly")
    if (
        mount_type not in {"bind", "volume", "tmpfs"}
        or type(read_only) is not bool
        or propagation not in ALLOWED_MOUNT_PROPAGATION
    ):
        raise RuntimeManifestError("Docker mount type/state is unsupported")
    if mount_type != "bind" and propagation != "":
        raise RuntimeManifestError("Docker mount propagation is inconsistent")
    destination_path = _normalise_container_path(destination, "mount destination")
    if mount_type == "tmpfs":
        if source not in {None, ""} or name not in {None, ""}:
            raise RuntimeManifestError("tmpfs mount source is malformed")
        safe_source = ""
        safe_name = None
    else:
        safe_source_path = _normalise_absolute(source, "mount source")
        safe_source = os.fspath(safe_source_path)
        if mount_type == "bind":
            if name not in {None, ""}:
                raise RuntimeManifestError("bind mount name is malformed")
            safe_name = None
            if require_sources:
                try:
                    metadata = safe_source_path.lstat()
                except FileNotFoundError as error:
                    raise RuntimeManifestError("bind mount source is missing") from error
                if not (stat.S_ISDIR(metadata.st_mode) or stat.S_ISREG(metadata.st_mode)):
                    raise RuntimeManifestError("bind mount source is not a real file/directory")
        else:
            if not isinstance(name, str) or VOLUME_RE.fullmatch(name) is None:
                raise RuntimeManifestError("named volume is malformed")
            safe_name = name
    return {
        "type": mount_type,
        "source": safe_source,
        "destination": destination_path,
        "readOnly": read_only,
        "name": safe_name,
        "propagation": propagation,
    }


def _normalise_mounts(value: Any, *, require_sources: bool) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        raise RuntimeManifestError("Docker mounts are malformed")
    mounts = [_normalise_mount(item, require_sources=require_sources) for item in value]
    destinations = [item["destination"] for item in mounts]
    if len(set(destinations)) != len(destinations):
        raise RuntimeManifestError("Docker mounts contain a duplicate destination")
    return sorted(
        mounts,
        key=lambda item: (
            item["destination"],
            item["type"],
            item["source"],
            item["name"] or "",
        ),
    )


def _normalise_restart_policy(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise RuntimeManifestError("Docker restart policy is malformed")
    name = value.get("Name", value.get("name"))
    maximum = value.get("MaximumRetryCount", value.get("maximumRetryCount"))
    if (
        name not in ALLOWED_RESTART_POLICIES
        or type(maximum) is not int
        or maximum < 0
        or maximum > 2_147_483_647
    ):
        raise RuntimeManifestError("Docker restart policy is unsupported")
    if name != "on-failure" and maximum != 0:
        raise RuntimeManifestError("Docker restart retry count is inconsistent")
    return {"name": name, "maximumRetryCount": maximum}


def _normalise_bounded_string(value: Any, label: str, *, allow_empty: bool) -> str:
    if (
        not isinstance(value, str)
        or (not allow_empty and not value)
        or len(value.encode("utf-8")) > 4096
        or any(ord(character) < 32 or ord(character) == 127 for character in value)
    ):
        raise RuntimeManifestError(f"{label} is malformed")
    return value


def _normalise_string_vector(
    value: Any,
    label: str,
    *,
    allow_null: bool,
    allow_scalar: bool = False,
) -> list[str] | str | None:
    if value is None and allow_null:
        return None
    if allow_scalar and isinstance(value, str):
        return _normalise_bounded_string(value, label, allow_empty=True)
    if not isinstance(value, list) or len(value) > 1024:
        raise RuntimeManifestError(f"{label} is malformed")
    normalised = [
        _normalise_bounded_string(item, label, allow_empty=True) for item in value
    ]
    if sum(len(item.encode("utf-8")) for item in normalised) > 65536:
        raise RuntimeManifestError(f"{label} exceeds its safety limit")
    return normalised


def _normalise_runtime_security(value: Mapping[str, Any]) -> dict[str, Any]:
    expected = {
        "privileged",
        "devices",
        "networkMode",
        "user",
        "command",
        "entrypoint",
        "capAdd",
        "capDrop",
        "securityOpt",
        "readOnlyRootfs",
    }
    if not isinstance(value, Mapping) or set(value) != expected:
        raise RuntimeManifestError("Docker security/runtime fields are malformed")
    privileged = value.get("privileged")
    read_only_rootfs = value.get("readOnlyRootfs")
    if type(privileged) is not bool or type(read_only_rootfs) is not bool:
        raise RuntimeManifestError("Docker privilege/rootfs state is malformed")

    raw_devices = value.get("devices")
    if raw_devices is None:
        raw_devices = []
    if not isinstance(raw_devices, list) or len(raw_devices) > 256:
        raise RuntimeManifestError("Docker device mappings are malformed")
    devices: list[dict[str, str]] = []
    for device in raw_devices:
        if not isinstance(device, dict) or set(device) != {
            "PathOnHost",
            "PathInContainer",
            "CgroupPermissions",
        }:
            raise RuntimeManifestError("Docker device mapping fields are malformed")
        path_on_host = os.fspath(
            _normalise_absolute(device.get("PathOnHost"), "Docker host device path")
        )
        path_in_container = _normalise_container_path(
            device.get("PathInContainer"), "Docker container device path"
        )
        permissions = device.get("CgroupPermissions")
        if (
            not isinstance(permissions, str)
            or not permissions
            or any(character not in "rwm" for character in permissions)
            or len(set(permissions)) != len(permissions)
        ):
            raise RuntimeManifestError("Docker device permissions are malformed")
        devices.append(
            {
                "pathOnHost": path_on_host,
                "pathInContainer": path_in_container,
                "cgroupPermissions": permissions,
            }
        )
    devices.sort(
        key=lambda item: (
            item["pathInContainer"],
            item["pathOnHost"],
            item["cgroupPermissions"],
        )
    )
    if len({item["pathInContainer"] for item in devices}) != len(devices):
        raise RuntimeManifestError("Docker device mappings contain duplicate targets")

    network_mode = _normalise_bounded_string(
        value.get("networkMode"), "Docker network mode", allow_empty=False
    )
    user = _normalise_bounded_string(
        value.get("user"), "Docker runtime user", allow_empty=True
    )
    command = _normalise_string_vector(
        value.get("command"), "Docker command", allow_null=True
    )
    entrypoint = _normalise_string_vector(
        value.get("entrypoint"),
        "Docker entrypoint",
        allow_null=True,
        allow_scalar=True,
    )
    cap_add = _normalise_string_vector(
        value.get("capAdd"), "Docker added capabilities", allow_null=True
    )
    cap_drop = _normalise_string_vector(
        value.get("capDrop"), "Docker dropped capabilities", allow_null=True
    )
    security_opt = _normalise_string_vector(
        value.get("securityOpt"), "Docker security options", allow_null=True
    )
    assert cap_add is None or isinstance(cap_add, list)
    assert cap_drop is None or isinstance(cap_drop, list)
    assert security_opt is None or isinstance(security_opt, list)
    if cap_add is not None:
        cap_add = sorted(cap_add)
    if cap_drop is not None:
        cap_drop = sorted(cap_drop)
    if security_opt is not None:
        security_opt = sorted(security_opt)
    return {
        "privileged": privileged,
        "devices": devices,
        "networkMode": network_mode,
        "user": user,
        "command": command,
        "entrypoint": entrypoint,
        "capAdd": cap_add,
        "capDrop": cap_drop,
        "securityOpt": security_opt,
        "readOnlyRootfs": read_only_rootfs,
    }


def _runtime_security_digest(value: Mapping[str, Any]) -> str:
    normalised = _normalise_runtime_security(value)
    return hashlib.sha256(_canonical_json({"runtimeSecurity": normalised})).hexdigest()


def _normalise_runtime_environment(value: Any) -> list[tuple[str, str]]:
    """Canonicalise an environment without ever persisting its values."""

    if not isinstance(value, list) or len(value) > MAX_ENVIRONMENT_ENTRIES:
        raise RuntimeManifestError("Docker environment is malformed")
    environment: dict[str, str] = {}
    total_bytes = 0
    for entry in value:
        if not isinstance(entry, str) or "\x00" in entry or "=" not in entry:
            raise RuntimeManifestError("Docker environment entry is malformed")
        key, item_value = entry.split("=", 1)
        if ENVIRONMENT_KEY_RE.fullmatch(key) is None:
            raise RuntimeManifestError("Docker environment key is malformed")
        if key in environment:
            raise RuntimeManifestError("Docker environment contains a duplicate key")
        total_bytes += len(entry.encode("utf-8"))
        if total_bytes > MAX_ENVIRONMENT_BYTES:
            raise RuntimeManifestError("Docker environment exceeds its safety limit")
        environment[key] = item_value
    return sorted(environment.items())


def _runtime_environment_digest(value: Any) -> str:
    return hashlib.sha256(
        _canonical_json(
            {"environment": _normalise_runtime_environment(value)}
        )
    ).hexdigest()


def _normalise_bounded_json(
    value: Any,
    *,
    label: str,
    depth: int = 0,
    item_count: list[int] | None = None,
) -> Any:
    """Validate Docker's functional config before hashing it into the seal."""

    if depth > MAX_RUNTIME_CONFIG_DEPTH:
        raise RuntimeManifestError(f"{label} exceeds its nesting limit")
    if item_count is None:
        item_count = [0]
    item_count[0] += 1
    if item_count[0] > MAX_RUNTIME_CONFIG_ITEMS:
        raise RuntimeManifestError(f"{label} exceeds its item limit")
    if value is None or type(value) is bool:
        return value
    if type(value) is int:
        if value < -(2**63) or value > 2**64 - 1:
            raise RuntimeManifestError(f"{label} integer is out of range")
        return value
    if isinstance(value, str):
        if (
            "\x00" in value
            or len(value.encode("utf-8")) > MAX_RUNTIME_CONFIG_STRING_BYTES
        ):
            raise RuntimeManifestError(f"{label} string is malformed")
        return value
    if isinstance(value, list):
        return [
            _normalise_bounded_json(
                item,
                label=label,
                depth=depth + 1,
                item_count=item_count,
            )
            for item in value
        ]
    if isinstance(value, dict):
        normalised: dict[str, Any] = {}
        for key, item in value.items():
            if (
                not isinstance(key, str)
                or not key
                or "\x00" in key
                or len(key.encode("utf-8")) > 4096
            ):
                raise RuntimeManifestError(f"{label} object key is malformed")
            normalised[key] = _normalise_bounded_json(
                item,
                label=label,
                depth=depth + 1,
                item_count=item_count,
            )
        return normalised
    raise RuntimeManifestError(f"{label} contains an unsupported JSON value")


def _empty_runtime_setting(value: Any) -> bool:
    return value is None or value == [] or value == {}


def _require_supported_capture_runtime(
    container_config: Mapping[str, Any], host_config: Mapping[str, Any]
) -> None:
    """Reject baseline features outside the current agent Compose contract."""

    for key in (
        "PortBindings",
        "ExtraHosts",
        "Dns",
        "DnsOptions",
        "DnsSearch",
        "Links",
        "VolumesFrom",
        "GroupAdd",
        "Tmpfs",
        "Sysctls",
        "Ulimits",
    ):
        if not _empty_runtime_setting(host_config.get(key)):
            raise RuntimeManifestError(
                f"Docker runtime feature is unsupported by rollback capture: {key}"
            )
    for key in ("AutoRemove", "PublishAllPorts"):
        if host_config.get(key) not in {None, False}:
            raise RuntimeManifestError(
                f"Docker runtime feature is unsupported by rollback capture: {key}"
            )
    for key in ("Healthcheck", "ExposedPorts"):
        if not _empty_runtime_setting(container_config.get(key)):
            raise RuntimeManifestError(
                f"Docker runtime feature is unsupported by rollback capture: {key}"
            )


def _functional_runtime_digest(
    container_config: Any,
    host_config: Any,
    *,
    container_id: str,
    require_supported_capture: bool,
) -> tuple[str, str]:
    if not isinstance(container_config, dict) or not isinstance(host_config, dict):
        raise RuntimeManifestError("Docker functional runtime config is malformed")
    environment_digest = _runtime_environment_digest(container_config.get("Env"))
    config = dict(container_config)
    config.pop("Env", None)
    config.pop("Image", None)
    hostname = config.get("Hostname")
    if (
        isinstance(hostname, str)
        and len(hostname) == 12
        and container_id.startswith(hostname)
    ):
        config["Hostname"] = "<docker-generated>"
    labels = config.get("Labels")
    if isinstance(labels, dict):
        labels = dict(labels)
        labels.pop("com.docker.compose.version", None)
        config["Labels"] = labels
    if require_supported_capture:
        _require_supported_capture_runtime(config, host_config)
    functional = _normalise_bounded_json(
        {"containerConfig": config, "hostConfig": dict(host_config)},
        label="Docker functional runtime config",
    )
    return (
        environment_digest,
        hashlib.sha256(
            _canonical_json({"functionalRuntime": functional})
        ).hexdigest(),
    )


def _rollback_tag(run_id: str, host: str, service: str) -> str:
    safe_host = re.sub(r"[^a-z0-9]+", "-", host.lower()).strip("-")[:48] or "host"
    token = hashlib.sha256(f"{run_id}\0{host}\0{service}".encode("utf-8")).hexdigest()[:20]
    return f"raspi-rollback/{safe_host}/{service}:{token}"


def _container_id(project: str, service: str) -> str | None:
    result = _run_command(
        [
            "docker",
            "ps",
            "-a",
            "--filter",
            f"label=com.docker.compose.project={project}",
            "--filter",
            f"label=com.docker.compose.service={service}",
            "--format",
            "{{.ID}}",
        ]
    )
    identifiers = [line for line in result.stdout.splitlines() if line]
    if len(identifiers) > 1:
        raise RuntimeManifestError("multiple Compose containers match one sealed service")
    if not identifiers:
        return None
    identifier = identifiers[0]
    if CONTAINER_ID_RE.fullmatch(identifier) is None:
        raise RuntimeManifestError("Docker container ID is malformed")
    return identifier


def _parse_inspect_json(raw: str) -> dict[str, Any]:
    encoded = raw.encode("utf-8")
    if len(encoded) > MAX_JSON_BYTES:
        raise RuntimeManifestError("Docker inspect output exceeds its size limit")
    return _decode_json(encoded, "Docker inspect")


def _inspect_container(
    identifier: str,
    *,
    expected_project: str,
    expected_service: str,
    require_supported_capture: bool = False,
) -> dict[str, Any]:
    if CONTAINER_ID_RE.fullmatch(identifier) is None:
        raise RuntimeManifestError("Docker container ID is malformed")
    result = _run_command(
        ["docker", "inspect", "--format", CONTAINER_INSPECT_TEMPLATE, identifier]
    )
    value = _parse_inspect_json(result.stdout)
    expected_keys = {
        "id",
        "imageId",
        "imageReference",
        "running",
        "containerConfig",
        "hostConfig",
        "restartPolicy",
        "mounts",
        "privileged",
        "devices",
        "networkMode",
        "user",
        "command",
        "entrypoint",
        "capAdd",
        "capDrop",
        "securityOpt",
        "readOnlyRootfs",
        "project",
        "service",
        "workingDirectory",
        "configFiles",
    }
    if set(value) != expected_keys:
        raise RuntimeManifestError("Docker inspect fields are malformed")
    full_id = value.get("id")
    if not isinstance(full_id, str) or CONTAINER_ID_RE.fullmatch(full_id) is None:
        raise RuntimeManifestError("Docker inspect container ID is malformed")
    if not full_id.startswith(identifier):
        raise RuntimeManifestError("Docker inspect returned a different container")
    if value.get("project") != expected_project or value.get("service") != expected_service:
        raise RuntimeManifestError("Docker Compose labels do not match the request")
    if type(value.get("running")) is not bool:
        raise RuntimeManifestError("Docker running state is malformed")
    runtime_environment_sha256, runtime_config_sha256 = _functional_runtime_digest(
        value.get("containerConfig"),
        value.get("hostConfig"),
        container_id=full_id,
        require_supported_capture=require_supported_capture,
    )
    config_files = value.get("configFiles")
    if not isinstance(config_files, str) or not config_files:
        raise RuntimeManifestError("Docker Compose config label is missing")
    compose = _validate_compose_context(
        {
            "project": value["project"],
            "workingDirectory": value.get("workingDirectory"),
            "configFiles": config_files.split(","),
        },
        require_files=True,
    )
    runtime_security_sha256 = _runtime_security_digest(
        {
            key: value[key]
            for key in (
                "privileged",
                "devices",
                "networkMode",
                "user",
                "command",
                "entrypoint",
                "capAdd",
                "capDrop",
                "securityOpt",
                "readOnlyRootfs",
            )
        }
    )
    return {
        "id": full_id,
        "imageId": _validate_image_id(value.get("imageId")),
        "imageReference": _validate_image_reference(value.get("imageReference")),
        "running": value["running"],
        "restartPolicy": _normalise_restart_policy(value.get("restartPolicy")),
        "mounts": _normalise_mounts(value.get("mounts"), require_sources=True),
        "runtimeSecuritySha256": runtime_security_sha256,
        "runtimeEnvironmentSha256": runtime_environment_sha256,
        "runtimeConfigSha256": runtime_config_sha256,
        "compose": compose,
    }


def _image_id(reference: str, *, allow_missing: bool) -> str | None:
    if allow_missing:
        # `docker image inspect` uses exit 1 both for a genuinely missing image
        # and for several daemon/API failures.  A successful, empty image-list
        # query is the only condition treated as absence; every API failure is
        # fail-closed.
        listed = _run_command(
            ["docker", "image", "ls", "--quiet", "--no-trunc", reference]
        )
        identifiers = [line for line in listed.stdout.splitlines() if line]
        if not identifiers:
            return None
        validated = {_validate_image_id(item) for item in identifiers}
        if len(validated) != 1:
            raise RuntimeManifestError("Docker image reference resolves ambiguously")
    result = _run_command(
        ["docker", "image", "inspect", "--format", "{{.Id}}", reference],
    )
    inspected = _validate_image_id(result.stdout)
    if allow_missing and inspected not in validated:
        raise RuntimeManifestError("Docker image list/inspect results disagree")
    return inspected


def _volume_exists(name: str) -> None:
    result = _run_command(
        ["docker", "volume", "inspect", "--format", "{{.Name}}", name]
    )
    if result.stdout != name:
        raise RuntimeManifestError("Docker volume inspect returned a different volume")


def _capture_docker_record(
    *,
    run_id: str,
    host: str,
    service: str,
    compose: Mapping[str, Any],
) -> dict[str, Any]:
    safe_service = _validate_service(service)
    project = compose["project"]
    identifier = _container_id(project, safe_service)
    if identifier is None:
        return {
            "service": safe_service,
            "state": "absent",
            "imageId": None,
            "imageReference": None,
            "running": None,
            "restartPolicy": None,
            "compose": dict(compose),
            "mounts": [],
            "runtimeSecuritySha256": None,
            "runtimeEnvironmentSha256": None,
            "runtimeConfigSha256": None,
            "rollbackTag": None,
        }
    inspected = _inspect_container(
        identifier,
        expected_project=project,
        expected_service=safe_service,
        require_supported_capture=True,
    )
    if inspected["compose"] != compose:
        raise RuntimeManifestError("container Compose context differs from capture request")
    return {
        "service": safe_service,
        "state": "present",
        "imageId": inspected["imageId"],
        "imageReference": inspected["imageReference"],
        "running": inspected["running"],
        "restartPolicy": inspected["restartPolicy"],
        "compose": inspected["compose"],
        "mounts": inspected["mounts"],
        "runtimeSecuritySha256": inspected["runtimeSecuritySha256"],
        "runtimeEnvironmentSha256": inspected["runtimeEnvironmentSha256"],
        "runtimeConfigSha256": inspected["runtimeConfigSha256"],
        "rollbackTag": _rollback_tag(run_id, host, safe_service),
    }


def _validate_docker_record(
    value: Any, *, run_id: str, host: str, require_paths: bool
) -> dict[str, Any]:
    expected_keys = {
        "service",
        "state",
        "imageId",
        "imageReference",
        "running",
        "restartPolicy",
        "compose",
        "mounts",
        "runtimeSecuritySha256",
        "runtimeEnvironmentSha256",
        "runtimeConfigSha256",
        "rollbackTag",
    }
    if not isinstance(value, dict) or set(value) != expected_keys:
        raise RuntimeManifestError("Docker record fields are malformed")
    service = _validate_service(value.get("service"))
    state = value.get("state")
    compose = _validate_compose_context(value.get("compose"), require_files=require_paths)
    if state == "absent":
        if any(
            value.get(key) is not None
            for key in (
                "imageId",
                "imageReference",
                "running",
                "restartPolicy",
                "runtimeSecuritySha256",
                "runtimeEnvironmentSha256",
                "runtimeConfigSha256",
                "rollbackTag",
            )
        ) or value.get("mounts") != []:
            raise RuntimeManifestError("absent Docker record contains runtime state")
        return {
            "service": service,
            "state": state,
            "imageId": None,
            "imageReference": None,
            "running": None,
            "restartPolicy": None,
            "compose": compose,
            "mounts": [],
            "runtimeSecuritySha256": None,
            "runtimeEnvironmentSha256": None,
            "runtimeConfigSha256": None,
            "rollbackTag": None,
        }
    if state != "present" or type(value.get("running")) is not bool:
        raise RuntimeManifestError("Docker presence/running state is malformed")
    image_id = _validate_image_id(value.get("imageId"))
    image_reference = _validate_image_reference(value.get("imageReference"))
    restart_policy = _normalise_restart_policy(value.get("restartPolicy"))
    mounts = _normalise_mounts(value.get("mounts"), require_sources=require_paths)
    runtime_security_sha256 = value.get("runtimeSecuritySha256")
    if (
        not isinstance(runtime_security_sha256, str)
        or SHA256_RE.fullmatch(runtime_security_sha256) is None
    ):
        raise RuntimeManifestError("Docker security/runtime digest is malformed")
    runtime_environment_sha256 = value.get("runtimeEnvironmentSha256")
    if (
        not isinstance(runtime_environment_sha256, str)
        or SHA256_RE.fullmatch(runtime_environment_sha256) is None
    ):
        raise RuntimeManifestError("Docker environment digest is malformed")
    runtime_config_sha256 = value.get("runtimeConfigSha256")
    if (
        not isinstance(runtime_config_sha256, str)
        or SHA256_RE.fullmatch(runtime_config_sha256) is None
    ):
        raise RuntimeManifestError("Docker functional runtime digest is malformed")
    rollback_tag = value.get("rollbackTag")
    if rollback_tag != _rollback_tag(run_id, host, service):
        raise RuntimeManifestError("Docker rollback tag is not bound to run/host/service")
    return {
        "service": service,
        "state": state,
        "imageId": image_id,
        "imageReference": image_reference,
        "running": value["running"],
        "restartPolicy": restart_policy,
        "compose": compose,
        "mounts": mounts,
        "runtimeSecuritySha256": runtime_security_sha256,
        "runtimeEnvironmentSha256": runtime_environment_sha256,
        "runtimeConfigSha256": runtime_config_sha256,
        "rollbackTag": rollback_tag,
    }


def _validate_manifest(
    value: dict[str, Any], context: ManifestContext, *, require_paths: bool
) -> dict[str, Any]:
    if set(value) != {
        "version",
        "runId",
        "host",
        "units",
        "docker",
        "restartOnRestore",
        "manifestSha256",
    }:
        raise RuntimeManifestError("runtime manifest fields are malformed")
    if value.get("version") != MANIFEST_VERSION:
        raise RuntimeManifestError("runtime manifest version is unsupported")
    if value.get("runId") != context.run_id or value.get("host") != context.host:
        raise RuntimeManifestError("runtime manifest identity does not match its path")
    digest = value.get("manifestSha256")
    if not isinstance(digest, str) or SHA256_RE.fullmatch(digest) is None:
        raise RuntimeManifestError("runtime manifest digest is malformed")
    if not hmac.compare_digest(digest, _digest(value, "manifestSha256")):
        raise RuntimeManifestError("runtime manifest integrity digest does not match")
    raw_units = value.get("units")
    raw_docker = value.get("docker")
    raw_restart_on_restore = value.get("restartOnRestore")
    if (
        not isinstance(raw_units, list)
        or not isinstance(raw_docker, list)
        or not isinstance(raw_restart_on_restore, list)
    ):
        raise RuntimeManifestError("runtime manifest record sets are malformed")
    units = [_validate_unit_record(item) for item in raw_units]
    docker = [
        _validate_docker_record(
            item,
            run_id=context.run_id,
            host=context.host,
            require_paths=require_paths,
        )
        for item in raw_docker
    ]
    unit_names = [item["name"] for item in units]
    service_names = [item["service"] for item in docker]
    if len(set(unit_names)) != len(unit_names):
        raise RuntimeManifestError("runtime manifest contains duplicate units")
    restart_on_restore = [
        _validate_unit_name(item) for item in raw_restart_on_restore
    ]
    if (
        len(set(restart_on_restore)) != len(restart_on_restore)
        or any(item not in RESTART_ON_RESTORE_UNITS for item in restart_on_restore)
        or any(item not in unit_names for item in restart_on_restore)
    ):
        raise RuntimeManifestError("runtime restart-on-restore set is malformed")
    if len(set(service_names)) != len(service_names):
        raise RuntimeManifestError("runtime manifest contains duplicate Docker services")
    if not units and not docker:
        raise RuntimeManifestError("runtime manifest contains no runtime targets")
    return {
        **value,
        "units": units,
        "docker": docker,
        "restartOnRestore": restart_on_restore,
    }


def _load_manifest(context: ManifestContext, *, require_paths: bool) -> dict[str, Any]:
    return _validate_manifest(
        _read_secure_json(context.manifest_path, "runtime manifest"),
        context,
        require_paths=require_paths,
    )


def _receipt_value(context: ManifestContext, manifest_digest: str, kind: str) -> dict[str, Any]:
    base = {
        "version": RECEIPT_VERSION,
        "runId": context.run_id,
        "host": context.host,
        "manifestSha256": manifest_digest,
        "kind": kind,
    }
    return _seal(base, "receiptSha256")


def _validate_receipt(
    value: dict[str, Any], context: ManifestContext, manifest_digest: str, kind: str
) -> dict[str, Any]:
    if set(value) != {
        "version",
        "runId",
        "host",
        "manifestSha256",
        "kind",
        "receiptSha256",
    }:
        raise RuntimeManifestError("runtime receipt fields are malformed")
    if (
        value.get("version") != RECEIPT_VERSION
        or value.get("runId") != context.run_id
        or value.get("host") != context.host
        or value.get("manifestSha256") != manifest_digest
        or value.get("kind") != kind
    ):
        raise RuntimeManifestError("runtime receipt identity is malformed")
    digest = value.get("receiptSha256")
    if (
        not isinstance(digest, str)
        or SHA256_RE.fullmatch(digest) is None
        or not hmac.compare_digest(digest, _digest(value, "receiptSha256"))
    ):
        raise RuntimeManifestError("runtime receipt digest does not match")
    return value


def _receipt_exists(
    path: Path, context: ManifestContext, manifest_digest: str, kind: str
) -> bool:
    try:
        path.lstat()
    except FileNotFoundError:
        return False
    _validate_receipt(
        _read_secure_json(path, f"runtime {kind} receipt"),
        context,
        manifest_digest,
        kind,
    )
    return True


def _outcome_receipt_exists(
    path: Path,
    context: ManifestContext,
    manifest_digest: str,
    *,
    phase: str,
    outcome: str,
) -> bool:
    try:
        path.lstat()
    except FileNotFoundError:
        return False
    expected_kind = f"{phase}:{outcome}"
    receipt = _read_secure_json(path, f"runtime {phase} receipt")
    if receipt.get("kind") != expected_kind:
        raise RuntimeManifestError("runtime cleanup receipt outcome does not match request")
    _validate_receipt(receipt, context, manifest_digest, expected_kind)
    return True


def _require_runtime_manifest_open(
    context: ManifestContext, manifest_digest: str, operation: str
) -> None:
    outcomes_seen: set[str] = set()
    for path, phase in (
        (context.cleanup_started_path, "cleanup-started"),
        (context.cleanup_path, "cleanup"),
    ):
        try:
            path.lstat()
        except FileNotFoundError:
            continue
        receipt = _read_secure_json(path, f"runtime {phase} receipt")
        kind = receipt.get("kind")
        outcomes = {
            f"{phase}:committed": "committed",
            f"{phase}:restored": "restored",
        }
        if kind not in outcomes:
            raise RuntimeManifestError(f"runtime {phase} receipt outcome is malformed")
        _validate_receipt(receipt, context, manifest_digest, kind)
        outcomes_seen.add(outcomes[kind])
    if len(outcomes_seen) > 1:
        raise RuntimeManifestError("runtime cleanup receipt outcomes disagree")
    if outcomes_seen:
        raise RuntimeManifestError(
            f"runtime manifest cleanup has started; {operation} is no longer permitted"
        )


def _capture_result(
    context: ManifestContext, manifest: Mapping[str, Any]
) -> dict[str, Any]:
    return {
        "captured": True,
        "manifest": os.fspath(context.manifest_path),
        "manifestSha256": manifest["manifestSha256"],
        "unitCount": len(manifest["units"]),
        "dockerCount": len(manifest["docker"]),
        "rollbackTags": [
            item["rollbackTag"] for item in manifest["docker"] if item["rollbackTag"]
        ],
    }


def _verify_capture_retry(
    manifest: Mapping[str, Any],
    *,
    requested_units: Sequence[str],
    requested_services: Sequence[str],
    requested_restart_on_restore: Sequence[str],
    compose: Mapping[str, Any] | None,
) -> None:
    if [item["name"] for item in manifest["units"]] != list(requested_units):
        raise RuntimeManifestError("existing runtime manifest has a different unit request")
    if [item["service"] for item in manifest["docker"]] != list(requested_services):
        raise RuntimeManifestError("existing runtime manifest has a different Docker request")
    if manifest["restartOnRestore"] != list(requested_restart_on_restore):
        raise RuntimeManifestError(
            "existing runtime manifest has a different restart-on-restore request"
        )
    if any(item["compose"] != compose for item in manifest["docker"]):
        raise RuntimeManifestError("existing runtime manifest has a different Compose context")
    for record in manifest["docker"]:
        if record["state"] != "present":
            continue
        retained = _image_id(record["rollbackTag"], allow_missing=True)
        if retained is None or not hmac.compare_digest(retained, record["imageId"]):
            raise RuntimeManifestError("existing runtime manifest rollback tag is unavailable")


def capture(
    *,
    root: os.PathLike[str] | str,
    run_id: str,
    host: str,
    units: Sequence[str],
    docker_services: Sequence[str],
    restart_on_restore_units: Sequence[str] = (),
    compose_project: str | None = None,
    compose_working_directory: os.PathLike[str] | str | None = None,
    compose_config_files: Sequence[os.PathLike[str] | str] = (),
) -> dict[str, Any]:
    context = _build_context(root=root, run_id=run_id, host=host, create=True)
    requested_units = [_validate_unit_name(item) for item in units]
    requested_services = [_validate_service(item) for item in docker_services]
    requested_restart_on_restore = [
        _validate_unit_name(item) for item in restart_on_restore_units
    ]
    if len(set(requested_units)) != len(requested_units):
        raise RuntimeManifestError("capture request contains duplicate systemd units")
    if len(set(requested_services)) != len(requested_services):
        raise RuntimeManifestError("capture request contains duplicate Docker services")
    if (
        len(set(requested_restart_on_restore))
        != len(requested_restart_on_restore)
        or any(
            item not in RESTART_ON_RESTORE_UNITS
            for item in requested_restart_on_restore
        )
        or any(item not in requested_units for item in requested_restart_on_restore)
    ):
        raise RuntimeManifestError("capture restart-on-restore set is malformed")
    if not requested_units and not requested_services:
        raise RuntimeManifestError("capture request contains no runtime targets")
    if requested_services:
        if compose_project is None or compose_working_directory is None:
            raise RuntimeManifestError("Docker capture requires a Compose context")
        compose = _validate_compose_context(
            {
                "project": compose_project,
                "workingDirectory": os.fspath(compose_working_directory),
                "configFiles": [os.fspath(path) for path in compose_config_files],
            },
            require_files=True,
        )
    else:
        if (
            compose_project is not None
            or compose_working_directory is not None
            or compose_config_files
        ):
            raise RuntimeManifestError("Compose context was provided without Docker services")
        compose = None

    with _HostLock(context.lock_path):
        try:
            context.manifest_path.lstat()
        except FileNotFoundError:
            pass
        else:
            existing_manifest = _load_manifest(context, require_paths=True)
            _require_runtime_manifest_open(
                context, existing_manifest["manifestSha256"], "capture"
            )
            _verify_capture_retry(
                existing_manifest,
                requested_units=requested_units,
                requested_services=requested_services,
                requested_restart_on_restore=requested_restart_on_restore,
                compose=compose,
            )
            if compose is not None:
                _preflight_compose(compose)
            return _capture_result(context, existing_manifest)

        if compose is not None:
            _preflight_compose(compose)
        unit_records = [_capturable_systemd_state(unit) for unit in requested_units]
        assert compose is not None or not requested_services
        docker_records = [
            _capture_docker_record(
                run_id=context.run_id,
                host=context.host,
                service=service,
                compose=compose,
            )
            for service in requested_services
        ]
        created_tags: list[tuple[str, str]] = []
        manifest_written = False
        try:
            for record in docker_records:
                if record["state"] != "present":
                    continue
                existing = _image_id(record["rollbackTag"], allow_missing=True)
                if existing is not None and not hmac.compare_digest(
                    existing, record["imageId"]
                ):
                    raise RuntimeManifestError(
                        "run-scoped rollback tag points to another image"
                    )
                if existing is None:
                    _run_command(
                        ["docker", "tag", record["imageId"], record["rollbackTag"]]
                    )
                    created_tags.append((record["rollbackTag"], record["imageId"]))
                retained = _image_id(record["rollbackTag"], allow_missing=False)
                if retained is None or not hmac.compare_digest(
                    retained, record["imageId"]
                ):
                    raise RuntimeManifestError(
                        "run-scoped rollback image retention failed"
                    )

            manifest = _seal(
                {
                    "version": MANIFEST_VERSION,
                    "runId": context.run_id,
                    "host": context.host,
                    "units": unit_records,
                    "docker": docker_records,
                    "restartOnRestore": requested_restart_on_restore,
                },
                "manifestSha256",
            )
            _validate_manifest(manifest, context, require_paths=True)
            _atomic_json(context.manifest_path, manifest)
            manifest_written = True
            _secure_file(context.manifest_path, "runtime manifest")
        except BaseException:
            if not manifest_written:
                for tag, expected_image in reversed(created_tags):
                    try:
                        retained = _image_id(tag, allow_missing=True)
                        if retained is not None and hmac.compare_digest(
                            retained, expected_image
                        ):
                            _run_command(["docker", "image", "rm", tag])
                    except BaseException:
                        pass
            raise
    return _capture_result(context, manifest)


def _preflight_docker(record: Mapping[str, Any]) -> None:
    compose = record["compose"]
    _validate_compose_context(compose, require_files=True)
    # Validate the exact, fixed Compose context before any image reference is
    # retagged.  Restore commands additionally use --pull never, so a rollback
    # cannot turn into a registry operation.
    _preflight_compose(compose)
    current = _container_id(compose["project"], record["service"])
    if current is not None:
        _inspect_container(
            current,
            expected_project=compose["project"],
            expected_service=record["service"],
        )
    if record["state"] == "absent":
        return
    retained = _image_id(record["rollbackTag"], allow_missing=True)
    if retained is None or not hmac.compare_digest(retained, record["imageId"]):
        raise RuntimeManifestError("sealed rollback image is unavailable")
    for mount in record["mounts"]:
        if mount["type"] == "volume":
            _volume_exists(mount["name"])
        elif mount["type"] == "bind":
            _normalise_mount(mount, require_sources=True)


def _compose_argv(compose: Mapping[str, Any]) -> list[str]:
    argv = [
        "docker",
        "compose",
        "--project-name",
        compose["project"],
        "--project-directory",
        compose["workingDirectory"],
    ]
    for config_file in compose["configFiles"]:
        argv.extend(["-f", config_file])
    return argv


def _preflight_compose(compose: Mapping[str, Any]) -> None:
    _validate_compose_context(compose, require_files=True)
    _run_command([*_compose_argv(compose), "config", "--quiet"])


def _restart_policy_argument(policy: Mapping[str, Any]) -> str:
    name = policy["name"]
    maximum = policy["maximumRetryCount"]
    return f"on-failure:{maximum}" if name == "on-failure" and maximum else name


def _docker_record_matches(record: Mapping[str, Any]) -> bool:
    compose = record["compose"]
    identifier = _container_id(compose["project"], record["service"])
    if record["state"] == "absent":
        return identifier is None
    if identifier is None:
        return False
    actual = _inspect_container(
        identifier,
        expected_project=compose["project"],
        expected_service=record["service"],
    )
    expected = {
        key: record[key]
        for key in (
            "imageId",
            "imageReference",
            "running",
            "restartPolicy",
            "mounts",
            "runtimeSecuritySha256",
            "runtimeEnvironmentSha256",
            "runtimeConfigSha256",
            "compose",
        )
    }
    actual_comparable = {key: actual[key] for key in expected}
    if actual_comparable != expected:
        return False
    referenced_image = _image_id(record["imageReference"], allow_missing=True)
    return referenced_image is not None and hmac.compare_digest(
        referenced_image, record["imageId"]
    )


def _verify_docker_record(record: Mapping[str, Any]) -> None:
    if not _docker_record_matches(record):
        raise RuntimeManifestError("Docker service does not match its sealed runtime state")


def _restore_docker(record: Mapping[str, Any]) -> None:
    compose = record["compose"]
    service = record["service"]
    if record["state"] == "absent":
        identifier = _container_id(compose["project"], service)
        if identifier is not None:
            _run_command(["docker", "rm", "--force", identifier])
        _verify_docker_record(record)
        return

    _run_command(["docker", "tag", record["rollbackTag"], record["imageReference"]])
    restored_image = _image_id(record["imageReference"], allow_missing=False)
    if restored_image is None or not hmac.compare_digest(restored_image, record["imageId"]):
        raise RuntimeManifestError("prior Docker image reference could not be restored")
    if record["running"]:
        compose_action = [
            "up",
            "-d",
            "--pull",
            "never",
            "--no-build",
            "--force-recreate",
            "--no-deps",
            service,
        ]
    else:
        compose_action = [
            "create",
            "--pull",
            "never",
            "--no-build",
            "--force-recreate",
            "--no-deps",
            service,
        ]
    _run_command([*_compose_argv(compose), *compose_action])
    identifier = _container_id(compose["project"], service)
    if identifier is None:
        raise RuntimeManifestError("Compose did not recreate the sealed service")
    _run_command(
        [
            "docker",
            "update",
            "--restart",
            _restart_policy_argument(record["restartPolicy"]),
            identifier,
        ]
    )
    _verify_docker_record(record)


def _quiesce_unit(record: Mapping[str, Any], current: Mapping[str, Any]) -> bool:
    if current["loadState"] == "not-found" or current["activeState"] == "inactive":
        return False
    if current["activeState"] not in {"active", "failed"}:
        raise RuntimeManifestError("systemd unit cannot be safely quiesced")
    _run_command(["systemctl", "stop", record["name"]])
    stopped = _systemd_observation(
        record["name"], allow_current_failed=True
    ).state
    if stopped["activeState"] != "inactive":
        raise RuntimeManifestError("systemd unit did not quiesce before rollback")
    return True


def _unit_file_state_differs(
    record: Mapping[str, Any], current: Mapping[str, Any]
) -> bool:
    return any(
        record[key] != current[key]
        for key in ("loadState", "unitFileState", "persistent")
    )


def _verify_inactive_unit_state(record: Mapping[str, Any]) -> None:
    current = _systemd_state(record["name"])
    expected = {**record, "activeState": "inactive"}
    if current != expected:
        raise RuntimeManifestError(
            "systemd unit-file/inactive state does not match its sealed runtime state"
        )


def _restore_unit_file_state(record: Mapping[str, Any]) -> None:
    unit = record["name"]
    unit_file_state = record["unitFileState"]
    if unit_file_state == "not-found":
        if _systemd_state(unit) != record:
            raise RuntimeManifestError("not-found systemd unit was not restored by file rollback")
        return
    if unit_file_state in {"masked", "masked-runtime"}:
        _run_command(["systemctl", "unmask", unit])
        _run_command(["systemctl", "unmask", "--runtime", unit])
        mask = ["systemctl", "mask"]
        if unit_file_state == "masked-runtime":
            mask.append("--runtime")
        _run_command([*mask, unit])
    else:
        _run_command(["systemctl", "unmask", unit])
        _run_command(["systemctl", "unmask", "--runtime", unit])
        if unit_file_state == "enabled":
            _run_command(["systemctl", "disable", "--runtime", unit])
            _run_command(["systemctl", "enable", unit])
        elif unit_file_state == "enabled-runtime":
            _run_command(["systemctl", "disable", unit])
            _run_command(["systemctl", "enable", "--runtime", unit])
        elif unit_file_state == "disabled":
            _run_command(["systemctl", "disable", unit])
            _run_command(["systemctl", "disable", "--runtime", unit])
        elif unit_file_state in {"static", "indirect", "generated", "transient"}:
            _run_command(["systemctl", "disable", unit])
            _run_command(["systemctl", "disable", "--runtime", unit])
    _verify_inactive_unit_state(record)


def _activate_unit(record: Mapping[str, Any]) -> None:
    if record["activeState"] != "active":
        return
    _run_command(["systemctl", "start", record["name"]])
    if _systemd_state(record["name"]) != record:
        raise RuntimeManifestError("systemd unit does not match its sealed runtime state")


def restore(
    *,
    root: os.PathLike[str] | str,
    run_id: str,
    host: str,
    expected_manifest_sha256: str,
) -> dict[str, Any]:
    if (
        not isinstance(expected_manifest_sha256, str)
        or SHA256_RE.fullmatch(expected_manifest_sha256) is None
    ):
        raise RuntimeManifestError("expected runtime manifest digest is malformed")
    context = _build_context(root=root, run_id=run_id, host=host, create=False)
    with _HostLock(context.lock_path):
        manifest = _load_manifest(context, require_paths=True)
        if not hmac.compare_digest(
            manifest["manifestSha256"], expected_manifest_sha256
        ):
            raise RuntimeManifestError("runtime manifest differs from expected sealed digest")
        _require_runtime_manifest_open(context, manifest["manifestSha256"], "restore")

        if _receipt_exists(
            context.restored_path,
            context,
            manifest["manifestSha256"],
            "restored",
        ):
            for record in manifest["docker"]:
                _verify_docker_record(record)
            for record in manifest["units"]:
                if _systemd_state(record["name"]) != record:
                    raise RuntimeManifestError(
                        "restored runtime changed after its durable receipt"
                    )
            return {
                "restored": True,
                "manifestSha256": manifest["manifestSha256"],
                "unitCount": len(manifest["units"]),
                "dockerCount": len(manifest["docker"]),
            }

        ordered_units = list(reversed(manifest["units"]))
        restart_on_restore = set(manifest["restartOnRestore"])
        # Captured timers are managed safety dependencies: even when their own
        # definition is unchanged, they must not fire while another sealed
        # runtime target is being restored.  This includes every Persistent
        # timer, and avoids treating unrelated services (notably lightdm) as a
        # reason to tear down a healthy GUI session.
        safety_timer_names: set[str] = set()
        for _attempt in range(3):
            current_units = {
                record["name"]: _systemd_observation(
                    record["name"], allow_current_failed=True
                )
                for record in manifest["units"]
            }
            for record in manifest["docker"]:
                _preflight_docker(record)
            changed_docker = [
                record
                for record in manifest["docker"]
                if not _docker_record_matches(record)
            ]
            direct_unit_names = {
                record["name"]
                for record in manifest["units"]
                if (
                    current_units[record["name"]].state != record
                    or current_units[record["name"]].needs_daemon_reload
                    or (
                        record["name"] in restart_on_restore
                        and record["activeState"] == "active"
                        and current_units[record["name"]].state["activeState"]
                        == "active"
                    )
                )
            }
            if not direct_unit_names and not changed_docker:
                break
            active_timer_names = {
                record["name"]
                for record in manifest["units"]
                if (
                    record["name"].endswith(".timer")
                    and current_units[record["name"]].state["activeState"]
                    in {"active", "failed"}
                )
            }
            if not active_timer_names:
                break
            for record in ordered_units:
                if record["name"] in active_timer_names:
                    _quiesce_unit(
                        record, current_units[record["name"]].state
                    )
            safety_timer_names.update(active_timer_names)
        else:
            raise RuntimeManifestError(
                "systemd timers did not remain quiesced during rollback preflight"
            )
        transition_unit_names = direct_unit_names | safety_timer_names
        for record in ordered_units:
            if (
                record["name"] in direct_unit_names
                and not record["name"].endswith(".timer")
            ):
                _quiesce_unit(record, current_units[record["name"]].state)

        reload_required = any(
            current_units[record["name"]].needs_daemon_reload
            or _unit_file_state_differs(
                record, current_units[record["name"]].state
            )
            for record in manifest["units"]
            if record["name"] in direct_unit_names
        )
        if reload_required:
            _run_command(["systemctl", "daemon-reload"])
        for record in ordered_units:
            if record["name"] not in direct_unit_names:
                continue
            if _unit_file_state_differs(
                record, current_units[record["name"]].state
            ):
                _restore_unit_file_state(record)
            else:
                _verify_inactive_unit_state(record)
        for record in reversed(changed_docker):
            _restore_docker(record)
        for record in ordered_units:
            if (
                record["name"] in direct_unit_names
                and not record["name"].endswith(".timer")
            ):
                _activate_unit(record)
        for record in ordered_units:
            if (
                record["name"] in transition_unit_names
                and record["name"].endswith(".timer")
            ):
                _activate_unit(record)

        for record in manifest["docker"]:
            _verify_docker_record(record)
        for record in manifest["units"]:
            if _systemd_state(record["name"]) != record:
                raise RuntimeManifestError("systemd postflight verification failed")

        receipt = _receipt_value(
            context, manifest["manifestSha256"], "restored"
        )
        _atomic_json(context.restored_path, receipt)
        _secure_file(context.restored_path, "runtime restored receipt")
    return {
        "restored": True,
        "manifestSha256": manifest["manifestSha256"],
        "unitCount": len(manifest["units"]),
        "dockerCount": len(manifest["docker"]),
    }


def cleanup(
    *,
    root: os.PathLike[str] | str,
    run_id: str,
    host: str,
    expected_manifest_sha256: str,
    outcome: str,
) -> dict[str, Any]:
    if (
        not isinstance(expected_manifest_sha256, str)
        or SHA256_RE.fullmatch(expected_manifest_sha256) is None
    ):
        raise RuntimeManifestError("expected runtime manifest digest is malformed")
    if outcome not in {"committed", "restored"}:
        raise RuntimeManifestError("cleanup outcome must be committed or restored")
    context = _build_context(root=root, run_id=run_id, host=host, create=False)
    with _HostLock(context.lock_path):
        manifest = _load_manifest(context, require_paths=False)
        if not hmac.compare_digest(
            manifest["manifestSha256"], expected_manifest_sha256
        ):
            raise RuntimeManifestError("runtime manifest differs from expected sealed digest")
        cleanup_exists = _outcome_receipt_exists(
            context.cleanup_path,
            context,
            manifest["manifestSha256"],
            phase="cleanup",
            outcome=outcome,
        )
        if outcome == "restored" and not _receipt_exists(
            context.restored_path,
            context,
            manifest["manifestSha256"],
            "restored",
        ):
            raise RuntimeManifestError("restored cleanup requires a verified restore")
        tagged = [record for record in manifest["docker"] if record["rollbackTag"]]
        if cleanup_exists:
            for record in tagged:
                if _image_id(record["rollbackTag"], allow_missing=True) is not None:
                    raise RuntimeManifestError(
                        "rollback tag reappeared after verified cleanup"
                    )
            return {
                "cleaned": True,
                "alreadyClean": True,
                "manifestSha256": manifest["manifestSha256"],
                "tagCount": 0,
                "outcome": outcome,
            }

        cleanup_started = _outcome_receipt_exists(
            context.cleanup_started_path,
            context,
            manifest["manifestSha256"],
            phase="cleanup-started",
            outcome=outcome,
        )
        retained_tags: set[str] = set()
        for record in tagged:
            retained = _image_id(record["rollbackTag"], allow_missing=True)
            if retained is None:
                if not cleanup_started:
                    raise RuntimeManifestError("rollback tag is missing before cleanup starts")
                continue
            if not hmac.compare_digest(retained, record["imageId"]):
                raise RuntimeManifestError("rollback tag changed before cleanup")
            retained_tags.add(record["rollbackTag"])
        if not cleanup_started:
            started_receipt = _receipt_value(
                context,
                manifest["manifestSha256"],
                f"cleanup-started:{outcome}",
            )
            _atomic_json(context.cleanup_started_path, started_receipt)
            _secure_file(
                context.cleanup_started_path, "runtime cleanup-started receipt"
            )
        for record in reversed(tagged):
            if record["rollbackTag"] in retained_tags:
                _run_command(["docker", "image", "rm", record["rollbackTag"]])
        for record in tagged:
            if _image_id(record["rollbackTag"], allow_missing=True) is not None:
                raise RuntimeManifestError("rollback tag remains after cleanup")

        receipt = _receipt_value(
            context, manifest["manifestSha256"], f"cleanup:{outcome}"
        )
        _atomic_json(context.cleanup_path, receipt)
        _secure_file(context.cleanup_path, "runtime cleanup receipt")
    return {
        "cleaned": True,
        "alreadyClean": False,
        "manifestSha256": manifest["manifestSha256"],
        "tagCount": len(tagged),
        "outcome": outcome,
    }


def _add_common_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--host", required=True)
    parser.add_argument("--ansible-marker", action="store_true")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    capture_parser = subparsers.add_parser("capture")
    _add_common_arguments(capture_parser)
    capture_parser.add_argument("--unit", action="append", default=[])
    capture_parser.add_argument(
        "--restart-on-restore-unit",
        action="append",
        default=[],
        choices=sorted(RESTART_ON_RESTORE_UNITS),
    )
    capture_parser.add_argument(
        "--docker-service", action="append", default=[], choices=sorted(ALLOWED_DOCKER_SERVICES)
    )
    capture_parser.add_argument("--compose-project")
    capture_parser.add_argument("--compose-working-directory", type=Path)
    capture_parser.add_argument("--compose-config-file", action="append", type=Path, default=[])

    restore_parser = subparsers.add_parser("restore")
    _add_common_arguments(restore_parser)
    restore_parser.add_argument("--expected-manifest-sha256", required=True)

    cleanup_parser = subparsers.add_parser("cleanup")
    _add_common_arguments(cleanup_parser)
    cleanup_parser.add_argument("--expected-manifest-sha256", required=True)
    cleanup_parser.add_argument(
        "--outcome", required=True, choices=("committed", "restored")
    )

    args = parser.parse_args(argv)
    try:
        if args.command == "capture":
            result = capture(
                root=args.root,
                run_id=args.run_id,
                host=args.host,
                units=args.unit,
                docker_services=args.docker_service,
                restart_on_restore_units=args.restart_on_restore_unit,
                compose_project=args.compose_project,
                compose_working_directory=args.compose_working_directory,
                compose_config_files=args.compose_config_file,
            )
        elif args.command == "restore":
            result = restore(
                root=args.root,
                run_id=args.run_id,
                host=args.host,
                expected_manifest_sha256=args.expected_manifest_sha256,
            )
        else:
            result = cleanup(
                root=args.root,
                run_id=args.run_id,
                host=args.host,
                expected_manifest_sha256=args.expected_manifest_sha256,
                outcome=args.outcome,
            )
    except (RuntimeManifestError, OSError) as error:
        print(f"terminal runtime manifest failed: {error}", file=sys.stderr)
        return 1
    encoded = json.dumps(result, ensure_ascii=False, sort_keys=True)
    if args.ansible_marker:
        marker = base64.urlsafe_b64encode(encoded.encode("utf-8")).decode("ascii")
        print(MARKER_PREFIX + marker)
    else:
        print(encoded)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
