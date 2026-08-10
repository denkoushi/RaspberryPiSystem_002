# ADR-20260810: Assembly procedure and template guided workflow

- Status: Accepted
- Date: 2026-08-10
- Scope: Kiosk assembly procedure-document and template management

## Context

The assembly management screen combines procedure-document intake and template editing. Users need a clear, recoverable path from draft intake through page confirmation, publication, template creation, and revision without changing the existing persistence contracts.

## Decision

- Keep procedure intake, preview, publication, and template creation as two explicit stages on the existing management page.
- Reuse the existing preview endpoint, page-image representation, template transaction/versioning, and Kiosk SOP renderer.
- Lock model name and procedure pattern during revision; users create a separate lineage through “複製して新規”.
- Keep interrupted editor drafts in browser-local storage only, with a versioned pure record validator and a separate storage adapter.
- Add the assembly manual as one eight-sheet generated manual, merging authentication and basic information into one sheet.

## Consequences

The API and database schema remain compatible. New UI orchestration and recovery behavior can be tested independently, while generated SOP artifacts remain offline and production-route based. Browser-local recovery is intentionally not shared across devices or users.

## Alternatives rejected

Server-side draft persistence, a new generic SOP framework, and a full management-list redesign are outside this change because they expand the persistence and operational scope without being required for the primary workflow.
