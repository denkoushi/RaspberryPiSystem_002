from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any


@dataclass(frozen=True)
class ParsedTorqueEvent:
    serial_number: str
    value: float
    unit: str
    raw_text: str
    device_recorded_at: str | None = None
    memory_counter: str | None = None
    device_judgement: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class WorkBinding:
    session_id: str
    current_template_bolt_id: str
    confirmation_id: str
    torque_wrench_profile_id: str
    connection_lease_id: str
    connection_lease_generation: int
