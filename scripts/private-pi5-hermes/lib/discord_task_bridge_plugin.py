#!/usr/bin/env python3
"""Hermes plugin exposing `/task` for the private Pi5 chat profile."""

from __future__ import annotations

from .discord_task_bridge import (
    load_task_bridge_policy,
    render_task_usage,
    run_task_bridge,
)
from .task_request import TaskRequest


def _handle_task_command(raw_args: str) -> str:
    request = TaskRequest.from_text(raw_args)
    if not request.prompt:
        return render_task_usage()
    policy = load_task_bridge_policy()
    return run_task_bridge(request, policy)


def register(ctx) -> None:
    """Register `/task` for CLI and gateway sessions."""
    ctx.register_command(
        "task",
        handler=_handle_task_command,
        description="Run a task on the isolated tools profile",
    )
