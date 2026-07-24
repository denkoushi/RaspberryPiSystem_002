# ADR-20260724: Gmail Import for Assembly Procedure Documents

- Status: accepted
- Date: 2026-07-24
- Scope: assembly procedure library, Gmail attachment ingestion, processed-mail disposal
- Related: [ADR-20260707](./ADR-20260707-assembly-procedure-order-library-scope.md), [ADR-20260708](./ADR-20260708-assembly-page-level-markers-and-publish-gate.md)
- Related plan: `docs/plans/assembly-procedure-gmail-import-execplan.md`

## Context

Assembly procedure documents can be uploaded manually, but operators also
receive PDF/JPEG procedures through the Gmail account already configured for CSV
imports. The generic kiosk-document Gmail importer is not an acceptable reuse
point because it creates `KioskDocument` rows, may replace a logical filename,
and archives processed mail. Assembly library documents have a separate
aggregate and an explicit draft/publish safety gate.

## Decision

1. `DocumentASM` Gmail imports create `AssemblyProcedureDocument` rows and never
   `KioskDocument` rows.
2. Each import is a new `DRAFT`. A different email with the same attachment
   filename creates another draft; it never changes a published document or its
   references.
3. A nullable unique key derived from Gmail message ID and normalized attachment
   filename makes the same email idempotent across HTTP retries and API
   processes.
4. Only unread inbox messages whose trimmed `Subject` is exactly
   case-sensitive `DocumentASM` are eligible. Process the oldest ten per
   operator request.
5. A message must have exactly one non-inline attachment. Email import accepts
   PDF or JPEG only. JPEG is auto-rotated and normalized to a 3000-pixel long
   edge / quality 85 / 12 MiB storage ceiling.
6. Apply the existing processed label and move the email to trash only after a
   durable document exists or the same message is confirmed as a duplicate.
   Invalid or failed messages remain unread in the inbox.
7. Reuse the existing Gmail OAuth/configuration and trash cleanup scheduler. Do
   not add a schedule or a second credential set for this use case.
8. Store Gmail source/audit metadata in a one-to-one
   `AssemblyProcedureDocumentSourceRecord`. Existing and manually registered
   documents have no source record and are interpreted as `MANUAL`. This keeps
   required fields and unique constraints off the populated document table.

## Consequences

- A source sidecar record carries source/audit metadata and the nullable unique
  Gmail key. Existing rows require no update or backfill.
- A cleanup failure after DB commit is visible to the operator. Retrying the
  button does not create a second document and retries only the mail disposal.
- Same-named drafts may coexist. This is intentional so review and publication
  remain explicit.
- Messages moved to trash with `rps_processed` are subject to the existing
  nightly permanent deletion and must be treated as non-recoverable after that
  job runs.

## Alternatives

- Import into `KioskDocument`: rejected because it violates the assembly-library
  scope ADR and bypasses assembly publication semantics.
- Replace by attachment filename: rejected because referenced/published content
  could change without review.
- Trash malformed mail: rejected because input or transient conversion problems
  would become permanent data loss.
- Background scheduler/job table: rejected for this operator-triggered first
  version; the ten-message cap and idempotent synchronous API are sufficient.
