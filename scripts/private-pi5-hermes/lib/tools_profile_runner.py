#!/usr/bin/env python3
"""Run Hermes CLI against the isolated tools profile (subprocess adapter)."""

from __future__ import annotations

import os
import re
import subprocess
import uuid
from dataclasses import dataclass
from pathlib import Path

try:
    from .dgx_runtime_prepare import ensure_dgx_runtime_ready
    from .task_bridge_policy import TaskBridgePolicy, toolsets_cli_argument
    from .tools_profile_constants import TOOLS_BUSINESS_MODEL_PROFILE_ID
except ImportError:
    from dgx_runtime_prepare import ensure_dgx_runtime_ready
    from task_bridge_policy import TaskBridgePolicy, toolsets_cli_argument
    from tools_profile_constants import TOOLS_BUSINESS_MODEL_PROFILE_ID


@dataclass(frozen=True)
class ToolsProfilePaths:
    """Host paths for tools profile execution."""

    hermes_user: str
    hermes_home: str
    tools_data_dir: str
    tools_home: str
    tools_env_path: str
    hermes_bin: str
    dgx_keep_warm_dir: str

    @classmethod
    def default_pi5(cls, hermes_user: str = "hermes") -> ToolsProfilePaths:
        home = f"/home/{hermes_user}"
        tools_data = f"{home}/.hermes-tools"
        chat_data = f"{home}/.hermes"
        return cls(
            hermes_user=hermes_user,
            hermes_home=home,
            tools_data_dir=tools_data,
            tools_home=f"{tools_data}/home",
            tools_env_path=f"{tools_data}/.env",
            hermes_bin=f"{home}/.local/bin/hermes",
            dgx_keep_warm_dir=f"{chat_data}/dgx-keep-warm",
        )


@dataclass
class ToolsProfileRunResult:
    ok: bool
    exit_code: int
    output: str
    error_hint: str = ""
    task_id: str = ""


def _truncate_output(text: str, max_chars: int) -> str:
    if len(text) <= max_chars:
        return text
    return text[: max_chars - 40] + "\n\n...(truncated for Discord)..."


def _runner_script_path() -> Path:
    base = Path(__file__).resolve().parent
    return base / "approval_relay" / "runner.py"


def ensure_tools_dgx_runtime_ready(paths: ToolsProfilePaths) -> tuple[bool, str]:
    """Restore DGX to the business profile before /task tools execution."""
    ok, hint = ensure_dgx_runtime_ready(
        Path(paths.tools_env_path),
        keep_warm_dir=paths.dgx_keep_warm_dir,
        default_model_profile_id=TOOLS_BUSINESS_MODEL_PROFILE_ID,
    )
    if ok:
        return True, ""
    if "tools" not in hint:
        return False, hint.replace("DGX runtime", "tools DGX runtime", 1)
    return False, hint


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


def _run_with_approval_relay(
    prompt: str,
    policy: TaskBridgePolicy,
    paths: ToolsProfilePaths,
    *,
    hermes_bin: Path,
    task_id: str | None = None,
) -> subprocess.CompletedProcess[str]:
    relay = policy.approval_relay
    resolved_task_id = task_id or uuid.uuid4().hex
    session_key = f"task-bridge:{resolved_task_id}"
    runner_script = _runner_script_path()
    if not runner_script.is_file():
        raise FileNotFoundError(f"approval relay runner missing: {runner_script}")

    python_bin = _resolve_hermes_python(hermes_bin, paths.hermes_home)
    argv = [
        str(python_bin),
        str(runner_script),
        "--task-id",
        resolved_task_id,
        "--store-dir",
        relay.store_dir,
        "--session-key",
        session_key,
        "--tools-home",
        paths.tools_home,
        "--tools-env",
        paths.tools_env_path,
        "--hermes-bin",
        str(hermes_bin),
        "--prompt",
        prompt,
        "--toolsets",
        toolsets_cli_argument(policy),
        "--request-timeout",
        str(relay.request_timeout_seconds),
        "--poll-interval",
        str(relay.poll_interval_seconds),
    ]
    env = os.environ.copy()
    env["PYTHONPATH"] = str(runner_script.parent.parent)
    return subprocess.run(
        argv,
        capture_output=True,
        text=True,
        timeout=policy.runner_timeout_seconds,
        check=False,
        env=env,
        cwd=paths.tools_home,
    )


def run_tools_profile_prompt(
    prompt: str,
    policy: TaskBridgePolicy,
    paths: ToolsProfilePaths | None = None,
    *,
    hermes_bin: str | None = None,
    task_id: str | None = None,
) -> ToolsProfileRunResult:
    """Invoke tools profile chat (relay or legacy subprocess)."""
    resolved = paths or ToolsProfilePaths.default_pi5()
    bin_path = Path(hermes_bin or resolved.hermes_bin)
    resolved_task_id = task_id or uuid.uuid4().hex

    if not Path(resolved.tools_env_path).is_file():
        return ToolsProfileRunResult(
            ok=False,
            exit_code=2,
            output="",
            error_hint=f"tools .env missing: {resolved.tools_env_path}",
            task_id=resolved_task_id,
        )

    ready_ok, ready_hint = ensure_tools_dgx_runtime_ready(resolved)
    if not ready_ok:
        return ToolsProfileRunResult(
            ok=False,
            exit_code=3,
            output="",
            error_hint=ready_hint,
            task_id=resolved_task_id,
        )

    try:
        if policy.approval_relay.enabled:
            completed = _run_with_approval_relay(
                prompt,
                policy,
                resolved,
                hermes_bin=bin_path,
                task_id=resolved_task_id,
            )
        else:
            completed = _run_legacy_subprocess(prompt, policy, resolved, bin_path=bin_path)
    except subprocess.TimeoutExpired:
        return ToolsProfileRunResult(
            ok=False,
            exit_code=124,
            output="",
            error_hint=(
                "task timed out (manual approval may be pending; "
                "reply yes/no or /task-approve / /task-deny)"
            ),
            task_id=resolved_task_id,
        )
    except FileNotFoundError as exc:
        return ToolsProfileRunResult(
            ok=False,
            exit_code=127,
            output="",
            error_hint=str(exc),
            task_id=resolved_task_id,
        )

    combined = (completed.stdout or "") + (completed.stderr or "")
    combined = combined.strip()
    output = _truncate_output(combined, policy.max_output_chars)

    if completed.returncode != 0:
        hint = "tools profile run failed"
        lowered = combined.lower()
        if "approval" in lowered or "approve" in lowered or "blocked" in lowered:
            hint = (
                "operation may require manual approval; "
                "reply yes/no or use /task-approve / /task-deny"
            )
        return ToolsProfileRunResult(
            ok=False,
            exit_code=completed.returncode,
            output=output or hint,
            error_hint=hint,
            task_id=resolved_task_id,
        )

    if not output:
        output = "(task completed with no stdout)"

    return ToolsProfileRunResult(ok=True, exit_code=0, output=output, task_id=resolved_task_id)


def _run_legacy_subprocess(
    prompt: str,
    policy: TaskBridgePolicy,
    resolved: ToolsProfilePaths,
    *,
    bin_path: Path,
) -> subprocess.CompletedProcess[str]:
    escaped_prompt = prompt.replace("'", "'\"'\"'")
    cmd = f"""
set -euo pipefail
export HOME='{resolved.tools_home}'
export PATH='{resolved.hermes_home}/.local/bin:/usr/local/bin:/usr/bin:/bin'
cd '{resolved.tools_home}'
set -a
source '{resolved.tools_env_path}'
set +a
'{bin_path}' chat -q '{escaped_prompt}' --toolsets '{toolsets_cli_argument(policy)}'
"""
    return subprocess.run(
        ["/bin/bash", "-c", cmd],
        capture_output=True,
        text=True,
        timeout=policy.runner_timeout_seconds,
        check=False,
        env=os.environ.copy(),
    )
