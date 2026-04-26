#!/usr/bin/env bash
set -euo pipefail

LOG_PATH="${LLM_RUNTIME_CONTROL_LOG_PATH:-/srv/dgx/system-prod/logs/control-server.log}"
PID_PATH="${LLM_RUNTIME_CONTROL_PID_PATH:-/srv/dgx/system-prod/logs/control-server.pid}"
SCRIPT_PATH="${LLM_RUNTIME_CONTROL_SCRIPT_PATH:-/srv/dgx/system-prod/bin/control-server.py}"
ENV_FILE="${LLM_RUNTIME_CONTROL_ENV_FILE:-/srv/dgx/system-prod/secrets/control-server.env}"
START_CMD="${LLM_RUNTIME_START_CMD:-bash /srv/dgx/system-prod/bin/start-llama-server.sh}"
STOP_CMD="${LLM_RUNTIME_STOP_CMD:-bash /srv/dgx/system-prod/bin/stop-llama-server.sh}"
ACTIVE_BACKEND="${ACTIVE_LLM_BACKEND:-green}"
GREEN_START_CMD="${GREEN_LLM_RUNTIME_START_CMD:-bash /srv/dgx/system-prod/bin/start-llama-server.sh}"
GREEN_STOP_CMD="${GREEN_LLM_RUNTIME_STOP_CMD:-bash /srv/dgx/system-prod/bin/stop-llama-server.sh}"
BLUE_START_CMD="${BLUE_LLM_RUNTIME_START_CMD:-bash /srv/dgx/system-prod/bin/start-trtllm-server.sh}"
BLUE_STOP_CMD="${BLUE_LLM_RUNTIME_STOP_CMD:-bash /srv/dgx/system-prod/bin/stop-trtllm-server.sh}"
TOKEN_FILE="${LLM_RUNTIME_CONTROL_TOKEN_FILE:-/srv/dgx/system-prod/secrets/runtime-control-token}"
HOST="${LLM_RUNTIME_LISTEN_HOST:-127.0.0.1}"
PORT="${LLM_RUNTIME_LISTEN_PORT:-39090}"

install -d "$(dirname "${LOG_PATH}")"

if [[ -f "${ENV_FILE}" ]]; then
  # shellcheck disable=SC1090
  set -a
  source "${ENV_FILE}"
  set +a
  START_CMD="${LLM_RUNTIME_START_CMD:-${START_CMD}}"
  STOP_CMD="${LLM_RUNTIME_STOP_CMD:-${STOP_CMD}}"
  ACTIVE_BACKEND="${ACTIVE_LLM_BACKEND:-${ACTIVE_BACKEND}}"
  GREEN_START_CMD="${GREEN_LLM_RUNTIME_START_CMD:-${GREEN_START_CMD}}"
  GREEN_STOP_CMD="${GREEN_LLM_RUNTIME_STOP_CMD:-${GREEN_STOP_CMD}}"
  BLUE_START_CMD="${BLUE_LLM_RUNTIME_START_CMD:-${BLUE_START_CMD}}"
  BLUE_STOP_CMD="${BLUE_LLM_RUNTIME_STOP_CMD:-${BLUE_STOP_CMD}}"
  HOST="${LLM_RUNTIME_LISTEN_HOST:-${HOST}}"
  PORT="${LLM_RUNTIME_LISTEN_PORT:-${PORT}}"
fi

if [[ -f "${PID_PATH}" ]]; then
  OLD_PID="$(tr -d '\n' < "${PID_PATH}")"
  if [[ -n "${OLD_PID}" ]] && kill -0 "${OLD_PID}" 2>/dev/null; then
    echo "control-server already running pid=${OLD_PID}"
    exit 0
  fi
fi

if [[ ! -f "${TOKEN_FILE}" ]]; then
  echo "runtime control token file not found: ${TOKEN_FILE}" >&2
  exit 1
fi

TOKEN="$(tr -d '\n' < "${TOKEN_FILE}")"
rm -f "${PID_PATH}"

nohup env \
  LLM_RUNTIME_CONTROL_TOKEN="${TOKEN}" \
  ACTIVE_LLM_BACKEND="${ACTIVE_BACKEND}" \
  LLM_RUNTIME_START_CMD="${START_CMD}" \
  LLM_RUNTIME_STOP_CMD="${STOP_CMD}" \
  GREEN_LLM_RUNTIME_START_CMD="${GREEN_START_CMD}" \
  GREEN_LLM_RUNTIME_STOP_CMD="${GREEN_STOP_CMD}" \
  BLUE_LLM_RUNTIME_START_CMD="${BLUE_START_CMD}" \
  BLUE_LLM_RUNTIME_STOP_CMD="${BLUE_STOP_CMD}" \
  BLUE_LLM_RUNTIME_STOP_MODE="${BLUE_LLM_RUNTIME_STOP_MODE:-}" \
  BLUE_LLM_RUNTIME_KEEP_WARM="${BLUE_LLM_RUNTIME_KEEP_WARM:-}" \
  LLM_RUNTIME_LISTEN_HOST="${HOST}" \
  LLM_RUNTIME_LISTEN_PORT="${PORT}" \
  python3 "${SCRIPT_PATH}" >>"${LOG_PATH}" 2>&1 < /dev/null &

echo $! >"${PID_PATH}"
echo "started pid=$(cat "${PID_PATH}")"
