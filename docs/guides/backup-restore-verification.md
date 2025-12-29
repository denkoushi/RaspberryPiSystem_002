# バックアップリストア機能の実機検証手順

最終更新: 2025-12-29

## 概要

本ドキュメントでは、Dropbox経由のバックアップリストア機能の実機検証手順を説明します。

## 検証環境

- **Raspberry Pi 5**: サーバー（API/DB/Web UI）
- **Dropbox**: バックアップストレージ

## 前提条件

- Dropbox OAuth認証が完了し、正しい`refreshToken`が設定されていること
- Dropbox上にバックアップファイルが存在すること
- 管理コンソールにアクセスできること（`https://100.106.158.2/admin`）

## 検証項目

### 検証1: CSVデータのリストア（Dropbox経由）

**目的**: DropboxからCSVバックアップをリストアし、データベースに正しく復元されることを確認

**準備**:
1. バックアップ履歴ページで、Dropboxに保存されているCSVバックアップのパスを確認
   - 管理コンソール → 「バックアップ」タブ → 「バックアップ履歴」
   - `storageProvider: dropbox`、`targetKind: csv`、`status: COMPLETED`の履歴を確認
   - `path`フィールドの値を記録（例: `/backups/csv/2025-12-29T00-00-01-695Z/employees.csv`）

**検証手順**:

1. **リストア前のデータ確認**
   ```bash
   # データベースの現在の状態を確認
   docker compose -f /opt/RaspberryPiSystem_002/infrastructure/docker/docker-compose.server.yml exec -T db psql -U postgres -d borrow_return -c "SELECT COUNT(*) FROM \"Employee\";"
   docker compose -f /opt/RaspberryPiSystem_002/infrastructure/docker/docker-compose.server.yml exec -T db psql -U postgres -d borrow_return -c "SELECT COUNT(*) FROM \"Item\";"
   ```

2. **管理コンソールからリストア実行**
   - 管理コンソール → 「バックアップ」タブ → 「Dropboxからリストア」
   - バックアップパスを入力（例: `/backups/csv/2025-12-29T00-00-01-695Z/employees.csv`）
   - 対象種類を選択（`csv`）
   - 「リストア実行」ボタンをクリック

3. **リストア結果の確認**
   - リストア履歴ページで、`status: COMPLETED`になっていることを確認
   - `storageProvider: dropbox`になっていることを確認

4. **データベースの確認**
   ```bash
   # リストア後のデータ数を確認
   docker compose -f /opt/RaspberryPiSystem_002/infrastructure/docker/docker-compose.server.yml exec -T db psql -U postgres -d borrow_return -c "SELECT COUNT(*) FROM \"Employee\";"
   docker compose -f /opt/RaspberryPiSystem_002/infrastructure/docker/docker-compose.server.yml exec -T db psql -U postgres -d borrow_return -c "SELECT \"employeeCode\", \"displayName\" FROM \"Employee\" LIMIT 5;"
   ```

**期待される結果**:
- ✅ リストアが成功し、`status: COMPLETED`になる
- ✅ データベースのレコード数が期待通りに更新される
- ✅ データの内容が正しい（従業員コード、氏名など）

---

### 検証2: データベースのリストア（Dropbox経由）

**目的**: Dropboxからデータベースバックアップをリストアし、データベースが正しく復元されることを確認

**準備**:
1. バックアップ履歴ページで、Dropboxに保存されているデータベースバックアップのパスを確認
   - `storageProvider: dropbox`、`targetKind: database`、`status: COMPLETED`の履歴を確認
   - `path`フィールドの値を記録（例: `/backups/database/2025-12-29T00-00-01-695Z/borrow_return.sql.gz`）

**検証手順**:

1. **リストア前のデータ確認**
   ```bash
   # データベースの現在の状態を確認
   docker compose -f /opt/RaspberryPiSystem_002/infrastructure/docker/docker-compose.server.yml exec -T db psql -U postgres -d borrow_return -c "SELECT COUNT(*) FROM \"Employee\";"
   docker compose -f /opt/RaspberryPiSystem_002/infrastructure/docker/docker-compose.server.yml exec -T db psql -U postgres -d borrow_return -c "SELECT COUNT(*) FROM \"Item\";"
   docker compose -f /opt/RaspberryPiSystem_002/infrastructure/docker/docker-compose.server.yml exec -T db psql -U postgres -d borrow_return -c "SELECT COUNT(*) FROM \"Loan\";"
   ```

2. **管理コンソールからリストア実行**
   - 管理コンソール → 「バックアップ」タブ → 「Dropboxからリストア」
   - バックアップパスを入力（例: `/backups/database/2025-12-29T00-00-01-695Z/borrow_return.sql.gz`）
   - 対象種類を選択（`database`）
   - 「リストア実行」ボタンをクリック

3. **リストア結果の確認**
   - リストア履歴ページで、`status: COMPLETED`になっていることを確認
   - `storageProvider: dropbox`になっていることを確認

4. **データベースの確認**
   ```bash
   # リストア後のデータ数を確認
   docker compose -f /opt/RaspberryPiSystem_002/infrastructure/docker/docker-compose.server.yml exec -T db psql -U postgres -d borrow_return -c "SELECT COUNT(*) FROM \"Employee\";"
   docker compose -f /opt/RaspberryPiSystem_002/infrastructure/docker/docker-compose.server.yml exec -T db psql -U postgres -d borrow_return -c "SELECT COUNT(*) FROM \"Item\";"
   docker compose -f /opt/RaspberryPiSystem_002/infrastructure/docker/docker-compose.server.yml exec -T db psql -U postgres -d borrow_return -c "SELECT COUNT(*) FROM \"Loan\";"
   ```

**期待される結果**:
- ✅ リストアが成功し、`status: COMPLETED`になる
- ✅ データベースの全テーブルのレコード数が期待通りに更新される
- ✅ データの整合性が保たれている（外部キー制約など）

---

### 検証3: 整合性検証機能の確認

**目的**: バックアップファイルの整合性検証（サイズ・ハッシュ）が正しく動作することを確認

**検証手順**:

1. **バックアップ履歴から整合性情報を取得**
   - 管理コンソール → 「バックアップ」タブ → 「バックアップ履歴」
   - Dropboxに保存されているバックアップの履歴を選択
   - `sizeBytes`と`hash`フィールドの値を記録

2. **整合性検証付きでリストア実行**
   - 管理コンソール → 「バックアップ」タブ → 「Dropboxからリストア」
   - バックアップパスを入力
   - 対象種類を選択
   - 「整合性検証を実行」にチェック
   - `expectedSize`と`expectedHash`を入力（バックアップ履歴から取得した値）
   - 「リストア実行」ボタンをクリック

**期待される結果**:
- ✅ 整合性検証が成功し、リストアが完了する
- ✅ 不正なサイズやハッシュの場合、エラーが返される

---

## API経由での検証（オプション）

### CSVデータのリストア（API経由）

```bash
# 1. ログインしてトークンを取得
TOKEN=$(curl -s -k -X POST https://100.106.158.2/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin1234"}' | jq -r '.accessToken')

# 2. DropboxからCSVバックアップをリストア
curl -X POST https://100.106.158.2/api/backup/restore/from-dropbox \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "backupPath": "/backups/csv/2025-12-29T00-00-01-695Z/employees.csv",
    "targetKind": "csv",
    "verifyIntegrity": true
  }'
```

### データベースのリストア（API経由）

```bash
# 1. ログインしてトークンを取得
TOKEN=$(curl -s -k -X POST https://100.106.158.2/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin1234"}' | jq -r '.accessToken')

# 2. Dropboxからデータベースバックアップをリストア
curl -X POST https://100.106.158.2/api/backup/restore/from-dropbox \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "backupPath": "/backups/database/2025-12-29T00-00-01-695Z/borrow_return.sql.gz",
    "targetKind": "database",
    "verifyIntegrity": true
  }'
```

---

## トラブルシューティング

### エラー: "Dropbox storage provider is not configured"

**原因**: バックアップ設定ファイルでDropboxが設定されていない

**解決策**:
1. 管理コンソール → 「バックアップ」タブ → 「バックアップ設定」
2. ストレージプロバイダーが`dropbox`になっていることを確認
3. Dropbox OAuth認証が完了していることを確認

### エラー: "Dropbox access token is required"

**原因**: Dropboxのアクセストークンが設定されていない

**解決策**:
1. `/api/backup/oauth/authorize`エンドポイントを呼び出してOAuth認証を実行
2. または、`/api/backup/oauth/refresh`エンドポイントを呼び出してトークンをリフレッシュ

### エラー: "Backup integrity verification failed"

**原因**: バックアップファイルのサイズまたはハッシュが一致しない

**解決策**:
1. バックアップ履歴から正しい`sizeBytes`と`hash`を確認
2. `verifyIntegrity: false`にしてリストアを試行（整合性検証をスキップ）

### エラー: "Backup file not found"

**原因**: Dropbox上に指定されたパスのバックアップファイルが存在しない

**解決策**:
1. バックアップ履歴ページで正しいパスを確認
2. `basePath`を含む完全パスまたは相対パスを指定

---

## 検証結果の記録

検証完了後、以下の情報を記録してください：

- **検証日時**: YYYY-MM-DD HH:MM:SS
- **検証者**: 名前
- **検証結果**: ✅ 成功 / ❌ 失敗
- **検証内容**: 
  - CSVデータのリストア: ✅ / ❌
  - データベースのリストア: ✅ / ❌
  - 整合性検証: ✅ / ❌
- **発見された問題**: （あれば）
- **備考**: （あれば）

---

## 関連ドキュメント

- [バックアップAPI仕様](../api/backup.md)
- [バックアップ・リストア手順](./backup-and-restore.md)
- [バックアップ設定ガイド](./backup-configuration.md)
