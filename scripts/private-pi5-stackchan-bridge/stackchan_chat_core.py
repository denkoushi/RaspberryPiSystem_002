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


class HomeAssistantContextProvider(Protocol):
    def snapshot_lines(self) -> list[str]: ...


@dataclass(frozen=True)
class ValidatedChatRequest:
    messages: list[Any]
    max_tokens: int
    temperature: float
    enable_thinking: bool


@dataclass(frozen=True)
class ChatValidationConfig:
    default_max_tokens: int = 160
    max_tokens_cap: int = 192
    max_messages: int = 8
    allow_thinking: bool = False


def _normalize_message(message: Any) -> dict[str, Any] | None:
    if not isinstance(message, dict):
        return None
    role = message.get("role")
    content = message.get("content")
    if not isinstance(role, str) or role.strip() == "":
        return None
    if not isinstance(content, str) or content.strip() == "":
        return None
    return {"role": role, "content": content}


def _trim_messages(messages: list[dict[str, Any]], max_messages: int) -> list[dict[str, Any]]:
    if max_messages <= 0 or len(messages) <= max_messages:
        return messages
    system_messages = [m for m in messages if m.get("role") == "system"]
    keep_system = system_messages[:1]
    remaining_slots = max(max_messages - len(keep_system), 0)
    non_system = [m for m in messages if m.get("role") != "system"]
    return keep_system + non_system[-remaining_slots:] if remaining_slots > 0 else keep_system


def validate_chat_payload(
    payload: dict[str, Any] | None,
    config: ChatValidationConfig | None = None,
) -> tuple[ValidatedChatRequest | None, str | None]:
    """Validate StackChan JSON body. Returns (request, None) or (None, error_message)."""
    cfg = config or ChatValidationConfig()
    if not isinstance(payload, dict):
        return None, "invalid json payload"
    messages = payload.get("messages", [])
    if not isinstance(messages, list) or len(messages) == 0:
        return None, "messages must be non-empty array"
    normalized_messages = []
    for message in messages:
        normalized = _normalize_message(message)
        if normalized is None:
            return None, "messages must contain role/content strings"
        normalized_messages.append(normalized)
    try:
        max_tokens = int(payload.get("maxTokens", cfg.default_max_tokens))
        temperature = float(payload.get("temperature", 0.35))
    except (TypeError, ValueError):
        return None, "maxTokens/temperature must be numeric"
    if max_tokens <= 0:
        return None, "maxTokens must be positive"
    max_tokens = min(max_tokens, cfg.max_tokens_cap) if cfg.max_tokens_cap > 0 else max_tokens
    enable_thinking = bool(payload.get("enableThinking", False)) and cfg.allow_thinking
    return ValidatedChatRequest(
        messages=_trim_messages(normalized_messages, cfg.max_messages),
        max_tokens=max_tokens,
        temperature=temperature,
        enable_thinking=enable_thinking,
    ), None


def validate_openai_compatible_chat_payload(
    payload: dict[str, Any] | None,
    config: ChatValidationConfig | None = None,
) -> tuple[ValidatedChatRequest | None, str | None]:
    """Validate OpenAI-compatible Chat Completions JSON for StackChan customEndpoint mode."""
    if not isinstance(payload, dict):
        return None, "invalid json payload"
    if payload.get("stream") is True:
        return None, "streaming responses are not supported"

    adapted = dict(payload)
    if "maxTokens" not in adapted:
        if "max_tokens" in adapted:
            adapted["maxTokens"] = adapted["max_tokens"]
        elif "max_completion_tokens" in adapted:
            adapted["maxTokens"] = adapted["max_completion_tokens"]
    return validate_chat_payload(adapted, config)


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

    def __init__(self, dgx: DgxUpstreamClient, model: str, home_assistant: HomeAssistantContextProvider | None = None) -> None:
        self._dgx = dgx
        self._model = model
        self._home_assistant = home_assistant

    def run(self, req: ValidatedChatRequest, log: LogFn | None = None) -> ChatSuccess | ChatFailure:
        request = with_home_assistant_context(req, self._home_assistant, log)
        body = encode_upstream_body(build_upstream_dict(request, self._model))
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


def with_home_assistant_context(
    req: ValidatedChatRequest,
    provider: HomeAssistantContextProvider | None,
    log: LogFn | None = None,
) -> ValidatedChatRequest:
    if provider is None:
        return req
    try:
        lines = provider.snapshot_lines()
    except Exception as e:
        if log:
            log("home assistant context unavailable: %s", str(e))
        return req
    if not lines:
        return req
    context = "Home Assistant current state (read-only):\n" + "\n".join(f"- {line}" for line in lines)
    messages = [{"role": "system", "content": context}] + req.messages
    return ValidatedChatRequest(
        messages=messages,
        max_tokens=req.max_tokens,
        temperature=req.temperature,
        enable_thinking=req.enable_thinking,
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
