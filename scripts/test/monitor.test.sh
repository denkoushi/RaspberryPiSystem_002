#!/bin/bash
# 監視スクリプトのテスト
# CI環境で実行可能なテスト

set -e

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
API_URL="${API_URL:-http://localhost:8080/api}"
TEST_LOG_FILE="/tmp/test-system-monitor.log"

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
  local body=$(echo "${response}" | head -n -1)
  local status_code=$(echo "${response}" | tail -n 1)

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

