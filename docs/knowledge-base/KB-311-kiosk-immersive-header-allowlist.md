---
title: KB-311 キオスク沉浸式レイアウト（上端ヘッダーリビール）の URL allowlist
tags: [キオスク, フロントエンド, KioskLayout]
audience: [開発者]
last-verified: 2026-03-21
category: knowledge-base
---

# KB-311: キオスク沉浸式レイアウト（上端ヘッダーリビール）の URL allowlist

## Context

`KioskLayout` では、特定ルートのみ最上段ヘッダーを既定で隠し、上端ホバー（および `useKioskTopEdgeHeaderReveal` の近傍検知）で表示する「沉浸式」レイアウトを使う。対象 URL は **allowlist** で管理し、計画納期・写真持出・通話などは意図的に除外する。

## Symptoms / 運用上の問い

- 新しいキオスク画面を追加したとき、同じヘッダー挙動にしたいが、どこを直せばよいか分からない。
- なぜ `/kiosk/production-schedule` だけ完全一致で、子パスは別扱いなのか。

## Decision / Fix

- 純関数 [`apps/web/src/features/kiosk/kioskImmersiveLayoutPolicy.ts`](../../apps/web/src/features/kiosk/kioskImmersiveLayoutPolicy.ts) の `usesKioskImmersiveLayout(pathname)` が唯一の判定源。
- 単体テスト: [`apps/web/src/features/kiosk/kioskImmersiveLayoutPolicy.test.ts`](../../apps/web/src/features/kiosk/kioskImmersiveLayoutPolicy.test.ts)。

### 対象（true）

| 種別 | パス |
|------|------|
| 完全一致（末尾 `/` 正規化後） | `/kiosk/tag`, `/kiosk/instruments/borrow`, `/kiosk/rigging/borrow`, `/kiosk/production-schedule` |
| `startsWith` | `KIOSK_MANUAL_ORDER_PATH_PREFIX`（手動順番）, `/kiosk/production-schedule/progress-overview` |

### 除外例（false）

- `/kiosk/photo`, `/kiosk/call`, `/kiosk/production-schedule/due-management`, `/kiosk/production-schedule/other`

## Prevention

- ルートを増やすときは **ポリシー＋テスト** を同時更新する。
- 手動順番のパス接頭辞は [`kioskManualOrderRoutes.ts`](../../apps/web/src/features/kiosk/manualOrder/kioskManualOrderRoutes.ts) の `KIOSK_MANUAL_ORDER_PATH_PREFIX` を import して DRY に保つ。

## デプロイ・実機検証（実績、2026-03-21）

- **ブランチ**: `feat/kiosk-immersive-layout-manual-order-row`（ポリシー拡張に加え、手動順番上ペイン行レイアウト変更・E2E `revealKioskHeader` を含む変更一式）。
- **デプロイ**: [deployment.md](../guides/deployment.md) 標準。**対象** Pi5 → raspberrypi4 → raspi4-robodrill01 のみ（**Pi3 除外**）、`--limit` で **1台ずつ**。
- **Run ID 例**: `20260321-192700-29456`（Pi5）/ `20260321-193059-19711`（raspberrypi4）/ `20260321-193547-13867`（raspi4-robodrill01）。
- **自動実機検証**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 28 / WARN 0 / FAIL 0**。
- **運用記録**: [KB-297 沉浸式拡張節](./KB-297-kiosk-due-management-workflow.md#kiosk-immersive-allowlist-manual-order-row-2026-03-21) / [deploy-status-recovery.md](../runbooks/deploy-status-recovery.md)（同趣旨のチェックリスト行）。

## Troubleshooting

- **沉浸式にならない / 逆に想定外の画面で隠れる**: `normalizeKioskPathname` の末尾 `/` と、`IMMERSIVE_PATH_EXACT` vs `startsWith` の扱いを確認（`/kiosk/production-schedule` は **子パスを含まない** 完全一致）。
- **E2E スモークでキオスクナビが失敗**: ヘッダー非表示のままクリックしている。`revealKioskHeader()` 等で上端ホバー相当を先に実行する（[`kiosk-smoke.spec.ts`](../../e2e/smoke/kiosk-smoke.spec.ts)）。
- **ローカル Web テストで `act(...)` エラー**: シェルに `NODE_ENV=production` が残っていると再現しうる → **`NODE_ENV=test`** を明示して Vitest を実行。

## References

- [`KioskLayout.tsx`](../../apps/web/src/layouts/KioskLayout.tsx)
- [`useKioskTopEdgeHeaderReveal.ts`](../../apps/web/src/hooks/useKioskTopEdgeHeaderReveal.ts)
- [KB-297 手動順番・沉浸式（2026-03-21）](./KB-297-kiosk-due-management-workflow.md#kiosk-immersive-allowlist-manual-order-row-2026-03-21)
