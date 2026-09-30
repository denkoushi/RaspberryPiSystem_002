#!/bin/bash
set -euo pipefail

# 稼働中（Caddyfileが指す）APIスロットのコンテナ内でコマンドを実行する。
# 使用方法: ./scripts/server/run-in-active-api.sh node /app/apps/api/dist/scripts/verify-backups.js ...
#
# blue/green化で docker-compose.server.yml の `api` サービスは存在しないため、
# ホスト側のタイマーは `docker compose ... exec -T api` ではなくこのスクリプトを使う。

PROJECT_DIR="${PROJECT_DIR:-/opt/RaspberryPiSystem_002}"
API_COMPOSE_FILE="${PROJECT_DIR}/infrastructure/docker/docker-compose.phase3.yml"
API_COMPOSE_PROJECT="bluegreen"
API_ENV_FILE="${PROJECT_DIR}/infrastructure/docker/.env"
ACTIVE_GATEWAY_CONFIG="${PROJECT_DIR}/logs/deploy/bluegreen/Caddyfile"
ACTIVE_API_RESOLVER="${PROJECT_DIR}/scripts/server/resolve-active-backup-api.py"

if [ "$#" -eq 0 ]; then
  echo "エラー: 実行するコマンドを指定してください。" >&2
  exit 2
fi

if ! ACTIVE_API_SERVICE=$(python3 "${ACTIVE_API_RESOLVER}" "${ACTIVE_GATEWAY_CONFIG}"); then
  echo "エラー: 稼働中のAPIスロットを一意に確認できません。" >&2
  exit 1
fi
case "${ACTIVE_API_SERVICE}" in
  api-blue|api-green) ;;
  *)
    echo "エラー: 許可されていないAPIスロットです。" >&2
    exit 1
    ;;
esac

PI5_BLUE_API_IMAGE=unused:latest \
PI5_GREEN_API_IMAGE=unused:latest \
PI5_BLUE_WEB_IMAGE=unused:latest \
PI5_GREEN_WEB_IMAGE=unused:latest \
PI5_GATEWAY_IMAGE=unused:latest \
PI5_ENV_FILE="${API_ENV_FILE}" \
  exec docker compose \
    -p "${API_COMPOSE_PROJECT}" \
    --env-file "${API_ENV_FILE}" \
    -f "${API_COMPOSE_FILE}" \
    exec -T "${ACTIVE_API_SERVICE}" "$@"
