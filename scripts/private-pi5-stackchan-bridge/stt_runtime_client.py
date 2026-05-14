#!/usr/bin/env python3
"""
STT runtime client for stackchan-bridge.

Supports:
- upstream OpenAI-compatible transcription endpoint
- optional local faster-whisper execution
"""

from __future__ import annotations

import json
import os
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.request import Request, urlopen


@dataclass(frozen=True)
class SttRuntimeConfig:
    provider: str = "upstream-openai"
    upstream_base_url: str = "http://100.118.82.72:38081"
    upstream_path: str = "/v1/audio/transcriptions"
    upstream_auth_mode: str = "x-llm-token"
    upstream_token: str = ""
    upstream_model: str = "whisper-1"
    upstream_timeout_sec: float = 60.0
    local_model: str = "small"
    local_device: str = "cpu"
    local_compute_type: str = "int8"
    local_language_default: str = "ja"
    local_vad_filter: bool = True
    local_retry_without_vad: bool = True
    local_fallback_to_upstream_on_empty: bool = False


def _env_bool(value: str | None, default: bool) -> bool:
    if value is None:
        return default
    normalized = value.strip().lower()
    if normalized == "":
        return default
    return normalized in {"1", "true", "yes", "on"}


def _encode_multipart_form(fields: list[tuple[str, str]], files: list[tuple[str, str, bytes, str]]) -> tuple[str, bytes]:
    boundary = "----stackchan-bridge-stt-boundary"
    chunks: list[bytes] = []
    for name, value in fields:
        chunks.append(f"--{boundary}\r\n".encode("utf-8"))
        chunks.append(f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode("utf-8"))
        chunks.append(value.encode("utf-8"))
        chunks.append(b"\r\n")
    for name, filename, body, content_type in files:
        chunks.append(f"--{boundary}\r\n".encode("utf-8"))
        chunks.append(
            (
                f'Content-Disposition: form-data; name="{name}"; filename="{filename}"\r\n'
                f"Content-Type: {content_type}\r\n\r\n"
            ).encode("utf-8")
        )
        chunks.append(body)
        chunks.append(b"\r\n")
    chunks.append(f"--{boundary}--\r\n".encode("utf-8"))
    return boundary, b"".join(chunks)


def _extract_text_from_response(raw: bytes) -> str:
    body = raw.decode("utf-8", errors="ignore").strip()
    if body == "":
        return ""
    try:
        parsed = json.loads(body)
    except json.JSONDecodeError:
        return body
    if isinstance(parsed, dict):
        text = parsed.get("text")
        if isinstance(text, str):
            return text.strip()
    return ""


class SttRuntimeClient:
    def __init__(self, config: SttRuntimeConfig) -> None:
        self._c = config
        self._whisper_model = None

    def transcribe(self, audio_bytes: bytes, content_type: str, language: str | None, model: str | None) -> tuple[str, dict[str, Any]]:
        provider = self._c.provider.lower()
        if provider == "faster-whisper-local":
            text, details = self._transcribe_local(audio_bytes, language)
            if text == "" and self._c.local_fallback_to_upstream_on_empty:
                text = self._transcribe_upstream(audio_bytes, content_type, language, model)
                details = {
                    **details,
                    "fallbackUsed": True,
                    "fallbackProvider": "upstream-openai",
                    "fallbackModel": model or self._c.upstream_model,
                }
            return text, {"provider": provider, "model": self._c.local_model, **details}
        text = self._transcribe_upstream(audio_bytes, content_type, language, model)
        return text, {"provider": "upstream-openai", "model": model or self._c.upstream_model}

    def _transcribe_upstream(self, audio_bytes: bytes, content_type: str, language: str | None, model: str | None) -> str:
        use_model = model or self._c.upstream_model
        fields = [("model", use_model)]
        if language:
            fields.append(("language", language))
        boundary, payload = _encode_multipart_form(
            fields=fields,
            files=[("file", "audio.wav", audio_bytes, content_type or "audio/wav")],
        )

        headers = {"Content-Type": f"multipart/form-data; boundary={boundary}"}
        auth_mode = self._c.upstream_auth_mode.lower()
        if auth_mode == "x-llm-token" and self._c.upstream_token:
            headers["X-LLM-Token"] = self._c.upstream_token
        elif auth_mode == "bearer" and self._c.upstream_token:
            headers["Authorization"] = f"Bearer {self._c.upstream_token}"

        req = Request(
            url=f"{self._c.upstream_base_url.rstrip('/')}{self._c.upstream_path}",
            method="POST",
            headers=headers,
            data=payload,
        )
        with urlopen(req, timeout=self._c.upstream_timeout_sec) as resp:
            raw = resp.read()
        return _extract_text_from_response(raw)

    def _ensure_whisper_model(self):
        if self._whisper_model is not None:
            return self._whisper_model
        try:
            from faster_whisper import WhisperModel
        except ImportError as e:
            raise RuntimeError(
                "faster-whisper is not installed. Use provider=upstream-openai "
                "or install faster-whisper in the bridge venv."
            ) from e
        self._whisper_model = WhisperModel(
            self._c.local_model,
            device=self._c.local_device,
            compute_type=self._c.local_compute_type,
        )
        return self._whisper_model

    def _transcribe_once(self, temp_path: Path, language: str | None, vad_filter: bool) -> str:
        model = self._ensure_whisper_model()
        segments, _info = model.transcribe(
            str(temp_path),
            language=language,
            vad_filter=vad_filter,
        )
        return "".join(seg.text for seg in segments).strip()

    def _transcribe_local(self, audio_bytes: bytes, language: str | None) -> tuple[str, dict[str, Any]]:
        with tempfile.NamedTemporaryFile(prefix="stackchan-stt-", suffix=".wav", delete=False) as fp:
            fp.write(audio_bytes)
            temp_path = Path(fp.name)
        try:
            first_language = language or self._c.local_language_default or None
            text = self._transcribe_once(temp_path, first_language, self._c.local_vad_filter)
            retried = False
            if text == "" and self._c.local_retry_without_vad and (first_language is not None or self._c.local_vad_filter):
                retried = True
                text = self._transcribe_once(temp_path, None, False)
            return text, {
                "language": first_language,
                "vadFilter": self._c.local_vad_filter,
                "retryWithoutVad": retried,
            }
        finally:
            try:
                temp_path.unlink(missing_ok=True)
            except OSError:
                pass


def config_from_env() -> SttRuntimeConfig:
    return SttRuntimeConfig(
        provider=os.getenv("STT_PROVIDER", "upstream-openai"),
        upstream_base_url=os.getenv("STT_UPSTREAM_BASE_URL", os.getenv("DGX_BASE_URL", "http://100.118.82.72:38081")),
        upstream_path=os.getenv("STT_UPSTREAM_PATH", "/v1/audio/transcriptions"),
        upstream_auth_mode=os.getenv("STT_UPSTREAM_AUTH_MODE", "x-llm-token"),
        upstream_token=os.getenv("STT_UPSTREAM_TOKEN", os.getenv("DGX_LLM_SHARED_TOKEN", "")),
        upstream_model=os.getenv("STT_UPSTREAM_MODEL", "whisper-1"),
        upstream_timeout_sec=float(os.getenv("STT_UPSTREAM_TIMEOUT_SEC", "60")),
        local_model=os.getenv("STT_LOCAL_MODEL", "small"),
        local_device=os.getenv("STT_LOCAL_DEVICE", "cpu"),
        local_compute_type=os.getenv("STT_LOCAL_COMPUTE_TYPE", "int8"),
        local_language_default=os.getenv("STT_LOCAL_LANGUAGE_DEFAULT", "ja"),
        local_vad_filter=_env_bool(os.getenv("STT_LOCAL_VAD_FILTER"), True),
        local_retry_without_vad=_env_bool(os.getenv("STT_LOCAL_RETRY_WITHOUT_VAD"), True),
        local_fallback_to_upstream_on_empty=_env_bool(os.getenv("STT_LOCAL_FALLBACK_TO_UPSTREAM_ON_EMPTY"), False),
    )
