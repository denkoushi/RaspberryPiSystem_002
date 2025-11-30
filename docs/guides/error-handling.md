# エラーハンドリングガイド

## 概要

このガイドでは、Raspberry Pi System 002のAPIにおけるエラーハンドリングの仕組みと、エラーレスポンスの形式、エラーログの構造について説明します。

## エラーレスポンス形式

すべてのAPIエラーレスポンスは統一された形式で返されます。

### 基本形式

```json
{
  "message": "エラーメッセージ（ユーザー向け）",
  "errorCode": "ERROR_CODE",
  "requestId": "req-xxx",
  "timestamp": "2025-11-30T10:38:20.369Z",
  "details": {},
  "issues": []
}
```

### フィールド説明

- **`message`** (必須): ユーザー向けのエラーメッセージ（日本語）
- **`errorCode`** (オプション): エラーを識別するためのコード（例: `VALIDATION_ERROR`, `AUTH_TOKEN_INVALID`, `P2002`）
- **`requestId`** (必須): リクエストを識別するためのID（ログと対応付け可能）
- **`timestamp`** (必須): エラー発生時刻（ISO 8601形式）
- **`details`** (オプション): エラーの詳細情報（Prismaエラーなど）
- **`issues`** (オプション): バリデーションエラーの詳細（Zodバリデーションエラー）

## エラーコード一覧

### 認証・認可エラー

| エラーコード | HTTPステータス | 説明 |
|------------|--------------|------|
| `AUTH_TOKEN_REQUIRED` | 401 | 認証トークンが提供されていない |
| `AUTH_TOKEN_INVALID` | 401 | 認証トークンが無効または期限切れ |
| `PERMISSION_DENIED` | 403 | 操作権限が不足している |

### バリデーションエラー

| エラーコード | HTTPステータス | 説明 |
|------------|--------------|------|
| `VALIDATION_ERROR` | 400 | リクエスト形式が不正（Zodバリデーションエラー） |

### データベースエラー（Prisma）

| エラーコード | HTTPステータス | 説明 |
|------------|--------------|------|
| `P2002` | 409 | 一意制約違反（重複エラー） |
| `P2003` | 400 | 外部キー制約違反（参照エラー） |
| `P2025` | 404 | レコードが見つからない |

### その他のエラー

| エラーコード | HTTPステータス | 説明 |
|------------|--------------|------|
| `INTERNAL_SERVER_ERROR` | 500 | 予期しないサーバーエラー |

## エラーレスポンス例

### バリデーションエラー

```json
{
  "message": "リクエスト形式が不正です",
  "errorCode": "VALIDATION_ERROR",
  "requestId": "req-abc123",
  "timestamp": "2025-11-30T10:38:20.369Z",
  "issues": [
    {
      "code": "invalid_string",
      "path": ["employeeCode"],
      "message": "employeeCodeは正規表現パターンに一致する必要があります"
    },
    {
      "code": "required",
      "path": ["displayName"],
      "message": "displayNameは必須です"
    }
  ]
}
```

### 認証エラー

```json
{
  "message": "トークンが無効です",
  "errorCode": "AUTH_TOKEN_INVALID",
  "requestId": "req-def456",
  "timestamp": "2025-11-30T10:38:20.369Z"
}
```

### Prismaエラー（P2002: 一意制約違反）

```json
{
  "message": "従業員コード '0001' は既に使用されています",
  "errorCode": "P2002",
  "requestId": "req-ghi789",
  "timestamp": "2025-11-30T10:38:20.369Z",
  "details": {
    "target": ["employeeCode"]
  }
}
```

### Prismaエラー（P2003: 外部キー制約違反）

```json
{
  "message": "従業員ID 'xxx' は存在しません",
  "errorCode": "P2003",
  "requestId": "req-jkl012",
  "timestamp": "2025-11-30T10:38:20.369Z",
  "details": {
    "field_name": "employeeId"
  }
}
```

## エラーログの構造

エラーログは構造化されて記録され、問題の特定と分析が容易になります。

### ログ形式

```json
{
  "level": 40,
  "time": 1764497516964,
  "pid": 1,
  "hostname": "6b50ba16e996",
  "requestId": "req-abc123",
  "method": "POST",
  "url": "/api/tools/employees",
  "errorCode": "VALIDATION_ERROR",
  "errorName": "ZodError",
  "errorMessage": "リクエスト形式が不正です",
  "userId": "80383a53-6885-4237-ad2b-ea2a47988f40",
  "stack": "ZodError: ...",
  "issues": [...]
}
```

### ログフィールド説明

- **`requestId`**: リクエストID（エラーレスポンスと対応付け可能）
- **`method`**: HTTPメソッド（GET, POST, PUT, DELETEなど）
- **`url`**: リクエストURL
- **`errorCode`**: エラーコード（エラーレスポンスと同じ）
- **`errorName`**: エラーの型名（ZodError, ApiError, PrismaClientKnownRequestErrorなど）
- **`errorMessage`**: エラーメッセージ
- **`userId`**: ユーザーID（認証済みリクエストの場合）
- **`stack`**: エラースタックトレース（デバッグ用）

## エラーハンドリングの実装

### ApiErrorクラス

カスタムエラーを投げる場合は`ApiError`クラスを使用します。

```typescript
import { ApiError } from '../lib/errors.js';

// 基本的な使用例
throw new ApiError(404, 'リソースが見つかりません', undefined, 'RESOURCE_NOT_FOUND');

// 詳細情報を含む例
throw new ApiError(400, '無効なリクエストです', { field: 'employeeCode' }, 'INVALID_REQUEST');
```

### エラーハンドラーの動作

1. **ZodError**: バリデーションエラーとして処理（`errorCode: VALIDATION_ERROR`）
2. **PrismaClientKnownRequestError**: Prismaエラーコードに基づいて詳細メッセージを生成
3. **ApiError**: カスタムエラーとして処理（指定された`errorCode`を使用）
4. **その他のエラー**: 予期しないエラーとして処理（`errorCode: INTERNAL_SERVER_ERROR`）

## トラブルシューティング

### エラーログの確認方法

```bash
# APIコンテナのログを確認
docker compose -f infrastructure/docker/docker-compose.server.yml logs api --tail 50

# エラーログのみをフィルタリング
docker compose -f infrastructure/docker/docker-compose.server.yml logs api --tail 100 | grep -i error

# 特定のrequestIdで検索
docker compose -f infrastructure/docker/docker-compose.server.yml logs api | grep "req-abc123"
```

### エラーレスポンスの確認方法

```bash
# curlでエラーレスポンスを確認
curl -X POST http://localhost:8080/api/tools/employees \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"employeeCode": "0001"}' | jq
```

### よくある問題と解決方法

#### 1. 認証エラーが発生する

**症状**: `AUTH_TOKEN_INVALID`エラーが返される

**解決方法**:
- トークンが期限切れていないか確認
- トークンの形式が正しいか確認（`Bearer <token>`形式）
- 新しいトークンを取得して再試行

```bash
# 新しいトークンを取得
TOKEN=$(curl -s -X POST http://localhost:8080/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin1234"}' | jq -r '.accessToken')
```

#### 2. バリデーションエラーが発生する

**症状**: `VALIDATION_ERROR`エラーが返される

**解決方法**:
- `issues`フィールドを確認して、どのフィールドが不正か確認
- リクエストボディの形式を確認（JSON形式、必須フィールドの有無など）

#### 3. Prismaエラーが発生する

**症状**: `P2002`（一意制約違反）や`P2003`（外部キー制約違反）エラーが返される

**解決方法**:
- `details`フィールドを確認して、どのフィールドで制約違反が発生したか確認
- データベースの状態を確認（重複データ、参照先の存在など）

## 関連ドキュメント

- [ログ出力ガイド](./logging.md)
- [システム安定性向上計画](../plans/stability-improvement-plan.md)
- [API概要](../api/overview.md)

