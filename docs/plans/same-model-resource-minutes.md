# Share production board part minutes across same-model machines

This ExecPlan follows `.agent/PLANS.md`.

## Purpose / Big Picture

An operator can enter 品番の値 on either 021 or 022 and use that definition on both machines, including operation-split bars moved between them. Administrators configure site-specific groups in 生産スケジュール設定. Placement, resource capacity, unit splitting and load destinations remain per physical machine.

## Progress

- [x] 2026-11-15: Read the supplied investigation and approved HTML mock; preserve existing untracked `.claude/` material.
- [x] Add Prisma group/member tables, canonical resource resolution and transactional value migration.
- [x] Expand canonical values for physical-resource readers; resolve direct SQL operation reads and site-specific reconciliation.
- [x] Add management endpoints, shared contracts, management card and grouped kiosk editing/cache behavior.
- [x] 2026-11-15: Generate Prisma Client, pass API/Web type checks and focused unit/UI validation.
- [x] 2026-11-15: Repair empty-group transaction mocks; restrict the management card to registered factories and reject resolved `shared` writes with 400.
- [x] Limit value migration and piece locking to changed memberships; restore parallel minutes reads and configure same-lot pieces across the group while preserving placement.
- [x] 2026-11-15: Add group create/add/remove/dissolve to the kiosk value sheet (agreed mock), with per-part conflict choice (`resolutions`) on save; the admin card stays.
- [ ] Execute the two new real-DB integration cases against a dedicated migrated test database (not available locally).

## Surprises & Discoveries

Off-board delete-only reconciliation retains definitions matching any site's effective raw resource or representative resource. Preserve the existing cross-site resource-code matching behavior; it removes obsolete evidence without filling new completion records.

The combined value sheet sums the existing per-machine quantities and lot counts. A lot represented on both physical machines contributes each machine’s count, matching the requested sum.

## Decision Log

Use the smallest resource code by JavaScript string comparison as the canonical definition key. Expand canonical rows into physical-resource response rows so projection, normal and aggregate load paths retain existing contracts.

Group replacement takes the existing common critical transaction lock before piece locks. Minutes-source updates take the same first lock; ordinary definition writers already take it. Only machines whose membership sets change contribute value rows and part numbers to migration, locking and reconciliation. Unchanged memberships, including reordered input, leave values untouched. Minutes reads use `Promise.all` without starting a read transaction.

Preserve part and operation IDs by moving a row when its old key is no longer required. Copy when a detached member still requires its old row. Conflicts compare parent minutes, setup, operation numbers and each operation's minutes/setup, ignoring IDs.

Configuration targets unfinished unit pieces in the same lot whose leading bars are on any group member. Split-source usage checks cover the group; rewritten boundaries retain each target's physical leading resource, and interval replacement preserves placement. Ordinary moves already preserve splits and completion records.

The same-model management card owns a factory selector populated from registered sites, excludes `shared`, and defaults to the first factory. The rest of the page keeps its existing location selector. API saves reject any location resolving to `siteKey='shared'` before a transaction starts.

## Context and Orientation

The API code lives under `apps/api/src/services/production-schedule/`. `same-model-resource-resolver.ts` reads site-specific groups. `same-model-resource-groups.service.ts` migrates definitions in one transaction. `grinding-planning-board-resource-minutes.service.ts` supplies expanded values and canonical writes. `sessaku-pieces/piece-operation-definitions.ts` handles definition reads and reconciliation. The settings route uses the page's existing ADMIN/MANAGER authorization.

Shared contracts live in `packages/shared-types/src/common/production-schedule-grinding-planning-board.ts`. The admin card and kiosk value sheet use existing Card/Button/table patterns and no new dependencies.

## Plan of Work

Implement storage and transactional migration first, then canonical read/write resolution and piece reconciliation. Add site generation tracking to both board and load tokens. Wire the management card through the existing API client/hooks and pass group metadata through the existing kiosk minutes response. Verify group migration, conflicts, detached copies, source alignment, shared editing and split-operation behavior with focused tests.

## Concrete Steps

Run only the four correction-task validation commands: API `tsc -p tsconfig.build.json --noEmit`, Web `tsc -b`, API Vitest for `sessaku-pieces/__tests__`, group migration, resource-minutes storage and board state, and Web Vitest for the grinding planning board, admin pages and resource-minutes hooks. A dedicated database is required for real database integration tests; never repurpose the production database.

## Validation and Acceptance

Invalid groups fail with 400 before mutation. Conflicting part definitions fail with 409 and a part-number list. One-sided definitions merge, representative changes preserve values, detached members retain copies, and own/original applies to the whole group. A write using 022 must affect required minutes for 021. Shared split sources must resolve the same operations. The value sheet shows a combined heading, union of parts, summed quantities and one input per shared value. The management card rejects a group of fewer than two machines.

## Idempotence and Recovery

The schema migration only creates new tables. Replacing groups is atomic: validation/conflicts roll back the transaction. Repeating a valid setting preserves values. Existing `.claude/` files and secrets are outside the editable scope. No database migration is applied during local implementation.

## Outcomes & Retrospective

Regression tests cover empty group mocks, `shared` rejection, unchanged memberships, migration scope, same-lot configuration on 021/022, physical placement preservation and group-wide split-in-use/completed-boundary checks. Real-database integration tests run in CI.

The location/site test refreshes the real site-directory resolver with a device whose location prefix differs from its explicit site. Management resolution and kiosk `resolveSiteKey` both return `canonical-site`.
