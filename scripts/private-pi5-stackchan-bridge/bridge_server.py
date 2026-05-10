#!/usr/bin/env python3
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any
from urllib.parse import urlsplit
from urllib.error import HTTPError, URLError

from dgx_runtime_client import DgxUpstreamClient, config_from_env


LISTEN_HOST = os.getenv("STACKCHAN_BRIDGE_HOST", "0.0.0.0")
LISTEN_PORT = int(os.getenv("STACKCHAN_BRIDGE_PORT", "18080"))

DGX_MODEL = os.getenv("DGX_MODEL", "system-prod-primary")
STACKCHAN_TOKEN = os.getenv("STACKCHAN_TOKEN", "")

_DGX_CLIENT = DgxUpstreamClient(config_from_env())


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


def _extract_reply_text(upstream: dict) -> str:
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


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        sys.stderr.write("[stackchan-bridge] " + fmt % args + "\n")

    def do_GET(self):
        route_path = urlsplit(self.path).path
        if route_path == "/healthz":
            _json_response(self, 200, {"ok": True, "service": "stackchan-private-bridge"})
            return
        _error_response(self, 404, "NOT_FOUND", "endpoint not found")

    def do_POST(self):
        route_path = urlsplit(self.path).path
        raw_paths = {"/api/stackchan/chat", "/api/stackchan/chat/", "/api/system/stackchan/chat", "/api/system/stackchan/chat/"}
        simple_paths = {"/api/stackchan/chat/simple", "/api/stackchan/chat/simple/"}
        if route_path not in raw_paths and route_path not in simple_paths:
            _error_response(self, 404, "NOT_FOUND", "endpoint not found")
            return
        simple_mode = route_path in simple_paths

        if STACKCHAN_TOKEN:
            client_token = self.headers.get("X-Stackchan-Token", "")
            if client_token != STACKCHAN_TOKEN:
                _error_response(self, 401, "UNAUTHORIZED", "invalid stackchan token")
                return

        payload, err = _read_json(self)
        if err:
            _error_response(self, 400, "BAD_REQUEST", err)
            return

        messages = payload.get("messages", [])
        if not isinstance(messages, list) or len(messages) == 0:
            _error_response(self, 400, "BAD_REQUEST", "messages must be non-empty array")
            return

        try:
            max_tokens = int(payload.get("maxTokens", 1024))
            temperature = float(payload.get("temperature", 0.35))
        except (TypeError, ValueError):
            _error_response(self, 400, "BAD_REQUEST", "maxTokens/temperature must be numeric")
            return
        enable_thinking = bool(payload.get("enableThinking", False))

        upstream_body = {
            "model": DGX_MODEL,
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "chat_template_kwargs": {"enable_thinking": enable_thinking},
        }
        req_body = json.dumps(upstream_body, ensure_ascii=False).encode("utf-8")

        auto_start = _DGX_CLIENT.auto_start

        for attempt in range(2):
            try:
                status, parsed = _DGX_CLIENT.post_chat_completions(req_body)
                if simple_mode:
                    reply_text = _extract_reply_text(parsed)
                    _json_response(
                        self,
                        status,
                        {
                            "ok": True,
                            "replyText": reply_text,
                            "model": parsed.get("model"),
                            "usage": parsed.get("usage"),
                            "upstream": parsed,
                        },
                    )
                else:
                    _json_response(self, status, parsed)
                return
            except HTTPError as e:
                body = e.read().decode("utf-8", errors="ignore")
                if attempt == 0 and e.code in (502, 503) and auto_start:
                    ready, runtime_details = _DGX_CLIENT.ensure_runtime_ready()
                    if ready:
                        self.log_message("upstream %s recovered after runtime start", e.code)
                        continue
                    _error_response(
                        self,
                        e.code,
                        "UPSTREAM_HTTP_ERROR",
                        "upstream returned non-2xx after runtime recovery attempt",
                        retryable=True,
                        details={"status": e.code, "body": body[:2000], "runtimeRecovery": runtime_details},
                    )
                    return
                _error_response(
                    self,
                    e.code,
                    "UPSTREAM_HTTP_ERROR",
                    "upstream returned non-2xx",
                    retryable=e.code in (429, 500, 502, 503, 504),
                    details={"status": e.code, "body": body[:2000]},
                )
                return
            except URLError as e:
                if attempt == 0 and auto_start:
                    ready, runtime_details = _DGX_CLIENT.ensure_runtime_ready()
                    if ready:
                        self.log_message("upstream unreachable; recovered after runtime start (%s)", str(e))
                        continue
                    _error_response(
                        self,
                        502,
                        "UPSTREAM_UNREACHABLE",
                        "failed to reach upstream after runtime recovery attempt",
                        retryable=True,
                        details={"message": str(e), "runtimeRecovery": runtime_details},
                    )
                    return
                _error_response(
                    self,
                    502,
                    "UPSTREAM_UNREACHABLE",
                    "failed to reach upstream",
                    retryable=True,
                    details={"message": str(e)},
                )
                return
            except TimeoutError:
                _error_response(self, 504, "UPSTREAM_TIMEOUT", "upstream request timed out", retryable=True)
                return
            except Exception as e:
                _error_response(
                    self,
                    500,
                    "BRIDGE_INTERNAL_ERROR",
                    "unexpected bridge error",
                    retryable=False,
                    details={"message": str(e)},
                )
                return


def main():
    server = HTTPServer((LISTEN_HOST, LISTEN_PORT), Handler)
    print(f"stackchan bridge listening on {LISTEN_HOST}:{LISTEN_PORT}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
