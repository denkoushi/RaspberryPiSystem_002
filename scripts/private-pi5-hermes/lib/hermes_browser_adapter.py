#!/usr/bin/env python3
"""Map boundary policy to Hermes browser config and environment (Phase D4)."""

from __future__ import annotations

from .boundary_policy import BoundaryPolicy

# Cloud browser providers are out of scope for private Pi5 tools profile (D4).
FORBIDDEN_CLOUD_BROWSER_ENV_KEYS: tuple[str, ...] = (
    "BROWSERBASE_API_KEY",
    "BROWSERBASE_PROJECT_ID",
    "BROWSER_USE_API_KEY",
    "FIRECRAWL_API_KEY",
    "CAMOFOX_URL",
)

DEFAULT_AGENT_BROWSER_ARGS = "--no-sandbox,--disable-dev-shm-usage"


def browser_config_document(*, auto_local_for_private_urls: bool = True) -> dict[str, object]:
    """Hermes config fragment: browser (local agent-browser only)."""
    return {
        "auto_local_for_private_urls": auto_local_for_private_urls,
        "inactivity_timeout": 120,
        "command_timeout": 30,
        "record_sessions": False,
    }


def normalize_agent_browser_args(raw: str | None) -> str:
    """Return comma-separated Chromium flags for AGENT_BROWSER_ARGS."""
    if raw is None:
        return DEFAULT_AGENT_BROWSER_ARGS
    stripped = raw.strip()
    return stripped if stripped else DEFAULT_AGENT_BROWSER_ARGS


def browser_env_document(agent_browser_args: str | None = None) -> dict[str, str]:
    """Environment variables for tools profile .env (browser local mode)."""
    return {
        "AGENT_BROWSER_ARGS": normalize_agent_browser_args(agent_browser_args),
    }


def hermes_browser_emission(
    policy: BoundaryPolicy,
    *,
    agent_browser_args: str | None = None,
) -> dict[str, object]:
    """JSON payload for validate_boundary_policy.py --emit-browser-env."""
    _ = policy  # reserved for future URL-specific browser policy
    return {
        "browser_config": browser_config_document(),
        "browser_env": browser_env_document(agent_browser_args),
        "forbidden_cloud_browser_env_keys": list(FORBIDDEN_CLOUD_BROWSER_ENV_KEYS),
        "default_agent_browser_args": DEFAULT_AGENT_BROWSER_ARGS,
    }


def env_lines_for_tools_profile(agent_browser_args: str | None = None) -> list[str]:
    """Lines to append or merge into tools .env (KEY=value, no export)."""
    doc = browser_env_document(agent_browser_args)
    return [f"{key}={value}" for key, value in doc.items()]


def find_forbidden_cloud_browser_keys(env_text: str) -> list[str]:
    """Return cloud browser env keys present in .env content."""
    found: list[str] = []
    for key in FORBIDDEN_CLOUD_BROWSER_ENV_KEYS:
        for line in env_text.splitlines():
            stripped = line.strip()
            if stripped.startswith("#"):
                continue
            if stripped.startswith(f"{key}="):
                found.append(key)
                break
    return found
