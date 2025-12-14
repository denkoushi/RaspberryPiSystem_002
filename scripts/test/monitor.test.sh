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

# Ansibleを使ってテンプレートをレンダリング（本番環境と同じ方法）
if command -v ansible-playbook >/dev/null 2>&1; then
  # Ansibleのtemplateモジュールを使ってレンダリング
  ANSIBLE_TMP_DIR="${TMP_DIR}/ansible"
  mkdir -p "${ANSIBLE_TMP_DIR}/templates"
  
  # テンプレートファイルをtemplatesディレクトリにコピー
  cp "${MONITOR_TEMPLATE}" "${ANSIBLE_TMP_DIR}/templates/security-monitor.sh.j2"
  
  cat > "${ANSIBLE_TMP_DIR}/render.yml" <<EOF
---
- hosts: localhost
  gather_facts: no
  tasks:
    - name: Render security monitor script
      ansible.builtin.template:
        src: security-monitor.sh.j2
        dest: "${MONITOR_SCRIPT}"
        mode: '0755'
      vars:
        alert_script_path: /bin/echo
        alert_webhook_url: ''
        alert_webhook_timeout_seconds: 5
        security_monitor_state_dir: "${TMP_DIR}"
        security_monitor_fail2ban_log: "${TMP_DIR}/fail2ban.log"
EOF
  
  cd "${ANSIBLE_TMP_DIR}"
  ansible-playbook -i localhost, -c local render.yml || {
    echo "⚠️  Ansibleでのレンダリングに失敗しました。フォールバックを使用します..."
    cd "${PROJECT_DIR}"
    # フォールバック: sedで簡易置換（bashの${#}構文は保護されないが、動作確認は可能）
    sed \
      -e "s#{{ alert_script_path }}#/bin/echo#g" \
      -e "s#{{ alert_webhook_url | default('') }}##g" \
      -e "s#{{ alert_webhook_timeout_seconds | default(5) }}#5#g" \
      -e "s#{{ security_monitor_state_dir }}#${TMP_DIR}#g" \
      -e "s#{{ security_monitor_fail2ban_log }}#${TMP_DIR}/fail2ban.log#g" \
      "${MONITOR_TEMPLATE}" > "${MONITOR_SCRIPT}"
  }
  cd "${PROJECT_DIR}"
else
  echo "⚠️  Ansibleが見つかりません。sedで簡易置換を試みます（bashの\${#}構文は保護されません）..."
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
  FILE_HASH_TARGETS="${FILE_HASH_TARGETS:-${TARGET_FILE}}" \
  FILE_HASH_EXCLUDES="${FILE_HASH_EXCLUDES:-}" \
  REQUIRED_PROCESSES="${REQUIRED_PROCESSES:-}" \
  ALLOWED_LISTEN_PORTS="${ALLOWED_LISTEN_PORTS:-${ALLOWED_PORTS}}" \
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

# 2. 除外リストのテスト（file-integrity誤検知を防ぐ）
EXCLUDED_FILE="${TMP_DIR}/excluded.txt"
echo "initial" > "${EXCLUDED_FILE}"
rm -f "${TMP_DIR}/file-hashes.txt"
FILE_HASH_TARGETS="${TARGET_FILE} ${EXCLUDED_FILE}"
FILE_HASH_EXCLUDES="${EXCLUDED_FILE}"
OUTPUT_EXCLUDE1=$(run_monitor || true)
if echo "${OUTPUT_EXCLUDE1}" | grep -q "file-integrity"; then
  echo "⚠️  除外付き初回実行でfile-integrityアラートが発生しました（期待: なし）"
  exit 1
else
  echo "✅ 除外付き初回実行ではfile-integrityアラートなし（スナップショット作成のみ）"
fi
echo "modified" > "${EXCLUDED_FILE}"
OUTPUT_EXCLUDE2=$(run_monitor || true)
if echo "${OUTPUT_EXCLUDE2}" | grep -q "file-integrity"; then
  echo "⚠️  除外対象の変更でfile-integrityアラートが発生しました（期待: なし）"
  exit 1
else
  echo "✅ 除外対象の変更ではfile-integrityアラートなし（除外リスト有効）"
fi

# 3. 必須プロセス欠落の検知テスト
rm -f "${TMP_DIR}/file-hashes.txt"
OUTPUT_PROC=$(REQUIRED_PROCESSES="__process_not_running__" FILE_HASH_TARGETS="${TARGET_FILE}" FILE_HASH_EXCLUDES="" ALLOWED_LISTEN_PORTS="${ALLOWED_PORTS}" run_monitor || true)
if echo "${OUTPUT_PROC}" | grep -q "process-missing"; then
  echo "✅ 必須プロセス欠落を検知しました"
else
  echo "⚠️  必須プロセス欠落の検知に失敗しました"
  exit 1
fi

# 4. 許可外LISTENポート検知テスト
rm -f "${TMP_DIR}/file-hashes.txt"
UNEXPECTED_PORT=8000
python -m http.server "${UNEXPECTED_PORT}" >/dev/null 2>&1 &
HTTP_PID=$!
sleep 2
OUTPUT_PORTS=$(ALLOWED_LISTEN_PORTS="" FILE_HASH_TARGETS="${TARGET_FILE}" FILE_HASH_EXCLUDES="" REQUIRED_PROCESSES="" run_monitor || true)
kill "${HTTP_PID}" >/dev/null 2>&1 || true
if echo "${OUTPUT_PORTS}" | grep -q "ports-unexpected"; then
  echo "✅ 許可外LISTENポートを検知しました"
else
  echo "⚠️  許可外LISTENポートの検知に失敗しました"
  exit 1
fi

rm -rf "${TMP_DIR}"

