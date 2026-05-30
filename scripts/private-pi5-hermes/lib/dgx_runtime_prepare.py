#!/usr/bin/env python3
"""Shared DGX runtime preparation for Hermes private Pi5 profiles."""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any


def load_dgx_runtime_client(keep_warm_dir: str | Path | None = None):
    """Load dgx_runtime_client from host keep-warm dir (Ansible) or dev fallbacks."""
    candidates: list[Path] = []
    if keep_warm_dir:
        candidates.append(Path(keep_warm_dir))
    candidates.extend(
        [
            Path(__file__).resolve().parent.parent / "dgx-keep-warm",
            Path(__file__).resolve().parent / "dgx-keep-warm",
        ]
    )
    for base in candidates:
        if not base.is_dir():
            continue
        path_str = str(base)
        if path_str not in sys.path:
            sys.path.insert(0, path_str)
        try:
            from dgx_runtime_client import DgxUpstreamClient, DgxUpstreamConfig  # noqa: WPS433

            return DgxUpstreamClient, DgxUpstreamConfig
        except ImportError:
            continue
    raise FileNotFoundError(
        "dgx_runtime_client.py not found (expected under ~/.hermes/dgx-keep-warm on host)"
    )


def parse_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.is_file():
        return values
    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        values[key.strip()] = value.strip()
    return values


def dgx_config_from_env_file(
    env_path: Path,
    *,
    keep_warm_dir: str | Path | None = None,
    default_model_profile_id: str = "",
) -> object:
    _, config_cls = load_dgx_runtime_client(keep_warm_dir)
    values = parse_env_file(env_path)
    auto = values.get("DGX_RUNTIME_AUTO_START", "true").lower() in {"1", "true", "yes", "on"}
    model_profile_id = values.get("DGX_MODEL_PROFILE_ID", default_model_profile_id).strip()
    return config_cls(
        base_url=values.get("DGX_BASE_URL", "http://100.118.82.72:38081").rstrip("/"),
        llm_shared_token=values.get("DGX_LLM_SHARED_TOKEN", values.get("OPENAI_API_KEY", "")),
        runtime_control_token=values.get("DGX_RUNTIME_CONTROL_TOKEN", ""),
        runtime_start_path=values.get("DGX_RUNTIME_START_PATH", "/start"),
        runtime_ready_path=values.get("DGX_RUNTIME_READY_PATH", "/v1/models"),
        upstream_timeout_sec=float(values.get("UPSTREAM_TIMEOUT_SEC", "45")),
        ready_timeout_sec=float(values.get("DGX_RUNTIME_READY_TIMEOUT_SEC", "600")),
        ready_poll_sec=float(values.get("DGX_RUNTIME_READY_POLL_SEC", "1")),
        auto_start=auto,
        model_profile_id=model_profile_id,
    )


def ensure_dgx_runtime_ready(
    env_path: Path,
    *,
    keep_warm_dir: str | Path | None = None,
    default_model_profile_id: str = "",
) -> tuple[bool, str]:
    """Ensure DGX runtime is ready; skips /start when target profile is already active."""
    if not env_path.is_file():
        return False, f"DGX runtime .env missing: {env_path}"

    try:
        client_cls, _ = load_dgx_runtime_client(keep_warm_dir)
        config = dgx_config_from_env_file(
            env_path,
            keep_warm_dir=keep_warm_dir,
            default_model_profile_id=default_model_profile_id,
        )
        client = client_cls(config)
        ok, details = client.warm_runtime()
    except (OSError, ValueError, ImportError) as exc:
        return False, f"DGX runtime prepare failed: {exc}"

    if ok:
        return True, ""
    message = str(details.get("message") or details)
    return False, f"DGX runtime not ready: {message}"


def verify_dgx_runtime_profile(
    env_path: Path,
    *,
    keep_warm_dir: str | Path | None = None,
    expected_model_profile_id: str,
) -> tuple[bool, str]:
    """Confirm /v1/models is ready and active profile matches before /task."""
    expected = (expected_model_profile_id or "").strip()
    if not expected:
        return False, "expected_model_profile_id is empty"

    try:
        client_cls, _ = load_dgx_runtime_client(keep_warm_dir)
        config = dgx_config_from_env_file(
            env_path,
            keep_warm_dir=keep_warm_dir,
            default_model_profile_id=expected,
        )
        client = client_cls(config)
    except (OSError, ValueError, ImportError) as exc:
        return False, f"DGX profile verify failed: {exc}"

    ready_ok, probe = client.probe_runtime_ready()
    if not ready_ok:
        return False, f"DGX /v1/models not ready: {probe}"

    active_ok, active = client.fetch_active_model_profile()
    if not active_ok:
        return False, f"DGX active profile probe failed: {active}"

    active_id = str(
        active.get("modelProfileId") or active.get("activeProfileId") or ""
    ).strip()
    if active_id != expected:
        return False, (
            f"DGX active profile mismatch: expected {expected} got {active_id or '(empty)'}"
        )
    return True, ""
