#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root (sudo)." >&2
  exit 1
fi

CONTROL_TOKEN="${LLM_RUNTIME_CONTROL_TOKEN:-}"
if [[ -z "${CONTROL_TOKEN}" ]]; then
  echo "LLM_RUNTIME_CONTROL_TOKEN is required." >&2
  exit 1
fi

SERVICE_USER="${LLM_RUNTIME_SERVICE_USER:-localllm}"
SERVICE_HOME="${LLM_RUNTIME_SERVICE_HOME:-/home/${SERVICE_USER}}"
INSTALL_DIR="${LLM_RUNTIME_INSTALL_DIR:-${SERVICE_HOME}}"
INSTALL_PATH="${LLM_RUNTIME_INSTALL_PATH:-${INSTALL_DIR}/control-server.mjs}"
COMPOSE_DIR="${LLM_RUNTIME_COMPOSE_DIR:-${SERVICE_HOME}/local-llm-system/compose}"
LISTEN_HOST="${LLM_RUNTIME_LISTEN_HOST:-0.0.0.0}"
LISTEN_PORT="${LLM_RUNTIME_LISTEN_PORT:-39090}"
DEFAULTS_PATH="${LLM_RUNTIME_DEFAULTS_PATH:-/etc/default/llm-runtime-control}"
SYSTEMD_PATH="${LLM_RUNTIME_SYSTEMD_PATH:-/etc/systemd/system/llm-runtime-control.service}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_SCRIPT="${SCRIPT_DIR}/control-server.mjs"

if ! id "${SERVICE_USER}" >/dev/null 2>&1; then
  echo "User not found: ${SERVICE_USER}" >&2
  exit 1
fi

if [[ ! -f "${SOURCE_SCRIPT}" ]]; then
  echo "Missing source script: ${SOURCE_SCRIPT}" >&2
  exit 1
fi

install -d -o "${SERVICE_USER}" -g "${SERVICE_USER}" "${INSTALL_DIR}"
install -o "${SERVICE_USER}" -g "${SERVICE_USER}" -m 0644 "${SOURCE_SCRIPT}" "${INSTALL_PATH}"

cat >"${DEFAULTS_PATH}" <<EOF
LLM_RUNTIME_CONTROL_TOKEN=${CONTROL_TOKEN}
LLM_RUNTIME_LISTEN_HOST=${LISTEN_HOST}
LLM_RUNTIME_LISTEN_PORT=${LISTEN_PORT}
LLM_RUNTIME_COMPOSE_DIR=${COMPOSE_DIR}
EOF
chmod 0600 "${DEFAULTS_PATH}"

cat >"${SYSTEMD_PATH}" <<EOF
[Unit]
Description=Local LLM runtime control server
After=network.target

[Service]
User=${SERVICE_USER}
EnvironmentFile=${DEFAULTS_PATH}
ExecStart=/usr/bin/node ${INSTALL_PATH}
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now llm-runtime-control.service
systemctl restart llm-runtime-control.service
systemctl --no-pager --full status llm-runtime-control.service || true
