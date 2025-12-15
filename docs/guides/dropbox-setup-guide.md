# Dropbox連携セットアップガイド

最終更新: 2025-12-14

## 概要

本ガイドでは、Dropboxアカウントと本システムを連携させるための手順を説明します。

## 前提条件

- Dropboxアカウントを持っていること
- インターネット接続が可能なこと

## 手順

### Step 1: Dropbox App Consoleでアプリを作成

1. **Dropbox App Consoleにアクセス**
   - ブラウザで https://www.dropbox.com/developers/apps を開く
   - Dropboxアカウントでログイン

2. **新しいアプリを作成**
   - 「Create app」ボタンをクリック
   - 以下の設定を選択：
     - **Choose an API**: `Dropbox API`
     - **Choose the type of access you need**: `Full Dropbox` または `App folder`（推奨: `App folder`）
     - **Name your app**: 任意の名前（例: `RaspberryPiSystem-Backup`）
   - 「Create app」ボタンをクリック

3. **アプリの設定を確認**
   - 作成されたアプリのページが表示される
   - 「Permissions」タブで必要な権限を確認：
     - `files.content.write`（ファイルのアップロード）
     - `files.content.read`（ファイルのダウンロード）
     - `files.metadata.read`（ファイル一覧の取得）
     - `files.metadata.write`（ファイルの削除）

### Step 2: アクセストークンを生成

⚠️ **重要: Dropboxのトークン有効期限について**

Dropboxは2024年以降、**長期アクセストークン（無期限）の新規発行を停止**しました。現在は以下の2つの方法があります：

#### 方法A: App Consoleで生成（簡易、短期トークン）

1. **Generated access tokenを生成**
   - アプリのページで「Generate access token」ボタンをクリック
   - 表示されたトークンをコピー（**このトークンは一度しか表示されません**）
   - ⚠️ **注意**: この方法で生成されるトークンは**短期トークン（通常4時間）**の可能性があります
   - アプリの設定で「Access token expiration」を確認してください

2. **トークンの確認**
   - トークンは `sl.` で始まる長い文字列です
   - 例: `sl.Bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`

#### 方法B: OAuth 2.0フローでリフレッシュトークンを取得（推奨、長期アクセス）✅ **実装完了**

長期アクセスが必要な場合は、OAuth 2.0フローを使用してリフレッシュトークンを取得することを推奨します：

**✅ 実装状況**: OAuth 2.0フローとリフレッシュトークンの自動更新機能が実装済みです。

詳細な手順は [`docs/guides/dropbox-oauth-setup-guide.md`](./dropbox-oauth-setup-guide.md) を参照してください。

**主な機能**:
- OAuth 2.0認証フロー（認証URL生成、認証コード受け取り、トークン交換）
- リフレッシュトークンによる自動アクセストークン更新
- 401エラー（`expired_access_token`）時の自動リフレッシュ
- 設定ファイルへの自動トークン保存

### Step 3: 環境変数に設定

#### 方法A: 開発環境（ローカル）

1. **`.env`ファイルを編集**
   ```bash
   cd /Users/tsudatakashi/RaspberryPiSystem_002/apps/api
   # .envファイルが存在しない場合は作成
   echo "DROPBOX_ACCESS_TOKEN=sl.あなたのトークン" >> .env
   ```

2. **環境変数を確認**
   ```bash
   grep DROPBOX_ACCESS_TOKEN .env
   ```

#### 方法B: テスト実行時のみ設定

```bash
export DROPBOX_ACCESS_TOKEN="sl.あなたのトークン"
pnpm test -- dropbox-storage.integration.test
```

### Step 4: テストを実行

```bash
cd /Users/tsudatakashi/RaspberryPiSystem_002/apps/api
pnpm test -- dropbox-storage.integration.test --run
```

### Step 5: 結果の確認

テストが成功すると、以下のような出力が表示されます：

```
✓ DropboxStorageProvider integration (requires DROPBOX_ACCESS_TOKEN) > should upload and download file to Dropbox
✓ DropboxStorageProvider integration (requires DROPBOX_ACCESS_TOKEN) > should list files in Dropbox
✓ DropboxStorageProvider integration (requires DROPBOX_ACCESS_TOKEN) > should backup and restore via BackupService
```

## トラブルシューティング

### エラー: "Invalid access token"

- トークンが正しくコピーされていない可能性があります
- 再度「Generate access token」で新しいトークンを生成してください

### エラー: "Insufficient permissions"

- アプリの権限設定を確認してください
- 必要な権限が有効になっているか確認してください

### エラー: "Network error" または "Connection timeout"

- インターネット接続を確認してください
- ファイアウォール設定を確認してください

## セキュリティ注意事項

- ⚠️ **アクセストークンは機密情報です**
- `.env`ファイルは`.gitignore`に含まれていることを確認してください
- 本番環境では、Ansible Vaultなどで暗号化して管理してください

## 次のステップ

連携テストが成功したら、Milestone 3（CSV・画像バックアップの追加）に進みます。
