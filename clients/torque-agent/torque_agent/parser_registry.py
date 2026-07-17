from __future__ import annotations

from collections.abc import Callable
from typing import Protocol

from .models import ParsedTorqueEvent


class TorquePayloadParser(Protocol):
    def parse(self, raw_text: str) -> ParsedTorqueEvent: ...


class ParserRegistry:
    def __init__(self) -> None:
        self._factories: dict[str, Callable[[], TorquePayloadParser]] = {}

    def register(self, profile: str, factory: Callable[[], TorquePayloadParser]) -> None:
        if profile in self._factories:
            raise ValueError(f"Parser already registered: {profile}")
        self._factories[profile] = factory

    def create(self, profile: str) -> TorquePayloadParser:
        factory = self._factories.get(profile)
        if not factory:
            raise ValueError(
                f"No verified parser for profile '{profile}'. Capture and approve a real CEM3-BTLA fixture before enabling it."
            )
        return factory()


class SyntheticDelimitedFixtureParser:
    """Test-only fixture parser. This is deliberately not a CEM3-BTLA format."""

    PROFILE = "synthetic-delimited-fixture-v1"

    def parse(self, raw_text: str) -> ParsedTorqueEvent:
        parts = raw_text.strip().split("|")
        if not parts or parts[0] != "FIXTURE":
            raise ValueError("Synthetic fixture must start with FIXTURE")
        values = dict(part.split("=", 1) for part in parts[1:] if "=" in part)
        required = ("serial", "value", "unit", "memory")
        missing = [key for key in required if not values.get(key)]
        if missing:
            raise ValueError(f"Synthetic fixture is missing: {', '.join(missing)}")
        return ParsedTorqueEvent(
            serial_number=values["serial"],
            value=float(values["value"]),
            unit=values["unit"],
            memory_counter=values["memory"],
            device_recorded_at=values.get("recordedAt"),
            device_judgement=values.get("judgement"),
            raw_text=raw_text,
        )
