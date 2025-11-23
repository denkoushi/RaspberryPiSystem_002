# 認証API

最終更新: 2025-01-XX

## 概要

認証APIは、ユーザーのログインとトークン管理を提供します。

## エンドポイント

### POST /api/auth/login

ユーザー名とパスワードでログインし、アクセストークンとリフレッシュトークンを取得します。

#### リクエスト

```json
{
  "username": "admin",
  "password": "admin1234"
}
```

#### レスポンス

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "80383a53-6885-4237-ad2b-ea2a47988f40",
    "username": "admin",
    "role": "ADMIN"
  }
}
```

#### エラー

- `401` - ユーザー名またはパスワードが違います
- `403` - アカウントが無効化されています
- `429` - レート制限超過（5リクエスト/分）

### POST /api/auth/refresh

リフレッシュトークンを使用して新しいアクセストークンを取得します。

#### リクエスト

```json
{
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

#### レスポンス

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

#### エラー

- `401` - リフレッシュトークンが無効です
- `429` - レート制限超過（5リクエスト/分）

## トークンの使用方法

取得したアクセストークンは、APIリクエストの`Authorization`ヘッダーに含めます：

```bash
curl -H "Authorization: Bearer <accessToken>" \
  http://localhost:8080/api/tools/employees
```

## トークンの有効期限

- **アクセストークン**: 15分
- **リフレッシュトークン**: 7日

アクセストークンの有効期限が切れた場合、リフレッシュトークンを使用して新しいアクセストークンを取得してください。

## セキュリティ

- 認証エンドポイントには厳しいレート制限（5リクエスト/分）が適用されます
- パスワードはbcryptでハッシュ化されて保存されます
- HTTPSの使用を強く推奨します（本番環境では必須）

