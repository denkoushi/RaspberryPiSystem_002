#!/usr/bin/env python3
"""Run Hermes CLI against the isolated novel profile (subprocess adapter)."""

from __future__ import annotations

import os
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

try:
    from .novel_profile_constants import (
        DEFAULT_NOVEL_MAX_OUTPUT_CHARS,
        DEFAULT_NOVEL_RUNNER_TIMEOUT_SECONDS,
        NOVEL_MODEL_PROFILE_ID,
    )
except ImportError:
    from novel_profile_constants import (
        DEFAULT_NOVEL_MAX_OUTPUT_CHARS,
        DEFAULT_NOVEL_RUNNER_TIMEOUT_SECONDS,
        NOVEL_MODEL_PROFILE_ID,
    )


@dataclass(frozen=True)
class NovelProfilePaths:
    """Host paths for novel profile execution."""

    hermes_user: str
    hermes_home: str
    novel_data_dir: str
    novel_home: str
    novel_env_path: str
    hermes_bin: str
    dgx_keep_warm_dir: str

    @classmethod
    def default_pi5(cls, hermes_user: str = "hermes") -> NovelProfilePaths:
        home = f"/home/{hermes_user}"
        novel_data = f"{home}/.hermes-novel"
        chat_data = f"{home}/.hermes"
        return cls(
            hermes_user=hermes_user,
            hermes_home=home,
            novel_data_dir=novel_data,
            novel_home=f"{novel_data}/home",
            novel_env_path=f"{novel_data}/.env",
            hermes_bin=f"{home}/.local/bin/hermes",
            dgx_keep_warm_dir=f"{chat_data}/dgx-keep-warm",
        )


@dataclass
class NovelProfileRunResult:
    ok: bool
    exit_code: int
    output: str
    error_hint: str = ""


def _truncate_output(text: str, max_chars: int) -> str:
    if len(text) <= max_chars:
        return text
    return text[: max_chars - 40] + "\n\n...(truncated for Discord)..."


def _resolve_hermes_python(hermes_bin: Path, hermes_home: str | None = None) -> Path:
    if hermes_bin.is_file():
        text = hermes_bin.read_text(encoding="utf-8")
        first_line = text.splitlines()[:1]
        if first_line and first_line[0].startswith("#!"):
            interpreter = first_line[0][2:].strip()
            if "python" in interpreter:
                return Path(interpreter)
        match = re.search(r'exec\s+"([^"]+/venv/bin/hermes)"', text)
        if match:
            venv_python = Path(match.group(1)).parent / "python3"
            if venv_python.is_file():
                return venv_python
    if hermes_home:
        fallback = Path(hermes_home) / ".hermes/hermes-agent/venv/bin/python3"
        if fallback.is_file():
            return fallback
    return Path("/usr/bin/python3")


def _load_dgx_runtime_client(keep_warm_dir: str | Path | None = None):
    """Load dgx_runtime_client from host keep-warm dir (Ansible) or dev fallbacks."""
    candidates: list[Path] = []
    if keep_warm_dir:
        candidates.append(Path(keep_warm_dir))
    # Local dev / repo layout only — not used on Pi5 when keep_warm_dir is set.
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


def _parse_env_file(path: Path) -> dict[str, str]:
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


def _dgx_config_from_novel_env(
    env_path: Path, *, keep_warm_dir: str | Path | None = None
) -> object:
    _, config_cls = _load_dgx_runtime_client(keep_warm_dir)
    values = _parse_env_file(env_path)
    auto = values.get("DGX_RUNTIME_AUTO_START", "true").lower() in {"1", "true", "yes", "on"}
    model_profile_id = values.get("DGX_MODEL_PROFILE_ID", NOVEL_MODEL_PROFILE_ID).strip()
    return config_cls(
        base_url=values.get("DGX_BASE_URL", "http://100.118.82.72:38081").rstrip("/"),
        llm_shared_token=values.get("DGX_LLM_SHARED_TOKEN", values.get("OPENAI_API_KEY", "")),
        runtime_control_token=values.get("DGX_RUNTIME_CONTROL_TOKEN", ""),
        runtime_start_path=values.get("DGX_RUNTIME_START_PATH", "/start"),
        runtime_ready_path=values.get("DGX_RUNTIME_READY_PATH", "/v1/models"),
        upstream_timeout_sec=float(values.get("UPSTREAM_TIMEOUT_SEC", "45")),
        ready_timeout_sec=float(values.get("DGX_RUNTIME_READY_TIMEOUT_SEC", "900")),
        ready_poll_sec=float(values.get("DGX_RUNTIME_READY_POLL_SEC", "1")),
        auto_start=auto,
        model_profile_id=model_profile_id,
    )


def ensure_novel_dgx_runtime_ready(paths: NovelProfilePaths) -> tuple[bool, str]:
    """Start DGX with the novel model profile when cold."""
    env_path = Path(paths.novel_env_path)
    if not env_path.is_file():
        return False, f"novel .env missing: {env_path}"

    try:
        client_cls, _ = _load_dgx_runtime_client(paths.dgx_keep_warm_dir)
        config = _dgx_config_from_novel_env(
            env_path, keep_warm_dir=paths.dgx_keep_warm_dir
        )
        client = client_cls(config)
        ok, details = client.ensure_runtime_ready()
    except (OSError, ValueError, ImportError) as exc:
        return False, f"novel DGX runtime prepare failed: {exc}"

    if ok:
        return True, ""
    message = str(details.get("message") or details)
    return False, f"novel DGX runtime not ready: {message}"


def run_novel_profile_prompt(
    prompt: str,
    paths: NovelProfilePaths | None = None,
    *,
    hermes_bin: str | None = None,
    max_output_chars: int = DEFAULT_NOVEL_MAX_OUTPUT_CHARS,
    runner_timeout_seconds: int = DEFAULT_NOVEL_RUNNER_TIMEOUT_SECONDS,
) -> NovelProfileRunResult:
    """Invoke novel profile chat after optional DGX profile-scoped warm start."""
    resolved = paths or NovelProfilePaths.default_pi5()
    bin_path = Path(hermes_bin or resolved.hermes_bin)

    if not Path(resolved.novel_env_path).is_file():
        return NovelProfileRunResult(
            ok=False,
            exit_code=2,
            output="",
            error_hint=f"novel .env missing: {resolved.novel_env_path}",
        )

    ready_ok, ready_hint = ensure_novel_dgx_runtime_ready(resolved)
    if not ready_ok:
        return NovelProfileRunResult(
            ok=False,
            exit_code=3,
            output="",
            error_hint=ready_hint,
        )

    escaped_prompt = prompt.replace("'", "'\"'\"'")
    cmd = f"""
set -euo pipefail
export HOME='{resolved.novel_home}'
export PATH='{resolved.hermes_home}/.local/bin:/usr/local/bin:/usr/bin:/bin'
cd '{resolved.novel_home}'
set -a
source '{resolved.novel_env_path}'
set +a
'{bin_path}' chat -q '{escaped_prompt}' --toolsets ''
"""
    try:
        completed = subprocess.run(
            ["/bin/bash", "-c", cmd],
            capture_output=True,
            text=True,
            timeout=runner_timeout_seconds,
            check=False,
            env=os.environ.copy(),
        )
    except subprocess.TimeoutExpired:
        return NovelProfileRunResult(
            ok=False,
            exit_code=124,
            output="",
            error_hint="novel run timed out (DGX cold start or generation may still be loading)",
        )

    combined = ((completed.stdout or "") + (completed.stderr or "")).strip()
    output = _truncate_output(combined, max_output_chars)

    if completed.returncode != 0:
        hint = "novel profile run failed"
        return NovelProfileRunResult(
            ok=False,
            exit_code=completed.returncode,
            output=output or hint,
            error_hint=hint,
        )

    if not output:
        output = "(novel completed with no stdout)"

    return NovelProfileRunResult(ok=True, exit_code=0, output=output)


def render_novel_usage() -> str:
    return (
        "usage: /novel <creative prompt>\n"
        "example: /novel Write the opening scene for a cyberpunk mystery in Japanese"
    )
