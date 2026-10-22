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
    sleep 1
  fi
  if [[ -n "${PID}" ]] && kill -0 "${PID}" 2>/dev/null; then
    echo "failed to stop pid=${PID}" >&2
    rm -f "${PID_PATH}"
    exit 1
  fi
  rm -f "${PID_PATH}"
  echo "stopped pid=${PID:-unknown}"
  exit 0
fi

EXISTING_NAME="$(docker ps -a --filter "name=^/${CONTAINER_NAME}$" --format '{{.Names}}' | tr -d '\r')"
if [[ "${EXISTING_NAME}" != "${CONTAINER_NAME}" ]]; then
  echo "container not found: ${CONTAINER_NAME}"
elif ! docker rm -f "${CONTAINER_NAME}" >/dev/null; then
  echo "docker rm failed for container=${CONTAINER_NAME}" >&2
  exit 1
else
  echo "stopped container=${CONTAINER_NAME}"
fi

WORKER_MARKER="${BLUE_REMOTE_WORKER_MARKER_PATH:-/srv/dgx/system-prod/state/blue-remote-worker.json}"
if [[ -f "${WORKER_MARKER}" ]]; then
  WORKER_DATA="$(python3 - "${WORKER_MARKER}" <<'PY'
import json
import re
import shlex
import sys
from pathlib import Path

marker = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
target = marker["sshTarget"]
name = marker["containerName"]
if not isinstance(target, str) or not re.fullmatch(r"[a-zA-Z0-9_][a-zA-Z0-9_.-]*@[a-zA-Z0-9_][a-zA-Z0-9_.-]*", target):
    raise SystemExit("invalid worker sshTarget in marker")
if not isinstance(name, str) or not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_.-]*", name):
    raise SystemExit("invalid worker containerName in marker")
print(target)
print(shlex.join(["docker", "rm", "-f", name]))
PY
  )"
  WORKER_TARGET="${WORKER_DATA%%$'\n'*}"
  WORKER_COMMAND="${WORKER_DATA#*$'\n'}"
  if ! ssh -o BatchMode=yes -o ConnectTimeout=10 -- "${WORKER_TARGET}" "${WORKER_COMMAND}"; then
    echo "failed to stop remote worker at ${WORKER_TARGET}; retaining marker ${WORKER_MARKER}" >&2
    exit 1
  fi
  rm -f -- "${WORKER_MARKER}"
fi
