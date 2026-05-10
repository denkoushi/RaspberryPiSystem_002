#!/usr/bin/env python3
"""
DGX system-prod 用のローカル gateway。

- /healthz は 200 ok
- /system/metrics は GPU/メモリ JSON（Pi KPI 用）。X-LLM-Token が LLM_SHARED_TOKEN と一致することを要求（/v1/* と同様）
- /start /stop は runtime control へ転送
- /v1/* は active backend へ転送

環境変数:
  LLM_SHARED_TOKEN            必須
  LLM_RUNTIME_CONTROL_TOKEN   必須
  EMBEDDING_API_KEY           任意
  GATEWAY_LISTEN_HOST         既定: 127.0.0.1
  GATEWAY_LISTEN_PORT         既定: 38081
  ACTIVE_LLM_BACKEND          既定: green（green / blue）
  LLAMA_SERVER_BASE_URL       互換用 fallback backend URL
  GREEN_LLM_BASE_URL          既定: http://127.0.0.1:38082
  BLUE_LLM_BASE_URL           既定: http://127.0.0.1:38083
  RUNTIME_CONTROL_BASE_URL    既定: http://127.0.0.1:39090
  EMBEDDING_BASE_URL          既定: http://127.0.0.1:38100
  AgentContainer（業務 system-prod と分離したエージェント用コンテナ制御）:
  AGENT_CONTAINER_ROOT             既定: /srv/dgx/agent-container/bin
  AGENT_CONTAINER_START_CMD       既定: ./start-agent-container.sh
  AGENT_CONTAINER_STOP_CMD        既定: ./stop-agent-container.sh
  AGENT_CONTAINER_HEALTH_URL      http モード時の GET 先（任意）
  AGENT_CONTAINER_HEALTH_MODE     既定: container（container | http）
  AGENT_CONTAINER_CONTAINER_NAME  既定: dgx-agent-container
"""

from __future__ import annotations

import os
import json
import sys
import subprocess
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Callable


@dataclass(frozen=True)
class GatewayConfig:
    llm_shared_token: str
    runtime_control_token: str
    host: str
    port: int
    active_backend: str
    legacy_backend_base_url: str
    green_backend_base_url: str
    blue_backend_base_url: str
    runtime_control_base_url: str
    embedding_api_key: str
    embedding_base_url: str
    private_comfy_root: str
    private_comfy_start_cmd: str
    private_comfy_stop_cmd: str
    private_comfy_health_url: str
    experiment_lab_root: str
    experiment_lab_start_cmd: str
    experiment_lab_stop_cmd: str
    experiment_lab_health_url: str
    experiment_lab_health_mode: str
    experiment_lab_container_name: str
    agent_container_root: str
    agent_container_start_cmd: str
    agent_container_stop_cmd: str
    agent_container_health_url: str
    agent_container_health_mode: str
    agent_container_container_name: str
    private_comfy_cmd_timeout_sec: int


def load_config_from_env() -> GatewayConfig:
    return GatewayConfig(
        llm_shared_token=(os.environ.get("LLM_SHARED_TOKEN") or "").strip(),
        runtime_control_token=(os.environ.get("LLM_RUNTIME_CONTROL_TOKEN") or "").strip(),
        host=(os.environ.get("GATEWAY_LISTEN_HOST") or "127.0.0.1").strip(),
        port=int((os.environ.get("GATEWAY_LISTEN_PORT") or "38081").strip()),
        active_backend=(os.environ.get("ACTIVE_LLM_BACKEND") or "green").strip().lower(),
        legacy_backend_base_url=(os.environ.get("LLAMA_SERVER_BASE_URL") or "").rstrip("/"),
        green_backend_base_url=(os.environ.get("GREEN_LLM_BASE_URL") or "http://127.0.0.1:38082").rstrip("/"),
        blue_backend_base_url=(os.environ.get("BLUE_LLM_BASE_URL") or "http://127.0.0.1:38083").rstrip("/"),
        runtime_control_base_url=(os.environ.get("RUNTIME_CONTROL_BASE_URL") or "http://127.0.0.1:39090").rstrip("/"),
        embedding_api_key=(os.environ.get("EMBEDDING_API_KEY") or "").strip(),
        embedding_base_url=(os.environ.get("EMBEDDING_BASE_URL") or "http://127.0.0.1:38100").rstrip("/"),
        private_comfy_root=(
            os.environ.get("PRIVATE_COMFY_ROOT")
            or "/srv/dgx/private-personal/compose/dgx-private-comfyui"
        ).strip(),
        private_comfy_start_cmd=(os.environ.get("PRIVATE_COMFY_START_CMD") or "./start-private-comfyui.sh").strip(),
        private_comfy_stop_cmd=(os.environ.get("PRIVATE_COMFY_STOP_CMD") or "./stop-private-comfyui.sh").strip(),
        private_comfy_health_url=(
            os.environ.get("PRIVATE_COMFY_HEALTH_URL") or "http://127.0.0.1:8188"
        ).strip(),
        experiment_lab_root=(os.environ.get("EXPERIMENT_LAB_ROOT") or "/srv/dgx/system-prod/bin").strip(),
        experiment_lab_start_cmd=(
            os.environ.get("EXPERIMENT_LAB_START_CMD")
            or "set -a; source /srv/dgx/system-prod/secrets/control-server.env; set +a; ./start-trtllm-server.sh"
        ).strip(),
        experiment_lab_stop_cmd=(
            os.environ.get("EXPERIMENT_LAB_STOP_CMD")
            or "set -a; source /srv/dgx/system-prod/secrets/control-server.env; set +a; ./stop-trtllm-server.sh"
        ).strip(),
        experiment_lab_health_url=(
            os.environ.get("EXPERIMENT_LAB_HEALTH_URL") or "http://127.0.0.1:38083/v1/models"
        ).strip(),
        experiment_lab_health_mode=(os.environ.get("EXPERIMENT_LAB_HEALTH_MODE") or "container").strip().lower(),
        experiment_lab_container_name=(os.environ.get("EXPERIMENT_LAB_CONTAINER_NAME") or "system-prod-trtllm").strip(),
        agent_container_root=(os.environ.get("AGENT_CONTAINER_ROOT") or "/srv/dgx/agent-container/bin").strip(),
        agent_container_start_cmd=(
            os.environ.get("AGENT_CONTAINER_START_CMD") or "./start-agent-container.sh"
        ).strip(),
        agent_container_stop_cmd=(
            os.environ.get("AGENT_CONTAINER_STOP_CMD") or "./stop-agent-container.sh"
        ).strip(),
        agent_container_health_url=(os.environ.get("AGENT_CONTAINER_HEALTH_URL") or "").strip(),
        agent_container_health_mode=(os.environ.get("AGENT_CONTAINER_HEALTH_MODE") or "container").strip().lower(),
        agent_container_container_name=(
            os.environ.get("AGENT_CONTAINER_CONTAINER_NAME") or "dgx-agent-container"
        ).strip(),
        private_comfy_cmd_timeout_sec=int((os.environ.get("PRIVATE_COMFY_CMD_TIMEOUT_SEC") or "240").strip()),
    )


def require_env(config: GatewayConfig) -> None:
    if not config.llm_shared_token:
        print("LLM_SHARED_TOKEN is required", file=sys.stderr)
        sys.exit(1)
    if not config.runtime_control_token:
        print("LLM_RUNTIME_CONTROL_TOKEN is required", file=sys.stderr)
        sys.exit(1)
    if config.active_backend not in {"green", "blue"}:
        print(f"ACTIVE_LLM_BACKEND must be green or blue, got: {config.active_backend}", file=sys.stderr)
        sys.exit(1)


def resolve_backend_base_url(config: GatewayConfig) -> str:
    if config.active_backend == "blue":
        return config.blue_backend_base_url or config.legacy_backend_base_url
    return config.green_backend_base_url or config.legacy_backend_base_url


def read_body(handler: BaseHTTPRequestHandler) -> bytes:
    length = int(handler.headers.get("Content-Length", "0"))
    return handler.rfile.read(length) if length > 0 else b""


def run_local_command(command: str, cwd: str, timeout_sec: int) -> tuple[int, str]:
    proc = subprocess.run(
        ["bash", "-lc", command],
        cwd=cwd,
        timeout=timeout_sec,
        capture_output=True,
        text=True,
        check=False,
    )
    out = (proc.stdout or "") + ("\n" if proc.stdout and proc.stderr else "") + (proc.stderr or "")
    return proc.returncode, out.strip()


def emit_agent_debug_log(hypothesis_id: str, location: str, message: str, data: dict) -> None:
    payload = {
        "sessionId": "504530",
        "runId": "dgx-resource-debug",
        "hypothesisId": hypothesis_id,
        "location": location,
        "message": message,
        "data": data,
        "timestamp": int(time.time() * 1000),
    }
    try:
        # region agent log
        with open(
            "/Users/tsudatakashi/RaspberryPiSystem_002/.cursor/debug-504530.log",
            "a",
            encoding="utf-8",
        ) as fp:
            fp.write(json.dumps(payload, ensure_ascii=False) + "\n")
        # endregion
    except Exception:
        pass


def is_container_running(container_name: str) -> bool:
    proc = subprocess.run(
        ["bash", "-lc", "docker ps --format '{{.Names}}'"],
        capture_output=True,
        text=True,
        check=False,
    )
    if proc.returncode != 0:
        return False
    names = [line.strip() for line in (proc.stdout or "").splitlines() if line.strip()]
    return container_name in names


def collect_gpu_metrics() -> tuple[bool, dict[str, float] | None]:
    proc = subprocess.run(
        [
            "bash",
            "-lc",
            "nvidia-smi --query-gpu=utilization.gpu,memory.used,memory.total --format=csv,noheader,nounits",
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    if proc.returncode != 0:
        # region agent log
        emit_agent_debug_log(
            "H6",
            "gateway-server.py:collect_gpu_metrics:nvidia-smi-failed",
            "nvidia-smi command failed",
            {"returncode": proc.returncode},
        )
        # endregion
        return False, None
    rows = [line.strip() for line in (proc.stdout or "").splitlines() if line.strip()]
    if not rows:
        # region agent log
        emit_agent_debug_log(
            "H6",
            "gateway-server.py:collect_gpu_metrics:no-rows",
            "nvidia-smi returned no rows",
            {},
        )
        # endregion
        return False, None
    gpu_utils: list[float] = []
    mem_pairs: list[tuple[float, float]] = []
    for row in rows:
        parts = [p.strip() for p in row.split(",")]
        if len(parts) != 3:
            continue
        try:
            util = float(parts[0])
            gpu_utils.append(util)
        except ValueError:
            continue
        try:
            mem_used_mib = float(parts[1])
            mem_total_mib = float(parts[2])
            mem_pairs.append((mem_used_mib, mem_total_mib))
        except ValueError:
            # DGX Spark unified memory では memory.* が [N/A] になることがある。
            pass
    if not gpu_utils:
        # region agent log
        emit_agent_debug_log(
            "H6",
            "gateway-server.py:collect_gpu_metrics:no-gpu-utils",
            "gpu utilization parse failed",
            {"rows": rows[:3]},
        )
        # endregion
        return False, None
    util_avg = sum(gpu_utils) / len(gpu_utils)
    used_gib: float | None = None
    total_gib: float | None = None
    if mem_pairs:
        used_gib = sum(v[0] for v in mem_pairs) / 1024.0
        total_gib = sum(v[1] for v in mem_pairs) / 1024.0
    else:
        # region agent log
        emit_agent_debug_log(
            "H6",
            "gateway-server.py:collect_gpu_metrics:compute-apps-fallback",
            "memory columns unavailable; try compute-apps memory",
            {"rows": rows[:3]},
        )
        # endregion
        apps_proc = subprocess.run(
            [
                "bash",
                "-lc",
                "nvidia-smi --query-compute-apps=used_memory --format=csv,noheader,nounits",
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        app_used_mib = 0.0
        if apps_proc.returncode == 0:
            for line in (apps_proc.stdout or "").splitlines():
                raw = line.strip().replace(" MiB", "")
                if not raw:
                    continue
                try:
                    app_used_mib += float(raw)
                except ValueError:
                    continue

        memtotal_proc = subprocess.run(
            ["bash", "-lc", "awk '/MemTotal:/ {print $2}' /proc/meminfo"],
            capture_output=True,
            text=True,
            check=False,
        )
        memtotal_kib: float | None = None
        if memtotal_proc.returncode == 0:
            raw = (memtotal_proc.stdout or "").strip()
            try:
                memtotal_kib = float(raw)
            except ValueError:
                memtotal_kib = None

        if memtotal_kib and memtotal_kib > 0:
            used_gib = app_used_mib / 1024.0
            total_gib = memtotal_kib / (1024.0 * 1024.0)
            # region agent log
            emit_agent_debug_log(
                "H8",
                "gateway-server.py:collect_gpu_metrics:compute-apps-fallback",
                "compute-apps memory fallback succeeded",
                {
                    "appUsedMiB": round(app_used_mib, 1),
                    "memTotalKiB": round(memtotal_kib, 1),
                    "usedGiB": round(used_gib, 1),
                    "totalGiB": round(total_gib, 1),
                },
            )
            # endregion
        else:
            payload = {"gpuUtilPct": round(util_avg, 1)}
            # region agent log
            emit_agent_debug_log(
                "H6",
                "gateway-server.py:collect_gpu_metrics:payload",
                "gpu-only metrics payload produced",
                {
                    "gpuUtilAvg": payload["gpuUtilPct"],
                    "usedRamFallback": False,
                    "rows": rows[:3],
                    "appMemoryFallbackTried": True,
                    "appUsedMiB": round(app_used_mib, 1),
                    "memTotalKiB": memtotal_kib,
                },
            )
            # endregion
            return True, payload

    if used_gib is None or total_gib is None or total_gib <= 0:
        return False, None

    payload = {
        "gpuUtilPct": round(util_avg, 1),
        "unifiedMemoryUsedGiB": round(used_gib, 1),
        "unifiedMemoryTotalGiB": round(total_gib, 1),
        "freeMemoryGiB": round(max(0.0, total_gib - used_gib), 1),
    }
    # region agent log
    emit_agent_debug_log(
        "H6",
        "gateway-server.py:collect_gpu_metrics:payload",
        "gpu metrics payload produced",
        {
            "gpuUtilAvg": round(util_avg, 1),
            "usedGiB": payload["unifiedMemoryUsedGiB"],
            "totalGiB": payload["unifiedMemoryTotalGiB"],
                "usedRamFallback": False,
            "rows": rows[:3],
        },
    )
    # endregion
    return True, payload


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


def make_handler(
    config: GatewayConfig,
    proxy_impl: Callable[[str, str, bytes, dict[str, str]], tuple[int, bytes, str]] = proxy_request,
) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        server_version = "dgx-local-llm-gateway/1.0"

        def _embedding_auth_ok(self) -> bool:
            if not config.embedding_api_key:
                return True
            return self.headers.get("Authorization", "") == f"Bearer {config.embedding_api_key}"

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
            if self.path == "/system/metrics":
                if self.headers.get("X-LLM-Token", "") != config.llm_shared_token:
                    self._send_text(403, "forbidden")
                    return
                ok, payload = collect_gpu_metrics()
                if ok and payload is not None:
                    self._send(200, json.dumps(payload).encode("utf-8"), "application/json; charset=utf-8")
                else:
                    self._send(503, b'{"ok":false,"reason":"gpu_metrics_unavailable"}', "application/json; charset=utf-8")
                return
            if self.path == "/private-comfyui/health":
                status, body, content_type = proxy_impl("GET", config.private_comfy_health_url, b"", {})
                self._send(status, body, content_type)
                return
            if self.path == "/experiment-lab/health":
                if config.experiment_lab_health_mode == "container":
                    if is_container_running(config.experiment_lab_container_name):
                        self._send(200, b'{"ok":true,"mode":"container"}', "application/json; charset=utf-8")
                    else:
                        self._send(503, b'{"ok":false,"mode":"container"}', "application/json; charset=utf-8")
                    return
                status, body, content_type = proxy_impl("GET", config.experiment_lab_health_url, b"", {})
                self._send(status, body, content_type)
                return
            if self.path == "/agent-container/health":
                if config.agent_container_health_mode == "container":
                    if is_container_running(config.agent_container_container_name):
                        self._send(200, b'{"ok":true,"mode":"container"}', "application/json; charset=utf-8")
                    else:
                        self._send(503, b'{"ok":false,"mode":"container"}', "application/json; charset=utf-8")
                    return
                if not config.agent_container_health_url:
                    self._send(
                        503,
                        b'{"ok":false,"reason":"agent_container_health_url_unconfigured"}',
                        "application/json; charset=utf-8",
                    )
                    return
                status, body, content_type = proxy_impl("GET", config.agent_container_health_url, b"", {})
                self._send(status, body, content_type)
                return
            if self.path == "/embed":
                if not self._embedding_auth_ok():
                    self._send_text(403, "forbidden")
                    return
                status, body, content_type = proxy_impl("GET", f"{config.embedding_base_url}{self.path}", b"", {})
                self._send(status, body, content_type)
                return
            if self.path.startswith("/v1/"):
                if self.headers.get("X-LLM-Token", "") != config.llm_shared_token:
                    self._send_text(403, "forbidden")
                    return
                status, body, content_type = proxy_impl(
                    "GET",
                    f"{resolve_backend_base_url(config)}{self.path}",
                    b"",
                    {},
                )
                self._send(status, body, content_type)
                return
            self._send_text(404, "not found")

        def do_POST(self) -> None:
            body = read_body(self)
            if self.path in ("/start", "/stop"):
                if self.headers.get("X-Runtime-Control-Token", "") != config.runtime_control_token:
                    self._send_text(403, "forbidden")
                    return
                status, resp_body, content_type = proxy_impl(
                    "POST",
                    f"{config.runtime_control_base_url}{self.path}",
                    body,
                    {"X-Runtime-Control-Token": config.runtime_control_token},
                )
                self._send(status, resp_body, content_type)
                return
            if self.path in ("/private-comfyui/start", "/private-comfyui/stop"):
                if self.headers.get("X-Runtime-Control-Token", "") != config.runtime_control_token:
                    self._send_text(403, "forbidden")
                    return
                command = (
                    config.private_comfy_start_cmd
                    if self.path.endswith("/start")
                    else config.private_comfy_stop_cmd
                )
                try:
                    rc, output = run_local_command(
                        command,
                        config.private_comfy_root,
                        config.private_comfy_cmd_timeout_sec,
                    )
                    if rc == 0:
                        # region agent log
                        emit_agent_debug_log(
                            "H9",
                            "gateway-server.py:private-comfyui-runtime",
                            "private-comfyui runtime command succeeded",
                            {
                                "path": self.path,
                                "exitCode": rc,
                                "outputSample": output[:200],
                            },
                        )
                        # endregion
                        payload = json.dumps({"ok": True, "path": self.path}).encode("utf-8")
                        self._send(200, payload, "application/json; charset=utf-8")
                        return
                    # region agent log
                    emit_agent_debug_log(
                        "H9",
                        "gateway-server.py:private-comfyui-runtime",
                        "private-comfyui runtime command failed",
                        {
                            "path": self.path,
                            "exitCode": rc,
                            "outputSample": output[:300],
                        },
                    )
                    # endregion
                    payload = json.dumps(
                        {
                            "ok": False,
                            "path": self.path,
                            "exitCode": rc,
                            "output": output[:400],
                        }
                    ).encode("utf-8")
                    self._send(502, payload, "application/json; charset=utf-8")
                    return
                except subprocess.TimeoutExpired:
                    # region agent log
                    emit_agent_debug_log(
                        "H9",
                        "gateway-server.py:private-comfyui-runtime",
                        "private-comfyui runtime command timeout",
                        {
                            "path": self.path,
                            "timeoutSec": config.private_comfy_cmd_timeout_sec,
                        },
                    )
                    # endregion
                    payload = json.dumps({"ok": False, "path": self.path, "message": "timeout"}).encode("utf-8")
                    self._send(504, payload, "application/json; charset=utf-8")
                    return
                except Exception as exc:
                    # region agent log
                    emit_agent_debug_log(
                        "H9",
                        "gateway-server.py:private-comfyui-runtime",
                        "private-comfyui runtime command exception",
                        {
                            "path": self.path,
                            "error": str(exc),
                        },
                    )
                    # endregion
                    payload = json.dumps(
                        {"ok": False, "path": self.path, "message": str(exc)}
                    ).encode("utf-8")
                    self._send(500, payload, "application/json; charset=utf-8")
                    return
            if self.path in ("/experiment-lab/start", "/experiment-lab/stop"):
                if self.headers.get("X-Runtime-Control-Token", "") != config.runtime_control_token:
                    self._send_text(403, "forbidden")
                    return
                command = (
                    config.experiment_lab_start_cmd
                    if self.path.endswith("/start")
                    else config.experiment_lab_stop_cmd
                )
                try:
                    rc, output = run_local_command(
                        command,
                        config.experiment_lab_root,
                        config.private_comfy_cmd_timeout_sec,
                    )
                    if rc == 0:
                        # region agent log
                        emit_agent_debug_log(
                            "H9",
                            "gateway-server.py:experiment-lab-runtime",
                            "experiment-lab runtime command succeeded",
                            {
                                "path": self.path,
                                "exitCode": rc,
                                "outputSample": output[:200],
                            },
                        )
                        # endregion
                        payload = json.dumps({"ok": True, "path": self.path}).encode("utf-8")
                        self._send(200, payload, "application/json; charset=utf-8")
                        return
                    # region agent log
                    emit_agent_debug_log(
                        "H9",
                        "gateway-server.py:experiment-lab-runtime",
                        "experiment-lab runtime command failed",
                        {
                            "path": self.path,
                            "exitCode": rc,
                            "outputSample": output[:300],
                        },
                    )
                    # endregion
                    payload = json.dumps(
                        {
                            "ok": False,
                            "path": self.path,
                            "exitCode": rc,
                            "output": output[:400],
                        }
                    ).encode("utf-8")
                    self._send(502, payload, "application/json; charset=utf-8")
                    return
                except subprocess.TimeoutExpired:
                    # region agent log
                    emit_agent_debug_log(
                        "H9",
                        "gateway-server.py:experiment-lab-runtime",
                        "experiment-lab runtime command timeout",
                        {
                            "path": self.path,
                            "timeoutSec": config.private_comfy_cmd_timeout_sec,
                        },
                    )
                    # endregion
                    payload = json.dumps({"ok": False, "path": self.path, "message": "timeout"}).encode("utf-8")
                    self._send(504, payload, "application/json; charset=utf-8")
                    return
                except Exception as exc:
                    # region agent log
                    emit_agent_debug_log(
                        "H9",
                        "gateway-server.py:experiment-lab-runtime",
                        "experiment-lab runtime command exception",
                        {
                            "path": self.path,
                            "error": str(exc),
                        },
                    )
                    # endregion
                    payload = json.dumps(
                        {"ok": False, "path": self.path, "message": str(exc)}
                    ).encode("utf-8")
                    self._send(500, payload, "application/json; charset=utf-8")
                    return
            if self.path in ("/agent-container/start", "/agent-container/stop"):
                if self.headers.get("X-Runtime-Control-Token", "") != config.runtime_control_token:
                    self._send_text(403, "forbidden")
                    return
                command = (
                    config.agent_container_start_cmd
                    if self.path.endswith("/start")
                    else config.agent_container_stop_cmd
                )
                try:
                    rc, output = run_local_command(
                        command,
                        config.agent_container_root,
                        config.private_comfy_cmd_timeout_sec,
                    )
                    if rc == 0:
                        emit_agent_debug_log(
                            "H9",
                            "gateway-server.py:agent-container-runtime",
                            "agent-container runtime command succeeded",
                            {
                                "path": self.path,
                                "exitCode": rc,
                                "outputSample": output[:200],
                            },
                        )
                        payload = json.dumps({"ok": True, "path": self.path}).encode("utf-8")
                        self._send(200, payload, "application/json; charset=utf-8")
                        return
                    emit_agent_debug_log(
                        "H9",
                        "gateway-server.py:agent-container-runtime",
                        "agent-container runtime command failed",
                        {
                            "path": self.path,
                            "exitCode": rc,
                            "outputSample": output[:300],
                        },
                    )
                    payload = json.dumps(
                        {
                            "ok": False,
                            "path": self.path,
                            "exitCode": rc,
                            "output": output[:400],
                        }
                    ).encode("utf-8")
                    self._send(502, payload, "application/json; charset=utf-8")
                    return
                except subprocess.TimeoutExpired:
                    emit_agent_debug_log(
                        "H9",
                        "gateway-server.py:agent-container-runtime",
                        "agent-container runtime command timeout",
                        {
                            "path": self.path,
                            "timeoutSec": config.private_comfy_cmd_timeout_sec,
                        },
                    )
                    payload = json.dumps({"ok": False, "path": self.path, "message": "timeout"}).encode("utf-8")
                    self._send(504, payload, "application/json; charset=utf-8")
                    return
                except Exception as exc:
                    emit_agent_debug_log(
                        "H9",
                        "gateway-server.py:agent-container-runtime",
                        "agent-container runtime command exception",
                        {
                            "path": self.path,
                            "error": str(exc),
                        },
                    )
                    payload = json.dumps(
                        {"ok": False, "path": self.path, "message": str(exc)}
                    ).encode("utf-8")
                    self._send(500, payload, "application/json; charset=utf-8")
                    return
            if self.path == "/embed":
                if not self._embedding_auth_ok():
                    self._send_text(403, "forbidden")
                    return
                headers = {"Content-Type": self.headers.get("Content-Type", "application/json")}
                status, resp_body, content_type = proxy_impl(
                    "POST",
                    f"{config.embedding_base_url}{self.path}",
                    body,
                    headers,
                )
                self._send(status, resp_body, content_type)
                return
            if self.path.startswith("/v1/"):
                if self.headers.get("X-LLM-Token", "") != config.llm_shared_token:
                    self._send_text(403, "forbidden")
                    return
                headers = {"Content-Type": self.headers.get("Content-Type", "application/json")}
                status, resp_body, content_type = proxy_impl(
                    "POST",
                    f"{resolve_backend_base_url(config)}{self.path}",
                    body,
                    headers,
                )
                self._send(status, resp_body, content_type)
                return
            self._send_text(404, "not found")

        def log_message(self, fmt: str, *args: object) -> None:
            sys.stderr.write("[dgx-local-llm-gateway] " + (fmt % args) + "\n")

    return Handler


def main() -> None:
    config = load_config_from_env()
    require_env(config)
    httpd = ThreadingHTTPServer((config.host, config.port), make_handler(config))
    print(f"[dgx-local-llm-gateway] listening on http://{config.host}:{config.port}", file=sys.stderr)
    httpd.serve_forever()


if __name__ == "__main__":
    main()
