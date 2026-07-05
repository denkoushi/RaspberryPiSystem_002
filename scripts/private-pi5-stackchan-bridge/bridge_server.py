#!/usr/bin/env python3
import base64
import json
import os
import socket
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any, ClassVar
from urllib.parse import urlsplit

from dgx_runtime_client import DgxUpstreamClient, config_from_env
from home_assistant_client import HomeAssistantClient, config_from_env as ha_config_from_env
from stt_bridge_core import SttFailure, SttSuccess, SttWorkflow, ValidatedSttRequest, validate_stt_json_payload
from stt_runtime_client import SttRuntimeClient, config_from_env as stt_config_from_env
from stackchan_chat_core import (
    ChatCompletionWorkflow,
    ChatFailure,
    ChatSuccess,
    ChatValidationConfig,
    format_simple_success,
    validate_openai_compatible_chat_payload,
    validate_chat_payload,
)
from stackchan_utterance_core import (
    UtteranceFailure,
    UtteranceSuccess,
    UtteranceWorkflow,
    format_utterance_success,
    validate_utterance_json_payload,
)

LISTEN_HOST = os.getenv("STACKCHAN_BRIDGE_HOST", "0.0.0.0")
LISTEN_PORT = int(os.getenv("STACKCHAN_BRIDGE_PORT", "18080"))
_request_read_raw = (os.getenv("STACKCHAN_REQUEST_READ_TIMEOUT_SEC") or "").strip()
try:
    REQUEST_READ_TIMEOUT_SEC = float(_request_read_raw) if _request_read_raw else 0.0
except ValueError:
    REQUEST_READ_TIMEOUT_SEC = 0.0

STACKCHAN_TOKEN = os.getenv("STACKCHAN_TOKEN", "")
OPENAI_COMPATIBLE_CHAT_PATHS = {"/v1/chat/completions", "/v1/chat/completions/"}


def _env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    normalized = value.strip().lower()
    if normalized == "":
        return default
    return normalized in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except ValueError:
        return default


CHAT_VALIDATION_CONFIG = ChatValidationConfig(
    default_max_tokens=_env_int("STACKCHAN_CHAT_DEFAULT_MAX_TOKENS", 160),
    max_tokens_cap=_env_int("STACKCHAN_CHAT_MAX_TOKENS_CAP", 192),
    max_messages=_env_int("STACKCHAN_CHAT_MAX_MESSAGES", 8),
    allow_thinking=_env_bool("STACKCHAN_CHAT_ALLOW_THINKING", False),
)


def _default_dgx_model() -> str:
    return os.getenv("DGX_MODEL", "system-prod-primary")


def _json_response(handler: BaseHTTPRequestHandler, status_code: int, payload: dict) -> None:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status_code)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def _error_response(
    handler: BaseHTTPRequestHandler,
    status_code: int,
    code: str,
    message: str,
    retryable: bool = False,
    details: dict | None = None,
) -> None:
    payload: dict[str, Any] = {"ok": False, "error": {"code": code, "message": message, "retryable": retryable}}
    if details:
        payload["error"]["details"] = details
    _json_response(handler, status_code, payload)


def _openai_error_response(
    handler: BaseHTTPRequestHandler,
    status_code: int,
    code: str,
    message: str,
    retryable: bool = False,
    details: dict | None = None,
) -> None:
    if status_code == 401:
        error_type = "authentication_error"
    elif status_code == 408:
        error_type = "timeout_error"
    elif status_code == 429:
        error_type = "rate_limit_error"
    elif status_code >= 500:
        error_type = "server_error"
    else:
        error_type = "invalid_request_error"

    error: dict[str, Any] = {
        "message": message,
        "type": error_type,
        "param": None,
        "code": code,
    }
    if retryable:
        error["retryable"] = True
    if details:
        error["details"] = details
    _json_response(handler, status_code, {"error": error})


def _read_json(handler: BaseHTTPRequestHandler):
    try:
        content_length = int(handler.headers.get("Content-Length", "0"))
    except ValueError:
        return None, "invalid content-length"
    raw = handler.rfile.read(content_length) if content_length > 0 else b""
    if not raw:
        return None, "empty body"
    try:
        return json.loads(raw.decode("utf-8")), None
    except json.JSONDecodeError:
        return None, "invalid json"


def _is_authorized(handler: BaseHTTPRequestHandler) -> bool:
    if not STACKCHAN_TOKEN:
        return True
    client_token = handler.headers.get("X-Stackchan-Token", "")
    if client_token == STACKCHAN_TOKEN:
        return True
    authorization = handler.headers.get("Authorization", "")
    prefix = "Bearer "
    return authorization.startswith(prefix) and authorization[len(prefix) :] == STACKCHAN_TOKEN


class Handler(BaseHTTPRequestHandler):
    """HTTP adapter; DGX behaviour is in ChatCompletionWorkflow + DgxUpstreamClient."""

    dgx_client: ClassVar[DgxUpstreamClient] = DgxUpstreamClient(config_from_env())
    stt_client: ClassVar[SttRuntimeClient] = SttRuntimeClient(stt_config_from_env())
    home_assistant_client: ClassVar[HomeAssistantClient] = HomeAssistantClient(ha_config_from_env())
    dgx_model: ClassVar[str] = _default_dgx_model()

    @classmethod
    def install_upstream(cls, client: DgxUpstreamClient, model: str | None = None) -> None:
        """Override DGX client/model (tests or custom wiring)."""
        cls.dgx_client = client
        if model is not None:
            cls.dgx_model = model

    def log_message(self, fmt, *args):
        sys.stderr.write("[stackchan-bridge] " + fmt % args + "\n")

    def do_GET(self):
        route_path = urlsplit(self.path).path
        if route_path == "/healthz":
            _json_response(self, 200, {"ok": True, "service": "stackchan-private-bridge"})
            return
        _error_response(self, 404, "NOT_FOUND", "endpoint not found")

    def do_POST(self):
        prev_timeout = None
        if REQUEST_READ_TIMEOUT_SEC > 0:
            try:
                prev_timeout = self.connection.gettimeout()
                self.connection.settimeout(REQUEST_READ_TIMEOUT_SEC)
            except (OSError, AttributeError):
                pass
        try:
            self._handle_post()
        except socket.timeout:
            self.log_message("request read timeout after %.1fs", REQUEST_READ_TIMEOUT_SEC)
            try:
                error_response = (
                    _openai_error_response
                    if urlsplit(self.path).path in OPENAI_COMPATIBLE_CHAT_PATHS
                    else _error_response
                )
                error_response(self, 408, "REQUEST_TIMEOUT", "request read timed out")
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                pass
        finally:
            if REQUEST_READ_TIMEOUT_SEC > 0:
                try:
                    self.connection.settimeout(prev_timeout)
                except (OSError, AttributeError):
                    pass

    def _handle_post(self):
        route_path = urlsplit(self.path).path
        raw_paths = {"/api/stackchan/chat", "/api/stackchan/chat/", "/api/system/stackchan/chat", "/api/system/stackchan/chat/"}
        simple_paths = {"/api/stackchan/chat/simple", "/api/stackchan/chat/simple/"}
        stt_paths = {"/api/stackchan/stt", "/api/stackchan/stt/"}
        utterance_paths = {"/api/stackchan/utterance", "/api/stackchan/utterance/"}
        if (
            route_path not in raw_paths
            and route_path not in simple_paths
            and route_path not in OPENAI_COMPATIBLE_CHAT_PATHS
            and route_path not in stt_paths
            and route_path not in utterance_paths
        ):
            _error_response(self, 404, "NOT_FOUND", "endpoint not found")
            return
        simple_mode = route_path in simple_paths
        openai_compatible_mode = route_path in OPENAI_COMPATIBLE_CHAT_PATHS
        stt_mode = route_path in stt_paths
        utterance_mode = route_path in utterance_paths
        error_response = _openai_error_response if openai_compatible_mode else _error_response

        if not _is_authorized(self):
            error_response(self, 401, "UNAUTHORIZED", "invalid stackchan token")
            return

        if utterance_mode:
            content_type = self.headers.get("Content-Type", "")
            if "application/json" in content_type:
                payload, err = _read_json(self)
                if err:
                    _error_response(self, 400, "BAD_REQUEST", err)
                    return
                validated_utt, verr = validate_utterance_json_payload(
                    payload if isinstance(payload, dict) else None,
                    CHAT_VALIDATION_CONFIG,
                )
            else:
                try:
                    content_length = int(self.headers.get("Content-Length", "0"))
                except ValueError:
                    _error_response(self, 400, "BAD_REQUEST", "invalid content-length")
                    return
                raw = self.rfile.read(content_length) if content_length > 0 else b""
                if not raw:
                    _error_response(self, 400, "BAD_REQUEST", "empty body")
                    return
                raw_headers: dict[str, Any] = {
                    "audioBase64": base64.b64encode(raw).decode("ascii"),
                    "contentType": content_type or "audio/wav",
                }
                if lang := self.headers.get("X-Stt-Language"):
                    raw_headers["language"] = lang
                if stt_model := self.headers.get("X-Stt-Model"):
                    raw_headers["sttModel"] = stt_model
                if max_tok := self.headers.get("X-Chat-Max-Tokens"):
                    raw_headers["maxTokens"] = max_tok
                if temp := self.headers.get("X-Chat-Temperature"):
                    raw_headers["temperature"] = temp
                validated_utt, verr = validate_utterance_json_payload(raw_headers, CHAT_VALIDATION_CONFIG)
            if verr or validated_utt is None:
                _error_response(self, 400, "BAD_REQUEST", verr or "bad request")
                return

            utterance_workflow = UtteranceWorkflow(
                SttWorkflow(self.stt_client),
                ChatCompletionWorkflow(self.dgx_client, self.dgx_model, self.home_assistant_client),
            )
            utt_outcome = utterance_workflow.run(validated_utt, log=self.log_message)
            if isinstance(utt_outcome, UtteranceSuccess):
                _json_response(self, utt_outcome.status_code, format_utterance_success(utt_outcome))
                return
            if isinstance(utt_outcome, UtteranceFailure):
                _error_response(
                    self,
                    utt_outcome.http_status,
                    utt_outcome.code,
                    utt_outcome.message,
                    utt_outcome.retryable,
                    {**(utt_outcome.details or {}), "stage": utt_outcome.stage},
                )
                return
            return

        if stt_mode:
            content_type = self.headers.get("Content-Type", "")
            if "application/json" in content_type:
                payload, err = _read_json(self)
                if err:
                    _error_response(self, 400, "BAD_REQUEST", err)
                    return
                validated_stt, verr = validate_stt_json_payload(payload if isinstance(payload, dict) else None)
            else:
                try:
                    content_length = int(self.headers.get("Content-Length", "0"))
                except ValueError:
                    _error_response(self, 400, "BAD_REQUEST", "invalid content-length")
                    return
                raw = self.rfile.read(content_length) if content_length > 0 else b""
                if not raw:
                    _error_response(self, 400, "BAD_REQUEST", "empty body")
                    return
                validated_stt = ValidatedSttRequest(
                    audio_bytes=raw,
                    content_type=content_type or "audio/wav",
                    language=self.headers.get("X-Stt-Language") or None,
                    model=self.headers.get("X-Stt-Model") or None,
                )
                verr = None
            if verr or validated_stt is None:
                _error_response(self, 400, "BAD_REQUEST", verr or "bad request")
                return

            stt_workflow = SttWorkflow(self.stt_client)
            stt_outcome = stt_workflow.run(validated_stt)
            if isinstance(stt_outcome, SttSuccess):
                _json_response(
                    self,
                    200,
                    {
                        "ok": True,
                        "text": stt_outcome.text,
                        "details": stt_outcome.details,
                    },
                )
                return
            if isinstance(stt_outcome, SttFailure):
                _error_response(
                    self,
                    stt_outcome.http_status,
                    stt_outcome.code,
                    stt_outcome.message,
                    stt_outcome.retryable,
                    stt_outcome.details,
                )
                return
            return

        payload, err = _read_json(self)
        if err:
            error_response(self, 400, "BAD_REQUEST", err)
            return
        validator = validate_openai_compatible_chat_payload if openai_compatible_mode else validate_chat_payload
        validated, verr = validator(payload if isinstance(payload, dict) else None, CHAT_VALIDATION_CONFIG)
        if verr or validated is None:
            error_response(self, 400, "BAD_REQUEST", verr or "bad request")
            return

        workflow = ChatCompletionWorkflow(self.dgx_client, self.dgx_model, self.home_assistant_client)
        outcome = workflow.run(validated, log=self.log_message)

        if isinstance(outcome, ChatSuccess):
            if simple_mode:
                _json_response(self, outcome.status_code, format_simple_success(outcome.parsed))
            else:
                _json_response(self, outcome.status_code, outcome.parsed)
            return

        if isinstance(outcome, ChatFailure):
            error_response(
                self,
                outcome.http_status,
                outcome.code,
                outcome.message,
                outcome.retryable,
                outcome.details,
            )
            return


def main():
    Handler.install_upstream(DgxUpstreamClient(config_from_env()), _default_dgx_model())
    Handler.stt_client = SttRuntimeClient(stt_config_from_env())
    Handler.home_assistant_client = HomeAssistantClient(ha_config_from_env())
    server = HTTPServer((LISTEN_HOST, LISTEN_PORT), Handler)
    print(f"stackchan bridge listening on {LISTEN_HOST}:{LISTEN_PORT}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
