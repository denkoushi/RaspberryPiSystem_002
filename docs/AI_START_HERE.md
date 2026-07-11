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
- Active self-inspection confirm guard + draft WIP: `docs/plans/self-inspection-confirm-guard-wip-draft.md`

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
