# Plan: Kiosk Leaderboard Labor Minutes Toggle (`+人`)

Status: **implemented / local validated** (branch `feature/kiosk-leaderboard-labor-minutes-toggle`)

Scope: Kiosk leader order board only. Rank calculation, auto-rank, and load-balancing are **out of scope**.

## Goal

Each resource slot gets a **`+人`** toggle (default OFF). When ON, display required minutes = `machineRequiredMinutes + laborRequiredMinutes` for rows in that slot. Gantt bar height and row minute label follow `requiredMinutes`.

## Contract

| Field | Meaning |
|-------|---------|
| `machineRequiredMinutes` | Machine row `FSIGENSHOYORYO` (minutes), immutable |
| `laborRequiredMinutes` | Sum of `FSIGENCD=10` rows for same `ProductNo + FKOJUN`, immutable |
| `requiredMinutes` | Display value after slot `+人` toggle |

- `FSIGENCD=10` rows are **not shown** in slots (import OK).
- Toggle state: per slot, per terminal (`localStorage`), survives resource CD reassignment on the slot.

## API

- `attachLeaderboardLaborMinutes()` on shell/continue board payloads.
- `ProductionScheduleRow` adds optional `machineRequiredMinutes`, `laborRequiredMinutes`.
- Labor SQL uses **positive minutes only** (`buildPositiveCsvDashboardRowRequiredMinutesSql`) — negative values count as 0 (P2 fix).
- Rows already carrying metadata skip re-lookup (P3 mitigation).

## Web

- `normalizeLeaderBoardRow`: resolve labor fields; exclude `FSIGENCD=10`.
- `applyLeaderBoardDisplayRequiredMinutesToGrouped`: slot-index-aware display mapping.
- `usePersistedLeaderBoardLaborMode`: slot toggles in localStorage.
- `LeaderOrderResourceCard`: header `+人` button (note-style highlight when ON).
- `LeaderOrderResourceRow`: minute label (`400分` / `575分`).
- IndexedDB cache schema **v3**; reject snapshots missing labor metadata.

## Validation Example

ProductNo `0003767716`, resource `021`: OFF **400** min, ON **575** min.

## Tests

- API: labor minutes service integration (6 cases).
- Web: normalize, display apply, labor mode persistence, gantt/labor UI, cache v3.
- `FSIGENCD=10` is excluded at localStorage restore, fallback seed, server merge, slot picker candidates, and `uniqueOrderedResourceCds`.
- Lookup WHERE aligns with shell fkmail visibility + residual filter (P2 fix).
- `attachLeaderboardLaborMinutes` service unit tests cover metadata attach, FSIGENCD=10, positive-only parse, key fallback.

## Open Items

- [ ] Field verify on Pi hardware after merge/deploy (user-driven).
- [ ] Large-data EXPLAIN / latency measurement for labor lookup (P3 — monitor before index work).

## References

- Branch: `feature/kiosk-leaderboard-labor-minutes-toggle`
- Related: [kiosk-leaderboard-gantt-mode.md](./kiosk-leaderboard-gantt-mode.md)

## Local Notes JA

- 要件正本: `leaderboard_labor_minutes_requirements.md`（リポジトリ外または別途）
- Codex レビュー P1–P3 を反映済み（Web 配線・SQL 正値 SUM・lookup スキップ）
