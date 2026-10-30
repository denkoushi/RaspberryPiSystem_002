"""Read the device's non-shell KEY=value configuration."""

import os
import shlex
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlsplit


@dataclass(frozen=True)
class Config:
    api_base_url: str
    x_client_key: str = field(repr=False)
    tls_skip_verify: bool = False
    hid_device: str = ""
    queue_path: str = "/var/lib/zero-edge-agent/queue.db"
    input_mode: str = "evdev"
    serial_device: str = "/dev/ttyACM0"
    reader_init_commands: tuple = field(default=(), repr=False)


def load_config() -> Config:
    path = Path(os.environ.get("ZERO_EDGE_AGENT_CONFIG", "/etc/zero-edge-agent.conf"))
    values = {}
    for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        key, separator, raw = line.partition("=")
        try:
            parts = shlex.split(raw, comments=True)
        except ValueError:
            raise ValueError("Invalid config quoting on line %d" % number) from None
        if not separator or len(parts) > 1:
            raise ValueError("Invalid config on line %d" % number)
        values[key.strip()] = parts[0] if parts else ""
    for key in ("API_BASE_URL", "X_CLIENT_KEY"):
        if not values.get(key, "").strip():
            raise ValueError("%s is required" % key)
    origin = values["API_BASE_URL"].rstrip("/")
    try:
        url = urlsplit(origin)
        valid = (url.scheme in ("http", "https") and url.hostname and url.port != 0
                 and not url.path and not url.query and not url.fragment
                 and url.username is None and url.password is None)
    except ValueError:
        valid = False
    if not valid:
        raise ValueError("API_BASE_URL must be an HTTP(S) origin without /api")
    if values.get("TLS_SKIP_VERIFY", "0") not in ("0", "1"):
        raise ValueError("TLS_SKIP_VERIFY must be 0 or 1")
    if values.get("INPUT_MODE", "evdev") not in ("evdev", "serial"):
        raise ValueError("INPUT_MODE must be evdev or serial")
    if any(ord(char) < 32 or ord(char) > 126 for char in values["X_CLIENT_KEY"]):
        raise ValueError("X_CLIENT_KEY must contain printable ASCII only")
    return Config(origin, values["X_CLIENT_KEY"], values.get("TLS_SKIP_VERIFY", "0") == "1",
                  values.get("HID_DEVICE", ""),
                  values.get("QUEUE_PATH") or "/var/lib/zero-edge-agent/queue.db",
                  values.get("INPUT_MODE", "evdev"),
                  values.get("SERIAL_DEVICE", "/dev/ttyACM0"),
                  tuple(command.strip() for command in values.get("READER_INIT_COMMANDS", "").split(";")
                        if command.strip()))
