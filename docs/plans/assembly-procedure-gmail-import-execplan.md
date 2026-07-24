# Assembly Procedure Gmail Import

This ExecPlan is a living document. Keep `Progress`, `Surprises & Discoveries`,
`Decision Log`, and `Outcomes & Retrospective` current while implementation
proceeds.

## Purpose / Big Picture

An operator on Kiosk > Assembly > Procedure Library can press `取込` to import
unread Gmail messages whose subject is exactly `DocumentASM`. Each valid message
contains one PDF or JPEG attachment. The attachment becomes a new draft
`AssemblyProcedureDocument`, using the filename without its extension as the
document name. Only after the database record and all page images are durable is
the message labeled with the existing processed label and moved to Gmail trash.

The implementation reuses the configured Gmail OAuth client and existing
assembly document conversion/storage. It does not create `KioskDocument` rows,
does not overwrite a same-named published document, and does not add a
scheduler.

## Progress

- [x] (2026-07-24) Read repository instructions, Gmail/assembly documentation,
  ADRs, schema, routes, services, UI, and existing tests.
- [x] (2026-07-24) Confirmed baseline Gmail client and assembly library UI tests
  pass.
- [x] (2026-07-24) Created branch
  `feat/assembly-procedure-gmail-import` from current `origin/main`.
- [x] (2026-07-24) Added the additive Prisma migration and source metadata.
- [x] (2026-07-24) Added reusable Gmail attachment collection and dedupe
  utilities.
- [x] (2026-07-24) Implemented the dependency-injected assembly Gmail import service and
  durable draft writer.
- [x] (2026-07-24) Added the authenticated HTTP endpoint and kiosk UI action.
- [x] (2026-07-24) Added unit, integration, and web tests.
- [x] (2026-07-24) Added ADR and operator documentation.
- [x] (2026-07-24) Validated migrations, SQL constraints, EXPLAIN, tests, lint, and builds
  against an isolated temporary PostgreSQL container.
- [x] (2026-07-24) Release preflight rejected the original migration before any
  production mutation because it altered an existing table with a default,
  enum, and unique index.
- [x] (2026-07-24) Replaced the unapplied migration with an expand-only source
  sidecar table, validate the exact repair declaration, and rerun the complete
  local migration/API gates. Production preflight remains to be rerun after
  exact-head CI.

## Surprises & Discoveries

- The existing generic kiosk-document Gmail import stores `KioskDocument` and
  archives mail; assembly procedure library imports must instead create
  `AssemblyProcedureDocument` drafts.
- The existing CSV flow already calls `GmailApiClient.trashMessage`, which
  applies `rps_processed` before moving a message to trash. A nightly scheduler
  permanently deletes messages carrying that label.
- PDF assembly imports already rasterize at 144 DPI / JPEG quality 85 and allow
  at most 40 pages. Single images are currently passed through and rejected
  above 12 MiB rather than resized.
- The repository's local PostgreSQL test helper uses the fixed container name
  `postgres-test-local` and deletes it. This plan will not use that helper; it
  will create task-specific temporary Docker resources.
- An initial integration test cleanup deleted every assembly procedure document
  and conflicted with references created by another suite. The test was changed
  to own and delete only message IDs with its task-specific prefix.
- `LOG_LEVEL=silent` is not accepted by the repository logger configuration;
  the isolated full-suite run used `LOG_LEVEL=error`.
- The Gmail MIME collector had trimmed filenames. Audit metadata now preserves
  the exact filename returned by Gmail; NFC normalization is applied only for
  validation, display-name derivation, and dedupe-key generation.
- The release migration gate intentionally rejects a required/defaulted enum
  column and unique index on an existing production table. The merged migration
  had not been applied, so its safe replacement can create a new empty sidecar
  table without locking or rewriting existing procedure-document rows.

## Decision Log

- Decision: Gmail imports create a new draft even when another message has the
  same filename.
  Rationale: published documents and existing template/order references must
  not change without review.
- Decision: the visible name excludes `.pdf`, `.jpg`, or `.jpeg`, while the
  complete source filename is retained for audit.
- Decision: process exact-subject messages oldest first, at most ten per
  request.
- Decision: invalid or failed messages remain unread in the inbox without the
  processed label.
- Decision: normalize JPEG input to a maximum 3000-pixel long edge at quality
  85, with EXIF rotation and bounded quality reduction to the storage limit.
- Decision: automated tests use fake Gmail gateways. No real mailbox is mutated
  without separate explicit authorization.
- Decision: existing and manually registered documents have no source row and
  are interpreted as `MANUAL`; Gmail imports create a one-to-one
  `AssemblyProcedureDocumentSourceRecord`. This keeps all constraints on a new
  empty table.
- Decision: a merged-but-unapplied migration repair must declare the exact old
  and new SHA-256 checksums and is enabled only by the repository candidate
  validator. The production ledger validator does not accept repair
  declarations, so an already-applied migration remains immutable.

## Context and Orientation

The Fastify assembly routes live in `apps/api/src/routes/assembly/index.ts`.
Assembly document persistence is implemented by
`AssemblyProcedureDocumentService`, while
`apps/api/src/lib/assembly-procedure-document-import.ts` converts and saves
pages. Gmail access is provided by `GmailApiClient` and resolved from
`backup.json` through `resolveGmailApiClientFromBackupConfig`.

The procedure library UI is composed by `KioskAssemblyPage` and
`AssemblyProcedureLibrarySection`. Web API functions are in
`apps/web/src/api/domains/assembly.ts`.

## Plan of Work

1. Add `AssemblyProcedureDocumentSource` and a one-to-one source record to
   Prisma. Apply a unique constraint to the source record's `gmailDedupeKey`;
   existing and manual documents have no source row and are interpreted as
   `MANUAL`.
2. Refactor Gmail message-part typing into a recursive shape and expose a pure
   attachment collector. Extract the Gmail dedupe-key helper into a Gmail
   utility so kiosk and assembly domains share it without depending on one
   another.
3. Add pure subject, filename, and attachment validation helpers plus a Sharp
   JPEG normalizer. Accept only one non-inline PDF/JPEG attachment.
4. Add a narrow `AssemblyProcedureMailGateway`,
   `AssemblyProcedureDraftWriter`, and `AssemblyProcedureJpegNormalizer`
   interface. Implement `AssemblyProcedureGmailImportService` with oldest-first
   ordering, a ten-message cap, process-local non-waiting exclusion, durable
   dedupe, and post-commit Gmail trash handling.
5. Centralize assembly draft creation and file rollback so manual upload and
   Gmail import cannot leave partial page files after a conversion, storage, DB,
   or unique-constraint failure.
6. Register `POST /assembly/procedure-documents/ingest-gmail` under the existing
   assembly write authorization. Return stable counters and per-message
   outcomes.
7. Add the web API function and an adjacent `取込` button. Disable it during the
   request, refresh the library after created documents, and display a concise
   summary including partial failures.
8. Add tests and documentation, then validate in an isolated pgvector/Postgres
   15 container.

## Concrete Steps

Run focused tests from the repository root:

    pnpm --filter @raspi-system/api test -- <focused test paths>
    pnpm --filter @raspi-system/web test -- <focused test paths>

For DB validation, create names containing a timestamp for the container,
volume, and network. Install an EXIT/INT/TERM trap that removes exactly those
resolved names. Use `pgvector/pgvector:pg15`, expose PostgreSQL on a dynamically
allocated loopback port, set a task-specific `DATABASE_URL`, and run:

    pnpm --filter @raspi-system/api prisma:generate
    pnpm --filter @raspi-system/api prisma:deploy
    pnpm --filter @raspi-system/api exec prisma migrate status

Use `psql` only against that temporary URL to inspect the source table and its
indexes, exercise the one-to-one and dedupe constraints, and run
`EXPLAIN (ANALYZE, BUFFERS)` for a `gmailDedupeKey` lookup.

Finally run API/web tests, lint, builds, and:

    git diff --check

## Validation and Acceptance

- A valid exact-subject PDF or JPEG produces a new draft with ordered pages and
  Gmail source metadata.
- The displayed name is the source basename without the supported extension.
- A same message retry does not create another draft and still retries mail
  disposal; a different message with the same filename creates a new draft.
- Only imported or confirmed-duplicate messages receive the processed label and
  move to trash.
- Invalid subject, attachment count, type, content, conversion, storage, or DB
  failures leave mail in the unread inbox.
- Large JPEGs are auto-rotated, never enlarged, fit within 3000 pixels, and are
  stored at or below 12 MiB.
- The `取込` button is immediately to the right of `登録`, reports busy state,
  and refreshes the library after creation.
- Existing manual imports, CSV imports, generic kiosk-document Gmail imports,
  published assembly documents, and existing database rows remain compatible.

## Idempotence and Recovery

The source record's nullable unique Gmail dedupe key is the cross-process
idempotency boundary. If an HTTP request times out after database commit, the
retry finds the existing draft and only retries Gmail disposal. If file storage
succeeds but database creation fails, the nested source/document transaction is
rolled back and all files created by that attempt are removed. Invalid input is
safe to retry because neither DB nor Gmail state changes.

Temporary Docker resources are always removed by an explicit trap. Existing
containers, volumes, networks, and databases are never reused or modified.

## Interfaces and Dependencies

The only new HTTP surface is:

    POST /api/assembly/procedure-documents/ingest-gmail

It accepts no body and uses existing assembly write authorization. Its response
contains scan/match/attempt/import/duplicate/trash/failure/remaining counters
and per-message `imported`, `duplicate`, `import_failed`, or `cleanup_failed`
items.

Sharp is already an API dependency. Gmail OAuth, Prisma, Poppler PDF conversion,
and assembly image storage are existing dependencies; no new runtime package is
required.

## Outcomes & Retrospective

The feature is implemented on `feat/assembly-procedure-gmail-import`. Gmail
transport, assembly draft persistence, image normalization, HTTP routing, and
the kiosk UI are separated by narrow ports. Existing manual upload now shares
the same durable draft writer and therefore also benefits from page-file
rollback after database failure.

An isolated `pgvector/pgvector:pg15` database applied all 153 migrations. SQL
inspection confirmed that existing/manual documents require no source row,
while Gmail metadata and both one-to-one and nullable dedupe constraints live
on the new sidecar table. A duplicate insert was rejected, and
`EXPLAIN (ANALYZE, BUFFERS)` used
`AssemblyProcedureDocumentSourceRecord_gmailDedupeKey_key` via an index scan.
The full API suite passed 459 files / 2,395 tests (with 2 files / 7 tests
skipped). The pre-existing database, containers, volumes, and networks were not
used or modified; the temporary container, volume, and network were removed by
the cleanup trap and verified absent.

API and Web lint, Prisma Client generation, and both production builds pass.
The final Web suite passed 300 files / 1,497 tests, including the audit-filename
and page-level UI additions. Final diff checks also pass. No real Gmail mailbox
was accessed or changed.
