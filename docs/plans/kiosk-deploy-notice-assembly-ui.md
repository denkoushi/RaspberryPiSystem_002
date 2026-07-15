---
title: Kiosk deploy notice and assembly library/editor UI
id: plan-kiosk-deploy-notice-assembly-ui
status: implemented
date: 2026-07-14
source_of_truth: this file
related_code: apps/api/src/routes/assembly/index.ts, apps/api/src/services/assembly, apps/web/src/features/assembly, apps/web/src/components/kiosk/KioskDeployPreNotice.tsx
related_docs: ../decisions/ADR-20260714-assembly-marker-callout-and-shared-image-canvas.md, ./kiosk-assembly-torque-management-mvp.md, ../guides/deployment.md
---

# Kiosk deploy notice and assembly library/editor UI

## Goal

- Replace the full-width deploy pre-notice with a centered, keyboard-movable, non-blocking card.
- Improve the assembly procedure/template library two-row layouts and add free-text combobox filters backed by assembly-only candidates.
- Reuse domain-neutral image-canvas zoom behavior in the assembly template editor.
- Add optional callout tips to both bolt and check markers and render them in editor and work-session views.
- Standardize user-facing assembly terminology from `形番` to `型番` without changing the `modelCode` DB/API contract.

## Decisions

- Implementation branch: `feat/kiosk-deploy-notice-assembly-ui`, based on `origin/main`.
- Deploy notice starts centered, moves 10px per arrow key, stays within a 16px viewport margin, ignores arrows while an interactive control is focused, and resets for a new deploy `runId`.
- Assembly zoom uses `− / ＋ / □`, default 1.0, range 0.5–2.5, step 0.25. Page changes reset to fit.
- Bolt and check callouts are optional paired ratios. A partial pair is invalid; omitted/nullable pairs remain backward compatible.
- Filter candidates come from the complete owning assembly dataset rather than the currently loaded 200-row page.
- Production deployment is out of scope. If later approved, apply the nullable migration and API before the Web client.

## Implementation sequence

1. Add the nullable marker-callout migration, DTO/service serialization, validation, and filter-options API.
2. Extract domain-neutral image-canvas zoom/pointer utilities and add reusable callout rendering and combobox presentation.
3. Implement the deploy notice position model and component behavior.
4. Integrate zoom/callouts into assembly editor/work-session views and revise library layouts/search inputs.
5. Verify with isolated Postgres, SQL/EXPLAIN, focused and full tests, builds, lint, and Playwright at 1366×768 and 1920×1080.

## Progress

- [x] 2026-07-14: Analyzed current docs, UI, API, Prisma models, tests, and deployment protocol.
- [x] 2026-07-14: Confirmed current 144-migration chain and 19 assembly integration tests on isolated Postgres 16; temporary resources removed.
- [x] 2026-07-14: Created branch from latest `origin/main`.
- [x] 2026-07-14: Added nullable bolt/check callout coordinates, strict paired-coordinate validation, revision/session serialization, filter-options API, and `型番` user-facing terminology.
- [x] 2026-07-14: Added shared image-canvas zoom/layout/pointer/callout primitives, preserved inspection-drawing compatibility exports, and implemented the movable deploy card.
- [x] 2026-07-14: Integrated zoom and optional callouts into assembly editor/work-session views and implemented two-row libraries and live server-backed combobox candidates.
- [x] 2026-07-14: Completed isolated DB, API/Web, lint/build, SQL/EXPLAIN, and two-viewport Playwright verification; updated the canonical Plan, ADR, and docs index.

## Implementation result

- Branch: `feat/kiosk-deploy-notice-assembly-ui`, created from the latest `origin/main` after confirming a clean worktree.
- Migration: `20260714120000_assembly_marker_callout_tips`; four nullable columns only, with no data update or index addition.
- Deploy notice: centered 24rem card, 16px viewport margin, 10px arrow-key movement, interactive-focus guard, resize clamp, and `runId` reset. The existing 60-second notice/ACK/maintenance protocol and deploy scripts are unchanged.
- Shared Web code: domain-neutral image-canvas zoom, contain layout, pointer-ratio conversion, 10px tap threshold, callout overlay, and zoom controls. Existing inspection-drawing modules remain as compatibility wrappers.
- Assembly editor/session: bolt and check marker kinds remain independent domain records; each can optionally store, remove, and display a callout tip. Zoom uses real content dimensions and scroll, preserving ratio coordinates.
- Libraries/search: both tables use two rows per item. The three requested fields use the common free-text combobox; assembly mode refreshes server results while open, while the existing self-inspection snapshot behavior remains available for compatibility.
- Candidate API: searches the complete owning dataset independently of the 200-row summary limit. Procedure-library candidates remain active-only even if an irrelevant `includeInactive` parameter is supplied.
- Deployment: not performed and not included in this implementation.

## Verification result

- Isolated `pgvector/pgvector:pg16` database:
  - All 145 migrations deployed; `migrate status` and Prisma generation passed.
  - The four new columns have the requested numeric types, are nullable, and legacy-equivalent inserted rows retain null callouts.
  - Assembly integration tests passed: 21/21, including old/new payloads, both marker kinds, revision copy, session response, invalid pairs/ranges/non-finite values, candidate scope/dedup/query/limit/inactive/rename, and Excel heading.
  - Representative candidate/list/marker SQL was checked with `EXPLAIN (ANALYZE, BUFFERS)` after loading 20,500 templates and 20,100 procedure documents. Plans used `AssemblyTemplate_idx_active_updated`, the procedure-document primary key, `AssemblyProcedureDocument_idx_active_updated`, and `AssemblyTemplateArea_idx_template`; no new candidate index was required.
  - Every temporary container, volume, and network was removed and the Docker listings were checked afterward.
- API: full suite passed, 445 files / 2,284 tests, with 2 files / 7 external-storage tests skipped by their existing gates. API lint and build passed.
- Web: final full suite passed, 290 files / 1,432 tests. The focused combobox/compatibility/layout suite also passed 3 files / 8 tests. Web lint and production build passed.
- Playwright: 4/4 passed at 1366x768 and 1920x1080, covering two-row layout, candidate selection, zoom/fit/placement, bolt/check callouts, deploy-card movement, and operation of the button behind the non-interactive card.
- `git diff --check`: passed.
- Prisma schema-drift check reports pre-existing repository-wide differences unrelated to this migration (including an existing photo-gallery table/default/index-name differences). The new callout columns do not appear in that diff; unrelated baseline drift was not modified in this scope.
