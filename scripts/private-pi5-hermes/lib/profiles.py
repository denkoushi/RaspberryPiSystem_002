#!/usr/bin/env python3
"""Built-in Hermes profile specifications."""

from __future__ import annotations

from .profile_spec import HermesProfileSpec

CHAT_PROFILE = HermesProfileSpec(
    name="chat",
    data_dir_name="hermes",
    systemd_unit="hermes-gateway",
    discord_enabled=True,
    tools_enabled=False,
    enabled_toolsets=frozenset(),
    expected_gateway_active=True,
)

TOOLS_PROFILE_D1 = HermesProfileSpec(
    name="tools",
    data_dir_name="hermes-tools",
    systemd_unit="hermes-tools-gateway",
    discord_enabled=False,
    tools_enabled=False,
    enabled_toolsets=frozenset(),
    expected_gateway_active=False,
)

TOOLS_PROFILE_D2 = HermesProfileSpec(
    name="tools",
    data_dir_name="hermes-tools",
    systemd_unit="hermes-tools-gateway",
    discord_enabled=False,
    tools_enabled=True,
    enabled_toolsets=frozenset({"file"}),
    expected_gateway_active=True,
)

TOOLS_PROFILE_D3 = HermesProfileSpec(
    name="tools",
    data_dir_name="hermes-tools",
    systemd_unit="hermes-tools-gateway",
    discord_enabled=False,
    tools_enabled=True,
    enabled_toolsets=frozenset({"file", "web"}),
    expected_gateway_active=True,
)

TOOLS_PROFILE_D4 = HermesProfileSpec(
    name="tools",
    data_dir_name="hermes-tools",
    systemd_unit="hermes-tools-gateway",
    discord_enabled=False,
    tools_enabled=True,
    enabled_toolsets=frozenset({"file", "web", "browser"}),
    expected_gateway_active=True,
)

# Default tools metadata alias (latest skeleton without file tools).
TOOLS_PROFILE = TOOLS_PROFILE_D1

PROFILES_BY_NAME: dict[str, HermesProfileSpec] = {
    CHAT_PROFILE.name: CHAT_PROFILE,
    TOOLS_PROFILE.name: TOOLS_PROFILE,
    "tools-d2": TOOLS_PROFILE_D2,
    "tools-d3": TOOLS_PROFILE_D3,
    "tools-d4": TOOLS_PROFILE_D4,
}
