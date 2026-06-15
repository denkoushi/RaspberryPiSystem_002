#!/usr/bin/env python3
"""
DGX system-prod 用のローカル gateway。

- /healthz は 200 ok
- /system/metrics は GPU/メモリ JSON（Pi KPI 用）。LLM 認証は X-LLM-Token または Authorization: Bearer（/v1/* と同様）
- /system/model-profiles は DGX 正本の業務用モデル allowlist
- /system/model-profile は現在ロード済みの active profile state
- /system/resource-state は DGX 共有リソースの owner/state
- /start /stop /stop-force は runtime control へ転送
- /v1/* は active profile state の backend を優先して転送

環境変数:
  LLM_SHARED_TOKEN            必須（少なくとも1つ有効な LLM トークン）
  LLM_SHARED_ADDITIONAL_TOKENS  任意（カンマ区切り。Hermes 専用トークン等）
  LLM_RUNTIME_CONTROL_TOKEN   必須
  EMBEDDING_API_KEY           任意
  GATEWAY_LISTEN_HOST         既定: 127.0.0.1
  GATEWAY_LISTEN_PORT         既定: 38081
  ACTIVE_LLM_BACKEND          既定: green（green / blue）
  DGX_MODEL_REGISTRY_ROOT     任意: モデルプロファイル manifest の root
  DGX_ACTIVE_MODEL_STATE_PATH 任意: active model profile state JSON の保存先
  DGX_RESOURCE_STATE_PATH     任意: DGX 共有リソース owner/state JSON の保存先
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

from active_model_state import active_model_state_to_api, read_active_model_state
from gateway_llm_auth import load_llm_shared_tokens_from_env, llm_shared_token_ok
from model_profiles import load_model_profiles, model_profile_to_api
from resource_state import read_resource_state, state_to_api, write_resource_state


@dataclass(frozen=True)
class GatewayConfig:
    llm_shared_tokens: frozenset[str]
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
    model_registry_root: str = "/srv/dgx/shared-models/registry"
    active_model_state_path: str = "/srv/dgx/system-prod/state/active-model-profile.json"
    resource_state_path: str = "/srv/dgx/system-prod/state/dgx-resource-state.json"


def load_config_from_env() -> GatewayConfig:
    return GatewayConfig(
        llm_shared_tokens=load_llm_shared_tokens_from_env(),
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
        model_registry_root=(os.environ.get("DGX_MODEL_REGISTRY_ROOT") or "/srv/dgx/shared-models/registry").strip(),
        active_model_state_path=(
            os.environ.get("DGX_ACTIVE_MODEL_STATE_PATH")
            or "/srv/dgx/system-prod/state/active-model-profile.json"
        ).strip(),
        resource_state_path=(
            os.environ.get("DGX_RESOURCE_STATE_PATH")
            or "/srv/dgx/system-prod/state/dgx-resource-state.json"
        ).strip(),
    )


def require_env(config: GatewayConfig) -> None:
    if not config.llm_shared_tokens:
        print("LLM_SHARED_TOKEN is required", file=sys.stderr)
        sys.exit(1)
    if not config.runtime_control_token:
        print("LLM_RUNTIME_CONTROL_TOKEN is required", file=sys.stderr)
        sys.exit(1)
    if config.active_backend not in {"green", "blue"}:
        print(f"ACTIVE_LLM_BACKEND must be green or blue, got: {config.active_backend}", file=sys.stderr)
        sys.exit(1)


def resolve_active_backend(config: GatewayConfig) -> str:
    state = read_active_model_state(config.active_model_state_path)
    return state.backend if state is not None else config.active_backend


def resolve_backend_base_url(config: GatewayConfig) -> str:
    active_backend = resolve_active_backend(config)
    if active_backend == "blue":
        return config.blue_backend_base_url or config.legacy_backend_base_url
    return config.green_backend_base_url or config.legacy_backend_base_url


def read_body(handler: BaseHTTPRequestHandler) -> bytes:
    length = int(handler.headers.get("Content-Length", "0"))
    return handler.rfile.read(length) if length > 0 else b""


def reason_from_json_body(body: bytes) -> str | None:
    if not body:
        return None
    try:
        payload = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None
    if not isinstance(payload, dict):
        return None
    reason = payload.get("reason")
    return reason.strip() if isinstance(reason, str) and reason.strip() else None


def write_gateway_resource_state_best_effort(
    config: GatewayConfig,
    *,
    owner: str,
    status: str,
    action: str,
    reason: str | None,
    guarantee_level: str = "post_only",
) -> dict[str, object] | None:
    try:
        state = write_resource_state(
            config.resource_state_path,
            owner=owner,
            status=status,
            action=action,
            reason=reason,
            guarantee_level=guarantee_level,
        )
    except OSError:
        return None
    return state_to_api(state)


def inject_blue_chat_completions_defaults(path: str, body: bytes, active_backend: str) -> bytes:
    """blue/vLLM (Qwen3.6): clients that omit enable_thinking get long reasoning runs.

    Hermes gateway may reset request_overrides each turn; inject here so Pi5/Hermes
    Discord chat stays fast without per-client extra_body.
    """
    if active_backend != "blue":
        return body
    if not path.rstrip("/").endswith("/chat/completions"):
        return body
    if not body:
        return body
    try:
        payload = json.loads(body)
    except json.JSONDecodeError:
        return body
    if not isinstance(payload, dict):
        return body
    kwargs = payload.get("chat_template_kwargs")
    if not isinstance(kwargs, dict):
        kwargs = {}
    if kwargs.get("enable_thinking") is not True:
        kwargs["enable_thinking"] = False
        payload["chat_template_kwargs"] = kwargs
    return json.dumps(payload, ensure_ascii=False).encode("utf-8")


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


def parse_nvidia_smi_number(raw: str) -> float | None:
    value = raw.strip().replace(" MiB", "").replace(" W", "").replace(" MHz", "")
    if not value or value.upper() in {"N/A", "[N/A]"}:
        return None
    try:
        return float(value)
    except ValueError:
        return None


def first_present(values: list[str]) -> str | None:
    for raw in values:
        value = raw.strip()
        if value and value.upper() not in {"N/A", "[N/A]"}:
            return value
    return None


def avg_or_none(values: list[float]) -> float | None:
    return sum(values) / len(values) if values else None


def add_gpu_detail_metrics(
    payload: dict[str, float | str],
    gpu_temperatures: list[float],
    gpu_power_draws: list[float],
    gpu_power_limits: list[float],
    gpu_clock_sms: list[float],
    gpu_clock_graphics: list[float],
    gpu_clock_memory: list[float],
    gpu_pstates: list[str],
    gpu_throttle_reasons: list[str],
    gpu_names: list[str],
    driver_versions: list[str],
) -> None:
    numeric_fields = [
        ("gpuTemperatureC", avg_or_none(gpu_temperatures)),
        ("gpuPowerDrawW", avg_or_none(gpu_power_draws)),
        ("gpuPowerLimitW", avg_or_none(gpu_power_limits)),
        ("gpuClockSmMhz", avg_or_none(gpu_clock_sms)),
        ("gpuClockGraphicsMhz", avg_or_none(gpu_clock_graphics)),
        ("gpuClockMemoryMhz", avg_or_none(gpu_clock_memory)),
    ]
    for key, value in numeric_fields:
        if value is not None:
            payload[key] = round(value, 1)

    pstate = first_present(gpu_pstates)
    if pstate is not None:
        payload["gpuPstate"] = pstate
    throttle_reason = first_present(gpu_throttle_reasons)
    if throttle_reason is not None:
        payload["gpuClocksThrottleReason"] = throttle_reason
    gpu_name = first_present(gpu_names)
    if gpu_name is not None:
        payload["gpuName"] = gpu_name
    driver_version = first_present(driver_versions)
    if driver_version is not None:
        payload["driverVersion"] = driver_version


def run_nvidia_smi_gpu_query(query: str):
    return subprocess.run(
        [
            "bash",
            "-lc",
            f"nvidia-smi --query-gpu={query} --format=csv,noheader,nounits",
        ],
        capture_output=True,
        text=True,
        check=False,
    )


def collect_gpu_metrics() -> tuple[bool, dict[str, float | str] | None]:
    proc = run_nvidia_smi_gpu_query(
        "utilization.gpu,memory.used,memory.total,temperature.gpu,"
        "power.draw,power.limit,clocks.sm,clocks.gr,clocks.mem,pstate,"
        "clocks_throttle_reasons.active,name,driver_version"
    )
    if proc.returncode != 0:
        legacy_proc = run_nvidia_smi_gpu_query("utilization.gpu,memory.used,memory.total")
        if legacy_proc.returncode == 0:
            proc = legacy_proc
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
    gpu_temperatures: list[float] = []
    gpu_power_draws: list[float] = []
    gpu_power_limits: list[float] = []
    gpu_clock_sms: list[float] = []
    gpu_clock_graphics: list[float] = []
    gpu_clock_memory: list[float] = []
    gpu_pstates: list[str] = []
    gpu_throttle_reasons: list[str] = []
    gpu_names: list[str] = []
    driver_versions: list[str] = []
    mem_pairs: list[tuple[float, float]] = []
    for row in rows:
        parts = [p.strip() for p in row.split(",")]
        if len(parts) < 3:
            continue
        util = parse_nvidia_smi_number(parts[0])
        if util is not None:
            gpu_utils.append(util)
        mem_used_mib = parse_nvidia_smi_number(parts[1])
        mem_total_mib = parse_nvidia_smi_number(parts[2])
        if mem_used_mib is not None and mem_total_mib is not None:
            mem_pairs.append((mem_used_mib, mem_total_mib))
        else:
            # DGX Spark unified memory では memory.* が [N/A] になることがある。
            pass
        if len(parts) >= 13:
            for bucket, idx in [
                (gpu_temperatures, 3),
                (gpu_power_draws, 4),
                (gpu_power_limits, 5),
                (gpu_clock_sms, 6),
                (gpu_clock_graphics, 7),
                (gpu_clock_memory, 8),
            ]:
                value = parse_nvidia_smi_number(parts[idx])
                if value is not None:
                    bucket.append(value)
            pstate = first_present([parts[9]])
            if pstate is not None:
                gpu_pstates.append(pstate)
            throttle_reason = first_present([parts[10]])
            if throttle_reason is not None:
                gpu_throttle_reasons.append(throttle_reason)
            gpu_name = first_present([parts[11]])
            if gpu_name is not None:
                gpu_names.append(gpu_name)
            driver_version = first_present([parts[12]])
            if driver_version is not None:
                driver_versions.append(driver_version)
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
            payload: dict[str, float | str] = {"gpuUtilPct": round(util_avg, 1)}
            add_gpu_detail_metrics(
                payload,
                gpu_temperatures,
                gpu_power_draws,
                gpu_power_limits,
                gpu_clock_sms,
                gpu_clock_graphics,
                gpu_clock_memory,
                gpu_pstates,
                gpu_throttle_reasons,
                gpu_names,
                driver_versions,
            )
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

    payload: dict[str, float | str] = {
        "gpuUtilPct": round(util_avg, 1),
        "unifiedMemoryUsedGiB": round(used_gib, 1),
        "unifiedMemoryTotalGiB": round(total_gib, 1),
        "freeMemoryGiB": round(max(0.0, total_gib - used_gib), 1),
    }
    add_gpu_detail_metrics(
        payload,
        gpu_temperatures,
        gpu_power_draws,
        gpu_power_limits,
        gpu_clock_sms,
        gpu_clock_graphics,
        gpu_clock_memory,
        gpu_pstates,
        gpu_throttle_reasons,
        gpu_names,
        driver_versions,
    )
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

        def _llm_auth_ok(self) -> bool:
            return llm_shared_token_ok(self.headers, config.llm_shared_tokens)

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

        def _send_json(self, status: int, payload: dict) -> None:
            self._send(
                status,
                json.dumps(payload, ensure_ascii=False).encode("utf-8"),
                "application/json; charset=utf-8",
            )

        def do_GET(self) -> None:
            if self.path == "/healthz":
                self._send_text(200, "ok\n")
                return
            if self.path == "/system/metrics":
                if not self._llm_auth_ok():
                    self._send_text(403, "forbidden")
                    return
                ok, payload = collect_gpu_metrics()
                if ok and payload is not None:
                    self._send(200, json.dumps(payload).encode("utf-8"), "application/json; charset=utf-8")
                else:
                    self._send(503, b'{"ok":false,"reason":"gpu_metrics_unavailable"}', "application/json; charset=utf-8")
                return
            if self.path == "/system/model-profiles":
                if not self._llm_auth_ok():
                    self._send_text(403, "forbidden")
                    return
                try:
                    profiles = load_model_profiles(config.model_registry_root)
                    active_state = read_active_model_state(config.active_model_state_path)
                    resource_state = read_resource_state(config.resource_state_path)
                    self._send_json(
                        200,
                        {
                            "ok": True,
                            "profiles": [model_profile_to_api(profile) for profile in profiles],
                            "activeProfileId": active_state.model_profile_id if active_state else None,
                            "state": active_model_state_to_api(active_state) if active_state else None,
                            "resourceState": state_to_api(resource_state) if resource_state else None,
                        },
                    )
                except Exception as exc:
                    self._send_json(503, {"ok": False, "code": "MODEL_PROFILES_UNAVAILABLE", "message": str(exc)})
                return
            if self.path == "/system/resource-state":
                if not self._llm_auth_ok():
                    self._send_text(403, "forbidden")
                    return
                resource_state = read_resource_state(config.resource_state_path)
                if resource_state is None:
                    self._send_json(
                        503,
                        {
                            "ok": False,
                            "code": "DGX_RESOURCE_STATE_UNAVAILABLE",
                            "message": "resource state is unavailable",
                        },
                    )
                    return
                self._send_json(200, {"ok": True, **state_to_api(resource_state)})
                return
            if self.path == "/system/model-profile":
                if not self._llm_auth_ok():
                    self._send_text(403, "forbidden")
                    return
                active_state = read_active_model_state(config.active_model_state_path)
                if active_state is None:
                    self._send_json(
                        503,
                        {
                            "ok": False,
                            "code": "ACTIVE_MODEL_PROFILE_UNAVAILABLE",
                            "message": "active profile state is unavailable",
                        },
                    )
                    return
                self._send_json(200, {"ok": True, **active_model_state_to_api(active_state)})
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
                if not self._llm_auth_ok():
                    self._send_text(403, "forbidden")
                    return
                active_backend = resolve_active_backend(config)
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
            if self.path in ("/start", "/stop", "/stop-force"):
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
                        is_start = self.path.endswith("/start")
                        resource_state = write_gateway_resource_state_best_effort(
                            config,
                            owner="private",
                            status="preparing" if is_start else "released",
                            action="private-comfyui-start" if is_start else "private-comfyui-stop",
                            reason=reason_from_json_body(body),
                        )
                        payload_body = {"ok": True, "path": self.path}
                        if resource_state is not None:
                            payload_body["resourceState"] = resource_state
                        payload = json.dumps(payload_body).encode("utf-8")
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
                        is_start = self.path.endswith("/start")
                        resource_state = write_gateway_resource_state_best_effort(
                            config,
                            owner="experiment",
                            status="preparing" if is_start else "released",
                            action="experiment-lab-start" if is_start else "experiment-lab-stop",
                            reason=reason_from_json_body(body),
                        )
                        payload_body = {"ok": True, "path": self.path}
                        if resource_state is not None:
                            payload_body["resourceState"] = resource_state
                        payload = json.dumps(payload_body).encode("utf-8")
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
                        is_start = self.path.endswith("/start")
                        resource_state = write_gateway_resource_state_best_effort(
                            config,
                            owner="experiment",
                            status="preparing" if is_start else "released",
                            action="agent-container-start" if is_start else "agent-container-stop",
                            reason=reason_from_json_body(body),
                        )
                        payload_body = {"ok": True, "path": self.path}
                        if resource_state is not None:
                            payload_body["resourceState"] = resource_state
                        payload = json.dumps(payload_body).encode("utf-8")
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
                if not self._llm_auth_ok():
                    self._send_text(403, "forbidden")
                    return
                headers = {"Content-Type": self.headers.get("Content-Type", "application/json")}
                active_backend = resolve_active_backend(config)
                upstream_body = inject_blue_chat_completions_defaults(
                    self.path, body, active_backend
                )
                status, resp_body, content_type = proxy_impl(
                    "POST",
                    f"{resolve_backend_base_url(config)}{self.path}",
                    upstream_body,
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
