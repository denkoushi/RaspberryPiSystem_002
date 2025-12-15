# Dropboxリフレッシュトークン実装ガイド

最終更新: 2025-12-15

## 現状の問題

- Dropboxは2021年9月30日以降、長期アクセストークンの新規発行を停止
- 「Generated access token」で生成されるトークンも短期（約4時間）で期限切れになる
- スケジュールバックアップには常時アクセスが必要

## 解決策: OAuth 2.0リフレッシュトークン実装

### 概要

OAuth 2.0フローでリフレッシュトークンを取得し、アクセストークンが期限切れになったら自動的に更新する機能を実装します。

### 実装手順

#### Step 1: リフレッシュトークンの取得（手動・初回のみ）

1. **Dropbox App Consoleで設定**
   - 「Settings」→「OAuth 2」
   - 「Redirect URIs」に `http://localhost:8080/oauth/dropbox/callback` を追加
   - 「App key」と「App secret」をメモ

2. **認証URLにアクセス**
   ```
   https://www.dropbox.com/oauth2/authorize?client_id=<APP_KEY>&response_type=code&token_access_type=offline&redirect_uri=http://localhost:8080/oauth/dropbox/callback
   ```
   - `<APP_KEY>`をアプリのキーに置き換え
   - ブラウザでアクセスして認証
   - リダイレクトURLに認証コードが含まれる

3. **認証コードをトークンに交換**
   ```bash
   curl https://api.dropbox.com/oauth2/token \
     -d code=<AUTHORIZATION_CODE> \
     -d grant_type=authorization_code \
     -d client_id=<APP_KEY> \
     -d client_secret=<APP_SECRET> \
     -d redirect_uri=http://localhost:8080/oauth/dropbox/callback
   ```
   - レスポンスに`access_token`と`refresh_token`が含まれる

4. **Pi5に設定**
   ```bash
   # .envファイルに追加
   DROPBOX_APP_KEY=<APP_KEY>
   DROPBOX_APP_SECRET=<APP_SECRET>
   DROPBOX_REFRESH_TOKEN=<REFRESH_TOKEN>
   ```

#### Step 2: 自動更新機能の実装

`DropboxStorageProvider`にリフレッシュトークンを使用した自動更新機能を追加します。

**実装が必要な機能**:
1. リフレッシュトークンから新しいアクセストークンを取得
2. アクセストークンが期限切れになったら自動的にリフレッシュ
3. 更新されたアクセストークンを保存

### 暫定対応: 手動トークン更新

実装が完了するまでの暫定対応として、定期的に新しいトークンを手動で生成して設定する方法：

```bash
# 3時間ごとに新しいトークンを生成して設定するスクリプト
# （ただし、手動でApp Consoleからトークンをコピーする必要がある）
```

**注意**: この方法は推奨されません。OAuth 2.0フローの実装を推奨します。

## ポリシー適合性とアカウントバンリスク

**✅ OAuth 2.0フローとリフレッシュトークンの自動更新機能は、Dropboxの公式ポリシーに完全に適合しています。アカウントバンのリスクはありません。**

詳細は `docs/guides/dropbox-oauth-policy-compliance.md` を参照してください。

### 重要なポイント

1. **公式推奨方法**: Dropboxが公式に推奨する方法です
2. **レート制限の遵守**: 現在の実装には既にレート制限の処理が含まれています
3. **使用頻度**: 1日3回のバックアップは非常に低い頻度で、レート制限に抵触する可能性はありません

## 実装の優先度

**高**: スケジュールバックアップ機能が正常に動作するため、リフレッシュトークンの自動更新機能は必須です。

## 次のステップ

1. OAuth 2.0フローとリフレッシュトークン取得機能の実装
2. `DropboxStorageProvider`に自動更新機能を追加
3. 設定ファイルに`refresh_token`を保存する機能を追加
