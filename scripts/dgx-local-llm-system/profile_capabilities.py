from __future__ import annotations

from typing import Any

CAPABILITY_TEXT = "text"
CAPABILITY_VISION = "vision"
VALID_CAPABILITIES = frozenset({CAPABILITY_TEXT, CAPABILITY_VISION})


def parse_declared_capabilities(body: dict[str, Any], backend: str) -> tuple[str, ...]:
    raw = body.get("declaredCapabilities")
    if isinstance(raw, list):
        out: list[str] = []
        for item in raw:
            if isinstance(item, str) and item in VALID_CAPABILITIES and item not in out:
                out.append(item)
        if out:
            return tuple(out)
    if backend == "blue":
        return (CAPABILITY_TEXT, CAPABILITY_VISION)
    return (CAPABILITY_TEXT,)


def parse_vision_requires_mmproj(body: dict[str, Any], backend: str) -> bool:
    value = body.get("visionRequiresMmproj")
    if isinstance(value, bool):
        return value
    return backend == "green"


def parse_launcher_hints(body: dict[str, Any]) -> dict[str, str]:
    raw = body.get("launcherHints")
    if not isinstance(raw, dict):
        return {}
    out: dict[str, str] = {}
    for key, value in raw.items():
        if isinstance(key, str) and key.strip() and isinstance(value, str) and value.strip():
            out[key.strip()] = value.strip()
    return out


def capabilities_to_api(capabilities: tuple[str, ...]) -> list[str]:
    return list(capabilities)
