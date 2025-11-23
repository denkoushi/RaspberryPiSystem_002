#!/bin/bash
set -e

# デプロイスクリプト
# 使用方法: ./scripts/server/deploy.sh [ブランチ名]
# デフォルト: mainブランチ

BRANCH="${1:-main}"
PROJECT_DIR="/opt/RaspberryPiSystem_002"
COMPOSE_FILE="${PROJECT_DIR}/infrastructure/docker/docker-compose.server.yml"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

log "デプロイを開始します (ブランチ: ${BRANCH})"

# プロジェクトディレクトリに移動
cd "${PROJECT_DIR}"

# Gitの最新状態を取得
log "Gitリポジトリを更新中..."
git fetch origin
git checkout "${BRANCH}"
git pull origin "${BRANCH}"

# 依存関係をインストール
log "依存関係をインストール中..."
pnpm install

# 共有型パッケージをビルド
log "共有型パッケージをビルド中..."
cd packages/shared-types
pnpm build
cd "${PROJECT_DIR}"

# APIをビルド
log "APIをビルド中..."
cd apps/api
pnpm build
cd "${PROJECT_DIR}"

# Dockerコンテナを再ビルド・再起動
log "Dockerコンテナを再ビルド・再起動中..."
docker compose -f "${COMPOSE_FILE}" down
docker compose -f "${COMPOSE_FILE}" up -d --build

# データベースマイグレーションを実行
log "データベースマイグレーションを実行中..."
sleep 5  # データベースが起動するまで待機
docker compose -f "${COMPOSE_FILE}" exec -T api pnpm prisma migrate deploy || {
  log "警告: マイグレーションの実行に失敗しました。手動で確認してください。"
}

# ヘルスチェック
log "ヘルスチェックを実行中..."
sleep 10  # APIが起動するまで待機
for i in {1..30}; do
  if curl -f -s http://localhost:8080/api/system/health > /dev/null 2>&1; then
    log "ヘルスチェック成功"
    break
  fi
  if [ $i -eq 30 ]; then
    log "エラー: ヘルスチェックが失敗しました。ログを確認してください。"
    docker compose -f "${COMPOSE_FILE}" logs api | tail -50
    exit 1
  fi
  sleep 2
done

log "デプロイが完了しました"
