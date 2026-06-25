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
  - Continue thinning remaining `docs/INDEX.md` latest-update blocks by domain.
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

### PR10: Thin Leaderboard Board And Performance History Blocks

Status: implemented in PR10.

- Thin only the board/continue cursor contract, deferred decorations,
  continue COUNT reuse, initial10/continue40, deltaRows/pageSize80, and board
  aggregate API history blocks in `docs/INDEX.md`.
- Preserve list positions and reachability, but replace deployment narrative
  detail with short links to KB, ADR, deployment, and KB-392 current-spec
  records.
- Treat `pageSize 80`, initial10, and continue40 wording as historical and
  point current leaderboard size expectations to KB-392.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR11: Thin 2026-05-07 Leaderboard Snapshot And Card-Scope Blocks

Status: implemented in PR11.

- Thin only the 2026-05-07 card-scope phased, server snapshot, and
  snapshot+cursor latest-update blocks in `docs/INDEX.md`.
- Preserve the 2026-05-07 heading and adjacent non-leaderboard entries, but
  replace detach/run narrative detail with short links to KB, ADR, deployment,
  and PR records.
- Treat card-scope phased as historical; point current leaderboard specification
  expectations to KB-392.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR12: Thin Mobile Placement Zero2W Index History Block

Status: implemented in PR12.

- Thin only the 2026-05-07 Mobile Placement Zero2W hardening latest-update
  block in `docs/INDEX.md`.
- Preserve reachability, but replace migration, API, route, and deployment
  narrative detail with short links to KB-368, the mobile placement runbook,
  the mobile placement API doc, the Zero2W setup runbook, and deployment.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR13: Thin Phase12 Zero2W NOPASSWD Index History Block

Status: implemented in PR13.

- Thin only the 2026-05-06 Phase12 recheck and Zero2W
  `sudo_nopasswd_commands` latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace validation, sample fragment, and
  deployment narrative detail with short links to KB-367, KB-368, the Zero2W
  setup runbook, and deployment.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR14: Thin Mishima Grinding CSV Gmail NON_RETRIABLE Index History Block

Status: implemented in PR14.

- Thin only the 2026-05-06 Mishima Grinding CSV Gmail
  `NON_RETRIABLE` / `CSV_HEADER_MISMATCH` latest-update block in
  `docs/INDEX.md`.
- Preserve reachability, but replace PowerAutomate empty attachment,
  disposal, and debug-sink narrative detail with short links to KB-297, the
  CSV import/export guide, and PR #259.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR15: Thin Order Supplement P2002 Index History Block

Status: implemented in PR15.

- Thin only the 2026-05-06 order supplement `P2002` /
  `csvDashboardRowId` latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace winner-row mismatch, implementation,
  deployment, and validation narrative detail with short links to KB-328,
  KB-297, the CSV import/export guide, PR #256, and deployment.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR16: Thin FKOJUNST_Status Sole Source Index History Block

Status: implemented in PR16.

- Thin only the 2026-05-08 FKOJUNST_Status sole-source latest-update block in
  `docs/INDEX.md`.
- Preserve reachability, but replace detach run, Phase12, and redeploy argument
  narrative detail with short links to ADR-20260508, KB-370, deployment, and
  ADR-20260526 for the later completion-status-only decision.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR17: Thin FKOJUNST_Status Disappearance Completion Index History Block

Status: implemented in PR17.

- Thin only the 2026-05-05 FKOJUNST_Status dedupe-key disappearance
  completion latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace branch, commit, detach run, and Phase12
  narrative detail with short links to KB-297, deployment, PR #250,
  ADR-20260508, and ADR-20260526.
- Keep the adjacent current-spec FKOJUNST_Status pointer intact.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR18: Thin Zero2W Edge Hardening Index History Block

Status: implemented in PR18.

- Thin only the 2026-05-05 Zero2W tanaban edge hardening latest-update block
  in `docs/INDEX.md`.
- Preserve reachability, but replace detach run, CI, Phase12, Zero2W playbook,
  service state, and E2E narrative detail with short links to KB-368, the
  Zero2W setup runbook, deployment, and KB-367.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR19: Thin Zero2W Tanaban Edge Setup Index History Block

Status: implemented in PR19.

- Thin only the 2026-05-04 Zero2W tanaban edge setup latest-update block in
  `docs/INDEX.md`.
- Preserve reachability, but replace Ansible, inventory fragment,
  `haizen-agent`, SSH/TLS finding, Android/API, and E2E narrative detail with
  short links to the Zero2W setup runbook, KB-367, KB-368, Tailscale policy,
  client setup, mobile-placement API, and haizen-agent README.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR20: Thin Zero2W Assignment API Index History Block

Status: implemented in PR20.

- Thin only the 2026-05-04 Zero2W assignment kiosk and
  `haizen-target-devices` API latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace Pi5 deploy, detach run, Pi4/Pi3
  no-hosts-matched, and Phase12 narrative detail with short links to KB-368,
  the mobile-placement smartphone runbook, the mobile-placement API doc, and
  deployment.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR21: Thin DGX Phase11 Index History Block

Status: implemented in PR21.

- Thin only the 2026-05-04 DGX Resource Phase11 latest-update block in
  `docs/INDEX.md`.
- Preserve reachability, but replace Pi5 deploy, detach run, DGX gateway
  restart, Phase12, and broad `pkill` narrative detail with short links to
  KB-365, the DGX runbook, deployment, and PR #246.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR22: Thin Leaderboard Rank Picker Index History Block

Status: implemented in PR22.

- Thin only the 2026-05-04 kiosk leaderboard seiban priority evaluation and
  registered-seiban rank picker latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace branch, commit, Pi5-to-Pi4 deploy,
  detach run, and Phase12 narrative detail with short links to KB-297 and
  deployment.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR23: Thin DGX KPI Metrics Index History Block

Status: implemented in PR23.

- Thin only the 2026-05-03 DGX KPI metrics latest-update block in
  `docs/INDEX.md`.
- Preserve reachability, but replace branch, commit, Pi5-to-DGX deploy,
  detach run, and Phase12 narrative detail with short links to KB-365, the
  DGX runbook, and deployment.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR24: Thin DGX Phase9 Index History Block

Status: implemented in PR24.

- Thin only the 2026-05-03 DGX Resource Phase9 Strict Ready latest-update
  block in `docs/INDEX.md`.
- Preserve reachability, but replace branch, commit, Pi5 deploy, detach run,
  Phase12, and timeout rollback narrative detail with short links to KB-365,
  the DGX runbook, and deployment.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR25: Thin DGX Phase7 Index History Block

Status: implemented in PR25.

- Thin only the 2026-05-03 DGX Resource Phase7 latest-update block in
  `docs/INDEX.md`.
- Preserve reachability, but replace main commit, Pi5 deploy, post-policy,
  gateway, Ansible, and `EXEC_PLAN.md` narrative detail with short links to
  KB-365, the DGX runbook, and deployment.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR26: Thin DGX Phase6 Index History Block

Status: implemented in PR26.

- Thin only the 2026-05-03 DGX Resource Phase6 task-first guide latest-update
  block in `docs/INDEX.md`.
- Preserve reachability, but replace branch, commit, Pi5 deploy, detach run,
  Phase12, and post-policy Comfy narrative detail with short links to KB-365,
  the DGX runbook, and deployment.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR27: Thin DGX UI Redesign Index History Block

Status: implemented in PR27.

- Thin only the 2026-05-03 DGX Resource UI redesign latest-update block in
  `docs/INDEX.md`.
- Preserve reachability, but replace branch, commit, Web-only deploy, detach
  run, Phase12, and UI token narrative detail with short links to KB-365, the
  DGX runbook, and deployment.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR28: Thin DGX Phase5 Index History Block

Status: implemented in PR28.

- Thin only the 2026-05-03 DGX Resource Phase5 operator console latest-update
  block in `docs/INDEX.md`.
- Preserve reachability, but replace branch, commit, Pi5 deploy, detach run,
  Phase12, and operator/workload-transition narrative detail with short links
  to KB-365, ADR-20260503, the DGX runbook, and deployment.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR29: Thin DGX GPU Contention Index History Block

Status: implemented in PR29.

- Thin only the DGX blue vLLM and private ComfyUI GPU contention latest-update
  block in `docs/INDEX.md`.
- Preserve reachability, but replace symptom and `EXEC_PLAN.md` narrative detail
  with short links to KB-364, the DGX runbook, and deployment.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR30: Thin DGX Phase4 Index History Block

Status: implemented in PR30.

- Thin only the 2026-05-03 DGX Resource Phase4 guided orchestration
  latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace branch, Pi5 deploy, detach run, Phase12,
  and `EXEC_PLAN.md` narrative detail with short links to KB-365, the DGX
  runbook, and deployment.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR31 And Later: Thin Indexes And Split Large Documents

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
