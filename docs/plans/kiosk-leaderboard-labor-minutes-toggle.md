# Plan: Kiosk Leaderboard Labor Minutes Toggle (`+人`)

## Metadata

| Field | Value |
|-------|-------|
| id | `plan-kiosk-leaderboard-labor-minutes-toggle` |
| status | **production_deployed** — Pi5 + Pi4×4 (`496c4e58`) |
| scope | Kiosk leader order board (`ProductionScheduleLeaderOrderBoardPage`) |
| date | 2026-06-17 |
| source_of_truth | this document |
| branch | `feature/kiosk-leaderboard-labor-minutes-toggle` |
| commit | `496c4e58` — `feat: add leaderboard labor minutes toggle` |
| related_code | `apps/api/src/services/production-schedule/leaderboard/leaderboard-labor-minutes*.ts`, `apps/web/src/features/kiosk/leaderOrderBoard/*` |
| related_docs | [kiosk-leaderboard-gantt-mode.md](./kiosk-leaderboard-gantt-mode.md), [deployment.md](../guides/deployment.md), [verification-checklist.md](../guides/verification-checklist.md) |

Rank calculation, auto-rank, and load-balancing are **out of scope**. Signage JPEG (`kiosk_leader_order_cards`) is **unchanged**.

## Goal

Each resource slot has a **`+人`** toggle (default OFF). When ON, display minutes = `machineRequiredMinutes + laborRequiredMinutes`. Gantt bar height and row minute label follow `requiredMinutes`.

## Contract

| Field | Meaning |
|-------|---------|
| `machineRequiredMinutes` | Machine row `FSIGENSHOYORYO` (minutes); API-attached, stable per row |
| `laborRequiredMinutes` | Sum of visible `FSIGENCD=10` rows for same `ProductNo + FKOJUN` |
| `requiredMinutes` | Web display value after slot `+人` toggle |

Rules:

- `FSIGENCD=10` rows are **not shown** as resource slots (sanitized on restore, fallback, server sync, picker).
- Toggle state: per slot index, per terminal (`localStorage` via `usePersistedLeaderBoardLaborMode`); survives resource CD reassignment on the slot.
- IndexedDB cache schema **v3**; records without labor metadata are rejected. Fingerprint includes labor fields.

## Implementation Summary

### API

- `attachLeaderboardLaborMinutes()` decorates shell/continue board payloads (max 1 DB lookup per call).
- `buildLeaderboardLaborMinutesLookupWhereSql()` aligns labor lookup with shell `fkmail` visibility and process-change residual filter.
- Positive-only SUM for `FSIGENSHOYORYO` (negative → 0).
- Rows already carrying metadata skip re-lookup.

### Web

- `normalizeLeaderBoardRow` / `applyLeaderBoardDisplayRequiredMinutesToGrouped` / `usePersistedLeaderBoardLaborMode`.
- `LeaderOrderResourceCard`: header `+人` button; `LeaderOrderResourceRow`: minute label.
- `sanitizeLeaderBoardSlotResourceCd` + server-sync filter exclude `10` from slots.
- `useLeaderBoardResourceSlots`: stable fallback seed to avoid re-hydrate loops.

## Validation Example

ProductNo `0003767716`, resource `021`: OFF **400** min, ON **575** min (from requirements).

## Local Validation (pre-production)

| Check | Result |
|-------|--------|
| Web lint / tsc / full tests (1074) | PASS |
| API lint / tsc / full tests on temp Postgres (1960) | PASS |
| Focused labor tests (API 9, Web 55+) | PASS |
| Temp Postgres: 108 migrations, lookup SQL `175` min visible / `25` hidden, negative → 0 | PASS |
| CI run `27686147211` | success (all jobs) |

## Production Deploy

Standard: [deployment.md](../guides/deployment.md) · `./scripts/update-all-clients.sh` · `./scripts/deploy/verify-phase12-real.sh`.

| Host | Detach Run ID | PLAY RECAP | Notes |
|------|---------------|------------|-------|
| `raspberrypi5` | `20260617-205420-14041` | `ok=134` `changed=4` `failed=0` | api/web rebuild; health wait retried then OK (memory ~91%) |
| `raspi4-kensaku-stonebase01` | `20260617-210832-11505` | `ok=129` `changed=10` `failed=0` | |
| `raspberrypi4` | `20260617-211425-7391` | `ok=122` `changed=10` `failed=0` | |
| `raspi4-robodrill01` | `20260617-212014-28758` | `ok=122` `changed=9` `failed=0` | |
| `raspi4-fjv60-80` | `20260617-212451-8826` | `ok=122` `changed=9` `failed=0` | |

Phase12 after Pi5 and after Pi4: **PASS 43 / WARN 0 / FAIL 0**.

Post-deploy checks (Pi5):

- Git HEAD `496c4e58` on branch `feature/kiosk-leaderboard-labor-minutes-toggle`.
- Web bundle `index-C6pj5jBg.js` contains `+人`, `machineRequiredMinutes`, `laborRequiredMinutes`.
- API container has `leaderboard-labor-minutes.service.js`.
- `GET .../leaderboard-board?boardResourceCds=021` — all sampled rows include labor metadata.
- Sample 160 rows for `021`: **0 rows with `laborRequiredMinutes > 0`** (field UI for ON state needs a row with labor data).

Pi4: kiosk-browser restart via Ansible; SPA served from Pi5. Force reload per [verification-checklist §6.6.4](../guides/verification-checklist.md) if UI looks stale.

## Operational Notes (not KB)

- Pi5 api/web rebuild may hit transient health-wait retries after memory spike; see [deployment.md §deploy-api-build-cache-health-wait](../guides/deployment.md#deploy-api-build-cache-health-wait-2026-06-17).
- Pi4 deploy does **not** rebuild api/web; only client-side refresh matters for this feature.

## Open Items

- [ ] **Field sign-off**: On each Pi4 kiosk, confirm `+人` toggle, minute label, and Gantt height on a row where `laborRequiredMinutes > 0` (sample API query for `021` had none in first 160 rows).
- [ ] **Performance monitor**: Labor lookup `EXPLAIN ANALYZE` on production-scale data; add index only if latency regresses (local temp DB: ~0.05 ms on 3 rows; synthetic 5万行 ~15 ms in prior review).

## Next Actions (for resuming AI)

1. Merge PR to `main` and tag plan status `done` after field sign-off.
2. Close field sign-off above; update this plan status to `done` or open KB only if a defect is found.
3. Optional: add leaderboard-board labor smoke to Phase12 only if repeated regressions occur (not required now).

## Local Notes JA

- 要件正本: `leaderboard_labor_minutes_requirements.md`（リポジトリ外）
- Codex レビュー反映: TS re-export fix, lookup 可視性合わせ, FSIGENCD=10 除外, cache v3/fingerprint, service tests, import/order, fallback 安定化
