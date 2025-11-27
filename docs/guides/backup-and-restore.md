---
title: バックアップ・リストア手順
tags: [運用, バックアップ, PostgreSQL, ラズパイ5]
audience: [運用者, 開発者]
last-verified: 2025-11-27
related: [monitoring.md, deployment.md]
category: guides
update-frequency: medium
---

# バックアップ・リストア手順

最終更新: 2025-11-27

## 概要

本ドキュメントでは、Raspberry Pi 5上で動作するシステムのバックアップとリストア手順を説明します。

## バックアップ対象

- **PostgreSQLデータベース**: すべてのデータ（従業員、アイテム、貸出履歴、トランザクション等）
- **環境変数ファイル**: `.env`ファイル（JWTシークレット、データベース接続情報等）
- **Dockerボリューム**: `db-data`ボリューム

## バックアップ手順

### 1. データベースのバックアップ

```bash
# ラズパイ5で実行
cd /opt/RaspberryPiSystem_002

# バックアップディレクトリを作成
mkdir -p /opt/backups
BACKUP_DIR="/opt/backups"
DATE=$(date +%Y%m%d_%H%M%S)

# PostgreSQLデータベースのバックアップ
docker compose -f infrastructure/docker/docker-compose.server.yml exec -T db \
  pg_dump -U postgres borrow_return > "${BACKUP_DIR}/db_backup_${DATE}.sql"

# バックアップファイルを圧縮
gzip "${BACKUP_DIR}/db_backup_${DATE}.sql"

echo "バックアップ完了: ${BACKUP_DIR}/db_backup_${DATE}.sql.gz"
```

### 2. 環境変数ファイルのバックアップ

```bash
# 環境変数ファイルをバックアップ
cp apps/api/.env "${BACKUP_DIR}/api_env_${DATE}.env"
cp apps/web/.env "${BACKUP_DIR}/web_env_${DATE}.env" 2>/dev/null || true
cp clients/nfc-agent/.env "${BACKUP_DIR}/nfc_agent_env_${DATE}.env" 2>/dev/null || true
```

### 3. Dockerボリュームのバックアップ

```bash
# Dockerボリュームのバックアップ
docker run --rm \
  -v docker_db-data:/data \
  -v "${BACKUP_DIR}":/backup \
  alpine tar czf /backup/volume_db-data_${DATE}.tar.gz -C /data .
```

### 4. 自動バックアップスクリプト

`scripts/server/backup.sh`を作成：

```bash
#!/bin/bash
set -e

BACKUP_DIR="/opt/backups"
DATE=$(date +%Y%m%d_%H%M%S)
RETENTION_DAYS=30

# バックアップディレクトリを作成
mkdir -p "${BACKUP_DIR}"

# データベースバックアップ
docker compose -f /opt/RaspberryPiSystem_002/infrastructure/docker/docker-compose.server.yml exec -T db \
  pg_dump -U postgres borrow_return | gzip > "${BACKUP_DIR}/db_backup_${DATE}.sql.gz"

# 環境変数ファイルのバックアップ
cp /opt/RaspberryPiSystem_002/apps/api/.env "${BACKUP_DIR}/api_env_${DATE}.env" 2>/dev/null || true

# 古いバックアップを削除（30日以上前）
find "${BACKUP_DIR}" -name "*.gz" -mtime +${RETENTION_DAYS} -delete
find "${BACKUP_DIR}" -name "*.env" -mtime +${RETENTION_DAYS} -delete

echo "バックアップ完了: ${BACKUP_DIR}/db_backup_${DATE}.sql.gz"
```

### 5. cronによる自動バックアップ

```bash
# crontabを編集
sudo crontab -e

# 毎日午前2時にバックアップを実行
0 2 * * * /opt/RaspberryPiSystem_002/scripts/server/backup.sh >> /var/log/backup.log 2>&1
```

## リストア手順

### 1. データベースのリストア

```bash
# ラズパイ5で実行
cd /opt/RaspberryPiSystem_002

# バックアップファイルを指定
BACKUP_FILE="/opt/backups/db_backup_20250101_020000.sql.gz"

# データベースをリストア
gunzip -c "${BACKUP_FILE}" | \
  docker compose -f infrastructure/docker/docker-compose.server.yml exec -T db \
  psql -U postgres -d borrow_return

echo "リストア完了"
```

### 2. 環境変数ファイルのリストア

```bash
# 環境変数ファイルをリストア
cp /opt/backups/api_env_20250101_020000.env /opt/RaspberryPiSystem_002/apps/api/.env

# Dockerコンテナを再起動
docker compose -f infrastructure/docker/docker-compose.server.yml restart api
```

### 3. Dockerボリュームのリストア

```bash
# Dockerボリュームをリストア
docker run --rm \
  -v docker_db-data:/data \
  -v /opt/backups:/backup \
  alpine tar xzf /backup/volume_db-data_20250101_020000.tar.gz -C /data

# Dockerコンテナを再起動
docker compose -f infrastructure/docker/docker-compose.server.yml restart db
```

## 完全リストア手順（災害復旧）

システム全体をリストアする場合：

```bash
# 1. Dockerコンテナを停止
cd /opt/RaspberryPiSystem_002
docker compose -f infrastructure/docker/docker-compose.server.yml down

# 2. 既存のボリュームを削除（注意：データが失われます）
docker volume rm docker_db-data

# 3. ボリュームをリストア
docker run --rm \
  -v docker_db-data:/data \
  -v /opt/backups:/backup \
  alpine tar xzf /backup/volume_db-data_20250101_020000.tar.gz -C /data

# 4. 環境変数ファイルをリストア
cp /opt/backups/api_env_20250101_020000.env /opt/RaspberryPiSystem_002/apps/api/.env

# 5. Dockerコンテナを起動
docker compose -f infrastructure/docker/docker-compose.server.yml up -d

# 6. データベースマイグレーションを実行（必要に応じて）
docker compose -f infrastructure/docker/docker-compose.server.yml exec api \
  pnpm prisma migrate deploy

# 7. データベースをリストア
gunzip -c /opt/backups/db_backup_20250101_020000.sql.gz | \
  docker compose -f infrastructure/docker/docker-compose.server.yml exec -T db \
  psql -U postgres -d borrow_return
```

## バックアップの検証

定期的にバックアップが正しく作成されているか確認：

```bash
# バックアップファイルの存在確認
ls -lh /opt/backups/

# バックアップファイルの整合性確認（gzipファイルの場合）
gunzip -t /opt/backups/db_backup_*.sql.gz

# バックアップファイルの内容確認（最初の数行）
gunzip -c /opt/backups/db_backup_*.sql.gz | head -20
```

## 注意事項

- **バックアップの保存場所**: バックアップは別のストレージ（USBメモリ、外部HDD、クラウドストレージ）にも保存することを推奨します
- **バックアップの暗号化**: 機密情報を含むバックアップは暗号化することを推奨します
- **リストア前の確認**: リストア前に現在のデータベースのバックアップを取得してください
- **テストリストア**: 定期的にテストリストアを実行し、バックアップが正しく動作することを確認してください

