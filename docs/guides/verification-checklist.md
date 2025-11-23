# 検証チェックリスト

最終更新: 2025-01-XX

## 概要

本ドキュメントでは、運用・保守性の向上機能のラズパイでの検証手順を説明します。

## 検証環境

- **Raspberry Pi 5**: サーバー（API/DB/Web UI）
- **Raspberry Pi 4**: クライアント（キオスク + NFCリーダー）

## 検証項目

### 1. バックアップ・リストア機能

#### 1.1 バックアップスクリプトの検証

```bash
# ラズパイ5で実行
cd /opt/RaspberryPiSystem_002

# バックアップを実行
./scripts/server/backup.sh

# バックアップファイルの確認
ls -lh /opt/backups/

# 期待される結果:
# - db_backup_YYYYMMDD_HHMMSS.sql.gz が作成される
# - api_env_YYYYMMDD_HHMMSS.env が作成される
# - ファイルサイズが0でないことを確認
```

#### 1.2 リストアスクリプトの検証

```bash
# ラズパイ5で実行
cd /opt/RaspberryPiSystem_002

# テストデータを作成（既存データがある場合はスキップ）
# 管理画面から従業員やアイテムを追加

# バックアップを取得
./scripts/server/backup.sh
BACKUP_FILE=$(ls -t /opt/backups/db_backup_*.sql.gz | head -1)

# テストデータを削除（管理画面から）

# リストアを実行
./scripts/server/restore.sh "$BACKUP_FILE"

# 期待される結果:
# - リストアが成功する
# - 削除したデータが復元される
```

### 2. 監視・アラート機能

#### 2.1 システムヘルスチェックエンドポイント

```bash
# ラズパイ5で実行
curl http://localhost:8080/api/system/health

# 期待される結果:
# {
#   "status": "ok",
#   "timestamp": "2025-01-XXT...",
#   "checks": {
#     "database": { "status": "ok" },
#     "memory": { "status": "ok" }
#   },
#   "memory": { ... },
#   "uptime": ...
# }
```

#### 2.2 メトリクスエンドポイント

```bash
# ラズパイ5で実行
curl http://localhost:8080/api/system/metrics

# 期待される結果:
# Prometheus形式のメトリクスが返される
# - db_connections_total
# - loans_active_total
# - employees_active_total
# - items_active_total
# - process_memory_bytes
# - process_uptime_seconds
```

#### 2.3 監視スクリプトの検証

```bash
# ラズパイ5で実行
cd /opt/RaspberryPiSystem_002

# 監視スクリプトを実行
./scripts/server/monitor.sh

# 期待される結果:
# - すべてのチェックが成功する
# - /var/log/system-monitor.log にログが記録される

# ログの確認
tail -20 /var/log/system-monitor.log
```

#### 2.4 異常状態の検証

```bash
# ラズパイ5で実行

# APIコンテナを停止
docker compose -f infrastructure/docker/docker-compose.server.yml stop api

# 監視スクリプトを実行（エラーが検出されることを確認）
./scripts/server/monitor.sh
# 期待される結果: エラーが報告される

# APIコンテナを再起動
docker compose -f infrastructure/docker/docker-compose.server.yml start api
```

### 3. デプロイスクリプトの検証

#### 3.1 デプロイスクリプトの実行

```bash
# ラズパイ5で実行
cd /opt/RaspberryPiSystem_002

# 現在の状態を確認
docker compose -f infrastructure/docker/docker-compose.server.yml ps

# デプロイスクリプトを実行
./scripts/server/deploy.sh

# 期待される結果:
# - Gitリポジトリが更新される
# - 依存関係がインストールされる
# - ビルドが成功する
# - Dockerコンテナが再ビルド・再起動される
# - データベースマイグレーションが実行される
# - ヘルスチェックが成功する
```

#### 3.2 デプロイ後の動作確認

```bash
# ラズパイ5で実行

# APIヘルスチェック
curl http://localhost:8080/api/health

# 認証テスト
TOKEN=$(curl -s -X POST http://localhost:8080/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin1234"}' | \
  grep -o '"accessToken":"[^"]*' | cut -d'"' -f4)

# APIリクエストテスト
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:8080/api/tools/employees

# 期待される結果:
# - すべてのリクエストが成功する
# - データが正しく返される
```

### 4. CI/CDパイプラインの検証

#### 4.1 GitHub Actionsの確認

GitHubリポジトリのActionsタブで以下を確認：

- `main`ブランチへのプッシュ時にCIパイプラインが実行される
- `lint-and-test`ジョブが成功する
- `docker-build`ジョブが成功する

#### 4.2 ローカルでのCI実行（オプション）

```bash
# Macで実行（オプション）
cd /Users/tsudatakashi/RaspberryPiSystem_002

# 依存関係のインストール
pnpm install

# 共有型パッケージのビルド
cd packages/shared-types && pnpm build && cd ../..

# APIのビルド
cd apps/api && pnpm build && cd ../..

# APIのテスト（PostgreSQLが必要）
# DockerでPostgreSQLを起動してから実行
cd apps/api && pnpm test && cd ../..

# Webのビルド
cd apps/web && pnpm build && cd ../..
```

## 検証結果の記録

検証が完了したら、以下の情報を記録してください：

- 検証日時
- 検証環境（ラズパイ5/4のバージョン、OSバージョンなど）
- 検証結果（成功/失敗、エラーメッセージなど）
- 問題点と対応方法

## トラブルシューティング

### バックアップが失敗する

- バックアップディレクトリの権限を確認: `ls -ld /opt/backups`
- Dockerコンテナが起動しているか確認: `docker compose ps`

### 監視スクリプトがエラーを報告する

- APIが起動しているか確認: `curl http://localhost:8080/api/system/health`
- Dockerコンテナの状態を確認: `docker compose ps`
- ログを確認: `tail -50 /var/log/system-monitor.log`

### デプロイスクリプトが失敗する

- Gitリポジトリの状態を確認: `git status`
- ビルドエラーを確認: `cd apps/api && pnpm build`
- Dockerログを確認: `docker compose logs api`

