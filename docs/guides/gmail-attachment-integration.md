---
title: Gmail添付ファイル統合ガイド
tags: [Gmail, CSV, 統合, 外部システム, OAuth]
audience: [運用者, 開発者, 外部システム担当者]
last-verified: 2025-12-21
related: [powerautomate-gmail-integration.md, backup-configuration.md]
category: guides
update-frequency: low
---

# Gmail添付ファイル統合ガイド

最終更新: 2025-12-21

## 概要

本ドキュメントでは、PowerAutomateからGmailにCSVファイルを添付ファイルとして送信し、Raspberry Pi 5が自動的にGmailから添付ファイルを取得してインポートする統合スキームの仕様を定義します。

## 統合スキーム

```
SharePointリスト
    ↓ (PowerAutomate)
Gmail（CSV添付ファイルとして送信）
    ↓ (Pi5がスケジュール実行で取得)
Raspberry Pi 5（CSVインポート）
```

## アーキテクチャ

### Gmail OAuth 2.0認証フロー

1. **認証URL生成**: Pi5がGmail OAuth認証URLを生成
2. **認証**: 管理者がブラウザで認証し、認証コードを取得
3. **トークン交換**: Pi5が認証コードをアクセストークン・リフレッシュトークンに交換
4. **自動更新**: リフレッシュトークンを使用してアクセストークンを自動更新

### メール検索と添付ファイル取得

1. **メール検索**: 件名パターンでメールを検索（例: `^CSV Import: employees-.*`）
2. **添付ファイル取得**: メールの添付ファイルをダウンロード
3. **CSVインポート**: 添付ファイルをCSVとして解析・インポート
4. **処理済みマーク**: 処理済みメールにラベルを追加し、既読化

## Pi5側の設定

### OAuth認証の設定

**設定ファイル**: `backup.json`

**設定例**:
```json
{
  "storage": {
    "provider": "gmail",
    "options": {
      "clientId": "your-gmail-client-id",
      "clientSecret": "your-gmail-client-secret",
      "accessToken": "initial-access-token",
      "refreshToken": "initial-refresh-token",
      "subjectPattern": "^CSV Import: (employees|items)-.*",
      "labelName": "Pi5/Processed"
    }
  }
}
```

**設定項目の説明**:
- `provider`: ストレージプロバイダー（`gmail`固定）
- `clientId`: Gmail OAuth 2.0クライアントID
- `clientSecret`: Gmail OAuth 2.0クライアントシークレット
- `accessToken`: 初期アクセストークン（OAuth認証後に設定）
- `refreshToken`: リフレッシュトークン（OAuth認証後に設定）
- `subjectPattern`: メール件名の正規表現パターン（例: `^CSV Import: (employees|items)-.*`）
- `labelName`: 処理済みメールに追加するラベル名（デフォルト: `Pi5/Processed`）

### OAuth認証フローの実行

**1. 認証URLの取得**:
```bash
curl -X GET "http://localhost:8080/api/backup/oauth/gmail/authorize" \
  -H "Authorization: Bearer <admin-token>"
```

**レスポンス**:
```json
{
  "authUrl": "https://accounts.google.com/o/oauth2/v2/auth?...",
  "state": "random-state-string"
}
```

**2. ブラウザで認証**:
- レスポンスの`authUrl`をブラウザで開く
- Gmailアカウントでログインし、権限を承認
- 認証コードが含まれたURLにリダイレクトされる

**3. 認証コードの交換**:
```bash
curl -X GET "http://localhost:8080/api/backup/oauth/gmail/callback?code=<auth-code>&state=<state>" \
  -H "Authorization: Bearer <admin-token>"
```

**レスポンス**:
```json
{
  "accessToken": "ya29.a0AfH6...",
  "refreshToken": "1//0g...",
  "expiresIn": 3600,
  "tokenType": "Bearer"
}
```

**4. 設定ファイルの更新**:
- レスポンスの`accessToken`と`refreshToken`を`backup.json`に設定
- 設定ファイルを保存

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

## APIエンドポイント

### Gmail OAuth認証

#### GET /api/backup/oauth/gmail/authorize

Gmail OAuth認証URLを生成します。

**認証**: 管理者権限必須

**レスポンス**:
```json
{
  "authUrl": "https://accounts.google.com/o/oauth2/v2/auth?...",
  "state": "random-state-string"
}
```

#### GET /api/backup/oauth/gmail/callback

認証コードをアクセストークン・リフレッシュトークンに交換します。

**認証**: 管理者権限必須

**クエリパラメータ**:
- `code`: 認証コード（必須）
- `state`: CSRF保護用のstateパラメータ（必須）

**レスポンス**:
```json
{
  "accessToken": "ya29.a0AfH6...",
  "refreshToken": "1//0g...",
  "expiresIn": 3600,
  "tokenType": "Bearer"
}
```

### Gmail設定管理

#### GET /api/backup/config/gmail

Gmail設定を取得します。

**認証**: 管理者権限必須

**レスポンス**:
```json
{
  "clientId": "your-gmail-client-id",
  "clientSecret": "***",
  "subjectPattern": "^CSV Import: (employees|items)-.*",
  "labelName": "Pi5/Processed"
}
```

#### PUT /api/backup/config/gmail

Gmail設定を更新します。

**認証**: 管理者権限必須

**リクエストボディ**:
```json
{
  "clientId": "your-gmail-client-id",
  "clientSecret": "your-gmail-client-secret",
  "subjectPattern": "^CSV Import: (employees|items)-.*",
  "labelName": "Pi5/Processed"
}
```

### CSVインポート

#### POST /api/imports/master/from-gmail

GmailからCSVファイルを取得してインポートします。

**認証**: 管理者権限必須

**リクエストボディ**:
```json
{
  "replaceExisting": false
}
```

**レスポンス**:
```json
{
  "summary": {
    "employees": {
      "created": 10,
      "updated": 5,
      "errors": 0
    },
    "items": {
      "created": 20,
      "updated": 10,
      "errors": 0
    }
  },
  "source": "gmail",
  "processedMessageCount": 2
}
```

## セキュリティ考慮事項

### OAuth 2.0認証

- **リフレッシュトークン**: アクセストークンの有効期限切れ時に自動更新
- **証明書ピニング**: Gmail APIへの接続時に証明書ピニングを実装（推奨）
- **最小権限の原則**: Gmailアプリには必要最小限の権限のみ付与

### トークン管理

- **環境変数**: 機密情報（`clientId`, `clientSecret`）は環境変数で管理可能
- **設定ファイル**: `backup.json`にトークンを保存（Ansible Vaultで暗号化推奨）
- **自動更新**: リフレッシュトークンによる自動アクセストークン更新

### メール検索

- **件名パターン**: 正規表現パターンでメールをフィルタリング
- **ラベル管理**: 処理済みメールにラベルを追加して重複処理を防止
- **既読化**: 処理済みメールを既読化して管理を容易に

## トラブルシューティング

### よくある問題

#### 1. OAuth認証エラー

**原因**:
- `clientId`または`clientSecret`が間違っている
- リダイレクトURIがGmailアプリの設定と一致していない
- 認証コードの有効期限が切れている

**対処法**:
- Gmailアプリの設定を確認（リダイレクトURI: `https://<pi5-host>/api/backup/oauth/gmail/callback`）
- 認証URLを再生成して認証をやり直す
- `backup.json`の`clientId`と`clientSecret`を確認

#### 2. アクセストークンの有効期限切れ

**原因**:
- アクセストークンの有効期限（通常1時間）が切れている
- リフレッシュトークンが無効になっている

**対処法**:
- リフレッシュトークンによる自動更新が機能しているか確認
- リフレッシュトークンが無効な場合は、OAuth認証をやり直す

#### 3. メールが見つからない

**原因**:
- 件名パターンがメールの件名と一致していない
- メールが既に処理済み（ラベルが追加されている）
- メールが削除されている

**対処法**:
- `subjectPattern`を確認し、メールの件名と一致するか確認
- Gmailでメールのラベルを確認（`Pi5/Processed`ラベルが追加されていないか）
- PowerAutomate側でメールが正しく送信されているか確認

#### 4. 添付ファイルの取得エラー

**原因**:
- 添付ファイルが存在しない
- 添付ファイルのサイズが大きすぎる（Gmail APIの制限）
- ネットワーク接続エラー

**対処法**:
- Gmailでメールの添付ファイルを確認
- 添付ファイルのサイズを確認（Gmail APIの制限: 25MB）
- エラーログを確認

## 関連ドキュメント

- `docs/guides/powerautomate-gmail-integration.md`: PowerAutomate側の仕様
- `docs/guides/backup-configuration.md`: バックアップ設定ガイド
- `docs/guides/dropbox-oauth-setup-guide.md`: Dropbox OAuth設定ガイド（参考）

## 実機検証

**実装状況**: ✅ 実装完了（2025-12-27）  
**実機検証状況**: ⏳ 未実施（2025-12-27時点）

### 実機検証手順

詳細な実機検証手順は [検証チェックリスト](./verification-checklist.md#6-gmail添付ファイル連携機能の検証未実施) を参照してください。

### 実機検証項目

1. **Gmail OAuth認証の動作確認**
   - 認証URL生成
   - 認証コード交換
   - リフレッシュトークンによる自動アクセストークン更新

2. **Gmail設定管理の動作確認**
   - 設定の取得・更新
   - `backup.json`との連携

3. **CSVインポートの動作確認**
   - PowerAutomateから送信されたメールの添付ファイル取得
   - CSVインポートの実行
   - 処理済みメールのラベル追加・既読化

4. **スケジュール実行の動作確認**
   - `backup.json`の`csvImports`設定による定期実行
   - cron形式のスケジュール設定

## 更新履歴

- 2025-12-21: 初版作成（Gmail添付ファイル統合ガイド）
- 2025-12-27: 実機検証セクション追加
