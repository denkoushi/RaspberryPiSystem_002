"""Closed registry of executable terminal adapter implementations."""
from __future__ import annotations

from typing import Any, Callable

try:
    from terminal_profile_registry import TerminalProfile, load_registry
except ImportError:  # Repository-root package imports used by contract tests.
    from scripts.deploy.terminal_profile_registry import TerminalProfile, load_registry

from .terminal_adapters import (
    GenericSystemdAdapter,
    SignageSystemdAdapter,
    TerminalAdapter,
)


AdapterFactory = Callable[[TerminalProfile, Any], TerminalAdapter]
_ADAPTER_FACTORIES: dict[str, AdapterFactory] = {
    GenericSystemdAdapter.adapter_id: GenericSystemdAdapter,
    SignageSystemdAdapter.adapter_id: SignageSystemdAdapter,
}



def registered_adapter_ids() -> frozenset[str]:
    """Return the immutable set of adapter IDs implemented by this checkout."""

    return frozenset(_ADAPTER_FACTORIES)


def adapter_for_profile(
    profile_id: str,
    *,
    runtime: Any,
    profile: TerminalProfile | None = None,
) -> TerminalAdapter:
    """Resolve and validate one profile without importing registry text."""

    selected = load_registry().profile(profile_id) if profile is None else profile
    if selected.id != profile_id:
        raise ValueError("terminal adapter profile identity is inconsistent")
    try:
        factory = _ADAPTER_FACTORIES[selected.adapter_id]
    except KeyError as error:
        raise ValueError(
            f"terminal profile {profile_id} references unavailable adapter "
            f"{selected.adapter_id}"
        ) from error
    adapter = factory(selected, runtime)
    adapter.validate()
    return adapter


def validate_adapter_profiles(profiles: tuple[TerminalProfile, ...]) -> None:
    """Fail local topology preflight for unsupported adapter options."""

    for profile in profiles:
        adapter_for_profile(profile.id, runtime=None, profile=profile)


__all__ = [
    "adapter_for_profile",
    "registered_adapter_ids",
    "validate_adapter_profiles",
]
