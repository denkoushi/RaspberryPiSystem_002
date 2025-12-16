# CSVインポート・エクスポート仕様

## 概要

本システムでは、以下の方法でマスターデータ（従業員・工具）を一括インポートできます：

1. **USBメモリ経由**: 管理画面からCSVファイルをアップロード
2. **Dropbox経由**: DropboxからCSVファイルをダウンロードしてインポート（手動実行）
3. **Dropbox経由（スケジュール実行）**: 設定したスケジュールに従って自動的にDropboxからCSVを取得してインポート

また、トランザクション履歴をCSV形式でエクスポートできます。

## CSVインポート仕様

### 基本要件

- **文字コード**: UTF-8
- **形式**: CSV（カンマ区切り）
- **ヘッダー行**: 必須（1行目）
- **データ行**: 1行1レコード

### 従業員CSV（employees.csv）

#### 必須項目

| 列名 | 形式 | 説明 | 例 |
|------|------|------|-----|
| `employeeCode` | 数字4桁 | 社員コード（一意） | `0001`, `0123` |
| `displayName` | 文字列 | 氏名 | `山田 太郎` |

#### 任意項目

| 列名 | 形式 | 説明 | 例 |
|------|------|------|-----|
| `nfcTagUid` | 文字列 | NFCタグUID（14文字の16進数） | `04C362E1330289` |
| `department` | 文字列 | 部署名 | `製造部` |
| `contact` | 文字列 | 連絡先 | `内線1234` |
| `status` | 文字列 | ステータス（`ACTIVE` / `INACTIVE`） | `ACTIVE` |

#### CSV例

```csv
employeeCode,displayName,nfcTagUid,department,contact,status
0001,山田 太郎,04C362E1330289,製造部,内線1234,ACTIVE
0002,佐藤 花子,,品質管理部,内線5678,ACTIVE
0003,鈴木 一郎,04DE8366BC2A81,製造部,,INACTIVE
```

#### バリデーションルール

- `employeeCode`: 数字4桁のみ（`/^\d{4}$/`）
- `displayName`: 1文字以上
- `nfcTagUid`: 既存の従業員・工具で使用されていないこと
- CSV内で`nfcTagUid`が重複していないこと

### 工具CSV（items.csv）

#### 必須項目

| 列名 | 形式 | 説明 | 例 |
|------|------|------|-----|
| `itemCode` | TO + 数字4桁 | 管理番号（一意） | `TO0001`, `TO0123` |
| `name` | 文字列 | 工具名 | `ドライバー No.1` |

#### 任意項目

| 列名 | 形式 | 説明 | 例 |
|------|------|------|-----|
| `nfcTagUid` | 文字列 | NFCタグUID（14文字の16進数） | `04DE8366BC2A81` |
| `category` | 文字列 | カテゴリ | `工具` |
| `storageLocation` | 文字列 | 保管場所 | `工具庫A` |
| `status` | 文字列 | ステータス（`AVAILABLE` / `IN_USE` / `MAINTENANCE` / `RETIRED`） | `AVAILABLE` |
| `notes` | 文字列 | 備考 | `定期点検必要` |

#### CSV例

```csv
itemCode,name,nfcTagUid,category,storageLocation,status,notes
TO0001,ドライバー No.1,04DE8366BC2A81,工具,工具庫A,AVAILABLE,
TO0002,レンチセット,,工具,工具庫B,AVAILABLE,定期点検必要
TO0003,ハンマー,04C362E1330289,工具,工具庫A,IN_USE,
```

#### バリデーションルール

- `itemCode`: TO + 数字4桁のみ（`/^TO\d{4}$/`）
- `name`: 1文字以上
- `nfcTagUid`: 既存の従業員・工具で使用されていないこと
- CSV内で`nfcTagUid`が重複していないこと
- 従業員CSVと工具CSV間で`nfcTagUid`が重複していないこと

## インポート処理の動作

### 通常インポート（`replaceExisting: false`）

- 既存データは削除されません
- `employeeCode` / `itemCode`が一致する場合: 既存レコードを更新
- `employeeCode` / `itemCode`が一致しない場合: 新規レコードを作成

### 全削除してからインポート（`replaceExisting: true`）

- 選択したCSVの種類（従業員または工具）の既存データを削除してからインポート
- **注意**: 貸出記録（Loan）が存在する従業員・工具は削除されません（外部キー制約のため）

## エラーメッセージ

### バリデーションエラー

- `社員コードは数字4桁である必要があります（例: 0001）`: `employeeCode`の形式が不正
- `管理番号はTO + 数字4桁である必要があります（例: TO0001）`: `itemCode`の形式が不正
- `氏名は必須です`: `displayName`が空
- `工具名は必須です`: `name`が空

### 重複エラー

- `nfcTagUid="..."は既にemployeeCode="..."で使用されています。employeeCode="..."では使用できません。`: 既存の従業員が同じ`nfcTagUid`を使用している
- `nfcTagUid="..."は既にitemCode="..."で使用されています。itemCode="..."では使用できません。`: 既存の工具が同じ`nfcTagUid`を使用している
- `CSV内でnfcTagUidが重複しています: ...`: CSV内で同じ`nfcTagUid`が複数回使用されている
- `従業員とアイテムで同じnfcTagUidが使用されています: ...`: 従業員CSVと工具CSV間で`nfcTagUid`が重複している

## CSVエクスポート仕様

### トランザクション履歴エクスポート

履歴画面からCSV形式でトランザクション履歴をエクスポートできます。

#### エクスポート項目

| 列名 | 説明 |
|------|------|
| `日時` | トランザクションの日時 |
| `アクション` | アクション種別（`BORROW` / `RETURN`） |
| `アイテム` | アイテム名（スナップショット優先） |
| `従業員` | 従業員名（スナップショット優先） |
| `端末` | クライアント端末名 |

#### エクスポート方法

1. 管理画面の「履歴」タブにアクセス
2. 必要に応じて日時フィルタを設定
3. 「CSVエクスポート」ボタンをクリック
4. `transactions.csv`がダウンロードされます

## DropboxからのCSVインポート

### 手動実行

管理画面からDropbox経由でCSVをインポートできます。

**APIエンドポイント**: `POST /api/imports/master/from-dropbox`

**リクエスト例**:
```json
{
  "employeesPath": "/backups/csv/employees-20251216.csv",
  "itemsPath": "/backups/csv/items-20251216.csv",
  "replaceExisting": false
}
```

**認証**: 管理者権限（`ADMIN`）が必要

### スケジュール実行

設定ファイル（`backup.json`）でスケジュールを設定すると、自動的にDropboxからCSVを取得してインポートします。

**設定例**:
```json
{
  "csvImports": [
    {
      "id": "daily-employees-import",
      "name": "毎日の従業員CSVインポート",
      "schedule": "0 2 * * *",
      "timezone": "Asia/Tokyo",
      "employeesPath": "/backups/csv/employees-YYYYMMDD.csv",
      "replaceExisting": false,
      "enabled": true
    }
  ]
}
```

**詳細**: [PowerAutomate → Dropbox → Pi5 CSV統合ガイド](./powerautomate-dropbox-integration.md)

### インポート履歴

スケジュール実行や手動実行の履歴を確認できます。

**APIエンドポイント**:
- `GET /api/imports/history`: 全履歴取得（フィルタ・ページング対応）
- `GET /api/imports/schedule/:id/history`: 特定スケジュールの履歴取得
- `GET /api/imports/history/failed`: 失敗した履歴のみ取得
- `GET /api/imports/history/:historyId`: 詳細履歴取得

**詳細**: [CSVインポート履歴機能の有効化手順](./csv-import-history-migration.md)

## 将来の拡張予定

### マスターデータエクスポート

- 従業員マスタのCSVエクスポート機能
- 工具マスタのCSVエクスポート機能

### その他のマスターデータインポート

- 将来のモジュール（ドキュメント管理、物流管理など）用のマスターデータインポート機能

## 関連ドキュメント

- [デプロイメントガイド](./deployment.md)
- [PowerAutomate → Dropbox → Pi5 CSV統合ガイド](./powerautomate-dropbox-integration.md)
- [CSVインポート履歴機能の有効化手順](./csv-import-history-migration.md)
- [Dropbox CSV統合機能の現状分析](../analysis/dropbox-csv-integration-status.md)
- [トラブルシューティングナレッジベース](../knowledge-base/troubleshooting-knowledge.md#kb-003-p2002エラーnfctaguidの重複が発生する)

