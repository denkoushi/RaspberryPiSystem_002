#!/usr/bin/env bash
set -euo pipefail

CONTAINER_NAME="${BLUE_CONTAINER_NAME:-${TRTLLM_CONTAINER_NAME:-system-prod-trtllm}}"
MODE="${BLUE_SERVER_MODE:-${TRTLLM_SERVER_MODE:-container}}"
PID_PATH="${BLUE_SERVER_PID_PATH:-${TRTLLM_SERVER_PID_PATH:-/srv/dgx/system-prod/logs/trtllm-server.pid}}"

if [[ "${MODE}" == "host" ]]; then
  if [[ ! -f "${PID_PATH}" ]]; then
    echo "pid file not found: ${PID_PATH}"
    exit 0
  fi
  PID="$(tr -d '\n' < "${PID_PATH}")"
  if [[ -n "${PID}" ]] && kill -0 "${PID}" 2>/dev/null; then
    kill "${PID}" 2>/dev/null || true
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      if ! kill -0 "${PID}" 2>/dev/null; then
        break
      fi
      sleep 1
    done
    kill -9 "${PID}" 2>/dev/null || true
  fi
  rm -f "${PID_PATH}"
  echo "stopped pid=${PID:-unknown}"
  exit 0
fi

EXISTING_NAME="$(docker ps -a --filter "name=^/${CONTAINER_NAME}$" --format '{{.Names}}' | tr -d '\r')"
if [[ "${EXISTING_NAME}" != "${CONTAINER_NAME}" ]]; then
  echo "container not found: ${CONTAINER_NAME}"
  exit 0
fi

docker rm -f "${CONTAINER_NAME}" >/dev/null
echo "stopped container=${CONTAINER_NAME}"
