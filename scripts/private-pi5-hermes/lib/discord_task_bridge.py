#!/usr/bin/env python3
"""Orchestrate Discord /task → tools profile execution."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

try:
    import yaml
except ImportError:  # pragma: no cover
    yaml = None  # type: ignore[assignment]

from .task_bridge_policy import (
    TaskBridgePolicy,
    toolsets_cli_argument,
    validate_task_bridge_document,
    validate_task_prompt,
)
from .task_request import TaskRequest
from .tools_profile_runner import ToolsProfilePaths, run_tools_profile_prompt


def _default_policy_path() -> Path:
    # Deployed: ~/.hermes/discord-task-bridge/task-bridge.policy.yaml
    deployed = Path(__file__).resolve().parent.parent / "task-bridge.policy.yaml"
    if deployed.is_file():
        return deployed
    return Path(__file__).resolve().parent.parent / "config" / "task-bridge.policy.yaml"


def load_task_bridge_policy(path: Path | None = None) -> TaskBridgePolicy:
    policy_path = path or _default_policy_path()
    text = policy_path.read_text(encoding="utf-8")
    if yaml is None:
        raise RuntimeError("PyYAML is required to load task bridge policy")
    data = yaml.safe_load(text)
    if not isinstance(data, dict):
        raise ValueError("task bridge policy root must be a mapping")
    errors = validate_task_bridge_document(data)
    if errors:
        raise ValueError("; ".join(errors))
    return TaskBridgePolicy.from_mapping(data)


def render_task_usage() -> str:
    """Usage text shared by the CLI helper and /task plugin command."""
    return (
        "usage: /task <instructions>\n"
        "example: /task List files in workspace and summarize notes.txt if present"
    )


def run_task_bridge(
    request: TaskRequest,
    policy: TaskBridgePolicy,
    paths: ToolsProfilePaths | None = None,
) -> str:
    """Validate and run; return text for Discord /task responses."""
    validation = validate_task_prompt(request.prompt, policy)
    if not validation.ok:
        return f"task rejected: {validation.reason}"

    result = run_tools_profile_prompt(request.prompt, policy, paths=paths)
    if result.ok:
        return result.output
    if result.output:
        return f"task failed: {result.error_hint}\n\n{result.output}"
    return f"task failed: {result.error_hint}"


def run_cli(argv: list[str] | None = None) -> int:
    """CLI entry for local smoke / troubleshooting."""
    try:
        policy = load_task_bridge_policy()
    except (OSError, ValueError, RuntimeError) as exc:
        print(f"bridge configuration error: {exc}", file=sys.stderr)
        return 2

    request = TaskRequest.from_argv(argv)
    if not request.prompt and not sys.stdin.isatty():
        try:
            import select

            if select.select([sys.stdin], [], [], 0.0)[0]:
                request = TaskRequest.from_text(sys.stdin.read())
        except (ImportError, ValueError):
            pass

    if not request.prompt:
        print(render_task_usage(), file=sys.stderr)
        return 1

    message = run_task_bridge(request, policy)
    print(message)
    if message.startswith("task rejected") or message.startswith("task failed"):
        return 1
    return 0


def emission_json(policy: TaskBridgePolicy) -> dict[str, Any]:
    """JSON contract for Ansible smoke / validate script."""
    return {
        "require_tools_phase": policy.require_tools_phase,
        "allowed_toolsets": list(policy.allowed_toolsets),
        "max_prompt_chars": policy.max_prompt_chars,
        "bridge_executable_basename": policy.bridge_executable_basename,
        "toolsets_cli": toolsets_cli_argument(policy),
    }


def main() -> int:
    return run_cli()


if __name__ == "__main__":
    raise SystemExit(main())
