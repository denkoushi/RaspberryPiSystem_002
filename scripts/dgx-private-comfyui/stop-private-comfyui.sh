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

# shellcheck disable=SC1090
set -a
# shellcheck disable=SC1091
source "${ENV_FILE}"
set +a

# shellcheck source=boundary-check.sh
source "${SCRIPT_DIR}/boundary-check.sh"
validate_comfyui_data_root "${COMFYUI_DATA_ROOT:-}"

docker compose -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" down

echo "OK: private ComfyUI stack stopped."
