#!/usr/bin/env python3
"""Align Hermes tools config with boundary-policy.tools.yaml."""

from __future__ import annotations

from .boundary_policy import BoundaryPolicy

WORKSPACE_CONTAINER_MOUNT = "/workspace"


def workspace_host_path_from_policy(policy: BoundaryPolicy) -> str:
    """Return the single allowed workspace host path (D2 contract)."""
    prefixes = policy.allowed_fs_prefixes
    if len(prefixes) != 1:
        raise ValueError(
            f"D2 expects exactly one allowed_fs_prefixes entry, got {len(prefixes)}"
        )
    return prefixes[0].rstrip("/")


def docker_volume_mount(host_workspace: str) -> str:
    """Hermes terminal.docker_volumes entry binding workspace to /workspace."""
    host = host_workspace.rstrip("/")
    return f"{host}:{WORKSPACE_CONTAINER_MOUNT}"


def workspace_mounts_from_policy(policy: BoundaryPolicy) -> tuple[str, ...]:
    return (docker_volume_mount(workspace_host_path_from_policy(policy)),)


def config_declares_workspace_mount(config_text: str, expected_mount: str) -> bool:
    return expected_mount in config_text


def config_declares_file_toolset_enabled(config_text: str) -> bool:
    return not config_disables_file_toolset(config_text)


def config_disables_file_toolset(config_text: str) -> bool:
    """True when agent.disabled_toolsets lists file (D1 skeleton)."""
    lines = config_text.splitlines()
    in_disabled = False
    for line in lines:
        stripped = line.strip()
        if stripped.startswith("disabled_toolsets:"):
            in_disabled = True
            continue
        if in_disabled:
            if stripped.startswith("- "):
                if stripped == "- file":
                    return True
                continue
            if stripped and not stripped.startswith("#"):
                in_disabled = False
    return False


def validate_tools_config_alignment(
    config_text: str,
    policy: BoundaryPolicy,
    *,
    file_toolset_enabled: bool,
) -> list[str]:
    """Return human-readable errors; empty means aligned."""
    errors: list[str] = []
    try:
        mounts = workspace_mounts_from_policy(policy)
    except ValueError as exc:
        return [str(exc)]

    if file_toolset_enabled:
        for mount in mounts:
            if not config_declares_workspace_mount(config_text, mount):
                errors.append(f"missing terminal.docker_volumes mount: {mount!r}")
        if config_disables_file_toolset(config_text):
            errors.append("file must not appear under agent.disabled_toolsets when D2 is enabled")
    else:
        if not config_disables_file_toolset(config_text):
            errors.append("file must be listed under agent.disabled_toolsets for D1 skeleton")
        for mount in mounts:
            if config_declares_workspace_mount(config_text, mount):
                errors.append(
                    f"unexpected workspace docker mount while file is disabled: {mount!r}"
                )
    return errors
