#!/usr/bin/env bash
set -euo pipefail

# CaddyのHTTPSリダイレクトと主要セキュリティヘッダーを確認する簡易スクリプト
# 環境変数:
#   TARGET_HOST: チェック対象ホスト（例: 100.106.158.2, localhost）
#   TARGET_DOMAIN: Caddyfile.productionのDOMAINを使う場合に指定（省略可）
#   HTTP_PORT: デフォルト80
#   HTTPS_PORT: デフォルト443

TARGET_HOST="${TARGET_HOST:-localhost}"
TARGET_DOMAIN="${TARGET_DOMAIN:-}"
HTTP_PORT="${HTTP_PORT:-80}"
HTTPS_PORT="${HTTPS_PORT:-443}"

base_host="${TARGET_DOMAIN:-$TARGET_HOST}"

http_url="http://${base_host}:${HTTP_PORT}"
https_url="https://${base_host}:${HTTPS_PORT}"

echo "[INFO] HTTP -> HTTPS リダイレクトを確認します: ${http_url}"
redir_status=$(curl -s -o /dev/null -w "%{http_code}" -I "${http_url}" || true)
if [[ "${redir_status}" != "301" && "${redir_status}" != "308" && "${redir_status}" != "302" ]]; then
  echo "[ERROR] HTTPアクセスがリダイレクトになっていません (status=${redir_status})"
  exit 1
fi
echo "[OK] HTTPリダイレクト status=${redir_status}"

echo "[INFO] HTTPSヘッダーを確認します: ${https_url}"
headers=$(curl -s -I "${https_url}")
missing=()
echo "${headers}"
grep -qi 'Strict-Transport-Security' <<< "${headers}" || missing+=("Strict-Transport-Security")
grep -qi 'X-Content-Type-Options: nosniff' <<< "${headers}" || missing+=("X-Content-Type-Options")
grep -qi 'X-Frame-Options' <<< "${headers}" || missing+=("X-Frame-Options")
grep -qi 'Referrer-Policy' <<< "${headers}" || missing+=("Referrer-Policy")

if [[ ${#missing[@]} -gt 0 ]]; then
  echo "[ERROR] 欠落ヘッダー: ${missing[*]}"
  exit 1
fi

echo "[OK] 主要セキュリティヘッダーが確認できました。"
