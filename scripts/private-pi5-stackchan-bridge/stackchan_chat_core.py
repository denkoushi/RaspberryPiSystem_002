#!/usr/bin/env python3
"""
StackChan ↔ DGX chat bridge: validation + upstream completion workflow.

Keeps HTTP framing in bridge_server.py; this module is testable without BaseHTTPRequestHandler.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Protocol
from urllib.error import HTTPError, URLError

from dgx_runtime_client import DgxUpstreamClient


class LogFn(Protocol):
    def __call__(self, fmt: str, *args: object) -> None: ...


@dataclass(frozen=True)
class ValidatedChatRequest:
    messages: list[Any]
    max_tokens: int
    temperature: float
    enable_thinking: bool


def validate_chat_payload(payload: dict[str, Any] | None) -> tuple[ValidatedChatRequest | None, str | None]:
    """Validate StackChan JSON body. Returns (request, None) or (None, error_message)."""
    if not isinstance(payload, dict):
        return None, "invalid json payload"
    messages = payload.get("messages", [])
    if not isinstance(messages, list) or len(messages) == 0:
        return None, "messages must be non-empty array"
    try:
        max_tokens = int(payload.get("maxTokens", 1024))
        temperature = float(payload.get("temperature", 0.35))
    except (TypeError, ValueError):
        return None, "maxTokens/temperature must be numeric"
    enable_thinking = bool(payload.get("enableThinking", False))
    return ValidatedChatRequest(
        messages=messages,
        max_tokens=max_tokens,
        temperature=temperature,
        enable_thinking=enable_thinking,
    ), None


def build_upstream_dict(req: ValidatedChatRequest, model: str) -> dict[str, Any]:
    return {
        "model": model,
        "messages": req.messages,
        "max_tokens": req.max_tokens,
        "temperature": req.temperature,
        "chat_template_kwargs": {"enable_thinking": req.enable_thinking},
    }


def encode_upstream_body(upstream_dict: dict[str, Any]) -> bytes:
    return json.dumps(upstream_dict, ensure_ascii=False).encode("utf-8")


def extract_reply_text(upstream: dict[str, Any]) -> str:
    choices = upstream.get("choices")
    if not isinstance(choices, list) or not choices:
        return ""
    first = choices[0]
    if not isinstance(first, dict):
        return ""
    message = first.get("message")
    if not isinstance(message, dict):
        return ""
    content = message.get("content")
    if isinstance(content, str):
        return content.strip()
    return ""


@dataclass(frozen=True)
class ChatSuccess:
    status_code: int
    parsed: dict[str, Any]


@dataclass(frozen=True)
class ChatFailure:
    http_status: int
    code: str
    message: str
    retryable: bool
    details: dict[str, Any] | None = None


class ChatCompletionWorkflow:
    """Runs chat completion against DGX with optional auto-start recovery (delegated to client)."""

    def __init__(self, dgx: DgxUpstreamClient, model: str) -> None:
        self._dgx = dgx
        self._model = model

    def run(self, req: ValidatedChatRequest, log: LogFn | None = None) -> ChatSuccess | ChatFailure:
        body = encode_upstream_body(build_upstream_dict(req, self._model))
        auto_start = self._dgx.auto_start

        for attempt in range(2):
            try:
                status, parsed = self._dgx.post_chat_completions(body)
                return ChatSuccess(status_code=status, parsed=parsed)
            except HTTPError as e:
                err_body = e.read().decode("utf-8", errors="ignore")
                if attempt == 0 and e.code in (502, 503) and auto_start:
                    ready, runtime_details = self._dgx.ensure_runtime_ready()
                    if ready:
                        if log:
                            log("upstream %s recovered after runtime start", e.code)
                        continue
                    return ChatFailure(
                        e.code,
                        "UPSTREAM_HTTP_ERROR",
                        "upstream returned non-2xx after runtime recovery attempt",
                        True,
                        {"status": e.code, "body": err_body[:2000], "runtimeRecovery": runtime_details},
                    )
                return ChatFailure(
                    e.code,
                    "UPSTREAM_HTTP_ERROR",
                    "upstream returned non-2xx",
                    e.code in (429, 500, 502, 503, 504),
                    {"status": e.code, "body": err_body[:2000]},
                )
            except URLError as e:
                if attempt == 0 and auto_start:
                    ready, runtime_details = self._dgx.ensure_runtime_ready()
                    if ready:
                        if log:
                            log("upstream unreachable; recovered after runtime start (%s)", str(e))
                        continue
                    return ChatFailure(
                        502,
                        "UPSTREAM_UNREACHABLE",
                        "failed to reach upstream after runtime recovery attempt",
                        True,
                        {"message": str(e), "runtimeRecovery": runtime_details},
                    )
                return ChatFailure(
                    502,
                    "UPSTREAM_UNREACHABLE",
                    "failed to reach upstream",
                    True,
                    {"message": str(e)},
                )
            except TimeoutError:
                return ChatFailure(504, "UPSTREAM_TIMEOUT", "upstream request timed out", True, None)
            except Exception as e:
                return ChatFailure(
                    500,
                    "BRIDGE_INTERNAL_ERROR",
                    "unexpected bridge error",
                    False,
                    {"message": str(e)},
                )

def format_simple_success(parsed: dict[str, Any]) -> dict[str, Any]:
    reply_text = extract_reply_text(parsed)
    return {
        "ok": True,
        "replyText": reply_text,
        "model": parsed.get("model"),
        "usage": parsed.get("usage"),
        "upstream": parsed,
    }
