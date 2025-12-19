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

最終更新: 2025-12-19

## アーキテクチャ改善（2025-12-19）

バックアップロジックのモジュール化、疎結合、拡張性を向上させるため、Factoryパターンとレジストリパターンを実装しました。

### 改善内容

- **BackupTargetFactory**: レジストリパターンによるバックアップターゲットの動的登録
- **StorageProviderFactory**: ストレージプロバイダー作成ロジックの共通化
- **リストアロジックの分離**: 各ターゲットが自身のリストアロジックを実装
- **設定ファイルによるパスマッピング管理**: `pathMappings`フィールドでDockerコンテナ内のパスマッピングを管理

詳細は [requirements/backup-target-management-ui.md](../requirements/backup-target-management-ui.md#phase-7-バックアップロジックのアーキテクチャ改善--完了) を参照してください。

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

**バックアップ形式**:
- 画像バックアップは`tar.gz`形式で保存されます
- 写真ディレクトリ（`photos`）とサムネイルディレクトリ（`thumbnails`）が含まれます
- JPEGファイルはそのまま含まれているため、リストア後に正常に使用できます

**リストア処理**:
- リストア時には`tar.gz`を自動的に展開して、写真ディレクトリとサムネイルディレクトリに復元します
- 既存のディレクトリは自動的にバックアップされます（タイムスタンプ付きでリネーム）
- API経由（`/api/backup/restore/from-dropbox`）または手動でリストア可能です

### クライアント端末ファイルバックアップ

クライアント端末（Pi4、Pi3など）のファイルをAnsible経由でバックアップする場合：

```json
{
  "kind": "client-file",
  "source": "raspberrypi4:/opt/RaspberryPiSystem_002/clients/nfc-agent/.env",
  "schedule": "0 4 * * *",
  "enabled": true
}
```

**設定項目**:
- `kind`: `"client-file"` を指定
- `source`: `"hostname:/path/to/file"` 形式で指定
  - `hostname`: Ansible inventoryに登録されているホスト名（例: `raspberrypi4`）
  - `/path/to/file`: クライアント端末上のファイルパス（例: `/opt/RaspberryPiSystem_002/clients/nfc-agent/.env`）
- `schedule`: cron形式のスケジュール
- `enabled`: `true` で有効化

**動作**:
- Ansible Playbook（`infrastructure/ansible/playbooks/backup-clients.yml`）を使用してクライアント端末からファイルを取得
- `ansible fetch`モジュールでリモートファイルをPi5（サーバー）に取得
- 取得したファイルをバックアップストレージ（ローカルまたはDropbox）に保存

**前提条件**:
- AnsibleがPi5（サーバー）にインストールされていること（Dockerコンテナ内にインストール済み）
- Ansible inventory（`infrastructure/ansible/inventory.yml`）にクライアント端末が登録されていること
- Pi5からクライアント端末へのSSH接続が可能であること（パスワード認証またはSSH鍵認証）
- SSH鍵がDockerコンテナ内にマウントされていること（`docker-compose.server.yml`で`/home/denkon5sd02/.ssh:/root/.ssh:ro`をマウント）
- `group_vars/all.yml`の`network_mode`が正しく設定されていること（`local`または`tailscale`）

**AnsibleとTailscale連携の注意事項**:

- **変数展開の仕組み**:
  - Ansible Playbookは`hosts: "{{ client_host }}"`で実行されるため、`inventory.yml`の変数が正しく展開される
  - `network_mode: "tailscale"`の場合、`kiosk_ip`は`tailscale_network.raspberrypi4_ip`に解決される
  - `network_mode: "local"`の場合、`kiosk_ip`は`local_network.raspberrypi4_ip`に解決される
  - 詳細は [Ansible SSH接続アーキテクチャの説明](./ansible-ssh-architecture.md) と [KB-102](../knowledge-base/infrastructure.md#kb-102-ansibleによるクライアント端末バックアップ機能実装時のansibleとtailscale連携問題) を参照

- **エラーハンドリング**:
  - ファイルが存在しない場合、404エラーが返される
  - SSH接続エラーの場合、500エラーが返される
  - エラーメッセージには、ファイルパスとアクセス権限の可能性が記載される

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

## 管理コンソールからの設定管理

バックアップ設定は、管理コンソールの「バックアップ」タブ（`/admin/backup/targets`）から管理できます。

### バックアップ対象の管理

**機能**:
- **一覧表示**: 現在の`targets`配列の内容を表示
- **追加**: 新しい`target`を追加（`kind`、`source`、`schedule`、`enabled`を設定）
- **編集**: 既存の`target`の`schedule`や`enabled`状態を編集
- **削除**: 不要な`target`を削除
- **有効/無効切り替え**: 各対象の`enabled`フラグをトグルスイッチで切り替え
- **手動実行**: 特定のバックアップ対象を手動で実行

**使用方法**:
1. 管理コンソールにログイン（`https://<pi5>/admin`）
2. 「バックアップ」タブをクリック
3. バックアップ対象一覧が表示される
4. 「追加」ボタンで新しい対象を追加、または既存の対象を編集・削除

**設定ファイルとの連携**:
- 管理コンソールでの変更は即座に設定ファイル（`backup.json`）に反映される
- `backup.sh`スクリプトは設定ファイルの`targets`配列を参照してバックアップを実行する
- 管理コンソールと`backup.sh`スクリプトの機能が整合性を保つ

詳細は [バックアップ対象管理UI実装計画](../requirements/backup-target-management-ui.md) と [バックアップ対象管理UI実機検証手順](./backup-target-management-verification.md) を参照してください。

## 関連ドキュメント

- [バックアップ・リストア手順](./backup-and-restore.md): 従来のスクリプトベースのバックアップ手順
- [Dropbox連携セットアップガイド](./dropbox-setup-guide.md): Dropboxアカウントとの連携手順
- [モニタリングガイド](./monitoring.md): バックアップの監視方法
- [バックアップ対象管理UI実装計画](../requirements/backup-target-management-ui.md): 管理コンソールからのバックアップ対象管理機能の実装計画
- [バックアップ対象管理UI実機検証手順](./backup-target-management-verification.md): 実機検証手順
