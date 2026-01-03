---
title: PowerAutomate Gmail連携仕様
tags: [PowerAutomate, Gmail, CSV, インポート]
audience: [運用者, 開発者]
last-verified: 2025-12-29
related: [gmail-setup-guide.md, csv-import-export.md]
category: guides
update-frequency: medium
---

# PowerAutomate Gmail連携仕様

最終更新: 2025-12-29

## 概要

本ドキュメントでは、PowerAutomateからGmail経由でPi5にCSVファイルやJPEGファイルを送信するための仕様を説明します。

## メール送信仕様

### 基本仕様

- **送信先**: Pi5で設定したGmailアカウントのメールボックス
- **送信方法**: PowerAutomateの「メールを送信する (V2)」アクションを使用
- **認証**: PowerAutomate側でGmailアカウントへの接続を設定

### メール件名パターン

メールの件名は、Pi5側で設定した件名パターンと一致させる必要があります。

**推奨パターン**:
- 従業員CSV: `[Pi5 CSV Import] employees`
- アイテムCSV: `[Pi5 CSV Import] items`
- 写真JPEG: `[Pi5 CSV Import] photos`

**注意事項**:
- 件名パターンは大文字・小文字を区別しませんが、スペースや記号は正確に一致させる必要があります
- Pi5側で設定した件名パターンと完全に一致させる必要があります
- 複数のメールが一致する場合、最初に見つかったメールの添付ファイルが使用されます

### 送信元メールアドレス

Pi5側で送信元メールアドレスを設定している場合、PowerAutomate側で送信するメールの送信元アドレスと一致させる必要があります。

**設定例**:
- PowerAutomate側の送信元: `powerautomate@example.com`
- Pi5側の設定: `powerautomate@example.com`

**注意事項**:
- 送信元メールアドレスを設定していない場合、Pi5側はすべてのメールを検索します
- 送信元メールアドレスを設定することで、検索対象を絞り込むことができます

### 添付ファイル仕様

#### CSVファイル

**ファイル名**:
- 従業員CSV: `employees.csv`（推奨）
- アイテムCSV: `items.csv`（推奨）
- ファイル名は任意ですが、分かりやすい名前を推奨します

**ファイル形式**:
- **エンコーディング**: UTF-8（必須）
- **改行コード**: LF（推奨）またはCRLF
- **ヘッダー行**: 必須

**従業員CSV形式**:
```csv
employeeCode,displayName,nfcTagUid,department,contact,status
0001,山田 太郎,TAG-001,製造部,090-1234-5678,ACTIVE
0002,佐藤 花子,TAG-002,品質管理部,090-2345-6789,ACTIVE
```

**必須カラム**:
- `employeeCode`: 従業員コード（4桁の数字、例: `0001`）
- `displayName`: 表示名（氏名）

**任意カラム**:
- `nfcTagUid`: NFCタグUID
- `department`: 部署名
- `contact`: 連絡先
- `status`: ステータス（`ACTIVE`, `INACTIVE`, `RETIRED`）

**アイテムCSV形式**:
```csv
itemCode,name,nfcTagUid,category,storageLocation,status,notes
TO0001,ドライバーセット,TAG-TO001,工具,工具庫,AVAILABLE,標準ドライバーセット
TO0002,レンチセット,TAG-TO002,工具,工具庫,AVAILABLE,メトリックレンチセット
```

**必須カラム**:
- `itemCode`: アイテムコード（`TO` + 4桁の数字、例: `TO0001`）
- `name`: アイテム名

**任意カラム**:
- `nfcTagUid`: NFCタグUID
- `category`: カテゴリ
- `storageLocation`: 保管場所
- `status`: ステータス（`AVAILABLE`, `BORROWED`, `MAINTENANCE`, `RETIRED`）
- `notes`: 備考

#### JPEGファイル

**ファイル名**:
- 任意のファイル名（例: `photo-001.jpg`）
- ファイル名にタイムスタンプを含めることを推奨（例: `photo-20251229-120000.jpg`）

**ファイル形式**:
- **形式**: JPEG（`.jpg`または`.jpeg`）
- **最大サイズ**: 10MB（推奨）
- **解像度**: 任意（Pi5側で自動的にサムネイルを生成）

**メール件名パターン**:
- `[Pi5 CSV Import] photos`（推奨）
- Pi5側で設定した件名パターンと一致させる必要があります

### メール送信タイミング

**推奨送信タイミング**:
- **日次**: 毎日午前2時（Pi5側のCSVインポートスケジュールと合わせる）
- **週次**: 毎週月曜日午前2時
- **手動**: 必要に応じて手動で送信

**注意事項**:
- Pi5側のCSVインポートスケジュールの実行時刻より前にメールを送信する必要があります
- メール送信後、Pi5側でメールが検索可能になるまで数秒かかる場合があります

## PowerAutomateフロー例

### 基本的なCSV送信フロー

```
1. SharePointリストからCSVデータを取得
2. CSVファイルを作成（「CSVテーブルを作成」アクション）
3. CSVファイルを添付してメールを送信
   - 送信先: Pi5で設定したGmailアカウント
   - 件名: [Pi5 CSV Import] employees（またはitems）
   - 添付ファイル: 作成したCSVファイル
```

### スケジュール実行フロー

```
1. スケジュールトリガー（毎日午前1時30分）
2. SharePointリストからCSVデータを取得
3. CSVファイルを作成
4. CSVファイルを添付してメールを送信
   - 件名: [Pi5 CSV Import] employees
5. （オプション）送信成功通知をSlackに送信
```

### エラーハンドリング

```
1. CSVデータ取得
2. CSVファイル作成
3. メール送信（エラーハンドリング付き）
   - 成功時: 送信成功通知
   - 失敗時: エラー通知をSlackに送信
```

## 注意事項

### セキュリティ

- Gmailアカウントの認証情報は安全に管理してください
- PowerAutomate側でGmail接続を設定する際は、最小限の権限を付与してください
- Pi5側で送信元メールアドレスを設定することで、不正なメールをフィルタリングできます

### パフォーマンス

- 大量のデータを送信する場合、複数のメールに分割することを推奨します
- 1メールあたりの添付ファイルサイズは10MB以下を推奨します
- CSVファイルの行数が多い場合（1000行以上）、処理に時間がかかる場合があります

### エラー処理

- PowerAutomate側でメール送信が失敗した場合、リトライ機能を使用してください
- Pi5側でメールが見つからない場合、件名パターンや送信元アドレスを確認してください
- CSVインポートが失敗した場合、Pi5側のログを確認してください

## 関連ドキュメント

- [Gmail連携セットアップガイド](./gmail-setup-guide.md): Pi5側の設定手順
- [CSVインポート・エクスポート](./csv-import-export.md): CSVインポート機能の詳細

