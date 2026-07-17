from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit


def _http_origin(value: str, label: str) -> str:
    parsed = urlsplit(value)
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.netloc
        or parsed.username is not None
        or parsed.password is not None
        or parsed.path not in {"", "/"}
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError(f"{label} must be an http(s) origin without a path, query, fragment, or credentials")
    return f"{parsed.scheme}://{parsed.netloc}"


@dataclass(frozen=True)
class HidDeviceConfig:
    path: Path
    parser_profile: str


@dataclass(frozen=True)
class AgentConfig:
    api_base_url: str
    client_key: str
    queue_path: Path
    devices: tuple[HidDeviceConfig, ...]
    browser_origins: tuple[str, ...] = ()
    heartbeat_ttl_seconds: float = 8.0
    local_port: int = 7073
    synthetic_fixture_enabled: bool = False

    @classmethod
    def from_env(cls) -> "AgentConfig":
        api_base_url = os.environ.get("TORQUE_API_BASE_URL", "").rstrip("/")
        client_key = os.environ.get("TORQUE_CLIENT_KEY", "")
        if not api_base_url or not client_key:
            raise ValueError("TORQUE_API_BASE_URL and TORQUE_CLIENT_KEY are required")
        api_origin = _http_origin(api_base_url, "TORQUE_API_BASE_URL")
        raw_browser_origins = json.loads(os.environ.get("TORQUE_BROWSER_ORIGINS_JSON", "[]"))
        if not isinstance(raw_browser_origins, list) or not all(isinstance(value, str) for value in raw_browser_origins):
            raise ValueError("TORQUE_BROWSER_ORIGINS_JSON must be a JSON string array")
        browser_origins = tuple(
            dict.fromkeys(
                [api_origin, *(_http_origin(value, "TORQUE_BROWSER_ORIGINS_JSON item") for value in raw_browser_origins)]
            )
        )
        raw_devices = json.loads(os.environ.get("TORQUE_HID_DEVICES_JSON", "[]"))
        devices: list[HidDeviceConfig] = []
        for row in raw_devices:
            path = Path(str(row["path"]))
            if not str(path).startswith("/dev/input/by-id/"):
                raise ValueError(f"Only /dev/input/by-id devices are allowed: {path}")
            devices.append(HidDeviceConfig(path=path, parser_profile=str(row["parserProfile"])))
        return cls(
            api_base_url=api_base_url,
            client_key=client_key,
            queue_path=Path(os.environ.get("TORQUE_QUEUE_PATH", "/data/torque-events.sqlite3")),
            devices=tuple(devices),
            browser_origins=browser_origins,
            heartbeat_ttl_seconds=float(os.environ.get("TORQUE_HEARTBEAT_TTL_SECONDS", "8")),
            local_port=int(os.environ.get("TORQUE_LOCAL_PORT", "7073")),
            synthetic_fixture_enabled=os.environ.get("TORQUE_ENABLE_SYNTHETIC_FIXTURE", "false").lower() == "true",
        )
