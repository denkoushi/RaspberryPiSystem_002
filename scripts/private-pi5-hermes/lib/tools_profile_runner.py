#!/usr/bin/env python3
"""Run Hermes CLI against the isolated tools profile (subprocess adapter)."""

from __future__ import annotations

import os
import subprocess
from dataclasses import dataclass
from pathlib import Path

try:
    from .task_bridge_policy import TaskBridgePolicy, toolsets_cli_argument
except ImportError:
    from task_bridge_policy import TaskBridgePolicy, toolsets_cli_argument


@dataclass(frozen=True)
class ToolsProfilePaths:
    """Host paths for tools profile execution."""

    hermes_user: str
    hermes_home: str
    tools_data_dir: str
    tools_home: str
    tools_env_path: str
    hermes_bin: str

    @classmethod
    def default_pi5(cls, hermes_user: str = "hermes") -> ToolsProfilePaths:
        home = f"/home/{hermes_user}"
        tools_data = f"{home}/.hermes-tools"
        return cls(
            hermes_user=hermes_user,
            hermes_home=home,
            tools_data_dir=tools_data,
            tools_home=f"{tools_data}/home",
            tools_env_path=f"{tools_data}/.env",
            hermes_bin=f"{home}/.local/bin/hermes",
        )


@dataclass
class ToolsProfileRunResult:
    ok: bool
    exit_code: int
    output: str
    error_hint: str = ""


def _truncate_output(text: str, max_chars: int) -> str:
    if len(text) <= max_chars:
        return text
    return text[: max_chars - 40] + "\n\n...(truncated for Discord)..."


def run_tools_profile_prompt(
    prompt: str,
    policy: TaskBridgePolicy,
    paths: ToolsProfilePaths | None = None,
    *,
    hermes_bin: str | None = None,
) -> ToolsProfileRunResult:
    """Invoke `hermes chat -q` with tools HOME and fixed toolsets."""
    resolved = paths or ToolsProfilePaths.default_pi5()
    bin_path = hermes_bin or resolved.hermes_bin
    toolsets = toolsets_cli_argument(policy)

    if not Path(resolved.tools_env_path).is_file():
        return ToolsProfileRunResult(
            ok=False,
            exit_code=2,
            output="",
            error_hint=f"tools .env missing: {resolved.tools_env_path}",
        )

    # Shell sources tools secrets then runs non-interactive chat (manual approvals may block).
    escaped_prompt = prompt.replace("'", "'\"'\"'")
    cmd = f"""
set -euo pipefail
export HOME='{resolved.tools_home}'
export PATH='{resolved.hermes_home}/.local/bin:/usr/local/bin:/usr/bin:/bin'
set -a
source '{resolved.tools_env_path}'
set +a
'{bin_path}' chat -q '{escaped_prompt}' --toolsets '{toolsets}'
"""
    env = os.environ.copy()
    try:
        completed = subprocess.run(
            ["/bin/bash", "-c", cmd],
            capture_output=True,
            text=True,
            timeout=policy.runner_timeout_seconds,
            check=False,
            env=env,
        )
    except subprocess.TimeoutExpired:
        return ToolsProfileRunResult(
            ok=False,
            exit_code=124,
            output="",
            error_hint=(
                "task timed out (manual approval may be pending on Pi5 tools profile; "
                "check hermes-tools-gateway or retry a read-only workspace task)"
            ),
        )
    except FileNotFoundError:
        return ToolsProfileRunResult(
            ok=False,
            exit_code=127,
            output="",
            error_hint=f"hermes binary not found: {bin_path}",
        )

    combined = (completed.stdout or "") + (completed.stderr or "")
    combined = combined.strip()
    output = _truncate_output(combined, policy.max_output_chars)

    if completed.returncode != 0:
        hint = "tools profile run failed"
        lowered = combined.lower()
        if "approval" in lowered or "approve" in lowered:
            hint = (
                "operation may require manual approval on Pi5 (approvals.mode=manual); "
                "retry a read-only task or complete approval on the host"
            )
        return ToolsProfileRunResult(
            ok=False,
            exit_code=completed.returncode,
            output=output or hint,
            error_hint=hint,
        )

    if not output:
        output = "(task completed with no stdout)"

    return ToolsProfileRunResult(ok=True, exit_code=0, output=output)
