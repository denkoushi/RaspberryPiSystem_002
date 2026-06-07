---
title: KB-389 DGX resource runtimeProfile and shared resourceState
tags: [DGX, DGX_RESOURCE, Spark, runtimeProfile, resourceState, vLLM]
audience: [開発者, 運用者]
last-verified: 2026-06-07
last-updated: 2026-06-07-async-ux-deploy
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

**Git**:

- Runtime profile/resource state base: branch `feat/dgx-resource-runtime-profile` · commit **`45c0c5ee`** (`feat(dgx): add runtime profiles and shared resource state`)
- Business-return async UX: branch `fix/dgx-business-return-async-ux` · commits **`b321f82f`** (`fix(dgx): return in_progress for async business return UX`), **`6f0d5b20`** (`fix(web): satisfy production build type for businessReturnReady`)

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

### Admin UI layout (2026-06-07)

- Main flow: KPI strip + 4 orchestration scenarios (unchanged contract).
- **モデルプロファイル起動** (quick `START_MODEL_PROFILE`) moved to **詳細・保守（通常は不要）**.
- Runtime budget shown when selecting business-return profile (e.g. `vLLM memory budget 65%`).

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
