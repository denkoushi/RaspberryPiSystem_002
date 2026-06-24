---
id: plan-docs-canonicalization-roadmap
status: active
scope: repository documentation source-of-truth migration
date: 2026-06-24
source_of_truth: true
related_docs:
  - ../../AGENTS.md
  - ../AI_START_HERE.md
  - ../INDEX.md
  - ../knowledge-base/index.md
  - ../../EXEC_PLAN.md
validation:
  - git status --short --branch
  - git diff --check
  - changed Markdown local link check
  - corruption and long-line checks
  - node scripts/docs/audit-docs.mjs --check
open_items:
  - Continue thinning remaining `docs/INDEX.md` leaderboard performance and board aggregation history blocks.
  - Create or identify standard deployment and validation runbooks before shortening guides.
supersedes: []
superseded_by: null
---

# Docs Canonicalization Roadmap

## Purpose

Move repository documentation toward one detailed source of truth per fact:
KB for incidents and investigations, Runbook for executable procedures,
ADR for decisions and tradeoffs, and Plan for unfinished migration work.

This document is the canonical plan for the documentation refactor. It does
not change application behavior, APIs, types, deployment scripts, or tests.

## Safety Rules

- Work in small PRs. Each PR covers one step or one document area only.
- Do not bulk-delete, bulk-rename, bulk-translate, or rewrite giant documents.
- Do not add detailed progress logs to `EXEC_PLAN.md`.
- Keep `docs/INDEX.md` and `docs/knowledge-base/index.md` as thin navigation.
- Preserve old URLs until a redirect, `superseded_by`, or archive path exists.
- Do not move historical evidence before its target canonical document is known.
- Do not mix existing untracked files into documentation migration commits.

## Baseline Snapshot

Baseline was taken from `main` on 2026-06-24 after PR #466 was merged.

| Path | Lines | Role / Risk |
|------|------:|-------------|
| `AGENTS.md` | 76 | Current AI root guidance. |
| `docs/AI_START_HERE.md` | 91 | Current minimal AI entrypoint. |
| `AI_HANDOFF_PROMPT.txt` | 17 | Legacy AI prompt still points to `EXEC_PLAN.md`. |
| `README.md` | 319 | Still describes `EXEC_PLAN.md` as project progress. |
| `docs/guides/development.md` | 559 | Startup flow still prioritizes `docs/INDEX.md` and `EXEC_PLAN.md`. |
| `docs/REFACTORING_PLAN.md` | 124 | Old completed refactor plan based on the former model. |
| `docs/INDEX.md` | 1,831 | Large index with narrative update history. |
| `docs/knowledge-base/index.md` | 855 | KB index, partly thinned but still large. |
| `EXEC_PLAN.md` | 4,658 | Legacy historical log with known corruption-like sequences. |
| `docs/guides/deployment.md` | 5,161 | Procedure, deployment diary, and evidence are mixed. |
| `docs/guides/verification-checklist.md` | 1,147 | Common checks and feature-specific checks are mixed. |

## Migration Sequence

### PR1: Roadmap And Thin Entry Link

Status: this document.

- Add this Plan as the source of truth for the documentation refactor.
- Add one thin link from `docs/AI_START_HERE.md`.
- Do not edit `docs/INDEX.md`, `EXEC_PLAN.md`, deployment guide, or checklist.

### PR2: Read-Only Inventory

Status: implemented in PR2.

- Add `scripts/docs/audit-docs.mjs`.
- Read only from `git ls-files`; do not rewrite Markdown.
- Emit `docs/_meta/document-inventory.json`.
- Emit a short `docs/_meta/document-inventory-summary.md`.
- Collect path, line count, byte size, frontmatter presence, title, status,
  `source_of_truth`, local links, inbound count, question-mark corruption,
  U+FFFD replacement-character corruption, long lines, and references to
  `EXEC_PLAN.md`.
- Add `node scripts/docs/audit-docs.mjs --check` for reproducible validation.

### PR3: High-Risk Migration Ledger

Status: implemented in PR3.

- Add `docs/_meta/document-migration-ledger.md`.
- Start only with high-risk entrypoints:
  `AI_HANDOFF_PROMPT.txt`, `README.md`, `docs/guides/development.md`,
  `docs/REFACTORING_PLAN.md`, `docs/INDEX.md`,
  `docs/guides/deployment.md`, `docs/guides/verification-checklist.md`,
  and `EXEC_PLAN.md`.
- Use columns:
  `old_path`, `current_role`, `target_canonical`, `action`, `preservation`,
  and `status`.
- Restrict `action` to `keep`, `redirect`, `split`, `archive`, or `unverified`.

### PR4: Align AI Entrypoints

Status: implemented in PR4.

- Update `AI_HANDOFF_PROMPT.txt` to point to `AGENTS.md`,
  `docs/AI_START_HERE.md`, and the relevant KB / Runbook / ADR / Plan.
- Update `README.md` so `EXEC_PLAN.md` is not described as current progress.
- Update `docs/guides/development.md` so startup does not prioritize giant
  `docs/INDEX.md` or `EXEC_PLAN.md`.
- Mark `docs/REFACTORING_PLAN.md` as `superseded` and link to this Plan.
- Do not delete these legacy files in this PR.

### PR5: Expanded Ledger Before Thinning

Status: implemented in PR5.

- Expand `docs/_meta/document-migration-ledger.md` with safe thinning units for
  `docs/INDEX.md`, `docs/knowledge-base/index.md`,
  `docs/guides/deployment.md`, `docs/guides/verification-checklist.md`, and
  `EXEC_PLAN.md`.
- Do not edit giant document bodies in this PR.
- Use the expanded ledger to choose the next one-domain PR.

### PR6: Thin Recent Kiosk Leaderboard Index Blocks

Status: implemented in PR6.

- Thin only the recent kiosk leaderboard latest-update blocks in
  `docs/INDEX.md`.
- Preserve the headings and old reachability, but replace narrative deployment
  detail with short links to KB-392 and the already-canonical KB / Plan records.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR7: Thin 2026-05-22 Kiosk Leaderboard History Blocks

Status: implemented in PR7.

- Thin only the 2026-05-22 kiosk leaderboard UI and history latest-update
  blocks in `docs/INDEX.md`.
- Preserve the headings and old reachability, but replace narrative deployment
  detail with short links to existing KB, deployment, and verification records.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR8: Thin 2026-05-21 / 2026-05-20 Leaderboard Performance And Ordering Blocks

Status: implemented in PR8.

- Thin only the 2026-05-21 shell initial optimization, 2026-05-21 continue
  80/80, and 2026-05-20 A+alpha ordering latest-update blocks in
  `docs/INDEX.md`.
- Preserve the headings and old reachability, but replace deployment narrative
  detail with short links to existing KB, deployment, and verification records.
- Point historical shell / continue values back to KB-392 for current
  leaderboard size and freshness expectations.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR9: Thin Leaderboard Terminal Cache Index History Blocks

Status: implemented in PR9.

- Thin only the leaderboard terminal cache, SWR, instant mutation display,
  footer chip cache, and seiban OR client cache history blocks in
  `docs/INDEX.md`.
- Preserve the existing list positions and old reachability, but replace
  deployment narrative detail with short links to ADR, KB, deployment, and
  KB-392 current-spec records.
- Treat `120秒` / `120s` wording in those entries as historical and point
  current freshness expectations to KB-392.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR10 And Later: Thin Indexes And Split Large Documents

- Thin `docs/INDEX.md` one domain at a time after ledger confirmation.
- Thin remaining long entries in `docs/knowledge-base/index.md`.
- Convert `docs/guides/deployment.md` toward a procedure entrypoint; move only
  already-confirmed history to KB / Plan / Evidence.
- Keep `docs/guides/verification-checklist.md` focused on common validation;
  move feature-specific checks only after their target Runbook or Plan exists.
- Leave `EXEC_PLAN.md` untouched until its useful sections are mapped.

## Metadata Conventions

New standalone KB, ADR, Runbook, and Plan documents should use structured
metadata where practical:

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

Status values:

- Plan: `draft`, `active`, `blocked`, `completed`, `superseded`, `archived`
- KB: `active`, `resolved`, `superseded`, `archived`
- ADR: `proposed`, `accepted`, `superseded`, `rejected`
- Runbook: `active`, `deprecated`, `superseded`, `archived`

## Validation For Each PR

- `git status --short --branch`
- `git diff --check`
- Check changed Markdown relative links.
- Run the repository-standard corruption pattern check on changed Markdown.
- `awk 'length($0)>1000 { print FILENAME ":" FNR ":" length($0) }' <changed-md-files>`
- Run the repository-standard added-line secret pattern check.
- `git diff --name-only --cached`
- If docs tooling is added, run `node scripts/docs/audit-docs.mjs --check`.

## Local Notes JA

- この移行は「一気に整理」ではなく、到達性を保った段階移行として進める。
- `EXEC_PLAN.md` は最後まで歴史ログとして扱い、推測復元や本文級追記をしない。
- 旧文書を短くする前に、移送先の正本が存在するかを必ず確認する。
