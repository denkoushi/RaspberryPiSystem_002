# Run Hermes preparation whenever DGX capacity is available

This is a living ExecPlan maintained under `.agent/PLANS.md`.

## Purpose / Big Picture

The user wants document preparation to progress without waiting for 03:00, with interactive requests taking priority. Karakeep has no daily duration cap and is lowest priority. This repository owns only the business consumer; DGXSparkControlPlane owns admission and Karakeep. Existing source verification and atomic answer adoption stay unchanged.

## Progress

- [x] 2026-09-14: lifecycle audit and start created `feat/dgx-background-admission` from `b5db0e0d701e7b40364e563abd3e60960fad975c`.
- [x] Implemented optional spare-capacity scheduling and DGX background request identity.
- [x] Added tests for no work, deferral without consuming progress, immediate next batch and no busy retry loop.
- [x] Finish local validation and review the cross-repository boundary.
- [ ] Production acceptance is a separate, unexecuted stage.

## Context and Orientation

`apps/api/src/services/assembly/business-hermes-nightly.scheduler.ts` starts preparation, while `business-hermes-nightly.service.ts` reads sources, prepares bounded candidates and invokes the existing answer-cache evaluator. `document-attempts.json` is the scheduling checkpoint, saved only after preparation finishes. `apps/api/src/services/inference/adapters/openai-compatible-text.adapter.ts` sends model calls. This feature needs the companion Control Plane branch `feat/dgx-background-admission`; that repository's `docs/exec-plans/35-background-admission.md` describes central admission.

## Decision Log

Keep existing journals and the existing inference engine; add no package dependencies. A `background` completion option selects the fixed `dgx-background-preparation` alias, which the authenticated DGX boundary maps to the business model with priority 10. Karakeep uses priority 20; business foreground uses 0 and private foreground 1. Lower values take precedence. These numbers are routing classes, not user-controlled business importance votes.

Do not force DGX startup from this low-priority consumer: the existing central keep-warm/startup behavior remains authoritative. Admission or readiness deferrals return a normal deferred result without consuming the document checkpoint. Waiting HTTP calls are not durable jobs; existing source ledgers and cache job files own retryable work. Repetition may recompute the last incomplete bounded batch, but must not publish unverified or duplicate answers.

## Plan of Work

Add `BUSINESS_HERMES_BACKGROUND_ENABLED`, default false, and expose it through the existing release role. With this enabled, the scheduler checks each minute instead of at a fixed hour. After a completed document batch, it starts the next immediately. No eligible documents cause a 15-minute discovery backoff; busy admission causes a one-minute backoff. A conversation-only batch is not repeated in a tight loop. The existing four-document batch is a transaction size, no longer a nightly quota. The per-batch 20-minute cancellation bound remains, independent of any daily allowance.

## Concrete Steps

In this task worktree, use the existing offline pnpm dependencies, generate Prisma and build `@raspi-system/shared-types`, `@raspi-system/part-search-core`, and `@raspi-system/shelf-layout-core`. Run focused Vitest files for the text adapter, nightly service, preparation and scheduler. Run ESLint for changed TypeScript files and `pnpm --filter @raspi-system/api exec tsc --noEmit -p tsconfig.build.json`.

## Validation and Acceptance

The background alias must be sent with the original generation parameters. HTTP 429 or 503 must defer without an internal blind replay, startup preemption, or an attempt timestamp that suppresses retry for seven days. Empty work must make no inference call. A completed source batch must start the next without waiting for the next scheduled minute; unchanged conversation work must back off. Existing source-fact adoption tests must retain their prior behavior.

Real deployment acceptance must confirm the installed Hermes native Runs honors the Karakeep model override, all configured DGX consumers use managed endpoints, and the active vLLM supports priority scheduling. Measure foreground latency with concurrent background work before selecting final admission capacity. These checks have not been run against production by this implementation task.

## Idempotence and Recovery

Default false preserves the deployed nightly schedule until both repositories are ready. Deploy the Control Plane contract before enabling the consumer. To disable business opportunistic processing, set the flag false; old scheduling and runtime control remain. No existing answer or source data migration is required. Background deferral occurs before evaluator activation and preserves the last completed checkpoint. Existing candidate activation hash checks remain mandatory.

## Surprises & Discoveries

Initial typecheck found missing generated outputs from two local workspace packages, not a source regression; building those packages resolved the invocation. An initial new deferral test retained the fixture's three queued successful mock responses; resetting that mock before injecting deferral fixed the test setup.

## Outcomes & Retrospective

Local implementation complete. All 18 focused Vitest tests passed; changed TypeScript ESLint and API build typecheck passed. Companion Control Plane tests cover manual private selection, draining and return before resuming. No commit, push, merge or deployment performed. Infrastructure validation budget is 45 minutes of validation and failure investigation.

## Interfaces and Dependencies

`TextCompletionRequest.background?: boolean` is used only with the DGX `system-prod-primary` model. `InferenceDeferredError` is a typed return path from the adapter to the preparation service. The release variable `business_hermes_background_enabled` maps to the new environment switch. No workflow engine, scheduler service, message broker or additional package is introduced.

Revision: 2026-09-14, records the implemented consumer contract and the unexecuted production boundary.
