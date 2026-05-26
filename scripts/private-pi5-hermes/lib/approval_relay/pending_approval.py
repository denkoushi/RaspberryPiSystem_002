#!/usr/bin/env python3
"""Shared file-IPC approval wait helpers (Phase D5.1)."""

from __future__ import annotations

from typing import Any

try:
    from .models import ApprovalChoice
    from .store import FileApprovalStore
except ImportError:
    from models import ApprovalChoice
    from store import FileApprovalStore


def wait_for_discord_approval(
    store: FileApprovalStore,
    approval_data: dict[str, Any],
    *,
    timeout_seconds: float,
    poll_interval_seconds: float,
) -> ApprovalChoice | None:
    """Write request.json, block until response.json or timeout; clear pending files."""
    store.clear_pending_files()
    store.write_request(approval_data)
    response = store.wait_for_response(
        timeout_seconds=max(float(timeout_seconds), 1.0),
        poll_interval_seconds=max(float(poll_interval_seconds), 0.05),
    )
    store.clear_pending_files()
    if response is None:
        return None
    return response.choice
