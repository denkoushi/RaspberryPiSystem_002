---
id: self-inspection-confirm-guard-wip-draft
title: Self-inspection CONFIRMED demote guard + draft WIP visibility
status: implemented
date: 2026-07-11
source_of_truth: true
related_docs:
  - ../decisions/ADR-20260710-self-inspection-draft-confirmed.md
  - ../knowledge-base/KB-320-kiosk-part-measurement.md
  - ../runbooks/kiosk-part-measurement.md
related_code:
  - apps/api/src/services/part-measurement/self-inspection/entry-draft-upsert-guard.ts
  - apps/api/src/services/part-measurement/self-inspection/shared.ts
  - apps/web/src/features/part-measurement/shouldAutosaveSelfInspectionDraftEntry.ts
  - apps/web/src/pages/kiosk/KioskSelfInspectionSessionPage.tsx
open_items: []
validation:
  - API/Web unit tests for guard, resolveStatus, autosave skip, cache status
  - Temp Postgres (pgvector/pg15 :55434) migrate + integration (confirm→draft no-op; draft-only in_progress)
  - EXPLAIN uses SelfInspectionLotEntry_idx_session_persistence
  - Temp container removed after validation
---

# Self-inspection confirm guard + draft WIP

## Context

Operators saw WIP cards disappear after reopening a session and tapping another slot (e.g. FIRST_LAST「最終」) without intending to clear work. Production `0003886271` kept measurement values but `persistenceStatus=DRAFT`, so キオスク＞自主検査仕掛中 hid the session while 記録承認 showed `入力 0/2・入力途中`.

## Decision

1. **API guard**: `POST .../entries/draft` on an existing **CONFIRMED** entry is a **no-op** (return current entry; do not demote or rewrite values).
2. **Web**: autosave skips `persistenceStatus === 'confirmed'` (confirm path remains「入力を保存」).
3. **WIP list status**: any persisted lot entry (DRAFT or CONFIRMED) → `in_progress` when not completed. **`completedEntryCount` stays CONFIRMED-only**.
4. **No automatic production data UPDATE**; demoted rows reappear in WIP; operators re-confirm with「入力を保存」.

## Validation (2026-07-11)

- Unit: `entry-draft-upsert-guard`, `resolveStatus`, `shouldAutosaveSelfInspectionDraftEntry`, merge cache draft-only `in_progress`
- Integration (temp DB): confirm then draft upsert stays CONFIRMED; draft-only session listed as `in_progress` with `completedEntryCount=0`
- EXPLAIN: Index Scan on `SelfInspectionLotEntry_idx_session_persistence`
- Temp Postgres container/volume cleaned up

## Local Notes JA

- 症状: 仕掛中から消える / 記録承認は入力途中 0/N
- 復旧: セッションを開き「入力を保存」で再確定（測定値は残っている想定）
