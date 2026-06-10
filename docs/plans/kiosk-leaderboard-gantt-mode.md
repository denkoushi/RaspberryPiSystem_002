---
id: kiosk-leaderboard-gantt-mode
status: implemented_local
scope: kiosk leader order board gantt display
date: 2026-06-10
source_of_truth: true
related_code:
  - apps/web/src/features/kiosk/leaderOrderBoard/gantt/
  - apps/web/src/features/kiosk/leaderOrderBoard/usePersistedLeaderBoardGanttMode.ts
related_docs:
  - docs/knowledge-base/KB-362-kiosk-load-balancing.md
  - docs/knowledge-base/KB-369-leader-order-board-api-internal-latency.md
validation: web vitest + web build (local)
open_items:
  - commit and deploy (user approval)
  - Pi4 manual scroll check on production kiosk
---

# Plan: Kiosk Leader Order Board Gantt Display

## Goal

Add a device-local **ガントON/OFF** toggle to the kiosk leader order board. When ON, each resource slot uses a **variable 8H ruler** scaled to the slot body height, row height scales with `FSIGENSHOYORYO` (required minutes, no quantity multiply), and 8H boundary ticks appear on the left gutter.

## Constraints

- Default OFF; OFF path preserves existing layout and virtualization settings.
- No API changes (`rowData.FSIGENSHOYORYO` already projected).
- Pi4-friendly: pure layout math, accurate virtual estimates, no height animations.
- Signage JPEG path out of scope.

## Layout contract (variable 8H ruler)

- Scale is **per resource slot**: `pxPerMinute = availableWorkHeightPx / max(totalRequiredMinutes, 480)`.
- `workHeightPx = requiredMinutes * pxPerMinute` (time axis for ruler mapping).
- `visualMinHeightPx = max(workHeightPx, 96)` (readability; DOM min-height).
- `estimateHeightPx = visualMinHeightPx + 4 + (footer chips ? 28 : 0)`.
- `containerMinHeightPx = max(totalEstimateHeightPx, availableWorkHeightPx)`.
- When total required minutes are under 8H and rows fit without exceeding available height, the **8H boundary** is drawn near the slot bottom to show unused capacity.
- When many short rows force `totalEstimateHeightPx > availableWorkHeightPx`, **readability wins**; unused-gap visualization is skipped and content scrolls inside the slot body.
- Slot card uses `h-full` (fills grid row). `max-height: 70vh` cap removed for gantt ON.
- Grid uses `minmax(14rem, 1fr)` for both gantt ON and OFF.
- 8H ticks: `origin` at 0H (thin), `boundary` at 8H/16H… (thicker). Footer chips and row padding are excluded from the time axis.
- Tick bottom placement clamps to `availableHeight - boundaryLineHeight` to avoid clipping when unused-gap is shown.
- When readability overflow expands `containerMinHeightPx` beyond the viewport body, tick boundaries clamp to `containerMinHeightPx` so ruler lines track scrollable content.

## Local Notes JA

- トグル表示名: **ガントOFF** / **ガントON**
- 左ペイン「表示」行（両方/未完/完了）の横に配置
- 永続化: `localStorage`（工場+端末スコープ）
