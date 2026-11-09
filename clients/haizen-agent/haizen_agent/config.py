"""Parse /etc/raspi-haizen-agent.conf style KEY=\"value\" lines."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from haizen_agent.classifier import DistributionClassificationMode

TlsVerifyMode = Literal["insecure", "system", "pinned"]


@dataclass(frozen=True)
class HaizenAgentConfig:
    """境界契約: api_base_url はオリジン（/api なし）。TLS は設定注入のみ。"""

    api_base_url: str
    x_client_key: str
    tls_verify_mode: TlsVerifyMode
    hid_device: str | None
    distribution_mode: DistributionClassificationMode
    tls_ca_file: str | None = None

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


def _parse_distribution_mode(file_vals: dict[str, str]) -> DistributionClassificationMode:
    """HAIZEN_DISTRIBUTION_MODE: legacy_short_numeric（既定）または prefixed_dist（DIST:n のみ分配）。"""
    raw = (
        os.environ.get("HAIZEN_DISTRIBUTION_MODE") or file_vals.get("HAIZEN_DISTRIBUTION_MODE") or ""
    ).strip().lower()
    if raw in ("prefixed_dist", "prefixed", "dist_prefix"):
        return "prefixed_dist"
    return "legacy_short_numeric"


def _parse_tls_verify_mode(file_vals: dict[str, str]) -> TlsVerifyMode:
    """明示 pin を優先し、それ以外は従来の TLS_SKIP_VERIFY の優先順を維持する。"""
    mode_raw = os.environ.get("HAIZEN_TLS_VERIFY_MODE") or file_vals.get("HAIZEN_TLS_VERIFY_MODE") or ""
    if mode_raw.strip().lower() == "pinned":
        return "pinned"
    skip_raw = os.environ.get("TLS_SKIP_VERIFY")
    if skip_raw is None:
        skip_raw = file_vals.get("TLS_SKIP_VERIFY")
    if skip_raw is not None:
        v = skip_raw.strip().lower()
        if v in ("1", "true", "yes", "on"):
            return "insecure"
        if v in ("0", "false", "no", "off"):
            return "system"

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
    tls_ca_file = os.environ.get("HAIZEN_TLS_CA_FILE") or file_vals.get("HAIZEN_TLS_CA_FILE")
    if tls_verify_mode == "pinned" and not tls_ca_file:
        raise ValueError("HAIZEN_TLS_CA_FILE is required for pinned mode")
    hid_device = hid.strip() or None
    distribution_mode = _parse_distribution_mode(file_vals)
    return HaizenAgentConfig(
        api_base_url=api.rstrip("/"),
        x_client_key=key,
        tls_verify_mode=tls_verify_mode,
        tls_ca_file=tls_ca_file if tls_verify_mode == "pinned" else None,
        hid_device=hid_device,
        distribution_mode=distribution_mode,
    )
