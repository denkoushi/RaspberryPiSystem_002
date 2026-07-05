---
title: DGX Spark Optimization ExecPlan
id: dgx-spark-optimization-execplan-202607
status: done_repo_side
scope: DGX Spark inference performance, mode switching, model decoupling, admin UI
date: 2026-07-05
source_of_truth: docs/plans/dgx-spark-optimization-execplan-202607.md
related_code:
  - scripts/dgx-local-llm-system/
  - apps/api/src/services/inference/
  - apps/api/src/services/system/dgx-resource/
  - apps/web/src/features/admin/dgx-resource/
related_docs:
  - docs/runbooks/dgx-system-prod-local-llm.md
  - docs/knowledge-base/KB-366-dgx-spark-operational-understanding.md
  - docs/decisions/ADR-20260428-dgx-active-backend-prod-default.md
validation: unit tests (vitest, pytest); DGX real-machine apply deferred
open_items:
  - Post-apply observation: spot-check photo_label / document_summary logs over normal operation
  - Optional: throughput baseline comparison (fp8 KV vs f16) if regression is suspected
supersedes: null
superseded_by: null
---

# DGX Spark Optimization ExecPlan

## Purpose

Optimize DGX Spark as the AI inference engine across four areas:

1. GB10/SM121 performance parameters (vLLM command builder, model manifests)
2. Model and feature decoupling (InferenceRouter, prompt registry)
3. Mode switching logic cleanup (API overview as single metadata source)
4. Admin UI incremental improvement (operator console as primary flow)

**Scope for this work**: repository changes and local validation only. DGX real-machine apply is deferred until explicit user instruction.

## Progress

- (2026-07-05) ExecPlan created. Baseline green: DGX pytest 54 passed, apps/api inference/dgx-resource vitest 177 passed.
- (2026-07-05) Phase 1 done: `vllm_command_builder.py` adds `VLLM_MARLIN_USE_ATOMIC_ADD=1` default export, `VLLM_NVFP4_GEMM_BACKEND` passthrough, `--moe-backend` / `--attention-backend` flags. `profile_launcher.py` maps `moeBackend` / `attentionBackend` / `enableChunkedPrefill` / `enablePrefixCaching`. NVFP4 manifests: kvCacheDtype removed (f16), chunked prefill off, marlin explicit, maxModelLen 16384. pytest 55 passed. Runbook gained "DGX 実機適用とロールバック" section.
- (2026-07-05) Phase 2 done (Composer subagent): prompt registry `services/inference/prompts/`, chat use cases (`admin_console_chat` / `stackchan_chat`) registered in InferenceRouter (admin provider semantics preserved), `BusinessProfileIntentStore` optional file persistence via `INFERENCE_BUSINESS_PROFILE_INTENT_FILE_PATH`. 285 tests passed, tsc build check passed.
- (2026-07-05) Phase 3 done (Composer subagent): API overview gained additive `overview.uiMetadata` (4 scenarios + 3 policy modes, Japanese text copied verbatim from Web metadata files). Web resolver `dgxResourceUiMetadataResolve.ts` prefers API metadata with local fallback. scenario-planner / policy-arbitrator left unchanged (already readable; no churn). API 98 + Web 34 tests passed.
- (2026-07-05) Phase 4 done (Composer subagent): new `DgxResourceStatusSummary` at top of dashboard (mode / Active Model / Pi5 intent with mismatch warning / next-action hint), operator console directly below, maintenance panels grouped in collapsed `<details>` "詳細・保守・ログ". Policy panel caution for the applyWorkloadChanges=false trap. `cautionsJa` wired to scenario UI. Web dgx-resource 40 tests passed.
- (2026-07-05) Phase 5 done: ADR-20260705 created, docs/INDEX.md links added, runbook apply/rollback section (Phase 1). Final verification: Web full suite 1253 passed (252 files), API changed-scope vitest green, API tsc + eslint green (1 duplicate-import warning fixed), DGX pytest 55 passed. No temporary Docker resources were created (pre-existing `postgres-test-local` untouched).
- (2026-07-05 PM) Committed on branch `feat/dgx-spark-optimization` (3 commits: dgx perf params / inference decoupling / dgx-resource UI+metadata). Pre-commit lint fixed 2 import-order errors in new Web files.
- (2026-07-05 PM) DGX real-machine apply done (Mac → `ubudgxkoushi@100.118.82.72`): `vllm_command_builder.py` / `profile_launcher.py` / Ornith manifest were already applied (backup dir `bin/backup-20260705-130209-gb10-perf`); 27B manifest applied after backing up to the same dir. Blue backend restarted via gateway `/stop-force` → `/start` (`modelProfileId=business_qwen36_27b_nvfp4`). Launch command verified: `VLLM_MARLIN_USE_ATOMIC_ADD=1` / `--moe-backend marlin` / no `--kv-cache-dtype` / no `--enable-chunked-prefill` / `--enable-prefix-caching` / `--max-model-len 16384` all OK. Cold start ~310s (< 900s Pi5 timeout). `/v1/models` 200 (`max_model_len: 16384`). Japanese chat output clean (no repetition), decode ~12.3 tok/s (256 tok / ~20.7s, single request; no fp8-KV baseline measured before the change). Pi5 → DGX `/healthz` 200, Pi5 `/healthz` 200.
- (2026-07-05 PM) Finding: the deployed 27B (`Qwen3_5ForConditionalGeneration`, `sakamakismile/Qwen3.6-27B-NVFP4`) is a dense model (`num_experts: None`), so `--moe-backend marlin` and the chunked-prefill SSM+MoE concern do not apply to it; both settings are harmless and remain correct for future MoE profiles. `VLLM_MARLIN_USE_ATOMIC_ADD=1` and f16 KV remain directly relevant (NVFP4 weights use Marlin GEMM on SM121).

## Phases

| Phase | Scope | Status |
| --- | --- | --- |
| 0 | Baseline tests + this document | done |
| 1 | vLLM command builder, manifests, profile launcher | done |
| 2 | Prompt registry, chat router integration, profile intent persistence | done |
| 3 | Web metadata consolidation, scenario/policy refactor | done |
| 4 | Admin UI primary flow and summary panel | done |
| 5 | ADR, runbook update, full test pass | done |

## Decision Log

| Date | Decision | Rationale |
| --- | --- | --- |
| 2026-07-05 | `kvCacheDtype` removed from NVFP4 manifests (f16 default) | GB10 reports output repetition with fp8 KV; unified memory favors f16 |
| 2026-07-05 | `enableChunkedPrefill: false` for NVFP4 MoE profiles | SSM+MoE hybrid throughput regression on GB10 |
| 2026-07-05 | `moeBackend: marlin` explicit | SM121 has no native FP4; Marlin W4A16 required |
| 2026-07-05 | `maxModelLen` 8192 → 16384 for business NVFP4 | Prefix caching benefit; 128GB unified memory allows conservative increase |

## Outcomes & Retrospective

- All repo-side changes are backward compatible: with no new env vars set and no DGX-side apply, production behavior is unchanged.
- New env vars (all optional): `INFERENCE_DOCUMENT_SUMMARY_SYSTEM_PROMPT`, `INFERENCE_STACKCHAN_SYSTEM_PROMPT`, `INFERENCE_BUSINESS_PROFILE_INTENT_FILE_PATH`. New manifest fields: `moeBackend`, `attentionBackend`, `enableChunkedPrefill`, `enablePrefixCaching`.
- Deliberately NOT done: DGX real-machine apply/benchmark (open item), deletion of Web fallback metadata files (kept for rolling-deploy compatibility), scenario-planner/policy-arbitrator rewrite (judged unnecessary).
- Follow-up candidates: unify the 3 duplicated DGX gateway client implementations (Pi5 TS / stackchan-bridge Python / hermes), raise `maxModelLen` beyond 16384 after real-machine benchmark, wire `INFERENCE_BUSINESS_PROFILE_INTENT_FILE_PATH` into Ansible docker.env template when enabling persistence in production.

## Validation Summary

| Target | Result |
| --- | --- |
| DGX pytest (`scripts/dgx-local-llm-system/tests`) | 55 passed |
| API vitest (inference / system / dgx-resource / kiosk-documents / photo-tool-label / routes/system) | all green (285 + 98 + 87 targeted runs) |
| Web vitest (full suite) | 1253 passed / 252 files |
| API typecheck (`tsc -p tsconfig.build.json --noEmit`) | pass |
| API eslint (changed scope) | pass (0 errors) |
| DGX real machine | NOT executed (out of scope) |

## Local Notes JA

- 既存未コミット WIP（kiosk/rigging/tools SOLID refactor phase6）には触れない。
- DGX 実機適用は runbook 節「DGX 実機適用とロールバック」に手順を記載し、別途指示待ち。
