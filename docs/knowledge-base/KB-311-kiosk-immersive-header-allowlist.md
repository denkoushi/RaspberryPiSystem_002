---
title: KB-311 キオスク沉浸式レイアウト（下端ヘッダーリビール）の URL allowlist
tags: [キオスク, フロントエンド, KioskLayout]
audience: [開発者]
last-verified: 2026-05-22
category: knowledge-base
---

# KB-311: キオスク沉浸式レイアウト（下端ヘッダーリビール）の URL allowlist

## Context

`KioskLayout` では、特定ルートのみキオスクナビ（`KioskHeader`）を既定で隠し、**画面下辺の中央 1/3** へマウスを寄せるとヘッダーが**下から上へ**スライド表示する「沉浸式」レイアウトを使う。近傍検知は [`useKioskBottomCenterHeaderReveal`](../../apps/web/src/hooks/useKioskBottomCenterHeaderReveal.ts)（内部で [`kioskHeaderRevealHotZone.ts`](../../apps/web/src/features/kiosk/kioskHeaderRevealHotZone.ts) の純関数判定）。対象 URL は **allowlist** で管理し、計画納期・通話などは意図的に除外する。**持出タブ**（`/kiosk/tag`・`/kiosk/photo`・計測/吊具持出）も下端リビールに統一（2026-05-22 以前は `/kiosk/photo` のみ上辺常時表示）。

**本変更のスコープ外**（上端のまま）:

- Raspberry Pi OS の `wf-panel-pi`（起動時 kill・**Super+Shift+P** で復帰）
- Firefox のタブ／URL バー（`userChrome.css` 上端 hover）

## ヘッダーリビール仕様（Web）

| 項目 | 値 |
|------|-----|
| ホットゾーン高さ | **14px**（下端帯） |
| ホットゾーン幅 | ビューポート幅の **中央 1/3**（`x ∈ [width/3, 2×width/3]`） |
| 非表示 | `translate-y-full`（画面下に隠す） |
| 表示 | `translate-y-0`（下から出る） |
| クローズ遅延 | **200ms**（`KIOSK_REVEAL_CLOSE_DELAY_MS`） |
| タッチ | 未対応（マウス前提） |
| 視覚ガイド | なし |

## Symptoms / 運用上の問い

- 新しいキオスク画面を追加したとき、同じヘッダー挙動にしたいが、どこを直せばよいか分からない。
- なぜ `/kiosk/production-schedule` だけ完全一致で、子パスは別扱いなのか。
- 手動順番の下ペイン（右端スライダーホバー）とナビが競合しないか → 下辺は**中央 1/3 のみ**がホットゾーン。

## Decision / Fix

- 純関数 [`kioskImmersiveLayoutPolicy.ts`](../../apps/web/src/features/kiosk/kioskImmersiveLayoutPolicy.ts) の `usesKioskImmersiveLayout(pathname)` が沉浸式 ON/OFF の唯一の判定源。
- ホットゾーン幾何: [`kioskHeaderRevealHotZone.ts`](../../apps/web/src/features/kiosk/kioskHeaderRevealHotZone.ts)（Vitest: [`kioskHeaderRevealHotZone.test.ts`](../../apps/web/src/features/kiosk/kioskHeaderRevealHotZone.test.ts)）。
- レイアウト／Tailwind プリセット: [`kioskImmersiveHeaderChrome.ts`](../../apps/web/src/features/kiosk/kioskImmersiveHeaderChrome.ts)。
- 単体テスト（allowlist）: [`kioskImmersiveLayoutPolicy.test.ts`](../../apps/web/src/features/kiosk/kioskImmersiveLayoutPolicy.test.ts)。

### 対象（true）

| 種別 | パス |
|------|------|
| 完全一致（末尾 `/` 正規化後） | `/kiosk/tag`, `/kiosk/photo`, `/kiosk/instruments/borrow`, `/kiosk/rigging/borrow`, `/kiosk/production-schedule`, `/kiosk/documents`（要領書 PDF・[KB-313](./KB-313-kiosk-documents.md)） |
| `startsWith` | `KIOSK_MANUAL_ORDER_PATH_PREFIX`（手動順番）, `/kiosk/production-schedule/progress-overview`, `/kiosk/part-measurement`（部品測定ハブ・編集・テンプレ・確定一覧。Phase2 以降）, `/kiosk/pallet-visualization`（加工機パレット可視化・[KB-355](./api.md)） |

### 除外例（false）

- `/kiosk/call`, `/kiosk/production-schedule/due-management`, `/kiosk/production-schedule/other`

## Prevention

- ルートを増やすときは **ポリシー＋テスト** を同時更新する。
- 手動順番のパス接頭辞は [`kioskManualOrderRoutes.ts`](../../apps/web/src/features/kiosk/manualOrder/kioskManualOrderRoutes.ts) の `KIOSK_MANUAL_ORDER_PATH_PREFIX` を import して DRY に保つ。
- ホットゾーン形状を変えるときは **純関数＋Vitest** を先に更新し、`KioskLayout` はプリセット経由のみ触る。

## デプロイ・実機検証（実績、2026-03-21）

- **ブランチ**: `feat/kiosk-immersive-layout-manual-order-row`（当時は上端リビール。2026-05-22 以降は下端中央1/3が正本）。
- **デプロイ**: [deployment.md](../guides/deployment.md) 標準。**対象** Pi5 → raspberrypi4 → raspi4-robodrill01 のみ（**Pi3 除外**）、`--limit` で **1台ずつ**。
- **運用記録**: [KB-297 沉浸式拡張節](./KB-297-kiosk-due-management-workflow.md#kiosk-immersive-allowlist-manual-order-row-2026-03-21) / [deploy-status-recovery.md](../runbooks/deploy-status-recovery.md)（同趣旨のチェックリスト行）。

## デプロイ・実機検証（実績、2026-04-22）

- **内容**: キオスク `/kiosk/pallet-visualization` の UI を feature 配下に分割（ブランチ `feat/kiosk-pallet-visualization-ui`・代表 `029ecc16`）。ルートの沉浸式判定は従来どおり本 KB の allowlist（[KB-355](./api.md)・「加工機パレット可視化」節 とセットで参照）。

## 下端リビール（2026-05-22・未デプロイ）

- **ブランチ**: `feat/kiosk-bottom-center-header-reveal`
- **変更**: 上端全幅リビール → **下端・中央1/3**・`useKioskTopEdgeHeaderReveal` 削除・`useKioskEdgeHeaderReveal` / `useKioskBottomCenterHeaderReveal` 追加
- **実機確認**: 手動順番・順位ボードで (1) 下辺左右1/3ではナビが出ない (2) 下辺中央1/3でナビが下から出る (3) 下ペイン右スライダーと干渉しない (4) `/kiosk/production-schedule/due-management` はヘッダー常時表示

## Troubleshooting

- **沉浸式にならない / 逆に想定外の画面で隠れる**: `normalizeKioskPathname` の末尾 `/` と、`IMMERSIVE_PATH_EXACT` vs `startsWith` の扱いを確認（`/kiosk/production-schedule` は **子パスを含まない** 完全一致）。
- **パレット可視化で左ペインだけスクロールせずページ全体が動く**: `/kiosk/pallet-visualization` が allowlist に無いと **`usesKioskImmersiveLayout` が false** のままになり、分割ペインの **overflow 前提が崩れる**（2026-04-22 修正・[KB-355](./api.md)）。
- **E2E スモークでキオスクナビが失敗**: ヘッダー非表示のままクリックしている。`revealKioskHeader()` で**下辺中央**へマウス移動してから操作する（[`kiosk-smoke.spec.ts`](../../e2e/smoke/kiosk-smoke.spec.ts)）。
- **ナビが出ない**: 下辺**左右 1/3** では開かない（仕様）。**中央 1/3**（画面幅の 33%〜66% 付近）を確認。
- **Pi5/Mac は新 UI・Pi4 だけ旧挙動（上端リビール等）**: SPA は Pi5 配信。Pi4 Firefox が **`?clientKey=` 固定 URL** で旧バンドルをキャッシュし得る。`kiosk-launch.sh` の **`&_appRef=<git HEAD>`**・プロファイル **`cache2` 削除**・`user.js` の HTTP キャッシュ無効化後に **`kiosk-browser` 再起動**（2026-05-22·`8a5369e1`）。上端に出る **タブ/URL バー**は Firefox `userChrome.css`（アプリのキオスクナビとは別）。
- **ローカル Web テストで `act(...)` エラー**: シェルに `NODE_ENV=production` が残っていると再現しうる → **`NODE_ENV=test`** を明示して Vitest を実行。

## References

- [`KioskLayout.tsx`](../../apps/web/src/layouts/KioskLayout.tsx)
- [`useKioskBottomCenterHeaderReveal.ts`](../../apps/web/src/hooks/useKioskBottomCenterHeaderReveal.ts)
- [`useKioskEdgeHeaderReveal.ts`](../../apps/web/src/hooks/useKioskEdgeHeaderReveal.ts)
- [KB-297 手動順番・沉浸式（2026-03-21）](./KB-297-kiosk-due-management-workflow.md#kiosk-immersive-allowlist-manual-order-row-2026-03-21)
