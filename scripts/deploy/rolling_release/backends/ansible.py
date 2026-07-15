"""Ansible command adapter used by the rolling-release coordinator.

This module executes already-decided host actions.  It deliberately does not
choose release scope, host order, or rollback policy.
"""
from __future__ import annotations

import base64
import binascii
import json
import os
import re
import shlex
import subprocess
from typing import Any, Protocol


_RUN_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{2,79}$")
_HOST_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,254}$")
_CLIENT_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
_FULL_SHA_RE = re.compile(r"^[0-9a-f]{40}$")
_SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
_VERIFICATION_ID_RE = re.compile(r"^[0-9a-f]{32}$")
_REMOTE_USER_RE = re.compile(r"^[a-z_][a-z0-9_-]{0,31}$")
_REMOTE_HOME_RE = re.compile(r"^/home/[a-z_][a-z0-9_-]{0,31}$")
_MANIFEST_MARKER_RE = re.compile(
    r"ROLLBACK_MANIFEST_RESULT:([A-Za-z0-9_-]+={0,2})(?![A-Za-z0-9_=-])"
)
_MAX_MARKER_BYTES = 2 * 1024 * 1024

_TERMINAL_REPOSITORY = "/opt/RaspberryPiSystem_002"
_ROLLBACK_MANIFEST_ROOT = "/var/lib/raspi-release/rollback-manifests"

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
    ) -> None: ...


def inventory_json(path: str, *, runtime: Runtime) -> dict[str, Any]:
    return json.loads(
        runtime.run(
            ["ansible-inventory", "-i", path, "--list"],
            cwd=runtime.ANSIBLE_DIRECTORY,
            capture=True,
        )
    )


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


def _validated_terminal_spec(target_spec: dict[str, str]) -> tuple[str, str]:
    host = target_spec.get("host")
    terminal_type = target_spec.get("terminalType")
    if not isinstance(host, str) or _HOST_RE.fullmatch(host) is None:
        raise ValueError("terminal host is malformed")
    if terminal_type not in {"kiosk", "signage"}:
        raise ValueError("terminal type is unsupported")
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
    dynamic_common = (
        f"/etc/sudoers.d/{user}",
        f"/etc/sudoers.d/{user}-client-services",
    )
    if terminal_type == "kiosk":
        dynamic_role = (
            f"{home}/.config/autostart/ibus.desktop",
            f"{home}/.config/autostart/ibus-owner.desktop",
            f"{home}/.config/autostart/ibus-engine.desktop",
            f"{home}/.config/autostart/im-launch.desktop",
            f"{home}/.mozilla/firefox/kiosk-system/chrome/userChrome.css",
            f"{home}/.mozilla/firefox/kiosk-system/user.js",
            f"{home}/.config/labwc/rc.xml",
        )
        role_paths = _KIOSK_TERMINAL_PATHS
    else:
        dynamic_role = (f"/run/signage/release-{run_id}-maintenance.svg",)
        role_paths = _SIGNAGE_TERMINAL_PATHS
    # Preserve the declared order while making accidental duplicates a single
    # sealed entry (the helper rejects duplicate destinations).
    return list(
        dict.fromkeys(
            (*_COMMON_TERMINAL_PATHS, *dynamic_common, *role_paths, *dynamic_role)
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


def _expected_manifest_path(run_id: str, host: str) -> str:
    return f"{_ROLLBACK_MANIFEST_ROOT}/{run_id}/{host}/manifest.json"


def capture_terminal_manifest(
    inventory: str,
    target_spec: dict[str, str],
    run_id: str,
    previous_sha: str,
    *,
    runtime: Runtime,
) -> dict[str, Any]:
    """Seal the exact terminal file set and repository HEAD before mutation."""

    host, terminal_type = _validated_terminal_spec(target_spec)
    _validated_run_and_sha(run_id, previous_sha)
    user, home = _remote_identity(inventory, host, runtime=runtime)
    paths = _terminal_manifest_paths(terminal_type, user, home, run_id)
    arguments = [
        "capture-set",
        "--root",
        _ROLLBACK_MANIFEST_ROOT,
        "--run-id",
        run_id,
        "--host",
        host,
        "--repository",
        _TERMINAL_REPOSITORY,
        "--expected-head",
        previous_sha,
    ]
    for path in paths:
        arguments.extend(("--path", path))
    result = _run_manifest_helper(
        inventory, host, arguments, runtime=runtime
    )
    expected_path = _expected_manifest_path(run_id, host)
    digest = result.get("manifestSha256")
    repository = result.get("repository")
    if (
        result.get("captured") is not True
        or result.get("manifest") != expected_path
        or not isinstance(digest, str)
        or _SHA256_RE.fullmatch(digest) is None
        or result.get("count") != len(paths)
        or result.get("destinations") != paths
        or repository
        != {"path": _TERMINAL_REPOSITORY, "head": previous_sha}
    ):
        raise RuntimeError(f"rollback manifest capture result is invalid: {host}")
    # Do not copy captured payloads or their (potentially secret) contents into
    # controller state. This sealed reference is sufficient for exact restore.
    return {"path": expected_path, "manifestSha256": digest, "count": len(paths)}


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
    command = (
        "set -e; "
        f"rsvg-convert -f png -w 1920 -h 1080 {shlex.quote(staged_source)} "
        "-o /run/signage/current.tmp.jpg; "
        "if test -f /run/signage/current.jpg; then "
        "cat /run/signage/current.tmp.jpg > /run/signage/current.jpg; "
        "rm -f /run/signage/current.tmp.jpg; "
        "else mv /run/signage/current.tmp.jpg /run/signage/current.jpg; fi; "
        f"rm -f {shlex.quote(staged_source)}"
    )
    runtime.run(
        ["ansible", "-i", inventory, host, "-b", "-m", "shell", "-a", command],
        cwd=runtime.ANSIBLE_DIRECTORY,
    )
    runtime.state_command("ack", "--run-id", run_id, "--client", client_id)


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


def converge_server_config(
    inventory: str,
    host: str,
    revision: str,
    run_id: str,
    *,
    runtime: Runtime,
) -> None:
    """Converge Pi5 host configuration without invoking a runtime executor."""

    environment = os.environ.copy()
    environment.update(
        {
            "ANSIBLE_REPO_VERSION": revision,
            "RUN_ID": run_id,
            "RELEASE_ORCHESTRATED": "1",
        }
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
            str(runtime.ANSIBLE_DIRECTORY / "playbooks/deploy-staged.yml"),
            "--limit",
            host,
            "-e",
            extra,
        ],
        cwd=runtime.ANSIBLE_DIRECTORY,
        env=environment,
    )


def playbook(
    inventory: str,
    host: str,
    revision: str,
    run_id: str,
    *,
    rollback: bool = False,
    runtime: Runtime,
) -> None:
    if rollback:
        raise ValueError(
            "terminal rollback must restore its sealed manifest, not rerun a playbook"
        )
    environment = os.environ.copy()
    environment.update(
        {"ANSIBLE_REPO_VERSION": revision, "RUN_ID": run_id, "RELEASE_ORCHESTRATED": "1"}
    )
    extra = (
        "release_orchestrated=true release_rollback=false "
        "terminal_release_mode=release-only"
    )
    runtime.run(
        [
            "ansible-playbook",
            "-i",
            inventory,
            str(runtime.ANSIBLE_DIRECTORY / "playbooks/deploy-staged.yml"),
            "--limit",
            host,
            "-e",
            extra,
        ],
        cwd=runtime.ANSIBLE_DIRECTORY,
        env=environment,
    )


def rollback_terminal(
    inventory: str,
    target_spec: dict[str, str],
    target: dict[str, Any],
    run_id: str,
    *,
    runtime: Runtime,
) -> bool:
    try:
        host, terminal_type = _validated_terminal_spec(target_spec)
        previous_sha = target.get("previousSha")
        _validated_run_and_sha(run_id, previous_sha)
        manifest = target.get("rollbackManifest")
        expected_path = _expected_manifest_path(run_id, host)
        if not isinstance(manifest, dict) or set(manifest) != {
            "path",
            "manifestSha256",
            "count",
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
            ],
            runtime=runtime,
        )
        destinations = result.get("destinations")
        if (
            result.get("restored") is not True
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
        _reconcile_terminal_runtime(
            inventory, host, terminal_type, runtime=runtime
        )
        target["rollback"] = "success"
        return True
    except Exception as rollback_error:
        target["rollback"] = f"failed: {rollback_error}"
        return False


def _reconcile_terminal_runtime(
    inventory: str,
    host: str,
    terminal_type: str,
    *,
    runtime: Runtime,
) -> None:
    """Restart only the runtime required for post-rollback health evidence."""

    if terminal_type == "kiosk":
        command = (
            "set -eu; "
            "systemctl daemon-reload; "
            "systemctl enable --now lightdm.service kiosk-browser.service "
            "status-agent.timer; "
            "systemctl start status-agent.service"
        )
    else:
        command = (
            "set -eu; "
            "systemctl daemon-reload; "
            "systemctl unmask --runtime signage-lite.service; "
            "systemctl enable --now lightdm.service signage-lite.service "
            "signage-lite-update.timer signage-lite-watchdog.timer "
            "signage-daily-reboot.timer status-agent.timer; "
            "systemctl start status-agent.service"
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
            command,
        ],
        cwd=runtime.ANSIBLE_DIRECTORY,
    )
