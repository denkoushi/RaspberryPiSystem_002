"""Parse /etc/raspi-haizen-agent.conf style KEY=\"value\" lines."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Literal


TlsVerifyMode = Literal["insecure", "system"]


@dataclass(frozen=True)
class HaizenAgentConfig:
    """境界契約: api_base_url はオリジン（/api なし）。TLS は設定注入のみ。"""

    api_base_url: str
    x_client_key: str
    tls_verify_mode: TlsVerifyMode
    hid_device: str | None

    @property
    def tls_skip_verify(self) -> bool:
        return self.tls_verify_mode == "insecure"


def _strip_quotes(value: str) -> str:
    v = value.strip()
    if len(v) >= 2 and v[0] == v[-1] and v[0] in ('"', "'"):
        return v[1:-1]
    return v


def load_config_path(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if not path.is_file():
        return out
    for raw in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        key, _, rest = line.partition("=")
        k = key.strip()
        out[k] = _strip_quotes(rest)
    return out


def _parse_tls_verify_mode(file_vals: dict[str, str]) -> TlsVerifyMode:
    """互換: TLS_SKIP_VERIFY が優先。次に HAIZEN_TLS_VERIFY_MODE。未指定は insecure。"""
    skip_raw = os.environ.get("TLS_SKIP_VERIFY")
    if skip_raw is None:
        skip_raw = file_vals.get("TLS_SKIP_VERIFY")
    if skip_raw is not None:
        v = skip_raw.strip().lower()
        if v in ("1", "true", "yes", "on"):
            return "insecure"
        if v in ("0", "false", "no", "off"):
            return "system"

    mode_raw = os.environ.get("HAIZEN_TLS_VERIFY_MODE") or file_vals.get("HAIZEN_TLS_VERIFY_MODE") or ""
    m = mode_raw.strip().lower()
    if m in ("system", "verify", "strict"):
        return "system"
    return "insecure"


def load_haizen_config() -> HaizenAgentConfig:
    cfg_path = Path(os.environ.get("CONFIG_PATH", "/etc/raspi-haizen-agent.conf"))
    file_vals = load_config_path(cfg_path)

    api = os.environ.get("API_BASE_URL") or file_vals.get("API_BASE_URL") or ""
    key = os.environ.get("X_CLIENT_KEY") or file_vals.get("X_CLIENT_KEY") or ""
    hid = os.environ.get("HAIZEN_HID_DEVICE") or file_vals.get("HAIZEN_HID_DEVICE") or ""

    if not api:
        raise SystemExit("API_BASE_URL is required (env or CONFIG file)")
    if not key:
        raise SystemExit("X_CLIENT_KEY is required (env or CONFIG file)")

    tls_verify_mode = _parse_tls_verify_mode(file_vals)
    hid_device = hid.strip() or None
    return HaizenAgentConfig(
        api_base_url=api.rstrip("/"),
        x_client_key=key,
        tls_verify_mode=tls_verify_mode,
        hid_device=hid_device,
    )
