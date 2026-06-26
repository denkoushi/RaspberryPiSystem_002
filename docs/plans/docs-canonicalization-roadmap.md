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

### PR107: Thin Mobile Placement V8 Index Block

Status: implemented in PR107.

- Thin only the 2026-04-13 mobile placement V8 latest-update block in
  `docs/INDEX.md`.
- Preserve reachability, but replace branch, commit, deployment scope,
  Phase12, detach-run pointer, and `EXEC_PLAN.md` detail with short links to
  the mobile placement runbook, KB-339, and API document.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR108: Thin Mobile Placement V7 Index Block

Status: implemented in PR108.

- Thin only the 2026-04-13 mobile placement V7 latest-update block in
  `docs/INDEX.md`.
- Preserve reachability, but replace branch, commit, deployment scope,
  Phase12, detach-run pointer, and `EXEC_PLAN.md` detail with short links to
  the mobile placement runbook, KB-339, and API document.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR109: Thin Mobile Placement V6 Index Block

Status: implemented in PR109.

- Thin only the 2026-04-13 mobile placement V6 latest-update block in
  `docs/INDEX.md`.
- Preserve reachability, but replace branch, commit, deployment scope,
  Phase12, detach-run pointer, and `EXEC_PLAN.md` detail with short links to
  the mobile placement runbook, KB-339, and API document.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR110: Thin API OCR/VLM Boundary Index Block

Status: implemented in PR110.

- Thin only the 2026-04-13 API OCR/VLM boundary latest-update block in
  `docs/INDEX.md`.
- Preserve reachability, but replace branch, commit, rollout order, Phase12,
  implementation-summary, and `EXEC_PLAN.md` detail with short links to
  KB-340, ADR-20260402, and the deployment guide.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR111: Thin Dropbox Backup Production Index Block

Status: implemented in PR111.

- Thin only the 2026-04-10 Dropbox backup production latest-update block in
  `docs/INDEX.md`.
- Preserve reachability, but replace branch, Pi5 deployment, Phase12,
  detach-run, and smoke-check detail with short links to KB-338 and the
  deployment guide.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR112: Thin Dropbox Backup API Index Block

Status: implemented in PR112.

- Thin only the 2026-04-10 Dropbox backup API / `coverage_gap`
  latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace `backup.json` compatibility,
  derived-cache, disabled-target, management UI, and `EXEC_PLAN.md` detail with
  short links to KB-338 and the backup API document.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR113: Thin Kiosk Analytics Month Filter Index Block

Status: implemented in PR113.

- Thin only the 2026-04-14 kiosk analytics month-picker and per-tab asset
  filter latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace branch, commit, rollout order, detach-run,
  Phase12, and `EXEC_PLAN.md` detail with short links to KB-334 and the
  deployment guide.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR114: Thin Kiosk Analytics Photo Tab Index Block

Status: implemented in PR114.

- Thin only the 2026-04-09 kiosk analytics photo-tab display-name aggregation
  latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace commit, Pi5 deployment, detach-run,
  Phase12, smoke-test, and `EXEC_PLAN.md` detail with short links to KB-334
  and the deployment guide.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR115: Thin Kiosk Documents Scroll Stability Index Block

Status: implemented in PR115.

- Thin only the 2026-04-09 kiosk documents viewer vertical-scroll stability
  latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace branch, Pi5 deployment, detach-run,
  Phase12, Trivy exception, manual-check, KB index, and `EXEC_PLAN.md` detail
  with short links to KB-313 and the kiosk documents runbook.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR116: Thin Photo VLM Active Assist Index Block

Status: implemented in PR116.

- Thin only the 2026-04-09 photo-loan VLM active-assist latest-update block in
  `docs/INDEX.md`.
- Preserve reachability, but replace env, vault, force-recreate, diagnosis,
  threshold, backup, Ansible follow-up, and `EXEC_PLAN.md` detail with short
  links to KB-319 and the deployment guide.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR117: Thin Pi4 Firefox Browser Chrome Index Block

Status: implemented in PR117.

- Thin only the 2026-04-08 Pi4 Firefox kiosk browser chrome minimization
  latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace implementation, Ansible distribution,
  rollout, OS-panel, and browser-reveal detail with short links to KB-336 and
  the kiosk Wi-Fi/panel runbook.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR118: Thin Mobile Placement Parts Shelf Signage Index Block

Status: implemented in PR118.

- Thin only the 2026-04-08 / 2026-04-13
  `mobile_placement_parts_shelf_grid` latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace feature summary, rollout order, follow-up
  PRs, detach-run, Phase12, and preview detail with short links to the signage
  guide, KB-341, and the deployment guide.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR119: Thin Signage Leader Header Index Block

Status: implemented in PR119.

- Thin only the 2026-05-21 signage `kiosk_leader_order_cards` header full
  machine-name latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace commit, API-only scope, Pi5 rollout,
  detach-run, Phase12, onsite visual check, and `EXEC_PLAN.md` detail with
  short links to KB-335 and the deployment guide.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR120: Thin Signage Leader 5x2 Grid Index Block

Status: implemented in PR120.

- Thin only the 2026-05-21 signage `kiosk_leader_order_cards` 5x2 grid
  latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace branch, API/admin-Web scope, Pi5 rollout,
  detach-run, CI, Phase12, PR, and `EXEC_PLAN.md` detail with short links to
  KB-335 and the deployment guide.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR121: Thin Signage Leader Due Date Index Block

Status: implemented in PR121.

- Thin only the 2026-05-21 signage `kiosk_leader_order_cards` due-date display
  latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace branch, Pi5 rollout, detach-run, CI,
  Phase12, PR, and `EXEC_PLAN.md` detail with short links to KB-335 and the
  deployment guide.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR122: Thin Signage Leader Compact Incomplete Index Block

Status: implemented in PR122.

- Thin only the 2026-05-21 signage `kiosk_leader_order_cards` compact
  incomplete latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace branch, Pi5 rollout, detach-run, CI,
  Phase12, PR, static preview, and `EXEC_PLAN.md` detail with short links to
  KB-335 and the deployment guide.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR123: Thin Signage Leader Kiosk Aligned Index Block

Status: implemented in PR123.

- Thin only the 2026-05-21 signage `kiosk_leader_order_cards` kiosk-aligned
  latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace branch, Pi5 rollout, detach-run, Phase12,
  PR, static preview, and `EXEC_PLAN.md` detail with short links to KB-335 and
  the deployment guide.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR124: Thin Signage Leader Readability Index Block

Status: implemented in PR124.

- Thin only the 2026-04-08 signage `kiosk_leader_order_cards` factory
  readability and SOLID split latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace branch, Pi5 rollout, detach-run, Phase12,
  PR, static preview path, and `EXEC_PLAN.md` detail with short links to
  KB-335, the deployment guide, and design preview index.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR125: Thin Signage Leader 4x8 Index Block

Status: implemented in PR125.

- Thin only the 2026-04-08 signage `kiosk_leader_order_cards` 4x2 max8
  latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace branch, Pi5 rollout, detach-run, Phase12,
  and `EXEC_PLAN.md` detail with short links to KB-335, the deployment guide,
  and PR #95.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR126: Thin Signage Leader Initial JPEG Index Block

Status: implemented in PR126.

- Thin only the 2026-04-07 signage `kiosk_leader_order_cards` initial JPEG
  latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace feature summary, branch, Pi5 rollout,
  detach-run, Phase12, main-merge note, and `EXEC_PLAN.md` detail with short
  links to KB-335 and the deployment guide.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR127: Thin Signage Target Client UI Index Block

Status: implemented in PR127.

- Thin only the 2026-04-07 signage target-client management UI latest-update
  block in `docs/INDEX.md`.
- Preserve reachability, but replace branch, Pi5 rollout, detach-run, Phase12,
  representative-file detail, and `EXEC_PLAN.md` detail with short links to
  ADR-20260407, the signage KB, the deployment guide, and PR #89.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR128: Thin Signage Target Client Schedule Index Block

Status: implemented in PR128.

- Thin only the 2026-04-07 signage target-client schedule and render-cache
  latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace branch, rollout, Phase12, Pi3 note,
  development caveat, and `EXEC_PLAN.md` detail with short links to
  ADR-20260407, the signage KB, and the deployment guide.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR129: Thin Signage Compact24 Footer Index Block

Status: implemented in PR129.

- Thin only the 2026-04-07 signage `splitCompact24` footer and kiosk cancel
  readability latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace branch, rollout, Phase12, deploy caveat,
  and `EXEC_PLAN.md` detail with short links to KB-333 and the deployment
  guide.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR130: Thin Kiosk Analytics Index Block

Status: implemented in PR130.

- Thin only the 2026-04-07 kiosk analytics latest-update block in
  `docs/INDEX.md`.
- Preserve reachability, but replace feature summary and `EXEC_PLAN.md` detail
  with short links to KB-334 and the deployment guide.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR131: Thin Kiosk Loan Card Surface Index Block

Status: implemented in PR131.

- Thin only the 2026-04-06 kiosk active-loan card modern surface latest-update
  block in `docs/INDEX.md`.
- Preserve reachability, but replace branch, rollout, Pi5-hop verification, and
  `EXEC_PLAN.md` detail with short links to KB-332 and the deployment guide.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR132: Thin Kiosk Compact Loan Lines Index Block

Status: implemented in PR132.

- Thin only the 2026-04-06 kiosk active-loan compact line notation
  latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace branch, rollout, smoke verification,
  deployment caveat, and `EXEC_PLAN.md` detail with short links to KB-330 and
  the deployment guide.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR133: Thin Part Measurement Multi Sheet Index Block

Status: implemented in PR133.

- Thin only the 2026-04-05 kiosk part-measurement multi-sheet latest-update
  block in `docs/INDEX.md`.
- Preserve reachability, but replace branch, rollout, Phase12, detach-run,
  timeout troubleshooting, and `EXEC_PLAN.md` detail with short links to
  KB-320 and the part-measurement runbook.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR134: Thin Part Measurement In Progress Index Block

Status: implemented in PR134.

- Thin only the 2026-04-05 kiosk part-measurement in-progress draft list
  latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace branch, rollout, Phase12, deployment
  troubleshooting, and `EXEC_PLAN.md` detail with short links to KB-320 and
  the part-measurement runbook.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR135: Thin Part Measurement FHINMEI Partial Match Index Block

Status: implemented in PR135.

- Thin only the 2026-04-05 kiosk part-measurement `FHINMEI_ONLY` partial-match
  latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace branch, rollout, Phase12, Pi3 warning
  note, and `EXEC_PLAN.md` detail with short links to ADR-20260404, KB-320,
  and the verification checklist.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR136: Thin Web Caddy Go-Jose Index Block

Status: implemented in PR136.

- Thin only the 2026-04-04 Web/Caddy `go-jose` CVE-2026-34986
  latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace commit, deploy scope, Phase12 timing,
  and `EXEC_PLAN.md` detail with short links to KB-307, the deployment guide,
  and the verification checklist.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR137: Thin Part Measurement Template Picker Index Block

Status: implemented in PR137.

- Thin only the 2026-04-04 kiosk part-measurement template picker
  latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace branch, API endpoint list, rollout,
  Phase12, deploy-status note, ICMP note, and `EXEC_PLAN.md` detail with short
  links to ADR-20260404, KB-320, the runbook, static preview, and the
  verification checklist.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR138: Thin Part Measurement Template Clone Index Block

Status: implemented in PR138.

- Thin only the 2026-04-04 kiosk part-measurement `clone-for-schedule-key`
  latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace branch, rollout, Phase12, detach-run,
  and `EXEC_PLAN.md` detail with short links to ADR-20260404, KB-320, the
  runbook, and the verification checklist.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR139: Thin Part Measurement Top Strip Index Block

Status: implemented in PR139.

- Thin only the 2026-04-04 kiosk part-measurement edit top-strip
  latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace branch, rollout, Phase12, detach-run,
  and `EXEC_PLAN.md` detail with short links to KB-320, the static preview,
  design-preview index, and the verification checklist.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR140: Thin Part Measurement Drawing Persistence Index Block

Status: implemented in PR140.

- Thin only the 2026-04-03 kiosk part-measurement drawing persistence and Pi5
  rerun recovery latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace branch, bind-mount details, rerun
  recovery detail, CI note, and `EXEC_PLAN.md` detail with short links to
  KB-320, KB-329, and the deployment guide.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR141: Thin Leaderboard Child Row Index Block

Status: implemented in PR141.

- Thin only the 2026-04-03 kiosk leader-order child row layout
  latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace branch, implementation file list, API
  contract note, deployment sequence, detach runs, Phase12, and `EXEC_PLAN.md`
  detail with short links to KB-297, the verification checklist, and the
  deployment guide.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR142: Thin Signage Split Compact24 Loan Card Index Block

Status: implemented in PR142.

- Thin only the 2026-04-03 signage `splitCompact24` loan-card
  latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace branch, preview instructions, Pi5 API
  source-of-truth note, deployment lock, worktree permission note, and
  `EXEC_PLAN.md` detail with short links to KB-325, the static preview, and
  the deployment guide.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR143: Thin Signage Loan Grid Engine Index Block

Status: implemented in PR143.

- Thin only the 2026-04-03 signage loan-grid `SIGNAGE_LOAN_GRID_ENGINE`
  latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace branch, env default, Ansible `docker.env`,
  API recreation, KB-318 comparison, and `EXEC_PLAN.md` detail with short
  links to KB-327, ADR-20260405, and the deployment guide.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR144: Thin Signage Loan Grid HTML Structure Index Block

Status: implemented in PR144.

- Thin only the 2026-04-03 signage Playwright loan-grid HTML structure
  latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace commit, implementation-token list,
  rollout, Phase12, and detailed verification text with short links to
  KB-327, the verification checklist, and the deployment guide.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR145: Thin Signage Loan Grid Modern Chrome Index Block

Status: implemented in PR145.

- Thin only the 2026-04-03 signage loan-grid HTML modern chrome
  latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace branch, StoneBase-only deploy detail,
  detach run, systemd smoke note, and `EXEC_PLAN.md` detail with short links to
  KB-331, KB-327, and the deployment guide.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR146: Thin Leaderboard Shared History Notes Machine Names Index Block

Status: implemented in PR146.

- Thin only the 2026-04-02 kiosk leader-order shared `search-state`, child-row
  note, and `seiban-machine-names` latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace branch, API/Web, rollout, Phase12, and
  `EXEC_PLAN.md` detail with short links to KB-297, the verification checklist,
  and the deployment guide.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR147: Thin Leaderboard Due Assist Stack Index Block

Status: implemented in PR147.

- Thin only the 2026-04-02 kiosk leader-order due-assist left two-stage stack
  and `overlayZIndex` latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace branch, API-change note, rollout,
  Phase12, and `EXEC_PLAN.md` detail with short links to KB-297, the
  verification checklist, and the deployment guide.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR148: Thin Leaderboard Due Assist Detail Index Block

Status: implemented in PR148.

- Thin only the 2026-04-02 kiosk leader-order due-assist seiban search and
  detail-sheet latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace branch, Web implementation, rollout,
  detach-run, Phase12, and `EXEC_PLAN.md` detail with short links to KB-297,
  the verification checklist, and the deployment guide.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR149: Thin Photo Loan VLM Active Assist Index Block

Status: implemented in PR149.

- Thin only the 2026-04-02 photo-loan VLM active-assist gallery-row gate
  latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace branch, default-off compatibility,
  Pi5-only rollout, Phase12, and `EXEC_PLAN.md` detail with short links to
  KB-319, ADR-20260404, the verification checklist, and the deployment guide.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR150: Thin Photo Loan VLM Active Assist Ansible Index Block

Status: implemented in PR150.

- Thin only the photo-loan VLM active-assist Ansible vault-to-inventory wiring
  latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace branch, default-off behavior, Pi5-only
  Phase12, and `EXEC_PLAN.md` detail with short links to KB-319 and the
  deployment guide.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR151: Thin Leaderboard UX Polish Index Block

Status: implemented in PR151.

- Thin only the 2026-04-02 kiosk leader-order UX polish latest-update block in
  `docs/INDEX.md`.
- Preserve reachability, but replace branch, Web implementation, rollout,
  Phase12, and `EXEC_PLAN.md` detail with short links to KB-297, the
  verification checklist, and the deployment guide.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR152: Thin Leaderboard Fast Path Index Block

Status: implemented in PR152.

- Thin only the 2026-04-02 kiosk leader-order React Query
  `leaderBoardFastPath` latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace branch, Web implementation, rollout,
  Phase12, and `EXEC_PLAN.md` detail with short links to KB-297, the
  verification checklist, and the deployment guide.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR153: Thin Leaderboard Row Actions Index Block

Status: implemented in PR153.

- Thin only the 2026-04-02 kiosk leader-order row actions and machine-name
  fallback latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace branch, Web implementation, rollout,
  Phase12, and `EXEC_PLAN.md` detail with short links to KB-297, the
  verification checklist, and the deployment guide.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR154: Thin Effective Due Date Index Block

Status: implemented in PR154.

- Thin only the 2026-04-01 production schedule `effectiveDueDate` and planned
  columns latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace branch, PR, rollout, Phase12, detach run,
  and `EXEC_PLAN.md` detail with short links to KB-297, the verification
  checklist, and the deployment guide.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR155: Thin Planned Supplement Index Block

Status: implemented in PR155.

- Thin only the 2026-04-01 production schedule order supplement CSV
  latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace branch, rollout, detach run, Phase12,
  production Gmail setup, and `EXEC_PLAN.md` detail with short links to KB-297,
  the CSV guide, and the verification checklist.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR156: Thin Photo Gallery Seed Index Block

Status: implemented in PR156.

- Thin only the 2026-04-01 photo loan gallery seed latest-update block in
  `docs/INDEX.md`.
- Preserve reachability, but replace branch, rollout, Phase12, manual
  production confirmation, and `EXEC_PLAN.md` detail with short links to KB-319,
  the photo-loan module doc, and the verification checklist.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR157: Thin Signage Schedule Admin Index Block

Status: implemented in PR157.

- Thin only the 2026-04-01 signage schedule management latest-update block in
  `docs/INDEX.md`.
- Preserve reachability, but replace public/management API explanation, branch,
  rollout, detach run, Phase12, and `EXEC_PLAN.md` detail with short links to
  KB-322, the verification checklist, and the deployment guide.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR158: Thin Signage Progress Overview Index Block

Status: implemented in PR158.

- Thin only the 2026-03-31 signage `kiosk_progress_overview` latest-update block
  in `docs/INDEX.md`.
- Preserve reachability, but replace branch, API/Web implementation, rollout,
  Phase12, and `EXEC_PLAN.md` detail with short links to KB-321, the
  verification checklist, and the deployment guide.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR159: Thin Registered Seiban History Index Block

Status: implemented in PR159.

- Thin only the 2026-03-30 production schedule registered-seiban shared history
  limit latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace shared-types implementation, rollout,
  Phase12, Trivy, and `EXEC_PLAN.md` detail with short links to KB-231, KB-297,
  and the deployment guide.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR160: Thin Local LLM On Demand Index Block

Status: implemented in PR160.

- Thin only the 2026-03-30 LocalLLM on-demand runtime latest-update block in
  `docs/INDEX.md`.
- Preserve reachability, but replace runtime-control wiring, production smoke,
  troubleshooting, admin Chat follow-up, Phase12, and `EXEC_PLAN.md` detail with
  short links to ADR-20260403, the LocalLLM runbook, KB-318, and KB-313.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR161: Thin Part Measurement Visual Template Index Block

Status: implemented in PR161.

- Thin only the 2026-03-30 kiosk part-measurement visual template latest-update
  block in `docs/INDEX.md`.
- Preserve reachability, but replace branch, Prisma/storage implementation,
  rollout, Phase12, deploy-log note, and `EXEC_PLAN.md` detail with short
  links to ADR-20260330, KB-320, the part-measurement runbook, and the
  verification checklist.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR162: Thin Photo Review Knowledge Index Block

Status: implemented in PR162.

- Thin only the 2026-03-30 photo-loan human review, GOOD gallery, similar
  candidates, and shadow-threshold operations-knowledge latest-update block in
  `docs/INDEX.md`.
- Preserve reachability, but replace the review semantics, canonical-label
  detail, threshold comparison, and `EXEC_PLAN.md` detail with short links to
  KB-319, the photo-loan module doc, and the similarity-gallery runbook.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR163: Thin Photo Embedding Rollout Index Block

Status: implemented in PR163.

- Thin only the 2026-03-29 photo-loan embedding production wiring, GOOD
  backfill, and shadow-observation runbook latest-update block in
  `docs/INDEX.md`.
- Preserve reachability, but replace branch, merge, Pi5-only rollout,
  Phase12, and `EXEC_PLAN.md` detail with short links to the
  similarity-gallery runbook, KB-319, and the deployment guide.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR164: Thin Kiosk Document Barcode Index Block

Status: implemented in PR164.

- Thin only the 2026-03-29 kiosk documents barcode-scan latest-update block in
  `docs/INDEX.md`.
- Preserve reachability, but replace ZXing implementation, rollout, Phase12,
  manual Pi4 verification, and `EXEC_PLAN.md` detail with short links to
  KB-313, ADR-20260329, and the kiosk-documents runbook.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR165: Thin Photo VLM Gallery Index Block

Status: implemented in PR165.

- Thin only the 2026-03-28 photo-loan VLM initial release, phase1 human review,
  Vision input, and similar-candidates gallery latest-update block in
  `docs/INDEX.md`.
- Preserve reachability, but replace VLM storage, review/display semantics,
  candidate API, real-device smoke, and `EXEC_PLAN.md` detail with short links
  to the photo-loan module doc, KB-319, ADR-20260330, and the
  similarity-gallery runbook.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR166: Thin Docs Placement Policy Index Block

Status: implemented in PR166.

- Thin only the 2026-03-28 host-role `docs/` placement policy latest-update
  block in `docs/INDEX.md`.
- Preserve reachability, but replace Ansible condition, Pi5/Pi4/Pi3
  verification detail, and `EXEC_PLAN.md` detail with short links to the
  infrastructure KB, deployment guide, and deploy-status runbook.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR167: Thin Admin Local LLM Index Block

Status: implemented in PR167.

- Thin only the 2026-03-28 admin LocalLLM UI, credential rotation, sequential
  rollout, and real-device verification latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace branch, PR, rollout, smoke results,
  localhost debug note, and `EXEC_PLAN.md` detail with short links to the
  LocalLLM runbook and KB-318.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR168: Thin Local LLM Observability Index Block

Status: implemented in PR168.

- Thin only the 2026-03-28 Pi5 LocalLLM observability, operations ADR, and
  real-device smoke latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace observability implementation, rollout,
  status smoke, health example, and `EXEC_PLAN.md` detail with short links to
  ADR-20260329 and the LocalLLM runbook.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR169: Thin Local LLM Ansible Env Index Block

Status: implemented in PR169.

- Thin only the 2026-03-28 Pi5 API `LOCAL_LLM_*` Ansible wiring latest-update
  block in `docs/INDEX.md`.
- Preserve reachability, but replace compose env-path detail, server-role
  deploy validation, and `EXEC_PLAN.md` detail with short links to KB-318 and
  the deployment guide.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR170: Thin Local LLM Proxy Index Block

Status: implemented in PR170.

- Thin only the 2026-03-28 Pi5 API to Ubuntu LocalLLM proxy connectivity
  latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace route list, header forwarding, gateway
  normalization, real connectivity result, local override note, and
  `EXEC_PLAN.md` detail with short links to the LocalLLM runbook and KB-317.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR171: Thin Ubuntu Local LLM Sidecar Index Block

Status: implemented in PR171.

- Thin only the 2026-03-28 Ubuntu LocalLLM dedicated-node Tailscale sidecar
  latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace host isolation, internal ports, ACL,
  compose-log leakage, restart-loop, and `EXEC_PLAN.md` detail with short links
  to KB-317, ADR-20260328, the LocalLLM runbook, and the Tailscale policy.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR172: Thin Pi4 FJV Third Kiosk Index Block

Status: implemented in PR172.

- Thin only the 2026-03-28 Pi4 FJV60/80 third-kiosk addition latest-update
  block in `docs/INDEX.md`.
- Preserve reachability, but replace inventory, client registration, staged
  deploy, Phase12 extension, route troubleshooting, and `EXEC_PLAN.md` detail
  with short links to KB-315, the client setup guide, and deploy-status runbook.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR173: Thin Pi4 StoneBase Fourth Kiosk Index Block

Status: implemented in PR173.

- Thin only the 2026-03-28 Pi4 StoneBase01 fourth-kiosk addition latest-update
  block in `docs/INDEX.md`.
- Preserve reachability, but replace Tailscale address, client registration,
  staged deploy, Docker bootstrap recovery, service status, and `EXEC_PLAN.md`
  detail with short links to KB-316, deploy-status, and the deployment guide.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR174: Thin Kiosk Document Hover Toolbar Index Block

Status: implemented in PR174.

- Thin only the 2026-03-27 kiosk documents viewer hover toolbar and list
  summary tooltip latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace implementation, PR, rollout, Phase12,
  KB-index, and `EXEC_PLAN.md` detail with short links to KB-313 and the
  kiosk-documents runbook.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR175: Thin Kiosk Document Number Summary Index Block

Status: implemented in PR175.

- Thin only the 2026-03-27 kiosk documents document-number, summary candidate,
  confirmed summary, search extension, and admin/list latest-update block in
  `docs/INDEX.md`.
- Preserve reachability, but replace migration, OCR ownership, rollout,
  Phase12, KB-index, and `EXEC_PLAN.md` detail with short links to KB-313 and
  the kiosk-documents runbook.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR176: Thin Kiosk Document Detail Cache Index Block

Status: implemented in PR176.

- Thin only the 2026-03-27 kiosk documents page-position reset and detail
  query cache latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace PR, web-only deployment, Phase12,
  onsite confirmation, and `EXEC_PLAN.md` detail with short links to KB-313,
  ADR-20260327, and the kiosk-documents runbook.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR177: Thin Kiosk Document Viewer Performance Index Block

Status: implemented in PR177.

- Thin only the 2026-03-26 kiosk documents viewer performance and scroll
  improvement latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace implementation identifiers, staged
  deployment, Phase12, and `EXEC_PLAN.md` detail with short links to KB-313
  and the kiosk-documents runbook.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR178: Thin Tool Loan Client Correction Index Block

Status: implemented in PR178.

- Thin only the 2026-03-25 tool-loan active loan `clientId` correction API
  latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace endpoint behavior, staged deployment,
  Phase12, and `EXEC_PLAN.md` detail with short links to the tool-loan KB and
  deploy-status runbook.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR179: Thin Rigging IdNum Index Block

Status: implemented in PR179.

- Thin only the 2026-03-24 rigging master `idNum` and active-loan card layout
  latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace behavior, partial deployment,
  RoboDrill01 follow-up, local worktree, verification checklist, and
  `EXEC_PLAN.md` detail with short links to KB-312 and deploy-status.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR180: Thin Actual Hours Baseline Index Block

Status: implemented in PR180.

- Thin only the 2026-03-23 actual-hours baseline estimation latest-update
  block in `docs/INDEX.md`.
- Preserve reachability, but replace implementation strategy, regression-test,
  and `EXEC_PLAN.md` detail with short links to KB-297 and ADR-20260323.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR181: Thin Progress Overview Due Overlap Index Block

Status: implemented in PR181.

- Thin only the 2026-03-23 progress overview due-date and resource chip
  overlap prevention latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace layout constants, PR, staged deployment,
  Phase12, and `EXEC_PLAN.md` detail with short links to KB-297 and
  deploy-status.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR182: Thin Progress Overview Due Compact Index Block

Status: implemented in PR182.

- Thin only the 2026-03-23 progress overview compact due-date and resource
  chip spacing latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace implementation-file, commit, staged
  deployment, Phase12, and `EXEC_PLAN.md` detail with short links to KB-297
  and deploy-status.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR183: Thin Manual Order FKOJUN Index Block

Status: implemented in PR183.

- Thin only the 2026-03-23 manual-order overview FKOJUN-only process label
  latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace API/Web behavior, branch, staged
  deployment, Phase12, and `EXEC_PLAN.md` detail with short links to KB-297
  and deploy-status.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR184: Thin Manual Order Card Header Index Block

Status: implemented in PR184.

- Thin only the 2026-03-23 manual-order overview two-line card header and
  hover-collapsed overview latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace implementation-file, branch, commit,
  staged deployment, Phase12, and `EXEC_PLAN.md` detail with short links to
  KB-297 and deploy-status.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR185: Thin Production Dropdown Portal Index Block

Status: implemented in PR185.

- Thin only the 2026-03-23 production schedule registered-seiban and resource
  dropdown Portal latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace implementation-file, commit, CI,
  staged deployment, Phase12, and `EXEC_PLAN.md` detail with short links to
  KB-297 and deploy-status.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR186: Thin Manual Order SiteKey Priority Index Block

Status: implemented in PR186.

- Thin only the 2026-03-23 manual-order overview assigned-resource siteKey
  priority latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace implementation-file, test, branch,
  deploy logs, Phase12, and `EXEC_PLAN.md` detail with short links to KB-297
  and deploy-status.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR187: Thin SiteKey Sync Index Block

Status: implemented in PR187.

- Thin only the 2026-03-23 manual-order and global-rank siteKey canonical
  synchronization latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace API boundary, fallback, branch, run IDs,
  Phase12, onsite API checks, and `EXEC_PLAN.md` detail with short links to
  ADR-20260323, KB-297, and deploy-status.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR188: Thin Manual Order Target Scope Index Block

Status: implemented in PR188.

- Thin only the 2026-03-23 manual-order Pi4 lower-pane targetDeviceScopeKey
  latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace implementation-file, API error,
  branch, run IDs, Phase12, and `EXEC_PLAN.md` detail with short links to
  KB-297 and deploy-status.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR189: Thin Progress Overview Five Columns Index Block

Status: implemented in PR189.

- Thin only the 2026-03-22 progress overview five-column layout and ICMP retry
  latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace implementation-file, production run IDs,
  Phase12, ping retry knowledge, and `EXEC_PLAN.md` detail with short links to
  KB-297 and deploy-status.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR190: Thin Production Schedule Toolbar Hover Index Block

Status: implemented in PR190.

- Thin only the 2026-03-21 production schedule search/resource filter hover
  toolbar latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace implementation-file, E2E, CORS,
  branch, deployment, Phase12, and `EXEC_PLAN.md` detail with short links to
  KB-297 and deploy-status.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR191: Thin Kiosk Immersive Allowlist Index Block

Status: implemented in PR191.

- Thin only the 2026-03-21 kiosk immersive allowlist and manual-order row
  latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace implementation policy, E2E, branch,
  staged deployment, Phase12, and `EXEC_PLAN.md` detail with short links to
  KB-311, KB-297, and deploy-status.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR192: Thin Manual Order Lower Toolbar Index Block

Status: implemented in PR192.

- Thin only the 2026-03-21 manual-order lower-pane right-edge hover toolbar
  latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace component, hover hook, test, branch,
  staged deployment, Phase12, and merged PR detail with short links to KB-297
  and deploy-status.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR193: Thin Manual Order Pane Polish Index Block

Status: implemented in PR193.

- Thin only the 2026-03-21 manual-order pane polish latest-update block in
  `docs/INDEX.md`.
- Preserve reachability, but replace API/Web behavior, branch, staged
  deployment, Phase12, and merged PR detail with short links to KB-297 and
  deploy-status.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR194: Thin Manual Order Resource Assignment Index Block

Status: implemented in PR194.

- Thin only the 2026-03-21 manual-order upper-pane resource assignment
  latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace table, route, overview, Web card, Phase12,
  branch, staged deployment, and `EXEC_PLAN.md` detail with short links to
  KB-297 and deploy-status.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR195: Thin Manual Order Overview UI Index Block

Status: implemented in PR195.

- Thin only the 2026-03-21 manual-order overview UI latest-update block in
  `docs/INDEX.md`.
- Preserve reachability, but replace header reveal, card density, grid,
  branch, staged deployment, Phase12, deployment knowledge, merged PR, and
  `EXEC_PLAN.md` detail with short links to KB-297 and deploy-status.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR196: Thin Manual Order Pencil Preserve Seiban Index Block

Status: implemented in PR196.

- Thin only the 2026-03-20 manual-order pencil registered-seiban chip preserve
  latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace search-field behavior, branch, staged
  deployment, Phase12, main merge, prior deployment, and `EXEC_PLAN.md` detail
  with short links to KB-297 and deploy-status.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR197: Thin Manual Order Pencil Reset Index Block

Status: implemented in PR197.

- Thin only the 2026-03-20 manual-order lower-pane pencil and site-change
  reset latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace reset behavior, branch, staged deployment,
  Phase12, and `EXEC_PLAN.md` detail with short links to KB-297 and
  deploy-status.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR198: Thin Manual Order Density And Machine Name Index Block

Status: implemented in PR198.

- Thin only the 2026-03-20 manual-order overview density and machine-name fix
  latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace UI density, machine-name API detail,
  branch, staged deployment, and Phase12 detail with short links to KB-297 and
  deploy-status.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR199: Thin Manual Order Solid Refactor Index Block

Status: implemented in PR199.

- Thin only the 2026-03-20 manual-order upper-pane SOLID refactor
  latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace component decomposition, branch, staged
  deployment, detach prerequisite, and Phase12 detail with short links to
  KB-297, deploy-status, and deployment guide.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR200: Thin Manual Order Rows Density Index Block

Status: implemented in PR200.

- Thin only the 2026-03-20 manual-order overview `rows[]` and upper-pane
  density latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace API rows, kiosk row display, CI, staged
  deployment, Phase12, empty-data note, and `EXEC_PLAN.md` detail with short
  links to KB-297 and deploy-status.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR201: Thin Manual Order Page Index Block

Status: implemented in PR201.

- Thin only the 2026-03-20 manual-order dedicated kiosk page, registered-seiban
  history sharing, and CI stabilization latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace route, state, shared history, deployment,
  Phase12, CI stabilization, and manual UI detail with short links to KB-297,
  KB-310, deploy-status, and deployment guide.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR202: Thin Manual Order Device-Scope V2 Index Block

Status: implemented in PR202.

- Thin only the 2026-03-19 manual-order device-scope v2 latest-update block in
  `docs/INDEX.md`.
- Preserve reachability, but replace siteKey/deviceScopeKey behavior,
  Mac proxy policy, overview shape, rollback flags, and Phase12 detail with
  short links to KB-297, ADR-20260319, and deploy-status.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR203: Thin Production Order Mode Index Block

Status: implemented in PR203.

- Thin only the 2026-03-19 production order mode extension latest-update block
  in `docs/INDEX.md`.
- Preserve reachability, but replace automatic/manual mode, targetLocation,
  proxy update policy, audit/learning event, and overview panel detail with
  short links to KB-297 and ADR-20260319.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR204: Thin Production UI Caddy Integration Index Block

Status: implemented in PR204.

- Thin only the 2026-03-19 production-schedule UI unification and Caddy
  self-build integration latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace integration branch, deployment, Phase12,
  onsite verification, and branch-divergence lesson with short links to
  frontend KB-308, frontend KB-307, ci-cd KB-307, and deploy-status.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR205: Thin Caddy Self-Build Index Block

Status: implemented in PR205.

- Thin only the 2026-03-19 Caddy self-build Trivy image web CVE latest-update
  block in `docs/INDEX.md`.
- Preserve reachability, but replace Dockerfile, dependency pinning, Trivy scan,
  and remediation detail with a short link to ci-cd KB-307.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR206: Thin Progress Overview Seiban Filter Index Block

Status: implemented in PR206.

- Thin only the 2026-03-18 progress overview seiban filter latest-update block
  in `docs/INDEX.md`.
- Preserve reachability, but replace dropdown behavior, persisted state,
  Phase12 API check, and onsite browser caveat with short links to KB-306 and
  deploy-status.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR207: Thin Production Schedule UI Unify Index Block

Status: implemented in PR207.

- Thin only the 2026-03-18 production-schedule registered-seiban and resource
  CD dropdown UI unification latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace UI behavior, resource filter controls,
  deployment branch, Phase12, and onsite verification detail with short links
  to frontend KB-307 and deploy-status.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR208: Thin Production Machine Part Search Index Block

Status: implemented in PR208.

- Thin only the 2026-03-17 production-schedule machine-name and part-name
  search latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace A-condition behavior, full/half width
  normalization, empty-dropdown mitigation, Phase12, and empty-data caveat with
  short links to KB-297, frontend KB-304, and deploy-status.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR209: Thin Production Order Popup Search Index Block

Status: implemented in PR209.

- Thin only the 2026-03-17 production-schedule manufacturing-order popup
  search latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace A-condition activation, 5-digit part
  candidate flow, order checklist, order-search route, staged deployment, and
  Phase12/API detail with short links to frontend KB-305 and deploy-status.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR210: Thin Excluded Resource Location Index Block

Status: implemented in PR210.

- Thin only the 2026-03-16 excluded-resource-CD Location alignment
  latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace policy lookup, dual save, staged deploy,
  raspberrypi4 retry, onsite verification, and `EXEC_PLAN.md` detail with short
  links to KB-297 and deploy-status.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR211: Thin Cutting Exclusion Follow-Up Index Block

Status: implemented in PR211.

- Thin only the 2026-03-16 cutting exclusion list follow-up latest-update block
  in `docs/INDEX.md`.
- Preserve reachability, but replace policy normalization, resources contract,
  Web resource button behavior, and `EXEC_PLAN.md` detail with a short link to
  KB-297.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR212: Thin Cutting Exclusion Plan Index Block

Status: implemented in PR212.

- Thin only the 2026-03-16 cutting exclusion list investigation and convergence
  plan latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace root-cause summary, convergence steps, and
  `EXEC_PLAN.md` detail with short links to KB-297 and the production schedule
  kiosk execution plan.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR213: Thin Location Scope Phase12 Index Block

Status: implemented in PR213.

- Thin only the 2026-03-16 Location Scope Phase12 latest-update block in
  `docs/INDEX.md`.
- Preserve reachability, but replace verify script, API/service/fallback and
  auto-generate aggregation, naming-rule, and runbook detail with short links
  to KB-297, deploy-status, and location-scope naming.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR214: Thin Location Scope Phase0-4 Index Block

Status: implemented in PR214.

- Thin only the 2026-03-16 Location Scope Phase0-4 safe rollout latest-update
  block in `docs/INDEX.md`.
- Preserve reachability, but replace terminology/boundary/logging/DB no-go,
  staged deployment, remote verification, and fallback monitoring detail with
  short links to KB-297, ADR-20260315, and deploy-status.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR215: Thin Location Scope Phase10 Index Block

Status: implemented in PR215.

- Thin only the 2026-03-16 Location Scope Phase10 latest-update block in
  `docs/INDEX.md`.
- Preserve reachability, but replace compat-internalization, public resolver
  contract, staged deployment, and real-device verification detail with short
  links to KB-297 and deploy-status.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR216: Thin Location Scope Phase9 Index Block

Status: implemented in PR216.

- Thin only the 2026-03-16 Location Scope Phase9 latest-update block in
  `docs/INDEX.md`.
- Preserve reachability, but replace compat callsite audit, public surface
  reduction, staged deployment, and real-device checklist detail with short
  links to KB-297 and deploy-status.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR217: Thin Location Scope Phase8 Index Block

Status: implemented in PR217.

- Thin only the 2026-03-16 Location Scope Phase8 latest-update block in
  `docs/INDEX.md`.
- Preserve reachability, but replace resolver standard/compat contract,
  staged deployment, and real-device API/service verification detail with
  short links to KB-297 and deploy-status.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR218: Thin Location Scope Phase7 Index Block

Status: implemented in PR218.

- Thin only the 2026-03-16 Location Scope Phase7 latest-update block in
  `docs/INDEX.md`.
- Preserve reachability, but replace production-schedule scope contract,
  staged deployment, and real-device API/service verification detail with
  short links to KB-297 and deploy-status.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR219: Thin Location Scope Phase6 Index Block

Status: implemented in PR219.

- Thin only the 2026-03-16 Location Scope Phase6 latest-update block in
  `docs/INDEX.md`.
- Preserve reachability, but replace adapter legacy path retirement, Phase3 flag
  cleanup, staged deployment, and real-device verification detail with short
  links to KB-297, ADR-20260315 Phase3, and deploy-status.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR220: Thin Location Scope Phase5 Index Block

Status: implemented in PR220.

- Thin only the 2026-03-16 Location Scope Phase5 latest-update block in
  `docs/INDEX.md`.
- Preserve reachability, but replace due-management legacy wiring cleanup,
  staged deployment, and real-device verification detail with short links to
  KB-297 and deploy-status.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR221: Thin Location Scope Phase4 Index Block

Status: implemented in PR221.

- Thin only the 2026-03-16 Location Scope Phase4 latest-update block in
  `docs/INDEX.md`.
- Preserve reachability, but replace due-management scope contract migration,
  staged deployment, and real-device verification detail with short links to
  KB-297, ADR-20260315 Phase3, and deploy-status.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR222: Thin Location Scope Phase3 Index Block

Status: implemented in PR222.

- Thin only the 2026-03-16 Location Scope Phase3 latest-update block in
  `docs/INDEX.md`.
- Preserve reachability, but replace scope contract/flag rollout, staged
  deployment, and real-device verification detail with short links to KB-297,
  ADR-20260315 Phase3, and deploy-status.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR223: Thin Location Scope Phase2 Index Block

Status: implemented in PR223.

- Thin only the 2026-03-16 Location Scope Phase2 latest-update block in
  `docs/INDEX.md`.
- Preserve reachability, but replace ResourceCategory site-scope migration,
  staged deployment, and real-device verification detail with short links to
  KB-297, ADR-20260315 Phase2, and deploy-status.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR224: Thin Location Scope Phase1 Progress Index Block

Status: implemented in PR224.

- Thin only the 2026-03-16 Location Scope Phase1 + progress overview latest-update
  block in `docs/INDEX.md`.
- Preserve reachability, but replace resolver boundary, progress overview
  restoration, deployment, and real-device verification detail with short links
  to KB-297 and the Phase1 audit plan.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR225: Thin Location Scope Phase1 Index Block

Status: implemented in PR225.

- Thin only the 2026-03-14 Location Scope Phase1 latest-update block in
  `docs/INDEX.md`.
- Preserve reachability, but replace resolver boundary and staged migration
  detail with short links to KB-297, the Phase1 audit plan, and ADR-20260314.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR226: Thin Global Rank Auto-Tuning Index Block

Status: implemented in PR226.

- Thin only the 2026-03-14 global rank auto-tuning latest-update block in
  `docs/INDEX.md`.
- Preserve reachability, but replace scoring parameters, orchestrator, DB
  history, API compatibility, deployment, and real-device verification detail
  with short links to KB-297 and deploy-status.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR227: Thin Due Management UI Phase3 Index Block

Status: implemented in PR227.

- Thin only the 2026-03-14 due-management UI Phase3 latest-update block in
  `docs/INDEX.md`.
- Preserve reachability, but replace left-pane workflow, triage integration,
  compatibility, deployment, and real-device UI verification detail with short
  links to KB-297 and deploy-status.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR228: Thin Due Management Section Accent Index Block

Status: implemented in PR228.

- Thin only the 2026-03-14 due-management left-pane section accent
  latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace accent prop, section color, deployment,
  and real-device UI verification detail with short links to KB-297 and
  deploy-status.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR229: Thin Due Management Selection Unify Index Block

Status: implemented in PR229.

- Thin only the 2026-03-14 due-management left-pane selection/unify
  latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace selection action consolidation, toggle UI,
  API compatibility, deployment, and real-device UI verification detail with
  short links to KB-297 and deploy-status.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR230: Thin Processing Type Due Date Index Block

Status: implemented in PR230.

- Thin only the 2026-03-13 processing-type due-date latest-update block in
  `docs/INDEX.md`.
- Preserve reachability, but replace right-pane button, precedence/fallback,
  left-pane summary/triage, deployment, and real-device UI verification detail
  with short links to KB-297 and deploy-status.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR231: Thin Due Management UI Phase2 Index Block

Status: implemented in PR231.

- Thin only the 2026-03-13 due-management UI Phase2 latest-update block in
  `docs/INDEX.md`.
- Preserve reachability, but replace left-pane toggle/default/collapse state,
  duplicate card removal, deployment, and real-device UI verification detail
  with short links to KB-297 and deploy-status.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR232: Thin Due Management UI Phase1 Index Block

Status: implemented in PR232.

- Thin only the 2026-03-13 due-management UI Phase1 latest-update block in
  `docs/INDEX.md`.
- Preserve reachability, but replace left-pane collapsible sections, duplicate
  detail-panel removal, deployment, and real-device UI verification detail with
  short links to KB-297 and deploy-status.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR233: Thin Due Management Layout V2 Index Block

Status: implemented in PR233.

- Thin only the 2026-03-13 due-management layout V2 latest-update block in
  `docs/INDEX.md`.
- Preserve reachability, but replace feature flag, left rail/context/detail
  layout, inventory control, rebuild task, deployment, and real-device
  verification detail with short links to KB-297 and deploy-status.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR234: Thin Actual Hours Fallback Index Block

Status: implemented in PR234.

- Thin only the 2026-03-13 actual-hours location/shared fallback latest-update
  block in `docs/INDEX.md`.
- Preserve reachability, but replace fallback policy, actor/shared lookup,
  RoboDrill01 symptom, inventory switch, and shared-global-rank backfill detail
  with short links to KB-297 and the backfill runbook.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR235: Thin GroupCD CSV Import Index Block

Status: implemented in PR235.

- Thin only the 2026-03-13 GroupCD master and resource-code mapping CSV import
  latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace `groupCd`, seed import, admin CSV API, and
  actual-hours resolver fallback detail with a short link to KB-297.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR236: Thin P2-5 Boundary Guard Index Block

Status: implemented in PR236.

- Thin only the 2026-03-13 P2-5 Boundary Guard latest-update block in
  `docs/INDEX.md`.
- Preserve reachability, but replace restricted-paths rollout, deployment, and
  real-device verification detail with short links to the Phase2 backlog,
  KB-297, and deploy-status.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR237: Thin P2-4 Web Split Index Block

Status: implemented in PR237.

- Thin only the 2026-03-13 P2-4 Web Split Part 2 latest-update block in
  `docs/INDEX.md`.
- Preserve reachability, but replace mutation/side-effect separation,
  deployment, and real-device verification detail with short links to the
  Phase2 backlog, KB-297, and deploy-status.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR238: Thin P2-3 Web Split Index Block

Status: implemented in PR238.

- Thin only the 2026-03-13 P2-3 Web Split Part 1 latest-update block in
  `docs/INDEX.md`.
- Preserve reachability, but replace derived-row/query/search/display split,
  deployment, and real-device verification detail with short links to the
  Phase2 backlog, KB-297, and deploy-status.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR239: Thin P2-2 Auth Route Index Block

Status: implemented in PR239.

- Thin only the 2026-03-13 P2-2 auth Route Thin latest-update block in
  `docs/INDEX.md`.
- Preserve reachability, but replace service extraction, notification side
  effects, route responsibilities, deployment, and real-device verification
  detail with short links to the Phase2 backlog and deploy-status.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR240: Thin P2-1 Import Schedule Index Block

Status: implemented in PR240.

- Thin only the 2026-03-13 P2-1 imports/schedule Route Thin latest-update block
  in `docs/INDEX.md`.
- Preserve reachability, but replace service/policy/error-mapper extraction,
  route responsibilities, API compatibility, deployment, and real-device
  verification detail with short links to the Phase2 backlog and deploy-status.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR241: Thin DebugSink Boundary Index Block

Status: implemented in PR241.

- Thin only the 2026-03-13 DebugSink boundary latest-update block in
  `docs/INDEX.md`.
- Preserve reachability, but replace direct debug-call isolation,
  `emitDebugEvent()` boundary, deployment, real-device verification, and local
  E2E seed note detail with short links to the Phase2 backlog and deploy-status.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR242: Thin Phase2 Refactor Backlog Index Block

Status: implemented in PR242.

- Thin only the 2026-03-11 non-destructive refactor Phase2 backlog
  latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace implementation order, safety gate,
  route/web split, boundary-guard, and validation detail with a short link to
  the Phase2 backlog plan.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR243: Thin FSIGEN Master Index Block

Status: implemented in PR243.

- Thin only the 2026-03-11 FSIGEN master latest-update block in
  `docs/INDEX.md`.
- Preserve reachability, but replace resource master schema, compatibility
  response, UI hover behavior, seed/upsert, real-device verification, and
  production SQL load detail with a short link to KB-297.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR244: Thin Actual Hours Column Alignment Index Block

Status: implemented in PR244.

- Thin only the 2026-03-11 actual-hours column alignment latest-update block in
  `docs/INDEX.md`.
- Preserve reachability, but replace deprecated estimated-minutes column,
  actual-hours resolver, resource-code mapping API/UI, deployment, and
  real-device verification detail with short links to KB-297 and deploy-status.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR245: Thin Location Sync Shared Index Block

Status: implemented in PR245.

- Thin only the 2026-03-11 location sync shared latest-update block in
  `docs/INDEX.md`.
- Preserve reachability, but replace note, due-date, processing-type shared
  repository, deploy, and real-device verification detail with short links to
  KB-297 and deploy-status.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR246: Thin Progress Sync Scope Index Block

Status: implemented in PR246.

- Thin only the 2026-03-11 production-schedule `progress_sync` scope
  separation latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace CSV progress-column eligibility,
  policy/service guard, deploy, and real-device verification detail with short
  links to KB-297 and deploy-status.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR247: Thin Global Rank Actual Hours Index Block

Status: implemented in PR247.

- Thin only the 2026-03-11 global-rank display extension and actual-hours
  column latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace display-rank context, actual-hours column,
  deploy, and real-device verification detail with short links to KB-297 and
  deploy-status.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR248: Thin Global Rank Sort Correction Index Block

Status: implemented in PR248.

- Thin only the 2026-03-11 global-rank sort correction latest-update block in
  `docs/INDEX.md`.
- Preserve reachability, but replace display-order correction, deploy,
  verification, and historical implementation note detail with a short link to
  KB-297.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR249: Thin Mac Target Location Priority Index Block

Status: implemented in PR249.

- Thin only the 2026-03-10 all-terminal shared-priority / Mac target-location
  latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace API scope, temporary override,
  feature-flag deploy, migration, and real-device verification detail with
  short links to KB-297, the Mac target-location runbook, and deploy-status.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR250: Thin Global Rank Display Ops Index Block

Status: implemented in PR250.

- Thin only the 2026-03-10 production-schedule global-rank display
  operational-alignment latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace filtered-rank display behavior and
  storage/display-layer detail with a short link to KB-297.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR251: Thin Actual Hours B7 Index Block

Status: implemented in PR251.

- Thin only the 2026-03-10 due-management B7 actual-hours CSV and
  global-ranking latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace canonical-diff, deploy, CSV import,
  large-payload workaround, and backfill-result detail with short links to
  KB-297, the actual-hours backfill runbook, KB-301, and deploy-status.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR252: Thin Pi4 Deploy Serial Index Block

Status: implemented in PR252.

- Thin only the 2026-03-09 Pi4 deploy serialization / KB-300 prevention block
  in `docs/INDEX.md`.
- Preserve reachability, but replace deploy-staged serial and inventory
  detail with short links to KB-300, deployment, and deploy-status recovery.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR253: Thin Global Row Rank Phase1 Index Block

Status: implemented in PR253.

- Thin only the 2026-03-09 due-management B6 global-row-rank Phase 1
  latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace row-rank projection, deploy recovery,
  serial redeploy, validation, and operator explanation detail with short
  links to KB-297, KB-300, deployment, and deploy-status.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR254: Thin Offline Learning Events Index Block

Status: implemented in PR254.

- Thin only the 2026-03-08 due-management offline learning evaluation and
  event-log latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace event model, learning-report, deploy,
  validation, operation-policy, and CI-fix detail with short links to KB-297
  and ADR-20260308.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR255: Thin B4 Correction Deploy Index Block

Status: implemented in PR255.

- Thin only the 2026-03-08 due-management B4 correction deploy and
  real-device verification latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace candidate filtering, deploy,
  verification, and expected empty-candidate detail with a short link to
  KB-297.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR256: Thin B4 Correction Implementation Index Block

Status: implemented in PR256.

- Thin only the 2026-03-07 due-management B4 correction implementation
  latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace due-date candidate filtering,
  auto-generate exclusion, JST day-boundary, and validation detail with a short
  link to KB-297.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR257: Thin B4 Auto Rank Index Block

Status: implemented in PR257.

- Thin only the 2026-03-07 due-management B4 auto-ranking and explanation
  latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace proposal/explanation API, safety guard,
  UI, deploy, and verification detail with a short link to KB-297.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR258: Thin B3 Visualization Index Block

Status: implemented in PR258.

- Thin only the 2026-03-07 due-management B3 visualization/read-only
  latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace global-rank visualization, inherited
  daily-plan wording, deploy, and validation detail with a short link to
  KB-297.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR259: Thin B3 Global Rank Handoff Index Block

Status: implemented in PR259.

- Thin only the 2026-03-07 due-management B3 global-rank / handoff
  latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace global-rank persistence, initial-order,
  handoff badge, deploy, Pi5-proxy verification, and validation detail with
  short links to KB-297, KB-299, and deploy-status.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR260: Thin Daily Plan B2 Index Block

Status: implemented in PR260.

- Thin only the 2026-03-07 due-management triage B2 daily-plan latest-update
  block in `docs/INDEX.md`.
- Preserve reachability, but replace daily-plan tables/API, UI, bug fix,
  deploy, validation, and operation detail with short links to KB-297 and the
  production-schedule-kiosk ExecPlan.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR261: Thin Triage B1 Index Block

Status: implemented in PR261.

- Thin only the 2026-03-07 due-management triage B1 latest-update block in
  `docs/INDEX.md`.
- Preserve reachability, but replace triage UI, selection persistence,
  triage APIs, reason fields, and validation detail with short links to KB-297
  and the production-schedule-kiosk ExecPlan.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR262: Thin Due Management Schedule Link Index Block

Status: implemented in PR262.

- Thin only the 2026-03-07 due-management and production-schedule linkage
  latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace registered-seiban sync, machine-name,
  process-progress, FHINCD processing master, A-fix deploy, CI-fix, and
  checklist detail with short links to KB-297, KB-298, the
  production-schedule-kiosk ExecPlan, and deploy-status.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR263: Thin Kiosk Due Management Index Block

Status: implemented in PR263.

- Thin only the 2026-03-07 kiosk due-management deployment and onsite
  validation latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace the seiban due-date, part-priority,
  cutting-exclusion, deployment, and onsite validation detail with short links
  to KB-297, ADR-20260307, and the production-schedule-kiosk ExecPlan.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR264: Thin Low-Level Observability Index Block

Status: implemented in PR264.

- Thin only the 2026-03-06 low-level observability canary
  latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace eventLoop metrics, signage worker metrics,
  cursor-debug, canary criteria, and warmup-window detail with short links to
  ADR-20260306, operation-manual, KB-296, KB-268, and KB-274.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR265: Thin Seiban Reorder Index Block

Status: implemented in PR265.

- Thin only the 2026-03-06 registered-seiban button reorder deployment and
  onsite validation latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace the reorder UI, pure helper, search-state
  sync, deployment, and onsite validation detail with short links to KB-295 and
  the production-schedule-kiosk ExecPlan.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR266: Thin Resource Priority Index Block

Status: implemented in PR266.

- Thin only the 2026-03-06 resource-CD button priority deployment and onsite
  validation latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace the priority helper, derived visible
  resources, deployment, and onsite validation detail with short links to
  KB-294 and the production-schedule-kiosk ExecPlan.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR267: Thin VNC Recovery Index Block

Status: implemented in PR267.

- Thin only the 2026-03-06 RealVNC Pi4/Pi3 recovery and onsite validation
  latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace the Tailscale ACL, Pi5 SSH tunnel,
  RealVNC port mapping, and validation detail with short links to
  vnc-tailscale-recovery and KB-293.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR268: Thin Deploy-Status V2 Index Block

Status: implemented in PR268.

- Thin only the 2026-03-06 per-client deploy-status v2 deployment and onsite
  validation latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace the endpoint state model, maintenance
  toggle, rollout, and onsite validation detail with short links to
  ADR-20260306, deployment, and deploy-status recovery.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR269: Thin Split Visualization Index Block

Status: implemented in PR269.

- Thin only the 2026-03-06 split-layout loans=0 visualization fix deployment
  and onsite validation latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace the renderer condition, pane resolver,
  visualization endpoint, deployment, and onsite validation detail with a short
  link to KB-292.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR270: Thin Pi4 Power Validation Index Block

Status: implemented in PR270.

- Thin only the 2026-03-05 Pi4 power-operation and double-click prevention
  onsite validation latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace the offline-terminal follow-up,
  reboot/shutdown validation, and overlay validation detail with short links to
  KB-288 and kiosk-power-operation-recovery.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR271: Thin RoboDrill NFC Index Block

Status: implemented in PR271.

- Thin only the 2026-03-05 RoboDrill01 NFC permanent-fix deployment and onsite
  validation latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace the pcscd, Docker, env distribution,
  nfc-agent startup, and onsite tag-scan validation detail with short links to
  KB-291 and nfc-reader-issues.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR272: Thin Dropbox Space Recovery Index Block

Status: implemented in PR272.

- Thin only the 2026-03-05 Dropbox space recovery deployment and onsite
  validation latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace the upload session, recovery retry,
  temporary path, rescue policy, deployment, and manual backup validation detail
  with short links to KB-290 and backup-verification.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR273: Thin Backup Target-Scoped Delete Index Block

Status: implemented in PR273.

- Thin only the 2026-03-05 target-scoped Dropbox deletion follow-up deployment
  and onsite validation latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace the target-scoped deletion, prefix
  filtering, deployment run, manual backup validation, and local API note with
  short links to backup-verification and KB-290.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR274: Thin IME Smooth Input Index Block

Status: implemented in PR274.

- Thin only the 2026-03-02 kensakuMain Japanese IME smooth-input deployment
  and onsite validation latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace the IBus owner-mode cause, competing
  autostart mitigation, deployment run, diagnosis, and onsite note with short
  links to KB-287 and the kiosk schedule regression investigation KB.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR275: Thin Firefox Panel Shortcut Index Block

Status: implemented in PR275.

- Thin only the 2026-03-02 kensakuMain Firefox migration and Super+Shift+P
  panel shortcut deployment and onsite validation latest-update block in
  `docs/INDEX.md`.
- Preserve reachability, but replace browser-engine settings, labwc keybind,
  reload handling, deployment, and onsite validation detail with short links to
  KB-289 and kiosk-wifi-panel-shortcut.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR276: Thin SH Machine Name Index Block

Status: implemented in PR276.

- Thin only the 2026-03-02 SH item exclusion and machine-name display
  deployment and onsite validation latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace frontend filter, API machine-name query,
  CI, deployment, and onsite validation detail with short links to KB-285
  frontend, KB-285 API, and the production-schedule-kiosk ExecPlan.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR277: Thin Power Hardening Index Block

Status: implemented in PR277.

- Thin only the 2026-03-01 KB-288 permanent fix, power overlay, deployment
  note, Pi5 deploy, and Pi4 onsite validation latest-update block in
  `docs/INDEX.md`.
- Preserve reachability, but replace the power-actions handler, overlay,
  deployment guide update, Pi5-only deploy, and Pi4 validation detail with short
  links to KB-288, kiosk-power-operation-recovery, and deployment.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR278: Thin IME Diagnosis Index Block

Status: implemented in PR278.

- Thin only the 2026-03-01 kiosk remark-field IME diagnosis foundation
  latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace the diagnostic script, Ansible diagnosis
  task, deploy-time logging, and pending analysis detail with short links to the
  kiosk-ime ExecPlan, KB-287, and kiosk-ime-diagnosis.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR279: Thin Power Solid Refactor Index Block

Status: implemented in PR279.

- Thin only the 2026-03-01 power-function SOLID refactor, CI/deploy, onsite
  validation, delay, debounce overlay, and KB-288 recovery latest-update block
  in `docs/INDEX.md`.
- Preserve reachability, but replace client-key resolution, power-operation
  delay, React Portal overlay, bind-mount recovery, and runbook creation detail
  with short links to the power-function ExecPlan, KB-285, KB-286, KB-288, and
  kiosk-power-operation-recovery.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR280: Thin Seiban Button Machine Name Index Block

Status: implemented in PR280.

- Thin only the 2026-02-28 registered-seiban button three-line display and
  machine-name deployment and onsite validation latest-update block in
  `docs/INDEX.md`.
- Preserve reachability, but replace the SeibanHistoryButton, normalization,
  API machineName, CI, deployment, and onsite validation detail with short links
  to KB-282 frontend, KB-282 API, and the production-schedule-kiosk ExecPlan.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR281: Thin Search Conditions LocalStorage Index Block

Status: implemented in PR281.

- Thin only the 2026-02-28 production-schedule search-condition localStorage
  deployment and onsite validation latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace the hook, schema version, debounce,
  reset behavior, CI, deployment, and onsite validation detail with short links
  to KB-283 and the production-schedule-kiosk ExecPlan.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR282: Thin RoboDrill Pi4 Addition Index Block

Status: implemented in PR282.

- Thin only the 2026-02-28 RoboDrill01 Pi4 addition and onsite validation
  latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace the Tailscale setup, SSH key setup,
  repository clone, status-agent setup, client registration,
  kiosk-browser startup, chromium-browser symlink, and onsite validation detail
  with short links to KB-280 and client-initial-setup.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR283: Thin Tailscale VNC Index Block

Status: implemented in PR283.

- Thin only the 2026-02-28 Tailscale-over-VNC access issue and onsite
  validation latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace the Tailscale ACL, wayvnc, UFW,
  connectivity test, and layered network troubleshooting detail with short links
  to KB-277, mac-ssh-access, and port-security-audit.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR284: Thin Client Duplicate Registration Index Block

Status: implemented in PR284.

- Thin only the 2026-02-28 client-device duplicate registration fix and
  recurrence-prevention latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace the register-clients guard, dry-run,
  cleanup, and count verification detail with short links to KB-278 and
  client-initial-setup.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR285: Thin Trivy Minimatch Index Block

Status: implemented in PR285.

- Thin only the 2026-02-28 Trivy minimatch CVE fix, deployment, and onsite
  validation latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace the dependency override, lockfile update,
  CI, deployment, onsite validation, and Pi4 Tailscale SSH documentation detail
  with short links to KB-279 and client-initial-setup.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR286: Thin Pi4 Kiosk-Browser Ansible Index Block

Status: implemented in PR286.

- Thin only the 2026-02-28 Pi4 kiosk-browser Ansible hardening, deployment, and
  onsite validation latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace the Ansible task hardening, syntax check,
  CI, deploy run, offline-host triage, and onsite validation detail with a
  short link to KB-281.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR287: Thin Signage Worker Memory Index Block

Status: implemented in PR287.

- Thin only the 2026-02-25 signage-render-worker high-memory stabilization,
  deployment, and onsite validation latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace the reentrancy guard, timeout logging,
  CI, deploy run, memory reduction, scheduler, and structured log validation
  detail with a short link to KB-274.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR288: Thin Uninspected Machines Signage Layout Index Block

Status: implemented in PR288.

- Thin only the 2026-02-25 uninspected-machines signage layout adjustment,
  deployment, and onsite validation latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace the title cleanup, machine-name width,
  KPI font-size, design-preview, CI, deployment, and onsite validation detail
  with a short link to KB-275.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR289: Thin CSV Dedup Policy Index Block

Status: implemented in PR289.

- Thin only the 2026-02-24 CSV dashboard DEDUP cleanup and error disposition
  interim latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace the shared loser cleanup,
  non-retriable-mail disposition, and ingest audit state detail with a short
  link to KB-273.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR290: Thin Gmail Phase 1 Verification Index Block

Status: implemented in PR290.

- Thin only the 2026-02-24 Gmail auto protocol phase 1 real-device validation
  latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace the health check, schedule check,
  PROCESSING cleanup, 429 cooldown, rate-limit state, and unchecked SSH detail
  with short links to KB-216 and the phase 1 verification checklist.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR291: Thin Gmail CsvDashboards Batch Index Block

Status: implemented in PR291.

- Thin only the 2026-02-22 Gmail csvDashboards 10-minute/30-message
  optimization, deployment, and onsite validation latest-update block in
  `docs/INDEX.md`.
- Preserve reachability, but replace the limited search, default batch size,
  Sunday schedule, CI, deploy run, onsite validation, and 429 monitoring detail
  with short links to KB-272 and csv-import-export.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR292: Thin Production Schedule Retention Index Block

Status: implemented in PR292.

- Thin only the 2026-02-19 production-schedule deletion rule, deployment, and
  onsite validation latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace the duplicate-loser deletion,
  one-year-retention filter, daily cleanup, CI fixes, deploy run, fail-fast
  stash note, and onsite validation detail with short links to KB-271 and
  csv-import-export.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR293: Thin Production Schedule Progress Index Block

Status: implemented in PR293.

- Thin only the 2026-02-19 production-schedule progress table separation,
  deployment, and onsite validation latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace the rowData overwrite risk,
  `ProductionScheduleProgress` schema, migration, API compatibility, CI,
  deploy run, and onsite validation detail with short links to KB-269 and
  ADR-20260219.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR294: Thin Rigging Borrow Info Index Block

Status: implemented in PR294.

- Thin only the 2026-02-18 rigging-borrow page rigging information display,
  deployment, and onsite validation latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace the tag lookup, display block, state
  handling, duplicate API avoidance, CI, deploy run, and onsite validation
  detail with a short link to KB-267.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR295: Thin NFC Stream Policy Index Block

Status: implemented in PR295.

- Thin only the 2026-02-18 NFC stream terminal separation, CI, deploy, and
  onsite validation latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace the policy modes, `localOnly`/`disabled`
  behavior, Pi5 `/stream` proxy removal, CI, deploy run, and onsite validation
  detail with short links to KB-266, the Tailscale policy ledger, and the NFC
  troubleshooting guide.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR296: Thin CSV Auto Fetch Recovery Index Block

Status: implemented in PR296.

- Thin only the 2026-02-16 CSV auto-fetch recovery and cron display UI
  latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace the Gmail 429 recovery chain,
  `PROCESSING` cleanup, cron-minute distribution, `retryConfig.maxRetries=0`,
  cron display formatting, interval editability, and onsite validation detail
  with short links to KB-216, KB-111, and the CSV import/export guide.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR297: Thin Dropbox Cert Pinning Index Block

Status: implemented in PR297.

- Thin only the 2026-02-16 Dropbox certificate pinning recurrence, CI, deploy,
  and onsite validation latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace the rejected OAuth refresh/API-outage
  hypotheses, refreshed Dropbox certificate fingerprints, CI/deploy run IDs,
  and onsite validation detail with a short link to KB-199.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR298: Thin Machine Inspection Signage Index Block

Status: implemented in PR298.

- Thin only the 2026-02-14 machine inspection signage card layout, deploy, and
  onsite validation latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace the 49-item card layout, badge/background
  color fixes, maintenance-flag troubleshooting, CI run IDs, deploy run IDs,
  and onsite validation detail with short links to KB-262 and KB-263.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR299: Thin API Quality Phase4 Index Block

Status: implemented in PR299.

- Thin only the 2026-02-13 code quality phase4 fifth batch and coverage
  stabilization latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace the alerts/tools service tests, import
  boundary rule, performance mini-cases, coverage artifact, Istanbul provider
  fix, local validation, and `test-exclude>glob` troubleshooting detail with a
  short link to KB-258.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR300: Thin Inspection Cell Color Index Block

Status: implemented in PR300.

- Thin only the 2026-02-13 machine inspection signage result-cell background
  color, deploy, and onsite validation latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace the result-cell style function, status
  color mapping, CI run ID, deploy run ID, and onsite validation detail with a
  short link to KB-256.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR301: Thin API Quality Phase4 Imports Index Block

Status: implemented in PR301.

- Thin only the 2026-02-12 code quality phase4 fourth batch latest-update
  block in `docs/INDEX.md`.
- Preserve reachability, but replace the import boundary rules, imports service
  tests, Tailscale health-check fallback, migration command note, local
  validation, CI run ID, deploy run ID, and onsite validation detail with a
  short link to KB-258.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR302: Thin API Quality Phase4 Services Index Block

Status: implemented in PR302.

- Thin only the 2026-02-12 code quality phase4 third batch latest-update block
  in `docs/INDEX.md`.
- Preserve reachability, but replace the backup/imports/alerts service tests,
  signage performance gate, deploy fail-fast stash note, local validation, CI
  run ID, deploy run ID, and onsite validation detail with a short link to
  KB-258.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR303: Thin API Quality Phase4 Tools Index Block

Status: implemented in PR303.

- Thin only the 2026-02-12 code quality phase4 second batch latest-update
  block in `docs/INDEX.md`.
- Preserve reachability, but replace the service-layer test expansion,
  employees/items performance gate, JWT auth header fix, local validation, CI
  run ID, deploy run ID, and onsite validation detail with a short link to
  KB-258.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR304: Thin API Quality Phase4 Performance Index Block

Status: implemented in PR304.

- Thin only the 2026-02-12 code quality phase4 first batch latest-update block
  in `docs/INDEX.md`.
- Preserve reachability, but replace the performance gate expansion, import
  boundary rules, service tests, x-client-key and metrics troubleshooting,
  initial CI failure and rerun, local validation, deploy run ID, and onsite
  validation detail with a short link to KB-258.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR305: Thin Machine Inspection Aggregation Index Block

Status: implemented in PR305.

- Thin only the 2026-02-12 machine inspection signage aggregation, two-column
  layout, font-size, deploy, and onsite validation latest-update block in
  `docs/INDEX.md`.
- Preserve reachability, but replace the visualization slot alignment, JST
  aggregation, data-source sort, two-column layout, font changes,
  troubleshooting, CI runs, deploy runs, and onsite validation detail with a
  short link to KB-256.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR306: Thin API Route Split Index Block

Status: implemented in PR306.

- Thin only the 2026-02-11 `/api/kiosk` and `/api/clients` route split,
  service extraction, deploy, and onsite API validation latest-update block in
  `docs/INDEX.md`.
- Preserve reachability, but replace the route/service ownership split,
  compatibility validation, CI run ID, deploy run ID, onsite API smoke, and
  `search-state` payload contract note with a short link to KB-255.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR307: Thin Resource CD Expression Index Index Block

Status: implemented in PR307.

- Thin only the 2026-02-11 production schedule resource-CD button delay,
  expression-index fix, and onsite validation latest-update block in
  `docs/INDEX.md`.
- Preserve reachability, but replace the slow resources query, correlated
  subquery/Seq Scan cause, expression-index decision, performance improvement,
  migration note, and onsite validation detail with short links to KB-248 and
  ADR-20260211.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR308: Thin WebRTC Video Stability Index Block

Status: implemented in PR308.

- Thin only the 2026-02-10 WebRTC video instability, error-dialog
  improvement, deploy, and onsite validation latest-update block in
  `docs/INDEX.md`.
- Preserve reachability, but replace the local/remote stream state,
  `ontrack` aggregation, video track toggle behavior, ICE restart recovery,
  dialog conversion, deploy run, and onsite call validation detail with short
  links to KB-243 and the WebRTC verification guide.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR309: Thin Pi4 IBus Mode Index Block

Status: implemented in PR309.

- Thin only the 2026-02-26 Pi4 kiosk Japanese input mode switch,
  IBus double-start/UI-window suppression, deploy, and onsite validation
  latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace the IBus panel UI cause, startup timing
  issue, hotkey trigger fix, deploy run, and onsite input validation detail
  with short links to KB-276 and ADR-20260228.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR310: Thin Production Schedule History Progress UI Index Block

Status: implemented in PR310.

- Thin only the 2026-02-10 production schedule registered-seiban delete
  button progress-linked UI, deploy, and kiosk validation latest-update block
  in `docs/INDEX.md`.
- Preserve reachability, but replace the delete-button color behavior,
  `history-progress` endpoint/service detail, deploy run, and kiosk validation
  detail with short links to KB-242 frontend, KB-242 API, and the production
  schedule kiosk ExecPlan.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR311: Thin Modal Standardization Index Block

Status: implemented in PR311.

- Thin only the 2026-02-08 modal standardization, accessibility,
  E2E-stabilization, CI/deploy, and health-check latest-update block in
  `docs/INDEX.md`.
- Preserve reachability, but replace the shared Dialog/ConfirmDialog
  implementation, kiosk/admin modal conversion, accessibility notes, E2E
  helper and CI fix details, deploy result, and health-check detail with a
  short link to KB-240.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR312: Thin Kiosk Header Portal Index Block

Status: implemented in PR312.

- Thin only the 2026-02-08 kiosk header UI, React Portal modal positioning,
  E2E stabilization, and onsite validation latest-update block in
  `docs/INDEX.md`.
- Preserve reachability, but replace the header icon changes, signage preview
  and power menu updates, CSS `filter` containing-block cause, Portal fix,
  modal sizing, E2E workaround, and onsite validation detail with a short link
  to KB-239.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR313: Thin Pi3 Xset Restart Verification Index Block

Status: implemented in PR313.

- Thin only the 2026-02-08 Pi3 signage-lite xset error handling, deploy
  service-restart verification, and preflight latest-update block in
  `docs/INDEX.md`.
- Preserve reachability, but replace the run ID, `--limit "server:signage"`
  standard procedure, preflight/lightdm checks, service restart status,
  xset warning behavior, and deployment lesson with short links to KB-236 and
  KB-234.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR314: Thin Pi3 Xset Failure Fix Index Block

Status: implemented in PR314.

- Thin only the 2026-02-07 Pi3 signage-lite xset startup failure and restart
  loop latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace the `xset: unable to open display ":0"`
  symptom, `set -euo pipefail` root cause, `|| true`/warning-log fix, and
  deployment-restart follow-up lesson with a short link to KB-236.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR315: Thin Parallel Deploy Maintenance Flag Index Block

Status: implemented in PR315.

- Thin only the 2026-02-07 all-device parallel deployment, kiosk maintenance
  flag early-clear implementation, and onsite verification latest-update block
  in `docs/INDEX.md`.
- Preserve reachability, but replace the Pi5/Pi4/Pi3 deployment result,
  elapsed time, prior Pi4 maintenance-screen delay, and early-clear validation
  detail with a short link to KB-234.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR316: Thin Trivy Package Skip Index Block

Status: implemented in PR316.

- Thin only the 2026-02-07 Trivy cron skip and ClamAV/rkhunter package
  install skip latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace the cron `register`/change-gated
  scheduling, `dpkg-query` package presence check, skipping confirmation, and
  2m54s canary timing comparison with a short link to KB-234.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR317: Thin Apt Cache Optimization Index Block

Status: implemented in PR317.

- Thin only the 2026-02-07 apt cache optimization latest-update block in
  `docs/INDEX.md`.
- Preserve reachability, but replace the `apt_cache_valid_time_seconds: 3600`
  setting, `cache_valid_time` task application, safety behavior, affected
  security packages, timing example, and follow-up lesson with a short link to
  KB-234.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR318: Thin Docker Build Optimization Index Block

Status: implemented in PR318.

- Thin only the 2026-02-07 Docker build optimization and changed-file build
  decision latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace the 181s bottleneck, changed-file match
  patterns, common-role and `update-all-clients.sh` double-safety
  implementation, 6m34s to 3m11s canary result, and safe-build fallback with
  short links to KB-235 and KB-234.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR319: Thin Ansible Performance Investigation Index Block

Status: implemented in PR319.

- Thin only the 2026-02-07 Ansible deployment performance investigation,
  canary-to-rollout staging, Pi4/Pi3 deployment split, and duplicate-task
  elimination latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace the 20-device Pi4 scaling premise,
  rollout structure, sequential execution, duplicate-task, Tailscale reinstall,
  pnpm-task mismatch, and profiling-gap investigation summary with a short
  link to KB-234.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR320: Thin Incomplete Parts Signage Index Block

Status: implemented in PR320.

- Thin only the 2026-02-06 signage incomplete-parts display control,
  normalization, and dynamic layout latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace the overflow, 10-plus item, sort-order,
  `metadata` structure, `maxIncompletePartsPerCard`, text-fit utility, and
  backward-compatibility narrative with short links to KB-232 and the
  production schedule signage guide.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR321: Thin Sudo Prompt Deployment Index Block

Status: implemented in PR321.

- Thin only the 2026-02-06 Pi5 deployment sudo prompt and
  `ansible_connection: local` latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace the Mac-side `ansible-playbook` cause,
  `RASPI_SERVER_HOST` remote-execution fix, Pi5 `become_ask_pass = False`
  behavior, and `update-all-clients.sh` `REMOTE_HOST` lesson with short links
  to KB-233 and the deployment guide.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR322: Thin Schedule Limit Signage Height Index Block

Status: implemented in PR322.

- Thin only the 2026-02-06 production schedule registered-seiban limit 8-to-20
  expansion and signage item-height optimization latest-update block in
  `docs/INDEX.md`.
- Preserve reachability, but replace the API/frontend/signage validation,
  normalization, card-height and scale changes, 20-item test, deployment
  validation, and distributed-limit lesson with short links to KB-231 API and
  KB-231 signage.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR323: Thin Gmail Reauth Alert Index Block

Status: implemented in PR323.

- Thin only the 2026-02-06 Gmail reauthorization alerting, Slack routing, and
  onsite recovery latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace the scheduler-only detection,
  `GmailReauthRequiredError`/`invalid_grant` trigger, `gmail-oauth-expired`
  alert type, `#rps-ops` route, dedupe behavior, Pi3 signage investigation,
  admin reauthorization, and 189-row manual run result with short links to
  KB-229, KB-230, and the Slack guide.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR324: Thin Fastify V5 Ci Gate Index Block

Status: implemented in PR324.

- Thin only the 2026-02-03 Fastify v5 migration, high audit gate restoration,
  staged Pi5/Pi4/Pi3 deployment, and deploy-stability latest-update block in
  `docs/INDEX.md`.
- Preserve reachability, but replace the Fastify/plugin updates,
  `reply.elapsedTime` and error-handler compatibility work, staged deployment
  detail, CI run ID, `ansible_become=false` preflight, and `become: false`
  reference-check lesson with short links to KB-227, KB-087, and KB-216.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR325: Thin Kiosk Input Protection Index Block

Status: implemented in PR325.

- Thin only the 2026-02-02 kiosk input-field protection and onsite
  verification latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace the keyboard-misinput incident,
  `KioskHeader.tsx` input removal, display-only client label, page-level
  localStorage removal, `DEFAULT_CLIENT_KEY` startup guard, 401 recovery,
  onsite validation, deferred recovery test note, and web rebuild lesson with
  short links to KB-225 frontend and the KB-225 investigation document.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR326: Thin Pi4 Maintenance And Access Incident Index Block

Status: implemented in PR326.

- Thin only the 2026-01-31 Pi4 kiosk maintenance, Pi5 SSH auth failure, and
  Pi5 Git ownership latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace the `--limit raspberrypi4` maintenance
  scope fix, `should_enable_kiosk_maintenance()` detail, fail2ban recovery,
  `.git` ownership repair, and pre-deploy checklist note with short links to
  KB-183, KB-218, KB-219, the deployment guide, and the Mac SSH guide.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR327: Thin Signage Visualization Rebuild Index Block

Status: implemented in PR327.

- Thin only the 2026-01-31 signage visualization dashboard implementation and
  Docker rebuild reliability latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace the visualization slot, data-source and
  renderer pattern, admin CRUD UI, `repo_changed` detection, `api/web`
  rebuild, `git rev-list` parsing, onsite positive/negative deployment checks,
  signage preview, and CI note with short links to KB-217, the signage module,
  and the deployment guide.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR328: Thin Pi5 Storage Maintenance Index Block

Status: implemented in PR328.

- Thin only the 2026-01-31 Pi5 storage maintenance follow-up latest-update
  block in `docs/INDEX.md`.
- Preserve reachability, but replace the disk growth investigation,
  `storage-maintenance.sh` deletion-count bug, accumulated rendered signage
  images, Docker build cache cleanup, unused image cleanup, script fix, disk
  recovery result, and CI note with short links to KB-130 and the operation
  manual.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR329: Thin Tailscale Primary Operations Index Block

Status: implemented in PR329.

- Thin only the 2026-01-30 Tailscale primary operations and Pi3
  `post_tasks` temporary unreachable latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace the Tailscale primary/local emergency
  policy, all-device deployment validation, Pi3 `unreachable=1` observation,
  service-state confirmation, and deployment-guide note with short links to
  ADR-20260130, KB-216, and the deployment guide.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR330: Thin Gmail OAuth Expiry Index Block

Status: implemented in PR330.

- Thin only the 2026-01-29 Gmail OAuth 7-day expiry latest-update block in
  `docs/INDEX.md`.
- Preserve reachability, but replace the unverified Google app diagnosis,
  GitHub Pages home/privacy pages, Google Cloud branding and verification
  request, and post-review operating expectation with short links to KB-215
  and the Gmail setup guide.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR331: Thin Deploy Hardening Index Block

Status: implemented in PR331.

- Thin only the 2026-01-29 deploy hardening, all-device validation, and branch
  requirement latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace the fail-fast clean-tree and push checks,
  detached execution, log follow/attach modes, Pi3 preflight, remote locking,
  `git reset --hard origin/<branch>` fix, mandatory branch selection, and
  Pi5/Pi4/Pi3 validation with short links to KB-200 and the deployment guide.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR332: Thin Kiosk Active Loans Sharing Index Block

Status: implemented in PR332.

- Thin only the 2026-01-29 kiosk active-loans cross-device sharing
  latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace the NFC/photo tab symptom, local
  `clientId` filtering root cause, `useActiveLoans(undefined, ...)` fix,
  active loan list scope, CI/deploy/onsite validation note, and KB-211 addition
  with short links to KB-211 and the tools API.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR333: Thin Security Verification Index Block

Status: implemented in PR333.

- Thin only the 2026-01-28 security evaluation, onsite verification, and
  router exposure assessment latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace the standards-based evaluation summary,
  port exposure, fail2ban and security-monitor results, router default
  assessment, remaining backup/restore and USB validation items, evidence
  script, report updates, and KB-213/KB-214 note with short links to the
  security evaluation report and production verification guide.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR334: Thin Production Schedule Search Sharing Index Block

Status: implemented in PR334.

- Thin only the 2026-01-28 production schedule registered-seiban search
  sharing regression latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace the KB-209 regression context,
  `search-history` versus `search-state` root cause, `activeQueries` sharing,
  resource-filter scope, debug-code removal, shared-key reuse, CI/deploy/onsite
  validation, and KB-210 addition with short links to KB-210 and the production
  schedule kiosk plan.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR335: Thin Deploy DB Gate Index Block

Status: implemented in PR335.

- Thin only the 2026-01-22 deploy verification DB gate and fail-fast
  latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace the stale-schema incident, Pi5 deploy
  migration fail-fast behavior, `verification-map.yml` DB checks,
  `verifier.sh` SSH/TLS/command expansion details, health-check DB checks,
  HTTPS backup script note, migration, DB/HTTP/smoke validation, timeout note,
  and KB-191 update with short links to KB-191 and the deployment guide.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR336: Thin Backup Legacy Key Cleanup Index Block

Status: implemented in PR336.

- Thin only the 2026-01-24 backup.json legacy-key automatic cleanup
  latest-update block in `docs/INDEX.md`.
- Preserve reachability, but replace the backup health warning, legacy flat
  fields under `storage.options`, KB-168 manual cleanup background,
  `BackupConfigLoader.save()` cleanup behavior, compatibility rule, tests,
  CI/deploy/onsite validation, and KB-196 addition with short links to KB-196
  and KB-168.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR337: Thin Backup Schedule History Index Block

Status: implemented in PR337.

- Thin only the 2026-01-23 scheduled backup history latest-update block in
  `docs/INDEX.md`.
- Preserve reachability, but replace the backup tab history mismatch, missing
  `BackupScheduler.executeBackup` history creation/update path, manual
  `/api/backup` comparison, `createHistory()` / `completeHistory()` /
  `failHistory()` fix, CI/deploy note, and KB-194 addition with short links to
  KB-194 and the backup/restore guide.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR338: Thin Dropbox 409 Index Block

Status: implemented in PR338.

- Thin only the 2026-01-23 Dropbox 409 path-invalid latest-update block in
  `docs/INDEX.md`.
- Preserve reachability, but replace the manual backup 409 incident, direct
  `options.label` path embedding, path separator/whitespace sanitization,
  `sanitizePathSegment()` and `buildPath()` fix, boundary test, CI/deploy/onsite
  validation, and KB-195 addition with short links to KB-195 and the
  investigation/result guides.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR339: Thin Admin Signage Preview Index Block

Status: implemented in PR339.

- Thin only the 2026-01-23 admin signage preview latest-update block in
  `docs/INDEX.md`.
- Preserve reachability, but replace the admin preview tab, automatic/manual
  refresh, fetch/JWT 401 diagnosis, `axios(api)` switch, Blob display,
  `URL.revokeObjectURL` cleanup, CI/deploy/onsite validation, and KB-192
  addition with short links to KB-192 and the signage module document.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR340: Thin CSV Import Interval Index Block

Status: implemented in PR340.

- Thin only the 2026-01-23 CSV import schedule interval latest-update block in
  `docs/INDEX.md`.
- Preserve reachability, but replace the once-daily schedule limitation,
  interval mode, 5/10/15/30/60 minute presets, minimum interval policy across
  UI/API/scheduler, cron parsing/display utilities, tests, CI/deploy/onsite
  validation, and KB-191 addition with short links to KB-191 and the CSV guide.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR341: Thin CSV Dashboard Column Width Index Block

Status: implemented in PR341.

- Thin only the 2026-01-23 CSV dashboard column-width latest-update block in
  `docs/INDEX.md`.
- Preserve reachability, but replace the Pi3 signage column-width incident,
  font-size propagation, all-row scan, formatted value handling, header width
  rule, shrink-to-fit behavior, NDJSON/debug note, unit tests, CI/deploy/onsite
  validation, and KB-193 addition with short links to KB-193 and the signage
  module document.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR342: Thin Production Schedule Performance Index Block

Status: implemented in PR342.

- Thin only the 2026-01-26 production schedule performance/search latest-update
  block in `docs/INDEX.md`.
- Preserve reachability, but replace the Pi4 3000-row latency note, `q`
  parameter and ProductNo/FSEIBAN search behavior, DB filtering/paging,
  reduced response fields/page size, query-gated frontend fetch, search history
  and clear-button UI notes, sampled column-width calculation, validation
  status, and KB-205/KB-206 additions with short links to KB-205, KB-206, and
  the CSV guide.
- Do not edit deployment guide, verification checklist, KB index, or
  `EXEC_PLAN.md` in this PR.

### PR343 And Later: Thin Indexes And Split Large Documents

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
