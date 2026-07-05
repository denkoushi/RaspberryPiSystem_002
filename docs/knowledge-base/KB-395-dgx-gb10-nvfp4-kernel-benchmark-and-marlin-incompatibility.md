---
title: "KB-395: DGX GB10 NVFP4 kernel benchmark and Marlin incompatibility for business 27B"
status: active
scope: DGX Spark blue backend (vLLM), business_qwen36_27b_nvfp4
date: 2026-07-05
source_of_truth: docs/knowledge-base/KB-395-dgx-gb10-nvfp4-kernel-benchmark-and-marlin-incompatibility.md
related_code:
  - scripts/dgx-local-llm-system/profile_launcher.py
  - scripts/dgx-local-llm-system/vllm_command_builder.py
related_docs:
  - ../decisions/ADR-20260705-dgx-spark-gb10-inference-performance-parameters.md
  - ../plans/dgx-spark-optimization-execplan-202607.md
---

# KB-395: DGX GB10 NVFP4 kernel benchmark and Marlin incompatibility for business 27B

## Context

After applying the GB10 performance parameters (ADR-20260705), a real-machine benchmark sweep was run on the blue backend (vLLM 0.19.2rc1 nightly, `vllm/vllm-openai:cu130-nightly`) with the dense `sakamakismile/Qwen3.6-27B-NVFP4` model (profile `business_qwen36_27b_nvfp4`) to find the fastest safe configuration.

## Investigation

Measurement: 3 decode runs (256 tokens, Japanese prompt, thinking off) + 1 TTFT run (~2,000-token prompt), on DGX localhost through the gateway.

| Config | Change | Decode median | TTFT | Result |
| --- | --- | --- | --- | --- |
| C1 | baseline (FlashInferCutlassNvFp4LinearKernel) | 12.41 tok/s | 3.64 s | OK, clean output |
| C2 | `nvfp4GemmBackend: marlin` | — | — | vLLM crashes at weight load |
| C3 | + `attentionBackend: TRITON_ATTN` | 12.29 tok/s | 3.73 s | OK but slower than C1 |

## Root Cause (Marlin crash)

`MarlinNvFp4LinearKernel` requires layer output dims divisible by tile 64. This model has a layer with `size_n = 96`:

```
RuntimeError: size_n = 96 is not divisible by tile_n_size = 64
(gptq_marlin_repack / prepare_fp4_layer_for_marlin)
```

The community guidance "force Marlin for NVFP4 on SM121" does not apply to this checkpoint. FlashInferCutlass output was verified clean (no garbage/repetition) on this nightly image.

## Additional finding: env propagation requires control-server restart

`control-server.py` is a long-running process that imports `profile_launcher.py` at startup. Deploying a new `profile_launcher.py` has NO effect until the control-server is restarted (`kill $(cat /srv/dgx/system-prod/logs/control-server.pid)` then `bash /srv/dgx/system-prod/bin/start-control-server.sh`). The inference container keeps running during the restart.

## Fix / Decision

- Keep C1 (no `nvfp4GemmBackend`, no `attentionBackend` override) for `business_qwen36_27b_nvfp4`. Do NOT set `nvfp4GemmBackend: marlin` on this profile.
- `profile_launcher.py` now maps `nvfp4GemmBackend` for future models where Marlin is compatible.

## Performance ceiling note

Decode ~12.4 tok/s is memory-bandwidth-bound for a dense 27B on GB10 (~273 GB/s LPDDR5X). Kernel-level tuning cannot exceed roughly 15–19 tok/s for this model. The dominant lever is a MoE model with a small active parameter set: `Qwen3.5-35B-A3B` GGUF (green backend) measured ~62 tok/s (2026-04-25, llama.cpp). A business-model switch is a product decision (context size, vision, tool-call support differ per backend) tracked in the ExecPlan open items.

## Validation

- After rollback, `/v1/models` 200, clean Japanese responses, memory available 39 GB.
- Repo pytest 55 passed with the new `nvfp4GemmBackend` mapping test.

## Open Items

- Business-model MoE switch decision (speed vs context/vision/tooling tradeoffs).

## References

- ADR-20260705 · ExecPlan `dgx-spark-optimization-execplan-202607.md`
- NVIDIA Developer Forums (DGX Spark/GB10 NVFP4 Marlin), vLLM issue reports on SM121
