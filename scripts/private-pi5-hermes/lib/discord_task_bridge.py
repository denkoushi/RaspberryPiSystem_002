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

try:
    from .task_bridge_policy import (
        TaskBridgePolicy,
        toolsets_cli_argument,
        validate_task_bridge_document,
        validate_task_prompt,
    )
    from .task_request import TaskRequest
    from .tools_profile_runner import ToolsProfilePaths, run_tools_profile_prompt
except ImportError:
    from task_bridge_policy import (
        TaskBridgePolicy,
        toolsets_cli_argument,
        validate_task_bridge_document,
        validate_task_prompt,
    )
    from task_request import TaskRequest
    from tools_profile_runner import ToolsProfilePaths, run_tools_profile_prompt

try:
    from .approval_relay.coordinator import (
        APPROVAL_EXPIRED_USER_MESSAGE,
        DiscordApprovalRelayCoordinator,
        notify_discord_approval_prompt,
        read_gateway_session_context,
    )
    from .approval_relay.models import TaskRunContext
    from .approval_relay.session_context import primary_approval_actor_id
except ImportError:
    from approval_relay.coordinator import (
        APPROVAL_EXPIRED_USER_MESSAGE,
        DiscordApprovalRelayCoordinator,
        notify_discord_approval_prompt,
        read_gateway_session_context,
    )
    from approval_relay.models import TaskRunContext
    from approval_relay.session_context import primary_approval_actor_id

_APPROVAL_PROMPT_MARKER = "task approval required"
_APPROVAL_TIMEOUT_MARKERS = (
    "file write approval timed out",
    "approval timed out",
    "manual approval may be pending",
)


def _default_policy_path() -> Path:
    plugin_dir = Path(__file__).resolve().parent
    deployed = plugin_dir / "task-bridge.policy.yaml"
    if deployed.is_file():
        return deployed
    repo_policy = plugin_dir.parent / "config" / "task-bridge.policy.yaml"
    if repo_policy.is_file():
        return repo_policy
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


def _is_approval_prompt_message(text: str) -> bool:
    lowered = (text or "").lower()
    return _APPROVAL_PROMPT_MARKER in lowered or "⚠️" in (text or "")


def _task_output_looks_like_approval_timeout(text: str) -> bool:
    lowered = (text or "").lower()
    return any(marker in lowered for marker in _APPROVAL_TIMEOUT_MARKERS)


def should_enter_approval_grace(task_context: TaskRunContext | None) -> bool:
    """Grace only after approval timed out — not after every /task completion."""
    if task_context is None:
        return False
    if task_context.approval_delivery_error:
        return False
    return task_context.approval_timed_out


def _compose_task_response(
    output: str,
    *,
    task_context: TaskRunContext | None,
    ok: bool,
    error_hint: str,
) -> str:
    if task_context and task_context.approval_delivery_error:
        return (
            "task failed: 承認通知を Discord に送れませんでした "
            f"({task_context.approval_delivery_error})"
        )

    if not ok and _task_output_looks_like_approval_timeout(
        f"{error_hint}\n{output}"
    ):
        if task_context is not None:
            task_context.approval_timed_out = True
        return APPROVAL_EXPIRED_USER_MESSAGE

    if task_context and task_context.intermediate_messages:
        non_approval = [
            message
            for message in task_context.intermediate_messages
            if not _is_approval_prompt_message(message)
        ]
        if non_approval:
            prefix = "\n\n".join(non_approval)
            output = f"{prefix}\n\n{output}" if output else prefix

    if not ok:
        if output:
            return f"task failed: {error_hint}\n\n{output}"
        return f"task failed: {error_hint}"
    return output


def format_task_output_for_discord(text: str) -> str:
    """Strip Hermes CLI TUI noise for Discord responses."""
    lines = (text or "").splitlines()
    trimmed: list[str] = []
    skip = False
    for line in lines:
        if skip:
            continue
        if line.strip().startswith("Resume this session with:"):
            skip = True
            continue
        if line.strip().startswith("Session:") and "Duration:" in text:
            continue
        if line.strip().startswith("Duration:"):
            continue
        if line.strip().startswith("Messages:"):
            continue
        if "Auxiliary title generation failed" in line:
            continue
        trimmed.append(line)
    cleaned = "\n".join(trimmed).strip()
    return cleaned or text.strip()


def run_task_bridge(
    request: TaskRequest,
    policy: TaskBridgePolicy,
    paths: ToolsProfilePaths | None = None,
    *,
    task_context: TaskRunContext | None = None,
) -> str:
    """Validate and run; return text for Discord /task responses."""
    validation = validate_task_prompt(request.prompt, policy)
    if not validation.ok:
        return f"task rejected: {validation.reason}"

    task_id = task_context.task_id if task_context else None
    result = run_tools_profile_prompt(
        request.prompt,
        policy,
        paths=paths,
        task_id=task_id,
    )
    output = format_task_output_for_discord(result.output)
    return _compose_task_response(
        output,
        task_context=task_context,
        ok=result.ok,
        error_hint=result.error_hint,
    )


async def run_task_bridge_async(
    request: TaskRequest,
    policy: TaskBridgePolicy,
    paths: ToolsProfilePaths | None = None,
) -> str:
    """Run /task with optional approval relay watcher."""
    import asyncio

    user_id, channel_id = read_gateway_session_context()
    approval_actor_id = primary_approval_actor_id(user_id, channel_id)
    coordinator: DiscordApprovalRelayCoordinator | None = None
    task_context: TaskRunContext | None = None
    stop_event = asyncio.Event()
    watcher: asyncio.Task | None = None

    if policy.approval_relay.enabled:
        coordinator = DiscordApprovalRelayCoordinator(policy.approval_relay)
        coordinator.purge_stale()
        try:
            task_context = coordinator.new_task_context(
                discord_user_id=approval_actor_id,
                discord_channel_id=channel_id,
            )
        except RuntimeError as exc:
            return f"task rejected: {exc}"
        store_dir = Path(policy.approval_relay.store_dir)

        async def _approval_notifier(message: str) -> None:
            assert task_context is not None
            await notify_discord_approval_prompt(
                task_context,
                message,
                store_dir=store_dir,
                stop_event=stop_event,
            )

        watcher = asyncio.create_task(
            coordinator.watch_task(
                task_context,
                notifier=_approval_notifier,
                stop_event=stop_event,
            )
        )

    message = ""
    try:
        message = await asyncio.to_thread(
            run_task_bridge,
            request,
            policy,
            paths,
            task_context=task_context,
        )
    finally:
        stop_event.set()
        if watcher is not None:
            await watcher
        if (
            task_context is not None
            and task_context.approval_delivery_error
            and message
            and not message.startswith("task failed:")
        ):
            message = (
                "task failed: 承認通知を Discord に送れませんでした "
                f"({task_context.approval_delivery_error})"
            )
        if coordinator is not None and task_context is not None:
            coordinator.finish_task_context(
                task_context,
                enter_grace=should_enter_approval_grace(task_context),
            )

    return message


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
        "approval_relay": {
            "enabled": policy.approval_relay.enabled,
            "store_dir": policy.approval_relay.store_dir,
            "request_timeout_seconds": policy.approval_relay.request_timeout_seconds,
            "poll_interval_seconds": policy.approval_relay.poll_interval_seconds,
            "approval_grace_seconds": policy.approval_relay.approval_grace_seconds,
        },
    }


def main() -> int:
    return run_cli()


if __name__ == "__main__":
    raise SystemExit(main())
