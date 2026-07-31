---
title: Kiosk Self-Inspection Layout Density ExecPlan
status: in_progress
scope: kiosk self-inspection layout delivery and constrained Pi3 deployment resilience
date: 2026-07-31
source_of_truth: this file
related_code:
  - apps/web/src/features/part-measurement
  - apps/web/src/pages/kiosk/KioskSelfInspectionSessionPage.tsx
related_docs:
  - docs/knowledge-base/KB-320-kiosk-part-measurement.md
  - docs/runbooks/kiosk-part-measurement.md
validation: passed_locally
open_items:
  - deploy remediated candidate and verify the fleet
---

# Kiosk Self-Inspection Layout Density

This is a living ExecPlan maintained according to `.agent/PLANS.md`. The goal is to recover usable vertical space in the self-inspection measurement session, align the self-inspection list with the inspection-drawing template table, and expose the already-available inspection frequency without changing HTTP, Prisma, database, or business-logic contracts.

## Purpose / Big Picture

Operators must be able to see the measurement-point list while entering values at kiosk resolutions. The fixed 54px session header will carry operator identity and the highest-priority notice, leaving the right pane for compact entry controls and a flexible measurement-point history area. The self-inspection list will use one table below 1536px and two tables from 1536px upward, with readable type and compact horizontal actions. The inspection-drawing template list will show inspection frequency immediately before its edit controls.

## Progress

- [x] (2026-07-31) Read repository instructions, canonical docs, existing implementation, tests, and relevant API/DTO contracts.
- [x] (2026-07-31) Confirmed a clean `main`, synchronized it with `origin/main`, and created `feat/kiosk-self-inspection-layout-density`.
- [x] (2026-07-31) Added shared presentation models and narrowly scoped density tokens.
- [x] (2026-07-31) Updated the self-inspection list layout and focused tests.
- [x] (2026-07-31) Updated the fixed session header, notification projection, and right-pane density.
- [x] (2026-07-31) Added inspection-frequency display to the inspection-drawing template table.
- [x] (2026-07-31) Updated canonical KB and runbook contracts.
- [x] (2026-07-31) Passed focused tests, all 1,657 Web tests, lint, production build, eight mocked layout E2E cases, and the isolated PostgreSQL regression.
- [x] (2026-07-31) Reviewed the UI diff, committed it as `a5ab0cdd`, pushed the feature branch, and submitted release run `20260731-125244-d78ee1`.
- [x] (2026-07-31) Deployed and stabilized Pi5 and verified the first Pi4 canary, then cooperatively cancelled before the remaining terminals to investigate Pi3 resource risk.
- [x] (2026-07-31) Diagnosed Pi3 memory pressure, intermittent status-agent TLS timeouts, and an ineffective Signage watchdog recovery path.
- [x] (2026-07-31) Added Pi3-only release quiescing, bounded watchdog sudo, and a 30-second status-agent timeout; passed the complete deployment contract suite under Node 20.20.2.
- [x] (2026-08-01) Committed and pushed the initial Pi3 remediation, passed a new production-ledger/terminal preflight, and deployed the candidate to Pi5 and all six Pi4 kiosks with verified release evidence.
- [x] (2026-08-01) Confirmed automatic Pi3 rollback to `ab57a4ab` after a transient systemd unit-registration failure; lightdm, Signage, and all timers recovered active and enabled.
- [x] (2026-08-01) Added post-restore daemon reload, unit-registration waits, timer-first ordering, and bounded retries; the complete deployment contract suite passed again under Node 20.20.2.
- [ ] Commit and push the post-restore hardening, redeploy Pi3 through the standard entrypoint, and verify final fleet convergence.

## Surprises & Discoveries

- Observation: The self-inspection list is already semantic HTML tables; its two-row records and vertically stacked action buttons make it appear card-like.
  Evidence: `SelfInspectionTable.tsx` renders a primary row plus a detail row and currently resolves 1/2/3 panes at 1280/1536 breakpoints.
- Observation: The right-pane history loss is caused by several non-shrinking controls before the final `min-h-0 flex-1` measurement-point list, not by the list itself.
  Evidence: `KioskSelfInspectionSessionPage.tsx` places actor, NFC, entry-slot, value, judgment, and action panels before `InspectionDrawingPointSummaryList`.
- Observation: The template-list DTO already carries `selfInspectionMode` and `selfInspectionFixedCount`; no transport or persistence work is needed.
  Evidence: the existing Web type and API route serialize both fields.
- Observation: The local shell resolves Node 18.20.8 although the workspace declares Node 20.9 or newer; focused tests and the production Web build still complete, but every pnpm invocation reports the engine warning.
  Evidence: the focused Vitest and Web build command output both report `Unsupported engine` before succeeding.
- Observation: The first browser layout run showed that existing button themes could retain a 44px `min-height` despite a non-important 30.8px height utility.
  Evidence: all three list viewports passed pane and overflow assertions but failed the action-height assertion; the shared structural token was tightened with important exact height/min-height/padding utilities and all eight E2E cases then passed.
- Observation: Pi3 had 130MB available memory but 293MB of 415MB zram swap in use, with about 14.9 million major faults and sustained swap churn since boot.
  Evidence: read-only Pi5-to-Pi3 diagnostics showed no OOM kill, thermal throttling, or disk pressure, isolating the risk to constrained memory and network/TLS latency rather than hardware failure.
- Observation: `device_type_defaults.pi3.stop_lightdm=true` was only effective in full provisioning; the release-only Signage role never registered `lightdm_stopped`, so its existing post-task restoration branch was unreachable.
  Evidence: `prestage-signage-runtime.yml` is forbidden in release-only mode, while `roles/signage/tasks/main.yml` stopped only Signage units before this remediation.
- Observation: The Signage watchdog ran as `signageras3` but invoked privileged `systemctl` commands without `sudo`, producing repeated interactive-authentication failures.
  Evidence: Pi3 journal entries repeatedly reported `Interactive authentication required`; the installed script matched the repository template and exact NOPASSWD commands are available through inventory policy.
- Observation: Intermittent `status-agent` exit status 2 came from TLS handshake/read timeouts, not malformed configuration.
  Evidence: `/var/log/raspi-status-agent.log` recorded handshake and read timeouts while later timer invocations succeeded with the same redacted config shape.
- Observation: Pi3 release `20260731-202134-009670` reproduced the exact April 2026 transient in which `signage-lite-update.timer` was enabled and present during the role but appeared unregistered to the first post-lightdm `systemd` start.
  Evidence: the release failed only that loop item with `Could not find the requested service`; rollback restored and verified `ab57a4ab`, and subsequent read-only checks found lightdm, Signage, and every timer active and enabled. The same task/item and a successful retry are recorded in the historical deployment notes.

## Decision Log

- Decision: Interpret requested `FHINBN` as the existing `FHINCD` part-code field.
  Rationale: There is no `FHINBN` field in the current data contract, and this interpretation was approved in the implementation plan.
  Date/Author: 2026-07-31 / Codex with user approval.
- Decision: Interpret “履歴一覧” as the existing measurement-point summary list.
  Rationale: No separate chronological-history model exists in this screen; the approved plan explicitly identifies the intended area.
  Date/Author: 2026-07-31 / Codex with user approval.
- Decision: Keep 22px controls as a deliberate local exception limited to entry-count buttons and the compact hundredths keypad.
  Rationale: These are dense numeric selectors, while primary kiosk actions retain a 44px minimum target.
  Date/Author: 2026-07-31 / Codex with user approval.
- Decision: Centralize session notices with priority `actionError`, NFC registration, guide hint, save-block reason, completion hint.
  Rationale: A pure display projection prevents duplicated or competing messages while preserving the underlying state and callbacks.
  Date/Author: 2026-07-31 / Codex with user approval.
- Decision: Do not create an ADR.
  Rationale: This work changes UI presentation only and does not alter a public contract or persistence boundary.
  Date/Author: 2026-07-31 / Codex with user approval.
- Decision: Put important sizing only in the shared dense table-action structure token.
  Rationale: It deterministically overrides legacy button-theme minimum height and padding while keeping screen-specific color and typography local.
  Date/Author: 2026-07-31 / Codex after browser measurement.
- Decision: Stop lightdm only during release-only application on device types already configured with `stop_lightdm: true`, and reuse the existing post-task and sealed runtime rollback restoration.
  Rationale: This frees the dominant GUI memory during checkout/configuration without changing normal Signage operation or inventing a parallel recovery path.
  Date/Author: 2026-07-31 / Codex after user-approved Pi3 investigation.
- Decision: Keep the watchdog unprivileged and invoke only two exact `sudo -n /usr/bin/systemctl` operations authorized by inventory.
  Rationale: Running a user-owned script as root would widen privilege; the bounded sudo surface restores self-healing without that coupling.
  Date/Author: 2026-07-31 / Codex after user-approved Pi3 investigation.
- Decision: Raise `REQUEST_TIMEOUT` from 10 to 30 seconds only for Pi3 through a reusable template variable.
  Rationale: The same configuration succeeds between transient TLS timeouts, and 30 seconds remains inside the ready-probe's enforced 60-second safety bound.
  Date/Author: 2026-07-31 / Codex after user-approved Pi3 investigation.
- Decision: Treat Signage restoration as an explicit convergence sequence: reload systemd, wait for every required unit to report `loaded`, start timers before the heavier display service, and retry transient starts three times.
  Rationale: Unit files and enablement were correct, rollback was healthy, and the identical historical failure converged on retry; bounded readiness and retry make that transient observable and recoverable without masking a persistent missing unit.
  Date/Author: 2026-08-01 / Codex after the first remediated Pi3 deployment.

## Context and Orientation

The list entry point is `apps/web/src/features/part-measurement/SelfInspectionTable.tsx`, supported by `selfInspectionTableModel.ts` and kiosk theme helpers. The measurement session is composed in `apps/web/src/pages/kiosk/KioskSelfInspectionSessionPage.tsx`; its fixed header is `SelfInspectionSessionHeader.tsx`, and the right-pane value controls live under `features/part-measurement/inspection-drawing/`. The inspection-drawing template table is `InspectionDrawingLibraryTemplateTable.tsx`. Existing mocked Playwright coverage is under `apps/web/e2e/`, and Web unit/component tests sit beside their modules.

## Plan of Work

First, add narrowly scoped presentation helpers: a shared dense table-action structure, the self-inspection-mode display label, the autosave-status badge, and the pure header-notice projection. Then update the list panes, typography, truncation, and horizontal actions without touching link or callback contracts. Next, refactor the fixed header into three non-wrapping regions and move operator identity and projected notices into its two-line center region. Reclaim right-pane height by removing duplicate banners/messages, compacting only entry buttons and the hundredths keypad, and constraining direct input width. Finally, add frequency next to template edit controls and update the canonical KB/runbook.

All behavior changes will be protected with focused component tests. Layout properties that JSDOM cannot prove will be checked in mocked Playwright at 1280x760, 1536x864, and 1920x1080. Database contracts will be checked in isolated, uniquely named Docker resources and removed through a pre-registered cleanup trap.

## Concrete Steps

Work from `/Users/tsudatakashi/RaspberryPiSystem_002` on `feat/kiosk-self-inspection-layout-density`.

1. Implement presentation models and density tokens, then update focused unit tests.
2. Modify the self-inspection list and mocked layout E2E for the one/two-pane contract.
3. Modify the session header and right pane, preserving all callbacks and accessibility state.
4. Display template inspection frequency using the existing DTO fields.
5. Update `KB-320-kiosk-part-measurement.md` and `docs/runbooks/kiosk-part-measurement.md`.
6. Run `pnpm --filter @raspi-system/web test`, `lint`, and `build`.
7. Start Vite on port 4173 and run the targeted fully mocked Playwright specs with one worker; inspect temporary screenshots and delete them afterward.
8. Create a unique temporary PostgreSQL container, volume, and network, apply all migrations, run schema SQL, the focused API integration test, and `EXPLAIN (ANALYZE, BUFFERS)`, then prove cleanup.
9. Run final diff/document checks and create a local commit only.

## Validation and Acceptance

Acceptance requires one list pane at 1279, 1280, and 1535 pixels and two panes at 1536 and 1920 pixels; readable, non-overflowing list content; a fixed 54px session header with two-line order/FHINCD identity, actor identity, and prioritized notice; 22px entry-count and hundredths controls only; direct input within the 360px pane; no duplicate standalone OK/NG status; and a visible, flexible measurement-point list. Template frequency must stay immediately left of edit controls for all four modes, including a safe em dash for missing fixed count.

The Web suite, lint, build, mocked E2E, isolated migration/schema/API/EXPLAIN regression, `git diff --check`, link audit, long-line audit, and corruption audit must pass. Any material deviation or discovered constraint is recorded above before proceeding.

## Idempotence and Recovery

Code and documentation edits are repeatable through normal patch application. Test commands are read-only with respect to repository state. PostgreSQL validation must register `EXIT`, `INT`, and `TERM` cleanup before creating resources, use a unique run identifier, expose only an automatically assigned loopback port, and never connect to or mutate existing containers or databases. Cleanup removes the temporary container, volume, and network whether validation passes or fails, and a final Docker name-filter check must return zero matching resources.

## Artifacts and Notes

Temporary screenshots and database resources are validation artifacts, not repository deliverables. Record concise observations here, then delete/remove the artifacts. Do not commit generated screenshots, logs, or test results.

The 1280x760 session screenshot showed all four mocked measurement cards in the recovered history area, a single-row hundredths keypad, contained direct input, and a non-overflowing 54px header. The 1536x864 list showed two balanced tables with horizontal action buttons. The 1920x1080 session retained the same header and exposed a large flexible history area. The inspection-drawing screenshot showed `頻度: 全数` immediately before the action group. The temporary screenshots were deleted after review.

## Interfaces and Dependencies

No API, DTO, Prisma schema, migration, or stored-data contract changes are expected. New Web-only interfaces are internal display props: NFC message placement (`inline | external`), hundredths keypad layout (`standard | singleRowCompact`), input-status visibility, and the `entryDense` kiosk-button size. Defaults preserve existing consumers. Shared helpers remain pure and presentation-oriented so screens depend on stable display models rather than each other.

## Outcomes & Retrospective

The requested presentation changes are implemented without changes to API, DTO, Prisma, migrations, or business workflows. Focused tests passed, the full Web suite passed 329 files and 1,657 tests, lint and production build passed, and eight fully mocked Chromium E2E cases passed at the target resolutions. The isolated `pgvector/pgvector:pg15` run applied and reported all 157 migrations current; `_prisma_migrations` returned `157|0`, both self-inspection columns existed, the focused API contract test passed, and the representative list query used indexed scans with 0.090ms execution in the one-row fixture. Cleanup reported zero matching containers, volumes, networks, and storage paths.

The UI and first Pi3 remediation commits were pushed. Pi5 and all six Pi4 kiosks now hold verified evidence for `a8977fe2`. The first remediated Pi3 attempt safely rolled back after exposing a known transient unit-registration race in the post-lightdm restoration loop. The restoration path is now hardened and fully contract-tested; a final Pi3-only standard release remains before closing this plan.
