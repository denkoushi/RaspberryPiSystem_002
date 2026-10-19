# Assembly torque training

## Progress

- [x] Current assembly, torque-wrench, NFC, agent, migration, and kiosk route contracts inspected.
- [x] Implementation branch created from `origin/main` without touching the original WIP worktree.
- [x] Add schema and migration.
- [x] Add training domain/API and lease cutover support.
- [x] Add agent delivery context and kiosk UI.
- [x] Run focused unit, integration, Docker/Postgres, migration-validator, agent, Web, and Playwright verification.

## Surprises & Discoveries

- The production migration validator rejects changes needed to relax the existing assembly-only lease row (`NOT NULL`, existing-table CHECK/FK, and DML). The runtime therefore needs one additive, constrained usage-lease table and a maintenance-window cutover; it must never operate both lease tables as active backends.
- `KioskAssemblyHomePage` and the assembly route/service files are already large. Training logic is kept in new modules and existing assembly code receives only adapters and route/link wiring.

## Decision Log

- Training is a torque-sense exercise: no axial-force measurement, qualification, ranking, or manual torque entry.
- A training program is versioned and identified for analytics by an immutable fingerprint containing torque limits, bolt/material/strength fields, capability group, and training-jig condition code.
- Existing JWT `ADMIN` authorization is reused for settings and all-employee results. No new password or view token is introduced.
- The only usage-lease owners are `assembly` and `training`. The old table is drained and retired from runtime before the new table becomes authoritative.
- The assembly lease serializer requires both `ownerKind=ASSEMBLY` and the requesting client before it exposes an owner token. A same-device training lease is therefore `owned_by_other` from the assembly view.
- PostgreSQL partitions the operator history query by immutable condition fingerprint and limits each partition to ten completed, non-excluded sessions. Versions with equal fingerprints share a series; changed conditions do not.
- The training route is lazy-loaded, and forced ADMIN login clears an existing non-ADMIN session before navigation is released; the WebSocket/NFC E2E waits on an explicit ready signal rather than a timer.

## Outcomes & Retrospective

- The additive migration passed Prisma validation, the expand-only validator, and fresh PostgreSQL deployment. New PK/FK/CHECK/UNIQUE constraints are inline in each `CREATE TABLE`; no destructive statement, rename, or DML was introduced.
- Focused PostgreSQL integration covered six concurrent training inputs (exactly five accepted), source-event replay, strict start request IDs/current-version checks, cancel/complete lease release history, assembly↔training same-profile exclusion on one client, stale-token fencing, fingerprint-specific recent-ten aggregation, locked concurrent revisions, and ADMIN 401/403/success. The focused training suite passed 5/5 tests; the existing torque-wrench traceability suite passed 3/3 on a fresh database (8/8 total).
- Training acquisition and release history retain the adopted confirmation ID; the focused completion-history assertion verifies the traceability link alongside the current lease row.
- The earlier two-case assembly red result was caused by a comparison run that did not provide the CI storage environment (`FILE_STORAGE_ROOT`, `PDF_STORAGE_DIR`, `PHOTO_STORAGE_DIR`, and related paths). With the CI-equivalent variables pointed at a unique temporary root and fresh PostgreSQL databases, both this branch and clean `origin/main` passed the identical assembly command: 32/32 tests. No assembly procedure-sequence code or assertion was changed.
- The same CI-equivalent run completed its explicit Docker cleanup before checking labels; both runs reported `TEST_EXIT=0` and label residue 0.
- Agent pytest (53), deploy identity contract tests (4), Web build/lint, API build/lint, Playwright NFC→five-attempt→cleanup→ADMIN-return E2E (1 passed), the frozen cutover script's success/active>0/NOWAIT/probe-failure/rollback-active>0 scenarios, `git diff --check`, and temporary Docker cleanup all passed. The deploy-contract command exited 0 (`276` tests, `skipped=1`, all checks passed). No production deployment or real hardware operation was performed.
- Core responsibilities remain separated: route schemas/auth/DTOs; training service and pure policy; Prisma transaction/repository calls; the small assembly/training lease union adapter; agent transport/outbox reuse; and the kiosk page/admin panels. Tests cover the policy boundary, API transaction/concurrency boundary, transport contract, and Web compile boundary respectively.
