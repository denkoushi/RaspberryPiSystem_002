---
title: Hermes torque training retrieval sources
status: implementation-verified-in-part
category: plans
tags: [hermes, retrieval, torque-training, execplan]
audience: [ai-agent, developer]
last-verified: 2026-10-06
source_of_truth: true
related: [./hermes-cross-source-foundation-execplan.md]
---

# Hermes torque training retrieval sources


This living ExecPlan follows `.agent/PLANS.md`. Keep Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective current.

## Purpose / Big Picture


Kiosk Chat's JEV record search will expose completed torque wrench training sessions, operator statistics, and team statistics through three opt-in sources. Users can ask for an operator's results during a completion-date period, their tightening bias and progress, or the same recent and all-time team figures shown on the training screen. JEV interprets the question; the Pi5 searches a locally refreshed set of rows and displays their text. No inference or external request is needed to build training rows.

## Progress


- [x] (2026-10-06 09:28Z) Add three structured source definitions, labels, registration, and database readers.
- [x] (2026-10-06 09:30Z) Verify API transformations and reader registration: 30 unit tests passed.
- [x] (2026-10-06 09:33Z) Finish bounded local checks: 88 existing focused retrieval regressions, two final training retrieval tests, API lint/build and final no-emit typecheck passed.
- [ ] Full retrieval suite completion: sandbox localhost denial and Node native abort stopped the requested directory run.
- [ ] integrationPending: reviewer checks, explicitly authorized commit/PR, required CI and main integration.
- [ ] Explicitly authorized production deployment and source enablement; live JEV latency and kiosk checks.

## Surprises & Discoveries


The same employee-name value occurs in both session and operator sources. The existing planner retained filters belonging to an unselected source, which query-plan validation rejected. The generic fix removes filters outside the selected sources and resolves sorting fields within the selected sources; the synthetic mixed-corpus test covers that case without an external JEV call.

The team service owns all-time SQL aggregation and the recent ten-session boundary. Calling `TorqueTrainingTeamSummaryService.summary()` directly preserves both existing calculation paths and avoids duplicating its formulas.

## Decision Log


Decision (2026-10-06, implementation): keep the requested three source IDs and public visibility for kiosk, viewer, manager, and admin. Definitions carry source descriptions, fields, and Japanese labels; no `offlineExtraction` is configured. The default remains `nonconformity`.

Decision (2026-10-06, implementation): group operator rows by employee ID, use the latest completed session's name/code snapshots, and group condition breakdowns by `conditionFingerprint` (the stored identity of the bolt, material, torque, and jig conditions). Operator recent metrics cover at most ten sessions; condition breakdowns also include their own latest ten, matching the individual screen's window. Rank operators with counted attempts by all-time pass rate, using competition ranks (1, 1, 3 for a tie). Operators with zero counted attempts have no rank; an operator row requires at least one eligible session.

Decision (2026-10-06, implementation): reuse `summarizeTrainingAttempts` for session/operator metrics after excluding unaccepted, IGNORED, and null-deviation attempts. Existing writes populate deviation for accepted judgements and leave ignored attempts unaccepted. Condition breakdown prose shows bolt length, material, strength, torque limits, and jig code rather than the internal fingerprint. The existing team service is used unchanged. Percent fields contain percent units (pass rate multiplied by 100); prose shows one decimal. Positive mean deviation means 強め, negative means 弱め. Progress means recent pass rate is no lower and mean absolute error is no higher, with at least one improvement; mixed movements are described without asserting improvement. The recent window overlaps all-time, and lastTrainingOn is the last training date, not a period-specific aggregate.

Decision (2026-10-06, implementation): make two small source-neutral planner changes: discard filters outside `plannedSources` and choose the recent-sort field within `plannedSources`. A date-free team source otherwise inherited another source's date field and failed validation. The existing identifier-sort fallback remains in place. The two existing sources retain their definitions, readers, and single-source behavior. No source-specific training name is introduced in planner/executor code.

## Context and Orientation


`scripts/hermes-search/hermes-source-definition.mjs` registers source JSONs under `scripts/hermes-search/hermes-sources/`. `retrieval/catalog.mjs` derives identifier, date, facet, and body roles from their field names/labels. `completedOn` and `lastTrainingOn` become dates. The worker receives authorized API rows, selects a source using JEV, filters local records, and displays the original row text.

`apps/api/src/services/assembly/hermes-search-sources.ts` maintains the API source allowlist. `hermes-search-trial.service.ts` registers readers for enabled sources. New row transformations live in `apps/api/src/services/torque-training/torque-training-hermes-source.service.ts`. One refresh shares one Prisma session query between session and operator readers. Only COMPLETED sessions with `excludedAt: null` are read; defensive transformation filters preserve that boundary too. The team reader calls the existing summary service and reads no unbounded attempt corpus. Dates use Asia/Tokyo. This changes no schema, training API, UI, business-consultation route, infrastructure, or CI configuration.

## Plan of Work


Milestone 1 adds `torque-training-session.json`, `torque-training-operator.json`, and `torque-training-team.json`, registers all three IDs, and provides the new training-service readers. Session bodies include per-attempt Nm values and snapshots, overall outcome words, and signed maximum absolute deviation. Operator bodies include all-time/recent metrics, tightening tendency, comparison, condition breakdowns, and rank. Team bodies use the existing service's all-time/recent figures. Definitions and reader tests demonstrate opt-in loading and preserve the old default.

Milestone 2 tests completed/excluded boundaries, zero-attempt and one-operator cases, ties, trend wording, and policy agreement. Mixed synthetic corpora exercise the real planner with synthetic JEV choices and kiosk visibility, employee names, and October completion dates. Fix only source-neutral issues required for this path. Run the commands below within a total twenty-minute local verification budget, retrying failures at most once after a relevant correction. Record unrelated/environment failures without editing their code.

Milestone 3 is unperformed production work. The latest repository evidence in `docs/plans/hermes-cross-source-foundation-execplan.md` (2026-10-04, maintenance run `20261004-045601-6a2031`) records the existing enabled value as `nonconformity,knowledge_procedure`. Actual current device settings were not inspected. At an explicitly authorized deployment, confirm that current source list and preserve any later additions. Supply the deployment environment variable:

    HERMES_RETRIEVAL_SOURCES=nonconformity,knowledge_procedure,torque_training_session,torque_training_operator,torque_training_team

Use the standard deployment guide with an immutable reviewed target and successful CI; print the plan and select the exact Pi5 limit. Do not edit Ansible or secrets for this implementation. After deployment and corpus refresh, ask for a synthetic/test operator's results by month, the operator's bias/rank, and team recent/all-time figures. Compare them to the training screen and measure actual JEV response latency. These operational actions require separate authorization and are not evidence of local implementation completion.

## Concrete Steps


From repository root, run:

    node --test scripts/hermes-search/hermes-source-definition.test.mjs
    pnpm --filter @raspi-system/api test -- src/services/torque-training/torque-training-hermes-source.service.test.ts src/services/assembly/__tests__/hermes-search-sources.test.ts src/services/assembly/__tests__/hermes-search-trial.service.test.ts
    pnpm --filter @raspi-system/api lint
    pnpm --filter @raspi-system/api build

From `scripts/hermes-search`, run:

    node --test retrieval/

The API package has no dedicated typecheck script; its `build` script runs `tsc -p tsconfig.build.json` and copies existing renderer assets. Database-dependent training integration tests are outside the necessary synthetic unit evidence; no production/database mutation is required.

## Validation and Acceptance


Source-definition validation must accept all three IDs without changing the unset-environment default. Unit tests must show that excluded, cancelled, and running sessions never enter session/operator rows; accepted metric values equal the existing policy; ignored inputs are absent; rank and positive/negative/zero bias are correct. Team rows must exactly project the existing team service's raw values.

Synthetic retrieval tests must return only `torque_training_session:a-oct` when asked for 合成作業者A in October 2026, exclude their September session and another operator, preserve Japanese outcome/value text, and expose all three training sources to a kiosk principal. They must pass without contacting JEV. Existing retrieval regressions must be attempted; limitations must be reported rather than hidden by skips.

## Idempotence and Recovery


Readers and tests are repeatable and read-only. Each corpus refresh rereads authoritative sessions, so later exclusions remove both session records and their aggregate contributions. All source IDs remain opt-in. Operational rollback restores the confirmed previous enabled-source list and refreshes/restarts through the existing deployment procedure; code rollback can revert this isolated implementation in a separately authorized change. No migration is involved.

## Artifacts and Notes


API unit evidence: three files, 30 tests passed (including nine training row/reader tests). Source definitions: seven tests passed. The requested `node --test
retrieval/` directory run reported 29 passed and two localhost-listen EPERM failures before a Node native assertion terminated further execution. Focused
catalog/corpus/planner/executor/worker/period/value-index tests passed 88 existing cases. The final training-only command `node --test
scripts/hermes-search/retrieval/torque-training.test.mjs` passed two cases. During the focused run, a new team-sort test initially expected relevance; it was
corrected to the existing identifier fallback, and the final training-only run passed. API lint and build passed; after adding readable condition details, the
nine training tests and `pnpm --filter @raspi-system/api exec tsc -p tsconfig.build.json --noEmit` passed. Local validation took approximately five minutes,
below the twenty-minute budget. No live JEV measurement, device connection, deployment, commit, or integration is authorized in this implementation task.

## Interfaces and Dependencies


Use existing Prisma and `summarizeTrainingAttempts`; add no dependencies. The new module exports `TrainingSearchSession`, `TorqueTrainingSourceId`, `torqueTrainingSessionRows`, `torqueTrainingOperatorRows`, `torqueTrainingTeamRow`, and `createTorqueTrainingSourceReaders`. Authorized rows are `Record<string, string>` with `kind`, `id`, declared metadata fields, and declared body fields. Numeric metadata is text because `recordFromAuthorizedRow` retains string fields only. `createTorqueTrainingSourceReaders` returns three async readers; session/operator share a lazy session query for one refresh, while the team reader uses `TorqueTrainingTeamSummaryService` directly.

## Outcomes & Retrospective


Three opt-in sources and synthetic coverage are implemented locally. API unit tests, definition validation, focused retrieval evidence, lint, build, and final typecheck are successful. The requested full retrieval suite remains incomplete because of the reported environment/runtime failures. Main integration, production source enablement, real-data totals, kiosk live behavior, and measured external-JEV latency remain unperformed.

Revision note (2026-10-06): created the plan, recorded shared-name and date-free-source planner decisions, completed local evidence, and left full-suite completion, integration, and source enablement open.
