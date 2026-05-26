# キオスク 生産スケジュール 負荷調整（山崩し支援）

## 概要

キオスク専用の **負荷調整** 画面（`/kiosk/production-schedule/load-balancing`）では、資源CDごとの **月次必要工数**（`FSIGENSHOYORYO` 合計）と **設定した能力** を比較し、超過状況を可視化します。**サジェスト**は工程行（CSV の1行）単位で移管候補を提示するのみで、自動で順番や割当を変更しません。

画面内タブ:

| タブ | 用途 | 月の定義 |
|------|------|----------|
| **資源CD俯瞰** | 単月の資源CD別負荷・能力・山崩しサジェスト | `plannedEndDate`（受注補足）の暦月 |
| **機種別月次負荷** | 機種（MH/SH 行 `FHINMEI`）→ 部品 → 月×資源CDの積み上げ | **有効納期**（行備考 `dueDate` → なければ `plannedEndDate`）の暦月 |

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
- `GET /kiosk/production-schedule/load-balancing/machine-monthly-load?fromMonth=YYYY-MM&toMonth=YYYY-MM&targetDeviceScopeKey=...&machineName=...&fhincd=...`  
  - 未完了部品工程のみ。月範囲は最大 **12 か月**。  
  - `machineName` / `fhincd` は任意（部品行クリックで `fhincd` 絞り込み）。  
  - 機種名は製番ごとの MH/SH 行 `FHINMEI`（`resolveSeibanMachineDisplayNamesBatched` と同系）。

Mac の device-scope v2 有効時は、他画面と同様 **`targetDeviceScopeKey` 必須**（未指定時は 400）。

## 機種別月次負荷（UI）

- **開始月・終了月**: 初期値は当月から **6 か月**（最大 **12 か月**）。
- **機種選択**: 一覧は期間内の未完了負荷から集計した `FHINMEI`（機種名未登録ラベル含む）。
- **部品表**: 品番・品名・最早納期・所要分・資源CD。行クリックで当該品番に絞り込み（**部品表自体は機種全体のまま**；グラフ・明細のみ絞る）。
- **グラフ**: 横軸＝月、積み上げ棒（資源CD・上位24）。**明細表**で月×資源CDの分数を確認。

### 実装ファイル（2026-05-26 追加分）

- API: `machine-monthly-load-*.ts`, `year-month-range.ts`
- Web: `LoadBalancingMachineMonthlyTab.tsx`, `LoadBalancingOverviewTab.tsx`, `LoadBalancingMacProxyPanel.tsx`, `mapMachineMonthlyLoadChartRows.ts`

## データベース

Prisma モデル（能力・ルール・2026-04-30 マイグレーション）: `ProductionScheduleResourceCapacityBase`, `ProductionScheduleResourceMonthlyCapacity`, `ProductionScheduleLoadBalanceClass`, `ProductionScheduleLoadBalanceTransferRule`（`csvDashboardId` + `siteKey` 単位）。

**機種別月次ビュー**は上記に加え、既存の `CsvDashboardRow` / `ProductionScheduleRowNote` / `ProductionScheduleOrderSupplement` / `ProductionScheduleProgress` を参照するのみ（**新規マイグレーションなし**）。

## 本番デプロイ

| 日付 | ブランチ | 範囲 | 代表コミット |
|------|----------|------|----------------|
| 2026-04-30 | `feat/kiosk-load-balance-suggest` | 初版（API+Web+DB） | `d3c37b6f` |
| 2026-05-26 | `feat/kiosk-load-balancing-machine-monthly-view` | 機種別月次タブ（API+Web） | `60b94b9d` |

標準手順は [deployment.md](deployment.md)。**Pi5 → Pi4×4 を `--limit` 1 台ずつ**。**Pi3 は除外**。

- 2026-05-26 実績・Detach ID・検証: [KB-362 §Production deploy](../knowledge-base/KB-362-kiosk-load-balancing.md#production-deploy実績-2026-05-26--機種別月次) / [deployment.md §2026-05-26](deployment.md#kiosk-load-balancing-machine-monthly-view-2026-05-26)
- 2026-04-30 初版: [KB-362](../knowledge-base/KB-362-kiosk-load-balancing.md) / [deployment.md §2026-04-30](deployment.md)

## 関連

- 手動順番・Mac 代理: [KB-297](./knowledge-base/KB-297-kiosk-due-management-workflow.md)
- 生産スケジュール設定 UI: `/admin/production-schedule-settings`
