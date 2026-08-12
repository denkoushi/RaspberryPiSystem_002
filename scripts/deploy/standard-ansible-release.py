#!/usr/bin/env python3
"""Thin canonical launcher for the standard Ansible release playbook."""
from __future__ import annotations

import argparse
import json
import os
import re
import secrets
import shlex
import socket
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Sequence

from release_artifact_contract import parse_release_set, validate_release_set
from release_build_contract import build_config_hash, parse_contract_json


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
PROFILES = ("pi5", "pi4", "pi3")
PROFILE_GROUP = {"pi5": "server", "pi4": "kiosk", "pi3": "signage"}
OPTIONAL_HOST_CONNECT_TIMEOUT_SECONDS = 3.0
SAFE_INVENTORY_HOST = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,252}$")
RETIRED = {
    "--approve", "--cancel", "--preflight-only", "--release-scope",
    "--signage-oci-digest", "--signage-source-sha",
    "--signage-artifact-sha256", "--signage-manifest-sha256",
    "--signage-payload-digest", "--readiness-admission-json",
}


class UsageError(RuntimeError):
    pass


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
        if any((args.branch, args.limit, args.full_fleet, args.print_plan, args.detach, args.execute_standard_route)):
            raise UsageError("--status accepts only RUN_ID and optional --inventory")
        if not RUN_ID.fullmatch(args.status):
            raise UsageError("run ID must use YYYYMMDD-HHMMSS-<6 lowercase hex>")
        args.inventory = args.inventory or DEFAULT_INVENTORY
        return args
    if not args.branch or not args.inventory:
        raise UsageError("branch and inventory are required")
    if not SAFE_BRANCH.fullmatch(args.branch) or args.branch.endswith((".", "/")):
        raise UsageError("branch is not a safe Git branch name")
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


def optional_host_endpoint(document: dict[str, Any], host: str) -> tuple[str, int]:
    values = document.get("_meta", {}).get("hostvars", {}).get(host, {})
    address = values.get("ansible_host", host)
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


def image_plan(sha: str, profiles: tuple[str, ...], build_hash: str = "") -> dict[str, Any]:
    result: dict[str, Any] = {}
    if "pi5" in profiles:
        suffix = build_hash[:16]
        result["pi5"] = [f"ghcr.io/denkoushi/raspisys-api:{sha}-{suffix}", f"ghcr.io/denkoushi/raspisys-web:{sha}-{suffix}"]
    if "pi4" in profiles:
        result["pi4"] = [f"ghcr.io/denkoushi/raspisys-{name}-agent:{sha}" for name in ("nfc", "barcode", "torque")]
    if "pi3" in profiles:
        result["pi3"] = [f"ghcr.io/denkoushi/raspisys-pi3-signage:{sha}"]
    return result


def ansible_argv(inventory: str, limit: str, profiles: tuple[str, ...], variables: dict[str, str], listing: str = "") -> list[str]:
    command = ["ansible-playbook", "-i", inventory, str(PLAYBOOK), "--tags", ",".join(profiles), "--extra-vars", json.dumps(variables, sort_keys=True, separators=(",", ":"))]
    if limit:
        command.extend(["--limit", limit])
    if listing:
        command.append(listing)
    return command


def plan(args: argparse.Namespace, sha: str, inventory: Path, relative: str, selection: tuple[tuple[str, tuple[str, ...]], ...]) -> dict[str, Any]:
    profiles = tuple(item[0] for item in selection)
    build_hash = config_hash(sha, inventory) if "pi5" in profiles else ""
    images = image_plan(sha, profiles, build_hash)
    variables = {"release_sha": sha, "release_run_id": "plan-preview", "release_pi5_api_image": images.get("pi5", [f"unused:{sha}", f"unused-web:{sha}"])[0], "release_pi5_web_image": images.get("pi5", [f"unused:{sha}", f"unused-web:{sha}"])[1], "release_signage_artifact_sha256": "0" * 64}
    for listing in ("--list-hosts", "--list-tasks"):
        run(ansible_argv(str(inventory), args.limit, profiles, variables, listing), env=ansible_environment())
    return {"schemaVersion": 1, "branch": args.branch, "releaseSha": sha, "inventory": relative, "limit": args.limit or None, "fullFleet": args.full_fleet, "executionOrder": [{"profile": profile, "hosts": list(hosts), "images": images[profile]} for profile, hosts in selection]}


def new_run_id() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S-") + secrets.token_hex(3)


def unit_name(run_id: str) -> str:
    return f"{UNIT_PREFIX}{run_id}.service"


def ssh_argv(host: str, user: str, port: int, remote: Sequence[str]) -> list[str]:
    return ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "-p", str(port), f"{user}@{host}", shlex.join(remote)]


def remote_script(args: argparse.Namespace, sha: str, run_id: str, relative: str, profiles: tuple[str, ...]) -> str:
    internal = ["python3", "scripts/deploy/standard-ansible-release.py", "--execute-standard-route", "--branch", args.branch, "--inventory", relative, "--sha", sha, "--run-id", run_id, "--profiles", ",".join(profiles)]
    internal.extend(["--limit", args.limit] if args.limit else ["--full-fleet"])
    return "\n".join(("set -euo pipefail", f"cd {shlex.quote(str(REMOTE_ROOT))}", "mkdir -p logs/deploy", "exec 9>>logs/deploy/fleet-release-state.lock", "/usr/bin/flock -n 9 || { echo 'another fleet release is running' >&2; exit 75; }", "test -z \"$(git status --porcelain)\"", f"git fetch --no-tags origin {shlex.quote(args.branch)}", f"test \"$(git rev-parse FETCH_HEAD)\" = {shlex.quote(sha)}", f"git checkout --detach {shlex.quote(sha)}", f"test \"$(git rev-parse HEAD)\" = {shlex.quote(sha)}", "test -z \"$(git status --porcelain)\"", f"exec {shlex.join(internal)}"))


def systemd_argv(args: argparse.Namespace, sha: str, run_id: str, relative: str, profiles: tuple[str, ...], user: str) -> list[str]:
    command = ["/usr/bin/sudo", "-n", "/usr/bin/systemd-run", "--quiet", f"--unit={unit_name(run_id)}", f"--uid={user}", f"--setenv=HOME=/home/{user}", f"--setenv=USER={user}", f"--setenv=LOGNAME={user}", "--setenv=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", "--property=Type=exec", f"--property=WorkingDirectory={REMOTE_ROOT}", "--property=KillMode=control-group", "--property=Restart=no", "--property=UMask=0077", "--property=StandardOutput=journal", "--property=StandardError=journal"]
    if args.detach:
        command.append("--property=RemainAfterExit=yes")
    else:
        command.append("--wait")
    command.extend(["--", "/bin/bash", "-lc", remote_script(args, sha, run_id, relative, profiles)])
    return command


def release_set_images(sha: str, inventory: Path) -> tuple[str, str]:
    build_hash = config_hash(sha, inventory)
    reference = f"ghcr.io/denkoushi/raspisys-release-set:{sha}-{build_hash}"
    run(["docker", "image", "pull", reference])
    container = run(["docker", "create", reference, "/release-set.json"]).stdout.strip()
    try:
        with tempfile.TemporaryDirectory(prefix="standard-release-set-") as directory:
            path = Path(directory) / "release-set.json"
            run(["docker", "cp", f"{container}:/release-set.json", str(path)])
            release = parse_release_set(path.read_text(encoding="utf-8"))
            validate_release_set(release, "denkoushi/RaspberryPiSystem_002", sha, build_hash, ".github/workflows/ci.yml")
    finally:
        run(["docker", "rm", "-f", container], check=False)
    suffix = build_hash[:16]
    return (f"{release.api.repository}:{sha}-{suffix}@{release.api.digest}", f"{release.web.repository}:{sha}-{suffix}@{release.web.digest}")


def signage_identity(sha: str) -> tuple[str, str]:
    reference = f"ghcr.io/denkoushi/raspisys-pi3-signage:{sha}"
    run(["docker", "image", "pull", "--platform", "linux/arm/v7", reference])
    digest = run(["docker", "image", "inspect", "--format", '{{index .Config.Labels "io.raspisystem.signage.artifact-sha256"}}', reference]).stdout.strip()
    if not re.fullmatch(r"[0-9a-f]{64}", digest):
        raise RuntimeError("published Signage artifact has no valid final tar SHA-256")
    return reference, digest


def execute_standard_route(args: argparse.Namespace) -> int:
    inventory, relative = inventory_path(args.inventory)
    if run(["git", "rev-parse", "HEAD"]).stdout.strip() != args.sha:
        raise RuntimeError("remote checkout does not match the release SHA")
    declared_profiles = tuple(args.profiles.split(","))
    selected = inventory_document(inventory, args.limit) if args.limit else inventory_document(inventory)
    requested_selection = selected_profiles(selected)
    if tuple(profile for profile, _hosts in requested_selection) != declared_profiles:
        raise RuntimeError("remote target profiles differ from the sealed launch request")
    reachable_selection, excluded = preflight_optional_hosts(
        selected, requested_selection
    )
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
    api, web = release_set_images(args.sha, inventory) if "pi5" in profiles else (f"unused:{args.sha}", f"unused-web:{args.sha}")
    signage, signage_sha = signage_identity(args.sha) if "pi3" in profiles else (f"unused-signage:{args.sha}", "0" * 64)
    variables = {"release_sha": args.sha, "release_run_id": args.run_id, "release_pi5_api_image": api, "release_pi5_web_image": web, "release_signage_artifact_image": signage, "release_signage_artifact_sha256": signage_sha}
    command = ansible_argv(relative, effective_limit, profiles, variables)
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
    if args.print_plan:
        print(json.dumps(plan(args, sha, inventory, relative, selection), ensure_ascii=False, indent=2))
        return 0
    host, user, port = server_connection(complete)
    run_id = new_run_id()
    profiles = tuple(item[0] for item in selection)
    result = run(ssh_argv(host, user, port, systemd_argv(args, sha, run_id, relative, profiles, user)), check=False)
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
