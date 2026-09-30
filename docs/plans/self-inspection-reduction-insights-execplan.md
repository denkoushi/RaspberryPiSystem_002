# Self-inspection reduction insights (減らせる検査) ExecPlan

This ExecPlan is a living document. It follows `.agent/PLANS.md`.

## Purpose / Big Picture

Kiosk self-inspection records exist so that inspection can be reduced step by step once a process is proven capable. After this change, a kiosk user opens 自主検査 › 検査記録確認 › 「詳細」 and sees, per part key (品番 × 工程 × 資源CD), whether the inspection level can go one step lighter (全数 → 指定数 → 最初と最後 → 1件), should stay, or should go back. The page shows the evidence plainly: measured values drawn inside the tolerance band, process capability (Cpk), consecutive passing lots, drift, operator/inspector measurement gap, and out-of-spec / downstream nonconformity counts.

Operating decision (user, 2026-09-30): option A. Approving "1段下げる / 1段上げる" only records the decision with the approver's employee tag. The actual inspection-mode change stays a template revision in the admin screen.

Other user decisions (2026-09-30):

- Cpk threshold is switchable between 1.33 and 1.67 in the UI.
- The required consecutive passing lots and the list of approvers are not decided yet, so both are editable from the kiosk (protected by the shared operation password, the same boundary as the registration policy toggle).
- Change points (刃具交換, 段取り替え, …) are recorded as a feature now; whether they reset the streak is a setting because the operation is not decided.
- Items without tolerance limits are shown as "判定できない".

## Progress

- [x] (2026-09-30) Code investigation, mock v1/v2 (https://claude.ai/artifact/9TqyptRiUJzL5Xn62kEAWx), production read-only counts.
- [x] (2026-09-30) Shared judge logic in `@raspi-system/shared-types` with tests.
- [x] (2026-09-30) Prisma models + additive migration `20260930120000_self_inspection_reduction_insights`.
- [x] (2026-09-30) API: insights, policy/approvers, change points, decisions (unit and route tests).
- [x] (2026-09-30) Web: new page, record-approval toolbar in one row with 「詳細」.
- [x] (2026-09-30) Focused tests, lint, typecheck; E2E `e2e/self-inspection-reduction-layout.spec.ts` at 1920/1536 with mocked API.
- [ ] PR, CI, merge, deploy (not started).

## Surprises & Discoveries

- Observation: changing a template's self-inspection mode creates a new template version, and template items get new ids per version.
  Evidence: `insertNextTemplateVersionInTransaction` in `part-measurement-template.service.ts`. Items are therefore matched across versions by a stable text key (datum surface, measurement point, label). When limits change, only values measured against the latest limits are used.
- Observation: production data on 2026-09-30 is small: 81 sessions (53 completed), 12 part keys, only 3 with 30+ values for one item; all used numeric items have both limits; 976 inspector re-measurements; median time between operator entry confirmations is about 15 s.

## Decision Log

- Decision: verdict rules live in one pure function shared by API and web (`judgeSelfInspectionReduction`).
  Rationale: the kiosk switches the Cpk threshold instantly on the client, and the API must re-check the same rule before recording an approval.
- Decision: a lot is one completed, non-invalidated self-inspection session.
- Decision: the next lighter level from 全数 is 指定数 5 (or 最初と最後 when the lot is 5 pieces or fewer). This is only the recorded proposal; the admin revision sets the real count.
- Decision: Cpk based "戻す" needs the minimum sample count; out-of-spec values and SCAW nonconformities always mean "戻す".

## Outcomes & Retrospective

- Implemented as planned. Visual self-check at 1920×1080 and 1536×864 caught two layout issues before review: the detail pane collapsed at 1536 px with a fixed 1080 px list, and the verdict column misaligned rows. Both were fixed with fractional grid columns and a fixed verdict column.
- The record-approval toolbar is one row (100 px → 60 px in the mock measurement) and keeps the existing accessible names (「自主検査画面へ戻る」, 「計測機器の使用前点検必須 ON/OFF」, 「クリア」) so existing unit and E2E tests stay valid.

## Context and Orientation

- Records: `SelfInspectionSession` → `SelfInspectionLotEntry` (CONFIRMED) → `SelfInspectionMeasurementValue` with limits on `PartMeasurementTemplateItem`. Inspector re-measurement: `SelfInspectionInspectorMeasurementValue` (`operatorValueSnapshot`, `inspectorValue`).
- Current level: the active template of the key (`selfInspectionMode`, `selfInspectionFixedCount`).
- Downstream nonconformity: `ScawStfutekigoCurrent.partNumber` = FHINCD.
- Kiosk access boundary: `allowView` for reads, `allowWriteKiosk` for writes; settings writes need the shared operation password (`verifyDueManagementAccessPassword`) unless an admin user is signed in.

## Plan of Work

1. `packages/shared-types/src/part-measurement/self-inspection-reduction.ts`: level ladder, pieces per lot, judge.
2. Prisma: `SelfInspectionReductionPolicyConfig`, `SelfInspectionReductionApprover`, `SelfInspectionChangePoint`, `SelfInspectionLevelDecision` (additive only).
3. API service folder `apps/api/src/services/part-measurement/self-inspection-reduction/` (pure stats, repository, services) and routes `routes/part-measurement/self-inspection-reduction.ts`.
4. Web: `features/part-measurement/selfInspectionReduction/`, page `KioskSelfInspectionReductionPage`, route `/kiosk/part-measurement/self-inspection/reduction`, toolbar change.

## Validation and Acceptance

- Unit tests for the judge and the statistics.
- Route/service tests where existing patterns allow.
- Web tests: toolbar has one row with 「詳細」 linking to the new route; page renders verdicts from a fixture.
- `pnpm` lint, typecheck, and build for touched packages.

## Idempotence and Recovery

The migration only adds tables and enums. Rolling back the app leaves the new tables unused. No existing rows are changed.

## Interfaces and Dependencies

HTTP (all under `/api`):

- `GET /part-measurement/self-inspection/reduction/insights?periodDays=30|90|180`
- `GET /part-measurement/self-inspection/reduction/policy`
- `PUT /part-measurement/self-inspection/reduction/policy`
- `POST /part-measurement/self-inspection/reduction/approvers`
- `POST /part-measurement/self-inspection/reduction/approvers/:id/remove`
- `POST /part-measurement/self-inspection/reduction/change-points`
- `POST /part-measurement/self-inspection/reduction/decisions`
