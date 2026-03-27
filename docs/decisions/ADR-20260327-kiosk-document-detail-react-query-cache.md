---
title: ADR-20260327 キオスク要領書詳細の React Query キャッシュ方針
status: accepted
---

# ADR-20260327: キオスク要領書詳細の React Query キャッシュ方針

## Context

- キオスク `/kiosk/documents` で、一覧の **ホバー先読み**（`prefetchQuery`）と **選択時の本取得**（`useQuery`）が両方 `GET /api/kiosk-documents/:id` を叩く。
- TanStack Query v5 の既定では **`staleTime` が 0** に近い挙動となり、先読みで入れたキャッシュが即「古い」と扱われ **`useQuery` がすぐ再フェッチ**する。ネットワーク上は同一 ID の GET が短間隔で複数本見える。
- これに加え、一覧行で **`onPointerEnter` と `onFocus` の両方**から先読みを起こすと、タッチ操作でイベントが重なり、無駄なプリフェッチや体感のガタつき要因になりうる。

## Decision

1. **詳細クエリの契約を1モジュールに集約**する: `apps/web/src/api/kioskDocumentDetailQueryOptions.ts` で `queryKey`・`queryFn`・`staleTime`（**60 秒**）・`gcTime`（**5 分**）を `useKioskDocumentDetail` と `prefetchQuery` で共有する。
2. **キオスク一覧ページ**（`KioskDocumentsPage`）では、先読みを **`onRowPointerEnter` のみ**にし、**`onRowFocus` 経路は接続しない**（当該一覧はキオスク専用で、キーボード先読みの優先度は低い）。

## Alternatives

| 案 | 却下理由 |
|----|-----------|
| `staleTime` を 0 のまま、`refetchOnMount: false` だけ抑止 | 他イベントでの再取得挙動とバッティングしやすく、意図が追いにくい |
| 先読みを廃止 | 初回表示の体感が悪化 |
| `staleTime` を極端に長く（例: 1 時間） | 管理画面以外での鮮度低下リスク。管理 mutation は `['kiosk-document']` invalidate 済みだが、運用外の更新には弱い |

## Consequences

- **良い**: 同一選択に対する **詳細 GET の短間隔重複が大幅に減る**。Pi4 実機で報告されていた **ビューアのチャタリングが解消**した（2026-03-27 運用確認）。
- **良い**: キャッシュ定数の変更が **1 ファイル**で済む（保守性）。
- **注意**: 60 秒以内にサーバ側だけ文書を差し替えた場合、invalidate が走らない限り **古い詳細が表示されうる**。通常は管理操作で mutation が走り invalidate される想定。
- **注意**: キオスク一覧で **キーボードフォーカスのみ**で先読みしたい要件は弱体化（タッチキオスク前提で許容）。

## References

- 実装: `apps/web/src/api/kioskDocumentDetailQueryOptions.ts`, `apps/web/src/api/hooks.ts`（`useKioskDocumentDetail`）, `apps/web/src/features/kiosk/documents/useKioskDocumentListPrefetch.ts`, `apps/web/src/pages/kiosk/KioskDocumentsPage.tsx`
- ナレッジ: [KB-313](../knowledge-base/KB-313-kiosk-documents.md)
