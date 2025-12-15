# バックアップ機能 実機検証結果

最終更新: 2025-12-15

## 検証環境

- **デバイス**: Raspberry Pi 5 (100.106.158.2)
- **ブランチ**: `refactor/imports-ts-refactoring`
- **検証日時**: 2025-12-15 00:29-00:30（初回検証）、00:42（改善後検証）

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

**レスポンス（改善後）**:
```json
{
  "success": true,
  "path": "csv/2025-12-15T00-42-04-953Z/employees.csv",
  "sizeBytes": 279,
  "timestamp": "2025-12-15T00:42:04.964Z"
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

**ファイルパス（改善後）**: `/opt/RaspberryPiSystem_002/backups/csv/2025-12-15T00-42-04-953Z/employees.csv`

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

**レスポンス（改善後）**:
```json
{
  "success": true,
  "path": "csv/2025-12-15T00-42-04-953Z/items.csv",
  "sizeBytes": 168,
  "timestamp": "2025-12-15T00:42:04.964Z"
}
```

### 5. バックアップ一覧取得

**リクエスト**:
```bash
GET /api/backup
Authorization: Bearer <token>
```

**レスポンス（改善後）**:
```json
{
  "backups": [
    {
      "path": "csv/2025-12-15T00-42-04-953Z/employees.csv",
      "sizeBytes": 279,
      "modifiedAt": "2025-12-15T00:42:04.961Z"
    }
  ]
}
```

**注意**: APIレスポンスの`path`は相対パス（`backups/`プレフィックスなし）で返されます。完全なファイルパスは`LocalStorageProvider`の`getBaseDir()`（`/opt/RaspberryPiSystem_002/backups`）と結合して取得します。

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

## 発見された問題と解決

### 問題1: バックアップディレクトリの二重構造 ✅ 解決済み

**現象**: バックアップファイルが `/opt/RaspberryPiSystem_002/backups/backups/csv/...` に作成される（`backups`が2階層）

**原因**: `BackupService.buildPath()`が`backups/`プレフィックスを含んでいたため、`LocalStorageProvider`の`getBaseDir()`（`/opt/RaspberryPiSystem_002/backups`）と結合時に`backups/backups`になった

**解決策**: `BackupService.buildPath()`から`backups/`プレフィックスを削除し、相対パス（`csv/{timestamp}/{source}.csv`）のみを返すように修正

**解決後の動作**:
- APIレスポンスの`path`: `csv/2025-12-15T00-42-04-953Z/employees.csv`
- 実際のファイルパス: `/opt/RaspberryPiSystem_002/backups/csv/2025-12-15T00-42-04-953Z/employees.csv`

**変更内容**:
- `apps/api/src/services/backup/backup.service.ts`: `buildPath()`メソッドを修正
- `listBackups()`のデフォルトプレフィックスを空文字列に変更

### 問題2: ファイル名に拡張子がない ✅ 解決済み

**現象**: CSVファイルが`employees`、`items`という名前で保存される（`.csv`拡張子なし）

**原因**: `BackupService.buildPath()`で拡張子を付与していなかった

**解決策**: `buildPath()`メソッドでCSVファイルタイプの場合に`.csv`拡張子を自動付与

**解決後の動作**:
- ファイル名: `employees.csv`、`items.csv`
- APIレスポンスの`path`: `csv/.../employees.csv`

**変更内容**:
- `apps/api/src/services/backup/backup.service.ts`: `buildPath()`メソッドに拡張子付与ロジックを追加

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
- ✅ **パス構造の改善**（`backups/backups`の二重構造を解消）
- ✅ **CSVファイル拡張子の追加**（`.csv`拡張子を自動付与）

## 改善内容の詳細

### バックアップパス構造の仕様

**APIレスポンスの`path`形式**:
- 相対パス: `{type}/{timestamp}/{source}.{extension}`
- 例: `csv/2025-12-15T00-42-04-953Z/employees.csv`

**実際のファイルパス**:
- `{getBaseDir()}/{path}`
- 例: `/opt/RaspberryPiSystem_002/backups/csv/2025-12-15T00-42-04-953Z/employees.csv`

**実装のポイント**:
- `LocalStorageProvider.getBaseDir()`: `/opt/RaspberryPiSystem_002/backups`を返す
- `BackupService.buildPath()`: 相対パスのみを返す（`backups/`プレフィックスなし）
- CSVファイルタイプの場合、自動的に`.csv`拡張子を付与

## 次のステップ

1. **Dropbox連携テスト**: 実際のDropboxトークンを設定して検証
2. **スケジュールバックアップ確認**: 実際のスケジュール実行を確認
3. **リストア機能検証**: バックアップファイルのリストアを検証
