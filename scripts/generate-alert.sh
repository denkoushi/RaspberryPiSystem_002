#!/usr/bin/env bash
set -euo pipefail

# アラート通知ファイル生成スクリプト
# 使用方法: ./scripts/generate-alert.sh <タイプ> <メッセージ> [詳細]

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ALERT_DIR="${PROJECT_ROOT}/alerts"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
ALERT_TYPE="${1:-unknown}"
MESSAGE="${2:-No message}"
DETAILS="${3:-}"

mkdir -p "${ALERT_DIR}"

# アラートファイルを生成
ALERT_FILE="${ALERT_DIR}/alert-${TIMESTAMP}.json"

cat > "${ALERT_FILE}" <<EOF
{
  "id": "${TIMESTAMP}",
  "type": "${ALERT_TYPE}",
  "message": "${MESSAGE}",
  "details": "${DETAILS}",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "acknowledged": false
}
EOF

echo "[INFO] Alert file created: ${ALERT_FILE}"
echo "${ALERT_FILE}"

