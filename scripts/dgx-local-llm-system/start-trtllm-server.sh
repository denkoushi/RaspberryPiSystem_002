#!/usr/bin/env bash
set -euo pipefail

# 歴史的なファイル名だが、blue backend 用の汎用コンテナランチャーとして使う。
# 新しい設定では BLUE_* を推奨しつつ、既存の TRTLLM_* 互換も維持する。

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

install -d "$(dirname "${LOG_PATH}")"

if [[ "${MODE}" != "container" && "${MODE}" != "host" ]]; then
  echo "BLUE_SERVER_MODE/TRTLLM_SERVER_MODE must be container or host: ${MODE}" >&2
  exit 1
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
