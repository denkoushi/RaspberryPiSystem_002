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
import re
import json
import sys
import subprocess
import time
import socket
import secrets
import http.client
import threading
from contextlib import contextmanager, nullcontext
from urllib.parse import urlsplit
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Callable

from glm_runtime_config import glm_runtime_config
from business_diagnostics import log_business_failure  # noqa: E402
from active_model_state import (active_model_state_to_api, read_active_model_state, business_switch_enabled,
    business_selection_state, business_state_lock, GLM_PROFILE, DEEPSEEK_PROFILE,
    BUSINESS_QWEN38_PROFILE_ID, business_qwen38_switch_enabled,
    business_draining, positive_env_seconds, control_request_budget)
from gateway_llm_auth import load_llm_shared_tokens_from_env, llm_shared_token_ok
from model_profiles import UnknownModelProfileError, find_model_profile, load_model_profiles, model_profile_to_api
from model_storage_delete import (
    DEFAULT_MODEL_STORAGE_DELETE_ALLOWED_ROOTS,
    ModelStorageDeleteError,
    build_model_storage_delete_plan,
    delete_preview_to_api,
    delete_protection_to_api,
    execute_model_storage_delete,
    parse_allowed_roots,
)
from resource_state import read_resource_state, state_to_api, write_resource_state
from business_qwen38 import sharing_evidence as qwen_sharing_evidence

QWEN_PRIVATE_WAIT_SECONDS = 30
QWEN_BUSINESS_PREEMPT_SECONDS = 5
QWEN_CACHE_RESET_SECONDS = 10
QWEN_BUSINESS_DRAIN_SECONDS = 2
QWEN_PREFIX_RESET_INTERVAL_SECONDS = 0.5
_QWEN_PRIVATE_CACHE_SALT = secrets.token_hex(32)


class QwenOwnerExclusive:
    """One admission gate for the single gateway process and both vLLM ranks."""
    def __init__(self):
        self.condition = threading.Condition()
        self.identity = None
        self.owner = 'unknown'
        self.uncleared = True
        self.transitioning = False
        self.business_waiters = 0
        self.active = {'business': set(), 'private': set()}

    @contextmanager
    def request(self, owner, identity, handler, reset, draining):
        stopped = threading.Event()
        def watch_lifecycle():
            while not stopped.wait(0.05):
                if draining():
                    handler._business_abort()
                    return
        watcher = None
        if owner == 'private':
            watcher = threading.Thread(target=watch_lifecycle, daemon=True)
            watcher.start()
        try:
            with self._admit(owner, identity, handler, reset, draining):
                yield
        finally:
            stopped.set()
            if watcher:
                watcher.join()

    @contextmanager
    def _admit(self, owner, identity, handler, reset, draining):
        business = owner == 'business'
        deadline = time.monotonic() + QWEN_PRIVATE_WAIT_SECONDS
        with self.condition:
            if self.identity != identity:
                self.identity = identity
                self.owner = 'private' if self.active['private'] else 'unknown'
                self.uncleared = True
            if business:
                self.business_waiters += 1
            try:
                while True:
                    if draining() or handler._business_timed_out:
                        raise ValueError('business_draining')
                    if not business and (self.business_waiters or self.identity != identity):
                        raise ValueError('private_shared_busy')
                    if self.transitioning:
                        if not business and time.monotonic() >= deadline:
                            raise ValueError('private_shared_busy')
                        self.condition.wait(0.05)
                        continue
                    if business and self.owner == 'business':
                        break
                    if not business and self.owner == 'private':
                        if not self.uncleared:
                            break
                        if self.active['private']:
                            # An identity change left old private work behind.
                            # Only business may preempt that work.
                            raise ValueError('private_shared_busy')
                        # Old private work has ended: clear before private resumes.
                    if not business and (self.active['business'] or self.active['private']):
                        remaining = deadline - time.monotonic()
                        if remaining <= 0:
                            raise ValueError('private_shared_busy')
                        self.condition.wait(min(remaining, 0.05))
                        continue
                    self.transitioning = True
                    try:
                        if business and self.active['private']:
                            cutoff = time.monotonic() + QWEN_BUSINESS_PREEMPT_SECONDS
                            while self.active['private']:
                                remaining = cutoff - time.monotonic()
                                if remaining <= 0:
                                    break
                                self.condition.wait(min(remaining, 0.05))
                            for private in self.active['private']:
                                private._qwen_preempted = True
                                private._business_abort(include_downstream=False)
                            cutoff = time.monotonic() + QWEN_BUSINESS_DRAIN_SECONDS
                            while self.active['private']:
                                remaining = cutoff - time.monotonic()
                                if remaining <= 0:
                                    for private in self.active['private']:
                                        private._business_abort()
                                    break
                                self.condition.wait(min(remaining, 0.05))
                        # Admission is closed, but completion must remain possible.
                        self.condition.release()
                        try:
                            def cancelled():
                                with self.condition:
                                    return not business and (self.business_waiters > 0 or self.identity != identity)
                            cleared = reset(cancelled)
                        except Exception:
                            cleared = False
                        finally:
                            self.condition.acquire()
                        if not business and (cleared is None or cancelled()):
                            # No private inference was admitted. Keep the previous
                            # isolation state and let business skip another reset.
                            if self.identity == identity:
                                self.owner = 'business'
                            raise ValueError('private_shared_busy')
                        self.uncleared = not cleared
                        self.owner = owner if business or cleared else 'business'
                        if not business and not cleared:
                            raise ValueError('private_shared_isolation_failed')
                    finally:
                        self.transitioning = False
                        self.condition.notify_all()
                    # A business arrival or lifecycle mutation during reset wins.
                self.active[owner].add(handler)
            finally:
                if business:
                    self.business_waiters -= 1
                self.condition.notify_all()
        try:
            yield
        finally:
            with self.condition:
                self.active[owner].remove(handler)
                self.condition.notify_all()


def reset_qwen_caches(base, proxy, cancelled=lambda: False):
    deadline = time.monotonic() + QWEN_CACHE_RESET_SECONDS
    _business_request.reset_deadline = deadline
    expired = threading.Event()
    context = getattr(_business_request, 'context', None)
    def expire():
        expired.set()
        if context is not None:
            _, guard, sockets, handler = context
            with guard:
                for current in sockets:
                    if current is not handler.connection:
                        try:
                            current.shutdown(socket.SHUT_RDWR)
                        except OSError:
                            pass
    timer = threading.Timer(max(0, deadline - time.monotonic()), expire)
    timer.daemon = True
    timer.start()
    try:
        while True:
            if cancelled():
                return None
            if expired.is_set() or time.monotonic() >= deadline:
                return False
            status, body, _ = proxy('POST', base + '/reset_prefix_cache', b'', {})
            if not 200 <= status < 300:
                return False
            success = json.loads(body).get('success')
            if success is True:
                break
            remaining = deadline - time.monotonic()
            if success is not False or remaining <= 0:
                return False
            time.sleep(min(QWEN_PREFIX_RESET_INTERVAL_SECONDS, remaining))
        for endpoint in ('/reset_mm_cache', '/reset_encoder_cache'):
            if cancelled():
                return None
            if expired.is_set() or time.monotonic() >= deadline:
                return False
            status, _, _ = proxy('POST', base + endpoint, b'', {})
            if not 200 <= status < 300:
                return False
        return not expired.is_set() and time.monotonic() < deadline
    except Exception:
        return False
    finally:
        timer.cancel()
        timer.join()
        del _business_request.reset_deadline


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
    model_storage_delete_allowed_roots: tuple[str, ...] = DEFAULT_MODEL_STORAGE_DELETE_ALLOWED_ROOTS
    private_comfy_worker_ssh_target: str = ""
    private_comfy_worker_start_cmd: str = (
        "docker compose -f /srv/dgx/private-personal/compose/dgx-private-comfyui/compose.yaml up -d --no-build"
    )
    private_comfy_worker_stop_cmd: str = (
        "docker compose -f /srv/dgx/private-personal/compose/dgx-private-comfyui/compose.yaml stop"
    )
    private_comfy_worker_cmd_timeout_sec: int = 20


def load_config_from_env() -> GatewayConfig:
    worker_target = os.environ.get("PRIVATE_COMFY_WORKER_SSH_TARGET", "")
    if worker_target and not re.fullmatch(r"[a-zA-Z0-9_][a-zA-Z0-9_.-]*@[a-zA-Z0-9_][a-zA-Z0-9_.-]*", worker_target):
        print("invalid PRIVATE_COMFY_WORKER_SSH_TARGET; private ComfyUI worker disabled", file=sys.stderr)
        worker_target = ""
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
        model_storage_delete_allowed_roots=parse_allowed_roots(os.environ.get("DGX_MODEL_STORAGE_DELETE_ALLOWED_ROOTS")),
        private_comfy_worker_ssh_target=worker_target,
        private_comfy_worker_start_cmd=(
            os.environ.get("PRIVATE_COMFY_WORKER_START_CMD") or GatewayConfig.private_comfy_worker_start_cmd
        ).strip(),
        private_comfy_worker_stop_cmd=(
            os.environ.get("PRIVATE_COMFY_WORKER_STOP_CMD") or GatewayConfig.private_comfy_worker_stop_cmd
        ).strip(),
        private_comfy_worker_cmd_timeout_sec=int((os.environ.get("PRIVATE_COMFY_WORKER_CMD_TIMEOUT_SEC") or "20").strip()),
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


def business_routing_required(config: GatewayConfig) -> bool:
    if business_switch_enabled():
        return True
    # Disabling the flags must fence a still-selected Qwen runtime instead of
    # falling back to the legacy blue route on its shared private/business port.
    try:
        with open(config.active_model_state_path, encoding="utf-8") as source:
            state = json.load(source)
        return isinstance(state, dict) and BUSINESS_QWEN38_PROFILE_ID in {
            state.get("modelProfileId"), state.get("activeProfileId"), state.get("selectedBusinessProfileId")}
    except (OSError, ValueError, TypeError):
        return False


def business_route(config: GatewayConfig) -> tuple[str, dict[str, str], str]:
    state = business_selection_state(config.active_model_state_path)
    profile = state.get("modelProfileId") or state.get("activeProfileId")
    active = read_active_model_state(config.active_model_state_path)
    generation = state.get("businessGeneration")
    legacy_glm = (not generation and state["selectedBusinessProfileId"] == GLM_PROFILE
        and state["businessTransition"] == "idle" and state["selectionRevision"] == 0)
    if (active is None or active.backend != "blue" or active.served_alias != "system-prod-primary"
            or profile != state["selectedBusinessProfileId"]
            or (not legacy_glm and (state["businessTransition"] != "ready"
                or not isinstance(generation, str) or not generation))):
        raise ValueError("business_runtime_unavailable")
    if profile == GLM_PROFILE:
        return glm_runtime_config()[2], {}, profile
    if profile == DEEPSEEK_PROFILE:
        key = os.environ.get("BUSINESS_DEEPSEEK_UPSTREAM_API_KEY", "").strip()
        if not key:
            raise ValueError("business_upstream_key_missing")
        return "http://192.168.100.11:8889", {"Authorization": "Bearer " + key}, profile
    if profile == BUSINESS_QWEN38_PROFILE_ID and business_qwen38_switch_enabled():
        return "http://127.0.0.1:38083", {}, profile
    raise ValueError("business_runtime_unavailable")


def attest_private_sharing(config: GatewayConfig, runtime: dict) -> dict:
    """Called under the routing/lifecycle lock; only this gateway proves fencing."""
    runtime = dict(runtime)
    evidence = runtime.pop("privateSharingEvidence", None)
    runtime.pop("privateSharing", None)
    try:
        _, _, profile = business_route(config)
        flag = ('DGX_PRIVATE_SHARED_QWEN38_ENABLED' if profile == BUSINESS_QWEN38_PROFILE_ID
                else 'DGX_PRIVATE_SHARED_DEEPSEEK_ENABLED')
        if os.environ.get(flag, '') not in {'true', '1'}:
            return runtime
        state = business_selection_state(config.active_model_state_path)
        generation = state["businessGeneration"]
        expected = {'generation': generation, 'weightsRevision': '878f5689-ablit-0bdc2036',
            'runtimeIdentity': 'tensorfold-native:serve:8889:parallel4:thinking',
            'promptCacheGiB': 0, 'learn': False, 'logDriver': 'none',
            'requestResponseLogging': False, 'persistsConversations': False}
        if profile == BUSINESS_QWEN38_PROFILE_ID:
            expected = qwen_sharing_evidence(generation)
        ranks = runtime['ranks']
        if (profile not in {DEEPSEEK_PROFILE, BUSINESS_QWEN38_PROFILE_ID} or runtime['modelProfileId'] != profile
                or runtime['generation'] != generation
                or type(runtime['selectionRevision']) is not int
                or runtime['selectionRevision'] != state['selectionRevision']
                or runtime['prepared'] is not True or runtime['failureReason'] is not None
                or runtime['apiListenerClosed'] is not False
                or len(ranks) != 2 or {r['rank'] for r in ranks} != {0, 1}
                or any(r['generation'] != generation or r['running'] is not True
                       or r['gpuReleased'] is not False for r in ranks)
                or not isinstance(evidence, dict) or evidence != expected
                or any(type(evidence[k]) is not type(v) for k, v in expected.items())):
            return runtime
        runtime['privateSharing'] = {**evidence, 'selectionRevision': state['selectionRevision'],
                                     'generationFenced': True}
    except (OSError, RuntimeError, ValueError, KeyError, TypeError):
        pass
    return runtime


def business_has_image(value) -> bool:
    messages = value.get("messages", [])
    return isinstance(messages, list) and any(
        isinstance(message, dict) and isinstance(message.get("content"), list) and any(
            isinstance(part, dict) and part.get("type") in {"image_url", "input_image", "image"}
            for part in message["content"])
        for message in messages)


def qwen_has_image(value) -> bool:
    if isinstance(value, dict):
        return value.get("type") in {"image_url", "input_image", "image"} or any(
            qwen_has_image(part) for part in value.values())
    return isinstance(value, list) and any(qwen_has_image(part) for part in value)


def private_has_unsupported_image_url(value):
    if isinstance(value, dict):
        if 'image_url' in value:
            image = value['image_url']
            url = image.get('url') if isinstance(image, dict) else image
            if not isinstance(url, str) or not url.startswith('data:'):
                return True
        return any(private_has_unsupported_image_url(part) for part in value.values())
    return isinstance(value, list) and any(private_has_unsupported_image_url(part) for part in value)


def business_sse_alias(line: bytes) -> bytes:
    if not line.startswith(b"data:"):
        return line
    try:
        value = json.loads(line[5:])
    except (ValueError, UnicodeDecodeError):
        return line
    if not isinstance(value, dict) or "model" not in value:
        return line
    value["model"] = "system-prod-primary"
    return b"data: " + json.dumps(value, ensure_ascii=False).encode() + (b"\r" if line.endswith(b"\r") else b"")


def business_response_alias(body: bytes) -> bytes:
    value = json.loads(body)
    if isinstance(value, dict) and "model" in value:
        value["model"] = "system-prod-primary"
    return json.dumps(value, ensure_ascii=False).encode()


def deepseek_json_request(payload: dict) -> tuple[dict, bool]:
    guided = [key for key in payload if key.startswith("guided_")]
    if "response_format" not in payload and not guided:
        return payload, False
    result = {key: value for key, value in payload.items() if key != "response_format" and key not in guided}
    response_format = payload.get("response_format")
    if isinstance(response_format, dict) and response_format.get("type") == "text" and not guided:
        return result, False
    schema = None
    if isinstance(response_format, dict) and isinstance(response_format.get("json_schema"), dict):
        schema = response_format["json_schema"].get("schema")
    if schema is None:
        schema = payload.get("guided_json")
        if isinstance(schema, str):
            try:
                schema = json.loads(schema)
            except ValueError:
                schema = None
    instruction = "Answer with exactly one JSON object, no code fences, no text before or after it."
    if isinstance(schema, dict):
        instruction += "\nJSON schema: " + json.dumps(schema, ensure_ascii=False)
    messages = list(result.get("messages") or [])
    first = messages[0] if messages else None
    if isinstance(first, dict) and first.get("role") == "system" and isinstance(first.get("content"), (str, list)):
        content = first["content"]
        content = content + "\n\n" + instruction if isinstance(content, str) else content + [{"type": "text", "text": instruction}]
        messages[0] = {**first, "content": content}
    else:
        messages.insert(0, {"role": "system", "content": instruction})
    result["messages"] = messages
    return result, True


def deepseek_json_response(body: bytes) -> bytes:
    try:
        value = json.loads(body)
    except (ValueError, UnicodeDecodeError):
        return body
    choices = value.get("choices", []) if isinstance(value, dict) else []
    for choice in choices if isinstance(choices, list) else []:
        message = choice.get("message") if isinstance(choice, dict) else None
        if not isinstance(message, dict) or not isinstance(message.get("content"), str):
            continue
        content = re.sub(r"<think>.*?</think>", "", message["content"], flags=re.DOTALL).strip()
        content = re.sub(r"<think>.*$", "", content, flags=re.DOTALL)
        content = re.sub(r"^.*?</think>", "", content, count=1, flags=re.DOTALL).strip()
        content = re.sub(r"^```(?:json)?\s*\n?(.*?)\s*```$", r"\1", content, flags=re.DOTALL).strip()
        try:
            obj = json.loads(content)
        except ValueError:
            obj = None
        if not isinstance(obj, dict):
            decoder = json.JSONDecoder()
            for match in re.finditer(r"\{", content):
                try:
                    obj, _ = decoder.raw_decode(content, match.start())
                except ValueError:
                    continue
                if isinstance(obj, dict):
                    break
        if isinstance(obj, dict):
            message["content"] = json.dumps(obj, ensure_ascii=False)
    return business_response_alias(json.dumps(value, ensure_ascii=False).encode())


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


def json_body_object(body: bytes) -> dict[str, object]:
    if not body:
        return {}
    try:
        payload = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return {}
    return payload if isinstance(payload, dict) else {}


def string_from_json_body(body: bytes, key: str) -> str | None:
    value = json_body_object(body).get(key)
    return value.strip() if isinstance(value, str) and value.strip() else None


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


def model_profiles_to_api_with_delete_protection(
    profiles: list,
    *,
    active_profile_id: str | None,
    allowed_roots: tuple[str, ...],
) -> list[dict[str, object]]:
    payloads: list[dict[str, object]] = []
    for profile in profiles:
        payload = model_profile_to_api(profile)
        delete_plan = build_model_storage_delete_plan(
            profile,
            all_profiles=profiles,
            active_profile_id=active_profile_id,
            allowed_roots=allowed_roots,
            include_size=False,
        )
        payload["deleteProtection"] = delete_protection_to_api(delete_plan)
        payloads.append(payload)
    return payloads


def label_multi_image_messages(messages: list) -> list:
    """Add positional labels to multi-image messages without modifying the input."""
    result = []
    for message in messages:
        content = message.get("content") if isinstance(message, dict) else None
        if not isinstance(content, list) or sum(
            isinstance(part, dict) and part.get("type") == "image_url" for part in content
        ) < 2:
            result.append(message)
            continue
        labelled = []
        image_index = 0
        for index, part in enumerate(content):
            if isinstance(part, dict) and part.get("type") == "image_url":
                image_index += 1
                previous = content[index - 1] if index else None
                if not isinstance(previous, dict) or previous.get("type") != "text":
                    labelled.append({"type": "text", "text": f"画像{image_index}:"})
            labelled.append(part)
        result.append({**message, "content": labelled})
    return result


def inject_blue_chat_completions_defaults(
    path: str, body: bytes, active_backend: str, config: GatewayConfig | None = None
) -> bytes:
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
    if isinstance(payload.get("messages"), list):
        payload["messages"] = label_multi_image_messages(payload["messages"])
    kwargs = payload.get("chat_template_kwargs")
    if not isinstance(kwargs, dict):
        kwargs = {}
    thinking_control = None
    if config is not None:
        try:
            state = read_active_model_state(config.active_model_state_path)
            if state is not None:
                profile = find_model_profile(config.model_registry_root, state.model_profile_id)
                chat = profile.runtime_profile.get("chat")
                if isinstance(chat, dict):
                    thinking_control = chat.get("thinkingControl")
        except (OSError, ValueError, UnknownModelProfileError):
            pass  # Missing/unreadable profiles keep the legacy Qwen defaults.
    if thinking_control == "reasoning_effort":
        enable_thinking = kwargs.pop("enable_thinking", None)
        if kwargs.get("reasoning_effort") not in ("low", "high"):
            kwargs["reasoning_effort"] = "high" if enable_thinking is True else "low"
        kwargs.setdefault("clear_thinking", True)
        payload["chat_template_kwargs"] = kwargs
        if "reasoning_effort" in payload and payload["reasoning_effort"] != "high":
            payload["reasoning_effort"] = "low"
    elif kwargs.get("enable_thinking") is not True:
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


def run_worker_command(target: str, command: str, timeout: int) -> dict:
    try:
        proc = subprocess.run(
            ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "--", target, command],
            timeout=timeout,
            capture_output=True,
            text=True,
            check=False,
        )
        output = (proc.stdout or "") + ("\n" if proc.stdout and proc.stderr else "") + (proc.stderr or "")
        result = {"ok": proc.returncode == 0, "exitCode": proc.returncode, "outputSample": output.strip()[:400]}
    except subprocess.TimeoutExpired:
        result = {"ok": False, "message": "timeout", "outputSample": ""}
    except Exception as exc:
        result = {"ok": False, "message": str(exc), "outputSample": ""}
    if not result["ok"]:
        print(f"private ComfyUI worker command failed: {json.dumps(result)}", file=sys.stderr)
    return result




def is_container_running(container_name: str) -> bool:
    try:
        proc = subprocess.run(
            ["bash", "-lc", "docker ps --format '{{.Names}}'"],
            capture_output=True,
            text=True,
            check=False,
            timeout=10,
        )
    except subprocess.TimeoutExpired:
        return False
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


def read_proc_meminfo_gib() -> dict[str, float]:
    try:
        proc = subprocess.run(
            ["bash", "-lc", "awk '/MemTotal:|MemAvailable:/ {print $1,$2}' /proc/meminfo"],
            capture_output=True,
            text=True,
            check=False,
            timeout=10,
        )
    except subprocess.TimeoutExpired:
        return {}
    if proc.returncode != 0:
        return {}
    values: dict[str, float] = {}
    for line in (proc.stdout or "").splitlines():
        parts = line.split()
        if len(parts) != 2:
            continue
        key = parts[0].rstrip(":")
        try:
            values[key] = float(parts[1]) / (1024.0 * 1024.0)
        except ValueError:
            continue
    return values


def collect_compute_app_processes() -> tuple[float, list[dict[str, object]]]:
    proc = subprocess.run(
        [
            "bash",
            "-lc",
            "nvidia-smi --query-compute-apps=pid,process_name,used_memory --format=csv,noheader,nounits",
        ],
        capture_output=True,
        text=True,
        check=False,
        timeout=10,
    )
    if proc.returncode != 0:
        legacy_proc = subprocess.run(
            [
                "bash",
                "-lc",
                "nvidia-smi --query-compute-apps=used_memory --format=csv,noheader,nounits",
            ],
            capture_output=True,
            text=True,
            check=False,
            timeout=10,
        )
        total_mib = 0.0
        if legacy_proc.returncode == 0:
            for line in (legacy_proc.stdout or "").splitlines():
                value = parse_nvidia_smi_number(line)
                if value is not None:
                    total_mib += value
        return total_mib, []

    total_mib = 0.0
    processes: list[dict[str, object]] = []
    for line in (proc.stdout or "").splitlines():
        parts = [part.strip() for part in line.split(",")]
        if len(parts) < 3:
            continue
        used_mib = parse_nvidia_smi_number(parts[2])
        if used_mib is None:
            continue
        total_mib += used_mib
        process: dict[str, object] = {
            "processName": parts[1],
            "usedMemoryGiB": round(used_mib / 1024.0, 3),
        }
        try:
            process["pid"] = int(parts[0])
        except ValueError:
            pass
        processes.append(process)
    return total_mib, processes[:12]


def add_gpu_detail_metrics(
    payload: dict[str, object],
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
        timeout=10,
    )


def collect_gpu_metrics() -> tuple[bool, dict[str, object] | None]:
    try:
        proc = run_nvidia_smi_gpu_query(
            "utilization.gpu,memory.used,memory.total,temperature.gpu,"
            "power.draw,power.limit,clocks.sm,clocks.gr,clocks.mem,pstate,"
            "clocks_throttle_reasons.active,name,driver_version"
        )
        if proc.returncode != 0:
            legacy_proc = run_nvidia_smi_gpu_query("utilization.gpu,memory.used,memory.total")
            if legacy_proc.returncode == 0:
                proc = legacy_proc
    except subprocess.TimeoutExpired:
        return False, None
    if proc.returncode != 0:
        return False, None
    rows = [line.strip() for line in (proc.stdout or "").splitlines() if line.strip()]
    if not rows:
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
        return False, None
    util_avg = sum(gpu_utils) / len(gpu_utils)
    meminfo_gib = read_proc_meminfo_gib()
    try:
        compute_apps_used_mib, compute_processes = collect_compute_app_processes()
    except subprocess.TimeoutExpired:
        return False, None
    used_gib: float | None = None
    total_gib: float | None = None
    memory_metric_source = "gpu_memory"
    if mem_pairs:
        used_gib = sum(v[0] for v in mem_pairs) / 1024.0
        total_gib = sum(v[1] for v in mem_pairs) / 1024.0
    else:
        if meminfo_gib.get("MemTotal", 0) > 0:
            used_gib = compute_apps_used_mib / 1024.0
            total_gib = meminfo_gib["MemTotal"]
            memory_metric_source = "compute_apps_memtotal"
        else:
            payload: dict[str, object] = {"gpuUtilPct": round(util_avg, 1), "memoryMetricSource": "gpu_only"}
            if compute_processes:
                payload["gpuProcesses"] = compute_processes
                payload["gpuProcessCount"] = len(compute_processes)
                payload["gpuProcessMemoryUsedGiB"] = round(compute_apps_used_mib / 1024.0, 3)
            if meminfo_gib.get("MemAvailable") is not None:
                payload["systemMemoryAvailableGiB"] = round(meminfo_gib["MemAvailable"], 1)
                payload["startupFreeMemoryGiB"] = round(meminfo_gib["MemAvailable"], 1)
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
            return True, payload

    if used_gib is None or total_gib is None or total_gib <= 0:
        return False, None

    payload: dict[str, object] = {
        "gpuUtilPct": round(util_avg, 1),
        "unifiedMemoryUsedGiB": round(used_gib, 1),
        "unifiedMemoryTotalGiB": round(total_gib, 1),
        "freeMemoryGiB": round(max(0.0, total_gib - used_gib), 1),
        "memoryMetricSource": memory_metric_source,
    }
    if meminfo_gib.get("MemAvailable") is not None:
        payload["systemMemoryAvailableGiB"] = round(meminfo_gib["MemAvailable"], 1)
        payload["startupFreeMemoryGiB"] = round(meminfo_gib["MemAvailable"], 1)
    elif payload.get("freeMemoryGiB") is not None:
        payload["startupFreeMemoryGiB"] = payload["freeMemoryGiB"]
    if compute_processes:
        payload["gpuProcesses"] = compute_processes
        payload["gpuProcessCount"] = len(compute_processes)
        payload["gpuProcessMemoryUsedGiB"] = round(compute_apps_used_mib / 1024.0, 3)
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
    return True, payload


_business_request = threading.local()


@contextmanager
def business_request_lifetime(handler):
    """Interrupt upstream reads and downstream writes at an absolute deadline."""
    lifetime = positive_env_seconds("BUSINESS_REQUEST_MAX_LIFETIME_SEC", 300)
    write_timeout = positive_env_seconds("BUSINESS_RESPONSE_WRITE_TIMEOUT_SEC", 10)
    handler._business_timed_out = False
    handler._business_downstream_closed = False
    guard = threading.Lock()
    sockets = []
    previous_timeout = None
    connection = handler.connection
    if isinstance(connection, socket.socket):
        previous_timeout = connection.gettimeout()
        connection.settimeout(min(write_timeout, lifetime))
        sockets.append(connection)
    deadline = time.monotonic() + lifetime
    def expire(*, include_downstream=True):
        with guard:
            handler._business_timed_out = True
            if include_downstream:
                handler._business_downstream_closed = True
            for current in sockets:
                if current is connection and not include_downstream:
                    continue
                try:
                    current.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass
    handler._business_abort = expire
    _business_request.context = (deadline, guard, sockets, handler)
    timer = threading.Timer(lifetime, expire)
    timer.daemon = True
    timer.start()
    try:
        yield
        if handler._business_timed_out:
            raise TimeoutError("business_request_lifetime_exceeded")
    finally:
        timer.cancel()
        timer.join()
        del _business_request.context
        if isinstance(connection, socket.socket):
            connection.settimeout(previous_timeout)


def business_upstream_timeout(default: float) -> float:
    reset_deadline = getattr(_business_request, 'reset_deadline', None)
    if reset_deadline is not None:
        remaining = reset_deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError('qwen_cache_reset_deadline_exceeded')
        default = min(default, remaining)
    context = getattr(_business_request, "context", None)
    if context is None:
        return default
    remaining = context[0] - time.monotonic()
    if remaining <= 0:
        raise TimeoutError("business_request_lifetime_exceeded")
    return min(default, remaining)


@contextmanager
def business_upstream_response(response):
    context = getattr(_business_request, "context", None)
    upstream = None
    if context is not None:
        _, guard, sockets, handler = context
        # urllib's HTTP(S)Response owns this socket. Shutting it down interrupts
        # read(), including an indefinitely trickling body or SSE stream.
        upstream = getattr(getattr(getattr(response, "fp", None), "raw", None), "_sock", None)
        if isinstance(upstream, socket.socket):
            with guard:
                if handler._business_timed_out:
                    raise TimeoutError("business_request_lifetime_exceeded")
                sockets.append(upstream)
    try:
        yield response
    finally:
        if context is not None and isinstance(upstream, socket.socket):
            with guard:
                sockets.remove(upstream)


class BusinessHTTPConnection(http.client.HTTPConnection):
    def connect(self):
        super().connect()
        context = getattr(_business_request, "context", None)
        if context is not None:
            deadline, guard, sockets, handler = context
            with guard:
                reset_deadline = getattr(_business_request, 'reset_deadline', float('inf'))
                if handler._business_timed_out or time.monotonic() >= min(deadline, reset_deadline):
                    self.close()
                    raise TimeoutError("business_request_lifetime_exceeded")
                # Register before sending the request or parsing response headers.
                # A peer trickling headers cannot extend the absolute deadline.
                sockets.append(self.sock)


class BusinessHTTPHandler(urllib.request.HTTPHandler):
    def http_open(self, request):
        return self.do_open(BusinessHTTPConnection, request)


def business_urlopen(request, *, timeout):
    if getattr(_business_request, "context", None) is None:
        return urllib.request.urlopen(request, timeout=timeout)
    return urllib.request.build_opener(BusinessHTTPHandler()).open(request, timeout=timeout)


def proxy_request(method: str, url: str, body: bytes, headers: dict[str, str]) -> tuple[int, bytes, str]:
    req = urllib.request.Request(url, data=body if method != "GET" else None, method=method)
    for key, value in headers.items():
        req.add_header(key, value)
    try:
        timeout = 120
        if urlsplit(url).path in {"/start", "/stop", "/stop-force"}:
            timeout = control_request_budget() + positive_env_seconds("LLM_RUNTIME_FORWARD_MARGIN_SEC", 30)
        with business_urlopen(req, timeout=business_upstream_timeout(timeout)) as response, business_upstream_response(response):
            return response.status, response.read(), response.headers.get("Content-Type", "application/octet-stream")
    except urllib.error.HTTPError as exc:
        with exc, business_upstream_response(exc):
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
    qwen_owner = QwenOwnerExclusive()
    class Handler(BaseHTTPRequestHandler):
        server_version = "dgx-local-llm-gateway/1.0"

        def _llm_auth_ok(self) -> bool:
            return llm_shared_token_ok(self.headers, config.llm_shared_tokens)

        def _embedding_auth_ok(self) -> bool:
            if not config.embedding_api_key:
                return True
            return self.headers.get("Authorization", "") == f"Bearer {config.embedding_api_key}"

        def _send(self, status: int, body: bytes, content_type: str) -> None:
            try:
                self.send_response(status)
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            except socket.timeout:
                if getattr(_business_request, "context", None) is not None:
                    self._business_timed_out = True
                raise

        def _proxy_stream(self, url: str, body: bytes, headers: dict[str, str], *, business: bool = False) -> None:
            req = urllib.request.Request(url, data=body, method="POST", headers=headers)
            self.close_connection = True
            response_started = False
            self._business_stream_handled = True
            def preempted_error():
                if getattr(self, '_business_downstream_closed', False):
                    return
                if response_started:
                    self.wfile.write(b'data: {"error":{"code":"private_shared_preempted"}}\n\n')
                    self.wfile.flush()
                else:
                    self._send_json(409, {'error': {'code': 'private_shared_preempted'}})
            try:
                try:
                    with business_urlopen(req, timeout=business_upstream_timeout(120)) as response, business_upstream_response(response):
                        # Read before committing headers so an initial timeout can still return 502.
                        chunk = response.read1(65536)
                        self.send_response(response.status)
                        self.send_header(
                            "Content-Type", response.headers.get("Content-Type", "application/octet-stream")
                        )
                        self.send_header("Cache-Control", "no-cache")
                        self.send_header("Connection", "close")
                        response_started = True
                        self.end_headers()
                        pending = b""
                        while chunk:
                            if getattr(self, '_qwen_preempted', False):
                                break
                            if business:
                                pending += chunk
                                lines = pending.split(b"\n")
                                pending = lines.pop()
                                out = []
                                for line in lines:
                                    out.append(business_sse_alias(line) + b"\n")
                                chunk = b"".join(out)
                            self.wfile.write(chunk)
                            self.wfile.flush()
                            chunk = response.read1(65536)
                        if getattr(self, '_qwen_preempted', False):
                            preempted_error()
                        elif business and pending:
                            self.wfile.write(business_sse_alias(pending))
                            self.wfile.flush()
                except urllib.error.HTTPError as exc:
                    with exc, business_upstream_response(exc):
                        if not response_started:
                            self._send(
                                exc.code, exc.read(), exc.headers.get("Content-Type", "text/plain; charset=utf-8")
                            )
                except Exception as exc:
                    if getattr(self, '_qwen_preempted', False):
                        preempted_error()
                    elif not response_started:
                        reason = exc.reason if isinstance(exc, urllib.error.URLError) else exc
                        self._send_text(502, f"bad gateway: {reason}")
            except (BrokenPipeError, ConnectionResetError, OSError):
                # The client may also disconnect while an error response is being sent.
                pass

        def _send_text(self, status: int, text: str) -> None:
            self._send(status, text.encode("utf-8"), "text/plain; charset=utf-8")

        def _send_json(self, status: int, payload: dict) -> None:
            self._send(
                status,
                json.dumps(payload, ensure_ascii=False).encode("utf-8"),
                "application/json; charset=utf-8",
            )

        def do_GET(self) -> None:
            if self._reject_unroutable_shared_request():
                return
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
                            "profiles": model_profiles_to_api_with_delete_protection(
                                profiles,
                                active_profile_id=active_state.model_profile_id if active_state else None,
                                allowed_roots=config.model_storage_delete_allowed_roots,
                            ),
                            "activeProfileId": active_state.model_profile_id if active_state else None,
                            "state": active_model_state_to_api(active_state) if active_state else None,
                            "resourceState": state_to_api(resource_state) if resource_state else None,
                        },
                    )
                except Exception as exc:
                    self._send_json(503, {"ok": False, "code": "MODEL_PROFILES_UNAVAILABLE", "message": str(exc)})
                return
            if self.path == "/system/resource-state":
                if business_switch_enabled():
                    if self.headers.get("X-Runtime-Control-Token", "") != config.runtime_control_token:
                        self._send_text(403, "forbidden")
                        return
                    status, body, content_type = proxy_impl("GET", config.runtime_control_base_url + self.path, b"",
                        {"X-Runtime-Control-Token": config.runtime_control_token})
                    if status == 200:
                        try:
                            runtime = json.loads(body)["businessRuntime"]
                            if any(os.environ.get(flag, "") in {"true", "1"} for flag in (
                                    "DGX_PRIVATE_SHARED_DEEPSEEK_ENABLED", "DGX_PRIVATE_SHARED_QWEN38_ENABLED")):
                                with business_state_lock(config.active_model_state_path, exclusive=False, blocking=False):
                                    runtime = attest_private_sharing(config, runtime)
                            else:
                                runtime = dict(runtime)
                                runtime.pop("privateSharingEvidence", None)
                                runtime.pop("privateSharing", None)
                            resource = read_resource_state(config.resource_state_path)
                            self._send_json(200, {"ok": True, **(state_to_api(resource) if resource else {}), "businessRuntime": runtime})
                        except (OSError, ValueError, KeyError, TypeError):
                            self._send_json(503, {"ok": False, "code": "BUSINESS_RUNTIME_UNAVAILABLE"})
                    else:
                        self._send(status, body, content_type)
                    return
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
                if business_routing_required(config):
                    self._business_v1("GET", b"")
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
            if self._reject_unroutable_shared_request():
                return
            body = read_body(self)
            if self.path in ("/system/model-storage-delete/preview", "/system/model-storage-delete/execute"):
                if self.headers.get("X-Runtime-Control-Token", "") != config.runtime_control_token:
                    self._send_text(403, "forbidden")
                    return
                model_profile_id = string_from_json_body(body, "modelProfileId")
                if not model_profile_id:
                    self._send_json(
                        400,
                        {
                            "ok": False,
                            "code": "MODEL_PROFILE_ID_REQUIRED",
                            "message": "modelProfileId is required",
                        },
                    )
                    return
                try:
                    profiles = load_model_profiles(config.model_registry_root)
                    profile = find_model_profile(config.model_registry_root, model_profile_id)
                    active_state = read_active_model_state(config.active_model_state_path)
                    plan = build_model_storage_delete_plan(
                        profile,
                        all_profiles=profiles,
                        active_profile_id=active_state.model_profile_id if active_state else None,
                        allowed_roots=config.model_storage_delete_allowed_roots,
                        include_size=True,
                    )
                    if self.path.endswith("/preview"):
                        self._send_json(200, delete_preview_to_api(plan))
                        return
                    result = execute_model_storage_delete(
                        plan,
                        plan_fingerprint=string_from_json_body(body, "planFingerprint") or "",
                        confirmation=string_from_json_body(body, "confirmation") or "",
                    )
                    self._send_json(200, result)
                    return
                except UnknownModelProfileError as exc:
                    self._send_json(exc.status_code, {"ok": False, "code": exc.code, "message": str(exc)})
                    return
                except ModelStorageDeleteError as exc:
                    self._send_json(
                        exc.status_code,
                        {
                            "ok": False,
                            "code": exc.code,
                            "message": str(exc),
                        },
                    )
                    return
                except Exception as exc:
                    self._send_json(
                        500,
                        {
                            "ok": False,
                            "code": "MODEL_STORAGE_DELETE_FAILED",
                            "message": str(exc),
                        },
                    )
                    return
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
                worker_payload = {}
                try:
                    if config.private_comfy_worker_ssh_target:
                        is_start = self.path.endswith("/start")
                        # Spark 1 keeps its own timeout; the worker is bounded so it never delays the reply past Spark 1 plus margin.
                        with ThreadPoolExecutor(max_workers=2) as executor:
                            local_future = executor.submit(
                                run_local_command, command, config.private_comfy_root,
                                config.private_comfy_cmd_timeout_sec,
                            )
                            worker_future = executor.submit(
                                run_worker_command, config.private_comfy_worker_ssh_target,
                                config.private_comfy_worker_start_cmd if is_start else config.private_comfy_worker_stop_cmd,
                                min(config.private_comfy_worker_cmd_timeout_sec, 20),
                            )
                            worker_payload["worker"] = worker_future.result()
                        rc = None
                        try:
                            rc, output = local_future.result()
                        finally:
                            if is_start and rc != 0:
                                run_worker_command(
                                    config.private_comfy_worker_ssh_target, config.private_comfy_worker_stop_cmd,
                                    min(config.private_comfy_worker_cmd_timeout_sec, 5),
                                )
                    else:
                        rc, output = run_local_command(
                            command,
                            config.private_comfy_root,
                            config.private_comfy_cmd_timeout_sec,
                        )
                    if rc == 0:
                        is_start = self.path.endswith("/start")
                        resource_state = write_gateway_resource_state_best_effort(
                            config,
                            owner="private",
                            status="preparing" if is_start else "released",
                            action="private-comfyui-start" if is_start else "private-comfyui-stop",
                            reason=reason_from_json_body(body),
                        )
                        payload_body = {"ok": True, "path": self.path, **worker_payload}
                        if resource_state is not None:
                            payload_body["resourceState"] = resource_state
                        payload = json.dumps(payload_body).encode("utf-8")
                        self._send(200, payload, "application/json; charset=utf-8")
                        return
                    payload = json.dumps(
                        {
                            "ok": False,
                            "path": self.path,
                            "exitCode": rc,
                            "output": output[:400],
                            **worker_payload,
                        }
                    ).encode("utf-8")
                    self._send(502, payload, "application/json; charset=utf-8")
                    return
                except subprocess.TimeoutExpired:
                    payload = json.dumps({"ok": False, "path": self.path, "message": "timeout", **worker_payload}).encode("utf-8")
                    self._send(504, payload, "application/json; charset=utf-8")
                    return
                except Exception as exc:
                    payload = json.dumps(
                        {"ok": False, "path": self.path, "message": str(exc), **worker_payload}
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
                    payload = json.dumps({"ok": False, "path": self.path, "message": "timeout"}).encode("utf-8")
                    self._send(504, payload, "application/json; charset=utf-8")
                    return
                except Exception as exc:
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
                    payload = json.dumps({"ok": False, "path": self.path, "message": "timeout"}).encode("utf-8")
                    self._send(504, payload, "application/json; charset=utf-8")
                    return
                except Exception as exc:
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
                if business_routing_required(config):
                    self._business_v1("POST", body)
                    return
                headers = {"Content-Type": self.headers.get("Content-Type", "application/json")}
                active_backend = resolve_active_backend(config)
                upstream_body = inject_blue_chat_completions_defaults(
                    self.path, body, active_backend, config
                )
                if (
                    self.path.rstrip("/").endswith("/completions")
                    and json_body_object(body).get("stream") is True
                ):
                    self._proxy_stream(
                        f"{resolve_backend_base_url(config)}{self.path}",
                        upstream_body,
                        headers,
                    )
                    return
                status, resp_body, content_type = proxy_impl(
                    "POST",
                    f"{resolve_backend_base_url(config)}{self.path}",
                    upstream_body,
                    headers,
                )
                self._send(status, resp_body, content_type)
                return
            self._send_text(404, "not found")

        def _reject_unroutable_shared_request(self) -> bool:
            if (self.headers.get("X-Private-Shared-Runtime") is not None
                    and (not self.path.startswith("/v1/") or not business_switch_enabled())):
                self._send(409, b"", "application/json")
                return True
            return False

        def _business_v1(self, method: str, body: bytes) -> None:
            shared = self.headers.get("X-Private-Shared-Runtime")
            json_mode = False
            profile = generation = None
            try:
                # A lifecycle mutation waits for every normal/streaming request to
                # finish; arrivals during that mutation fail closed immediately.
                if business_draining(config.active_model_state_path):
                    raise ValueError("business_draining")
                with business_request_lifetime(self), business_state_lock(config.active_model_state_path, exclusive=False, blocking=False):
                    # Close the admission race between the first check and LOCK_SH.
                    if business_draining(config.active_model_state_path):
                        raise ValueError("business_draining")
                    snapshot = business_selection_state(config.active_model_state_path)
                    profile = snapshot["selectedBusinessProfileId"]
                    generation = snapshot.get("businessGeneration")
                    base, auth, profile = business_route(config)
                    if shared is not None:
                        state = business_selection_state(config.active_model_state_path)
                        if (profile not in {DEEPSEEK_PROFILE, BUSINESS_QWEN38_PROFILE_ID}
                                or (profile == BUSINESS_QWEN38_PROFILE_ID and os.environ.get('DGX_PRIVATE_SHARED_QWEN38_ENABLED', '') not in {'true', '1'})
                                or len(self.headers.get_all("X-Private-Shared-Runtime")) != 1
                                or shared != f"{state['selectionRevision']}:{state['businessGeneration']}"):
                            self._send(409, b"", "application/json")
                            return
                        status, runtime_snapshot, _ = proxy_impl("GET", config.runtime_control_base_url + "/system/resource-state", b"",
                            {"X-Runtime-Control-Token": config.runtime_control_token})
                        runtime = attest_private_sharing(config, json.loads(runtime_snapshot)['businessRuntime']) if status == 200 else {}
                        proof = runtime.get('privateSharing', {})
                        if shared != f"{proof.get('selectionRevision')}:{proof.get('generation')}":
                            self._send(409, b"", "application/json")
                            return
                    headers = {"Content-Type": "application/json", **auth}
                    if method == "POST":
                        try:
                            payload = json.loads(body)
                            if not isinstance(payload, dict):
                                raise ValueError("invalid_request")
                            if payload.get("model", "system-prod-primary") != "system-prod-primary":
                                raise ValueError("unsupported_model")
                            if profile == DEEPSEEK_PROFILE and (business_has_image(payload) or "/images" in self.path):
                                raise ValueError("image_requests_unsupported")
                            if shared is not None and private_has_unsupported_image_url(payload):
                                raise ValueError('private_shared_image_url_unsupported')
                            if profile == BUSINESS_QWEN38_PROFILE_ID and "chat_template_kwargs" in payload and not isinstance(payload["chat_template_kwargs"], dict):
                                raise ValueError("invalid_chat_template_kwargs")
                        except (ValueError, UnicodeDecodeError) as error:
                            self._send_json(400, {"error": {"code": str(error)}})
                            return
                        payload["model"] = "system-prod-primary"
                        if profile == BUSINESS_QWEN38_PROFILE_ID:
                            payload.pop('cache_salt', None)
                            if shared is not None:
                                payload['cache_salt'] = _QWEN_PRIVATE_CACHE_SALT
                        body = json.dumps(payload, ensure_ascii=False).encode()
                        if profile == GLM_PROFILE:
                            body = inject_blue_chat_completions_defaults(self.path, body, "blue", config)
                        elif profile == DEEPSEEK_PROFILE and self.path.rstrip("/").endswith("/chat/completions"):
                            payload, json_mode = deepseek_json_request(payload)
                            body = json.dumps(payload, ensure_ascii=False).encode()
                        elif profile == BUSINESS_QWEN38_PROFILE_ID and self.path.rstrip("/").endswith("/chat/completions"):
                            payload.setdefault("chat_template_kwargs", {}).setdefault("enable_thinking", False)
                            body = json.dumps(payload, ensure_ascii=False).encode()
                    admission = (qwen_owner.request('private' if shared is not None else 'business',
                        (snapshot['selectionRevision'], generation), self,
                        lambda cancelled: reset_qwen_caches(base, proxy_impl, cancelled),
                        lambda: business_draining(config.active_model_state_path))
                        if profile == BUSINESS_QWEN38_PROFILE_ID and method == 'POST' else nullcontext())
                    if profile == BUSINESS_QWEN38_PROFILE_ID:
                        status, runtime_body, _ = proxy_impl("GET", config.runtime_control_base_url + "/system/resource-state", b"",
                            {"X-Runtime-Control-Token": config.runtime_control_token})
                        runtime = json.loads(runtime_body).get("businessRuntime", {}) if status == 200 else {}
                        ranks = runtime.get("ranks", [])
                        if (runtime.get("modelProfileId") != profile
                                or type(runtime.get("selectionRevision")) is not int
                                or runtime["selectionRevision"] != snapshot["selectionRevision"]
                                or runtime.get("generation") != generation
                                or runtime.get("prepared") is not True or runtime.get("failureReason")
                                or runtime.get("apiListenerClosed") is True
                                or not isinstance(ranks, list) or len(ranks) != 2
                                or {rank.get("rank") for rank in ranks} != {0, 1}
                                or any(rank.get("running") is not True or rank.get("generation") != generation for rank in ranks)):
                            raise ValueError("business_runtime_unavailable")
                        if self.path != "/v1/models":
                            status, models_body, _ = proxy_impl("GET", base + "/v1/models", b"", headers)
                            models = json.loads(models_body).get("data", []) if status == 200 else []
                            if not any(isinstance(model, dict) and model.get("id") == "system-prod-primary" for model in models):
                                raise ValueError("business_alias_unavailable")
                    with admission:
                        if method == "POST" and self.path.rstrip("/").endswith("/completions") and payload.get("stream") is True:
                            self._proxy_stream(base + self.path, body, headers, business=True)
                            return
                        status, response, content_type = proxy_impl(method, base + self.path, body, headers)
                        if profile == BUSINESS_QWEN38_PROFILE_ID and self._business_timed_out:
                            raise TimeoutError('business_request_cancelled')
                        if 200 <= status < 300:
                            if self.path == "/v1/models":
                                models = json.loads(response).get("data", [])
                                if not any(m.get("id") == "system-prod-primary" for m in models):
                                    raise ValueError("business_alias_unavailable")
                                response = json.dumps({"object": "list", "data": [m for m in models if m.get("id") == "system-prod-primary"]}).encode()
                            else:
                                response = deepseek_json_response(response) if json_mode else business_response_alias(response)
                        self._send(status, response, content_type)
            except Exception as exc:
                if getattr(self, "_business_timed_out", False) or isinstance(exc, (BrokenPipeError, ConnectionResetError)):
                    if (getattr(self, '_qwen_preempted', False)
                            and not getattr(self, '_business_stream_handled', False)
                            and not getattr(self, '_business_downstream_closed', False)):
                        try:
                            self._send_json(409, {'error': {'code': 'private_shared_preempted'}})
                        except OSError:
                            pass
                    self.close_connection = True
                    return
                if shared is None:
                    log_business_failure("inference", profile, generation, exc,
                        secrets=(*config.llm_shared_tokens, config.runtime_control_token, _QWEN_PRIVATE_CACHE_SALT))
                if shared is not None:
                    if profile == BUSINESS_QWEN38_PROFILE_ID and str(exc) in {'private_shared_busy', 'private_shared_isolation_failed'}:
                        self._send_json(409, {'error': {'code': str(exc)}})
                    else:
                        self._send(409, b"", "application/json")
                else:
                    self._send_json(503, {"error": {"code": "business_runtime_unavailable"}})

        def log_message(self, fmt: str, *args: object) -> None:
            if getattr(self, "headers", {}).get("X-Private-Shared-Runtime") is not None:
                return
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
