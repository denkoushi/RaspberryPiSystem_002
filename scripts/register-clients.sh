#!/usr/bin/env bash
set +x # Never trace credentials, even when invoked with bash -x.
set -euo pipefail

# クライアントデバイスをサーバーに登録するスクリプト
# Pi5で実行（ansible.cfgのVault設定でcontroller上の変数を解決する）:
#   cd /opt/RaspberryPiSystem_002/infrastructure/ansible
#   export ADMIN_ACCESS_TOKEN  # 事前に安全に設定した管理者トークン
#   # または、事前に設定した ADMIN_USERNAME と ADMIN_PASSWORD をexportする
#   REGISTER_CLIENT_HOST=raspi4-assembly-02 DRY_RUN=1 ../../scripts/register-clients.sh
#   REGISTER_CLIENT_HOST=raspi4-assembly-02 ../../scripts/register-clients.sh
# APIは既定で http://127.0.0.1:8080/api。必要時のみAPI_BASE_URLを指定する。
# DRY_RUNもVaultの解決は行うが、APIへの接続・登録は行わない。キーは表示しない。

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

# TLS verification is the default. CURL_INSECURE=1 is an explicit emergency
# override and must never be placed in tracked production configuration.
CURL_INSECURE="${CURL_INSECURE:-0}"

curl_common_opts=(-sS)
if [[ "${CURL_INSECURE}" == "1" ]]; then
  echo "[WARN] TLS certificate verification is explicitly disabled for this run." >&2
  curl_common_opts+=(-k)
fi

ADMIN_ACCESS_TOKEN="${ADMIN_ACCESS_TOKEN:-}"
ADMIN_USERNAME="${ADMIN_USERNAME:-}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"
DRY_RUN="${DRY_RUN:-0}"
REGISTER_CLIENT_HOST="${REGISTER_CLIENT_HOST:-}"

is_truthy() {
  local value="${1:-}"
  case "${value}" in
    1|true|TRUE|yes|YES|on|ON) return 0 ;;
    *) return 1 ;;
  esac
}

is_invalid_client_key() {
  local key="${1:-}"
  local compact_key="${key//[[:space:]]/}"

  # 未解決テンプレートや空値を弾いて、誤登録の増殖を防ぐ
  if [ -z "${compact_key}" ]; then
    return 0
  fi
  if [ "${#compact_key}" -lt 8 ]; then
    return 0
  fi
  if needs_resolution "${key}"; then
    return 0
  fi
  return 1
}

needs_resolution() {
  [[ "$1" == *"{{"* || "$1" == *"}}"* || "$1" == *"{%"* || "$1" == *"%}"* ||
     "$1" == *"vault_"* || "$1" == *'$ANSIBLE_VAULT'* || "$1" == *"__ansible_vault"* ]]
}

resolve_inventory_var() {
  local host="$1" variable="$2" output
  # debug is a controller action: no SSH, facts, or remote module execution.
  # Capture its one-line JSON and disable log/callback output that could retain keys.
  if ! output="$(cd "${PROJECT_ROOT}/infrastructure/ansible" &&
    ANSIBLE_LOG_PATH=/dev/null ANSIBLE_DEBUG=0 ANSIBLE_VERBOSITY=0 \
    ANSIBLE_NOCOLOR=1 ANSIBLE_STDOUT_CALLBACK=oneline \
    ANSIBLE_CALLBACKS_ENABLED=ansible.builtin.oneline ANSIBLE_LOAD_CALLBACK_PLUGINS=0 \
    ansible -i "${inventory_path}" "${host}" -c local -o \
      -m ansible.builtin.debug -a "var=${variable}" 2>/dev/null)"; then
    return 1
  fi
  python3 /dev/fd/3 "${host}" "${variable}" 3<<'PY' <<<"${output}" 2>/dev/null
import json
import sys

try:
    host, variable = sys.argv[1:]
    prefix = host + " | SUCCESS => "
    records = [line[len(prefix):] for line in sys.stdin if line.startswith(prefix)]
    if len(records) != 1:
        raise ValueError()
    result = json.loads(records[0])
    value = result[variable]
    if result.get("failed") or not isinstance(value, str) or "VARIABLE IS NOT DEFINED" in value:
        raise ValueError()
    print(value)
except (ValueError, KeyError, TypeError):
    sys.exit(1)
PY
}

if is_truthy "${DRY_RUN}"; then
  TOKEN=""
  echo "[INFO] DRY_RUN is enabled. API login is skipped."
else
  if [ -n "${ADMIN_ACCESS_TOKEN}" ]; then
    TOKEN="${ADMIN_ACCESS_TOKEN}"
    echo "[INFO] Using the explicitly supplied administrator access token."
  else
    if [ -z "${ADMIN_USERNAME}" ] || [ -z "${ADMIN_PASSWORD}" ]; then
      echo "[ERROR] Set ADMIN_ACCESS_TOKEN or both ADMIN_USERNAME and ADMIN_PASSWORD." >&2
      exit 1
    fi
    echo "[INFO] Logging in to API..."
    login_payload="$(jq -cn --arg username "${ADMIN_USERNAME}" --arg password "${ADMIN_PASSWORD}" \
      '{username: $username, password: $password}')"
    TOKEN=$(curl "${curl_common_opts[@]}" -X POST "${API_BASE_URL}/auth/login" \
      -H "Content-Type: application/json" \
      -d "${login_payload}" | jq -r '.accessToken')
  fi

  if [ -z "$TOKEN" ] || [ "$TOKEN" = "null" ]; then
    echo "[ERROR] Failed to get access token"
    exit 1
  fi

  echo "[INFO] Access token obtained"
fi

# クライアントデバイスを登録
register_client() {
  local name="$1"
  local api_key="$2"
  local location="$3"
  local kiosk_initial_route="${4:-}"
  local status_client_id="${5:-}"

  echo "[INFO] Registering client: ${name}"

  case "${kiosk_initial_route}" in
    ""|borrow_tag|borrow_photo|leader_order_board|assembly|self_inspection|production_schedule) ;;
    *)
      echo "[ERROR] Invalid kiosk_initial_route for ${name}: ${kiosk_initial_route}" >&2
      return 1
      ;;
  esac

  if is_truthy "${DRY_RUN}"; then
    echo "[INFO] [DRY-RUN] Skip API call for client=${name}, clientId=${status_client_id}, key: resolved (redacted)"
    return 0
  fi
  
  # クライアントデバイスを登録（管理者専用 POST /clients）
  local response payload
  payload="$(jq -cn --arg key "${api_key}" --arg name "${name}" --arg location "${location}" \
    '{apiKey: $key, name: $name, location: $location}')"
  response=$(curl "${curl_common_opts[@]}" -X POST "${API_BASE_URL}/clients" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Content-Type: application/json" \
    -d "${payload}")

  if echo "$response" | jq -e '.error' > /dev/null 2>&1; then
    echo "[ERROR] Failed to register client ${name}" >&2
    return 1
  fi

  if [ -n "${kiosk_initial_route}" ]; then
    local client_id route_response
    client_id="$(echo "$response" | jq -r '.client.id // empty' 2>/dev/null)"
    if [ -z "${client_id}" ]; then
      echo "[ERROR] Registered client ${name} response did not include client.id" >&2
      return 1
    fi
    route_response=$(curl "${curl_common_opts[@]}" -X PUT "${API_BASE_URL}/clients/${client_id}" \
      -H "Authorization: Bearer ${TOKEN}" \
      -H "Content-Type: application/json" \
      -d "{\"kioskInitialRoute\":\"${kiosk_initial_route}\"}")
    if ! echo "$route_response" | jq -e --arg route "${kiosk_initial_route}" '.client.kioskInitialRoute == $route' > /dev/null 2>&1; then
      echo "[ERROR] Failed to set kiosk initial route for ${name}" >&2
      return 1
    fi
  fi

  echo "[SUCCESS] Client ${name} registered successfully"
}

inventory_path="${PROJECT_ROOT}/infrastructure/ansible/inventory.yml"

read_hosts_from_inventory() {
  local path="$1"
  local resolved_inventory
  if ! command -v ansible-inventory >/dev/null 2>&1; then
    echo '{"error":"ansible_inventory_missing"}'
    return 2
  fi
  if ! resolved_inventory="$(cd "${PROJECT_ROOT}/infrastructure/ansible" &&
    ANSIBLE_LOG_PATH=/dev/null ANSIBLE_DEBUG=0 ANSIBLE_VERBOSITY=0 \
    ansible-inventory -i "${path}" --list 2>/dev/null)"; then
    echo '{"error":"inventory_resolution_failed"}'
    return 2
  fi
  python3 /dev/fd/3 3<<'PY' <<<"${resolved_inventory}"
import json
import sys

inv = json.load(sys.stdin)
hostvars = inv.get("_meta", {}).get("hostvars", {})
items = []
for host_name, host_vars in hostvars.items():
    if not isinstance(host_vars, dict):
        continue
    client_id = host_vars.get("status_agent_client_id")
    client_key = host_vars.get("status_agent_client_key")
    location = host_vars.get("status_agent_location") or ""
    kiosk_initial_route = host_vars.get("kiosk_initial_route") or ""
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
            "kioskInitialRoute": str(kiosk_initial_route),
        }
    )

for item in sorted(items, key=lambda x: x["host"]):
    print(json.dumps(item, ensure_ascii=False))
PY
}

if [ -f "${inventory_path}" ]; then
  echo "[INFO] Reading device information from inventory.yml..."
  inventory_jsonl="$(read_hosts_from_inventory "${inventory_path}" || true)"

  if echo "${inventory_jsonl}" | jq -e 'select(.error)' >/dev/null 2>&1; then
    echo "[ERROR] Could not resolve inventory.yml with ansible-inventory." >&2
    exit 1
  fi

  if [ -n "${inventory_jsonl}" ]; then
    if [ -n "${REGISTER_CLIENT_HOST}" ]; then
      inventory_jsonl="$(printf '%s\n' "${inventory_jsonl}" | jq -c --arg host "${REGISTER_CLIENT_HOST}" 'select(.host == $host)')"
      if [ -z "${inventory_jsonl}" ]; then
        echo "[ERROR] REGISTER_CLIENT_HOST was not found in inventory: ${REGISTER_CLIENT_HOST}" >&2
        exit 1
      fi
    fi
    echo "${inventory_jsonl}" | while IFS= read -r line; do
      [ -z "${line}" ] && continue
      name="$(echo "${line}" | jq -r '.name')"
      status_client_id="$(echo "${line}" | jq -r '.clientId')"
      client_key="$(echo "${line}" | jq -r '.clientKey')"
      location="$(echo "${line}" | jq -r '.location')"
      kiosk_initial_route="$(echo "${line}" | jq -r '.kioskInitialRoute')"
      if needs_resolution "${client_key}"; then
        if ! client_key="$(resolve_inventory_var "${name}" status_agent_client_key)"; then
          echo "[WARN] Skip client ${name}: could not resolve status_agent_client_key on controller" >&2
          continue
        fi
      fi
      if is_invalid_client_key "${client_key}"; then
        echo "[WARN] Skip client ${name}: unresolved/invalid status_agent_client_key" >&2
        continue
      fi
      if needs_resolution "${location}"; then
        if ! location="$(resolve_inventory_var "${name}" status_agent_location)" || needs_resolution "${location}"; then
          echo "[WARN] Skip client ${name}: could not resolve status_agent_location on controller" >&2
          continue
        fi
      fi
      register_client "${name}" "${client_key}" "${location}" "${kiosk_initial_route}" "${status_client_id}"
    done
  else
    if [ -n "${REGISTER_CLIENT_HOST}" ]; then
      echo "[ERROR] Could not select REGISTER_CLIENT_HOST because inventory parsing returned no hosts: ${REGISTER_CLIENT_HOST}" >&2
      exit 1
    fi
    echo "[ERROR] No resolved status-agent hosts were found in inventory.yml." >&2
    exit 1
  fi
else
  if [ -n "${REGISTER_CLIENT_HOST}" ]; then
    echo "[ERROR] inventory.yml not found; cannot select REGISTER_CLIENT_HOST=${REGISTER_CLIENT_HOST}" >&2
    exit 1
  fi
  echo "[ERROR] inventory.yml not found." >&2
  exit 1
fi

echo "[INFO] Client registration completed"
