# Dropboxバックアップ機能の状況調査レポート

作成日: 2026-01-23

## 調査目的

管理コンソールから設定できるDropboxへのバックアップ機能の状況を調査し、バックアップ対象がスケジュール通りDropboxへバックアップされているかを確認する。

## 調査結果サマリー

### 実装状況

✅ **実装済み**: Dropboxバックアップ機能は完全に実装されています。

1. **管理コンソールUI**: `/admin/backup/targets`でバックアップ対象を管理可能
2. **バックアップスケジューラー**: `BackupScheduler`クラスでcron形式のスケジュール実行をサポート
3. **Dropboxストレージプロバイダー**: `DropboxStorageProvider`でDropbox API連携を実装
4. **バックアップ履歴**: `BackupHistory`テーブルにすべてのバックアップ実行履歴を記録

### 主要コンポーネント

#### 1. バックアップ設定UI (`BackupTargetsPage.tsx`)
- **場所**: `apps/web/src/pages/admin/BackupTargetsPage.tsx`
- **機能**:
  - バックアップ対象の一覧表示
  - バックアップ対象の追加・編集・削除
  - スケジュール設定（cron形式）
  - 有効/無効の切り替え
  - 手動実行
  - ストレージプロバイダー（Dropbox/ローカル）の設定
  - ヘルスチェック結果の表示

#### 2. バックアップスケジューラー (`backup-scheduler.ts`)
- **場所**: `apps/api/src/services/backup/backup-scheduler.ts`
- **機能**:
  - cron形式のスケジュールに基づいてバックアップを自動実行
  - 設定ファイル（`backup.json`）から設定を読み込み
  - バックアップ実行後、古いバックアップの自動削除（retention設定に基づく）
  - タイムゾーン: `Asia/Tokyo`

#### 3. Dropboxストレージプロバイダー (`dropbox-storage.provider.ts`)
- **場所**: `apps/api/src/services/backup/storage/dropbox-storage.provider.ts`
- **機能**:
  - Dropbox APIを使用したファイルアップロード・ダウンロード・削除
  - リフレッシュトークンによる自動アクセストークン更新
  - レート制限エラー（429）時の自動リトライ（指数バックオフ）
  - ネットワークエラー時の自動リトライ
  - 証明書ピニングによるセキュリティ強化

#### 4. バックアップ履歴サービス (`backup-history.service.ts`)
- **場所**: `apps/api/src/services/backup/backup-history.service.ts`
- **機能**:
  - バックアップ・リストア操作の履歴をデータベースに記録
  - フィルタ・ページネーション対応の履歴取得
  - ファイルステータス（EXISTS/DELETED）の管理

### 設定ファイル

**設定ファイルの場所**:
- デフォルト: `/app/config/backup.json`（Dockerコンテナ内）
- 環境変数で変更可能: `BACKUP_CONFIG_PATH`

**設定ファイルの構造**:
```json
{
  "storage": {
    "provider": "dropbox",
    "options": {
      "basePath": "/backups",
      "dropbox": {
        "appKey": "...",
        "appSecret": "...",
        "accessToken": "...",
        "refreshToken": "..."
      }
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
    }
  ],
  "retention": {
    "days": 30,
    "maxBackups": 100
  }
}
```

### バックアップスケジューラーの起動

**起動タイミング**: APIサーバー起動時（`apps/api/src/main.ts`）
```typescript
const backupScheduler = getBackupScheduler();
await backupScheduler.start();
```

**起動条件**:
- APIサーバーが正常に起動していること
- 設定ファイル（`backup.json`）が読み込めること
- 各ターゲットの`enabled: true`かつ`schedule`が設定されていること

## 確認すべき項目

### 1. 設定ファイルの存在確認

```bash
# Pi5上で実行
docker compose -f infrastructure/docker/docker-compose.server.yml exec api ls -la /app/config/backup.json
```

### 2. バックアップスケジューラーの起動確認

```bash
# APIサーバーのログを確認
docker compose -f infrastructure/docker/docker-compose.server.yml logs api | grep -i "backup scheduler"
```

期待されるログ:
- `[BackupScheduler] Scheduler started`
- `[BackupScheduler] Scheduled task registered`

### 3. Dropbox認証情報の確認

```bash
# 設定ファイルの内容を確認（機密情報はマスク）
docker compose -f infrastructure/docker/docker-compose.server.yml exec api cat /app/config/backup.json | jq '.storage.options.dropbox | {hasAccessToken: (.accessToken != null and .accessToken != ""), hasRefreshToken: (.refreshToken != null and .refreshToken != "")}'
```

### 4. バックアップ履歴の確認

管理コンソールから確認:
- URL: `https://<pi5>/admin/backup/history`
- フィルタ: `operationType=BACKUP`, `storageProvider=dropbox`

またはAPI経由:
```bash
curl -k -H "Authorization: Bearer <admin_token>" \
  "https://<pi5>/api/backup/history?operationType=BACKUP&storageProvider=dropbox&limit=20"
```

### 5. スケジュール設定の確認

管理コンソールから確認:
- URL: `https://<pi5>/admin/backup/targets`
- 各ターゲットの`enabled`と`schedule`を確認

または設定ファイルから確認:
```bash
docker compose -f infrastructure/docker/docker-compose.server.yml exec api cat /app/config/backup.json | jq '.targets[] | {kind, source, schedule, enabled, storage}'
```

### 6. Dropboxへの実際のバックアップ確認

**方法1: バックアップ履歴から確認**
- 管理コンソールの「バックアップ履歴」ページで、`storageProvider=dropbox`かつ`status=COMPLETED`の履歴を確認
- 最新のバックアップ実行日時とスケジュールを照合

**方法2: Dropbox API経由で確認**
- Dropboxアカウントにログインして`/backups`配下のファイルを確認
- ファイル名のタイムスタンプとスケジュールを照合

**方法3: 手動実行でテスト**
- 管理コンソールの「バックアップ対象管理」ページで「実行」ボタンをクリック
- 実行結果を確認（成功/失敗）

### 7. エラーログの確認

```bash
# APIサーバーのログからバックアップ関連のエラーを確認
docker compose -f infrastructure/docker/docker-compose.server.yml logs api | grep -i "backup" | grep -i "error\|failed\|exception"
```

## トラブルシューティング

### バックアップが実行されない場合

1. **スケジューラーの起動確認**
   ```bash
   docker compose -f infrastructure/docker/docker-compose.server.yml logs api | grep -i "backup scheduler"
   ```
   - `Scheduler started`が表示されていない場合、APIサーバーの再起動が必要

2. **設定ファイルの確認**
   ```bash
   docker compose -f infrastructure/docker/docker-compose.server.yml exec api cat /app/config/backup.json | jq '.targets[] | select(.enabled == true) | {kind, source, schedule}'
   ```
   - `enabled: true`かつ`schedule`が設定されているターゲットが存在するか確認

3. **cron形式の検証**
   - スケジュールが正しいcron形式か確認（例: `"0 4 * * *"` = 毎日4時）
   - タイムゾーンは`Asia/Tokyo`で実行される

### Dropboxへのアップロードが失敗する場合

1. **アクセストークンの確認**
   - 設定ファイルに`accessToken`が設定されているか確認
   - トークンが期限切れの場合は、リフレッシュトークンで自動更新される（`refreshToken`が設定されている場合）

2. **ネットワーク接続の確認**
   - Pi5からDropbox APIへの接続が可能か確認
   - ファイアウォールやプロキシの設定を確認

3. **エラーログの確認**
   ```bash
   docker compose -f infrastructure/docker/docker-compose.server.yml logs api | grep -i "dropbox" | tail -50
   ```

### バックアップ履歴に記録されない場合

1. **データベース接続の確認**
   ```bash
   docker compose -f infrastructure/docker/docker-compose.server.yml exec api pnpm prisma migrate status
   ```

2. **BackupHistoryテーブルの確認**
   ```bash
   docker compose -f infrastructure/docker/docker-compose.server.yml exec api pnpm prisma studio
   ```
   - `BackupHistory`テーブルを開いて最新のレコードを確認

## 次のステップ

1. **実際の環境での確認**
   - Pi5にSSH接続して上記の確認項目を実行
   - バックアップ履歴とDropboxのファイルを照合

2. **スケジュール実行の検証**
   - 次回のスケジュール実行時刻を確認
   - 実行時刻にログを監視して正常に実行されるか確認

3. **問題が発見された場合**
   - エラーログを詳細に確認
   - 設定ファイルの内容を確認
   - 必要に応じて設定を修正

## 関連ドキュメント

- [バックアップ設定ガイド](./backup-configuration.md)
- [バックアップ・リストア手順](./backup-and-restore.md)
- [Dropbox連携セットアップガイド](./dropbox-setup-guide.md)
- [バックアップ対象管理UI実装計画](../requirements/backup-target-management-ui.md)
