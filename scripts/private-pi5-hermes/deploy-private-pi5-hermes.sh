#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEFAULT_FRAGMENT="${PROJECT_ROOT}/infrastructure/ansible/inventory-private-pi5-stackchan-bridge-fragment.yml"
INVENTORY_FRAGMENT="${PRIVATE_PI5_HERMES_INVENTORY:-${DEFAULT_FRAGMENT}}"
PLAYBOOK_DIR="${PROJECT_ROOT}/infrastructure/ansible"
PLAYBOOK_PATH="${PLAYBOOK_DIR}/playbooks/private-pi5-hermes.yml"
LIMIT_HOST="${PRIVATE_PI5_HERMES_LIMIT:-private-pi5-stackchan-bridge}"

if [[ ! -f "${INVENTORY_FRAGMENT}" ]]; then
  echo "[ERROR] inventory fragment not found: ${INVENTORY_FRAGMENT}" >&2
  exit 2
fi

cd "${PLAYBOOK_DIR}"
exec ansible-playbook "${PLAYBOOK_PATH}" \
  -i "${INVENTORY_FRAGMENT}" \
  --limit "${LIMIT_HOST}" \
  "$@"
