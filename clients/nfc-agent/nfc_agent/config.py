from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
import os


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

    @classmethod
    def load(cls) -> "AgentConfig":
        load_dotenv()
        queue_path = Path(os.environ.get("QUEUE_DB_PATH", "./data/nfc-agent-queue.db"))
        queue_path.parent.mkdir(parents=True, exist_ok=True)
        rest_port = int(os.environ.get("REST_PORT", os.environ.get("WEBSOCKET_PORT", "7071")))
        rest_host = os.environ.get("REST_HOST", os.environ.get("WEBSOCKET_HOST", "0.0.0.0"))
        return cls(
            rest_host=rest_host,
            rest_port=rest_port,
            queue_db_path=queue_path,
            log_level=os.environ.get("LOG_LEVEL", "INFO"),
            agent_mode=os.environ.get("AGENT_MODE", "pcsc").lower(),
            api_base_url=os.environ.get("API_BASE_URL"),
            client_id=os.environ.get("CLIENT_ID"),
            client_secret=os.environ.get("CLIENT_SECRET"),
        )
