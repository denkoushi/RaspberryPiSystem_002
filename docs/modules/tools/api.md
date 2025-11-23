# 工具管理モジュール API仕様書

## 認証

すべてのエンドポイントはJWT認証が必要です（`/borrow`と`/return`はクライアントキー認証も可能）。

```
Authorization: Bearer <access_token>
```

または、クライアントキー認証：

```
x-client-key: <client_api_key>
```

## 従業員管理 API

### GET /api/tools/employees

従業員一覧を取得します。

**クエリパラメータ**:
- `search` (string, optional): 検索文字列（displayName, employeeCode）
- `status` (enum, optional): ステータスフィルタ（ACTIVE, INACTIVE）

**レスポンス**:
```json
{
  "employees": [
    {
      "id": "uuid",
      "employeeCode": "string",
      "displayName": "string",
      "nfcTagUid": "string | null",
      "department": "string | null",
      "contact": "string | null",
      "status": "ACTIVE | INACTIVE",
      "createdAt": "ISO8601",
      "updatedAt": "ISO8601"
    }
  ]
}
```

### POST /api/tools/employees

従業員を作成します。

**リクエストボディ**:
```json
{
  "employeeCode": "string (required)",
  "displayName": "string (required)",
  "nfcTagUid": "string | null (optional, min 4 chars)",
  "department": "string | null (optional)",
  "contact": "string | null (optional)",
  "status": "ACTIVE | INACTIVE (optional, default: ACTIVE)"
}
```

**レスポンス**: 作成された従業員オブジェクト

## アイテム管理 API

### GET /api/tools/items

アイテム一覧を取得します。

**クエリパラメータ**:
- `search` (string, optional): 検索文字列（name, itemCode）
- `status` (enum, optional): ステータスフィルタ（AVAILABLE, IN_USE, RETIRED）

**レスポンス**:
```json
{
  "items": [
    {
      "id": "uuid",
      "itemCode": "string",
      "name": "string",
      "description": "string | null",
      "nfcTagUid": "string | null",
      "category": "string | null",
      "storageLocation": "string | null",
      "status": "AVAILABLE | IN_USE | RETIRED",
      "notes": "string | null",
      "createdAt": "ISO8601",
      "updatedAt": "ISO8601"
    }
  ]
}
```

## 貸出・返却 API

### POST /api/tools/borrow

持出を登録します。

**リクエストボディ**:
```json
{
  "itemTagUid": "string (required, min 4 chars)",
  "employeeTagUid": "string (required, min 4 chars)",
  "clientId": "uuid (optional)",
  "dueAt": "ISO8601 (optional)",
  "note": "string | null (optional)"
}
```

**レスポンス**:
```json
{
  "loan": {
    "id": "uuid",
    "itemId": "uuid",
    "employeeId": "uuid",
    "borrowedAt": "ISO8601",
    "dueAt": "ISO8601 | null",
    "returnedAt": "ISO8601 | null",
    "clientId": "uuid | null",
    "notes": "string | null",
    "item": { ... },
    "employee": { ... },
    "client": { ... }
  }
}
```

### POST /api/tools/return

返却を登録します。

**リクエストボディ**:
```json
{
  "loanId": "uuid (required)",
  "clientId": "uuid (optional)",
  "performedByUserId": "uuid (optional)",
  "note": "string | null (optional)"
}
```

**レスポンス**: 更新されたLoanオブジェクト

### GET /api/tools/loans/active

アクティブな貸出一覧を取得します。

**クエリパラメータ**:
- `clientId` (uuid, optional): クライアントIDでフィルタ

**レスポンス**:
```json
{
  "loans": [
    {
      "id": "uuid",
      "itemId": "uuid",
      "employeeId": "uuid",
      "borrowedAt": "ISO8601",
      "item": { ... },
      "employee": { ... },
      "client": { ... }
    }
  ]
}
```

## トランザクション履歴 API

### GET /api/tools/transactions

トランザクション履歴を取得します（ページネーション対応）。

**クエリパラメータ**:
- `page` (number, optional, default: 1): ページ番号
- `pageSize` (number, optional, default: 20, max: 100): 1ページあたりの件数
- `employeeId` (uuid, optional): 従業員IDでフィルタ
- `itemId` (uuid, optional): アイテムIDでフィルタ
- `clientId` (uuid, optional): クライアントIDでフィルタ
- `startDate` (ISO8601, optional): 開始日時でフィルタ
- `endDate` (ISO8601, optional): 終了日時でフィルタ

**レスポンス**:
```json
{
  "transactions": [
    {
      "id": "uuid",
      "loanId": "uuid",
      "action": "BORROW | RETURN",
      "actorEmployeeId": "uuid",
      "performedByUserId": "uuid | null",
      "clientId": "uuid | null",
      "details": {
        "note": "string | null",
        "itemSnapshot": { ... },
        "employeeSnapshot": { ... }
      },
      "createdAt": "ISO8601",
      "loan": { ... },
      "actorEmployee": { ... }
    }
  ],
  "total": 100,
  "page": 1,
  "pageSize": 20
}
```

## エラーレスポンス

すべてのエンドポイントは以下の形式でエラーを返します：

```json
{
  "message": "エラーメッセージ",
  "error": "Error Name",
  "statusCode": 400
}
```

### 主なエラーコード

- `400`: バリデーションエラー、ビジネスロジックエラー
- `401`: 認証エラー
- `404`: リソースが見つからない
- `500`: サーバーエラー

