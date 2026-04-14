# KB-344: キオスク集計の統合ローン分析（計測機器 CSV+NFC）

## Context

キオスク「集計」画面は従来、吊具と写真持出アイテムのみを対象にしていた。計測機器はサイネージ用可視化に CSV 由来イベントが存在し、キオスク持出では NFC 由来 `Loan` が存在するため、分析軸が分断されていた。

## Symptoms

- 計測機器の「誰が何を持出・返却したか」を月単位で一貫して見られない。
- CSV と NFC の二重計上、取消除外、同一人物名寄せを画面側で吸収しきれない。

## Investigation

- CONFIRMED: 吊具/アイテム集計は `loan-analytics` API で月次・資産別・人別を返す。
- CONFIRMED: 計測機器は `MeasuringInstrumentLoanEvent`（CSV）と `Loan`（NFC）で別経路。
- CONFIRMED: 取消は `Loan.cancelledAt` で除外できる。

## Root cause

計測機器分析の正本イベント系列が統一されておらず、UI から統合可能な API 契約が未整備だった。

## Fix

- `MeasuringInstrumentLoanEvent` を計測機器分析のイベント基盤として利用し、NFC 持出/返却もミラー記録。
- 集計時に `managementNumber + action + 5分窓` で重複統合し、競合時は NFC を優先。
- `cancelledAt` のある Loan に紐づく NFC ミラーイベントは除外。
- 新規 API `GET /api/measuring-instruments/loan-analytics` を追加。
- キオスク集計画面へ `計測機器` タブと月次フィルタ（`input type="month"`）を追加。
- 吊具・アイテムのクエリも同じ月次パラメータで取得するよう統一。

## Prevention

- 集計 API は共通パラメータ（`periodFrom`/`periodTo`/`monthlyMonths`/`timeZone`）で運用する。
- 画面側のデータセット切替は共通 ViewModel へ寄せ、データ源追加時の変更範囲を局所化する。
- 統合ルール（NFC 優先・5分窓・取消除外）は回帰テストで固定する。

## References

- `apps/api/src/services/measuring-instruments/analytics/measuring-instrument-loan-analytics.repository.ts`
- `apps/api/src/services/measuring-instruments/analytics/measuring-instrument-loan-analytics.service.ts`
- `apps/api/src/services/measuring-instruments/loan.service.ts`
- `apps/api/src/routes/measuring-instruments/index.ts`
- `apps/web/src/pages/kiosk/KioskRiggingAnalyticsPage.tsx`
