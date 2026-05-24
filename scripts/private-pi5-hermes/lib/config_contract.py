#!/usr/bin/env python3
"""Align Hermes tools config with boundary-policy.tools.yaml."""

from __future__ import annotations

import re

from .boundary_policy import BoundaryPolicy
from .hermes_security_adapter import (
    expected_llm_base_url_from_policy,
    hermes_security_blocklist_document,
    website_blocklist_domains_from_policy,
)

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


def _iter_disabled_toolsets(config_text: str) -> list[str]:
    lines = config_text.splitlines()
    in_disabled = False
    toolsets: list[str] = []
    for line in lines:
        stripped = line.strip()
        if stripped.startswith("disabled_toolsets:"):
            in_disabled = True
            continue
        if in_disabled:
            if stripped.startswith("- "):
                toolsets.append(stripped[2:].strip())
                continue
            if stripped and not stripped.startswith("#"):
                in_disabled = False
    return toolsets


def config_disables_toolset(config_text: str, toolset: str) -> bool:
    return toolset in _iter_disabled_toolsets(config_text)


def config_disables_file_toolset(config_text: str) -> bool:
    """True when agent.disabled_toolsets lists file (D1 skeleton)."""
    return config_disables_toolset(config_text, "file")


def config_disables_web_toolset(config_text: str) -> bool:
    return config_disables_toolset(config_text, "web")


def config_declares_file_toolset_enabled(config_text: str) -> bool:
    return not config_disables_file_toolset(config_text)


def config_declares_web_toolset_enabled(config_text: str) -> bool:
    return not config_disables_web_toolset(config_text)


def config_declares_workspace_mount(config_text: str, expected_mount: str) -> bool:
    return expected_mount in config_text


def config_declares_website_blocklist_enabled(config_text: str) -> bool:
    return bool(
        re.search(
            r"website_blocklist:\s*\n(?:\s+.+\n)*?\s+enabled:\s*true",
            config_text,
            re.MULTILINE,
        )
    )


def config_has_single_security_block(config_text: str) -> bool:
    return len(re.findall(r"^security:\s*$", config_text, re.MULTILINE)) == 1


def config_contains_blocklist_domains(
    config_text: str, expected_domains: tuple[str, ...]
) -> bool:
    return all(domain in config_text for domain in expected_domains)


def config_declares_llm_base_url(config_text: str, expected_base_url: str) -> bool:
    """Match model/custom_providers base_url host against allowed DGX prefix."""
    needle = expected_base_url.rstrip("/")
    return needle in config_text


def validate_tools_config_alignment(
    config_text: str,
    policy: BoundaryPolicy,
    *,
    file_toolset_enabled: bool,
    web_toolset_enabled: bool = False,
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
            errors.append("file must not appear under agent.disabled_toolsets when file is enabled")
    else:
        if not config_disables_file_toolset(config_text):
            errors.append("file must be listed under agent.disabled_toolsets for D1 skeleton")
        for mount in mounts:
            if config_declares_workspace_mount(config_text, mount):
                errors.append(
                    f"unexpected workspace docker mount while file is disabled: {mount!r}"
                )

    if web_toolset_enabled:
        if not file_toolset_enabled:
            errors.append("web toolset requires file toolset (Phase D3 ladder)")
        if config_disables_web_toolset(config_text):
            errors.append("web must not appear under agent.disabled_toolsets when web is enabled")
        if not config_has_single_security_block(config_text):
            errors.append("config must contain exactly one security block when web is enabled")
        if not config_declares_website_blocklist_enabled(config_text):
            errors.append("security.website_blocklist.enabled must be true when web is enabled")
        expected_domains = website_blocklist_domains_from_policy(policy)
        if not config_contains_blocklist_domains(config_text, expected_domains):
            missing = [d for d in expected_domains if d not in config_text]
            errors.append(f"website_blocklist missing domains: {missing!r}")
        try:
            expected_base = expected_llm_base_url_from_policy(policy)
        except ValueError as exc:
            errors.append(str(exc))
        else:
            if not config_declares_llm_base_url(config_text, expected_base):
                errors.append(
                    f"config must reference allowed LLM base URL {expected_base!r} when web is enabled"
                )
        blocklist_doc = hermes_security_blocklist_document(policy)
        if blocklist_doc.get("enabled") is not True:
            errors.append("hermes_security_blocklist_document must have enabled: true")
    else:
        if not config_disables_web_toolset(config_text):
            errors.append("web must be listed under agent.disabled_toolsets when web is disabled")

    return errors
