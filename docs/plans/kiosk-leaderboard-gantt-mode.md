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

Add a device-local **ガントON/OFF** toggle to the kiosk leader order board. When ON, row height scales with `FSIGENSHOYORYO` (required minutes, no quantity multiply) and an 8H tick gutter appears on the left of each resource slot card.

## Constraints

- Default OFF; OFF path preserves existing layout and virtualization settings.
- No API changes (`rowData.FSIGENSHOYORYO` already projected).
- Pi4-friendly: pure layout math, accurate virtual estimates, no height animations.
- Signage JPEG path out of scope.

## Layout contract

- `contentHeightPx = clamp(96, requiredMinutes * pxPerMinute, 384)`
- `estimateHeightPx = contentHeightPx + 4 + (footer chips ? 28 : 0)`
- Card inner scroll parent is always retained (`flex-1 min-h-0 overflow-y-auto` on the body when gantt ON).
- When gantt ON: card `max-height` is capped at `70vh` so inner scroll activates before the card grows unbounded; content shorter than the cap still sizes naturally up to the cap.
- When gantt ON and row count > virtual threshold: virtualized inner scroll (unchanged Pi4 path).
- Grid uses `minmax(14rem, auto)` when gantt ON.
- 8H ticks map to cumulative **work-time** height (`rowMinHeightPx` only). Footer chips and row padding are excluded from the time axis.

## Local Notes JA

- トグル表示名: **ガントOFF** / **ガントON**
- 左ペイン「表示」行（両方/未完/完了）の横に配置
- 永続化: `localStorage`（工場+端末スコープ）
