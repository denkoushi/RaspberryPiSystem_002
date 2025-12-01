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
SUMMARY_FILE="${LOG_DIR}/ansible-update-${TIMESTAMP}.summary.json"

mkdir -p "${LOG_DIR}"

# エラーコードを返す関数
exit_with_error() {
  local exit_code=$1
  local message=$2
  echo "[ERROR] ${message}" >&2
  echo "[INFO] Log saved to ${LOG_FILE}"
  exit "${exit_code}"
}

# 実行結果を解析してサマリーを生成
generate_summary() {
  local log_file=$1
  local summary_file=$2
  
  # PLAY RECAPから情報を抽出
  local failed_hosts=$(grep -E "failed=[1-9]" "${log_file}" | grep -oE "raspberrypi[0-9]+" | sort -u | tr '\n' ',' | sed 's/,$//' || echo "")
  local unreachable_hosts=$(grep -E "unreachable=[1-9]" "${log_file}" | grep -oE "raspberrypi[0-9]+" | sort -u | tr '\n' ',' | sed 's/,$//' || echo "")
  local total_hosts=$(grep -E "PLAY RECAP" -A 10 "${log_file}" | grep -E "raspberrypi[0-9]+" | wc -l | tr -d ' ' || echo "0")
  
  # JSON形式でサマリーを生成
  cat > "${summary_file}" <<EOF
{
  "timestamp": "${TIMESTAMP}",
  "logFile": "${LOG_FILE}",
  "totalHosts": ${total_hosts},
  "failedHosts": [$(echo "${failed_hosts}" | sed 's/,/","/g' | sed 's/^/"/' | sed 's/$/"/' || echo "")],
  "unreachableHosts": [$(echo "${unreachable_hosts}" | sed 's/,/","/g' | sed 's/^/"/' | sed 's/$/"/' || echo "")],
  "success": $(if [ -n "${failed_hosts}" ] || [ -n "${unreachable_hosts}" ]; then echo "false"; else echo "true"; fi)
}
EOF
}

run_locally() {
  cd "${PROJECT_ROOT}"
  local exit_code=0
  ansible-playbook -i "${INVENTORY_PATH}" "${PLAYBOOK_PATH}" | tee "${LOG_FILE}" || exit_code=$?
  generate_summary "${LOG_FILE}" "${SUMMARY_FILE}"
  return ${exit_code}
}

run_remotely() {
  local exit_code=0
  ssh ${SSH_OPTS} "${REMOTE_HOST}" "cd /opt/RaspberryPiSystem_002 && ansible-playbook -i ${INVENTORY_PATH} ${PLAYBOOK_PATH}" | tee "${LOG_FILE}" || exit_code=$?
  generate_summary "${LOG_FILE}" "${SUMMARY_FILE}"
  return ${exit_code}
}

# メイン処理
if [[ -n "${REMOTE_HOST}" ]]; then
  echo "[INFO] Executing update playbook on ${REMOTE_HOST}"
  if ! run_remotely; then
    exit_with_error 1 "Update playbook failed. Check ${LOG_FILE} for details."
  fi
else
  echo "[INFO] Executing update playbook locally"
  if ! run_locally; then
    exit_with_error 1 "Update playbook failed. Check ${LOG_FILE} for details."
  fi
fi

# サマリーを表示
if [ -f "${SUMMARY_FILE}" ]; then
  echo ""
  echo "[INFO] Deployment Summary:"
  if command -v jq >/dev/null 2>&1; then
    jq '.' "${SUMMARY_FILE}"
  else
    cat "${SUMMARY_FILE}"
  fi
fi

echo "[INFO] Log saved to ${LOG_FILE}"
echo "[INFO] Summary saved to ${SUMMARY_FILE}"
