#!/usr/bin/env python3
"""
Read-only Home Assistant context client for stackchan-bridge.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Any
from urllib.request import Request, urlopen


@dataclass(frozen=True)
class HomeAssistantConfig:
    enabled: bool = False
    base_url: str = ""
    token: str = ""
    entity_ids: tuple[str, ...] = ()
    timeout_sec: float = 5.0


def _env_bool(value: str | None, default: bool = False) -> bool:
    if value is None:
        return default
    normalized = value.strip().lower()
    if normalized == "":
        return default
    return normalized in {"1", "true", "yes", "on"}


def _env_entity_ids(value: str | None) -> tuple[str, ...]:
    if not value:
        return ()
    return tuple(part.strip() for part in value.split(",") if part.strip())


class HomeAssistantClient:
    def __init__(self, config: HomeAssistantConfig) -> None:
        self._c = config

    @property
    def enabled(self) -> bool:
        return self._c.enabled and self._c.base_url != "" and self._c.token != "" and len(self._c.entity_ids) > 0

    def snapshot_lines(self) -> list[str]:
        if not self.enabled:
            return []
        lines: list[str] = []
        for entity_id in self._c.entity_ids:
            state = self._get_state(entity_id)
            if state:
                lines.append(state)
        return lines

    def _get_state(self, entity_id: str) -> str | None:
        req = Request(
            url=f"{self._c.base_url.rstrip('/')}/api/states/{entity_id}",
            method="GET",
            headers={"Authorization": f"Bearer {self._c.token}", "Accept": "application/json"},
        )
        with urlopen(req, timeout=self._c.timeout_sec) as resp:
            parsed = json.loads(resp.read().decode("utf-8"))
        return format_home_assistant_state(parsed)


def format_home_assistant_state(payload: dict[str, Any]) -> str | None:
    entity_id = payload.get("entity_id")
    state = payload.get("state")
    if not isinstance(entity_id, str) or not isinstance(state, str):
        return None
    attributes = payload.get("attributes")
    friendly_name = None
    unit = None
    if isinstance(attributes, dict):
        raw_name = attributes.get("friendly_name")
        raw_unit = attributes.get("unit_of_measurement")
        friendly_name = raw_name if isinstance(raw_name, str) and raw_name else None
        unit = raw_unit if isinstance(raw_unit, str) and raw_unit else None
    label = friendly_name or entity_id
    suffix = unit or ""
    return f"{label} ({entity_id}): {state}{suffix}"


def config_from_env() -> HomeAssistantConfig:
    return HomeAssistantConfig(
        enabled=_env_bool(os.getenv("HOME_ASSISTANT_CONTEXT_ENABLED"), False),
        base_url=os.getenv("HOME_ASSISTANT_BASE_URL", ""),
        token=os.getenv("HOME_ASSISTANT_TOKEN", ""),
        entity_ids=_env_entity_ids(os.getenv("HOME_ASSISTANT_CONTEXT_ENTITIES")),
        timeout_sec=float(os.getenv("HOME_ASSISTANT_TIMEOUT_SEC", "5")),
    )
