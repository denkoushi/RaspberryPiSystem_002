#!/bin/bash
set -euo pipefail

# deploy-all: change-detector -> impact-analyzer -> deploy-executor -> verifier を順次実行する。
# デフォルトは executor/verifier が dry-run。DEPLOY_EXECUTOR_ENABLE=1 / DEPLOY_VERIFIER_ENABLE=1 で実行。
# ログ: ${DEPLOY_LOG_DIR:-logs/deploy}/deploy-<ts>.jsonl

usage() {
  cat <<'EOF'
Usage: scripts/deploy/deploy-all.sh [--dry-run] [--help]
  --dry-run  : executor/verifierを強制スキップとして扱う
Env:
  DEPLOY_EXECUTOR_ENABLE=1   実デプロイ実行
  DEPLOY_VERIFIER_ENABLE=1   実検証実行
  ROLLBACK_ON_FAIL=1         deploy失敗時にロールバックを試行
  ROLLBACK_CMD="command"     ロールバックコマンドを上書き（デフォルト: ansible-playbook rollback.yml）
  FORCE_DEPLOY_FAILURE=1     テスト用にdeploy結果を強制failedにする
  DEPLOY_LOG_DIR=<dir>       ログ出力先（デフォルト: logs/deploy）
EOF
}

TS="$(date -u +"%Y-%m-%dT%H-%M-%SZ")"

DRY_RUN=false
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    --help) usage; exit 0 ;;
    *) ;;
  esac
done

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "${repo_root}"

# --- Lockfile to prevent concurrent deploys ---
# ロックファイルはプロジェクトディレクトリ内に配置（ユーザー権限で実行可能）
LOCK_FILE="${DEPLOY_LOCK_FILE:-${repo_root}/logs/deploy/.deployment.lock}"
LOCK_TIMEOUT_SECONDS="${DEPLOY_LOCK_TIMEOUT_SECONDS:-1800}" # 30 minutes default
lock_dir="$(dirname "$LOCK_FILE")"
mkdir -p "$lock_dir"

if [[ -f "$LOCK_FILE" ]]; then
  # remove stale lock older than timeout
  if find "$LOCK_FILE" -mmin +$((LOCK_TIMEOUT_SECONDS/60)) >/dev/null 2>&1; then
    echo "警告: 古いロックファイルを削除します: $LOCK_FILE"
    rm -f "$LOCK_FILE"
  fi
fi

if [[ -f "$LOCK_FILE" ]]; then
  echo "エラー: デプロイが既に実行中です。ロックファイル: $LOCK_FILE"
  exit 1
fi

echo $$ > "$LOCK_FILE"
trap 'rm -f "$LOCK_FILE"' EXIT

log_dir="${DEPLOY_LOG_DIR:-${repo_root}/logs/deploy}"
mkdir -p "${log_dir}"
log_file="${log_dir}/deploy-${TS}.jsonl"

json_escape() {
  python3 - <<'PY' "$1"
import json, sys
print(json.dumps(sys.argv[1]))
PY
}

run_and_capture() {
  local cmd="$1"
  local out rc
  set +e
  out=$(eval "$cmd")
  rc=$?
  set -e
  if [[ $rc -ne 0 ]]; then
    echo "{\"stage\":\"error\",\"cmd\":$(json_escape "${cmd}"),\"exit_code\":${rc},\"output\":$(json_escape "${out}")}" >> "${log_file}"
    echo "コマンド失敗: ${cmd}" >&2
    echo "${out}"
    exit $rc
  fi
  echo "${out}"
}

# 1. 変更検知
changes=$(run_and_capture "scripts/deploy/change-detector.sh")
echo "{\"stage\":\"change-detector\",\"output\":$(json_escape "${changes}")}" >> "${log_file}"

# 変更なしなら早期終了
no_changes=false
impact=""
deploy_result=""
verify_result=""

if [[ "${FORCE_DEPLOY_FAILURE:-0}" != "1" ]]; then
  if echo "${changes}" | grep -q '"config_changes": \[\]'; then
    if echo "${changes}" | grep -q '"code_changes": \[\]'; then
      no_changes=true
      impact='{"impact_scope":{},"deploy_targets":[],"reason":"no changes"}'
      deploy_result='{"results":[],"overall_status":"skipped","note":"no changes"}'
      verify_result='{"verification_results":[],"overall_status":"skipped","note":"no changes"}'
      echo "{\"stage\":\"summary\",\"output\":$(json_escape "${deploy_result}")}" >> "${log_file}"
    fi
  fi
fi

if ! ${no_changes}; then
  # 2. 影響範囲判定
  impact=$(echo "${changes}" | run_and_capture "scripts/deploy/impact-analyzer.sh")
  echo "{\"stage\":\"impact-analyzer\",\"output\":$(json_escape "${impact}")}" >> "${log_file}"

  # 3. デプロイ実行
  if ${DRY_RUN}; then
    deploy_result='{"results":[],"overall_status":"skipped","note":"dry-run or disabled"}'
  else
    deploy_result=$(echo "${impact}" | run_and_capture "scripts/deploy/deploy-executor.sh")
  fi

  # テスト用: 強制失敗
  if [[ "${FORCE_DEPLOY_FAILURE:-0}" == "1" ]]; then
    deploy_result='{"results":[],"overall_status":"failed","note":"forced failure for test"}'
  fi
  echo "{\"stage\":\"deploy-executor\",\"output\":$(json_escape "${deploy_result}")}" >> "${log_file}"

  # 4. 検証（環境変数を設定してから実行）
  # group_vars/all.ymlから環境変数を読み取り、verifier.shに渡す
  verify_env=$(python3 - <<'PY' "${repo_root}"
import sys, yaml, os
repo_root = sys.argv[1]
group_vars_path = os.path.join(repo_root, "infrastructure/ansible/group_vars/all.yml")
if not os.path.isfile(group_vars_path):
    print("")
    sys.exit(0)
with open(group_vars_path, "r") as f:
    vars_data = yaml.safe_load(f) or {}
network_mode = vars_data.get("network_mode", "local")
local_net = vars_data.get("local_network", {})
tailscale_net = vars_data.get("tailscale_network", {})
current_net = tailscale_net if network_mode == "tailscale" else local_net
server_ip = current_net.get("raspberrypi5_ip", local_net.get("raspberrypi5_ip", ""))
server_base_url = f"https://{server_ip}" if server_ip else ""
kiosk_full_url = f"{server_base_url}/kiosk" if server_base_url else ""
env_vars = []
if server_ip:
    env_vars.append(f"SERVER_IP={server_ip}")
if server_base_url:
    env_vars.append(f"SERVER_BASE_URL={server_base_url}")
if kiosk_full_url:
    env_vars.append(f"KIOSK_FULL_URL={kiosk_full_url}")
# セキュリティ機能の有効/無効も設定
for key in ["ufw_enabled", "fail2ban_enabled", "clamav_server_enabled", "security_monitor_enabled", "clamav_kiosk_enabled"]:
    val = vars_data.get(key, False)
    env_vars.append(f"{key.upper()}={str(val).lower()}")
print(" ".join(env_vars))
PY
)
  if [[ -n "${verify_env}" ]]; then
    verify_result=$(eval "export ${verify_env} && echo '${deploy_result}' | scripts/deploy/verifier.sh")
    echo "{\"stage\":\"verifier\",\"output\":$(json_escape "${verify_result}")}" >> "${log_file}"
  else
    verify_result=$(echo "${deploy_result}" | run_and_capture "scripts/deploy/verifier.sh")
    echo "{\"stage\":\"verifier\",\"output\":$(json_escape "${verify_result}")}" >> "${log_file}"
  fi
fi

# 5. ロールバック（失敗時のみ）
rollback_info='{"status":"skipped","note":"not required"}'
deploy_overall=$(python3 - <<'PY' "${deploy_result}"
import sys, json
try:
    d = json.loads(sys.argv[1])
    print(d.get("overall_status",""))
except Exception:
    print("")
PY
)

if [[ "${deploy_overall}" == "failed" && "${ROLLBACK_ON_FAIL:-0}" == "1" ]]; then
  rb_cmd="${ROLLBACK_CMD:-ansible-playbook infrastructure/ansible/playbooks/rollback.yml}"
  set +e
  eval "${rb_cmd}" >/dev/null 2>&1
  rc=$?
  set -e
  if [[ $rc -eq 0 ]]; then
    rollback_info='{"status":"success","command":'"$(json_escape "${rb_cmd}")"',"exit_code":0}'
  else
    rollback_info='{"status":"failed","command":'"$(json_escape "${rb_cmd}")"',"exit_code":'"${rc}"'}'
  fi
  echo "{\"stage\":\"rollback\",\"output\":${rollback_info}}" >> "${log_file}"
fi

# 6. 集約出力
python3 - <<'PY' "${changes}" "${impact}" "${deploy_result}" "${verify_result}" "${TS}" "${rollback_info}"
import sys, json
changes, impact, deploy, verify, ts, rollback = sys.argv[1:]

def parse(text):
    try:
        return json.loads(text)
    except Exception:
        return {"raw": text}

chg = parse(changes)
imp = parse(impact)
dep = parse(deploy)
ver = parse(verify)
rb  = json.loads(rollback)

def overall(dep, ver):
    if dep.get("overall_status") == "failed":
        return "failed"
    if ver.get("overall_status") in ("failed","fail"):
        return "failed"
    if dep.get("overall_status") in ("skipped", None) and ver.get("overall_status") in ("skipped", None):
        return "skipped"
    return "success"

summary = {
    "timestamp": ts,
    "changes": chg,
    "impact": imp,
    "deploy": dep,
    "verify": ver,
    "rollback": rb,
    "overall_status": overall(dep, ver)
}
print(json.dumps(summary, ensure_ascii=False, indent=2))
PY

# Test deployment - Sat Dec  6 17:16:47 JST 2025
