#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE_FILE="$REPO_ROOT/../infrastructure/docker/docker-compose.server.yml"
API_ENV="$REPO_ROOT/../apps/api/.env"
if [[ ! -f "$API_ENV" ]]; then
  cp "$API_ENV.example" "$API_ENV" 2>/dev/null || cp "$REPO_ROOT/../apps/api/.env.example" "$API_ENV"
  echo "apps/api/.env を作成しました。実際のパスワードや JWT シークレットを編集してください。" >&2
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "docker コマンドが見つかりません。" >&2
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "docker compose が利用できません (Docker Desktop / compose plugin をインストールしてください)。" >&2
  exit 1
fi

echo "[server] Docker Compose で API/DB/Web を起動します"
pushd "$REPO_ROOT/.." >/dev/null
docker compose -f infrastructure/docker/docker-compose.server.yml up -d --build
popd >/dev/null

echo "デプロイ完了: http://<pi5-ip>:8080 (API) / http://<pi5-ip>:4173 (Web)。"
