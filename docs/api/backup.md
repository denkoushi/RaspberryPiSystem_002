# バックアップAPI

最終更新: 2026-01-06

## 概要

バックアップAPIは、データベース、ファイル、CSV、画像などのバックアップとリストア機能を提供します。ローカルストレージとDropboxの両方に対応しており、バックアップ対象ごとにストレージプロバイダーを指定できます。

## 認証

すべてのエンドポイントは管理者権限（`ADMIN`ロール）が必要です。`Authorization: Bearer <token>`ヘッダーにJWTアクセストークンを含めてリクエストしてください。

## エンドポイント

### バックアップ実行

#### POST /api/backup

手動でバックアップを実行します。複数のストレージプロバイダーへの同時バックアップ（多重バックアップ）に対応しています。

**リクエスト**

```json
{
  "kind": "database" | "file" | "directory" | "csv" | "image" | "client-file" | "client-directory",
  "source": "postgresql://postgres:postgres@db:5432/borrow_return",
  "metadata": {
    "label": "手動バックアップ"
  }
}
```

**パラメータ**

- `kind` (必須): バックアップ対象の種類
  - `database`: データベース
  - `file`: 単一ファイル（Pi5上のローカルファイル）
  - `directory`: ディレクトリ（Pi5上のローカルディレクトリ）
  - `csv`: CSVデータ（`employees`、`items`など）
  - `image`: 画像データ（写真・サムネイル）
  - `client-file`: クライアント端末のファイル（Ansible経由、Pi3/Pi4など）
  - `client-directory`: クライアント端末のディレクトリ（Ansible経由、Pi3/Pi4など）
- `source` (必須): バックアップ対象のソース
  - `database`: データベース接続文字列（例: `postgresql://postgres:postgres@db:5432/borrow_return`）
  - `file`: ファイルパス（例: `/opt/RaspberryPiSystem_002/apps/api/.env`）
  - `csv`: CSVデータソース名（例: `employees`、`items`）
  - `image`: 画像ストレージタイプ（例: `photo-storage`、`thumbnail-storage`）
- `metadata` (オプション): メタデータ
  - `label`: バックアップのラベル

**レスポンス**

```json
{
  "success": true,
  "path": "/backups/database/2025-12-29T00-00-01-695Z/borrow_return.sql.gz",
  "sizeBytes": 12345,
  "timestamp": "2025-12-29T00:00:01.695Z",
  "historyId": "a6330b33-e141-4224-b105-ca52c99e342f",
  "providers": [
    { "provider": "dropbox", "success": true },
    { "provider": "local", "success": true }
  ]
}
```

**エラー**

- `400` - バリデーションエラー（`kind`または`source`が不正）
- `401` - 認証エラー
- `403` - 権限エラー（管理者権限が必要）
- `500` - バックアップ失敗（すべてのプロバイダーで失敗した場合）

**動作**

1. 設定ファイル（`backup.json`）から対象設定を検索
2. 対象設定の`storage.providers`または`storage.provider`を取得（未指定時は全体設定を使用）
3. 各プロバイダーに順次バックアップを実行
4. バックアップ履歴に記録（実際に使用されたプロバイダーを記録）
5. バックアップ実行後、保持期間設定に基づいて古いバックアップを自動削除

**注意（トークンの分離・provider別名前空間）**:
- `backup.json` の `storage.options` にはDropboxとGmailのOAuth設定が保存され得ますが、**トークンは衝突しないよう分離**されています：
  - **新構造（推奨）**: provider別名前空間を使用
    - **Dropbox**: `storage.options.dropbox.*` (`accessToken`, `refreshToken`, `appKey`, `appSecret`)
    - **Gmail**: `storage.options.gmail.*` (`accessToken`, `refreshToken`, `clientId`, `clientSecret`, `redirectUri`, `subjectPattern`, `fromEmail`)
  - **旧構造（後方互換）**: フラットなキーも読み取り可能（書き込みは新構造へ自動移行）
    - **Dropbox**: `storage.options.accessToken` / `refreshToken` / `appKey` / `appSecret`
    - **Gmail**: `storage.options.gmailAccessToken` / `gmailRefreshToken` / `clientId` / `clientSecret` / `redirectUri` など
- OAuthコールバック/refresh/onTokenUpdate は全て新構造（`options.dropbox.*`, `options.gmail.*`）へ保存されます
- 既存の `backup.json` は後方互換で動作しますが、新規設定は自動的に新構造へ保存されます

---

### バックアップ一覧取得

#### GET /api/backup

ローカルストレージに保存されているバックアップファイルの一覧を取得します。

**クエリパラメータ**

- `prefix` (オプション): パスプレフィックスでフィルタリング（例: `database`、`csv/employees`）
- `limit` (オプション): 取得件数の上限

**レスポンス**

```json
{
  "backups": [
    {
      "path": "/backups/database/2025-12-29T00-00-01-695Z/borrow_return.sql.gz",
      "sizeBytes": 12345,
      "modifiedAt": "2025-12-29T00:00:01.695Z"
    }
  ]
}
```

**エラー**

- `401` - 認証エラー
- `403` - 権限エラー

---

### バックアップリストア

#### POST /api/backup/restore

ローカルストレージからバックアップをリストアします。

**リクエスト**

```json
{
  "backupPath": "/backups/database/2025-12-29T00-00-01-695Z/borrow_return.sql.gz",
  "destination": "/tmp/restored.sql.gz",
  "storage": {
    "provider": "local",
    "options": {}
  }
}
```

**パラメータ**

- `backupPath` (必須): バックアップファイルのパス
- `destination` (オプション): リストア先のパス（未指定時は元の場所に復元）
- `storage` (オプション): ストレージプロバイダー設定（未指定時はローカルストレージ）

**レスポンス**

```json
{
  "success": true,
  "message": "Backup restored successfully",
  "timestamp": "2025-12-29T00:00:01.695Z"
}
```

**エラー**

- `400` - バリデーションエラー
- `404` - バックアップファイルが見つからない
- `500` - リストア失敗

---

### Dropboxからのリストア

#### POST /api/backup/restore/from-dropbox

Dropboxからバックアップをダウンロードしてリストアします。

**リクエスト**

```json
{
  "backupPath": "/backups/csv/2025-12-29T00-00-01-695Z/employees.csv",
  "targetKind": "csv",
  "verifyIntegrity": true,
  "expectedSize": 12345,
  "expectedHash": "sha256:abc123..."
}
```

**パラメータ**

- `backupPath` (必須): Dropbox上のバックアップファイルのパス（`basePath`を含む完全パスまたは相対パス）
- `targetKind` (オプション): バックアップ対象の種類（`database`、`csv`、`image`）。未指定時はパスから推測
- `verifyIntegrity` (オプション): 整合性検証を実行するか（デフォルト: `true`）
- `expectedSize` (オプション): 期待されるファイルサイズ（バイト）
- `expectedHash` (オプション): 期待されるハッシュ値（SHA256、`sha256:`プレフィックス付き）

**レスポンス**

```json
{
  "success": true,
  "message": "Backup restored successfully",
  "backupPath": "csv/2025-12-29T00-00-01-695Z/employees.csv",
  "originalPath": "/backups/csv/2025-12-29T00-00-01-695Z/employees.csv",
  "timestamp": "2025-12-29T00:00:01.695Z",
  "historyId": "a6330b33-e141-4224-b105-ca52c99e342f"
}
```

**エラー**

- `400` - バリデーションエラー、整合性検証失敗、Dropbox設定が不正
- `404` - バックアップファイルが見つからない
- `500` - リストア失敗

**動作**

1. Dropboxからバックアップファイルをダウンロード
2. 整合性検証（`verifyIntegrity: true`の場合）
3. バックアップターゲットの`restore`メソッドを呼び出してリストア
4. リストア履歴に記録

---

### バックアップ削除

#### DELETE /api/backup/*

バックアップファイルを削除します。パスはURLエンコードが必要です。

**パラメータ**

- パス: バックアップファイルのパス（URLエンコード）

**例**

```
DELETE /api/backup/%2Fbackups%2Fdatabase%2F2025-12-29T00-00-01-695Z%2Fborrow_return.sql.gz
```

**レスポンス**

```json
{
  "success": true
}
```

**エラー**

- `400` - パスが不正
- `404` - バックアップファイルが見つからない
- `500` - 削除失敗

**注意**

- ファイル削除後、対応するバックアップ履歴レコードの`fileStatus`が`DELETED`に更新されます
- 履歴レコード自体は削除されません

---

### バックアップ履歴

#### GET /api/backup/history

バックアップ・リストア履歴の一覧を取得します。フィルタリングとページネーションに対応しています。

**クエリパラメータ**

- `operationType` (オプション): 操作種別（`BACKUP`、`RESTORE`）
- `targetKind` (オプション): バックアップ対象の種類
- `status` (オプション): ステータス（`PENDING`、`PROCESSING`、`COMPLETED`、`FAILED`）
- `startDate` (オプション): 開始日時（ISO 8601形式）
- `endDate` (オプション): 終了日時（ISO 8601形式）
- `offset` (オプション): オフセット（デフォルト: `0`）
- `limit` (オプション): 取得件数（デフォルト: `100`）

**レスポンス**

```json
{
  "history": [
    {
      "id": "a6330b33-e141-4224-b105-ca52c99e342f",
      "operationType": "BACKUP",
      "targetKind": "csv",
      "targetSource": "employees",
      "storageProvider": "dropbox",
      "status": "COMPLETED",
      "fileStatus": "EXISTS",
      "path": "/backups/csv/2025-12-29T00-00-01-695Z/employees.csv",
      "sizeBytes": 12345,
      "hash": "sha256:abc123...",
      "createdAt": "2025-12-29T00:00:01.695Z",
      "completedAt": "2025-12-29T00:00:02.123Z"
    }
  ],
  "total": 100,
  "offset": 0,
  "limit": 100
}
```

**エラー**

- `400` - バリデーションエラー（日時形式が不正など）
- `401` - 認証エラー
- `403` - 権限エラー

---

#### GET /api/backup/history/:id

バックアップ・リストア履歴の詳細を取得します。

**パラメータ**

- `id` (必須): 履歴ID（UUID）

**レスポンス**

```json
{
  "id": "a6330b33-e141-4224-b105-ca52c99e342f",
  "operationType": "BACKUP",
  "targetKind": "csv",
  "targetSource": "employees",
  "storageProvider": "dropbox",
  "status": "COMPLETED",
  "fileStatus": "EXISTS",
  "path": "/backups/csv/2025-12-29T00-00-01-695Z/employees.csv",
  "sizeBytes": 12345,
  "hash": "sha256:abc123...",
  "error": null,
  "createdAt": "2025-12-29T00:00:01.695Z",
  "completedAt": "2025-12-29T00:00:02.123Z"
}
```

**エラー**

- `404` - 履歴が見つからない
- `401` - 認証エラー
- `403` - 権限エラー

---

### バックアップ設定

#### GET /api/backup/config

バックアップ設定ファイル（`backup.json`）の内容を取得します。

**レスポンス**

```json
{
  "storage": {
    "provider": "dropbox",
    "options": {
      "basePath": "/backups",
      "accessToken": "sl.u.AGOKAyeFfm...",
      "refreshToken": "mhzePpDIJ2kAAAA...",
      "appKey": "1k8mig5my0zk0ms",
      "appSecret": "es8m5ngz2vzxlbh"
    }
  },
  "targets": [
    {
      "kind": "database",
      "source": "postgresql://postgres:postgres@db:5432/borrow_return",
      "schedule": "0 4 * * *",
      "enabled": true,
      "storage": {
        "provider": "dropbox"
      },
      "retention": {
        "days": 7,
        "maxBackups": 10
      }
    }
  ],
  "retention": {
    "days": 30,
    "maxBackups": 50
  }
}
```

**エラー**

- `401` - 認証エラー
- `403` - 権限エラー
- `500` - 設定ファイルの読み込み失敗

**注意**

- 環境変数（`${DROPBOX_APP_KEY}`など）は解決済みの値が返されます
- 機密情報（`accessToken`、`refreshToken`、`appSecret`）が含まれるため、適切に管理してください

---

#### PUT /api/backup/config

バックアップ設定ファイル（`backup.json`）を更新します。設定変更後、バックアップスケジューラーが自動的に再読み込みされます。

**リクエスト**

```json
{
  "storage": {
    "provider": "dropbox",
    "options": {
      "basePath": "/backups",
      "accessToken": "${DROPBOX_ACCESS_TOKEN}",
      "refreshToken": "${DROPBOX_REFRESH_TOKEN}",
      "appKey": "${DROPBOX_APP_KEY}",
      "appSecret": "${DROPBOX_APP_SECRET}"
    }
  },
  "targets": [
    {
      "kind": "database",
      "source": "postgresql://postgres:postgres@db:5432/borrow_return",
      "schedule": "0 4 * * *",
      "enabled": true,
      "storage": {
        "providers": ["dropbox", "local"]
      },
      "retention": {
        "days": 7,
        "maxBackups": 10
      }
    }
  ],
  "retention": {
    "days": 30,
    "maxBackups": 50
  }
}
```

**レスポンス**

```json
{
  "success": true
}
```

**エラー**

- `400` - バリデーションエラー（設定ファイルの形式が不正）
- `401` - 認証エラー
- `403` - 権限エラー
- `500` - 設定ファイルの保存失敗

**注意**

- 環境変数は`${VARIABLE_NAME}`形式で指定できます
- 設定変更後、バックアップスケジューラーが自動的に再読み込みされます

---

### バックアップ対象管理

#### POST /api/backup/config/targets

バックアップ対象を追加します。

**リクエスト**

```json
{
  "kind": "csv",
  "source": "employees",
  "schedule": "0 5 * * *",
  "enabled": true,
  "storage": {
    "providers": ["dropbox", "local"]
  },
  "retention": {
    "days": 7,
    "maxBackups": 10
  },
  "metadata": {
    "label": "従業員データ"
  }
}
```

**パラメータ**

- `kind` (必須): バックアップ対象の種類
- `source` (必須): バックアップ対象のソース
- `schedule` (オプション): cron形式のスケジュール（例: `"0 4 * * *"`）
- `enabled` (オプション): 有効/無効（デフォルト: `true`）
- `storage` (オプション): ストレージプロバイダー設定
  - `provider`: 単一プロバイダー（`local`、`dropbox`）
  - `providers`: 複数プロバイダー（Phase 2: 多重バックアップ）
- `retention` (オプション): 保持期間設定
  - `days`: 保持日数
  - `maxBackups`: 最大保持数
- `metadata` (オプション): メタデータ

**レスポンス**

```json
{
  "success": true,
  "index": 0
}
```

**エラー**

- `400` - バリデーションエラー（cron形式が不正など）
- `401` - 認証エラー
- `403` - 権限エラー
- `500` - 設定ファイルの保存失敗

---

#### PUT /api/backup/config/targets/:index

バックアップ対象を更新します。

**パラメータ**

- `index` (必須): バックアップ対象のインデックス（0から始まる）

**リクエスト**

```json
{
  "kind": "csv",
  "source": "employees",
  "schedule": "0 5 * * *",
  "enabled": false,
  "storage": {
    "provider": "dropbox"
  },
  "retention": {
    "days": 14,
    "maxBackups": 20
  }
}
```

**レスポンス**

```json
{
  "success": true
}
```

**エラー**

- `400` - バリデーションエラー
- `404` - 指定されたインデックスの対象が見つからない
- `401` - 認証エラー
- `403` - 権限エラー

---

#### DELETE /api/backup/config/targets/:index

バックアップ対象を削除します。

**パラメータ**

- `index` (必須): バックアップ対象のインデックス（0から始まる）

**レスポンス**

```json
{
  "success": true
}
```

**エラー**

- `404` - 指定されたインデックスの対象が見つからない
- `401` - 認証エラー
- `403` - 権限エラー

---

### Dropbox OAuth認証

#### GET /api/backup/oauth/authorize

Dropbox OAuth認証の認証URLを取得します。

**レスポンス**

```json
{
  "authorizationUrl": "https://www.dropbox.com/oauth2/authorize?client_id=...&response_type=code&token_access_type=offline&redirect_uri=...&state=...",
  "state": "1a49f43e2bc2f0a6431227b076ccb94e47c05a127e67e411f041d94550c40216"
}
```

**エラー**

- `400` - Dropbox App Key/Secretが設定されていない
- `401` - 認証エラー
- `403` - 権限エラー

**手順**

1. このエンドポイントを呼び出して認証URLを取得
2. ブラウザで認証URLにアクセス
3. Dropboxで認証を許可
4. コールバックURL（`/api/backup/oauth/callback`）にリダイレクトされ、`accessToken`と`refreshToken`が自動的に設定ファイルに保存される

---

#### GET /api/backup/oauth/callback

Dropbox OAuth認証のコールバックエンドポイントです。Dropboxからリダイレクトされます。

**クエリパラメータ**

- `code` (必須): 認証コード
- `state` (必須): CSRF保護用のstateパラメータ
- `error` (オプション): エラーコード（認証が拒否された場合など）

**レスポンス**

```json
{
  "success": true,
  "message": "Tokens saved successfully",
  "hasRefreshToken": true
}
```

**エラー**

- `400` - 認証コードが不正、OAuthエラー
- `500` - トークン交換失敗

**注意**

- このエンドポイントは認証不要です（Dropboxからリダイレクトされるため）
- CSRF保護は`state`パラメータで行います

---

#### POST /api/backup/oauth/refresh

リフレッシュトークンを使用してDropboxのアクセストークンを手動で更新します。

**レスポンス**

```json
{
  "success": true,
  "message": "Access token refreshed successfully",
  "hasRefreshToken": true
}
```

**エラー**

- `400` - リフレッシュトークンが設定されていない、トークン更新失敗
- `401` - 認証エラー
- `403` - 権限エラー

**注意**

- 通常は自動的にリフレッシュされますが、手動で更新する場合に使用します
- 更新された`accessToken`は設定ファイルに自動的に保存されます

---

## 内部エンドポイント

### POST /api/backup/internal

`backup.sh`スクリプトから使用するための内部エンドポイントです。localhostからのアクセスのみ許可されます。

**認証**: 不要（localhostからのアクセスのみ）

**リクエスト**

```json
{
  "kind": "database",
  "source": "postgresql://postgres:postgres@db:5432/borrow_return",
  "metadata": {}
}
```

**レスポンス**

```json
{
  "success": true,
  "path": "/backups/database/2025-12-29T00-00-01-695Z/borrow_return.sql.gz",
  "sizeBytes": 12345,
  "timestamp": "2025-12-29T00:00:01.695Z"
}
```

**エラー**

- `403` - localhost以外からのアクセス
- `400` - バリデーションエラー
- `500` - バックアップ失敗

---

## エラーレスポンス

APIは以下の形式でエラーを返します：

```json
{
  "message": "エラーメッセージ",
  "requestId": "req-123",
  "timestamp": "2025-12-29T00:00:01.695Z",
  "errorCode": "ERROR_CODE"
}
```

### HTTPステータスコード

- `200` - 成功
- `400` - バリデーションエラー、リクエストが不正
- `401` - 認証エラー
- `403` - 権限エラー、localhost以外からのアクセス（`/backup/internal`）
- `404` - リソースが見つからない（バックアップファイル、履歴など）
- `500` - サーバーエラー（バックアップ失敗、設定ファイルの読み込み/保存失敗など）

---

## バックアップ対象の種類

### database

PostgreSQLデータベースのバックアップ。`pg_dump`を使用してSQLダンプファイル（`.sql.gz`）を作成します。

**source例**: `postgresql://postgres:postgres@db:5432/borrow_return`

### file

単一ファイルのバックアップ。ファイルをそのままコピーします。

**source例**: `/opt/RaspberryPiSystem_002/apps/api/.env`

### directory

ディレクトリ全体のバックアップ。`tar.gz`形式でアーカイブします。

**source例**: `/opt/RaspberryPiSystem_002/config`

### csv

CSVデータのバックアップ。データベースからCSV形式でエクスポートします。

**source例**: `employees`、`items`

### image

画像データのバックアップ。写真ディレクトリとサムネイルディレクトリを`tar.gz`形式でアーカイブします。

**source例**: `photo-storage`、`thumbnail-storage`

### client-file

クライアント端末（Pi3、Pi4など）のファイルのバックアップ。Ansibleを使用してファイルを取得します。

**source例**: `raspberrypi4:/opt/RaspberryPiSystem_002/clients/nfc-agent/.env`

**注意**: Pi5自身のファイルには使用しないでください。Pi5自身のファイルは`file` kindを使用します。

### client-directory

クライアント端末（Pi3、Pi4など）のディレクトリのバックアップ。Ansibleを使用してディレクトリを`tar.gz`形式でアーカイブして取得します。

**source例**: `raspberrypi3:/var/lib/tailscale`、`raspberrypi4:/home/tools03/.ssh`

**注意**: Pi5自身のディレクトリには使用しないでください。Pi5自身のディレクトリは`directory` kindを使用します。

---

## ストレージプロバイダー

### local

ローカルストレージ。デフォルトの保存先は`/opt/RaspberryPiSystem_002/storage/backups`です。

### dropbox

Dropboxストレージ。OAuth 2.0認証が必要です。

**設定要件**:
- `appKey`: Dropbox App Key
- `appSecret`: Dropbox App Secret
- `refreshToken`: Dropbox Refresh Token（OAuth認証フローで取得）
- `accessToken`: Dropbox Access Token（自動的にリフレッシュされます）

**OAuth認証手順**:
1. `/api/backup/oauth/authorize`を呼び出して認証URLを取得
2. ブラウザで認証URLにアクセス
3. Dropboxで認証を許可
4. コールバックで`accessToken`と`refreshToken`が自動的に保存される

---

## バックアップ履歴のステータス

- `PENDING`: バックアップ/リストアが開始される前
- `PROCESSING`: バックアップ/リストア実行中
- `COMPLETED`: バックアップ/リストア成功
- `FAILED`: バックアップ/リストア失敗

## ファイル存在状態（fileStatus）

- `EXISTS`: バックアップファイルが存在する
- `DELETED`: バックアップファイルが削除された（履歴は保持）

---

## 保持期間設定

バックアップ対象ごとに保持期間を設定できます：

```json
{
  "retention": {
    "days": 7,
    "maxBackups": 10
  }
}
```

- `days`: 保持日数（この日数を超えたバックアップは自動削除）
- `maxBackups`: 最大保持数（この数を超えたバックアップは古いものから自動削除）

対象ごとの設定が優先され、未指定時は全体設定（`config.retention`）を使用します。

---

## 多重バックアップ（Phase 2）

バックアップ対象ごとに複数のストレージプロバイダーを指定できます：

```json
{
  "storage": {
    "providers": ["dropbox", "local"]
  }
}
```

指定されたすべてのプロバイダーに順次バックアップを実行します。1つでも成功すればバックアップは成功とみなされます。

---

## トラブルシューティング

### エラー: "Backup file not found in Dropbox"

**原因**: Dropbox上に指定されたパスのバックアップファイルが存在しない、またはパスが正しくない

**解決策**:
1. バックアップ履歴ページで正しいパスを確認
2. `basePath`を含む完全パスまたは相対パスを指定
3. データベースバックアップの場合は、拡張子（`.sql.gz`）が含まれていることを確認

**関連KB**: [KB-097](../knowledge-base/infrastructure/backup-restore.md#kb-097-csvリストア時のtargetsource拡張子削除修正とデータベースバックアップのパス問題)

---

### エラー: "Invalid CSV source: employees.csv. Must be 'employees' or 'items'"

**原因**: CSVリストア時に`targetSource`がファイル名（`employees.csv`）のままになっている

**解決策**: 
- この問題は修正済みです（2025-12-29）
- リストアAPIが自動的に拡張子を削除します

**関連KB**: [KB-097](../knowledge-base/infrastructure/backup-restore.md#kb-097-csvリストア時のtargetsource拡張子削除修正とデータベースバックアップのパス問題)

---

### エラー: "従業員CSVの解析エラー: 従業員CSVの2行目でエラー: 社員コードは数字4桁である必要があります"

**原因**: バックアップされたCSVデータに、現在のバリデーションルールに適合しないデータが含まれている

**解決策**:
1. バックアップファイルの内容を確認して、問題のあるデータを特定
2. 必要に応じてバリデーションルールを調整、またはデータ形式を修正
3. リストア機能自体は正常動作しているため、データの問題として対応

**関連KB**: [KB-098](../knowledge-base/infrastructure/backup-restore.md#kb-098-csvリストア時のバリデーションエラー問題)

---

### エラー: "Dropbox storage provider is not configured"

**原因**: バックアップ設定ファイルでDropboxが設定されていない

**解決策**:
1. 管理コンソール → 「バックアップ」タブ → 「バックアップ設定」
2. ストレージプロバイダーが`dropbox`になっていることを確認
3. Dropbox OAuth認証が完了していることを確認

**関連KB**: [KB-096](../knowledge-base/infrastructure/backup-restore.md#kb-096-dropboxバックアップ履歴未記録問題refreshtokenからaccesstoken自動取得機能)

---

### エラー: "Dropbox access token is required"

**原因**: Dropboxのアクセストークンが設定されていない

**解決策**:
1. `/api/backup/oauth/authorize`エンドポイントを呼び出してOAuth認証を実行
2. または、`/api/backup/oauth/refresh`エンドポイントを呼び出してトークンをリフレッシュ
3. `refreshToken`が設定されていれば、自動的に`accessToken`が取得されます

**関連KB**: [KB-096](../knowledge-base/infrastructure/backup-restore.md#kb-096-dropboxバックアップ履歴未記録問題refreshtokenからaccesstoken自動取得機能)

---

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

**関連KB**: [KB-107](../knowledge-base/infrastructure/backup-restore.md#kb-107-dropboxストレージプロバイダーのエラーハンドリング改善)

**詳細**: [バックアップエラーハンドリング改善](../guides/backup-error-handling-improvements.md)

---

## 関連ドキュメント

- [バックアップ設定ガイド](../guides/backup-configuration.md)
- [バックアップ・リストア手順](../guides/backup-and-restore.md)
- [バックアップ対象管理UI実装計画](../requirements/backup-target-management-ui.md)
- [Dropbox OAuth設定ガイド](../guides/dropbox-oauth-setup-guide.md)
- [バックアップリストア機能の実機検証結果](../guides/backup-restore-verification-results.md)
- [バックアップスクリプトとの整合性確認結果](../guides/backup-script-integration-verification.md)
- [バックアップエラーハンドリング改善](../guides/backup-error-handling-improvements.md)
