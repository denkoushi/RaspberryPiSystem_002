#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INVENTORY_PATH="infrastructure/ansible/inventory.yml"
PLAYBOOK_PATH="infrastructure/ansible/playbooks/update-clients.yml"
HEALTH_PLAYBOOK_PATH="infrastructure/ansible/playbooks/health-check.yml"
LOG_DIR="${PROJECT_ROOT}/logs"
REMOTE_HOST="${RASPI_SERVER_HOST:-}"
SSH_OPTS=${RASPI_SERVER_SSH_OPTS:-""}
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
LOG_FILE="${LOG_DIR}/ansible-update-${TIMESTAMP}.log"
SUMMARY_FILE="${LOG_DIR}/ansible-update-${TIMESTAMP}.summary.json"
HEALTH_LOG_FILE="${LOG_DIR}/ansible-health-${TIMESTAMP}.log"
HEALTH_SUMMARY_FILE="${LOG_DIR}/ansible-health-${TIMESTAMP}.summary.json"
HISTORY_FILE="${LOG_DIR}/ansible-history.jsonl"

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

  local failed_hosts
  local unreachable_hosts
  local total_hosts

  failed_hosts=$(grep -E "failed=[1-9]" "${log_file}" | grep -oE "raspberrypi[0-9]+" | sort -u | tr '\n' ',' | sed 's/,$//' || echo "")
  unreachable_hosts=$(grep -E "unreachable=[1-9]" "${log_file}" | grep -oE "raspberrypi[0-9]+" | sort -u | tr '\n' ',' | sed 's/,$//' || echo "")
  total_hosts=$(grep -E "PLAY RECAP" -A 10 "${log_file}" | grep -E "raspberrypi[0-9]+" | wc -l | tr -d ' ' || echo "0")

  local failed_hosts_json="[]"
  local unreachable_hosts_json="[]"

  if [[ -n "${failed_hosts}" ]]; then
    failed_hosts_json="[\"${failed_hosts//,/\",\"}\"]"
  fi
  if [[ -n "${unreachable_hosts}" ]]; then
    unreachable_hosts_json="[\"${unreachable_hosts//,/\",\"}\"]"
  fi

  cat > "${summary_file}" <<EOF
{
  "timestamp": "${TIMESTAMP}",
  "logFile": "${log_file}",
  "totalHosts": ${total_hosts},
  "failedHosts": ${failed_hosts_json},
  "unreachableHosts": ${unreachable_hosts_json},
  "success": $(if [ -n "${failed_hosts}" ] || [ -n "${unreachable_hosts}" ]; then echo "false"; else echo "true"; fi)
}
EOF
}

append_history() {
  local summary_file=$1
  local log_file=$2
  local exit_code=$3
  local operation=$4
  local duration=$5
  local host_context=$6

  python3 - <<'PY' "${summary_file}" "${HISTORY_FILE}" "${log_file}" "${exit_code}" "${operation}" "${duration}" "${host_context}"
import json, sys, os
summary_path, history_path, log_file, exit_code, operation, duration, host_context = sys.argv[1:]
try:
    with open(summary_path, encoding="utf-8") as fh:
        summary = json.load(fh)
except FileNotFoundError:
    summary = {}

entry = {
    "operation": operation,
    "timestamp": summary.get("timestamp"),
    "logFile": log_file,
    "summaryFile": summary_path,
    "success": bool(summary.get("success", False)),
    "failedHosts": summary.get("failedHosts", []),
    "unreachableHosts": summary.get("unreachableHosts", []),
    "totalHosts": summary.get("totalHosts", 0),
    "exitCode": int(exit_code),
    "durationSeconds": int(duration),
    "hostContext": host_context if host_context else "local"
}

os.makedirs(os.path.dirname(history_path), exist_ok=True)
with open(history_path, "a", encoding="utf-8") as out:
    json.dump(entry, out, ensure_ascii=False)
    out.write("\n")
PY
}

run_locally() {
  cd "${PROJECT_ROOT}"
  local exit_code=0
  local start_time
  start_time=$(date +%s)
  ansible-playbook -i "${INVENTORY_PATH}" "${PLAYBOOK_PATH}" | tee "${LOG_FILE}" || exit_code=$?
  local duration=$(( $(date +%s) - start_time ))
  generate_summary "${LOG_FILE}" "${SUMMARY_FILE}"
  append_history "${SUMMARY_FILE}" "${LOG_FILE}" "${exit_code}" "update" "${duration}" "local"
  return ${exit_code}
}

run_remotely() {
  local exit_code=0
  local start_time
  start_time=$(date +%s)
  ssh ${SSH_OPTS} "${REMOTE_HOST}" "cd /opt/RaspberryPiSystem_002 && ansible-playbook -i ${INVENTORY_PATH} ${PLAYBOOK_PATH}" | tee "${LOG_FILE}" || exit_code=$?
  local duration=$(( $(date +%s) - start_time ))
  generate_summary "${LOG_FILE}" "${SUMMARY_FILE}"
  append_history "${SUMMARY_FILE}" "${LOG_FILE}" "${exit_code}" "update" "${duration}" "${REMOTE_HOST}"
  return ${exit_code}
}

run_health_check_locally() {
  cd "${PROJECT_ROOT}"
  local exit_code=0
  local start_time
  start_time=$(date +%s)
  ansible-playbook -i "${INVENTORY_PATH}" "${HEALTH_PLAYBOOK_PATH}" | tee "${HEALTH_LOG_FILE}" || exit_code=$?
  local duration=$(( $(date +%s) - start_time ))
  generate_summary "${HEALTH_LOG_FILE}" "${HEALTH_SUMMARY_FILE}"
  append_history "${HEALTH_SUMMARY_FILE}" "${HEALTH_LOG_FILE}" "${exit_code}" "health-check" "${duration}" "local"
  return ${exit_code}
}

run_health_check_remotely() {
  local exit_code=0
  local start_time
  start_time=$(date +%s)
  ssh ${SSH_OPTS} "${REMOTE_HOST}" "cd /opt/RaspberryPiSystem_002 && ansible-playbook -i ${INVENTORY_PATH} ${HEALTH_PLAYBOOK_PATH}" | tee "${HEALTH_LOG_FILE}" || exit_code=$?
  local duration=$(( $(date +%s) - start_time ))
  generate_summary "${HEALTH_LOG_FILE}" "${HEALTH_SUMMARY_FILE}"
  append_history "${HEALTH_SUMMARY_FILE}" "${HEALTH_LOG_FILE}" "${exit_code}" "health-check" "${duration}" "${REMOTE_HOST}"
  return ${exit_code}
}

# メイン処理
if [[ -n "${REMOTE_HOST}" ]]; then
  echo "[INFO] Executing update playbook on ${REMOTE_HOST}"
  echo "[INFO] This will update both server (Raspberry Pi 5) and clients (Raspberry Pi 3/4)"
  if ! run_remotely; then
    if [ -f "${PROJECT_ROOT}/scripts/generate-alert.sh" ]; then
      "${PROJECT_ROOT}/scripts/generate-alert.sh" \
        "ansible-update-failed" \
        "Ansible更新が失敗しました" \
        "ログファイル: ${LOG_FILE}"
    fi
    exit_with_error 1 "Update playbook failed. Check ${LOG_FILE} for details."
  fi

  echo "[INFO] Running post-deploy health check on ${REMOTE_HOST}"
  if ! run_health_check_remotely; then
    if [ -f "${PROJECT_ROOT}/scripts/generate-alert.sh" ]; then
      "${PROJECT_ROOT}/scripts/generate-alert.sh" \
        "ansible-health-check-failed" \
        "Ansibleヘルスチェックが失敗しました" \
        "ログファイル: ${HEALTH_LOG_FILE}"
    fi
    exit_with_error 2 "Post-deploy health check failed. Check ${HEALTH_LOG_FILE} for details."
  fi
else
  echo "[INFO] Executing update playbook locally"
  echo "[INFO] This will update both server (Raspberry Pi 5) and clients (Raspberry Pi 3/4)"
  if ! run_locally; then
    if [ -f "${PROJECT_ROOT}/scripts/generate-alert.sh" ]; then
      "${PROJECT_ROOT}/scripts/generate-alert.sh" \
        "ansible-update-failed" \
        "Ansible更新が失敗しました" \
        "ログファイル: ${LOG_FILE}"
    fi
    exit_with_error 1 "Update playbook failed. Check ${LOG_FILE} for details."
  fi

  echo "[INFO] Running post-deploy health check locally"
  if ! run_health_check_locally; then
    if [ -f "${PROJECT_ROOT}/scripts/generate-alert.sh" ]; then
      "${PROJECT_ROOT}/scripts/generate-alert.sh" \
        "ansible-health-check-failed" \
        "Ansibleヘルスチェックが失敗しました" \
        "ログファイル: ${HEALTH_LOG_FILE}"
    fi
    exit_with_error 2 "Post-deploy health check failed. Check ${HEALTH_LOG_FILE} for details."
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

if [ -f "${HEALTH_SUMMARY_FILE}" ]; then
  echo ""
  echo "[INFO] Health Check Summary:"
  if command -v jq >/dev/null 2>&1; then
    jq '.' "${HEALTH_SUMMARY_FILE}"
  else
    cat "${HEALTH_SUMMARY_FILE}"
  fi
fi

echo "[INFO] Log saved to ${LOG_FILE}"
echo "[INFO] Summary saved to ${SUMMARY_FILE}"
echo "[INFO] Health log saved to ${HEALTH_LOG_FILE}"
echo "[INFO] Health summary saved to ${HEALTH_SUMMARY_FILE}"
