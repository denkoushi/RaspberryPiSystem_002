# 実機検証ガイド（マージ前）

最終更新: 2025-11-26

## 概要

本ドキュメントでは、非機能要件の実機検証手順を説明します。マージ前にブランチ`fix/ci-test-architecture`で検証を行います。

## 検証環境

- **Raspberry Pi 5**: サーバー（API/DB/Web UI）
- **Raspberry Pi 4**: クライアント（キオスク + NFCリーダー）

## Step 1: ブランチのデプロイ（ラズパイ5）

### 1.1 ブランチをチェックアウトして更新

```bash
# ラズパイ5で実行
cd /opt/RaspberryPiSystem_002

# ブランチをチェックアウト（初回のみ、またはブランチが存在しない場合）
git fetch origin
git checkout fix/ci-test-architecture

# 最新のコードを取得（従来の手順と同じ）
git pull origin fix/ci-test-architecture
```

### 1.2 依存関係のインストールとビルド

```bash
# ラズパイ5で実行
# 依存関係をインストール
pnpm install

# 共有型パッケージをビルド
cd packages/shared-types
pnpm build
cd /opt/RaspberryPiSystem_002

# APIをビルド
cd apps/api
pnpm build
cd /opt/RaspberryPiSystem_002
```

### 1.3 Dockerコンテナの再ビルド・再起動

```bash
# ラズパイ5で実行
# Dockerコンテナを再ビルド・再起動（従来の手順と同じ）
docker compose -f infrastructure/docker/docker-compose.server.yml up -d --force-recreate --build

# データベースマイグレーションを実行
sleep 5  # データベースが起動するまで待機
docker compose -f infrastructure/docker/docker-compose.server.yml exec -T api pnpm prisma migrate deploy
```

### 1.4 デプロイ後の動作確認

```bash
# ラズパイ5で実行
# APIヘルスチェック
curl http://localhost:8080/api/system/health

# メトリクスエンドポイント
curl http://localhost:8080/api/system/metrics

# Dockerコンテナの状態確認
docker compose -f infrastructure/docker/docker-compose.server.yml ps
```

期待される結果：
- `/api/system/health`が`200 OK`を返す
- `/api/system/metrics`が`200 OK`を返す
- すべてのコンテナ（db, api, web）が`Up`状態

## Step 2: バックアップ・リストアスクリプトの実機検証

### 2.1 バックアップの実行

```bash
# ラズパイ5で実行
cd /opt/RaspberryPiSystem_002
./scripts/server/backup.sh
```

期待される結果：
- `/opt/backups/db_backup_YYYYMMDD_HHMMSS.sql.gz`が作成される
- バックアップファイルのサイズが表示される

### 2.2 バックアップファイルの確認

```bash
# ラズパイ5で実行
ls -lh /opt/backups/
gunzip -t /opt/backups/db_backup_*.sql.gz  # 最新のバックアップファイルを指定
```

期待される結果：
- バックアップファイルが存在する
- バックアップファイルが破損していない（gunzip -tが成功）

### 2.3 リストアのテスト（注意: テスト用DBを使用）

**重要**: 本番データベースを壊さないよう、テスト用データベースでリストアをテストします。

```bash
# ラズパイ5で実行
# テスト用データベースを作成
docker compose -f infrastructure/docker/docker-compose.server.yml exec -T db \
  psql -U postgres -c "CREATE DATABASE test_restore;"

# テスト用データベースにリストア
BACKUP_FILE="/opt/backups/db_backup_YYYYMMDD_HHMMSS.sql.gz"  # 実際のファイル名に置き換え
DB_NAME="test_restore" \
BACKUP_FILE="${BACKUP_FILE}" \
SKIP_CONFIRM=yes \
./scripts/server/restore.sh

# テスト用データベースの確認
docker compose -f infrastructure/docker/docker-compose.server.yml exec -T db \
  psql -U postgres -d test_restore -c "SELECT COUNT(*) FROM \"Employee\";"

# テスト用データベースを削除
docker compose -f infrastructure/docker/docker-compose.server.yml exec -T db \
  psql -U postgres -c "DROP DATABASE test_restore;"
```

期待される結果：
- リストアが成功する
- データが復元されている（Employeeテーブルにデータが存在）

## Step 3: 監視・アラート機能の実機検証

### 3.1 監視スクリプトの実行

```bash
# ラズパイ5で実行
cd /opt/RaspberryPiSystem_002
./scripts/server/monitor.sh
```

期待される結果：
- APIヘルスチェックが成功
- ディスク使用量が表示される
- メモリ使用量が表示される（Linux環境の場合）
- エラーが発生しない

### 3.2 APIエンドポイントの確認

```bash
# ラズパイ5で実行
# ヘルスチェックエンドポイント
curl -s http://localhost:8080/api/system/health | jq .

# メトリクスエンドポイント
curl -s http://localhost:8080/api/system/metrics | jq .
```

期待される結果：
- `/api/system/health`が`{"status":"ok","checks":{...}}`を返す
- `/api/system/metrics`が`{"uptime":...,"memory":{...},"requests":{...}}`を返す

## Step 4: パフォーマンスの実機検証

### 4.1 APIレスポンス時間の測定

```bash
# ラズパイ5で実行
# ヘルスチェックエンドポイントのレスポンス時間
time curl -s http://localhost:8080/api/system/health > /dev/null

# メトリクスエンドポイントのレスポンス時間
time curl -s http://localhost:8080/api/system/metrics > /dev/null

# 認証が必要なエンドポイントのレスポンス時間（認証トークンを取得してから）
TOKEN=$(curl -s -X POST http://localhost:8080/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin1234"}' | jq -r '.accessToken')
time curl -s http://localhost:8080/api/tools/employees \
  -H "Authorization: Bearer ${TOKEN}" > /dev/null
```

期待される結果：
- すべてのエンドポイントが1秒以内に応答する（NFR-001）

### 4.2 ページ読み込み時間の測定

ブラウザの開発者ツール（F12）を使用して測定：

1. **管理画面の読み込み時間**
   - `http://<ラズパイ5のIP>:4173/login` にアクセス
   - Networkタブでページ読み込み時間を確認
   - 期待値: 3秒以内（NFR-001）

2. **キオスク画面の読み込み時間**
   - `http://<ラズパイ5のIP>:4173/kiosk` にアクセス
   - Networkタブでページ読み込み時間を確認
   - 期待値: 3秒以内（NFR-001）

## 検証結果の記録

各ステップの検証結果を記録してください：

- ✅ 成功: 期待される結果が得られた
- ⚠️ 警告: 一部の問題があったが動作はしている
- ❌ 失敗: 期待される結果が得られなかった

問題が発生した場合は、エラーメッセージとログを記録してください。

## トラブルシューティング

### デプロイが失敗する場合

```bash
# ラズパイ5で実行
# Dockerコンテナのログを確認
docker compose -f infrastructure/docker/docker-compose.server.yml logs api
docker compose -f infrastructure/docker/docker-compose.server.yml logs db

# コンテナの状態を確認
docker compose -f infrastructure/docker/docker-compose.server.yml ps
```

### バックアップが失敗する場合

```bash
# ラズパイ5で実行
# バックアップディレクトリの権限を確認
ls -ld /opt/backups
# 権限がない場合は作成
sudo mkdir -p /opt/backups
sudo chown $(whoami):$(whoami) /opt/backups
```

## 関連ドキュメント

- [システム要件定義](docs/requirements/system-requirements.md)
- [バックアップ・リストア手順](docs/guides/backup-and-restore.md)
- [監視・アラートガイド](docs/guides/monitoring.md)

