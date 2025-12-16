---
title: PowerAutomate → Dropbox → Pi5 CSV統合ガイド
tags: [PowerAutomate, Dropbox, CSV, 統合, 外部システム]
audience: [運用者, 開発者, 外部システム担当者]
last-verified: 2025-12-16
related: [dropbox-csv-integration-status.md, sharepoint-dropbox-integration-assessment.md]
category: guides
update-frequency: low
---

# PowerAutomate → Dropbox → Pi5 CSV統合ガイド

最終更新: 2025-12-16

## 概要

本ドキュメントでは、SharePointリストからPowerAutomateでCSV出力し、Dropboxに保存して、Raspberry Pi 5が自動的にCSVを取得してインポートする統合スキームの仕様を定義します。

## 統合スキーム

```
SharePointリスト
    ↓ (PowerAutomate)
Dropbox（CSV保存）
    ↓ (Pi5がスケジュール実行で取得)
Raspberry Pi 5（CSVインポート）
```

## PowerAutomate側の実装要件

### 1. ファイル命名規則

**必須**: ファイル名に日付を含める形式を使用してください。

#### 従業員CSV
- **形式**: `employees-YYYYMMDD.csv`
- **例**: `employees-20251216.csv`
- **説明**: `employees-`プレフィックス + 日付（YYYYMMDD形式）+ `.csv`拡張子

#### アイテムCSV
- **形式**: `items-YYYYMMDD.csv`
- **例**: `items-20251216.csv`
- **説明**: `items-`プレフィックス + 日付（YYYYMMDD形式）+ `.csv`拡張子

**注意事項**:
- ファイル名は大文字小文字を区別します（小文字推奨）
- 日付は実行日（UTC+9、JST）を使用してください
- ファイル名に特殊文字（`..`, `//`, `/`など）を含めないでください

### 2. Dropbox格納フォルダ構造

**推奨フォルダ構造**:
```
/backups/csv/
  ├── employees-20251216.csv
  ├── employees-20251215.csv
  ├── items-20251216.csv
  └── items-20251215.csv
```

**フォルダパス**:
- **ベースパス**: `/backups/csv/`
- **従業員CSV**: `/backups/csv/employees-YYYYMMDD.csv`
- **アイテムCSV**: `/backups/csv/items-YYYYMMDD.csv`

**注意事項**:
- フォルダパスは絶対パス（`/`で始まる）を使用してください
- パストラバーサル（`..`）を含めないでください
- フォルダは事前に作成しておく必要があります

### 3. CSV形式仕様

#### 従業員CSV（employees-*.csv）

**必須カラム**:
- `employeeCode`: 社員コード（数字4桁、例: `0001`）
- `displayName`: 氏名（必須）

**オプションカラム**:
- `nfcTagUid`: NFCタグUID
- `department`: 部署名
- `contact`: 連絡先
- `status`: ステータス（`ACTIVE`, `INACTIVE`など）

**CSV例**:
```csv
employeeCode,displayName,nfcTagUid,department,contact,status
0001,山田太郎,04A1B2C3D4E5F6,製造部,090-1234-5678,ACTIVE
0002,佐藤花子,04B2C3D4E5F6A7,品質管理部,090-2345-6789,ACTIVE
```

#### アイテムCSV（items-*.csv）

**必須カラム**:
- `itemCode`: 管理番号（`TO` + 数字4桁、例: `TO0001`）
- `name`: 工具名（必須）

**オプションカラム**:
- `nfcTagUid`: NFCタグUID
- `category`: カテゴリ
- `storageLocation`: 保管場所
- `status`: ステータス（`AVAILABLE`, `BORROWED`, `MAINTENANCE`など）

**CSV例**:
```csv
itemCode,name,nfcTagUid,category,storageLocation,status
TO0001,ドライバーセット,04C3D4E5F6A7B8,工具,工具庫,AVAILABLE
TO0002,ハンマー,04D4E5F6A7B8C9,工具,工具庫,AVAILABLE
```

**CSV形式の要件**:
- **エンコーディング**: UTF-8（BOMなし推奨）
- **改行コード**: LF（`\n`）またはCRLF（`\r\n`）
- **区切り文字**: カンマ（`,`）
- **引用符**: 必要に応じてダブルクォート（`"`）で囲む
- **ヘッダー行**: 必須（1行目）

### 4. 署名/ハッシュの扱い（整合性検証）

**現状**: Pi5側ではファイルの整合性検証は実装されていません。

**将来の拡張**:
- ファイルのハッシュ値（SHA-256）をメタデータとして保存することを検討
- PowerAutomate側でハッシュ値を計算し、ファイル名やメタデータとして保存
- Pi5側でハッシュ値を検証して整合性を確認

**現時点での推奨事項**:
- PowerAutomate側でファイルの整合性を確認（エラーハンドリング）
- ファイルサイズの検証（0バイトファイルの拒否）
- CSV形式のバリデーション（必須カラムの存在確認）

### 5. スケジュール実行タイミング

**推奨実行タイミング**:
- **頻度**: 1日1回（毎日）
- **実行時刻**: 午前2時（JST、UTC+9）
- **理由**: Pi5側のスケジュール実行とタイミングを合わせるため

**注意事項**:
- PowerAutomate側の実行タイミングとPi5側のスケジュール実行タイミングを調整してください
- Pi5側のスケジュール実行は`backup.json`で設定可能です（例: `0 2 * * *` = 毎日午前2時）

### 6. 古いファイルの自動削除

**推奨設定**:
- **保持期間**: 30日
- **削除タイミング**: 新しいファイルをアップロードする前に実行
- **削除対象**: 30日以上経過したファイル

**実装例（PowerAutomate）**:
1. 現在の日付から30日前の日付を計算
2. Dropboxから該当するファイルを検索
3. 該当ファイルを削除

**注意事項**:
- Pi5側では古いファイルの自動削除は実装されていません
- PowerAutomate側で実装してください

### 7. エラーハンドリング

**PowerAutomate側で実装すべきエラーハンドリング**:
1. **SharePointリストの取得エラー**: リトライロジック（最大3回）
2. **CSV形式のバリデーション**: 必須カラムの存在確認、データ型の検証
3. **Dropboxアップロードエラー**: リトライロジック（最大3回）、エラーログの記録
4. **ファイルサイズの検証**: 0バイトファイルの拒否、サイズ上限の設定（例: 10MB）

**エラー通知**:
- PowerAutomate側でエラーが発生した場合、通知を送信（メール、Teamsなど）
- Pi5側では、インポート失敗時にアラートを生成（`ImportAlertService`）

## Pi5側の設定

### スケジュール実行の設定

**設定ファイル**: `backup.json`

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
    },
    {
      "id": "daily-items-import",
      "name": "毎日のアイテムCSVインポート",
      "schedule": "0 2 * * *",
      "timezone": "Asia/Tokyo",
      "itemsPath": "/backups/csv/items-YYYYMMDD.csv",
      "replaceExisting": false,
      "enabled": true
    }
  ]
}
```

**設定項目の説明**:
- `id`: スケジュールの一意ID
- `name`: スケジュールの名前（管理用）
- `schedule`: cron形式のスケジュール（例: `0 2 * * *` = 毎日午前2時）
- `timezone`: タイムゾーン（`Asia/Tokyo`固定）
- `employeesPath`: 従業員CSVのDropboxパス（`YYYYMMDD`は実行日の日付に置換）
- `itemsPath`: アイテムCSVのDropboxパス（`YYYYMMDD`は実行日の日付に置換）
- `replaceExisting`: 既存データを置き換えるか（`true`/`false`）
- `enabled`: スケジュールを有効にするか（`true`/`false`）

**注意事項**:
- `YYYYMMDD`は実行日の日付（JST）に自動的に置換されます
- PowerAutomate側の実行タイミングとPi5側のスケジュール実行タイミングを調整してください

## トラブルシューティング

### よくある問題

#### 1. CSVファイルが見つからない（404エラー）

**原因**:
- PowerAutomate側でファイルがアップロードされていない
- ファイル名が間違っている（日付形式が異なるなど）
- Dropboxパスが間違っている

**対処法**:
- PowerAutomate側の実行ログを確認
- Dropbox上でファイルの存在を確認
- Pi5側の`backup.json`のパス設定を確認

#### 2. CSV形式エラー

**原因**:
- CSVの必須カラムが不足している
- データ型が不正（例: `employeeCode`が数字4桁でない）
- エンコーディングがUTF-8でない

**対処法**:
- CSVファイルを開いて形式を確認
- 必須カラムが存在するか確認
- エンコーディングをUTF-8に変換

#### 3. インポートが失敗する

**原因**:
- Dropbox API認証エラー
- ネットワーク接続エラー
- データベースエラー

**対処法**:
- Pi5側のインポート履歴を確認（`GET /api/imports/history`）
- Dropbox APIトークンの有効性を確認
- エラーログを確認

## セキュリティ考慮事項

詳細は `docs/security/sharepoint-dropbox-integration-assessment.md` を参照してください。

**重要なポイント**:
- Dropbox APIトークンは環境変数で管理（Ansible Vaultで暗号化）
- HTTPS接続必須（TLS 1.2以上）
- 証明書ピニングの実装（推奨）
- 最小権限の原則（Dropboxアプリには必要最小限の権限のみ付与）

## 関連ドキュメント

- `docs/analysis/dropbox-csv-integration-status.md`: Dropbox CSV統合機能の現状分析
- `docs/security/sharepoint-dropbox-integration-assessment.md`: SharePoint → Dropbox → Pi5統合のセキュリティ評価
- `docs/security/sharepoint-dropbox-multi-purpose-assessment.md`: 多目的用途の評価

## 更新履歴

- 2025-12-16: 初版作成（PowerAutomate側仕様の明文化）
