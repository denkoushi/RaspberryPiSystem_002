#!/usr/bin/env bash
set -euo pipefail

# 使用方法: ./scripts/update-all-clients.sh <ブランチ名> <inventoryパス>
# 例:
#   ./scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml
#   ./scripts/update-all-clients.sh main infrastructure/ansible/inventory-talkplaza.yml
#
# ⚠️ 安全のため inventory は必須（誤デプロイ防止）
# 環境変数 ANSIBLE_REPO_VERSION でも指定可能（引数より優先度低い）
# ⚠️ Tailscale主運用: network_mode=local は緊急時のみ許可
#    - localを使う場合は ALLOW_LOCAL_EMERGENCY=1 を明示すること

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLAYBOOK_PATH="infrastructure/ansible/playbooks/update-clients.yml"
HEALTH_PLAYBOOK_PATH="infrastructure/ansible/playbooks/health-check.yml"
LOG_DIR="${PROJECT_ROOT}/logs"
REMOTE_HOST_RAW="${RASPI_SERVER_HOST:-}"
SSH_OPTS=${RASPI_SERVER_SSH_OPTS:-""}
TIMESTAMP=$(date +%Y%m%d-%H%M%S)

# REMOTE_HOSTの正規化: ユーザー名が含まれていない場合、inventory.ymlから取得して自動付与
normalize_remote_host() {
  local host="${REMOTE_HOST_RAW}"
  if [[ -z "${host}" ]]; then
    echo ""
    return 0
  fi
  
  # 既にユーザー名が含まれている場合（@が含まれている）はそのまま使用
  if [[ "${host}" == *"@"* ]]; then
    echo "${host}"
    return 0
  fi
  
  # ユーザー名が含まれていない場合、inventory.ymlから取得
  if [[ -n "${INVENTORY_PATH:-}" && -f "${PROJECT_ROOT}/${INVENTORY_PATH}" ]]; then
    local ansible_user
    ansible_user=$(python3 - <<'PY' "${PROJECT_ROOT}/${INVENTORY_PATH}"
import yaml
import sys
try:
    with open(sys.argv[1], encoding='utf-8') as f:
        inv = yaml.safe_load(f)
        # serverグループのraspberrypi5ホストからansible_userを取得
        server_hosts = inv.get('all', {}).get('children', {}).get('server', {}).get('hosts', {})
        if 'raspberrypi5' in server_hosts:
            user = server_hosts['raspberrypi5'].get('ansible_user')
            if user:
                print(user)
                sys.exit(0)
except Exception:
    pass
sys.exit(1)
PY
    )
    
    if [[ -n "${ansible_user}" ]]; then
      echo "${ansible_user}@${host}"
      return 0
    fi
  fi
  
  # inventory.ymlから取得できない場合、デフォルトユーザー名を使用
  echo "denkon5sd02@${host}"
}

LOG_FILE="${LOG_DIR}/ansible-update-${TIMESTAMP}.log"
SUMMARY_FILE="${LOG_DIR}/ansible-update-${TIMESTAMP}.summary.json"
HEALTH_LOG_FILE="${LOG_DIR}/ansible-health-${TIMESTAMP}.log"
HEALTH_SUMMARY_FILE="${LOG_DIR}/ansible-health-${TIMESTAMP}.summary.json"
PREFLIGHT_LOG_FILE="${LOG_DIR}/ansible-preflight-${TIMESTAMP}.log"
HISTORY_FILE="${LOG_DIR}/ansible-history.jsonl"
REMOTE_LOCK_FILE="${REMOTE_LOCK_FILE:-/opt/RaspberryPiSystem_002/logs/.update-all-clients.lock}"
REMOTE_LOCK_TIMEOUT_SECONDS="${REMOTE_LOCK_TIMEOUT_SECONDS:-2400}"
REMOTE_DEPLOY_STATUS_FILE="${REMOTE_DEPLOY_STATUS_FILE:-/opt/RaspberryPiSystem_002/config/deploy-status.json}"
REMOTE_LOG_DIR="${REMOTE_LOG_DIR:-/opt/RaspberryPiSystem_002/logs/deploy}"

# 引数解析
LIMIT_HOSTS=""
INVENTORY_PATH=""
REPO_VERSION=""
DETACH_MODE=0
JOB_MODE=0
FOLLOW_MODE=0
FOREGROUND_MODE=0
AUTO_DETACH_MODE=0
ATTACH_RUN_ID=""
STATUS_RUN_ID=""
PRINT_PLAN=0
RUN_ID=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --limit)
      LIMIT_HOSTS="$2"
      shift 2
      ;;
    --detach)
      DETACH_MODE=1
      shift
      ;;
    --job)
      JOB_MODE=1
      shift
      ;;
    --follow)
      FOLLOW_MODE=1
      shift
      ;;
    --foreground)
      FOREGROUND_MODE=1
      shift
      ;;
    --attach)
      ATTACH_RUN_ID="$2"
      shift 2
      ;;
    --status)
      STATUS_RUN_ID="$2"
      shift 2
      ;;
    --print-plan|--dry-run)
      PRINT_PLAN=1
      shift
      ;;
    *)
      if [[ -z "${REPO_VERSION}" ]]; then
        REPO_VERSION="$1"
      elif [[ -z "${INVENTORY_PATH}" ]]; then
        INVENTORY_PATH="$1"
      fi
      shift
      ;;
  esac
done

usage() {
  cat >&2 <<'USAGE'
Usage:
  ./scripts/update-all-clients.sh <branch> <inventory_path> [--limit <host_pattern>] [--detach] [--follow]
  ./scripts/update-all-clients.sh <branch> <inventory_path> [--limit <host_pattern>] [--job] [--follow]
  ./scripts/update-all-clients.sh <branch> <inventory_path> [--limit <host_pattern>] --foreground
  ./scripts/update-all-clients.sh --attach <run_id>
  ./scripts/update-all-clients.sh --status <run_id>
  ./scripts/update-all-clients.sh <branch> <inventory_path> --print-plan

Examples:
  # 第2工場（既存）
  ./scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml

  # トークプラザ（新拠点）
  ./scripts/update-all-clients.sh main infrastructure/ansible/inventory-talkplaza.yml

  # Pi3を除外してデプロイ
  ./scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml --limit '!raspberrypi3'

  # デタッチ実行（Pi5側で継続実行）
  ./scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml --detach

  # 前景実行（長時間は非推奨）
  ./scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml --foreground

  # ジョブ実行（systemd-run）
  ./scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml --job --follow

  # デタッチ実行のログ追尾
  ./scripts/update-all-clients.sh --attach 20260125-123456-4242

  # 状態確認
  ./scripts/update-all-clients.sh --status 20260125-123456-4242
USAGE
}

# ブランチ指定の検証（--attach/--status/--print-planの場合はブランチ指定不要）
if [[ -z "${ATTACH_RUN_ID}" && -z "${STATUS_RUN_ID}" && ${PRINT_PLAN} -eq 0 ]]; then
  # 通常のデプロイ実行時はブランチ指定が必須（誤デプロイ防止のため）
  if [[ -z "${REPO_VERSION}" && -z "${ANSIBLE_REPO_VERSION}" ]]; then
    echo "[ERROR] ブランチ指定が必須です。使用方法: ./scripts/update-all-clients.sh <branch> <inventory_path>" >&2
    usage
    exit 2
  fi
fi

REPO_VERSION="${REPO_VERSION:-${ANSIBLE_REPO_VERSION:-}}"

export ANSIBLE_REPO_VERSION="${REPO_VERSION}"

mkdir -p "${LOG_DIR}"

# REMOTE_HOSTを正規化（INVENTORY_PATHが設定された後）
REMOTE_HOST=$(normalize_remote_host)

if [[ -n "${REMOTE_HOST}" && ${DETACH_MODE} -eq 0 && ${JOB_MODE} -eq 0 && ${FOREGROUND_MODE} -eq 0 ]]; then
  DETACH_MODE=1
  AUTO_DETACH_MODE=1
fi

ensure_local_repo_ready_for_deploy() {
  # Skip checks for read-only operations
  if [[ -n "${ATTACH_RUN_ID}" || -n "${STATUS_RUN_ID}" || ${PRINT_PLAN} -eq 1 ]]; then
    return 0
  fi

  # Only enforce for remote deployments (Pi5 pulls from origin/<branch>)
  if [[ -z "${REMOTE_HOST}" ]]; then
    return 0
  fi

  if ! command -v git >/dev/null 2>&1; then
    return 0
  fi
  if ! git -C "${PROJECT_ROOT}" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    return 0
  fi

  # 1) Working tree must be clean (no local-only state)
  if ! git -C "${PROJECT_ROOT}" diff --quiet \
    || ! git -C "${PROJECT_ROOT}" diff --cached --quiet \
    || [ -n "$(git -C "${PROJECT_ROOT}" ls-files --others --exclude-standard)" ]; then
    echo "[ERROR] ローカルリポジトリに未commit変更があります。デプロイはリモートブランチ由来に限定します。" >&2
    echo "        対処: commit するか stash してから再実行してください。" >&2
    exit 2
  fi

  # 2) The target branch must exist on origin and must include local commits (no ahead/diverged)
  # Fetch only the target branch ref (fast, minimal)
  if ! git -C "${PROJECT_ROOT}" fetch -q origin "${REPO_VERSION}" >/dev/null 2>&1; then
    echo "[ERROR] origin/${REPO_VERSION} を取得できません（fetch失敗）。" >&2
    echo "        対処: 先に push（ブランチ作成含む）し、CI成功後に再実行してください。" >&2
    exit 2
  fi
  if ! git -C "${PROJECT_ROOT}" rev-parse --verify --quiet "origin/${REPO_VERSION}" >/dev/null 2>&1; then
    echo "[ERROR] origin/${REPO_VERSION} が見つかりません。" >&2
    echo "        対処: 対象ブランチを push してから再実行してください。" >&2
    exit 2
  fi

  local local_ref="HEAD"
  if git -C "${PROJECT_ROOT}" show-ref --verify --quiet "refs/heads/${REPO_VERSION}"; then
    local_ref="${REPO_VERSION}"
  fi

  local counts
  counts=$(git -C "${PROJECT_ROOT}" rev-list --left-right --count "origin/${REPO_VERSION}...${local_ref}" 2>/dev/null || echo "")
  local behind=""
  local ahead=""
  if [[ -n "${counts}" ]]; then
    read -r behind ahead <<<"$(echo "${counts}" | awk '{print $1, $2}')"
  fi
  if [[ -n "${behind}" && ! "${behind}" =~ ^[0-9]+$ ]]; then
    echo "[ERROR] ブランチ差分の判定に失敗しました（behind='${behind}', counts='${counts}'）。" >&2
    echo "        対処: push/CI成功を確認後に再実行してください。" >&2
    exit 2
  fi
  if [[ -n "${ahead}" && ! "${ahead}" =~ ^[0-9]+$ ]]; then
    echo "[ERROR] ブランチ差分の判定に失敗しました（ahead='${ahead}', counts='${counts}'）。" >&2
    echo "        対処: push/CI成功を確認後に再実行してください。" >&2
    exit 2
  fi
  if [[ -n "${ahead}" && "${ahead}" != "${behind}" && "${ahead}" -gt 0 ]]; then
    echo "[ERROR] ローカル(${local_ref})に未pushコミットがあります（origin/${REPO_VERSION}よりahead）。" >&2
    echo "        対処: pushしてCI成功を確認後にデプロイしてください。" >&2
    exit 2
  fi
  if [[ -n "${ahead}" && "${ahead}" == "${behind}" && "${ahead}" -gt 0 ]]; then
    # Defensive: unexpected parse; treat as not-safe
    echo "[ERROR] ブランチ差分の判定に失敗しました（counts='${counts}'）。" >&2
    echo "        対処: push/CI成功を確認後に再実行してください。" >&2
    exit 2
  fi
}

require_remote_host() {
  if [[ -z "${REMOTE_HOST}" ]]; then
    echo "[ERROR] RASPI_SERVER_HOST is not set. Remote operations require Pi5 host." >&2
    exit 2
  fi
}

build_run_id() {
  if [[ -n "${RUN_ID}" ]]; then
    echo "${RUN_ID}"
    return 0
  fi
  echo "${TIMESTAMP}-${RANDOM}"
}

if [[ -n "${ATTACH_RUN_ID}" || -n "${STATUS_RUN_ID}" ]]; then
  require_remote_host
fi

if [[ -z "${INVENTORY_PATH}" && -z "${ATTACH_RUN_ID}" && -z "${STATUS_RUN_ID}" ]]; then
  usage
  exit 2
fi

if [[ -n "${INVENTORY_PATH}" && ! -f "${PROJECT_ROOT}/${INVENTORY_PATH}" ]]; then
  echo "[ERROR] inventory not found: ${INVENTORY_PATH}" >&2
  usage
  exit 2
fi

if [[ -n "${INVENTORY_PATH}" ]]; then
  echo "[INFO] Target inventory: ${INVENTORY_PATH}"
  echo "[INFO] Repo version: ${REPO_VERSION}"
  if [[ -n "${LIMIT_HOSTS}" ]]; then
    echo "[INFO] Limit hosts: ${LIMIT_HOSTS}"
  fi
fi
if [[ ${DETACH_MODE} -eq 1 ]]; then
  echo "[INFO] Detach mode: enabled"
fi
if [[ ${FOLLOW_MODE} -eq 1 ]]; then
  echo "[INFO] Follow mode: enabled"
fi

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

  # PLAY RECAP行からホスト名を抽出（拠点追加でraspberrypi固定にしない）
  failed_hosts=$(grep -E "failed=[1-9]" "${log_file}" | awk '{print $1}' | tr -d ':' | sort -u | tr '\n' ',' | sed 's/,$//' || echo "")
  unreachable_hosts=$(grep -E "unreachable=[1-9]" "${log_file}" | awk '{print $1}' | tr -d ':' | sort -u | tr '\n' ',' | sed 's/,$//' || echo "")
  total_hosts=$(grep -E "PLAY RECAP" -A 50 "${log_file}" | awk '/: ok=/{print $1}' | tr -d ':' | sort -u | wc -l | tr -d ' ' || echo "0")
  
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

send_alert() {
  local key="$1"
  local title="$2"
  local detail="$3"
  if [ -f "${PROJECT_ROOT}/scripts/generate-alert.sh" ]; then
    "${PROJECT_ROOT}/scripts/generate-alert.sh" "${key}" "${title}" "${detail}"
  fi
}

notify_start() {
  local host_context="${REMOTE_HOST:-local}"
  send_alert "ansible-update-started" "Ansible更新を開始しました" "対象: ${INVENTORY_PATH} / ブランチ: ${REPO_VERSION} / 実行元: ${host_context}"
}

notify_success() {
  send_alert "ansible-update-success" "Ansible更新が完了しました" "ログファイル: ${LOG_FILE}"
}

notify_failed_hosts() {
  local summary_path="$1"
  local log_path="$2"
  python3 - <<'PY' "${summary_path}" "${log_path}" "${PROJECT_ROOT}"
import json, sys, os
summary_path, log_path, project_root = sys.argv[1:]
try:
    with open(summary_path, encoding="utf-8") as fh:
        summary = json.load(fh)
except Exception:
    sys.exit(0)
hosts = set(summary.get("failedHosts", []) or []) | set(summary.get("unreachableHosts", []) or [])
if not hosts:
    sys.exit(0)
print("\n".join(sorted(hosts)))
PY
}

# デプロイ前チェック: Git権限とfail2ban Banの確認
pre_deploy_checks() {
  if [[ -z "${REMOTE_HOST}" ]]; then
    return 0
  fi
  
  local checks_failed=0

  # aptリポジトリチェック（NodeSourceのGPG署名キー問題を事前検知）
  # 2026-02-01以降、NodeSourceの署名がSHA1由来で拒否され、apt update_cacheが失敗してデプロイが中断するケースがある（KB-220）
  echo "[INFO] Checking apt repositories on ${REMOTE_HOST} (NodeSource)..."
  local nodesource_exists
  nodesource_exists=$(ssh ${SSH_OPTS} "${REMOTE_HOST}" "test -f /etc/apt/sources.list.d/nodesource.list && echo 'yes' || echo 'no'" || echo "no")
  if [[ "${nodesource_exists}" == "yes" ]]; then
    echo "[ERROR] NodeSource apt repository exists on ${REMOTE_HOST} (/etc/apt/sources.list.d/nodesource.list)." >&2
    echo "[ERROR] This can break apt cache updates due to GPG signature policy (SHA1) and will abort deployments." >&2
    echo "[ERROR] See KB-220: docs/knowledge-base/infrastructure/ansible-deployment.md" >&2
    echo "[ERROR] Fix with: ssh ${REMOTE_HOST} 'sudo rm -f /etc/apt/sources.list.d/nodesource.list && sudo apt-get update'" >&2
    checks_failed=$((checks_failed + 1))
  fi
  
  # Git権限チェック
  echo "[INFO] Checking Git directory permissions on ${REMOTE_HOST}..."
  local git_owner
  git_owner=$(ssh ${SSH_OPTS} "${REMOTE_HOST}" "ls -ld /opt/RaspberryPiSystem_002/.git 2>/dev/null | awk '{print \$3}'" || echo "")
  if [[ -n "${git_owner}" && "${git_owner}" != "denkon5sd02" ]]; then
    echo "[WARN] Git directory is owned by ${git_owner} (expected: denkon5sd02)" >&2
    echo "[WARN] This may cause permission errors during detached execution." >&2
    echo "[WARN] Fix with: ssh ${REMOTE_HOST} 'sudo chown -R denkon5sd02:denkon5sd02 /opt/RaspberryPiSystem_002/.git'" >&2
    checks_failed=$((checks_failed + 1))
  fi
  
  # fail2ban Banチェック（MacのTailscale IPを確認）
  if command -v tailscale >/dev/null 2>&1; then
    local mac_ip
    mac_ip=$(tailscale ip -4 2>/dev/null || echo "")
    if [[ -n "${mac_ip}" ]]; then
      echo "[INFO] Checking fail2ban ban status for ${mac_ip} on ${REMOTE_HOST}..."
      local banned
      banned=$(ssh ${SSH_OPTS} "${REMOTE_HOST}" "sudo fail2ban-client status sshd 2>/dev/null | grep -q '${mac_ip}' && echo 'yes' || echo 'no'" || echo "no")
      if [[ "${banned}" == "yes" ]]; then
        echo "[ERROR] Your IP ${mac_ip} is banned by fail2ban on ${REMOTE_HOST}" >&2
        echo "[ERROR] Unban with: ssh ${REMOTE_HOST} 'sudo fail2ban-client set sshd unbanip ${mac_ip}'" >&2
        echo "[ERROR] Or use RealVNC to access Pi5 desktop and unban manually." >&2
        checks_failed=$((checks_failed + 1))
      fi
    fi
  fi
  
  if [[ ${checks_failed} -gt 0 ]]; then
    echo "[ERROR] Pre-deploy checks failed. Please fix the issues above before proceeding." >&2
    return 1
  fi
  
  echo "[INFO] Pre-deploy checks passed."
  return 0
}

NETWORK_MODE=""

check_network_mode() {
  if [[ -z "${REMOTE_HOST}" ]]; then
    return 0
  fi

  echo "[INFO] Checking network_mode configuration on Pi5..."
  NETWORK_MODE=$(ssh ${SSH_OPTS} "${REMOTE_HOST}" "grep '^network_mode:' /opt/RaspberryPiSystem_002/infrastructure/ansible/group_vars/all.yml 2>/dev/null | awk '{print \$2}' | tr -d '\"'" || echo "")

  if [[ -z "${NETWORK_MODE}" ]]; then
    echo "⚠️  警告: network_modeの設定を確認できませんでした"
    echo "   手動で確認してください:"
    echo "   ssh ${REMOTE_HOST} \"cat /opt/RaspberryPiSystem_002/infrastructure/ansible/group_vars/all.yml | grep network_mode\""
    return 0
  fi

  if [[ "${NETWORK_MODE}" = "local" ]]; then
    if [[ "${ALLOW_LOCAL_EMERGENCY:-0}" != "1" ]]; then
      echo "[ERROR] network_mode='local' は緊急時のみ許可です。続行には ALLOW_LOCAL_EMERGENCY=1 を指定してください。" >&2
      exit 1
    fi
    echo "⚠️  警告: network_mode='local'（緊急時モード）で続行します"
    echo "   Tailscale主運用が標準です。復旧後は network_mode=tailscale へ戻してください。"
  elif [[ "${NETWORK_MODE}" = "tailscale" ]]; then
    echo "[INFO] network_mode='tailscale' が設定されています（標準運用）"
  else
    echo "⚠️  警告: network_modeの設定を確認できませんでした（${NETWORK_MODE}）"
    echo "   手動で確認してください:"
    echo "   ssh ${REMOTE_HOST} \"cat /opt/RaspberryPiSystem_002/infrastructure/ansible/group_vars/all.yml | grep network_mode\""
  fi
}

check_tailscale_on_pi5() {
  if [[ -z "${REMOTE_HOST}" ]]; then
    return 0
  fi
  if [[ "${NETWORK_MODE}" != "tailscale" ]]; then
    return 0
  fi

  echo "[INFO] Checking tailscaled status on Pi5..."
  if ! ssh ${SSH_OPTS} "${REMOTE_HOST}" "systemctl is-active tailscaled" >/dev/null 2>&1; then
    exit_with_error 3 "Preflight failed: tailscaled is not active on ${REMOTE_HOST}."
  fi

  local ts_json
  ts_json=$(ssh ${SSH_OPTS} "${REMOTE_HOST}" "tailscale status --json 2>/dev/null" || echo "")
  if [[ -z "${ts_json}" ]]; then
    exit_with_error 3 "Preflight failed: tailscale status --json returned empty output on ${REMOTE_HOST}."
  fi

  if ! python3 - <<'PY' "${ts_json}"
import json, sys
data = json.loads(sys.argv[1])
state = data.get("BackendState", "")
if state != "Running":
    print(state)
    sys.exit(1)
PY
  then
    exit_with_error 3 "Preflight failed: Tailscale BackendState is not Running on ${REMOTE_HOST}."
  fi
}

run_preflight_remotely() {
  local limit_hosts="${1:-}"
  local exit_code=0
  local start_time
  start_time=$(date +%s)
  echo "[INFO] Running preflight connectivity checks on ${REMOTE_HOST}"

  if ! ssh ${SSH_OPTS} "${REMOTE_HOST}" "echo ok" >/dev/null 2>&1; then
    exit_with_error 3 "Preflight failed: cannot reach ${REMOTE_HOST} via SSH."
  fi

  check_tailscale_on_pi5

  local inventory_basename
  inventory_basename=$(basename "${INVENTORY_PATH}")
  local limit_arg=""
  if [[ -n "${limit_hosts}" ]]; then
    limit_arg="--limit ${limit_hosts}"
  fi
  ssh ${SSH_OPTS} "${REMOTE_HOST}" "cd /opt/RaspberryPiSystem_002/infrastructure/ansible && ansible -i ${inventory_basename} all -m ping ${limit_arg}" \
    | tee "${PREFLIGHT_LOG_FILE}" || exit_code=$?

  local duration=$(( $(date +%s) - start_time ))
  if [[ ${exit_code} -ne 0 ]]; then
    append_history "${SUMMARY_FILE}" "${PREFLIGHT_LOG_FILE}" "${exit_code}" "preflight" "${duration}" "${REMOTE_HOST}"
    exit_with_error 3 "Preflight connectivity checks failed. Check ${PREFLIGHT_LOG_FILE} for details."
  fi
}

acquire_remote_lock() {
  if [[ -z "${REMOTE_HOST}" ]]; then
    return 0
  fi

  echo "[INFO] Acquiring remote lock on ${REMOTE_HOST} (${REMOTE_LOCK_FILE})"
  ssh ${SSH_OPTS} "${REMOTE_HOST}" "mkdir -p \"$(dirname "${REMOTE_LOCK_FILE}")\""

  if ! ssh ${SSH_OPTS} "${REMOTE_HOST}" "if [ -f \"${REMOTE_LOCK_FILE}\" ]; then if find \"${REMOTE_LOCK_FILE}\" -mmin +$((REMOTE_LOCK_TIMEOUT_SECONDS/60)) >/dev/null 2>&1; then echo \"[INFO] Removing stale lock\"; rm -f \"${REMOTE_LOCK_FILE}\"; fi; fi; if [ -f \"${REMOTE_LOCK_FILE}\" ]; then echo \"LOCKED\"; exit 2; fi; echo \"\$(hostname) \$(date -u +%Y-%m-%dT%H:%M:%SZ)\" > \"${REMOTE_LOCK_FILE}\""; then
    exit_with_error 3 "Failed to acquire remote lock on ${REMOTE_HOST}."
  fi
}

release_remote_lock() {
  if [[ -z "${REMOTE_HOST}" ]]; then
    return 0
  fi

  ssh ${SSH_OPTS} "${REMOTE_HOST}" "rm -f \"${REMOTE_LOCK_FILE}\"" >/dev/null 2>&1 || true
}

KIOSK_MAINTENANCE_ENABLED=0

# キオスク端末（Pi4等: manage_kiosk_browser=true）がデプロイ対象に含まれる場合、
# デプロイ中はユーザー操作を防ぐためメンテナンス画面を表示する。
#
# NOTE:
# - `serial: 1` によりデプロイは順次実行されるが、フラグは「デプロイ開始〜終了」までONにする。
# - `--limit` 指定時も、対象ホストにキオスク端末が含まれる場合はONにする。
should_enable_kiosk_maintenance() {
  if [[ -z "${REMOTE_HOST}" ]]; then
    return 1
  fi
  if [[ -z "${INVENTORY_PATH}" ]]; then
    return 1
  fi

  local inventory_basename
  inventory_basename=$(basename "${INVENTORY_PATH}")

  # Determine target hosts (honor --limit) and intersect with kiosk hosts
  local limit_arg=""
  if [[ -n "${LIMIT_HOSTS}" ]]; then
    limit_arg="--limit ${LIMIT_HOSTS}"
    # Fast-path: common limits that definitely include Pi4 kiosks
    case "${LIMIT_HOSTS}" in
      *raspberrypi4*|clients|server:clients|all)
        return 0
        ;;
    esac
  else
    # No --limit means full deploy (server + clients). If kiosks exist, they are included.
    return 0
  fi

  local selected_hosts
  selected_hosts=$(
    ssh ${SSH_OPTS} "${REMOTE_HOST}" "cd /opt/RaspberryPiSystem_002/infrastructure/ansible && ansible -i ${inventory_basename} 'server:clients' --list-hosts ${limit_arg} 2>/dev/null" \
      | python3 - <<'PY'
import re, sys
text = sys.stdin.read()
hosts = []
for line in text.splitlines():
    m = re.match(r'^\s+([A-Za-z0-9_.-]+)\s*$', line)
    if m:
        hosts.append(m.group(1))
print("\n".join(hosts))
PY
  )
  if [[ -z "${selected_hosts}" ]]; then
    return 1
  fi

  # Read kiosk hosts (manage_kiosk_browser=true) from inventory hostvars
  local kiosk_hosts
  kiosk_hosts=$(
    ssh ${SSH_OPTS} "${REMOTE_HOST}" "cd /opt/RaspberryPiSystem_002/infrastructure/ansible && ansible-inventory -i ${inventory_basename} --list" \
      | python3 - <<'PY'
import json, sys
data = json.load(sys.stdin)
hostvars = (data.get("_meta") or {}).get("hostvars") or {}
kiosk = [h for h, v in hostvars.items() if v.get("manage_kiosk_browser") is True]
print("\n".join(sorted(kiosk)))
PY
  )

  if [[ -z "${kiosk_hosts}" ]]; then
    return 1
  fi

  # Intersect: if any selected host is a kiosk host, enable maintenance
  python3 - <<'PY' "${selected_hosts}" "${kiosk_hosts}" || return 1
import sys
selected = set([h for h in sys.argv[1].splitlines() if h.strip()])
kiosk = set([h for h in sys.argv[2].splitlines() if h.strip()])
sys.exit(0 if (selected & kiosk) else 1)
PY
}

set_pi4_maintenance_flag() {
  if [[ -z "${REMOTE_HOST}" ]]; then
    return 0
  fi

  if should_enable_kiosk_maintenance; then
    echo "[INFO] Setting kiosk maintenance flag on ${REMOTE_HOST}"
    ssh ${SSH_OPTS} "${REMOTE_HOST}" "mkdir -p \"$(dirname "${REMOTE_DEPLOY_STATUS_FILE}")\" && echo '{\"kioskMaintenance\": true, \"scope\": \"kiosk\", \"startedAt\": \"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'\"}' > \"${REMOTE_DEPLOY_STATUS_FILE}\"" || true
    KIOSK_MAINTENANCE_ENABLED=1
  fi
}

clear_pi4_maintenance_flag() {
  if [[ -z "${REMOTE_HOST}" ]]; then
    return 0
  fi

  if [[ "${KIOSK_MAINTENANCE_ENABLED}" == "1" ]]; then
    echo "[INFO] Clearing kiosk maintenance flag on ${REMOTE_HOST}"
    ssh ${SSH_OPTS} "${REMOTE_HOST}" "rm -f \"${REMOTE_DEPLOY_STATUS_FILE}\"" >/dev/null 2>&1 || true
  fi
}

remote_run_paths() {
  local run_id="$1"
  REMOTE_RUN_ID="${run_id}"
  REMOTE_RUN_LOG="${REMOTE_LOG_DIR}/ansible-update-${REMOTE_RUN_ID}.log"
  REMOTE_RUN_STATUS="${REMOTE_LOG_DIR}/ansible-update-${REMOTE_RUN_ID}.status.json"
  REMOTE_RUN_EXIT="${REMOTE_LOG_DIR}/ansible-update-${REMOTE_RUN_ID}.exit"
  REMOTE_RUN_PID="${REMOTE_LOG_DIR}/ansible-update-${REMOTE_RUN_ID}.pid"
}

remote_status() {
  local run_id="$1"
  remote_run_paths "${run_id}"
  echo "[INFO] Remote status for ${run_id} on ${REMOTE_HOST}"
  ssh ${SSH_OPTS} "${REMOTE_HOST}" "if [ -f \"${REMOTE_RUN_STATUS}\" ]; then cat \"${REMOTE_RUN_STATUS}\"; else echo \"{\\\"error\\\":\\\"status not found\\\",\\\"runId\\\":\\\"${run_id}\\\"}\"; fi"
  local unit_name
  unit_name=$(ssh ${SSH_OPTS} "${REMOTE_HOST}" "if [ -f \"${REMOTE_RUN_STATUS}\" ]; then sed -n 's/.*\"unitName\":\"\\([^\"]*\\)\".*/\\1/p' \"${REMOTE_RUN_STATUS}\" | head -n 1; fi" || echo "")
  if [[ -n "${unit_name}" ]]; then
    echo "[INFO] Unit status: ${unit_name}"
    ssh ${SSH_OPTS} "${REMOTE_HOST}" "systemctl show -p ActiveState -p SubState -p ExecMainStatus \"${unit_name}\"" || true
  fi
  if ssh ${SSH_OPTS} "${REMOTE_HOST}" "test -f \"${REMOTE_RUN_EXIT}\""; then
    local exit_code
    exit_code=$(ssh ${SSH_OPTS} "${REMOTE_HOST}" "cat \"${REMOTE_RUN_EXIT}\"" || echo "unknown")
    echo "[INFO] Exit code: ${exit_code}"
  else
    echo "[INFO] Exit code: running"
  fi
}

remote_attach() {
  local run_id="$1"
  remote_run_paths "${run_id}"
  echo "[INFO] Attaching to ${run_id} on ${REMOTE_HOST}"
  if ! ssh ${SSH_OPTS} "${REMOTE_HOST}" "test -f \"${REMOTE_RUN_LOG}\""; then
    echo "[ERROR] Remote log not found: ${REMOTE_RUN_LOG}"
    exit 2
  fi
  local unit_name
  unit_name=$(ssh ${SSH_OPTS} "${REMOTE_HOST}" "if [ -f \"${REMOTE_RUN_STATUS}\" ]; then sed -n 's/.*\"unitName\":\"\\([^\"]*\\)\".*/\\1/p' \"${REMOTE_RUN_STATUS}\" | head -n 1; fi" || echo "")
  if [[ -n "${unit_name}" ]] && ssh ${SSH_OPTS} "${REMOTE_HOST}" "command -v journalctl >/dev/null 2>&1"; then
    ssh ${SSH_OPTS} "${REMOTE_HOST}" "journalctl -u \"${unit_name}\" -f" &
  else
    ssh ${SSH_OPTS} "${REMOTE_HOST}" "tail -f \"${REMOTE_RUN_LOG}\"" &
  fi
  local tail_pid=$!
  while ! ssh ${SSH_OPTS} "${REMOTE_HOST}" "test -f \"${REMOTE_RUN_EXIT}\""; do
    sleep 5
  done
  kill "${tail_pid}" >/dev/null 2>&1 || true
  local exit_code
  exit_code=$(ssh ${SSH_OPTS} "${REMOTE_HOST}" "cat \"${REMOTE_RUN_EXIT}\"" || echo "unknown")
  echo "[INFO] Remote run finished with exit code: ${exit_code}"
}

if [[ -n "${STATUS_RUN_ID}" ]]; then
  remote_status "${STATUS_RUN_ID}"
  exit 0
fi

if [[ -n "${ATTACH_RUN_ID}" ]]; then
  remote_attach "${ATTACH_RUN_ID}"
  exit 0
fi

print_plan() {
  local inventory_basename
  local playbook_basename
  local playbook_relative
  local limit_arg=""
  inventory_basename=$(basename "${INVENTORY_PATH}")
  playbook_basename=$(basename "${PLAYBOOK_PATH}")
  playbook_relative="playbooks/${playbook_basename}"
  if [[ -n "${LIMIT_HOSTS}" ]]; then
    limit_arg="--limit ${LIMIT_HOSTS}"
  fi
  if [[ -n "${REMOTE_HOST}" ]]; then
    local planned_run_id
    planned_run_id=$(build_run_id)
    remote_run_paths "${planned_run_id}"
    echo "[PLAN] Mode: remote"
    echo "[PLAN] Host: ${REMOTE_HOST}"
    echo "[PLAN] Run ID: ${planned_run_id}"
    echo "[PLAN] Command: ansible-playbook -i ${inventory_basename} ${playbook_relative} ${limit_arg}"
    if [[ ${DETACH_MODE} -eq 1 ]]; then
      if [[ ${AUTO_DETACH_MODE} -eq 1 ]]; then
        echo "[PLAN] Detach: enabled (auto)"
      else
        echo "[PLAN] Detach: enabled"
      fi
      echo "[PLAN] Remote log: ${REMOTE_RUN_LOG}"
      echo "[PLAN] Remote status: ${REMOTE_RUN_STATUS}"
      echo "[PLAN] Remote exit: ${REMOTE_RUN_EXIT}"
      echo "[PLAN] Remote pid: ${REMOTE_RUN_PID}"
    fi
    if [[ ${JOB_MODE} -eq 1 ]]; then
      echo "[PLAN] Job: enabled (systemd-run)"
      echo "[PLAN] Remote log: ${REMOTE_RUN_LOG}"
      echo "[PLAN] Remote status: ${REMOTE_RUN_STATUS}"
      echo "[PLAN] Remote exit: ${REMOTE_RUN_EXIT}"
      echo "[PLAN] Remote pid: ${REMOTE_RUN_PID}"
    fi
  else
    echo "[PLAN] Mode: local"
    echo "[PLAN] Command: ansible-playbook -i ${INVENTORY_PATH} ${PLAYBOOK_PATH}"
  fi
}
if [[ ${PRINT_PLAN} -eq 1 ]]; then
  print_plan
  exit 0
fi

if [[ ${DETACH_MODE} -eq 1 && ${JOB_MODE} -eq 1 ]]; then
  echo "[ERROR] --detach and --job are mutually exclusive." >&2
  exit 2
fi

if [[ ${DETACH_MODE} -eq 1 && -z "${REMOTE_HOST}" ]]; then
  echo "[ERROR] --detach requires RASPI_SERVER_HOST (remote Pi5)." >&2
  exit 2
fi

if [[ ${JOB_MODE} -eq 1 && -z "${REMOTE_HOST}" ]]; then
  echo "[ERROR] --job requires RASPI_SERVER_HOST (remote Pi5)." >&2
  exit 2
fi

if [[ ${AUTO_DETACH_MODE} -eq 1 ]]; then
  echo "[INFO] Remote execution defaults to detach mode. Use --foreground to run in the foreground."
fi


write_remote_runner_script() {
  local run_id="$1"
  remote_run_paths "${run_id}"

  ssh ${SSH_OPTS} "${REMOTE_HOST}" "cat > /tmp/ansible-update-${run_id}.sh" <<'REMOTE_SCRIPT'
#!/usr/bin/env bash
set -euo pipefail

RUN_ID="${RUN_ID}"
REMOTE_LOG_DIR="${REMOTE_LOG_DIR}"
REMOTE_RUN_LOG="${REMOTE_RUN_LOG}"
REMOTE_RUN_STATUS="${REMOTE_RUN_STATUS}"
REMOTE_RUN_EXIT="${REMOTE_RUN_EXIT}"
REMOTE_RUN_PID="${REMOTE_RUN_PID}"
REMOTE_LOCK_FILE="${REMOTE_LOCK_FILE}"
REMOTE_DEPLOY_STATUS_FILE="${REMOTE_DEPLOY_STATUS_FILE}"
REPO_VERSION="${REPO_VERSION}"
INVENTORY_BASENAME="${INVENTORY_BASENAME}"
PLAYBOOK_RELATIVE="${PLAYBOOK_RELATIVE}"
LIMIT_HOSTS="${LIMIT_HOSTS}"
UNIT_NAME="${UNIT_NAME}"
RUNNER="${RUNNER}"

mkdir -p "${REMOTE_LOG_DIR}"
cd /opt/RaspberryPiSystem_002/infrastructure/ansible
export ANSIBLE_ROLES_PATH=/opt/RaspberryPiSystem_002/infrastructure/ansible/roles
export ANSIBLE_REPO_VERSION="${REPO_VERSION}"
if [ -d /opt/RaspberryPiSystem_002/.git ]; then
  if ! git -C /opt/RaspberryPiSystem_002 diff --quiet \
    || ! git -C /opt/RaspberryPiSystem_002 diff --cached --quiet \
    || [ -n "$(git -C /opt/RaspberryPiSystem_002 ls-files --others --exclude-standard)" ]; then
    git -C /opt/RaspberryPiSystem_002 stash push -u -m "Auto-stash before ansible update $(date +%Y%m%d_%H%M%S)" || true
  fi
  git -C /opt/RaspberryPiSystem_002 fetch origin
  git -C /opt/RaspberryPiSystem_002 checkout "${REPO_VERSION}"
  git -C /opt/RaspberryPiSystem_002 pull --ff-only origin "${REPO_VERSION}"
fi

MAINTENANCE_FLAG_SET=0

should_enable_kiosk_maintenance() {
  local limit_arg=""
  if [ -n "${LIMIT_HOSTS}" ]; then
    limit_arg="--limit ${LIMIT_HOSTS}"
    # Fast-path: common limits that definitely include Pi4 kiosks
    case "${LIMIT_HOSTS}" in
      *raspberrypi4*|clients|server:clients|all)
        return 0
        ;;
    esac
  else
    # No --limit means full deploy (server + clients). If kiosks exist, they are included.
    return 0
  fi

  local selected_hosts
  selected_hosts=$(
    ansible -i "${INVENTORY_BASENAME}" 'server:clients' --list-hosts ${limit_arg} 2>/dev/null \
      | python3 - <<'PY'
import re, sys
text = sys.stdin.read()
hosts = []
for line in text.splitlines():
    m = re.match(r'^\s+([A-Za-z0-9_.-]+)\s*$', line)
    if m:
        hosts.append(m.group(1))
print("\n".join(hosts))
PY
  )
  if [ -z "${selected_hosts}" ]; then
    return 1
  fi

  local kiosk_hosts
  kiosk_hosts=$(
    ansible-inventory -i "${INVENTORY_BASENAME}" --list \
      | python3 - <<'PY'
import json, sys
data = json.load(sys.stdin)
hostvars = (data.get("_meta") or {}).get("hostvars") or {}
kiosk = [h for h, v in hostvars.items() if v.get("manage_kiosk_browser") is True]
print("\n".join(sorted(kiosk)))
PY
  )
  if [ -z "${kiosk_hosts}" ]; then
    return 1
  fi

  python3 - <<'PY' "${selected_hosts}" "${kiosk_hosts}"
import sys
selected = set([h for h in sys.argv[1].splitlines() if h.strip()])
kiosk = set([h for h in sys.argv[2].splitlines() if h.strip()])
sys.exit(0 if (selected & kiosk) else 1)
PY
}

set_kiosk_maintenance_flag() {
  if should_enable_kiosk_maintenance; then
    echo "[INFO] Setting kiosk maintenance flag (${REMOTE_DEPLOY_STATUS_FILE})"
    mkdir -p "$(dirname "${REMOTE_DEPLOY_STATUS_FILE}")" || true
    echo "{\"kioskMaintenance\": true, \"scope\": \"kiosk\", \"startedAt\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" > "${REMOTE_DEPLOY_STATUS_FILE}" || true
    MAINTENANCE_FLAG_SET=1
  fi
}

clear_kiosk_maintenance_flag() {
  if [ "${MAINTENANCE_FLAG_SET}" = "1" ]; then
    echo "[INFO] Clearing kiosk maintenance flag (${REMOTE_DEPLOY_STATUS_FILE})"
    rm -f "${REMOTE_DEPLOY_STATUS_FILE}" >/dev/null 2>&1 || true
  fi
}

write_status() {
  local state="$1"
  local exit_code="${2:-}"
  python3 - <<'PY' "${REMOTE_RUN_STATUS}" "${RUN_ID}" "${REPO_VERSION}" "${INVENTORY_BASENAME}" "${LIMIT_HOSTS}" "${state}" "${exit_code}" "${UNIT_NAME}" "${RUNNER}"
import json, sys, time
path, run_id, repo_version, inventory, limit_hosts, state, exit_code, unit_name, runner = sys.argv[1:]
data = {
    "runId": run_id,
    "branch": repo_version,
    "inventory": inventory,
    "limitHosts": limit_hosts,
    "state": state,
    "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
}
if state == "running":
    data["startedAt"] = data["updatedAt"]
if state in ("success", "failed"):
    data["endedAt"] = data["updatedAt"]
    data["exitCode"] = exit_code
if unit_name:
    data["unitName"] = unit_name
if runner:
    data["runner"] = runner
with open(path, "w", encoding="utf-8") as fh:
    json.dump(data, fh, ensure_ascii=False)
PY
}

send_alert() {
  local key="$1"
  local title="$2"
  local detail="$3"
  if [ -f "/opt/RaspberryPiSystem_002/scripts/generate-alert.sh" ]; then
    /opt/RaspberryPiSystem_002/scripts/generate-alert.sh "${key}" "${title}" "${detail}"
  fi
}

generate_summary() {
  local log_file="$1"
  local summary_file="$2"
  python3 - <<'PY' "${log_file}" "${summary_file}"
import json, re, sys
log_path, summary_path = sys.argv[1:]
with open(log_path, encoding="utf-8", errors="ignore") as fh:
    text = fh.read()
failed_hosts = set(re.findall(r"^([\\w\\-]+): ok=\\d+ .* failed=[1-9]", text, re.M))
unreachable_hosts = set(re.findall(r"^([\\w\\-]+): ok=\\d+ .* unreachable=[1-9]", text, re.M))
all_hosts = set(re.findall(r"^([\\w\\-]+): ok=\\d+", text, re.M))
summary = {
    "timestamp": "${TIMESTAMP}",
    "logFile": log_path,
    "totalHosts": len(all_hosts),
    "failedHosts": sorted(failed_hosts),
    "unreachableHosts": sorted(unreachable_hosts),
    "success": len(failed_hosts) == 0 and len(unreachable_hosts) == 0,
}
with open(summary_path, "w", encoding="utf-8") as fh:
    json.dump(summary, fh, ensure_ascii=False)
PY
}

get_retry_hosts_if_unreachable_only() {
  local summary_path="$1"
  python3 - <<'PY' "${summary_path}"
import json, sys
summary_path = sys.argv[1]
with open(summary_path, encoding="utf-8") as fh:
    summary = json.load(fh)
failed = summary.get("failedHosts", []) or []
unreachable = summary.get("unreachableHosts", []) or []
if failed or not unreachable:
    print("")
    sys.exit(0)
print(",".join(unreachable))
PY
}

cleanup() {
  local exit_code=$?
  echo "${exit_code}" > "${REMOTE_RUN_EXIT}" || true
  clear_kiosk_maintenance_flag
  rm -f "${REMOTE_LOCK_FILE}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

set_kiosk_maintenance_flag
write_status running
echo "[INFO] Detach run started: ${RUN_ID}"
echo "[INFO] Log: ${REMOTE_RUN_LOG}"

summary_file="${REMOTE_LOG_DIR}/ansible-update-${RUN_ID}.summary.json"
attempt=1
max_attempts=3
while [ ${attempt} -le ${max_attempts} ]; do
  echo "[INFO] Running ansible-playbook (attempt ${attempt}/${max_attempts})"
  if [ -n "${LIMIT_HOSTS}" ]; then
    ansible-playbook -i "${INVENTORY_BASENAME}" "${PLAYBOOK_RELATIVE}" --limit "${LIMIT_HOSTS}" || true
  else
    ansible-playbook -i "${INVENTORY_BASENAME}" "${PLAYBOOK_RELATIVE}" || true
  fi
  generate_summary "${REMOTE_RUN_LOG}" "${summary_file}"
  retry_hosts=$(get_retry_hosts_if_unreachable_only "${summary_file}")
  if [ -z "${retry_hosts}" ]; then
    break
  fi
  LIMIT_HOSTS="${retry_hosts}"
  attempt=$((attempt + 1))
  sleep 30
done

exit_code=0
echo "[INFO] Summary file: ${summary_file}"
summary_check=0
summary_check_output=$(python3 - "${summary_file}" <<'PY' 2>&1 || summary_check=$?
import json, sys
with open(sys.argv[1], encoding=\"utf-8\") as fh:
    summary = json.load(fh)
sys.exit(0 if summary.get(\"success\") is True else 1)
PY
)
if [ "${summary_check}" -eq 0 ]; then
  exit_code=0
  echo "[INFO] Summary success check: true"
  write_status success "${exit_code}"
  send_alert "ansible-update-success" "Ansible更新が完了しました" "ログファイル: ${REMOTE_RUN_LOG}"
else
  exit_code=1
  echo "[INFO] Summary success check: false"
  if [ -n "${summary_check_output}" ]; then
    echo "[INFO] Summary check error output: ${summary_check_output}"
  fi
  write_status failed "${exit_code}"
  send_alert "ansible-update-failed" "Ansible更新が失敗しました" "ログファイル: ${REMOTE_RUN_LOG}"
fi
exit ${exit_code}
REMOTE_SCRIPT
}

start_remote_detached() {
  local run_id="$1"
  local inventory_basename
  local playbook_basename
  local playbook_relative
  local limit_arg=""
  inventory_basename=$(basename "${INVENTORY_PATH}")
  playbook_basename=$(basename "${PLAYBOOK_PATH}")
  playbook_relative="playbooks/${playbook_basename}"
  if [[ -n "${LIMIT_HOSTS}" ]]; then
    limit_arg="--limit ${LIMIT_HOSTS}"
  fi
  local INVENTORY_BASENAME="${inventory_basename}"
  local PLAYBOOK_RELATIVE="${playbook_relative}"
  local UNIT_NAME=""
  local RUNNER="nohup"

  write_remote_runner_script "${run_id}"
  ssh ${SSH_OPTS} "${REMOTE_HOST}" "chmod +x /tmp/ansible-update-${run_id}.sh"
  ssh ${SSH_OPTS} "${REMOTE_HOST}" "RUN_ID=\"${run_id}\" REMOTE_LOG_DIR=\"${REMOTE_LOG_DIR}\" REMOTE_RUN_LOG=\"${REMOTE_RUN_LOG}\" REMOTE_RUN_STATUS=\"${REMOTE_RUN_STATUS}\" REMOTE_RUN_EXIT=\"${REMOTE_RUN_EXIT}\" REMOTE_RUN_PID=\"${REMOTE_RUN_PID}\" REMOTE_LOCK_FILE=\"${REMOTE_LOCK_FILE}\" REMOTE_DEPLOY_STATUS_FILE=\"${REMOTE_DEPLOY_STATUS_FILE}\" REPO_VERSION=\"${REPO_VERSION}\" INVENTORY_BASENAME=\"${INVENTORY_BASENAME}\" PLAYBOOK_RELATIVE=\"${PLAYBOOK_RELATIVE}\" LIMIT_HOSTS=\"${LIMIT_HOSTS}\" UNIT_NAME=\"${UNIT_NAME}\" RUNNER=\"${RUNNER}\" nohup /tmp/ansible-update-${run_id}.sh >> \"${REMOTE_RUN_LOG}\" 2>&1 & echo \$! > \"${REMOTE_RUN_PID}\""
  echo "[INFO] Detach run started: ${run_id}"
  echo "[INFO] Remote log: ${REMOTE_RUN_LOG}"
  echo "[INFO] Remote status: ${REMOTE_RUN_STATUS}"
  echo "[INFO] Remote exit: ${REMOTE_RUN_EXIT}"
  echo "[INFO] Remote pid: ${REMOTE_RUN_PID}"
  if [[ ${FOLLOW_MODE} -eq 1 ]]; then
    remote_attach "${run_id}"
  fi
}

start_remote_job() {
  local run_id="$1"
  local inventory_basename
  local playbook_basename
  local playbook_relative
  local limit_arg=""
  inventory_basename=$(basename "${INVENTORY_PATH}")
  playbook_basename=$(basename "${PLAYBOOK_PATH}")
  playbook_relative="playbooks/${playbook_basename}"
  if [[ -n "${LIMIT_HOSTS}" ]]; then
    limit_arg="--limit ${LIMIT_HOSTS}"
  fi
  local INVENTORY_BASENAME="${inventory_basename}"
  local PLAYBOOK_RELATIVE="${playbook_relative}"
  local UNIT_NAME="ansible-update-${run_id}"
  local RUNNER="systemd-run"

  write_remote_runner_script "${run_id}"
  ssh ${SSH_OPTS} "${REMOTE_HOST}" "chmod +x /tmp/ansible-update-${run_id}.sh"
  ssh ${SSH_OPTS} "${REMOTE_HOST}" "RUN_ID=\"${run_id}\" REMOTE_LOG_DIR=\"${REMOTE_LOG_DIR}\" REMOTE_RUN_LOG=\"${REMOTE_RUN_LOG}\" REMOTE_RUN_STATUS=\"${REMOTE_RUN_STATUS}\" REMOTE_RUN_EXIT=\"${REMOTE_RUN_EXIT}\" REMOTE_RUN_PID=\"${REMOTE_RUN_PID}\" REMOTE_LOCK_FILE=\"${REMOTE_LOCK_FILE}\" REMOTE_DEPLOY_STATUS_FILE=\"${REMOTE_DEPLOY_STATUS_FILE}\" REPO_VERSION=\"${REPO_VERSION}\" INVENTORY_BASENAME=\"${INVENTORY_BASENAME}\" PLAYBOOK_RELATIVE=\"${PLAYBOOK_RELATIVE}\" LIMIT_HOSTS=\"${LIMIT_HOSTS}\" UNIT_NAME=\"${UNIT_NAME}\" RUNNER=\"${RUNNER}\" systemd-run --unit=\"${UNIT_NAME}\" --collect --property=WorkingDirectory=/opt/RaspberryPiSystem_002/infrastructure/ansible --property=StandardOutput=append:${REMOTE_RUN_LOG} --property=StandardError=append:${REMOTE_RUN_LOG} /bin/bash /tmp/ansible-update-${run_id}.sh >/dev/null 2>&1 && systemctl show -p MainPID --value \"${UNIT_NAME}\" > \"${REMOTE_RUN_PID}\""
  echo "[INFO] Job run started: ${run_id}"
  echo "[INFO] Unit: ${UNIT_NAME}"
  echo "[INFO] Remote log: ${REMOTE_RUN_LOG}"
  echo "[INFO] Remote status: ${REMOTE_RUN_STATUS}"
  echo "[INFO] Remote exit: ${REMOTE_RUN_EXIT}"
  echo "[INFO] Remote pid: ${REMOTE_RUN_PID}"
  if [[ ${FOLLOW_MODE} -eq 1 ]]; then
    remote_attach "${run_id}"
  fi
}

run_locally() {
  cd "${PROJECT_ROOT}"
  local exit_code=0
  local start_time
  start_time=$(date +%s)
  ANSIBLE_ROLES_PATH="${PROJECT_ROOT}/infrastructure/ansible/roles" ANSIBLE_REPO_VERSION="${REPO_VERSION}" ansible-playbook -i "${INVENTORY_PATH}" "${PLAYBOOK_PATH}" | tee "${LOG_FILE}" || exit_code=$?
  local duration=$(( $(date +%s) - start_time ))
  generate_summary "${LOG_FILE}" "${SUMMARY_FILE}"
  append_history "${SUMMARY_FILE}" "${LOG_FILE}" "${exit_code}" "update" "${duration}" "local"
  return ${exit_code}
}

run_remotely() {
  local limit_hosts="${1:-}"
  local log_file="${RUN_LOG_FILE:-${LOG_FILE}}"
  local summary_file="${RUN_SUMMARY_FILE:-${SUMMARY_FILE}}"
  local exit_code=0
  local start_time
  start_time=$(date +%s)
  # Pi5上でcdした後は相対パスを使用
  # inventory.yml -> inventory.yml (infrastructure/ansible/からの相対パス)
  # playbooks/update-clients.yml -> playbooks/update-clients.yml
  local inventory_basename=$(basename "${INVENTORY_PATH}")
  local playbook_basename=$(basename "${PLAYBOOK_PATH}")
  local playbook_relative="playbooks/${playbook_basename}"
  local limit_arg=""
  if [[ -n "${limit_hosts}" ]]; then
    limit_arg="--limit ${limit_hosts}"
  fi
  ssh ${SSH_OPTS} "${REMOTE_HOST}" "cd /opt/RaspberryPiSystem_002/infrastructure/ansible && ANSIBLE_ROLES_PATH=/opt/RaspberryPiSystem_002/infrastructure/ansible/roles ANSIBLE_REPO_VERSION=${REPO_VERSION} ansible-playbook -i ${inventory_basename} ${playbook_relative} ${limit_arg}" | tee "${log_file}" || exit_code=$?
  local duration=$(( $(date +%s) - start_time ))
  generate_summary "${log_file}" "${summary_file}"
  append_history "${summary_file}" "${log_file}" "${exit_code}" "update" "${duration}" "${REMOTE_HOST}"
  return ${exit_code}
}

get_retry_hosts_if_unreachable_only() {
  local summary_path="$1"
  python3 - <<'PY' "${summary_path}"
import json, sys
summary_path = sys.argv[1]
try:
    with open(summary_path, encoding="utf-8") as fh:
        summary = json.load(fh)
except Exception:
    print("")
    sys.exit(0)

failed = summary.get("failedHosts", []) or []
unreachable = summary.get("unreachableHosts", []) or []
if failed or not unreachable:
    print("")
    sys.exit(0)
print(",".join(unreachable))
PY
}

retry_unreachable_hosts() {
  local retry_hosts="$1"
  local attempt=1
  local max_attempts=3

  while [[ ${attempt} -le ${max_attempts} ]]; do
    echo "[INFO] Retrying unreachable hosts (attempt ${attempt}/${max_attempts}): ${retry_hosts}"
    sleep 30

    RUN_LOG_FILE="${LOG_DIR}/ansible-update-${TIMESTAMP}-retry-${attempt}.log" \
    RUN_SUMMARY_FILE="${LOG_DIR}/ansible-update-${TIMESTAMP}-retry-${attempt}.summary.json" \
      run_remotely "${retry_hosts}" || true

    local next_retry_hosts
    next_retry_hosts=$(get_retry_hosts_if_unreachable_only "${RUN_SUMMARY_FILE}")
    if [[ -z "${next_retry_hosts}" ]]; then
      # Either success or non-retriable failure
      LOG_FILE="${RUN_LOG_FILE}"
      SUMMARY_FILE="${RUN_SUMMARY_FILE}"
      if python3 - <<'PY' "${SUMMARY_FILE}" >/dev/null 2>&1
import json, sys
with open(sys.argv[1], encoding="utf-8") as fh:
    summary = json.load(fh)
sys.exit(0 if summary.get("success") is True else 1)
PY
      then
        return 0
      fi
      return 1
    fi

    retry_hosts="${next_retry_hosts}"
    attempt=$((attempt + 1))
  done

  LOG_FILE="${RUN_LOG_FILE}"
  SUMMARY_FILE="${RUN_SUMMARY_FILE}"
  return 1
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
  # Pi5上でcdした後は相対パスを使用
  local inventory_basename=$(basename "${INVENTORY_PATH}")
  local health_playbook_basename=$(basename "${HEALTH_PLAYBOOK_PATH}")
  local health_playbook_relative="playbooks/${health_playbook_basename}"
  ssh ${SSH_OPTS} "${REMOTE_HOST}" "cd /opt/RaspberryPiSystem_002/infrastructure/ansible && ANSIBLE_ROLES_PATH=/opt/RaspberryPiSystem_002/infrastructure/ansible/roles ansible-playbook -i ${inventory_basename} ${health_playbook_relative}" | tee "${HEALTH_LOG_FILE}" || exit_code=$?
  local duration=$(( $(date +%s) - start_time ))
  generate_summary "${HEALTH_LOG_FILE}" "${HEALTH_SUMMARY_FILE}"
  append_history "${HEALTH_SUMMARY_FILE}" "${HEALTH_LOG_FILE}" "${exit_code}" "health-check" "${duration}" "${REMOTE_HOST}"
  return ${exit_code}
}

# メイン処理
if [[ -n "${REMOTE_HOST}" ]]; then
  echo "[INFO] Executing update playbook on ${REMOTE_HOST}"
  echo "[INFO] Branch: ${REPO_VERSION}"
  echo "[INFO] This will update both server (Raspberry Pi 5) and clients (Raspberry Pi 3/4)"
  ensure_local_repo_ready_for_deploy
  pre_deploy_checks || exit_with_error 3 "Pre-deploy checks failed. Please fix the issues above."
  notify_start
  check_network_mode
  acquire_remote_lock
  if [[ ${DETACH_MODE} -eq 0 && ${JOB_MODE} -eq 0 ]]; then
    trap 'release_remote_lock; clear_pi4_maintenance_flag' EXIT
  fi
  set_pi4_maintenance_flag
  run_preflight_remotely "${LIMIT_HOSTS}"
  if [[ ${JOB_MODE} -eq 1 ]]; then
    RUN_ID="$(build_run_id)"
    start_remote_job "${RUN_ID}"
    exit 0
  fi
  if [[ ${DETACH_MODE} -eq 1 ]]; then
    RUN_ID="$(build_run_id)"
    start_remote_detached "${RUN_ID}"
    exit 0
  fi
  if ! run_remotely "${LIMIT_HOSTS}"; then
    retry_hosts=$(get_retry_hosts_if_unreachable_only "${SUMMARY_FILE}")
    if [[ -n "${retry_hosts}" ]]; then
      if ! retry_unreachable_hosts "${retry_hosts}"; then
        send_alert "ansible-update-failed" "Ansible更新が失敗しました（再試行後も到達不可）" "ログファイル: ${LOG_FILE}"
        notify_failed_hosts "${SUMMARY_FILE}" "${LOG_FILE}" | while read -r host; do
          [ -z "${host}" ] && continue
          send_alert "ansible-update-host-failed" "ホスト更新に失敗しました: ${host}" "ログファイル: ${LOG_FILE}"
        done
        exit_with_error 1 "Update playbook failed after retries. Check ${LOG_FILE} for details."
      fi
    else
      send_alert "ansible-update-failed" "Ansible更新が失敗しました" "ログファイル: ${LOG_FILE}"
      notify_failed_hosts "${SUMMARY_FILE}" "${LOG_FILE}" | while read -r host; do
        [ -z "${host}" ] && continue
        send_alert "ansible-update-host-failed" "ホスト更新に失敗しました: ${host}" "ログファイル: ${LOG_FILE}"
      done
      exit_with_error 1 "Update playbook failed. Check ${LOG_FILE} for details."
    fi
  fi

  echo "[INFO] Running post-deploy health check on ${REMOTE_HOST}"
  if ! run_health_check_remotely; then
    send_alert "ansible-health-check-failed" "Ansibleヘルスチェックが失敗しました" "ログファイル: ${HEALTH_LOG_FILE}"
    exit_with_error 2 "Post-deploy health check failed. Check ${HEALTH_LOG_FILE} for details."
  fi
  notify_success
else
  echo "[INFO] Executing update playbook locally"
  echo "[INFO] Branch: ${REPO_VERSION}"
  echo "[INFO] This will update both server (Raspberry Pi 5) and clients (Raspberry Pi 3/4)"
  notify_start
  if ! run_locally; then
    send_alert "ansible-update-failed" "Ansible更新が失敗しました" "ログファイル: ${LOG_FILE}"
    notify_failed_hosts "${SUMMARY_FILE}" "${LOG_FILE}" | while read -r host; do
      [ -z "${host}" ] && continue
      send_alert "ansible-update-host-failed" "ホスト更新に失敗しました: ${host}" "ログファイル: ${LOG_FILE}"
    done
    exit_with_error 1 "Update playbook failed. Check ${LOG_FILE} for details."
  fi

  echo "[INFO] Running post-deploy health check locally"
  if ! run_health_check_locally; then
    send_alert "ansible-health-check-failed" "Ansibleヘルスチェックが失敗しました" "ログファイル: ${HEALTH_LOG_FILE}"
    exit_with_error 2 "Post-deploy health check failed. Check ${HEALTH_LOG_FILE} for details."
  fi
  notify_success
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
