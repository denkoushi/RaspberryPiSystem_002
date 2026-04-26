#!/usr/bin/env bash
set -euo pipefail

LOG_PATH="${LLM_RUNTIME_CONTROL_LOG_PATH:-/srv/dgx/system-prod/logs/control-server.log}"
PID_PATH="${LLM_RUNTIME_CONTROL_PID_PATH:-/srv/dgx/system-prod/logs/control-server.pid}"
SCRIPT_PATH="${LLM_RUNTIME_CONTROL_SCRIPT_PATH:-/srv/dgx/system-prod/bin/control-server.py}"
START_CMD="${LLM_RUNTIME_START_CMD:-/srv/dgx/system-prod/bin/start-llama-server.sh}"
STOP_CMD="${LLM_RUNTIME_STOP_CMD:-/srv/dgx/system-prod/bin/stop-llama-server.sh}"
TOKEN_FILE="${LLM_RUNTIME_CONTROL_TOKEN_FILE:-/srv/dgx/system-prod/secrets/runtime-control-token}"
HOST="${LLM_RUNTIME_LISTEN_HOST:-127.0.0.1}"
PORT="${LLM_RUNTIME_LISTEN_PORT:-39090}"

install -d "$(dirname "${LOG_PATH}")"

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
  LLM_RUNTIME_START_CMD="${START_CMD}" \
  LLM_RUNTIME_STOP_CMD="${STOP_CMD}" \
  LLM_RUNTIME_LISTEN_HOST="${HOST}" \
  LLM_RUNTIME_LISTEN_PORT="${PORT}" \
  python3 "${SCRIPT_PATH}" >>"${LOG_PATH}" 2>&1 < /dev/null &

echo $! >"${PID_PATH}"
echo "started pid=$(cat "${PID_PATH}")"
