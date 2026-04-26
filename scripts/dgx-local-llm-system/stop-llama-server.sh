#!/usr/bin/env bash
set -euo pipefail

PID_PATH="${LLAMA_SERVER_PID_PATH:-/srv/dgx/system-prod/logs/llama-server.pid}"

if [[ ! -f "${PID_PATH}" ]]; then
  echo "pid file not found"
  exit 0
fi

PID="$(tr -d '\n' < "${PID_PATH}")"
if [[ -z "${PID}" ]]; then
  rm -f "${PID_PATH}"
  echo "empty pid file removed"
  exit 0
fi

if kill -0 "${PID}" 2>/dev/null; then
  kill "${PID}"
  sleep 2
fi

rm -f "${PID_PATH}"
echo "stopped pid=${PID}"
