---
title: PowerAutomate → Gmail → Pi5 CSV統合ガイド
tags: [PowerAutomate, Gmail, CSV, 統合, 外部システム]
audience: [運用者, 開発者, 外部システム担当者]
last-verified: 2025-12-21
related: [gmail-attachment-integration.md, powerautomate-dropbox-integration.md]
category: guides
update-frequency: low
---

# PowerAutomate → Gmail → Pi5 CSV統合ガイド

最終更新: 2025-12-21

## 概要

本ドキュメントでは、SharePointリストからPowerAutomateでCSV出力し、Gmailに添付ファイルとして送信して、Raspberry Pi 5が自動的にGmailから添付ファイルを取得してインポートする統合スキームの仕様を定義します。

## 統合スキーム

```
SharePointリスト
    ↓ (PowerAutomate)
Gmail（CSV添付ファイルとして送信）
    ↓ (Pi5がスケジュール実行で取得)
Raspberry Pi 5（CSVインポート）
```

## PowerAutomate側の実装要件

### 1. メール件名の命名規則

**必須**: メール件名にファイルタイプと日付を含める形式を使用してください。

#### 従業員CSV
- **形式**: `CSV Import: employees-YYYYMMDD`
- **例**: `CSV Import: employees-20251221`
- **説明**: `CSV Import: `プレフィックス + `employees-` + 日付（YYYYMMDD形式）

#### アイテムCSV
- **形式**: `CSV Import: items-YYYYMMDD`
- **例**: `CSV Import: items-20251221`
- **説明**: `CSV Import: `プレフィックス + `items-` + 日付（YYYYMMDD形式）

**注意事項**:
- メール件名は大文字小文字を区別します（大文字推奨）
- 日付は実行日（UTC+9、JST）を使用してください
- メール件名に特殊文字を含めないでください

### 2. 添付ファイルの命名規則

**必須**: 添付ファイル名に日付を含める形式を使用してください。

#### 従業員CSV
- **形式**: `employees-YYYYMMDD.csv`
- **例**: `employees-20251221.csv`
- **説明**: `employees-`プレフィックス + 日付（YYYYMMDD形式）+ `.csv`拡張子

#### アイテムCSV
- **形式**: `items-YYYYMMDD.csv`
- **例**: `items-20251221.csv`
- **説明**: `items-`プレフィックス + 日付（YYYYMMDD形式）+ `.csv`拡張子

**注意事項**:
- ファイル名は大文字小文字を区別します（小文字推奨）
- 日付は実行日（UTC+9、JST）を使用してください
- ファイル名に特殊文字（`..`, `//`, `/`など）を含めないでください

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

### 4. メール送信設定

#### 送信先

**必須**: Pi5用の専用Gmailアカウントを使用してください。

**推奨設定**:
- **送信元**: PowerAutomate用のGmailアカウント
- **送信先**: Pi5用の専用Gmailアカウント（OAuth認証で使用するアカウント）
- **CC/BCC**: 不要（Pi5が自動的に処理）

#### メール本文

**推奨設定**:
- **本文**: CSVファイルの説明やメタデータを含める（オプション）
- **重要度**: 通常
- **優先度**: 通常

**メール本文例**:
```
CSV Import: employees-20251221.csv

本メールには従業員データのCSVファイルが添付されています。
Pi5が自動的に処理します。
```

### 5. スケジュール実行タイミング

**推奨実行タイミング**:
- **頻度**: 1日1回（毎日）
- **実行時刻**: 午前1時30分（JST、UTC+9）
- **理由**: Pi5側のスケジュール実行（午前2時）の30分前に実行し、メールが確実に届くようにする

**注意事項**:
- PowerAutomate側の実行タイミングとPi5側のスケジュール実行タイミングを調整してください
- Pi5側のスケジュール実行は`backup.json`で設定可能です（例: `0 2 * * *` = 毎日午前2時）

### 6. エラーハンドリング

**PowerAutomate側で実装すべきエラーハンドリング**:
1. **SharePointリストの取得エラー**: リトライロジック（最大3回）
2. **CSV形式のバリデーション**: 必須カラムの存在確認、データ型の検証
3. **Gmail送信エラー**: リトライロジック（最大3回）、エラーログの記録
4. **ファイルサイズの検証**: 0バイトファイルの拒否、サイズ上限の設定（例: 25MB、Gmail APIの制限）

**エラー通知**:
- PowerAutomate側でエラーが発生した場合、通知を送信（メール、Teamsなど）
- Pi5側では、インポート失敗時にアラートを生成（`ImportAlertService`）

### 7. メールの重複送信防止

**推奨設定**:
- **送信前チェック**: 同じ件名のメールが既に送信されていないか確認
- **送信履歴**: 送信済みメールの履歴を記録（SharePointリスト、Excelなど）
- **重複防止**: 同じ日付のCSVファイルを複数回送信しないようにする

**実装例（PowerAutomate）**:
1. 現在の日付を取得（YYYYMMDD形式）
2. 送信履歴を確認（同じ日付のメールが既に送信されていないか）
3. 送信履歴に記録がない場合のみメールを送信
4. 送信後に送信履歴に記録

## Pi5側の設定

### メール検索パターンの設定

**設定ファイル**: `backup.json`

**設定例**:
```json
{
  "storage": {
    "provider": "gmail",
    "options": {
      "subjectPattern": "^CSV Import: (employees|items)-.*",
      "labelName": "Pi5/Processed"
    }
  }
}
```

**設定項目の説明**:
- `subjectPattern`: メール件名の正規表現パターン（例: `^CSV Import: (employees|items)-.*`）
- `labelName`: 処理済みメールに追加するラベル名（デフォルト: `Pi5/Processed`）

**注意事項**:
- `subjectPattern`はPowerAutomate側のメール件名と一致する必要があります
- 正規表現を使用して、複数のファイルタイプ（employees、items）を1つのパターンで検索可能です

### スケジュール実行の設定

**設定ファイル**: `backup.json`

**設定例**:
```json
{
  "csvImports": [
    {
      "id": "daily-employees-import-gmail",
      "name": "毎日の従業員CSVインポート（Gmail）",
      "schedule": "0 2 * * *",
      "timezone": "Asia/Tokyo",
      "source": "gmail",
      "subjectPattern": "^CSV Import: employees-.*",
      "replaceExisting": false,
      "enabled": true
    },
    {
      "id": "daily-items-import-gmail",
      "name": "毎日のアイテムCSVインポート（Gmail）",
      "schedule": "0 2 * * *",
      "timezone": "Asia/Tokyo",
      "source": "gmail",
      "subjectPattern": "^CSV Import: items-.*",
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
- `source`: データソース（`gmail`固定）
- `subjectPattern`: メール件名の正規表現パターン
- `replaceExisting`: 既存データを置き換えるか（`true`/`false`）
- `enabled`: スケジュールを有効にするか（`true`/`false`）

**注意事項**:
- PowerAutomate側の実行タイミング（午前1時30分）とPi5側のスケジュール実行タイミング（午前2時）を調整してください
- メールが確実に届くように、PowerAutomate側の実行をPi5側の実行の30分前に設定することを推奨します

## トラブルシューティング

### よくある問題

#### 1. メールが見つからない（404エラー）

**原因**:
- PowerAutomate側でメールが送信されていない
- メール件名が間違っている（パターンと一致しない）
- メールが既に処理済み（ラベルが追加されている）

**対処法**:
- PowerAutomate側の実行ログを確認
- Gmailでメールの件名を確認
- Pi5側の`backup.json`の`subjectPattern`を確認
- Gmailでメールのラベルを確認（`Pi5/Processed`ラベルが追加されていないか）

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
- Gmail API認証エラー
- ネットワーク接続エラー
- データベースエラー

**対処法**:
- Pi5側のインポート履歴を確認（`GET /api/imports/history`）
- Gmail APIトークンの有効性を確認
- エラーログを確認

#### 4. メールの重複処理

**原因**:
- 同じメールが複数回処理されている
- ラベルが追加されていない

**対処法**:
- Gmailでメールのラベルを確認（`Pi5/Processed`ラベルが追加されているか）
- Pi5側のログを確認（メールの処理済みマークが成功しているか）

## セキュリティ考慮事項

詳細は `docs/guides/gmail-attachment-integration.md` を参照してください。

**重要なポイント**:
- Gmail APIトークンは環境変数で管理（Ansible Vaultで暗号化）
- HTTPS接続必須（TLS 1.2以上）
- 証明書ピニングの実装（推奨）
- 最小権限の原則（Gmailアプリには必要最小限の権限のみ付与）

## 関連ドキュメント

- `docs/guides/gmail-attachment-integration.md`: Gmail添付ファイル統合ガイド（Pi5側の設定）
- `docs/guides/powerautomate-dropbox-integration.md`: PowerAutomate → Dropbox → Pi5統合ガイド（参考）

## 更新履歴

- 2025-12-21: 初版作成（PowerAutomate側仕様の明文化）
