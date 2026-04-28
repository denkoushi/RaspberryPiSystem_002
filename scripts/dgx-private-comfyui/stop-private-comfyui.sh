#!/usr/bin/env bash
# Stop private ComfyUI stack (containers only — volumes persist).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}"

die() {
  echo "stop-private-comfyui: $*" >&2
  exit 1
}

command -v docker >/dev/null 2>&1 || die "docker not found"

COMPOSE_FILE="${COMPOSE_FILE:-${SCRIPT_DIR}/compose.yaml}"
ENV_FILE="${ENV_FILE:-${SCRIPT_DIR}/.env}"

[[ -f "${COMPOSE_FILE}" ]] || die "missing ${COMPOSE_FILE}"
[[ -f "${ENV_FILE}" ]] || die "missing ${ENV_FILE}"

docker compose -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" down

echo "OK: private ComfyUI stack stopped."
