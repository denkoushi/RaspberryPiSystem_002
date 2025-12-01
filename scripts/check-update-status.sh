#!/usr/bin/env bash
set -euo pipefail

# 更新ステータス確認スクリプト
# 使用方法: ./scripts/check-update-status.sh [ログファイル名]

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="${PROJECT_ROOT}/logs"

# 最新のログファイルを取得
if [ $# -eq 0 ]; then
  LATEST_LOG=$(ls -t "${LOG_DIR}"/ansible-update-*.log 2>/dev/null | head -1)
  if [ -z "${LATEST_LOG}" ]; then
    echo "[ERROR] No log files found in ${LOG_DIR}"
    exit 1
  fi
else
  LATEST_LOG="${LOG_DIR}/$1"
  if [ ! -f "${LATEST_LOG}" ]; then
    echo "[ERROR] Log file not found: ${LATEST_LOG}"
    exit 1
  fi
fi

# 対応するサマリーファイルを取得
SUMMARY_FILE="${LATEST_LOG%.log}.summary.json"

echo "[INFO] Checking update status from: $(basename "${LATEST_LOG}")"
echo ""

# サマリーファイルが存在する場合は表示
if [ -f "${SUMMARY_FILE}" ]; then
  echo "=== Deployment Summary ==="
  if command -v jq >/dev/null 2>&1; then
    jq '.' "${SUMMARY_FILE}"
  else
    cat "${SUMMARY_FILE}"
  fi
  echo ""
fi

# PLAY RECAPを抽出して表示
echo "=== Play Recap ==="
grep -A 20 "PLAY RECAP" "${LATEST_LOG}" || echo "No PLAY RECAP found"

# エラーがある場合は詳細を表示
if grep -q "failed=[1-9]" "${LATEST_LOG}" || grep -q "unreachable=[1-9]" "${LATEST_LOG}"; then
  echo ""
  echo "=== Error Details ==="
  grep -E "FAILED|UNREACHABLE" "${LATEST_LOG}" | head -20
fi

