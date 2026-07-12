---
id: dgx-comfyui-single-image-edit-workflow
status: active
scope: DGX Spark ComfyUI Phase 1 single-image editing; the optional two-image candidate remains non-canonical
date: 2026-07-11
source_of_truth: docs/plans/dgx-comfyui-single-image-edit-workflow.md
related_code:
  - scripts/dgx-private-comfyui/workflows/phase1_qwen_edit_2511_dgx_flat.json
  - scripts/dgx-private-comfyui/workflows/phase1_qwen_edit_2511_pose_identity_ref.json
related_docs:
  - docs/knowledge-base/KB-379-dgx-private-comfyui-nvfp4-migration-and-workflow-tuning.md
  - scripts/dgx-private-comfyui/workflows/README.md
validation:
  - fixed-seed Phase 1 four-step and eight-step live comparisons recorded on 2026-07-11
  - JSON syntax and workflow-node comparison repeated locally on 2026-07-12
open_items:
  - execute and visually evaluate the non-canonical two-image candidate only after the DGX ComfyUI endpoint is available
---

# Complete the DGX ComfyUI single-image prompt editing workflow

This ExecPlan is a living document. It must be maintained in accordance with `.agent/PLANS.md`. The required `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` sections are updated as work proceeds.

## Purpose / Big Picture

The operator will be able to load one safe source image in ComfyUI, describe a change in ordinary language, and receive a natural edited image that follows the instruction while retaining the subject's identity and all regions that were not requested to change. The main path will not use a face mask, face replacement, or a second identity image. Completion is demonstrated by fixed-seed output comparisons from the running DGX Spark ComfyUI instance.

## Progress

- [x] (2026-07-11 16:10 JST) Inspected the running ComfyUI API, installed models, core nodes, existing Phase 1 workflow, and prior failure record.
- [x] (2026-07-11 16:21 JST) Established a safe fixed-seed four-step Lightning baseline; output succeeded in about 371 seconds.
- [x] (2026-07-11 16:30 JST) Built and ran a non-Lightning eight-step quality candidate without face masking or head replacement; output succeeded in about 376 seconds.
- [x] (2026-07-11 16:31 JST) Compared prompt following, identity retention, preservation of unrequested regions, artifacts, and runtime; eight-step output followed the smile edit more clearly with retained identity and scene.
- [x] (2026-07-11 16:34 JST) Promoted the eight-step graph to the single Phase 1 canonical workflow; retained the Lightning node in bypass mode for reversible preview testing.
- [x] (2026-07-11 16:35 JST) Updated the canonical KB and workflow README with measured evidence and the runtime-environment caveat.
- [ ] (2026-07-11 16:45 JST) Additive two-image identity-reference candidate created after pose-edit testing showed face drift; it has not yet been executed because the DGX service restarted during the next test.
- [ ] (2026-07-12 18:50 JST) The local ComfyUI tunnel refused connections, so no candidate was submitted and the candidate remains non-canonical.

## Surprises & Discoveries

- Observation: The running environment differs from the June record: it starts with `--reserve-vram 2 --mmap-torch-files`, while the older KB records `--reserve-vram 8 --disable-mmap`.
  Evidence: `GET /system_stats` on 2026-07-11 returned the active command arguments.
- Observation: Qwen Image Edit 2511 bf16, its VAE and FP8-scaled text encoder, and both Lightning and full-quality paths are locally available; no model download is required.
  Evidence: `GET /object_info` lists the exact filenames used by `phase1_qwen_edit_2511_dgx_flat.json`.
- Observation: `EditModelReference` is not registered as a node name in this ComfyUI build, so the implementation must use the supported native Qwen conditioning nodes rather than inventing a missing dependency.
  Evidence: the object registry contains `TextEncodeQwenImageEditPlus`, `ReferenceLatent`, and 756 total node types, but no `EditModelReference`.
- Observation: A twenty-step non-Lightning attempt caused a temporary ComfyUI disconnect and history loss, but a clean eight-step non-Lightning run completed successfully.
  Evidence: prompt `1312456c-d9e1-425e-8d33-3bd80dca528f` disappeared after service recovery; prompt `4af83423-8778-4b4c-8657-3065869079fb` completed with `status_str: success`.
- Observation: Four-step Lightning and eight-step non-Lightning executions both took roughly 6.2 minutes in the observed runtime, so acceleration did not provide a useful speed advantage during this session.
  Evidence: ComfyUI timestamps measured approximately 371 and 376 seconds respectively.
- Observation: A pose-only test at denoise 0.75 did not produce a history record because ComfyUI restarted during execution; no visual conclusion can be drawn from it.
  Evidence: prompt `2e80099e-3259-420b-9878-1e8a6cbbf824` disappeared after service recovery and `/queue` returned empty.
- Observation: A second face reference can be supplied through core `TextEncodeQwenImageEditPlus.image2` without introducing a spatial face mask.
  Evidence: additive workflow `phase1_qwen_edit_2511_pose_identity_ref.json` connects `LoadImage(DSC07559_face_ref_1024.jpg)` to input `image2`.
- Observation: The local ComfyUI tunnel was unavailable during the 2026-07-12 follow-up, so live validation could not be repeated.
  Evidence: curl to the local system_stats endpoint returned connection refused; no prompt was submitted.

## Decision Log

- Decision: Use Qwen Image Edit 2511 as the only primary editing model and remove face-mask/head-swap logic from Phase 1.
  Rationale: Qwen is trained for semantic and appearance editing from an input image; prior FLUX reference and masked face paths caused identity competition, seams, and pasted-face artifacts.
  Date/Author: 2026-07-11 / Codex
- Decision: Compare the existing four-step Lightning graph against a full-quality non-Lightning graph using the same input, instruction, and seed.
  Rationale: Four-step acceleration is useful for previews but cannot establish the quality ceiling. A controlled comparison isolates the effect of the acceleration LoRA and sampling schedule.
  Date/Author: 2026-07-11 / Codex
- Decision: Use only additive workflow/output changes until a candidate has been visually verified.
  Rationale: Existing workflows and DGX assets are operational evidence and must remain recoverable.
  Date/Author: 2026-07-11 / Codex
- Decision: Promote non-Lightning eight-step, CFG 3.0 as the canonical quality path and retain the Lightning loader as a bypassed node.
  Rationale: It produced the clearer requested expression while preserving identity and the scene, with no observed runtime penalty in the current DGX state; bypass preserves a reversible preview option.
  Date/Author: 2026-07-11 / Codex
- Decision: Leave the two-image identity-reference graph as an explicitly non-canonical, unexecuted experiment until the DGX endpoint is available.
  Rationale: The primary Phase 1 contract is one source image. An unavailable service cannot produce trustworthy visual evidence, and no prompt submission avoids changing the DGX queue or outputs during recovery.
  Date/Author: 2026-07-12 / Codex

## Outcomes & Retrospective

The canonical Phase 1 graph now performs direct one-image Qwen editing without any identity mask or second face image. Fixed-seed evidence shows a clearer requested expression than the previous four-step graph while retaining identity, clothing, pose, framing, and background. Runtime performance remains an environment-level open concern: both successful candidates took about 6.2 minutes, and a twenty-step switch triggered a service restart. The workflow goal is complete; DGX performance normalization is intentionally left separate.

## Context and Orientation

The local repository is `/Users/tsudatakashi/RaspberryPiSystem_002`. ComfyUI runs on the DGX Spark and is visible through the existing tunnel at `http://127.0.0.1:8188`. The existing canonical graph is `scripts/dgx-private-comfyui/workflows/phase1_qwen_edit_2511_dgx_flat.json`. It loads one image, scales it with `FluxKontextImageScale`, sends the same scaled image to `TextEncodeQwenImageEditPlus` and `VAEEncode`, and samples from that encoded latent. This is an input-image editing graph, unlike older FLUX graphs that begin with an empty latent and synthesize a new image.

The canonical graph now bypasses the Qwen Image Edit 2511 Lightning LoRA and samples eight Euler/simple steps at CFG 3.0 and denoise 1.0. The earlier four-step Lightning graph is retained as a bypassed node for future preview comparisons. “Identity retention” here means that the source person's recognizable facial structure, hair, age, and overall appearance remain stable without supplying a separate face image. “Unrequested-region preservation” means that composition, camera, background, clothing, and lighting do not materially change unless named in the instruction.

## Plan of Work

The completed canonical selection submitted the existing graph through the local ComfyUI API with a safe instruction and fixed seed, then compared it with a quality candidate that bypassed the acceleration LoRA. Both used the same direct-image conditioning and latent start. The eight-step candidate was promoted only after original-resolution visual comparison.

The remaining work is limited to the additive two-image candidate. When the DGX endpoint is available, verify every node and model, submit only that candidate with a safe fixed-seed input, inspect the result at original resolution, and record the outcome. Do not promote it to the one-image canonical path unless the product requirement changes.

Finally, verify every workflow node against `GET /object_info`, verify every referenced model against loader choices, ensure the graph loads without missing-node/model alerts, and update `docs/knowledge-base/KB-379-dgx-private-comfyui-nvfp4-migration-and-workflow-tuning.md` plus `scripts/dgx-private-comfyui/workflows/README.md` with only the measured result.

## Concrete Steps

All repository commands run from `/Users/tsudatakashi/RaspberryPiSystem_002`. Runtime checks use `curl http://127.0.0.1:8188/system_stats`, `curl http://127.0.0.1:8188/object_info`, `curl http://127.0.0.1:8188/queue`, and `curl http://127.0.0.1:8188/history`. Workflow submissions use `POST /prompt` with an API-format prompt derived from the version-controlled UI graph. Generated images are retrieved only from the local ComfyUI `/view` endpoint or its mounted output location.

Repository validation runs `jq empty` on each changed JSON, checks workflow node types against the live object registry, runs `git diff --check`, and reviews `git diff` to ensure no unrelated or private input files were added.

## Validation and Acceptance

The completed canonical workflow must load with no missing nodes or models, accept exactly one source image, and contain no face mask, face crop, identity reference image, PuLID, InsightFace, or head-swap dependency. With a fixed safe source and instruction, it must produce a valid non-black image. The requested change must be visible, the person must remain recognizably the same, and the background, framing, clothing, and lighting must remain substantially unchanged when the prompt says to preserve them. Runtime and exact sampler settings must be recorded so the result is reproducible.

## Idempotence and Recovery

API submissions are additive: they create new outputs and do not overwrite source images or model files. Experimental workflow files use distinct names and output prefixes. If ComfyUI errors or a candidate regresses, clear only the failed queued item, keep the existing canonical JSON unchanged, and return to the last fixed-seed output. No container recreation, model download, deployment, or runtime flag change is required by this plan.

## Artifacts and Notes

The primary evidence consists of the source workflow JSON, candidate workflow JSON, ComfyUI prompt/history records, generated image filenames, elapsed time, and visual comparison notes. Personal source images and model binaries remain outside Git.

## Interfaces and Dependencies

The workflow uses core nodes available in ComfyUI 0.22.0: `UNETLoader`, `CLIPLoader`, `VAELoader`, `ModelSamplingAuraFlow`, `CFGNorm`, `FluxKontextImageScale`, `TextEncodeQwenImageEditPlus`, `ConditioningZeroOut`, `VAEEncode`, `KSampler`, `VAEDecode`, and `SaveImage`. The installed model files are `qwen_image_edit_2511_bf16.safetensors`, `qwen_2.5_vl_7b_fp8_scaled.safetensors`, and `qwen_image_vae.safetensors`; the preview path additionally uses `Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors`.

Revision note (2026-07-11): Initial plan created after live read-only inspection; it deliberately excludes masked identity replacement from the Phase 1 architecture.

Revision note (2026-07-12): Added structured metadata, corrected the canonical sampler description, and recorded that the optional two-image candidate could not be submitted because the local ComfyUI tunnel was unavailable.
