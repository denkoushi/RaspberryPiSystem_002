#!/usr/bin/env bash
set -euo pipefail

# 歴史的なファイル名だが、blue backend 用の汎用コンテナランチャーとして使う。
# 新しい設定では BLUE_* を推奨しつつ、既存の TRTLLM_* 互換も維持する。

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTAINER_NAME="${BLUE_CONTAINER_NAME:-${TRTLLM_CONTAINER_NAME:-system-prod-trtllm}}"
MODE="${BLUE_SERVER_MODE:-${TRTLLM_SERVER_MODE:-container}}"
IMAGE="${BLUE_SERVER_IMAGE:-${TRTLLM_SERVER_IMAGE:-}}"
HOST_PORT="${BLUE_SERVER_PORT:-${TRTLLM_SERVER_PORT:-38083}}"
CONTAINER_PORT="${BLUE_SERVER_CONTAINER_PORT:-${TRTLLM_SERVER_CONTAINER_PORT:-8000}}"
ENTRYPOINT="${BLUE_SERVER_ENTRYPOINT:-${TRTLLM_SERVER_ENTRYPOINT:-}}"
LOG_PATH="${BLUE_SERVER_LOG_PATH:-${TRTLLM_SERVER_LOG_PATH:-/srv/dgx/system-prod/logs/trtllm-server.log}}"
PID_PATH="${BLUE_SERVER_PID_PATH:-${TRTLLM_SERVER_PID_PATH:-/srv/dgx/system-prod/logs/trtllm-server.pid}}"
MODEL_DIR="${BLUE_MODEL_DIR:-${TRTLLM_MODEL_DIR:-}}"
HF_CACHE_DIR="${BLUE_HF_CACHE_DIR:-${TRTLLM_HF_CACHE_DIR:-/srv/dgx/system-prod/data/hf-cache}}"
SERVER_COMMAND="${BLUE_SERVER_COMMAND:-${TRTLLM_SERVER_COMMAND:-}}"
HOST_VENV_PATH="${BLUE_HOST_VENV_PATH:-${TRTLLM_HOST_VENV_PATH:-}}"
EXTRA_DOCKER_ARGS="${BLUE_EXTRA_DOCKER_ARGS:-${TRTLLM_EXTRA_DOCKER_ARGS:-}}"

check_running_profile() {
  # Calls without a profile retain the legacy already-running behavior.
  if [[ -n "${BLUE_MODEL_PROFILE_ID:-}" ]]; then
    local running_profile
    running_profile="$(docker inspect --format '{{index .Config.Labels "dgx.profile"}}' "${CONTAINER_NAME}")" || exit 1
    if [[ -z "${running_profile}" || "${running_profile}" == "<no value>" ]]; then
      if [[ "${BLUE_SERVER_ADAPTER:-}" != "glm53_flash_tp2" ]]; then
        return 0
      fi
      echo "running container profile mismatch: running=unlabelled requested=${BLUE_MODEL_PROFILE_ID}; stop before switching profiles" >&2
      exit 1
    fi
    if [[ "${running_profile}" != "${BLUE_MODEL_PROFILE_ID}" ]]; then
      echo "running container profile mismatch: running=${running_profile} requested=${BLUE_MODEL_PROFILE_ID}; stop before switching profiles" >&2
      exit 1
    fi
    if [[ "${BLUE_SERVER_ADAPTER:-}" == "glm53_flash_tp2" ]]; then
      local worker_data worker_target worker_command worker_running
      if ! worker_data="$(python3 - "${BLUE_REMOTE_WORKER_MARKER_PATH:-/srv/dgx/system-prod/state/blue-remote-worker.json}" <<'PY'
import json
import re
import shlex
import sys
from pathlib import Path

try:
    marker = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    target = marker["sshTarget"]
    name = marker["containerName"]
    if not isinstance(target, str) or not re.fullmatch(r"[a-zA-Z0-9_][a-zA-Z0-9_.-]*@[a-zA-Z0-9_][a-zA-Z0-9_.-]*", target):
        raise ValueError("invalid worker sshTarget in marker")
    if not isinstance(name, str) or not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_.-]*", name):
        raise ValueError("invalid worker containerName in marker")
except (OSError, ValueError, KeyError, TypeError) as exc:
    raise SystemExit(f"cannot read worker marker: {exc}")
print(target)
print(shlex.join(["docker", "inspect", "--format", "{{.State.Running}}", name]))
PY
      )"; then
        echo "GLM TP2 worker marker unavailable; restarting head and worker" >&2
        return 1
      fi
      worker_target="${worker_data%%$'\n'*}"
      worker_command="${worker_data#*$'\n'}"
      if ! worker_running="$(ssh -o BatchMode=yes -o ConnectTimeout=10 -- "${worker_target}" "${worker_command}")"; then
        echo "GLM TP2 worker check failed at ${worker_target} (ssh/docker inspect); restarting head and worker" >&2
        return 1
      fi
      if [[ "${worker_running}" != "true" ]]; then
        echo "GLM TP2 worker is not running at ${worker_target}; restarting head and worker" >&2
        return 1
      fi
    fi
  fi
  return 0
}

install -d "$(dirname "${LOG_PATH}")"

if [[ "${MODE}" != "container" && "${MODE}" != "host" ]]; then
  echo "BLUE_SERVER_MODE/TRTLLM_SERVER_MODE must be container or host: ${MODE}" >&2
  exit 1
fi

# Some blue profiles require the upstream model author's patched launcher
# (PLE preparation, memory budget, watchdog, and local-cache checks).  Keep
# this dispatch closed over a fixed adapter name; profile manifests never pass
# an arbitrary shell command here.
# A remote launch recorded by a non-GLM adapter (e.g. DeepSeek on both Sparks)
# holds GPUs this start needs; stop it first so business restore cannot collide.
WORKER_MARKER="${BLUE_REMOTE_WORKER_MARKER_PATH:-/srv/dgx/system-prod/state/blue-remote-worker.json}"
if [[ "${BLUE_SERVER_ADAPTER:-}" != "dsv41_tensorfold_2x" &&
      "${BLUE_SERVER_ADAPTER:-}" != "glm53_tensorfold_2x" && -f "${WORKER_MARKER}" ]] &&
  python3 -c 'import json,sys; sys.exit(0 if "adapter" in json.load(open(sys.argv[1])) else 1)' "${WORKER_MARKER}"; then
  # Container mode reaches the marker branch even when the next profile is host mode.
  BLUE_SERVER_MODE=container TRTLLM_SERVER_MODE=container bash "${SCRIPT_DIR}/stop-trtllm-server.sh"
fi

if [[ -n "${BLUE_SERVER_ADAPTER:-}" ]]; then
  case "${BLUE_SERVER_ADAPTER}" in
    vllm) ;; # Explicitly select the standard builder over inherited adapters.
    dsv41_tensorfold_2x|glm53_tensorfold_2x)
      # This adapter stops the existing blue workload before switching ranks.
      exec "${SCRIPT_DIR}/tensorfold-2x-adapter.sh"
      ;;
    qwen38_flash_next|glm53_flash_tp2)
      if [[ "${MODE}" == "container" ]]; then
        RUNNING_NAME="$(docker ps --filter "name=^/${CONTAINER_NAME}$" --format '{{.Names}}' | tr -d '\r')"
        if [[ "${RUNNING_NAME}" == "${CONTAINER_NAME}" ]]; then
          if check_running_profile; then
            echo "trtllm-server already running container=${CONTAINER_NAME}"
            exit 0
          fi
        fi
      fi
      if [[ "${BLUE_SERVER_ADAPTER}" == "glm53_flash_tp2" ]]; then
        exec "${SCRIPT_DIR}/glm53-flash-tp2-adapter.sh"
      fi
      exec "${SCRIPT_DIR}/qwen38-flash-next-adapter.sh"
      ;;
    *)
      echo "unsupported BLUE_SERVER_ADAPTER: ${BLUE_SERVER_ADAPTER}" >&2
      exit 1
      ;;
  esac
fi

if [[ -z "${SERVER_COMMAND}" && -n "${MODEL_DIR}" ]]; then
  VLLM_COMMAND_BUILDER="${BLUE_VLLM_COMMAND_BUILDER_PATH:-${SCRIPT_DIR}/vllm_command_builder.py}"
  if [[ ! -f "${VLLM_COMMAND_BUILDER}" ]]; then
    echo "vLLM command builder not found: ${VLLM_COMMAND_BUILDER}" >&2
    exit 1
  fi
  SERVER_COMMAND="$(
    BLUE_MODEL_DIR="${MODEL_DIR}" \
    TRTLLM_MODEL_DIR="${MODEL_DIR}" \
    BLUE_SERVER_CONTAINER_PORT="${CONTAINER_PORT}" \
    TRTLLM_SERVER_CONTAINER_PORT="${CONTAINER_PORT}" \
    python3 "${VLLM_COMMAND_BUILDER}"
  )"
fi

if [[ "${MODE}" == "host" ]]; then
  if [[ -z "${SERVER_COMMAND}" ]]; then
    echo "BLUE_SERVER_COMMAND/TRTLLM_SERVER_COMMAND is required in host mode" >&2
    exit 1
  fi
  if [[ -f "${PID_PATH}" ]]; then
    OLD_PID="$(tr -d '\n' < "${PID_PATH}")"
    if [[ -n "${OLD_PID}" ]] && kill -0 "${OLD_PID}" 2>/dev/null; then
      echo "trtllm-server already running pid=${OLD_PID}"
      exit 0
    fi
  fi
  install -d "$(dirname "${PID_PATH}")"
  rm -f "${PID_PATH}"
  HOST_PREFIX=""
  if [[ -n "${HOST_VENV_PATH}" ]]; then
    HOST_PREFIX="source \"${HOST_VENV_PATH}/bin/activate\" && "
  fi
  nohup env \
    BLUE_SERVER_PORT="${HOST_PORT}" \
    BLUE_SERVER_CONTAINER_PORT="${CONTAINER_PORT}" \
    BLUE_MODEL_DIR="${MODEL_DIR}" \
    TRTLLM_SERVER_PORT="${HOST_PORT}" \
    TRTLLM_SERVER_CONTAINER_PORT="${CONTAINER_PORT}" \
    TRTLLM_MODEL_DIR="${MODEL_DIR}" \
    HF_HOME="${HF_CACHE_DIR}" \
    bash -lc "${HOST_PREFIX}exec ${SERVER_COMMAND}" >>"${LOG_PATH}" 2>&1 < /dev/null &
  echo $! >"${PID_PATH}"
  echo "started pid=$(cat "${PID_PATH}")"
  exit 0
fi

if [[ -z "${IMAGE}" ]]; then
  echo "BLUE_SERVER_IMAGE/TRTLLM_SERVER_IMAGE is required in container mode" >&2
  exit 1
fi

RUNNING_NAME="$(docker ps --filter "name=^/${CONTAINER_NAME}$" --format '{{.Names}}' | tr -d '\r')"
if [[ "${RUNNING_NAME}" == "${CONTAINER_NAME}" ]]; then
  check_running_profile
  echo "trtllm-server already running container=${CONTAINER_NAME}"
  exit 0
fi

docker rm -f "${CONTAINER_NAME}" >/dev/null 2>&1 || true

DOCKER_ARGS=(
  --detach
  --name "${CONTAINER_NAME}"
  --restart "no"
  --gpus "all"
  --publish "127.0.0.1:${HOST_PORT}:${CONTAINER_PORT}"
)

if [[ "${VLLM_LOCAL_SNAPSHOTS_ONLY:-}" == "true" ]]; then
  # Image fetch is an explicit preparation step, just like weight fetch.
  DOCKER_ARGS+=( --pull never --ipc host )
fi

if [[ -n "${MODEL_DIR}" ]]; then
  DOCKER_ARGS+=( --volume "${MODEL_DIR}:${MODEL_DIR}:ro" )
fi

if [[ -n "${HF_CACHE_DIR}" ]]; then
  install -d "${HF_CACHE_DIR}"
  DOCKER_ARGS+=( --volume "${HF_CACHE_DIR}:${HF_CACHE_DIR}" )
  DOCKER_ARGS+=( --env "HF_HOME=${HF_CACHE_DIR}" )
fi

if [[ -n "${EXTRA_DOCKER_ARGS}" ]]; then
  # shellcheck disable=SC2206
  EXTRA_DOCKER_ARGS_ARRAY=( ${EXTRA_DOCKER_ARGS} )
  DOCKER_ARGS+=( "${EXTRA_DOCKER_ARGS_ARRAY[@]}" )
fi

if [[ -n "${ENTRYPOINT}" ]]; then
  DOCKER_ARGS+=( --entrypoint "${ENTRYPOINT}" )
fi

DOCKER_CMD=( docker run "${DOCKER_ARGS[@]}" "${IMAGE}" )
if [[ -n "${SERVER_COMMAND}" ]]; then
  if [[ -n "${ENTRYPOINT}" ]]; then
    DOCKER_CMD+=( -lc "${SERVER_COMMAND}" )
  else
    DOCKER_CMD+=( bash -lc "${SERVER_COMMAND}" )
  fi
fi

{
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] starting ${CONTAINER_NAME} image=${IMAGE} hostPort=${HOST_PORT}"
  "${DOCKER_CMD[@]}"
} >>"${LOG_PATH}" 2>&1

echo "started container=${CONTAINER_NAME}"
