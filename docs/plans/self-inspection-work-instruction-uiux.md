# Self-inspection work-instruction UI/UX

This ExecPlan is a living document. Keep `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` current while implementation proceeds.

## Purpose / Big Picture

Add self-inspection as a selectable kiosk initial route, make work-instruction memos revision-owned without mutating imported source text, remove repeated local-recovery prompts, and improve the work-instruction editor/viewer layouts. The result is observable from the admin client selector and the kiosk self-inspection work-instruction editor/viewer.

## Progress

- [x] 2026-09-01: Audited the canonical repository and created `feat/self-inspection-work-instruction-uiux` through the repository lifecycle CLI.
- [x] 2026-09-01: Inspected shared route, work-instruction revision, recovery, editor, viewer, test, and disposable-Postgres boundaries.
- [x] 2026-09-01: Added the shared self-inspection initial route, registration allowlist, tests, and operator/API documentation.
- [x] 2026-09-01: Added revision-owned memo overrides, migration, trusted draft API contract, published projection, and disposable-Postgres validation.
- [x] 2026-09-01: Added editor memo draft state, explicit review/reset commands, recovery v2, responsive layout, history toggle, toolbar status, and inspector accessibility fixes.
- [x] 2026-09-01: Split viewer card/image-dialog/navigation responsibilities and added photo navigation, accessible numbering, and expanded memo presentation.
- [x] 2026-09-01: Passed focused tests, disposable-Postgres migration/SQL/EXPLAIN/integration validation, Chromium E2E, builds, lint, diff checks, and final lifecycle audit.

## Surprises & Discoveries

- The client initial route is a nullable string, so adding `self_inspection` needs no database migration.
- Imported source memo text is immutable, while edit revisions currently own only overlays/assets.
- The recovery read effect can rerun because an inline callback changes identity, and restore does not consume the stored record.
- The editor currently renders comparison images above the edit target, which is the reverse of the requested layout.
- Canonical full-set memo saves need explicit tombstones for source reset; silently omitting an existing override would otherwise make data loss indistinguishable from a reset.

## Decision Log

- Keep source memo text immutable and persist edits in a revision-owned relational override table.
- Save overlays and memo overrides atomically under one optimistic `editVersion`.
- Keep local recovery, but show it once per revision/source/hash/edit-version identity and preserve server memos when restoring v1 overlay-only records.
- Require an explicit keep-override/use-source choice when the imported source memo changes.
- Keep the old overlays endpoint as an adapter that preserves memo overrides while the new draft endpoint is canonical.
- Treat client memo fingerprints and migration states as untrusted. Existing rows retain server-owned base/state, KEEP verifies the current target fingerprint, and USE_SOURCE is the only deletion command.
- Apply smaller text and thicker line defaults only to newly created work-instruction overlays, not shared Assembly defaults or existing overlays.

## Plan of Work

1. Extend the shared initial-route source of truth, shell allowlist, documentation, and route/API tests.
2. Introduce a memo-specific migration state and `WorkInstructionEditMemoOverride` with revision ownership, source/target step identities, memo fingerprints, uniqueness, and indexes. Add pure memo migration functions and wire copy/save/publish/discard/read projection through repository ports.
3. Add the canonical draft save endpoint and DTOs. Preserve source `text`; expose override/effective text and review state. Keep the legacy overlay endpoint memo-preserving.
4. Add pure web memo draft state and recovery v2, then wire memo edit/reset/review/reassign behavior into the controller without moving domain decisions into React.
5. Split editor layout/history/memo/status UI and viewer card/image-dialog/navigation responsibilities. Implement the requested responsive layout, accessibility, and per-feature defaults.
6. Validate in increasing scope: unit/component, API integration, disposable Postgres migration/SQL/EXPLAIN, Playwright viewports/WebKit, builds, diff check, and lifecycle audit.

## Validation and Acceptance

Use focused workspace test commands first. Database validation must run only through `scripts/test/work-instructions-validation.sh`, which creates uniquely named disposable resources on a loopback random port and removes them on exit. The inner overlay DB validation must deploy migrations twice, verify status and constraints, exercise repository/API tests, run ANALYZE/EXPLAIN, and end with `TEMP_RESOURCE_REMAINING=0`. Playwright must cover 1280x800, 1920x1080, and a short-height viewport for editor/viewer behavior.

## Outcomes & Retrospective

Implemented the self-inspection initial route and the complete work-instruction editor/viewer improvement without mutating imported memo text or shared Assembly overlay defaults. Memo overrides now have a server-owned revision lifecycle, explicit migration resolution, and an atomic draft save contract. UI responsibilities are split into memo state/recovery, editor presentation, viewer cards, image dialog, and pure navigation modules. Validation passed: shared route 2 tests; focused Web 56 tests; focused API 29 tests; disposable work-instruction DB validation 28 integration tests with migration deployment twice, SQL constraints, empty memo, ANALYZE/EXPLAIN, and `TEMP_RESOURCE_REMAINING=0`; disposable client/kiosk integration 54 tests with `TEMP_RESOURCE_REMAINING=0`; work-instruction E2E 5 tests in Chromium and the same 5 in WebKit; API/Web/shared builds and lint/diff checks. The final lifecycle audit found no special-index flags; the task worktree is intentionally dirty because changes are handed off uncommitted and no push/PR was requested.
