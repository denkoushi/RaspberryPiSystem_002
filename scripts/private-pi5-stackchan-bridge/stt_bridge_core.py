#!/usr/bin/env python3
"""
STT payload validation and workflow for stackchan-bridge.
"""

from __future__ import annotations

import base64
from dataclasses import dataclass
from typing import Any, Protocol
from urllib.error import HTTPError, URLError


class SttClientLike(Protocol):
    def transcribe(self, audio_bytes: bytes, content_type: str, language: str | None, model: str | None) -> tuple[str, dict[str, Any]]: ...


@dataclass(frozen=True)
class ValidatedSttRequest:
    audio_bytes: bytes
    content_type: str
    language: str | None
    model: str | None


@dataclass(frozen=True)
class SttSuccess:
    text: str
    details: dict[str, Any]


@dataclass(frozen=True)
class SttFailure:
    http_status: int
    code: str
    message: str
    retryable: bool
    details: dict[str, Any] | None = None


def validate_stt_json_payload(payload: dict[str, Any] | None) -> tuple[ValidatedSttRequest | None, str | None]:
    if not isinstance(payload, dict):
        return None, "invalid json payload"
    audio_b64 = payload.get("audioBase64")
    if not isinstance(audio_b64, str) or audio_b64.strip() == "":
        return None, "audioBase64 is required"
    try:
        audio_bytes = base64.b64decode(audio_b64, validate=True)
    except Exception:
        return None, "audioBase64 must be valid base64"
    if len(audio_bytes) == 0:
        return None, "audio payload is empty"
    content_type = payload.get("contentType", "audio/wav")
    language = payload.get("language")
    model = payload.get("model")
    if language is not None and not isinstance(language, str):
        return None, "language must be string"
    if model is not None and not isinstance(model, str):
        return None, "model must be string"
    return (
        ValidatedSttRequest(
            audio_bytes=audio_bytes,
            content_type=content_type if isinstance(content_type, str) else "audio/wav",
            language=language,
            model=model,
        ),
        None,
    )


class SttWorkflow:
    def __init__(self, client: SttClientLike) -> None:
        self._client = client

    def run(self, req: ValidatedSttRequest) -> SttSuccess | SttFailure:
        try:
            text, details = self._client.transcribe(
                audio_bytes=req.audio_bytes,
                content_type=req.content_type,
                language=req.language,
                model=req.model,
            )
            return SttSuccess(text=text, details=details)
        except HTTPError as e:
            return SttFailure(
                http_status=e.code,
                code="STT_UPSTREAM_HTTP_ERROR",
                message="stt upstream returned non-2xx",
                retryable=e.code in (429, 500, 502, 503, 504),
                details={"status": e.code},
            )
        except URLError as e:
            return SttFailure(
                http_status=502,
                code="STT_UPSTREAM_UNREACHABLE",
                message="failed to reach stt upstream",
                retryable=True,
                details={"message": str(e)},
            )
        except TimeoutError:
            return SttFailure(
                http_status=504,
                code="STT_UPSTREAM_TIMEOUT",
                message="stt request timed out",
                retryable=True,
            )
        except Exception as e:
            return SttFailure(
                http_status=500,
                code="STT_BRIDGE_INTERNAL_ERROR",
                message="unexpected stt bridge error",
                retryable=False,
                details={"message": str(e)},
            )
