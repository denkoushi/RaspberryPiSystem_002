#!/usr/bin/env python3
"""Orchestrate Discord /ask -> isolated research profile execution."""

from __future__ import annotations

import asyncio

try:
    from .discord_task_bridge import format_task_output_for_discord
    from .research_profile_runner import (
        ResearchProfilePaths,
        render_research_usage,
        run_research_profile_prompt,
    )
    from .research_request import ResearchRequest
except ImportError:
    from discord_task_bridge import format_task_output_for_discord
    from research_profile_runner import (
        ResearchProfilePaths,
        render_research_usage,
        run_research_profile_prompt,
    )
    from research_request import ResearchRequest


MAX_RESEARCH_PROMPT_CHARS = 2000


def run_research_bridge(
    request: ResearchRequest,
    paths: ResearchProfilePaths | None = None,
) -> str:
    if not request.prompt:
        return render_research_usage()
    if len(request.prompt) > MAX_RESEARCH_PROMPT_CHARS:
        return f"ask rejected: prompt exceeds max length ({MAX_RESEARCH_PROMPT_CHARS} chars)"

    result = run_research_profile_prompt(request.prompt, paths=paths)
    output = format_task_output_for_discord(result.output)
    if result.ok:
        return output
    if output:
        return f"ask failed: {result.error_hint}\n\n{output}"
    return f"ask failed: {result.error_hint}"


async def run_research_bridge_async(
    request: ResearchRequest,
    paths: ResearchProfilePaths | None = None,
) -> str:
    return await asyncio.to_thread(run_research_bridge, request, paths)
