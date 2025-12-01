#!/usr/bin/env bash
set -euo pipefail

# クライアントデバイスをサーバーに登録するスクリプト
# 使用方法: ./scripts/register-clients.sh

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_BASE_URL="${API_BASE_URL:-http://192.168.128.131:8080/api}"
ADMIN_USERNAME="${ADMIN_USERNAME:-admin}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-admin1234}"

# ログインしてトークンを取得
echo "[INFO] Logging in to API..."
TOKEN=$(curl -s -X POST "${API_BASE_URL}/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"${ADMIN_USERNAME}\",\"password\":\"${ADMIN_PASSWORD}\"}" | jq -r '.accessToken')

if [ -z "$TOKEN" ] || [ "$TOKEN" = "null" ]; then
  echo "[ERROR] Failed to get access token"
  exit 1
fi

echo "[INFO] Access token obtained"

# クライアントデバイスを登録
register_client() {
  local name="$1"
  local client_id="$2"
  local api_key="$3"
  local location="$4"

  echo "[INFO] Registering client: ${name} (${client_id})"
  
  # クライアントデバイスを登録（heartbeatエンドポイントを使用）
  RESPONSE=$(curl -s -X POST "${API_BASE_URL}/clients/heartbeat" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{
      \"apiKey\": \"${api_key}\",
      \"name\": \"${name}\",
      \"location\": \"${location}\"
    }")

  if echo "$RESPONSE" | jq -e '.error' > /dev/null 2>&1; then
    echo "[ERROR] Failed to register client ${name}: $(echo "$RESPONSE" | jq -r '.message // .error')"
    return 1
  else
    echo "[SUCCESS] Client ${name} registered successfully"
    return 0
  fi
}

# インベントリファイルからクライアント情報を読み込んで登録
if [ -f "${PROJECT_ROOT}/infrastructure/ansible/inventory.yml" ]; then
  echo "[INFO] Reading client information from inventory.yml..."
  
  # YAMLをパースしてクライアント情報を取得（簡易版）
  # 実際の実装ではyqやpythonを使う方が良いが、jqとsedで簡易的に実装
  while IFS= read -r line; do
    if [[ "$line" =~ raspberrypi[34]: ]]; then
      HOSTNAME=$(echo "$line" | sed 's/://' | xargs)
      echo "[INFO] Found client: ${HOSTNAME}"
    elif [[ "$line" =~ status_agent_client_id: ]]; then
      CLIENT_ID=$(echo "$line" | sed 's/.*status_agent_client_id: *//' | xargs)
    elif [[ "$line" =~ status_agent_client_key: ]]; then
      CLIENT_KEY=$(echo "$line" | sed 's/.*status_agent_client_key: *//' | xargs)
    elif [[ "$line" =~ status_agent_location: ]]; then
      LOCATION=$(echo "$line" | sed 's/.*status_agent_location: *//' | sed 's/"//g' | xargs)
      
      # クライアント情報が揃ったら登録
      if [ -n "${CLIENT_ID:-}" ] && [ -n "${CLIENT_KEY:-}" ]; then
        NAME="${HOSTNAME:-${CLIENT_ID}}"
        register_client "$NAME" "$CLIENT_ID" "$CLIENT_KEY" "${LOCATION:-}"
        CLIENT_ID=""
        CLIENT_KEY=""
        LOCATION=""
      fi
    fi
  done < "${PROJECT_ROOT}/infrastructure/ansible/inventory.yml"
else
  # インベントリファイルがない場合、手動で登録
  echo "[INFO] inventory.yml not found, registering clients manually..."
  
  register_client "Raspberry Pi 4 - キオスク1" "raspberrypi4-kiosk1" "client-key-raspberrypi4-kiosk1" "ラズパイ4 - キオスク1"
  register_client "Raspberry Pi 3 - サイネージ1" "raspberrypi3-signage1" "client-key-raspberrypi3-signage1" "ラズパイ3 - サイネージ1"
fi

echo "[INFO] Client registration completed"

