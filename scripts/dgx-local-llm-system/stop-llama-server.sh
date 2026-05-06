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
  kill "${PID}" 2>/dev/null || true
  for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
    if ! kill -0 "${PID}" 2>/dev/null; then
      break
    fi
    sleep 1
  done
  if kill -0 "${PID}" 2>/dev/null; then
    kill -9 "${PID}" 2>/dev/null || true
    sleep 1
  fi
fi

if kill -0 "${PID}" 2>/dev/null; then
  echo "failed to stop pid=${PID}" >&2
  rm -f "${PID_PATH}"
  exit 1
fi

rm -f "${PID_PATH}"
echo "stopped pid=${PID}"
