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
  - Continue thinning remaining `docs/INDEX.md` latest-update blocks by domain.
  - Create or identify standard deployment and validation runbooks before shortening guides.
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
| `AI_HANDOFF_PROMPT.txt` | Legacy AI prompt; formerly told agents to use `EXEC_PLAN.md` and `docs/INDEX.md` as current state. | `AGENTS.md`; `docs/AI_START_HERE.md`; relevant KB / Runbook / ADR / Plan. | redirect | Kept the path and replaced the body with a short current-start pointer in PR4. | aligned_pr4 |
| `README.md` | Human repository overview; formerly described `EXEC_PLAN.md` as progress and implementation guidance. | `docs/AI_START_HERE.md`; `docs/plans/docs-canonicalization-roadmap.md`; existing module docs. | keep | Kept README as project overview; revised stale `EXEC_PLAN.md` guidance in PR4. | aligned_pr4 |
| `docs/guides/development.md` | Developer guide; formerly prioritized giant `docs/INDEX.md` and `EXEC_PLAN.md` in the startup flow. | `docs/AI_START_HERE.md`; `.cursor/rules/`; relevant KB / Runbook / ADR / Plan. | keep | Kept developer guide; revised the startup section and legacy references in PR4. | aligned_pr4 |
| `docs/REFACTORING_PLAN.md` | Completed old refactoring plan based on former `EXEC_PLAN.md`-centered model. | `docs/plans/docs-canonicalization-roadmap.md`. | redirect | Kept original body as history; added `superseded_by` and a short superseded notice in PR4. | aligned_pr4 |
| `docs/INDEX.md` | Oversized global index with narrative updates and many links. | Thin global navigation; domain indexes where needed; canonical KB / Runbook / ADR / Plan. | split | Expanded below in PR5. Thin one domain per PR while preserving old links. | expanded_pr5 |
| `docs/guides/deployment.md` | Mixed deployment procedure, deployment diary, run IDs, troubleshooting, and feature history. | Deployment Runbook for current procedure; KB / Plan / Evidence for history and incidents. | split | Expanded below in PR5. Do not shorten until procedure sections and history sections are mapped separately. | expanded_pr5 |
| `docs/guides/verification-checklist.md` | Common validation plus feature-specific acceptance history. | Common validation Runbook; feature-specific Runbook or Plan entries. | split | Expanded below in PR5. Do not shorten until common checks and feature checks are mapped separately. | expanded_pr5 |
| `EXEC_PLAN.md` | Legacy historical log with corruption-like text, long lines, and many inbound links. | Existing canonical KB / Runbook / ADR / Plan; future archive path only after mapping. | archive | Freeze as historical log; do not rewrite, infer, or shorten until useful sections are mapped. | frozen |

## PR5 Expanded Target Map

This expansion identifies the next safe thinning units. It does not move
content and does not make a target canonical unless that target already owns
the topic.

| source_area | current_payload | target_canonical | action | preservation | next_status |
|-------------|-----------------|------------------|--------|--------------|-------------|
| `docs/INDEX.md` latest-update blocks | Date-stamped narrative updates and deployment summaries. | Existing linked KB / Plan / ADR / Runbook / API documents. For kiosk leaderboard current specification, use `docs/knowledge-base/KB-392-kiosk-leaderboard-spec-source-of-truth.md`. | split | PR6-PR140 thinned selected recent blocks. PR50-PR51 moved remaining onsite smoke validation for seiban list and note-modal registration from `docs/INDEX.md` into KB-297. Continue by domain. | partial_pr140 |
| `docs/INDEX.md` purpose/category navigation | Navigation tables and audience-oriented entry links. | `docs/INDEX.md` as thin global navigation. | keep | Keep this file as a lightweight index; avoid adding narrative update logs. | keep_thin |
| `docs/knowledge-base/index.md` category and issue tables | KB navigation mixed with status notes and some deployment facts. | `docs/knowledge-base/index.md` as thin KB navigation; individual KB files for details. | split | Shorten after `docs/INDEX.md` first-pass thinning; do not duplicate KB detail text. | pending_after_global_index |
| `docs/knowledge-base/index.md` update history | Chronological deployment and validation notes that duplicate KB / deployment / EXEC_PLAN history. | Existing KB files, Plans, Runbooks, or Evidence paths referenced by each entry. | split | Map by domain before deleting text; preserve links that external docs use. | map_before_edit |
| `docs/guides/deployment.md` top deployment diary | Date-stamped feature deploy logs, run IDs, Phase12 outcomes, and feature history. | Related KB / Plan / Evidence documents for each feature; deployment guide should not be the fact owner. | split | Do not bulk-delete. Move only entries whose canonical owner is already clear. | map_by_domain |
| `docs/guides/deployment.md` standard procedure sections | Network mode, Pi5/Pi4/Pi3 update steps, rollback, troubleshooting, operational checklists. | Future standard deployment Runbook, or this file as a temporary procedure entrypoint until the Runbook exists. | keep | Keep executable steps reachable until a Runbook replacement is created and linked. | runbook_needed |
| `docs/guides/verification-checklist.md` common checks | Backup, offline, monitoring, deploy, CI/CD, and result-recording checks. | Future common validation Runbook. | keep | Keep as checklist until the Runbook exists; avoid adding feature acceptance history. | runbook_needed |
| `docs/guides/verification-checklist.md` feature-specific checks | Long-lived CSV and feature acceptance sections mixed into the common checklist. | Feature-specific KB / Plan / Runbook entries. | split | Move only after the target document exists and the old section can point to it. | map_by_feature |
| `EXEC_PLAN.md` Progress / Surprises / Decision Log / Outcomes / Next Steps | Legacy project-wide narrative with corruption-like text and many long lines. | Existing canonical KB / Runbook / ADR / Plan documents; future archive note only after mapping. | archive | Do not rewrite, infer, or shorten yet. Use only as historical cross-check. | frozen |

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

PR141 should continue `docs/INDEX.md` thinning for another domain, or create the
standard deployment / validation runbook targets before shortening those guides.
