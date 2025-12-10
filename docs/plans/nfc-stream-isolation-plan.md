# NFC/カメラ入力のスコープ分離計画

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
2. **PHOTOモードは自動撮影を維持しつつ、PHOTOページ内だけで購読**  
   - PHOTOページ遷移時にのみ `enabled=true` でNFCを購読し、他ページでは購読停止。  
   - defaultMode=PHOTO でも、PHOTOページ以外でイベントを拾わないようにする。
3. **直近パス優先のリダイレクトは維持しつつ、/kiosk 直アクセス時のみ defaultMode 適用**  
   - 「直近パス復元」は `/` に限定し、`/kiosk` では defaultMode を優先（実装済み）。  
   - 設定変更（defaultMode）時は `/kiosk` でのみ効くため、PHOTO運用も継続可能。

## 実装タスク
- [ ] `apps/web/src/hooks/useNfcStream.ts` に `enabled:boolean` を追加（デフォルト false）し、enabledがtrueのときのみイベントを発火。
- [ ] `/kiosk/photo` はページ表示中のみ `enabled=true`、離脱で `enabled=false`。自動撮影フローは維持。
- [ ] `/kiosk/instruments/borrow` など計測機器/工具の各ページで、マウント時に `enabled=true`、アンマウント/他タブ切替時に `enabled=false` を適用。
- [ ] `KioskLayout`/`KioskRedirect` の挙動は現状維持（直近パス復元は `/` のみ）。
- [ ] ドキュメント更新（INDEXリンク、検証ガイドへのテスト項目追記）。

## テスト計画
- **ユニット**: `useNfcStream` が `enabled=false` でイベントを発火しないこと、`enabled=true` で発火すること。
- **E2E (Playwright)**:
  - シナリオ1: defaultMode=PHOTO、`/kiosk/instruments/borrow` → リロード → 氏名タグスキャン → photo-borrow が発火しないこと。
  - シナリオ2: `/kiosk/photo` で「撮影開始」未アーム状態でNFCスキャン → 発火しないこと。
  - シナリオ3: `/kiosk/photo` で「撮影開始」後にスキャン → 1件だけ発火し、成功後に非アームへ戻ること。
  - シナリオ4: `/kiosk/photo` から `/kiosk/instruments/borrow` へ遷移後にスキャン → photo-borrow が発火しないこと。
  - シナリオ5: 並行で CPU 温度/ネットワークポーリングが走っていても発火制御に影響しないこと。

## ロールバック
- フロントの hook/ページ変更のみ。問題発生時は元の `useNfcStream` を戻し、PHOTOアームUIを非表示にする。

## 関連ドキュメント
- KB-026, KB-027: `docs/knowledge-base/frontend.md`
- PHOTOテスト計画: `docs/guides/photo-loan-test-plan.md`
- UI仕様: `docs/modules/measuring-instruments/ui.md`, `docs/modules/tools/photo-loan.md`
