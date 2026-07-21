"""Ansible command adapter used by the rolling-release coordinator.

This module executes already-decided host actions.  It deliberately does not
choose release scope, host order, or rollback policy.
"""
from __future__ import annotations

import base64
import binascii
import hashlib
import json
import os
import re
import shlex
import subprocess
import tempfile
import time
import zipapp
from contextlib import contextmanager
from pathlib import Path
from typing import TYPE_CHECKING, Any, Protocol

from ..adapter_registry import adapter_for_profile
from .. import telemetry
from ..activation import (
    ActivationUncertainError,
    KIOSK_WEB_ACTIVATION_STRATEGY,
    KIOSK_WEB_ACTIVATION_TARGET_UNIT,
)

if TYPE_CHECKING:
    from ..terminal_adapters import TerminalRuntimeManifestContract


_RUN_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{2,79}$")
_HOST_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,254}$")
_CLIENT_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
_FULL_SHA_RE = re.compile(r"^[0-9a-f]{40}$")
_SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
_VERIFICATION_ID_RE = re.compile(r"^[0-9a-f]{32}$")
_REMOTE_USER_RE = re.compile(r"^[a-z_][a-z0-9_-]{0,31}$")
_REMOTE_HOME_RE = re.compile(r"^/home/[a-z_][a-z0-9_-]{0,31}$")
_SYSTEMD_UNIT_RE = re.compile(
    r"^[A-Za-z0-9][A-Za-z0-9_.@:-]{0,126}\."
    r"(?:service|timer|socket|path|target|mount)$"
)
_MANIFEST_MARKER_RE = re.compile(
    r"ROLLBACK_MANIFEST_RESULT:([A-Za-z0-9_-]+={0,2})(?![A-Za-z0-9_=-])"
)
_REPOSITORY_BASELINE_MARKER_RE = re.compile(
    r"TERMINAL_REPOSITORY_BASELINE_RESULT:"
    r"([A-Za-z0-9_-]+={0,2})(?![A-Za-z0-9_=-])"
)
_RUNTIME_MANIFEST_MARKER_RE = re.compile(
    r"TERMINAL_RUNTIME_MANIFEST_RESULT:"
    r"([A-Za-z0-9_-]+={0,2})(?![A-Za-z0-9_=-])"
)
_RUNTIME_MANIFEST_ERROR_MARKER_RE = re.compile(
    r"TERMINAL_RUNTIME_MANIFEST_ERROR:"
    r"([A-Za-z0-9_-]+={0,2})(?![A-Za-z0-9_=-])"
)
_SIGNAGE_MAINTENANCE_MARKER_RE = re.compile(
    r"SIGNAGE_MAINTENANCE_SEALED:([0-9a-f]{64})(?![0-9a-f])"
)
_SIGNAGE_ENDPOINT_MARKER_RE = re.compile(
    r"SIGNAGE_ENDPOINT_PROOF_OK:([0-9a-f]{64})(?![0-9a-f])"
)
_SIGNAGE_RUNTIME_MARKER_RE = re.compile(
    r"SIGNAGE_RUNTIME_PROOF_OK:([0-9a-f]{64})(?![0-9a-f])"
)
_KIOSK_AGENT_ORDER = ("nfc-agent", "barcode-agent", "torque-agent")
_TERMINAL_AGENT_MARKER_RE = re.compile(
    r"TERMINAL_AGENT_HEALTH_OK:("
    + "|".join(re.escape(agent) for agent in _KIOSK_AGENT_ORDER)
    + r"):([0-9]{1,5})"
    r"(?![A-Za-z0-9_-])"
)
_TERMINAL_RELEASE_EVIDENCE_MARKER_RE = re.compile(
    r"TERMINAL_RELEASE_EVIDENCE_RESULT:"
    r"([A-Za-z0-9_-]+={0,2})(?![A-Za-z0-9_=-])"
)
_TERMINAL_MANIFEST_CAPTURE_MARKER_RE = re.compile(
    r"TERMINAL_MANIFEST_CAPTURE_RESULT:"
    r"([A-Za-z0-9_-]+={0,2})(?![A-Za-z0-9_=-])"
)
_TERMINAL_MANIFEST_CAPTURE_ERROR_MARKER_RE = re.compile(
    r"TERMINAL_MANIFEST_CAPTURE_ERROR:"
    r"([A-Za-z0-9_-]+={0,2})(?![A-Za-z0-9_=-])"
)
_MAX_MARKER_BYTES = 2 * 1024 * 1024
_READ_ONLY_CONFIG_NAME = "ansible-readonly.cfg"
_READ_ONLY_ENVIRONMENT_REMOVALS = (
    "ANSIBLE_INVENTORY",
    "ANSIBLE_VAULT_IDENTITY_LIST",
    "ANSIBLE_VAULT_ID_MATCH",
    "ANSIBLE_VAULT_PASSWORD_FILE",
)


def _terminal_apply_environment() -> dict[str, str]:
    """Return the process environment for the candidate terminal executor.

    Pipelining is deliberately scoped to the forward terminal playbook and
    its exact preflight. Rollback, manifest capture, and evidence collection
    retain their previously accepted Ansible transport behavior.
    """

    environment = os.environ.copy()
    environment["ANSIBLE_PIPELINING"] = "true"
    environment["ANSIBLE_SSH_PIPELINING"] = "true"
    return environment


@contextmanager
def _bundled_script(
    runtime: "Runtime",
    *,
    main: str,
    modules: dict[str, str],
):
    """Build one candidate-owned zipapp for a single Ansible script call."""

    with tempfile.TemporaryDirectory(prefix="raspi-release-bundle-") as temporary:
        source_directory = Path(temporary) / "source"
        source_directory.mkdir(mode=0o700)
        sources = {"__main__.py": main, **modules}
        for destination, relative in sources.items():
            source = Path(runtime.PROJECT) / relative
            if not source.is_file() or source.is_symlink():
                raise RuntimeError(f"release bundle source is unavailable: {relative}")
            (source_directory / destination).write_bytes(source.read_bytes())
        archive = Path(temporary) / "release-helper.pyz"
        zipapp.create_archive(
            source_directory,
            target=archive,
            interpreter="/usr/bin/env python3",
            compressed=False,
        )
        archive.chmod(0o700)
        yield archive


def _release_timing_environment(
    environment: dict[str, str],
    *,
    runtime: "Runtime",
    run_id: str,
    host: str,
    scope: str,
) -> None:
    """Enable a notification callback only for an orchestrated release run."""

    environment.update(telemetry.environment(Path(runtime.PROJECT), run_id, host, scope))
    plugin_directory = str(Path(runtime.ANSIBLE_DIRECTORY) / "callback_plugins")
    existing_plugins = environment.get("ANSIBLE_CALLBACK_PLUGINS", "")
    environment["ANSIBLE_CALLBACK_PLUGINS"] = os.pathsep.join(
        item for item in (existing_plugins, plugin_directory) if item
    )
    enabled = [
        item
        for item in environment.get("ANSIBLE_CALLBACKS_ENABLED", "").split(",")
        if item
    ]
    if "rolling_release_timing" not in enabled:
        enabled.append("rolling_release_timing")
    environment["ANSIBLE_CALLBACKS_ENABLED"] = ",".join(enabled)

_TERMINAL_REPOSITORY = "/opt/RaspberryPiSystem_002"
_ROLLBACK_MANIFEST_ROOT = "/var/lib/raspi-release/rollback-manifests"
_RUNTIME_MANIFEST_ROOT = "/var/lib/raspi-release/rollback-runtime"
_KIOSK_WEB_ACTIVATION_UNIT_RE = re.compile(
    r"^raspi-kiosk-web-[0-9a-f]{20}\.service$"
)
_KIOSK_WEB_ACTIVATION_RECONCILE_ATTEMPTS = 65
_KIOSK_WEB_ACTIVATION_RECONCILE_DELAY_SECONDS = 1
_SERVER_CONFIG_PATHS = (
    f"{_TERMINAL_REPOSITORY}/apps/api/.env",
    f"{_TERMINAL_REPOSITORY}/apps/web/.env",
    f"{_TERMINAL_REPOSITORY}/infrastructure/docker/.env",
)
_COMMON_RUNTIME_UNITS = (
    "lightdm.service",
    "status-agent.service",
    "status-agent.timer",
    "haizen-agent.service",
)
_KIOSK_RUNTIME_UNITS = ("kiosk-browser.service",)
_SIGNAGE_RUNTIME_UNITS = (
    "signage-lite.service",
    "signage-lite-update.service",
    "signage-lite-update.timer",
    "signage-lite-watchdog.service",
    "signage-lite-watchdog.timer",
    "signage-daily-reboot.service",
    "signage-daily-reboot.timer",
)

# This is deliberately an explicit destination contract, not a filesystem
# glob.  Capturing an absent path is supported by rollback-manifest.py, so the
# same sealed set works across terminal variants without discovering or
# restoring unrelated host files.
_COMMON_TERMINAL_PATHS = (
    "/etc/raspi-status-agent.conf",
    "/etc/systemd/system/status-agent.service",
    "/etc/systemd/system/status-agent.timer",
    "/etc/systemd/system/timers.target.wants/status-agent.timer",
    "/etc/systemd/system/multi-user.target.wants/status-agent.service",
    "/etc/polkit-1/rules.d/50-pcscd-allow-all.rules",
    "/etc/NetworkManager/NetworkManager.conf",
    f"{_TERMINAL_REPOSITORY}/clients/nfc-agent/.env",
    f"{_TERMINAL_REPOSITORY}/clients/barcode-agent/.env",
    "/etc/raspi-haizen-agent.conf",
    "/etc/systemd/system/haizen-agent.service",
    "/etc/systemd/system/multi-user.target.wants/haizen-agent.service",
)

_KIOSK_TERMINAL_PATHS = (
    f"{_TERMINAL_REPOSITORY}/clients/torque-agent/.env",
    "/usr/local/libexec/torque-bluetooth-adapter",
    "/etc/systemd/system/torque-bluetooth-adapter@.service",
    "/etc/udev/rules.d/90-torque-bluetooth-adapter.rules",
    "/etc/udev/rules.d/99-torque-wrench-hid.rules",
    "/usr/bin/chromium-browser",
    "/usr/local/bin/kiosk-launch.sh",
    "/etc/systemd/system/kiosk-browser.service",
    "/etc/systemd/system/graphical.target.wants/kiosk-browser.service",
    "/usr/local/bin/show-kiosk-panel.sh",
    "/usr/local/bin/ibus-kiosk-init.sh",
    "/usr/local/bin/ibus-process-owner.sh",
    "/usr/local/bin/clamav-kiosk-scan.sh",
    "/usr/local/bin/rkhunter-kiosk-scan.sh",
    "/var/spool/cron/crontabs/root",
    "/usr/local/libexec/raspi-local-ansible-runner",
    "/usr/local/libexec/raspi_local_execution.py",
    "/usr/local/libexec/raspi-terminal-ready-probe",
    "/usr/local/libexec/raspi-terminal-maintenance-probe",
    "/usr/local/libexec/raspi-local-runtime-install",
    "/usr/local/libexec/raspi-local-runtime-lock.json",
    "/usr/local/libexec/raspi-local-requirements-aarch64-py311.lock",
    "/opt/raspi-local-ansible-runtime/active",
)

_SIGNAGE_TERMINAL_PATHS = (
    "/etc/tmpfiles.d/signage-lite.conf",
    "/usr/local/share/signage-maintenance.svg",
    "/run/signage/current.jpg",
    "/run/signage/current.tmp.jpg",
    "/usr/local/bin/signage-update.sh",
    "/usr/local/bin/signage-display.sh",
    "/usr/local/bin/signage-stop.sh",
    "/usr/local/bin/signage-lite-watchdog.sh",
    "/etc/systemd/system/signage-lite.service",
    "/etc/systemd/system/signage-lite-update.service",
    "/etc/systemd/system/signage-lite-update.timer",
    "/etc/systemd/system/signage-lite-watchdog.service",
    "/etc/systemd/system/signage-lite-watchdog.timer",
    "/etc/systemd/system/signage-daily-reboot.service",
    "/etc/systemd/system/signage-daily-reboot.timer",
    "/etc/systemd/system/graphical.target.wants/signage-lite.service",
    "/etc/systemd/system/timers.target.wants/signage-lite-update.timer",
    "/etc/systemd/system/timers.target.wants/signage-lite-watchdog.timer",
    "/etc/systemd/system/timers.target.wants/signage-daily-reboot.timer",
    "/run/systemd/system/signage-lite.service",
)


class Runtime(Protocol):
    ANSIBLE_DIRECTORY: Any
    PROJECT: Any

    def run(self, command: list[str], **kwargs: Any) -> str: ...

    def state_command(self, *arguments: str) -> None: ...

    def utc_now(self) -> str: ...

    def playbook(
        self,
        inventory: str,
        host: str,
        revision: str,
        run_id: str,
        *,
        rollback: bool = False,
        runtime_artifact_vars: str | None = None,
    ) -> None: ...


def inventory_json(path: str, *, runtime: Runtime) -> dict[str, Any]:
    return json.loads(
        runtime.run(
            ["ansible-inventory", "-i", path, "--list"],
            cwd=runtime.ANSIBLE_DIRECTORY,
            capture=True,
        )
    )


def _read_only_environment(*, runtime: Runtime) -> dict[str, str]:
    config = Path(runtime.ANSIBLE_DIRECTORY) / _READ_ONLY_CONFIG_NAME
    try:
        resolved = config.resolve(strict=True)
    except (FileNotFoundError, OSError):
        raise RuntimeError(
            "read-only Ansible configuration is missing; restore "
            "infrastructure/ansible/ansible-readonly.cfg and rerun --print-plan"
        ) from None
    if not resolved.is_file():
        raise RuntimeError(
            "read-only Ansible configuration is invalid; restore "
            "infrastructure/ansible/ansible-readonly.cfg and rerun --print-plan"
        )

    environment = os.environ.copy()
    for name in _READ_ONLY_ENVIRONMENT_REMOVALS:
        environment.pop(name, None)
    environment["ANSIBLE_CONFIG"] = str(resolved)
    return environment


def _read_only_inventory_failure() -> RuntimeError:
    return RuntimeError(
        "read-only inventory validation failed; check the inventory YAML and "
        "group variables, plus any --limit pattern, then rerun --print-plan. "
        "This check intentionally does not use .vault-pass; mutating releases "
        "still require the normal deployment Vault configuration"
    )


def _run_read_only_inventory_command(
    command: list[str], *, runtime: Runtime, zero_match_is_empty: bool = False
) -> str:
    environment = _read_only_environment(runtime=runtime)
    try:
        return runtime.run(
            command,
            cwd=runtime.ANSIBLE_DIRECTORY,
            capture=True,
            env=environment,
        )
    except FileNotFoundError:
        raise RuntimeError(
            "ansible-core commands are required for --print-plan; install "
            "ansible-core and rerun"
        ) from None
    except subprocess.CalledProcessError as error:
        if zero_match_is_empty:
            combined = "\n".join(
                value
                for value in (error.stdout, error.stderr)
                if isinstance(value, str)
            )
            if (
                "hosts (0)" in combined
                or "leaves us with no hosts to target" in combined
            ):
                return ""
        raise _read_only_inventory_failure() from None
    except Exception:
        # Inventory plugins and future variables may write sensitive values to
        # stdout/stderr.  The stable operator error deliberately omits both.
        raise _read_only_inventory_failure() from None


def read_only_inventory_json(path: str, *, runtime: Runtime) -> dict[str, Any]:
    raw = _run_read_only_inventory_command(
        ["ansible-inventory", "-i", path, "--list"], runtime=runtime
    )
    try:
        value = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        raise RuntimeError(
            "read-only inventory validation returned invalid JSON; verify the "
            "installed ansible-core version and rerun --print-plan"
        ) from None
    if not isinstance(value, dict):
        raise RuntimeError(
            "read-only inventory validation returned an invalid document; "
            "verify the inventory and rerun --print-plan"
        )
    return value


def read_only_selected_hosts(
    path: str, limit: str, *, runtime: Runtime
) -> list[str] | None:
    if not limit:
        return None
    output = _run_read_only_inventory_command(
        [
            "ansible",
            "-i",
            path,
            "server:clients",
            "--list-hosts",
            "--limit",
            limit,
        ],
        runtime=runtime,
        zero_match_is_empty=True,
    )
    return [
        line.strip()
        for line in output.splitlines()
        if line.strip() and not line.lstrip().startswith("hosts")
    ]


def selected_hosts(path: str, limit: str, *, runtime: Runtime) -> list[str] | None:
    if not limit:
        return None
    try:
        output = runtime.run(
            ["ansible", "-i", path, "server:clients", "--list-hosts", "--limit", limit],
            cwd=runtime.ANSIBLE_DIRECTORY,
            capture=True,
        )
    except subprocess.CalledProcessError as error:
        combined = "\n".join(
            value for value in (error.stdout, error.stderr) if isinstance(value, str)
        )
        if "hosts (0)" in combined:
            return []
        raise
    return [
        line.strip()
        for line in output.splitlines()
        if line.strip() and not line.lstrip().startswith("hosts")
    ]


def _reject_duplicate_json_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"duplicate JSON key: {key}")
        result[key] = value
    return result


def _strict_result_marker(
    output: str,
    *,
    pattern: re.Pattern[str],
    prefix: str,
    label: str,
    max_bytes: int = _MAX_MARKER_BYTES,
) -> dict[str, Any]:
    encoded_results = pattern.findall(output)
    if not encoded_results:
        if prefix in output:
            raise RuntimeError(f"{label} marker is malformed")
        raise RuntimeError(f"{label} marker is missing")
    decoded_results: list[dict[str, Any]] = []
    for encoded in encoded_results:
        if len(encoded) > max_bytes:
            raise RuntimeError(f"{label} marker is too large")
        try:
            raw = base64.b64decode(encoded, altchars=b"-_", validate=True)
            if base64.urlsafe_b64encode(raw).decode("ascii") != encoded:
                raise ValueError("non-canonical base64")
            value = json.loads(
                raw.decode("utf-8"),
                object_pairs_hook=_reject_duplicate_json_keys,
                parse_constant=lambda constant: (_ for _ in ()).throw(
                    ValueError(f"invalid JSON constant: {constant}")
                ),
            )
        except (
            UnicodeDecodeError,
            binascii.Error,
            json.JSONDecodeError,
            ValueError,
        ) as error:
            raise RuntimeError(f"{label} marker is malformed") from error
        if not isinstance(value, dict):
            raise RuntimeError(f"{label} result must be an object")
        decoded_results.append(value)
    first = decoded_results[0]
    if any(value != first for value in decoded_results[1:]):
        raise RuntimeError(f"{label} callback results disagree")
    return first


def _terminal_manifest_capture_error(output: str) -> dict[str, str]:
    value = _strict_result_marker(
        output,
        pattern=_TERMINAL_MANIFEST_CAPTURE_ERROR_MARKER_RE,
        prefix="TERMINAL_MANIFEST_CAPTURE_ERROR:",
        label="terminal manifest capture error",
        max_bytes=65536,
    )
    if (
        set(value) != {"version", "stage", "code", "message"}
        or value.get("version") != 1
        or value.get("stage") not in {"identity", "file", "runtime"}
        or not isinstance(value.get("code"), str)
        or re.fullmatch(r"[a-z0-9.-]{1,100}", value["code"]) is None
        or not isinstance(value.get("message"), str)
        or not value["message"]
        or len(value["message"]) > 512
        or any(ord(character) < 32 for character in value["message"])
    ):
        raise RuntimeError("terminal manifest capture error marker is malformed")
    return value


def _manifest_marker(output: str) -> dict[str, Any]:
    """Decode one logical result from Ansible's duplicated callback output."""

    encoded_results = _MANIFEST_MARKER_RE.findall(output)
    if not encoded_results:
        if "ROLLBACK_MANIFEST_RESULT:" in output:
            raise RuntimeError("rollback manifest result marker is malformed")
        raise RuntimeError("rollback manifest result marker is missing")
    decoded_results: list[dict[str, Any]] = []
    for encoded in encoded_results:
        if len(encoded) > _MAX_MARKER_BYTES:
            raise RuntimeError("rollback manifest result marker is too large")
        try:
            raw = base64.b64decode(encoded, altchars=b"-_", validate=True)
            # Reject alternate/non-canonical encodings so marker comparison is
            # not weakened by padding or unused-bit variations.
            if base64.urlsafe_b64encode(raw).decode("ascii") != encoded:
                raise ValueError("non-canonical base64")
            value = json.loads(
                raw.decode("utf-8"),
                object_pairs_hook=_reject_duplicate_json_keys,
                parse_constant=lambda value: (_ for _ in ()).throw(
                    ValueError(f"invalid JSON constant: {value}")
                ),
            )
        except (UnicodeDecodeError, binascii.Error, json.JSONDecodeError, ValueError) as error:
            raise RuntimeError("rollback manifest result marker is malformed") from error
        if not isinstance(value, dict):
            raise RuntimeError("rollback manifest result must be an object")
        decoded_results.append(value)
    first = decoded_results[0]
    if any(result != first for result in decoded_results[1:]):
        raise RuntimeError("rollback manifest callback results disagree")
    return first


def _repository_baseline_marker(output: str) -> dict[str, Any]:
    encoded_results = _REPOSITORY_BASELINE_MARKER_RE.findall(output)
    if not encoded_results:
        if "TERMINAL_REPOSITORY_BASELINE_RESULT:" in output:
            raise RuntimeError("terminal repository baseline marker is malformed")
        raise RuntimeError("terminal repository baseline marker is missing")
    decoded_results: list[dict[str, Any]] = []
    for encoded in encoded_results:
        if len(encoded) > 4096:
            raise RuntimeError("terminal repository baseline marker is too large")
        try:
            raw = base64.b64decode(encoded, altchars=b"-_", validate=True)
            if base64.urlsafe_b64encode(raw).decode("ascii") != encoded:
                raise ValueError("non-canonical base64")
            value = json.loads(
                raw.decode("utf-8"),
                object_pairs_hook=_reject_duplicate_json_keys,
                parse_constant=lambda constant: (_ for _ in ()).throw(
                    ValueError(f"invalid JSON constant: {constant}")
                ),
            )
        except (UnicodeDecodeError, binascii.Error, json.JSONDecodeError, ValueError) as error:
            raise RuntimeError("terminal repository baseline marker is malformed") from error
        if not isinstance(value, dict):
            raise RuntimeError("terminal repository baseline result must be an object")
        decoded_results.append(value)
    first = decoded_results[0]
    if any(result != first for result in decoded_results[1:]):
        raise RuntimeError("terminal repository baseline callback results disagree")
    return first


def _runtime_manifest_marker(output: str) -> dict[str, Any]:
    encoded_results = _RUNTIME_MANIFEST_MARKER_RE.findall(output)
    if not encoded_results:
        if "TERMINAL_RUNTIME_MANIFEST_RESULT:" in output:
            raise RuntimeError("terminal runtime manifest marker is malformed")
        raise RuntimeError("terminal runtime manifest marker is missing")
    decoded_results: list[dict[str, Any]] = []
    for encoded in encoded_results:
        if len(encoded) > 65536:
            raise RuntimeError("terminal runtime manifest marker is too large")
        try:
            raw = base64.b64decode(encoded, altchars=b"-_", validate=True)
            if base64.urlsafe_b64encode(raw).decode("ascii") != encoded:
                raise ValueError("non-canonical base64")
            value = json.loads(
                raw.decode("utf-8"),
                object_pairs_hook=_reject_duplicate_json_keys,
                parse_constant=lambda constant: (_ for _ in ()).throw(
                    ValueError(f"invalid JSON constant: {constant}")
                ),
            )
        except (UnicodeDecodeError, binascii.Error, json.JSONDecodeError, ValueError) as error:
            raise RuntimeError("terminal runtime manifest marker is malformed") from error
        if not isinstance(value, dict):
            raise RuntimeError("terminal runtime manifest result must be an object")
        decoded_results.append(value)
    first = decoded_results[0]
    if any(result != first for result in decoded_results[1:]):
        raise RuntimeError("terminal runtime manifest callback results disagree")
    return first


def _runtime_manifest_error_marker(output: str) -> dict[str, Any]:
    encoded_results = _RUNTIME_MANIFEST_ERROR_MARKER_RE.findall(output)
    if not encoded_results:
        raise RuntimeError("terminal runtime manifest error marker is missing")
    decoded_results: list[dict[str, str]] = []
    for encoded in encoded_results:
        if len(encoded) > 65536:
            raise RuntimeError("terminal runtime manifest error marker is too large")
        try:
            raw = base64.b64decode(encoded, altchars=b"-_", validate=True)
            if base64.urlsafe_b64encode(raw).decode("ascii") != encoded:
                raise ValueError("non-canonical base64")
            value = json.loads(
                raw.decode("utf-8"),
                object_pairs_hook=_reject_duplicate_json_keys,
                parse_constant=lambda constant: (_ for _ in ()).throw(
                    ValueError(f"invalid JSON constant: {constant}")
                ),
            )
        except (
            UnicodeDecodeError,
            binascii.Error,
            json.JSONDecodeError,
            ValueError,
        ) as error:
            raise RuntimeError(
                "terminal runtime manifest error marker is malformed"
            ) from error
        if (
            not isinstance(value, dict)
            or set(value) != {"version", "code", "message"}
            or value.get("version") != 1
            or not isinstance(value.get("code"), str)
            or re.fullmatch(r"[a-z0-9.-]{1,100}", value["code"]) is None
            or not isinstance(value.get("message"), str)
            or not value["message"]
            or len(value["message"]) > 512
            or any(ord(character) < 32 for character in value["message"])
        ):
            raise RuntimeError("terminal runtime manifest error marker is malformed")
        decoded_results.append(value)
    first = decoded_results[0]
    if any(result != first for result in decoded_results[1:]):
        raise RuntimeError("terminal runtime manifest error callback results disagree")
    return first


def _validated_terminal_spec(target_spec: dict[str, str]) -> tuple[str, str]:
    host = target_spec.get("host")
    terminal_type = target_spec.get("terminalType")
    if not isinstance(host, str) or _HOST_RE.fullmatch(host) is None:
        raise ValueError("terminal host is malformed")
    if not isinstance(terminal_type, str):
        raise ValueError("terminal type is unsupported")
    try:
        adapter_for_profile(terminal_type, runtime=None)
    except (KeyError, ValueError) as error:
        raise ValueError("terminal type is unsupported") from error
    return host, terminal_type


def _validated_run_and_sha(run_id: str, previous_sha: str) -> None:
    if not isinstance(run_id, str) or _RUN_ID_RE.fullmatch(run_id) is None:
        raise ValueError("run ID is malformed")
    if not isinstance(previous_sha, str) or _FULL_SHA_RE.fullmatch(previous_sha) is None:
        raise ValueError("previous release SHA is malformed")


def _remote_identity(inventory: str, host: str, *, runtime: Runtime) -> tuple[str, str]:
    # Only a non-secret account name/home marker is returned. In particular,
    # this avoids materialising the full decrypted inventory on the controller.
    command = (
        "set -eu; user=$(id -un); "
        'home=$(getent passwd "$user" | cut -d: -f6); '
        'printf "ROLLBACK_REMOTE_IDENTITY:%s:%s\\n" "$user" "$home"'
    )
    output = runtime.run(
        [
            "ansible",
            "-i",
            inventory,
            host,
            "-e",
            "ansible_become=false",
            "-m",
            "shell",
            "-a",
            command,
        ],
        cwd=runtime.ANSIBLE_DIRECTORY,
        capture=True,
    )
    identities = re.findall(
        r"ROLLBACK_REMOTE_IDENTITY:([a-z_][a-z0-9_-]{0,31}):"
        r"(/home/[a-z_][a-z0-9_-]{0,31})(?![A-Za-z0-9_/-])",
        output,
    )
    if not identities or any(identity != identities[0] for identity in identities[1:]):
        raise RuntimeError(f"terminal account identity could not be resolved: {host}")
    user, home = identities[0]
    if _REMOTE_USER_RE.fullmatch(user) is None or _REMOTE_HOME_RE.fullmatch(home) is None:
        raise RuntimeError(f"terminal account identity is malformed: {host}")
    return user, home


def _terminal_manifest_paths(
    terminal_type: str, user: str, home: str, run_id: str
) -> list[str]:
    return list(
        adapter_for_profile(terminal_type, runtime=None).rollback_paths(
            user, home, run_id
        )
    )


def _manifest_action(arguments: list[str]) -> str:
    return shlex.join(arguments)


def _run_manifest_helper(
    inventory: str,
    host: str,
    arguments: list[str],
    *,
    runtime: Runtime,
) -> dict[str, Any]:
    source = runtime.PROJECT / "scripts/deploy/rollback-manifest.py"
    output = runtime.run(
        [
            "ansible",
            "-i",
            inventory,
            host,
            "-b",
            "-m",
            "script",
            "-a",
            _manifest_action([str(source), *arguments, "--ansible-marker"]),
        ],
        cwd=runtime.ANSIBLE_DIRECTORY,
        capture=True,
    )
    return _manifest_marker(output)


def _run_runtime_manifest_helper(
    inventory: str,
    host: str,
    arguments: list[str],
    *,
    runtime: Runtime,
) -> dict[str, Any]:
    source = runtime.PROJECT / "scripts/deploy/terminal-runtime-manifest.py"
    try:
        output = runtime.run(
            [
                "ansible",
                "-i",
                inventory,
                host,
                "-b",
                "-m",
                "script",
                "-a",
                _manifest_action([str(source), *arguments, "--ansible-marker"]),
            ],
            cwd=runtime.ANSIBLE_DIRECTORY,
            capture=True,
        )
    except subprocess.CalledProcessError as error:
        combined = "\n".join(
            value
            for value in (error.stdout, error.stderr)
            if isinstance(value, str)
        )
        try:
            evidence = _runtime_manifest_error_marker(combined)
        except RuntimeError:
            raise RuntimeError(
                f"terminal runtime manifest operation failed without safe evidence: {host}"
            ) from None
        raise RuntimeError(
            f"terminal runtime manifest {evidence['code']}: {evidence['message']}"
        ) from None
    return _runtime_manifest_marker(output)


def _expected_manifest_path(run_id: str, host: str) -> str:
    return f"{_ROLLBACK_MANIFEST_ROOT}/{run_id}/{host}/manifest.json"


def _expected_runtime_manifest_path(run_id: str, host: str) -> str:
    return f"{_RUNTIME_MANIFEST_ROOT}/{run_id}/{host}/manifest.json"


def _expected_kiosk_web_activation_unit(run_id: str, host: str) -> str:
    if _RUN_ID_RE.fullmatch(run_id) is None or _HOST_RE.fullmatch(host) is None:
        raise ValueError("Kiosk Web activation identity is malformed")
    digest = hashlib.sha256(
        f"{KIOSK_WEB_ACTIVATION_STRATEGY}\0{run_id}\0{host}".encode("utf-8")
    ).hexdigest()[:20]
    return f"raspi-kiosk-web-{digest}.service"


def _validated_kiosk_web_activation_result(
    value: Any, *, run_id: str, host: str
) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != {
        "strategyId",
        "operationUnit",
        "targetUnit",
        "state",
        "activeState",
        "result",
        "execMainStatus",
    }:
        raise RuntimeError("Kiosk Web activation result is malformed")
    expected_unit = _expected_kiosk_web_activation_unit(run_id, host)
    if (
        value.get("strategyId") != KIOSK_WEB_ACTIVATION_STRATEGY
        or value.get("operationUnit") != expected_unit
        or _KIOSK_WEB_ACTIVATION_UNIT_RE.fullmatch(expected_unit) is None
        or value.get("targetUnit") != KIOSK_WEB_ACTIVATION_TARGET_UNIT
        or value.get("state") not in {"absent", "running", "succeeded", "failed"}
        or not isinstance(value.get("activeState"), str)
        or value.get("result") is not None
        and not isinstance(value.get("result"), str)
        or isinstance(value.get("execMainStatus"), bool)
        or not isinstance(value.get("execMainStatus"), int)
    ):
        raise RuntimeError("Kiosk Web activation result identity is invalid")
    return dict(value)


def _kiosk_web_activation_authority(
    target_spec: dict[str, str], target: dict[str, Any], run_id: str
) -> tuple[str, str]:
    authority = _validated_terminal_rollback_authority(
        target_spec, target, run_id
    )
    if authority["terminalType"] != "kiosk":
        raise RuntimeError("Kiosk Web activation is valid only for the Kiosk profile")
    runtime_manifest = authority["runtimeManifest"]
    return authority["host"], runtime_manifest["manifestSha256"]


def _run_kiosk_web_activation_helper(
    inventory: str,
    host: str,
    run_id: str,
    manifest_sha256: str,
    command: str,
    *,
    runtime: Runtime,
) -> dict[str, Any]:
    value = _run_runtime_manifest_helper(
        inventory,
        host,
        [
            command,
            "--root",
            _RUNTIME_MANIFEST_ROOT,
            "--run-id",
            run_id,
            "--host",
            host,
            "--expected-manifest-sha256",
            manifest_sha256,
        ],
        runtime=runtime,
    )
    return _validated_kiosk_web_activation_result(
        value, run_id=run_id, host=host
    )


def reconcile_kiosk_web_activation(
    inventory: str,
    target_spec: dict[str, str],
    target: dict[str, Any],
    run_id: str,
    *,
    runtime: Runtime,
) -> dict[str, Any]:
    host, manifest_sha256 = _kiosk_web_activation_authority(
        target_spec, target, run_id
    )
    return _run_kiosk_web_activation_helper(
        inventory,
        host,
        run_id,
        manifest_sha256,
        "reconcile-kiosk-web-activation",
        runtime=runtime,
    )


def activate_kiosk_web(
    inventory: str,
    target_spec: dict[str, str],
    target: dict[str, Any],
    run_id: str,
    *,
    runtime: Runtime,
) -> dict[str, Any]:
    """Submit once and reconcile response loss through the deterministic unit."""

    host, manifest_sha256 = _kiosk_web_activation_authority(
        target_spec, target, run_id
    )
    submitted = False
    try:
        result = _run_kiosk_web_activation_helper(
            inventory,
            host,
            run_id,
            manifest_sha256,
            "activate-kiosk-web",
            runtime=runtime,
        )
        submitted = True
    except RuntimeError:
        # A missing result marker can mean the transient unit was accepted
        # before the SSH response disappeared. The exact unit is the recovery
        # authority; never infer success from the transport outcome.
        result = reconcile_kiosk_web_activation(
            inventory, target_spec, target, run_id, runtime=runtime
        )
    for _attempt in range(_KIOSK_WEB_ACTIVATION_RECONCILE_ATTEMPTS):
        state = result["state"]
        if state == "succeeded":
            return result
        if state == "failed":
            raise RuntimeError("Kiosk Web activation unit failed quiescently")
        if state == "absent" and not submitted:
            # Reconciliation proved that the first submission was not
            # accepted. Re-submit the same deterministic unit, never a second
            # operation identity.
            result = _run_kiosk_web_activation_helper(
                inventory,
                host,
                run_id,
                manifest_sha256,
                "activate-kiosk-web",
                runtime=runtime,
            )
            submitted = True
            continue
        time.sleep(_KIOSK_WEB_ACTIVATION_RECONCILE_DELAY_SECONDS)
        result = reconcile_kiosk_web_activation(
            inventory, target_spec, target, run_id, runtime=runtime
        )
    raise ActivationUncertainError(
        "Kiosk Web activation remains non-quiescent after bounded reconciliation"
    )


def cleanup_kiosk_web_activation(
    inventory: str,
    target_spec: dict[str, str],
    target: dict[str, Any],
    run_id: str,
    *,
    runtime: Runtime,
) -> dict[str, Any]:
    host, manifest_sha256 = _kiosk_web_activation_authority(
        target_spec, target, run_id
    )
    value = _run_runtime_manifest_helper(
        inventory,
        host,
        [
            "cleanup-kiosk-web-activation",
            "--root",
            _RUNTIME_MANIFEST_ROOT,
            "--run-id",
            run_id,
            "--host",
            host,
            "--expected-manifest-sha256",
            manifest_sha256,
        ],
        runtime=runtime,
    )
    expected_unit = _expected_kiosk_web_activation_unit(run_id, host)
    if (
        not isinstance(value, dict)
        or set(value)
        != {
            "cleaned",
            "alreadyClean",
            "strategyId",
            "operationUnit",
            "manifestSha256",
        }
        or value.get("cleaned") is not True
        or type(value.get("alreadyClean")) is not bool
        or value.get("strategyId") != KIOSK_WEB_ACTIVATION_STRATEGY
        or value.get("operationUnit") != expected_unit
        or value.get("manifestSha256") != manifest_sha256
    ):
        raise RuntimeError("Kiosk Web activation cleanup result is malformed")
    return value


def _terminal_runtime_contract(terminal_type: str) -> tuple[list[str], list[str]]:
    adapter = adapter_for_profile(terminal_type, runtime=None)
    return list(adapter.runtime_units), list(adapter.docker_services)


def _terminal_runtime_manifest_contract(
    terminal_type: str,
) -> TerminalRuntimeManifestContract:
    return adapter_for_profile(
        terminal_type, runtime=None
    ).runtime_manifest_contract


def _validated_runtime_health_contract(
    value: Any, *, terminal_type: str
) -> dict[str, list[str]]:
    """Validate the non-secret health contract derived from a sealed manifest."""

    units, docker_services = _terminal_runtime_contract(terminal_type)
    if not isinstance(value, dict) or set(value) != {
        "activeSystemdUnits",
        "runningDockerServices",
    }:
        raise RuntimeError("terminal runtime health contract is malformed")
    active_units = value.get("activeSystemdUnits")
    running_services = value.get("runningDockerServices")
    if (
        not isinstance(active_units, list)
        or any(not isinstance(unit, str) or unit not in units for unit in active_units)
        or len(active_units) != len(set(active_units))
        or not isinstance(running_services, list)
        or any(
            not isinstance(service, str) or service not in docker_services
            for service in running_services
        )
        or len(running_services) != len(set(running_services))
    ):
        raise RuntimeError("terminal runtime health contract is malformed")
    return {
        "activeSystemdUnits": list(active_units),
        "runningDockerServices": list(running_services),
    }


def _terminal_restart_on_restore_contract(terminal_type: str) -> list[str]:
    return list(
        adapter_for_profile(
            terminal_type, runtime=None
        ).restart_on_restore_units
    )


def _capture_terminal_runtime_manifest(
    inventory: str,
    host: str,
    terminal_type: str,
    run_id: str,
    *,
    runtime: Runtime,
) -> dict[str, Any]:
    contract = _terminal_runtime_manifest_contract(terminal_type)
    units = list(contract.systemd_units)
    docker_services = list(contract.docker_services)
    arguments = [
        "capture",
        "--root",
        _RUNTIME_MANIFEST_ROOT,
        "--run-id",
        run_id,
        "--host",
        host,
    ]
    for unit in units:
        arguments.extend(("--unit", unit))
    for unit in contract.restart_on_restore_units:
        arguments.extend(("--restart-on-restore-unit", unit))
    for service in docker_services:
        arguments.extend(("--docker-service", service))
    if docker_services:
        if (
            contract.compose_project is None
            or contract.compose_working_directory is None
            or not contract.compose_config_files
        ):
            raise RuntimeError("terminal runtime Compose contract is incomplete")
        arguments.extend(
            (
                "--compose-project",
                contract.compose_project,
                "--compose-working-directory",
                contract.compose_working_directory,
            )
        )
        for path in contract.compose_config_files:
            arguments.extend(("--compose-config-file", path))
    result = _run_runtime_manifest_helper(
        inventory, host, arguments, runtime=runtime
    )
    expected_path = _expected_runtime_manifest_path(run_id, host)
    digest = result.get("manifestSha256")
    rollback_tags = result.get("rollbackTags")
    if (
        set(result)
        != {
            "captured",
            "manifest",
            "manifestSha256",
            "unitCount",
            "dockerCount",
            "rollbackTags",
        }
        or result.get("captured") is not True
        or result.get("manifest") != expected_path
        or not isinstance(digest, str)
        or _SHA256_RE.fullmatch(digest) is None
        or result.get("unitCount") != len(units)
        or result.get("dockerCount") != len(docker_services)
        or not isinstance(rollback_tags, list)
        or len(rollback_tags) > len(docker_services)
        or any(
            not isinstance(tag, str)
            or not tag.startswith("raspi-rollback/")
            or len(tag) > 255
            for tag in rollback_tags
        )
        or len(set(rollback_tags)) != len(rollback_tags)
    ):
        raise RuntimeError(f"terminal runtime manifest capture result is invalid: {host}")
    return {
        "path": expected_path,
        "manifestSha256": digest,
        "unitCount": len(units),
        "dockerCount": len(docker_services),
    }


def _validated_runtime_manifest_reference(
    manifest: Any,
    *,
    run_id: str,
    host: str,
    terminal_type: str,
) -> dict[str, Any]:
    units, docker_services = _terminal_runtime_contract(terminal_type)
    expected_path = _expected_runtime_manifest_path(run_id, host)
    if not isinstance(manifest, dict) or set(manifest) != {
        "path",
        "manifestSha256",
        "unitCount",
        "dockerCount",
    }:
        raise RuntimeError("terminal runtime manifest reference is malformed")
    digest = manifest.get("manifestSha256")
    if (
        manifest.get("path") != expected_path
        or not isinstance(digest, str)
        or _SHA256_RE.fullmatch(digest) is None
        or manifest.get("unitCount") != len(units)
        or manifest.get("dockerCount") != len(docker_services)
    ):
        raise RuntimeError("terminal runtime manifest identity is invalid")
    return manifest


def capture_terminal_manifest(
    inventory: str,
    target_spec: dict[str, str],
    run_id: str,
    previous_sha: str,
    *,
    runtime: Runtime,
) -> dict[str, Any]:
    """Seal independent file/runtime authorities through one SSH transport."""

    host, terminal_type = _validated_terminal_spec(target_spec)
    _validated_run_and_sha(run_id, previous_sha)
    path_templates = _terminal_manifest_paths(
        terminal_type, "@REMOTE_USER@", "@REMOTE_HOME@", run_id
    )
    contract = _terminal_runtime_manifest_contract(terminal_type)
    units = list(contract.systemd_units)
    docker_services = list(contract.docker_services)
    arguments = [
        "--file-root",
        _ROLLBACK_MANIFEST_ROOT,
        "--runtime-root",
        _RUNTIME_MANIFEST_ROOT,
        "--run-id",
        run_id,
        "--host",
        host,
        "--repository",
        _TERMINAL_REPOSITORY,
        "--expected-head",
        previous_sha,
        "--ansible-marker",
    ]
    for path in path_templates:
        arguments.extend(("--path-template", path))
    for unit in units:
        arguments.extend(("--unit", unit))
    for unit in contract.restart_on_restore_units:
        arguments.extend(("--restart-on-restore-unit", unit))
    for service in docker_services:
        arguments.extend(("--docker-service", service))
    if docker_services:
        if (
            contract.compose_project is None
            or contract.compose_working_directory is None
            or not contract.compose_config_files
        ):
            raise RuntimeError("terminal runtime Compose contract is incomplete")
        arguments.extend(
            (
                "--compose-project",
                contract.compose_project,
                "--compose-working-directory",
                contract.compose_working_directory,
            )
        )
        for path in contract.compose_config_files:
            arguments.extend(("--compose-config-file", path))
    with _bundled_script(
        runtime,
        main="scripts/deploy/rolling_release/terminal_manifest_capture.py",
        modules={
            "rollback_manifest.py": "scripts/deploy/rollback-manifest.py",
            "terminal_runtime_manifest.py": (
                "scripts/deploy/terminal-runtime-manifest.py"
            ),
        },
    ) as source:
        try:
            output = runtime.run(
                [
                    "ansible",
                    "-i",
                    inventory,
                    host,
                    "-e",
                    "ansible_become=false",
                    "-m",
                    "script",
                    "-a",
                    shlex.join([str(source), *arguments]),
                ],
                cwd=runtime.ANSIBLE_DIRECTORY,
                capture=True,
            )
        except subprocess.CalledProcessError as error:
            combined = "\n".join(
                value
                for value in (error.stdout, error.stderr)
                if isinstance(value, str)
            )
            try:
                evidence = _terminal_manifest_capture_error(combined)
            except RuntimeError:
                raise RuntimeError(
                    f"terminal manifest capture failed without safe evidence: {host}"
                ) from None
            raise RuntimeError(
                "terminal manifest capture "
                f"{evidence['stage']}/{evidence['code']}: {evidence['message']}"
            ) from None
    envelope = _strict_result_marker(
        output,
        pattern=_TERMINAL_MANIFEST_CAPTURE_MARKER_RE,
        prefix="TERMINAL_MANIFEST_CAPTURE_RESULT:",
        label="terminal manifest capture",
    )
    user = envelope.get("remoteUser")
    home = envelope.get("remoteHome")
    if (
        set(envelope)
        != {
            "version",
            "remoteUser",
            "remoteHome",
            "fileManifest",
            "runtimeManifest",
        }
        or envelope.get("version") != 1
        or not isinstance(user, str)
        or _REMOTE_USER_RE.fullmatch(user) is None
        or not isinstance(home, str)
        or _REMOTE_HOME_RE.fullmatch(home) is None
        or home != f"/home/{user}"
    ):
        raise RuntimeError(f"terminal manifest capture result is invalid: {host}")
    paths = _terminal_manifest_paths(terminal_type, user, home, run_id)
    result = envelope.get("fileManifest")
    expected_path = _expected_manifest_path(run_id, host)
    digest = result.get("manifestSha256") if isinstance(result, dict) else None
    repository = result.get("repository") if isinstance(result, dict) else None
    if (
        not isinstance(result, dict)
        or set(result)
        != {
            "captured",
            "manifest",
            "manifestSha256",
            "count",
            "destinations",
            "repository",
        }
        or result.get("captured") is not True
        or result.get("manifest") != expected_path
        or not isinstance(digest, str)
        or _SHA256_RE.fullmatch(digest) is None
        or result.get("count") != len(paths)
        or result.get("destinations") != paths
        or repository
        != {"path": _TERMINAL_REPOSITORY, "head": previous_sha}
    ):
        raise RuntimeError(f"rollback manifest capture result is invalid: {host}")
    runtime_result = envelope.get("runtimeManifest")
    runtime_path = _expected_runtime_manifest_path(run_id, host)
    runtime_digest = (
        runtime_result.get("manifestSha256")
        if isinstance(runtime_result, dict)
        else None
    )
    rollback_tags = (
        runtime_result.get("rollbackTags")
        if isinstance(runtime_result, dict)
        else None
    )
    if (
        not isinstance(runtime_result, dict)
        or set(runtime_result)
        != {
            "captured",
            "manifest",
            "manifestSha256",
            "unitCount",
            "dockerCount",
            "rollbackTags",
        }
        or runtime_result.get("captured") is not True
        or runtime_result.get("manifest") != runtime_path
        or not isinstance(runtime_digest, str)
        or _SHA256_RE.fullmatch(runtime_digest) is None
        or runtime_result.get("unitCount") != len(units)
        or runtime_result.get("dockerCount") != len(docker_services)
        or not isinstance(rollback_tags, list)
        or len(rollback_tags) > len(docker_services)
        or any(
            not isinstance(tag, str)
            or not tag.startswith("raspi-rollback/")
            or len(tag) > 255
            for tag in rollback_tags
        )
        or len(set(rollback_tags)) != len(rollback_tags)
    ):
        raise RuntimeError(
            f"terminal runtime manifest capture result is invalid: {host}"
        )
    runtime_manifest = {
        "path": runtime_path,
        "manifestSha256": runtime_digest,
        "unitCount": len(units),
        "dockerCount": len(docker_services),
    }
    # Do not copy captured payloads or their (potentially secret) contents into
    # controller state. This sealed reference is sufficient for exact restore.
    return {
        "path": expected_path,
        "manifestSha256": digest,
        "count": len(paths),
        "runtime": runtime_manifest,
    }


def prestage_signage_maintenance(
    inventory: str,
    host: str,
    run_id: str,
    client_id: str,
    *,
    runtime: Runtime,
) -> None:
    if not isinstance(host, str) or _HOST_RE.fullmatch(host) is None:
        raise ValueError("terminal host is malformed")
    if not isinstance(run_id, str) or _RUN_ID_RE.fullmatch(run_id) is None:
        raise ValueError("run ID is malformed")
    if not isinstance(client_id, str) or _CLIENT_ID_RE.fullmatch(client_id) is None:
        raise ValueError("terminal client identity is malformed")
    source = runtime.ANSIBLE_DIRECTORY / "roles/signage/templates/signage-maintenance.svg.j2"
    staged_source = f"/run/signage/release-{run_id}-maintenance.svg"
    staged_image = f"/run/signage/release-{run_id}-maintenance.jpg"
    # Prestage must not install packages or touch a persistent template. The
    # release-only play asserts required host provisioning separately.
    runtime.run(
        [
            "ansible",
            "-i",
            inventory,
            host,
            "-b",
            "-m",
            "shell",
            "-a",
            "command -v rsvg-convert >/dev/null && test -d /run/signage",
        ],
        cwd=runtime.ANSIBLE_DIRECTORY,
    )
    runtime.run(
        [
            "ansible",
            "-i",
            inventory,
            host,
            "-b",
            "-m",
            "copy",
            "-a",
            f"src={source} dest={staged_source} mode=0600 owner=root group=root",
        ],
        cwd=runtime.ANSIBLE_DIRECTORY,
    )
    render_command = (
        "set -e; umask 077; "
        f"rm -f {shlex.quote(staged_image)}; "
        f"rsvg-convert -f png -w 1920 -h 1080 {shlex.quote(staged_source)} "
        f"-o {shlex.quote(staged_image)}; "
        f"test -s {shlex.quote(staged_image)}"
    )
    runtime.run(
        [
            "ansible",
            "-i",
            inventory,
            host,
            "-b",
            "-m",
            "shell",
            "-a",
            render_command,
        ],
        cwd=runtime.ANSIBLE_DIRECTORY,
    )
    proof_source = runtime.PROJECT / "scripts/deploy/signage-runtime-proof.py"
    seal_action = shlex.join(
        [
            str(proof_source),
            "--run-id",
            run_id,
            "--seal-maintenance-image",
            staged_image,
            "--ansible-marker",
        ]
    )
    seal_output = runtime.run(
        [
            "ansible",
            "-i",
            inventory,
            host,
            "-b",
            "-m",
            "script",
            "-a",
            seal_action,
        ],
        cwd=runtime.ANSIBLE_DIRECTORY,
        capture=True,
    )
    seals = _SIGNAGE_MAINTENANCE_MARKER_RE.findall(seal_output)
    if not seals or any(seal != seals[0] for seal in seals):
        raise RuntimeError(f"signage maintenance artifact could not be sealed: {host}")
    install_command = (
        "set -e; "
        "if test -f /run/signage/current.jpg; then "
        f"cat {shlex.quote(staged_image)} > /run/signage/current.jpg; "
        f"rm -f {shlex.quote(staged_image)}; "
        f"else mv {shlex.quote(staged_image)} /run/signage/current.jpg; fi; "
        f"rm -f {shlex.quote(staged_source)}"
    )
    runtime.run(
        [
            "ansible",
            "-i",
            inventory,
            host,
            "-b",
            "-m",
            "shell",
            "-a",
            install_command,
        ],
        cwd=runtime.ANSIBLE_DIRECTORY,
    )
    runtime.state_command("ack", "--run-id", run_id, "--client", client_id)


def prepare_terminal_repository(
    inventory: str, host: str, *, runtime: Runtime
) -> dict[str, Any]:
    """Return one clean HEAD, repairing only the exact legacy docs deletion."""

    if not isinstance(host, str) or _HOST_RE.fullmatch(host) is None:
        raise ValueError("terminal host is malformed")
    source = runtime.PROJECT / "scripts/deploy/terminal-repository-baseline.py"
    action = shlex.join(
        [
            str(source),
            "--repository",
            _TERMINAL_REPOSITORY,
            "--ansible-marker",
        ]
    )
    output = runtime.run(
        [
            "ansible",
            "-i",
            inventory,
            host,
            "-m",
            "script",
            "-a",
            action,
        ],
        cwd=runtime.ANSIBLE_DIRECTORY,
        capture=True,
    )
    result = _repository_baseline_marker(output)
    if set(result) != {"head", "repairedLegacyDocs", "count"}:
        raise RuntimeError(f"terminal repository baseline result is invalid: {host}")
    head = result.get("head")
    repaired = result.get("repairedLegacyDocs")
    count = result.get("count")
    if (
        not isinstance(head, str)
        or _FULL_SHA_RE.fullmatch(head) is None
        or type(repaired) is not bool
        or isinstance(count, bool)
        or not isinstance(count, int)
        or count < 0
        or (repaired and count <= 0)
        or (not repaired and count != 0)
    ):
        raise RuntimeError(f"terminal repository baseline result is invalid: {host}")
    return {"head": head, "repairedLegacyDocs": repaired, "count": count}


def remote_previous_sha(inventory: str, host: str, *, runtime: Runtime) -> str:
    output = runtime.run(
        [
            "ansible",
            "-i",
            inventory,
            host,
            "-b",
            "-m",
            "command",
            "-a",
            "git -C /opt/RaspberryPiSystem_002 rev-parse HEAD",
        ],
        cwd=runtime.ANSIBLE_DIRECTORY,
        capture=True,
    )
    for line in output.splitlines():
        candidate = line.strip()
        if len(candidate) == 40 and all(character in "0123456789abcdef" for character in candidate):
            return candidate
    raise RuntimeError(f"could not resolve previous SHA for {host}: {output}")


def probe_terminal_identity(
    inventory: str,
    host: str,
    client_id: str,
    *,
    runtime: Runtime,
) -> dict[str, Any]:
    """Prove the terminal's configured key is accepted without transporting it."""

    if re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,127}", client_id) is None:
        raise ValueError("terminal client identity is malformed")
    source = runtime.PROJECT / "scripts/deploy/terminal-identity-probe.py"
    output = runtime.run(
        [
            "ansible",
            "-i",
            inventory,
            host,
            "-b",
            "-m",
            "script",
            "-a",
            f"{source} --expected-client-id {shlex.quote(client_id)}",
        ],
        cwd=runtime.ANSIBLE_DIRECTORY,
        capture=True,
    )
    identities = re.findall(
        r"TERMINAL_IDENTITY_OK:([A-Za-z0-9][A-Za-z0-9._:-]{0,127})",
        output,
    )
    # Ansible callbacks can render the same stdout in both ``stdout`` and
    # ``stdout_lines``. Every rendered proof must nevertheless be exact.
    if not identities or any(identity != client_id for identity in identities):
        raise RuntimeError(f"terminal identity could not be verified: {host}")
    return {"authenticated": True, "statusClientId": client_id}


def _signage_proof(
    inventory: str,
    host: str,
    arguments: list[str],
    marker: re.Pattern[str],
    qualifier: str,
    *,
    runtime: Runtime,
) -> str:
    if not isinstance(host, str) or _HOST_RE.fullmatch(host) is None:
        raise ValueError("terminal host is malformed")
    source = runtime.PROJECT / "scripts/deploy/signage-runtime-proof.py"
    action = shlex.join([str(source), *arguments, "--ansible-marker"])
    output = runtime.run(
        [
            "ansible",
            "-i",
            inventory,
            host,
            "-b",
            "-m",
            "script",
            "-a",
            action,
        ],
        cwd=runtime.ANSIBLE_DIRECTORY,
        capture=True,
    )
    markers = marker.findall(output)
    if not markers or any(value != markers[0] for value in markers):
        raise RuntimeError(f"signage {qualifier} proof could not be verified: {host}")
    return markers[0]


def probe_signage_endpoints(
    inventory: str,
    host: str,
    *,
    runtime: Runtime,
) -> dict[str, Any]:
    """Authenticate the signage-specific API without transporting its key."""

    digest = _signage_proof(
        inventory,
        host,
        ["--check-endpoints"],
        _SIGNAGE_ENDPOINT_MARKER_RE,
        "endpoint",
        runtime=runtime,
    )
    return {
        "signageEndpointAuthenticated": True,
        "signageImageSha256": digest,
    }


def _kiosk_agent_specs(
    inventory: str,
    host: str,
    expected_agents: list[str] | tuple[str, ...] | None = None,
    *,
    runtime: Runtime,
) -> list[tuple[str, int | None, bool]]:
    """Resolve the selected agent set without mixing release-time authorities.

    A normal deployment derives the set from current inventory.  A rollback
    supplies the exact running service set derived from its sealed runtime
    manifest; newer inventory may describe agents that did not exist in the
    restored release.
    """

    if not isinstance(host, str) or _HOST_RE.fullmatch(host) is None:
        raise ValueError("terminal host is malformed")
    raw = runtime.run(
        ["ansible-inventory", "-i", inventory, "--host", host],
        cwd=runtime.ANSIBLE_DIRECTORY,
        capture=True,
    )
    try:
        values = json.loads(
            raw,
            object_pairs_hook=_reject_duplicate_json_keys,
            parse_constant=lambda constant: (_ for _ in ()).throw(
                ValueError(f"invalid JSON constant: {constant}")
            ),
        )
    except (json.JSONDecodeError, ValueError) as error:
        raise RuntimeError(f"kiosk inventory facts are malformed: {host}") from error
    if not isinstance(values, dict):
        raise RuntimeError(f"kiosk inventory facts are malformed: {host}")
    if expected_agents is None:
        nfc_identity = values.get("nfc_agent_client_id")
        if nfc_identity is not None and (
            not isinstance(nfc_identity, str)
            or _CLIENT_ID_RE.fullmatch(nfc_identity) is None
        ):
            raise RuntimeError(f"kiosk NFC inventory contract is malformed: {host}")
        barcode_enabled = values.get("barcode_agent_enabled", False)
        if type(barcode_enabled) is not bool:
            raise RuntimeError(f"kiosk barcode inventory contract is malformed: {host}")
        torque_enabled = values.get("torque_agent_enabled", False)
        if type(torque_enabled) is not bool:
            raise RuntimeError(f"kiosk torque inventory contract is malformed: {host}")
        selected_agents = tuple(
            agent
            for agent, enabled in (
                ("nfc-agent", nfc_identity is not None),
                ("barcode-agent", barcode_enabled),
                ("torque-agent", torque_enabled),
            )
            if enabled
        )
    else:
        if (
            not isinstance(expected_agents, (list, tuple))
            or any(
                not isinstance(agent, str) or agent not in _KIOSK_AGENT_ORDER
                for agent in expected_agents
            )
            or len(expected_agents) != len(set(expected_agents))
        ):
            raise RuntimeError(f"kiosk restored-agent contract is malformed: {host}")
        selected = set(expected_agents)
        selected_agents = tuple(
            agent for agent in _KIOSK_AGENT_ORDER if agent in selected
        )
    barcode_port = (
        values.get("barcode_agent_rest_port", 7072)
        if expected_agents is None
        else None
    )
    if (
        "barcode-agent" in selected_agents
        and barcode_port is not None
        and (
            isinstance(barcode_port, bool)
            or not isinstance(barcode_port, int)
            or not 1 <= barcode_port <= 65535
        )
    ):
        raise RuntimeError(f"kiosk barcode inventory port is malformed: {host}")
    agents: list[tuple[str, int | None, bool]] = []
    if "nfc-agent" in selected_agents:
        agents.append(
            ("nfc-agent", 7071 if expected_agents is None else None, True)
        )
    if "barcode-agent" in selected_agents:
        agents.append(("barcode-agent", barcode_port, False))
    torque_port = (
        values.get("torque_agent_local_port", 7073)
        if expected_agents is None
        else None
    )
    if (
        "torque-agent" in selected_agents
        and torque_port is not None
        and (
            isinstance(torque_port, bool)
            or not isinstance(torque_port, int)
            or torque_port != 7073
        )
    ):
        raise RuntimeError(f"kiosk torque inventory port is malformed: {host}")
    if "torque-agent" in selected_agents:
        agents.append(("torque-agent", torque_port, False))
    return agents


def probe_kiosk_agents(
    inventory: str,
    host: str,
    expected_agents: list[str] | tuple[str, ...] | None = None,
    *,
    runtime: Runtime,
) -> dict[str, Any]:
    """Prove every selected kiosk agent with the legacy per-agent transport."""

    agents = _kiosk_agent_specs(
        inventory, host, expected_agents, runtime=runtime
    )

    source = runtime.PROJECT / "scripts/deploy/terminal-agent-health-probe.py"
    compose_files = _terminal_runtime_manifest_contract(
        "kiosk"
    ).compose_config_files
    if len(compose_files) != 1:
        raise RuntimeError("kiosk agent health Compose contract is malformed")
    endpoints: list[dict[str, Any]] = []
    for agent, port, require_pcscd in agents:
        arguments = [
            str(source),
            "--agent",
            agent,
            *(["--port", str(port)] if port is not None else []),
            "--repository",
            _TERMINAL_REPOSITORY,
            "--compose-file",
            compose_files[0],
            *(["--require-pcscd"] if require_pcscd else []),
            "--ansible-marker",
        ]
        output = runtime.run(
            [
                "ansible",
                "-i",
                inventory,
                host,
                "-b",
                "-m",
                "script",
                "-a",
                shlex.join(arguments),
            ],
            cwd=runtime.ANSIBLE_DIRECTORY,
            capture=True,
        )
        markers = _TERMINAL_AGENT_MARKER_RE.findall(output)
        if not markers or any(marker != markers[0] for marker in markers):
            raise RuntimeError(f"kiosk agent health could not be verified: {host}")
        proven_agent, proven_port_raw = markers[0]
        if proven_agent != agent:
            raise RuntimeError(f"kiosk agent health could not be verified: {host}")
        proven_port = int(proven_port_raw)
        if port is not None and proven_port != port:
            raise RuntimeError(f"kiosk agent health could not be verified: {host}")
        endpoints.append({"agent": agent, "port": proven_port})
    return {
        "agentContainers": [value["agent"] for value in endpoints],
        "authenticatedAgentEndpoints": endpoints,
        "pcscdRequired": any(agent == "nfc-agent" for agent, _port, _pcsc in agents),
    }


def probe_terminal_release_evidence(
    inventory: str,
    host: str,
    client_id: str,
    services: list[str],
    *,
    expected_agents: list[str] | tuple[str, ...] | None = None,
    check_status_agent_result: bool = True,
    runtime: Runtime,
) -> dict[str, Any]:
    """Collect Git, systemd, identity, and agent proof in one SSH call."""

    if not isinstance(host, str) or _HOST_RE.fullmatch(host) is None:
        raise ValueError("terminal host is malformed")
    if not isinstance(client_id, str) or _CLIENT_ID_RE.fullmatch(client_id) is None:
        raise ValueError("terminal client identity is malformed")
    if (
        not isinstance(services, list)
        or not services
        or len(services) != len(set(services))
        or any(
            not isinstance(service, str)
            or _SYSTEMD_UNIT_RE.fullmatch(service) is None
            for service in services
        )
        or type(check_status_agent_result) is not bool
    ):
        raise ValueError("terminal service proof request is malformed")
    agent_specs = _kiosk_agent_specs(
        inventory, host, expected_agents, runtime=runtime
    )
    compose_files = _terminal_runtime_manifest_contract("kiosk").compose_config_files
    if len(compose_files) != 1:
        raise RuntimeError("kiosk agent health Compose contract is malformed")
    arguments = [
        "--expected-client-id",
        client_id,
        "--repository",
        _TERMINAL_REPOSITORY,
        "--compose-file",
        compose_files[0],
        "--ansible-marker",
    ]
    for service in services:
        arguments.extend(("--service", service))
    if check_status_agent_result:
        arguments.append("--check-status-agent-result")
    for agent, port, require_pcscd in agent_specs:
        arguments.extend(
            (
                "--agent-spec",
                f"{agent}:{port if port is not None else 'auto'}:"
                f"{1 if require_pcscd else 0}",
            )
        )
    with _bundled_script(
        runtime,
        main="scripts/deploy/rolling_release/terminal_release_evidence.py",
        modules={
            "terminal_identity_probe.py": "scripts/deploy/terminal-identity-probe.py",
            "terminal_agent_health_probe.py": (
                "scripts/deploy/terminal-agent-health-probe.py"
            ),
        },
    ) as source:
        try:
            output = runtime.run(
                [
                    "ansible",
                    "-i",
                    inventory,
                    host,
                    "-b",
                    "-m",
                    "script",
                    "-a",
                    shlex.join([str(source), *arguments]),
                ],
                cwd=runtime.ANSIBLE_DIRECTORY,
                capture=True,
            )
        except subprocess.CalledProcessError:
            raise RuntimeError(
                f"terminal release evidence failed without safe proof: {host}"
            ) from None
    value = _strict_result_marker(
        output,
        pattern=_TERMINAL_RELEASE_EVIDENCE_MARKER_RE,
        prefix="TERMINAL_RELEASE_EVIDENCE_RESULT:",
        label="terminal release evidence",
    )
    expected_oneshot = ["status-agent.service"] if check_status_agent_result else []
    expected_agent_names = [agent for agent, _port, _pcsc in agent_specs]
    endpoints = value.get("authenticatedAgentEndpoints")
    if (
        set(value)
        != {
            "version",
            "currentSha",
            "activeSystemdUnits",
            "oneshotServices",
            "identity",
            "agentContainers",
            "authenticatedAgentEndpoints",
            "pcscdRequired",
        }
        or value.get("version") != 1
        or not isinstance(value.get("currentSha"), str)
        or _FULL_SHA_RE.fullmatch(value["currentSha"]) is None
        or value.get("activeSystemdUnits") != services
        or value.get("oneshotServices") != expected_oneshot
        or value.get("identity")
        != {"authenticated": True, "statusClientId": client_id}
        or value.get("agentContainers") != expected_agent_names
        or not isinstance(endpoints, list)
        or len(endpoints) != len(agent_specs)
        or any(
            not isinstance(endpoint, dict)
            or set(endpoint) != {"agent", "port"}
            or endpoint.get("agent") != agent_specs[index][0]
            or isinstance(endpoint.get("port"), bool)
            or not isinstance(endpoint.get("port"), int)
            or not 1 <= endpoint["port"] <= 65535
            or (
                agent_specs[index][1] is not None
                and endpoint["port"] != agent_specs[index][1]
            )
            for index, endpoint in enumerate(endpoints)
        )
        or value.get("pcscdRequired") != ("nfc-agent" in expected_agent_names)
    ):
        raise RuntimeError(f"terminal release evidence is malformed: {host}")
    return {
        "currentSha": value["currentSha"],
        "services": services,
        "oneshotServices": expected_oneshot,
        "authenticatedEndpoint": True,
        "statusClientId": client_id,
        "agentContainers": expected_agent_names,
        "authenticatedAgentEndpoints": endpoints,
        "pcscdRequired": value["pcscdRequired"],
    }


def refresh_signage_after_maintenance(
    inventory: str,
    host: str,
    run_id: str,
    *,
    runtime: Runtime,
) -> dict[str, Any]:
    """Fetch and install a non-maintenance image after deploy-status removal."""

    if not isinstance(run_id, str) or _RUN_ID_RE.fullmatch(run_id) is None:
        raise ValueError("run ID is malformed")
    digest = _signage_proof(
        inventory,
        host,
        ["--run-id", run_id, "--refresh-image"],
        _SIGNAGE_RUNTIME_MARKER_RE,
        "runtime",
        runtime=runtime,
    )
    return {
        "signageEndpointAuthenticated": True,
        "signageImageSha256": digest,
        "maintenanceArtifactReplaced": True,
    }


def prove_signage_ready(
    inventory: str,
    host: str,
    run_id: str,
    client_id: str,
    release_sha: str,
    verification_id: str,
    *,
    runtime: Runtime,
) -> None:
    """Run the controller-owned, release-bound ACK proof on a signage host."""

    if not isinstance(host, str) or _HOST_RE.fullmatch(host) is None:
        raise ValueError("terminal host is malformed")
    if not isinstance(run_id, str) or _RUN_ID_RE.fullmatch(run_id) is None:
        raise ValueError("run ID is malformed")
    if not isinstance(client_id, str) or _CLIENT_ID_RE.fullmatch(client_id) is None:
        raise ValueError("terminal client identity is malformed")
    if not isinstance(release_sha, str) or _FULL_SHA_RE.fullmatch(release_sha) is None:
        raise ValueError("release SHA is malformed")
    if (
        not isinstance(verification_id, str)
        or _VERIFICATION_ID_RE.fullmatch(verification_id) is None
    ):
        raise ValueError("verification ID is malformed")
    source = runtime.PROJECT / "scripts/deploy/terminal-ready-probe.py"
    action = shlex.join(
        [
            str(source),
            "--run-id",
            run_id,
            "--release-sha",
            release_sha,
            "--verification-id",
            verification_id,
            "--expected-client-id",
            client_id,
            "--repo",
            _TERMINAL_REPOSITORY,
        ]
    )
    output = runtime.run(
        [
            "ansible",
            "-i",
            inventory,
            host,
            "-b",
            "-m",
            "script",
            "-a",
            action,
        ],
        cwd=runtime.ANSIBLE_DIRECTORY,
        capture=True,
    )
    markers = re.findall(r"TERMINAL_READY_OK:([0-9a-f]{40})(?![0-9a-f])", output)
    if not markers or any(marker != release_sha for marker in markers):
        raise RuntimeError(f"signage ready proof could not be verified: {host}")


def _validated_server_config_identity(host: str, run_id: str) -> None:
    if not isinstance(host, str) or _HOST_RE.fullmatch(host) is None:
        raise ValueError("server host is malformed")
    if not isinstance(run_id, str) or _RUN_ID_RE.fullmatch(run_id) is None:
        raise ValueError("run ID is malformed")


def _validated_server_config_manifest_reference(
    manifest: Any, *, host: str, run_id: str
) -> dict[str, Any]:
    _validated_server_config_identity(host, run_id)
    expected_path = _expected_manifest_path(run_id, host)
    if not isinstance(manifest, dict) or set(manifest) != {
        "path",
        "manifestSha256",
        "count",
    }:
        raise RuntimeError("server config rollback manifest reference is malformed")
    digest = manifest.get("manifestSha256")
    if (
        manifest.get("path") != expected_path
        or not isinstance(digest, str)
        or _SHA256_RE.fullmatch(digest) is None
        or manifest.get("count") != len(_SERVER_CONFIG_PATHS)
    ):
        raise RuntimeError("server config rollback manifest identity is invalid")
    return manifest


def capture_server_config_manifest(
    inventory: str,
    host: str,
    run_id: str,
    *,
    runtime: Runtime,
) -> dict[str, Any]:
    """Seal only the three Pi5 release environment files before convergence."""

    _validated_server_config_identity(host, run_id)
    arguments = [
        "capture-set",
        "--root",
        _ROLLBACK_MANIFEST_ROOT,
        "--run-id",
        run_id,
        "--host",
        host,
    ]
    for path in _SERVER_CONFIG_PATHS:
        arguments.extend(("--path", path))
    result = _run_manifest_helper(
        inventory, host, arguments, runtime=runtime
    )
    expected_path = _expected_manifest_path(run_id, host)
    digest = result.get("manifestSha256")
    if (
        set(result)
        != {
            "captured",
            "manifest",
            "manifestSha256",
            "count",
            "destinations",
            "repository",
        }
        or result.get("captured") is not True
        or result.get("manifest") != expected_path
        or not isinstance(digest, str)
        or _SHA256_RE.fullmatch(digest) is None
        or result.get("count") != len(_SERVER_CONFIG_PATHS)
        or result.get("destinations") != list(_SERVER_CONFIG_PATHS)
        or result.get("repository") is not None
    ):
        raise RuntimeError(f"server config rollback capture result is invalid: {host}")
    return {
        "path": expected_path,
        "manifestSha256": digest,
        "count": len(_SERVER_CONFIG_PATHS),
    }


def restore_server_config_manifest(
    inventory: str,
    host: str,
    run_id: str,
    manifest: dict[str, Any],
    *,
    runtime: Runtime,
) -> dict[str, Any]:
    """Restore exactly one run's sealed Pi5 environment-file manifest."""

    reference = _validated_server_config_manifest_reference(
        manifest, host=host, run_id=run_id
    )
    result = _run_manifest_helper(
        inventory,
        host,
        [
            "restore",
            "--root",
            _ROLLBACK_MANIFEST_ROOT,
            "--run-id",
            run_id,
            "--host",
            host,
            "--expected-manifest-sha256",
            reference["manifestSha256"],
        ],
        runtime=runtime,
    )
    if (
        set(result)
        != {
            "restored",
            "manifest",
            "manifestSha256",
            "count",
            "destinations",
            "repository",
        }
        or result.get("restored") is not True
        or result.get("manifest") != reference["path"]
        or result.get("manifestSha256") != reference["manifestSha256"]
        or result.get("count") != reference["count"]
        or result.get("destinations") != list(_SERVER_CONFIG_PATHS)
        or result.get("repository") is not None
    ):
        raise RuntimeError(f"server config rollback restore result is invalid: {host}")
    return result


def converge_server_config(
    inventory: str,
    host: str,
    revision: str,
    run_id: str,
    rollback_manifest: dict[str, Any],
    *,
    runtime: Runtime,
) -> None:
    """Converge Pi5 config after validating its sealed rollback authority."""

    _validated_server_config_identity(host, run_id)
    if not isinstance(revision, str) or _FULL_SHA_RE.fullmatch(revision) is None:
        raise ValueError("server config release SHA is malformed")
    _validated_server_config_manifest_reference(
        rollback_manifest, host=host, run_id=run_id
    )
    environment = os.environ.copy()
    environment.update(
        {
            "ANSIBLE_REPO_VERSION": revision,
            "RUN_ID": run_id,
            "RELEASE_ORCHESTRATED": "1",
        }
    )
    _release_timing_environment(
        environment,
        runtime=runtime,
        run_id=run_id,
        host=host,
        scope="server-config",
    )
    extra = (
        "release_orchestrated=true release_rollback=false "
        "server_release_mode=host-config-only"
    )
    runtime.run(
        [
            "ansible-playbook",
            "-i",
            inventory,
            str(runtime.ANSIBLE_DIRECTORY / "playbooks/server-config-release.yml"),
            "--limit",
            host,
            "-e",
            extra,
        ],
        cwd=runtime.ANSIBLE_DIRECTORY,
        env=environment,
    )


def preflight_terminal_ansible_pipelining(
    inventory: str,
    host: str,
    *,
    runtime: Runtime,
) -> None:
    """Prove the optimized Ansible/become path before terminal mutation."""

    if not isinstance(host, str) or _HOST_RE.fullmatch(host) is None:
        raise ValueError("terminal host is malformed")
    runtime.run(
        [
            "ansible",
            "-i",
            inventory,
            host,
            "-b",
            "-m",
            "ansible.builtin.command",
            "-a",
            "/usr/bin/true",
        ],
        cwd=runtime.ANSIBLE_DIRECTORY,
        capture=True,
        env=_terminal_apply_environment(),
    )


def playbook(
    inventory: str,
    host: str,
    revision: str,
    run_id: str,
    *,
    rollback: bool = False,
    playbook: str = "playbooks/deploy-staged.yml",
    runtime_artifact_vars: str | None = None,
    runtime: Runtime,
) -> None:
    if rollback:
        raise ValueError(
            "terminal rollback must restore its sealed manifest, not rerun a playbook"
        )
    environment = _terminal_apply_environment()
    environment.update(
        {"ANSIBLE_REPO_VERSION": revision, "RUN_ID": run_id, "RELEASE_ORCHESTRATED": "1"}
    )
    _release_timing_environment(
        environment,
        runtime=runtime,
        run_id=run_id,
        host=host,
        scope="terminal-apply",
    )
    extra = (
        "release_orchestrated=true release_rollback=false "
        "terminal_release_mode=release-only"
    )
    if (
        not isinstance(playbook, str)
        or not playbook.startswith("playbooks/")
        or ".." in playbook.split("/")
        or "\\" in playbook
        or "//" in playbook
    ):
        raise ValueError("terminal profile playbook is unavailable")
    playbook_path = runtime.ANSIBLE_DIRECTORY / playbook
    command = [
        "ansible-playbook",
        "-i",
        inventory,
        str(playbook_path),
        "--limit",
        host,
        "-e",
        extra,
    ]
    if runtime_artifact_vars is not None:
        artifact_vars_path = Path(runtime_artifact_vars)
        if (
            not artifact_vars_path.is_absolute()
            or not artifact_vars_path.is_file()
            or artifact_vars_path.is_symlink()
            or artifact_vars_path.name != "ansible-vars.json"
        ):
            raise ValueError("runtime artifact vars are unavailable")
        command.extend(["-e", f"@{artifact_vars_path}"])
    runtime.run(
        command,
        cwd=runtime.ANSIBLE_DIRECTORY,
        env=environment,
    )


def _validated_terminal_rollback_authority(
    target_spec: dict[str, str], target: dict[str, Any], run_id: str
) -> dict[str, Any]:
    host, terminal_type = _validated_terminal_spec(target_spec)
    previous_sha = target.get("previousSha")
    _validated_run_and_sha(run_id, previous_sha)
    desired_sha = target.get("desiredSha")
    if (
        not isinstance(desired_sha, str)
        or _FULL_SHA_RE.fullmatch(desired_sha) is None
    ):
        raise ValueError("desired release SHA is malformed")
    manifest = target.get("rollbackManifest")
    expected_path = _expected_manifest_path(run_id, host)
    if not isinstance(manifest, dict) or set(manifest) != {
        "path",
        "manifestSha256",
        "count",
        "runtime",
    }:
        raise RuntimeError("terminal rollback manifest reference is malformed")
    digest = manifest.get("manifestSha256")
    count = manifest.get("count")
    if (
        manifest.get("path") != expected_path
        or not isinstance(digest, str)
        or _SHA256_RE.fullmatch(digest) is None
        or isinstance(count, bool)
        or not isinstance(count, int)
        or count <= 0
        or count > 4096
    ):
        raise RuntimeError("terminal rollback manifest identity is invalid")
    runtime_manifest = _validated_runtime_manifest_reference(
        manifest.get("runtime"),
        run_id=run_id,
        host=host,
        terminal_type=terminal_type,
    )
    return {
        "host": host,
        "terminalType": terminal_type,
        "previousSha": previous_sha,
        "desiredSha": desired_sha,
        "manifest": manifest,
        "manifestPath": expected_path,
        "manifestSha256": digest,
        "count": count,
        "runtimeManifest": runtime_manifest,
    }


def preflight_terminal_rollback(
    inventory: str,
    target_spec: dict[str, str],
    target: dict[str, Any],
    run_id: str,
    *,
    runtime: Runtime,
) -> dict[str, Any]:
    """Read every sealed rollback prerequisite before the first host mutation."""

    authority = _validated_terminal_rollback_authority(target_spec, target, run_id)
    issues: list[str] = []
    file_result: dict[str, Any] | None = None
    runtime_result: dict[str, Any] | None = None
    try:
        file_result = _run_manifest_helper(
            inventory,
            authority["host"],
            [
                "preflight-restore",
                "--root",
                _ROLLBACK_MANIFEST_ROOT,
                "--run-id",
                run_id,
                "--host",
                authority["host"],
                "--expected-manifest-sha256",
                authority["manifestSha256"],
                "--candidate-head",
                authority["desiredSha"],
            ],
            runtime=runtime,
        )
        if (
            set(file_result)
            != {
                "ready",
                "manifest",
                "manifestSha256",
                "count",
                "repository",
                "issues",
            }
            or type(file_result.get("ready")) is not bool
            or file_result.get("manifest") != authority["manifestPath"]
            or file_result.get("manifestSha256") != authority["manifestSha256"]
            or file_result.get("count") != authority["count"]
            or file_result.get("repository")
            != {"path": _TERMINAL_REPOSITORY, "head": authority["previousSha"]}
            or not isinstance(file_result.get("issues"), list)
            or any(
                not isinstance(issue, str) or not issue
                for issue in file_result["issues"]
            )
            or file_result["ready"] != (not file_result["issues"])
        ):
            raise RuntimeError("terminal file rollback preflight result is invalid")
        issues.extend(f"file manifest: {issue}" for issue in file_result["issues"])
    except Exception as error:
        issues.append(f"file manifest: {error}")

    runtime_manifest = authority["runtimeManifest"]
    try:
        runtime_result = _run_runtime_manifest_helper(
            inventory,
            authority["host"],
            [
                "preflight-restore",
                "--root",
                _RUNTIME_MANIFEST_ROOT,
                "--run-id",
                run_id,
                "--host",
                authority["host"],
                "--expected-manifest-sha256",
                runtime_manifest["manifestSha256"],
            ],
            runtime=runtime,
        )
        if (
            set(runtime_result)
            != {
                "ready",
                "manifestSha256",
                "unitCount",
                "dockerCount",
                "runtimeHealth",
                "restoredReceipt",
                "requiresRuntimeReconciliation",
                "issues",
            }
            or type(runtime_result.get("ready")) is not bool
            or runtime_result.get("manifestSha256")
            != runtime_manifest["manifestSha256"]
            or runtime_result.get("unitCount") != runtime_manifest["unitCount"]
            or runtime_result.get("dockerCount") != runtime_manifest["dockerCount"]
            or type(runtime_result.get("restoredReceipt")) is not bool
            or type(runtime_result.get("requiresRuntimeReconciliation")) is not bool
            or not isinstance(runtime_result.get("issues"), list)
            or any(
                not isinstance(issue, str) or not issue
                for issue in runtime_result["issues"]
            )
            or runtime_result["ready"] != (not runtime_result["issues"])
        ):
            raise RuntimeError("terminal runtime rollback preflight result is invalid")
        runtime_result["runtimeHealth"] = _validated_runtime_health_contract(
            runtime_result.get("runtimeHealth"), terminal_type=authority["terminalType"]
        )
        issues.extend(f"runtime manifest: {issue}" for issue in runtime_result["issues"])
    except Exception as error:
        issues.append(f"runtime manifest: {error}")

    return {
        "ready": not issues,
        "issues": issues,
        "fileManifestReady": bool(file_result and file_result.get("ready")),
        "runtimeManifestReady": bool(runtime_result and runtime_result.get("ready")),
        "runtimeHealth": (
            runtime_result.get("runtimeHealth") if runtime_result else None
        ),
        "restoredReceipt": bool(runtime_result and runtime_result.get("restoredReceipt")),
        "requiresRuntimeReconciliation": bool(
            runtime_result and runtime_result.get("requiresRuntimeReconciliation")
        ),
    }


def rollback_terminal(
    inventory: str,
    target_spec: dict[str, str],
    target: dict[str, Any],
    run_id: str,
    *,
    runtime: Runtime,
) -> bool:
    try:
        authority = _validated_terminal_rollback_authority(
            target_spec, target, run_id
        )
        host = authority["host"]
        terminal_type = authority["terminalType"]
        previous_sha = authority["previousSha"]
        desired_sha = authority["desiredSha"]
        expected_path = authority["manifestPath"]
        digest = authority["manifestSha256"]
        count = authority["count"]
        runtime_manifest = authority["runtimeManifest"]
        result = _run_manifest_helper(
            inventory,
            host,
            [
                "restore",
                "--root",
                _ROLLBACK_MANIFEST_ROOT,
                "--run-id",
                run_id,
                "--host",
                host,
                "--expected-manifest-sha256",
                digest,
                "--candidate-head",
                desired_sha,
            ],
            runtime=runtime,
        )
        destinations = result.get("destinations")
        if (
            set(result)
            != {
                "restored",
                "manifest",
                "manifestSha256",
                "count",
                "destinations",
                "repository",
            }
            or result.get("restored") is not True
            or result.get("manifest") != expected_path
            or result.get("manifestSha256") != digest
            or result.get("count") != count
            or not isinstance(destinations, list)
            or len(destinations) != count
            or any(
                not isinstance(destination, str)
                or not destination.startswith("/")
                or "\x00" in destination
                for destination in destinations
            )
            or len(set(destinations)) != count
            or result.get("repository")
            != {"path": _TERMINAL_REPOSITORY, "head": previous_sha}
        ):
            raise RuntimeError("terminal rollback restore result is invalid")
        if remote_previous_sha(inventory, host, runtime=runtime) != previous_sha:
            raise RuntimeError("terminal repository HEAD was not restored")
        runtime_result = _run_runtime_manifest_helper(
            inventory,
            host,
            [
                "restore",
                "--root",
                _RUNTIME_MANIFEST_ROOT,
                "--run-id",
                run_id,
                "--host",
                host,
                "--expected-manifest-sha256",
                runtime_manifest["manifestSha256"],
            ],
            runtime=runtime,
        )
        if (
            set(runtime_result)
            != {
                "restored",
                "manifestSha256",
                "unitCount",
                "dockerCount",
                "runtimeHealth",
            }
            or runtime_result.get("restored") is not True
            or runtime_result.get("manifestSha256")
            != runtime_manifest["manifestSha256"]
            or runtime_result.get("unitCount") != runtime_manifest["unitCount"]
            or runtime_result.get("dockerCount")
            != runtime_manifest["dockerCount"]
        ):
            raise RuntimeError("terminal runtime restore result is invalid")
        target["rollbackRuntimeHealth"] = _validated_runtime_health_contract(
            runtime_result.get("runtimeHealth"), terminal_type=terminal_type
        )
        target["rollback"] = "success"
        return True
    except Exception as rollback_error:
        target["rollback"] = f"failed: {rollback_error}"
        return False


def cleanup_terminal_rollback(
    inventory: str,
    target_spec: dict[str, str],
    target: dict[str, Any],
    run_id: str,
    outcome: str,
    *,
    runtime: Runtime,
) -> dict[str, Any]:
    """Remove only run-scoped rollback image tags after a verified outcome."""

    host, terminal_type = _validated_terminal_spec(target_spec)
    if not isinstance(run_id, str) or _RUN_ID_RE.fullmatch(run_id) is None:
        raise ValueError("run ID is malformed")
    if outcome not in {"committed", "restored"}:
        raise ValueError("terminal rollback cleanup outcome is invalid")
    manifest = target.get("rollbackManifest")
    if not isinstance(manifest, dict):
        raise RuntimeError("terminal rollback manifest reference is malformed")
    runtime_manifest = _validated_runtime_manifest_reference(
        manifest.get("runtime"),
        run_id=run_id,
        host=host,
        terminal_type=terminal_type,
    )
    result = _run_runtime_manifest_helper(
        inventory,
        host,
        [
            "cleanup",
            "--root",
            _RUNTIME_MANIFEST_ROOT,
            "--run-id",
            run_id,
            "--host",
            host,
            "--expected-manifest-sha256",
            runtime_manifest["manifestSha256"],
            "--outcome",
            outcome,
        ],
        runtime=runtime,
    )
    already_clean = result.get("alreadyClean")
    tag_count = result.get("tagCount")
    if (
        set(result)
        != {
            "cleaned",
            "alreadyClean",
            "manifestSha256",
            "tagCount",
            "outcome",
        }
        or result.get("cleaned") is not True
        or type(already_clean) is not bool
        or result.get("manifestSha256") != runtime_manifest["manifestSha256"]
        or isinstance(tag_count, bool)
        or not isinstance(tag_count, int)
        or tag_count < 0
        or tag_count > runtime_manifest["dockerCount"]
        or (already_clean and tag_count != 0)
        or result.get("outcome") != outcome
    ):
        raise RuntimeError("terminal runtime cleanup result is invalid")
    return result
