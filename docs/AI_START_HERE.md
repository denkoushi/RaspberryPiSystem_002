---
title: AI Start Here
tags: [ai, documentation, source-of-truth, handoff]
audience: [ai-agent]
last-verified: 2026-06-22
related: [../AGENTS.md, ../.cursor/rules/01-core-docs-and-knowledge.mdc, ./guides/ai-handoff.md, ./guides/agmsg-codex-cursor-collaboration.md]
category: guides
update-frequency: high
---

# AI Start Here

This file is the minimal entry point for AI agents. It is not a human-facing manual.

## Read Order

1. `AGENTS.md`
2. `docs/AI_START_HERE.md`
3. `.cursor/rules/00-core-safety.mdc`
4. `.cursor/rules/01-core-docs-and-knowledge.mdc`
5. Any `.cursor/rules/*.mdc` relevant to the current task
6. `docs/guides/agmsg-codex-cursor-collaboration.md` if the task uses Codex/Cursor agmsg collaboration
7. The related KB, Runbook, ADR, or Plan

Do not start by reading every large document.

## Current Documentation Policy

Existing large documents are kept as legacy assets. Do not rewrite or translate them as part of ordinary feature work.

`EXEC_PLAN.md` is a legacy historical log. It contains excessive detail and known corruption-like `?` sequences. Do not use it as the detailed source of truth. Do not append detailed progress logs to it.

If `EXEC_PLAN.md` must be touched, keep the entry short and limited to current state, open items, and next actions.

## Source Of Truth Map

- Incidents, investigations, root causes, and prevention: `docs/knowledge-base/`
- Operations, recovery, deployment, and validation procedures: `docs/runbooks/`
- Design decisions and tradeoffs: `docs/decisions/`
- Planned or unfinished implementation work: `docs/plans/`
- Documentation canonicalization roadmap: `docs/plans/docs-canonicalization-roadmap.md`
- AI agent collaboration through agmsg: `docs/guides/agmsg-codex-cursor-collaboration.md`
- Global document navigation: `docs/INDEX.md`
- Knowledge-base navigation: `docs/knowledge-base/index.md`
- Active inspection-drawing OCR candidate improvement: `docs/plans/inspection-drawing-ocr-local-candidates.md`
- Active inspection-drawing OCR RapidOCR local secondary: `docs/plans/inspection-drawing-ocr-rapidocr-local.md`
- Active self-inspection autosave / callout / template create lock: `docs/plans/self-inspection-autosave-callout-template-lock.md`
- Active SelfInspectionService use-case boundary refactor: `docs/plans/self-inspection-use-case-boundaries-execplan.md`
- Active generated kiosk SOP maintenance system (production-route capture, committed images, fail-closed CI): `docs/plans/kiosk-sop-generated-maintenance-execplan.md`
- Active kiosk SOP leader-geometry and Full HD presentation correction: `docs/plans/kiosk-sop-visual-layout-correction-execplan.md`
- Active kiosk SOP semantic target correction (10 sheets / 45 DOM anchors): `docs/plans/kiosk-sop-semantic-target-correction-execplan.md`
- Superseded hand-authored inspection-drawing SOP history: `docs/plans/kiosk-inspection-drawing-edit-existing-sop.md`
- Active release-bundled kiosk SOP popup viewer: `docs/plans/kiosk-sop-popup-viewer-execplan.md`
- Accepted inspection-drawing dimension/tolerance 1-page SOP (layout-pattern sample only; not full edit path): `docs/plans/kiosk-inspection-drawing-dimension-tolerance-sop-1page.md`
- Active self-inspection confirm guard + draft WIP: `docs/plans/self-inspection-confirm-guard-wip-draft.md`
- Completed kiosk self-inspection layout density: `docs/plans/kiosk-self-inspection-layout-density-execplan.md`
- Completed main-integration completion guard: `docs/plans/main-integration-completion-guard-execplan.md`
- Active DGX ComfyUI Phase 1 follow-up: `docs/plans/dgx-comfyui-single-image-edit-workflow.md`
- Active assembly torque-wrench traceability: `docs/plans/assembly-torque-wrench-traceability-execplan.md`
- Active fleet-wide assembly torque-wrench connection lease: `docs/plans/assembly-torque-wrench-connection-lease-execplan.md`
- Active assembly torque display latency: `docs/plans/assembly-torque-display-latency-execplan.md`
- Active assembly template editor density: `docs/plans/kiosk-assembly-template-editor-density-execplan.md`
- Deploy speed Phase B (SSH path, production-validated): `docs/plans/deploy-speed-phase-b-execplan.md`
- Deploy workflow safe shortening Phase 1 (implementation; no production authorization): `docs/plans/deploy-workflow-safe-shortening-execplan.md`
- Deploy workflow safe shortening Phase 2 (attested ARM64 artifact promotion; no production authorization): `docs/plans/deploy-workflow-artifact-promotion-execplan.md`
- Deploy artifact timeout and canary handoff correction (implementation; no production authorization): `docs/plans/deploy-artifact-timeout-canary-handoff-execplan.md`
- Production configuration and terminal peripheral health fail-closed correction (implementation; no production authorization): `docs/plans/fail-closed-production-config-and-terminal-health-execplan.md`
- Standard release production-path execution audit (production frozen; no production authorization): `docs/plans/standard-release-production-path-audit-execplan.md`
- Pi4 SD-card recovery production readiness (implementation; no production authorization): `docs/plans/pi4-sd-recovery-readiness-execplan.md`
- StoneBase Local executor integration (pending; not a canonical device route): `docs/plans/stonebase-local-executor-freeze.md`
- Normal SSH deployment gate audit and first stabilization (in progress; no hardware authorization): `docs/plans/normal-ssh-deploy-gate-audit-20260722.md`
- Build-aware deployment release-readiness review (in progress): `docs/plans/deploy-release-readiness-review-20260725.md`
- Pi5 release Pi4 display protection (in progress): `docs/plans/pi5-deploy-pi4-display-protection-execplan.md`
- Kiosk stale-chunk white-screen recovery (implementation; no production authorization): `docs/decisions/ADR-20260731-kiosk-runtime-chunk-recovery.md`, `docs/plans/kiosk-white-screen-runtime-recovery-execplan.md`
- Gmail CSV / assembly DocumentASM conflict guards (in progress): `docs/plans/gmail-import-conflict-guards-20260725.md`
- Pi5 API footprint and single-SSD file storage safety (in progress): `docs/plans/pi5-api-image-local-storage-scalability-execplan.md`
- Cross-repository DGX ownership and deployment boundary: [`DGXSparkControlPlane/docs/repository-boundary.md`](https://github.com/denkoushi/DGXSparkControlPlane/blob/main/docs/repository-boundary.md)
- Active DGX business-proxy consumer contract (no fleet deploy): [Plan](./plans/dgx-control-plane-business-proxy-consumer-execplan.md)

The index files are navigation only. They must not become narrative logs.

## Write Rules

- Put detailed facts in exactly one source-of-truth document.
- Link to that source from indexes or related documents instead of copying the same text.
- Do not copy the same validation result, deployment result, or troubleshooting story into multiple documents.
- Keep index entries short: status, title, and link are enough.
- Preserve Japanese UI labels, operator wording, logs, hostnames, and shop-floor terms exactly when needed.
- New standalone KB, ADR, Runbook, and Plan documents should use English headings and structured metadata.
- If an existing Japanese document must be updated, follow that document's language and style.
- If Japanese context is needed in a new English document, use `Local Notes JA` or `notes_ja`.

## Required Fields For New Source Documents

Use the relevant subset:

- `id`
- `status`
- `scope`
- `date`
- `source_of_truth`
- `related_code`
- `related_docs`
- `validation`
- `open_items`
- `supersedes`
- `superseded_by`

## Before Commit

For documentation changes, check:

- `git diff --check`
- changed Markdown links
- accidental repeated-question-mark corruption
- lines longer than 1,000 characters
- index files receiving narrative content
- duplicated source-of-truth content

## What Not To Do

- Do not perform a broad documentation cleanup unless the user explicitly asks for it.
- Do not translate existing large Japanese documents.
- Do not treat `EXEC_PLAN.md` as the canonical current state.
- Do not add large narrative entries to `docs/INDEX.md`.
- Do not add large narrative entries to `docs/knowledge-base/index.md`.
