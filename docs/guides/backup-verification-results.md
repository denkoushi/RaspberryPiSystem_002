# バックアップ機能 実機検証結果

最終更新: 2025-12-15

## 検証環境

- **デバイス**: Raspberry Pi 5 (100.106.158.2)
- **ブランチ**: `refactor/imports-ts-refactoring`
- **検証日時**: 2025-12-15 00:29-00:30

## 検証結果サマリー

| 項目 | 状態 | 詳細 |
|------|------|------|
| デプロイ | ✅ 成功 | APIコンテナ正常起動 |
| バックアップスケジューラー | ✅ 起動済み | 4タスク登録 |
| 設定ファイル読み込み | ✅ 成功 | デフォルト設定使用 |
| 手動バックアップ（CSV employees） | ✅ 成功 | 279 bytes |
| 手動バックアップ（CSV items） | ✅ 成功 | 168 bytes |
| バックアップ一覧取得 | ✅ 成功 | 3件のバックアップ確認 |
| バックアップファイル内容 | ✅ 正常 | CSV形式、データ整合性確認済み |
| Dropbox連携 | ⏸️ 保留 | トークン設定待ち |

## 詳細検証結果

### 1. デプロイ確認

```bash
# コンテナ状態
docker compose ps
# → api, db, web すべて Up
```

### 2. バックアップスケジューラー起動確認

```json
{
  "level": 30,
  "taskCount": 4,
  "msg": "[BackupScheduler] Scheduler started"
}
```

**登録されたタスク**:
- `database-postgresql://postgres:postgres@localhost:5432/borrow_return` (0 4 * * *)
- `csv-employees` (0 5 * * *)
- `csv-items` (0 5 * * *)
- `image-photo-storage` (0 6 * * *)

### 3. 設定ファイル読み込み確認

```json
{
  "level": 40,
  "configPath": "/app/config/backup.json",
  "msg": "[BackupConfigLoader] Config file not found, using default config"
}
```

**デフォルト設定**:
- ストレージプロバイダー: `local`
- ベースパス: `/opt/RaspberryPiSystem_002/backups`

### 4. 手動バックアップ実行

#### 4.1 CSVバックアップ（従業員データ）

**リクエスト**:
```bash
POST /api/backup
Authorization: Bearer <token>
{
  "kind": "csv",
  "source": "employees"
}
```

**レスポンス**:
```json
{
  "success": true,
  "path": "backups/csv/2025-12-15T00-29-43-887Z/employees",
  "sizeBytes": 279,
  "timestamp": "2025-12-15T00:29:43.890Z"
}
```

**ファイル内容確認**:
```csv
employeeCode,displayName,nfcTagUid,department,contact,status
1179,萱沼涼太,04C393C1330289,加工担当部署,,ACTIVE
1190,遠藤亜生,04B34411340289,加工担当部署,,ACTIVE
6666,山田 太郎,04C362E1330289,加工,,ACTIVE
8888,佐藤 花子,04131705340289,組立,,ACTIVE
```

**ファイルパス**: `/opt/RaspberryPiSystem_002/backups/backups/csv/2025-12-15T00-29-43-887Z/employees`

#### 4.2 CSVバックアップ（アイテムデータ）

**リクエスト**:
```bash
POST /api/backup
Authorization: Bearer <token>
{
  "kind": "csv",
  "source": "items"
}
```

**レスポンス**:
```json
{
  "success": true,
  "path": "backups/csv/2025-12-15T00-29-50-581Z/items",
  "sizeBytes": 168,
  "timestamp": "2025-12-15T00:29:50.582Z"
}
```

### 5. バックアップ一覧取得

**リクエスト**:
```bash
GET /api/backup
Authorization: Bearer <token>
```

**レスポンス**:
```json
{
  "backups": [
    {
      "path": "backups/csv/2025-12-15T00-29-43-887Z/employees",
      "sizeBytes": 279,
      "modifiedAt": "2025-12-15T00:29:43.888Z"
    },
    {
      "path": "backups/csv/2025-12-15T00-29-50-581Z/items",
      "sizeBytes": 168,
      "modifiedAt": "2025-12-15T00:29:50.580Z"
    },
    {
      "path": "backups/csv/2025-12-15T00-30-20-362Z/employees",
      "sizeBytes": 279,
      "modifiedAt": "2025-12-15T00:30:20.361Z"
    }
  ]
}
```

### 6. バックアップファイルの整合性確認

- ✅ CSV形式が正しい（ヘッダー行 + データ行）
- ✅ データが正しくエクスポートされている
- ✅ ファイルサイズが適切（279 bytes, 168 bytes）
- ✅ タイムスタンプが正しく記録されている

### 7. 設定API確認

**リクエスト**:
```bash
GET /api/backup/config
Authorization: Bearer <token>
```

**レスポンス**: デフォルト設定が返される

## 発見された問題

### 問題1: バックアップディレクトリの二重構造

**現象**: バックアップファイルが `/opt/RaspberryPiSystem_002/backups/backups/csv/...` に作成される（`backups`が2階層）

**原因**: `LocalStorageProvider`の`getBaseDir()`が`/opt/RaspberryPiSystem_002/backups`を返し、APIレスポンスの`path`が`backups/csv/...`で始まるため、結合時に`backups/backups`になる

**影響**: 機能的な問題はないが、パス構造が冗長

**対応**: 設定ファイルの`basePath`を調整するか、APIレスポンスの`path`形式を変更する

### 問題2: ファイル名に拡張子がない

**現象**: CSVファイルが`employees`、`items`という名前で保存される（`.csv`拡張子なし）

**原因**: `CsvBackupTarget`の実装で拡張子を付与していない

**影響**: 機能的な問題はないが、ファイルタイプの識別が困難

**対応**: 必要に応じて拡張子を追加する

## 未検証項目

### Dropbox連携テスト

**状況**: Dropboxアクセストークンがプレースホルダー（`your-token-here`）のまま

**必要な作業**:
1. Pi5の`.env`ファイルに実際のDropboxアクセストークンを設定
2. APIコンテナを再起動
3. Dropboxストレージプロバイダーでバックアップを実行
4. Dropbox上でファイルの存在を確認

### スケジュールバックアップ実行確認

**状況**: スケジューラーは起動しているが、実際のスケジュール実行は未確認

**必要な作業**:
1. スケジュール時刻まで待つ、または
2. スケジュール時刻を過去に設定してテスト実行

### バックアップリストア機能

**状況**: リストア機能の実機検証は未実施

**必要な作業**:
1. バックアップファイルをリストア
2. データの整合性を確認

## 検証完了項目

- ✅ デプロイ成功
- ✅ バックアップスケジューラー起動
- ✅ 設定ファイル読み込み
- ✅ 手動バックアップ実行（CSV employees）
- ✅ 手動バックアップ実行（CSV items）
- ✅ バックアップ一覧取得
- ✅ バックアップファイル内容確認

## 次のステップ

1. **Dropbox連携テスト**: 実際のDropboxトークンを設定して検証
2. **スケジュールバックアップ確認**: 実際のスケジュール実行を確認
3. **リストア機能検証**: バックアップファイルのリストアを検証
4. **パス構造の改善**: `backups/backups`の二重構造を解消
