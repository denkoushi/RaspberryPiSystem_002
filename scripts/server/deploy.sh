#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE_FILE="$REPO_ROOT/../infrastructure/docker/docker-compose.server.yml"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker コマンドが見つかりません。" >&2
  exit 1
fi

echo "[server] Docker Compose で API/DB/Web を起動します"
cd "$REPO_ROOT/.."
docker compose -f infrastructure/docker/docker-compose.server.yml up -d --build
