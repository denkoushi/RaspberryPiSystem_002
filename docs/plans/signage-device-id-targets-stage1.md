# Signage device ID targets: stage one

This plan follows `.agent/PLANS.md`. It covers local implementation and validation only.

## Purpose / Big Picture

Schedules, kiosk preview selections, renderer files, and delivery tracking use `ClientDevice.id`. The admin web chooses signage terminals with `ClientDevice.isSignage`. The existing credential fields remain in responses and storage for this stage. Terminals continue authenticating with `x-client-key`; the API resolves that credential to an ID.

## Progress

- [x] Add one additive migration and Prisma fields.
- [x] Move runtime matching, images, tracking, and Hermes targets to IDs.
- [x] Validate target existence, accept cached legacy inputs, and synchronize legacy columns.
- [x] Move web targeting and preview selection to IDs and add the terminal signage toggle.
- [x] Update affected fixtures and add contract tests.
- [x] Record final verification results.

## Context and Orientation

`apps/api/prisma/schema.prisma` defines device and schedule storage. `apps/api/src/services/signage/signage.service.ts` selects schedules and owns schedule writes. Renderer storage is `apps/api/src/lib/signage-render-storage.ts`. Kiosk preview validation and persistence live in `apps/api/src/services/kiosk/kiosk-signage-preview.service.ts`. Client edits flow through `apps/api/src/routes/clients` and `apps/api/src/services/clients/client-telemetry.service.ts`. Hermes prepares proposals with IDs and display names; schedule persistence alone handles the rollback fields.

The admin hub, schedule editor, data board schedule fixtures, and kiosk preview modal live under `apps/web/src`. Their target values are device IDs. `packages/shared-types/src/tools/index.ts` also describes client devices.

## Plan of Work

The migration adds `isSignage`, `signagePreviewTargetDeviceId`, and `targetClientDeviceIds`. It backfills the flag from the historical credential naming convention, maps schedule keys to device IDs while dropping missing devices (disabling schedules left with no target), and maps saved preview targets to device IDs. Existing preview rows containing IDs are preserved too.

Schedule writes prefer explicitly supplied IDs, validate every requested device, and save both IDs and current credentials in a single Prisma write. Cached key inputs are resolved before saving. Updates without target input leave both target arrays untouched, so a concurrent target change is never overwritten. Invalid legacy input is rejected rather than converted to a global assignment.

Kiosk and ordinary client edit routes validate preview targets using `isSignage`. Clearing a target clears both columns. Renderer filenames and delivery map keys derive from IDs. The image route resolves terminal credentials at request time. Management image previews pass a device ID and require ADMIN or MANAGER authorization; they do not count as terminal delivery. Existing overview credential fields remain for stage-one compatibility, while the web uses its new `clientDeviceId` field.

## Milestones

The storage milestone is complete when Prisma generates successfully and the migration is additive. The runtime milestone is complete when request-key matching, legacy conversion, synchronized writes, preview validation, and render isolation tests pass. The web milestone is complete when target pickers use `isSignage` and IDs, the terminal toggle saves for ADMIN and MANAGER, and web tests and type checking pass.

## Concrete Steps

From the repository root, generate Prisma with `pnpm --filter @raspi-system/api exec prisma generate`. Run API tests from `apps/api` with the supplied test JWT secrets and `npx vitest run src/services/signage src/routes/signage src/routes/kiosk src/routes/clients src/services/kiosk src/services/business-hermes`; include `src/lib/signage/__tests__` to check the updated helpers. Run API TypeScript with `pnpm --filter @raspi-system/api exec tsc --noEmit -p tsconfig.build.json`.

Run web TypeScript with `pnpm --filter @raspi-system/web exec tsc --noEmit -p .`. Run web Vitest for `src/features/admin/signage-hub src/features/admin/signage src/features/admin/data-boards src/lib src/pages/admin`, plus `src/components/kiosk/KioskSignagePreviewModal.test.tsx`. Run `pnpm -r lint --max-warnings=0`.

## Validation and Acceptance

An unknown request credential selects the same schedules as an omitted credential. Known credentials select schedules by their resolved ID. Both new ID input and legacy key input save corresponding ID/key arrays. Preview targets without `isSignage` are rejected. Failed terminal rendering preserves isolation from later terminals. Delivery tracking and image lookup use IDs. Web selection never inspects a returned terminal credential.

Verification runs disable implicit `.env` reads using a temporary Node preload outside the repository. PostgreSQL integration fixtures are updated, but integration tests run only if an already configured database is reachable. No database is started and no migration is executed.

## Surprises & Discoveries

Existing kiosk preview code already saved some IDs in the legacy column. The migration therefore first resolves actual keys, then preserves remaining ID-valued references. The consultation service already works with ID/name summaries and explicitly forbids credential output; it needs no functional change.

The client route test fixture lacked the user lookup used by current authentication. Its mock is updated to exercise the real ADMIN/MANAGER boundary for the requested new fields.

## Decision Log

Use the new ID fields as the runtime source of truth. Keep key conversion and rollback synchronization at persistence boundaries so rendering and the web cannot depend on legacy target values.

Keep the existing `clientKeysRendered` numeric response counter and legacy overview credential field for stage-one response compatibility. Neither is used as a terminal identifier by the web.

## Idempotence and Recovery

The migration is deployed once through the normal Prisma mechanism in a later authorized stage. It drops no columns. Rolling application code back can use the synchronized legacy fields. Old render files are left intact; the new renderer populates ID-based paths on its next cycle. Until then, an ID-based cache miss shows the existing empty-content message.

## Interfaces and Dependencies

No dependency is added. Schedule inputs add `targetClientDeviceIds`. Client edits add `isSignage` and `signagePreviewTargetDeviceId`, retaining legacy preview input. The kiosk route accepts the canonical preview ID field and the existing cached ID alias. Public schedule output adds IDs without exposing legacy credentials. Existing authenticated responses retain their legacy credential fields.

## Outcomes & Retrospective

Final local verification (no database; PostgreSQL integration tests not executed):

- API Vitest for signage, kiosk, clients, business-hermes, `lib/signage` and `services/clients`: 118 files passed, 1 skipped; 1107 tests passed, 3 skipped.
- Web Vitest for kiosk components, API domains, signage features and admin pages: 72 files, 464 tests passed.
- API and web TypeScript checks: exit 0.

Review follow-ups applied: schedules whose stored targets all point at removed terminals are disabled by the migration instead of becoming global; updates without target input leave targets untouched; the kiosk preview's legacy column stores the device ID, as older versions already did.

Deployment notes: deploy the API before the web. Renderer image paths change, so a terminal may show the empty-content message until the next render cycle. If the application is rolled back after the migration, schedule edits made on the old version update only the legacy array; re-run the backfill statements before moving forward again.
