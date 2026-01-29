---
title: APIキー統一の方針とフィルタリングロジック
tags: [API, 認証, クライアントキー, キオスク]
audience: [開発者, 運用者]
last-verified: 2025-12-02
related: [api.md, kiosk.md]
category: guides
update-frequency: low
---

# APIキー統一の方針とフィルタリングロジック

最終更新: 2025-12-02

## 概要

本システムでは、複数のAPIキー（クライアントキー）が存在しますが、**キオスク画面ではすべての貸出を表示する**という方針を採用しています。これにより、異なるAPIキーで作成された貸出も含めて、すべての貸出情報を確認できます。

## 現在のAPIキー構成

| APIキー | クライアントID | 用途 | 初期表示モード |
|---------|---------------|------|--------------|
| `client-demo-key` | `5c88681a-1f1c-4c7f-a5c7-fbfc0a7387a2` | デモ・開発用 | `TAG` (2タグスキャン) |
| `client-key-raspberrypi3-signage1` | `d1f81cfa-af3c-4958-9252-7da69d4b7e96` | Pi3サイネージ用 | `PHOTO` (写真撮影持出) |
| `client-key-raspberrypi4-kiosk1` | `43bb79fd-6f4c-42fb-b342-5531687581be` | Pi4キオスク用 | `PHOTO` (写真撮影持出) |

## 問題の背景

以前は、以下の問題が発生していました：

1. **フィルタリング問題**: Pi4のキオスクが`client-key-raspberrypi4-kiosk1`を使用すると、そのclientIdでフィルタリングされ、`client-demo-key`で作成された昨日の貸出が表示されない
2. **カメラ問題**: 特定のAPIキーを使用すると、カメラが起動しない（ブラウザのカメラAPI権限の問題の可能性）

## 解決方針

### 1. キオスク画面では全件表示

**方針**: キオスク画面では、どのAPIキーを使用しても、**すべての貸出を表示**します。

**実装**:
- `/api/tools/loans/active`エンドポイントで、クライアントキーから自動解決されたclientIdでフィルタリングしない
- `clientId`がクエリパラメータで**明示的に指定されている場合のみ**フィルタリング
- キオスク画面では、`clientId`を送信しない（または空文字列を送信）

**コード例**:

```typescript
// apps/web/src/api/client.ts
export async function getActiveLoans(clientId?: string, clientKey: string = 'client-demo-key') {
  // キオスク画面では全件表示するため、clientIdを送信しない
  const { data } = await api.get<{ loans: Loan[] }>('/tools/loans/active', {
    params: clientId ? { clientId } : {}, // clientIdが明示的に指定されている場合のみ送信
    headers: { 'x-client-key': clientKey }
  });
  return data.loans;
}
```

```typescript
// apps/api/src/routes/tools/loans/active.ts
// キオスク画面では、クライアントキー認証があっても全件表示する
// clientIdがクエリパラメータで明示的に指定されている場合のみフィルタリング
const loans = await loanService.findActive({ clientId: query.clientId || undefined });
```

### 2. APIキーの用途

| APIキー | 用途 | 説明 |
|---------|------|------|
| `client-demo-key` | デモ・開発用 | 開発環境やデモ環境で使用。すべてのキオスクで使用可能 |
| `client-key-raspberrypi3-signage1` | Pi3サイネージ用 | Pi3のサイネージ表示専用。サイネージの設定（`defaultMode`など）を取得するために使用 |
| `client-key-raspberrypi4-kiosk1` | Pi4キオスク用 | Pi4のキオスク専用。キオスクの設定（`defaultMode`など）を取得するために使用 |

### 3. カメラAPIの認証

カメラAPI（`POST /api/tools/loans/photo-borrow`）は、クライアントキー認証をサポートしていますが、**ブラウザのカメラAPIの権限は別問題**です。

**注意**: カメラが起動しない場合は、以下の点を確認してください：

1. **HTTPS接続**: ブラウザのカメラAPIはHTTPS接続が必要です
2. **ブラウザの権限**: ブラウザがカメラへのアクセスを許可しているか確認
3. **コンソールログ**: ブラウザの開発者ツールでエラーログを確認

## 実装の詳細

### フィルタリングロジック

```typescript
// apps/api/src/routes/tools/loans/active.ts
app.get('/active', async (request, reply) => {
  const query = activeLoanQuerySchema.parse(request.query);
  let resolvedClientId = query.clientId;
  let allowWithoutAuth = false;

  // クライアントキーがあれば優先的にデバイス認証とみなす
  const headerKey = request.headers['x-client-key'];
  if (headerKey) {
    // clientIdがクエリパラメータで指定されていない場合のみ、クライアントキーから解決
    if (!resolvedClientId) {
      resolvedClientId = await loanService.resolveClientId(undefined, headerKey);
    } else {
      // clientIdが指定されている場合は検証のみ
      await loanService.resolveClientId(resolvedClientId, headerKey);
    }
    allowWithoutAuth = true;
  }

  // キオスク画面では全件表示するため、クエリパラメータのclientIdのみを使用
  const loans = await loanService.findActive({ clientId: query.clientId || undefined });

  return { loans };
});
```

### キオスク画面での使用

持出タブ・返却一覧では**全端末の持出中**を表示するため、`useActiveLoans` の第一引数は必ず `undefined` にすること。`KioskBorrowPage`・`KioskReturnPage`・`KioskPhotoBorrowPage` のいずれも同じとする（KB-211 参照）。

```typescript
// apps/web/src/pages/kiosk/KioskReturnPage.tsx
const [localClientKey] = useLocalStorage('kiosk-client-key', 'client-demo-key');
const [localClientId] = useLocalStorage('kiosk-client-id', '');

// clientIdは送信しない（全件表示のため）
const loansQuery = useActiveLoans(undefined, localClientKey);
```

```typescript
// apps/web/src/pages/kiosk/KioskPhotoBorrowPage.tsx（写真タブ・持出一覧）
// 返却一覧は全クライアント分を表示（端末間共有のため）
const loansQuery = useActiveLoans(undefined, resolvedClientKey);
```

## 今後の改善案

1. **APIキーの統一**: すべてのキオスクで`client-demo-key`を使用し、設定（`defaultMode`など）は別の方法で管理する
2. **カメラAPIの権限管理**: ブラウザのカメラAPIの権限をより明確に管理する
3. **フィルタリングオプション**: 管理画面などで、特定のclientIdでフィルタリングするオプションを追加する

## 関連ドキュメント

- [API仕様書](../modules/tools/api.md)
- [認証API](../api/auth.md)
- [キオスク設定ガイド](./kiosk-setup.md)

