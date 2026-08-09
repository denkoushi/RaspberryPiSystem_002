---
id: KB-408
title: Self-inspection per-entry operator confirmation and inspector gate
status: accepted
scope: kiosk self-inspection API and Web
date: 2026-08-09
source_of_truth: true
related_code:
  - apps/api/src/services/part-measurement/self-inspection/inspector-slot-state.ts
  - apps/api/src/services/part-measurement/self-inspection/inspector-entry-eligibility.ts
  - apps/web/src/features/part-measurement/SelfInspectionEntrySlotSelector.tsx
related_docs:
  - ../decisions/ADR-20260710-self-inspection-draft-confirmed.md
  - ../runbooks/kiosk-part-measurement.md
  - ../plans/self-inspection-per-entry-inspector-gate-execplan.md
validation:
  - apps/api/src/routes/__tests__/self-inspection-per-entry-inspector-gate.integration.test.ts
  - apps/api/src/services/part-measurement/self-inspection/__tests__/inspector-slot-state.test.ts
open_items:
  - Existing production inconsistency remains a separately approved read-only/data-correction task.
---

# KB-408: Self-inspection per-entry inspector gate

## Symptom

On 2026-08-09, product `0003806492`, resource `589`, `サドル` had one inspector row for a slot whose operator row was still `DRAFT`. The slot contained all visible operator and inspector values, so the old API treated it as measurable and the record view could look complete even though the operator had not pressed 「入力を保存」. A lot of five also needs to move one or two items at a time; a lot-wide inspector lock prevented that workflow.

## Root cause

The inspector save and inspector instrument pre-use paths checked employee registration and value completeness but not `SelfInspectionLotEntry.persistenceStatus`. The operator mutation guard looked for any inspector row in the session instead of the same `entryIndex`. Aggregate inspector progress also counted inspector rows without pairing them with a confirmed operator row.

## Prevention

- Inspector create/update, instrument pre-use, and final judgement require the paired operator row to be `CONFIRMED`. A 409 uses `SELF_INSPECTION_OPERATOR_ENTRY_UNCONFIRMED` and tells the operator to press 「入力を保存」.
- Operator create/update/draft/pre-use operations lock only an `entryIndex` that already has an inspector row. Other items remain editable.
- The session row is locked before reading the paired rows, so concurrent operator confirmation and inspector save cannot commit an inspector row while the operator row is still `DRAFT`.
- The inspector detail API returns per-slot `missing/draft/confirmed` and `not_started/in_progress/complete` states. The kiosk renders `未/可/中/済`, disables unconfirmed slots, and offers 「状況更新」.
- Record approval treats a fully populated `DRAFT` as `input_incomplete`; inspector values attached to it do not count toward completion.

## Existing data handling

The read-only production audit found one inconsistency: session `73bed4ea-0f9c-4cfe-a6b7-c80bdbe1df07`, product `0003806492`, resource `589`, slot 3. This implementation does not migrate, delete, or auto-confirm it. Follow the separately approved 現品処置/data-correction task and keep deployment readiness blocked until the read-only audit is zero.

## Verification

The dedicated integration test covers a planned quantity of five: draft inspector save/pre-use 409 with no inspector usage, loan, or inspection record; item-by-item continuation; same-item operator lock; DRAFT final judgement 409; and concurrent confirmation/save ordering. Pure state tests cover FULL, FIXED_COUNT, FIRST_LAST, missing/draft/confirmed, and stale inspector values.
