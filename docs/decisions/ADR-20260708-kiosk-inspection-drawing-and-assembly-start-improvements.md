---
id: ADR-20260708-kiosk-inspection-drawing-and-assembly-start-improvements
status: accepted
scope: kiosk part-measurement inspection drawing / kiosk assembly start pane
date: 2026-07-08
source_of_truth: true
related_code:
  - apps/api/src/services/part-measurement/part-measurement-template.service.ts
  - apps/api/src/services/part-measurement/inspection-drawing-fhincd-candidates.service.ts
  - apps/api/src/services/assembly/assembly-seiban-start.service.ts
  - apps/api/src/services/assembly/assembly-seiban-lot-quantity.service.ts
  - apps/api/prisma/migrations/20260708194000_add_assembly_seiban_fseiban_prefix_index/migration.sql
  - apps/web/src/features/part-measurement/inspection-drawing/InspectionDrawingCreateToolbar.tsx
  - apps/web/src/features/part-measurement/inspection-drawing/InspectionDrawingFhincdSuggestInput.tsx
  - apps/web/src/pages/kiosk/KioskAssemblyHomePage.tsx
related_docs:
  - ./ADR-20260701-part-measurement-template-sibling-groups.md
  - ./ADR-20260707-assembly-procedure-order-library-scope.md
---

# ADR-20260708: Kiosk Inspection Drawing Process Change And Assembly Start Speedup

## Status

accepted (deployed to production 2026-07-08, see Validation)

## Context

Operator feedback on two kiosk screens:

1. Inspection drawing templates created with the wrong process (切削/研削) could not be corrected. `processGroup` is part of the template lineage key `(fhincd, processGroup, resourceCd, version)` and is locked during revise.
2. The 品番 (`fhincd`) field on the drawing create screen was manual-input only, although the production schedule DB (`CsvDashboardRow.rowData->>'FHINCD'`) holds part codes. The reference key between drawings and schedule rows is ambiguous, so hard auto-fill is not safe.
3. On the assembly top screen, seiban candidate search felt slow and locked the keypad while searching. The candidate SQL used the per-row correlated max-ProductNo winner subquery over JSON columns with no supporting index.
4. Assembly lot quantity came from `ProductionScheduleActualHoursRaw.lotQty` (production actuals CSV), while the leader order board uses `ProductionScheduleOrderSupplement.plannedQuantity` (指示数, 部品納期個数 CSV). The user asked to source lot quantity from the same route as the board. Some parts are used twice per product, so per-part 指示数 can be double the product count.

## Decision

1. **Process change as a dedicated lineage-wide operation**, not an unlock of revise. `POST /part-measurement/inspection-drawing/templates/:id/change-process-group` updates `processGroup` for every version in the lineage and, when the template belongs to a sibling group, for all group members and the `PartMeasurementTemplateSiblingGroup` row, inside one transaction. A 409 is returned when a template with the target `(fhincd, targetProcessGroup, resourceCd)` already exists outside the affected set. `PartMeasurementSheet.processGroupSnapshot` and other historical records are never rewritten. The UI exposes this as a select on the 工程 chip in the revise screen with a confirm dialog.
2. **品番 is suggested, not auto-filled.** `GET /part-measurement/inspection-drawing/fhincd-candidates?prefix=` returns distinct `FHINCD` (+ representative `FHINMEI`) from the production schedule dashboard for prefixes of 2+ chars. The create screen shows a combobox dropdown; free text input remains possible. Rationale: the drawing-to-schedule reference key is ambiguous today, so the operator stays in control.
3. **Seiban candidate search drops the winner condition and gains an expression index.** `FSEIBAN` is one of the winner logical-key partition columns, so every partition shares one `FSEIBAN` value and every partition always has exactly one winner; filtering candidates by winner therefore never changes the distinct-`FSEIBAN` result set. The correlated subquery was removed and migration `20260708194000_add_assembly_seiban_fseiban_prefix_index` adds `("csvDashboardId", (UPPER(COALESCE("rowData"->>'FSEIBAN',''))) text_pattern_ops)` (partial, production schedule dashboard only) for prefix `LIKE`. Frontend: the seiban keypad/input is no longer disabled during `candidateLoading` (only during `busy`), and lot quantities are no longer fetched for unselected candidates.
4. **Lot quantity primary route = 指示数 mode, fallback = production actuals.** `AssemblySeibanLotQuantityService` first derives, per seiban, the mode of `ProductionScheduleOrderSupplement.plannedQuantity` (ties resolved to the smaller value) over that seiban's schedule rows; the mode absorbs parts whose 指示数 is a multiple of the product count (e.g. 2 pieces per product). Seibans with no supplement data fall back to the previous `ProductionScheduleActualHoursRaw` DISTINCT-lot SUM. The API response shape `{ productNo, lotQty }` is unchanged.

Also in this batch: the テスト入力 / ガイド試行 / 一覧へ戻る buttons in the inspection drawing create header band moved to the right edge of the same band row (`ml-auto` group; band height unchanged).

## Alternatives

- Unlocking `processGroup` during revise: rejected; it would fork the version lineage under a different unique key and break version numbering semantics.
- Auto-filling 品番 from schedule rows: rejected until a reliable reference key exists.
- Materialized winner IDs (leaderboard style) for candidate search: unnecessary once the winner condition is shown to be redundant for distinct-`FSEIBAN` listing.
- Minimum (instead of mode) of 指示数: rejected; a data-entry outlier below the true count would win. Mode with min tiebreak is more robust.

## Consequences

- Wrong-process templates can now be fixed in place; history (sheets, sessions) keeps its recorded snapshots.
- Candidate search cost no longer scales with the correlated winner subquery; index applies after `prisma migrate deploy` on the target DB.
- Lot quantity now follows 指示数 as primary source. If a seiban's supplement rows are all doubled (every part used 2x per product), the mode would overstate the product count; the operator can still correct via the existing manual lot-qty input.
- New public contracts: `change-process-group` POST and `fhincd-candidates` GET (see related_code).

## Validation

- Temp Postgres (`postgres-test-local`, pgvector:pg15): `prisma migrate deploy` applied `20260708194000_add_assembly_seiban_fseiban_prefix_index` cleanly (opclass syntax verified against live PostgreSQL after fixing worker output).
- apps/api integration: `part-measurement-inspection-drawing-change-process-group` (3 tests: lineage-wide change, 409 conflict, sibling-group-wide change), `part-measurement-inspection-drawing-fhincd-candidates` (2 tests), `assembly-seiban.integration` (5 tests: mode `[5,5,10]→5`, tie→min, actuals fallback, winner-free equivalence, route response) — all pass.
- Regression: `assembly.integration.test.ts` + `part-measurement.integration.test.ts` (86 passed / 2 skipped), services suites (143 passed), apps/web suites for assembly + part-measurement (412 passed), `tsc` for api/web on merged `main` — all pass.
- CI: first run failed on FK-ordered cleanup in the new change-process-group test (fixed in `10d4c69a`), second run hit a pre-existing multipart-boundary flake in `assembly.integration.test.ts` (fixed in `1a85d412`); final main `22e79e28` CI success.
- Production deploy 2026-07-08: Run ID `20260708-231555-17031`, all 7 hosts `failed=0 / unreachable=0`, Pi5 HEAD `22e79e28`, migration + index applied, phase12 verify PASS 45 / WARN 0 / FAIL 0. Record: `docs/guides/deployment.md` §検査図面 工程変更/品番サジェスト 2026-07-08.

## Open Items

- On-site visual/touch confirmation of the new UI (see deployment record checklist).
- The manual lot-qty fallback message still says 「生産実績からロット数を取得できませんでした」; acceptable but could mention 指示数.
- A stable drawing-to-schedule reference key (for true 品番 auto-fill) remains future work.

## Local Notes JA

- 工程変更は改版ロックの解除ではなく「系譜（全バージョン＋兄弟グループ）を一括で付け替える」専用操作として実装。過去の記録表スナップショットは変更しない。
- ロット数は「1製品に同一部品を2個使う仕様では部品行の指示数がロット数の倍になる」ため、製番内の指示数の最頻値（同数なら最小）を採用。指示数が無い製番のみ従来の生産実績合算で補完。
