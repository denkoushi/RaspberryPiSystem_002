# キオスク 生産スケジュール 負荷調整（山崩し支援）

## 概要

キオスク専用の **負荷調整** 画面（`/kiosk/production-schedule/load-balancing`）では、資源CDごとの **月次必要工数**（`FSIGENSHOYORYO` 合計）と **設定した能力** を比較し、超過状況を可視化します。**社内移管サジェスト**は工程行単位で別資源CDへの移管候補を提示するのみです。**外注候補シミュ**は選択した工程行を社内負荷から除外する試算のみです。いずれも自動で順番や割当を変更しません。

画面内タブ:

| タブ | 用途 | 月の定義 |
|------|------|----------|
| **資源CD俯瞰** | 単月の資源CD別負荷・能力・社内移管サジェスト・外注候補シミュ | `plannedEndDate`（受注補足）の暦月 |
| **機種別月次負荷** | 機種（MH/SH 行 `FHINMEI`）→ 部品 → 月×資源CDの積み上げ | **有効納期**（行備考 `dueDate` → なければ `plannedEndDate`）の暦月 |
| **着手日・平準化** | 着手日〜有効納期の日割り負荷・月/日次・平準化シミュ | **日割り後**を月合算／日別表示（着手日は `plannedStartDate`） |

## UI レイアウト（2026-05-28 · 資源CD俯瞰）

- **正本**: 静的プレビュー [kiosk-load-balancing-layout-preview.html](../previews/kiosk-load-balancing-layout-preview.html)（**2026-05-28**: ワークスペース配置・表 14px・**X軸=上段CD+下段表示名縦書き** を反映）
- **契約モジュール**: `loadBalancingUiClasses.ts`（ページ/カード/表/ボタン/チップの Tailwind クラス）
- **ヘッダー**: `LoadBalancingPageHeader.tsx`（3タブ + Mac 絞込 `V`）
- **ベースフォント**: ページ・表・チップ **`text-sm`（14px）** · 見出し `text-xl` · Recharts 軸 **13px**
- **ワークスペース（俯瞰・`lg` 以上）**: 左列 **1.45fr** = 棒グラフ + 試算結果、右列 **1fr** = 推奨セット
- **全幅**: ページ `max-w-[1440px]` なし（他キオスク同様）。棒グラフ凡例は **チャート直上**（Recharts 内蔵 Legend 不使用）
- **資源CD表示名（2026-05-28）**:
  - **データ**: 既存 `GET /kiosk/production-schedule/resources` の `resourceNameMap`（新 API なし）
  - **ステップ2チップ**: 1行目 `資源CD (+超過分)` · 2行目 表示名（`lbChip.line1` / `line2`）
  - **棒グラフ X 軸（2026-05-28 現行）**: **棒側**=資源CD（`dy: -4`）· **軸下**=表示名（**`+90°`** · 下余白のみ）。`-90°` は実機 NG（上方向に被る）。`loadBalancingOverviewChartAxis.ts`
  - **解決関数**: `resolveLoadBalancingResourceDisplayName.ts`（手動順番 `joinManualOrderResourceDisplayNames` と同一）
  - **行マッピング**: `mapOverviewResourceChartRows.ts`（必要分降順・上位 48）
- **俯瞰のみ全面適用**。機種別月次・着手日は今後 `loadBalancingUiClasses` を横展開可能
- **デプロイ**: **Pi5 のみ**。本番 **`b7288982`**（[KB-362 §軸下方向](../knowledge-base/KB-362-kiosk-load-balancing.md#production-deploy実績-2026-05-28--棒グラフx軸表示名を軸下へ--pi5-のみ)）

## 集計ポリシー（サーバ実装に準拠）

- **月次キー**: 受注補足 `ProductionScheduleOrderSupplement.plannedEndDate` の暦月（UTC 月初〜翌月未満）。
- **対象行（資源CD俯瞰・外注・社内移管）**: winner 行かつ **負荷専用 eligibility**（`fkmail` 必須・**S/R/O/P**・**C/X 除外**・実効未完了）。工数は **`FSIGENSHOYORYO` 合計**（`× plannedQuantity` しない）。
- **対象行（機種別月次・着手日）**: winner 行かつ **上記と同じ負荷専用 eligibility**（`load-balancing-eligibility.policy.ts`）。月キーだけタブごとに異なる（下表参照）。
- **一覧表示との差**: 生産日程一覧は **S/R/C/X** 可視。**負荷集計**は **C/X 除外・S/R/O/P**（P/O は一覧に出なくても未完了負荷に含む）。
- **品目コード**: `FHINCD` が `MH%` / `SH%` の行は集計から除外（一覧の注文検索と同趣旨）。
- **資源CD**: 大文字・トリム正規化。切断工程除外リスト（資源カテゴリ設定）に該当する CD は集計対象外。

## 能力・ルール設定（管理画面）

**管理** → **生産スケジュール設定** 内の各カードで、ロケーション（端末スコープ文字列）に紐づく **siteKey** 単位で保存します。

1. **基準能力**: 資源CD → `baseAvailableMinutes`（分）。  
2. **月次能力**: `YYYY-MM` ごとの上書き（同一資源CDでは月次が基準より優先）。  
3. **山崩し分類**: 資源CD → `classCode`。  
4. **移管ルール**: `fromClassCode` → `toClassCode`、優先度、有効、効率係数（移管先に載る負荷は `行工数 / efficiencyRatio`）。
5. **稼働日ルール**（着手日・平準化タブ用）: 資源CD → `weekdays`（平日）または `calendar_days`（暦日）。未設定は平日扱い。

API（管理者）: `/production-schedule-settings/load-balancing/*`（`work-calendars` 含む）

### 管理 `shared` とキオスク `siteKey`（2026-05-27）

- 管理画面の既定ロケーションは **`shared`**（工場共通設定）。キオスクは端末から **`siteKey`（例: 第2工場）** を解決して読む。
- キオスク向け読み取り（`*Resolved`）は **`siteKey` 行を優先**し、不足分だけ **`shared` を補完**する（資源カテゴリ設定と同趣旨）。**DB 移行は不要**。
- **移管ルール**のマージキーは DB と同じ **`fromClassCode` + `toClassCode` + `priority`**。site で priority だけ変えても、shared の別 priority 行は残る（from/to 単位の全面置換ではない）。

## キオスク API

- `GET /kiosk/production-schedule/load-balancing/overview?month=YYYY-MM&targetDeviceScopeKey=...`
- `POST /kiosk/production-schedule/load-balancing/suggestions`
  Body: `{ month, targetDeviceScopeKey?, maxSuggestions?, overResourceCds? }`（**社内移管**サジェスト）
- `POST /kiosk/production-schedule/load-balancing/outsourcing-candidates`
  Body: `{ month, targetDeviceScopeKey?, overResourceCds?, maxCandidates? }`
  - `candidates`（工程行・効果降順）と `externalizationCandidates`（部品単位・`candidateId` 安定キー）。
- `POST /kiosk/production-schedule/load-balancing/outsourcing-plan`
  Body: `{ month, targetDeviceScopeKey?, overResourceCds?, strategy? }`（既定 `max_over_reduction`）。
  - 部品推奨セット・解消可否・残超過を返す。**DB 更新なし**。
- `POST /kiosk/production-schedule/load-balancing/outsourcing-simulate`
  Body: `{ month, targetDeviceScopeKey?, overResourceCds?, selectedRowIds[] | selectedCandidateIds[] }`
  - **どちらか一方**（同時指定・両方空は 400）。社内負荷除外の read-only シミュ。
  - **`selectedCandidateIds` は最大 500 件**（`outsourcing-simulation.policy.ts` 正本）。`maxCandidates` リクエスト上限は **200**。
- `POST /kiosk/production-schedule/load-balancing/outsourcing-replacements`
  Body: `{ month, targetDeviceScopeKey?, overResourceCds?, currentSelectedCandidateIds[], removeCandidateId, maxOptions? }`
  - 1 部品を外したときの代替候補（既定最大 5 件）。
- `GET /kiosk/production-schedule/load-balancing/machine-monthly-load?fromMonth=YYYY-MM&toMonth=YYYY-MM&targetDeviceScopeKey=...&machineName=...&fhincd=...`  
  - 未完了部品工程のみ。月範囲は最大 **12 か月**。  
  - `machineName` / `fhincd` は任意（部品行クリックで `fhincd` 絞り込み）。  
  - 機種名は製番ごとの MH/SH 行 `FHINMEI`（`resolveSeibanMachineDisplayNamesBatched` と同系）。
- `GET /kiosk/production-schedule/load-balancing/start-date-leveling?fromMonth=&toMonth=&bucket=month|day&focusMonth=&resourceCd=&targetDeviceScopeKey=...`
  - 負荷 = **`FSIGENSHOYORYO` 行総分（分）**（0 分は未配分 `zero_required_minutes`）。
  - **着手日** = `OrderSupplement.plannedStartDate`、**終端** = 有効納期。期間内を資源CDの稼働日ルールで**均等日割り**し、月次は日割りの合算。
  - 着手日/有効納期が欠損する行は SQL で落とさず **未配分**（`missing_planned_start_date` / `missing_effective_due_date`）として返す。
  - 月範囲は最大 **12 か月**。
- `POST /kiosk/production-schedule/load-balancing/start-date-leveling/simulate`
  - Body: 表示条件 + `moves: [{ rowId, targetDate }]`。**DB 更新なし**（指定行の負荷を移動先日に寄せて再集計）。

Mac の device-scope v2 有効時は、他画面と同様 **`targetDeviceScopeKey` 必須**（未指定時は 400）。

## 機種別月次負荷（UI）

- **開始月・終了月**: 初期値は当月から **6 か月**（最大 **12 か月**）。
- **機種選択**: 一覧は期間内の未完了負荷から集計した `FHINMEI`（機種名未登録ラベル含む）。
- **部品表**: 品番・品名・最早納期・所要分・資源CD。行クリックで当該品番に絞り込み（**部品表自体は機種全体のまま**；グラフ・明細のみ絞る）。
- **グラフ**: 横軸＝月、積み上げ棒（資源CD・上位24）。**明細表**で月×資源CDの分数を確認。

### 実装ファイル（2026-05-26 追加分）

- API: `machine-monthly-load-*.ts`, `year-month-range.ts`
- Web: `LoadBalancingMachineMonthlyTab.tsx`, `LoadBalancingOverviewTab.tsx`, `LoadBalancingMacProxyPanel.tsx`, `mapMachineMonthlyLoadChartRows.ts`

## 資源CD俯瞰・外注候補シミュ（UI）

- **超過資源選択**: `overMinutes > 0` の資源CDを複数選択（初期は全超過資源を選択）。
- **推奨セット（部品）**: 「推奨セットを自動選定」→ 部品一覧・残超過・**外す** / **入れ替え** / **クリア**（**DB 更新なし**）。
- **工程行（従来）**: 折りたたみ内で外注候補取得 → チェック → 累積シミュ（Phase 0 互換）。
- **社内移管サジェスト**: 既存どおり分類/移管ルールに基づく別資源CDへの移管候補（外注候補とは別）。

**デプロイ**: 外注・推奨セットは Pi5 **`cd42ebfe`**（契約整合）+ **`463aeabb`**（**自動選定後の表示維持**·Web のみ）·Pi5→Pi4×4 **本番反映済**（2026-05-27）。詳細は [KB-362](../knowledge-base/KB-362-kiosk-load-balancing.md)。

### 自動選定後の表示維持（`463aeabb`）

**前提**: `cd42ebfe` で plan 成功後は **`outsourcing-simulate` を呼ばず** `mapOutsourcingPlanToSimulateResult` でチャートを更新する。

**不具合（修正前）**: overview の React Query 再評価で `overResourceOptions` の**配列参照だけ**が変わり、reset effect が **plan / simulate 表示を即クリア**していた。

**修正後の契約**:

| イベント | reset（試算破棄） | 超過資源チェック同期 |
|----------|-------------------|----------------------|
| `month` / `scopeKey` / `overResourceKey` のいずれか変化 | **する** | `overResourceKey` 変化時 |
| overview 同値再フェッチのみ | **しない** | **しない** |

正本: `loadBalancingOverviewSession.ts` · UI: `LoadBalancingOverviewTab.tsx` · テスト: `loadBalancingOverviewSession.test.ts` · `ProductionScheduleLoadBalancingPage.test.tsx`（「同値 overview 再評価でも plan 表示維持」）。

### 実装ファイル（外注・推奨セット）

- API: `load-balancing-eligibility.policy.ts`, `outsourcing-simulation.policy.ts`, `monthly-load-query.service.ts`, `outsourcing-simulation.engine.ts`, `outsourcing-simulation.service.ts`
- Web: `LoadBalancingOverviewTab.tsx`, `LoadBalancingPageHeader.tsx`, `loadBalancingUiClasses.ts`（見た目契約）, `loadBalancingOverviewSession.ts`, `useExternalizationPlanState.ts`, `ExternalizationPlanPanel.tsx`, `loadBalancingOutsourcingLimits.ts`, `loadBalancingOutsourcingSelection.ts`, `mapOutsourcingPlanToSimulateResult.ts`, `externalizationPlanErrors.ts`
- UI プレビュー（静的）: [docs/previews/kiosk-load-balancing-layout-preview.html](../previews/kiosk-load-balancing-layout-preview.html)

### 推奨セット自動選定（契約・`cd42ebfe`）

**ボタン押下後のサーバ呼び出し（正常系）**:

1. `POST outsourcing-plan` — 部品 ID リスト + `beforeResources` / `afterResources`（チャート用）
2. `mapOutsourcingPlanToSimulateResult` — クライアントで simulate 相当 DTO に変換しチャート更新（**`outsourcing-simulate` は呼ばない**）
3. `POST outsourcing-candidates` — **`maxCandidates: 200`**（`loadBalancingOutsourcingLimits.ts` が policy と同値）

**上限（単一正本）**: `outsourcing-simulation.policy.ts` → [ADR-20260527](../decisions/ADR-20260527-load-balancing-outsourcing-limits.md)

| パラメータ | 上限 |
|------------|------|
| `maxCandidates`（candidates API） | **200** |
| `selectedCandidateIds`（simulate API） | **500** |
| plan 内部プール | **500** |

**エラー**: `ExternalizationPlanPanel` の **`actionError`** に plan / candidates / simulate / replacements を集約表示。

**体感速度の注意**: タブ初回の `machine-monthly-load`・`start-date-leveling` は **十数秒〜30秒**かかることがある（2026-05-27 Pi5 実測）。自動選定単体は **plan 約 1s 台**（simulate 省略後）。React Query **`staleTime`**: overview **60s**、機種別月次・着手日 **120s**。

## 着手日・平準化（UI）

- **開始月・終了月**: 初期値は当月から **6 か月**（最大 **12 か月**）。
- **表示**: **月次**（月×資源の積み上げ）／ **日次**（対象月の日別・資源CD任意で能力比較）。
- **平準化シミュ**: 行を選び移動先日を指定 → **読み取り専用**（着手日・補助テーブルは更新しない）。
- **未配分**: 着手日/納期欠損・所要0分・稼働日なし等を別表で表示。

### 実装ファイル（着手日・平準化）

- API: `start-date-leveling-*.ts`, `work-calendar-policy.ts`, `load-distribution.ts`
- Web: `LoadBalancingStartDateLevelingTab.tsx`, `mapStartDateLevelingChartRows.ts`
- 管理: `ProductionScheduleLoadBalancingSettingsSection.tsx`（稼働日ルール）

## データベース

Prisma モデル（能力・ルール・2026-04-30 マイグレーション）: `ProductionScheduleResourceCapacityBase`, `ProductionScheduleResourceMonthlyCapacity`, `ProductionScheduleLoadBalanceClass`, `ProductionScheduleLoadBalanceTransferRule`（`csvDashboardId` + `siteKey` 単位）。

**稼働日ルール**（2026-05-26）: `ProductionScheduleResourceWorkCalendar`（マイグレーション `20260526100000_load_balancing_work_calendar`）。

**機種別月次・着手日平準化**は、上記に加え既存の `CsvDashboardRow` / `ProductionScheduleRowNote` / `ProductionScheduleOrderSupplement` / `ProductionScheduleProgress` を参照。

## 本番デプロイ

| 日付 | ブランチ | 範囲 | 代表コミット |
|------|----------|------|----------------|
| 2026-04-30 | `feat/kiosk-load-balance-suggest` | 初版（API+Web+DB） | `d3c37b6f` |
| 2026-05-26 | `feat/kiosk-load-balancing-machine-monthly-view` | 機種別月次タブ（API+Web） | `60b94b9d` |
| 2026-05-26 | `feat/kiosk-load-balancing-start-date-leveling` | 着手日・平準化タブ + 稼働日ルール（API+Web+DB） | （未コミット） |
| 2026-05-26 | `feat/kiosk-load-balancing-externalization-plan` | 部品推奨セット・負荷母集団修正（API+Web） | Pi5 で `outsourcing-plan` / 画面文言を確認 |
| 2026-05-27 | `feat/kiosk-load-balancing-ui-p0p1` | 外注上限統一・自動選定フロー修正 | Pi5 **`cd42ebfe`** |
| 2026-05-27 | `feat/kiosk-load-balancing-auto-plan-reset-fix` | 自動選定後の表示維持（reset 境界） | **`463aeabb`** · Pi5→Pi4×4 |

標準手順は [deployment.md](deployment.md)。**Pi5 → Pi4×4 を `--limit` 1 台ずつ**。**Pi3 は除外**。

- 2026-05-27 表示維持: [KB-362 §Production deploy 表示維持](../knowledge-base/KB-362-kiosk-load-balancing.md#production-deploy実績-2026-05-27--自動選定表示維持--pi5pi44) / [deployment.md §2026-05-27](deployment.md#kiosk-load-balancing-auto-plan-reset-fix-2026-05-27)

- 2026-05-26 実績・Detach ID・検証: [KB-362 §Production deploy](../knowledge-base/KB-362-kiosk-load-balancing.md#production-deploy実績-2026-05-26--機種別月次) / [deployment.md §2026-05-26](deployment.md#kiosk-load-balancing-machine-monthly-view-2026-05-26)
- 2026-04-30 初版: [KB-362](../knowledge-base/KB-362-kiosk-load-balancing.md) / [deployment.md §2026-04-30](deployment.md)

## 生産システムとの数値突合（重要）

キオスクの月次 H は、**生産システムの「負荷残」「負荷消費」と定義が異なり、一致しないのが正常**です。

| 観点 | 生産システム | キオスク負荷調整 |
|------|--------------|------------------|
| 主データ | **資源所要量**（`scawSTSIGENSHOYORYO` 等） | **生産日程 winner 行**（`CsvDashboardRow`） |
| グラフの日付 | **`FSIGENSHOYOYMD`** | **着手日〜有効納期**（日割り）または **納期月** |
| 工数行 | **日別**（1日1行） | **工程1行**（`FSIGENSHOYORYO`＝行総分） |
| `FSIGENSHOYOYMD` | あり | **未取込** |

**設計判断**: 山崩し・平準化の正本軸は **着手日** とする。`FSIGENSHOYOYMD` には合わせない。

- 詳細・数値表: [KB-363](../knowledge-base/KB-363-load-balancing-production-system-reconciliation.md)
- 分析: [production-load-balancing-reconciliation-with-production-system-20260527.md](../analysis/production-load-balancing-reconciliation-with-production-system-20260527.md)
- ADR: [ADR-20260527](../decisions/ADR-20260527-load-balancing-aggregation-axis-start-date.md)

**2026-05-27 集計修正**（ブランチ `feat/kiosk-load-balancing-aggregation-fix` · PR [#350](https://github.com/denkoushi/RaspberryPiSystem_002/pull/350)）:

| 項目 | 内容 |
|------|------|
| 着手日タブ工数 | **`FSIGENSHOYORYO` 行総分のみ**（`× plannedQuantity` 廃止） |
| 母集団 | **`buildLoadBalancingRowEligibilityWhereSql`** — 俯瞰・機種別・着手日で統一（C/X 除外・S/R/O/P・実効未完了・`fkmail` 同期済み） |
| 生産 H との関係 | **数値一致は要件にしない**（[ADR-20260527](../decisions/ADR-20260527-load-balancing-aggregation-axis-start-date.md)） |
| 詳細 | [KB-363](../knowledge-base/KB-363-load-balancing-production-system-reconciliation.md) |

**2026-05-27 `shared` 能力フォールバック**（`37a7b6d4`）:

- 管理は **`siteKey=shared`** に保存しやすいが、キオスクは **`siteKey=工場名`** で読む。
- キオスク API は **`listLoadBalancing*Resolved`**（5 種）で **`site` 優先 + `shared` 不足分補完**。管理の `replace*` は不変。
- **症状**: 工程能力がすべて `—` だが `requiredMinutes` は返る → [KB-362 §能力設定](../knowledge-base/KB-362-kiosk-load-balancing.md#能力設定と-shared--sitekey2026-05-27)
- **本番（Pi5 のみ）**: Detach **`20260527-161741-7843`** — [deployment.md §2026-05-27](deployment.md#kiosk-load-balancing-aggregation-fix-2026-05-27)

**2026-05-27 外注契約整合 + 自動選定フロー**（`cd42ebfe`）:

| 項目 | 内容 |
|------|------|
| 症状 | 「推奨セットを自動選定」無反応・`maxCandidates:500` で 400 |
| 修正 | policy 単一化 · plan 結果の即チャート反映 · `actionError` · simulate 省略 |
| 本番（Pi5 のみ） | Detach **`20260527-191646-1476`** · Phase12 **43/0/0** |
| 詳細 | [KB-362 §実機検証 契約整合](../knowledge-base/KB-362-kiosk-load-balancing.md#実機検証2026-05-27--外注契約整合--自動選定フロー) · [deployment §契約整合](deployment.md#kiosk-load-balancing-ui-p0p1-contract-fix-2026-05-27) |

---

## トラブルシューティング（要約）

| 症状 | 確認 |
|------|------|
| 自動選定が無反応 | device scope · 超過資源 0 · Pi5 HEAD **`cd42ebfe`** · DevTools で plan 後の **400** |
| 能力がすべて `—` | `*Resolved` 未デプロイ or 能力未登録 — [KB-362 §shared](../knowledge-base/KB-362-kiosk-load-balancing.md#能力設定と-shared--sitekey2026-05-27) |
| 全タブが重い | 月次/平準化 API の初回クエリ — 自動選定だけの問題ではない |
| Pi4 だけ旧 UI | Pi4 未デプロイ or キャッシュ — [verification-checklist §6.6.4](verification-checklist.md) |

詳細表: [KB-362 §Troubleshooting](../knowledge-base/KB-362-kiosk-load-balancing.md#troubleshooting)

---

## 設定読み取り境界（キオスク vs 管理）

| 用途 | API / 関数 | `siteKey` の扱い |
|------|------------|------------------|
| 管理 CRUD | `listLoadBalancing*` / `replaceLoadBalancing*` | リクエストのロケーションそのまま（`shared` 可） |
| キオスク表示・サジェスト | `listLoadBalancing*Resolved` | **site 優先 + shared 補完** |
| マージ実装 | `load-balancing-settings-merge.ts` | キー単位で site が勝ち、欠損のみ shared |

---

## 関連

- 手動順番・Mac 代理: [KB-297](../knowledge-base/KB-297-kiosk-due-management-workflow.md)
- 生産スケジュール設定 UI: `/admin/production-schedule-settings`
- 生産システム突合: [KB-363](../knowledge-base/KB-363-load-balancing-production-system-reconciliation.md)
- 外注上限 ADR: [ADR-20260527](../decisions/ADR-20260527-load-balancing-outsourcing-limits.md)
- ナレッジ正本: [KB-362](../knowledge-base/KB-362-kiosk-load-balancing.md)
