---
id: kiosk-leaderboard-gantt-mode
status: pi5_deployed_pending_signoff
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
validation: web vitest 29 + lint + build + CI 27315868021 + Pi5 deploy 20260611-095259-28452
open_items:
  - Pi5 manual sign-off for vertical ruler bands
  - Pi4×4 deploy after Pi5 OK
  - optional verification-checklist section for gantt toggle and ruler
---

# Plan: Kiosk Leader Order Board Gantt Display

## Goal

Add a device-local **ガントON/OFF** toggle to the kiosk leader order board. When ON, each resource slot uses a **variable 8H ruler** scaled to the slot body height, row height scales with `FSIGENSHOYORYO` (required minutes, no quantity multiply), and **alternating 4px vertical 8H bands** appear in the left gutter.

## Current branch and HEAD

- **Branch**: `feat/kiosk-gantt-ruler-vertical-bars`
- **HEAD**: `ee3aebfc` — `feat: improve kiosk gantt ruler readability`
- **Base on main**: `2480fc87` (merged PR #429 — initial gantt mode)

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
- **8H bands**: consecutive vertical bars in gutter only; `bandIndex % 2` alternates two cyan shades in render layer.
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
| Render | `LeaderBoardGanttTickGutter.tsx` | alternating vertical bands; `data-testid` / `data-band-index` |
| Card | `LeaderOrderResourceCard.tsx` | `rulerSegments` memo + virtual `measure()` |
| Body height | `useLeaderBoardGanttBodyHeight.ts` | ResizeObserver (unchanged) |
| Persistence | `usePersistedLeaderBoardGanttMode.ts` | `localStorage` (unchanged) |

**Prior commits on main** (PR #429):

- `f97fdd96` — initial gantt mode (toggle, fixed-scale gutter)
- `874fdb00` — variable 8H ruler, overflow fix, body-height hook

**This branch**:

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
| `27315868021` | `ee3aebfc` | all jobs success (lint-build-unit, security-docker, api-db-and-infra, e2e-smoke, e2e-tests) |

### Production deploy (Web only)

Standard: [deployment.md](../guides/deployment.md) · `update-all-clients.sh`

| Phase | Host | Detach Run ID | HEAD | PLAY RECAP | Notes |
|-------|------|---------------|------|------------|-------|
| **Prior (main)** | `raspberrypi5` | `20260610-221820-17260` | `874fdb00` | `ok=134` `failed=0` | initial gantt + horizontal ticks |
| **Prior (main)** | Pi4×4 | `20260611-073516` … `074648` | — | all `failed=0` | `kiosk-browser` restart; horizontal-tick era |
| **This branch** | `raspberrypi5` | **`20260611-095259-28452`** | **`ee3aebfc`** | **`ok=134` `changed=4` `failed=0`** | `web` rebuild · `Git: changed` |
| **This branch** | Pi4×4 | — | — | — | **not deployed** — await Pi5 sign-off |

**Pi3**: out of scope.

### Manual verification (operator)

**Pi5 (pending sign-off)** — vertical ruler bands on `ee3aebfc`:

1. Open leader order board; toggle **ガントON** (left pane beside 表示).
2. Left gutter: **4px alternating vertical bands** per 8H; **no horizontal lines**.
3. Cards fill grid height; inner scroll works on heavy slots.
4. 8H+ workload: second/third band colors visible at band boundaries.
5. Force reload if stale bundle: [verification-checklist §6.6.4](../guides/verification-checklist.md).

**Pi4 (after Pi5 OK)**: deploy 1 host at a time (`raspi4-kensaku-stonebase01` first recommended) + force reload.

## Knowledge (for next AI)

- **Pi4 does not rebuild web** — SPA from Pi5; Pi4 needs `kiosk-browser` restart or force reload.
- **Do not reuse horizontal `computeEightHourBoundaryY` line-height offset** for vertical segment ends — use `eightHourBoundaryEndY` without `GANTT_TICK_BOUNDARY_LINE_HEIGHT_PX` subtraction.
- **8H-spanning single row** is OK: bands live in gutter lane only; `mapGanttTimeYToVisualY` may place boundary mid-row.
- **Virtual rows**: `rowVirtualizer.measure()` when `slotLayout` changes under gantt + virtual threshold.
- **ResizeObserver tests**: restore `globalThis.ResizeObserver` in `afterEach`.
- **Default OFF** preserves prior Pi4 performance path.

## Open items

1. **Pi5 manual sign-off** for vertical ruler bands (`20260611-095259-28452`).
2. **Pi4×4 deploy** after Pi5 OK — same branch/ref, one `--limit` per host.
3. **Optional** — `verification-checklist` § for gantt toggle/ruler bands.
4. **PR merge to main** — in progress this session.

## Local Notes JA

- トグル表示名: **ガントOFF** / **ガントON**
- 左ペイン「表示」行の横に配置
- 永続化: `localStorage`（工場+端末スコープ）
- 縦バー色: `cyan-400/75` と `cyan-200/45` 交互（`bandIndex % 2`）
