#!/usr/bin/env python3
"""Approval relay policy slice (Phase D5.1)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class ApprovalRelayPolicy:
    enabled: bool
    store_dir: str
    request_timeout_seconds: int
    poll_interval_seconds: float
    approval_grace_seconds: int = 120

    @classmethod
    def from_mapping(cls, data: dict[str, Any] | None) -> ApprovalRelayPolicy:
        if not data:
            return cls(
                enabled=False,
                store_dir="",
                request_timeout_seconds=300,
                poll_interval_seconds=0.5,
                approval_grace_seconds=120,
            )
        enabled = bool(data.get("enabled", False))
        store_dir = str(data.get("store_dir") or "").strip()
        timeout = data.get("request_timeout_seconds", 300)
        poll = data.get("poll_interval_seconds", 0.5)
        grace = data.get("approval_grace_seconds", 120)
        if not isinstance(timeout, int) or timeout <= 0:
            raise ValueError("approval_relay.request_timeout_seconds must be a positive integer")
        if not isinstance(poll, (int, float)) or float(poll) <= 0:
            raise ValueError("approval_relay.poll_interval_seconds must be positive")
        if not isinstance(grace, int) or grace < 0:
            raise ValueError("approval_relay.approval_grace_seconds must be a non-negative integer")
        if enabled and not store_dir:
            raise ValueError("approval_relay.store_dir is required when enabled")
        return cls(
            enabled=enabled,
            store_dir=store_dir,
            request_timeout_seconds=timeout,
            poll_interval_seconds=float(poll),
            approval_grace_seconds=grace,
        )


def validate_approval_relay_document(data: dict[str, Any] | None) -> list[str]:
    try:
        ApprovalRelayPolicy.from_mapping(data)
    except ValueError as exc:
        return [str(exc)]
    return []
