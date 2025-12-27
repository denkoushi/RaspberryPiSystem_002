#!/usr/bin/env bash
set -euo pipefail

# 使用方法:
#   ./scripts/update-all-clients.sh [--skip-checks] [--yes] [ブランチ名]
#
# ブランチ指定: 引数 > 環境変数(ANSIBLE_REPO_VERSION) > デフォルト(main)
# デプロイ前チェックはデフォルトで実施（--skip-checksでスキップ可能）

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
PRECHECK_JSONL_FILE="${LOG_DIR}/ansible-precheck-${TIMESTAMP}.jsonl"
PRECHECK_FILE="${LOG_DIR}/ansible-precheck-${TIMESTAMP}.json"
DIAGNOSTICS_FILE="${LOG_DIR}/ansible-diagnostics-${TIMESTAMP}.json"

SKIP_CHECKS=false
AUTO_YES=false
DEPLOY_MODE="local"

usage() {
  cat <<'EOF'
Usage:
  ./scripts/update-all-clients.sh [--skip-checks] [--yes] [branch]

Options:
  --skip-checks   Skip pre-deployment checks (debug only)
  --yes           Auto-approve interactive prompts (non-interactive safe)
  -h, --help      Show help

Examples:
  export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"
  ./scripts/update-all-clients.sh main
  ./scripts/update-all-clients.sh --yes feature/gmail-attachment-integration
EOF
}

# args: [--flags...] [branch]
while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-checks)
      SKIP_CHECKS=true
      shift
      ;;
    --yes|-y)
      AUTO_YES=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --)
      shift
      break
      ;;
    -*)
      echo "[ERROR] Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
    *)
      break
      ;;
  esac
done

REPO_VERSION="${1:-${ANSIBLE_REPO_VERSION:-main}}"
export ANSIBLE_REPO_VERSION="${REPO_VERSION}"

mkdir -p "${LOG_DIR}"

timestamp() {
  date '+%Y-%m-%d %H:%M:%S'
}

log_info() {
  echo "[$(timestamp)] [INFO] $*"
}

log_warn() {
  echo "[$(timestamp)] [WARN] $*"
}

log_error() {
  echo "[$(timestamp)] [ERROR] $*" >&2
}

is_interactive() {
  [[ -t 0 ]]
}

precheck_record() {
  local name=$1
  local status=$2
  local message=${3:-}
  python3 - <<'PY' "${PRECHECK_JSONL_FILE}" "${name}" "${status}" "${message}"
import json, sys, os
path, name, status, message = sys.argv[1:]
os.makedirs(os.path.dirname(path), exist_ok=True)
entry = {"name": name, "status": status, "message": message}
with open(path, "a", encoding="utf-8") as f:
    json.dump(entry, f, ensure_ascii=False)
    f.write("\n")
PY
}

finalize_precheck_log() {
  # Always try to emit a single JSON artifact (even if checks were skipped / failed early).
  python3 - <<'PY' "${PRECHECK_JSONL_FILE}" "${PRECHECK_FILE}" "${TIMESTAMP}" "${REPO_VERSION}" "${DEPLOY_MODE}" "${REMOTE_HOST}"
import json, sys, os
jsonl_path, out_path, ts, branch, mode, remote_host = sys.argv[1:]
checks = []
if os.path.exists(jsonl_path):
    with open(jsonl_path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                checks.append(json.loads(line))
            except Exception:
                checks.append({"name": "precheck_log_parse", "status": "warn", "message": "invalid jsonl line"})
doc = {
    "timestamp": ts,
    "branch": branch,
    "mode": mode,
    "remoteHost": remote_host or None,
    "checks": checks,
}
os.makedirs(os.path.dirname(out_path), exist_ok=True)
with open(out_path, "w", encoding="utf-8") as out:
    json.dump(doc, out, ensure_ascii=False, indent=2)
    out.write("\n")
PY
}

trap finalize_precheck_log EXIT

collect_diagnostics() {
  # Best-effort diagnostics collection (should never abort the script).
  local network_mode=""
  local pi5_mem=""
  local pi5_ansible_ps=""
  local pi5_git=""

  if [[ -n "${REMOTE_HOST}" ]]; then
    network_mode=$(ssh ${SSH_OPTS} "${REMOTE_HOST}" "grep '^network_mode:' /opt/RaspberryPiSystem_002/infrastructure/ansible/group_vars/all.yml 2>/dev/null || true" 2>/dev/null || true)
    pi5_mem=$(ssh ${SSH_OPTS} "${REMOTE_HOST}" "free -m 2>/dev/null | head -2 || true" 2>/dev/null || true)
    pi5_ansible_ps=$(ssh ${SSH_OPTS} "${REMOTE_HOST}" "ps aux | grep -E 'ansible-playbook|AnsiballZ' | grep -v grep | head -20 || true" 2>/dev/null || true)
    pi5_git=$(ssh ${SSH_OPTS} "${REMOTE_HOST}" "cd /opt/RaspberryPiSystem_002 && git rev-parse --short HEAD 2>/dev/null || true" 2>/dev/null || true)
  else
    # local mode (typically on Pi5)
    network_mode=$(grep '^network_mode:' /opt/RaspberryPiSystem_002/infrastructure/ansible/group_vars/all.yml 2>/dev/null || true)
    pi5_mem=$(free -m 2>/dev/null | head -2 || true)
    pi5_ansible_ps=$(ps aux | grep -E 'ansible-playbook|AnsiballZ' | grep -v grep | head -20 || true)
    pi5_git=$(cd /opt/RaspberryPiSystem_002 2>/dev/null && git rev-parse --short HEAD 2>/dev/null || true)
  fi

  python3 - <<'PY' "${DIAGNOSTICS_FILE}" "${TIMESTAMP}" "${REPO_VERSION}" "${DEPLOY_MODE}" "${REMOTE_HOST}" "${network_mode}" "${pi5_git}" "${pi5_mem}" "${pi5_ansible_ps}"
import json, sys, os
out_path, ts, branch, mode, remote_host, network_mode, pi5_git, pi5_mem, pi5_ps = sys.argv[1:]
doc = {
    "timestamp": ts,
    "branch": branch,
    "mode": mode,
    "remoteHost": remote_host or None,
    "networkModeLine": network_mode,
    "pi5": {
        "gitHead": pi5_git,
        "freeMB": pi5_mem,
        "ansibleProcesses": pi5_ps,
    },
}
os.makedirs(os.path.dirname(out_path), exist_ok=True)
with open(out_path, "w", encoding="utf-8") as f:
    json.dump(doc, f, ensure_ascii=False, indent=2)
    f.write("\n")
PY
}

# エラーコードを返す関数
exit_with_error() {
  local exit_code=$1
  local message=$2
  log_error "${message}"
  collect_diagnostics || true
  log_info "Precheck saved to ${PRECHECK_FILE}"
  log_info "Diagnostics saved to ${DIAGNOSTICS_FILE}"
  log_info "Log saved to ${LOG_FILE}"
  exit "${exit_code}"
}

# 実行結果を解析してサマリーを生成
generate_summary() {
  local log_file=$1
  local summary_file=$2
  
  local failed_hosts
  local unreachable_hosts
  local total_hosts

  # NOTE: set -euo pipefail is enabled; avoid `|| echo` inside pipelines (it can double-emit output).
  failed_hosts=$(grep -E "failed=[1-9]" "${log_file}" 2>/dev/null | grep -oE "raspberrypi[0-9]+" | sort -u | tr '\n' ',' | sed 's/,$//' || true)
  unreachable_hosts=$(grep -E "unreachable=[1-9]" "${log_file}" 2>/dev/null | grep -oE "raspberrypi[0-9]+" | sort -u | tr '\n' ',' | sed 's/,$//' || true)
  total_hosts=$(grep -E "PLAY RECAP" -A 10 "${log_file}" 2>/dev/null | grep -E "raspberrypi[0-9]+" | wc -l | tr -d ' ' || true)
  failed_hosts="${failed_hosts//$'\n'/}"
  unreachable_hosts="${unreachable_hosts//$'\n'/}"
  total_hosts="${total_hosts//$'\n'/}"
  if [[ -z "${total_hosts}" ]]; then
    total_hosts="0"
  fi
  
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

check_network_mode() {
  if [[ -z "${REMOTE_HOST}" ]]; then
    return 0
  fi

  log_info "Checking network_mode configuration on Pi5..."
  local network_mode
  network_mode=$(ssh ${SSH_OPTS} "${REMOTE_HOST}" "grep '^network_mode:' /opt/RaspberryPiSystem_002/infrastructure/ansible/group_vars/all.yml 2>/dev/null | awk '{print \$2}' | tr -d '\"'" || echo "")

  if [[ "${network_mode}" = "local" ]]; then
    log_warn "Pi5上のnetwork_modeが'local'です"
    echo "  現在のネットワーク環境を確認してください:"
    echo "  - オフィスネットワーク: network_mode=local でOK"
    echo "  - 自宅ネットワーク/リモートアクセス: network_mode=tailscale に変更が必要"
    echo ""
    echo "  変更方法:"
    echo "  ssh ${REMOTE_HOST} \"sed -i 's/network_mode: \\\"local\\\"/network_mode: \\\"tailscale\\\"/' /opt/RaspberryPiSystem_002/infrastructure/ansible/group_vars/all.yml\""
    echo ""

    if [[ "${AUTO_YES}" == "true" ]]; then
      precheck_record "network_mode" "warn" "network_mode=local (auto-continue via --yes)"
      return 0
    fi

    if ! is_interactive; then
      precheck_record "network_mode" "fail" "network_mode=local (non-interactive; pass --yes or fix network_mode)"
      exit_with_error 3 "network_mode=local です（非対話実行のため停止）。network_modeを修正するか、--yes を付けて実行してください。"
    fi

    read -p "続行しますか？ (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
      precheck_record "network_mode" "fail" "user_cancelled"
      log_info "デプロイをキャンセルしました"
      exit 1
    fi
    precheck_record "network_mode" "warn" "network_mode=local (user approved)"
  elif [[ "${network_mode}" = "tailscale" ]]; then
    precheck_record "network_mode" "ok" "network_mode=tailscale"
    log_info "network_mode='tailscale' が設定されています（リモートアクセス用）"
  else
    precheck_record "network_mode" "warn" "network_mode not detected (${network_mode})"
    log_warn "network_modeの設定を確認できませんでした（${network_mode}）"
    echo "  手動で確認してください:"
    echo "  ssh ${REMOTE_HOST} \"cat /opt/RaspberryPiSystem_002/infrastructure/ansible/group_vars/all.yml | grep network_mode\""
  fi
}

check_pi5_connectivity() {
  if [[ -z "${REMOTE_HOST}" ]]; then
    precheck_record "pi5_connectivity" "skip" "running locally"
    return 0
  fi

  local host="${REMOTE_HOST#*@}"
  log_info "Checking Pi5 connectivity: ${REMOTE_HOST}"

  if ping -c 1 "${host}" >/dev/null 2>&1; then
    precheck_record "pi5_ping" "ok" "ping ok (${host})"
  else
    # ICMP may be blocked; treat as warning if SSH works.
    precheck_record "pi5_ping" "warn" "ping failed (${host})"
    log_warn "ping failed (${host}) (SSHで疎通が取れれば続行します)"
  fi

  if ssh ${SSH_OPTS} -o BatchMode=yes -o ConnectTimeout=10 "${REMOTE_HOST}" 'echo CONNECTED' >/dev/null 2>&1; then
    precheck_record "pi5_ssh" "ok" "ssh ok"
  else
    precheck_record "pi5_ssh" "fail" "ssh failed"
    exit_with_error 3 "Pi5へSSH接続できません（${REMOTE_HOST}）。Tailscale/鍵/ユーザー/ネットワークを確認してください。"
  fi
}

kill_existing_ansible_processes() {
  if [[ -z "${REMOTE_HOST}" ]]; then
    precheck_record "ansible_process_cleanup" "skip" "running locally"
    return 0
  fi
  log_info "Killing existing ansible processes on Pi5 (prevent stacking)..."
  ssh ${SSH_OPTS} "${REMOTE_HOST}" 'pkill -9 -f ansible-playbook || true; pkill -9 -f AnsiballZ || true' >/dev/null 2>&1 || true
  precheck_record "ansible_process_cleanup" "ok" "pkill issued"
}

check_ansible_connectivity() {
  if [[ -z "${REMOTE_HOST}" ]]; then
    precheck_record "ansible_ping" "skip" "running locally"
    return 0
  fi
  log_info "Checking client connectivity from Pi5 (ansible ping)..."
  local out
  local exit_code=0
  # タイムアウト120秒でansible pingを実行（Pi3の応答が遅い場合を考慮）
  out=$(timeout 120 ssh ${SSH_OPTS} "${REMOTE_HOST}" "cd /opt/RaspberryPiSystem_002 && ansible all -i ${INVENTORY_PATH} -m ping" 2>&1) || {
    exit_code=$?
    if [[ ${exit_code} -eq 124 ]]; then
      # タイムアウト（124はtimeoutコマンドのタイムアウト終了コード）
      precheck_record "ansible_ping" "fail" "ansible ping timeout (120s)"
      log_error "ansible pingがタイムアウトしました（120秒）。Pi3/Pi4のSSHデーモンが応答していない可能性があります。"
      log_error "出力: ${out}"
      exit_with_error 3 "Pi5→Pi3/Pi4 の疎通（ansible ping）がタイムアウトしました。対象端末のSSHデーモン状態を確認してください（KB-096参照）。"
    else
      # その他のエラー
      precheck_record "ansible_ping" "fail" "ansible ping failed (exit=${exit_code})"
      log_error "${out}"
      exit_with_error 3 "Pi5→Pi3/Pi4 の疎通（ansible ping）が失敗しました（終了コード: ${exit_code}）。network_modeやSSH鍵を確認してください。"
    fi
  }
  if echo "${out}" | grep -qE "UNREACHABLE|FAILED"; then
    precheck_record "ansible_ping" "fail" "unreachable detected"
    log_error "${out}"
    exit_with_error 3 "ansible pingにUNREACHABLE/FAILEDが含まれます。network_modeや対象端末の状態を確認してください。"
  fi
  precheck_record "ansible_ping" "ok" "all hosts reachable"
}

check_memory() {
  # Pi5: 2GB+ recommended (warn if below). Pi3: 120MB+ required (fail if below).
  if [[ -z "${REMOTE_HOST}" ]]; then
    precheck_record "memory" "skip" "running locally"
    return 0
  fi

  log_info "Checking memory on Pi5..."
  local pi5_avail
  pi5_avail=$(ssh ${SSH_OPTS} "${REMOTE_HOST}" "free -m | awk 'NR==2 {print \$7}'" 2>/dev/null || echo "")
  if [[ -n "${pi5_avail}" ]] && [[ "${pi5_avail}" =~ ^[0-9]+$ ]]; then
    if (( pi5_avail < 2048 )); then
      precheck_record "pi5_memory" "warn" "availableMB=${pi5_avail} (<2048 recommended)"
      log_warn "Pi5 available memory is ${pi5_avail}MB (<2048MB 推奨)"
    else
      precheck_record "pi5_memory" "ok" "availableMB=${pi5_avail}"
    fi
  else
    precheck_record "pi5_memory" "warn" "could not parse free -m"
    log_warn "Pi5 memory check: could not parse free -m"
  fi

  log_info "Checking memory on Pi3 (requires >=120MB available)..."
  local pi3_avail_raw
  pi3_avail_raw=$(ssh ${SSH_OPTS} "${REMOTE_HOST}" "cd /opt/RaspberryPiSystem_002 && ansible raspberrypi3 -i ${INVENTORY_PATH} -m shell -a 'free -m | awk \"NR==2 {print \\\$7}\"' 2>/dev/null" 2>/dev/null || true)
  local pi3_avail
  pi3_avail=$(echo "${pi3_avail_raw}" | grep -oE "[0-9]+" | tail -1 2>/dev/null || echo "")
  if [[ -n "${pi3_avail}" ]] && [[ "${pi3_avail}" =~ ^[0-9]+$ ]]; then
    if (( pi3_avail < 120 )); then
      precheck_record "pi3_memory" "fail" "availableMB=${pi3_avail} (<120 required)"
      exit_with_error 3 "Pi3の空きメモリが不足しています（available=${pi3_avail}MB < 120MB）。Pi3のサービス停止（signage-lite等）後に再実行してください。"
    fi
    precheck_record "pi3_memory" "ok" "availableMB=${pi3_avail}"
  else
    precheck_record "pi3_memory" "warn" "could not read/parse via ansible"
    log_warn "Pi3 memory check: could not read/parse (ansible)"
  fi
}

stop_pi3_services_for_deploy() {
  if [[ -z "${REMOTE_HOST}" ]]; then
    precheck_record "pi3_service_stop" "skip" "running locally"
    return 0
  fi
  log_info "Stopping Pi3 signage services to prevent memory hang (KB-089/KB-097)..."
  local out
  out=$(ssh ${SSH_OPTS} "${REMOTE_HOST}" "cd /opt/RaspberryPiSystem_002 && ansible raspberrypi3 -i ${INVENTORY_PATH} -b -m shell -a 'systemctl stop signage-lite.service signage-lite-update.timer status-agent.timer && systemctl disable signage-lite.service signage-lite-update.timer status-agent.timer && systemctl mask --runtime signage-lite.service' 2>&1" 2>&1) || true
  if echo "${out}" | grep -qE "UNREACHABLE|FAILED"; then
    precheck_record "pi3_service_stop" "fail" "ansible failed"
    log_error "${out}"
    exit_with_error 3 "Pi3のサービス停止に失敗しました。Pi3への疎通/権限を確認してください。"
  fi
  precheck_record "pi3_service_stop" "ok" "stop/disable/mask issued"
}

run_prechecks() {
  if [[ "${SKIP_CHECKS}" == "true" ]]; then
    precheck_record "prechecks" "skip" "--skip-checks"
    log_warn "Pre-deployment checks are skipped (--skip-checks)"
    return 0
  fi

  if [[ -n "${REMOTE_HOST}" ]]; then
    DEPLOY_MODE="remote"
  fi

  log_info "Stage 1/3: Pre-deployment checks"
  check_pi5_connectivity
  kill_existing_ansible_processes
  check_network_mode
  check_ansible_connectivity
  check_memory
  stop_pi3_services_for_deploy
  log_info "Note: Pi3 deployment may take 10-15+ minutes. Avoid interrupting until PLAY RECAP."
  precheck_record "prechecks" "ok" "completed"
  return 0
}

run_locally() {
  cd "${PROJECT_ROOT}"
  local exit_code=0
  local start_time
  start_time=$(date +%s)
  ANSIBLE_REPO_VERSION="${REPO_VERSION}" ansible-playbook -i "${INVENTORY_PATH}" "${PLAYBOOK_PATH}" | tee "${LOG_FILE}" || exit_code=$?
  local duration=$(( $(date +%s) - start_time ))
  generate_summary "${LOG_FILE}" "${SUMMARY_FILE}"
  append_history "${SUMMARY_FILE}" "${LOG_FILE}" "${exit_code}" "update" "${duration}" "local"
  return ${exit_code}
}

run_remotely() {
  local exit_code=0
  local start_time
  start_time=$(date +%s)
  local remote_cmd
  # NOTE: We `cd` into infrastructure/ansible on Pi5. Use paths relative to that directory.
  remote_cmd="cd /opt/RaspberryPiSystem_002/infrastructure/ansible && ANSIBLE_ROLES_PATH=/opt/RaspberryPiSystem_002/infrastructure/ansible/roles ANSIBLE_REPO_VERSION=${REPO_VERSION} ansible-playbook -i inventory.yml playbooks/update-clients.yml"
  : > "${LOG_FILE}"
  for attempt in 1 2; do
    log_info "Remote update attempt ${attempt}/2"
    echo "=== Remote update attempt ${attempt}/2 @ $(timestamp) ===" >> "${LOG_FILE}"
    if [[ "${attempt}" -eq 1 ]]; then
      ssh ${SSH_OPTS} "${REMOTE_HOST}" "${remote_cmd}" | tee "${LOG_FILE}" || exit_code=$?
    else
      ssh ${SSH_OPTS} "${REMOTE_HOST}" "${remote_cmd}" | tee -a "${LOG_FILE}" || exit_code=$?
    fi
    if [[ "${exit_code}" -eq 0 ]]; then
      break
    fi
    log_warn "Remote update failed (exit=${exit_code}). Retrying once..."
    sleep 3
  done
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
  local remote_cmd
  # NOTE: We `cd` into infrastructure/ansible on Pi5. Use paths relative to that directory.
  remote_cmd="cd /opt/RaspberryPiSystem_002/infrastructure/ansible && ANSIBLE_ROLES_PATH=/opt/RaspberryPiSystem_002/infrastructure/ansible/roles ansible-playbook -i inventory.yml playbooks/health-check.yml"
  : > "${HEALTH_LOG_FILE}"
  for attempt in 1 2; do
    log_info "Remote health check attempt ${attempt}/2"
    echo "=== Remote health check attempt ${attempt}/2 @ $(timestamp) ===" >> "${HEALTH_LOG_FILE}"
    if [[ "${attempt}" -eq 1 ]]; then
      ssh ${SSH_OPTS} "${REMOTE_HOST}" "${remote_cmd}" | tee "${HEALTH_LOG_FILE}" || exit_code=$?
    else
      ssh ${SSH_OPTS} "${REMOTE_HOST}" "${remote_cmd}" | tee -a "${HEALTH_LOG_FILE}" || exit_code=$?
    fi
    if [[ "${exit_code}" -eq 0 ]]; then
      break
    fi
    log_warn "Remote health check failed (exit=${exit_code}). Retrying once..."
    sleep 3
  done
  local duration=$(( $(date +%s) - start_time ))
  generate_summary "${HEALTH_LOG_FILE}" "${HEALTH_SUMMARY_FILE}"
  append_history "${HEALTH_SUMMARY_FILE}" "${HEALTH_LOG_FILE}" "${exit_code}" "health-check" "${duration}" "${REMOTE_HOST}"
  return ${exit_code}
}

# メイン処理
if [[ -n "${REMOTE_HOST}" ]]; then
  DEPLOY_MODE="remote"
  log_info "Executing update playbook on ${REMOTE_HOST}"
  log_info "Branch: ${REPO_VERSION}"
  log_info "This will update both server (Raspberry Pi 5) and clients (Raspberry Pi 3/4)"
  run_prechecks
  log_info "Stage 2/3: Update (ansible-playbook)"
  if ! run_remotely; then
    if [ -f "${PROJECT_ROOT}/scripts/generate-alert.sh" ]; then
      "${PROJECT_ROOT}/scripts/generate-alert.sh" \
        "ansible-update-failed" \
        "Ansible更新が失敗しました" \
        "ログファイル: ${LOG_FILE}"
    fi
    exit_with_error 1 "Update playbook failed. Check ${LOG_FILE} for details."
  fi

  log_info "Stage 3/3: Health check (ansible-playbook)"
  log_info "Running post-deploy health check on ${REMOTE_HOST}"
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
  DEPLOY_MODE="local"
  log_info "Executing update playbook locally"
  log_info "Branch: ${REPO_VERSION}"
  log_info "This will update both server (Raspberry Pi 5) and clients (Raspberry Pi 3/4)"
  run_prechecks
  log_info "Stage 2/3: Update (ansible-playbook)"
  if ! run_locally; then
    if [ -f "${PROJECT_ROOT}/scripts/generate-alert.sh" ]; then
      "${PROJECT_ROOT}/scripts/generate-alert.sh" \
        "ansible-update-failed" \
        "Ansible更新が失敗しました" \
        "ログファイル: ${LOG_FILE}"
    fi
    exit_with_error 1 "Update playbook failed. Check ${LOG_FILE} for details."
  fi

  log_info "Stage 3/3: Health check (ansible-playbook)"
  log_info "Running post-deploy health check locally"
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

log_info "Precheck saved to ${PRECHECK_FILE}"
log_info "Log saved to ${LOG_FILE}"
log_info "Summary saved to ${SUMMARY_FILE}"
log_info "Health log saved to ${HEALTH_LOG_FILE}"
log_info "Health summary saved to ${HEALTH_SUMMARY_FILE}"
