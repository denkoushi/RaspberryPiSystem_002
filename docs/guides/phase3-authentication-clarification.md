# Phase 3実機検証における認証トークンの整理

最終更新: 2025-12-16

## 2種類の認証トークン

Phase 3の実機検証では、**2種類の異なるトークン**が関係します：

### 1. API認証用のJWTトークン（ユーザー認証用）

**用途**: APIリクエストの認証（ユーザーがログインしたことを証明）

**取得方法**:
- 管理画面（`https://100.106.158.2/admin`）にログイン
- `POST /api/auth/login`でユーザー名とパスワードを送信
- レスポンスで`accessToken`と`refreshToken`を取得

**特徴**:
- **有効期限**: 15分（`TOKEN_EXPIRES_IN`）
- **リフレッシュトークン**: 7日間有効（`REFRESH_TOKEN_EXPIRES_IN`）
- **自動更新**: `POST /api/auth/refresh`でリフレッシュトークンを使用して新しいアクセストークンを取得可能

**実機検証での使用**:
- Phase 3のAPI（`GET /api/backup/history`、`POST /api/backup/restore/from-dropbox`など）を呼び出す際に必要
- `Authorization: Bearer <accessToken>`ヘッダーに含める

### 2. Dropbox OAuthトークン（Dropbox API認証用）

**用途**: Dropbox APIを呼び出すための認証（Dropboxにアクセスする権限を証明）

**取得方法**:
- OAuth 2.0フローで取得（`GET /api/backup/oauth/authorize`）
- 認証コードを`POST /api/backup/oauth/callback`で交換
- `accessToken`と`refreshToken`を取得

**特徴**:
- **有効期限**: Dropboxのアクセストークンは短時間で期限切れになる
- **リフレッシュトークン**: 長期間有効（無期限に近い）
- **自動更新**: ✅ **実装済み** - `DropboxOAuthService.refreshAccessToken()`で自動更新
- **自動更新の仕組み**: 
  - `DropboxStorageProvider`が401エラー（`expired_access_token`）を検出
  - `DropboxOAuthService.refreshAccessToken()`を呼び出して新しいアクセストークンを取得
  - `onTokenUpdate`コールバックで設定ファイル（`backup.json`）を自動更新

**実機検証での使用**:
- Dropboxからのバックアップダウンロードやリストア時に自動的に使用される
- ユーザーが明示的に操作する必要はない（自動更新される）

## 実機検証で必要なトークン

**Phase 3の実機検証では、API認証用のJWTトークン（ユーザー認証用）が必要です。**

Dropbox OAuthトークンは、Dropboxストレージを使用する場合に自動的に使用されますが、実機検証のAPI呼び出しには直接関係しません。

## Dropbox OAuthトークンの自動更新機能

### 実装状況

✅ **実装済み** - Phase 1で実装完了（2025-12-15）

### 実装内容

1. **`DropboxOAuthService.refreshAccessToken()`**
   - リフレッシュトークンを使用して新しいアクセストークンを取得
   - Dropbox APIの`/oauth2/token`エンドポイントを呼び出し

2. **`DropboxStorageProvider`での自動更新**
   - 401エラー（`expired_access_token`）を検出
   - 自動的に`refreshAccessToken()`を呼び出し
   - `onTokenUpdate`コールバックで設定ファイルを更新

3. **設定ファイルの自動更新**
   - `backup.json`の`storage.options.accessToken`と`storage.options.refreshToken`を自動更新
   - 次回のAPI呼び出しから新しいトークンを使用

### 検証済み

- ✅ OAuth 2.0フローでのリフレッシュトークン取得（Phase 1実機検証完了）
- ✅ リフレッシュトークンによる自動アクセストークン更新（Phase 1実機検証完了）
- ✅ 設定ファイルの自動更新（Phase 1実機検証完了）

詳細: [dropbox-oauth-verification-checklist.md](./dropbox-oauth-verification-checklist.md)

## まとめ

- **API認証用のJWTトークン**: 実機検証でAPIを呼び出すために必要（ユーザーが取得）
- **Dropbox OAuthトークン**: Dropboxストレージを使用する際に自動的に使用される（自動更新機能実装済み）

実機検証では、**API認証用のJWTトークン**を取得していただければ、Phase 3の機能をテストできます。
