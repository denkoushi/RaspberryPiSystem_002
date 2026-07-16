"""Closed registry of executable terminal adapter implementations.

Terminal profiles may reuse one of these adapter identifiers without changing
the planner or fleet-state core.  PR 4 binds the same identifiers to concrete
``TerminalAdapter`` implementations; keeping the availability check here makes
an unknown adapter fail during local inventory preflight, before SSH or state.
"""
from __future__ import annotations


_REGISTERED_ADAPTER_IDS = frozenset({"generic-systemd", "signage-systemd"})


def registered_adapter_ids() -> frozenset[str]:
    """Return the immutable set of adapter IDs implemented by this checkout."""

    return _REGISTERED_ADAPTER_IDS


__all__ = ["registered_adapter_ids"]
