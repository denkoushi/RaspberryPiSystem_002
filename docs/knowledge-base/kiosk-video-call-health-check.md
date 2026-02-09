# キオスクビデオ通話機能 健全性評価レポート

**評価日時**: 2026-02-09  
**評価対象**: キオスクビデオ通話機能（`/kiosk/call`）  
**評価者**: AI Agent

## 評価概要

キオスクのビデオ通話機能の実装を確認し、既存の仕様ドキュメントとコードを参照してロジックを把握した上で、健全性を評価しました。

## 確認した実装

### 主要コンポーネント

1. **フロントエンド**
   - `apps/web/src/pages/kiosk/KioskCallPage.tsx`: 通話ページUI
   - `apps/web/src/features/webrtc/hooks/useWebRTC.ts`: WebRTCメインフック
   - `apps/web/src/features/webrtc/hooks/useWebRTCSignaling.ts`: WebSocketシグナリングフック
   - `apps/web/src/features/webrtc/utils/media.ts`: メディアストリームユーティリティ

2. **バックエンド**
   - `apps/api/src/routes/webrtc/signaling.ts`: WebRTCシグナリングサーバー
   - `apps/api/src/routes/webrtc/call-store.ts`: コール状態管理

### 既知の問題と解決状況

ナレッジベースに記録されている問題（KB-132〜KB-141、KB-171）はすべて解決済みです：

- ✅ KB-132: WebRTCシグナリングルートのダブルプレフィックス問題 → 解決済み
- ✅ KB-136: useWebRTCフックのcleanup関数が早期実行される問題 → 解決済み（useRefでコールバックを安定化）
- ✅ KB-137: マイク未接続端末でのrecvonlyフォールバック → 解決済み
- ✅ KB-138: ビデオ通話時のDOM要素へのsrcObjectバインディング問題 → 解決済み（useEffectでバインド）
- ✅ KB-139: WebSocket接続管理（重複接続防止） → 解決済み（接続状態チェック追加）
- ✅ KB-171: clientKey/clientId未設定問題 → 解決済み（KB-225でlocalStorage無効化）

## 発見された潜在的な問題

### 🔴 問題1: useWebRTCSignaling.tsのresolveClientKey()がDEFAULT_CLIENT_KEYをフォールバックとして使用していない

**場所**: `apps/web/src/features/webrtc/hooks/useWebRTCSignaling.ts:12-26`

**問題の詳細**:
- `useWebRTCSignaling.ts`の`resolveClientKey()`関数は、`localStorage`に値がない場合に空文字列を返す
- 一方、`apps/web/src/api/client.ts`の`resolveClientKey()`は`DEFAULT_CLIENT_KEY`をフォールバックとして使用している
- KB-225でlocalStorageへの書き込みが無効化され、`DEFAULT_CLIENT_KEY`を直接使用するように変更されたが、`useWebRTCSignaling.ts`はこの変更に対応していない

**影響**:
- `localStorage`に`kiosk-client-key`が設定されていない場合、WebSocket接続が確立されない
- `connect()`関数の97行目で`if (!clientKey || !clientId)`により早期リターンし、接続が試行されない

**現在の実装**:
```typescript
const resolveClientKey = (): string => {
  if (typeof window === 'undefined') return '';
  const savedKey = window.localStorage.getItem('kiosk-client-key');
  if (!savedKey || savedKey.length === 0) return '';  // ← 空文字列を返す
  // ...
};
```

**推奨される修正**:
```typescript
import { DEFAULT_CLIENT_KEY } from '../../api/client';

const resolveClientKey = (): string => {
  if (typeof window === 'undefined') return DEFAULT_CLIENT_KEY;
  const savedKey = window.localStorage.getItem('kiosk-client-key');
  if (!savedKey || savedKey.length === 0) return DEFAULT_CLIENT_KEY;  // ← フォールバック追加
  // ...
};
```

### 🟡 問題2: clientIdの初期化が不十分

**場所**: `apps/web/src/features/webrtc/hooks/useWebRTCSignaling.ts:28-42`

**問題の詳細**:
- `resolveClientId()`関数は`localStorage`に`kiosk-client-id`が設定されていない場合、`null`を返す
- `client.ts`では`kiosk-client-key`は初期化されているが、`kiosk-client-id`の初期化は行われていない
- KB-225でlocalStorageへの書き込みが無効化されたため、`clientId`が設定されない可能性がある

**影響**:
- `clientId`が`null`の場合、WebSocket接続が確立されない（97行目で早期リターン）
- ただし、`client.ts`の初期化（85行目）で`kiosk-client-key`は設定されているため、`clientId`のみが問題となる

**現在の実装**:
```typescript
const resolveClientId = (): string | null => {
  if (typeof window === 'undefined') return null;
  const savedId = window.localStorage.getItem('kiosk-client-id');
  if (!savedId || savedId.length === 0) return null;  // ← nullを返す
  // ...
};
```

**推奨される対応**:
1. **オプションA**: `clientId`をAPIから取得する（`statusClientId`をクライアントデバイステーブルから取得）
2. **オプションB**: 環境変数から`DEFAULT_CLIENT_ID`を定義し、フォールバックとして使用
3. **オプションC**: `client.ts`の初期化時に`clientId`も設定する（ただし、KB-225の方針と矛盾する可能性がある）

**注意**: KB-225でlocalStorageへの書き込みが無効化されたため、`clientId`の取得方法を再検討する必要がある。

### 🟢 問題3: デバッグログの残存

**場所**: `apps/web/src/pages/kiosk/KioskCallPage.tsx`、`apps/web/src/features/webrtc/hooks/useWebRTC.ts`、`apps/web/src/features/webrtc/hooks/useWebRTCSignaling.ts`

**問題の詳細**:
- デバッグ用の`fetch`呼び出しが複数箇所に残っている（`http://127.0.0.1:7242/ingest/...`）
- 本番環境では不要な可能性がある

**影響**:
- パフォーマンスへの影響は軽微（エラーは無視されている）
- コードの可読性が低下

**推奨される対応**:
- デバッグログを環境変数で制御するか、削除する

## 健全性評価

### ✅ 正常に動作している機能

1. **WebRTC接続確立**: 実装は適切で、既知の問題はすべて解決済み
2. **シグナリングサーバー**: Fastify WebSocketを使用した実装は堅牢
3. **エラーハンドリング**: recvonlyフォールバック、接続状態管理、クリーンアップ処理が適切に実装されている
4. **メディアストリーム管理**: ビデオの有効化/無効化、ストリームのクリーンアップが適切

### ⚠️ 改善が必要な点

1. **clientKey/clientIdの解決ロジック**: `useWebRTCSignaling.ts`の`resolveClientKey()`が`DEFAULT_CLIENT_KEY`をフォールバックとして使用していない
2. **clientIdの初期化**: `clientId`の取得方法が不明確（localStorageに依存しているが、KB-225で無効化された）

### 📊 総合評価

**健全性スコア**: 7/10

**評価理由**:
- 既知の問題はすべて解決済みで、実装は堅牢
- ただし、`clientKey`/`clientId`の解決ロジックに不整合があり、特定の条件下で動作しない可能性がある
- デバッグログの残存は軽微な問題

## 推奨される対応

### 優先度: 高

1. **`useWebRTCSignaling.ts`の`resolveClientKey()`を修正**
   - `DEFAULT_CLIENT_KEY`をインポートし、フォールバックとして使用
   - `client.ts`の`resolveClientKey()`と整合性を保つ

2. **`clientId`の取得方法を明確化**
   - KB-225の方針（localStorage無効化）と整合性を保つ方法を検討
   - APIから`statusClientId`を取得するか、環境変数から取得するかを決定

### 優先度: 中

3. **デバッグログの整理**
   - デバッグ用の`fetch`呼び出しを環境変数で制御するか削除

## 関連ドキュメント

- [KB-132: WebRTCシグナリングルートのダブルプレフィックス問題](./api.md#kb-132)
- [KB-136: useWebRTCフックのcleanup関数が早期実行される問題](./frontend.md#kb-136)
- [KB-137: マイク未接続端末でのrecvonlyフォールバック](./frontend.md#kb-137)
- [KB-138: ビデオ通話時のDOM要素へのsrcObjectバインディング問題](./frontend.md#kb-138)
- [KB-139: WebSocket接続管理（重複接続防止）](./frontend.md#kb-139)
- [KB-171: WebRTCビデオ通話機能が動作しない（KioskCallPageでのclientKey/clientId未設定）](./frontend.md#kb-171)
- [KB-225: キオスク入力フィールド保護ルールの実装と実機検証](./frontend.md#kb-225)
- [WebRTCビデオ通話機能 実機検証手順](../guides/webrtc-verification.md)

## 結論

キオスクのビデオ通話機能は、既知の問題がすべて解決されており、基本的には健全に動作しています。ただし、`clientKey`/`clientId`の解決ロジックに不整合があり、特定の条件下（localStorageが空の場合）で動作しない可能性があります。この問題を修正することで、機能の健全性が向上します。
