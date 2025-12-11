# NFC/カメラ入力のスコープ分離計画

**最終更新**: 2025-12-11  
**ステータス**: ✅ 実装完了

## 背景
- 計測機器モードで氏名タグを1回スキャンした直後に、`defaultMode=PHOTO` が効いて `/kiosk/photo` へ遷移し、photo-borrow が意図せず1件発火する事象が再発。
- NFCイベントとカメラインプットをアプリ全体で共有しており、画面/モード単位のスコープ分離が無い。
- 今後、計測機器・工具以外の拡張でも同一NFCリーダー/USBカメラを併用するため、入力の明示的なスコープ管理が必要。

## 目的
- NFC/カメラインプットの「受け付け権限」を画面/モード単位で制御し、他モードへの横漏れを防ぐ。
- PHOTOモードの利便性（/kiosk → PHOTO での即撮影フロー）を維持しつつ、別モード利用時の誤発火を防止する。
- 今後の拡張機能でも、明示的な「購読開始/停止」と「アーム（手動開始）」を組み合わせて安全に再利用できる基盤を作る。

## スコープと対象
- フロントエンド（apps/web）
  - `useNfcStream` のスコープ管理
  - `/kiosk/photo` の撮影トリガー制御
  - `/kiosk/instruments/borrow` 等、計測機器/工具の各ページ
- バックエンドは対象外（現状のAPIで問題なし）

## 実装方針（決定）
1. **NFC購読のスコープ化**  
   - `useNfcStream` に `enabled` フラグを追加し、デフォルトは `false`。  
   - 各ページで「アクティブ時のみ enabled=true」にする（マウント/アンマウント、タブ切替、非表示時は false）。
2. **enabled=true になった時刻より前のイベントを無視**
   - `useNfcStream` 内で `enabledAt` タイムスタンプを記録。
   - `payload.timestamp < enabledAt` の場合はイベントを無視（画面遷移直後の古いイベントを防止）。
3. **PHOTOモードは自動撮影を維持しつつ、PHOTOページ内だけで購読**  
   - PHOTOページ遷移時にのみ `enabled=true` でNFCを購読し、他ページでは購読停止。  
   - defaultMode=PHOTO でも、PHOTOページ以外でイベントを拾わないようにする。
4. **React Routerの `useMatch` でルートマッチを判定**
   - 各ページで `useMatch('/kiosk/photo')` 等を使用し、自分がアクティブなルートかどうかを判定。
   - アクティブな場合のみ `useNfcStream(true)` でNFCを有効化。

## 実装タスク
- [x] `apps/web/src/hooks/useNfcStream.ts` に `enabled:boolean` を追加（デフォルト false）し、enabledがtrueのときのみイベントを発火。
- [x] `useNfcStream` に `enabledAt` タイムスタンプを追加し、それ以前のイベントを無視。
- [x] `/kiosk/photo` はページ表示中のみ `enabled=true`、離脱で `enabled=false`。自動撮影フローは維持。
- [x] `/kiosk/instruments/borrow` で `useMatch` を使用し、アクティブ時のみ `enabled=true`。
- [x] `/kiosk/tag` で `useMatch` を使用し、アクティブ時のみ `enabled=true`。
- [x] `/tools/employees`、`/tools/items` で `useLocation` を使用し、アクティブ時のみ `enabled=true`。
- [x] `KioskLayout`/`KioskRedirect` の挙動は現状維持（直近パス復元は `/` のみ）。
- [x] ドキュメント更新（この計画書を更新）。

## 実装詳細（2025-12-11 追記）

### 修正ファイル一覧
1. **`apps/web/src/hooks/useNfcStream.ts`**
   - `enabledAtRef` を追加し、`enabled=true` になった時刻をISO文字列で記録。
   - `payload.timestamp < enabledAt` の場合はイベントを無視するロジックを追加。
   - `enabled=false` になったら `enabledAtRef.current = null` でリセット。

2. **`apps/web/src/pages/kiosk/KioskPhotoBorrowPage.tsx`**
   - `useMatch('/kiosk/photo')` を使用し、アクティブ時のみ `useNfcStream(true)`。

3. **`apps/web/src/pages/kiosk/KioskInstrumentBorrowPage.tsx`**
   - `useMatch('/kiosk/instruments/borrow')` を使用し、アクティブ時のみ `useNfcStream(true)`。

4. **`apps/web/src/pages/kiosk/KioskBorrowPage.tsx`**
   - `useMatch('/kiosk/tag')` を使用し、アクティブ時のみ `useNfcStream(true)`。

5. **`apps/web/src/pages/tools/EmployeesPage.tsx`**
   - `useLocation()` を使用し、`pathname.endsWith('/employees')` でアクティブ判定。

6. **`apps/web/src/pages/tools/ItemsPage.tsx`**
   - `useLocation()` を使用し、`pathname.endsWith('/items')` でアクティブ判定。

## テスト計画
- **ユニット**: `useNfcStream` が `enabled=false` でイベントを発火しないこと、`enabled=true` で発火すること。
- **E2E (Playwright)**:
  - シナリオ1: defaultMode=PHOTO、`/kiosk/instruments/borrow` → リロード → 氏名タグスキャン → photo-borrow が発火しないこと。
  - シナリオ2: `/kiosk/photo` でNFCスキャン → 1件だけ発火し、成功後にリセットされること。
  - シナリオ3: `/kiosk/photo` から `/kiosk/instruments/borrow` へ遷移後にスキャン → photo-borrow が発火しないこと。
  - シナリオ4: 並行で CPU 温度/ネットワークポーリングが走っていても発火制御に影響しないこと。

## ロールバック
- フロントの hook/ページ変更のみ。問題発生時は元の `useNfcStream` を戻し、各ページで `useNfcStream(true)` に戻す。

## 関連ドキュメント
- KB-026, KB-027: `docs/knowledge-base/frontend.md`
- PHOTOテスト計画: `docs/guides/photo-loan-test-plan.md`
- UI仕様: `docs/modules/measuring-instruments/ui.md`, `docs/modules/tools/photo-loan.md`
- 計測機器検証ガイド: `docs/guides/measuring-instruments-verification.md`
