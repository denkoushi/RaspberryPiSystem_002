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
  BLUE_LLM_RUNTIME_STOP_MODE  任意: on_demand | keep_warm | always_on（他は runtime_stop_policy 参照）
  BLUE_LLM_RUNTIME_KEEP_WARM  任意: 互換用（STOP_MODE 未使用時、true で keep_warm 相当）
  DGX_LLM_SINGLE_ACTIVE_GUARD 任意: true/false（既定 true）。true のとき POST /start 前に非アクティブ側へ実 stop を必ず掛け、
                                  green/blue 両方の stop が解決できることを起動時に検証する（単一アクティブ運用）
  DGX_MODEL_REGISTRY_ROOT     任意: モデルプロファイル manifest の root
  DGX_ACTIVE_MODEL_STATE_PATH 任意: active model profile state JSON の保存先
  DGX_RESOURCE_STATE_PATH     任意: DGX 共有リソース owner/state JSON の保存先
  LLM_RUNTIME_LISTEN_HOST    既定: 127.0.0.1
  LLM_RUNTIME_LISTEN_PORT    既定: 39090

HTTP:
  POST /start       active backend を起動（modelProfileId 指定時は profile backend を優先）
  POST /stop        通常停止（blue + keep_warm / always_on では no-op）
  POST /stop-force  強制停止（keep_warm を上書きして active backend を実 stop）
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
import time
import uuid
import urllib.request
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Protocol

# 同一ディレクトリの policy を import 可能にする（python3 /path/to/control-server.py 実行時）
_SCRIPT_DIR = Path(__file__).resolve().parent
if str(_SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPT_DIR))

from dgx_llm_single_active_guard import (  # noqa: E402
    inactive_backend,
    resolve_hard_stop_for_backend,
    single_active_guard_enabled,
    validate_both_backend_stops_configured,
)
from active_model_state import (active_model_state_to_api, read_active_model_state, write_active_model_state,
    business_switch_enabled, business_selection_state, business_state_lock, replace_active_payload,
    BUSINESS_PROFILES, DEEPSEEK_PROFILE, GLM_PROFILE)  # noqa: E402
from model_profiles import (  # noqa: E402
    BusinessRestoreUnavailableError,
    ModelProfileError,
    ModelProfile,
    validate_startable_profile,
)
from profile_launcher import launcher_env_for_profile  # noqa: E402
from resource_state import infer_owner_from_profile, state_to_api, write_resource_state  # noqa: E402
from vision_readiness import assess_runtime_readiness  # noqa: E402
from runtime_stop_policy import (  # noqa: E402
    BlueStopMode,
    should_use_noop_stop_for_blue,
    load_blue_stop_mode_from_env,
)


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
    # blue ランタイムの /stop 解釈: on_demand / keep_warm / always_on（runtime_stop_policy 参照）
    blue_stop_mode: BlueStopMode
    host: str
    port: int
    model_registry_root: str = "/srv/dgx/shared-models/registry"
    active_model_state_path: str = "/srv/dgx/system-prod/state/active-model-profile.json"
    resource_state_path: str = "/srv/dgx/system-prod/state/dgx-resource-state.json"


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
        blue_stop_mode=load_blue_stop_mode_from_env(),
        model_registry_root=(os.environ.get("DGX_MODEL_REGISTRY_ROOT") or "/srv/dgx/shared-models/registry").strip(),
        active_model_state_path=(
            os.environ.get("DGX_ACTIVE_MODEL_STATE_PATH")
            or "/srv/dgx/system-prod/state/active-model-profile.json"
        ).strip(),
        resource_state_path=(
            os.environ.get("DGX_RESOURCE_STATE_PATH")
            or "/srv/dgx/system-prod/state/dgx-resource-state.json"
        ).strip(),
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
    if single_active_guard_enabled():
        validate_both_backend_stops_configured(
            green_stop_cmd=config.green_stop_cmd,
            blue_stop_cmd=config.blue_stop_cmd,
            legacy_stop_cmd=config.stop_cmd,
        )


class CommandRunner(Protocol):
    def __call__(self, command: str, extra_env: dict[str, str] | None = None) -> None: ...


def run_shell(command: str, extra_env: dict[str, str] | None = None) -> None:
    env = os.environ.copy()
    if extra_env:
        env.update(extra_env)
    subprocess.run(
        ["bash", "-lc", command],
        check=True,
        timeout=120,
        capture_output=True,
        text=True,
        env=env,
    )


def resolve_effective_backend(config: ControlConfig) -> tuple[str, str]:
    """
    停止対象 backend を決める。
    active model state があれば実稼働 backend を優先し、無ければ ACTIVE_LLM_BACKEND にフォールバック。
    戻り値: (backend, source) where source is model_profile_state | env_fallback
    """
    state = read_active_model_state(config.active_model_state_path)
    if state is not None and state.backend in {"green", "blue"}:
        return state.backend, "model_profile_state"
    return config.active_backend, "env_fallback"


def resolve_effective_backend_for_stop_force(config: ControlConfig) -> tuple[str, str]:
    """後方互換の別名。"""
    return resolve_effective_backend(config)


def resolve_command(config: ControlConfig, action: str, backend: str | None = None) -> str:
    active_backend = backend or config.active_backend
    if action == "start":
        command = config.green_start_cmd if active_backend == "green" else config.blue_start_cmd
        fallback = config.start_cmd
    elif action in {"stop", "stop-force"}:
        if (
            action == "stop"
            and active_backend == "blue"
            and should_use_noop_stop_for_blue(config.blue_stop_mode)
        ):
            # keep_warm / always_on: 実 stop を掛けず no-op（cold start 回避・常駐相当）
            return ":"
        command = config.green_stop_cmd if active_backend == "green" else config.blue_stop_cmd
        fallback = config.stop_cmd
    else:  # pragma: no cover
        raise ValueError(f"unknown action: {action}")
    resolved = command or fallback
    if not resolved:
        raise SystemExit(
            f"{action} command is required for backend={active_backend} "
            "(set backend-specific command or legacy LLM_RUNTIME_* fallback)"
        )
    return resolved


def read_json_body(handler: BaseHTTPRequestHandler) -> dict[str, object]:
    length = int(handler.headers.get("Content-Length", "0"))
    if length <= 0:
        return {}
    raw = handler.rfile.read(length)
    if not raw:
        return {}
    try:
        parsed = json.loads(raw.decode("utf-8"))
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _string_body_value(body: dict[str, object], key: str) -> str | None:
    value = body.get(key)
    return value.strip() if isinstance(value, str) and value.strip() else None


def resolve_start_profile(
    config: ControlConfig,
    model_profile_id: object,
    reason: str | None,
) -> ModelProfile | None:
    """Resolve an explicit profile or a validated last active business profile.

    Profile-less starts prefer the last profile state, keeping the legacy
    environment fallback if it is unavailable or invalid.  Business restore
    fails closed unless that state still names an available business profile.
    """
    if isinstance(model_profile_id, str) and model_profile_id.strip():
        return validate_startable_profile(config.model_registry_root, model_profile_id.strip())
    if reason != "business-restore":
        try:
            state = read_active_model_state(config.active_model_state_path)
            if state is not None:
                profile = validate_startable_profile(config.model_registry_root, state.model_profile_id)
                if profile.business_orchestration_eligible and profile.backend == state.backend:
                    return profile
        except (ModelProfileError, OSError, ValueError):
            pass
        return None

    try:
        state = read_active_model_state(config.active_model_state_path)
        if state is None:
            raise BusinessRestoreUnavailableError("business restore profile state is unavailable")
        profile = validate_startable_profile(config.model_registry_root, state.model_profile_id)
    except BusinessRestoreUnavailableError:
        raise
    except (ModelProfileError, OSError, ValueError) as error:
        raise BusinessRestoreUnavailableError("business restore profile is unavailable") from error
    if not profile.business_orchestration_eligible or profile.backend != state.backend:
        raise BusinessRestoreUnavailableError("business restore profile is not eligible")
    return profile


def write_resource_state_best_effort(
    config: ControlConfig,
    *,
    owner: str,
    status: str,
    action: str,
    reason: str | None,
    profile,
    backend: str | None,
    guarantee_level: str | None,
) -> dict[str, object] | None:
    try:
        state = write_resource_state(
            config.resource_state_path,
            owner=owner,
            status=status,
            action=action,
            reason=reason,
            profile=profile,
            backend=backend,
            guarantee_level=guarantee_level,
        )
    except OSError:
        return None
    return state_to_api(state)


class SelectionConflict(ModelProfileError):
    status_code = 409
    code = "BUSINESS_SELECTION_CONFLICT"


def assert_selection_request(state: dict, body: dict) -> None:
    profile_id = body.get("modelProfileId")
    revision = body.get("selectionRevision")
    if ((profile_id is not None and profile_id != state["selectedBusinessProfileId"])
            or (revision is not None and (type(revision) is not int or revision != state["selectionRevision"]))
            or (body.get("reason") == "keep-warm" and revision is None)):
        raise SelectionConflict("stale or mismatching business selection")


def business_runtime_status(config: ControlConfig) -> dict:
    from business_tensorfold import runtime_status
    state = business_selection_state(config.active_model_state_path)
    generation = state.get("businessGeneration")
    if (not generation and state["selectedBusinessProfileId"] == GLM_PROFILE
            and state["businessTransition"] == "idle" and state["selectionRevision"] == 0):
        # Legacy GLM has no launch generation. Inspect its real ranks under a
        # stable initial identity; a subsequent start creates a fresh generation.
        generation = "business-glm-initial-0"
    if not isinstance(generation, str) or not generation:
        raise BusinessRestoreUnavailableError("business runtime generation unavailable")
    if state["selectedBusinessProfileId"] == DEEPSEEK_PROFILE:
        result = runtime_status(generation)
    else:
        from resource_state import glm_business_runtime
        result = glm_business_runtime(generation)
    result.update(modelProfileId=state["selectedBusinessProfileId"], selectionRevision=state["selectionRevision"])
    if state.get("businessFailureReason"):
        result["failureReason"] = state["businessFailureReason"]
    if business_selection_state(config.active_model_state_path) != state:
        raise SelectionConflict("business runtime changed during inspection")
    return result


def business_active_running(config: ControlConfig) -> bool:
    try:
        value = business_runtime_status(config)
        return value["prepared"] and not value["failureReason"] and all(r["running"] for r in value["ranks"])
    except Exception:
        return False


def monitor_business_ready(config: ControlConfig, identity: tuple, profile: ModelProfile) -> None:
    # Detached start stays within the existing command timeout. Readiness is
    # fenced by selection + generation and never probes through a loading gateway.
    from business_tensorfold import runtime_status
    deadline = time.monotonic() + 1200
    failure = "business_readiness_timeout"
    base = "http://192.168.100.11:8889" if profile.id == DEEPSEEK_PROFILE else "http://127.0.0.1:38083"
    headers = {}
    if profile.id == DEEPSEEK_PROFILE:
        key = os.environ.get("BUSINESS_DEEPSEEK_UPSTREAM_API_KEY", "").strip()
        if not key:
            failure = "business_upstream_key_missing"
            deadline = 0
        headers["Authorization"] = "Bearer " + key
    while time.monotonic() < deadline:
        try:
            with business_state_lock(config.active_model_state_path, exclusive=False):
                state = business_selection_state(config.active_model_state_path)
                if (state["selectedBusinessProfileId"], state["selectionRevision"], state.get("businessGeneration")) != identity or state["businessTransition"] != "loading":
                    return
                with urllib.request.urlopen(urllib.request.Request(base + "/v1/models", headers=headers), timeout=8) as response:
                    models = json.load(response)["data"]
                if not any(m.get("id") == "system-prod-primary" for m in models):
                    raise ValueError("alias mismatch")
                body = {"model": "system-prod-primary", "messages": [{"role": "user", "content": "Reply OK."}], "max_tokens": 16, "temperature": 0}
                if profile.id != DEEPSEEK_PROFILE:
                    body["chat_template_kwargs"] = {"reasoning_effort": "low"}
                request = urllib.request.Request(base + "/v1/chat/completions", data=json.dumps(body).encode(), headers={**headers, "Content-Type": "application/json"})
                with urllib.request.urlopen(request, timeout=30) as response:
                    message = json.load(response)["choices"][0]["message"]["content"]
                if not isinstance(message, str) or not message.strip():
                    raise ValueError("empty inference probe")
                if profile.id == DEEPSEEK_PROFILE:
                    status = runtime_status(identity[2])
                    if not status["prepared"] or status["failureReason"] or not all(r["running"] for r in status["ranks"]):
                        raise ValueError("runtime not ready")
            with business_state_lock(config.active_model_state_path):
                state = business_selection_state(config.active_model_state_path)
                if (state["selectedBusinessProfileId"], state["selectionRevision"], state.get("businessGeneration")) == identity and state["businessTransition"] == "loading":
                    state["businessTransition"] = "ready"
                    replace_active_payload(config.active_model_state_path, state)
            return
        except Exception:
            time.sleep(5)
    with business_state_lock(config.active_model_state_path):
        state = business_selection_state(config.active_model_state_path)
        if (state["selectedBusinessProfileId"], state["selectionRevision"], state.get("businessGeneration")) == identity and state["businessTransition"] == "loading":
            state.update(businessTransition="failed", businessFailureReason=failure)
            replace_active_payload(config.active_model_state_path, state)


_business_monitors: dict[str, tuple[tuple, threading.Thread]] = {}


def recover_business_loading(config: ControlConfig, state: dict) -> dict:
    # Caller holds the lifecycle lock, so a start cannot race registration.
    identity = (state["selectedBusinessProfileId"], state["selectionRevision"], state.get("businessGeneration"))
    monitor = _business_monitors.get(config.active_model_state_path)
    if state["businessTransition"] == "loading" and not (
            monitor and monitor[0] == identity and monitor[1].is_alive()):
        state.update(businessTransition="failed", businessFailureReason="business_control_restarted")
        replace_active_payload(config.active_model_state_path, state)
    return state


def make_handler(config: ControlConfig, command_runner: CommandRunner = run_shell) -> type[BaseHTTPRequestHandler]:
    if business_switch_enabled():
        with business_state_lock(config.active_model_state_path):
            recover_business_loading(config, business_selection_state(config.active_model_state_path, config.model_registry_root))

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
            if self.path == "/system/resource-state" and business_switch_enabled():
                try:
                    self._send_json(200, {"ok": True, "businessRuntime": business_runtime_status(config)})
                except Exception:
                    self._send_json(503, {"ok": False, "code": "BUSINESS_RUNTIME_UNAVAILABLE"})
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
                if business_switch_enabled() and self.path in {"/start", "/stop", "/stop-force"}:
                    self._business_post(read_json_body(self))
                    return
                if self.path == "/start":
                    body = read_json_body(self)
                    model_profile_id = body.get("modelProfileId")
                    reason = _string_body_value(body, "reason")
                    profile = resolve_start_profile(config, model_profile_id, reason)
                    start_backend = config.active_backend
                    if profile is not None:
                        start_backend = profile.backend
                    if single_active_guard_enabled():
                        hard_stop = resolve_hard_stop_for_backend(
                            inactive_backend(start_backend),
                            green_stop_cmd=config.green_stop_cmd,
                            blue_stop_cmd=config.blue_stop_cmd,
                            legacy_stop_cmd=config.stop_cmd,
                        )
                        command_runner(hard_stop)
                    start_env = launcher_env_for_profile(profile) if profile is not None else None
                    if start_env:
                        command_runner(resolve_command(config, "start", start_backend), start_env)
                    else:
                        command_runner(resolve_command(config, "start", start_backend))
                    payload: dict[str, object] = {"ok": True, "action": "start", "backend": start_backend}
                    resource_state = write_resource_state_best_effort(
                        config,
                        owner=infer_owner_from_profile(profile, reason),
                        status="preparing",
                        action="start",
                        reason=reason,
                        profile=profile,
                        backend=start_backend,
                        guarantee_level="post_only",
                    )
                    if resource_state is not None:
                        payload["resourceState"] = resource_state
                    if profile is not None:
                        ready_caps, vision_reason = assess_runtime_readiness(profile, start_env=start_env)
                        state = write_active_model_state(
                            config.active_model_state_path,
                            profile,
                            runtime_ready_capabilities=ready_caps,
                            vision_ready_reason=vision_reason,
                        )
                        payload["modelProfile"] = active_model_state_to_api(state)
                    self._send_json(200, payload)
                    return
                if self.path == "/stop":
                    body = read_json_body(self)
                    reason = _string_body_value(body, "reason")
                    stop_backend, stop_source = resolve_effective_backend(config)
                    command_runner(resolve_command(config, "stop", stop_backend))
                    resource_state = write_resource_state_best_effort(
                        config,
                        owner=infer_owner_from_profile(None, reason),
                        status="released",
                        action="stop",
                        reason=reason,
                        profile=None,
                        backend=stop_backend,
                        guarantee_level="post_only",
                    )
                    payload: dict[str, object] = {
                        "ok": True,
                        "action": "stop",
                        "backend": stop_backend,
                        "backendSource": stop_source,
                    }
                    if resource_state is not None:
                        payload["resourceState"] = resource_state
                    self._send_json(200, payload)
                    return
                if self.path == "/stop-force":
                    body = read_json_body(self)
                    reason = _string_body_value(body, "reason")
                    stop_backend, stop_source = resolve_effective_backend(config)
                    command_runner(resolve_command(config, "stop-force", stop_backend))
                    resource_state = write_resource_state_best_effort(
                        config,
                        owner="private",
                        status="released",
                        action="stop-force",
                        reason=reason,
                        profile=None,
                        backend=stop_backend,
                        guarantee_level="post_only",
                    )
                    payload = {
                        "ok": True,
                        "action": "stop-force",
                        "backend": stop_backend,
                        "backendSource": stop_source,
                    }
                    if resource_state is not None:
                        payload["resourceState"] = resource_state
                    self._send_json(200, payload)
                    return
                self._send_text(404, "not found")
            except subprocess.CalledProcessError as exc:
                if business_switch_enabled():
                    self._send_json(503, {"ok": False, "code": "business_runtime_control_failed"})
                    return
                detail = exc.stderr or exc.stdout or str(exc)
                self._send_text(500, detail[:2000])
            except ModelProfileError as exc:
                self._send_json(exc.status_code, {"ok": False, "code": exc.code, "message": str(exc)})
            except Exception as exc:  # pragma: no cover
                self._send_text(500, str(exc))

        def _business_post(self, body: dict) -> None:
            reason = _string_body_value(body, "reason")
            with business_state_lock(config.active_model_state_path):
                state = business_selection_state(config.active_model_state_path)
                if self.path == "/start":
                    state = recover_business_loading(config, state)
                if reason in {"keep-warm", "business-restore"}:
                    assert_selection_request(state, body)
                if self.path != "/start":
                    backend, source = resolve_effective_backend(config)
                    # Selection never changes on a private stop or recovery stop.
                    stop_env = None
                    if state.get("modelProfileId") == DEEPSEEK_PROFILE:
                        stop_env = {"DGX_BUSINESS_GENERATION": state.get("businessGeneration", "")}
                    command = resolve_command(config, self.path[1:], backend)
                    try:
                        command_runner(command, stop_env)
                    except Exception:
                        state.update(businessTransition="failed", businessFailureReason="business_runtime_stop_unverified")
                        replace_active_payload(config.active_model_state_path, state)
                        self._send_json(503, {"ok": False, "code": "business_runtime_stop_unverified"})
                        return
                    if command != ":":
                        state["businessTransition"] = "idle"
                    replace_active_payload(config.active_model_state_path, state)
                    self._send_json(200, {"ok": True, "action": self.path[1:], "backend": backend, "backendSource": source})
                    return
                requested = _string_body_value(body, "modelProfileId")
                selected = state["selectedBusinessProfileId"]
                profile_id = requested or selected
                profile = validate_startable_profile(config.model_registry_root, profile_id)
                explicit = reason == "business-model-selection"
                if explicit and (profile_id not in BUSINESS_PROFILES or not profile.business_orchestration_eligible):
                    raise SelectionConflict("unsupported business profile")
                if profile.business_orchestration_eligible:
                    if profile_id not in BUSINESS_PROFILES:
                        raise SelectionConflict("unsupported business profile")
                    if not explicit:
                        assert_selection_request(state, body)
                    if profile_id == DEEPSEEK_PROFILE:
                        from business_tensorfold import check_prepared
                        try:
                            check_prepared()
                        except RuntimeError as error:
                            raise BusinessRestoreUnavailableError(str(error)) from error
                    # Duplicate UI clicks and keep-warm do not create a new generation.
                    if (profile_id == selected and state.get("modelProfileId") == selected
                            and (state["businessTransition"] == "loading" or (
                                state["businessTransition"] == "ready" and business_active_running(config)))):
                        self._send_json(200, {"ok": True, "action": "start", "backend": profile.backend})
                        return
                    if explicit:
                        state["selectedBusinessProfileId"] = profile_id
                        state["selectionRevision"] += 1
                    state.update(businessTransition="loading", businessGeneration=uuid.uuid4().hex)
                    state.pop("businessFailureReason", None)
                else:
                    if not profile.id.startswith("private_"):
                        raise SelectionConflict("unsupported private profile")
                    state["businessTransition"] = "idle"
                replace_active_payload(config.active_model_state_path, state)
                try:
                    # Drain has completed under the shared gateway/lifecycle lock.
                    # Always stop blue too: GLM and DeepSeek share that backend.
                    command_runner(resolve_command(config, "stop-force", "blue"))
                    if single_active_guard_enabled():
                        command_runner(resolve_command(config, "stop-force", "green"))
                    start_env = launcher_env_for_profile(profile)
                    if profile.business_orchestration_eligible:
                        start_env["DGX_BUSINESS_GENERATION"] = state["businessGeneration"]
                    command_runner(resolve_command(config, "start", profile.backend), start_env)
                    ready_caps, vision_reason = assess_runtime_readiness(profile, start_env=start_env)
                    active = write_active_model_state(config.active_model_state_path, profile,
                        runtime_ready_capabilities=ready_caps, vision_ready_reason=vision_reason)
                    write_resource_state_best_effort(config, owner=infer_owner_from_profile(profile, reason),
                        status="preparing", action="start", reason=reason, profile=profile,
                        backend=profile.backend, guarantee_level="post_only")
                except Exception:
                    state = business_selection_state(config.active_model_state_path)
                    state.update(businessTransition="failed", businessFailureReason="business_runtime_start_failed")
                    replace_active_payload(config.active_model_state_path, state)
                    self._send_json(503, {"ok": False, "code": "business_runtime_start_failed"})
                    return
                if profile.business_orchestration_eligible:
                    identity = (state["selectedBusinessProfileId"], state["selectionRevision"], state["businessGeneration"])
                    monitor = threading.Thread(target=monitor_business_ready, args=(config, identity, profile), daemon=True)
                    _business_monitors[config.active_model_state_path] = (identity, monitor)
                    monitor.start()
                self._send_json(200, {"ok": True, "action": "start", "backend": profile.backend,
                                      "modelProfile": active_model_state_to_api(active)})

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
