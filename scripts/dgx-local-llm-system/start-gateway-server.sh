#!/usr/bin/env bash
set -euo pipefail

LOG_PATH="${GATEWAY_LOG_PATH:-/srv/dgx/system-prod/logs/gateway-server.log}"
PID_PATH="${GATEWAY_PID_PATH:-/srv/dgx/system-prod/logs/gateway-server.pid}"
SCRIPT_PATH="${GATEWAY_SCRIPT_PATH:-/srv/dgx/system-prod/bin/gateway-server.py}"
ENV_FILE="${GATEWAY_ENV_FILE:-/srv/dgx/system-prod/secrets/gateway-server.env}"
LLM_TOKEN_FILE="${LLM_SHARED_TOKEN_FILE:-/srv/dgx/system-prod/secrets/api-token}"
RUNTIME_TOKEN_FILE="${LLM_RUNTIME_CONTROL_TOKEN_FILE:-/srv/dgx/system-prod/secrets/runtime-control-token}"
EMBEDDING_API_KEY_FILE="${EMBEDDING_API_KEY_FILE:-/srv/dgx/system-prod/secrets/embedding-api-key}"
HOST="${GATEWAY_LISTEN_HOST:-0.0.0.0}"
PORT="${GATEWAY_LISTEN_PORT:-38081}"
ACTIVE_BACKEND="${ACTIVE_LLM_BACKEND:-green}"
LLAMA_SERVER_BASE_URL="${LLAMA_SERVER_BASE_URL:-http://127.0.0.1:38082}"
GREEN_LLM_BASE_URL="${GREEN_LLM_BASE_URL:-http://127.0.0.1:38082}"
BLUE_LLM_BASE_URL="${BLUE_LLM_BASE_URL:-http://127.0.0.1:38083}"
RUNTIME_CONTROL_BASE_URL="${RUNTIME_CONTROL_BASE_URL:-http://127.0.0.1:39090}"
EMBEDDING_BASE_URL="${EMBEDDING_BASE_URL:-http://127.0.0.1:38100}"

install -d "$(dirname "${LOG_PATH}")"

if [[ -f "${ENV_FILE}" ]]; then
  # shellcheck disable=SC1090
  set -a
  source "${ENV_FILE}"
  set +a
  LLM_TOKEN_FILE="${LLM_SHARED_TOKEN_FILE:-${LLM_TOKEN_FILE}}"
  RUNTIME_TOKEN_FILE="${LLM_RUNTIME_CONTROL_TOKEN_FILE:-${RUNTIME_TOKEN_FILE}}"
  EMBEDDING_API_KEY_FILE="${EMBEDDING_API_KEY_FILE:-${EMBEDDING_API_KEY_FILE}}"
  HOST="${GATEWAY_LISTEN_HOST:-${HOST}}"
  PORT="${GATEWAY_LISTEN_PORT:-${PORT}}"
  ACTIVE_BACKEND="${ACTIVE_LLM_BACKEND:-${ACTIVE_BACKEND}}"
  LLAMA_SERVER_BASE_URL="${LLAMA_SERVER_BASE_URL:-${LLAMA_SERVER_BASE_URL}}"
  GREEN_LLM_BASE_URL="${GREEN_LLM_BASE_URL:-${GREEN_LLM_BASE_URL}}"
  BLUE_LLM_BASE_URL="${BLUE_LLM_BASE_URL:-${BLUE_LLM_BASE_URL}}"
  RUNTIME_CONTROL_BASE_URL="${RUNTIME_CONTROL_BASE_URL:-${RUNTIME_CONTROL_BASE_URL}}"
  EMBEDDING_BASE_URL="${EMBEDDING_BASE_URL:-${EMBEDDING_BASE_URL}}"
fi

if [[ -f "${PID_PATH}" ]]; then
  OLD_PID="$(tr -d '\n' < "${PID_PATH}")"
  if [[ -n "${OLD_PID}" ]] && kill -0 "${OLD_PID}" 2>/dev/null; then
    echo "gateway-server already running pid=${OLD_PID}"
    exit 0
  fi
fi

if [[ ! -f "${LLM_TOKEN_FILE}" ]]; then
  echo "LLM token file not found: ${LLM_TOKEN_FILE}" >&2
  exit 1
fi
if [[ ! -f "${RUNTIME_TOKEN_FILE}" ]]; then
  echo "runtime control token file not found: ${RUNTIME_TOKEN_FILE}" >&2
  exit 1
fi

LLM_TOKEN="$(tr -d '\n' < "${LLM_TOKEN_FILE}")"
RUNTIME_TOKEN="$(tr -d '\n' < "${RUNTIME_TOKEN_FILE}")"
EMBEDDING_API_KEY=""
if [[ -f "${EMBEDDING_API_KEY_FILE}" ]]; then
  EMBEDDING_API_KEY="$(tr -d '\n' < "${EMBEDDING_API_KEY_FILE}")"
fi

rm -f "${PID_PATH}"

nohup env \
  LLM_SHARED_TOKEN="${LLM_TOKEN}" \
  LLM_RUNTIME_CONTROL_TOKEN="${RUNTIME_TOKEN}" \
  EMBEDDING_API_KEY="${EMBEDDING_API_KEY}" \
  ACTIVE_LLM_BACKEND="${ACTIVE_BACKEND}" \
  GATEWAY_LISTEN_HOST="${HOST}" \
  GATEWAY_LISTEN_PORT="${PORT}" \
  LLAMA_SERVER_BASE_URL="${LLAMA_SERVER_BASE_URL}" \
  GREEN_LLM_BASE_URL="${GREEN_LLM_BASE_URL}" \
  BLUE_LLM_BASE_URL="${BLUE_LLM_BASE_URL}" \
  RUNTIME_CONTROL_BASE_URL="${RUNTIME_CONTROL_BASE_URL}" \
  EMBEDDING_BASE_URL="${EMBEDDING_BASE_URL}" \
  python3 "${SCRIPT_PATH}" >>"${LOG_PATH}" 2>&1 < /dev/null &

echo $! >"${PID_PATH}"
echo "started pid=$(cat "${PID_PATH}")"
