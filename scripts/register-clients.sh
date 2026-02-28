#!/usr/bin/env bash
set -euo pipefail

# クライアントデバイスをサーバーに登録するスクリプト
# 使用方法: ./scripts/register-clients.sh

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# APIベースURLは以下の優先順位で決定する：
# 1. 環境変数 API_BASE_URL（最優先）
# 2. 環境変数 SERVER_IP があれば https://SERVER_IP/api（Caddy経由・推奨）
# 3. デフォルト値 http://127.0.0.1:8080/api（Pi5上でのローカル確認用）
DEFAULT_API_BASE_URL="http://127.0.0.1:8080/api"
if [ -n "${SERVER_IP:-}" ]; then
  DEFAULT_API_BASE_URL="https://${SERVER_IP}/api"
fi
API_BASE_URL="${API_BASE_URL:-${DEFAULT_API_BASE_URL}}"

# 自己署名証明書（ローカルCA含む）環境ではTLS検証エラーになりやすいため、
# https経由時はデフォルトで -k を有効化する（必要なら CURL_INSECURE=0 で無効化）
CURL_INSECURE="${CURL_INSECURE:-}"
if [[ "${API_BASE_URL}" == https://* ]]; then
  CURL_INSECURE="${CURL_INSECURE:-1}"
else
  CURL_INSECURE="${CURL_INSECURE:-0}"
fi

curl_common_opts=()
if [[ "${CURL_INSECURE}" == "1" ]]; then
  curl_common_opts+=(-k)
fi

ADMIN_USERNAME="${ADMIN_USERNAME:-admin}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-admin1234}"

# ログインしてトークンを取得
echo "[INFO] Logging in to API..."
TOKEN=$(curl -sS "${curl_common_opts[@]}" -X POST "${API_BASE_URL}/auth/login" \
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
  local api_key="$2"
  local location="$3"

  echo "[INFO] Registering client: ${name}"
  
  # クライアントデバイスを登録（heartbeatエンドポイントを使用）
  RESPONSE=$(curl -sS "${curl_common_opts[@]}" -X POST "${API_BASE_URL}/clients/heartbeat" \
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

inventory_path="${PROJECT_ROOT}/infrastructure/ansible/inventory.yml"

read_hosts_from_inventory() {
  local path="$1"
  python3 - <<'PY' "$path"
import json
import sys

path = sys.argv[1]

try:
    import yaml  # type: ignore
except Exception as e:
    print(json.dumps({"error": "pyyaml_missing", "message": str(e), "path": path}, ensure_ascii=False))
    sys.exit(2)

with open(path, encoding="utf-8") as f:
    inv = yaml.safe_load(f) or {}

def walk_hosts(node):
    if not isinstance(node, dict):
        return

    # inventoryの典型構造: {hosts: {...}} / {children: {...}}
    hosts = node.get("hosts") if isinstance(node, dict) else None
    if isinstance(hosts, dict):
        for host_name, host_vars in hosts.items():
            if not isinstance(host_vars, dict):
                host_vars = {}
            yield host_name, host_vars

    children = node.get("children") if isinstance(node, dict) else None
    if isinstance(children, dict):
        for _, child in children.items():
            yield from walk_hosts(child)

all_node = inv.get("all", {})

seen = set()
items = []
for host_name, host_vars in walk_hosts(all_node):
    if host_name in seen:
        continue
    seen.add(host_name)

    client_id = host_vars.get("status_agent_client_id")
    client_key = host_vars.get("status_agent_client_key")
    location = host_vars.get("status_agent_location") or ""
    if not client_id or not client_key:
        continue

    # nameは管理画面上の表示名として使われる。まずはホスト名を採用（locationは別項目）
    items.append(
        {
            "host": host_name,
            "name": host_name,
            "clientId": str(client_id),
            "clientKey": str(client_key),
            "location": str(location),
        }
    )

for item in sorted(items, key=lambda x: x["host"]):
    print(json.dumps(item, ensure_ascii=False))
PY
}

if [ -f "${inventory_path}" ]; then
  echo "[INFO] Reading device information from inventory.yml..."
  inventory_jsonl="$(read_hosts_from_inventory "${inventory_path}" || true)"

  if echo "${inventory_jsonl}" | jq -e 'select(.error=="pyyaml_missing")' >/dev/null 2>&1; then
    echo "[WARN] Could not parse inventory.yml with python/yaml. Falling back to manual registration." >&2
    inventory_jsonl=""
  fi

  if [ -n "${inventory_jsonl}" ]; then
    echo "${inventory_jsonl}" | while IFS= read -r line; do
      [ -z "${line}" ] && continue
      name="$(echo "${line}" | jq -r '.name')"
      client_key="$(echo "${line}" | jq -r '.clientKey')"
      location="$(echo "${line}" | jq -r '.location')"
      register_client "${name}" "${client_key}" "${location}"
    done
  else
    echo "[WARN] No status-agent hosts found in inventory.yml (or parse failed). Registering example entries." >&2
    register_client "raspberrypi4" "client-key-raspberrypi4-kiosk1" "ラズパイ4 - キオスク1"
    register_client "raspberrypi3" "client-key-raspberrypi3-signage1" "ラズパイ3 - サイネージ1"
  fi
else
  echo "[WARN] inventory.yml not found. Registering example entries." >&2
  register_client "raspberrypi4" "client-key-raspberrypi4-kiosk1" "ラズパイ4 - キオスク1"
  register_client "raspberrypi3" "client-key-raspberrypi3-signage1" "ラズパイ3 - サイネージ1"
fi

echo "[INFO] Client registration completed"

