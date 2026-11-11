from __future__ import annotations

import os
from dataclasses import dataclass

from urllib.parse import urlsplit

from dotenv import load_dotenv


def normalize_origin(value: str) -> str:
    origin = urlsplit(value.strip().rstrip("/"))
    if (
        origin.scheme not in {"http", "https"}
        or not origin.hostname
        or origin.username is not None
        or origin.password is not None
        or origin.path
        or origin.query
        or origin.fragment
        or any(char.isspace() for char in value)
    ):
        raise ValueError("Expected an HTTP(S) origin")
    host = origin.hostname.lower()
    if ":" in host:
        host = f"[{host}]"
    port = origin.port
    suffix = f":{port}" if port is not None and port != {"http": 80, "https": 443}[origin.scheme] else ""
    return f"{origin.scheme}://{host}{suffix}"


@dataclass(frozen=True)
class AgentConfig:
    rest_host: str
    rest_port: int
    serial_device: str
    serial_baud: int
    log_level: str
    allowed_origins: tuple[str, ...] = ()

    @classmethod
    def load(cls) -> AgentConfig:
        load_dotenv()
        allowed_origins = tuple(
            normalize_origin(value.strip())
            for value in os.environ.get("ALLOWED_ORIGINS", "").split(",")
            if value.strip()
        )
        return cls(
            allowed_origins=allowed_origins,
            rest_host=os.environ.get("REST_HOST", "127.0.0.1"),
            rest_port=int(os.environ.get("REST_PORT", "7072")),
            serial_device=os.environ.get("SERIAL_DEVICE", "/dev/ttyACM0"),
            serial_baud=int(os.environ.get("SERIAL_BAUD", "9600")),
            log_level=os.environ.get("LOG_LEVEL", "INFO"),
        )
