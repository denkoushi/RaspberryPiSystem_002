# Unify torque-wrench ownership across assembly and training

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must stay current while work proceeds. Maintain this document in accordance with `.agent/PLANS.md`.

## Purpose / Big Picture

An operator must be able to move one physical torque wrench between any number of terminals and between normal assembly and training while the whole system has either zero or one effective owner. If another owner exists, the destination shows who owns the wrench and offers the same two-stage physical-presence takeover. A successful takeover fences the old generation before the old terminal can submit input, waits for the old Bluetooth window to close, and then enables the destination. A delayed cleanup from an old page is a successful no-op and never tears down the new page's lease.

The database row remains the fleet-wide source of truth, the localhost torque agent remains the only browser path that can control Bluetooth and HID input, and the browser coordinates operator actions and presentation. Pairing, parser behavior, NFC, assembly tightening progression, training scoring and the five-attempt completion rule do not change.

## Progress

- [x] (2026-08-18 JST) Re-read repository safety, architecture, test, documentation and UI rules and the relevant torque-wrench ADRs, plans, runbooks and code.
- [x] (2026-08-18 JST) Revalidated remote `origin/main` at `af4ac166125e8dc1ea2c93c6d9cefe45bbaa2944`; proved `71077ea`, `d8d3fd96`, `97ec77bc`, `56de0e47`, `7095fe18`, `a16d74f7`, `264d3188` and `af4ac166` are contained.
- [x] (2026-08-18 JST) Protected the unrelated source worktree and created `/Users/tsudatakashi/RaspberryPiSystem_002-torque-wrench-global-ownership` on `feat/torque-wrench-global-ownership` from exact `af4ac166`.
- [x] (2026-08-18 JST) Created this ExecPlan and `docs/decisions/ADR-20260818-torque-wrench-global-ownership.md` before source edits.
- [x] (2026-08-18 JST) Extracted and tested the common API lease policy, coordinator, Prisma repository, assembly/training adapters and owner-redacted status contract.
- [x] (2026-08-18 JST) Implemented exact-token conditional release and bounded same-token communication recovery in torque-agent.
- [x] (2026-08-18 JST) Implemented the common Web transport, controller, presentation and two-stage takeover panel, then migrated assembly and training pages.
- [x] (2026-08-18 JST) Updated the operator runbook and documentation index with the cross-workflow contract and diagnostics.
- [x] (2026-08-18 JST) Ran focused tests and builds plus isolated PostgreSQL migration, fencing and query-plan validation; removed every labelled temporary Docker resource.
- [x] (2026-08-18 JST) Reviewed responsibilities, dependency direction and final diff. Commit, push, PR, merge, deployment and physical-device changes remain unapproved and were not performed.

## Surprises & Discoveries

- Observation: the schema already enforces at most one current row per physical profile and exactly one assembly or training owner, so no migration is required.
  Evidence: `TorqueWrenchUsageLease.torqueWrenchProfileId` is the primary key, `leaseId` is unique, and migration `20260809050353_add_torque_training` adds `TorqueWrenchUsageLease_owner_exactly_one_ck`.
- Observation: backend training takeover exists, but owner presentation and the browser-to-agent completion path are absent.
  Evidence: `apps/api/src/routes/torque-training/index.ts` exposes takeover while the training page has no takeover wrapper or shared owner panel.
- Observation: a delayed old-page release can clear a newly acquired local lease because the current agent release accepts only a reason.
  Evidence: `ConnectionLeaseManager.release` operates on whichever `_lease` is current when the request reaches its lock.
- Observation: assembly and training intentionally differ for a lease that merely expires without a newer generation.
  Evidence: assembly accepts a delayed, captured event for the current generation while training checks send-time expiry. This task preserves both policies and only unifies takeover fencing.
- Observation: host pnpm 11.19.0 rewrote the pnpm 9.15.9 lockfile, removed the repository overrides and added an invalid `allowBuilds` placeholder even though this feature adds no dependency.
  Evidence: both files were restored byte-for-byte from `af4ac166`; all subsequent Node validation used existing app-local `node_modules/.bin` executables. The final gate is `git diff --exit-code af4ac166 -- pnpm-lock.yaml pnpm-workspace.yaml`.
- Observation: pulling `postgres:16-alpine` did not complete within the validation window, but the host already had `pgvector/pgvector:pg15`.
  Evidence: validation used a newly created, uniquely labelled container, volume and network from that local image; it did not attach to or mutate an existing container or database. Cleanup left zero matching resources.
- Observation: repository-wide Ruff currently reports 22 pre-existing findings in unchanged capture, websocket and test files.
  Evidence: the changed agent files pass focused Ruff, and the complete agent behavior suite passes 59 tests. Unrelated lint cleanup was not folded into this feature.

## Decision Log

- Decision: Use exact `origin/main` SHA `af4ac166` as the implementation base without cherry-picks.
  Rationale: every required training and agent fix listed in the approved plan is an ancestor of that SHA; taking old feature-branch tips would drop later fixes or reintroduce superseded manifest state.
  Date/Author: 2026-08-18 / Codex.
- Decision: Define ownership as a discriminated owner identity `{ ownerKind, clientDeviceId, sessionId }` plus token `{ torqueWrenchProfileId, leaseId, generation }`.
  Rationale: business validation remains owner-specific while concurrency, fencing, renew and release use one stable contract.
  Date/Author: 2026-08-18 / Codex.
- Decision: Treat a mismatched release as `stale_noop` with HTTP success.
  Rationale: this protects the successor lease and lets the old route transition finish instead of converting safety into a navigation blocker.
  Date/Author: 2026-08-18 / Codex.
- Decision: Permit automatic recovery only for server-confirmed renewal of the exact same token and owner while browser heartbeat and the known lease window remain valid.
  Rationale: a transient network break can complete safely without granting a new ownership generation. Fenced, expired, released or different ownership remains OFF and requires explicit operator action.
  Date/Author: 2026-08-18 / Codex.
- Decision: Preserve the existing assembly and training outbox-expiry policies and audit action names.
  Rationale: harmonizing business TTL semantics is not necessary to guarantee that takeover rejects old lease IDs and generations, and would expand the acceptance surface.
  Date/Author: 2026-08-18 / Codex.

## Outcomes & Retrospective

The common current-row coordinator now owns profile locking, self renewal, takeover token rotation, handoff timing, generation fencing and conditional release for both workflows. Training lease behavior was removed from the large training service into its own adapter. The localhost agent exposes only its self token, makes stale cleanup an inert success, immediately disarms on communication loss and can recover only by exact-token renew. Both kiosk pages now use the same transport/controller/presentation/two-stage takeover feature.

Focused verification completed as follows: API policy 6/6; isolated-PostgreSQL torque lease integration 10/10; Web shared-controller, transport, panel, assembly-page, training-heartbeat and training-completion tests 38/38; torque-agent 59/59, including 6 global-ownership cases. Shared types, API and Web TypeScript checks passed; API focused lint and Web focused lint passed; changed Python files passed Ruff; API and Web production builds passed. `git diff --check`, no Prisma schema/migration diff, and exact pnpm lock/workspace comparison to `af4ac166` are final handoff gates.

All 158 migrations applied to the temporary PostgreSQL database and the migration ledger reported 158 applied entries. The lease profile primary key, unique lease ID, owner exactly-one check and foreign keys were present. With a fixture row, `EXPLAIN (ANALYZE, BUFFERS)` used the profile primary-key index for the current-row lock lookup (one row, three shared hits, 0.034 ms) and `TorqueWrenchUsageLease_idx_owner_expiry` for owner/expiry lookup (one row, five shared hits, 0.027 ms). Label checks found zero task containers, volumes or networks after cleanup.

No database schema, pairing/discovery, parser, NFC, tightening progression, training scoring or five-attempt rule was changed. Physical two-terminal acceptance, deployment and restart/long-outage measurements remain pending separate authorization, as planned.

## Context and Orientation

`apps/api/prisma/schema.prisma` defines `TorqueWrenchUsageLease`, the single retained current row for one physical wrench profile. The API's assembly lease behavior currently lives in `apps/api/src/services/torque-wrenches/torque-wrench-connection-lease.service.ts`; training lease behavior is embedded in `apps/api/src/services/torque-training/torque-training.service.ts`. Both write the same table but duplicate locking and transition rules.

`clients/torque-agent/torque_agent/connection_lease.py` owns the local lease snapshot, binding, renew loop and guard intent. The guard intent controls a root-owned service that is the final authority for the exact external Bluetooth adapter. The browser communicates only with the loopback agent. `apps/web/src/features/assembly/torqueAgentClient.ts`, `apps/web/src/pages/kiosk/KioskAssemblyWorkSessionPage.tsx` and `apps/web/src/pages/kiosk/KioskAssemblyTrainingPage.tsx` currently duplicate or omit parts of the connection workflow.

A fencing generation is a monotonically increasing integer in the current lease row. Takeover writes a new lease ID and higher generation under the profile row lock. Any event or renewal bearing the older token cannot affect current work. `connectAfter` is the earliest time the new terminal may enable its Bluetooth controller; takeover sets it after the former lease expiry plus the grace interval.

## Plan of Work

First, add small API domain modules for owner and token types, pure transition decisions, Prisma access and orchestration. Owner adapters validate assembly bolt/eligibility/confirmation or training session/confirmation, then call the same coordinator. The coordinator locks the profile row, determines active ownership, keeps the same token for a self renew, increments generation and creates a new token for takeover, preserves a future `connectAfter`, writes the existing audit action, and conditionally validates release/renew tokens. Existing route URLs remain stable. Status and held errors show the owner's device name, location, kind and expiry but expose tokens only to the exact self owner.

Second, change the loopback agent's release contract to require the expected owner and full token. Under one lock, an absent lease returns `already_absent`, an exact match performs local disarm and server release and returns `released`, and a mismatch returns `stale_noop` without modifying any current state. Add self-only token fields to status. On a temporary server communication failure, disarm immediately and retain the exact token as a bounded in-memory recovery candidate. While browser heartbeat and the known expiry remain valid, retry only same-token renew. Restore guard, Bluetooth and binding only when the response confirms every token and owner field. Never call acquire or takeover from recovery.

Third, add a Web connection feature whose localhost transport is separate from a controller hook, pure presentation and reusable takeover panel. The controller owns full local tokens and `available`, `acquiring`, `owned_by_self`, `handoff_wait`, `ready`, `owned_by_other`, `communication_lost`, `recovering` and `fenced` states. It performs acquire, two-second heartbeat, takeover and exact-token release. Both pages supply their business-specific profile, session and confirmation inputs. Training retains its confirmation after a conflict and can complete the same 1.2-second, checkbox and final-button takeover used by assembly.

Finally, update `docs/runbooks/assembly-torque-agent.md` for cross-kind operation, conditional cleanup and same-token recovery. Validate focused contracts first. Then use a uniquely labelled temporary PostgreSQL container, network and volume, apply all migrations, run related integration tests and inspect relevant query plans. Cleanup runs on success or failure and proves no labelled temporary resource remains.

## Concrete Steps

All source work occurs in `/Users/tsudatakashi/RaspberryPiSystem_002-torque-wrench-global-ownership`.

Inspect changes before and after each milestone with:

    git status --short
    git diff --check
    git diff --stat

Run focused API tests using the commands selected by `apps/api/package.json`; run Web unit tests and build using `apps/web/package.json`; run torque-agent tests and lint using `clients/torque-agent/pyproject.toml`. Record the exact commands and counts in this plan after the final command set is known from those manifests.

For PostgreSQL validation, create a unique network, volume and container bearing a task label. Register cleanup before starting the container. Set `DATABASE_URL` only to that isolated database, run the repository's Prisma generation and `prisma migrate deploy`, query `_prisma_migrations` and the lease constraints, execute the cross-kind integration tests, and run `EXPLAIN (ANALYZE, BUFFERS)` for profile-current-row and owner/expiry lookups. Remove only resources created by this run and verify that the unique label matches zero resources afterward.

## Validation and Acceptance

The API acceptance suite must prove that concurrent acquisition for one profile has one winner; every assembly-to-training, training-to-assembly, assembly-to-assembly and training-to-training takeover creates one higher generation; old renew, release and input cannot affect the successor; same-owner renew and reacquire preserve future `connectAfter`; and status never leaks another owner's token.

The agent suite must prove exact release performs server and local teardown, stale release returns `stale_noop` and leaves the successor ready, absent release returns `already_absent`, and Bluetooth cannot turn on before `connectAfter`. Communication loss must disarm immediately. Exact-token renew may recover while the browser heartbeat and expiry are valid. Fenced, expired, released, other-owner, other-session, other-generation and browser-expired cases must stay OFF and must never acquire automatically.

The Web suite must prove both pages use the shared state flow, training displays another owner and completes the two-stage takeover, `handoff_wait` is not shown as ready, and delayed cleanup never blocks navigation or tears down the successor. Existing assembly takeover, training heartbeat, five-attempt completion and immediate attempt refresh must remain passing.

The final static boundary is no Prisma schema or migration diff, no NFC/parser/assembly progress/training scoring changes, and clean `git diff --check`. Deployment and two-terminal physical acceptance remain explicitly pending separate approval.

## Idempotence and Recovery

The feature branch and worktree can be reused after interruption. The current lease mutation is guarded by the profile lock and exact token, so retrying renew or stale release is safe. Temporary Docker resources use a unique name and label and are the only resources cleanup may remove; existing containers, databases, volumes and networks must never be mutated. If a focused test exposes an unrelated baseline failure, confirm it once and record it without expanding the change.

## Artifacts and Notes

Base evidence recorded before source edits:

    origin/main af4ac166125e8dc1ea2c93c6d9cefe45bbaa2944
    71077ea included
    d8d3fd96 included
    97ec77bc included
    56de0e47 included
    7095fe18 included
    a16d74f7 included
    264d3188 included
    af4ac166 included

The original worktree remains on unrelated branch `feat/private-ai-butler-morning-tone`; this plan changes only the dedicated worktree.

Validation command notes: host `pnpm --version` was 11.19.0 while the repository declares 9.15.9. After restoring the two package metadata files, validation deliberately used `apps/api/node_modules/.bin/*`, `apps/web/node_modules/.bin/*`, and `python3 -m pytest/ruff`; no further install command was run. PostgreSQL validation used only task-scoped temporary resources and the local `pgvector/pgvector:pg15` image.

## Interfaces and Dependencies

The API owner identity is a discriminated union with `ownerKind`, `clientDeviceId` and the matching assembly or training `sessionId`. The token has `torqueWrenchProfileId`, `leaseId` and `generation`. A status result includes state, owner display, expiry and `connectAfter`; token fields are present only when the requester is the exact owner.

The loopback release body is `{ reason, targetKind, sessionId, torqueWrenchProfileId, leaseId, generation }` and returns `{ result: 'released' | 'already_absent' | 'stale_noop', status: ... }`. The recovery path calls only the existing renew endpoint with the retained exact token.

The Web controller depends on a localhost transport interface rather than direct Pi5 routes. Assembly and training pages depend on the controller's commands and presentation state, while the controller has no knowledge of NFC, bolt progression, scoring or five-attempt completion.

Revision note (2026-08-18): created from the approved implementation plan after confirming the exact base and preserved commits; updated after implementation and isolated validation with final outcomes, package-lock incident evidence and remaining physical acceptance scope.
