#!/usr/bin/env python3
"""Hermes profile metadata for private Pi5 deployment."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class HermesProfileSpec:
    """Declarative profile boundary (config paths, gateway, Discord)."""

    name: str
    data_dir_name: str
    systemd_unit: str
    discord_enabled: bool
    tools_enabled: bool
    workspace_subdir: str = "workspace"

    @property
    def home_relative_data_dir(self) -> str:
        return f".{self.data_dir_name}" if not self.data_dir_name.startswith(".") else self.data_dir_name
