#!/usr/bin/env bash
# Start private ComfyUI stack on DGX Spark (Docker Compose + GPU).
# SOLID: launcher only orchestrates; compose/Dockerfile/env hold configuration.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}"

die() {
  echo "start-private-comfyui: $*" >&2
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"
}

need_cmd docker

COMPOSE_FILE="${COMPOSE_FILE:-${SCRIPT_DIR}/compose.yaml}"
ENV_FILE="${ENV_FILE:-${SCRIPT_DIR}/.env}"
DOCKERFILE="${DOCKERFILE:-${SCRIPT_DIR}/Dockerfile}"

[[ -f "${COMPOSE_FILE}" ]] || die "missing ${COMPOSE_FILE} — copy compose.yaml.example and edit paths."
[[ -f "${ENV_FILE}" ]] || die "missing ${ENV_FILE} — copy .env.example and set COMFYUI_DATA_ROOT."
[[ -f "${DOCKERFILE}" ]] || die "missing ${DOCKERFILE} — copy Dockerfile.example to Dockerfile."

# shellcheck disable=SC1090
set -a
# shellcheck disable=SC1091
source "${ENV_FILE}"
set +a

NETWORK_NAME="${DGX_PRIVATE_NETWORK_NAME:-dgx_private_personal_net}"
if ! docker network inspect "${NETWORK_NAME}" >/dev/null 2>&1; then
  die "Docker network '${NETWORK_NAME}' not found. Create once on the host: docker network create ${NETWORK_NAME}"
fi

ROOT="${COMFYUI_DATA_ROOT:-}"
[[ -n "${ROOT}" ]] || die "COMFYUI_DATA_ROOT must be set in ${ENV_FILE}"

install -d -m 0750 "${ROOT}/models/checkpoints" "${ROOT}/input" "${ROOT}/output" "${ROOT}/user"

echo "Building / starting ComfyUI (project=${COMPOSE_PROJECT_NAME:-dgx-private-comfyui})..."
docker compose -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" up -d --build

echo "OK: ComfyUI should listen on host loopback 127.0.0.1:${COMFYUI_PORT:-8188} — see docs/runbooks/dgx-private-comfyui.md for Tailscale Mac access."
