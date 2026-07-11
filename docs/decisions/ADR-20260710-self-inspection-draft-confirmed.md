---
id: ADR-20260710-self-inspection-draft-confirmed
title: Self-inspection entry DRAFT vs CONFIRMED persistence
status: accepted
date: 2026-07-10
source_of_truth: true
related_docs:
  - ../plans/self-inspection-autosave-callout-template-lock.md
  - ../plans/self-inspection-confirm-guard-wip-draft.md
  - ../design-previews/kiosk-self-inspection-autosave-callout-preview.html
  - ../knowledge-base/KB-320-kiosk-part-measurement.md
related_code:
  - apps/api/src/services/part-measurement/self-inspection/
  - apps/web/src/pages/kiosk/KioskSelfInspectionSessionPage.tsx
---

# ADR-20260710: Self-inspection DRAFT / CONFIRMED

## Context

Operators lose in-progress measurements on refresh. Confirm must remain strict (all points, registration). Complete and record-approval must not treat partial drafts as done.

## Decision

- `SelfInspectionLotEntry.persistenceStatus`: `DRAFT` | `CONFIRMED` (existing rows backfilled `CONFIRMED`)
- `POST .../entries/draft` upserts partial values (blanks allowed)
- Existing create/update entry paths confirm with full `validateMeasurementPayload`
- `completedEntryCount`, required-slot fill, and record-approval saved gate count **CONFIRMED only**
- Session NFC gate: first employee tag unlocks measurement; confirm still uses per-entry registration (copy first employee into empty later drafts)
- Debounced autosave (~400ms) to draft API;「入力を保存」= confirm
- **Amendment (2026-07-11)**: draft upsert on an existing CONFIRMED entry is a **no-op** (no demotion). Autosave must not target confirmed entries. WIP **list** includes sessions with any lot entry (DRAFT or CONFIRMED) as `in_progress`; WIP **progress counts** remain CONFIRMED-only. Details: [Plan](../plans/self-inspection-confirm-guard-wip-draft.md).

## Alternatives

- localStorage-only drafts — rejected (weak across reboot/device)
- Separate draft table — rejected (extra merge complexity)

## Consequences

- WIP/boards ignore DRAFT when **counting** completed work
- WIP hub **shows** draft-only sessions so operators can resume
- Draft and confirm validation stay in separate modules
- CONFIRMED rows are not rewritten by autosave

## Validation

- Unit: draft validation, confirmed counts, action state, demote guard, resolveStatus
- Temp Postgres: migrate + EXPLAIN on `persistenceStatus` index + confirm-guard integration
