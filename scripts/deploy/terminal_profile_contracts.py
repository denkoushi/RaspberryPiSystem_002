#!/usr/bin/env python3
"""Static CI contracts for registry-selected terminal deployments."""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any, Iterable

try:
    from terminal_profile_registry import (
        DEFAULT_REGISTRY_PATH,
        TerminalProfile,
        TerminalProfileRegistry,
        load_registry,
    )
    from rolling_release.adapter_registry import adapter_for_profile
    from rolling_release.policy import release_hosts
except ImportError:  # Repository-root package imports used by contract tests.
    from scripts.deploy.terminal_profile_registry import (
        DEFAULT_REGISTRY_PATH,
        TerminalProfile,
        TerminalProfileRegistry,
        load_registry,
    )
    from scripts.deploy.rolling_release.adapter_registry import adapter_for_profile
    from scripts.deploy.rolling_release.policy import release_hosts


PROJECT_ROOT = Path(__file__).resolve().parents[2]
CORE_MODULES = (
    "scripts/deploy/rolling_release/coordinator.py",
    "scripts/deploy/rolling_release/fleet_state.py",
    "scripts/deploy/rolling_release/planner.py",
    "scripts/deploy/rolling_release/policy.py",
)
REQUIRED_ADAPTER_OPERATIONS = (
    "prepare_repository",
    "capture_manifest",
    "should_issue_notice",
    "deliver_notice",
    "enter_maintenance",
    "prestage_maintenance",
    "apply",
    "expected_ready_sha",
    "prove_ready",
    "observe",
    "rollback",
    "preflight_rollback",
    "clear_maintenance",
    "finalize_after_maintenance",
    "cleanup",
)
_PLAY_START_RE = re.compile(r"^- name:\s*(.+?)\s*$")
_PLAY_HOSTS_RE = re.compile(r"^\s{2}hosts:\s*(.+?)\s*$")
_PLAY_SERIAL_RE = re.compile(r"^\s{2}serial:\s*(.+?)\s*$")


class TerminalProfileContractError(ValueError):
    """Raised when a registry-selected deployment asset is unsafe."""


def registry_playbooks(registry: TerminalProfileRegistry) -> tuple[str, ...]:
    """Return registry playbooks once, preserving profile rollout order."""

    return tuple(dict.fromkeys(profile.playbook for profile in registry.profiles))


def _unquote(value: str) -> str:
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
        return value[1:-1]
    return value


def _play_blocks(text: str) -> list[tuple[str, str, str | None, str]]:
    """Extract top-level play name, hosts, serial and text without YAML deps."""

    lines = text.splitlines()
    starts = [index for index, line in enumerate(lines) if _PLAY_START_RE.fullmatch(line)]
    result: list[tuple[str, str, str | None, str]] = []
    for position, start in enumerate(starts):
        end = starts[position + 1] if position + 1 < len(starts) else len(lines)
        block_lines = lines[start:end]
        name_match = _PLAY_START_RE.fullmatch(block_lines[0])
        hosts = None
        serial = None
        for line in block_lines[1:]:
            hosts_match = _PLAY_HOSTS_RE.fullmatch(line)
            if hosts_match is not None:
                hosts = _unquote(hosts_match.group(1))
            serial_match = _PLAY_SERIAL_RE.fullmatch(line)
            if serial_match is not None:
                serial = _unquote(serial_match.group(1))
        if hosts is not None and name_match is not None:
            result.append((name_match.group(1), hosts, serial, "\n".join(block_lines)))
    return result


def _profile_play(
    profile: TerminalProfile,
    *,
    repository_root: Path,
) -> tuple[str, str, str | None, str]:
    playbook_path = repository_root / "infrastructure/ansible" / profile.playbook
    try:
        text = playbook_path.read_text(encoding="utf-8")
    except OSError as error:
        raise TerminalProfileContractError(
            f"terminal profile {profile.id} playbook is unreadable"
        ) from error
    accepted_hosts = {profile.inventory_group, "clients", "all"}
    matches = [play for play in _play_blocks(text) if play[1] in accepted_hosts]
    if len(matches) != 1:
        raise TerminalProfileContractError(
            f"terminal profile {profile.id} playbook must have exactly one "
            "matching terminal play"
        )
    return matches[0]


def validate_profile_assets(
    registry: TerminalProfileRegistry,
    *,
    repository_root: Path = PROJECT_ROOT,
) -> None:
    """Validate every adapter and its selected serial guarded playbook."""

    for profile in registry.profiles:
        adapter = adapter_for_profile(profile.id, runtime=None, profile=profile)
        missing = [
            operation
            for operation in REQUIRED_ADAPTER_OPERATIONS
            if not callable(getattr(adapter, operation, None))
        ]
        if missing:
            raise TerminalProfileContractError(
                f"terminal profile {profile.id} adapter is missing operations: "
                + ", ".join(missing)
            )
        _name, _hosts, serial, play = _profile_play(
            profile, repository_root=repository_root
        )
        if serial != "1":
            raise TerminalProfileContractError(
                f"terminal profile {profile.id} play must declare serial: 1"
            )
        if "../tasks/assert-release-orchestration.yml" not in play:
            raise TerminalProfileContractError(
                f"terminal profile {profile.id} play lacks orchestration guard"
            )
        if "../tasks/assert-terminal-release-mode.yml" not in play:
            raise TerminalProfileContractError(
                f"terminal profile {profile.id} play lacks release-only guard"
            )
        if "rollback-configs.yml" in play or "backup_timestamp" in play:
            raise TerminalProfileContractError(
                f"terminal profile {profile.id} play owns forbidden rollback state"
            )

    coordinator = (
        repository_root / "scripts/deploy/rolling_release/coordinator.py"
    ).read_text(encoding="utf-8")
    if "adapter.rollback(" not in coordinator:
        raise TerminalProfileContractError(
            "terminal exact rollback is not owned by the coordinator adapter boundary"
        )


def validate_core_independence(
    registry: TerminalProfileRegistry,
    *,
    repository_root: Path = PROJECT_ROOT,
) -> None:
    """Reject production profile names in planner/policy/state/coordinator."""

    for module in CORE_MODULES:
        text = (repository_root / module).read_text(encoding="utf-8")
        for profile_id in registry.profile_ids:
            pattern = re.compile(
                rf"(?<![a-z0-9-]){re.escape(profile_id)}(?![a-z0-9-])",
                re.IGNORECASE,
            )
            if pattern.search(text) is not None:
                raise TerminalProfileContractError(
                    f"core module {module} contains terminal profile name {profile_id}"
                )


def validate_inventory_contracts(
    registry: TerminalProfileRegistry,
    inventories: Iterable[tuple[str, dict[str, Any]]],
) -> None:
    """Validate topology and ensure every production profile is inventoried."""

    present_profiles: set[str] = set()
    inventory_count = 0
    for name, inventory in inventories:
        inventory_count += 1
        try:
            hosts = release_hosts(inventory, registry=registry)
        except (RuntimeError, ValueError) as error:
            raise TerminalProfileContractError(
                f"terminal profile inventory contract failed for {name}: {error}"
            ) from error
        present_profiles.update(
            host["role"] for host in hosts if host.get("role") != "server"
        )
    if inventory_count == 0:
        raise TerminalProfileContractError("at least one inventory JSON is required")
    missing = [
        profile.id for profile in registry.profiles if profile.id not in present_profiles
    ]
    if missing:
        raise TerminalProfileContractError(
            "terminal profiles are absent from all validated inventories: "
            + ", ".join(missing)
        )


def _load_inventory(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise TerminalProfileContractError(
            f"inventory JSON is unreadable: {path.name}"
        ) from error
    if not isinstance(value, dict):
        raise TerminalProfileContractError(
            f"inventory JSON root must be an object: {path.name}"
        )
    return value


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Validate registry-driven terminal deployment contracts."
    )
    parser.add_argument("--registry", default=str(DEFAULT_REGISTRY_PATH))
    parser.add_argument("--repository-root", default=str(PROJECT_ROOT))
    parser.add_argument("--inventory-json", action="append", default=[])
    parser.add_argument("--list-playbooks", action="store_true")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    repository_root = Path(args.repository_root).resolve()
    registry = load_registry(
        Path(args.registry).resolve(), repository_root=repository_root
    )
    if args.list_playbooks:
        for playbook in registry_playbooks(registry):
            print(playbook)
        return 0
    validate_profile_assets(registry, repository_root=repository_root)
    validate_core_independence(registry, repository_root=repository_root)
    inventories = [
        (Path(path).name, _load_inventory(Path(path)))
        for path in args.inventory_json
    ]
    validate_inventory_contracts(registry, inventories)
    print(
        "terminal profile contracts passed: "
        f"{len(registry.profiles)} profiles, "
        f"{len(registry_playbooks(registry))} playbooks, "
        f"{len(inventories)} inventories"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
