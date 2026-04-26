#!/usr/bin/env python3
"""
DGX system-prod 用: active backend を start/stop する最小 HTTP 制御サーバ。

環境変数:
  LLM_RUNTIME_CONTROL_TOKEN  必須
  ACTIVE_LLM_BACKEND         既定: green（green / blue）
  LLM_RUNTIME_START_CMD      互換用 fallback start command
  LLM_RUNTIME_STOP_CMD       互換用 fallback stop command
  GREEN_LLM_RUNTIME_START_CMD / STOP_CMD
  BLUE_LLM_RUNTIME_START_CMD / STOP_CMD
  LLM_RUNTIME_LISTEN_HOST    既定: 127.0.0.1
  LLM_RUNTIME_LISTEN_PORT    既定: 39090
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Callable


@dataclass(frozen=True)
class ControlConfig:
    token: str
    active_backend: str
    start_cmd: str
    stop_cmd: str
    green_start_cmd: str
    green_stop_cmd: str
    blue_start_cmd: str
    blue_stop_cmd: str
    blue_keep_warm: bool
    host: str
    port: int


def parse_bool_env(name: str, default: bool = False) -> bool:
    raw = (os.environ.get(name) or "").strip().lower()
    if not raw:
        return default
    return raw in {"1", "true", "yes", "on"}


def load_config_from_env() -> ControlConfig:
    return ControlConfig(
        token=(os.environ.get("LLM_RUNTIME_CONTROL_TOKEN") or "").strip(),
        active_backend=(os.environ.get("ACTIVE_LLM_BACKEND") or "green").strip().lower(),
        start_cmd=(os.environ.get("LLM_RUNTIME_START_CMD") or "").strip(),
        stop_cmd=(os.environ.get("LLM_RUNTIME_STOP_CMD") or "").strip(),
        green_start_cmd=(os.environ.get("GREEN_LLM_RUNTIME_START_CMD") or "").strip(),
        green_stop_cmd=(os.environ.get("GREEN_LLM_RUNTIME_STOP_CMD") or "").strip(),
        blue_start_cmd=(os.environ.get("BLUE_LLM_RUNTIME_START_CMD") or "").strip(),
        blue_stop_cmd=(os.environ.get("BLUE_LLM_RUNTIME_STOP_CMD") or "").strip(),
        blue_keep_warm=parse_bool_env("BLUE_LLM_RUNTIME_KEEP_WARM", False),
        host=(os.environ.get("LLM_RUNTIME_LISTEN_HOST") or "127.0.0.1").strip(),
        port=int((os.environ.get("LLM_RUNTIME_LISTEN_PORT") or "39090").strip()),
    )


def require_env(config: ControlConfig) -> None:
    if not config.token:
        print("LLM_RUNTIME_CONTROL_TOKEN is required", file=sys.stderr)
        sys.exit(1)
    if config.active_backend not in {"green", "blue"}:
        print(f"ACTIVE_LLM_BACKEND must be green or blue, got: {config.active_backend}", file=sys.stderr)
        sys.exit(1)
    resolve_command(config, "start")
    resolve_command(config, "stop")


def run_shell(command: str) -> None:
    subprocess.run(
        ["bash", "-lc", command],
        check=True,
        timeout=120,
        capture_output=True,
        text=True,
    )


def resolve_command(config: ControlConfig, action: str) -> str:
    if action == "start":
        command = config.green_start_cmd if config.active_backend == "green" else config.blue_start_cmd
        fallback = config.start_cmd
    elif action == "stop":
        if config.active_backend == "blue" and config.blue_keep_warm:
            # Keep blue runtime warm during iterative testing; stop becomes a no-op.
            return ":"
        command = config.green_stop_cmd if config.active_backend == "green" else config.blue_stop_cmd
        fallback = config.stop_cmd
    else:  # pragma: no cover
        raise ValueError(f"unknown action: {action}")
    resolved = command or fallback
    if not resolved:
        raise SystemExit(
            f"{action} command is required for ACTIVE_LLM_BACKEND={config.active_backend} "
            "(set backend-specific command or legacy LLM_RUNTIME_* fallback)"
        )
    return resolved


def make_handler(config: ControlConfig, command_runner: Callable[[str], None] = run_shell) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        server_version = "dgx-llm-runtime-control/1.0"

        def _auth_ok(self) -> bool:
            return self.headers.get("X-Runtime-Control-Token", "") == config.token

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
                    command_runner(resolve_command(config, "start"))
                    self._send_json(200, {"ok": True, "action": "start", "backend": config.active_backend})
                    return
                if self.path == "/stop":
                    command_runner(resolve_command(config, "stop"))
                    self._send_json(200, {"ok": True, "action": "stop", "backend": config.active_backend})
                    return
                self._send_text(404, "not found")
            except subprocess.CalledProcessError as exc:
                detail = exc.stderr or exc.stdout or str(exc)
                self._send_text(500, detail[:2000])
            except Exception as exc:  # pragma: no cover
                self._send_text(500, str(exc))

        def log_message(self, fmt: str, *args: object) -> None:
            sys.stderr.write("[dgx-llm-runtime-control] " + (fmt % args) + "\n")

    return Handler


def main() -> None:
    config = load_config_from_env()
    require_env(config)
    httpd = ThreadingHTTPServer((config.host, config.port), make_handler(config))
    print(f"[dgx-llm-runtime-control] listening on http://{config.host}:{config.port}", file=sys.stderr)
    httpd.serve_forever()


if __name__ == "__main__":
    main()
