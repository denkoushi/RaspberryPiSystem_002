from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from urllib.parse import urlsplit

from dotenv import load_dotenv
import os


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


@dataclass
class AgentConfig:
    rest_host: str
    rest_port: int
    queue_db_path: Path
    log_level: str
    agent_mode: str
    api_base_url: Optional[str]
    client_id: Optional[str]
    client_secret: Optional[str]
    allowed_origins: tuple[str, ...] = ()

    @classmethod
    def load(cls) -> "AgentConfig":
        load_dotenv()
        queue_path = Path(os.environ.get("QUEUE_DB_PATH", "./data/nfc-agent-queue.db"))
        queue_path.parent.mkdir(parents=True, exist_ok=True)
        rest_port = int(os.environ.get("REST_PORT", os.environ.get("WEBSOCKET_PORT", "7071")))
        rest_host = os.environ.get("REST_HOST", os.environ.get("WEBSOCKET_HOST", "127.0.0.1"))
        allowed_origins = tuple(
            normalize_origin(value.strip())
            for value in os.environ.get("ALLOWED_ORIGINS", "").split(",")
            if value.strip()
        )
        return cls(
            allowed_origins=allowed_origins,
            rest_host=rest_host,
            rest_port=rest_port,
            queue_db_path=queue_path,
            log_level=os.environ.get("LOG_LEVEL", "INFO"),
            agent_mode=os.environ.get("AGENT_MODE", "pcsc").lower(),
            api_base_url=os.environ.get("API_BASE_URL"),
            client_id=os.environ.get("CLIENT_ID"),
            client_secret=os.environ.get("CLIENT_SECRET"),
        )
