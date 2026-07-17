---
id: self-inspection-confirm-guard-wip-draft
title: Self-inspection confirm guard, draft WIP, and inspector final judgement
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
  - apps/api/src/services/part-measurement/self-inspection/inspector-entry.ts
  - apps/api/prisma/migrations/20260717000000_self_inspection_inspector_final_judgement/migration.sql
open_items: []
validation:
  - API/Web unit tests for guard, resolveStatus, autosave skip, cache status
  - Temp Postgres (pgvector/pg15 :55434) migrate + integration (confirm→draft no-op; draft-only in_progress)
  - EXPLAIN uses SelfInspectionLotEntry_idx_session_persistence
  - Temp container removed after validation
  - Production Pi5 + Pi4×5 at HEAD b52931bd (Pi3 skipped); verify-phase12-real PASS 45
  - PR #970
  - Inspector final judgement API integration tests (FINAL_OK / FINAL_NG / completion guards / legacy compatibility)
  - API and Web production TypeScript builds, full lint, Prisma validation, and focused Web tests
  - Production Pi5 + Pi4×5 at 3e52d7bb; first Pi4 real-device workflow PASS
  - Inspector registration boundary fix deployed to Pi5 + Pi3 at 72de4add
  - PR #1036
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
- Production: Detach Pi5 **`20260711-093400-26223`** · Pi4×5 **`20260711-094015-24272`** · Phase12 **PASS 45** · HEAD **`b52931bd`**
- Deploy record: [deployment](../archive/deployments/2026-07.md#self-inspection-confirm-guard-wip-draft-2026-07-11)

## Local Notes JA

- 症状: 仕掛中から消える / 記録承認は入力途中 0/N
- 復旧: セッションを開き「入力を保存」で再確定（測定値は残っている想定）

## Inspector final judgement (2026-07-17)

### Context

The measurer could enter an out-of-tolerance value, but the acknowledgement was
lost through draft persistence and the entry could remain 「入力中」. The final
record-approval workflow also did not match the required shop-floor handoff:
the inspector must retain actual remeasurement entry and decide the final result
for every measurer-side NG point.

### Decision

1. Preserve the measurer's out-of-tolerance acknowledgement in draft storage so
   the entry can be confirmed and the measurer can finish with NG values present.
2. Keep the inspector remeasurement entry unchanged, then require `FINAL_OK` or
   `FINAL_NG` for every measurer-side out-of-tolerance point before completion.
3. Preserve the measurer's original `PENDING` result for audit, and store the
   inspector's final result separately as `APPROVED` or `REJECTED`. The API
   exposes the final result after judgement; final NG is a valid completed
   inspection result.
4. Mark new and reset sessions as `INSPECTOR_FINAL_JUDGEMENT`. Existing sessions
   have a null workflow value, which the compatibility boundary exposes as
   `LEGACY_RECORD_APPROVAL`, and retain the previous approval flow.
5. Use an Expand-only migration containing only nullable `TEXT` column additions.
   This satisfies the production migration contract without rewriting existing
   records or altering PostgreSQL enum types.
6. At inspector completion, re-evaluate the current measuring-instrument policy.
   If a now-required inspector registration is missing, return `409` without
   discarding the saved measurements or final judgements. The inspector can
   register the instruments and retry completion.

### Validation

- API integration: inspector measurements remain required; incomplete judgement
  blocks completion; FINAL_OK and FINAL_NG persist; judged entries are immutable;
  final NG can complete; new sessions are excluded from legacy record approval.
- Legacy integration: existing record-approval completion flow remains valid.
- Draft unit tests: out-of-tolerance acknowledgement survives persistence and an
  unchanged DRAFT entry can still be confirmed.
- Web tests: action state and WIP routing reflect the new handoff.
- API/Web TypeScript checks, full lint, Prisma validation, all 148 migrations on
  a fresh temporary PostgreSQL database, 80 related API tests, and
  `git diff --check` all pass.
- Registration boundary: after inspector measurements and judgements were saved,
  changing the policy to require instrument registration blocked completion with
  `409`; values and judgements remained intact; registration followed by retry
  completed successfully. The full related API integration file passed 72 tests.
- GitHub CI: full API suite passed 2,336 tests; required workspace, Web, client,
  database, deploy-contract, E2E, security, CodeQL, and secret-scan checks passed.
- Initial production rollout: Pi5 + Pi4×5 completed at `3e52d7bb` in run
  `20260717-000420-914d65`; maintenance was cleared on every target, and the
  measurer-to-inspector workflow passed real-device verification on the first Pi4.
- Boundary-fix rollout: Pi5 + Pi3 completed at `72de4add` in run
  `20260717-031409-be92ee`; Pi5 remained healthy through the stability hold, Pi3
  was runtime-verified, and Pi4×5 correctly remained at `3e52d7bb` because the
  boundary fix had no kiosk impact. A repeat plan selected zero targets.
- The preceding run `20260717-030044-4549a6` stopped before product updates when
  the Pi5 checkout contained the untracked runtime `power-actions/` queue. The
  queue is now ignored and allowed only during the old-checkout preflight; all
  other dirty-worktree states remain fail-closed. All 619 deploy tests passed,
  and the successful rerun preserved the queue while leaving the worktree clean.
