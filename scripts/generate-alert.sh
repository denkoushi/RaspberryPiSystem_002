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

# Slack/Webhook設定（未設定ならファイル出力のみ）
WEBHOOK_URL="${WEBHOOK_URL:-}"
WEBHOOK_TIMEOUT_SECONDS="${WEBHOOK_TIMEOUT_SECONDS:-5}"

# 簡易JSONエスケープ（必要最低限）
json_escape() {
  printf '%s' "$1" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read())[1:-1])'
}

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

# Webhook送信（設定されている場合のみ）
if [[ -n "${WEBHOOK_URL}" ]]; then
  payload=$(cat <<EOF
{
  "type": "$(json_escape "${ALERT_TYPE}")",
  "message": "$(json_escape "${MESSAGE}")",
  "details": "$(json_escape "${DETAILS}")",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
)
  if command -v curl >/dev/null 2>&1; then
    curl -sS -m "${WEBHOOK_TIMEOUT_SECONDS}" -H "Content-Type: application/json" -d "${payload}" "${WEBHOOK_URL}" >/dev/null || \
      echo "[WARN] Webhook post failed (timeout=${WEBHOOK_TIMEOUT_SECONDS}s)"
  else
    echo "[WARN] curl not found; skipped webhook post"
  fi
fi

