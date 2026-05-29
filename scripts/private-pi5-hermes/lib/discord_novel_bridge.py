#!/usr/bin/env python3
"""Orchestrate Discord /novel → isolated novel profile execution."""

from __future__ import annotations

import asyncio

try:
    from .discord_task_bridge import format_task_output_for_discord
    from .novel_profile_runner import (
        NovelProfilePaths,
        render_novel_usage,
        run_novel_profile_prompt,
    )
    from .novel_request import NovelRequest
except ImportError:
    from discord_task_bridge import format_task_output_for_discord
    from novel_profile_runner import (
        NovelProfilePaths,
        render_novel_usage,
        run_novel_profile_prompt,
    )
    from novel_request import NovelRequest


def run_novel_bridge(
    request: NovelRequest,
    paths: NovelProfilePaths | None = None,
) -> str:
    if not request.prompt:
        return render_novel_usage()

    result = run_novel_profile_prompt(request.prompt, paths=paths)
    output = format_task_output_for_discord(result.output)
    if result.ok:
        return output
    if output:
        return f"novel failed: {result.error_hint}\n\n{output}"
    return f"novel failed: {result.error_hint}"


async def run_novel_bridge_async(
    request: NovelRequest,
    paths: NovelProfilePaths | None = None,
) -> str:
    return await asyncio.to_thread(run_novel_bridge, request, paths)
