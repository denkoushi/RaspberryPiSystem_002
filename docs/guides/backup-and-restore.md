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

最終更新: 2025-12-18

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

## バックアップ対象の決定仕様

バックアップ対象は、**バックアップAPI（`/api/backup`）**と**バックアップ設定ファイル（`backup.json`）**で管理されます。

### バックアップAPIの仕様

バックアップAPIは、リクエストボディで`kind`と`source`を指定してバックアップを実行します：

| `kind` | `source`の例 | 説明 |
|--------|-------------|------|
| `database` | `postgresql://postgres:...@db:5432/borrow_return` | PostgreSQLデータベース全体 |
| `csv` | `employees` または `items` | 従業員データまたはアイテムデータをCSV形式で |
| `image` | `photo-storage` | 写真ストレージディレクトリ（`PHOTO_STORAGE_DIR`環境変数で指定）。`tar.gz`形式で保存され、リストア時に自動展開される |
| `file` | `/path/to/file.txt` | 特定のファイル |
| `directory` | `/path/to/directory` | ディレクトリ全体（tar.gz形式） |

### バックアップ設定ファイル（`backup.json`）

設定ファイル（`/opt/RaspberryPiSystem_002/config/backup.json`）の`targets`配列で、バックアップ対象とスケジュールを定義します：

```json
{
  "storage": {
    "provider": "dropbox",
    "options": {
      "basePath": "/backups",
      "accessToken": "...",
      "refreshToken": "..."
    }
  },
  "targets": [
    {
      "kind": "database",
      "source": "postgresql://postgres:...@db:5432/borrow_return",
      "schedule": "0 4 * * *",
      "enabled": true
    },
    {
      "kind": "file",
      "source": "/opt/RaspberryPiSystem_002/apps/api/.env",
      "schedule": "0 4 * * *",
      "enabled": true
    },
    {
      "kind": "file",
      "source": "/opt/RaspberryPiSystem_002/apps/web/.env",
      "schedule": "0 4 * * *",
      "enabled": true
    },
    {
      "kind": "file",
      "source": "/opt/RaspberryPiSystem_002/infrastructure/docker/.env",
      "schedule": "0 4 * * *",
      "enabled": true
    },
    {
      "kind": "file",
      "source": "/opt/RaspberryPiSystem_002/clients/nfc-agent/.env",
      "schedule": "0 4 * * *",
      "enabled": true
    },
    {
      "kind": "csv",
      "source": "employees",
      "schedule": "0 5 * * *",
      "enabled": true
    },
    {
      "kind": "csv",
      "source": "items",
      "schedule": "0 5 * * *",
      "enabled": true
    },
    {
      "kind": "image",
      "source": "photo-storage",
      "schedule": "0 6 * * *",
      "enabled": true
    }
  ]
}
```

**設定ファイルの詳細**: [バックアップ設定ガイド](./backup-configuration.md) を参照してください。

### `backup.sh`スクリプトとの対応

`backup.sh`スクリプトは、以下のバックアップ対象を処理します：

| `backup.sh`の処理 | APIの`kind` | APIの`source` |
|------------------|------------|--------------|
| データベース（`pg_dump`） | `database` | `postgresql://postgres:...@db:5432/borrow_return` |
| 環境変数ファイル（`.env`） | `file` | `/opt/RaspberryPiSystem_002/apps/api/.env` など |
| 写真ディレクトリ（`tar.gz`） | `image` | `photo-storage`（`tar.gz`形式で保存、リストア時に自動展開） |
| CSVデータ（従業員・アイテム） | `csv` | `employees`, `items` |

**動作**:
- APIが利用可能な場合、API経由でバックアップを実行（設定ファイルのDropbox設定が自動的に使用される）
- APIが利用できない場合、またはAPI経由のバックアップが失敗した場合、ローカルバックアップにフォールバック
- ローカルバックアップは常に実行される（API経由のバックアップが成功しても、フォールバック用に保持）

### 管理コンソールからのバックアップ対象管理

バックアップ対象は、管理コンソールの「バックアップ」タブ（`/admin/backup/targets`）から管理できます：

**機能**:
- **バックアップ対象の一覧表示**: 現在の`targets`配列の内容を表示（種類、ソース、スケジュール、有効/無効状態）
- **バックアップ対象の追加**: 新しい`target`を追加（`kind`、`source`、`schedule`、`enabled`を設定）
- **バックアップ対象の編集**: 既存の`target`の`schedule`や`enabled`状態を編集
- **バックアップ対象の削除**: 不要な`target`を`targets`配列から削除
- **有効/無効切り替え**: 各対象の`enabled`フラグをトグルスイッチで切り替え
- **手動バックアップ実行**: 特定のバックアップ対象を手動で実行

**使用方法**:
1. 管理コンソールにログイン
2. 「バックアップ」タブをクリック
3. バックアップ対象一覧が表示される
4. 「追加」ボタンで新しい対象を追加、または既存の対象を編集・削除

**設定ファイルとの連携**:
- 管理コンソールでの変更は即座に設定ファイル（`backup.json`）に反映される
- `backup.sh`スクリプトは設定ファイルの`targets`配列を参照してバックアップを実行する
- 管理コンソールと`backup.sh`スクリプトの機能が整合性を保つ

詳細は [バックアップ対象管理UI実装計画](../requirements/backup-target-management-ui.md) と [バックアップ対象管理UI実機検証手順](./backup-target-management-verification.md) を参照してください。

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

`scripts/server/backup.sh`は以下の機能を提供します：

**バックアップ対象**:
- PostgreSQLデータベース
- 環境変数ファイル（`.env`）
- 写真ディレクトリ
- CSVデータ（従業員・アイテム、API経由の場合）

**バックアップ先**:
- **ローカルディレクトリ**: `/opt/backups/`（常に実行）
- **Dropbox**: 設定ファイル（`/opt/RaspberryPiSystem_002/config/backup.json`）でDropboxが有効化されている場合、API経由で自動的にDropboxにアップロード

**動作**:
1. APIが利用可能な場合、API経由でバックアップを実行（設定ファイルのDropbox設定が自動的に使用される）
2. APIが利用できない場合、またはAPI経由のバックアップが失敗した場合、ローカルバックアップにフォールバック
3. ローカルバックアップは常に実行される（API経由のバックアップが成功しても、フォールバック用に保持）

**使用方法**:
```bash
# Pi5上で実行
cd /opt/RaspberryPiSystem_002
./scripts/server/backup.sh
```

**Dropboxへの自動アップロードを有効化する方法**:
1. 設定ファイル（`/opt/RaspberryPiSystem_002/config/backup.json`）を作成・編集
2. `storage.provider`を`"dropbox"`に設定
3. Dropboxアクセストークンを設定（詳細は [バックアップ設定ガイド](./backup-configuration.md) を参照）

設定ファイルが存在しない場合、ローカルバックアップのみ実行されます。

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

### 3. 画像バックアップのリストア

画像バックアップは`tar.gz`形式で保存されています。リストア時には`tar.gz`を展開して、写真ディレクトリ（`photos`）とサムネイルディレクトリ（`thumbnails`）に復元します。

**API経由でのリストア（推奨）**:

管理コンソールの「バックアップ」タブから、またはAPIエンドポイント `/api/backup/restore/from-dropbox` を使用してリストアできます：

```bash
# API経由で画像バックアップをリストア
curl -X POST https://<pi5>/api/backup/restore/from-dropbox \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <JWT_TOKEN>" \
  -d '{
    "backupPath": "/backups/image/2025-12-19T05-45-14-502Z/photo-storage",
    "targetKind": "image"
  }'
```

**手動でのリストア**:

```bash
# ラズパイ5で実行
cd /opt/RaspberryPiSystem_002

# バックアップファイルを指定
BACKUP_FILE="/opt/backups/image/2025-12-19T05-45-14-502Z/photo-storage"

# 一時ディレクトリを作成
TMP_DIR=$(mktemp -d)

# tar.gzを展開
tar -xzf "${BACKUP_FILE}" -C "${TMP_DIR}"

# 既存のディレクトリをバックアップ（安全のため）
PHOTO_STORAGE_DIR="/opt/RaspberryPiSystem_002/storage"
if [ -d "${PHOTO_STORAGE_DIR}/photos" ]; then
  mv "${PHOTO_STORAGE_DIR}/photos" "${PHOTO_STORAGE_DIR}/photos-backup-$(date +%Y%m%d_%H%M%S)"
fi
if [ -d "${PHOTO_STORAGE_DIR}/thumbnails" ]; then
  mv "${PHOTO_STORAGE_DIR}/thumbnails" "${PHOTO_STORAGE_DIR}/thumbnails-backup-$(date +%Y%m%d_%H%M%S)"
fi

# 展開されたディレクトリを目的の場所に移動
if [ -d "${TMP_DIR}/photos" ]; then
  mkdir -p "${PHOTO_STORAGE_DIR}"
  mv "${TMP_DIR}/photos" "${PHOTO_STORAGE_DIR}/photos"
fi
if [ -d "${TMP_DIR}/thumbnails" ]; then
  mkdir -p "${PHOTO_STORAGE_DIR}"
  mv "${TMP_DIR}/thumbnails" "${PHOTO_STORAGE_DIR}/thumbnails"
fi

# 一時ディレクトリを削除
rm -rf "${TMP_DIR}"

echo "画像バックアップのリストア完了"
```

**注意事項**:
- 画像バックアップは`tar.gz`形式で保存されます（JPEGファイルがそのまま含まれています）
- リストア時には既存の写真ディレクトリとサムネイルディレクトリがバックアップされ、新しいデータで上書きされます
- API経由のリストアでは、既存ディレクトリの自動バックアップが実行されます

### 4. Dockerボリュームのリストア

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

