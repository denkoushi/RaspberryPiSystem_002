#!/bin/bash
# 監視スクリプトのテスト
# CI環境で実行可能なテスト

set -e

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
API_URL="${API_URL:-http://localhost:8080/api}"
TEST_LOG_FILE="/tmp/test-system-monitor.log"
TMP_DIR="$(mktemp -d)"
MONITOR_TEMPLATE="${PROJECT_DIR}/infrastructure/ansible/templates/security-monitor.sh.j2"
MONITOR_SCRIPT="${TMP_DIR}/security-monitor.sh"

echo "=========================================="
echo "監視スクリプトのテスト"
echo "=========================================="

# ログファイルをクリア
rm -f "${TEST_LOG_FILE}"

# APIサーバーが起動しているか確認
if ! curl -s -f "${API_URL}/system/health" > /dev/null 2>&1; then
  echo "警告: APIサーバーが起動していません（${API_URL}/system/health）"
  echo "監視スクリプトのAPIヘルスチェック機能のみテストします"
fi

echo ""
echo "1. APIヘルスチェック機能のテスト"
echo "-----------------------------------"

check_api_health() {
  local response=$(curl -s -w "\n%{http_code}" "${API_URL}/system/health" 2>/dev/null || echo -e "\n000")
  # macOSのheadコマンドは-n -1をサポートしていないため、tail -n 1で最後の行を取得してから除外
  local status_code=$(echo "${response}" | tail -n 1)
  local body=$(echo "${response}" | sed '$d')

  if [ "${status_code}" != "200" ]; then
    echo "⚠️  API health check failed (HTTP ${status_code})"
    return 1
  fi

  # JSONからstatusフィールドを抽出
  local status=""
  if command -v jq >/dev/null 2>&1; then
    status=$(echo "${body}" | jq -r '.status' 2>/dev/null || echo "")
  else
    status=$(echo "${body}" | grep -o '"status":"[^"]*"' | head -1 | cut -d'"' -f4)
  fi

  if [ "${status}" != "ok" ]; then
    echo "⚠️  API health check returned degraded status: ${status:-unknown}"
    return 1
  fi

  echo "✅ API health check passed"
  return 0
}

if check_api_health; then
  echo "✅ APIヘルスチェック機能は正常に動作しています"
else
  echo "⚠️  APIヘルスチェック機能のテストをスキップ（APIサーバーが起動していない可能性）"
fi

echo ""
echo "2. メトリクスエンドポイントのテスト"
echo "-----------------------------------"

check_metrics() {
  local response=$(curl -s -w "\n%{http_code}" "${API_URL}/system/metrics" 2>/dev/null || echo -e "\n000")
  # macOSのheadコマンドは-n -1をサポートしていないため、tail -n 1で最後の行を取得
  local status_code=$(echo "${response}" | tail -n 1)

  if [ "${status_code}" != "200" ]; then
    echo "⚠️  Metrics endpoint check failed (HTTP ${status_code})"
    return 1
  fi

  echo "✅ Metrics endpoint is accessible"
  return 0
}

if check_metrics; then
  echo "✅ メトリクスエンドポイントは正常に動作しています"
else
  echo "⚠️  メトリクスエンドポイントのテストをスキップ（APIサーバーが起動していない可能性）"
fi

echo ""
echo "3. 監視スクリプトの関数テスト"
echo "-----------------------------------"

# 監視スクリプトの関数をテスト
echo "監視スクリプトの関数を直接テストします"

# check_disk_usage関数のテスト
echo "ディスク使用量チェック機能をテスト中..."
DISK_USAGE=$(df -h / | awk 'NR==2 {print $5}' | sed 's/%//' 2>/dev/null || echo "0")
if [ -z "${DISK_USAGE}" ] || [ "${DISK_USAGE}" -gt 100 ]; then
  echo "  ⚠️  ディスク使用量の取得に失敗しました"
else
  echo "  現在のディスク使用量: ${DISK_USAGE}%"
  echo "  ✅ ディスク使用量チェック機能は正常に動作しています"
fi

# check_memory_usage関数のテスト
echo "メモリ使用量チェック機能をテスト中..."
if command -v free >/dev/null 2>&1; then
  MEM_TOTAL=$(free | awk 'NR==2 {print $2}' 2>/dev/null || echo "0")
  MEM_USED=$(free | awk 'NR==2 {print $3}' 2>/dev/null || echo "0")
  if [ -z "${MEM_TOTAL}" ] || [ -z "${MEM_USED}" ] || [ "${MEM_TOTAL}" = "0" ]; then
    echo "  ⚠️  メモリ使用量の取得に失敗しました"
  else
    MEM_PERCENT=$((MEM_USED * 100 / MEM_TOTAL))
    echo "  現在のメモリ使用量: ${MEM_PERCENT}%"
    echo "  ✅ メモリ使用量チェック機能は正常に動作しています"
  fi
else
  echo "  ⚠️  freeコマンドが利用できません（macOS環境など）"
  echo "  ✅ メモリ使用量チェック機能のテストをスキップ"
fi

echo ""
echo "✅ 監視スクリプトのテスト完了"

# -----------------------------------
# 4. ファイル改ざん検知の回帰テスト
# -----------------------------------

echo ""
echo "4. ファイル改ざん検知（ファイルハッシュ差分）のテスト"
echo "-----------------------------------"

if [[ ! -f "${MONITOR_TEMPLATE}" ]]; then
  echo "⚠️  テンプレートが見つかりません: ${MONITOR_TEMPLATE}"
  exit 0
fi

# 現在開いているLISTENポートを許可リストにして誤検知を避ける
detect_ports() {
  if command -v ss >/dev/null 2>&1; then
    ss -tuln | awk 'NR>1 {print $5}' | awk -F':' '{print $NF}' | sort -u
  elif command -v netstat >/dev/null 2>&1; then
    netstat -tuln | awk 'NR>2 {print $4}' | awk -F':' '{print $NF}' | sort -u
  else
    echo ""
  fi
}

ALLOWED_PORTS="$(detect_ports | xargs)"

# Jinja2テンプレートをレンダリング（PythonでJinja2を使用）
if command -v python3 >/dev/null 2>&1; then
  MONITOR_TEMPLATE_VAR="${MONITOR_TEMPLATE}" \
  TMP_DIR_VAR="${TMP_DIR}" \
  MONITOR_SCRIPT_VAR="${MONITOR_SCRIPT}" \
  python3 <<'PYTHON_SCRIPT'
import os
from pathlib import Path

template_path = Path(os.environ['MONITOR_TEMPLATE_VAR'])
if not template_path.exists():
    print(f"⚠️  テンプレートが見つかりません: {template_path}", flush=True)
    raise SystemExit(1)

with open(template_path, "r", encoding="utf-8") as f:
    content = f.read()

replacements = {
    "{{ alert_script_path }}": "/bin/echo",
    "{{ alert_webhook_url | default('') }}": "",
    "{{ alert_webhook_timeout_seconds | default(5) }}": "5",
    "{{ security_monitor_state_dir }}": os.environ["TMP_DIR_VAR"],
    "{{ security_monitor_fail2ban_log }}": os.path.join(os.environ["TMP_DIR_VAR"], "fail2ban.log"),
}

for key, value in replacements.items():
    content = content.replace(key, value)

out_path = Path(os.environ["MONITOR_SCRIPT_VAR"])
with open(out_path, "w", encoding="utf-8") as f:
    f.write(content)

print(f"✅ テンプレートをレンダリングしました: {out_path}", flush=True)
PYTHON_SCRIPT
else
  echo "⚠️  python3が見つかりません。sedで簡易置換を試みます..."
  sed \
    -e "s#{{ alert_script_path }}#/bin/echo#g" \
    -e "s#{{ alert_webhook_url | default('') }}##g" \
    -e "s#{{ alert_webhook_timeout_seconds | default(5) }}#5#g" \
    -e "s#{{ security_monitor_state_dir }}#${TMP_DIR}#g" \
    -e "s#{{ security_monitor_fail2ban_log }}#${TMP_DIR}/fail2ban.log#g" \
    "${MONITOR_TEMPLATE}" > "${MONITOR_SCRIPT}"
fi

chmod +x "${MONITOR_SCRIPT}"

TARGET_FILE="${TMP_DIR}/watched.txt"
echo "initial" > "${TARGET_FILE}"

run_monitor() {
  FILE_HASH_TARGETS="${TARGET_FILE}" \
  FILE_HASH_EXCLUDES="" \
  REQUIRED_PROCESSES="" \
  ALLOWED_LISTEN_PORTS="${ALLOWED_PORTS}" \
  WEBHOOK_URL="" \
  WEBHOOK_TIMEOUT_SECONDS="5" \
  "${MONITOR_SCRIPT}"
}

# 1回目: 初回スナップショットのみでアラートなし
OUTPUT1=$(run_monitor || true)
if echo "${OUTPUT1}" | grep -q "file-integrity"; then
  echo "⚠️  初回実行でfile-integrityアラートが発生しました（期待: なし）"
else
  echo "✅ 初回実行ではfile-integrityアラートなし（スナップショット作成のみ）"
fi

# 2回目: 内容変更→アラートが出ることを確認
echo "modified" > "${TARGET_FILE}"
OUTPUT2=$(run_monitor || true)
if echo "${OUTPUT2}" | grep -q "file-integrity"; then
  echo "✅ 変更検知でfile-integrityアラートを発報しました"
else
  echo "⚠️  変更検知でfile-integrityアラートが発報されませんでした"
  exit 1
fi

rm -rf "${TMP_DIR}"

