from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Protocol

from .hid_line_decoder import TERMINATORS
from .models import ParsedTorqueEvent


class TorquePayloadParser(Protocol):
    def parse(self, raw_text: str) -> ParsedTorqueEvent: ...


@dataclass(frozen=True)
class ParserDefinition:
    factory: Callable[[], TorquePayloadParser]
    frame_terminators: frozenset[str]


class ParserRegistry:
    def __init__(self) -> None:
        self._definitions: dict[str, ParserDefinition] = {}

    def register(
        self,
        profile: str,
        factory: Callable[[], TorquePayloadParser],
        *,
        frame_terminators: frozenset[str] | None = None,
    ) -> None:
        if profile in self._definitions:
            raise ValueError(f"Parser already registered: {profile}")
        selected_terminators = frame_terminators or frozenset(TERMINATORS)
        if not selected_terminators or not selected_terminators.issubset(TERMINATORS):
            raise ValueError(f"Parser has invalid HID frame terminators: {profile}")
        self._definitions[profile] = ParserDefinition(factory, selected_terminators)

    def create(self, profile: str) -> TorquePayloadParser:
        definition = self._definitions.get(profile)
        if not definition:
            raise ValueError(
                f"No verified parser for profile '{profile}'. Capture and approve a real CEM3-BTLA fixture before enabling it."
            )
        return definition.factory()

    def frame_terminators(self, profile: str) -> frozenset[str]:
        definition = self._definitions.get(profile)
        if not definition:
            raise ValueError(f"No verified parser profile: {profile}")
        return definition.frame_terminators


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
