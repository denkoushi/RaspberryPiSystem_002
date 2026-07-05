---
title: "ADR-20260705: DGX Spark GB10 inference performance parameters"
status: accepted
date: 2026-07-05
scope: scripts/dgx-local-llm-system (vLLM blue backend), model-registry manifests
related_docs:
  - ../plans/dgx-spark-optimization-execplan-202607.md
  - ../runbooks/dgx-system-prod-local-llm.md
  - ./ADR-20260428-dgx-active-backend-prod-default.md
related_code:
  - ../../scripts/dgx-local-llm-system/vllm_command_builder.py
  - ../../scripts/dgx-local-llm-system/profile_launcher.py
  - ../../scripts/dgx-local-llm-system/model-registry.examples/
---

# ADR-20260705: DGX Spark GB10 inference performance parameters

## Status

accepted (repo-side change done; DGX real-machine apply pending user instruction)

## Context

DGX Spark (GB10, SM121, 128GB unified LPDDR5X memory) serves business inference via the vLLM blue backend with NVFP4 MoE models (Qwen3.6-27B, Ornith-1.0-35B). The existing configuration predated community/forum findings specific to GB10/SM121:

1. SM121 has no native FP4 compute. NVFP4 MoE layers must use the Marlin W4A16 kernel; auto-fallback can silently produce degraded or garbage output.
2. The Marlin kernel on SM121 has a race condition unless `VLLM_MARLIN_USE_ATOMIC_ADD=1` is set.
3. `--enable-chunked-prefill` causes a large (reported ~9x) throughput regression on SSM+MoE hybrid architectures (Qwen3.5/3.6 family) on GB10.
4. `--kv-cache-dtype fp8` on GB10 is reported to cause output repetition loops, and independent KV-cache benchmarks on GB10 recommend f16 because the unified 128GB pool makes memory capacity rarely the bottleneck while dequantization compute dominates on LPDDR5X bandwidth.
5. `maxModelLen 8192` limited prefix-caching benefit and long-document summarization headroom.

Sources: NVIDIA Developer Forums (DGX Spark / GB10), NVIDIA dgx-spark-playbooks (vLLM), community GB10 deployment playbooks and KV-cache benchmarks (2026).

## Decision

Repo-side canonical configuration (`scripts/dgx-local-llm-system/`):

- `vllm_command_builder.py` exports `VLLM_MARLIN_USE_ATOMIC_ADD=1` by default and passes through `VLLM_NVFP4_GEMM_BACKEND`; new CLI passthroughs `--moe-backend` (`VLLM_MOE_BACKEND`) and `--attention-backend` (`VLLM_ATTENTION_BACKEND`).
- `profile_launcher.py` maps new manifest fields `moeBackend`, `attentionBackend`, `enableChunkedPrefill`, `enablePrefixCaching` to the corresponding env vars.
- NVFP4 business manifests (`business_qwen36_27b_nvfp4`, `business_ornith_35b_nvfp4`):
  - `moeBackend: "marlin"` (explicit)
  - `kvCacheDtype` removed (f16 default)
  - `enableChunkedPrefill: false`
  - `enablePrefixCaching: true`
  - `maxModelLen: 8192 -> 16384`

All changes are backward compatible: unset fields/env vars preserve current behavior. The GGUF green profile (`business_qwen35_35b_gguf`) is unchanged.

## Alternatives

- Keep fp8 KV cache for memory headroom: rejected; repetition-loop risk and GB10 benchmark data favor f16, and 16384 context with f16 KV fits comfortably at `gpuMemoryUtilization 0.65`.
- Force a global `--attention-backend`: rejected; hybrid models crash when one backend is forced globally on SM121. Passthrough added but left unset (vLLM auto-selects per layer).
- Larger `maxModelLen` (65536+): deferred until real-machine benchmark; 16384 is a conservative first step.

## Consequences

- Correctness guardrails (Marlin atomic add, explicit marlin MoE) prevent silent output corruption on SM121.
- Expected throughput improvement on Qwen3.6 NVFP4 from disabling chunked prefill; TTFT improvement from prefix caching with a larger context window.
- KV cache memory grows (f16, 16384 ctx); mitigated by low `gpuMemoryUtilization` (0.65) and `maxNumSeqs 4`. If OOM/Xid 43 occurs on real machine, roll back `maxModelLen` to 8192 first.
- No effect until applied on the DGX host (see runbook section "DGX 実機適用とロールバック").

## Validation

- pytest `scripts/dgx-local-llm-system/tests/` 55 passed (command assembly and launcher env mapping fixed by tests).
- Real-machine validation checklist in runbook: `/v1/models` ready, admin chat, representative photo_label / document_summary, log inspection for `--moe-backend marlin` and absence of `--enable-chunked-prefill`.

## Supersedes / Superseded By

- Supersedes: none (parameter-level refinement of ADR-20260428 backend defaults)
- Superseded By: none
