# Kiosk and Admin DGX UI Brushup (2026-07)

This ExecPlan is a living document maintained in accordance with `.agent/PLANS.md`. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

- id: plan-kiosk-admin-ui-brushup-202607
- status: completed
- scope: apps/web UI + docs; no API/DB behavior changes; production deploy completed
- date: 2026-07-03
- source_of_truth: this document
- related_code: apps/web/src/features/kiosk/, apps/web/src/features/part-measurement/, apps/web/src/features/admin/dgx-resource/, apps/web/src/components/ui/, apps/web/src/layouts/
- related_docs: docs/plans/dgx-resource-dashboard-ui-phase8.md (superseded regarding DGX light theme)

## Purpose / Big Picture

The factory-floor kiosk screens (持出, 順位ボード, 自主検査, 検査図面) and the admin DGX リソース screen have drifted apart visually: white cards on dark shells, three different button systems, a one-off near-black gradient background, and a light-theme exception for DGX. This plan unifies them under one dark, high-visibility, decoration-free design language so that operators can be guided by shape/color hierarchy instead of text, while keeping information density high.

After this change, all five screens share: one surface system, one button hierarchy, one typography scale, minimum 44px touch targets for kiosk tap controls, and no gradients or decorative animation.

## Design Language (canonical rules)

These rules are the single source of truth for the implementation subtasks.

1. Surfaces (dark theme everywhere):
   - Page shell: `bg-slate-800 text-white` (existing `KioskLayout` / `AdminLayout` default). No page-level gradients.
   - Panel / card: `rounded-lg border border-white/15 bg-slate-900/60`. Elevated modal surface: `bg-slate-900 border-white/20`.
   - Never use white cards or white inputs on the dark shell. Inputs/selects: `rounded-md border border-white/20 bg-slate-950/60 text-white placeholder:text-white/40 focus:border-sky-400 focus:outline-none`.
2. Color roles (Tailwind default palette only, no custom hex):
   - emerald = primary action / success; sky = secondary / informational; red = danger; amber = warning / attention; violet stays as 順位ボード tab accent.
   - Per-tab accent colors in `KioskHeader` are wayfinding and are kept as-is.
3. Buttons:
   - Kiosk tap controls: min height 44px (`min-h-11`), `rounded-md font-semibold`.
   - Primary (the one action to take next): filled emerald. Secondary: `border border-white/20 bg-white/5 text-white hover:bg-white/10`. Danger: filled red. Disabled: `opacity-40 cursor-not-allowed` while keeping shape.
   - Shared `components/ui/Button.tsx` remains the base; screen-local button systems must converge on the same visual grammar (do not delete `SelfInspectionKioskButton` API, restyle it to match).
4. Typography scale: page title `text-xl font-bold`; section title `text-base font-semibold`; body `text-sm`~`text-base`; metadata `text-xs text-white/60`. No font sizes below `text-xs` / `0.75rem` for operator-facing text.
5. Decoration: no gradients, no new animations/transitions beyond existing color transitions, no large `shadow-*` (drop decorative `shadow-[0_16px_48px_...]`), no `backdrop-blur` additions.
6. Density: keep grids and tables dense; spacing rhythm uses gap-2/gap-3/p-3 as default; do not add extra whitespace.
7. Accessibility: icon-only buttons get `aria-label`; destructive actions keep confirmation dialogs; error text appears next to the action that caused it.

## Progress

- [x] (2026-07-03) Investigated all five screens and the styling system (explore subagents).
- [x] (2026-07-03) Wrote this plan and the canonical design language.
- [x] (2026-07-03 19:20 JST) Step 1: shared kiosk theme token module `apps/web/src/features/kiosk/kioskTheme.ts` (loan card fixed height 248→260px for 44px buttons).
- [x] (2026-07-03 19:20 JST) Step 2: 持出 (KioskBorrowPage / KioskPhotoBorrowPage / KioskReturnPage / KioskActiveLoanCard) dark panels + touch targets.
- [x] (2026-07-03 19:26 JST) Step 3: 順位ボード (removed gradient/`#0c1222` → flat `bg-slate-900`, removed 9 decorative shadow/gradient spots, cyan→sky consolidation; row control dimensions untouched).
- [x] (2026-07-03 19:26 JST) Step 4: 自主検査 (`selfInspectionKioskTheme.ts` rewritten to canonical button grammar; 保存/完了 blue-ring → emerald primary; sub-0.75rem fonts raised).
- [x] (2026-07-03 19:26 JST) Step 5: 検査図面 (h1 unified to text-xl; white inputs/selects removed via `inspectionDrawingKioskUi.ts`; print preview intentionally stays white paper).
- [x] (2026-07-03 19:26 JST) Step 6: DGX リソース dark-theme unification (AdminLayout light branch fully removed; `dgxResourceUi.ts` tokens dark; decorative shadows removed).
- [x] (2026-07-03 19:37 JST) Fix: Tailwind class conflicts between shared `Input`/`Button` base classes and kiosk tokens (replaced with plain input/button elements at 20+ call sites; Dialog dark overrides use `!` classes).
- [x] (2026-07-03 19:40 JST) Validation: `pnpm lint` clean, `pnpm test` 1179 passed, `pnpm build` (tsc -b) clean; visual check of all five screens via temp Postgres (`postgres-test-local`, removed) + local api/web dev servers + browser screenshots.
- [x] (2026-07-03 19:49 JST) Committed and pushed implementation to `main` as `2f7f5069 feat: unify kiosk and DGX UI theme`.
- [x] (2026-07-03 20:46 JST) GitHub checks passed: CI `28655706399`, Secret scan `28655706381`, CodeQL `28655706437`, Pages `28655706002`.
- [x] (2026-07-03 20:46 JST) Production deploy run `20260703-200852-8077` completed successfully on all seven Raspberry Pi hosts.
- [x] (2026-07-03 20:48 JST) Real hardware verification `./scripts/deploy/verify-phase12-real.sh` passed with `PASS: 45`, `WARN: 0`, `FAIL: 0`.

## Surprises & Discoveries

- The DGX light theme was an intentional earlier decision (AdminLayout branches on the DGX route), but it is the only light screen in the whole app; unifying to dark removes the special case entirely.
- 順位ボードのタブアクセントは violet だが、盤面自体は独自 `#0c1222` + radial-gradient で、"no gradient" 方針に直接抵触していた。
- Vitest suites encode many concrete Tailwind classes; tests must be updated together with the components in the same step.
- Passing kiosk token class strings via `className` into shared `Input`/`Button` produced Tailwind property conflicts (e.g. `bg-white` vs `bg-slate-950/60`) whose winner depends on CSS output order because tailwind-merge is not installed. Browser check caught white inputs surviving on 検査図面; fixed by using plain elements where the full style comes from kiosk tokens.
  Evidence: screenshot of `/kiosk/part-measurement/inspection` before fix showed white filter inputs; after fix all inputs render dark.
- `prisma:seed` runs via tsx and does not load `apps/api/.env` (unlike prisma CLI); `DATABASE_URL` must be passed explicitly when seeding locally.
- Deploy run `20260703-200552-28612` stopped on `raspberrypi5` before pull because a root-owned untracked copy of `apps/api/prisma/migrations/20260703150000_assembly_summary_indexes/migration.sql` would have been overwritten by merge. SHA256 matched the tracked file (`992059742ae54037e79e972ac1010478434197c365186f37ceb0dd1389d0f765`), so the safe recovery was to move that untracked migration directory to `/opt/RaspberryPiSystem_002/logs/deploy/prepull-backup-20260703-200552-28612-20260703-200826/` and move the stale lock to `/opt/RaspberryPiSystem_002/logs/deploy/stale-lock-20260703-200552-28612.json`, then rerun deploy. Prevention: if this Git safety stop recurs, compare checksums before moving files and keep a timestamped backup under deploy logs instead of deleting.

## Decision Log

- Decision: Unify DGX リソース to the dark admin theme (remove the AdminLayout light-theme branch).
  Rationale: The user asked for one unified color/design theme across the targets; DGX is the only light screen and the branch in AdminLayout is a special case that costs complexity. Supersedes the light-theme aspect of dgx-resource-dashboard-ui-phase8.md.
  Date/Author: 2026-07-03 / Fable5 orchestrator
- Decision: Keep per-tab accent colors in KioskHeader.
  Rationale: They are functional wayfinding (which screen am I on), which supports "guide by design, not text".
  Date/Author: 2026-07-03 / Fable5 orchestrator
- Decision: Add a small shared token module (`kioskTheme.ts`) with class-name constants instead of a Tailwind config overhaul or component library.
  Rationale: Minimal change; existing screens already consume class-string token files (`inspectionDrawingKioskUi.ts` pattern); avoids a risky global restyle.
  Date/Author: 2026-07-03 / Fable5 orchestrator
- Decision: Do not rename/remove screen-local theme files (`selfInspectionKioskTheme.ts`, `inspectionDrawingKioskUi.ts`); restyle their values to the canonical rules.
  Rationale: Keeps blast radius small; consumers keep their imports.
  Date/Author: 2026-07-03 / Fable5 orchestrator

## Outcomes & Retrospective

- All five target screens share the dark surface system (`border-white/15 bg-slate-900/60` panels on `bg-slate-800` shells), the emerald/sky/red/amber color roles, the unified typography scale, and `min-h-11` touch targets. The only light-theme exception (DGX) and the only gradient background (順位ボード) are gone.
- Validation results (2026-07-03): `pnpm lint` 0 errors, `pnpm test` 244 files / 1179 tests passed, `pnpm build` (tsc -b + vite) succeeded. Visual verification of all five routes on local dev servers confirmed dark panels, dark inputs, no gradients, and visible button hierarchy. Temporary Postgres container and validation `.env` were removed afterwards; no existing containers/volumes touched.
- Release validation (2026-07-03): implementation commit `2f7f5069` is on `origin/main`; GitHub CI, Secret scan, CodeQL, and Pages runs all succeeded; deploy run `20260703-200852-8077` reached all seven hosts with `failed=0` and `unreachable=0`; every host HEAD was `2f7f5069`; `raspberrypi5` had `docker-web-1 Up`, `docker-api-1 Up (healthy)`, and `docker-db-1 Up`; real hardware verification passed with `PASS: 45`, `WARN: 0`, `FAIL: 0`.
- Lesson: without tailwind-merge, never layer full token class strings onto shared primitives that carry conflicting base classes; use plain elements or restrict overrides to non-conflicting utilities.
- Open items for this scope: none. Remaining candidates for a later pass (out of scope here): `KioskHeader` tab bar, admin screens other than DGX (e.g. dashboard stat cards are still white on dark), other kiosk pages (計測機器持出, 部品測定テンプレ選択, 呼出 etc. still have white surfaces), and 順位ボード row-internal control sizes (kept for virtual-list stability).

## Update Notes

- 2026-07-03: Initial plan, implementation (Steps 1–6), conflict fix, local validation, commit/push, GitHub checks, production deploy, and real hardware verification completed in one session. Progress timestamps are JST.

## Context and Orientation

Frontend lives in `apps/web` (React 18 + Vite + Tailwind 3.4, no CSS modules). Styling is Tailwind utility classes plus per-screen class-string token files. `apps/web/tailwind.config.ts` has an empty `extend`. Shared UI primitives are in `apps/web/src/components/ui/` (Button, Card, Dialog, ...). Kiosk shell: `apps/web/src/layouts/KioskLayout.tsx` (bg-slate-800) + `apps/web/src/components/kiosk/KioskHeader.tsx`. Admin shell: `apps/web/src/layouts/AdminLayout.tsx` (dark, with a light-theme branch for DGX routes to remove).

Key screen entry points:

- 持出: `apps/web/src/pages/KioskBorrowPage.tsx`, `KioskPhotoBorrowPage.tsx`, `KioskReturnPage.tsx`, card: `apps/web/src/components/kiosk/KioskActiveLoanCard.tsx`
- 順位ボード: `apps/web/src/pages/ProductionScheduleLeaderOrderBoardPage.tsx` + `apps/web/src/features/kiosk/leaderOrderBoard/`
- 自主検査: `apps/web/src/pages/KioskSelfInspectionPage.tsx`, `KioskSelfInspectionSessionPage.tsx` + `apps/web/src/features/part-measurement/`
- 検査図面: `apps/web/src/pages/KioskInspectionDrawingLibraryPage.tsx`, `KioskInspectionDrawingCreatePage.tsx`, `KioskInspectionDrawingEditPage.tsx` + `apps/web/src/features/part-measurement/inspection-drawing/` (`inspectionDrawingKioskUi.ts` is the token source)
- DGX: `apps/web/src/features/admin/dgx-resource/` (`DgxResourceDashboard.tsx`, `DgxResourceOperatorConsole.tsx`, `dgxResourceUi.ts`)

## Plan of Work

Step 1 creates `apps/web/src/features/kiosk/kioskTheme.ts` exporting class-name constants for the canonical surfaces, inputs, titles, and button variants described above. Steps 2–5 restyle each kiosk screen to consume those constants (or align local token files to the same values). Step 6 removes the AdminLayout DGX light branch and restyles the DGX feature to the dark language. Each step updates the colocated vitest files when they assert concrete classes. No logic, routing, API, or state-machine changes are allowed in any step.

## Validation and Acceptance

Run in `apps/web`: `pnpm lint`, `pnpm test`, and `pnpm build` (which runs `tsc -b`). All must pass. Visually: start db (temporary container ok), api (`pnpm dev` in apps/api), web (`pnpm dev` in apps/web, port 4173), then check `/kiosk/tag`, `/kiosk/production-schedule/leader-order-board`, `/kiosk/part-measurement/self-inspection`, `/kiosk/part-measurement/inspection`, `/admin/tools/dgx-resource`. Acceptance: no white cards/inputs on dark shells, no gradients, all kiosk tap controls >= 44px tall, one button grammar, DGX renders dark.

## Idempotence and Recovery

All changes are working-tree edits on branch main, uncommitted until the user asks. Rollback: `git checkout -- <file>`. Temporary Docker resources used for validation must be removed afterwards; existing containers/DB data must not be modified.
