---
title: Assembly Torque Wrench Traceability
id: plan-assembly-torque-wrench-traceability
status: active
scope: assembly template tightening conditions, torque wrench master, physical-tool confirmation, torque-agent, torque audit records, responsive kiosk UI
date: 2026-07-17
source_of_truth: this file
related_code: apps/api/prisma/schema.prisma, apps/api/src/routes/assembly, apps/api/src/services/assembly, apps/web/src/features/assembly, apps/web/src/pages/kiosk, packages/shared-types, clients/torque-agent
related_docs: ../decisions/ADR-20260717-assembly-torque-wrench-traceability.md, ../design-previews/assembly-torque-wrench-traceability-preview.html, ./kiosk-assembly-torque-management-mvp.md
validation: preview approved; lint and affected builds pass; disposable-Postgres migration, upgrade, integration, and EXPLAIN checks pass; agent and deployment contracts pass; physical CEM3-BTLA payload capture remains pending
open_items: capture real CEM3-BTLA HOGP output and freeze its parser fixtures; rerun Ruff in a Poetry-capable environment; finish canonical operations documentation and final hardware-responsive acceptance
---

# Add Physical Torque Wrench Traceability to Assembly Work

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept current while work proceeds. Maintain this document in accordance with `.agent/PLANS.md` from the repository root.

## Purpose / Big Picture

After this change, an operator can configure one tightening condition once and reuse it across many uniquely numbered circle markers. A required-traceability template identifies the permitted torque-wrench capability rather than one irreplaceable physical tool. At work time, the operator confirms a specific serial-numbered wrench and its displayed settings, and every accepted or rejected torque event records the physical wrench and setting snapshot.

The system must refuse an incompatible, unregistered, uncalibrated, expired, wrongly configured, or unexpected wrench without advancing the current marker. It must still retain the input and reason as an audit event. Existing assembly templates and records remain usable in a legacy mode.

Two explicit gates protect the implementation. First, the user must approve a three-screen interactive design preview at 1920x1080 and 1366x768 before production UI, API, or database changes begin. Second, a real CEM3-BTLA HOGP payload must be captured before the production parser contract is fixed. No guessed separator or field order may cross that gate.

## Progress

- [x] (2026-07-17 06:13Z) Confirmed the original worktree was clean and fetched the latest `origin/main`.
- [x] (2026-07-17 06:13Z) Created `feat/assembly-torque-wrench-traceability` directly from `origin/main` because `main` is checked out by another worktree at `/private/tmp/raspi-phase3`; no other worktree was changed.
- [x] (2026-07-17 06:13Z) Re-read repository safety, architecture, documentation, Git, test, UI, and ExecPlan rules.
- [x] (2026-07-17 06:13Z) Recorded the implementation contract and the preview/payload approval gates in this ExecPlan.
- [x] (2026-07-17 06:32Z) Created and visually verified the interactive design preview for torque-wrench master, template editor, and work/exception states.
- [x] (2026-07-17 06:40Z) Presented the preview evidence and received explicit user approval to proceed with production implementation.
- [ ] Capture and sanitize real CEM3-BTLA output from required scenarios and freeze parser fixtures.
- [x] (2026-07-17 07:48Z) Implemented shared types, additive Prisma schema, safe migration, torque-wrench master services, unit conversion, and centralized eligibility policy.
- [x] (2026-07-17 07:48Z) Implemented template condition inheritance, range copy, global marker uniqueness, and hidden server-generated tightening IDs.
- [x] (2026-07-17 07:48Z) Implemented work confirmation, agent event intake, rejected-event audit, idempotency, admin override, and Excel traceability.
- [x] (2026-07-17 07:48Z) Implemented the parser-independent `clients/torque-agent` boundaries and integrated Docker Compose, Ansible, terminal profiles, and health checks.
- [x] (2026-07-17 07:48Z) Ran focused unit/integration, migration/upgrade, EXPLAIN, agent, Docker-runtime, infrastructure, lint, and build validation using disposable resources only.
- [ ] Update canonical assembly/measuring-instrument documentation and complete the retrospective.

## Surprises & Discoveries

- Observation: The repository-local `main` branch could not be checked out in this worktree.
  Evidence: `git switch main` returned `fatal: 'main' is already used by worktree at '/private/tmp/raspi-phase3'`. The fetched `origin/main` commit `b4c7d01a` was therefore used directly as the feature-branch base.

- Observation: The existing assembly schema cannot prove that a circle marker is unique across areas in one template.
  Evidence: `AssemblyTemplateBolt` has area-scoped ordering and tightening-ID constraints, while `markerNo` is only indexed by area. The editor also derives a new number from the selected area's current bolt count and renumbers later bolts after deletion.

- Observation: The existing assembly work path treats a wrench as free text and does not preserve a physical serial or settings.
  Evidence: `AssemblyLot.torqueWrenchId` and `AssemblyWorkSession.torqueWrenchId` are strings, while `AssemblyTorqueRecord` records torque value/source/raw payload but has no physical-wrench relation.

- Observation: CEM3-BTLA exposes one-way Bluetooth HOGP keyboard output; system code cannot remotely read the setting displayed on the wrench.
  Evidence: The official product page documents selectable output fields and HOGP communication but not remote setting read/write. This makes operator confirmation plus append-only setting history a required control rather than a UI preference.

- Observation: The in-app browser's explicit viewport override uses a 0.67 device scale, so integer outer dimensions produce CSS viewports one pixel above or below the requested height.
  Evidence: The responsive pass reported 1366x769 for a 915x515 override and 1919x1081 for a 1286x724-equivalent calculation. The default browser rendered clean screenshots at 1910x1075. Acceptance measurements use the CSS viewport and treat the one-pixel height difference as browser instrumentation, not application overflow.

- Observation: The feature migration safely supports both fresh installation and legacy upgrade, and refuses ambiguous historical marker identity.
  Evidence: All 149 migrations applied from zero. A database migrated to the prior version retained representative legacy values after the feature migration. A separate database containing a cross-area duplicate marker failed with SQLSTATE `P0001`; the migration rolled back and the original rows remained unchanged.

- Observation: The intended indexes serve the five high-volume traceability lookups.
  Evidence: With 5,000 profiles, 15,000 settings, 5,000 groups, 10,000 records, `EXPLAIN (ANALYZE, BUFFERS)` selected the serial-key unique index, profile/effective setting index, fastener/group indexes, source-device/event unique index, and session/recorded index respectively. A profile/memory/recorded index was subsequently included in the migration for replay-audit lookup.

- Observation: Runtime health testing caught an incorrect Python module working directory in the first agent image.
  Evidence: The Dockerfile was corrected to copy under `/app/torque-agent` and execute there. The rebuilt multi-stage image was 214 MB and returned `{ok: true, queuedEvents: 0, bound: false}` from its loopback health endpoint.

## Decision Log

- Decision: Reuse `MeasuringInstrument` as the physical asset record and add a one-to-one torque-wrench profile rather than duplicating storage location, calibration, and lifecycle state.
  Rationale: It preserves the existing asset-management source of truth and keeps torque-specific rules in a separate module.
  Date/Author: 2026-07-17 / Codex, confirmed by user.

- Decision: Templates select a capability group that can contain multiple models; work records select and snapshot one physical serial-numbered wrench.
  Rationale: A template should describe an allowed capability, while an audit record must prove which replaceable physical asset was actually used.
  Date/Author: 2026-07-17 / Codex, confirmed by user.

- Decision: Existing templates are backfilled as `LEGACY`; new templates and revisions saved by the new editor are `REQUIRED`.
  Rationale: This prevents historical data from becoming invalid while making new work enforce the stronger contract.
  Date/Author: 2026-07-17 / Codex, confirmed by user.

- Decision: Circle-marker identity and copied tightening conditions are separate concerns.
  Rationale: Marker numbers remain unique and stable. Bulk copy changes only condition fields and never coordinates, page references, callouts, ordering, or internal IDs.
  Date/Author: 2026-07-17 / Codex, clarified by user.

- Decision: Store wrench settings as append-only history and require first-use confirmation of the current history row against the physical display.
  Rationale: The device cannot be queried remotely; overwriting one current-value row would destroy auditability.
  Date/Author: 2026-07-17 / Codex, confirmed by user.

- Decision: Preserve rejected device inputs as `IGNORED` torque records and do not advance the work position.
  Rationale: Rejection controls safety, while retention proves what was attempted and why it was refused.
  Date/Author: 2026-07-17 / Codex, confirmed by user.

- Decision: A dedicated local `torque-agent` owns HID reading, durable delivery, and multi-device multiplexing. The API owns authorization, eligibility, current-position validation, and final acceptance.
  Rationale: Device I/O changes independently from assembly policy. A durable outbox prevents transient network failures from losing measurements.
  Date/Author: 2026-07-17 / Codex, confirmed by user.

- Decision: Do not begin production UI, API, schema, migration, or agent implementation before preview approval; do not fix the parser contract before real payload capture.
  Rationale: These are explicit acceptance gates in the approved plan and prevent expensive UI rework or an invented device protocol.
  Date/Author: 2026-07-17 / Codex, confirmed by user.

## Outcomes & Retrospective

The feature branch, living plan, ADR, and interactive three-screen preview now exist on the latest remote main. Browser validation exercised condition inheritance, range copy, all five work states, and both target responsive classes without console errors, outer overflow, or clipped controls. Production behavior, database state, existing Docker resources, and deployed hosts remain unchanged.

At the preview gate, update this section with the approved/rejected layout and any requested changes. At completion, summarize traceable user behavior, migration compatibility, device-capture evidence, test counts, EXPLAIN results, and any deferred operational work.

The user approved the preview without requested layout changes on 2026-07-17. Production schema, API, and UI work may now proceed. The separate real-device payload gate still applies to the CEM3-BTLA production parser; parser-independent agent boundaries and durable-delivery behavior may be implemented and tested with an explicitly labeled synthetic profile.

At the 2026-07-17 17:00 JST safety checkpoint, parser-independent production work is implemented on the feature branch. Validation includes 22 focused API integration tests, 6 torque-agent unit tests, 130 deployment/profile/probe tests, root lint with zero warnings, shared/API/Web production builds, full fresh and legacy-upgrade migrations, duplicate-marker rollback, representative EXPLAIN plans, Compose configuration, Ansible syntax, image build, and live container health. The only supported agent parser remains explicitly synthetic; no CEM3-BTLA field order or delimiter has been guessed. Final completion is therefore intentionally held behind the real-device fixture gate and remaining runbook/canonical-document updates.

## Context and Orientation

The Prisma schema is `apps/api/prisma/schema.prisma`. Generic physical measuring instruments already live in `MeasuringInstrument` with management number, storage location, calibration expiry, and lifecycle status. Torque-specific models must reference it rather than copy those columns.

Assembly API routes are registered under `apps/api/src/routes/assembly/index.ts`. Template normalization and revisions are handled in `apps/api/src/services/assembly/assembly-template.service.ts`. Work progression is controlled by `apps/api/src/services/assembly/assembly-work-session.service.ts`, and Excel output is produced by `apps/api/src/services/assembly/assembly-excel-export.service.ts`.

The template editor is `apps/web/src/pages/kiosk/KioskAssemblyTemplateEditorPage.tsx`, with draft mutation helpers in `apps/web/src/features/assembly/assemblyTemplateDraft.ts`. The operator work page is `apps/web/src/pages/kiosk/KioskAssemblyWorkSessionPage.tsx`. Existing local agent patterns live under `clients/nfc-agent`, `clients/barcode-agent`, and `clients/haizen-agent`, but none combines durable API acknowledgement with torque-specific parsing.

A capability group is a named fastener condition—nominal diameter, length, material, and strength class—associated with one or more torque-wrench models. A physical wrench is one serial-numbered `MeasuringInstrument` with a torque profile. A confirmation is a work-session record saying the operator compared one physical wrench's display with the latest registered setting for the current condition.

## Plan of Work

### Milestone 1: preview and approval

Create `docs/design-previews/assembly-torque-wrench-traceability-preview.html` as one self-contained, interactive mock. It must expose tabs for the master, template editor, and work screen. Work-screen state controls must show confirmed/armed, disconnected, wrong wrench, expired calibration, and admin exception states. The template screen must demonstrate a two-row maximum toolbar, a narrow condition pane without an editable tightening ID, default-on inheritance, and range copy from a selected marker to existing markers only.

Serve the directory through a local loopback HTTP server and inspect the actual rendered page at 1920x1080 and 1366x768. Exercise every tab and state, check horizontal and vertical overflow, and capture screenshots. Add a short entry to `docs/design-previews/README.md`. Present the evidence to the user and stop until approval.

### Milestone 2: real device contract

Configure a physical CEM3-BTLA to send serial number, torque, unit, and memory counter, plus date/time and judgement when available. Use TAB or newline as the final event terminator. Capture normal, below-limit, above-limit, repeated-memory, rapid consecutive, partial, and malformed transmissions. When multiple physical wrenches are available, capture at least two serials.

Store sanitized samples under `clients/torque-agent/tests/fixtures/cem3_btla/`. Record the exact field order, delimiters, escaping, locale decimal behavior, terminator, model firmware, and output configuration in the agent README and this plan. The parser implementation must be fixture-driven and must not accept speculative alternate shapes.

### Milestone 3: additive domain model and master API

Add shared DTOs and enums under `packages/shared-types/src/torque-wrenches`. Add `AssemblyTorqueTraceabilityMode` with `LEGACY` and `REQUIRED`. In Prisma add `TorqueWrenchModel`, `TorqueWrenchProfile`, `TorqueWrenchCapabilityGroup`, the group/model join, and `TorqueWrenchSettingHistory`. Store original unit values and canonical N·m decimals. Use normalized manufacturer/model/serial keys for deterministic uniqueness.

Add `templateId`, structured fastener fields, and capability-group reference to `AssemblyTemplateBolt`. Backfill the template ID through its area and add a template-wide marker unique constraint only after an explicit duplicate check. The migration must abort with an actionable error when duplicates exist and must never renumber historical markers. Make the legacy lot/session wrench strings nullable without modifying existing values. Add confirmation and torque-record audit columns additively so existing rows remain valid.

Implement separate torque-wrench routes/services. Keep normalization in pure helpers, conversion behind `TorqueUnitConverter`, and all compatibility decisions behind `TorqueWrenchEligibilityPolicy`. Master reads accept JWT or registered client key. Writes and setting-history append operations require ADMIN or MANAGER JWT. Referenced entities are retired, never hard-deleted.

### Milestone 4: template editing behavior

Make new templates `REQUIRED` and convert revisions saved by the new editor to `REQUIRED`. The server generates the internal tightening ID. Required templates reject missing structured fields or capability groups.

Use the globally smallest unused positive marker number for new tightening markers. Deleting a marker never renumbers another marker. Add a default-on inheritance toggle: the next marker receives the selected or most recently used condition, or existing defaults when no source exists.

Add a range-copy command using the selected marker as source and inclusive target marker numbers. It updates only existing tightening markers across all areas/pages, skips gaps, and reports changed/skipped counts. Copy nominal diameter, length, material, strength class, nominal/lower/upper torque, unit, and capability group only. Preserve marker number, coordinates, page, area, sort order, callout, persistent ID, and internal tightening ID.

### Milestone 5: confirmation, event intake, audit, and export

Add compatible-wrench lookup and confirmation endpoints. Eligibility requires exact structured fastener match, model membership, model range coverage, AVAILABLE or IN_USE state, non-null calibration valid through the current Asia/Tokyo date, exact latest-setting match after canonical conversion, and a current confirmation.

Extend agent torque intake with source event ID, expected template bolt, confirmation ID, serial, value, unit, raw payload, optional device time, memory counter, and device judgement. Match the client-key device to the session owner and make `(sourceClientDeviceId, sourceEventKey)` unique. Repeated delivery returns the original outcome. Wrong, unknown, expired, ineligible, stale-position, stale-confirmation, or unsupported-unit input is stored as `IGNORED` with a stable reason code and does not advance the marker.

Keep the existing legacy input shape only for LEGACY templates. REQUIRED templates accept ordinary work events from the agent. Add an ADMIN/MANAGER-only override endpoint and page that require a valid confirmation, value/unit, and non-empty reason; an override replaces the transport but does not bypass eligibility.

Update Excel output to include marker, required condition, actual value, physical serial, manufacturer/model, setting snapshot, acceptance/rejection reason, and override actor/reason. Retain the internal tightening ID only as an audit/compatibility column.

### Milestone 6: local torque-agent and deployment contracts

Create `clients/torque-agent` with independent HID adapter, parser registry, SQLite outbox, HTTP delivery adapter, and loopback control server. Only configured stable `/dev/input/by-id` paths may be opened, and input devices must be grabbed so measurements do not leak into kiosk text fields. Persist each event before network delivery; delete it only after a terminal 2xx acknowledgement; retry timeout and 5xx responses with the same event ID and bounded backoff.

The browser sends a short-lived binding heartbeat containing session, expected bolt, confirmed physical wrench, and confirmation ID to `127.0.0.1:7073`. An event without a live binding is retained as a local error and never guessed into a session. Multiple configured wrenches are multiplexed by their payload serial and events are serialized through the durable outbox.

Add the service to the client Docker Compose, a dedicated Dockerfile, Ansible configuration and lifecycle tasks, terminal profile/runtime registries, deployment change classification, and health-probe tests. Do not deploy or modify any real host.

### Milestone 7: documentation and final verification

Update the compact current-state sections in `docs/plans/kiosk-assembly-torque-management-mvp.md` and the measuring-instrument module docs. Correct any authentication documentation that disagrees with code. Add an operations README/runbook for Bluetooth pairing, configured HID paths, queue inspection, and safe restart. Link canonical documents from thin indexes without copying narrative logs.

Run focused tests after each milestone and the full affected suites at the end. Record only concise evidence in this plan, leaving generated logs and screenshots in designated artifact paths.

## Concrete Steps

Run all repository commands from `/Users/tsudatakashi/RaspberryPiSystem_002`. The branch has already been created from fetched `origin/main` as described in Progress.

For the preview, start a local server bound to loopback:

    cd docs/design-previews
    python3 -m http.server 8765 --bind 127.0.0.1

Open `http://127.0.0.1:8765/assembly-torque-wrench-traceability-preview.html`, exercise all tabs/states, then terminate the server. This process has no application or database access.

For production code, use the existing workspace commands and add focused tests before full suites:

    pnpm --filter @raspi-system/shared-types build
    pnpm --filter @raspi-system/api build
    pnpm --filter @raspi-system/web test
    pnpm --filter @raspi-system/web build
    pnpm lint --max-warnings=0
    cd clients/torque-agent
    poetry run pytest
    poetry run ruff check .

Database tests must use a unique temporary container, volume, and network based on one run ID. Do not use the repository helper that owns the fixed `postgres-test-local` name. Bind a random container port only to `127.0.0.1`, export the resulting disposable `DATABASE_URL`, and install an EXIT/INT/TERM trap before migration. Use `pgvector/pgvector:pg15`; pulling the image is allowed. The trap must remove the temporary container, volume, and network, and a final `docker ps`, `docker volume ls`, and `docker network ls` filter must prove the run ID is absent.

Deploy migrations from zero. In a second disposable database, deploy through the migration immediately before this feature, insert representative legacy template/lot/session/record rows with SQL, apply the new migration, and assert the old values and counts remain unchanged. Run relevant integration tests against the same disposable server.

Load representative master, group, setting, session, and event volumes and run `EXPLAIN (ANALYZE, BUFFERS)` for normalized serial lookup, latest setting, compatible-group lookup, event idempotency, and session history. Record the chosen indexes and actual plan nodes in this document. Finish with infrastructure contract tests, agent image build, `git diff --check`, Markdown-link validation, and a review that no secret or generated database file is tracked.

## Validation and Acceptance

The preview milestone is accepted when all controls work in the standalone mock, all five work states are reachable, the template toolbar occupies no more than two rows, short fields are not stretched, no action is clipped, and the document pane remains the dominant surface at both required viewports. User approval is mandatory.

The device-contract milestone is accepted when sanitized real samples exist and parser tests distinguish complete events, partial input, malformed input, two serials when available, repeat/send, and rapid consecutive events. No parser behavior may rely only on product-page prose.

The domain milestone is accepted when legacy rows migrate unchanged, new required templates enforce structured fields, template-wide marker duplicates fail at both service and database boundaries, and referenced master data cannot be physically deleted.

The work milestone is accepted when a correct confirmed wrench advances an in-range marker and snapshots its serial/settings; each incompatible case creates one ignored audit row and leaves the marker unchanged; a retried event key returns one stored row; and an admin override is authenticated and reasoned.

The UI milestone is accepted when markers 1 through 35 can share condition values while retaining unique identity and placement, required work has no ordinary manual input, and legacy work keeps its existing flow. The export must prove the actual wrench and setting per record.

The agent milestone is accepted when two simulated HID sources, API outage/recovery, SQLite restart, binding expiry, duplicate acknowledgement, and malformed input pass without data loss, double insert, cross-session assignment, or keyboard leakage.

## Idempotence and Recovery

All schema work is additive before constraints. Migration tests run only on disposable databases. If existing marker duplicates are found, stop and report the template/marker groups; do not repair them automatically. A later data-remediation plan requires explicit authorization.

The torque agent's outbox makes delivery retryable. Restarting it replays the same event IDs. A 2xx acknowledgement is the only condition that removes a queued event. Parser fixtures are immutable evidence and may only be replaced by a documented new capture/profile.

Preview files and documentation are ordinary feature-branch commits and can be reverted independently from later schema/API commits. No push, merge, deploy, real-host Ansible operation, existing database mutation, or existing Docker-resource deletion is authorized by this plan.

## Artifacts and Notes

Expected preview artifact:

    docs/design-previews/assembly-torque-wrench-traceability-preview.html

Expected design decision record:

    docs/decisions/ADR-20260717-assembly-torque-wrench-traceability.md

Expected production parser evidence after the hardware gate:

    clients/torque-agent/tests/fixtures/cem3_btla/

Keep screenshots and short validation summaries as artifacts; do not commit transient server logs, SQLite queues, credentials, or raw production identifiers.

Preview evidence captured on 2026-07-17:

    1910x1075 master: no clipped controls; body 1910x1075 with no outer scroll.
    1910x1075 template: document pane 1267px, condition pane 350px, toolbar 43px high, no clipped controls.
    1910x1075 work: document pane 1511px, work pane 356px, no clipped controls.
    1366x769 master: body/app/screen dimensions equal scroll dimensions; no clipped controls.
    1366x769 template: document pane 792px, condition pane 320px, toolbar scrollWidth equals clientWidth, no clipped controls.
    1366x769 work: document pane 1003px, work pane 330px, no ordinary manual input, footer visible, no clipped controls.
    Range-copy interaction: 2–35 reported 31 updated and 3 missing; condition chips changed while marker identity remained represented separately.
    Inheritance interaction: switch changed from checked to unchecked and copy changed to the default-value explanation.
    Work states: confirmed/ARMED, disconnected/OFFLINE, wrong/REJECTED, expired/BLOCKED, and override/ADMIN all rendered; override form was visible only in the ADMIN state.
    Browser console: zero warning or error entries.

## Interfaces and Dependencies

The shared type package will expose `AssemblyTorqueTraceabilityMode`, torque-wrench master DTOs, confirmation DTOs, agent event DTOs, and stable rejection reason codes. The API will keep legacy assembly input types at the boundary and convert them to domain commands rather than leaking legacy strings into the new policy.

`TorqueUnitConverter` is a pure interface accepting decimal value and observed unit and returning a canonical N·m decimal or an unsupported-unit result. `TorqueWrenchEligibilityPolicy` accepts an immutable template condition, model capability, physical asset state, latest setting, current date, and optional confirmation; it returns either eligible data or one stable rejection code. HTTP handlers, Prisma queries, and React components must not duplicate these rules.

The torque agent will define independent ports for HID events, payload parsing, durable outbox persistence, work binding, and API delivery. The CEM3-BTLA parser is one adapter selected by an output-profile identifier derived from captured fixtures. SQLite, evdev, WebSocket, and HTTP are implementation details behind those ports.

Revision note 2026-07-17 06:32Z: Created this self-contained execution plan after branching from fetched `origin/main`, then added the approved-scope interactive preview and responsive browser evidence. The production implementation remains deliberately paused at the user approval gate.

Revision note 2026-07-17 06:40Z: Recorded the user's preview approval. Opened the production schema/API/UI milestones while retaining the independent real-device payload gate for the final CEM3-BTLA parser profile.

Revision note 2026-07-17 07:48Z: Recorded the production checkpoint, disposable-database migration and EXPLAIN evidence, affected test/build results, and the remaining real-device fixture gate before the requested 17:00 JST safe pause.
