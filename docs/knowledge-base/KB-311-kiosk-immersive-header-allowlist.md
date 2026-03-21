---
title: KB-311 キオスク沉浸式レイアウト（上端ヘッダーリビール）の URL allowlist
tags: [キオスク, フロントエンド, KioskLayout]
audience: [開発者]
last-verified: 2026-03-20
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

## References

- [`KioskLayout.tsx`](../../apps/web/src/layouts/KioskLayout.tsx)
- [`useKioskTopEdgeHeaderReveal.ts`](../../apps/web/src/hooks/useKioskTopEdgeHeaderReveal.ts)
