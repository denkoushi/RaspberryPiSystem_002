#!/usr/bin/env python3
"""
DGX system-prod 用のローカル gateway。

- /healthz は 200 ok
- /start /stop は runtime control へ転送
- /v1/* は llama-server へ転送

環境変数:
  LLM_SHARED_TOKEN            必須
  LLM_RUNTIME_CONTROL_TOKEN   必須
  EMBEDDING_API_KEY           任意
  GATEWAY_LISTEN_HOST         既定: 127.0.0.1
  GATEWAY_LISTEN_PORT         既定: 38081
  LLAMA_SERVER_BASE_URL       既定: http://127.0.0.1:38082
  RUNTIME_CONTROL_BASE_URL    既定: http://127.0.0.1:39090
  EMBEDDING_BASE_URL          既定: http://127.0.0.1:38100
"""

from __future__ import annotations

import os
import sys
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


LLM_SHARED_TOKEN = (os.environ.get("LLM_SHARED_TOKEN") or "").strip()
RUNTIME_CONTROL_TOKEN = (os.environ.get("LLM_RUNTIME_CONTROL_TOKEN") or "").strip()
HOST = (os.environ.get("GATEWAY_LISTEN_HOST") or "127.0.0.1").strip()
PORT = int((os.environ.get("GATEWAY_LISTEN_PORT") or "38081").strip())
LLAMA_SERVER_BASE_URL = (os.environ.get("LLAMA_SERVER_BASE_URL") or "http://127.0.0.1:38082").rstrip("/")
RUNTIME_CONTROL_BASE_URL = (os.environ.get("RUNTIME_CONTROL_BASE_URL") or "http://127.0.0.1:39090").rstrip("/")
EMBEDDING_API_KEY = (os.environ.get("EMBEDDING_API_KEY") or "").strip()
EMBEDDING_BASE_URL = (os.environ.get("EMBEDDING_BASE_URL") or "http://127.0.0.1:38100").rstrip("/")


def require_env() -> None:
    if not LLM_SHARED_TOKEN:
        print("LLM_SHARED_TOKEN is required", file=sys.stderr)
        sys.exit(1)
    if not RUNTIME_CONTROL_TOKEN:
        print("LLM_RUNTIME_CONTROL_TOKEN is required", file=sys.stderr)
        sys.exit(1)


def read_body(handler: BaseHTTPRequestHandler) -> bytes:
    length = int(handler.headers.get("Content-Length", "0"))
    return handler.rfile.read(length) if length > 0 else b""


def proxy_request(method: str, url: str, body: bytes, headers: dict[str, str]) -> tuple[int, bytes, str]:
    req = urllib.request.Request(url, data=body if method != "GET" else None, method=method)
    for key, value in headers.items():
        req.add_header(key, value)
    try:
        with urllib.request.urlopen(req, timeout=120) as response:
            return response.status, response.read(), response.headers.get("Content-Type", "application/octet-stream")
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read(), exc.headers.get("Content-Type", "text/plain; charset=utf-8")
    except urllib.error.URLError as exc:
        body = f"bad gateway: {exc.reason}".encode("utf-8")
        return 502, body, "text/plain; charset=utf-8"
    except Exception as exc:  # pragma: no cover
        body = f"bad gateway: {exc}".encode("utf-8")
        return 502, body, "text/plain; charset=utf-8"


class Handler(BaseHTTPRequestHandler):
    server_version = "dgx-local-llm-gateway/1.0"

    def _embedding_auth_ok(self) -> bool:
        if not EMBEDDING_API_KEY:
            return True
        return self.headers.get("Authorization", "") == f"Bearer {EMBEDDING_API_KEY}"

    def _send(self, status: int, body: bytes, content_type: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_text(self, status: int, text: str) -> None:
        self._send(status, text.encode("utf-8"), "text/plain; charset=utf-8")

    def do_GET(self) -> None:
        if self.path == "/healthz":
            self._send_text(200, "ok\n")
            return
        if self.path == "/embed":
            if not self._embedding_auth_ok():
                self._send_text(403, "forbidden")
                return
            status, body, content_type = proxy_request("GET", f"{EMBEDDING_BASE_URL}{self.path}", b"", {})
            self._send(status, body, content_type)
            return
        if self.path.startswith("/v1/"):
            if self.headers.get("X-LLM-Token", "") != LLM_SHARED_TOKEN:
                self._send_text(403, "forbidden")
                return
            status, body, content_type = proxy_request("GET", f"{LLAMA_SERVER_BASE_URL}{self.path}", b"", {})
            self._send(status, body, content_type)
            return
        self._send_text(404, "not found")

    def do_POST(self) -> None:
        body = read_body(self)
        if self.path in ("/start", "/stop"):
            if self.headers.get("X-Runtime-Control-Token", "") != RUNTIME_CONTROL_TOKEN:
                self._send_text(403, "forbidden")
                return
            status, resp_body, content_type = proxy_request(
                "POST",
                f"{RUNTIME_CONTROL_BASE_URL}{self.path}",
                body,
                {"X-Runtime-Control-Token": RUNTIME_CONTROL_TOKEN},
            )
            self._send(status, resp_body, content_type)
            return
        if self.path == "/embed":
            if not self._embedding_auth_ok():
                self._send_text(403, "forbidden")
                return
            headers = {"Content-Type": self.headers.get("Content-Type", "application/json")}
            status, resp_body, content_type = proxy_request(
                "POST",
                f"{EMBEDDING_BASE_URL}{self.path}",
                body,
                headers,
            )
            self._send(status, resp_body, content_type)
            return
        if self.path.startswith("/v1/"):
            if self.headers.get("X-LLM-Token", "") != LLM_SHARED_TOKEN:
                self._send_text(403, "forbidden")
                return
            headers = {"Content-Type": self.headers.get("Content-Type", "application/json")}
            status, resp_body, content_type = proxy_request(
                "POST",
                f"{LLAMA_SERVER_BASE_URL}{self.path}",
                body,
                headers,
            )
            self._send(status, resp_body, content_type)
            return
        self._send_text(404, "not found")

    def log_message(self, fmt: str, *args: object) -> None:
        sys.stderr.write("[dgx-local-llm-gateway] " + (fmt % args) + "\n")


if __name__ == "__main__":
    require_env()
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"[dgx-local-llm-gateway] listening on http://{HOST}:{PORT}", file=sys.stderr)
    httpd.serve_forever()
