"""Minimal pure helper for PR Deploy impact target inference.

The existing CI classifier remains the authority for job selection.  This
module only reuses the static terminal profile registry to map the paths
already present in the CI JSON to affected profiles; it has no CLI, Git I/O,
deployment execution, or mutable state.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from typing import Any

from .terminal_profile_registry import TerminalProfileRegistry, load_registry


DEFAULT_REGISTRY = load_registry()
SERVER_COMPONENTS = frozenset(
    {"global", "migration", "pi5-control", "server-app"}
)


def _component_for(
    path: str, *, registry: TerminalProfileRegistry = DEFAULT_REGISTRY
) -> str:
    return registry.component_for(path)


def classify(
    paths: Iterable[str],
    *,
    registry: TerminalProfileRegistry = DEFAULT_REGISTRY,
) -> dict[str, Any]:
    """Classify repository paths using the current terminal profile registry."""

    normalized_paths = list(paths)
    components = {
        _component_for(path, registry=registry) for path in normalized_paths
    }
    affected_profiles = registry.profiles_for_components(components)
    return {
        "server": bool(components & SERVER_COMPONENTS) or "unknown" in components,
        "kiosk": "kiosk" in affected_profiles,
        "signage": "signage" in affected_profiles,
        "migration": "migration" in components,
        "paths": normalized_paths,
        "components": sorted(components),
        "affectedProfiles": affected_profiles,
    }


def classify_change_records(
    changes: Sequence[dict[str, Any]],
    *,
    registry: TerminalProfileRegistry = DEFAULT_REGISTRY,
) -> dict[str, Any]:
    """Infer profiles from CI change records, including rename/copy sources."""

    paths: list[str] = []
    for change in changes:
        path = change.get("path")
        if isinstance(path, str):
            paths.append(path)
        previous_path = change.get("previousPath")
        if isinstance(previous_path, str):
            paths.append(previous_path)
    return classify(paths, registry=registry)
