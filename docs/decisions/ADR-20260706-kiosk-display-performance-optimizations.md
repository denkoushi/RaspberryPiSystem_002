# ADR-20260706: Kiosk Display Performance Optimizations (Drawings, Leader Order Board, Assembly Procedure Documents)

- Status: accepted
- Date: 2026-07-06
- Scope: kiosk inspection drawing display, self-inspection drawing display, production schedule leader order board, assembly tab procedure document (要領書) list and viewer
- related_code:
  - `apps/api/src/lib/part-measurement-drawing-storage.ts`
  - `apps/api/src/routes/storage/part-measurement-drawings.ts`
  - `apps/api/src/app.ts`
  - `apps/api/src/services/production-schedule/leaderboard/leaderboard-shell-hydrate.service.ts`
  - `apps/api/src/routes/kiosk-documents.ts`
  - `apps/api/src/services/kiosk-documents/adapters/prisma-kiosk-document.repository.ts`
  - `apps/web/src/features/part-measurement/usePartMeasurementDrawingBlobUrl.ts`
  - `apps/web/src/pages/kiosk/KioskAssemblyProcedureOrderSettingsPage.tsx`
  - `apps/web/src/features/assembly/AssemblyProcedureSequenceViewer.tsx`
  - `scripts/perf/` (seed, measurement, scale scripts)
- related_docs: `docs/guides/deployment.md`, `docs/plans/kiosk-assembly-torque-management-mvp.md`

## Context

Kiosk pages showed slow display paths on the Pi4 kiosk + Pi5 server LAN environment:

1. Inspection drawings (検査図面), self-inspection drawings (自主検査), and self-inspection sessions opened from the leader order board (順位ボード「検」) always transferred the full-resolution drawing image (up to 12MB) via authenticated axios blob fetch.
2. The leader order board shell API returned ~660KB of uncompressed JSON per initial load (960 rows / 6 resource slots); no HTTP compression existed anywhere (API or Caddy). The hydrate SQL used per-row correlated subqueries for `processingOrder` / `globalRank`.
3. `GET /api/kiosk-documents` returned all documents including `extractedText` (~30KB OCR text per document) with no `take`/`skip`. Payload and DB cost grew linearly with document count (9.5MB at 300 docs, 35MB at 1500 docs), affecting the assembly procedure order settings page and the kiosk documents tab.

## Decision

1. **Drawing derivatives**: serve display-width WebP derivatives via `GET /api/storage/part-measurement-drawings/:filename?w=1280|1920|2560` (whitelist only). Derivatives are generated with sharp (WebP q80, `withoutEnlargement`), cached on FS under `part-measurement-drawings-derivatives/w{width}/`, regenerated when the source mtime is newer, deduplicated with an in-flight map. Requests without `w` keep the exact previous behavior. Display-only pages (`KioskInspectionDrawingEditPage`, `KioskSelfInspectionSessionPage`) request a snapped width from `min(2560, innerWidth × devicePixelRatio)`; create/edit template pages keep full resolution. Client blob LRU cache grew 10 → 30 entries.
2. **Response compression**: register `@fastify/compress` globally (`threshold: 1024`, encodings gzip + brotli, brotli quality uses plugin default 4). Images (`image/*`) are not compressed by the plugin.
3. **Leaderboard hydrate SQL**: replace per-row correlated subqueries with the same `buildLeaderboardShellRankJoinContext` LATERAL JOIN used by the shell list query.
4. **Kiosk documents list contract**: add explicit `fields=summary` (omits `extractedText`, returned as `null`), `limit` (1–500) and `offset` query parameters to `GET /api/kiosk-documents`. Unspecified parameters keep the response fully backward compatible. Assembly procedure order settings and the kiosk documents tab list use `fields=summary` + server-side `q` search; the admin page keeps the legacy full response. `AssemblyProcedureSequenceViewer` prefetches the next 1–2 pages and the next document's first page.

## Alternatives

- Client-side `<img srcset>`: rejected because drawings require the `x-client-key` header (blob fetch path is kept).
- Caddy-level `encode`: viable, but API-level compression works in local dev and any proxy topology, and is testable in CI.
- pg_trgm index for `extractedText` search: deferred; server-side search cost is acceptable after summary/limit, and the heavy payload was the dominant factor.
- Changing the leader order board phased fetch design (shell → continue → decorations): rejected; the existing design is already tuned, only the SQL and transfer encoding were changed.

## Consequences

- Benefits: ~93% transfer reduction for drawings at w=1280 (6.09MB → 0.45MB), ~93% for the leaderboard shell JSON (662KB → 47KB gzip), kiosk-documents list becomes count-independent (35MB/473ms at 1500 docs → 208KB/12ms with summary+limit).
- Costs: first derivative generation per drawing/width costs ~300–470ms on the Mac dev machine (longer on Pi5, once per drawing); derivative files consume disk under `part-measurement-drawings-derivatives/` with no cleanup policy yet; gzip adds modest CPU on Pi5.
- Risks: none observed for image routes (plugin skips `image/*`); `w`-less URLs and parameter-less kiosk-documents requests are byte-compatible with previous behavior.

## Validation

Measured on Mac local dev (API :8080 tsx watch, web :4173 vite, temporary `postgres-test-local` container, PERF seed: 1200 leaderboard rows / 6 resources, 6 drawings ~6MB, 300–1500 kiosk documents, 20-document procedure order × 5 pages). Harness: `scripts/perf/measure-kiosk-perf.mjs` (Playwright + fetch, cold/warm ×3).

- Drawing `?w=1280`: 6,086,942 B → 447,680 B (−92.6%); FS-cache hit 4.5ms; initial generation 294–466ms. Browser verified the `?w=` URL is actually used on the self-inspection session page.
- Leaderboard shell API: 661,729 B → 47,328 B gzip; hydrate SQL 5.4ms → 3.0ms (160 rows, 5-run average); `leaderboard-full` browser scenario 1017ms → 797ms median.
- Kiosk documents: legacy full list 144ms/9.5MB (300 docs) and 473ms/35MB (1500 docs); `fields=summary&limit=200` is ~12ms/208KB at both 300 and 1500 docs. `procedure-sequence` stays 8ms/15KB regardless of total document count (resolves only ordered items, max 50).
- Regression: API vitest full suite, web vitest, api/web lint and build green on merged main (see merge commits `243007be`, `f53ea1a2`, `77d30363`).

## Open Items

- Pi production measurement after deployment (LAN transfer and Pi4 decode are expected to benefit more than localhost).
- Cleanup policy for stale derivative files (currently only mtime-based regeneration).
- Optional: pre-warm derivatives at upload time to avoid the first-view generation cost.

## Local Notes JA

- 対象は「キオスク＞順位ボード」「キオスク＞検査図面」「キオスク＞自主検査」の図面表示、順位ボードのアイテム表示、組立タブ起点の要領書表示。
- 要領書一覧は `fields=summary` + `limit` により件数増大でも表示速度が低下しない契約へ変更（未指定時は完全互換）。
- 検証用スクリプトは `scripts/perf/` に常設（seed / 計測 / 1500件スケール投入）。
