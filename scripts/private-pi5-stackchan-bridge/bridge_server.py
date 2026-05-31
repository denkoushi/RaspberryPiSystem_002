#!/usr/bin/env python3
import base64
import json
import os
import socket
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from socketserver import ThreadingMixIn
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
    validate_chat_payload,
)
from stackchan_utterance_core import (
    UtteranceFailure,
    UtteranceSuccess,
    UtteranceWorkflow,
    format_utterance_success,
    validate_utterance_json_payload,
)
from audio_artifact_store import AudioArtifactStore
from stackchan_device_client import StackChanDeviceClient, config_from_env as device_config_from_env
from voice_assistant_core import (
    VoiceTurnFailure,
    VoiceTurnSuccess,
    VoiceTurnWorkflow,
    format_voice_turn_success,
    resolve_public_audio_base_url,
    validate_voice_turn_json_payload,
    voice_turn_max_audio_bytes,
    voice_turn_max_json_body_bytes,
)
from voicevox_client import VoicevoxClient, config_from_env as voicevox_config_from_env

LISTEN_HOST = os.getenv("STACKCHAN_BRIDGE_HOST", "0.0.0.0")
LISTEN_PORT = int(os.getenv("STACKCHAN_BRIDGE_PORT", "18080"))
_request_read_raw = (os.getenv("STACKCHAN_REQUEST_READ_TIMEOUT_SEC") or "").strip()
try:
    REQUEST_READ_TIMEOUT_SEC = float(_request_read_raw) if _request_read_raw else 0.0
except ValueError:
    REQUEST_READ_TIMEOUT_SEC = 0.0

STACKCHAN_TOKEN = os.getenv("STACKCHAN_TOKEN", "")


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


def _voice_turn_error_response(handler: BaseHTTPRequestHandler, message: str) -> None:
    if "exceeds limit" in message:
        _error_response(handler, 413, "PAYLOAD_TOO_LARGE", message)
    else:
        _error_response(handler, 400, "BAD_REQUEST", message)


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


class ThreadingHTTPServer(ThreadingMixIn, HTTPServer):
    """Allow concurrent GET /api/stackchan/audio while POST /voice-turn is in flight."""

    daemon_threads = True


class Handler(BaseHTTPRequestHandler):
    """HTTP adapter; DGX behaviour is in ChatCompletionWorkflow + DgxUpstreamClient."""

    dgx_client: ClassVar[DgxUpstreamClient] = DgxUpstreamClient(config_from_env())
    stt_client: ClassVar[SttRuntimeClient] = SttRuntimeClient(stt_config_from_env())
    home_assistant_client: ClassVar[HomeAssistantClient] = HomeAssistantClient(ha_config_from_env())
    voicevox_client: ClassVar[VoicevoxClient] = VoicevoxClient(voicevox_config_from_env())
    device_client: ClassVar[StackChanDeviceClient] = StackChanDeviceClient(device_config_from_env())
    audio_store: ClassVar[AudioArtifactStore] = AudioArtifactStore()
    dgx_model: ClassVar[str] = _default_dgx_model()
    public_audio_base_url: ClassVar[str | None] = resolve_public_audio_base_url(LISTEN_HOST, LISTEN_PORT)

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
        if route_path.startswith("/api/stackchan/audio/") and route_path.endswith(".wav"):
            audio_id = route_path.removeprefix("/api/stackchan/audio/").removesuffix(".wav")
            artifact = self.audio_store.get(audio_id)
            if artifact is None:
                _error_response(self, 404, "NOT_FOUND", "audio artifact not found or expired")
                return
            self.send_response(200)
            self.send_header("Content-Type", artifact.content_type)
            self.send_header("Content-Length", str(len(artifact.wav_bytes)))
            self.end_headers()
            self.wfile.write(artifact.wav_bytes)
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
                _error_response(self, 408, "REQUEST_TIMEOUT", "request read timed out")
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
        voice_turn_paths = {
            "/api/stackchan/voice-turn",
            "/api/stackchan/voice-turn/",
            "/api/stackchan/audio-capture",
            "/api/stackchan/audio-capture/",
        }
        if (
            route_path not in raw_paths
            and route_path not in simple_paths
            and route_path not in stt_paths
            and route_path not in utterance_paths
            and route_path not in voice_turn_paths
        ):
            _error_response(self, 404, "NOT_FOUND", "endpoint not found")
            return
        simple_mode = route_path in simple_paths
        stt_mode = route_path in stt_paths
        utterance_mode = route_path in utterance_paths
        voice_turn_mode = route_path in voice_turn_paths

        if STACKCHAN_TOKEN:
            client_token = self.headers.get("X-Stackchan-Token", "")
            if client_token != STACKCHAN_TOKEN:
                _error_response(self, 401, "UNAUTHORIZED", "invalid stackchan token")
                return

        if voice_turn_mode:
            max_audio = voice_turn_max_audio_bytes()
            try:
                declared_length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                _error_response(self, 400, "BAD_REQUEST", "invalid content-length")
                return

            content_type = self.headers.get("Content-Type", "")
            is_json_voice = "application/json" in content_type
            if is_json_voice:
                json_cap = voice_turn_max_json_body_bytes()
                if declared_length > json_cap:
                    _error_response(
                        self,
                        413,
                        "PAYLOAD_TOO_LARGE",
                        f"json body exceeds limit ({json_cap} bytes); decoded audio limit is {max_audio} bytes",
                    )
                    return
            elif declared_length > max_audio:
                _error_response(
                    self,
                    413,
                    "PAYLOAD_TOO_LARGE",
                    f"audio payload exceeds limit ({max_audio} bytes)",
                )
                return

            if is_json_voice:
                payload, err = _read_json(self)
                if err:
                    _error_response(self, 400, "BAD_REQUEST", err)
                    return
                validated_voice, verr = validate_voice_turn_json_payload(
                    payload if isinstance(payload, dict) else None,
                    CHAT_VALIDATION_CONFIG,
                )
            else:
                raw = self.rfile.read(declared_length) if declared_length > 0 else b""
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
                if emotion := self.headers.get("X-Voice-Emotion"):
                    raw_headers["emotion"] = emotion
                trigger = self.headers.get("X-Trigger-Device-Playback", "true")
                raw_headers["triggerDevicePlayback"] = trigger.strip().lower() not in {
                    "0",
                    "false",
                    "no",
                    "off",
                }
                validated_voice, verr = validate_voice_turn_json_payload(raw_headers, CHAT_VALIDATION_CONFIG)
            if verr or validated_voice is None:
                _voice_turn_error_response(self, verr or "bad request")
                return

            voice_workflow = VoiceTurnWorkflow(
                SttWorkflow(self.stt_client),
                ChatCompletionWorkflow(self.dgx_client, self.dgx_model, self.home_assistant_client),
                self.voicevox_client,
                self.audio_store,
                self.device_client,
                self.public_audio_base_url,
            )
            voice_outcome = voice_workflow.run(validated_voice, log=self.log_message)
            if isinstance(voice_outcome, VoiceTurnSuccess):
                _json_response(self, voice_outcome.status_code, format_voice_turn_success(voice_outcome))
                return
            if isinstance(voice_outcome, VoiceTurnFailure):
                _error_response(
                    self,
                    voice_outcome.http_status,
                    voice_outcome.code,
                    voice_outcome.message,
                    voice_outcome.retryable,
                    {**(voice_outcome.details or {}), "stage": voice_outcome.stage},
                )
                return
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
            _error_response(self, 400, "BAD_REQUEST", err)
            return
        validated, verr = validate_chat_payload(payload if isinstance(payload, dict) else None, CHAT_VALIDATION_CONFIG)
        if verr or validated is None:
            _error_response(self, 400, "BAD_REQUEST", verr or "bad request")
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
            _error_response(
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
    Handler.voicevox_client = VoicevoxClient(voicevox_config_from_env())
    Handler.device_client = StackChanDeviceClient(device_config_from_env())
    Handler.audio_store = AudioArtifactStore()
    Handler.public_audio_base_url = resolve_public_audio_base_url(LISTEN_HOST, LISTEN_PORT)
    server = ThreadingHTTPServer((LISTEN_HOST, LISTEN_PORT), Handler)
    print(f"stackchan bridge listening on {LISTEN_HOST}:{LISTEN_PORT}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
