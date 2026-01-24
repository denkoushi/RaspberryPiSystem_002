#!/bin/bash
set -e

# デプロイスクリプト
# 使用方法: ./scripts/server/deploy.sh [ブランチ名]
# デフォルト: mainブランチ

BRANCH="${1:-main}"
PROJECT_DIR="/opt/RaspberryPiSystem_002"
COMPOSE_FILE="${PROJECT_DIR}/infrastructure/docker/docker-compose.server.yml"
LOG_DIR="${PROJECT_DIR}/logs/deploy"
TS="$(date -u +"%Y-%m-%dT%H-%M-%SZ")"
LOG_FILE="${LOG_DIR}/deploy-sh-${TS}.log"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

mkdir -p "${LOG_DIR}"
exec > >(tee -a "${LOG_FILE}") 2>&1
log "Deploy log: ${LOG_FILE}"

recover_on_failure() {
  local exit_code=$?
  if [ "${exit_code}" -ne 0 ]; then
    log "デプロイ失敗（exit ${exit_code}）。復旧のため docker compose up -d を試行します。"
    docker compose -f "${COMPOSE_FILE}" up -d || true
  fi
}
trap recover_on_failure EXIT

log "デプロイを開始します (ブランチ: ${BRANCH})"

# プロジェクトディレクトリに移動
cd "${PROJECT_DIR}"

# Gitの最新状態を取得
log "Gitリポジトリを更新中..."
# ローカル変更がある場合はstashしてから更新
if ! git diff --quiet || ! git diff --cached --quiet || [ -n "$(git ls-files --others --exclude-standard)" ]; then
  log "ローカル変更をstashします..."
  git stash push -u -m "Auto-stash before deploy $(date +%Y%m%d_%H%M%S)"
fi
git fetch origin
git checkout "${BRANCH}"
git pull --ff-only origin "${BRANCH}"

# node_modulesの権限ガード（root所有でpnpmが失敗するケースを自動復旧）
fix_node_modules_permissions() {
  local targets=()
  if [ -d "node_modules" ]; then
    targets+=("node_modules")
  fi
  for path in packages/*/node_modules; do
    if [ -d "${path}" ]; then
      targets+=("${path}")
    fi
  done
  if [ ${#targets[@]} -eq 0 ]; then
    return 0
  fi

  local need_fix=0
  for t in "${targets[@]}"; do
    local owner
    owner=$(stat -c '%U' "${t}" 2>/dev/null || echo "")
    if [ "${owner}" = "root" ]; then
      need_fix=1
      break
    fi
    if [ -d "${t}/.bin" ]; then
      owner=$(stat -c '%U' "${t}/.bin" 2>/dev/null || echo "")
      if [ "${owner}" = "root" ]; then
        need_fix=1
        break
      fi
    fi
  done

  if [ ${need_fix} -eq 1 ]; then
    if ! command -v sudo >/dev/null 2>&1; then
      log "エラー: node_modulesがroot所有ですがsudoが見つかりません。手動で権限修正してください。"
      exit 1
    fi
    log "node_modulesがroot所有のため権限を修正します..."
    sudo chown -R "$(whoami):$(whoami)" "${targets[@]}" || {
      log "エラー: node_modulesの権限修正に失敗しました。手動で修正して再実行してください。"
      exit 1
    }
  fi
}

# 依存関係をインストール
log "依存関係をインストール中..."
fix_node_modules_permissions
pnpm install

# 共有型パッケージをビルド
log "共有型パッケージをビルド中..."
cd packages/shared-types
pnpm build
cd "${PROJECT_DIR}"

# Prisma Clientを生成（共有型ビルド後、APIビルド前）
log "Prisma Clientを生成中..."
cd apps/api
pnpm prisma generate
cd "${PROJECT_DIR}"

# APIをビルド
log "APIをビルド中..."
cd apps/api
pnpm build
cd "${PROJECT_DIR}"

# Dockerコンテナを再ビルド・再起動
log "Dockerコンテナを再ビルド・再起動中..."
docker compose -f "${COMPOSE_FILE}" build
docker compose -f "${COMPOSE_FILE}" up -d --force-recreate

# データベースマイグレーションを実行
log "データベースマイグレーションを実行中..."
sleep 5  # データベースが起動するまで待機
docker compose -f "${COMPOSE_FILE}" exec -T api pnpm prisma migrate deploy

# データベース整合性チェック（fail-fast）
log "データベース整合性チェックを実行中..."
docker compose -f "${COMPOSE_FILE}" exec -T api pnpm prisma migrate status

MIGRATION_COUNT=$(docker compose -f "${COMPOSE_FILE}" exec -T db psql -U postgres -d borrow_return -v ON_ERROR_STOP=1 -tAc "SELECT COUNT(*) FROM \"_prisma_migrations\";")
if [ "${MIGRATION_COUNT}" -le 0 ]; then
  log "エラー: _prisma_migrations が空です。マイグレーション未適用の可能性があります。"
  exit 1
fi

TABLE_EXISTS=$(docker compose -f "${COMPOSE_FILE}" exec -T db psql -U postgres -d borrow_return -v ON_ERROR_STOP=1 -tAc "SELECT to_regclass('public.\"MeasuringInstrumentLoanEvent\"') IS NOT NULL;")
if [ "${TABLE_EXISTS}" != "t" ]; then
  log "エラー: MeasuringInstrumentLoanEvent テーブルが存在しません。"
  exit 1
fi

# ヘルスチェック
log "ヘルスチェックを実行中..."
sleep 10  # APIが起動するまで待機
for i in {1..30}; do
  status_https=$(curl -k -s -o /dev/null -w "%{http_code}" https://localhost/api/system/health || true)
  status_http=$(curl -s -o /dev/null -w "%{http_code}" http://localhost/api/system/health || true)
  if [ "${status_https}" = "200" ] || [ "${status_http}" = "200" ]; then
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
