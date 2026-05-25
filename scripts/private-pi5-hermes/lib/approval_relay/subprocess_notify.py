#!/usr/bin/env python3
"""Subprocess-side gateway approval notify + file IPC (Phase D5.1)."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

try:
    from .models import ApprovalChoice
    from .store import FileApprovalStore
except ImportError:
    from models import ApprovalChoice
    from store import FileApprovalStore

logger = logging.getLogger(__name__)


def install_file_approval_relay(
    *,
    store_dir: Path,
    task_id: str,
    session_key: str,
    request_timeout_seconds: float,
    poll_interval_seconds: float,
) -> None:
    """Register Hermes gateway notify callback that writes approval requests to disk."""
    del poll_interval_seconds
    store = FileApprovalStore(store_dir, task_id)
    timeout_seconds = max(float(request_timeout_seconds), 1.0)

    def notify_cb(approval_data: dict[str, Any]) -> None:
        store.write_request(approval_data)
        response = store.wait_for_response(timeout_seconds=timeout_seconds)
        if response is None:
            store.write_response(ApprovalChoice.DENY)

    try:
        import tools.approval as approval  # type: ignore[import-untyped]
    except ImportError as exc:
        raise RuntimeError(f"tools.approval unavailable: {exc}") from exc

    approval.register_gateway_notify(session_key, notify_cb)
    logger.debug("registered file approval relay for session %s", session_key)
