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

### 必須バックアップ（失うと復旧困難）

1. **PostgreSQLデータベース**: すべてのデータ（従業員、アイテム、貸出履歴、トランザクション等）
   - **場所**: Dockerボリューム `db-data`
   - **バックアップ方法**: `scripts/server/backup.sh`で自動バックアップ
   - **頻度**: 日次（推奨）
   - **保存先**: `/opt/backups/`

2. **環境変数ファイル**: `.env`ファイル（JWTシークレット、データベース接続情報等）
   - **場所**: `apps/api/.env`, `apps/web/.env`, `infrastructure/docker/.env`
   - **バックアップ方法**: `scripts/server/backup.sh`で自動バックアップ
   - **頻度**: 変更時（自動バックアップスクリプトに含まれる）
   - **保存先**: `/opt/backups/`

3. **証明書ファイル**
   - **場所**: `/opt/RaspberryPiSystem_002/certs/`
   - **バックアップ方法**: 手動でコピー（バックアップスクリプトに含まれていない）
   - **頻度**: 証明書生成時（一度だけ）
   - **保存先**: USBメディアまたは安全な場所

4. **写真・PDFファイル**
   - **場所**: `/opt/RaspberryPiSystem_002/storage/photos`, `/opt/RaspberryPiSystem_002/storage/pdfs`
   - **バックアップ方法**: `scripts/server/backup.sh`で自動バックアップ
   - **頻度**: 日次（推奨）
   - **保存先**: `/opt/backups/`

### 推奨バックアップ（失っても再設定可能だが時間がかかる）

1. **IPアドレス設定**
   - **場所**: `infrastructure/ansible/group_vars/all.yml`
   - **バックアップ方法**: リポジトリに含まれるため、Gitで管理
   - **頻度**: 変更時（Gitコミット）
   - **注意**: デバイスごとに異なる値が設定されているため、新しいデバイスでは再設定が必要

### デバイスごとのバックアップ対象

#### Pi5（サーバー）にのみ存在する情報

| 情報の種類 | 場所 | バックアップ | 管理方法 |
|-----------|------|------------|---------|
| **環境変数ファイル** | `apps/api/.env`, `apps/web/.env`, `infrastructure/docker/.env` | ✅ **必須** | `.env.example`をコピーして作成、バックアップスクリプトで自動バックアップ |
| **証明書ファイル** | `/opt/RaspberryPiSystem_002/certs/` | ✅ **必須** | 自己署名証明書を生成、手動でバックアップ |
| **IPアドレス設定** | `infrastructure/ansible/group_vars/all.yml` | ⚠️ **推奨** | Ansible変数で管理、リポジトリに含まれる（デバイスごとに異なる値） |
| **データベース** | Dockerボリューム `db-data` | ✅ **必須** | バックアップスクリプトで自動バックアップ |
| **写真・PDFファイル** | `/opt/RaspberryPiSystem_002/storage/` | ✅ **必須** | バックアップスクリプトで自動バックアップ |

#### Pi4（キオスク）にのみ存在する情報

| 情報の種類 | 場所 | バックアップ | 管理方法 |
|-----------|------|------------|---------|
| **環境変数ファイル** | `clients/nfc-agent/.env` | ⚠️ **推奨** | `.env.example`をコピーして作成、Ansibleでデプロイ可能 |
| **NFCリーダー設定** | システム設定 | ❌ 不要 | ハードウェア設定、再設定可能 |

#### Pi3（サイネージ）にのみ存在する情報

| 情報の種類 | 場所 | バックアップ | 管理方法 |
|-----------|------|------------|---------|
| **ブラウザ設定** | Chromium設定 | ❌ 不要 | 再設定可能 |

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
cp infrastructure/docker/.env "${BACKUP_DIR}/docker_env_${DATE}.env" 2>/dev/null || true
cp clients/nfc-agent/.env "${BACKUP_DIR}/nfc_agent_env_${DATE}.env" 2>/dev/null || true
```

**重要**: 環境変数ファイルには機密情報（パスワード、APIキーなど）が含まれているため、バックアップファイルも安全に保管してください。

### 3. 証明書ファイルのバックアップ

証明書ファイルはバックアップスクリプトに含まれていないため、手動でバックアップする必要があります：

```bash
# Pi5上で実行
# 証明書ファイルをバックアップ
tar -czf "${BACKUP_DIR}/certs_backup_${DATE}.tar.gz" -C /opt/RaspberryPiSystem_002 certs/

# USBメディアにコピー（USBメディアがマウントされている場合）
# sudo mount /dev/sda1 /mnt/usb
# cp "${BACKUP_DIR}/certs_backup_${DATE}.tar.gz" /mnt/usb/
# sudo umount /mnt/usb
```

**重要**: 証明書ファイルを失うと、HTTPS接続ができなくなります。証明書生成時（一度だけ）に必ずバックアップを取得してください。

### 4. Dockerボリュームのバックアップ

```bash
# Dockerボリュームのバックアップ
docker run --rm \
  -v docker_db-data:/data \
  -v "${BACKUP_DIR}":/backup \
  alpine tar czf /backup/volume_db-data_${DATE}.tar.gz -C /data .
```

### 5. 自動バックアップスクリプト

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

### 6. cronによる自動バックアップ

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

