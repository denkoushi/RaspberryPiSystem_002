---
id: kiosk-leaderboard-gantt-mode
status: deployed_all_kiosks_auto_verified
scope: kiosk leader order board gantt display
date: 2026-06-11
source_of_truth: true
related_code:
  - apps/web/src/features/kiosk/leaderOrderBoard/gantt/
  - apps/web/src/features/kiosk/leaderOrderBoard/usePersistedLeaderBoardGanttMode.ts
  - apps/web/src/features/kiosk/leaderOrderBoard/LeaderOrderResourceCard.tsx
  - apps/web/src/features/kiosk/leaderOrderBoard/LeaderBoardGrid.tsx
related_docs:
  - docs/guides/deployment.md
  - docs/guides/verification-checklist.md
  - docs/knowledge-base/KB-369-leader-order-board-api-internal-latency.md
validation: web vitest 29 + lint + CI 27481779984 + Pi5→Pi4×4 deploy 20260614 + verify-phase12-real PASS 43/0/0
open_items:
  - operator visual sign-off for visible/transparent ruler contrast on shop floor
  - optional verification-checklist section for gantt toggle and ruler
---

# Plan: Kiosk Leader Order Board Gantt Display

## Goal

Add a device-local **ガントON/OFF** toggle to the kiosk leader order board. When ON, each resource slot uses a **variable 8H ruler** scaled to the slot body height, row height scales with `FSIGENSHOYORYO` (required minutes, no quantity multiply), and **4px visible/transparent vertical 8H bands** appear in the left gutter.

## Current branch and HEAD

- **Branch**: `fix/gantt-ruler-contrast` (contrast fix; pending merge to `main`)
- **Feature commit**: `6a7b5218` — visible/transparent ruler contrast (`bg-cyan-400/90`)
- **Prior on main**: PR [#430](https://github.com/denkoushi/RaspberryPiSystem_002/pull/430) (`c9baa657`) — vertical ruler bands · PR #429 — initial gantt mode

### Contrast fix (2026-06-14)

- **Problem**: two-shade alternating bands (`cyan-400/75` + `cyan-200/45`) — lighter shade hard to see on kiosk displays.
- **Fix**: render-only change — even `bandIndex` → `bg-cyan-400/90`; odd → `bg-transparent`. Layout/`rulerSegments` contract unchanged.

## Constraints

- Default OFF; OFF path preserves existing layout and virtualization settings.
- No API changes (`rowData.FSIGENSHOYORYO` already projected).
- Pi4-friendly: pure layout math, accurate virtual estimates, no height animations.
- Signage JPEG path (`kiosk_leader_order_cards`) out of scope.

## Layout contract (variable 8H ruler + vertical bands)

- Scale is **per resource slot**: `pxPerMinute = availableWorkHeightPx / max(totalRequiredMinutes, 480)`.
- `availableWorkHeightPx` from `useLeaderBoardGanttBodyHeight` (ResizeObserver on card body); fallback `480px`.
- `workHeightPx = requiredMinutes * pxPerMinute` (time axis for ruler mapping).
- `visualMinHeightPx = max(workHeightPx, 96)` (readability; DOM min-height).
- `estimateHeightPx = visualMinHeightPx + 4 + (footer chips ? 28 : 0)`.
- `containerMinHeightPx = max(totalEstimateHeightPx, availableWorkHeightPx)`.
- When total required minutes are under 8H and rows fit without exceeding available height, the **first 8H band** extends to the slot bottom to show unused capacity.
- When many short rows force `totalEstimateHeightPx > availableWorkHeightPx`, **readability wins**; unused-gap visualization is skipped and content scrolls inside the slot body.
- Slot card uses `h-full` (fills grid row). `max-height: 70vh` cap removed for gantt ON.
- Grid uses `minmax(14rem, 1fr)` for both gantt ON and OFF.

### Ruler visual contract (2026-06-11)

- **Replaced** horizontal `tickMarks` (`origin` 1px / `boundary` 3px) with **`rulerSegments`**.
- Segment shape: `{ topPx, heightPx, bandIndex }` — no `startMinute` / `endMinute` in DOM contract.
- **8H bands**: consecutive vertical bars in gutter only; `bandIndex % 2` alternates one stronger cyan band and a transparent band in render layer.
- **No horizontal tick lines**.
- Gutter `GANTT_RULER_GUTTER_WIDTH_PX = 4`; bar `GANTT_RULER_BAR_WIDTH_PX = 4` (same value, separate responsibility).
- Empty resource slot (`rows.length === 0`): no gutter rendered.
- `eightHourBoundaryEndY` (not line-height-offset boundary): full bottom for unused-gap mode.
- Overflow: segments follow `rulerHeightPx`; render layer extends last band to `max(bodyTotalHeightPx, rulerHeightPx)` via `normalizeRulerSegmentsForRenderHeight()`.
- **Performance cap**: `GANTT_RULER_MAX_BAND_COUNT = 64` — boundary loop and DOM segments capped regardless of `rulerHeightPx`; sub-pixel boundaries (`< 1px` gap) skipped during generation.
- Footer chips and row padding excluded from time axis; non-time tail absorbed into last band for visual continuity.

## Implementation summary

| Area | Module | Role |
|------|--------|------|
| Layout | `leaderBoardGanttLayout.ts` | `computeGanttSlotLayout`, `computeGanttRulerSegments`, `normalizeRulerSegmentsForRenderHeight` |
| Constants | `leaderBoardGanttConstants.ts` | `GANTT_RULER_*`, `GANTT_RULER_MAX_BAND_COUNT` |
| Render | `LeaderBoardGanttTickGutter.tsx` | visible/transparent vertical bands; `data-testid` / `data-band-index` |
| Card | `LeaderOrderResourceCard.tsx` | `rulerSegments` memo + virtual `measure()` |
| Body height | `useLeaderBoardGanttBodyHeight.ts` | ResizeObserver (unchanged) |
| Persistence | `usePersistedLeaderBoardGanttMode.ts` | `localStorage` (unchanged) |

**Prior commits on main** (PR #429):

- `f97fdd96` — initial gantt mode (toggle, fixed-scale gutter)
- `874fdb00` — variable 8H ruler, overflow fix, body-height hook

**This branch**:

- `6a7b5218` — ruler contrast: single stronger cyan / transparent alternating bands

**Prior on main** (PR #430):

- `ee3aebfc` — vertical ruler bands, segment model, 4px gutter, band cap, test hardening

## Review fixes applied (this branch)

1. **Multi-band absorption (P1)**: 8H+ workloads now emit separate segments per 8H boundary (e.g. 960min → 2 bands, 1440min → 3 bands). Fixed boundary loop to include `timeY <= totalWorkPx` at 8H multiples.
2. **Performance cap (P2)**: `GANTT_RULER_MAX_BAND_COUNT = 64` applied at generation and cap stages; not proportional to `rulerHeightPx`.
3. **Test stability (P3)**: removed wall-clock `performance.now()` assertions; structural caps only.

## Validation

### Local

| Check | Result |
|-------|--------|
| `pnpm --filter @raspi-system/web test -- leaderBoardGantt` | **29 passed** |
| `pnpm --filter @raspi-system/web lint` | pass |
| `pnpm --filter @raspi-system/web build` | pass |
| `git diff --check` | pass |

### CI

| Run ID | Commit | Result |
|--------|--------|--------|
| `27481779984` | `6a7b5218` | all jobs success (lint-build-unit, security-docker, api-db-and-infra, e2e-smoke, e2e-tests) |
| `27315868021` | `ee3aebfc` | all jobs success (prior vertical bands PR) |

### Production deploy (Web only)

Standard: [deployment.md](../guides/deployment.md) · `update-all-clients.sh`

| Phase | Host | Detach Run ID | HEAD | PLAY RECAP | Notes |
|-------|------|---------------|------|------------|-------|
| **Prior (main)** | `raspberrypi5` | `20260610-221820-17260` | `874fdb00` | `ok=134` `failed=0` | initial gantt + horizontal ticks |
| **Prior (main)** | Pi4×4 | `20260611-073516` … `074648` | — | all `failed=0` | horizontal-tick era |
| **Prior (main)** | `raspberrypi5` | `20260611-095259-28452` | `ee3aebfc` | `ok=134` `changed=4` `failed=0` | vertical bands (two-shade) |
| **Contrast fix** | `raspberrypi5` | **`20260614-085456-296`** | **`6a7b5218`** | **`ok=134` `changed=4` `failed=0`** | `web` rebuild · bundle `index-CeJFgkye.js` |
| **Contrast fix** | `raspi4-kensaku-stonebase01` | **`20260614-091844-29193`** | **`6a7b5218`** | **`ok=129` `changed=10` `failed=0`** | `kiosk-browser` restart |
| **Contrast fix** | `raspberrypi4` | **`20260614-092320-13872`** | **`6a7b5218`** | **`ok=122` `changed=10` `failed=0`** | `kiosk-browser` restart |
| **Contrast fix** | `raspi4-robodrill01` | **`20260614-092821-28995`** | **`6a7b5218`** | **`ok=122` `changed=9` `failed=0`** | `kiosk-browser` restart |
| **Contrast fix** | `raspi4-fjv60-80` | **`20260614-093224-18058`** | **`6a7b5218`** | **`ok=122` `changed=9` `failed=0`** | `kiosk-browser` restart |

**Pi3**: out of scope (SPA not served from Pi4 path).

### Automated verification (2026-06-14)

| Check | Result |
|-------|--------|
| `verify-phase12-real.sh` (post Pi5 deploy) | **PASS 43 / WARN 0 / FAIL 0** (~68s) |
| `verify-phase12-real.sh` (post Pi4×4 deploy) | **PASS 43 / WARN 0 / FAIL 0** (~73s) |
| Pi5 bundle class probe | `bg-cyan-400/90` + `bg-transparent` in `index-CeJFgkye.js` |
| deploy-status (all Pi4) | pass |

### Manual verification (operator)

**All kiosks (post `6a7b5218`)** — visible/transparent ruler contrast:

1. Open leader order board; toggle **ガントON** (left pane beside 表示).
2. Left gutter: **4px visible/transparent alternating bands** per 8H; **no horizontal lines**; visible bands use stronger cyan.
3. Cards fill grid height; inner scroll works on heavy slots.
4. 8H+ workload: visible/transparent rhythm at band boundaries (960min → 2 visible bands).
5. Force reload if stale bundle: [verification-checklist §6.6.4](../guides/verification-checklist.md).

## Knowledge (for next AI)

- **Contrast fix is render-only** — no layout/API changes; safe to deploy web-only Pi5→Pi4 path.
- **Pi4 does not rebuild web** — SPA from Pi5; Pi4 needs `kiosk-browser` restart or force reload.
- **Do not reuse horizontal `computeEightHourBoundaryY` line-height offset** for vertical segment ends — use `eightHourBoundaryEndY` without `GANTT_TICK_BOUNDARY_LINE_HEIGHT_PX` subtraction.
- **8H-spanning single row** is OK: bands live in gutter lane only; `mapGanttTimeYToVisualY` may place boundary mid-row.
- **Virtual rows**: `rowVirtualizer.measure()` when `slotLayout` changes under gantt + virtual threshold.
- **ResizeObserver tests**: restore `globalThis.ResizeObserver` in `afterEach`.
- **Default OFF** preserves prior Pi4 performance path.

## Open items

1. **Operator visual sign-off** on shop floor for visible/transparent contrast (`6a7b5218` deployed all 5 kiosks).
2. **Optional** — `verification-checklist` § for gantt toggle/ruler bands.

## Local Notes JA

- トグル表示名: **ガントOFF** / **ガントON**
- 左ペイン「表示」行の横に配置
- 永続化: `localStorage`（工場+端末スコープ）
- 縦バー色: `cyan-400/90` と透明 交互（`bandIndex % 2`）
