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

### PR31: Thin DGX Phase3 Index History Block

Status: implemented in PR31.

- Thin only the 2026-05-03 DGX Resource Phase3 auxiliary runtime and
  `SET_POLICY.applyWorkloadChanges` latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace branch, representative commit, Pi5 deploy,
  detach run, Phase12, and Ansible env narrative detail with short links to
  KB-365, the DGX runbook, and deployment.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR32: Thin DGX Control Targets Index History Block

Status: implemented in PR32.

- Thin only the 2026-05-03 DGX Control Targets production-reflection
  latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace branch, commit, Pi5 deploy, detach run,
  Phase12, command, and gateway action narrative detail with short links to
  ADR-20260502, the DGX runbook, and deployment.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR33: Thin DGX Control Targets Design Index Block

Status: implemented in PR33.

- Thin only the 2026-05-02 DGX Control Targets design-summary
  latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace branch, target/API, compatibility, and
  production-reflection narrative detail with short links to ADR-20260502, the
  DGX runbook, and deployment.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR34: Thin FKOJUNST External Completion Index Block

Status: implemented in PR34.

- Thin only the 2026-05-02 FKOJUNST_Status external-completion
  latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace branch, implementation file, migration,
  and outdated `S`/`R` narrative detail with short links to KB-297,
  ADR-20260508, and deployment.
- Keep the index wording explicit that the 2026-05-02 row is historical and
  current behavior follows the 2026-05-08 revision.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR35: Thin DGX sparkHost Fallback Index Block

Status: implemented in PR35.

- Thin only the 2026-05-02 DGX `sparkHost` fallback latest-update block in
  `docs/INDEX.md`.
- Preserve reachability, but replace branch, commit, Pi5 deploy, Phase12,
  command, detach run, PR, and validation narrative detail with short links to
  KB-363, the DGX runbook, and deployment.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR36: Thin DGX Typography Index Block

Status: implemented in PR36.

- Thin only the 2026-05-02 DGX admin typography latest-update block in
  `docs/INDEX.md`.
- Preserve reachability, but replace branch, commit, Pi5 deploy, Phase12,
  command, detach run, PR, and validation narrative detail with short links to
  the DGX runbook and deployment.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR37: Thin DGX Phase2 Index Block

Status: implemented in PR37.

- Thin only the 2026-05-02 DGX Resource Phase2 latest-update block in
  `docs/INDEX.md`.
- Preserve reachability, but replace branch, commit, Pi5 deploy, Phase12,
  command, detach run, validation, and `EXEC_PLAN.md` narrative detail with
  short links to the DGX runbook and deployment.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR38: Thin Leaderboard Resource Chips Index Block

Status: implemented in PR38.

- Thin only the 2026-05-02 leaderboard resource chips join-grain
  latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace branch, commit/PR, code file, Pi deploy,
  CI, Phase12, command, detach run, and `EXEC_PLAN.md` narrative detail with
  short links to KB-297 and deployment.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR39: Thin Leaderboard Footer Resource Chips Index Block

Status: implemented in PR39.

- Thin only the 2026-05-02 leaderboard row-footer resource chips
  latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace branch, commit, Pi deploy, Phase12,
  detach run, and Web-only narrative detail with short links to KB-297 and
  deployment.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR40: Thin DGX Phase1 Index Block

Status: implemented in PR40.

- Thin only the 2026-05-01 DGX resource management console Phase1
  latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace branch, commit, Pi5 deploy, Phase12, CI,
  command, detach run, and `EXEC_PLAN.md` narrative detail with short links to
  the DGX runbook and deployment.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR41: Thin PowerAutomate Datetime Index Block

Status: implemented in PR41.

- Thin only the 2026-05-01 Gmail CSV PowerAutomate datetime compatibility
  latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace branch, commit/PR, code file, Pi5 deploy,
  Phase12, command, detach run, and `EXEC_PLAN.md` narrative detail with short
  links to KB-297, the CSV guide, and deployment.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR42: Thin Mishima Grinding No-Date Index Block

Status: implemented in PR42.

- Thin only the 2026-05-01 `ProductionSchedule_Mishima_Grinding` no-date
  latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace fixed dashboard ID, date column behavior,
  manual import run, numeric-column confirmation, and index self-link detail
  with short links to KB-297 and the CSV guide.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR43: Thin Planned End Date Index Block

Status: implemented in PR43.

- Thin only the 2026-05-01 order supplement `plannedEndDate` latest-update
  block in `docs/INDEX.md`.
- Preserve reachability, but replace commit, Pi5 deploy, Phase12, command,
  detach run, implementation, and `EXEC_PLAN.md` narrative detail with short
  links to KB-297, the CSV guide, and KB-328.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR44: Thin Order Supplement Incremental Sync Index Block

Status: implemented in PR44.

- Thin only the 2026-05-01 order supplement incremental sync latest-update
  block in `docs/INDEX.md`.
- Preserve reachability, but replace branch, PR, Pi5 deploy, Phase12, command,
  detach run, API/DB narrative, and `EXEC_PLAN.md` detail with short links to
  KB-297, KB-328, and the implementation Plan.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR45: Thin Leaderboard Completion Filter Index Block

Status: implemented in PR45.

- Thin only the 2026-04-30 leaderboard default completion filter latest-update
  block in `docs/INDEX.md`.
- Preserve reachability, but replace branch, commit, Pi5 deploy, Phase12,
  command, detach run, implementation, and `EXEC_PLAN.md` detail with short
  links to KB-297 and deployment.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR46: Thin Leaderboard Pi4 Rerender Index Block

Status: implemented in PR46.

- Thin only the 2026-04-29 leaderboard Pi4 rerender suppression latest-update
  block in `docs/INDEX.md`.
- Preserve reachability, but replace branch, commit, Pi5/Pi4 rollout,
  command, detach run, implementation, Phase12, and `EXEC_PLAN.md` detail with
  short links to KB-297 and deployment.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR47: Thin Leaderboard Seiban Panel UI Index Block

Status: implemented in PR47.

- Thin only the 2026-04-29 leaderboard seiban list panel UI latest-update block
  in `docs/INDEX.md`.
- Preserve reachability, but replace branch, commit, Pi5 rollout, command,
  detach run, implementation, Phase12, and `EXEC_PLAN.md` detail with short
  links to KB-297 and deployment.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR48: Thin Leaderboard Seiban Panel Prefix Index Block

Status: implemented in PR48.

- Thin only the 2026-04-29 leaderboard seiban list panel prefix follow-up
  latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace branch, commit, Pi5 rollout, command,
  detach run, implementation, Phase12, and `EXEC_PLAN.md` detail with short
  links to KB-297 and deployment.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR49: Thin Leaderboard Opaque Panel Index Block

Status: implemented in PR49.

- Thin only the 2026-04-29 leaderboard opaque left panel latest-update block in
  `docs/INDEX.md`.
- Preserve reachability, but replace branch, commit, Pi5 rollout, command,
  detach run, Phase12, and `EXEC_PLAN.md` detail with short links to KB-297 and
  deployment.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR50: Thin Leaderboard Seiban List Panel Index Block

Status: implemented in PR50.

- Move the remaining onsite smoke validation note for the 2026-04-29
  leaderboard seiban list panel from `docs/INDEX.md` into KB-297.
- Thin the matching latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace branch, commit, Pi5 rollout, command,
  detach run, implementation, Phase12, and `EXEC_PLAN.md` detail with short
  links to KB-297 and deployment.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR51: Thin Leaderboard Note Modal Seiban Index Block

Status: implemented in PR51.

- Move the remaining onsite smoke validation note for the 2026-04-29
  leaderboard note-modal seiban registration from `docs/INDEX.md` into KB-297.
- Thin the matching latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace branch, commit, Pi5 rollout, command,
  detach run, implementation, Phase12, and `EXEC_PLAN.md` detail with short
  links to KB-297 and deployment.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR52: Thin Inspection KPI Index Block

Status: implemented in PR52.

- Thin only the 2026-04-29 machine inspection KPI/latest-update block in
  `docs/INDEX.md`.
- Preserve reachability, but replace branch, commit, Pi5 rollout, detach run,
  Phase12, and `EXEC_PLAN.md` detail with short links to KB-360 and deployment.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR53: Thin Active Loan Layout Index Block

Status: implemented in PR53.

- Thin only the 2026-04-29 kiosk active-loan card layout latest-update block in
  `docs/INDEX.md`.
- Preserve reachability, but replace branch, commit, Pi5 rollout, command,
  detach run, implementation, Phase12, and `EXEC_PLAN.md` detail with short
  links to KB-323 and deployment.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR54: Thin Active Loan Borrowed-At Index Block

Status: implemented in PR54.

- Thin only the 2026-04-29 kiosk active-loan borrowed-at format latest-update
  block in `docs/INDEX.md`.
- Preserve reachability, but replace branch, commit, Pi5 rollout, command,
  detach run, Phase12, and `EXEC_PLAN.md` detail with short links to KB-323 and
  deployment.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR55: Thin Leaderboard Shared History Sync Index Block

Status: implemented in PR55.

- Thin only the 2026-04-29 leaderboard seiban registration / progress overview
  shared-history sync latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace branch, commit, Pi5 rollout, command,
  detach run, Phase12, and `EXEC_PLAN.md` detail with short links to KB-297 and
  deployment.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR56: Thin System CSV Schedule Index Block

Status: implemented in PR56.

- Thin only the 2026-04-29 system fixed CSV import schedule invariant
  latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace branch, commit, Pi5 rollout, command,
  detach run, Phase12, and `EXEC_PLAN.md` detail with short links to the CSV
  guide and deployment.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR57: Thin Photo Loan VLM First-Pass Index Block

Status: implemented in PR57.

- Thin only the 2026-04-28 photo loan VLM first-pass strictness latest-update
  block in `docs/INDEX.md`.
- Preserve reachability, but replace branch, commit, Pi5 rollout, command,
  detach run, Phase12, and `EXEC_PLAN.md` detail with short links to KB-319,
  the photo-loan module guide, and deployment.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR58: Thin Leaderboard Machine Name Index Block

Status: implemented in PR58.

- Thin only the 2026-04-28 kiosk leaderboard `resolvedMachineName`
  latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace branch, commit, Pi5 rollout, command,
  detach run, Phase12, PR, and `EXEC_PLAN.md` detail with short links to
  KB-350 and deployment.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR59: Thin FKOJUNST S/R List Visibility Index Block

Status: implemented in PR59.

- Thin only the 2026-04-28 production schedule FKOJUNST S/R list visibility
  latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace branch, commit, Pi5 rollout, command,
  detach run, Phase12, PR, and `EXEC_PLAN.md` detail with short links to
  KB-297 and deployment.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR60: Thin FKOJUNST Gmail Route Index Block

Status: implemented in PR60.

- Thin only the 2026-04-28 production schedule FKOJUNST_Status Gmail route
  latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace branch, commit, fixed import schedule,
  Pi5 rollout, command, detach run, Phase12, PR, and `EXEC_PLAN.md` detail
  with short links to KB-297 and deployment.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR61: Thin Pallet Preview Parity Index Block

Status: implemented in PR61.

- Thin only the 2026-04-28 pallet signage JPEG static preview parity
  latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace branch, commit, Pi5 rollout, command,
  detach run, Phase12, PR, and `EXEC_PLAN.md` detail with short links to
  KB-355, deployment, and the preview HTML.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR62: Thin Pallet Signage JPEG V3 Index Block

Status: implemented in PR62.

- Thin only the 2026-04-28 pallet signage JPEG v3 latest-update block in
  `docs/INDEX.md`.
- Preserve reachability, but replace branch, commit, Pi5 rollout, command,
  detach run, Phase12, PR, and `EXEC_PLAN.md` detail with short links to
  KB-355, deployment, and the preview HTML.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR63: Thin Pallet Signage JPEG V3 Follow-Up Index Block

Status: implemented in PR63.

- Thin only the 2026-04-28 pallet signage JPEG v3 follow-up fix
  latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace commit, Pi5 rollout, command, detach run,
  Phase12, and `EXEC_PLAN.md` detail with short links to KB-355 and
  deployment.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR64: Thin VLM Image 400 Index Block

Status: implemented in PR64.

- Thin only the 2026-04-28 VLM image 400 additional hardening latest-update
  block in `docs/INDEX.md`.
- Preserve reachability, but replace implementation, probe, timeout, tunnel,
  and `EXEC_PLAN.md` detail with short links to deployment and the DGX local
  LLM runbook.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR65: Thin DGX PR203 Index Block

Status: implemented in PR65.

- Thin only the 2026-04-27 PR #203 DGX/CI/operations documentation convergence
  latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace merge commit, Pi5 deploy command, detach
  run, CI rerun, pyenv warning, progress, and `EXEC_PLAN.md` detail with short
  links to ADR, DGX runbook, deployment, KB-357, KB-358, and KB-359.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR66: Thin Pallet Slot Geometry Index Block

Status: implemented in PR66.

- Thin only the 2026-04-25 pallet visualization board slot geometry and
  full-width lower details latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace branch, commit, deployment command,
  detach run, Phase12, manual visual-check, PR, and `EXEC_PLAN.md` detail with
  short links to KB-355 and deployment.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR67: Thin Pallet Signage JPEG Illustration Index Block

Status: implemented in PR67.

- Thin only the 2026-04-25 pallet visualization board signage JPEG renderer
  latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace branch, commit, deployment command,
  detach run, Phase12, manual visual-check, PR, and `EXEC_PLAN.md` detail with
  short links to KB-355, deployment, and preview workflow guidance.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR68: Thin Pallet Viz Card UI Index Block

Status: implemented in PR68.

- Thin only the 2026-04-25 pallet visualization item card UI latest-update
  block in `docs/INDEX.md`.
- Preserve reachability, but replace branch, commit, deployment command,
  detach run, Phase12, Pi3 note, PR, and `EXEC_PLAN.md` detail with short
  links to KB-339, KB-355, deployment, and the static preview.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR69: Thin Leaderboard Pi4 Performance Index Block

Status: implemented in PR69.

- Thin only the 2026-04-24 kiosk leaderboard Pi4 lightweight fetch and
  virtualization latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace branch, commit, per-host deployment,
  detach runs, Phase12, barcode-agent retry, PR, and `EXEC_PLAN.md` detail
  with short links to KB-297 and deployment.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR70: Thin Pallet Illustrations Volume Index Block

Status: implemented in PR70.

- Thin only the 2026-04-22 pallet machine illustrations Docker persistence
  latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace branch, commit, deployment command,
  detach run, Phase12, PR, and `EXEC_PLAN.md` detail with short links to
  KB-355 and the related KB-343 storage persistence pattern.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR71: Thin Pallet Visualization UI Index Block

Status: implemented in PR71.

- Move the 2026-04-22 kiosk pallet visualization UI component split deployment
  facts from `docs/INDEX.md` into KB-355.
- Thin the matching latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace branch, commit, per-host deployment,
  detach runs, Phase12, and `EXEC_PLAN.md` detail with short links to KB-355
  and KB-311.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR72: Thin Purchase Lookup History Index Block

Status: implemented in PR72.

- Thin only the 2026-04-21 purchase order lookup history upsert and
  `plannedStartDate` latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace branch, commit, deployment command,
  detach run, Phase12, PR, Caddy dependency-pin, and `EXEC_PLAN.md` detail
  with short links to KB-297 and KB-307.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR73: Thin Loan Report Treemap Index Block

Status: implemented in PR73.

- Thin only the 2026-04-19 admin loan report supply treemap recovery
  latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace branch, commit, deployment command,
  detach run, Phase12, smoke, CI, PR, and `EXEC_PLAN.md` detail with a short
  link to KB-354.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR74: Thin Loan Report Hardening Index Block

Status: implemented in PR74.

- Thin only the 2026-04-19 loan report API hardening latest-update block in
  `docs/INDEX.md`.
- Preserve reachability, but replace branch, commit, deployment command, detach
  run, Phase12, smoke, PR, and `EXEC_PLAN.md` detail with a short link to
  KB-354.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR75: Thin Loan Report Real Metrics Index Block

Status: implemented in PR75.

- Thin only the 2026-04-18 admin loan report real metrics and preview width
  latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace branch, commit, deployment command, detach
  run, Phase12, onsite verification, CI, PR, and `EXEC_PLAN.md` detail with a
  short link to KB-354.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR76: Thin Loan Report Gmail Send Index Block

Status: implemented in PR76.

- Thin only the 2026-04-18 admin loan report Gmail send and two-pane layout
  latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace branch, commit, deployment command, detach
  run, Phase12, onsite verification, smoke, health, CI, PR, and `EXEC_PLAN.md`
  detail with a short link to KB-354.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR77: Thin Loan Report Gmail Draft Index Block

Status: implemented in PR77.

- Thin only the 2026-04-18 admin loan report HTML preview and Gmail draft
  latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace branch, commit, deployment command, detach
  run, Phase12, onsite verification, Pi host scope, CI, PR, and `EXEC_PLAN.md`
  detail with a short link to KB-354.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR78: Thin FKOJUNST Gmail Status Index Block

Status: implemented in PR78.

- Thin only the 2026-04-16 FKOJUNST Gmail status latest-update block in
  `docs/INDEX.md`.
- Preserve reachability, but replace branch, commit, deployment sequence,
  detach runs, Phase12, Pi host scope, operations, and `EXEC_PLAN.md` detail
  with a short link to KB-297.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR79: Thin FKOJUNST Schedule Guarantee Index Block

Status: implemented in PR79.

- Thin only the 2026-04-16 FKOJUNST Gmail import schedule guarantee
  latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace branch, commit, deployment command, detach
  run, Phase12, Pi host scope, PR, and `EXEC_PLAN.md` detail with a short link
  to KB-297.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR80: Thin Signage Business Day Index Block

Status: implemented in PR80.

- Thin only the 2026-04-16 signage visualization JST 9:00 business-day
  latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace branch, commit, deployment sequence,
  detach runs, Phase12, Pi host scope, troubleshooting, and `EXEC_PLAN.md`
  detail with short links to KB-347 and the signage module document.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR81: Thin Leader Card Layout Index Block

Status: implemented in PR81.

- Thin only the 2026-04-17 kiosk leader-order resource card layout
  latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace branch, commit, deployment sequence,
  detach runs, Phase12, Pi host scope, static preview, PR, and `EXEC_PLAN.md`
  detail with short links to KB-297 and the static preview.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR82: Thin Machine Name Common API Index Block

Status: implemented in PR82.

- Thin only the 2026-04-17 production schedule `resolvedMachineName` common API
  latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace branch, commit, deployment sequence,
  detach runs, Phase12, Pi host scope, PR, and `EXEC_PLAN.md` detail with a
  short link to KB-350.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR83: Thin Gmail Dashboard Ensure Index Block

Status: implemented in PR83.

- Thin only the 2026-04-17 Gmail seiban machine-name fixed `CsvDashboard`
  ensure latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace branch, commit, deployment command,
  failed and successful detach runs, Trivy key recovery, Phase12, PR, and
  `EXEC_PLAN.md` detail with a short link to KB-350.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR84: Thin Seiban Schedule Ensure Index Block

Status: implemented in PR84.

- Thin only the 2026-04-17 seiban machine-name fixed Gmail schedule guarantee
  latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace branch, commit, incident, fix, deployment
  command, detach run, production confirmation, Phase12, and `EXEC_PLAN.md`
  detail with a short link to KB-350.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR85: Thin Seiban Machine Name Supplement Index Block

Status: implemented in PR85.

- Thin only the 2026-04-17 seiban machine-name Gmail `FHINMEI_MH_SH`
  latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace branch, commit, deployment sequence,
  detach runs, Phase12, Pi host scope, merge details, and `EXEC_PLAN.md`
  detail with short links to KB-350 and the CSV guide.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR86: Thin Kiosk Signage Preview Target Index Block

Status: implemented in PR86.

- Thin only the 2026-04-17 kiosk signage preview target selector latest-update
  block in `docs/INDEX.md`.
- Preserve reachability, but replace branch, commit, deployment sequence,
  detach runs, Phase12, Pi host scope, merge details, and `EXEC_PLAN.md`
  detail with short links to KB-349 and the signage module document.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR87: Thin Admin Signage Preview Target Index Block

Status: implemented in PR87.

- Thin only the 2026-04-17 admin signage preview client-select latest-update
  block in `docs/INDEX.md`.
- Preserve reachability, but replace branch, commit, deployment sequence,
  detach run, Phase12, Pi host scope, merge details, and `EXEC_PLAN.md`
  detail with short links to KB-348, KB-192, and the signage module document.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR88: Thin Measuring Instrument Inspection Key Index Block

Status: implemented in PR88.

- Thin only the 2026-04-17 measuring-instrument inspection-record API
  client-key latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace branch, commit, merge, root-cause,
  production follow-up, and `EXEC_PLAN.md` detail with short links to KB-346,
  the measuring-instruments UI module document, and deployment guide.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR89: Thin Kiosk Analytics UI Balance Index Block

Status: implemented in PR89.

- Thin only the 2026-04-17 kiosk analytics UI balance latest-update block in
  `docs/INDEX.md`.
- Preserve reachability, but replace branch, commit, deployment sequence,
  detach runs, Phase12, CI run, merge details, and `EXEC_PLAN.md` detail with
  short links to KB-334 and deployment guide.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR90: Thin Instrument Borrow NFC Race Index Block

Status: implemented in PR90.

- Thin only the 2026-04-16 measuring-instrument borrow second-NFC race
  latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace branch, CI run, deployment sequence,
  recovery run detail, onsite checks, and implementation explanation with
  short links to KB-345, the measuring-instruments UI module document, and
  deployment guide.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR91: Thin Kiosk Analytics Four Panel Index Block

Status: implemented in PR91.

- Thin only the 2026-04-15 kiosk analytics four-panel and period-events
  latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace branch, commit, deployment sequence,
  dirty-tree deployment note, detach runs, Phase12, and `EXEC_PLAN.md` detail
  with short links to KB-334 and deployment guide.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR92: Thin Unified Loan Analytics Index Block

Status: implemented in PR92.

- Thin only the 2026-04-14 kiosk unified loan analytics latest-update block in
  `docs/INDEX.md`.
- Preserve reachability, but replace API contract details, merge source,
  deployment sequence, Phase12, and `EXEC_PLAN.md` detail with short links to
  KB-344, the measuring-instruments UI module document, and deployment guide.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR93: Thin Measuring Instrument Genre Image Persistence Index Block

Status: implemented in PR93.

- Thin only the 2026-04-14 measuring-instrument genre image persistence
  latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace branch, PR, detach run, bind mount,
  best-effort rescue, Phase12, and `EXEC_PLAN.md` detail with short links to
  KB-343, the measuring-instruments UI module document, and deployment guide.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR94: Thin Measuring Instrument Genres Index Block

Status: implemented in PR94.

- Thin only the 2026-04-14 measuring-instrument genres latest-update block in
  `docs/INDEX.md`.
- Preserve reachability, but replace branch, commit, migration, CRUD/profile,
  protected-image, deployment, detach run, Phase12, and `EXEC_PLAN.md` detail
  with short links to the plan and measuring-instruments module documents.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR95: Thin Mobile Placement V22 Index Block

Status: implemented in PR95.

- Thin only the 2026-04-13 mobile placement V22 latest-update block in
  `docs/INDEX.md`.
- Preserve reachability, but replace branch, commit, deployment scope,
  Phase12, detach-run pointer, and `EXEC_PLAN.md` detail with short links to
  the mobile placement runbook and KB-339.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR96: Thin Mobile Placement V21 Index Block

Status: implemented in PR96.

- Thin only the 2026-04-13 mobile placement V21 latest-update block in
  `docs/INDEX.md`.
- Preserve reachability, but replace branch, commit, deployment scope,
  Phase12, detach-run pointer, and `EXEC_PLAN.md` detail with short links to
  the mobile placement runbook and KB-339.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR97: Thin Mobile Placement V20 Index Block

Status: implemented in PR97.

- Thin only the 2026-04-13 mobile placement V20 latest-update block in
  `docs/INDEX.md`.
- Preserve reachability, but replace branch, commit, deployment scope,
  Phase12, detach-run pointer, API note, and `EXEC_PLAN.md` detail with short
  links to the mobile placement runbook, KB-339, and API document.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR98: Thin Mobile Placement V19 Index Block

Status: implemented in PR98.

- Thin only the 2026-04-13 mobile placement V19 latest-update block in
  `docs/INDEX.md`.
- Preserve reachability, but replace branch, commit, deployment scope,
  Phase12, detach-run pointer, API note, and `EXEC_PLAN.md` detail with short
  links to the mobile placement runbook, KB-339, and API document.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR99: Thin Mobile Placement V17 Index Block

Status: implemented in PR99.

- Thin only the 2026-04-13 mobile placement V17 latest-update block in
  `docs/INDEX.md`.
- Preserve reachability, but replace branch, commit, deployment scope,
  Phase12, detach-run pointer, API note, and `EXEC_PLAN.md` detail with short
  links to the mobile placement runbook, KB-339, and API document.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR100: Thin Mobile Placement V16 Index Block

Status: implemented in PR100.

- Thin only the 2026-04-13 mobile placement V16 latest-update block in
  `docs/INDEX.md`.
- Preserve reachability, but replace branch, commit, deployment scope,
  Phase12, detach-run and spot-check detail, API note, and `EXEC_PLAN.md`
  detail with short links to the mobile placement runbook, KB-339, and API
  document.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR101: Thin Mobile Placement V15 Index Block

Status: implemented in PR101.

- Thin only the 2026-04-13 mobile placement V15 latest-update block in
  `docs/INDEX.md`.
- Preserve reachability, but replace branch, commit, deployment scope,
  Phase12, detach-run pointer, preview note, and `EXEC_PLAN.md` detail with
  short links to the mobile placement runbook, KB-339, and static design
  preview.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR102: Thin Mobile Placement V14 Index Block

Status: implemented in PR102.

- Thin only the 2026-04-13 mobile placement V14 latest-update block in
  `docs/INDEX.md`.
- Preserve reachability, but replace branch, commit, deployment scope,
  Phase12, DB migration note, detach-run pointer, and `EXEC_PLAN.md` detail
  with short links to the mobile placement runbook, KB-339, and API document.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR103: Thin Mobile Placement V13 Index Block

Status: implemented in PR103.

- Thin only the 2026-04-13 mobile placement V13 latest-update block in
  `docs/INDEX.md`.
- Preserve reachability, but replace branch, commit, deployment scope,
  Phase12, detach-run pointer, preview note, and `EXEC_PLAN.md` detail with
  short links to the mobile placement runbook, KB-339, and static design
  preview.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR104: Thin Mobile Placement V12 Index Block

Status: implemented in PR104.

- Thin only the 2026-04-13 mobile placement V12 latest-update block in
  `docs/INDEX.md`.
- Preserve reachability, but replace branch, commit, deployment scope,
  Phase12, detach-run pointer, and `EXEC_PLAN.md` detail with short links to
  the mobile placement runbook, KB-339, and API document.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR105: Thin Mobile Placement V11 Index Block

Status: implemented in PR105.

- Thin only the 2026-04-13 mobile placement V11 latest-update block in
  `docs/INDEX.md`.
- Preserve reachability, but replace parser implementation notes and repeated
  API / KB pointers with short links to the mobile placement runbook, KB-339,
  and API document.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR106: Thin Mobile Placement V9 Index Block

Status: implemented in PR106.

- Thin only the 2026-04-13 mobile placement V9 latest-update block in
  `docs/INDEX.md`.
- Preserve reachability, but replace branch, commit, deployment scope,
  Phase12, detach-run pointer, and `EXEC_PLAN.md` detail with short links to
  the mobile placement runbook, KB-339, and API document.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR107 And Later: Thin Indexes And Split Large Documents

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
