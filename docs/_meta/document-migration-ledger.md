---
id: meta-document-migration-ledger
status: active
scope: high-risk documentation entrypoints and legacy large documents
date: 2026-06-24
source_of_truth: false
related_docs:
  - ./document-inventory-summary.md
  - ./document-inventory.json
  - ../plans/docs-canonicalization-roadmap.md
validation:
  - node scripts/docs/audit-docs.mjs --check
  - git diff --check
open_items:
  - Execute PR4 entrypoint alignment.
  - Expand this ledger after PR4 before thinning large indexes.
---

# Document Migration Ledger

This ledger maps high-risk legacy entrypoints and large documents to their
next canonical destination. It is a migration control file, not a content
source of truth.

## Action Vocabulary

- `keep`: keep the file in place and edit only the stale guidance.
- `redirect`: keep the old URL, but make it a short pointer to the new source.
- `split`: move confirmed sections to KB / Runbook / ADR / Plan over multiple PRs.
- `archive`: preserve historical content outside the active path after mapping.
- `unverified`: do not edit content until the target canonical owner is clear.

## Initial High-Risk Set

| old_path | current_role | target_canonical | action | preservation | status |
|----------|--------------|------------------|--------|--------------|--------|
| `AI_HANDOFF_PROMPT.txt` | Legacy AI prompt; still tells agents to use `EXEC_PLAN.md` and `docs/INDEX.md` as current state. | `AGENTS.md`; `docs/AI_START_HERE.md`; relevant KB / Runbook / ADR / Plan. | redirect | Keep the path and replace body with a short current-start pointer in PR4. | pending_pr4 |
| `README.md` | Human repository overview; still describes `EXEC_PLAN.md` as progress and implementation guidance. | `docs/AI_START_HERE.md`; `docs/plans/docs-canonicalization-roadmap.md`; existing module docs. | keep | Keep README as project overview; revise only stale `EXEC_PLAN.md` guidance in PR4. | pending_pr4 |
| `docs/guides/development.md` | Developer guide; startup flow still prioritizes giant `docs/INDEX.md` and `EXEC_PLAN.md`. | `docs/AI_START_HERE.md`; `.cursor/rules/`; relevant KB / Runbook / ADR / Plan. | keep | Keep developer guide; revise the startup section and legacy references in PR4. | pending_pr4 |
| `docs/REFACTORING_PLAN.md` | Completed old refactoring plan based on former `EXEC_PLAN.md`-centered model. | `docs/plans/docs-canonicalization-roadmap.md`. | redirect | Keep original body as history; add `superseded_by` and a short superseded notice in PR4. | pending_pr4 |
| `docs/INDEX.md` | Oversized global index with narrative updates and many links. | Thin global navigation; domain indexes where needed; canonical KB / Runbook / ADR / Plan. | split | Do not edit in PR4; after ledger expansion, thin one domain per PR while preserving old links. | pending_pr5 |
| `docs/guides/deployment.md` | Mixed deployment procedure, deployment diary, run IDs, troubleshooting, and feature history. | Deployment Runbook for current procedure; KB / Plan / Evidence for history and incidents. | split | Do not edit until standard procedure sections and history sections are mapped separately. | pending_pr5 |
| `docs/guides/verification-checklist.md` | Common validation plus feature-specific acceptance history. | Common validation Runbook; feature-specific Runbook or Plan entries. | split | Do not edit until common checks and feature checks are mapped separately. | pending_pr5 |
| `EXEC_PLAN.md` | Legacy historical log with corruption-like text, long lines, and many inbound links. | Existing canonical KB / Runbook / ADR / Plan; future archive path only after mapping. | archive | Freeze as historical log; do not rewrite, infer, or shorten until useful sections are mapped. | frozen |

## PR3 Inventory Snapshot

From `docs/_meta/document-inventory.json` before adding this ledger:

| Path | Lines | Inbound | Local links | Notes |
|------|------:|--------:|------------:|-------|
| `AI_HANDOFF_PROMPT.txt` | 17 | 0 | 1 | Legacy AI prompt, no frontmatter. |
| `README.md` | 319 | 2 | 19 | Human overview with stale `EXEC_PLAN.md` guidance. |
| `docs/guides/development.md` | 559 | 16 | 16 | Has frontmatter; stale startup order. |
| `docs/REFACTORING_PLAN.md` | 124 | 1 | 8 | Has frontmatter; no status yet. |
| `docs/INDEX.md` | 1,831 | 14 | 935 | 85 long lines; oversized index. |
| `docs/guides/deployment.md` | 5,161 | 448 | 377 | 8 long lines; largest tracked text doc. |
| `docs/guides/verification-checklist.md` | 1,147 | 76 | 80 | 1 long line; mixed common and feature checks. |
| `EXEC_PLAN.md` | 4,658 | 42 | 749 | 327 long lines; corruption flags present. |

## Next Step

PR4 should modify only the four entrypoint files marked `pending_pr4`:
`AI_HANDOFF_PROMPT.txt`, `README.md`, `docs/guides/development.md`, and
`docs/REFACTORING_PLAN.md`.
