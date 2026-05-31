#!/usr/bin/env python3
"""Thin HTTP client to control StackChan device (playback, state, speech fallback)."""

from __future__ import annotations

import os
from dataclasses import dataclass
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urljoin
from urllib.request import Request, urlopen


@dataclass(frozen=True)
class StackChanDeviceConfig:
    base_url: str
    timeout_sec: float = 15.0
    enabled: bool = False


class StackChanDeviceClient:
    def __init__(self, config: StackChanDeviceConfig) -> None:
        self._c = config

    @property
    def enabled(self) -> bool:
        return self._c.enabled and bool(self._c.base_url.strip())

    def health_check(self) -> tuple[bool, str]:
        if not self.enabled:
            return False, "stackchan device client disabled"
        url = urljoin(self._c.base_url.rstrip("/") + "/", "/")
        try:
            req = Request(url=url, method="GET")
            with urlopen(req, timeout=self._c.timeout_sec) as resp:
                return 200 <= resp.getcode() < 300, f"status={resp.getcode()}"
        except HTTPError as e:
            return False, f"http {e.code}"
        except URLError as e:
            return False, str(e)
        except TimeoutError:
            return False, "timeout"

    def set_state(self, state: str) -> tuple[bool, str]:
        if not self.enabled:
            return False, "disabled"
        url = urljoin(
            self._c.base_url.rstrip("/") + "/",
            f"private-bridge/state?state={quote(state)}",
        )
        return self._get_ok(url)

    def play_audio_url(self, audio_url: str) -> tuple[bool, str]:
        if not self.enabled:
            return False, "disabled"
        public_base = (os.getenv("VOICE_AUDIO_PUBLIC_BASE_URL") or "").strip().rstrip("/")
        if public_base and audio_url.rstrip("/").startswith(public_base):
            return False, "refusing loopback play-audio (device should GET audioUrl after response)"
        url = urljoin(
            self._c.base_url.rstrip("/") + "/",
            f"private-bridge/play-audio?url={quote(audio_url, safe='')}",
        )
        return self._get_ok(url)

    def speech_text(self, text: str) -> tuple[bool, str]:
        if not self.enabled:
            return False, "disabled"
        url = urljoin(
            self._c.base_url.rstrip("/") + "/",
            f"speech?say={quote(text)}",
        )
        return self._get_ok(url)

    def playback(self, *, audio_url: str | None, reply_text: str) -> tuple[bool, str]:
        """Prefer Pi5-synthesized audio URL; fall back to device /speech.

        Do not call play-audio with URLs served by the same Pi5 bridge during POST /voice-turn
        (StackChan would GET back into the bridge and deadlock a single-thread server).
        """
        if audio_url and self.enabled:
            ok, detail = self.play_audio_url(audio_url)
            if ok:
                return True, detail
            if detail.startswith("refusing loopback"):
                if reply_text.strip():
                    return self.speech_text(reply_text)
                return False, detail
        if reply_text.strip():
            return self.speech_text(reply_text)
        return False, "no playback path"

    def _get_ok(self, url: str) -> tuple[bool, str]:
        try:
            req = Request(url=url, method="GET")
            with urlopen(req, timeout=self._c.timeout_sec) as resp:
                code = resp.getcode()
                body = resp.read(256).decode("utf-8", errors="ignore")
                return 200 <= code < 300, f"status={code} body={body[:80]}"
        except HTTPError as e:
            return False, f"http {e.code}"
        except URLError as e:
            return False, str(e)
        except TimeoutError:
            return False, "timeout"


def config_from_env() -> StackChanDeviceConfig:
    base = (os.getenv("STACKCHAN_DEVICE_BASE_URL") or "").strip()
    enabled = _env_bool(os.getenv("STACKCHAN_DEVICE_CONTROL_ENABLED"), default=bool(base))
    try:
        timeout = float(os.getenv("STACKCHAN_DEVICE_TIMEOUT_SEC", "15"))
    except ValueError:
        timeout = 15.0
    return StackChanDeviceConfig(base_url=base, timeout_sec=timeout, enabled=enabled)


def _env_bool(value: str | None, default: bool) -> bool:
    if value is None:
        return default
    normalized = value.strip().lower()
    if normalized == "":
        return default
    return normalized in {"1", "true", "yes", "on"}
