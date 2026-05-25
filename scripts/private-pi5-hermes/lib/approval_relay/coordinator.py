#!/usr/bin/env python3
"""Discord-side approval relay coordinator (Phase D5.1)."""

from __future__ import annotations

import asyncio
import time
import uuid
from pathlib import Path
from typing import Awaitable, Callable

try:
    from .discord_relay import format_approval_prompt, send_discord_channel_message
    from .models import ApprovalChoice, TaskRunContext
    from .policy import ApprovalRelayPolicy
    from .session_context import read_gateway_session_context
    from .store import FileApprovalStore
except ImportError:
    from discord_relay import format_approval_prompt, send_discord_channel_message
    from models import ApprovalChoice, TaskRunContext
    from policy import ApprovalRelayPolicy
    from session_context import read_gateway_session_context
    from store import FileApprovalStore


ApprovalNotifier = Callable[[str], Awaitable[None]]


class DiscordApprovalRelayCoordinator:
    """Watch file store and surface pending approvals to Discord."""

    def __init__(self, relay_policy: ApprovalRelayPolicy) -> None:
        self.relay_policy = relay_policy
        self.store_dir = Path(relay_policy.store_dir)

    def new_task_context(
        self,
        *,
        discord_user_id: str = "",
        discord_channel_id: str = "",
    ) -> TaskRunContext:
        if discord_user_id:
            active = FileApprovalStore.active_task_id(self.store_dir, discord_user_id)
            if active:
                raise RuntimeError("another /task is already active for this Discord user")
        task_id = uuid.uuid4().hex
        ctx = TaskRunContext(
            task_id=task_id,
            discord_user_id=discord_user_id,
            discord_channel_id=discord_channel_id,
        )
        if discord_user_id:
            FileApprovalStore.bind_active_task(self.store_dir, discord_user_id, task_id)
        FileApprovalStore(self.store_dir, task_id).ensure_task_dir()
        return ctx

    def finish_task_context(self, ctx: TaskRunContext) -> None:
        if ctx.discord_user_id:
            active = FileApprovalStore.active_task_id(self.store_dir, ctx.discord_user_id)
            if active == ctx.task_id:
                FileApprovalStore.clear_active_task(self.store_dir, ctx.discord_user_id)

    async def watch_task(
        self,
        ctx: TaskRunContext,
        *,
        notifier: ApprovalNotifier | None = None,
        stop_event: asyncio.Event | None = None,
    ) -> None:
        store = FileApprovalStore(self.store_dir, ctx.task_id)
        seen_request_at = 0.0
        event = stop_event or asyncio.Event()

        while not event.is_set():
            request = store.read_request()
            if request and request.created_at > seen_request_at:
                seen_request_at = request.created_at
                message = format_approval_prompt(request)
                ctx.intermediate_messages.append(message)
                if notifier is not None:
                    await notifier(message)
                elif ctx.discord_channel_id:
                    await send_discord_channel_message(ctx.discord_channel_id, message)
            await asyncio.sleep(self.relay_policy.poll_interval_seconds)

    def resolve_for_user(
        self,
        discord_user_id: str,
        choice: ApprovalChoice,
    ) -> tuple[bool, str]:
        task_id = FileApprovalStore.active_task_id(self.store_dir, discord_user_id)
        if not task_id:
            return False, "no active /task awaiting approval"
        store = FileApprovalStore(self.store_dir, task_id)
        if not store.read_request():
            return False, "no pending approval for active task"
        store.write_response(choice, discord_user_id=discord_user_id)
        label = "approved" if choice != ApprovalChoice.DENY else "denied"
        return True, f"task {label} ({choice.value})"

    def try_resolve_text(self, discord_user_id: str, text: str) -> tuple[bool, str] | None:
        choice = ApprovalChoice.from_text(text)
        if choice is None:
            return None
        task_id = FileApprovalStore.active_task_id(self.store_dir, discord_user_id)
        if not task_id:
            return None
        store = FileApprovalStore(self.store_dir, task_id)
        if not store.read_request():
            return None
        return self.resolve_for_user(discord_user_id, choice)

    def purge_stale(self) -> int:
        return FileApprovalStore.purge_stale_tasks(
            self.store_dir,
            max_age_seconds=float(self.relay_policy.request_timeout_seconds) * 2,
        )
