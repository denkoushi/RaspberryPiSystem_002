---
title: バックアップ設定ガイド
tags: [運用, バックアップ, 設定, Dropbox]
audience: [運用者, 開発者]
last-verified: 2026-02-08
related: [backup-and-restore.md, dropbox-setup-guide.md, monitoring.md]
category: guides
update-frequency: medium
---

# バックアップ設定ガイド

最終更新: 2026-02-08（バックアップ改善1–4: 自動検証、設定履歴、リストア安全策、性能/計測を追加）

## バックアップ改善1–4（2026-02-08）

本プロジェクトのバックアップは `backup.json`（端末固有・Git管理外）を正として運用します。改善1–4では「設定の監査性」「復元の安全性」「性能」「定期検証」を強化しました。

### 1) 自動バックアップ検証（systemd timer）

- **月次**: `backup-verify-monthly.timer`（履歴とファイル存在の確認、非破壊）
- **四半期**: `backup-verify-quarterly.timer`（必要に応じて小さな検証用ダウンロードを実施）

ログ確認例:

```bash
sudo journalctl -u backup-verify-monthly.service -n 200
sudo journalctl -u backup-verify-quarterly.service -n 200
```

詳細は [バックアップ検証チェックリスト](./backup-verification-checklist.md) を参照してください。

### 2) 設定変更履歴（監査・秘匿）

- **管理UI**: `/admin/backup/config-history` で設定変更履歴を閲覧可能
- **注意**: 履歴に保存されるスナップショットは **秘匿情報（token/secret等）をredact** して保存します（生値は保存しません）

### 3) リストア安全策（事前バックアップ/ドライラン）

- **事前バックアップ（preBackup）**: データベースのリストアは既定で事前バックアップを作成し、失敗時はリストアを中断します
- **ドライラン**: 実行前に対象・存在・サイズ等の確認を行うAPIを追加（破壊的操作なし）

詳細は [バックアップ・リストア手順](./backup-and-restore.md) を参照してください。

### 4) 性能/計測（運用で効く最小改善）

- **CSVバックアップ**: ページングで生成し、メモリ使用量のスパイクを抑制
- **directoryバックアップ**: `tar -czf -` のストリーミングで一時ファイルI/Oを削減
- **履歴への計測**: バックアップ履歴に `durationMs` や `provider` を記録（遅延/劣化の検知に利用）

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
      "basePath": "/opt/backups",
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
      "basePath": "/opt/backups"
    }
  }
}
```

**設定項目**:
- `provider`: `"local"` を指定
- `options.basePath`: バックアップファイルの保存先ディレクトリ（デフォルト: `/opt/backups`）

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
  - 詳細は [Ansible SSH接続アーキテクチャの説明](./ansible-ssh-architecture.md) と [KB-102](../knowledge-base/infrastructure/backup-restore.md#kb-102-ansibleによるクライアント端末バックアップ機能実装時のansibleとtailscale連携問題) を参照

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

#### 証明書ディレクトリのバックアップ（推奨）

Pi5の証明書ディレクトリ（`/opt/RaspberryPiSystem_002/certs/`）をバックアップする場合は、APIコンテナから参照可能なパス（`/app/host/certs`）を指定します。

```json
{
  "kind": "directory",
  "source": "/app/host/certs",
  "schedule": "0 4 * * 0",
  "enabled": true,
  "storage": {
    "provider": "dropbox"
  },
  "retention": {
    "days": 90,
    "maxBackups": 10
  }
}
```

**証明書ディレクトリのバックアップターゲット追加方法**:

証明書ディレクトリのバックアップターゲットを追加するには、以下のいずれかの方法を使用できます：

**方法1: Node.jsスクリプトを使用（推奨）**

Pi5上で以下のコマンドを実行：

```bash
cd /opt/RaspberryPiSystem_002
# Dockerコンテナ内で実行
docker compose -f infrastructure/docker/docker-compose.server.yml exec api node /app/scripts/server/add-cert-backup-target.mjs
```

スクリプトは自動的に`backup.json`に証明書ディレクトリのバックアップターゲットを追加します。

**方法2: Ansible Playbookを使用**

Macから実行：

```bash
cd infrastructure/ansible
ansible-playbook -i inventory.yml playbooks/add-cert-backup-target.yml
```

**方法3: 管理コンソールから手動追加**

1. 管理コンソールの「バックアップ」タブにアクセス
2. 「バックアップ対象を追加」ボタンをクリック
3. 以下の設定を入力：
   - **種類**: `directory`
   - **ソース**: `/app/host/certs`
   - **スケジュール**: `0 4 * * 0`（週次、日曜日4時）
   - **ストレージプロバイダー**: `dropbox`
   - **保持期間**: 90日
   - **最大保持数**: 10件
4. 「追加」ボタンをクリック

**追加後の確認**:

追加後、以下の手順で動作確認を行ってください：

1. **設定の確認**:
   ```bash
   # Pi5上で実行
   cat /opt/RaspberryPiSystem_002/config/backup.json | jq '.targets[] | select(.source == "/app/host/certs")'
   ```

2. **手動バックアップの実行**:
   - 管理コンソールの「バックアップ」タブから手動実行
   - または、API経由で実行（JWTトークンが必要）：
     ```bash
     curl -k -X POST https://localhost/api/backup \
       -H "Content-Type: application/json" \
       -H "Authorization: Bearer <your-token>" \
       -d '{"kind": "directory", "source": "/app/host/certs"}'
     ```

3. **バックアップ履歴の確認**:
   - 管理コンソールの「バックアップ履歴」タブで確認
   - Dropbox上にバックアップファイルが作成されていることを確認
```

**ポイント**:
- `/app/host/certs` はホスト側の `/opt/RaspberryPiSystem_002/certs` をマウントしたパスです。
- 証明書は変更頻度が低いため週次バックアップで十分です。
- 紛失時の影響が大きいため、保持期間は長めを推奨します。

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
- `maxBackups`: 最大バックアップ数（オプション）

**重要（実装上の注意）**:
- 現行実装では、保持期間のクリーンアップ処理は `retention.days` が設定されている場合にのみ実行されます。
- そのため、**`maxBackups`のみで運用したい場合でも、暫定的に`days`を併記**してください（例: `days: 3650, maxBackups: 10`）。
  - ※ `maxBackups`単独でも動くべきですが、現時点では仕様と実装に差があります（改善計画で扱います）。

## バックアップパス構造の仕様

バックアップ機能では、APIレスポンスの`path`と実際のファイルパスが異なる形式で返されます。

### APIレスポンスの`path`形式

APIレスポンスの`path`は、基本的に**`basePath`を含む完全パス**（`/backups/...`）で返されます：

```
/backups/{type}/{timestamp}/{source}.{extension}
```

**例**:
- `/backups/csv/2025-12-15T00-42-04-953Z/employees.csv`
- `/backups/csv/2025-12-15T00-42-04-953Z/items.csv`
- `/backups/database/2025-12-15T00-40-00-000Z/borrow_return.sql.gz`

**注意**:
- 内部実装や一部の入力（例: Dropboxからのリストア）では、`database/...` のような相対パスが渡される場合があります。
- 呼び出し側は、**完全パス（`/backups/...`）と相対パス（`database/...`）の両方が混在し得る**前提で扱ってください（API仕様は `docs/api/backup.md` を正とする）。

### エラーハンドリング（2025-12-29追加）

Dropboxストレージプロバイダーには、以下のエラーハンドリング機能が実装されています：

**レート制限エラー（429）への対応**:
- `upload`、`download`、`delete`メソッドでレート制限エラー（429）時に自動的にリトライ
- `Retry-After`ヘッダーが指定されている場合はその値を使用、それ以外は指数バックオフ（2^retryCount秒、最大30秒）
- 最大リトライ回数: 5回

**ネットワークエラーへの対応**:
- `download`、`delete`メソッドでネットワークエラー（タイムアウト、接続エラーなど）時に自動的にリトライ
- 検出するネットワークエラー: `ETIMEDOUT`、`ECONNRESET`、`ENOTFOUND`、`ECONNREFUSED`、エラーメッセージに`timeout`、`network`、`ECONN`が含まれる場合
- 指数バックオフによるリトライロジック（最大5回、最大30秒）

**効果**:
- レート制限エラーや一時的なネットワークエラーが発生した場合でも、自動的にリトライすることでバックアップ・リストアが成功する可能性が向上
- ログ出力の改善により、リトライ時に詳細なログを出力することで、問題の特定が容易に

詳細は [バックアップエラーハンドリング改善](./backup-error-handling-improvements.md) を参照してください。

### 実際のファイルパス

実際のファイルパスは以下のように構成されます：

```
{getBaseDir()}/{path}
```

**ローカルストレージの場合**:
- `getBaseDir()`: `/opt/backups`（`options.basePath`の値）
- 完全パス例: `/opt/backups/csv/2025-12-15T00-42-04-953Z/employees.csv`

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
      "basePath": "/opt/backups"
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
    },
    {
      "kind": "directory",
      "source": "/app/host/certs",
      "schedule": "0 4 * * 0",
      "enabled": true,
      "storage": {
        "provider": "dropbox"
      },
      "retention": {
        "days": 90,
        "maxBackups": 10
      }
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

設定ファイルを**手動で編集**した後は、以下いずれかで新しい設定を反映します（スケジュール実行も含めて更新されます）：

```bash
cd /opt/RaspberryPiSystem_002
docker compose -f infrastructure/docker/docker-compose.server.yml restart api
```

または、APIエンドポイントから設定を更新することもできます（管理者権限が必要）。この方法では、設定保存後にバックアップスケジューラーが自動で再読み込みされます：

```bash
curl -X PUT http://localhost:8080/api/backup/config \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -d @backup.json
```

**補足**: 管理コンソール（`/admin/backup/targets`）からバックアップ対象や設定を更新した場合も、同様に即時反映されます。

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
   - **証明書更新時の対応**: Dropboxが証明書を更新した場合、証明書ピニング検証が失敗しバックアップが500エラーになることがあります
   - この場合は、`apps/api/scripts/get-dropbox-cert-fingerprint.ts`で新しい証明書フィンガープリントを取得し、`apps/api/src/services/backup/storage/dropbox-cert-pinning.ts`の`DROPBOX_CERTIFICATE_FINGERPRINTS`配列に追加してください
   - 詳細は [KB-199](../knowledge-base/infrastructure/backup-restore.md#kb-199-dropbox証明書ピニング検証失敗によるバックアップ500エラー) を参照してください

## 管理コンソールからの設定管理

バックアップ設定は、管理コンソールの「バックアップ」タブ（`/admin/backup/targets`）から管理できます。

### バックアップ対象の管理

**機能**:
- **一覧表示**: 現在の`targets`配列の内容を表示
- **追加**: 新しい`target`を追加（`kind`、`source`、`schedule`、`enabled`を設定）
- **テンプレート追加**: 代表的な対象をテンプレートから追加（必要なら`source`を上書き）
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
- 設定変更履歴は`/admin/backup/config-history`で確認できる（秘匿情報はredact済み）

詳細は [バックアップ対象管理UI実装計画](../requirements/backup-target-management-ui.md) と [バックアップ対象管理UI実機検証手順](./backup-target-management-verification.md) を参照してください。

## 関連ドキュメント

- [バックアップ・リストア手順](./backup-and-restore.md): 従来のスクリプトベースのバックアップ手順
- [Dropbox連携セットアップガイド](./dropbox-setup-guide.md): Dropboxアカウントとの連携手順
- [モニタリングガイド](./monitoring.md): バックアップの監視方法
- [バックアップ対象管理UI実装計画](../requirements/backup-target-management-ui.md): 管理コンソールからのバックアップ対象管理機能の実装計画
- [バックアップ対象管理UI実機検証手順](./backup-target-management-verification.md): 実機検証手順
- [バックアップスクリプトとの整合性確認結果](./backup-script-integration-verification.md): バックアップスクリプトとの整合性確認結果
- [バックアップエラーハンドリング改善](./backup-error-handling-improvements.md): エラーハンドリング改善の詳細
