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

最終更新: 2025-12-29（エラーハンドリング改善とバックアップスクリプト整合性確認を追加）

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
   - **場所**: `/opt/RaspberryPiSystem_002/certs/`（コンテナ内パス: `/app/host/certs`）
   - **バックアップ方法**: `backup.json`で自動バックアップ設定可能（`kind=directory`, `source=/app/host/certs`）
   - **頻度**: 週次（推奨: `schedule="0 4 * * 0"`）
   - **保存先**: Dropbox（推奨）またはローカルストレージ
   - **追加方法**: [バックアップ設定ガイド](./backup-configuration.md#証明書ディレクトリのバックアップ推奨) を参照

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
| **証明書ファイル** | `/opt/RaspberryPiSystem_002/certs/` | ✅ **必須** | `backup.json`で自動バックアップ設定可能（`kind=directory`, `source=/app/host/certs`） |
| **IPアドレス設定** | `infrastructure/ansible/group_vars/all.yml` | ⚠️ **推奨** | Ansible変数で管理、リポジトリに含まれる（デバイスごとに異なる値） |
| **データベース** | Dockerボリューム `db-data` | ✅ **必須** | バックアップスクリプトで自動バックアップ |
| **写真・PDFファイル** | `/opt/RaspberryPiSystem_002/storage/` | ✅ **必須** | バックアップスクリプトで自動バックアップ |

#### Pi4（キオスク）にのみ存在する情報

| 情報の種類 | 場所 | バックアップ | 管理方法 |
|-----------|------|------------|---------|
| **環境変数ファイル** | `clients/nfc-agent/.env` | ⚠️ **推奨** | `.env.example`をコピーして作成、Ansibleでデプロイ可能。**現在はAnsible経由のバックアップ機能を実装予定** |
| **NFCリーダー設定** | システム設定 | ❌ 不要 | ハードウェア設定、再設定可能 |

**注意**: クライアント端末のファイルは物理的に別マシン上に存在するため、Pi5（サーバー）のAPIから直接アクセスできません。Ansibleを使用してクライアント端末のファイルをPi5に取得してバックアップする機能を実装済みです。

**AnsibleとTailscale連携の詳細**:
- Ansible Playbookは`hosts: "{{ client_host }}"`で実行され、`group_vars/all.yml`の変数（`kiosk_ip`など）が正しく展開されます
- `network_mode: "tailscale"`の場合、Tailscale IP経由で接続されます
- `network_mode: "local"`の場合、ローカルネットワークIP経由で接続されます
- SSH鍵はDockerコンテナ内にマウントされ、Pi5からPi4へのSSH接続が可能です
- 詳細は [KB-102](../knowledge-base/infrastructure/backup-restore.md#kb-102-ansibleによるクライアント端末バックアップ機能実装時のansibleとtailscale連携問題) を参照してください。

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
| `file` | `/path/to/file.txt` | 特定のファイル（Pi5上のローカルファイル） |
| `directory` | `/path/to/directory` | ディレクトリ全体（tar.gz形式、Pi5上のローカルディレクトリ） |
| `client-file` | `raspberrypi4:/opt/RaspberryPiSystem_002/clients/nfc-agent/.env` | クライアント端末のファイル（Ansible経由で取得、Pi3/Pi4など） |
| `client-directory` | `raspberrypi3:/var/lib/tailscale` | クライアント端末のディレクトリ（Ansible経由でtar.gz形式で取得、Pi3/Pi4など） |

### バックアップ設定ファイル（`backup.json`）

設定ファイル（`/opt/RaspberryPiSystem_002/config/backup.json`）の`targets`配列で、バックアップ対象とスケジュールを定義します：

**Phase 1-2（2025-12-28実装）**: バックアップ対象ごとにストレージプロバイダーを指定可能になりました。

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
      "enabled": true,
      "storage": {
        "provider": "dropbox"
      }
    },
    {
      "kind": "file",
      "source": "/opt/RaspberryPiSystem_002/apps/api/.env",
      "schedule": "0 4 * * *",
      "enabled": true,
      "storage": {
        "providers": ["local", "dropbox"]
      }
    },
    {
      "kind": "file",
      "source": "/opt/RaspberryPiSystem_002/apps/api/.env",
      "schedule": "0 4 * * *",
      "enabled": true,
      "storage": {
        "provider": "local"
      }
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

### バックアップ対象ごとのストレージプロバイダー指定（Phase 1-2）

**Phase 1（2025-12-28実装）**: バックアップ対象ごとにストレージプロバイダーを指定できるようになりました。

**設定方法**:
- 各`target`に`storage.provider`フィールドを追加（オプショナル）
- 未指定の場合は全体設定（`config.storage.provider`）を使用
- 指定可能な値: `"local"` または `"dropbox"`

**例**:
```json
{
  "targets": [
    {
      "kind": "database",
      "source": "postgresql://...",
      "schedule": "0 4 * * *",
      "enabled": true,
      "storage": {
        "provider": "dropbox"
      }
    },
    {
      "kind": "image",
      "source": "photo-storage",
      "schedule": "0 6 * * *",
      "enabled": true,
      "storage": {
        "provider": "local"
      }
    }
  ]
}
```

**Phase 2（2025-12-28実装）**: 多重バックアップ機能を実装しました。

**設定方法**:
- 各`target`に`storage.providers`配列を追加（オプショナル）
- 複数のプロバイダーを指定すると、各プロバイダーに順次バックアップを実行
- `storage.provider`と`storage.providers`の両方が指定されている場合、`providers`が優先される

**例**:
```json
{
  "targets": [
    {
      "kind": "database",
      "source": "postgresql://...",
      "schedule": "0 4 * * *",
      "enabled": true,
      "storage": {
        "providers": ["local", "dropbox"]
      }
    }
  ]
}
```

**動作**:
- 複数のプロバイダーが指定されている場合、各プロバイダーに順次バックアップを実行
- 1つのプロバイダーで失敗しても、他のプロバイダーへのバックアップは継続
- すべてのプロバイダーで失敗した場合のみエラーをスロー

**後方互換性**:
- `storage`フィールドが未指定の場合は全体設定を使用（既存の動作を維持）
- `storage.provider`が指定されている場合は単一プロバイダーとして扱う（Phase 1の動作を維持）

### バックアップ対象ごとの保持期間設定（Phase 3）

**Phase 3（2025-12-28実装）**: バックアップ対象ごとに保持期間を設定し、期限切れバックアップを自動削除できるようになりました。

**設定方法**:
- 各`target`に`retention`フィールドを追加（オプショナル）
- `retention.days`: 保持日数（例: 30日）
- `retention.maxBackups`: 最大保持数（例: 10件）
- 未指定の場合は全体設定（`config.retention`）を使用

**例**:
```json
{
  "targets": [
    {
      "kind": "database",
      "source": "postgresql://...",
      "schedule": "0 4 * * *",
      "enabled": true,
      "retention": {
        "days": 30,
        "maxBackups": 10
      }
    },
    {
      "kind": "image",
      "source": "photo-storage",
      "schedule": "0 6 * * *",
      "enabled": true,
      "retention": {
        "days": 7,
        "maxBackups": 5
      }
    }
  ]
}
```

**動作**:
- バックアップ実行時に自動的に期限切れバックアップを削除
- 対象ごとのバックアップのみをクリーンアップ（他の対象のバックアップには影響しない）
- 保持日数を超えたバックアップを削除
- 最大保持数を超えた場合は古いものから削除
- **ファイル削除時、バックアップ履歴は削除せず`fileStatus`を`DELETED`に更新**（履歴は保持され、過去の実行記録を追跡可能）

**優先順位**:
1. 対象ごとの`retention`設定（指定されている場合）
2. 全体設定（`config.retention`）
3. 未指定の場合はクリーンアップを実行しない

**後方互換性**:
- `retention`フィールドが未指定の場合は全体設定を使用（既存の動作を維持）

### バックアップ履歴のファイル存在状態管理（Phase 3拡張）

**実装日**: 2025-12-28

**機能**:
- バックアップ履歴に`fileStatus`列（`EXISTS` / `DELETED`）を追加
- ファイル削除時に履歴を削除せず、`fileStatus`を`DELETED`に更新
- UIに「ファイル」列を追加して存在状態を表示

**メリット**:
- 履歴は削除されずに保持され、過去のバックアップ実行記録を追跡可能
- どのバックアップが現在存在するか、どのバックアップが削除されたかを明確に把握可能
- 監査やトラブルシューティングに有用

**UI表示**:
- 「ファイル」列に「存在」または「削除済」を表示
- 削除済みの履歴は背景色を変更して視覚的に区別

### バックアップ履歴のストレージプロバイダー記録（Phase 3拡張）

**実装日**: 2025-12-28

**機能**:
- バックアップ実行時に実際に使用されたストレージプロバイダー（フォールバック後の値）を履歴に記録
- Dropboxのトークンが設定されていない場合、`local`にフォールバックし、履歴にも`local`を記録

**メリット**:
- 履歴に表示されるストレージプロバイダーと実際に使用されたプロバイダーが一致
- Dropbox設定が不完全な場合でも、実際の動作を正確に記録

**動作**:
- `StorageProviderFactory`が`accessToken`が空の場合に`local`にフォールバック
- フォールバック後の実際のプロバイダーを履歴に記録

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

証明書ファイルはバックアップスクリプトに含まれていないため、以下のいずれかでバックアップします。

```bash
# Pi5上で実行
# 証明書ファイルをバックアップ
tar -czf "${BACKUP_DIR}/certs_backup_${DATE}.tar.gz" -C /opt/RaspberryPiSystem_002 certs/

# USBメディアにコピー（USBメディアがマウントされている場合）
# sudo mount /dev/sda1 /mnt/usb
# cp "${BACKUP_DIR}/certs_backup_${DATE}.tar.gz" /mnt/usb/
# sudo umount /mnt/usb
```

**自動バックアップ（推奨）**:
- 既存のバックアップ機能に証明書ディレクトリを追加できます。
- 管理コンソールの「バックアップ」タブから `kind=directory` / `source=/app/host/certs` を追加してください。
  - `/app/host/certs` はホスト側の `/opt/RaspberryPiSystem_002/certs` をマウントしたパスです。

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

- **事前バックアップ（安全策）**: データベースのリストアは既定で事前バックアップを作成し、失敗時はリストアを中断する。
- **ドライラン**: `/api/backup/restore/dry-run` で対象・サイズ・存在確認を事前に取得できる。

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

### 3. 証明書ファイルのリストア

**Dropbox経由でのリストア（推奨）**:
1. 管理コンソールの「バックアップ」タブ → 「リストア」セクション
2. 証明書ディレクトリのバックアップを選択
3. 「リストア」ボタンをクリック
4. リストア完了後、Caddyを再起動

```bash
docker compose -f infrastructure/docker/docker-compose.server.yml restart caddy
```

**手動でのリストア**:
1. Dropboxから証明書バックアップファイル（`tar.gz`）をダウンロード
2. Pi5上で展開

```bash
tar -xzf certs_backup_YYYYMMDD_HHMMSS.tar.gz -C /opt/RaspberryPiSystem_002/
sudo chown -R denkon5sd02:denkon5sd02 /opt/RaspberryPiSystem_002/certs
docker compose -f infrastructure/docker/docker-compose.server.yml restart caddy
```

### 4. 画像バックアップのリストア

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

**実機検証手順**: Dropbox経由のリストア機能の実機検証手順は [バックアップリストア機能の実機検証手順](./backup-restore-verification.md) を参照してください。

**エラーハンドリング**:
- Dropbox APIのレート制限エラー（429）時は自動的にリトライされます（最大5回、指数バックオフ）
- ネットワークエラー（タイムアウト、接続エラーなど）時も自動的にリトライされます
- **証明書ピニング検証失敗（500エラー）**: Dropboxが証明書を更新した場合、証明書ピニング検証が失敗しバックアップが500エラーになることがあります。この場合は、`apps/api/scripts/get-dropbox-cert-fingerprint.ts`で新しい証明書フィンガープリントを取得し、`apps/api/src/services/backup/storage/dropbox-cert-pinning.ts`に追加してください。詳細は [KB-199](../knowledge-base/infrastructure/backup-restore.md#kb-199-dropbox証明書ピニング検証失敗によるバックアップ500エラー) を参照してください
- 詳細は [バックアップエラーハンドリング改善](./backup-error-handling-improvements.md) を参照してください

### 5. Dockerボリュームのリストア

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

# 5. 証明書ファイルをリストア
tar -xzf /opt/backups/certs_backup_20250101_020000.tar.gz -C /opt/RaspberryPiSystem_002/
sudo chown -R denkon5sd02:denkon5sd02 /opt/RaspberryPiSystem_002/certs

# 6. Dockerコンテナを起動
docker compose -f infrastructure/docker/docker-compose.server.yml up -d

# 7. データベースマイグレーションを実行（必要に応じて）
docker compose -f infrastructure/docker/docker-compose.server.yml exec api \
  pnpm prisma migrate deploy

# 8. データベースをリストア
gunzip -c /opt/backups/db_backup_20250101_020000.sql.gz | \
  docker compose -f infrastructure/docker/docker-compose.server.yml exec -T db \
  psql -U postgres -d borrow_return
```

## backup.jsonが失われた場合の復元手順

`backup.json`が削除・破損した場合、Dropboxから復元できます。

### 復元手順

1. **最新のbackup.jsonバックアップを特定**:
   - 管理コンソールの「バックアップ履歴」から、`backup.json`の最新バックアップを確認
   - または、Dropbox上で `/backups/file/backup.json/` 配下の最新ファイルを確認
2. **バックアップファイルをダウンロード**:
   - 管理コンソールからダウンロード、またはDropboxから直接ダウンロード
3. **backup.jsonを復元**:
   ```bash
   # Pi5上で実行
   sudo nano /opt/RaspberryPiSystem_002/config/backup.json
   # ダウンロードしたバックアップの内容を貼り付け
   ```
4. **APIを再起動**:
   ```bash
   docker compose -f infrastructure/docker/docker-compose.server.yml restart api
   ```
5. **Gmail設定の復元（必要に応じて）**:
   - [KB-166](../knowledge-base/infrastructure/backup-restore.md#kb-166-gmail-oauth設定の復元方法) を参照
   - 管理コンソールの「バックアップ」タブ → 「Gmail設定」セクションからOAuth認証を実行

**関連ナレッジ**:
- [KB-165](../knowledge-base/infrastructure/backup-restore.md#kb-165-dropboxからのbackupjson復元方法)
- [KB-166](../knowledge-base/infrastructure/backup-restore.md#kb-166-gmail-oauth設定の復元方法)

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
- **エラーハンドリング**: Dropbox APIのレート制限エラーやネットワークエラー時は自動的にリトライされます。証明書ピニング検証失敗（500エラー）の場合は、証明書フィンガープリントの更新が必要です。詳細は [KB-199](../knowledge-base/infrastructure/backup-restore.md#kb-199-dropbox証明書ピニング検証失敗によるバックアップ500エラー) と [バックアップエラーハンドリング改善](./backup-error-handling-improvements.md) を参照してください

---

## 関連ドキュメント

- [バックアップ設定ガイド](./backup-configuration.md): バックアップ設定ファイルの詳細
- [バックアップAPI仕様](../api/backup.md): バックアップAPIの詳細仕様
- [バックアップリストア機能の実機検証結果](./backup-restore-verification-results.md): 実機検証結果
- [バックアップスクリプトとの整合性確認結果](./backup-script-integration-verification.md): バックアップスクリプトとの整合性確認結果
- [バックアップエラーハンドリング改善](./backup-error-handling-improvements.md): エラーハンドリング改善の詳細
- [バックアップ対象管理UI実装計画](../requirements/backup-target-management-ui.md): 管理コンソールからのバックアップ対象管理機能の実装計画

