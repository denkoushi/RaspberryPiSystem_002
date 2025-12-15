---
title: バックアップ設定ガイド
tags: [運用, バックアップ, 設定, Dropbox]
audience: [運用者, 開発者]
last-verified: 2025-12-14
related: [backup-and-restore.md, dropbox-setup-guide.md, monitoring.md]
category: guides
update-frequency: medium
---

# バックアップ設定ガイド

最終更新: 2025-12-14

## 概要

本ガイドでは、モジュール化されたバックアップ機能の設定方法を説明します。バックアップ機能は設定ファイルベースで動作し、ローカルストレージまたはDropboxへの自動バックアップをサポートします。

## 設定ファイルの場所

バックアップ設定ファイルは以下の場所に配置されます：

```
/opt/RaspberryPiSystem_002/config/backup.json
```

環境変数 `BACKUP_CONFIG_PATH` で設定ファイルのパスを変更できます。

## 設定ファイルの構造

設定ファイルはJSON形式で、以下の構造を持ちます：

```json
{
  "storage": {
    "provider": "local" | "dropbox",
    "options": {
      "basePath": "/opt/RaspberryPiSystem_002/backups",
      "accessToken": "your-dropbox-access-token"
    }
  },
  "targets": [
    {
      "kind": "database" | "file" | "directory" | "csv" | "image",
      "source": "データソースのパスまたは識別子",
      "schedule": "0 4 * * *",
      "enabled": true,
      "metadata": {}
    }
  ],
  "retention": {
    "days": 30,
    "maxBackups": 100
  }
}
```

## ストレージプロバイダーの設定

### ローカルストレージ

ローカルファイルシステムにバックアップを保存する場合：

```json
{
  "storage": {
    "provider": "local",
    "options": {
      "basePath": "/opt/RaspberryPiSystem_002/backups"
    }
  }
}
```

**設定項目**:
- `provider`: `"local"` を指定
- `options.basePath`: バックアップファイルの保存先ディレクトリ（デフォルト: `/opt/RaspberryPiSystem_002/backups`）

### Dropboxストレージ

Dropboxにバックアップを保存する場合：

```json
{
  "storage": {
    "provider": "dropbox",
    "options": {
      "basePath": "/backups",
      "accessToken": "your-dropbox-access-token"
    }
  }
}
```

**設定項目**:
- `provider`: `"dropbox"` を指定
- `options.basePath`: Dropbox内のバックアップ保存先パス（デフォルト: `/backups`）
- `options.accessToken`: Dropboxアクセストークン（必須）

**Dropboxアクセストークンの取得方法**:
詳細は [Dropbox連携セットアップガイド](./dropbox-setup-guide.md) を参照してください。

## バックアップ対象の設定

### データベースバックアップ

PostgreSQLデータベースをバックアップする場合：

```json
{
  "kind": "database",
  "source": "postgresql://postgres:postgres@localhost:5432/borrow_return",
  "schedule": "0 4 * * *",
  "enabled": true
}
```

**設定項目**:
- `kind`: `"database"` を指定
- `source`: PostgreSQL接続文字列
- `schedule`: cron形式のスケジュール（例: `"0 4 * * *"` = 毎日4時）
- `enabled`: `true` で有効化

### CSVバックアップ

従業員データまたはアイテムデータをCSV形式でバックアップする場合：

```json
{
  "kind": "csv",
  "source": "employees",
  "schedule": "0 5 * * *",
  "enabled": true
}
```

または

```json
{
  "kind": "csv",
  "source": "items",
  "schedule": "0 5 * * *",
  "enabled": true
}
```

**設定項目**:
- `kind`: `"csv"` を指定
- `source`: `"employees"` または `"items"` を指定
- `schedule`: cron形式のスケジュール
- `enabled`: `true` で有効化

### 画像ファイルバックアップ

写真ストレージディレクトリをバックアップする場合：

```json
{
  "kind": "image",
  "source": "photo-storage",
  "schedule": "0 6 * * *",
  "enabled": true,
  "metadata": {
    "label": "photo-backup"
  }
}
```

**設定項目**:
- `kind`: `"image"` を指定
- `source`: `"photo-storage"` を指定（`PHOTO_STORAGE_DIR` 環境変数で指定されたディレクトリをバックアップ）
- `schedule`: cron形式のスケジュール
- `enabled`: `true` で有効化
- `metadata.label`: バックアップファイル名に使用されるラベル（オプション）

### ファイルバックアップ

特定のファイルをバックアップする場合：

```json
{
  "kind": "file",
  "source": "/path/to/file.txt",
  "schedule": "0 3 * * *",
  "enabled": true
}
```

**設定項目**:
- `kind`: `"file"` を指定
- `source`: バックアップ対象のファイルパス
- `schedule`: cron形式のスケジュール
- `enabled`: `true` で有効化

### ディレクトリバックアップ

ディレクトリ全体をバックアップする場合：

```json
{
  "kind": "directory",
  "source": "/path/to/directory",
  "schedule": "0 2 * * *",
  "enabled": true
}
```

**設定項目**:
- `kind`: `"directory"` を指定
- `source`: バックアップ対象のディレクトリパス
- `schedule`: cron形式のスケジュール
- `enabled`: `true` で有効化

## スケジュール設定（cron形式）

スケジュールはcron形式で指定します：

```
分 時 日 月 曜日
```

**例**:
- `"0 4 * * *"`: 毎日4時0分
- `"0 */6 * * *"`: 6時間ごと
- `"0 0 * * 0"`: 毎週日曜日の0時
- `"0 0 1 * *"`: 毎月1日の0時
- `"*/30 * * * *"`: 30分ごと

**注意**: タイムゾーンはサーバーのシステムタイムゾーンに従います。

## 保持期間の設定

古いバックアップを自動削除する設定：

```json
{
  "retention": {
    "days": 30,
    "maxBackups": 100
  }
}
```

**設定項目**:
- `days`: バックアップを保持する日数（デフォルト: 30日）
- `maxBackups`: 最大バックアップ数（オプション、指定した場合は日数に関係なく最大数まで保持）

## バックアップパス構造の仕様

バックアップ機能では、APIレスポンスの`path`と実際のファイルパスが異なる形式で返されます。

### APIレスポンスの`path`形式

APIレスポンスの`path`は**相対パス**で返されます：

```
{type}/{timestamp}/{source}.{extension}
```

**例**:
- `csv/2025-12-15T00-42-04-953Z/employees.csv`
- `csv/2025-12-15T00-42-04-953Z/items.csv`
- `database/2025-12-15T00-40-00-000Z/borrow_return.sql`

**注意**: `backups/`プレフィックスは含まれません。これは`LocalStorageProvider`の`getBaseDir()`と結合するためです。

### 実際のファイルパス

実際のファイルパスは以下のように構成されます：

```
{getBaseDir()}/{path}
```

**ローカルストレージの場合**:
- `getBaseDir()`: `/opt/RaspberryPiSystem_002/backups`（`options.basePath`の値）
- 完全パス例: `/opt/RaspberryPiSystem_002/backups/csv/2025-12-15T00-42-04-953Z/employees.csv`

**Dropboxストレージの場合**:
- `getBaseDir()`: `/backups`（`options.basePath`の値、デフォルト）
- 完全パス例: `/backups/csv/2025-12-15T00-42-04-953Z/employees.csv`

### ファイル拡張子

- **CSVバックアップ**: 自動的に`.csv`拡張子が付与されます
- **データベースバックアップ**: `.sql`拡張子が付与されます
- **その他のバックアップ**: タイプに応じた拡張子が付与されます

**動作**:
- `days` を超えたバックアップは自動削除されます
- `maxBackups` が指定されている場合、古いバックアップから順に削除されます
- 保持期間のチェックと削除は、スケジュールバックアップ実行時に自動的に行われます

**実装の詳細**:
- バックアップスケジューラーがバックアップを実行した後、`cleanupOldBackups()`メソッドが自動的に呼び出されます
- 保持期間を超えたバックアップは、`modifiedAt`（最終更新日時）を基準に判定されます
- `maxBackups`が指定されている場合、まず最大数を超える古いバックアップが削除され、その後保持期間を超えたバックアップが削除されます

## デフォルト設定

設定ファイルが存在しない場合、以下のデフォルト設定が使用されます：

```json
{
  "storage": {
    "provider": "local",
    "options": {
      "basePath": "/opt/RaspberryPiSystem_002/backups"
    }
  },
  "targets": [
    {
      "kind": "database",
      "source": "postgresql://postgres:postgres@localhost:5432/borrow_return",
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
  ],
  "retention": {
    "days": 30,
    "maxBackups": 100
  }
}
```

## 設定ファイルの作成・編集

### 設定ファイルの作成

1. 設定ディレクトリを作成（存在しない場合）:
   ```bash
   sudo mkdir -p /opt/RaspberryPiSystem_002/config
   ```

2. 設定ファイルを作成:
   ```bash
   sudo nano /opt/RaspberryPiSystem_002/config/backup.json
   ```

3. JSON形式で設定を記述（上記の例を参考）

4. 設定ファイルの権限を設定:
   ```bash
   sudo chown root:root /opt/RaspberryPiSystem_002/config/backup.json
   sudo chmod 600 /opt/RaspberryPiSystem_002/config/backup.json
   ```

### 設定ファイルの編集

設定ファイルを編集した後、APIサーバーを再起動すると新しい設定が読み込まれます：

```bash
cd /opt/RaspberryPiSystem_002
docker compose -f infrastructure/docker/docker-compose.server.yml restart api
```

または、APIエンドポイントから設定を更新することもできます（管理者権限が必要）：

```bash
curl -X PUT http://localhost:8080/api/backup/config \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -d @backup.json
```

## APIエンドポイント

### 設定の取得

```bash
curl http://localhost:8080/api/backup/config \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
```

### 設定の更新

```bash
curl -X PUT http://localhost:8080/api/backup/config \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -d @backup.json
```

### 手動バックアップの実行

```bash
curl -X POST http://localhost:8080/api/backup \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -d '{
    "kind": "csv",
    "source": "employees",
    "metadata": {
      "label": "manual-backup"
    }
  }'
```

### バックアップ一覧の取得

```bash
curl http://localhost:8080/api/backup \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
```

## トラブルシューティング

### 設定ファイルが見つからない

**症状**: ログに「Config file not found, using default config」が表示される

**対処**: 
- 設定ファイルが正しい場所に存在するか確認
- `BACKUP_CONFIG_PATH` 環境変数が設定されているか確認

### バックアップが実行されない

**症状**: スケジュール設定した時間にバックアップが実行されない

**対処**:
- `enabled: true` が設定されているか確認
- cron形式のスケジュールが正しいか確認
- APIサーバーのログを確認（`docker logs api`）

### Dropboxへのアップロードが失敗する

**症状**: Dropboxへのバックアップが失敗する

**対処**:
- アクセストークンが正しく設定されているか確認
- Dropboxアプリの権限（scopes）が正しく設定されているか確認
- ネットワーク接続を確認
- APIサーバーのログを確認

### バックアップファイルが見つからない

**症状**: バックアップ一覧に表示されない

**対処**:
- ストレージプロバイダーの設定（`basePath`）を確認
- ファイルシステムの権限を確認
- バックアップが実際に作成されているか確認（ローカルストレージの場合）

## セキュリティ考慮事項

1. **設定ファイルの権限**: 設定ファイルには機密情報（Dropboxアクセストークンなど）が含まれるため、適切な権限（600）を設定してください

2. **アクセストークンの管理**: Dropboxアクセストークンは環境変数で管理することも検討してください

3. **バックアップの暗号化**: 機密情報を含むバックアップは暗号化することを推奨します

4. **ネットワークセキュリティ**: Dropboxへの通信はTLS 1.2以上で保護され、証明書ピニングが実装されています

## 関連ドキュメント

- [バックアップ・リストア手順](./backup-and-restore.md): 従来のスクリプトベースのバックアップ手順
- [Dropbox連携セットアップガイド](./dropbox-setup-guide.md): Dropboxアカウントとの連携手順
- [モニタリングガイド](./monitoring.md): バックアップの監視方法
