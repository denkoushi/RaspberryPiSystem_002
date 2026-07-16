"""Policy constants for the kiosk pre-deploy notice protocol.

The first compatibility rollout deliberately keeps the protocol disabled.  It
must be enabled only by the second release, after every kiosk browser has
received code that understands the ``notice`` deploy-status phase.
"""
from __future__ import annotations

NOTICE_DURATION_SECONDS = 60
NOTICE_ACK_TIMEOUT_SECONDS = 30

# The compatibility release has been installed on every Pi4 kiosk.  Keep this
# as an explicit policy switch so the emergency and terminal-type exceptions
# remain independently testable.
TERMINAL_PRENOTICE_ENABLED = True


def should_issue_terminal_notice(
    *,
    terminal_type: str,
    emergency_override: bool,
    notice_seconds: int | None = None,
) -> bool:
    """Return whether this terminal must receive the save-work notice."""
    applicable = terminal_type == 'kiosk' if notice_seconds is None else notice_seconds > 0
    return (
        TERMINAL_PRENOTICE_ENABLED
        and applicable
        and not emergency_override
    )


def terminal_notice_skip_reason(
    *,
    terminal_type: str,
    emergency_override: bool,
    notice_seconds: int | None = None,
) -> str:
    """Return a durable, operator-readable reason for not showing a notice."""
    applicable = terminal_type == 'kiosk' if notice_seconds is None else notice_seconds > 0
    if not applicable:
        return 'not-applicable'
    if emergency_override:
        return 'emergency-override'
    return 'compatibility-gate-disabled'
