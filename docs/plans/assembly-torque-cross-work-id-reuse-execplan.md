# Reuse one physical torque-wrench confirmation across work IDs

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date while implementation proceeds. Maintain this document in accordance with `.agent/PLANS.md`.

## Purpose / Big Picture

An operator must be able to open any assembly work ID on StoneBase or Assembly-01 and use the shared physical torque wrench when its serial number, latest registered setting, and tightening condition are unchanged. Today the assembly page can be opened on another terminal, but the torque APIs reject it because the work session remembers the terminal that originally started it and every physical confirmation is tied to one session.

After this change, that remembered terminal remains audit data rather than torque authorization. A physical confirmation successfully adopted by the connection lease can be reused for another work ID on the same terminal. Starting Bluetooth still requires the explicit “このレンチを使用開始” action. Moving the wrench to another terminal still requires a fresh physical confirmation and the existing two-stage takeover, and the old terminal is fenced by the connection-lease generation.

## Progress

- [x] (2026-07-23 17:32+09:00) Verified a clean worktree, fetched `origin`, confirmed `origin/main` contains PR #1068 merge `30230222`, and created `feat/assembly-torque-cross-work-id-reuse` from `origin/main`.
- [x] (2026-07-23 17:32+09:00) Read the traceability and connection-lease ADRs, runbook, API/UI documentation, Prisma schema, API services, Web session page, agent binding, integration tests, and expand-only migration validator.
- [x] (2026-07-23 17:40+09:00) Added nullable adopted-confirmation audit state and the two-column expand-only migration.
- [x] (2026-07-23 17:47+09:00) Extracted the pure confirmation-use policy, confirmation-state repository, shared eligibility context, and shared physical-profile lock; applied them to listing, confirmation, setting/profile mutation, acquisition, takeover, and agent intake.
- [x] (2026-07-23 17:48+09:00) Removed work-session start-terminal authorization from kiosk torque selection/confirmation/lease paths while preserving the enforcement-off tokenless fallback.
- [x] (2026-07-23 17:51+09:00) Updated kiosk messages, integration and policy tests, superseding ADR, prior ADR references, API/UI documentation, and the agent runbook.
- [x] (2026-07-23 18:05+09:00) Completed unit, integration, agent, Web, build, lint, migration-validator, SQL, and EXPLAIN validation using disposable PostgreSQL resources.
- [x] (2026-07-23 18:05+09:00) Recorded validation evidence and inspected the final diff. At this checkpoint, no commit, push, PR mutation, deployment, production database access, or production enforcement activation had been performed.
- [x] (2026-07-23 18:25+09:00) Ran the complete API and Web suites, workspace lint, shared-package builds/tests, CI-policy tests, production Web build, and documentation inventory audit in preparation for the next-day rollout.
- [x] (2026-07-23 18:35+09:00) Committed the reviewed 24-file scope as `508d25b3`, pushed `feat/assembly-torque-cross-work-id-reuse`, and opened Draft PR #1069 against `main`.
- [x] (2026-07-23 18:43+09:00) Confirmed exact-head CI for `508d25b3`: 9 checks succeeded, 6 path-classified checks were skipped, and no check failed or remained pending.
- [x] (2026-07-24 11:54+09:00) Deployed the PR #1069 head through the standard rolling-release path and completed the available StoneBase/Assembly-01 physical acceptance while leaving connection-lease enforcement disabled.
- [x] (2026-07-24 12:08+09:00) Traced two physical-test UI defects to an unobserved initial agent state and a conditionally mounted page-level message element; confirmed that neither defect came from the lease, database, Bluetooth guard, or torque input path.
- [x] (2026-07-24 12:14+09:00) Added a read-only pre-confirmation health probe, pure connection-presentation policy, neutral preparation labels, and a persistent fixed-height status region. Focused Web validation passed 23 tests.
- [x] (2026-07-24 12:32+09:00) Completed the UI follow-up validation: 25 focused Web tests, all 1,487 Web tests, Web lint/build, 29 torque-agent core tests, documentation audit, diff checks, and real-browser geometry at 1280×720 and 1920×1080 all passed.

## Surprises & Discoveries

- Observation: There is no serial-number allow-list. The visible “この作業は別のクライアント端末に割り当てられています” failure comes from `assertSessionClient` in `assembly-torque-traceability.service.ts` and the equivalent check in `lockAssemblySession` in `torque-wrench-connection-lease.service.ts`.
  Evidence: The kiosk work-in-progress list exposes every in-progress session, while the torque services compare `AssemblyWorkSession.clientDeviceId` with the requesting client.

- Observation: The existing condition fingerprint already excludes work ID and template bolt ID.
  Evidence: It is calculated from normalized diameter, length, material, strength class, capability group, and lower/nominal/upper torque converted to newton metres, so semantically identical work IDs already produce the same key.

- Observation: Removing only the session comparison would make confirmations left behind on a previously owning terminal appear reusable after the wrench moved.
  Evidence: confirmations are append-only and current lease rows retain their last owner and monotonic generation after release; neither model currently records which confirmation that ownership transition adopted.

- Observation: No new lookup index is required if the retained lease row stores the adopted confirmation ID.
  Evidence: lease lookup uses the profile primary key, adopted confirmation lookup uses the confirmation primary key, and session-local confirmation lookup already has `(sessionId, conditionFingerprint, confirmedAt DESC)`.

- Observation: Setting-history insertion and profile status/calibration mutation previously did not lock the physical profile, so they could interleave with confirmation adoption even though later agent validation would reject the stale evidence.
  Evidence: `TorqueWrenchMasterService.addSetting` used a standalone create. It now shares the `TorqueWrenchProfile` row lock used by confirmation, acquisition, takeover, and agent intake; all operations that also lock a session do so second.

- Observation: PostgreSQL chooses a sequential scan for a one-row lease fixture even when the primary key is present, which is correct for a tiny table but does not prove scaling behavior.
  Evidence: after seeding 20,000 lease rows and 50,000 confirmation rows and running `ANALYZE`, the measured plans used `TorqueWrenchConnectionLease_pkey`, `AssemblyTorqueWrenchConfirmation_pkey`, and `AssemblyTorqueWrenchConfirmation_idx_session_condition`.

- Observation: the repository's bare `tsc --noEmit` command has a pre-existing `rootDir=src` conflict with files included from `prisma`, `scripts`, and `vitest.config.ts`.
  Evidence: the repository-standard API build uses `tsconfig.build.json` and passed. This unrelated configuration was not changed.

- Observation: Poetry was unavailable on the Mac, but the checked-out torque-agent virtual environment already contained the required test dependencies.
  Evidence: `clients/torque-agent/.venv/bin/python -m pytest` passed all 45 tests.

- Observation: The initial `agentReachable=false` value meant both “not measured yet” and “a loopback request failed”. The heartbeat effect deliberately skipped `POST /heartbeat` while a current bolt had no confirmation, so a healthy agent was labelled `通信断` before any request was made.
  Evidence: physical testing showed `通信断` while the Assembly agent was healthy and locally available; `KioskAssemblyWorkSessionPage.tsx` returned from the heartbeat callback before changing the initial boolean.

- Observation: A local torque-agent snapshot with `state=available` does not prove that the Pi5-authoritative lease is globally unowned.
  Evidence: while StoneBase held generation 26, Assembly-01 had no local lease and reported `available` until the explicit acquire attempt returned `owned_by_other`. The UI must say `現物確認待ち` or `使用開始待ち` rather than claim `使用可能` before acquisition.

- Observation: The page-level notification was mounted between the header and the flexible main region only while text existed.
  Evidence: the physical screen moved vertically when the Bluetooth-wait message disappeared. Existing Web tests checked that old text was replaced or removed, but did not measure geometry or require a persistent fixed-height region.

- Observation: `GET /health` is already a read-only, CORS-enabled torque-agent contract.
  Evidence: `test_loopback_api_health_and_disarm_contract` verifies the GET response and allowed kiosk origin separately from the mutating/disarming heartbeat POST. No agent or wire-protocol change is needed to determine real loopback reachability before confirmation.

## Decision Log

- Decision: Reuse is allowed across all work IDs and lots, not only within one lot.
  Rationale: Lot identity is not part of the safety condition; the physical profile, latest setting, current eligibility, and tightening fingerprint are the relevant invariants.
  Date/Author: 2026-07-23, user and Codex.

- Decision: `AssemblyWorkSession.clientDeviceId` remains the immutable start-origin snapshot and is not rewritten when another terminal works on the session.
  Rationale: Actual torque authority is more accurately audited by confirmation client, current lease owner/session/generation, and `AssemblyTorqueRecord.sourceClientDeviceId`.
  Date/Author: 2026-07-23, user and Codex.

- Decision: Reusable confirmation validity is event-based, with no operator restriction or time-to-live.
  Rationale: A confirmation becomes stale only when the physical wrench, latest setting, tightening condition, live eligibility, adopted terminal, or lease ownership epoch changes.
  Date/Author: 2026-07-23, user and Codex.

- Decision: Store a nullable scalar `adoptedConfirmationId` on the retained lease and its history, without a foreign key, backfill, or index.
  Rationale: Adoption changes atomically with lease ownership; legacy `NULL` rows fail safely and the repository can validate that the referenced confirmation still exists. Avoiding a foreign key keeps the migration inside the production expand-only contract.
  Date/Author: 2026-07-23, Codex.

- Decision: Admin override remains session-scoped.
  Rationale: The feature is for physical kiosk/agent operation; widening privileged manual override would be an unrelated safety and authorization change.
  Date/Author: 2026-07-23, user and Codex.

- Decision: `connectionLeaseEnforcedAt` remains unchanged.
  Rationale: The user reserved enforcement activation for a later, separately approved rollout. Cross-work reuse must use a valid lease token, while the existing tokenless, same-session, start-terminal fallback remains only while enforcement is disabled.
  Date/Author: 2026-07-23, user and Codex.

- Decision: Move the physical-profile row lock into a dedicated repository helper and use it for setting/profile mutations as well as confirmation and lease operations.
  Rationale: This keeps transaction ordering reusable and prevents a latest-setting, status, calibration, or profile mutation from interleaving with adoption. It also avoids coupling the master-data service to the connection-lease service.
  Date/Author: 2026-07-23, Codex.

- Decision: Probe the existing local `GET /health` before physical confirmation and keep remote ownership discovery on the existing explicit acquire action.
  Rationale: this distinguishes a real loopback failure from an unmeasured state without adding an API, changing agent binding, polling Pi5 ownership, or allowing automatic acquisition. A pre-confirmation health snapshot is intentionally presented as preparation state rather than global lease availability.
  Date/Author: 2026-07-24, user and Codex.

- Decision: Replace `使用可能` on an active tightening position with `現物確認待ち` or `使用開始待ち`, and reserve a fixed-height page notification region.
  Rationale: the former label overstated what the local agent knew, while a persistent `h-14` region prevents transient connection and operation messages from resizing the main work area.
  Date/Author: 2026-07-24, user and Codex.

## Outcomes & Retrospective

Implementation is complete on `feat/assembly-torque-cross-work-id-reuse` and published in Draft PR #1069. The reviewed implementation commit is `508d25b3`; its exact-head GitHub CI completed with all applicable checks successful. A confirmation adopted by the retained lease can now be listed and explicitly re-acquired for another work ID or lot on the same terminal when physical profile, latest setting, tightening fingerprint, capability group, instrument state, and calibration remain eligible. The start-origin terminal remains unchanged on `AssemblyWorkSession`; the actual terminal, target session, lease generation, and adopted confirmation are audited separately.

Lease acquisition, expired acquisition, takeover, same-generation confirmation adoption, and release preserve `adoptedConfirmationId` in the lease/history as designed. Agent intake accepts cross-session evidence only with a complete token whose lease ID, generation, owner client, owner session, and adopted confirmation all match. The tokenless enforcement-off path still requires the original session, start terminal, and session-local confirmation. Admin override remains session-local. The HTTP paths and torque-agent payload are unchanged.

Validation completed:

- Pure confirmation and eligibility policies: 21 tests passed.
- API torque integration: 3 tests passed, including D26IIII/D26HHHH-shaped cross-work/lot reuse, immutable StoneBase start-origin with Assembly-01 input audit, explicit release/acquire, no automatic enforcement, same-generation `CONFIRMATION_ADOPTED`, stale destination rejection, fresh takeover, generation fencing, concurrency, invalid status, expired calibration, condition change, setting change, admin isolation, and tokenless fallback.
- Related API regression: 9 files and 71 tests passed on a disposable database.
- Complete API regression on a newly created disposable database: 454 files and 2,373 tests passed; 2 files and 7 tests requiring external storage credentials were skipped by their existing gates. All 152 migrations were applied first and the database was reported up to date.
- Kiosk page: 9 tests passed, including reusable-confirmation text, explicit start, takeover guard, release, error suppression, and stable layout behavior.
- Complete Web regression: 297 files and 1,471 tests passed; the production Web build passed.
- Torque agent: 45 tests passed. Bluetooth guard, adapter, and device-identity tests: 19 passed. No wire-protocol change was required.
- Workspace lint with zero warnings, API/Web builds, all three shared-package builds, part-search-core's 15 tests, shelf-layout-core's 8 tests, and 22 CI-policy tests passed.
- Documentation audit passed and regenerated `docs/_meta/document-inventory.json` and `docs/_meta/document-inventory-summary.md` with the new ADR and ExecPlan links.
- The only environment warnings were the local Node 18 version versus the repository's requested Node 20.9+, stale Browserslist data, the existing Web chunk-size warning, and expected test-only storage initialization warnings on macOS.
- Expand-only migration validator: 22 tests passed, and the actual migration was classified as allowed.
- A clean disposable `pgvector/pgvector:pg15` database applied all 152 migrations and reported the schema up to date. SQL confirmed both new columns are nullable `text`, and history samples retained adopted IDs for acquisition, takeover, expired acquisition, confirmation adoption, and release.
- After `ANALYZE` with 20,000 lease and 50,000 confirmation fixtures, `EXPLAIN (ANALYZE, BUFFERS)` used the lease primary key (0.018 ms), confirmation primary key (0.009 ms), and existing session-condition index (0.013 ms).
- Every disposable PostgreSQL run finished with `containers=0 volumes=0 networks=0`; no existing container or database was accessed or modified.
- The final complete-suite disposable PostgreSQL run also finished with `containers=0 volumes=0 networks=0`.
- The UI follow-up's pure presentation and kiosk-page suites passed 25 tests. The complete Web suite then passed 298 files and 1,487 tests; Web lint and the production build also passed.
- The torque-agent core regression passed 29 tests, including the existing read-only `GET /health` and disarming-heartbeat contract. No agent code or payload changed.
- A temporary Playwright network mock reproduced reusable confirmation, explicit acquisition, Bluetooth wait, ready/input wait, and release without touching a database or physical agent. At both 1280×720 and 1920×1080, the inner work `main` kept the same `top` and `height` in all four measured states: the maximum difference was 0 px. The status region retained `h-14 shrink-0 overflow-y-auto` with and without text.
- Documentation inventory regeneration and `node scripts/docs/audit-docs.mjs --check` passed, as did `git diff --check`. No PostgreSQL run was needed because the follow-up changed only Web presentation and existing health-client use.

One intermediate test assertion incorrectly expected a renewed lease expiry to remain unchanged; it was corrected to assert the safety identity that must remain stable (lease ID and generation). The implementation itself did not need a workaround.

Physical acceptance on 2026-07-24 confirmed the core feature with enforcement still disabled. StoneBase acquired D26IIII at generation 19 and recorded an input, then reused the adopted confirmation for D26HHHH at generation 20 without automatic connection and recorded to the selected work session. A later StoneBase D26GGGG run used a fresh destination confirmation at generation 26 because Assembly-01 had become the last owner. Assembly-01 then created a fresh D26HHHH confirmation and completed the two-stage takeover at generation 27. Continuous external-adapter observation showed StoneBase ON/Assembly-01 OFF through 11:47:57, both OFF from 11:47:59 through 11:48:04, and StoneBase OFF/Assembly-01 ON from 11:48:05; there was no simultaneous ON. The generation-27 input was accepted to D26HHHH with Assembly-01 as the source client and the adopted confirmation and lease generation matching. `OPERATOR_RELEASE` retained the adopted confirmation, and both external adapters were OFF at the end.

The same physical run exposed the two UI defects described above. They did not cause a wrong torque record, simultaneous Bluetooth activation, or a lease violation. The follow-up is now implemented and locally validated: unmeasured and reachable preparation states no longer claim `通信断` or Pi5-wide availability, and the permanent notification slot prevents message transitions from moving the work area. A separate-lot same-condition physical run remains unavailable because the other observed lot used inactive template version 3; D26GGGG is an active-version same-lot case and is not claimed as separate-lot acceptance. The user approved committing, pushing, and deploying this UI follow-up on 2026-07-24; no post-change deployment result is claimed in this checkpoint. No merge or enforcement activation has been performed.

## Context and Orientation

`apps/api/src/services/torque-wrenches/assembly-torque-traceability.service.ts` lists compatible wrenches, creates physical confirmations, returns the confirmation considered current for a work session, records agent input, and records administrator override input. `apps/api/src/services/torque-wrenches/torque-wrench-connection-lease.service.ts` owns the Pi5-authoritative lease for one physical wrench. The lease row is intentionally retained after release so its integer generation can only increase; an old generation is a fence token that prevents a former terminal from reconnecting.

`apps/api/prisma/schema.prisma` defines `AssemblyTorqueWrenchConfirmation`, `TorqueWrenchConnectionLease`, and `TorqueWrenchConnectionLeaseHistory`. A confirmation records the session in which a person checked the wrench serial number and displayed setting. The new adopted-confirmation field records which one of those audit rows became the current physical-location evidence when the lease was acquired.

`apps/web/src/pages/kiosk/KioskAssemblyWorkSessionPage.tsx` loads compatible wrenches and current confirmations. It must continue to preselect a reusable confirmation without contacting Bluetooth until the operator presses “このレンチを使用開始”. `clients/torque-agent` treats confirmation and lease IDs as opaque binding data, so no agent payload or protocol change is needed.

The “legacy fallback” means an agent event without lease ID and generation while `connectionLeaseEnforcedAt` is null. It must retain the old same-session and start-terminal checks. A cross-work or cross-terminal event is accepted only when it carries a current lease ID and generation and the lease adopted the supplied confirmation.

## Plan of Work

First, add `adoptedConfirmationId String?` to the current lease and history Prisma models and an expand-only migration containing only two nullable `TEXT` columns. Existing rows remain null and therefore cannot yield cross-work reuse until an operator next confirms and explicitly acquires the wrench.

Next, add a repository that loads a confirmation together with the retained lease state needed to classify it, and add a pure `TorqueWrenchConfirmationUsePolicy`. The policy receives ordinary values rather than a Prisma client and returns a typed decision. It distinguishes a current-session confirmation from a lease-adopted reusable confirmation and supplies stable rejection reasons. Eligibility, latest-setting, and condition-fingerprint checks remain shared with `TorqueWrenchEligibilityPolicy`.

Change confirmation creation to use the common lock order: lock the physical profile, then the work session. Remove start-terminal rejection from compatible-list, confirmation-create, kiosk current-confirmation, and lease acquisition paths. Kiosk current-confirmation listing merges valid current-session confirmations created on the requesting terminal with the adopted confirmation of a retained lease whose owner is that terminal, de-duplicating by physical profile. The administrator form continues to receive session-local confirmations only.

When acquire, expired acquire, or takeover succeeds, set `adoptedConfirmationId` to the supplied confirmation and copy it into lease history. If the same live owner and session explicitly starts with a different valid confirmation, retain the generation, adopt the new ID, and append a `CONFIRMATION_ADOPTED` history row. A destination terminal may not adopt one of its old confirmations from a previous ownership epoch; it must create a confirmation in the current target session after the other terminal’s relevant acquisition/release/expiry boundary. Active-owner takeover additionally retains the existing physical-presence reason, 1.2-second pause, checkbox, and final confirmation button.

For agent intake with a supplied lease token, validate lease ID, generation, owner client, owner target session, and adopted confirmation ID before permitting a confirmation from another source session. For tokenless intake while enforcement is off, retain the existing start-terminal and same-session checks. Continue writing the real request client into `AssemblyTorqueRecord.sourceClientDeviceId` and the lease ID and generation into their existing audit columns.

Finally, update the work-session message for a lease held by another session to say “別の作業または端末で使用中”, expand integration and Web tests, and update the ADR/runbook/API/UI documentation. The traceability ADR’s same-session reuse rule is superseded by a new ADR rather than silently edited out of history.

## Concrete Steps

All commands run from `/Users/tsudatakashi/RaspberryPiSystem_002`.

The branch setup is:

    git fetch origin
    git status --short
    git merge-base --is-ancestor 3023022251dc5039c78a58006df59b68969ae92b origin/main
    git switch -c feat/assembly-torque-cross-work-id-reuse origin/main

After editing Prisma, validate the schema and generated client:

    pnpm --filter @raspi-system/api exec prisma validate
    pnpm --filter @raspi-system/api exec prisma generate
    python3 -m unittest scripts/deploy/tests/test_validate_expand_only_migrations.py

Run focused code tests:

    pnpm --filter @raspi-system/api exec vitest run \
      src/services/torque-wrenches/__tests__/torque-wrench-confirmation-use.policy.test.ts \
      src/services/torque-wrenches/__tests__/torque-wrench-eligibility.policy.test.ts
    pnpm --filter @raspi-system/web exec vitest run \
      src/pages/kiosk/KioskAssemblyWorkSessionPage.test.tsx
    cd clients/torque-agent && poetry run pytest && cd ../..
    python3 -m unittest \
      scripts/deploy/tests/test_torque_bluetooth_guard.py \
      scripts/deploy/tests/test_torque_bluetooth_adapter.py \
      scripts/deploy/tests/test_torque_device_identity.py

For database validation, never use a running existing PostgreSQL container. Create a unique container, volume, and network from `pgvector/pgvector:pg15`, bind PostgreSQL to a dynamically assigned loopback port, and install EXIT/INT/TERM cleanup traps before starting it. Apply every migration, run `prisma migrate status`, execute the torque-wrench integration suite, inspect the nullable columns and audit rows with SQL, seed enough confirmation rows for planner measurement, run `ANALYZE`, and run `EXPLAIN (ANALYZE, BUFFERS)` for lease-by-profile, confirmation-by-ID, and session/condition/latest queries. The trap must remove all three resources, and a final Docker listing must prove their unique names are absent.

Then run:

    pnpm --filter @raspi-system/api lint
    pnpm --filter @raspi-system/api build
    pnpm --filter @raspi-system/web lint
    pnpm --filter @raspi-system/web build

Do not commit, push, deploy, merge, or call the enforcement endpoint during these steps.

## Validation and Acceptance

An API integration test must create two client devices and at least three work sessions with the same tightening fingerprint, including sessions whose start-origin clients differ. It must prove that a destination terminal can confirm and acquire a session started on the other terminal, record an agent value to that target session with the destination as `sourceClientDeviceId`, release, list the adopted confirmation from another work ID and lot, explicitly acquire again, and record only to the newly selected session.

The same suite must prove that a stale confirmation from a previous destination ownership epoch is rejected; a fresh destination confirmation and takeover increments generation; the old generation is fenced; the old terminal no longer lists the adopted confirmation; setting, condition, eligibility, and calibration changes force confirmation; concurrent acquisition leaves one owner and one adopted confirmation; enforcement stays null; tokenless legacy input does not gain cross-session or cross-terminal authority; and admin override rejects another session’s confirmation.

The Web test must show the reused-confirmation message and enabled explicit-start button while proving no acquire or agent activation occurs automatically. Existing two-stage takeover, unmount release, expected disarm-error suppression, and stable layout tests must remain green.

On the disposable database, `prisma migrate deploy` and `migrate status` must succeed. SQL must show both new fields nullable and legacy rows null. EXPLAIN must use the lease primary key, confirmation primary key, and existing session-condition index rather than adding a scan whose cost grows with every work ID.

No production or physical-device acceptance is part of this implementation run. Later, under separate approval, canary deployment must use only `scripts/update-all-clients.sh` in Pi5, StoneBase, Assembly-01 order, leave enforcement off, and verify D26IIII/D26HHHH, right-pane history, and absence of simultaneous external Bluetooth ON.

## Idempotence and Recovery

The migration is additive and has no data update, foreign key, default, or backfill. Reapplying the full migration ledger to a fresh database is safe. Existing production lease rows remain usable for their current session but cannot provide cross-work confirmation reuse until a later explicit acquisition adopts a confirmation.

Disposable Docker resources must contain a unique run identifier and must never reuse the names, ports, volumes, or network of an existing container. Cleanup must tolerate partially created resources and run both after success and failure. If a test fails, preserve its terminal output in this document, let the trap remove the database resources, fix the code, and repeat with a new unique identifier.

## Artifacts and Notes

Initial repository state:

    branch: feat/assembly-torque-cross-work-id-reuse
    base: 3023022251dc5039c78a58006df59b68969ae92b
    worktree before implementation: clean
    connectionLeaseEnforcedAt: unchanged by this work

## Interfaces and Dependencies

The Prisma lease models gain an optional scalar:

    adoptedConfirmationId String?

The pure policy exposes typed decisions for these contexts:

    current-session
    adopted-reuse
    lease-adoption
    agent-intake
    admin-session-only

The repository performs only database reads and mapping. The policy performs no I/O. `AssemblyTorqueTraceabilityService` and `TorqueWrenchConnectionLeaseService` receive the policy/repository through constructor defaults so tests can substitute them without coupling domain decisions to Prisma.

Existing public HTTP paths, `AgentTorqueEventPayload`, and `TorqueWrenchConnectionLeaseStatusDto` remain wire-compatible. `GET /assembly/work-sessions/:id/torque-wrench-confirmations/current` keeps its response shape; only its kiosk-authenticated selection semantics expand.

Revision note (2026-07-23 17:32+09:00): created the living plan after completing the required documentation and code analysis and after the user selected all-work-ID reuse, start-terminal-as-audit, and event-based validity.

Revision note (2026-07-23 18:05+09:00): completed implementation and validation; added the shared physical-profile lock after final concurrency review, recorded disposable PostgreSQL evidence and cleanup, and closed all progress items without publishing or deploying.

Revision note (2026-07-23 18:25+09:00): added full API/Web regression, workspace-quality, CI-policy, and document-inventory evidence after deployment and physical-wrench testing were explicitly deferred to the next day.

Revision note (2026-07-23 18:44+09:00): recorded commit `508d25b3`, Draft PR #1069, and its exact-head CI success while preserving the separate approval boundaries for merge, deployment, physical testing, and enforcement activation.

Revision note (2026-07-24 12:14+09:00): recorded production canary and physical acceptance, corrected the earlier no-physical-test outcome, documented the two observed UI root causes, and began the neutral-status and fixed-notification follow-up without changing API, database, agent, Bluetooth, or enforcement contracts.

Revision note (2026-07-24 12:32+09:00): completed the UI follow-up and recorded focused/full Web, lint/build, torque-agent, documentation, diff, and two-viewport browser-geometry evidence.

Revision note (2026-07-24 12:35+09:00): recorded the user's separate approval to commit, push, and deploy the UI follow-up while preserving the no-merge and no-enforcement boundaries.
