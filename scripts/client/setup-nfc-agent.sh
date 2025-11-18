#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE_FILE="$REPO_ROOT/infrastructure/docker/docker-compose.client.yml"
ENV_FILE="$REPO_ROOT/clients/nfc-agent/.env"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker が見つかりません。Raspberry Pi に docker をインストールしてください。" >&2
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "docker compose コマンドが利用できません。Docker Desktop もしくは docker-compose-plugin をインストールしてください。" >&2
  exit 1
fi

EXAMPLE_FILE="$REPO_ROOT/clients/nfc-agent/.env.example"

if [[ ! -f "$ENV_FILE" ]]; then
  cp "$EXAMPLE_FILE" "$ENV_FILE"
  echo "Created $ENV_FILE. 必要に応じて API_BASE_URL / CLIENT_ID を編集してください。" >&2
fi

pushd "$REPO_ROOT" >/dev/null
docker compose -f "$COMPOSE_FILE" up -d --build
popd >/dev/null

cat <<'EOM'
NFC エージェントコンテナを起動しました (docker compose client)。USBリーダーを接続した状態で
  docker compose -f infrastructure/docker/docker-compose.client.yml logs -f
でログを確認できます。コンテナは `restart: unless-stopped` なので再起動後も自動で立ち上がります。
EOM
