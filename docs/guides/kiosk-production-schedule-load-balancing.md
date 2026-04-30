# キオスク 生産スケジュール 負荷調整（山崩し支援）

## 概要

キオスク専用の **負荷調整** 画面（`/kiosk/production-schedule/load-balancing`）では、資源CDごとの **月次必要工数**（`FSIGENSHOYORYO` 合計）と **設定した能力** を比較し、超過状況を可視化します。**サジェスト**は工程行（CSV の1行）単位で移管候補を提示するのみで、自動で順番や割当を変更しません。

## 集計ポリシー（サーバ実装に準拠）

- **月次キー**: 受注補足 `ProductionScheduleOrderSupplement.plannedEndDate` の暦月（UTC 月初〜翌月未満）。
- **対象行**: 生産スケジュール winner 行（`buildMaxProductNoWinnerCondition`）かつ **FKOJUNST 一覧可視性**（`fkmail` / `fkst` の S/R ポリシー）に一致する行。
- **未完了**: `ProductionScheduleProgress.isCompleted = false`（または未設定を未完了扱い）。
- **品目コード**: `FHINCD` が `MH%` / `SH%` の行は集計から除外（一覧の注文検索と同趣旨）。
- **資源CD**: 大文字・トリム正規化。切断工程除外リスト（資源カテゴリ設定）に該当する CD は集計対象外。

## 能力・ルール設定（管理画面）

**管理** → **生産スケジュール設定** 内の各カードで、ロケーション（端末スコープ文字列）に紐づく **siteKey** 単位で保存します。

1. **基準能力**: 資源CD → `baseAvailableMinutes`（分）。  
2. **月次能力**: `YYYY-MM` ごとの上書き（同一資源CDでは月次が基準より優先）。  
3. **山崩し分類**: 資源CD → `classCode`。  
4. **移管ルール**: `fromClassCode` → `toClassCode`、優先度、有効、効率係数（移管先に載る負荷は `行工数 / efficiencyRatio`）。

API（管理者）: `/production-schedule-settings/load-balancing/*`

## キオスク API

- `GET /kiosk/production-schedule/load-balancing/overview?month=YYYY-MM&targetDeviceScopeKey=...`
- `POST /kiosk/production-schedule/load-balancing/suggestions`  
  Body: `{ month, targetDeviceScopeKey?, maxSuggestions?, overResourceCds? }`

Mac の device-scope v2 有効時は、他画面と同様 **`targetDeviceScopeKey` 必須**（未指定時は 400）。

## データベース

Prisma モデル: `ProductionScheduleResourceCapacityBase`, `ProductionScheduleResourceMonthlyCapacity`, `ProductionScheduleLoadBalanceClass`, `ProductionScheduleLoadBalanceTransferRule`（`csvDashboardId` + `siteKey` 単位）。

## 関連

- 手動順番・Mac 代理: [KB-297](./knowledge-base/KB-297-kiosk-due-management-workflow.md)
- 生産スケジュール設定 UI: `/admin/production-schedule-settings`
