#!/usr/bin/env python3
"""Run Hermes CLI against the isolated novel profile (subprocess adapter)."""

from __future__ import annotations

import os
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path

try:
    from .dgx_runtime_prepare import (
        dgx_config_from_env_file as _dgx_config_from_env_file,
        ensure_dgx_runtime_ready as _ensure_dgx_runtime_ready_impl,
        load_dgx_runtime_client as _load_dgx_runtime_client,
    )
    from .novel_profile_constants import (
        DEFAULT_NOVEL_MAX_OUTPUT_CHARS,
        DEFAULT_NOVEL_RUNNER_TIMEOUT_SECONDS,
        NOVEL_MODEL_PROFILE_ID,
    )
except ImportError:
    from dgx_runtime_prepare import (
        dgx_config_from_env_file as _dgx_config_from_env_file,
        ensure_dgx_runtime_ready as _ensure_dgx_runtime_ready_impl,
        load_dgx_runtime_client as _load_dgx_runtime_client,
    )
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


def _dgx_config_from_novel_env(
    env_path: Path, *, keep_warm_dir: str | Path | None = None
) -> object:
    return _dgx_config_from_env_file(
        env_path,
        keep_warm_dir=keep_warm_dir,
        default_model_profile_id=NOVEL_MODEL_PROFILE_ID,
    )


def ensure_novel_dgx_runtime_ready(paths: NovelProfilePaths) -> tuple[bool, str]:
    """Start DGX with the novel model profile when cold."""
    ok, hint = _ensure_dgx_runtime_ready_impl(
        Path(paths.novel_env_path),
        keep_warm_dir=paths.dgx_keep_warm_dir,
        default_model_profile_id=NOVEL_MODEL_PROFILE_ID,
    )
    if ok:
        return True, ""
    if "novel" not in hint:
        return False, hint.replace("DGX runtime", "novel DGX runtime", 1)
    return False, hint


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
        "使い方: /novel <創作プロンプト>\n\n"
        "Discord スラッシュの場合:\n"
        "  /novel を選んだら **Arguments（プロンプト欄）** に続きを書いてから送信してください。\n"
        "  （プロンプト欄が空だとこのメッセージになります）\n\n"
        "確実な方法:\n"
        "  チャットに1行で送る — 例: /novel 坂の上の雲の続きを書いて\n\n"
        "初回は DGX 35B の cold start で数分かかることがあります。"
    )
