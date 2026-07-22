"""Bounded, durable observations that do not decide release correctness."""
from __future__ import annotations

from typing import Any


_OBSERVERS = frozenset({"kiosk-browser"})
_PHASES = frozenset({"notice", "maintenance"})
_OUTCOMES = frozenset({"timeout"})


def record_observer_warning(
    state: Any,
    target: dict[str, Any],
    *,
    host: str,
    phase: str,
    outcome: str,
    timeout_seconds: int,
    observed_at: str,
    observer: str = "kiosk-browser",
) -> dict[str, Any]:
    """Persist a bounded observer result on both the host and release record.

    Observer warnings are intentionally separate from release claims, rollback
    evidence, and maintenance ownership.  They preserve a useful diagnosis
    without allowing a display acknowledgement to manufacture release success.
    """

    if (
        not isinstance(host, str)
        or not host
        or phase not in _PHASES
        or outcome not in _OUTCOMES
        or observer not in _OBSERVERS
        or type(timeout_seconds) is not int
        or timeout_seconds <= 0
        or not isinstance(observed_at, str)
        or not observed_at
    ):
        raise ValueError("observer warning is malformed")
    warning = {
        "kind": "observer-unconfirmed",
        "observer": observer,
        "host": host,
        "phase": phase,
        "outcome": outcome,
        "timeoutSeconds": timeout_seconds,
        "observedAt": observed_at,
    }
    target.setdefault("warnings", []).append(dict(warning))
    state.payload.setdefault("warnings", []).append(dict(warning))
    return warning
