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
)

TOOLS_PROFILE = HermesProfileSpec(
    name="tools",
    data_dir_name="hermes-tools",
    systemd_unit="hermes-tools-gateway",
    discord_enabled=False,
    tools_enabled=False,
)

PROFILES_BY_NAME: dict[str, HermesProfileSpec] = {
    CHAT_PROFILE.name: CHAT_PROFILE,
    TOOLS_PROFILE.name: TOOLS_PROFILE,
}
