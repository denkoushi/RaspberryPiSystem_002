#!/usr/bin/env python3
"""
DGX system-prod 用: host 上の llama-server を start/stop する最小 HTTP 制御サーバ。

環境変数:
  LLM_RUNTIME_CONTROL_TOKEN  必須
  LLM_RUNTIME_START_CMD      必須
  LLM_RUNTIME_STOP_CMD       必須
  LLM_RUNTIME_LISTEN_HOST    既定: 127.0.0.1
  LLM_RUNTIME_LISTEN_PORT    既定: 39090
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


TOKEN = (os.environ.get("LLM_RUNTIME_CONTROL_TOKEN") or "").strip()
START_CMD = (os.environ.get("LLM_RUNTIME_START_CMD") or "").strip()
STOP_CMD = (os.environ.get("LLM_RUNTIME_STOP_CMD") or "").strip()
HOST = (os.environ.get("LLM_RUNTIME_LISTEN_HOST") or "127.0.0.1").strip()
PORT = int((os.environ.get("LLM_RUNTIME_LISTEN_PORT") or "39090").strip())


def require_env() -> None:
    if not TOKEN:
        print("LLM_RUNTIME_CONTROL_TOKEN is required", file=sys.stderr)
        sys.exit(1)
    if not START_CMD:
        print("LLM_RUNTIME_START_CMD is required", file=sys.stderr)
        sys.exit(1)
    if not STOP_CMD:
        print("LLM_RUNTIME_STOP_CMD is required", file=sys.stderr)
        sys.exit(1)


def run_shell(command: str) -> None:
    subprocess.run(
        ["bash", "-lc", command],
        check=True,
        timeout=120,
        capture_output=True,
        text=True,
    )


class Handler(BaseHTTPRequestHandler):
    server_version = "dgx-llm-runtime-control/1.0"

    def _auth_ok(self) -> bool:
        return self.headers.get("X-Runtime-Control-Token", "") == TOKEN

    def _send_text(self, status: int, body: str) -> None:
        encoded = body.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def _send_json(self, status: int, payload: dict[str, object]) -> None:
        encoded = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def do_GET(self) -> None:
        if not self._auth_ok():
            self._send_text(401, "unauthorized")
            return
        if self.path == "/healthz":
            self._send_text(200, "ok\n")
            return
        self._send_text(404, "not found")

    def do_POST(self) -> None:
        if not self._auth_ok():
            self._send_text(401, "unauthorized")
            return
        try:
            if self.path == "/start":
                run_shell(START_CMD)
                self._send_json(200, {"ok": True, "action": "start"})
                return
            if self.path == "/stop":
                run_shell(STOP_CMD)
                self._send_json(200, {"ok": True, "action": "stop"})
                return
            self._send_text(404, "not found")
        except subprocess.CalledProcessError as exc:
            detail = exc.stderr or exc.stdout or str(exc)
            self._send_text(500, detail[:2000])
        except Exception as exc:  # pragma: no cover
            self._send_text(500, str(exc))

    def log_message(self, fmt: str, *args: object) -> None:
        sys.stderr.write("[dgx-llm-runtime-control] " + (fmt % args) + "\n")


if __name__ == "__main__":
    require_env()
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"[dgx-llm-runtime-control] listening on http://{HOST}:{PORT}", file=sys.stderr)
    httpd.serve_forever()
