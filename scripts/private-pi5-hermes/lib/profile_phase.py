#!/usr/bin/env python3
"""Tools profile rollout phases for private Pi5 Hermes deployment."""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from .profile_spec import HermesProfileSpec


class ProfilePhase(str, Enum):
    """Hermes tools profile maturity on private Pi5."""

    D1_SKELETON = "d1"
    D2_FILE_ONLY = "d2"
    D3_FILE_WEB = "d3"

    @classmethod
    def from_tools_flags(
        cls,
        *,
        tools_profile_enabled: bool,
        tools_file_enabled: bool,
        tools_web_enabled: bool = False,
    ) -> ProfilePhase | None:
        if not tools_profile_enabled:
            return None
        if tools_web_enabled:
            return cls.D3_FILE_WEB
        if tools_file_enabled:
            return cls.D2_FILE_ONLY
        return cls.D1_SKELETON


@dataclass(frozen=True)
class ToolsPhaseExpectation:
    """Expected tools profile state for a rollout phase."""

    phase: ProfilePhase
    profile: HermesProfileSpec
    require_tools_gateway_active: bool
    require_workspace_docker_mount: bool
    config_must_disable_file_toolset: bool
    config_must_disable_web_toolset: bool
    require_website_blocklist: bool

    @property
    def hermes_tools_phase_env(self) -> str:
        return self.phase.value


def expectation_for_phase(phase: ProfilePhase) -> ToolsPhaseExpectation:
    if phase is ProfilePhase.D1_SKELETON:
        from .profiles import TOOLS_PROFILE_D1

        return ToolsPhaseExpectation(
            phase=phase,
            profile=TOOLS_PROFILE_D1,
            require_tools_gateway_active=False,
            require_workspace_docker_mount=False,
            config_must_disable_file_toolset=True,
            config_must_disable_web_toolset=True,
            require_website_blocklist=False,
        )
    if phase is ProfilePhase.D2_FILE_ONLY:
        from .profiles import TOOLS_PROFILE_D2

        return ToolsPhaseExpectation(
            phase=phase,
            profile=TOOLS_PROFILE_D2,
            require_tools_gateway_active=True,
            require_workspace_docker_mount=True,
            config_must_disable_file_toolset=False,
            config_must_disable_web_toolset=True,
            require_website_blocklist=False,
        )
    if phase is ProfilePhase.D3_FILE_WEB:
        from .profiles import TOOLS_PROFILE_D3

        return ToolsPhaseExpectation(
            phase=phase,
            profile=TOOLS_PROFILE_D3,
            require_tools_gateway_active=True,
            require_workspace_docker_mount=True,
            config_must_disable_file_toolset=False,
            config_must_disable_web_toolset=False,
            require_website_blocklist=True,
        )
    raise ValueError(f"unsupported phase: {phase!r}")
