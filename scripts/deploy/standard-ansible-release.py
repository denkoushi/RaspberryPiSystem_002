#!/usr/bin/env python3
"""Thin canonical launcher for the standard Ansible release playbook."""
from __future__ import annotations

import argparse
import json
import os
import re
import secrets
import shlex
import shutil
import socket
import subprocess
import sys
import tempfile
from collections.abc import Sequence
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, NamedTuple

from release_artifact_contract import (
    ReleaseSet,
    TORQUE_ADOPTION_PREDICATE_TYPE,
    TORQUE_PROTOCOL_VERSION,
    parse_release_set,
    validate_release_set,
)
from release_build_contract import build_config_hash, parse_contract_json
from torque_component_adoption import AdoptionError, validate_adoption_predicate
from rolling_release.attestation_environment import (
    PUBLIC_ATTESTATION_TOKEN,
    isolated_attestation_environment,
)

ROOT = Path(__file__).resolve().parents[2]
ANSIBLE = ROOT / "infrastructure/ansible"
PLAYBOOK = ANSIBLE / "playbooks/deploy-release-standard.yml"
REMOTE_ROOT = Path("/opt/RaspberryPiSystem_002")
DEFAULT_INVENTORY = "infrastructure/ansible/inventory.yml"
UNIT_PREFIX = "raspi-standard-release-"
FULL_SHA = re.compile(r"^[0-9a-f]{40}$")
RUN_ID = re.compile(r"^[0-9]{8}-[0-9]{6}-[0-9a-f]{6}$")
SAFE_BRANCH = re.compile(r"^(?![-./])(?!.*(?:\.\.|//|@\{|\.lock(?:/|$)))[A-Za-z0-9_./-]{1,255}$")
SAFE_USER = re.compile(r"^[a-z_][a-z0-9_-]{0,30}$")
SAFE_REMOTE_ROOT = re.compile(
    r"^/opt/RaspberryPiSystem_002(?:-[A-Za-z0-9][A-Za-z0-9._-]*)?$"
)
PROFILES = ("pi5", "pi4", "pi3")
PROFILE_GROUP = {"pi5": "server", "pi4": "kiosk", "pi3": "signage"}
TORQUE_CUTOVER_SERVICE = "torque-agent"
TORQUE_USB_ID = re.compile(r"^[0-9a-f]{4}$")
TORQUE_SERIAL = re.compile(r"^[A-Za-z0-9._-]{1,120}$")
TORQUE_LINK_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,126}-event-kbd$")
TORQUE_DEVICE_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,126}$")
TORQUE_BLUETOOTH_UNIQ = re.compile(r"^[0-9a-f]{2}(?::[0-9a-f]{2}){5}$")
TORQUE_URL = re.compile(r"^https?://[^\s{}]+$")
TORQUE_URL_VARIABLE = re.compile(r"^\{\{\s*[A-Za-z_][A-Za-z0-9_.]*\s*\}\}$")
OPTIONAL_HOST_CONNECT_TIMEOUT_SECONDS = 3.0
SAFE_INVENTORY_HOST = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,252}$")
OPTIONAL_ADDRESS_ALIASES = {
    "kiosk_ip": "raspberrypi4_ip",
    "signage_ip": "raspberrypi3_ip",
}
OPTIONAL_ADDRESS_ALIAS = re.compile(r"^\{\{\s*(kiosk_ip|signage_ip)\s*\}\}$")
OPTIONAL_NETWORK_ADDRESS = re.compile(
    r"^\{\{\s*current_network\.([A-Za-z0-9_]+)\s*\|\s*"
    r"default\(local_network\.\1\)\s*\}\}$"
)
RETIRED = {
    "--approve", "--cancel", "--preflight-only", "--release-scope",
    "--signage-oci-digest", "--signage-source-sha",
    "--signage-artifact-sha256", "--signage-manifest-sha256",
    "--signage-payload-digest", "--readiness-admission-json",
}


class UsageError(RuntimeError):
    pass


class ReleaseArtifacts(NamedTuple):
    api: str
    web: str
    torque_agent: str | None
    torque_protocol_version: int | None


class TorqueCutoverPlan(NamedTuple):
    """One verified, run-scoped component plan shared by every selected host."""

    source_sha: str
    run_id: str
    hosts: tuple[str, ...]
    api_image: str
    web_image: str
    torque_image: str
    protocol_version: int

    def ansible_variables(self) -> dict[str, Any]:
        return {
            "release_torque_cutover_hosts": list(self.hosts),
            "release_kiosk_service_allowlist": [TORQUE_CUTOVER_SERVICE],
            "release_kiosk_torque_image": self.torque_image,
            "release_torque_protocol_version": self.protocol_version,
        }

    def journal_event(self) -> dict[str, Any]:
        return {
            "event": "release-set-v2-prepared",
            "releaseSha": self.source_sha,
            "runId": self.run_id,
            "protocol": {"name": "torque-ownership", "version": self.protocol_version},
            "images": {
                "api": self.api_image,
                "web": self.web_image,
                "torqueAgent": self.torque_image,
            },
            "targets": [
                {"host": host, "component": TORQUE_CUTOVER_SERVICE}
                for host in self.hosts
            ],
        }


class Parser(argparse.ArgumentParser):
    def error(self, message: str) -> None:
        raise UsageError(message)


def run(command: Sequence[str], *, check: bool = True, env: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(command, cwd=ROOT, env=env, text=True, capture_output=True, check=False)
    if check and result.returncode:
        raise RuntimeError((result.stderr or result.stdout or f"command failed: {command[0]}").strip())
    return result


def parser() -> Parser:
    value = Parser(prog="update-all-clients.sh")
    value.add_argument("branch_positional", nargs="?")
    value.add_argument("inventory_positional", nargs="?")
    value.add_argument("--branch")
    value.add_argument("--inventory")
    value.add_argument("--limit", default="")
    value.add_argument("--full-fleet", action="store_true")
    value.add_argument("--print-plan", action="store_true")
    value.add_argument("--detach", action="store_true")
    value.add_argument("--torque-cutover", action="store_true")
    value.add_argument("--status")
    value.add_argument("--execute-standard-route", action="store_true", help=argparse.SUPPRESS)
    value.add_argument("--sha", help=argparse.SUPPRESS)
    value.add_argument("--run-id", help=argparse.SUPPRESS)
    value.add_argument("--profiles", help=argparse.SUPPRESS)
    return value


def parse_arguments(argv: Sequence[str]) -> argparse.Namespace:
    for token in argv:
        option = token.split("=", 1)[0]
        if option in RETIRED:
            raise UsageError(f"{option} is unsupported by the standard Ansible route")
    args = parser().parse_args(argv)
    for name in ("branch", "inventory"):
        positional = getattr(args, f"{name}_positional")
        explicit = getattr(args, name)
        if positional and explicit and positional != explicit:
            raise UsageError(f"conflicting {name} values")
        setattr(args, name, explicit or positional)
    if args.full_fleet and args.limit:
        raise UsageError("--full-fleet cannot be combined with --limit")
    if args.print_plan and args.detach:
        raise UsageError("--print-plan cannot be combined with --detach")
    if args.status:
        if any((args.branch, args.limit, args.full_fleet, args.print_plan, args.detach, args.torque_cutover, args.execute_standard_route)):
            raise UsageError("--status accepts only RUN_ID and optional --inventory")
        if not RUN_ID.fullmatch(args.status):
            raise UsageError("run ID must use YYYYMMDD-HHMMSS-<6 lowercase hex>")
        args.inventory = args.inventory or DEFAULT_INVENTORY
        return args
    if not args.branch or not args.inventory:
        raise UsageError("branch and inventory are required")
    if not SAFE_BRANCH.fullmatch(args.branch) or args.branch.endswith((".", "/")):
        raise UsageError("branch is not a safe Git branch name")
    if args.torque_cutover and (args.full_fleet or not args.limit):
        raise UsageError("--torque-cutover requires an exact --limit and cannot use --full-fleet")
    if not args.execute_standard_route and not args.print_plan and not (args.limit or args.full_fleet):
        raise UsageError("mutation requires explicit --limit PATTERN or --full-fleet")
    if args.execute_standard_route:
        profiles = tuple((args.profiles or "").split(","))
        if not (args.limit or args.full_fleet):
            raise UsageError("internal mutation requires explicit --limit or --full-fleet")
        if not args.sha or not FULL_SHA.fullmatch(args.sha) or not args.run_id or not RUN_ID.fullmatch(args.run_id):
            raise UsageError("internal standard route identity is malformed")
        if not profiles or any(item not in PROFILES for item in profiles) or len(set(profiles)) != len(profiles):
            raise UsageError("internal standard route profiles are malformed")
    elif args.sha or args.run_id or args.profiles:
        raise UsageError("internal standard route options are not public")
    return args


def inventory_path(value: str) -> tuple[Path, str]:
    candidate = Path(value)
    candidate = candidate if candidate.is_absolute() else ROOT / candidate
    resolved = candidate.resolve(strict=True)
    if (
        candidate.is_symlink()
        or not resolved.is_file()
        or resolved.suffix != ".yml"
        or not resolved.is_relative_to(ANSIBLE)
    ):
        raise UsageError("inventory must be a regular YAML file in infrastructure/ansible")
    return resolved, resolved.relative_to(ROOT).as_posix()


def ansible_environment() -> dict[str, str]:
    environment = os.environ.copy()
    environment["ANSIBLE_CONFIG"] = str(ANSIBLE / "ansible.cfg")
    return environment


def inventory_document(path: Path, limit: str = "") -> dict[str, Any]:
    command = ["ansible-inventory", "-i", str(path), "--list"]
    if limit:
        command.extend(["--limit", limit])
    try:
        value = json.loads(run(command, env=ansible_environment()).stdout)
    except json.JSONDecodeError as error:
        raise RuntimeError("ansible-inventory returned malformed JSON") from error
    if not isinstance(value, dict):
        raise RuntimeError("ansible-inventory returned no inventory object")
    return value


def selected_profiles(document: dict[str, Any]) -> tuple[tuple[str, tuple[str, ...]], ...]:
    hostvars = document.get("_meta", {}).get("hostvars", {})
    selected = set(hostvars) if isinstance(hostvars, dict) else set()
    result = []
    supported: set[str] = set()
    for profile in PROFILES:
        hosts = document.get(PROFILE_GROUP[profile], {}).get("hosts", [])
        members = set(hosts) if isinstance(hosts, list) else set()
        supported.update(members)
        chosen = tuple(host for host in hosts if host in selected)
        if chosen:
            result.append((profile, chosen))
    if not selected:
        raise UsageError("target selection matched no hosts")
    if selected - supported:
        raise UsageError("target selection includes hosts outside server/kiosk/signage")
    return tuple(result)


def validate_torque_cutover_selection(
    document: dict[str, Any],
    selection: tuple[tuple[str, tuple[str, ...]], ...],
) -> None:
    profiles = tuple(profile for profile, _hosts in selection)
    if profiles != ("pi5", "pi4"):
        raise UsageError("--torque-cutover requires exactly the Pi5 server and torque-enabled Pi4 kiosks")
    hostvars = document.get("_meta", {}).get("hostvars", {})
    pi4_hosts = selection[1][1]
    if not isinstance(hostvars, dict) or any(
        not torque_cutover_capable(hostvars.get(host)) for host in pi4_hosts
    ):
        raise UsageError(
            "--torque-cutover requires every explicitly selected Pi4 to have complete torque-agent inventory capability"
        )


def torque_cutover_capable(values: object) -> bool:
    if not isinstance(values, dict):
        return False
    adapter = values.get("torque_agent_bluetooth_adapter")
    devices = values.get("torque_agent_hid_devices")
    links = values.get("torque_agent_hid_links")
    browser_origins = values.get("torque_agent_browser_origins", [])
    local_port = values.get("torque_agent_local_port", 7073)
    heartbeat_ttl = values.get("torque_agent_heartbeat_ttl_seconds", 8)
    if not isinstance(adapter, dict) or not isinstance(devices, list) or not devices:
        return False
    if not isinstance(links, list) or not links:
        return False
    device_paths = {
        device.get("path")
        for device in devices
        if isinstance(device, dict)
        and isinstance(device.get("path"), str)
        and device["path"].startswith("/dev/input/by-id/")
        and device.get("parserProfile") == "cem3-btla-hogp-v1"
        and isinstance(device.get("serialNumber"), str)
        and TORQUE_SERIAL.fullmatch(device["serialNumber"])
    }
    if len(device_paths) != len(devices):
        return False
    links_complete = all(
        isinstance(link, dict)
        and isinstance(link.get("link_name"), str)
        and TORQUE_LINK_NAME.fullmatch(link["link_name"])
        and isinstance(link.get("name"), str)
        and TORQUE_DEVICE_NAME.fullmatch(link["name"])
        and isinstance(link.get("uniq"), str)
        and TORQUE_BLUETOOTH_UNIQ.fullmatch(link["uniq"])
        and isinstance(link.get("vendor_id"), str)
        and TORQUE_USB_ID.fullmatch(link["vendor_id"])
        and isinstance(link.get("product_id"), str)
        and TORQUE_USB_ID.fullmatch(link["product_id"])
        and f"/dev/input/by-id/{link['link_name']}" in device_paths
        for link in links
    )
    return bool(
        values.get("torque_agent_enabled") is True
        and values.get("torque_connection_lease_enabled") is True
        and isinstance(values.get("torque_agent_api_base_url"), str)
        and torque_inventory_url(values["torque_agent_api_base_url"])
        and isinstance(values.get("torque_agent_client_key"), str)
        and values["torque_agent_client_key"]
        and values.get("torque_agent_tls_verify_mode", "system") in {"system", "insecure"}
        and isinstance(local_port, int)
        and not isinstance(local_port, bool)
        and 0 < local_port < 65536
        and isinstance(heartbeat_ttl, int)
        and not isinstance(heartbeat_ttl, bool)
        and heartbeat_ttl > 0
        and isinstance(browser_origins, list)
        and all(
            isinstance(origin, str) and torque_inventory_url(origin)
            for origin in browser_origins
        )
        and isinstance(adapter.get("usb_vendor_id"), str)
        and TORQUE_USB_ID.fullmatch(adapter["usb_vendor_id"])
        and isinstance(adapter.get("usb_product_id"), str)
        and TORQUE_USB_ID.fullmatch(adapter["usb_product_id"])
        and links_complete
    )


def torque_inventory_url(value: str) -> bool:
    # ansible-inventory retains safe nested variable references; the shared
    # runtime role validates the fully rendered URL before any kiosk is stopped.
    return bool(TORQUE_URL.fullmatch(value) or TORQUE_URL_VARIABLE.fullmatch(value))


def resolve_optional_host_address(values: dict[str, Any], address: str) -> str:
    alias = OPTIONAL_ADDRESS_ALIAS.fullmatch(address)
    network = OPTIONAL_NETWORK_ADDRESS.fullmatch(address)
    if not alias and not network:
        return address

    key = OPTIONAL_ADDRESS_ALIASES[alias.group(1)] if alias else network.group(1)
    mode = values.get("network_mode")
    local = values.get("local_network")
    tailscale = values.get("tailscale_network")
    if (
        mode not in ("local", "tailscale")
        or not isinstance(local, dict)
        or not isinstance(tailscale, dict)
    ):
        return address
    selected = local if mode == "local" else tailscale
    candidate = selected.get(key, local.get(key))
    return candidate if isinstance(candidate, str) else address


def optional_host_endpoint(document: dict[str, Any], host: str) -> tuple[str, int]:
    values = document.get("_meta", {}).get("hostvars", {}).get(host, {})
    address = values.get("ansible_host", host)
    if isinstance(address, str):
        address = resolve_optional_host_address(values, address)
    port = values.get("ansible_port", 22)
    if (
        not SAFE_INVENTORY_HOST.fullmatch(host)
        or not isinstance(address, str)
        or not address
        or address != address.strip()
        or any(character.isspace() for character in address)
        or "{" in address
        or "}" in address
    ):
        raise UsageError(f"optional host {host!r} has an unresolved SSH address")
    if isinstance(port, str) and port.isdecimal():
        port = int(port)
    if not isinstance(port, int) or not 1 <= port <= 65535:
        raise UsageError(f"optional host {host!r} has a malformed SSH port")
    return address, port


def preflight_optional_hosts(
    document: dict[str, Any],
    selection: tuple[tuple[str, tuple[str, ...]], ...],
    *,
    connector: Any = socket.create_connection,
) -> tuple[tuple[tuple[str, tuple[str, ...]], ...], tuple[dict[str, str], ...]]:
    """Keep Pi5 mandatory and probe each optional terminal exactly once."""
    reachable: list[tuple[str, tuple[str, ...]]] = []
    excluded: list[dict[str, str]] = []
    for profile, hosts in selection:
        if profile == "pi5":
            reachable.append((profile, hosts))
            continue
        profile_hosts: list[str] = []
        for host in hosts:
            address, port = optional_host_endpoint(document, host)
            try:
                connection = connector(
                    (address, port), timeout=OPTIONAL_HOST_CONNECT_TIMEOUT_SECONDS
                )
            except OSError:
                excluded.append(
                    {"host": host, "profile": profile, "reason": "tcp-unreachable"}
                )
            else:
                connection.close()
                profile_hosts.append(host)
        if profile_hosts:
            reachable.append((profile, tuple(profile_hosts)))
    return tuple(reachable), tuple(excluded)


def exact_host_limit(
    selection: tuple[tuple[str, tuple[str, ...]], ...]
) -> str:
    hosts = [host for _profile, members in selection for host in members]
    if not hosts or any(not SAFE_INVENTORY_HOST.fullmatch(host) for host in hosts):
        raise UsageError("reachable target selection is empty or malformed")
    return ":".join(hosts)


def server_connection(document: dict[str, Any]) -> tuple[str, str, int]:
    hosts = document.get("server", {}).get("hosts", [])
    if not isinstance(hosts, list) or len(hosts) != 1:
        raise UsageError("inventory must contain exactly one Pi5 server executor")
    values = document.get("_meta", {}).get("hostvars", {}).get(hosts[0], {})
    host = values.get("deploy_executor_host")
    user, port = values.get("ansible_user"), values.get("ansible_port", 22)
    if (
        not isinstance(host, str)
        or not host
        or host != host.strip()
        or any(character.isspace() for character in host)
        or "{" in host
        or "}" in host
        or not isinstance(user, str)
        or not SAFE_USER.fullmatch(user)
    ):
        raise UsageError("Pi5 SSH identity is unresolved or malformed")
    if not isinstance(port, int) or not 1 <= port <= 65535:
        raise UsageError("Pi5 SSH port is malformed")
    return host, user, port


def server_release_root(document: dict[str, Any]) -> Path:
    hosts = document.get("server", {}).get("hosts", [])
    if not isinstance(hosts, list) or len(hosts) != 1:
        raise UsageError("inventory must contain exactly one Pi5 server executor")
    values = document.get("_meta", {}).get("hostvars", {}).get(hosts[0], {})
    value = values.get("release_remote_root", str(REMOTE_ROOT))
    if not isinstance(value, str) or not SAFE_REMOTE_ROOT.fullmatch(value):
        raise UsageError("Pi5 release remote root is unresolved or malformed")
    return Path(value)


def resolve_sha(branch: str) -> str:
    output = run(["git", "ls-remote", "--exit-code", "origin", f"refs/heads/{branch}"]).stdout.splitlines()
    if len(output) != 1 or not FULL_SHA.fullmatch(output[0].split()[0]):
        raise RuntimeError("branch did not resolve to one remote commit")
    sha = output[0].split()[0]
    if run(["git", "rev-parse", "HEAD"]).stdout.strip() != sha:
        raise UsageError("local checkout must match the selected remote branch SHA")
    return sha


def config_hash(sha: str, inventory: Path) -> str:
    with tempfile.TemporaryDirectory(prefix="standard-release-contract-") as directory:
        contract = Path(directory) / "contract.json"
        run([str(ROOT / "scripts/ci/render-release-build-contract.sh"), "--inventory", str(inventory), "--sha", sha, "--output", str(contract)])
        return build_config_hash(parse_contract_json(contract.read_text(encoding="utf-8"), sha))


def image_plan(
    sha: str,
    profiles: tuple[str, ...],
    build_hash: str = "",
    *,
    torque_cutover: bool = False,
) -> dict[str, Any]:
    result: dict[str, Any] = {}
    if "pi5" in profiles:
        suffix = build_hash[:16]
        result["pi5"] = [f"ghcr.io/denkoushi/raspisys-api:{sha}-{suffix}", f"ghcr.io/denkoushi/raspisys-web:{sha}-{suffix}"]
    if "pi4" in profiles:
        if torque_cutover:
            result["pi4"] = [f"release-set-v2:{sha}:torque-agent"]
        else:
            result["pi4"] = [
                f"ghcr.io/denkoushi/raspisys-{name}-agent:{sha}"
                for name in ("nfc", "barcode", "torque")
            ]
    if "pi3" in profiles:
        result["pi3"] = [f"ghcr.io/denkoushi/raspisys-pi3-signage:{sha}"]
    return result


def ansible_argv(
    inventory: str,
    limit: str,
    profiles: tuple[str, ...],
    variables: dict[str, Any],
    listing: str = "",
    *,
    torque_cutover: bool = False,
) -> list[str]:
    tags = (("torque-cutover",) + profiles) if torque_cutover else profiles
    command = ["ansible-playbook", "-i", inventory, str(PLAYBOOK), "--tags", ",".join(tags), "--extra-vars", json.dumps(variables, sort_keys=True, separators=(",", ":"))]
    if limit:
        command.extend(["--limit", limit])
    if listing:
        command.append(listing)
    return command


def plan(
    args: argparse.Namespace,
    sha: str,
    inventory: Path,
    relative: str,
    selection: tuple[tuple[str, tuple[str, ...]], ...],
    remote_root: Path = REMOTE_ROOT,
) -> dict[str, Any]:
    profiles = tuple(item[0] for item in selection)
    torque_cutover = bool(getattr(args, "torque_cutover", False))
    build_hash = config_hash(sha, inventory) if "pi5" in profiles else ""
    images = image_plan(sha, profiles, build_hash, torque_cutover=torque_cutover)
    pi4_hosts = list(dict(selection).get("pi4", ()))
    variables = {"release_sha": sha, "release_run_id": "plan-preview", "release_pi5_api_image": images.get("pi5", [f"unused:{sha}", f"unused-web:{sha}"])[0], "release_pi5_web_image": images.get("pi5", [f"unused:{sha}", f"unused-web:{sha}"])[1], "release_signage_artifact_sha256": "0" * 64, "release_torque_cutover": torque_cutover, "release_torque_cutover_hosts": pi4_hosts, "release_kiosk_service_allowlist": [TORQUE_CUTOVER_SERVICE] if torque_cutover else []}
    if torque_cutover:
        variables.update(
            {
                "release_kiosk_torque_image": (
                    f"ghcr.io/denkoushi/raspisys-torque-agent@sha256:{'0' * 64}"
                ),
                "release_torque_protocol_contract_version": 1,
            }
        )
    for listing in ("--list-hosts", "--list-tasks"):
        run(ansible_argv(str(inventory), args.limit, profiles, variables, listing, torque_cutover=torque_cutover), env=ansible_environment())
    result = {"schemaVersion": 1, "branch": args.branch, "releaseSha": sha, "inventory": relative, "limit": args.limit or None, "fullFleet": args.full_fleet, "remoteRoot": str(remote_root), "executionOrder": [{"profile": profile, "hosts": list(hosts), "images": images[profile]} for profile, hosts in selection]}
    if torque_cutover:
        result["artifactResolution"] = (
            "signed-release-set-v2-before-service-quiesce"
        )
        result["cutoverPhases"] = [
            {
                "phase": "PREPARED",
                "hosts": list(selection[0][1]) + pi4_hosts,
                "serviceImpact": "none",
            },
            {"phase": "QUIESCED", "hosts": pi4_hosts},
            {"phase": "CONTROL_PLANE", "hosts": list(selection[0][1])},
            {"phase": "AGENTS_STAGED", "hosts": pi4_hosts},
            {"phase": "AGENTS_HEALTHY_OFF", "hosts": pi4_hosts},
            {"phase": "BROWSERS_RESUMED", "hosts": pi4_hosts},
        ]
    return result


def new_run_id() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S-") + secrets.token_hex(3)


def unit_name(run_id: str) -> str:
    return f"{UNIT_PREFIX}{run_id}.service"


def ssh_argv(host: str, user: str, port: int, remote: Sequence[str]) -> list[str]:
    return ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "-p", str(port), f"{user}@{host}", shlex.join(remote)]


def remote_script(
    args: argparse.Namespace,
    sha: str,
    run_id: str,
    relative: str,
    profiles: tuple[str, ...],
    remote_root: Path = REMOTE_ROOT,
) -> str:
    internal = ["python3", "scripts/deploy/standard-ansible-release.py", "--execute-standard-route", "--branch", args.branch, "--inventory", relative, "--sha", sha, "--run-id", run_id, "--profiles", ",".join(profiles)]
    if getattr(args, "torque_cutover", False):
        internal.append("--torque-cutover")
    internal.extend(["--limit", args.limit] if args.limit else ["--full-fleet"])
    return "\n".join(("set -euo pipefail", f"cd {shlex.quote(str(remote_root))}", "mkdir -p logs/deploy", "exec 9>>logs/deploy/fleet-release-state.lock", "/usr/bin/flock -n 9 || { echo 'another fleet release is running' >&2; exit 75; }", "test -z \"$(git status --porcelain)\"", f"git fetch --no-tags origin {shlex.quote(args.branch)}", f"test \"$(git rev-parse FETCH_HEAD)\" = {shlex.quote(sha)}", f"git checkout --detach {shlex.quote(sha)}", f"test \"$(git rev-parse HEAD)\" = {shlex.quote(sha)}", "test -z \"$(git status --porcelain)\"", f"exec {shlex.join(internal)}"))


def systemd_argv(args: argparse.Namespace, sha: str, run_id: str, relative: str, profiles: tuple[str, ...], user: str, remote_root: Path = REMOTE_ROOT) -> list[str]:
    command = ["/usr/bin/sudo", "-n", "/usr/bin/systemd-run", "--quiet", f"--unit={unit_name(run_id)}", f"--uid={user}", f"--setenv=HOME=/home/{user}", f"--setenv=USER={user}", f"--setenv=LOGNAME={user}", "--setenv=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", "--property=Type=exec", f"--property=WorkingDirectory={remote_root}", "--property=KillMode=control-group", "--property=Restart=no", "--property=UMask=0077", "--property=StandardOutput=journal", "--property=StandardError=journal"]
    if args.detach:
        command.append("--property=RemainAfterExit=yes")
    else:
        command.append("--wait")
    command.extend(["--", "/bin/bash", "-lc", remote_script(args, sha, run_id, relative, profiles, remote_root)])
    return command


def _exact_repo_digest(reference: str) -> str:
    inspected = run(
        ["docker", "image", "inspect", "--format", "{{json .RepoDigests}}", reference]
    )
    try:
        values = json.loads(inspected.stdout)
    except json.JSONDecodeError as error:
        raise RuntimeError("pulled release-set image has malformed RepoDigests") from error
    repository = reference.split(":", 1)[0]
    matches = [
        value
        for value in values
        if isinstance(value, str) and value.startswith(f"{repository}@sha256:")
    ] if isinstance(values, list) else []
    if len(matches) != 1:
        raise RuntimeError("pulled release-set image has no unique immutable digest")
    return matches[0]


def verify_component_attestation(
    exact_reference: str,
    source_sha: str,
    *,
    predicate_type: str | None = None,
    adoption_workflow: tuple[str, int, int] | None = None,
) -> None:
    gh = shutil.which("gh")
    if gh is None:
        raise RuntimeError("GitHub attestation verifier is unavailable")
    with isolated_attestation_environment() as isolated:
        environment = isolated.values
        version = run([gh, "--version"], env=environment)
        if not version.stdout.startswith("gh version 2.96.0 "):
            raise RuntimeError("GitHub attestation verifier is not the pinned 2.96.0 release")
        command = [
            gh,
            "attestation",
            "verify",
            f"oci://{exact_reference}",
            "--bundle-from-oci",
            "--repo",
            "denkoushi/RaspberryPiSystem_002",
            "--source-digest",
            source_sha,
            "--source-ref",
            "refs/heads/main",
            "--deny-self-hosted-runners",
        ]
        if predicate_type is not None:
            command.extend(["--predicate-type", predicate_type])
        if adoption_workflow is None:
            run(command, env=environment)
            return
        command.extend(["--format", "json"])
        verified = run(command, env=environment)
    try:
        values = json.loads(verified.stdout)
        predicates = [
            item["verificationResult"]["statement"]["predicate"]
            for item in values
            if isinstance(item, dict)
            and isinstance(item.get("verificationResult"), dict)
            and isinstance(item["verificationResult"].get("statement"), dict)
            and "predicate" in item["verificationResult"]["statement"]
        ] if isinstance(values, list) else []
    except (json.JSONDecodeError, KeyError, TypeError) as error:
        raise RuntimeError("component adoption attestation result is malformed") from error
    workflow, run_id, run_attempt = adoption_workflow
    matching = 0
    for predicate in predicates:
        try:
            validate_adoption_predicate(
                predicate,
                adoption_sha=source_sha,
                workflow=workflow,
                run_id=run_id,
                run_attempt=run_attempt,
            )
        except AdoptionError:
            continue
        matching += 1
    if matching != 1:
        raise RuntimeError(
            "component adoption attestation has no unique manifest-bound predicate"
        )


def _read_release_set_from_image(reference: str) -> ReleaseSet:
    """Read one signed release-set document from an exact OCI reference."""
    container = run(["docker", "create", reference, "/release-set.json"]).stdout.strip()
    if not container:
        raise RuntimeError("release-set image did not produce a container")
    try:
        with tempfile.TemporaryDirectory(prefix="standard-release-set-") as directory:
            path = Path(directory) / "release-set.json"
            run(["docker", "cp", f"{container}:/release-set.json", str(path)])
            return parse_release_set(path.read_text(encoding="utf-8"))
    finally:
        run(["docker", "rm", "-f", container], check=False)


def release_set_artifacts(
    sha: str,
    inventory: Path,
    *,
    require_torque: bool = False,
) -> ReleaseArtifacts:
    build_hash = config_hash(sha, inventory)
    tag_suffix = "-torque-v2" if require_torque else ""
    reference = (
        f"ghcr.io/denkoushi/raspisys-release-set:"
        f"{sha}-{build_hash}{tag_suffix}"
    )
    run(["docker", "image", "pull", reference])
    exact_release_set = _exact_repo_digest(reference)
    verify_component_attestation(exact_release_set, sha)
    release = _read_release_set_from_image(exact_release_set)
    validate_release_set(
        release,
        "denkoushi/RaspberryPiSystem_002",
        sha,
        build_hash,
        ".github/workflows/ci.yml",
    )
    torque_agent = release.torque_agent
    torque_compatibility = release.torque_compatibility
    if require_torque and (torque_agent is None or torque_compatibility is None):
        raise RuntimeError("torque cutover requires signed release-set schema v2")
    if require_torque:
        base_release_set = release.base_release_set
        if base_release_set is None:
            raise RuntimeError("torque cutover requires an exact base v1 release set")
        base_reference = base_release_set.digest
        run(["docker", "image", "pull", base_reference])
        verify_component_attestation(base_reference, sha)
        base_release = _read_release_set_from_image(base_reference)
        validate_release_set(
            base_release,
            "denkoushi/RaspberryPiSystem_002",
            sha,
            build_hash,
            ".github/workflows/ci.yml",
        )
        if (
            base_release.schema_version != 1
            or base_release.source_repository != release.source_repository
            or base_release.source_sha != release.source_sha
            or base_release.source_ref != release.source_ref
            or base_release.config_hash != release.config_hash
            or base_release.api != release.api
            or base_release.web != release.web
            or base_release.workflow != release.workflow
        ):
            raise RuntimeError(
                "schema-v2 base release set does not match its v1 API/Web identity"
            )
    torque_reference = None
    protocol_version = None
    if torque_agent is not None and torque_compatibility is not None:
        torque_reference = f"{torque_agent.repository}@{torque_agent.index_digest}"
        protocol_version = torque_compatibility.protocol_version
        if require_torque:
            composition_workflow = release.composition_workflow
            if composition_workflow is None:
                raise RuntimeError(
                    "torque cutover requires schema-v2 composition workflow identity"
                )
            verify_component_attestation(
                torque_reference,
                sha,
                predicate_type=TORQUE_ADOPTION_PREDICATE_TYPE,
                adoption_workflow=(
                    composition_workflow.path,
                    composition_workflow.run_id,
                    composition_workflow.run_attempt,
                ),
            )
    suffix = build_hash[:16]
    return ReleaseArtifacts(
        api=f"{release.api.repository}:{sha}-{suffix}@{release.api.digest}",
        web=f"{release.web.repository}:{sha}-{suffix}@{release.web.digest}",
        torque_agent=torque_reference,
        torque_protocol_version=protocol_version,
    )


def release_set_images(sha: str, inventory: Path) -> tuple[str, str]:
    artifacts = release_set_artifacts(sha, inventory)
    return artifacts.api, artifacts.web


def normalize_torque_cutover_plan(
    sha: str,
    run_id: str,
    hosts: Sequence[str],
    artifacts: ReleaseArtifacts,
) -> TorqueCutoverPlan:
    """Normalize already-verified v2 artifacts once before Ansible can mutate hosts."""
    if (
        not FULL_SHA.fullmatch(sha)
        or not RUN_ID.fullmatch(run_id)
        or not hosts
        or len(set(hosts)) != len(hosts)
        or any(not SAFE_INVENTORY_HOST.fullmatch(host) for host in hosts)
        or artifacts.torque_agent is None
        or artifacts.torque_protocol_version != TORQUE_PROTOCOL_VERSION
    ):
        raise RuntimeError("release-set torque component plan is incomplete or protocol-incompatible")
    return TorqueCutoverPlan(
        source_sha=sha,
        run_id=run_id,
        hosts=tuple(hosts),
        api_image=artifacts.api,
        web_image=artifacts.web,
        torque_image=artifacts.torque_agent,
        protocol_version=artifacts.torque_protocol_version,
    )


def signage_identity(sha: str) -> tuple[str, str]:
    reference = f"ghcr.io/denkoushi/raspisys-pi3-signage:{sha}"
    run(["docker", "image", "pull", "--platform", "linux/arm/v7", reference])
    digest = run(["docker", "image", "inspect", "--format", '{{index .Config.Labels "io.raspisystem.signage.artifact-sha256"}}', reference]).stdout.strip()
    if not re.fullmatch(r"[0-9a-f]{64}", digest):
        raise RuntimeError("published Signage artifact has no valid final tar SHA-256")
    return reference, digest


def execute_standard_route(args: argparse.Namespace) -> int:
    torque_cutover = bool(getattr(args, "torque_cutover", False))
    inventory, relative = inventory_path(args.inventory)
    if run(["git", "rev-parse", "HEAD"]).stdout.strip() != args.sha:
        raise RuntimeError("remote checkout does not match the release SHA")
    declared_profiles = tuple(args.profiles.split(","))
    selected = inventory_document(inventory, args.limit) if args.limit else inventory_document(inventory)
    requested_selection = selected_profiles(selected)
    if torque_cutover:
        validate_torque_cutover_selection(selected, requested_selection)
    if tuple(profile for profile, _hosts in requested_selection) != declared_profiles:
        raise RuntimeError("remote target profiles differ from the sealed launch request")
    reachable_selection, excluded = preflight_optional_hosts(
        selected, requested_selection
    )
    if torque_cutover and excluded:
        raise RuntimeError("torque cutover requires every selected torque kiosk to be reachable before quiesce")
    print(
        json.dumps(
            {
                "event": "optional-host-preflight",
                "reachable": [
                    {"profile": profile, "hosts": list(hosts)}
                    for profile, hosts in reachable_selection
                ],
                "excluded": list(excluded),
            },
            ensure_ascii=False,
            sort_keys=True,
        ),
        flush=True,
    )
    if not reachable_selection:
        raise RuntimeError("all selected optional hosts are offline; no mutation was run")
    profiles = tuple(profile for profile, _hosts in reachable_selection)
    effective_limit = exact_host_limit(reachable_selection)
    artifacts = (
        release_set_artifacts(args.sha, inventory, require_torque=torque_cutover)
        if "pi5" in profiles
        else ReleaseArtifacts(f"unused:{args.sha}", f"unused-web:{args.sha}", None, None)
    )
    api, web = artifacts.api, artifacts.web
    signage, signage_sha = signage_identity(args.sha) if "pi3" in profiles else (f"unused-signage:{args.sha}", "0" * 64)
    pi4_hosts = list(dict(reachable_selection).get("pi4", ()))
    variables = {"release_sha": args.sha, "release_run_id": args.run_id, "release_pi5_api_image": api, "release_pi5_web_image": web, "release_signage_artifact_image": signage, "release_signage_artifact_sha256": signage_sha, "release_torque_cutover": torque_cutover, "release_torque_cutover_hosts": pi4_hosts, "release_kiosk_service_allowlist": [TORQUE_CUTOVER_SERVICE] if torque_cutover else []}
    if torque_cutover:
        cutover_plan = normalize_torque_cutover_plan(
            args.sha, args.run_id, pi4_hosts, artifacts
        )
        variables.update(cutover_plan.ansible_variables())
        print(
            json.dumps(cutover_plan.journal_event(), ensure_ascii=False, sort_keys=True),
            flush=True,
        )
    command = ansible_argv(relative, effective_limit, profiles, variables, torque_cutover=torque_cutover)
    os.execvpe(command[0], command, ansible_environment())
    return 1


def status(args: argparse.Namespace) -> int:
    inventory, _ = inventory_path(args.inventory)
    host, user, port = server_connection(inventory_document(inventory))
    unit = unit_name(args.status)
    properties = ["LoadState", "ActiveState", "SubState", "Result", "ExecMainStatus"]
    show = run(ssh_argv(host, user, port, ["/usr/bin/sudo", "-n", "/usr/bin/systemctl", "show", "--no-pager", *[f"--property={item}" for item in properties], "--", unit]), check=False)
    journal = run(ssh_argv(host, user, port, ["/usr/bin/sudo", "-n", "/usr/bin/journalctl", "--unit", unit, "--lines=200", "--no-pager", "--output=short-iso"]), check=False)
    values = dict(line.split("=", 1) for line in show.stdout.splitlines() if "=" in line)
    print(json.dumps({"runId": args.status, "unit": unit, "status": values, "journal": journal.stdout.splitlines()}, ensure_ascii=False))
    known = values.get("LoadState") == "loaded"
    healthy = values.get("ActiveState") != "failed" and values.get("Result") in {"", "success"}
    return 0 if show.returncode == 0 and known and healthy else 1


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_arguments(argv if argv is not None else sys.argv[1:])
    if args.execute_standard_route:
        return execute_standard_route(args)
    if args.status:
        return status(args)
    inventory, relative = inventory_path(args.inventory)
    sha = resolve_sha(args.branch)
    complete = inventory_document(inventory)
    selected = complete if not args.limit else inventory_document(inventory, args.limit)
    selection = selected_profiles(selected)
    remote_root = server_release_root(complete)
    if getattr(args, "torque_cutover", False):
        validate_torque_cutover_selection(selected, selection)
    if args.print_plan:
        print(json.dumps(plan(args, sha, inventory, relative, selection, remote_root), ensure_ascii=False, indent=2))
        return 0
    host, user, port = server_connection(complete)
    run_id = new_run_id()
    profiles = tuple(item[0] for item in selection)
    result = run(ssh_argv(host, user, port, systemd_argv(args, sha, run_id, relative, profiles, user, remote_root)), check=False)
    status_command = shlex.join(["scripts/update-all-clients.sh", "--status", run_id, "--inventory", relative])
    print(json.dumps({"runId": run_id, "unit": unit_name(run_id), "detached": args.detach, "statusCommand": status_command}))
    if result.stdout:
        print(result.stdout, end="")
    if result.stderr:
        print(result.stderr, end="", file=sys.stderr)
    return result.returncode


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except UsageError as error:
        print(f"[ERROR] {error}", file=sys.stderr)
        raise SystemExit(2)
    except Exception as error:
        print(f"[ERROR] {error}", file=sys.stderr)
        raise SystemExit(1)
