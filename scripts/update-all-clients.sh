#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INVENTORY_PATH="infrastructure/ansible/inventory.yml"
PLAYBOOK_PATH="infrastructure/ansible/playbooks/update-clients.yml"
LOG_DIR="${PROJECT_ROOT}/logs"
REMOTE_HOST="${RASPI_SERVER_HOST:-}"
SSH_OPTS=${RASPI_SERVER_SSH_OPTS:-""}
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
LOG_FILE="${LOG_DIR}/ansible-update-${TIMESTAMP}.log"

mkdir -p "${LOG_DIR}"

run_locally() {
  cd "${PROJECT_ROOT}"
  ansible-playbook -i "${INVENTORY_PATH}" "${PLAYBOOK_PATH}" | tee "${LOG_FILE}"
}

run_remotely() {
  ssh ${SSH_OPTS} "${REMOTE_HOST}" "cd /opt/RaspberryPiSystem_002 && ansible-playbook -i ${INVENTORY_PATH} ${PLAYBOOK_PATH}" | tee "${LOG_FILE}"
}

if [[ -n "${REMOTE_HOST}" ]]; then
  echo "[INFO] Executing update playbook on ${REMOTE_HOST}"
  run_remotely
else
  echo "[INFO] Executing update playbook locally"
  run_locally
fi

echo "[INFO] Log saved to ${LOG_FILE}"
