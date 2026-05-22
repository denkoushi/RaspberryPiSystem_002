# KB-381: 吊具点検 Gmail 統合・サイネージ

## Context

PowerApps 吊具点検 CSV（Gmail 件名 `slingsInspectionRecord_PowerApps`）を本システムの `RiggingInspectionRecord` に取り込み、キオスク吊具持出時の点検記録作成と、計測機器点検可視化と同デザインの吊具サイネージを追加する要件（2026-05）。

## Symptoms

- Gmail 吊具点検 CSV は取り込まれず、`RiggingInspectionRecord` はキオスク/API から手動作成されていなかった
- 吊具の持出・点検状況をサイネージで一覧表示する手段がなかった

## Investigation

- 計測機器 Gmail CSV は `MeasuringInstrumentLoanEvent`（持出イベント）であり、点検記録とは別経路
- 吊具は `RiggingInspectionRecord` モデルが存在するが、Gmail 投影・キオスク自動作成・サイネージが未実装だった
- postIngest パターン（CustomerSCAW 型）が Gmail + 手動 upload 両対応に適する

## Root cause

機能ギャップ（未実装）。スキーマ変更は不要。

## Fix

1. **境界モジュール** `apps/api/src/services/rigging/inspection/`
   - `RiggingGearResolver`: `control_num` → `managementNumber` 優先、なければ `ID_num` → `idNum`
   - `RiggingInspectionDedupPolicy`: 管理番号 + JST 業務日 + 氏名で重複判定
   - `RiggingInspectionProjectionService`: Gmail ingestRun から投影
   - `RiggingBorrowInspectionOrchestrator`: キオスク `borrow` 成功後 PASS 作成（best-effort）
2. **CsvDashboard**: 固定 ID `c4e8a1b2-3d6f-7890-abcd-ef1234567891`・postIngest 配線・builtin schedule `csv-import-rigging-slings-inspection-powerapps`（**enabled: false**）
3. **サイネージ**: `rigging_loan_inspection` DataSource/Renderer（共有 `loan-inspection-card`）
4. **管理 UI**: 可視化ダッシュボード「吊具点検可視化プリセット」・サイネージ `[吊具点検]` タグ

## Prevention

- dedup・結果マッピング・resolver のユニットテスト
- postIngest dispatch テスト（dashboard ID 限定）
- スケジュール policy テスト（enabled: false 既定の確認）

## References

- [csv-import-export.md](../guides/csv-import-export.md) Gmail スケジュール節
- `apps/api/src/services/rigging/constants.ts`
- `apps/api/src/services/visualization/shared/loan-inspection-card/`

## 運用手順（本番）

1. Pi5 で API 再ビルド（スキーマ migrate 不要）
2. `/admin/imports/schedule` で `csv-import-rigging-slings-inspection-powerapps` を **有効化**
3. `/admin/visualization-dashboards` で吊具点検プリセット作成 → `/admin/signage/schedules` で visualization スロット割当
