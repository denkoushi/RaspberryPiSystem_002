# Phase 2 実機検証手順

最終更新: 2025-12-15

## 概要

Phase 2で実装したCSVインポートスケジュール機能の実機検証手順です。

## 前提条件

- ✅ Phase 2の実装が完了していること
- ✅ ImportHistoryServiceが有効化されていること
- ✅ Prismaマイグレーションが実行されていること
- ✅ Dropbox OAuth認証が完了していること（`backup.json`にトークンが設定されていること）

## 検証項目

### 1. スケジュール設定APIの動作確認

#### 1.1 スケジュールの追加

```bash
# 管理画面から実行、またはcurlで実行
curl -X POST http://localhost:8080/api/imports/schedule \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <admin-token>" \
  -d '{
    "id": "test-schedule-1",
    "name": "テストスケジュール（毎日0時）",
    "employeesPath": "/test/employees.csv",
    "itemsPath": "/test/items.csv",
    "schedule": "0 0 * * *",
    "enabled": true,
    "replaceExisting": false
  }'
```

**期待される結果**: HTTP 201、スケジュールが追加される

#### 1.2 スケジュール一覧の取得

```bash
curl http://localhost:8080/api/imports/schedule \
  -H "Authorization: Bearer <admin-token>"
```

**期待される結果**: HTTP 200、追加したスケジュールが含まれる

#### 1.3 スケジュールの更新

```bash
curl -X PUT http://localhost:8080/api/imports/schedule/test-schedule-1 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <admin-token>" \
  -d '{
    "name": "テストスケジュール（更新後）",
    "schedule": "0 1 * * *"
  }'
```

**期待される結果**: HTTP 200、スケジュールが更新される

#### 1.4 スケジュールの削除

```bash
curl -X DELETE http://localhost:8080/api/imports/schedule/test-schedule-1 \
  -H "Authorization: Bearer <admin-token>"
```

**期待される結果**: HTTP 200、スケジュールが削除される

### 2. 手動実行APIの動作確認

#### 2.1 スケジュールの手動実行

```bash
# スケジュールを追加
curl -X POST http://localhost:8080/api/imports/schedule \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <admin-token>" \
  -d '{
    "id": "manual-test-1",
    "name": "手動実行テスト",
    "employeesPath": "/test/employees.csv",
    "schedule": "0 0 * * *",
    "enabled": true
  }'

# 手動実行
curl -X POST http://localhost:8080/api/imports/schedule/manual-test-1/run \
  -H "Authorization: Bearer <admin-token>"
```

**期待される結果**: 
- HTTP 200
- CSVインポートが実行される
- インポート履歴が記録される（`CsvImportHistory`テーブルにレコードが追加される）

### 3. スケジュール実行の動作確認

#### 3.1 cronスケジュールの確認

```bash
# スケジュールを追加（1分後に実行されるように設定）
curl -X POST http://localhost:8080/api/imports/schedule \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <admin-token>" \
  -d '{
    "id": "cron-test-1",
    "name": "Cron実行テスト",
    "employeesPath": "/test/employees.csv",
    "schedule": "* * * * *",
    "enabled": true
  }'

# 1分待ってからログを確認
sleep 60
docker compose logs api --tail 50 | grep CsvImportScheduler
```

**期待される結果**:
- 1分後にスケジュールが実行される
- CSVインポートが実行される
- インポート履歴が記録される

#### 3.2 同時実行の防止確認

```bash
# 同じスケジュールを2回連続で手動実行
curl -X POST http://localhost:8080/api/imports/schedule/manual-test-1/run \
  -H "Authorization: Bearer <admin-token>" &
curl -X POST http://localhost:8080/api/imports/schedule/manual-test-1/run \
  -H "Authorization: Bearer <admin-token>"
```

**期待される結果**:
- 2回目の実行がエラーになる（`CSV import is already running`）
- または、1回目の実行が完了するまで2回目が待機する

### 4. インポート履歴の確認

#### 4.1 データベースでの確認

```bash
docker compose exec db psql -U postgres -d borrow_return -c \
  "SELECT id, scheduleId, scheduleName, status, startedAt, completedAt FROM \"CsvImportHistory\" ORDER BY startedAt DESC LIMIT 5;"
```

**期待される結果**: インポート履歴が記録されている

#### 4.2 履歴APIエンドポイントの確認（実装済みの場合）

```bash
# すべての履歴を取得
curl http://localhost:8080/api/imports/history \
  -H "Authorization: Bearer <admin-token>"

# 特定のスケジュールの履歴を取得
curl http://localhost:8080/api/imports/schedule/manual-test-1/history \
  -H "Authorization: Bearer <admin-token>"

# 失敗した履歴を取得
curl http://localhost:8080/api/imports/history/failed \
  -H "Authorization: Bearer <admin-token>"
```

**注意**: 履歴APIエンドポイントは`imports.ts`でコメントアウトされている可能性があります。実装状況を確認してください。

### 5. エラー時のアラート生成確認

#### 5.1 存在しないファイルパスでの実行

```bash
# 存在しないファイルパスでスケジュールを追加
curl -X POST http://localhost:8080/api/imports/schedule \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <admin-token>" \
  -d '{
    "id": "error-test-1",
    "name": "エラーテスト",
    "employeesPath": "/nonexistent/employees.csv",
    "schedule": "0 0 * * *",
    "enabled": true
  }'

# 手動実行
curl -X POST http://localhost:8080/api/imports/schedule/error-test-1/run \
  -H "Authorization: Bearer <admin-token>"
```

**期待される結果**:
- HTTP 500またはエラーレスポンス
- アラートファイルが生成される（`/opt/RaspberryPiSystem_002/alerts/`）
- インポート履歴に失敗として記録される

#### 5.2 連続失敗時のアラート確認

```bash
# 3回連続で失敗するスケジュールを実行
for i in {1..3}; do
  curl -X POST http://localhost:8080/api/imports/schedule/error-test-1/run \
    -H "Authorization: Bearer <admin-token>"
  sleep 5
done
```

**期待される結果**:
- 3回目の失敗時に連続失敗アラートが生成される
- アラートファイルに連続失敗の情報が記録される

### 6. ログの確認

```bash
# APIサーバーのログを確認
docker compose logs api --tail 100 | grep -i "csv\|import\|scheduler"

# スケジュール実行のログを確認
docker compose logs api --tail 100 | grep CsvImportScheduler
```

**確認ポイント**:
- スケジュールの登録・更新・削除のログ
- スケジュール実行の開始・完了ログ
- エラー時のログ
- インポート履歴の記録ログ

## トラブルシューティング

### エラー: `CSV import scheduler started`がログに表示されない

**原因**: `CsvImportScheduler`が起動していない

**解決方法**:
1. APIサーバーのログを確認
2. `main.ts`で`csvImportScheduler.start()`が呼ばれていることを確認
3. APIサーバーを再起動

### エラー: スケジュールが実行されない

**原因**: 
- cronスケジュールの形式が間違っている
- スケジュールが無効化されている
- `backup.json`にスケジュールが保存されていない

**解決方法**:
1. `backup.json`を確認（`/opt/RaspberryPiSystem_002/config/backup.json`）
2. `csvImports`セクションにスケジュールが含まれていることを確認
3. `enabled: true`になっていることを確認
4. cronスケジュールの形式を確認（`node-cron`形式）

### エラー: インポート履歴が記録されない

**原因**: 
- Prismaマイグレーションが実行されていない
- `ImportHistoryService`が有効化されていない

**解決方法**:
1. `CsvImportHistory`テーブルが存在することを確認
2. `import-history.service.ts`のコメントアウトが解除されていることを確認
3. APIサーバーを再起動

## 関連ドキュメント

- [CSVインポート履歴機能の有効化手順](./csv-import-history-migration.md)
- [Dropbox CSV統合の現状分析](../analysis/dropbox-csv-integration-status.md)
