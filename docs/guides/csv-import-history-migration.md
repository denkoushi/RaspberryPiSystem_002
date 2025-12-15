# CSVインポート履歴機能の有効化手順

最終更新: 2025-12-15

## 概要

Phase 2で実装したCSVインポート履歴機能（`ImportHistoryService`）を有効化するための手順です。

## 前提条件

- Phase 2の実装が完了していること
- Prismaスキーマに`CsvImportHistory`モデルが追加されていること（`apps/api/prisma/schema.prisma`）
- 実機（Raspberry Pi 5）で実行すること

## 手順

### 1. Prismaマイグレーションの実行

実機で以下のコマンドを実行して、データベースに`CsvImportHistory`テーブルを作成します。

```bash
cd /opt/RaspberryPiSystem_002/apps/api
docker compose exec api pnpm prisma migrate deploy
```

または、Docker Composeを使用しない場合：

```bash
cd /opt/RaspberryPiSystem_002/apps/api
export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/borrow_return"
pnpm prisma migrate deploy
```

### 2. Prisma Clientの再生成

マイグレーション実行後、Prisma Clientを再生成します。

```bash
cd /opt/RaspberryPiSystem_002/apps/api
docker compose exec api pnpm prisma generate
```

または：

```bash
cd /opt/RaspberryPiSystem_002/apps/api
pnpm prisma generate
```

### 3. APIサーバーの再起動

Prisma Clientが更新されたため、APIサーバーを再起動します。

```bash
cd /opt/RaspberryPiSystem_002
docker compose restart api
```

### 4. 動作確認

#### 4.1 スケジュール実行の確認

スケジュールを設定して実行し、履歴が記録されることを確認します。

```bash
# スケジュールを追加
curl -X POST http://localhost:8080/api/imports/schedule \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <admin-token>" \
  -d '{
    "id": "test-schedule-1",
    "name": "テストスケジュール",
    "employeesPath": "/test/employees.csv",
    "schedule": "0 0 * * *",
    "enabled": true
  }'

# 手動実行
curl -X POST http://localhost:8080/api/imports/schedule/test-schedule-1/run \
  -H "Authorization: Bearer <admin-token>"
```

#### 4.2 インポート履歴の確認

履歴APIエンドポイントが有効化されている場合、履歴を確認できます。

```bash
# すべての履歴を取得
curl http://localhost:8080/api/imports/history \
  -H "Authorization: Bearer <admin-token>"

# 特定のスケジュールの履歴を取得
curl http://localhost:8080/api/imports/schedule/test-schedule-1/history \
  -H "Authorization: Bearer <admin-token>"

# 失敗した履歴を取得
curl http://localhost:8080/api/imports/history/failed \
  -H "Authorization: Bearer <admin-token>"
```

### 5. ログの確認

APIサーバーのログを確認して、履歴が正しく記録されていることを確認します。

```bash
docker compose logs -f api | grep CsvImportScheduler
```

## トラブルシューティング

### エラー: `Property 'csvImportHistory' does not exist on type 'PrismaClient'`

**原因**: Prisma Clientが再生成されていない、またはマイグレーションが実行されていない。

**解決方法**:
1. `pnpm prisma generate`を実行
2. APIサーバーを再起動
3. マイグレーションが実行されていることを確認（`pnpm prisma migrate status`）

### エラー: `relation "CsvImportHistory" does not exist`

**原因**: マイグレーションが実行されていない。

**解決方法**:
1. `pnpm prisma migrate deploy`を実行
2. マイグレーションが正常に完了したことを確認

### 履歴が記録されない

**原因**: `ImportHistoryService`が有効化されていない、またはエラーが発生している。

**解決方法**:
1. APIサーバーのログを確認
2. `import-history.service.ts`と`csv-import-scheduler.ts`のコメントアウトが解除されていることを確認
3. データベース接続が正常であることを確認

## 関連ドキュメント

- [Dropbox CSV統合の現状分析](./../analysis/dropbox-csv-integration-status.md)
- [Prismaマイグレーションガイド](./prisma-migrations.md)（作成予定）
