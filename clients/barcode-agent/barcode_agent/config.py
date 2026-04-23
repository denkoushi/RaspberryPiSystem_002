from __future__ import annotations

import os
from dataclasses import dataclass

from dotenv import load_dotenv


@dataclass(frozen=True)
class AgentConfig:
    rest_host: str
    rest_port: int
    serial_device: str
    serial_baud: int
    log_level: str

    @classmethod
    def load(cls) -> AgentConfig:
        load_dotenv()
        return cls(
            rest_host=os.environ.get("REST_HOST", "0.0.0.0"),
            rest_port=int(os.environ.get("REST_PORT", "7072")),
            serial_device=os.environ.get("SERIAL_DEVICE", "/dev/ttyACM0"),
            serial_baud=int(os.environ.get("SERIAL_BAUD", "9600")),
            log_level=os.environ.get("LOG_LEVEL", "INFO"),
        )
