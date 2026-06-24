---
id: kiosk-leaderboard-gantt-mode
status: deployed_all_kiosks_operator_pi5_ok_plus_8h_10h_toggle_local
scope: kiosk leader order board gantt display
date: 2026-06-17
source_of_truth: true
related_code:
  - apps/web/src/features/kiosk/leaderOrderBoard/gantt/
  - apps/web/src/features/kiosk/leaderOrderBoard/gantt/leaderBoardGanttCapacity.ts
  - apps/web/src/features/kiosk/leaderOrderBoard/usePersistedLeaderBoardGanttMode.ts
  - apps/web/src/features/kiosk/leaderOrderBoard/usePersistedLeaderBoardCapacityMode.ts
  - apps/web/src/features/kiosk/leaderOrderBoard/LeaderOrderResourceCard.tsx
  - apps/web/src/features/kiosk/leaderOrderBoard/LeaderBoardGrid.tsx
  - infrastructure/docker/Dockerfile.web
related_docs:
  - docs/guides/deployment.md
  - docs/guides/verification-checklist.md
  - docs/knowledge-base/KB-369-leader-order-board-api-internal-latency.md
  - docs/knowledge-base/ci-cd.md
validation: web vitest leaderBoardGantt 42 passed + lint + tsc + build + CI 27662630259 success + Pi5/Pi4 deploy + verify-phase12-real 43/0/0 (2026-06-17) + 2026-06-24 focused 8H/10H toggle tests/lint/build PASS
open_items:
  - operator visual sign-off for remainder-band display on all Pi4 kiosks (Pi5 OK 2026-06-17)
  - 8H/10H toggle production deploy and real-device visual sign-off
---

# Plan: Kiosk Leader Order Board Gantt Display

## Resume here (next AI)

**What shipped (2026-06-17)**: branch `fix/kiosk-leaderboard-capacity-bands` · commits `336d7baa` (remainder bands + capacity resolver) · `66fd10c6` (Caddy `v2.11.4` CI fix). **Production HEAD `66fd10c6`** on Pi5 + Pi4×4. Pi5 operator sign-off **OK**; Pi4 remainder-band visual check still open.

**Read next if touching this area**: Layout contract § below · `leaderBoardGanttCapacity.ts` (slot capacity, default 480) · `leaderBoardGanttLayout.ts` (remainder band boundaries).

## Goal

Add a device-local **ガントON/OFF** toggle to the kiosk leader order board. When ON, each resource slot uses a **variable capacity ruler** (default 8H = 480min; operator can switch each slot to 10H = 600min) scaled to the slot body height, row height scales with `FSIGENSHOYORYO` (`requiredMinutes`), and **4px visible/transparent vertical bands** appear in the left gutter.

2026-06-24 update: each resource slot also has a device-local **8H/10H** toggle next to `+人`. It switches the slot capacity between **480min** and **600min** and passes that value as `capacityMinutes` into the existing Gantt layout.

## Branch, commits, CI

| Item | Value |
|------|-------|
| Branch | `fix/kiosk-leaderboard-capacity-bands` |
| Feature commit | `336d7baa` — `fix(kiosk): show capacity remainder bands` |
| CI fix commit | `66fd10c6` — `fix(docker): update web Caddy dependency` (`v2.11.3` → `v2.11.4`) |
| CI run | **`27662630259`** — all jobs success (after Caddy bump) |
| Prior on `main` | `6a7b5218` — visible/transparent ruler contrast |

CI blocker (resolved): `security-docker` failed on Caddy **CVE-2026-52844 / CVE-2026-52845** — see [ci-cd.md §KB-307](../knowledge-base/ci-cd.md) (2026-06-17追記). Do not duplicate that troubleshooting here.

## Capacity remainder bands (2026-06-17) — current feature

### Problem

Workloads exceeding a capacity multiple (e.g. 600min at 8H) extended the last visible band to the slot bottom; remainder work (e.g. 2H) did not appear as a separate transparent band.

### Fix (layout)

- `computeCapacityBoundaryEndYs` adds a logical work-end boundary after complete capacity multiples.
- Non-time tail (padding/footer/virtual diff) still extends the last band only.
- Examples @ 480min capacity: 600min → `bandIndex [0,1]`; 960min → `[0,1]` only; 1080min → `[0,1,2]`.

### Capacity resolver (SOLID boundary)

- Module: `leaderBoardGanttCapacity.ts`
- `resolveLeaderBoardGanttCapacityMinutes({ siteKey, deviceScopeKey, slotIndex, resourceCd })`
- **Production default: all slots 480min.** Example map values (305→480, 584→720, 585→1440) documented in code comments only — **not enabled**.
- 2026-06-24: Web applies the persisted per-slot 8H/10H toggle before falling back to the resolver. Values are limited to **480** or **600** minutes.
- `normalizeLeaderBoardGanttCapacityMinutes` clamps invalid input to 480.
- Wiring: `LeaderBoardGrid` resolves per slot → `LeaderOrderResourceCard` receives `capacityMinutes` (card does not resolve by `resourceCd` alone).
- Naming: `capacityBoundaryEndY` added; `eightHourBoundaryEndY` kept as deprecated alias.

## 8H/10H per-slot toggle (2026-06-24)

- UI: `LeaderOrderResourceCard` header button, displayed immediately to the left of `+人`.
- State: `usePersistedLeaderBoardCapacityMode`, `localStorage` scoped by site + device, slotIndex order. Default is **8H** for every slot.
- Behavior: pressing the button toggles `8H` ↔ `10H`; `LeaderBoardGrid` passes the selected minutes to the card as `capacityMinutes`.
- API: none. Existing row `requiredMinutes` and Gantt layout do the scaling.
- Coexists with `+人`: `+人` changes `requiredMinutes`; `8H/10H` changes the ruler/capacity scale.

### Unchanged

- Row height: `visualMinHeightPx = max(workHeightPx, 96)`.
- API: none (`rowData.FSIGENSHOYORYO` → `requiredMinutes` already projected).
- Contrast bands (2026-06-14): even `bandIndex` → `bg-cyan-400/90`; odd → `bg-transparent`.

## Layout contract (variable capacity ruler + vertical bands)

- Scale per slot: `pxPerMinute = availableWorkHeightPx / max(totalRequiredMinutes, capacityMinutes)`.
- `capacityMinutes` from resolver (default **480**; min/max in `leaderBoardGanttConstants.ts`).
- `availableWorkHeightPx` from `useLeaderBoardGanttBodyHeight` (ResizeObserver); fallback `480px`.
- `workHeightPx = requiredMinutes * pxPerMinute`; `visualMinHeightPx = max(workHeightPx, 96)`.
- Remainder band when `totalRequiredMinutes` exceeds last complete capacity multiple.
- **Performance cap**: `GANTT_RULER_MAX_BAND_COUNT = 64`.
- Footer chips / row padding excluded from time axis; non-time tail absorbed into last band.

## Implementation summary

| Area | Module | Role |
|------|--------|------|
| Capacity | `leaderBoardGanttCapacity.ts` | slot-context resolve + normalize |
| Layout | `leaderBoardGanttLayout.ts` | boundaries, remainder bands, `computeGanttSlotLayout` |
| Constants | `leaderBoardGanttConstants.ts` | `GANTT_DEFAULT_CAPACITY_MINUTES`, min/max, ruler caps |
| Render | `LeaderBoardGanttTickGutter.tsx` | visible/transparent vertical bands |
| Grid | `LeaderBoardGrid.tsx` | per-slot `capacityMinutes` + `siteKey` / `deviceScopeKey` |
| Card | `LeaderOrderResourceCard.tsx` | passes `capacityMinutes` into layout |
| Persistence | `usePersistedLeaderBoardGanttMode.ts` | `localStorage` (default OFF) |
| Capacity persistence | `usePersistedLeaderBoardCapacityMode.ts` | per-slot 8H/10H `localStorage` |

## Validation

### Local (pre-push)

| Check | Result |
|-------|--------|
| `pnpm --filter @raspi-system/web test -- leaderBoardGantt` | **42 passed** |
| lint / tsc / build | **pass** |
| Docker web build + Trivy (post Caddy bump) | **pass** locally |

2026-06-24 local focused validation:

| Check | Result |
|-------|--------|
| `usePersistedLeaderBoardCapacityMode`, `leaderBoardGanttDisplay`, `leaderBoardGanttCapacity`, related `+人` tests | **69 passed** |
| Web lint / build | **pass** |

### CI

| Run ID | Commit | Result |
|--------|--------|--------|
| `27662630259` | `66fd10c6` | all jobs success |
| `27661913361` | `336d7baa` | `security-docker` failed (Caddy CVE; fixed in next commit) |

### Production deploy (Web only)

Standard: [deployment.md](../guides/deployment.md) · `update-all-clients.sh` · branch `fix/kiosk-leaderboard-capacity-bands`

| Phase | Host | Detach Run ID | HEAD | PLAY RECAP | Notes |
|-------|------|---------------|------|------------|-------|
| **Capacity bands** | `raspberrypi5` | **`20260617-121124-20540`** | **`66fd10c6`** | **`ok=134` `changed=4` `failed=0`** | `web` rebuild · bundle `index-uk3x2mcu.js` |
| **Capacity bands** | `raspberrypi4` | **`20260617-131010-10029`** | **`66fd10c6`** | **`ok=122` `changed=10` `failed=0`** | `kiosk-browser` restart |
| **Capacity bands** | `raspi4-robodrill01` | **`20260617-131443-27802`** | **`66fd10c6`** | **`ok=122` `changed=9` `failed=0`** | `kiosk-browser` restart |
| **Capacity bands** | `raspi4-fjv60-80` | **`20260617-131804-13754`** | **`66fd10c6`** | **`ok=122` `changed=9` `failed=0`** | `kiosk-browser` restart |
| **Capacity bands** | `raspi4-kensaku-stonebase01` | **`20260617-132125-5230`** | **`66fd10c6`** | **`ok=129` `changed=10` `failed=0`** | `kiosk-browser` restart |

**Pi3**: out of scope.

### Automated verification (2026-06-17)

| Check | Result |
|-------|--------|
| `verify-phase12-real.sh` (post Pi5) | **PASS 43 / WARN 0 / FAIL 0** |
| `verify-phase12-real.sh` (post Pi4×4) | **PASS 43 / WARN 0 / FAIL 0** |
| deploy-status (all Pi4) | pass |

### Manual verification (operator)

**Pi5 (2026-06-17)**: operator **OK** after deploy.

**All kiosks — remainder bands (open on Pi4×4)**:

1. Open leader order board; toggle **ガントON**.
2. Slot with workload **> 8H** (e.g. 10H): gutter shows **8H band + remainder band** (not one band stretched to bottom).
3. Exact multiples (e.g. 16H @ 8H capacity): **no extra remainder band**.
4. Stale bundle: [verification-checklist §6.6.4](../guides/verification-checklist.md).

## Knowledge (for next AI)

- **Pi4 does not rebuild web** — SPA from Pi5; Pi4 needs `kiosk-browser` restart or force reload.
- **Capacity is injectable per slot** — enable production map in `resolveLeaderBoardGanttCapacityMinutes` only; keep normalize bounds.
- **Test pitfall (Codex review)**: when asserting injected `capacityMinutes`, pick workload where **band counts differ** (e.g. 1080min → 3 bands @480 vs 2 @720), not workloads with equal band counts.
- **Default OFF** preserves prior Pi4 performance path.
- **Do not reuse** horizontal tick offset math for vertical segment ends.

## Open items

1. **Operator visual sign-off** for remainder-band display on **Pi4×4** (Pi5 done).
2. **8H/10H toggle deploy + real-device sign-off** — verify button placement, persistence, and ruler/bar change on kiosk.

## Local Notes JA

- トグル: **ガントOFF** / **ガントON**（左ペイン「表示」横 · `localStorage` 工場+端末スコープ）
- スロット別基準時間: **8H** / **10H**（資源カードヘッダー · `+人` の左 · `localStorage` 工場+端末スコープ）
- 縦バー: `cyan-400/90` と透明 交互（`bandIndex % 2`）
- 基準時間超過例: 600分 → 8H帯 + 2H帯（480分基準時）
