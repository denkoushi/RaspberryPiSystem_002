---
title: KB-389 DGX resource runtimeProfile and shared resourceState
tags: [DGX, DGX_RESOURCE, Spark, runtimeProfile, resourceState, vLLM]
audience: [開発者, 運用者]
last-verified: 2026-06-15
last-updated: 2026-06-15-preflight-metrics-deploy
category: knowledge-base
status: active
scope: DGX Spark system-prod LocalLLM, Pi5 `/admin/tools/dgx-resource`, profile-scoped memory budget
date: 2026-06-07
source_of_truth: this document
related_code:
  - scripts/dgx-local-llm-system/resource_state.py
  - scripts/dgx-local-llm-system/control-server.py
  - scripts/dgx-local-llm-system/gateway-server.py
  - scripts/dgx-local-llm-system/profile_launcher.py
  - apps/api/src/services/system/dgx-resource/
  - apps/web/src/features/admin/dgx-resource/
related_docs:
  - ../runbooks/dgx-system-prod-local-llm.md
  - ./KB-365-dgx-resource-phase3-workload-orchestration.md
  - ./KB-366-dgx-spark-operational-understanding.md
---

# KB-389: DGX resource runtimeProfile and shared resourceState

## Context

Branch `feat/dgx-resource-runtime-profile` adds **per-model `runtimeProfile`** (vLLM / llama.cpp budgets) and **DGX shared `resourceState`** (logical owner: business / private / experiment). Cursor deployed to DGX Spark and Pi5; real-machine validation completed on 2026-06-07.

Contract details (paths, API fields, env): [Runbook §DGX model profiles](../runbooks/dgx-system-prod-local-llm.md#管理コンソール-dgx-リソースpi5-api-経由) — do not duplicate here.

## Progress

| Item | Status |
|------|--------|
| DGX `runtimeProfile` in manifests + `launcher_env_for_profile()` | Done (`45c0c5ee`) |
| DGX `resource_state.py` + `DGX_RESOURCE_STATE_PATH` | Done |
| `control-server.py` writes owner on `/start` `/stop` `/stop-force` | Done |
| `gateway-server.py` exposes `GET /system/resource-state`, `resourceState` in `GET /system/model-profiles` | Done |
| Pi5 API: `runtimeProfile`, `resourceState`, `runtimeSummary` owner fields | Done |
| Admin UI: `DGX 所有`, runtime budget, quick profile under 詳細・保守 | Done |
| DGX deploy (SHA match with repo) | Done (2026-06-07) |
| Pi5 deploy (api + web) | Done (2026-06-07) |
| Async business-return UX (`in_progress` + overview polling) | Done (`b321f82f`, `6f0d5b20`) |
| Modern dashboard UI (view model + status header + tabbed details) | Done (`95b4b0e4`) · Pi5 production verified |
| Admin preflight metrics (temperature / power / clocks / model / vLLM) | Done · Pi5 + DGX production verified (2026-06-15) |

**Git**:

- Runtime profile/resource state base: branch `feat/dgx-resource-runtime-profile` · commit **`45c0c5ee`** (`feat(dgx): add runtime profiles and shared resource state`)
- Business-return async UX: branch `fix/dgx-business-return-async-ux` · commits **`b321f82f`** (`fix(dgx): return in_progress for async business return UX`), **`6f0d5b20`** (`fix(web): satisfy production build type for businessReturnReady`)
- Modern dashboard UI: branch `fix/dgx-resource-modern-ui` · commit **`95b4b0e4`** (`Modernize DGX resource dashboard UI`)
- Admin preflight metrics: branch `feat/dgx-resource-preflight-metrics` · commit **`efcca1e2`** (`feat: add DGX resource preflight metrics`)

## Specification (summary)

### runtimeProfile (per-model budget)

- **`business_qwen36_27b_nvfp4`** (blue / vLLM): `gpuMemoryUtilization: 0.65`, `maxModelLen: 8192`, `maxNumSeqs: 4`, `maxNumBatchedTokens: 16384`, `kvCacheDtype: fp8`, `languageModelOnly: true`. Budget is **profile-scoped**, not a global DGX default.
- **GGUF / green profiles**: use `llamaCpp.ctxSize` / `parallel` / `nGpuLayers`; they do **not** inherit vLLM `gpuMemoryUtilization`.

### resourceState (shared owner)

- Path: `/srv/dgx/system-prod/state/dgx-resource-state.json`
- `owner`: `business` | `private` | `experiment` | `unknown`
- `status`: `preparing` | `released` (see Open Items — `ready` not written yet)
- Pi5 admin shows **`DGX 所有`** via `overview.runtimeSummary.resourceOwnerLabelJa`
- Strict Ready / business readiness still uses Pi5 orchestration + `/v1/models`; resourceState is **display and cross-workload lease hint**, not a KPI.

### Async business-return UX (Pi5 only · 2026-06-07)

- Scenarios: **`private_to_business`** / **`experiment_to_business`** only.
- After workload steps and DGX `POST /start` with `modelProfileId`, API sets **`deferReadiness: true`** and returns **`scenarioExecute.outcomeKind: in_progress`** instead of blocking on Strict Ready.
- UI pending clears when **`runtimeSummary.businessReady === true`** and **`runtimeSummary.resourceOwner === 'business'`** (overview polling + `sessionStorage` restore on remount).
- Other scenarios (e.g. `business_to_private`) keep synchronous Strict Ready.
- DGX code unchanged for this UX fix.

### Modern dashboard UI (Pi5 Web only · 2026-06-07)

- **Scope**: Web presentation only. API / DGX contracts unchanged.
- **View model**: `buildDgxResourceDashboardViewModel()` in `dgxResourceDashboardViewModel.ts` maps `overview` → header pills, 4-tile status row, detail rows. UI components consume the view model; they do not re-derive owner/ready/memory labels inline.
- **Status header** (`DgxResourceStatusHeader`): title **DGX リソース**; service pills **VLM / ComfyUI / 実験**; 4 tiles — **DGX** (owner), **業務推論** (ready/loading/degraded), **モデル**, **メモリ** (unified mem).
- **Pending banner**: business-return shows **業務復帰中 / DGX 側でモデルをロードしています**; other scenarios show Strict Ready elapsed hint from events.
- **Primary flow** (`DgxResourcePrimaryScenarioFlow`): compact scenario cards; business-return profile picker label **ロードモデル**; async UX messages unchanged (§ Async business-return UX).
- **Detail tabs** (below primary flow): **状態** (backend, policy, resource state, GPU, free memory) · **保守** (quick profile start, policy, targets, warm notice) · **ログ** (events timeline, monitoring when applicable).
- **Removed from main viewport**: legacy KPI strip / separate runtime summary strip as primary layout; consolidated into header + tabs.

### Admin UI layout (pre-modern · retained contracts)

- Main flow: 4 orchestration scenarios (unchanged API contract).
- **モデルプロファイル起動** (quick `START_MODEL_PROFILE`) under **保守** tab.
- Runtime budget shown when selecting business-return profile (e.g. `vLLM memory budget 65%`).

### Admin preflight metrics (2026-06-15)

- DGX gateway `/system/metrics` returns optional detail fields from `nvidia-smi`: `gpuTemperatureC`, `gpuPowerDrawW`, `gpuPowerLimitW`, `gpuClockSmMhz`, `gpuClockGraphicsMhz`, `gpuClockMemoryMhz`, `gpuPstate`, `gpuClocksThrottleReason`, `gpuName`, `driverVersion`.
- Pi5 API passes these through `overview.kpis` (`dgx-resource.probes.ts` accepts camelCase and legacy snake_case keys).
- Web main viewport (below status header): **`DgxResourceStatusBoard`** (KPI strip + runtime summary) and **`DgxResourcePreflightPanel`** (6 tiles: 温度 / 電力 / クロック / 統合メモリ / active model / vLLM疎通). Low-load low-clock is treated as OK; high-load low-clock warns.
- Compatibility: extended `nvidia-smi --query-gpu` failure falls back to legacy `utilization.gpu,memory.used,memory.total` so GPU/memory KPI still works.

## Validation

### Local (pre-deploy)

| Check | Result |
|-------|--------|
| DGX Python tests | 45 passed |
| API focused tests (`dgx-resource*`) | 52 passed |
| Web focused tests (`dgx-resource*`) | 9 passed |
| Web `tsc --noEmit` | passed |
| Python compile | passed |
| `git diff --check` | passed |

Note: full API `tsc --noEmit` still fails on pre-existing `rootDir` scope (`prisma/seed.ts`, `apps/api/scripts/*`, `vitest.config.ts`) — unrelated to this change.

### Deploy verification

**DGX** (`ubudgxkoushi@100.118.82.72`):

- `control-server.py`, `gateway-server.py` running
- Deployed files SHA-256 match repo: `resource_state.py`, `control-server.py`, `gateway-server.py`, `model_profiles.py`, `profile_launcher.py`, three manifests
- `DGX_RESOURCE_STATE_PATH=/srv/dgx/system-prod/state/dgx-resource-state.json` (writable)
- `GET /system/model-profiles` returns `runtimeProfile`
- `GET /v1/models` → 200 when business vLLM ready

**Pi5** (`denkon5sd02@100.106.158.2`):

- `docker-api-1` healthy, `docker-web-1` running
- Web bundle includes: `DGX 所有`, `保守: モデルプロファイル起動`, `Strict Ready`, `vLLM memory budget`
- `GET /api/system/dgx-resource/overview` returns `runtimeProfile` and `resourceState` fields

### Real-machine scenarios (2026-06-07)

| Phase | Observed |
|-------|----------|
| Business (post-deploy, before first action) | `DGX 所有: 不明`, `BUSINESS READY: Ready`, Unified Mem **78.6 / 121.6 GiB**, vLLM cmd includes `--gpu-memory-utilization 0.65` |
| Private switch | `DGX 所有: Private`, Unified Mem **4.2 / 121.6 GiB**, `BUSINESS READY: Not Ready`, ComfyUI running |
| Business return | UI showed **timeout** while DGX continued; `resourceState` → `business / preparing`; `/v1/models` → 200 ~13:36 JST; final: `resourceOwner: business`, `businessReady: true`, ComfyUI stopped, Unified Mem **74.3 / 121.6 GiB** |

Phase12 `verify-phase12-real.sh` was not re-run in this session; prior Pi5 deploy pattern expects **43/0/0** when run after ansible update.

### Admin preflight metrics (Pi5 + DGX · 2026-06-15)

| Target | Deploy | Validation |
|--------|--------|------------|
| Pi5 (`raspberrypi5`) | `./scripts/update-all-clients.sh feat/dgx-resource-preflight-metrics … --limit raspberrypi5 --detach --follow` · Detach **`20260615-121701-25267`** · `PLAY RECAP` **`ok=134` `changed=4` `failed=0`** | Git **`efcca1e2`** · `docker-api-1` healthy · `docker-web-1` up · API dist contains `gpuTemperatureC` · `./scripts/deploy/verify-phase12-real.sh` → **43/0/0** (~55s) |
| DGX Spark | `scp gateway-server.py` → `/srv/dgx/system-prod/bin/` · PID-guard restart (`gateway-server.pid` kill → `start-gateway-server.sh`) · **`pid=236743`** | SHA-256 **`f2e5b09e…`** matches repo · `healthz` **200** · `GET /system/metrics` sample: `gpuTemperatureC=42`, `gpuPowerDrawW=10.3`, `gpuName=NVIDIA GB10`, `driverVersion=580.159.03` |

**Deploy note (DGX)**: `start-gateway-server.sh` alone does not reload code when an old PID is alive; always **kill PID from `gateway-server.pid` → remove file → start script** (same pattern as [Runbook](../runbooks/dgx-system-prod-local-llm.md)).

**CI (pre-merge)**: GitHub Actions run **`27521487515`** — `lint-build-unit`, `e2e-smoke`, `api-db-and-infra` success (full workflow green before merge).

## Findings

### 1. Profile `0.65` memory budget is active

Unified memory no longer behaves like the old ~80% allocation.

| Phase | Unified Mem (observed) |
|-------|------------------------|
| Business ready (after return) | ~74.3 GiB / 121.6 GiB |
| Business warmup | up to ~83 GiB / 121.6 GiB |
| Private (after `stop-force`) | ~4.2 GiB / 121.6 GiB |

Do not infer "model not loaded" from low memory on **35B green** alone; on **27B blue**, 70–80 GiB range is normal when ready.

### 2. resourceState owner tracking works

After first real orchestration action, `DGX 所有` moved **不明 → Private → 業務**, matching DGX writes on `/start` / `/stop-force`.

### 3. Business-return UI timeout (pre-async UX · resolved)

Before **`b321f82f`**, vLLM cold start could exceed the synchronous `EXECUTE_ORCHESTRATION_SCENARIO` HTTP window while DGX kept progressing. **Mitigation shipped**: `in_progress` + overview polling (§4). Residual operator notes:

- Do not spam the action button while pending banner is shown.
- Temporary `502` on `/v1/models` during cold start is expected until Ready.

### 4. Async business-return UX is deployed

The previous synchronous wait was replaced for long business-return scenarios:

- `private_to_business` / `experiment_to_business` return `scenarioExecute.outcomeKind: in_progress` after the DGX model-load request is accepted.
- The UI shows:

```text
復帰処理を開始しました。DGX 側でモデルをロード中です。
Ready まで数分かかることがあります。画面を閉じても処理は継続します。
```

- The UI persists pending state in `sessionStorage` and clears it when overview reports `runtimeSummary.businessReady === true` and `runtimeSummary.resourceOwner === business`.
- If a browser/API timeout still happens after the execute request was dispatched, the UI treats it as a continuing business-return attempt instead of showing a terminal failure.

Deploy summary:

| Target | Result |
|--------|--------|
| Pi5 API/Web deploy | Success on detach run **`20260607-143332-28257`** (`PLAY RECAP failed=0`) |
| First deploy attempt | Failed on web production build type mismatch; fixed by **`6f0d5b20`** |
| Pi5 production Git ref | **`6f0d5b20`** |
| DGX deploy/actions | Not performed for this UX-only change |
| Pi5 containers | `docker-api-1` healthy, `docker-web-1` up |
| Web bundle | Contains `DGX 側でモデルをロード中` |
| Phase12 after async UX deploy | **43/0/0** (~57s) |

**Authenticated overview snapshot** (Pi5 read-only GET after deploy; no DGX actions):

| Field | Value |
|-------|-------|
| `runtimeSummary.businessReady` | `true` |
| `runtimeSummary.resourceOwner` | `business` |
| `runtimeSummary.resourceStateStatus` | `preparing` |
| `modelProfiles.activeProfileId` | `business_qwen36_27b_nvfp4` |
| `modelProfiles.activeStateBackend` | `blue` |
| `modelProfiles.status` | `ok` |
| `resourceState.owner` / `backend` | `business` / `blue` |
| `resourceState.status` | `preparing` (see Open Items) |

Validation for this async UX branch:

| Check | Result |
|-------|--------|
| API focused tests (`dgx-resource.service`, business profile propagation) | 30 passed |
| Web focused tests (`DgxResourcePrimaryScenarioFlow`, `DgxResourceDashboard`) | 4 passed |
| API `tsc -p tsconfig.build.json --noEmit` | passed |
| Web `tsc -b` | passed |
| `git diff --check` | passed |

### Modern dashboard UI (Pi5 Web · 2026-06-07)

| Check | Result |
|-------|--------|
| Web `lint` | passed |
| Web `tsc -b` | passed |
| Web focused tests (`src/features/admin/dgx-resource`) | 24 passed (10 files) |
| Web production `build` | passed (no type fix required) |
| `git diff --check` | passed |
| Pi5 deploy | Success on detach run **`20260607-153453-15574`** (`PLAY RECAP failed=0`) |
| Pi5 production Git ref | **`95b4b0e4`** |
| DGX deploy/actions | Not performed |
| Pi5 containers | `docker-api-1` healthy, `docker-web-1` up |
| Web bundle | Contains `DGX リソース`, `業務推論`, `ロードモデル`, `DGX 側でモデルをロードしています` |
| Real-machine UI validation | **OK** (operator confirmed 2026-06-07) |

**Authenticated overview snapshot** (Pi5 read-only GET after modern UI deploy; no DGX actions):

| Field | Value |
|-------|-------|
| `runtimeSummary.businessReady` | `true` |
| `runtimeSummary.resourceOwner` | `business` |
| `runtimeSummary.resourceStateStatus` | `preparing` |
| `modelProfiles.activeProfileId` | `business_qwen36_27b_nvfp4` |
| `modelProfiles.status` | `ok` |

**Deploy note**: Pi5 ansible fetches `origin/<branch>`. First deploy attempt failed because `fix/dgx-resource-modern-ui` was not on `origin` yet; `git push -u origin fix/dgx-resource-modern-ui` then redeploy succeeded. No code change.

## Current expected state (after successful business return)

- `DGX 所有: 業務`
- `BUSINESS READY: Ready`
- Active model: **業務 Qwen3.6 27B NVFP4**
- `VLM 推論: running`, `ComfyUI: stopped`
- Unified Mem ~74–83 GiB / 121.6 GiB

## Open Items

1. **`resourceState.status`** — Promote from `preparing` to `ready` when Pi5 Strict Ready succeeds (today: authenticated overview still shows `business / preparing / post_only` even while `businessReady: true`).
2. **Cold-start duration doc** — Record typical `business_qwen36_27b_nvfp4` ready time on Spark (observed: several minutes; UI timeout occurred before ~13:36 JST completion; DGX Spark/vLLM forum examples show ~7.5-11 minutes can be plausible before optimization).
3. **Optional UI** — Show vLLM startup phase if safe probes/logs become available.

## References

- [KB-365](./KB-365-dgx-resource-phase3-workload-orchestration.md) — orchestration, Strict Ready, policy modes
- [KB-366](./KB-366-dgx-spark-operational-understanding.md) — KPI interpretation, 27B/35B, mode switch FAQ
- [Runbook dgx-system-prod-local-llm.md](../runbooks/dgx-system-prod-local-llm.md) — API contracts, deploy paths
