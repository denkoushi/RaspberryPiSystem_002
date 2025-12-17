# Phase 3手動検証手順（ステップバイステップ）

最終更新: 2025-12-16

## 概要

このドキュメントでは、Phase 3の機能を実際に動作させるための手動検証手順を、1アクションずつ詳しく説明します。

## 検証環境

- **Raspberry Pi 5**: サーバー（API/DB/Web UI）
- **IPアドレス**: `100.106.158.2`（Tailscale経由）
- **管理画面URL**: `https://100.106.158.2/admin`

---

## ステップ1: 管理画面へのアクセス確認

### 1.1 管理画面にアクセス

1. ブラウザで以下のURLにアクセス：
   ```
   https://100.106.158.2/admin
   ```

2. ログイン画面が表示されることを確認

### 1.2 ログイン情報の確認

- **ユーザー名**: `admin`
- **パスワード**: （実機環境のパスワードを使用）

**注意**: パスワードが不明な場合は、データベースから確認できます：
```bash
ssh denkon5sd02@100.106.158.2 "cd /opt/RaspberryPiSystem_002 && docker compose -f infrastructure/docker/docker-compose.server.yml exec -T db psql -U postgres -d borrow_return -c \"SELECT username, role FROM \\\"User\\\" WHERE role = 'ADMIN';\""
```

---

## ステップ2: 認証トークンの取得

### 2.1 ブラウザの開発者ツールを開く

1. 管理画面にログイン後、ブラウザの開発者ツールを開く（F12キー）
2. 「Network」タブを開く
3. ページをリロード（F5キー）

### 2.2 認証トークンを確認

1. Networkタブで、`/api/auth/login`または`/api/`で始まるリクエストを探す
2. リクエストの「Headers」タブを開く
3. 「Request Headers」セクションで`Authorization: Bearer <トークン>`を確認
4. トークンをコピー（`Bearer `の後の部分）

**または、ブラウザのコンソールで実行**：
```javascript
// ブラウザのコンソール（F12 > Console）で実行
localStorage.getItem('token') || sessionStorage.getItem('token')
```

---

## ステップ3: バックアップ履歴APIのテスト

### 3.1 APIエンドポイントの確認

認証トークンを取得したら、以下のコマンドでAPIをテストします：

```bash
# Pi5上で実行
TOKEN="<取得したトークン>"
curl -X GET 'http://localhost:8080/api/backup/history?limit=5' \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN"
```

**期待される結果**:
```json
{
  "history": [],
  "total": 0,
  "offset": 0,
  "limit": 5
}
```

### 3.2 フィルタ機能のテスト

```bash
# バックアップ操作のみを取得
curl -X GET 'http://localhost:8080/api/backup/history?operationType=BACKUP&limit=10' \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN"

# 特定のステータスでフィルタ
curl -X GET 'http://localhost:8080/api/backup/history?status=COMPLETED&limit=10' \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN"
```

---

## ステップ4: CSVインポート後の自動バックアップ機能のテスト

### 4.1 テスト用CSVファイルの準備

1. テスト用の従業員CSVファイルを作成：
   ```csv
   employeeCode,displayName,nfcTagUid,department,contact,status
   9999,テストユーザー,,テスト部,内線9999,ACTIVE
   ```

2. ファイルを`employees-test.csv`として保存（UTF-8エンコーディング）

### 4.2 DropboxにCSVファイルをアップロード

1. Dropboxにログイン
2. `/backups/csv/`ディレクトリに`employees-test.csv`をアップロード

### 4.3 backup.jsonの設定

1. Pi5にSSH接続：
   ```bash
   ssh denkon5sd02@100.106.158.2
   ```

2. `backup.json`を編集：
   ```bash
   cd /opt/RaspberryPiSystem_002
   nano config/backup.json
   ```

3. `csvImports`セクションに以下を追加：
   ```json
   {
     "csvImports": [
       {
         "id": "test-import",
         "name": "テスト用CSVインポート",
         "schedule": "0 2 * * *",
         "timezone": "Asia/Tokyo",
         "employeesPath": "/backups/csv/employees-test.csv",
         "replaceExisting": false,
         "autoBackupAfterImport": {
           "enabled": true,
           "targets": ["csv"]
         },
         "enabled": true
       }
     ]
   }
   ```

4. 設定ファイルを保存

### 4.4 手動実行でCSVインポートをテスト

1. 管理画面でCSVインポートスケジュールを作成（またはAPIで作成）

2. 手動実行APIを呼び出し：
   ```bash
   TOKEN="<取得したトークン>"
   curl -X POST 'http://localhost:8080/api/imports/schedule/test-import/run' \
     -H 'Content-Type: application/json' \
     -H "Authorization: Bearer $TOKEN"
   ```

3. インポートが成功することを確認

4. バックアップ履歴を確認：
   ```bash
   curl -X GET 'http://localhost:8080/api/backup/history?operationType=BACKUP&limit=5' \
     -H 'Content-Type: application/json' \
     -H "Authorization: Bearer $TOKEN"
   ```

5. 自動バックアップが実行され、`BackupHistory`に記録されていることを確認

---

## ステップ5: Dropboxからのリストア機能のテスト

### 5.1 事前準備：バックアップの作成

1. 手動バックアップAPIを呼び出し：
   ```bash
   TOKEN="<取得したトークン>"
   curl -X POST 'http://localhost:8080/api/backup' \
     -H 'Content-Type: application/json' \
     -H "Authorization: Bearer $TOKEN" \
     -d '{
       "kind": "csv",
       "source": "employees",
       "storage": {
         "provider": "dropbox"
       }
     }'
   ```

2. バックアップが成功することを確認
3. Dropboxにバックアップファイルが作成されていることを確認

### 5.2 Dropboxからのリストア実行

1. リストアAPIを呼び出し：
   ```bash
   TOKEN="<取得したトークン>"
   curl -X POST 'http://localhost:8080/api/backup/restore/from-dropbox' \
     -H 'Content-Type: application/json' \
     -H "Authorization: Bearer $TOKEN" \
     -d '{
       "backupPath": "/backups/csv/2025-12-16T04-00-00-000Z/employees.csv",
       "targetKind": "csv",
       "verifyIntegrity": true
     }'
   ```

2. リストアが成功することを確認

3. バックアップ履歴を確認：
   ```bash
   curl -X GET 'http://localhost:8080/api/backup/history?operationType=RESTORE&limit=5' \
     -H 'Content-Type: application/json' \
     -H "Authorization: Bearer $TOKEN"
   ```

4. リストア履歴が`BackupHistory`に記録されていることを確認

---

## トラブルシューティング

### 認証トークンが取得できない

- 管理画面に正しくログインできているか確認
- ブラウザの開発者ツールで`/api/auth/login`のレスポンスを確認
- トークンが`localStorage`または`sessionStorage`に保存されているか確認

### APIが401エラーを返す

- 認証トークンが正しく設定されているか確認
- トークンの有効期限が切れていないか確認（再ログインが必要な場合あり）
- `Authorization: Bearer <トークン>`の形式が正しいか確認

### CSVインポートが失敗する

- DropboxにCSVファイルが存在するか確認
- CSVファイルのパスが正しいか確認（`backup.json`の`employeesPath`）
- CSVファイルの形式が正しいか確認（UTF-8エンコーディング、ヘッダー行）

### 自動バックアップが実行されない

- `backup.json`の`autoBackupAfterImport.enabled`が`true`になっているか確認
- CSVインポートが成功しているか確認（自動バックアップはインポート成功時にのみ実行される）
- APIログを確認してエラーがないか確認：
  ```bash
  docker compose -f infrastructure/docker/docker-compose.server.yml logs api | grep -i backup
  ```

---

## 検証結果の記録

各ステップの検証結果を記録してください：

- [ ] ステップ1: 管理画面へのアクセス確認
- [ ] ステップ2: 認証トークンの取得
- [ ] ステップ3: バックアップ履歴APIのテスト
- [ ] ステップ4: CSVインポート後の自動バックアップ機能のテスト
- [ ] ステップ5: Dropboxからのリストア機能のテスト

**検証日時**: _______________
**検証者**: _______________
**検証結果**: _______________
