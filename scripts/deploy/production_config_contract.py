#!/usr/bin/env python3
"""Typed, non-secret production Web configuration contract.

This module is deliberately pure.  It describes which Vite values are compiled
into the shared production image and which values are generated or resolved on
the kiosk.  Docker, Ansible, GitHub, and filesystem adapters must derive their
allow-lists from these records instead of maintaining another list.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from enum import Enum
from typing import Iterable, Mapping


VITE_KEY_RE = re.compile(r"^VITE_[A-Z0-9_]+$")
SECRET_KEY_RE = re.compile(
    r"(?:SECRET|TOKEN|PASSWORD|PRIVATE|CREDENTIAL|API_KEY)", re.IGNORECASE
)
MAX_VALUE_BYTES = 4096


class ProductionConfigError(ValueError):
    """A production configuration declaration is incomplete or unsafe."""


class ConfigKind(str, Enum):
    IMAGE = "image"
    GENERATED = "generated"
    TERMINAL_RUNTIME = "terminal-runtime"
    DEVELOPMENT = "development"


class ValueKind(str, Enum):
    STRING = "string"
    BOOLEAN = "boolean"
    POSITIVE_INTEGER = "positive-integer"
    URL = "url"


@dataclass(frozen=True)
class ProductionWebSetting:
    key: str
    kind: ConfigKind
    value_kind: ValueKind
    production_default: str | None
    ansible_variable: str | None
    reason: str


def _image(
    key: str,
    value_kind: ValueKind,
    default: str,
    ansible_variable: str,
    reason: str,
) -> ProductionWebSetting:
    return ProductionWebSetting(
        key, ConfigKind.IMAGE, value_kind, default, ansible_variable, reason
    )


PRODUCTION_WEB_SETTINGS = (
    _image(
        "VITE_AGENT_WS_MODE",
        ValueKind.STRING,
        "local",
        "web_agent_ws_mode",
        "Kiosks use only their own loopback NFC Agent.",
    ),
    _image(
        "VITE_AGENT_WS_URL",
        ValueKind.URL,
        "ws://localhost:7071/stream",
        "web_agent_ws_url",
        "NFC stream endpoint used by the typed runtime contract.",
    ),
    _image(
        "VITE_API_BASE_URL",
        ValueKind.STRING,
        "/api",
        "web_api_base_url",
        "Browser API requests use the same-origin API proxy.",
    ),
    _image(
        "VITE_API_TIMEOUT_MS",
        ValueKind.POSITIVE_INTEGER,
        "120000",
        "web_api_timeout_ms",
        "API client timeout is explicit and immutable.",
    ),
    _image(
        "VITE_BARCODE_AGENT_WS_URL",
        ValueKind.URL,
        "ws://localhost:7072/stream",
        "web_barcode_agent_ws_url",
        "Barcode input is terminal-local.",
    ),
    ProductionWebSetting(
        "VITE_DEFAULT_CLIENT_KEY",
        ConfigKind.TERMINAL_RUNTIME,
        ValueKind.STRING,
        None,
        None,
        "The shared image resolves the terminal key from inventory URL/localStorage.",
    ),
    _image(
        "VITE_ENABLE_DEBUG_LOGS",
        ValueKind.BOOLEAN,
        "false",
        "web_enable_debug_logs",
        "Production must not log NFC identifiers or debug payloads.",
    ),
    _image(
        "VITE_KIOSK_DUE_MGMT_LAYOUT_V2_ENABLED",
        ValueKind.BOOLEAN,
        "true",
        "web_kiosk_due_mgmt_layout_v2_enabled",
        "Production due-management layout selection.",
    ),
    _image(
        "VITE_KIOSK_LEADERBOARD_BOARD_CLIENT_PERF_LOG",
        ValueKind.BOOLEAN,
        "false",
        "web_kiosk_leaderboard_board_client_perf_log",
        "Performance diagnostics are disabled in production.",
    ),
    _image(
        "VITE_KIOSK_LEADERBOARD_CACHE_WRITE_ON_MUTATION",
        ValueKind.BOOLEAN,
        "true",
        "web_kiosk_leaderboard_cache_write_on_mutation",
        "Leaderboard mutation mirror rollback switch.",
    ),
    _image(
        "VITE_KIOSK_LEADERBOARD_DEFER_RESIDUAL_SUMMARY_ENABLED",
        ValueKind.BOOLEAN,
        "false",
        "web_kiosk_leaderboard_defer_residual_summary_enabled",
        "Residual-summary staged rollout remains explicitly disabled.",
    ),
    _image(
        "VITE_KIOSK_LEADERBOARD_SEIBAN_OR_CLIENT_FILTER",
        ValueKind.BOOLEAN,
        "true",
        "web_kiosk_leaderboard_seiban_or_client_filter",
        "Leaderboard client filter rollback switch.",
    ),
    _image(
        "VITE_KIOSK_LEADERBOARD_TERMINAL_CACHE_ENABLED",
        ValueKind.BOOLEAN,
        "true",
        "web_kiosk_leaderboard_terminal_cache_enabled",
        "Leaderboard terminal cache rollback switch.",
    ),
    _image(
        "VITE_KIOSK_LEADERBOARD_TERMINAL_CACHE_PHASE2_SWR",
        ValueKind.BOOLEAN,
        "true",
        "web_kiosk_leaderboard_terminal_cache_phase2_swr",
        "Leaderboard stale-while-revalidate rollback switch.",
    ),
    _image(
        "VITE_KIOSK_MANUAL_ORDER_DEVICE_SCOPE_V2_ENABLED",
        ValueKind.BOOLEAN,
        "true",
        "web_kiosk_manual_order_device_scope_v2_enabled",
        "Manual-order terminal scope rollback switch.",
    ),
    _image(
        "VITE_KIOSK_PRODUCTION_SCHEDULE_ORDER_SPLIT_ENABLED",
        ValueKind.BOOLEAN,
        "false",
        "web_kiosk_production_schedule_order_split_enabled",
        "Production-order splitting remains explicitly disabled.",
    ),
    _image(
        "VITE_KIOSK_SOP_POPUP_ENABLED",
        ValueKind.BOOLEAN,
        "true",
        "web_kiosk_sop_popup_enabled",
        "Inspection SOP popup production switch.",
    ),
    _image(
        "VITE_KIOSK_TARGET_LOCATION_SELECTOR_ENABLED",
        ValueKind.BOOLEAN,
        "true",
        "web_kiosk_target_location_selector_enabled",
        "Kiosk target-location selector production switch.",
    ),
    ProductionWebSetting(
        "VITE_RELEASE_SHA",
        ConfigKind.GENERATED,
        ValueKind.STRING,
        None,
        "release_build_contract_sha",
        "Exact main SHA generated by the release workflow.",
    ),
    _image(
        "VITE_WS_BASE_URL",
        ValueKind.STRING,
        "/ws",
        "web_ws_base_url",
        "Browser application WebSocket proxy base.",
    ),
)


def _validate_registry(
    settings: Iterable[ProductionWebSetting],
) -> tuple[ProductionWebSetting, ...]:
    normalized = tuple(settings)
    seen: set[str] = set()
    for setting in normalized:
        if not VITE_KEY_RE.fullmatch(setting.key):
            raise ProductionConfigError(f"invalid Vite setting name: {setting.key}")
        if setting.key in seen:
            raise ProductionConfigError(f"duplicate Vite setting: {setting.key}")
        if SECRET_KEY_RE.search(setting.key):
            raise ProductionConfigError(
                f"secret-like key cannot enter the Web build contract: {setting.key}"
            )
        seen.add(setting.key)
        if setting.kind is ConfigKind.IMAGE:
            if setting.production_default is None or setting.ansible_variable is None:
                raise ProductionConfigError(
                    f"image setting lacks an explicit source/default: {setting.key}"
                )
            validate_value(setting, setting.production_default)
        elif setting.kind is ConfigKind.GENERATED:
            if setting.ansible_variable is None or setting.production_default is not None:
                raise ProductionConfigError(
                    f"generated setting is malformed: {setting.key}"
                )
        elif setting.production_default is not None or setting.ansible_variable is not None:
            raise ProductionConfigError(
                f"runtime setting must not be embedded in the shared image: {setting.key}"
            )
    return normalized


def validate_value(setting: ProductionWebSetting, value: object) -> str:
    if (
        not isinstance(value, str)
        or "\x00" in value
        or "\r" in value
        or "\n" in value
        or len(value.encode("utf-8")) > MAX_VALUE_BYTES
    ):
        raise ProductionConfigError(f"{setting.key} must be a bounded single-line string")
    if setting.value_kind is ValueKind.BOOLEAN and value not in {"true", "false"}:
        raise ProductionConfigError(f"{setting.key} must be true or false")
    if setting.value_kind is ValueKind.POSITIVE_INTEGER:
        if not value.isdigit() or int(value) <= 0:
            raise ProductionConfigError(f"{setting.key} must be a positive integer")
    if setting.value_kind is ValueKind.URL:
        if not value.startswith(("ws://", "wss://", "http://", "https://")):
            raise ProductionConfigError(f"{setting.key} must be an absolute agent URL")
    return value


PRODUCTION_WEB_SETTINGS = _validate_registry(PRODUCTION_WEB_SETTINGS)
PRODUCTION_WEB_SETTING_BY_KEY = {
    setting.key: setting for setting in PRODUCTION_WEB_SETTINGS
}
ALL_VITE_KEYS = tuple(setting.key for setting in PRODUCTION_WEB_SETTINGS)
WEB_IMAGE_ARGUMENT_KEYS = tuple(
    setting.key
    for setting in PRODUCTION_WEB_SETTINGS
    if setting.kind in {ConfigKind.IMAGE, ConfigKind.GENERATED}
)
WEB_ANSIBLE_VARIABLES = tuple(
    setting.ansible_variable
    for setting in PRODUCTION_WEB_SETTINGS
    if setting.ansible_variable is not None
)
WEB_IMAGE_DEFAULTS = {
    setting.key: setting.production_default
    for setting in PRODUCTION_WEB_SETTINGS
    if setting.kind is ConfigKind.IMAGE
}


def render_typescript_image_defaults() -> str:
    """Render the checked-in browser defaults from the Python source of truth."""

    lines = [
        "/**",
        " * Generated from scripts/deploy/production_config_contract.py.",
        " * Do not edit this file directly; the CI audit rejects drift.",
        " */",
        "export const PRODUCTION_WEB_IMAGE_DEFAULTS = {",
    ]
    for key, value in WEB_IMAGE_DEFAULTS.items():
        lines.append(f"  {key}: {json.dumps(value, ensure_ascii=False)},")
    lines.extend(("} as const;", ""))
    return "\n".join(lines)


def validate_exact_keys(
    surface: str, actual: Iterable[str], expected: Iterable[str]
) -> None:
    actual_list = tuple(actual)
    if len(set(actual_list)) != len(actual_list):
        raise ProductionConfigError(f"{surface} contains duplicate Vite settings")
    missing = sorted(set(expected) - set(actual_list))
    unknown = sorted(set(actual_list) - set(expected))
    if missing or unknown:
        raise ProductionConfigError(
            f"{surface} differs from the production contract; "
            f"missing={missing}, unknown={unknown}"
        )


def validate_image_values(values: Mapping[str, object]) -> dict[str, str]:
    validate_exact_keys("Web image values", values, WEB_IMAGE_ARGUMENT_KEYS)
    result: dict[str, str] = {}
    for key in WEB_IMAGE_ARGUMENT_KEYS:
        setting = PRODUCTION_WEB_SETTING_BY_KEY[key]
        value = values[key]
        if setting.kind is ConfigKind.GENERATED:
            if not isinstance(value, str):
                raise ProductionConfigError(f"{key} must be a string")
            result[key] = value
        else:
            result[key] = validate_value(setting, value)
    return result
