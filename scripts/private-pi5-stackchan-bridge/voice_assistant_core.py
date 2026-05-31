#!/usr/bin/env python3
"""
Voice turn orchestration: STT -> DGX chat -> Pi5 VOICEVOX -> optional StackChan playback.

HTTP framing stays in bridge_server.py; this module is unit-testable.
"""

from __future__ import annotations

import base64
import os
from dataclasses import dataclass
from typing import Any, Protocol
from urllib.parse import urljoin

from stackchan_chat_core import (
    ChatCompletionWorkflow,
    ChatFailure,
    ChatSuccess,
    ChatValidationConfig,
    ValidatedChatRequest,
    extract_reply_text,
    validate_chat_payload,
)
from stt_bridge_core import SttFailure, SttSuccess, SttWorkflow, ValidatedSttRequest

from audio_artifact_store import AudioArtifactStore
from stackchan_device_client import StackChanDeviceClient
from voicevox_client import VoicevoxClient


class LogFn(Protocol):
    def __call__(self, fmt: str, *args: object) -> None: ...


class AudioStoreLike(Protocol):
    def put(self, wav_bytes: bytes, content_type: str = "audio/wav") -> str: ...


class DeviceClientLike(Protocol):
    @property
    def enabled(self) -> bool: ...

    def set_state(self, state: str) -> tuple[bool, str]: ...
    def playback(self, *, audio_url: str | None, reply_text: str) -> tuple[bool, str]: ...


class VoicevoxLike(Protocol):
    @property
    def enabled(self) -> bool: ...

    def synthesize_wav(self, text: str) -> bytes: ...


@dataclass(frozen=True)
class ValidatedVoiceTurnRequest:
    audio_bytes: bytes
    content_type: str
    language: str | None
    stt_model: str | None
    prior_messages: list[dict[str, Any]]
    chat: ValidatedChatRequest
    emotion: str
    trigger_device_playback: bool


@dataclass(frozen=True)
class VoiceTurnSuccess:
    status_code: int
    stt_text: str
    reply_text: str
    audio_id: str
    audio_url: str
    emotion: str
    stt_details: dict[str, Any]
    device_playback_ok: bool
    device_playback_detail: str
    upstream_model: str | None


@dataclass(frozen=True)
class VoiceTurnFailure:
    http_status: int
    code: str
    message: str
    retryable: bool
    details: dict[str, Any] | None = None
    stage: str = "unknown"


def voice_turn_max_audio_bytes() -> int:
    raw = (os.getenv("VOICE_TURN_MAX_AUDIO_BYTES") or "").strip()
    if not raw:
        return 2 * 1024 * 1024
    try:
        return max(1, int(raw))
    except ValueError:
        return 2 * 1024 * 1024


def voice_turn_max_json_body_bytes() -> int:
    """HTTP JSON envelope cap (base64 overhead). Decoded audio still capped by voice_turn_max_audio_bytes."""
    raw = (os.getenv("VOICE_TURN_MAX_JSON_BODY_BYTES") or "").strip()
    if raw:
        try:
            return max(1, int(raw))
        except ValueError:
            pass
    audio_cap = voice_turn_max_audio_bytes()
    return max(audio_cap * 4, 8 * 1024 * 1024)


def validate_voice_turn_json_payload(
    payload: dict[str, Any] | None,
    chat_config: ChatValidationConfig | None = None,
) -> tuple[ValidatedVoiceTurnRequest | None, str | None]:
    if not isinstance(payload, dict):
        return None, "invalid json payload"
    audio_b64 = payload.get("audioBase64")
    if not isinstance(audio_b64, str) or not audio_b64.strip():
        return None, "audioBase64 is required"
    try:
        audio_bytes = base64.b64decode(audio_b64, validate=True)
    except Exception:
        return None, "audioBase64 must be valid base64"
    if len(audio_bytes) == 0:
        return None, "audio payload is empty"
    max_bytes = voice_turn_max_audio_bytes()
    if len(audio_bytes) > max_bytes:
        return None, f"audio payload exceeds limit ({max_bytes} bytes)"

    content_type = payload.get("contentType", "audio/wav")
    language = payload.get("language")
    stt_model = payload.get("sttModel", payload.get("model"))
    if language is not None and not isinstance(language, str):
        return None, "language must be string"
    if stt_model is not None and not isinstance(stt_model, str):
        return None, "sttModel must be string"

    prior_messages = payload.get("messages", [])
    if prior_messages is None:
        prior_messages = []
    if not isinstance(prior_messages, list):
        return None, "messages must be array when provided"

    normalized_prior: list[dict[str, Any]] = []
    for message in prior_messages:
        if not isinstance(message, dict):
            return None, "messages must contain objects"
        role = message.get("role")
        content = message.get("content")
        if not isinstance(role, str) or not isinstance(content, str) or not content.strip():
            return None, "messages must contain role/content strings"
        normalized_prior.append({"role": role, "content": content.strip()})

    chat_payload: dict[str, Any] = {"messages": list(normalized_prior)}
    for key in ("maxTokens", "temperature", "enableThinking"):
        if key in payload:
            chat_payload[key] = payload.get(key)
    chat_payload["messages"].append({"role": "user", "content": "."})
    validated_chat, verr = validate_chat_payload(chat_payload, chat_config)
    if verr or validated_chat is None:
        return None, verr or "invalid chat options"

    emotion = payload.get("emotion", "neutral")
    if not isinstance(emotion, str) or not emotion.strip():
        emotion = "neutral"
    trigger = payload.get("triggerDevicePlayback", True)
    if not isinstance(trigger, bool):
        trigger = str(trigger).strip().lower() in {"1", "true", "yes", "on"}

    return (
        ValidatedVoiceTurnRequest(
            audio_bytes=audio_bytes,
            content_type=content_type if isinstance(content_type, str) else "audio/wav",
            language=language,
            stt_model=stt_model,
            prior_messages=normalized_prior,
            chat=validated_chat,
            emotion=emotion.strip(),
            trigger_device_playback=trigger,
        ),
        None,
    )


def build_chat_request_after_stt(
    prior: list[dict[str, Any]], stt_text: str, chat: ValidatedChatRequest
) -> ValidatedChatRequest:
    messages = list(prior) + [{"role": "user", "content": stt_text}]
    return ValidatedChatRequest(
        messages=messages,
        max_tokens=chat.max_tokens,
        temperature=chat.temperature,
        enable_thinking=chat.enable_thinking,
    )


def public_audio_url(audio_id: str, public_base: str | None) -> str:
    if not public_base or not public_base.strip():
        return ""
    base = public_base.rstrip("/")
    return urljoin(base + "/", f"api/stackchan/audio/{audio_id}.wav")


def is_loopback_bridge_audio_url(audio_url: str, public_base: str | None) -> bool:
    """True when StackChan must GET this URL from the same Pi5 bridge still handling POST /voice-turn."""
    if not audio_url.strip() or not public_base:
        return False
    return audio_url.rstrip("/").startswith(public_base.rstrip("/"))


class VoiceTurnWorkflow:
    def __init__(
        self,
        stt_workflow: SttWorkflow,
        chat_workflow: ChatCompletionWorkflow,
        voicevox: VoicevoxLike,
        audio_store: AudioStoreLike,
        device_client: DeviceClientLike,
        public_audio_base_url: str | None,
    ) -> None:
        self._stt = stt_workflow
        self._chat = chat_workflow
        self._voicevox = voicevox
        self._audio_store = audio_store
        self._device = device_client
        self._public_audio_base_url = (public_audio_base_url or "").strip() or None

    def run(self, req: ValidatedVoiceTurnRequest, log: LogFn | None = None) -> VoiceTurnSuccess | VoiceTurnFailure:
        if self._device.enabled:
            self._device.set_state("listening")

        stt_outcome = self._stt.run(
            ValidatedSttRequest(
                audio_bytes=req.audio_bytes,
                content_type=req.content_type,
                language=req.language,
                model=req.stt_model,
            )
        )
        if isinstance(stt_outcome, SttFailure):
            if self._device.enabled:
                self._device.set_state("error")
            return VoiceTurnFailure(
                stt_outcome.http_status,
                stt_outcome.code,
                stt_outcome.message,
                stt_outcome.retryable,
                stt_outcome.details,
                stage="stt",
            )

        stt_text = stt_outcome.text.strip()
        if stt_text == "":
            if self._device.enabled:
                self._device.set_state("error")
            return VoiceTurnFailure(
                422,
                "STT_EMPTY",
                "speech recognition returned empty text",
                True,
                stt_outcome.details,
                stage="stt",
            )

        if self._device.enabled:
            self._device.set_state("thinking")

        chat_req = build_chat_request_after_stt(req.prior_messages, stt_text, req.chat)
        chat_outcome = self._chat.run(chat_req, log=log)
        if isinstance(chat_outcome, ChatFailure):
            if self._device.enabled:
                self._device.set_state("error")
            return VoiceTurnFailure(
                chat_outcome.http_status,
                chat_outcome.code,
                chat_outcome.message,
                chat_outcome.retryable,
                chat_outcome.details,
                stage="chat",
            )

        reply_text = extract_reply_text(chat_outcome.parsed)
        if reply_text == "":
            if self._device.enabled:
                self._device.set_state("error")
            return VoiceTurnFailure(
                502,
                "UPSTREAM_EMPTY_REPLY",
                "upstream chat returned empty replyText",
                True,
                {"sttText": stt_text},
                stage="chat",
            )

        audio_id = ""
        audio_url = ""
        tts_used_speech_fallback = False
        if self._voicevox.enabled:
            try:
                if self._device.enabled:
                    self._device.set_state("speaking")
                wav_bytes = self._voicevox.synthesize_wav(reply_text)
                audio_id = self._audio_store.put(wav_bytes)
                if self._public_audio_base_url:
                    audio_url = public_audio_url(audio_id, self._public_audio_base_url)
                elif log:
                    log("VOICE_AUDIO_PUBLIC_BASE_URL unset; skipping audioUrl (use /speech fallback)")
            except Exception as e:
                if log:
                    log("voicevox synthesis failed, using speech fallback: %s", str(e))
                tts_used_speech_fallback = True

        device_ok = False
        device_detail = "device playback skipped"
        if req.trigger_device_playback and self._device.enabled:
            playback_url = audio_url or None
            if playback_url and is_loopback_bridge_audio_url(playback_url, self._public_audio_base_url):
                device_ok = True
                device_detail = "deferred loopback audioUrl to device (GET after voice-turn response)"
            else:
                if tts_used_speech_fallback or (not playback_url and reply_text):
                    playback_url = None
                device_ok, device_detail = self._device.playback(
                    audio_url=playback_url, reply_text=reply_text
                )
            if not device_ok and log:
                log("device playback failed: %s", device_detail)
        elif req.trigger_device_playback and not self._device.enabled:
            device_detail = "STACKCHAN_DEVICE_CONTROL_ENABLED=false"

        if self._device.enabled:
            self._device.set_state("idle")

        return VoiceTurnSuccess(
            status_code=chat_outcome.status_code,
            stt_text=stt_text,
            reply_text=reply_text,
            audio_id=audio_id,
            audio_url=audio_url,
            emotion=req.emotion,
            stt_details=stt_outcome.details,
            device_playback_ok=device_ok,
            device_playback_detail=device_detail,
            upstream_model=chat_outcome.parsed.get("model") if isinstance(chat_outcome.parsed, dict) else None,
        )


def format_voice_turn_success(success: VoiceTurnSuccess) -> dict[str, Any]:
    return {
        "ok": True,
        "sttText": success.stt_text,
        "replyText": success.reply_text,
        "emotion": success.emotion,
        "audioId": success.audio_id,
        "audioUrl": success.audio_url,
        "model": success.upstream_model,
        "stt": success.stt_details,
        "devicePlayback": {
            "ok": success.device_playback_ok,
            "detail": success.device_playback_detail,
        },
    }


def resolve_public_audio_base_url(listen_host: str, listen_port: int) -> str | None:
    """LAN-reachable base URL for StackChan to GET synthesized WAV. None = no audioUrl."""
    override = (os.getenv("VOICE_AUDIO_PUBLIC_BASE_URL") or "").strip()
    if override:
        return override.rstrip("/")
    public_host = (os.getenv("VOICE_AUDIO_PUBLIC_HOST") or "").strip()
    if public_host:
        return f"http://{public_host}:{listen_port}".rstrip("/")
    host = listen_host.strip()
    if host and host not in {"0.0.0.0", "::"}:
        return f"http://{host}:{listen_port}"
    return None


def default_public_audio_base_url(listen_host: str, listen_port: int) -> str | None:
    return resolve_public_audio_base_url(listen_host, listen_port)
