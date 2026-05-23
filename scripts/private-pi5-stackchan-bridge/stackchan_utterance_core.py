#!/usr/bin/env python3
"""
StackChan utterance workflow: STT (Spark or local) -> DGX chat -> replyText.

Keeps HTTP framing in bridge_server.py; testable without BaseHTTPRequestHandler.
"""

from __future__ import annotations

import base64
from dataclasses import dataclass
from typing import Any, Protocol

from stackchan_chat_core import (
    ChatCompletionWorkflow,
    ChatFailure,
    ChatSuccess,
    ChatValidationConfig,
    ValidatedChatRequest,
    extract_reply_text,
    format_simple_success,
    validate_chat_payload,
)
from stt_bridge_core import SttFailure, SttSuccess, SttWorkflow, ValidatedSttRequest


class LogFn(Protocol):
    def __call__(self, fmt: str, *args: object) -> None: ...


@dataclass(frozen=True)
class ValidatedUtteranceRequest:
    audio_bytes: bytes
    content_type: str
    language: str | None
    stt_model: str | None
    chat: ValidatedChatRequest
    prior_messages: list[dict[str, Any]]


@dataclass(frozen=True)
class UtteranceSuccess:
    status_code: int
    stt_text: str
    stt_details: dict[str, Any]
    chat_parsed: dict[str, Any]


@dataclass(frozen=True)
class UtteranceFailure:
    http_status: int
    code: str
    message: str
    retryable: bool
    details: dict[str, Any] | None = None
    stage: str = "unknown"


def validate_utterance_json_payload(
    payload: dict[str, Any] | None,
    chat_config: ChatValidationConfig | None = None,
) -> tuple[ValidatedUtteranceRequest | None, str | None]:
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
    if "maxTokens" in payload:
        chat_payload["maxTokens"] = payload.get("maxTokens")
    if "temperature" in payload:
        chat_payload["temperature"] = payload.get("temperature")
    if "enableThinking" in payload:
        chat_payload["enableThinking"] = payload.get("enableThinking")
    # Placeholder user line; replaced after STT in workflow.
    chat_payload["messages"].append({"role": "user", "content": "."})
    validated_chat, verr = validate_chat_payload(chat_payload, chat_config)
    if verr or validated_chat is None:
        return None, verr or "invalid chat options"

    return (
        ValidatedUtteranceRequest(
            audio_bytes=audio_bytes,
            content_type=content_type if isinstance(content_type, str) else "audio/wav",
            language=language,
            stt_model=stt_model,
            chat=validated_chat,
            prior_messages=normalized_prior,
        ),
        None,
    )


def build_chat_request_after_stt(prior: list[dict[str, Any]], stt_text: str, chat: ValidatedChatRequest) -> ValidatedChatRequest:
    messages = list(prior) + [{"role": "user", "content": stt_text}]
    return ValidatedChatRequest(
        messages=messages,
        max_tokens=chat.max_tokens,
        temperature=chat.temperature,
        enable_thinking=chat.enable_thinking,
    )


class UtteranceWorkflow:
    def __init__(
        self,
        stt_workflow: SttWorkflow,
        chat_workflow: ChatCompletionWorkflow,
    ) -> None:
        self._stt = stt_workflow
        self._chat = chat_workflow

    def run(self, req: ValidatedUtteranceRequest, log: LogFn | None = None) -> UtteranceSuccess | UtteranceFailure:
        stt_outcome = self._stt.run(
            ValidatedSttRequest(
                audio_bytes=req.audio_bytes,
                content_type=req.content_type,
                language=req.language,
                model=req.stt_model,
            )
        )
        if isinstance(stt_outcome, SttFailure):
            return UtteranceFailure(
                stt_outcome.http_status,
                stt_outcome.code,
                stt_outcome.message,
                stt_outcome.retryable,
                stt_outcome.details,
                stage="stt",
            )
        stt_text = stt_outcome.text.strip()
        if stt_text == "":
            return UtteranceFailure(
                422,
                "STT_EMPTY",
                "speech recognition returned empty text",
                True,
                stt_outcome.details,
                stage="stt",
            )

        chat_req = build_chat_request_after_stt(req.prior_messages, stt_text, req.chat)
        chat_outcome = self._chat.run(chat_req, log=log)
        if isinstance(chat_outcome, ChatFailure):
            return UtteranceFailure(
                chat_outcome.http_status,
                chat_outcome.code,
                chat_outcome.message,
                chat_outcome.retryable,
                chat_outcome.details,
                stage="chat",
            )

        reply = extract_reply_text(chat_outcome.parsed)
        if reply == "":
            return UtteranceFailure(
                502,
                "UPSTREAM_EMPTY_REPLY",
                "upstream chat returned empty replyText",
                True,
                {"sttText": stt_text},
                stage="chat",
            )

        return UtteranceSuccess(
            status_code=chat_outcome.status_code,
            stt_text=stt_text,
            stt_details=stt_outcome.details,
            chat_parsed=chat_outcome.parsed,
        )


def format_utterance_success(success: UtteranceSuccess) -> dict[str, Any]:
    simple = format_simple_success(success.chat_parsed)
    return {
        "ok": True,
        "sttText": success.stt_text,
        "replyText": simple.get("replyText", ""),
        "model": simple.get("model"),
        "usage": simple.get("usage"),
        "stt": success.stt_details,
        "upstream": simple.get("upstream"),
    }
