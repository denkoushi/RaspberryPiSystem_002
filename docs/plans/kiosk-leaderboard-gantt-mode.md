---
id: kiosk-leaderboard-gantt-mode
status: deployed_production
scope: kiosk leader order board gantt display
date: 2026-06-10
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
validation: web vitest (23) + lint + build + CI 27277996263 + Pi5/Pi4 deploy + Phase12
open_items:
  - merge PR to main (in progress)
  - Pi4 floor manual check: gantt ON scroll + overflow tick alignment on real workload
  - optional: verification-checklist section for gantt toggle and ruler
---

# Plan: Kiosk Leader Order Board Gantt Display

## Goal

Add a device-local **ガントON/OFF** toggle to the kiosk leader order board. When ON, each resource slot uses a **variable 8H ruler** scaled to the slot body height, row height scales with `FSIGENSHOYORYO` (required minutes, no quantity multiply), and 8H boundary ticks appear on the left gutter.

## Constraints

- Default OFF; OFF path preserves existing layout and virtualization settings.
- No API changes (`rowData.FSIGENSHOYORYO` already projected).
- Pi4-friendly: pure layout math, accurate virtual estimates, no height animations.
- Signage JPEG path (`kiosk_leader_order_cards`) out of scope.

## Layout contract (variable 8H ruler)

- Scale is **per resource slot**: `pxPerMinute = availableWorkHeightPx / max(totalRequiredMinutes, 480)`.
- `availableWorkHeightPx` from `useLeaderBoardGanttBodyHeight` (ResizeObserver on card body); fallback `480px`.
- `workHeightPx = requiredMinutes * pxPerMinute` (time axis for ruler mapping).
- `visualMinHeightPx = max(workHeightPx, 96)` (readability; DOM min-height).
- `estimateHeightPx = visualMinHeightPx + 4 + (footer chips ? 28 : 0)`.
- `containerMinHeightPx = max(totalEstimateHeightPx, availableWorkHeightPx)`.
- When total required minutes are under 8H and rows fit without exceeding available height, the **8H boundary** is drawn near the slot bottom to show unused capacity.
- When many short rows force `totalEstimateHeightPx > availableWorkHeightPx`, **readability wins**; unused-gap visualization is skipped and content scrolls inside the slot body.
- Slot card uses `h-full` (fills grid row). `max-height: 70vh` cap removed for gantt ON.
- Grid uses `minmax(14rem, 1fr)` for both gantt ON and OFF.
- 8H ticks: `origin` at 0H (1px), `boundary` at 8H/16H… (3px). Footer chips and row padding are excluded from the time axis.
- Unused-gap mode: tick clamp to `availableWorkHeightPx`.
- Overflow mode: tick clamp to `containerMinHeightPx` (`rulerHeightPx`) so boundaries track scrollable content.

## Implementation summary

| Area | Change |
|------|--------|
| Layout core | `computeGanttSlotLayout` — separates `workHeightPx` vs `visualMinHeightPx` |
| Body height | `useLeaderBoardGanttBodyHeight` — ResizeObserver + `clientHeight` fallback |
| Card | `LeaderOrderResourceCard` — slot layout, virtual `measure()` on layout change |
| Gutter | `LeaderBoardGanttTickGutter` — `origin` / `boundary` tick kinds |
| Grid | `LeaderBoardGrid` — gantt ON/OFF both use `minmax(14rem, 1fr)` |
| Persistence | `usePersistedLeaderBoardGanttMode` — `localStorage` (factory + device scope) |

**Branch**: `feat/kiosk-leaderboard-gantt-mode`

**Commits**:

- `f97fdd96` — initial gantt mode (toggle, fixed-scale gutter)
- `874fdb00` — variable 8H ruler, overflow tick fix, body-height hook + tests

## Validation

### Local / CI

| Check | Result |
|-------|--------|
| `pnpm --filter @raspi-system/web test -- leaderBoardGantt` | 23 passed |
| `pnpm --filter @raspi-system/web lint` | pass |
| `pnpm --filter @raspi-system/web build` | pass |
| GitHub Actions CI run `27277996263` (`874fdb00`) | all jobs success |

### Production deploy (Web only)

Standard: [deployment.md](../guides/deployment.md) · `update-all-clients.sh` · branch `feat/kiosk-leaderboard-gantt-mode`

| Host | Detach Run ID | PLAY RECAP | Notes |
|------|---------------|------------|-------|
| `raspberrypi5` | `20260610-221820-17260` | `ok=134` `changed=4` `failed=0` | `web` rebuild · bundle `index-BPJzr_D6.js` contains ガントON/OFF |
| `raspi4-kensaku-stonebase01` | `20260611-073516-1464` | `ok=129` `changed=11` `failed=0` | `kiosk-browser` restart |
| `raspberrypi4` | `20260611-073916-22113` | `ok=122` `changed=10` `failed=0` | same |
| `raspi4-robodrill01` | `20260611-074339-27053` | `ok=122` `changed=9` `failed=0` | same |
| `raspi4-fjv60-80` | `20260611-074648-5765` | `ok=122` `changed=9` `failed=0` | same |

**Phase12**: Pi5 post-deploy **43/0/0** · Pi4群後 **42/1/0** (WARN: auto-tuning scheduler log count 0 — unrelated).

**Pi3**: out of scope.

### Manual verification (operator)

1. Open leader order board on kiosk.
2. Toggle **ガントOFF** / **ガントON** in left pane beside 表示 filter.
3. Gantt ON: left gutter shows 0H + 8H boundary lines; cards fill grid height; inner scroll works.
4. Short-row overflow: 8H line stays aligned with scroll content (not stuck at viewport bottom).
5. Pi4 stale UI: force reload per [verification-checklist §6.6.4](../guides/verification-checklist.md) if toggle missing.

## Knowledge (for next AI)

- **Pi4 does not rebuild web** — SPA is served from Pi5; Pi4 needs `kiosk-browser` restart or force reload.
- **ResizeObserver test** must restore `globalThis.ResizeObserver` in `afterEach` to avoid polluting later tests.
- **Virtual rows**: call `rowVirtualizer.measure()` when `slotLayout` changes under gantt + virtual threshold.
- **Review fix (pre-deploy)**: overflow ticks were clamped to viewport height; fixed to `containerMinHeightPx`.
- **Default OFF** preserves prior Pi4 performance path (fixed row estimate, no gutter).

## Open items

1. **Merge PR** to `main` (this session).
2. **Pi4 floor manual check** — scroll smoothness and overflow ruler on real multi-short-row slots (automated deploy OK; visual not fully signed off).
3. **Optional** — add `verification-checklist` § for gantt toggle/ruler (no section yet).

## Local Notes JA

- トグル表示名: **ガントOFF** / **ガントON**
- 左ペイン「表示」行（両方/未完/完了）の横に配置
- 永続化: `localStorage`（工場+端末スコープ）
