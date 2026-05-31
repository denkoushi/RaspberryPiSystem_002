#!/usr/bin/env python3
"""VOICEVOX engine HTTP client (Pi5-local synthesis)."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from urllib.parse import quote
from urllib.request import Request, urlopen


@dataclass(frozen=True)
class VoicevoxConfig:
    base_url: str
    speaker_id: int = 1
    timeout_sec: float = 60.0
    enabled: bool = True


class VoicevoxClient:
    def __init__(self, config: VoicevoxConfig) -> None:
        self._c = config

    @property
    def enabled(self) -> bool:
        return self._c.enabled and bool(self._c.base_url.strip())

    def synthesize_wav(self, text: str) -> bytes:
        if not self.enabled:
            raise RuntimeError("voicevox client is disabled")
        if not text.strip():
            raise ValueError("text is empty")

        base = self._c.base_url.rstrip("/")
        query_url = f"{base}/audio_query?text={quote(text)}&speaker={self._c.speaker_id}"
        query_req = Request(url=query_url, method="POST", data=b"")
        with urlopen(query_req, timeout=self._c.timeout_sec) as resp:
            query_body = json.loads(resp.read().decode("utf-8"))

        synth_url = f"{base}/synthesis?speaker={self._c.speaker_id}"
        synth_req = Request(
            url=synth_url,
            method="POST",
            headers={"Content-Type": "application/json"},
            data=json.dumps(query_body).encode("utf-8"),
        )
        with urlopen(synth_req, timeout=self._c.timeout_sec) as resp:
            return resp.read()


def config_from_env() -> VoicevoxConfig:
    base = (os.getenv("VOICEVOX_BASE_URL") or "").strip()
    enabled = _env_bool(os.getenv("VOICEVOX_ENABLED"), default=bool(base))
    try:
        speaker = int(os.getenv("VOICEVOX_SPEAKER_ID", "1"))
    except ValueError:
        speaker = 1
    try:
        timeout = float(os.getenv("VOICEVOX_TIMEOUT_SEC", "60"))
    except ValueError:
        timeout = 60.0
    return VoicevoxConfig(base_url=base, speaker_id=speaker, timeout_sec=timeout, enabled=enabled)


def _env_bool(value: str | None, default: bool) -> bool:
    if value is None:
        return default
    normalized = value.strip().lower()
    if normalized == "":
        return default
    return normalized in {"1", "true", "yes", "on"}
