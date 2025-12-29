# バックアップリストア機能の実機検証実行手順

最終更新: 2025-12-29

## 概要

本ドキュメントでは、実機検証を実際に実行する際の具体的な手順を説明します。

## 検証環境

- **Raspberry Pi 5**: サーバー（API/DB/Web UI）
- **管理コンソール**: `https://100.106.158.2/admin`

## 検証1: CSVデータのリストア（Dropbox経由）

### ステップ1: バックアップ履歴の確認

1. **管理コンソールにログイン**
   - `https://100.106.158.2/admin` にアクセス
   - ユーザー名: `admin`
   - パスワード: `admin1234`

2. **バックアップ履歴ページを開く**
   - 「バックアップ」タブをクリック
   - 「バックアップ履歴」をクリック

3. **DropboxのCSVバックアップを探す**
   - フィルターで以下を設定:
     - `storageProvider: dropbox`
     - `targetKind: csv`
     - `status: COMPLETED`
   - 最新の履歴を選択
   - `path`フィールドの値をコピー（例: `/backups/csv/2025-12-29T00-00-01-695Z/employees.csv`）

### ステップ2: リストア前のデータ確認

SSH経由でRaspberry Piに接続して、現在のデータベースの状態を確認:

```bash
# SSH接続
ssh denkon5sd02@100.106.158.2

# データベースの現在の状態を確認
docker compose -f /opt/RaspberryPiSystem_002/infrastructure/docker/docker-compose.server.yml exec -T db psql -U postgres -d borrow_return -c "SELECT COUNT(*) FROM \"Employee\";"
docker compose -f /opt/RaspberryPiSystem_002/infrastructure/docker/docker-compose.server.yml exec -T db psql -U postgres -d borrow_return -c "SELECT \"employeeCode\", \"displayName\" FROM \"Employee\" LIMIT 5;"
```

**記録**: 現在の従業員数を記録してください。

### ステップ3: リストア実行

1. **管理コンソールでリストアを実行**
   - 「バックアップ」タブ → 「Dropboxからリストア」をクリック
   - バックアップパスを入力（ステップ1でコピーした値）
   - 対象種類を選択: `csv`
   - 「リストア実行」ボタンをクリック

2. **リストア結果の確認**
   - バックアップ履歴ページで、新しいリストア履歴が作成されていることを確認
   - `status: COMPLETED`になっていることを確認
   - `storageProvider: dropbox`になっていることを確認

### ステップ4: リストア後のデータ確認

SSH経由でRaspberry Piに接続して、リストア後のデータベースの状態を確認:

```bash
# リストア後のデータ数を確認
docker compose -f /opt/RaspberryPiSystem_002/infrastructure/docker/docker-compose.server.yml exec -T db psql -U postgres -d borrow_return -c "SELECT COUNT(*) FROM \"Employee\";"
docker compose -f /opt/RaspberryPiSystem_002/infrastructure/docker/docker-compose.server.yml exec -T db psql -U postgres -d borrow_return -c "SELECT \"employeeCode\", \"displayName\" FROM \"Employee\" LIMIT 5;"
```

**検証結果**:
- ✅ リストアが成功し、`status: COMPLETED`になる
- ✅ データベースのレコード数が期待通りに更新される
- ✅ データの内容が正しい（従業員コード、氏名など）

---

## 検証2: データベースのリストア（Dropbox経由）

### ステップ1: バックアップ履歴の確認

1. **管理コンソールでバックアップ履歴を確認**
   - 「バックアップ」タブ → 「バックアップ履歴」
   - フィルターで以下を設定:
     - `storageProvider: dropbox`
     - `targetKind: database`
     - `status: COMPLETED`
   - 最新の履歴を選択
   - `path`フィールドの値をコピー（例: `/backups/database/2025-12-29T00-00-01-695Z/borrow_return.sql.gz`）

### ステップ2: リストア前のデータ確認

```bash
# データベースの現在の状態を確認
docker compose -f /opt/RaspberryPiSystem_002/infrastructure/docker/docker-compose.server.yml exec -T db psql -U postgres -d borrow_return -c "SELECT COUNT(*) FROM \"Employee\";"
docker compose -f /opt/RaspberryPiSystem_002/infrastructure/docker/docker-compose.server.yml exec -T db psql -U postgres -d borrow_return -c "SELECT COUNT(*) FROM \"Item\";"
docker compose -f /opt/RaspberryPiSystem_002/infrastructure/docker/docker-compose.server.yml exec -T db psql -U postgres -d borrow_return -c "SELECT COUNT(*) FROM \"Loan\";"
```

**記録**: 現在の各テーブルのレコード数を記録してください。

### ステップ3: リストア実行

1. **管理コンソールでリストアを実行**
   - 「バックアップ」タブ → 「Dropboxからリストア」
   - **バックアップ履歴から選択**（ドロップダウンで選択可能）
     - `operationType: BACKUP`
     - `status: COMPLETED`
     - `storageProvider: dropbox`
     - `targetKind: database`
     - `fileStatus: EXISTS`（推奨、チェックボックスでフィルタ可能）
   - 対象種類を選択: `database`
   - 「リストア実行」ボタンをクリック
   
   **注意**: `fileStatus: DELETED`のバックアップを選択した場合、警告が表示されます。リストアは失敗する可能性が高いため、`fileStatus: EXISTS`のバックアップを選択することを推奨します。

2. **リストア結果の確認**
   - バックアップ履歴ページで、新しいリストア履歴が作成されていることを確認
   - `status: COMPLETED`になっていることを確認
   - `storageProvider: dropbox`になっていることを確認

### ステップ4: リストア後のデータ確認

```bash
# リストア後のデータ数を確認
docker compose -f /opt/RaspberryPiSystem_002/infrastructure/docker/docker-compose.server.yml exec -T db psql -U postgres -d borrow_return -c "SELECT COUNT(*) FROM \"Employee\";"
docker compose -f /opt/RaspberryPiSystem_002/infrastructure/docker/docker-compose.server.yml exec -T db psql -U postgres -d borrow_return -c "SELECT COUNT(*) FROM \"Item\";"
docker compose -f /opt/RaspberryPiSystem_002/infrastructure/docker/docker-compose.server.yml exec -T db psql -U postgres -d borrow_return -c "SELECT COUNT(*) FROM \"Loan\";"
```

**検証結果**:
- ✅ リストアが成功し、`status: COMPLETED`になる
- ✅ データベースの全テーブルのレコード数が期待通りに更新される
- ✅ データの整合性が保たれている（外部キー制約など）

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

## 検証結果の記録

検証完了後、以下の情報を記録してください：

- **検証日時**: YYYY-MM-DD HH:MM:SS
- **検証者**: 名前
- **検証結果**: ✅ 成功 / ❌ 失敗
- **検証内容**: 
  - CSVデータのリストア: ✅ / ❌
  - データベースのリストア: ✅ / ❌
- **発見された問題**: （あれば）
- **備考**: （あれば）

---

## 関連ドキュメント

- [バックアップリストア機能の実機検証手順](./backup-restore-verification.md)
- [バックアップAPI仕様](../api/backup.md)
