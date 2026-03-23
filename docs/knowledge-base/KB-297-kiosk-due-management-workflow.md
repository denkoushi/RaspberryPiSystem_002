---
title: KB-297: キオスク納期管理（製番納期・部品優先・切削除外設定）の実装
tags: [production-schedule, kiosk, due-management, priority]
audience: [開発者, 運用者]
last-verified: 2026-03-23
related:
  - ../decisions/ADR-20260307-kiosk-due-management-model.md
  - ../decisions/ADR-20260319-production-schedule-manual-order-target-location.md
  - ../decisions/ADR-20260319-manual-order-device-scope-v2.md
  - ../guides/csv-import-export.md
category: knowledge-base
---

# KB-297: キオスク納期管理（製番納期・部品優先・切削除外設定）の実装

## Context

- 生産スケジュールで「行単位の納期設定」だけでは、現場リーダーが製番単位で全体調整しづらい
- 切削判定が「研削以外すべて」だったため、塗装系コード（`10`, `MSZ`）が切削に混入する運用課題があった
- 既存画面との互換を保ちつつ、製番単位納期管理へ段階移行する必要があった

## Symptoms

- 製番納期を部品・工程へ反映する作業が手動で重い
- 部品優先順位の保存先がなく、提案順と実運用順を分離できない
- 工程カテゴリ（研削/切削）の切替結果が実態とずれる

## Investigation

- H1: `ProductionScheduleRowNote.dueDate` のみで製番単位運用を吸収できる  
  - Result: REJECTED（行単位のみで、製番全体更新/再読込が困難）
- H2: 製番納期を別テーブル化し、既存行へwritebackすれば互換維持できる  
  - Result: CONFIRMED
- H3: 切削除外リストをロケーション別設定にすれば、現場差異へ追従できる  
  - Result: CONFIRMED

## Root cause

- 既存モデルが「行単位最適化」で、製番単位の意思決定（納期・優先順）を保持する境界がなかった

## Fix

- DBに以下を追加
  - `ProductionScheduleSeibanDueDate`（製番納期）
  - `ProductionSchedulePartPriority`（製番内の部品優先順位）
  - `ProductionScheduleResourceCategoryConfig`（切削除外リスト）
- キオスク専用APIを追加
  - `GET /api/kiosk/production-schedule/due-management/summary`
  - `GET /api/kiosk/production-schedule/due-management/seiban/:fseiban`
  - `PUT /api/kiosk/production-schedule/due-management/seiban/:fseiban/due-date`
  - `PUT /api/kiosk/production-schedule/due-management/seiban/:fseiban/part-priorities`
- `DueDateWritebackService`で製番納期更新時に既存`row dueDate`へ反映（互換維持）
- 管理コンソールに切削除外設定API/UIを追加
  - `GET/PUT /api/production-schedule-settings/resource-categories`
- キオスクに新画面を追加
  - `/kiosk/production-schedule/due-management`

## Prevention

- ポリシー層を分離して、工程カテゴリ判定・表面処理優先を呼び出し側から隔離
- 切削除外リストはロケーション別設定で変更可能にし、コード修正なしで運用調整可能
- 回帰防止として、ポリシーユニットテストとキオスク統合テスト（due-management系）を追加

## 生産順序モード拡張（手動順番/自動順番 + targetLocation、2026-03-19）

- **Context**:
  - 全体ランキング精度が改善途上のため、現場ではオペレーターの手動順番を並行運用する必要がある。
  - 現場リーダーが自席から代理設定できるよう、`targetLocation` を指定した更新基盤が必要になった。
- **Fix**:
  - 生産スケジュール画面に `自動順番 / 手動順番` を追加し、既定を `手動順番` に設定。
  - 手動順番は「単一資源CD表示時のみ」有効化し、それ以外は `資源順番` ドロップダウンをグレーアウト。
  - 手動順番の並びは `processingOrder` 昇順（未設定は末尾）へ分離し、`auto` は既存 `globalRank` 表示ロジックを維持。
  - `PUT /api/kiosk/production-schedule/:rowId/order` に `targetLocation`（任意）を追加。
    - 未指定: 従来どおり actor location を更新。
    - 指定時: 代理更新可否を境界でガードし、不正な他拠点更新は `403 TARGET_LOCATION_FORBIDDEN`。
  - 監査用に order 更新ログへ `actorLocation/targetLocation/actorClientKey/resourceCd/orderNumber` を記録。
  - 学習イベントに `manual_order_update` を追加し、`actorLocation/targetLocation/resourceCd/reorderDelta` を記録。
  - 納期管理画面に `手動順番 全体像` パネルを追加し、工程別設定件数・自動順位との乖離・最終更新時刻/更新者を可視化。
- **Verification**:
  - `pnpm --filter @raspi-system/web test -- src/features/kiosk/productionSchedule/displayRank.test.ts src/features/kiosk/productionSchedule/displayRowDerivation.machinePart.test.ts src/features/kiosk/productionSchedule/displayRowDerivation.sortMode.test.ts` 成功（9 tests）。
  - `pnpm --filter @raspi-system/web exec tsc --noEmit` 成功。
  - API側 `tsc --noEmit` は既存の `rootDir/include` 設定起因で失敗（今回差分起因ではないため既知）。
  - **デプロイ・実機検証（2026-03-19）**: ブランチ `feat/production-schedule-target-location-ordering`、Pi5 → raspberrypi4 → raspi4-robodrill01 の順に1台ずつ実行。Phase12 26項目PASS（manual-order-overview API チェック追加）、実機OK。
  - **CI修正**: `ProductionScheduleGlobalRank` の正しいカラムは `priorityOrder`（`rankOrder` は存在しない）。`due-management-manual-order-overview.service.ts` で誤参照していたため修正。
- **Prevention**:
  - `targetLocation` の変換・検証は route 境界に閉じ込め、service 契約は `locationKey` を維持。
  - 手動順番の有効条件を UI とソート戦略の両方で一致させ、単一資源CD条件の逸脱を防止。
  - 代理更新や学習イベント追加時も既存API互換（未指定時の挙動）を壊さない。

### Device-scope v2: manual order, Mac proxy, Pi4 scope, UI hints (2026-03-20)

- **Spec / progress**: `ProductionScheduleOrderAssignment.siteKey` と端末キー `deviceScopeKey`（`ClientDevice.location`）で手動順番を保存。工場俯瞰 API は `siteKey` 必須・`devices[]` 返却（`KIOSK_MANUAL_ORDER_DEVICE_SCOPE_V2_ENABLED`）。ADR: [ADR-20260319-manual-order-device-scope-v2](../decisions/ADR-20260319-manual-order-device-scope-v2.md)。
- **Leader ops（代理更新）**: API 上、**`ClientDevice.location === 'Mac'`** の端末だけが他端末向けに `targetDeviceScopeKey` を付与可能。**Apple 開発用 Mac 専用ではない**。現場リーダー用デスク PC を **`location=Mac` として登録し、専用 `clientKey` でキオスクを開く**運用とする。
- **Pi4 kiosk alone**: **その端末自身**の手動順番のみ変更可。他 Pi4 の代理は不可（`targetDeviceScopeKey` / `targetLocation` は 400）。
- **UI**: 文言「今日判断系」は無い。**当日計画への反映**内の **「今日対象候補（トリアージ属性）」** が相当。サマリは **製番登録・納期前提**内の対象候補/危険/注意/余裕。**手動順番 全体像**で v2 時に変わるのは主に**左レール内のシアン枠**（工場→端末の2段・端末切替で枠内の資源CD別集計が変わる）。
- **Deploy / verify（実績）**: `feat/device-scope-manual-order` を Pi5 → `raspberrypi4` → `raspi4-robodrill01` の順に `--limit` でデプロイ（Pi3 除外）。`./scripts/deploy/verify-phase12-real.sh` は v2 有効時 `global-rank` の `actorLocation` から `siteKey` を導出し `manual-order-overview?siteKey=...` を検証するよう更新済み。
- **Troubleshooting**:
  - Phase12 が `manual-order-overview` で失敗: v2 有効時は **無印 overview は 400**（`siteKey` 必須）。スクリプトが最新か、`siteKey` 付きで叩けているか確認。
  - ローカル API テストが大量失敗: **Postgres 未起動**のことが多い。Docker で DB 起動後 `prisma migrate deploy` を実施。
  - Web lint（import 順）: `pnpm exec eslint --fix` で自動修正可。

<a id="manual-order-pi4-target-device-scope-key-web-fix-2026-03-23"></a>

### 手動順番 Pi4 下ペイン「取得に失敗」— `targetDeviceScopeKey` の Web 付与誤り（2026-03-23）

- **Context**:
  - 手動順番専用ページで上ペインの「編集」を押すと、下ペインの `GET /api/kiosk/production-schedule`（および `order-usage`）にクエリ `targetDeviceScopeKey` が付与されていた。
  - device-scope v2 では **キオスク（Pi4 等）は `targetDeviceScopeKey` を送ってはならない**（`resolveProductionScheduleAssignmentLocationKey` が `TARGET_DEVICE_SCOPE_KEY_FORBIDDEN` で 400）。**Mac 相当（`ClientDevice.location === 'Mac'`）の端末のみ**代理指定可。
  - 通常の生産スケジュール画面（`ProductionSchedulePage`）は `isMacEnvironment(userAgent)` で **Mac のときだけ** `targetDeviceScopeKey` を付けていたが、`ProductionScheduleManualOrderPage` は **常に付与**しており、Mac ブラウザでは問題が表面化しにくく、**Pi4 キオスク（Linux arm User-Agent）では必ず 400** となり「取得に失敗しました」と表示された。
- **Fix（Web）**:
  - [`ProductionScheduleManualOrderPage.tsx`](../../apps/web/src/pages/kiosk/ProductionScheduleManualOrderPage.tsx) で `isMacEnvironment` と `VITE_KIOSK_MANUAL_ORDER_DEVICE_SCOPE_V2_ENABLED` から `macManualOrderV2` を導出し、**Mac かつ v2 のときだけ** `scheduleListParams` / `useProductionScheduleMutations` の `productionScheduleTargetDeviceScopeKey` / `useKioskProductionScheduleOrderUsage` の `targetDeviceScopeKey` を付与（`ProductionSchedulePage` と同型）。
  - API 変更なし。
- **Deploy / verify（実績）**:
  - ブランチ **`fix/phase12-verify-ping-retry`** に手動順番修正を含め、`infrastructure/ansible/inventory.yml` で **Pi5 → `raspberrypi4` → `raspi4-robodrill01` のみ**（Pi3 除外）、`--limit` 1 台ずつ、`--detach --follow`（`RASPI_SERVER_HOST` 必須）。
  - **Run ID 例**: `20260323-083523-8980`（Pi5）/ `20260323-084021-9264`（raspberrypi4）/ `20260323-084439-11342`（raspi4-robodrill01）。
  - **実機検証**: `./scripts/deploy/verify-phase12-real.sh` **PASS 28 / WARN 0 / FAIL 0**（2026-03-23）。
- **Troubleshooting**:
  - 下ペインが「取得に失敗」で、API が **400** + `errorCode: TARGET_DEVICE_SCOPE_KEY_FORBIDDEN**: キオスクから `targetDeviceScopeKey` が送られていないか、Web ビルドが古い可能性。Pi5 の `web` イメージ／キャッシュとキオスクのハードリロードを確認。
  - **Pi4 で他端末カードを選んだときのデータ**: キオスクは API 上 **自端末の assignment スコープ**のみ。上ペインで別端末を選んでも、クエリから `targetDeviceScopeKey` を外すと一覧は **actor（当該 Pi4）**基準で解決される（他端末の割当を Pi4 から代理閲覧する要件は別途 API ポリシー検討が必要）。

<a id="manual-order-sitekey-canonical-sync-2026-03-23"></a>

### 手動順番・全体ランキングの工場共有同期（`siteKey` 正本、2026-03-23）

- **Context**:
  - 手動順番は `deviceScopeKey` 保存、全体ランキング（globalShared）は `shared-global-rank` 保存で運用されており、同一工場内でも端末ごとに表示差分が発生した。
  - 要件は「資源CDごとの手動順番」と「全体ランキング（行単位表示含む）」の両方を工場単位で同期すること。
- **Fix（API/保存契約）**:
  - 手動順番:
    - `resolveProductionScheduleAssignmentLocationKey` は v2 有効時に **`siteKey` を返す**よう変更（Mac は `targetDeviceScopeKey` を検証した上でその工場へ、キオスクは自工場へ）。
    - `PUT /kiosk/production-schedule/:rowId/order` と `PUT /kiosk/production-schedule/:rowId/complete` は工場キーで更新。
    - 読み取りは `location=siteKey` を優先しつつ `siteKey=siteKey` の legacy 行をフォールバック参照（`processingOrder`/`order-usage`/assigned-only 条件）。
  - 全体ランキング:
    - `globalShared` の保存先を `shared-global-rank` 固定から **`siteKey` 保存**へ変更。
    - 参照時は `siteKey` を優先し、空の場合のみ `shared-global-rank` をフォールバック参照（互換）。
    - 生産スケジュール一覧の `globalRank` 参照優先順も `siteKey -> shared-global-rank -> locationKey` へ更新。
  - overview:
    - `manual-order-overview` は `siteKey` 正本行を各端末割当（resource assignments）へ再配分して表示できるよう調整。
- **Deploy / verify（実績）**:
  - ブランチ **`feat/sitekey-shared-manual-rank-sync`**。
  - **デプロイ**（Pi3 除外、1台ずつ）: `20260323-100741-24963`（Pi5）/ `20260323-101322-22407`（raspberrypi4）/ `20260323-101738-18203`（raspi4-robodrill01）。
  - **自動実機検証**: `./scripts/deploy/verify-phase12-real.sh` **PASS 28 / WARN 0 / FAIL 0**。
  - **同期実測（API）**:
    - `client-key-raspberrypi4-kiosk1` で手動順番を更新 -> `client-key-raspi4-robodrill01-kiosk1` で同一 row の `processingOrder` 反映を確認。
    - `global-rank`（`targetLocation=第2工場&rankingScope=globalShared`）を片側更新 -> 他端末で同順序反映を確認。
- **Troubleshooting**:
  - `global-rank` 手動保存の `reasonCode` は enum 制約があるため、任意文字列を送ると 400 になる。検証時は `reasonCode` 省略または許可コードを使う。
  - ローカル統合テストで `kiosk-production-schedule.integration.test.ts` が全落ちする場合、`localhost:5432` の Postgres 未起動が典型（`pnpm test:api` の起動スクリプト利用）。
  - **上ペインカードが「未設定」のまま増えない（2026-03-23 追記）**: `manual-order-resource-assignments` で資源割当済みでも、同端末に旧 `deviceScopeKey` 行（例: `resourceCd=500`）が残っていると `manual-order-overview` が端末sliceを優先し、`siteKey` 正本（例: `581`）を拾えず `rows: []` になることがある。対策として `manual-order-overview` の資源解決を **割当順 + siteKey 正本優先** に修正し、site に無い場合のみ端末sliceを補助参照する（旧データ削除は不要）。

<a id="manual-order-overview-assigned-resource-sitekey-priority-2026-03-23"></a>

### manual-order-overview 割当資源の siteKey 正本優先（旧 slice 行混在、2026-03-23）

- **Context**: 上記「工場共有同期」とは別コミットで、overview 集約のみを修正。端末に旧 `deviceScopeKey` 行が残ると derived が slice 優先となり、割当済み `siteKey` 正本が `mergeManualOrderOverviewResourcesWithAssignmentOrder` に渡らずカードが空に見える事象があった。
- **Fix（API）**: [`resolveManualOrderOverviewResourcesForAssignedDevice`](../../apps/api/src/services/production-schedule/due-management-manual-order-overview.service.ts) を追加し、割当スロットごとに **site 正本 → 無ければ端末 slice**。単体: [`merge-manual-order-resource-assignments.test.ts`](../../apps/api/src/services/production-schedule/__tests__/merge-manual-order-resource-assignments.test.ts)。
- **Deploy / verify（実績）**: ブランチ **`feat/sitekey-shared-manual-rank-sync`**（siteKey 同期デプロイに続く API 追従デプロイ）。Pi5 → raspberrypi4 → raspi4-robodrill01 のみ（Pi3 除外）、`--limit` 1 台ずつ、`RASPI_SERVER_HOST` + `--foreground`。**Ansible ログ timestamp**: `20260323-113105`（Pi5）/ `20260323-113715`（raspberrypi4）/ `20260323-114137`（raspi4-robodrill01）。**自動実機検証**: `./scripts/deploy/verify-phase12-real.sh` **PASS 28 / WARN 0 / FAIL 0**（2026-03-23、`manual-order-overview` v2・`siteKey` 導出含む）。
- **Troubleshooting**: 割当済みなのに上ペイン行が空に見えるときは `GET .../manual-order-overview?siteKey=<工場>` で当該端末の `resources[]` に正本 `resourceCd` と `rows[]` が載るか確認。旧 `location=...` 行が DB に残っていても本修正後は site 優先で表示される（データ削除不要）。

<a id="production-schedule-filter-dropdown-portal-2026-03-23"></a>

### 生産スケジュール 登録製番・資源CDドロップダウンを Portal 配置（overflow クリップ解消、2026-03-23）

- **Context**:
  - 折りたたみツールバー（[生産スケジュール本体 検索・資源フィルタ帯 ホバー展開](#production-schedule-main-toolbar-hover-2026-03-21)）内で、登録製番・資源CDのドロップダウンパネルが **親の `overflow` で切り取られる**ことがあった。
- **Fix（Web）**:
  - [`AnchoredDropdownPortal.tsx`](../../apps/web/src/components/kiosk/AnchoredDropdownPortal.tsx): `document.body` へ `createPortal` し、`fixed` + アンカー要素の `getBoundingClientRect()` で位置決め（右寄せは `translateX(-100%)`）。外側クリックはアンカーとパネルの両方を考慮。
  - [`ProductionScheduleSeibanFilterDropdown.tsx`](../../apps/web/src/components/kiosk/ProductionScheduleSeibanFilterDropdown.tsx) / [`ProductionScheduleResourceFilterDropdown.tsx`](../../apps/web/src/components/kiosk/ProductionScheduleResourceFilterDropdown.tsx) から利用。API 変更なし。
- **CI / 型**:
  - Docker ビルド（`pnpm run build`）で `RefObject<HTMLDivElement | null>` を `div` の `ref` に渡すと **TS2322**（`LegacyRef` 不一致）になる場合がある。props は `RefObject<HTMLElement>` / `RefObject<HTMLDivElement>`（`null` をジェネリクスに含めない）に揃える（`main`: `4b799762`）。
- **Deploy / verify（実績）**:
  - ブランチ **`main`**。対象は Pi5 → `raspberrypi4` → `raspi4-robodrill01` のみ（Pi3 除外）、[`deployment.md`](../guides/deployment.md) の **1台ずつ順番**（`--limit` 各ホスト、`--detach --follow`、`RASPI_SERVER_HOST` 必須）。
  - **Run ID**: `20260323-131306-17247`（Pi5）/ `20260323-132133-31976`（raspberrypi4）/ `20260323-132555-23983`（raspi4-robodrill01）。
  - **自動実機検証**: `./scripts/deploy/verify-phase12-real.sh` **PASS 28 / WARN 0 / FAIL 0**（2026-03-23）。
- **Troubleshooting**:
  - **CI の web ビルドのみ失敗**（`AnchoredDropdownPortal.tsx` TS2322）: 上記の `RefObject` 型定義を確認。ローカル `pnpm --filter @raspi-system/web build` で再現可能。
  - **見た目の確認**: Phase12 は API・サービス中心のため、ドロップダウンが画面端で切れないことは **実機/VNC** で `/kiosk/production-schedule` を開き、登録製番・資源CDのドロップダウンを展開して確認（自己署名で Mac 直ブラウザが失敗しうる件は [KB-306](../knowledge-base/frontend.md#kb-306-キオスク進捗一覧-製番フィルタドロップダウン端末別保存) と同趣旨）。

<a id="manual-order-overview-card-two-line-header-2026-03-23"></a>

### 手動順番 上ペイン 端末カード2行ヘッダー・全体把握行のホバー格納（2026-03-23）

- **Context**:
  - 端末カード先頭を **1行**（ロケーション · 資源CD · 件数 · 操作）から **2行**にし、**資源名称**（`GET .../resources` の `resourceNameMap`）を2行目に載せたい。
  - 縦スペース確保のため、**カード一覧（空メッセージ含む）にポインタがある間**は [`ManualOrderPaneHeader`](../../apps/web/src/components/kiosk/manualOrder/ManualOrderPaneHeader.tsx)（手動順番見出し・工場選択｜全体把握｜N端末）を畳む。
- **Fix（Web・関心事分離）**:
  - **純関数**: [`manualOrderOverviewCardPresentation.ts`](../../apps/web/src/features/kiosk/manualOrder/manualOrderOverviewCardPresentation.ts)（`joinManualOrderResourceDisplayNames`・Vitest）。
  - **カード**: [`ManualOrderDeviceCardHeaderRow`](../../apps/web/src/components/kiosk/manualOrder/ManualOrderDeviceCardHeaderRow.tsx) — 1行目＝ロケーション＋編集・資源・編集中、2行目＝名称·資源CD·件数（名称はマスタ無しなら省略して CD·件数のみ）。
  - **上ペイン**: [`useToolbarCollapseWhileContentHovered`](../../apps/web/src/hooks/useToolbarCollapseWhileContentHovered.ts) — 下ペインの [`useTimedHoverReveal`](../../apps/web/src/hooks/useTimedHoverReveal.ts)（ホバーで**開く**）とは逆方向のため **別フック**。
  - **API/データ契約**: 変更なし（名称は既存 `resourceNameMap` をページから `resolveResourceDisplayName` 注入）。
- **Deploy / verify（実績）**:
  - ブランチ **`feat/kiosk-manual-order-card-two-line-header-hover-toolbar`**。Pi5 → `raspberrypi4` → `raspi4-robodrill01` のみ（Pi3 除外）、[`deployment.md`](../guides/deployment.md) の **1台ずつ**（`--limit` 各ホスト、`--detach --follow`、`RASPI_SERVER_HOST` 必須）。
  - **Detach Run ID**: `20260323-143949-27009`（Pi5）/ `20260323-144352-15929`（raspberrypi4）/ `20260323-144807-4866`（raspi4-robodrill01）。
  - **コミット（機能）**: `90520568`。
  - **自動実機検証**: `./scripts/deploy/verify-phase12-real.sh` **PASS 28 / WARN 0 / FAIL 0**（2026-03-23）。
- **Troubleshooting**:
  - **工場セレクトに触りたいのにヘッダが畳まれたまま**: カードグリッドからポインタを外す（約 280ms 後にヘッダ再表示）。タッチのみ運用ではホバー格納の恩恵は限定的。
  - **名称が出ない**: `resourceNameMap[cd]` が空のときは仕様どおり2行目は **資源CD·件数**のみ。

## 手動順番 上ペイン SOLID リファクタ（2026-03-20）

- **Context**:
  - 手動順番専用ページの上ペインがコンポーネント肥大しやすく、表示整形とテスト境界を固定したい。
- **Fix（仕様）**:
  - **純関数**: [`apps/web/src/features/kiosk/manualOrder/manualOrderRowPresentation.ts`](../../apps/web/src/features/kiosk/manualOrder/manualOrderRowPresentation.ts) の `presentManualOrderRow`（Vitest）、`ManualOrderOverviewRowBlock`、`ManualOrderPaneHeader`、`ManualOrderSiteToolbar` で JSX と表示ロジックを分離。
  - **API/データ契約**: 変更なし（`manual-order-overview` の `resources[].rows[]` 等は従来どおり）。
- **Deploy / verify（実績）**:
  - ブランチ **`feat/kiosk-manual-order-ui-solid`**。Pi5 → raspberrypi4 → raspi4-robodrill01 のみ（Pi3 除外）、`--limit` 1台ずつ、`--detach --follow`。
  - **Run ID 例**: `20260320-190147-27980`（Pi5）/ `20260320-190559-20664`（raspberrypi4）/ `20260320-191024-14641`（raspi4-robodrill01）。
  - **実機検証**: `./scripts/deploy/verify-phase12-real.sh` **PASS 27 / WARN 0 / FAIL 0**。
- **Troubleshooting**:
  - **`[ERROR] --detach requires RASPI_SERVER_HOST`**: Mac から `--detach` を付けて実行する場合、`RASPI_SERVER_HOST` 未設定で停止する。`export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"` を先に設定（[deployment.md](../guides/deployment.md)「デタッチ実行」、[KB-238](./infrastructure/ansible-deployment.md#kb-238-update-all-clientsshでraspberrypi5対象時にraspi_server_host必須チェックを追加)）。

## 手動順番 overview UI（上端ヘッダーリビール・カード密度・グリッド）（2026-03-21）

- **Context**:
  - 手動順番専用ルートでキオスク最上段メニューを畳みつつ操作領域を確保し、端末カードの情報密度とグリッド列数を調整したい。
- **Fix（仕様）**:
  - **ルート限定ヘッダー**: [`useKioskTopEdgeHeaderReveal`](../../apps/web/src/hooks/useKioskTopEdgeHeaderReveal.ts) と [`KioskLayout`](../../apps/web/src/layouts/KioskLayout.tsx) で **`/kiosk/production-schedule/manual-order` のときのみ** 既定で `KioskLayout` 最上段を非表示。画面上端付近へポインタを寄せるとスライドイン（タッチ専用代替は未実装）。
  - **カード**: `ManualOrderActiveDeviceBanner` を廃止。編集状態は [`ManualOrderDeviceCardHeaderRow`](../../apps/web/src/components/kiosk/manualOrder/ManualOrderDeviceCardHeaderRow.tsx) / [`ManualOrderDeviceCard`](../../apps/web/src/components/kiosk/manualOrder/ManualOrderDeviceCard.tsx) の「編集中」表示とグレーアウトで示す。複数資源時は先頭のみヘッダー1行、2件目以降はブロック内に `資源CD·件数`（全体仕様は本ファイル「手動順番 専用ページ」節の Spec を参照）。
  - **行表示**: [`presentManualOrderRow`](../../apps/web/src/features/kiosk/manualOrder/manualOrderRowPresentation.ts)（純関数・Vitest [`manualOrderRowPresentation.test.ts`](../../apps/web/src/features/kiosk/manualOrder/manualOrderRowPresentation.test.ts)）。
  - **グリッド**: [`ManualOrderOverviewPane`](../../apps/web/src/components/kiosk/manualOrder/ManualOrderOverviewPane.tsx) で `md:grid-cols-4` / `xl:grid-cols-6`。
  - **API**: 変更なし（`manual-order-overview` 契約は従来どおり）。
- **Deploy / verify（実績）**:
  - ブランチ **`feat/kiosk-manual-order-overview-ui`**。
  - Pi5 → raspberrypi4 → raspi4-robodrill01 のみ（Pi3 除外）、`--limit` 1台ずつ（[deployment.md](../guides/deployment.md)）。
  - **Run ID**: `20260321-094548-8867`（Pi5、`--limit server`、既定 detach のため **`./scripts/update-all-clients.sh --attach 20260321-094548-8867`** で完了待機）/ `20260321-095056`（raspberrypi4、`--foreground`）/ `20260321-095528`（raspi4-robodrill01、`--foreground`）。
  - **実機検証**: `./scripts/deploy/verify-phase12-real.sh` **PASS 27 / WARN 0 / FAIL 0**（2026-03-21）。
- **Troubleshooting**:
  - **Pi5 が detach で先に戻る**: Mac から `update-all-clients.sh` は既定でリモート detach。Pi5 実行後は **`--attach <run_id>`** で Ansible 完了を待ってから Pi4 を走らせるか、**`--foreground`** で最初からブロック実行する。
  - **順序**: Web バンドルは Pi5 の Docker `web` に載るため **必ず Pi5 を先**、続けて各 Pi4（`kiosk-browser` 再起動で新バンドルを取得）。

<a id="manual-order-resource-assignment-2026-03-20"></a>

## 手動順番 上ペイン 資源CD割り当て（DB・API・モーダル）（2026-03-20）

- **Context**:
  - device-scope v2 で工場内の各端末カードに、表示する資源CDを **複数・優先順** で明示したい。同一資源は1端末のみ。未設定時は上ペインを「資源未割り当て」とし、下ペインの鉛筆先頭資源は overview の先頭資源に追従させる。
- **Fix（仕様）**:
  - **DB**: `ProductionScheduleManualOrderResourceAssignment`（`csvDashboardId`, `siteKey`, `deviceScopeKey`, `resourceCd`, `priority`）。`@@unique` で **工場内の資源重複禁止**・端末内の順位・資源の一意性を担保。
  - **API**（`KIOSK_MANUAL_ORDER_DEVICE_SCOPE_V2_ENABLED` 時のみ有効、無効時は 404）:
    - `GET /api/kiosk/production-schedule/manual-order-resource-assignments?siteKey=...` → `{ siteKey, assignments: [{ deviceScopeKey, resourceCds[] }] }`
    - `PUT /api/kiosk/production-schedule/manual-order-resource-assignments` → body `{ siteKey, deviceScopeKey, resourceCds[] }`（端末単位の全置換）。他端末が使用中の資源を奪おうとした場合は **`409` / `RESOURCE_ALREADY_ASSIGNED`**。
  - **overview 統合**: [`listDueManagementManualOrderOverviewV2`](../../apps/api/src/services/production-schedule/due-management-manual-order-overview.service.ts) が **登録端末すべて** を `devices[]` に出し、**割当行が無い端末**は `resources: []`（資源未割り当て）。割当がある端末は [`mergeManualOrderOverviewResourcesWithAssignmentOrder`](../../apps/api/src/services/production-schedule/due-management-manual-order-overview.service.ts) で **割当に登録した資源CDのみを割当順で返す**（行なしは空 `rows[]`。割当に無い行集計は `resources[]` に載せない）。**レガシー**（`location === siteKey`）は割当0件のとき従来どおり行データから集計（後方互換）。
  - **Web**: カードヘッダーに **「資源」**（[`ManualOrderResourceAssignmentModal`](../../apps/web/src/components/kiosk/manualOrder/ManualOrderResourceAssignmentModal.tsx)）。候補は既存 `GET .../resources` 相当（ページの `visibleResourceCds`）。保存成功で **assignments + manual-order-overview** を invalidate。
- **Verification**:
  - API: `pnpm --filter @raspi-system/api test -- src/services/production-schedule/__tests__/merge-manual-order-resource-assignments.test.ts`
  - 実機一括: `./scripts/deploy/verify-phase12-real.sh`（v2 分岐で `manual-order-resource-assignments` の `assignments` を検証）
- **Deploy / verify（実績、2026-03-21）**:
  - ブランチ **`feat/manual-order-resource-assignment-ui`**。Pi5 → raspberrypi4 → raspi4-robodrill01 のみ（Pi3 除外）、`--limit` 1台ずつ、`--detach --follow`。
  - **Run ID**: `20260321-111725-4914`（Pi5）/ `20260321-112232-987`（raspberrypi4）/ `20260321-112706-12728`（raspi4-robodrill01）、いずれも success。
  - **実機検証**: `./scripts/deploy/verify-phase12-real.sh` **PASS 28 / WARN 0 / FAIL 0**（`manual-order-resource-assignments` の `assignments` 検証を含む）。
- **Troubleshooting**:
  - **409**: 同じ工場でその資源は既に別端末に割り当て済み。先に相手端末の割り当てを外す。

<a id="manual-order-pane-polish-2026-03-21"></a>

## 手動順番 overview 割当のみ・カードラベル短縮・下ペイン折りたたみ（2026-03-21）

- **Context**:
  - 上ペインに割当 UI に無い資源が載ると運用が紛らわしい。カード先頭の Location 行が工場ドロップダウンと重複し幅を圧迫する。下ペインのツールバー＋資源帯が縦に大きい。
- **Fix（仕様）**:
  - **API**: [`mergeManualOrderOverviewResourcesWithAssignmentOrder`](../../apps/api/src/services/production-schedule/due-management-manual-order-overview.service.ts) は **割当順が1件以上ある端末**では `assignmentOrder` のスロットのみ返し、割当に無い `derived` 資源は **末尾に付けない**。`assignmentOrder` が空のときは関数単体契約として `derived` をそのまま返す（v2 では割当0件端末は呼び出し側で `[]`）。Vitest: `merge-manual-order-resource-assignments.test.ts`。
  - **Web**: [`stripSitePrefixFromDeviceLabel`](../../apps/web/src/features/kiosk/manualOrder/manualOrderDeviceDisplayLabel.ts) で `{siteKey} - ` プレフィックスのみ除去（[`useManualOrderPageController`](../../apps/web/src/features/kiosk/productionSchedule/useManualOrderPageController.ts) に集約）。下ペインのツールバー＋資源帯は [`ManualOrderLowerPaneCollapsibleToolbar`](../../apps/web/src/components/kiosk/manualOrder/ManualOrderLowerPaneCollapsibleToolbar.tsx) で包み、**見た目の開閉は [`useTimedHoverReveal`](../../apps/web/src/hooks/useTimedHoverReveal.ts) の `isVisible` のみ**（絞り込み有無とは独立）。一覧取得の `enabled`・空状態「検索してください」・`showFetching` 等は従来どおり [`hasScheduleFilterQuery`](../../apps/web/src/pages/kiosk/ProductionScheduleManualOrderPage.tsx)（`hasQuery || hasResourceCategoryResourceSelection`）。キオスク最上段は [`useKioskTopEdgeHeaderReveal`](../../apps/web/src/hooks/useKioskTopEdgeHeaderReveal.ts) が同フックを拡張利用。
- **Deploy / verify（実績、2026-03-21）**:
  - ブランチ **`feat/manual-order-pane-assignment-label-toolbar`**（API 割当のみ・ラベル短縮・当時の下ペイン折りたたみ初版）。[deployment.md](../guides/deployment.md) 標準。**対象**: Pi5 → raspberrypi4 → raspi4-robodrill01 のみ（Pi3 除外）、`--limit` 1台ずつ、`export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`、`--detach --follow`。
  - **Run ID**: `20260321-145746-1455`（Pi5）/ `20260321-150253-8405`（raspberrypi4）/ `20260321-150735-6173`（raspi4-robodrill01）、いずれも success。
  - **下ペイン右端ホバー・開閉と絞り込み分離**の本番反映は別ブランチ **`feat/manual-order-lower-pane-toolbar-hover`**（Run ID・Phase12 は [下ペイン帯ホバー節](#manual-order-lower-pane-toolbar-hover-2026-03-21)）。
  - **自動実機検証**: `./scripts/deploy/verify-phase12-real.sh` **PASS 28 / WARN 0 / FAIL 0**（上記各デプロイ後に再実行）。
- **UI（実機/VNC・推奨）**:
  - `/kiosk/production-schedule/manual-order` で上ペイン資源が割当と一致すること、Location 行の工場名重複が無いこと、下ペイン見出し行**右端アイコン**へマウスを乗せて帯が展開し、パネル外に出すと遅延後に折りたたまれることを確認（Phase12 はブラウザを開かない）。絞り込み有無で帯が常時開いたままにならないこと。
- **Troubleshooting**:
  - **下ペイン帯が開かない**: タッチのみ端末ではホバーできない（最上段メニューと同様 **マウス前提**）。**右端のスライダー型アイコン**（十分な hit area）へポインタを載せる。
  - **上ペインに想定外の資源が無い**: 割当モーダルで登録した CD のみが v2 overview に載る。DB に残る割当外の行は下ペイン一覧（別クエリ）で確認。

<a id="manual-order-lower-pane-toolbar-hover-2026-03-21"></a>

## 手動順番 下ペイン ツールバー帯 右端ホバー展開（2026-03-21）

- **Context**:
  - 下ペイン帯の展開を `hasScheduleFilterQuery` と OR すると、絞り込み有効時に常時展開となり上ペイン（ヘッダーはホバーのみ）と挙動が揃わない。細い `h-2` ホットゾーンは実機で発見しづらい。
- **Fix（仕様）**:
  - **Web**: [`ManualOrderLowerPaneCollapsibleToolbar`](../../apps/web/src/components/kiosk/manualOrder/ManualOrderLowerPaneCollapsibleToolbar.tsx) が見出し行（タイトル・ステータス・**右端トリガー**）と `max-height` 折りたたみ枠を担当。子は `children` で注入（SOLID: ページはフック＋業務 UI のみ）。**見た目の開閉**は [`useTimedHoverReveal`](../../apps/web/src/hooks/useTimedHoverReveal.ts) の `isVisible` のみ。`hasScheduleFilterQuery` は [`useKioskProductionSchedule`](../../apps/web/src/pages/kiosk/ProductionScheduleManualOrderPage.tsx) の `enabled`・空状態「検索してください」・`showFetching` 等にのみ使用。Vitest: [`ManualOrderLowerPaneCollapsibleToolbar.test.tsx`](../../apps/web/src/components/kiosk/manualOrder/ManualOrderLowerPaneCollapsibleToolbar.test.tsx)。
- **Deploy / verify（実績、2026-03-21）**:
  - ブランチ **`feat/manual-order-lower-pane-toolbar-hover`**。[deployment.md](../guides/deployment.md) 標準。**対象**: Pi5 → raspberrypi4 → raspi4-robodrill01 のみ（Pi3 除外）、`--limit` 1台ずつ、`export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`、`--detach --follow`。
  - **Run ID**: `20260321-162637-28864`（Pi5）/ `20260321-163112-2184`（raspberrypi4）/ `20260321-163710-15180`（raspi4-robodrill01）、いずれも success。
  - **自動実機検証**: `./scripts/deploy/verify-phase12-real.sh` **PASS 28 / WARN 0 / FAIL 0**（2026-03-21、Mac から実行）。
- **知見**:
  - 製番／資源のドロップダウンがポータルで body 側に出ると、マウスが折りたたみラッパー外に出て **`mouseleave` により帯が閉じうる**。運用上問題になったらコンポーネント境界で遅延クローズ等を最小追加する（実装計画上のリスク）。
- **Troubleshooting**:
  - **帯が開かない**: タッチのみ端末ではホバー不可（最上段メニューと同様 **マウス前提**）。**見出し行右端のスライダー型アイコン**へポインタを載せる。

<a id="production-schedule-main-toolbar-hover-2026-03-21"></a>

## 生産スケジュール本体 検索・資源フィルタ帯 ホバー展開（2026-03-21）

- **Context**:
  - キオスク **生産スケジュール本体**（`/kiosk/production-schedule`、沉浸式 allowlist 対象）は最上段メニューを上端ホバーで出す一方、検索バー＋資源フィルタが常時表示で表示領域を圧迫していた。手動順番下ペインと同様、**ホバーで帯を出す**挙動に揃えたい。
- **Fix（仕様）**:
  - **Web**: [`ProductionSchedulePage.tsx`](../../apps/web/src/pages/kiosk/ProductionSchedulePage.tsx) で [`ManualOrderLowerPaneCollapsibleToolbar`](../../apps/web/src/components/kiosk/manualOrder/ManualOrderLowerPaneCollapsibleToolbar.tsx) に [`ProductionScheduleToolbar`](../../apps/web/src/components/kiosk/ProductionScheduleToolbar.tsx) と [`ProductionScheduleResourceFilters`](../../apps/web/src/components/kiosk/ProductionScheduleResourceFilters.tsx) を包む。**見た目の開閉**は [`useTimedHoverReveal`](../../apps/web/src/hooks/useTimedHoverReveal.ts)。見出し文言は **「検索・資源フィルタ」**。Mac 向け端末選択バー（`macManualOrderV2`）は折りたたみ対象外のまま上段に配置。API 契約・DB 変更なし。
- **E2E / ローカル検証**:
  - 沉浸式ヘッダーと同様、ナビ・サイネージ／電源ボタン操作前に **上端ホバー**が必要。[`revealKioskHeader`](../../e2e/helpers.ts) を [`kiosk.spec.ts`](../../e2e/kiosk.spec.ts) と [`kiosk-smoke.spec.ts`](../../e2e/smoke/kiosk-smoke.spec.ts) で共有。
  - **Playwright（`CI=true`）**: `apps/api/.env` が `NODE_ENV=production` の開発マシンでは **CORS が無効**になり、Web(4173)→API(8080) の **OPTIONS が 404** → 管理画面バックアップ E2E 等が `waitForResponse` タイムアウトしうる。[`playwright.config.ts`](../../playwright.config.ts) の API `webServer.env` に **`NODE_ENV: development`** を明示（子プロセスでは dotenv が既存 env を上書きしない前提で有効）。
  - **Web Vitest**: シェルに **`NODE_ENV=production` が残っている**と React production ビルドとなり `act(...) is not supported in production builds` で大量失敗する → **`NODE_ENV=development`** で `pnpm --filter @raspi-system/web test` を実行。
- **Deploy / verify（実績、2026-03-21）**:
  - ブランチ **`feat/kiosk-production-schedule-collapsible-toolbar`**。[deployment.md](../guides/deployment.md) 標準の `scripts/update-all-clients.sh`。**対象**: Pi5 → raspberrypi4 → raspi4-robodrill01 のみ（**Pi3 除外**）、`--limit` で **1台ずつ順番**。`export RASPI_SERVER_HOST=100.106.158.2`（ホストのみの場合はスクリプトが `denkon5sd02@` を付与する運用に合わせる）。
  - **ログ接頭辞例**: Pi5 `ansible-update-20260321-214954`（以降 Pi4 は連続実行で別ログ）。
  - **自動実機検証**: `./scripts/deploy/verify-phase12-real.sh` **PASS 28 / WARN 0 / FAIL 0**（本変更は API 追加なしのため Phase12 は回帰中心。帯 UI はスクリプト外）。
- **Troubleshooting**:
  - **帯が開かない**: タッチのみでは不可。**「検索・資源フィルタ」行右端のスライダー型アイコン**へマウスを載せる。
  - **ローカル E2E が backup 系でタイムアウト**: Pi5 起動 API の `NODE_ENV` と CORS を確認（上記 `playwright.config.ts`）。

<a id="kiosk-immersive-allowlist-manual-order-row-2026-03-21"></a>

## キオスク沉浸式 allowlist 拡張 + 手動順番上ペイン行（品名を工順直後）（2026-03-21）

- **Context**:
  - 沉浸式（上端ホバーで `KioskLayout` 最上段をリビール）は当初 **手動順番ルートのみ** としていたが、タグ持出・計測/吊具持出・**生産スケジュール本体**・**進捗一覧**でも操作領域を広げたい要望があった。
  - 手動順番上ペインの行表示で、**品名を工順の直後（1行目）**に寄せ、**2行目は機種名のみ**とするレイアウトに変更した（現場の視線移動を減らす）。
- **Fix（仕様）**:
  - **沉浸式の単一判定源**: [`kioskImmersiveLayoutPolicy.ts`](../../apps/web/src/features/kiosk/kioskImmersiveLayoutPolicy.ts) の `usesKioskImmersiveLayout(pathname)`。[`KioskLayout.tsx`](../../apps/web/src/layouts/KioskLayout.tsx) がこれを参照し、該当ルートで `flex` 沉浸式＋上端リビールを有効化。allowlist・除外は [KB-311](./KB-311-kiosk-immersive-header-allowlist.md) を参照。
  - **手動順番行**: [`presentManualOrderRow`](../../apps/web/src/features/kiosk/manualOrder/manualOrderRowPresentation.ts) — **Row A**: 製番·品番·工順·品名（いずれかが空なら省略）、**Row B**: `normalizeMachineName` 適用済みの機種名のみ。Vitest: [`manualOrderRowPresentation.test.ts`](../../apps/web/src/features/kiosk/manualOrder/manualOrderRowPresentation.test.ts)。UI: [`ManualOrderOverviewRowBlock.tsx`](../../apps/web/src/components/kiosk/manualOrder/ManualOrderOverviewRowBlock.tsx)。
  - **E2E**: 沉浸式でヘッダー非表示のままナビを叩くと失敗するため、[`kiosk-smoke.spec.ts`](../../e2e/smoke/kiosk-smoke.spec.ts) に **`revealKioskHeader()`**（上端ホバー相当）を追加。
- **Deploy / verify（実績、2026-03-21）**:
  - ブランチ **`feat/kiosk-immersive-layout-manual-order-row`**。[deployment.md](../guides/deployment.md) 標準。**対象**: Pi5 → raspberrypi4 → raspi4-robodrill01 のみ（**Pi3 除外**・リソース僅少のため Pi3 は専用手順）、`--limit` で **1台ずつ順番**。
  - **Run ID**: `20260321-192700-29456`（Pi5 / server）/ `20260321-193059-19711`（raspberrypi4）/ `20260321-193547-13867`（raspi4-robodrill01）、いずれも success。
  - **自動実機検証**: `./scripts/deploy/verify-phase12-real.sh` **PASS 28 / WARN 0 / FAIL 0**（2026-03-21、Tailscale 経由で実施）。
- **知見**:
  - ルート追加時は **ポリシー＋Vitest** を同時更新しないと、沉浸式の有無がブレる（[KB-311](./KB-311-kiosk-immersive-header-allowlist.md)）。
  - ローカル Web テストで `NODE_ENV=production` が残ると React `act(...)` 警告・失敗が出ることがある → **`NODE_ENV=test`** を明示して `pnpm --filter @raspi-system/web test` を実行。
- **Troubleshooting**:
  - **某画面だけヘッダーが常時出る / 常に隠れる**: `usesKioskImmersiveLayout` の allowlist と pathname（末尾 `/` 正規化）を確認。`/kiosk/production-schedule` は **完全一致**、手動順番・進捗一覧は **接頭辞**。
  - **Phase12 はブラウザを開かない**: allowlist 各 URL の上端リビール・手動順番の Row A/B は **実機または Pi5 経由 VNC** で目視（Mac 直 `https` は自己署名で失敗しやすい → [deploy-status-recovery.md](../runbooks/deploy-status-recovery.md)）。

## 手動順番 overview 密度調整 + 機種名表示修正（2026-03-20）

- **Context**:
  - 手動順番専用ページ上ペインの本文フォントを生産スケジュール一覧（`text-xs`）と揃え、高密度表示を統一したい。
  - 部品行のみ割当のとき、上ペイン行明細で機種名が空になる事象が報告された。
- **Fix（仕様）**:
  - **Web**: [`manualOrderOverviewTypography.ts`](../../apps/web/src/features/kiosk/manualOrder/manualOrderOverviewTypography.ts) に `KIOSK_MANUAL_ORDER_OVERVIEW_BODY_TEXT_CLASS = 'text-xs'` を追加。`ManualOrderDeviceCard` と `ManualOrderOverviewRowBlock` で参照し、本文のみ `text-xs` を適用（カード全体にはかけない）。
  - **API**: [`due-management-manual-order-overview.service.ts`](../../apps/api/src/services/production-schedule/due-management-manual-order-overview.service.ts) で機種名解決を `buildSeibanToMachineName`（割当行のみから MH/SH を探す）から [`fetchSeibanProgressRows`](../../apps/api/src/services/production-schedule/seiban-progress.service.ts) 経由へ変更。CsvDashboardRow 全体から製番単位で機種名を取得し、割当が部品行のみのときも機種名が返るように修正。
- **Deploy / verify（実績）**:
  - ブランチ **`feat/manual-order-overview-density-align`**。Pi5 → raspberrypi4 → raspi4-robodrill01 のみ（Pi3 除外）、`--limit` 1台ずつ、`--detach --follow`。
  - **Run ID 例**: `20260320-201540-12802`（Pi5）/ `20260320-202332-28162`（raspberrypi4）/ `20260320-202831-30296`（raspi4-robodrill01）、いずれも success。
  - **実機検証**: `./scripts/deploy/verify-phase12-real.sh` **PASS 27 / WARN 0 / FAIL 0**。
- **Troubleshooting**:
  - **機種名が空**: 割当行のみから MH/SH を探していた旧実装が原因。`fetchSeibanProgressRows` で製番全体の CsvDashboardRow を参照するよう修正済み。

## 手動順番 下ペイン 鉛筆・工場変更時のフィルタリセット（2026-03-20）

- **Context**:
  - 上ペインで端末（鉛筆）や工場を切り替えたとき、下ペインの絞り込みが残ると誤操作しやすい。
  - 鉛筆選択直後は、当該端末の先頭資源に合わせて一覧を出したい（機種名未入力でも API は `resourceCds` + `resourceCategory` で絞り込み可能）。
- **Fix（仕様）**:
  - **鉛筆**: `selectedOrderNumbers` をクリアし、検索条件を `DEFAULT_SEARCH_CONDITIONS` 相当に戻したうえで、カード先頭資源 `resources[0].resourceCd` を1件選択し、`isGrindingResourceCd` に応じて研削/切削トグルを整合（純関数 `buildConditionsAfterPencilFromFirstResourceCd`）。**登録製番チップの選択（`activeQueries`）だけは直前状態を引き継ぐ**（`mergeManualOrderPencilPreservedSearchFields`）。**ツールバー検索欄の `inputQuery` はベース（空）に戻す**（チップのみ維持するため）。資源0件端末でも同様に `DEFAULT` へ戻しつつ `activeQueries` のみ継承。実装: [`manualOrderLowerPaneSearch.ts`](../../apps/web/src/features/kiosk/productionSchedule/manualOrderLowerPaneSearch.ts)。
  - **工場変更**: 編集端末をクリアしつつ、`resetSearchConditions` + `selectedOrderNumbers` クリア（先頭資源の自動指定はしない）。
  - **一覧取得**: 手動順番ページのみ、`hasQuery` に加え `useProductionScheduleQueryParams` の `hasResourceCategoryResourceSelection`（工程ONかつ資源選択あり）で `useKioskProductionSchedule` を有効化。ツールバー「取得中表示」や「検索してください」も同じ合成条件に合わせる。
  - **不変**: ソートモード（`MANUAL_ORDER_PAGE_SORT_MODE_STORAGE_KEY`）と共有登録製番履歴（`kioskProductionScheduleSharedStorageKeys`）はリセットしない。
- **Deploy / verify（実績、2026-03-20）**:
  - **第1弾（下ペイン初期化のみ）**: ブランチ **`feat/manual-order-pencil-lower-pane-reset`**（コミット例: `cf27935a`）。**対象**: Pi5 + Pi4×2 のみ（Pi3 除外）、[deployment.md](../guides/deployment.md) の **1台ずつ順番**（`export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"` → `--limit "raspberrypi5"` → `raspberrypi4` → `raspi4-robodrill01`、`--detach --follow`）。**Run ID 例**: `20260320-214327-13205`（Pi5）/ `20260320-215018-18468`（raspberrypi4）/ `20260320-215450-29665`（raspi4-robodrill01）、いずれも success。
  - **第2弾（登録製番チップ `activeQueries` 維持の実装反映）**: ブランチ **`feat/manual-order-pencil-preserve-seiban`**。**Run ID**: `20260320-223140-3362`（Pi5）/ `20260320-223518-30451`（raspberrypi4）/ `20260320-223949-27315`（raspi4-robodrill01）、いずれも success。手順は第1弾と同じ（Pi3 除外・1台ずつ）。
  - **自動実機検証**: `./scripts/deploy/verify-phase12-real.sh` **PASS 27 / WARN 0 / FAIL 0**（API・deploy-status・manual-order-overview v2・Pi5 リモート・Pi4/Pi3 サービス・`verify-services-real.sh` まで含むサマリ）。第2弾デプロイ後に再実行して確認。
  - **main 取り込み**: fast-forward、`a6ab547ee4aea70703a133685a348394f6200d12`（2026-03-20）。
- **UI（実機/VNC・推奨）**: Phase12 はブラウザを開かない。鉛筆で端末を切替えたとき、**登録製番チップ選択は維持**され、その他の下ペイン絞り込み（資源・製造order追加・備考/納期トグル・機種名など）は初期化され先頭資源が選ばれること、工場変更で下ペインがクリアされることは、キオスク実機または Pi5 経由 VNC で `/kiosk/production-schedule/manual-order` を開き目視確認する（[deploy-status-recovery.md](../runbooks/deploy-status-recovery.md) の該当行を参照）。
- **Troubleshooting**:
  - **鉛筆後にツールバー検索欄だけ空になる**: 不具合ではなく仕様。`inputQuery` はリセットし、**登録製番チップ（`activeQueries`）のみ**前状態を維持する。
  - **`pnpm -r test` だけでは API 統合テストが DB なしで失敗**: ローカルは `pnpm --filter @raspi-system/web test` と `pnpm test:api`（Docker `postgres-test-local`）に分ける。終了後 `bash scripts/test/stop-postgres.sh` でテスト用コンテナを削除する運用が既存ドキュメントと整合。
  - **機種名なしで先頭資源のみ**: メイン生産スケジュール画面の `hasQuery` は機種名付きの機械スコープ検索を想定しているが、手動順番ページでは `hasResourceCategoryResourceSelection` を追加し API の `resourceCds` + `resourceCategory` と整合させている。一覧が空のときは `activeDeviceScopeKey`・資源0件カード・検索条件を確認。

## 手動順番 専用ページ（キオスク）追加（2026-03-20）

- **Context**:
  - 現場リーダーが「全体把握（端末横断）→下ペイン編集（既存スケジュールUI）」を1画面で行いたい要求が明確化。
  - 既存 `ProductionSchedulePage` の丸ごと複製は責務肥大を招くため、部品再利用で専用ページを追加する方針にした。
- **Fix**:
  - ルート `/kiosk/production-schedule/manual-order` を追加し、ヘッダーに `手動順番` ナビを追加（生産スケジュールと進捗一覧の間）。
  - 上ペインは `site-devices` + `manual-order-overview` を統合し、工場内全端末カードを表示（空カード含む、返却順固定）。
  - 下ペインは既存 `ProductionScheduleToolbar` / `ProductionScheduleResourceFilters` / `ProductionScheduleTable` を再利用。
  - 端末選択はカードの **「編集」** で `targetDeviceScopeKey` を切替、順番変更は既存 `PUT /kiosk/production-schedule/:rowId/order` 契約で即保存。
  - 検索条件は専用 storage key に分離し、既存生産スケジュール画面と干渉しないようにした。
- **UX/State**:
  - 編集中端末は**該当カード**のヘッダー行に「編集中」と **「編集」** ボタンで示す（グローバル帯バナーは廃止）。
  - **沉浸式 allowlist** に含まれるルート（手動順番・進捗一覧・タグ/計測/吊具持出・生産スケジュール本体等。詳細は [KB-311](./KB-311-kiosk-immersive-header-allowlist.md)）では、キオスク最上段メニュー（`KioskLayout` ヘッダー）を既定で非表示にし、マウスを画面上端付近へ寄せるとスライド表示（`useKioskTopEdgeHeaderReveal`）。タッチ専用代替は未実装。
  - **下ペイン**の `ProductionScheduleToolbar` と資源帯は、[`ManualOrderLowerPaneCollapsibleToolbar`](../../apps/web/src/components/kiosk/manualOrder/ManualOrderLowerPaneCollapsibleToolbar.tsx) で **既定折りたたみ**、見出し行**右端ホットゾーン**へマウスを乗せると展開（`useTimedHoverReveal`）。**開閉は絞り込み条件と独立**（一覧取得の有効化は `hasScheduleFilterQuery`）。タッチのみ端末ではホバーできないため帯が畳んだままになりうる（最上段メニューと同様 **マウス前提**）。
  - 非編集中カードは読める程度にグレーアウト。
  - 保存中はカード単位で軽いローディング、失敗はカード強調 + 下ペイン上部バーで通知。
  - 保存成功メッセージは出さず、上ペイン反映でフィードバック。
- **Spec（契約・境界）**:
  - **ルート**: `/kiosk/production-schedule/manual-order`（`App.tsx`）。**ナビ**: `KioskHeader` に「手動順番」（生産スケジュールと進捗一覧の間）。
  - **データ**: 上ペインは `site-devices` + `manual-order-overview` を `useManualOrderPageController` で統合。下ペインは既存 `ProductionScheduleToolbar` / `ProductionScheduleResourceFilters` / `ProductionScheduleTable`。
  - **上辺1行（余白削減）**: `ManualOrderOverviewPane` に `siteToolbar`（手動順番見出し・工場 `<select>`）を渡し、**全体把握**・**N 端末**と同一フレックス行にまとめる（旧2段ヘッダを廃止）。重複していた「端末一覧: N」表記は **N 端末**に一本化。
  - **行表示のプレゼンテーション層（SOLID 寄せ）**: [`manualOrderRowPresentation.ts`](../../apps/web/src/features/kiosk/manualOrder/manualOrderRowPresentation.ts) の `presentManualOrderRow`（純関数・Vitest）。**行ブロックは2行（2026-03-21 更新）**: **Row A**＝製番·品番·**工順·品名**（空は省略）、**Row B**＝**機種名のみ**（[`normalizeMachineName`](../../apps/web/src/features/kiosk/productionSchedule/machineName.ts) で半角大文字）。UI は [`ManualOrderOverviewRowBlock.tsx`](../../apps/web/src/components/kiosk/manualOrder/ManualOrderOverviewRowBlock.tsx)。**端末カード最上段**は [`ManualOrderDeviceCardHeaderRow.tsx`](../../apps/web/src/components/kiosk/manualOrder/ManualOrderDeviceCardHeaderRow.tsx)（Location·先頭資源CD·件数·編集中·編集）。複数資源時は先頭のみヘッダー1行に含め、2件目以降はブロック内に `資源CD·件数` のみ。上ペイン本文の `text-xs` は [`manualOrderOverviewTypography.ts`](../../apps/web/src/features/kiosk/manualOrder/manualOrderOverviewTypography.ts)。**カード Location 行の重複削減**: 選択中工場の `siteKey` と一致する `{siteKey} - ` プレフィックスだけを [`stripSitePrefixFromDeviceLabel`](../../apps/web/src/features/kiosk/manualOrder/manualOrderDeviceDisplayLabel.ts) で除去（[`useManualOrderPageController`](../../apps/web/src/features/kiosk/productionSchedule/useManualOrderPageController.ts) で集約）。グリッド列数は [`ManualOrderOverviewPane.tsx`](../../apps/web/src/components/kiosk/manualOrder/ManualOrderOverviewPane.tsx)（例: `md:grid-cols-4` / `xl:grid-cols-6` でカード幅を圧縮）。パス接頭辞定数は [`kioskManualOrderRoutes.ts`](../../apps/web/src/features/kiosk/manualOrder/kioskManualOrderRoutes.ts)。上ペイン統合ヘッダは [`ManualOrderPaneHeader.tsx`](../../apps/web/src/components/kiosk/manualOrder/ManualOrderPaneHeader.tsx)、工場選択は [`ManualOrderSiteToolbar.tsx`](../../apps/web/src/components/kiosk/manualOrder/ManualOrderSiteToolbar.tsx)。沉浸式 allowlist・上端リビールは [KB-311](./KB-311-kiosk-immersive-header-allowlist.md) / [沉浸式拡張節](#kiosk-immersive-allowlist-manual-order-row-2026-03-21)。
  - **manual-order-overview の行明細 `resources[].rows[]`（2026-03-20）**: 資源 CD ごとに手動順の行を `orderNumber` 昇順で返す。各要素は `fseiban` / `fhincd` / `processLabel`（`ProductionScheduleRowNote.processingType` があれば優先、なければ `FKOJUN`）/ `machineName` / `partName`（API 解決経路は従来どおり上記サービス参照）。キオスク上ペインの**行ブロック表示**は `presentManualOrderRow` により **Row A: 製番·品番·工順·品名**、**Row B: 機種名のみ**（2026-03-21）。空セグメントは省略。**本文フォントは生産スケジュール一覧の `text-xs` と同じ。** `assignedCount` 等の集計は従来どおり。**手動 vs 自動順の差分はキオスク上ペインには表示しない**（デザイン方針）。静的プレビューは実装と乖離しうるため [design-previews](../design-previews/README.md) を参照。
  - **検索条件**: `useProductionScheduleSearchConditionsWithStorageKey` により **専用 localStorage キー**で通常の生産スケジュールページと干渉しない。
  - **登録製番（検索履歴）・search-state（2026-03-19 実装）**:
    - 通常の `ProductionSchedulePage` と同様、`GET/PUT .../kiosk/production-schedule/search-state`（共有ストレージ）と [`useSharedSearchHistory`](../../apps/web/src/features/kiosk/productionSchedule/useSharedSearchHistory.ts) を `ProductionScheduleManualOrderPage` に配線。
    - localStorage の履歴・非表示履歴キーは [`kioskProductionScheduleSharedStorageKeys.ts`](../../apps/web/src/features/kiosk/productionSchedule/kioskProductionScheduleSharedStorageKeys.ts)（`production-schedule-search-history` / `production-schedule-search-history-hidden`）で通常ページと **同一**（検索条件の専用キーとは分離したまま）。
    - `useProductionScheduleMutations` の `isSearchStateWriting` は `useUpdateKioskProductionScheduleSearchState` の `isPending` と整合。
  - **製番ドロップダウンの機種名**: `useKioskProductionScheduleHistoryProgress` の `progressBySeiban` を `ProductionScheduleSeibanFilterDropdown` へ渡す表示と、通常ページを揃える。
  - **保存**: `PUT /api/kiosk/production-schedule/:rowId/order` + `targetDeviceScopeKey`（device-scope v2 前提）。ミューテーションは `useProductionScheduleMutations` の `orderError` / `resetOrderError` でカード／バーに集約。
  - **静的プレビュー**: [docs/design-previews/README.md](../design-previews/README.md)（実装検討用 HTML、本番挙動の代替ではない）。
- **Deploy / verify（実績、2026-03-20）**:
  - **初回（専用ページ本体）**: ブランチ `feature/kiosk-manual-order-page`。[deployment.md](../guides/deployment.md) 標準。**1台ずつ順番**: `--limit "raspberrypi5"` → `--limit "raspberrypi4"` → `--limit "raspi4-robodrill01"`（Pi3 除外）、`--detach --follow`。
  - **追従（登録製番履歴共有 + CI/テスト安定化）**: ブランチ `feat/kiosk-manual-order-shared-search-history`。同じく Pi5 → raspberrypi4 → raspi4-robodrill01 を1台ずつ。**デプロイ Run ID 例**: `20260320-151334-11088`（Pi5）/ `20260320-152207-21899`（raspberrypi4）/ `20260320-152629-30597`（raspi4-robodrill01）、いずれも **exit 0 / success**。
  - **main 反映（overview 行明細 `rows[]` + 上ペイン高密度）**: ブランチ **`main`**（コミット例: `feat(kiosk): manual-order-overview に行明細 rows[] と上ペイン高密度表示`）。**CI**: GitHub Actions 成功（例: Run `23332683133`）。**デプロイ**: 対象 Pi5 + Pi4×2 のみ（Pi3 除外）、**1台ずつ順番**（`raspberrypi5` → `raspberrypi4` → `raspi4-robodrill01`）。**Run ID 例**: `20260320-175411-21044` / `20260320-180217-22594` / `20260320-180649-2465`（いずれも success）。
  - **自動実機検証**: `./scripts/deploy/verify-phase12-real.sh` — **PASS 27 / WARN 0 / FAIL 0**（`manual-order-overview` v2 は `siteKey` 導出付きで検証）。
  - **手動UI**: Phase12 はブラウザの専用ページを見ない。**実機/VNC** で `/kiosk/production-schedule/manual-order` を開き、(1) **最上段メニュー**は上端ホバーで表示できること（沉浸式 allowlist 拡張後は **タグ持出・計測/吊具・生産スケジュール本体・進捗一覧** でも同様。除外例は [KB-311](./KB-311-kiosk-immersive-header-allowlist.md)）、(2) **「編集」**で端末切替・下ペイン編集・保存フィードバック、(3) 登録製番履歴共有・製番ドロップダウン機種名、(4) 上ペイン行が **製番·品番·工順·品名（1行目）/ 機種名のみ（2行目）** であること、を確認（Mac 直ブラウザは自己署名で失敗しやすい → [deploy-status-recovery.md](../runbooks/deploy-status-recovery.md) 注記どおり）。
  - **注記（`rows[]` と空データ）**: device-scope v2 で `manual-order-overview?siteKey=...` の **`resources` が 0 件**のとき、API 上は `rows[]` の中身を検証できない。Phase12 の合格と、手動UIの「表示のみ」で代替可（データあり環境で再確認）。
- **ローカル品質ゲート（開発時）**:
  - `pnpm --filter @raspi-system/web lint` / `build` / `test`（Vitest）。
  - API 統合テスト: `pnpm test:api`（`scripts/test/run-tests.sh`、PostgreSQL `postgres-test-local`。終了後 `scripts/test/stop-postgres.sh` でテスト用コンテナ削除）。
- **Troubleshooting**:
  - **ESLint import/order**: `ProductionScheduleManualOrderPage.tsx` 等で import 順エラー → `eslint --fix` または deployment.md の import グループ規則に合わせる。
  - **型エラー（製番検索モーダル）**: `ProductionOrderSearchModal` は `useProductionOrderSearch` の戻り値（`productNoInput` 等）と props を一致させる（古い prop 名はビルド失敗）。
  - **Phase12 と overview**: device-scope v2 時は無印 `manual-order-overview` が 400 になるのは仕様。スクリプトが `global-rank` から `siteKey` を導出できているか確認（[KB-302](../knowledge-base/ci-cd.md#kb-302-location-scope-resolverのブランド型ciビルド失敗とverify-phase12-realのping失敗) — ping 失敗時は手動 curl 代替）。
  - **`rows[]` が curl で見えない**: `resources` が空のときは `rows[]` も返らない。本番データで手動順の行が存在する端末・サイトで再確認する。
- **main マージ**: ドキュメント反映後、PR 経由で `main` へ統合（運用標準）。

## 切削除外リストで一部資源CDのみ除外される事象（2026-03-16 調査）

- **Context**:
  - キオスク進捗一覧と生産スケジュール設定（切削除外リスト）で、除外指定した資源CDが「一部のみ」反映される報告が継続。
  - Location Scope リファクタ後の運用しやすさは向上したが、切削除外の一貫性は未収束。
- **Symptoms**:
  - 管理画面で除外設定した資源CDが、画面によって除外されたり残ったりする。
  - 資源CDボタン一覧と実際の行データで、除外結果が一致しないケースがある。
- **Investigation**:
  - H1: DB保存値が壊れている  
    - Result: REJECTED（設定値は保存・取得できている）
  - H2: 判定ロジックが経路ごとに分岐し、比較規則が揃っていない  
    - Result: CONFIRMED
  - H3: 資源一覧APIが除外ポリシーを適用していない  
    - Result: CONFIRMED
- **Root cause**:
  - 除外判定の責務が分散し、データソース（静的デフォルト/DB設定）と正規化規則（trimのみ、uppercaseあり/なし）が統一されていない。
  - `GET /api/kiosk/production-schedule/resources` が除外前データを返却し、UI表示との整合が崩れる。
- **Fix plan（最小変更）**:
  - `resource-category-policy` を除外判定の単一入口にする。
  - `resourceCd` 比較を `trim + uppercase` に統一（保存時/読取時/比較時）。
  - `resources` API でも同ポリシーを適用し、ボタン表示と一覧結果の不整合を解消。
  - Web側の固定デフォルト依存を段階的に削減し、API設定値を正に寄せる。
- **Prevention**:
  - 大文字小文字・空白混在・複数除外CDの回帰テストを API/Web 双方に追加する。
  - 「切削除外は policy 経由のみ」の実装規約を維持し、呼び出し側で個別判定を増やさない。
- **References**:
  - `apps/api/src/services/production-schedule/policies/resource-category-policy.service.ts`
  - `apps/api/src/services/production-schedule/production-schedule-query.service.ts`
  - `apps/api/src/services/production-schedule/progress-overview-query.service.ts`
  - `apps/api/src/services/production-schedule/due-management-query.service.ts`
  - `apps/api/src/routes/kiosk/production-schedule/resources.ts`
  - `apps/web/src/features/kiosk/productionSchedule/resourceCategory.ts`

## 切削除外リスト追随修正（policy統一 + resources拡張、2026-03-16 実装）

- **Context**:
  - 管理コンソールで除外資源CDを追加/削除しても、画面経路によって追随しない状態が残っていた。
  - 運用上は「設定変更に自動追随」が必須。
- **Fix**:
  - API policy層に `resourceCd` 正規化（`trim + uppercase`）と除外判定を集約。
  - `production-schedule` / `progress-overview` / `due-management` / `resource-load-estimator` を共通判定へ統一。
  - `GET /api/kiosk/production-schedule/resources` を後方互換で拡張し、`resourceItems[{resourceCd, excluded}]` を追加。
  - Web の資源CDボタンを `resourceItems.excluded` 追随へ変更（静的既定値依存を回避）。
- **Verification**:
  - `pnpm -r lint --max-warnings=0` 成功
  - `pnpm --filter @raspi-system/api build` 成功
  - `pnpm --filter @raspi-system/web build` 成功
  - `pnpm --filter @raspi-system/api test -- src/services/production-schedule/__tests__/resource-category-policy.service.test.ts src/services/production-schedule/__tests__/production-schedule-query.service.test.ts` 成功（13 tests）
  - 補足: `pnpm --filter @raspi-system/api test` 全件はローカルDB未起動（`localhost:5432`）で統合テスト失敗。DB起動後に再実行が必要。
- **Prevention**:
  - 除外判定の新規実装は policy ヘルパー経由のみとし、呼び出し側の重複判定を禁止。
  - resources API は後方互換のまま拡張を継続し、段階移行を可能にする。
- **References**:
  - `apps/api/src/services/production-schedule/policies/resource-category-policy.service.ts`
  - `apps/api/src/services/production-schedule/production-schedule-query.service.ts`
  - `apps/api/src/routes/kiosk/production-schedule/resources.ts`
  - `apps/web/src/pages/kiosk/ProductionSchedulePage.tsx`

## 除外資源CD Location整合化（site優先 + shared互換、2026-03-16 実装）

- **Context**:
  - 実機で `KUMITATE2` が除外されず、`resources` API でも `excluded=false` が返る事象を再確認。
  - DB設定は `location=shared` に存在する一方、キオスク参照は `deviceScopeKey -> siteKey(第2工場)` に解決され、site側設定行が無いとデフォルト除外（`10`,`MSZ`）へフォールバックしていた。
- **Fix**:
  - `resource-category-policy` を `siteKey` 優先参照 + `shared` フォールバックに拡張。
  - `production-schedule-settings` の ResourceCategory 保存を `siteKey` + `shared` 二重保存（Tx）へ変更し、移行期間の整合性を担保。
  - ResourceCategory 取得も `siteKey` 優先 + `shared` フォールバックに統一。
- **Verification**:
  - `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/borrow_return pnpm --filter @raspi-system/api exec prisma migrate deploy` 成功
  - `pnpm --filter @raspi-system/api test -- src/services/production-schedule/__tests__/resource-category-policy.service.test.ts src/services/production-schedule/__tests__/production-schedule-settings.service.test.ts src/routes/__tests__/kiosk-production-schedule.integration.test.ts` 成功（61 tests）
  - `pnpm --filter @raspi-system/api build` 成功
  - `pnpm --filter @raspi-system/api lint` 成功
  - テスト用コンテナは `pnpm test:postgres:stop` で削除済み
  - 実機はデプロイ後に [deploy-status-recovery.md](../runbooks/deploy-status-recovery.md) のチェックリスト（`resources` の `resourceItems.excluded` / `progress-overview` での非表示）で最終確認
- **Prevention**:
  - ResourceCategory の参照は policy 経由に限定し、呼び出し側で location 解決を重複実装しない。
  - `siteKey` 行未作成の既存環境でも `shared` 互換で動作を維持し、段階的に site 正規へ移行する。
- **デプロイ結果（2026-03-16）**:
  - Pi5: Run ID 20260316-174822-31959、state success。
  - raspi4-robodrill01: Run ID 20260316-175659-32118、state success。
  - raspberrypi4（研削メイン）: 初回はプリフライトで SSH 接続タイムアウト（UNREACHABLE）のため未デプロイ。接続復旧後に `--limit "raspberrypi4"` で再デプロイし**デプロイ済み**（3台完了）。
- **実機検証**: OK。Pi5・raspi4-robodrill01 にて KUMITATE2 が除外され進捗一覧に表示されないこと、`GET /api/kiosk/production-schedule/resources` の `resourceItems[].excluded` が期待どおりであることを確認。
- **トラブルシュート（Pi4 研削メインがデプロイ時に接続不可の場合）**:
  - 症状: `ssh: connect to host 100.74.144.79 port 22: Connection timed out`、プリフライトで raspberrypi4 が UNREACHABLE。
  - 確認: Pi5 上で `tailscale status` で raspberrypi4 の online/offline と IP を確認。電源・ネットワーク（Tailscale）の状態を確認。必要なら `group_vars/all.yml` の `tailscale_network.kiosk_ip`（または該当 Pi4 の `ansible_host`）が現状の Tailscale IP と一致しているか確認。
  - 復旧後: `./scripts/update-all-clients.sh feat/resource-exclusion-policy-sync infrastructure/ansible/inventory.yml --limit "raspberrypi4" --detach --follow` で再デプロイ。
- **References**:
  - `apps/api/src/services/production-schedule/policies/resource-category-policy.service.ts`
  - `apps/api/src/services/production-schedule/production-schedule-settings.service.ts`
  - `apps/api/src/services/production-schedule/__tests__/production-schedule-settings.service.test.ts`
  - `apps/api/src/routes/__tests__/kiosk-production-schedule.integration.test.ts`
  - [deployment.md](../guides/deployment.md)（1台ずつ順番デプロイ）
  - [deploy-status-recovery.md](../runbooks/deploy-status-recovery.md)（実機検証チェックリスト）

## 生産スケジュール 機種名・部品名検索（2026-03-17）

- **仕様（A条件）**:
  - 機種名で絞るには「機種名」＋「工程（研削/切削）」＋「資源CD」の3つを指定する（AND条件）。
  - API: `GET /api/kiosk/production-schedule?resourceCategory=grinding&resourceCds=305&machineName=サーボストッパ` 等で 200 かつ該当製番のみ返却。
  - UI: 生産スケジュール画面で機種名ドロップダウン→工程と資源CDを選択→検索で該当機種の製番・部品のみ表示。
- **正規化（全角/半角）**:
  - フロント: `useProductionScheduleQueryParams.ts` で API 送信時に `toHalfWidthAscii(selectedMachineName.trim()).toUpperCase()` で正規化。
  - API: `production-schedule-query.service.ts` で `normalizeMachineNameForCompare` を追加。機種行（MH/SH）を取得して Node 側で正規化比較し、一致する FSEIBAN で IN 条件を組み立てる。
- **トラブルシュート（機種名検索が効かない）**:
  - 症状: 機種名を指定しても結果が0件または期待と異なる。
  - 原因: 実機API検証で全角/半角の不一致が判明。CSV由来の機種名とUI入力の正規化が揃っていなかった。
  - 対策: 上記のフロント・API両方の正規化を導入して解消。
- **トラブルシュート（機種名・部品名ドロップダウンが空になる）**:
  - 症状: API で `machineName` 絞り込みをすると MH/SH 行が返らず、クライアントの「機種→製番」インデックスが空になり、全件除外されて一覧が空になる。
  - 原因: 機種名指定時はAPIが該当製番の行のみ返すため、機種名を持つMH/SH行が結果に含まれず、ドロップダウン用の機種一覧が構築できない。
  - 対策: `displayRowDerivation.ts` の `filterRowsByMachineAndPart` にオプション `skipMachineFilterIfNoIndexHit: true` を追加。インデックス未ヒット時は機種名の再絞り込みをスキップし、API が返した行をそのまま表示。`useProductionScheduleDerivedRows.ts` からそのオプションを渡す。
- **実機検証（2026-03-17）**:
  - API: `machineName` 付き・なしとも 200 で応答することを確認。実機では production-schedule データが 0 件のため、絞り込み結果件数はデータあり環境で別途確認。
  - Phase12 一括検証（`verify-phase12-real.sh`）は全24項目 PASS。
- **References**:
  - `apps/api/src/services/production-schedule/production-schedule-query.service.ts`（`normalizeMachineNameForCompare`）
  - `apps/web/src/features/kiosk/productionSchedule/useProductionScheduleQueryParams.ts`（`toHalfWidthAscii`）
  - `apps/web/src/features/kiosk/productionSchedule/displayRowDerivation.ts`（`skipMachineFilterIfNoIndexHit`）
  - [deploy-status-recovery.md](../runbooks/deploy-status-recovery.md)（生産スケジュール 機種名検索チェック項目）

## Location Scope Phase1（挙動不変の境界導入、2026-03-14）

- **背景**:
  - `location` が「業務ロケーション」「端末別設定キー」「shared参照キー」で混在し、機能追加時に誤適用リスクが高かった。
  - 既存挙動を壊さずに段階移行するため、先に境界のみ導入する必要があった。
- **実装**:
  - `apps/api/src/lib/location-scope-resolver.ts` を追加し、用途別 resolver を実装。
    - `resolveDeviceScopeKey`
    - `resolveSiteKey`
    - `resolveDeviceName`
    - `resolveInfraHost`
    - `resolveCredentialIdentity`
    - `resolveLocationScopeContext`
  - `apps/api/src/routes/kiosk/shared.ts` の `resolveLocationKey` は互換ラッパーとして維持（挙動不変）。
  - `apps/api/src/routes/kiosk/production-schedule/shared.ts` に用途別 resolver 依存を追加し、次フェーズで差し替え可能な境界を明示。
- **検証**:
  - resolver 単体テストを追加（`apps/api/src/lib/__tests__/location-scope-resolver.test.ts`）。
  - 既存 API 契約・既存データ互換を維持（DBスキーマ変更なし）。
- **成果**:
  - `location` の意味をコード上で分離できる足場を構築。
  - Phase2 以降で `device/site/shared` の個別移行が可能になった。

## Location Scope Phase2（siteスコープ正規化の段階移行、2026-03-15）

- **仕様決定**:
  - `ProductionScheduleResourceCategoryConfig` は site スコープを正規とする（ADR-20260315）。
  - `legacyLocationKey` / `deviceScopeKey` が入力された場合も内部で site に正規化して参照する。
- **実装**:
  - `resource-category-policy.service.ts`
    - `resolveResourceCategorySiteKey()` を追加し、`siteKey` 優先で解決。
    - `getResourceCategoryPolicy()` は `string | { siteKey, deviceScopeKey, legacyLocationKey }` を受け取り、互換維持で段階移行可能にした。
  - `production-schedule-settings.service.ts`
    - ResourceCategory 設定の read/write は `resolveSiteKeyFromScopeKey()` で site 正規化して保存・参照。
  - ルート層（段階移行）
    - `list.ts` / `progress-overview.ts` / `due-management-seiban.ts` で `resolveLocationScopeContext()` を利用し、`deviceScopeKey` を明示利用。
  - 管理画面文言
    - `ProductionScheduleSettingsPage` で「拠点共通設定(site)」と「端末別設定(device)」を明示し、誤設定を抑止。
- **検証**:
  - resolver/policy テスト追加:
    - `location-scope-resolver.test.ts`
    - `resource-category-policy.service.test.ts`
  - `@raspi-system/api` 対象テスト、api/web lint、api/web build を通過。
- **実機検証（2026-03-15）**:
  - デプロイ: `feat/location-scope-phase2-migration`、Pi5 → raspberrypi4 → raspi4-robodrill01 の順に1台ずつ実行。
  - リモート自動チェック: APIヘルス、deploy-status（両Pi4で `isMaintenance: false`）、キオスクAPI、納期管理API（triage/summary/global-rank/actual-hours/stats/progress-overview/proposal）、resource-categories（401認証必須）、サイネージAPI、backup.json、マイグレーション52件適用済み、Pi4/Pi3サービス稼働を確認。全項目合格。
- **トラブルシューティング**:
  - `due-management-query.service.ts` への追加置換は、編集ツールの一時エラー（`SQLITE_CORRUPT`）を回避するため、今回は互換レイヤー（policy側の内部正規化）で挙動を担保した。次回差分で同ファイルの明示引数化を継続する。

## Location Scope Phase3（scope契約統一 + Flag段階切替、2026-03-15）

- **仕様決定**:
  - `production-schedule` 系ルートは `resolveLocationScopeContext()` 経由を必須化し、サービス層へ `deviceScopeKey` を明示入力する。
  - `LOCATION_SCOPE_PHASE3_ENABLED` により、`legacyLocationKey` 優先経路と `deviceScopeKey` 優先経路を切替可能にする。
- **実装**:
  - `due-management-location-scope-adapter.service.ts` を追加し、`string` 入力と `scopeContext` 入力の互換アダプタを導入。
  - `due-management-summary` / `due-management-seiban` / `due-management-triage` / `due-management-global-rank` など主要ルートを scopeContext 経由へ統一。
  - `due-management-triage.service.ts` / `due-management-scoring.service.ts` / `due-management-learning-evaluator.service.ts` に `locationScope` 互換入力を追加。
  - 設定系: `env.ts` / `.env.example` / `docker.env.j2` / `inventory.yml` に `LOCATION_SCOPE_PHASE3_ENABLED`（`location_scope_phase3_enabled`）を追加。
- **検証**:
  - `pnpm --filter @raspi-system/api lint`: pass
  - `pnpm --filter @raspi-system/api build`: pass
  - `pnpm --filter @raspi-system/api test -- src/services/production-schedule/__tests__/due-management-location-scope-adapter.service.test.ts src/services/production-schedule/__tests__/due-management-triage.service.test.ts src/services/production-schedule/__tests__/due-management-scoring.service.test.ts src/services/production-schedule/__tests__/due-management-learning-evaluator.service.test.ts`: pass
  - `pnpm --filter @raspi-system/web lint`: pass
  - `pnpm --filter @raspi-system/web build`: pass
  - `./scripts/deploy/verify-services-real.sh`: pass（Pi3 `signage-lite.service`/`signage-lite-update.timer` active、Pi4 `kiosk-browser.service` active）
- **既知事項**:
  - フル `pnpm --filter @raspi-system/api test` はローカルDB (`localhost:5432`) 非起動により backup系テストで失敗するため、実機検証前にDB起動状態で再実施が必要。

- **実機検証（2026-03-15）**:
  - **デプロイ**: `feat/location-scope-phase3-completion`、Pi5 → raspberrypi4 → raspi4-robodrill01 の順に1台ずつ実行（Run ID `20260315-123857-22423` / `20260315-124840-2507` / `20260315-125820-7779`）、約45分、Pi3除外。
  - **リモート自動チェック**: APIヘルス（status: ok）、deploy-status（両Pi4で `isMaintenance: false`）、キオスクAPI（loans/active 200）、納期管理API（triage/daily-plan/global-rank/proposal/learning-report/actual-hours/stats/summary すべて200）、サイネージAPI（layoutConfig 含む）、backup.json（15KB）、マイグレーション52件適用済み、Pi4×2サービス（kiosk-browser/status-agent.timer ともに active）を確認。全項目合格。
  - **Feature Flag**: `location_scope_phase3_enabled` は 2026-03-15 に `true` へ切替済み（`feat/location-scope-phase3-enable`）。
  - **参照**: [deploy-status-recovery.md](../runbooks/deploy-status-recovery.md) の実機検証チェックリスト

- **Phase3有効化デプロイ（2026-03-15）**:
  - **ブランチ**: `feat/location-scope-phase3-enable`
  - **変更**: `infrastructure/ansible/inventory.yml` の `location_scope_phase3_enabled` を `"true"` に変更
  - **デプロイ**: Pi5 → raspberrypi4 → raspi4-robodrill01 の順に1台ずつ実行（Run ID `20260315-134146-15083` / `20260315-134456-14921` / `20260315-135231-9809`）
  - **実機検証**: APIヘルス（`status: ok`）、deploy-status（両Pi4で `isMaintenance: false`）、キオスクAPI（`/api/tools/loans/active` 200）、納期管理API（triage/daily-plan/global-rank/proposal/learning-report/actual-hours/stats/summary すべて200）、global-rank の `targetLocation` / `actorLocation` / `rankingScope`、actual-hours/stats の `totalRawRows` / `totalCanonicalRows` / `totalFeatureKeys` / `topFeatures`、サイネージAPI（`layoutConfig` あり）、backup.json（14522 bytes）、マイグレーション52件 up to date、`LOCATION_SCOPE_PHASE3_ENABLED=true`（APIコンテナ）、両Pi4サービス（`kiosk-browser.service` / `status-agent.timer`）active を確認。

## Location Scope Phase4（due-management限定: scope契約明示 + legacy依存縮小、2026-03-15）

- **背景**:
  - Phase3有効化後、due-management 内では `locationKey` 直渡しと `locationScope` 入力が混在していた。
  - 破壊的変更を避けるため、DB契約は維持したまま「ルート境界でscope化 → サービス層でstorage解決」に統一した。
- **実装**:
  - `due-management-location-scope-adapter.service.ts` に `DueManagementScope` と `toDueManagementScope` / `toDueManagementScopeFromContext` を追加。
  - `due-management-global-rank` ルートで scope 変換を明示し、`auto-generate` / `proposal` / `learning-report` / `explanation` の呼び出しを scope入力へ統一。
  - `due-management-triage.service.ts` / `due-management-scoring.service.ts` / `due-management-learning-evaluator.service.ts` / `due-management-global-rank-auto.service.ts` を scope契約優先に更新。
  - `due-management-summary.ts` / `due-management-seiban.ts` / `due-management-triage.ts` のルート境界で `toDueManagementScopeFromContext` を適用。
  - auto-tuning オーケストレータと学習レポートテストを新契約に追随。
- **検証**:
  - `pnpm --filter @raspi-system/api lint`: pass
  - `pnpm --filter @raspi-system/api test -- src/services/production-schedule/__tests__/due-management-location-scope-adapter.service.test.ts src/services/production-schedule/__tests__/due-management-triage.service.test.ts src/services/production-schedule/__tests__/due-management-scoring.service.test.ts src/services/production-schedule/__tests__/due-management-learning-evaluator.service.test.ts`: pass
  - `pnpm --filter @raspi-system/api build`: pass
  - `pnpm --filter @raspi-system/web lint`: pass
  - `pnpm --filter @raspi-system/web build`: pass
- **デプロイ**:
  - ブランチ: `feat/location-scope-phase4-due-mgmt-legacy-retire`
  - Pi5 → raspberrypi4 → raspi4-robodrill01 の順に1台ずつ実行（Run ID `20260315-142550-21730` / `20260315-143257-13000` / `20260315-144526-7518`）
- **実機検証**:
  - APIヘルス（`status: ok`）
  - deploy-status（両Pi4で `isMaintenance: false`）
  - キオスクAPI（`/api/tools/loans/active` 200）
  - 納期管理API（triage/daily-plan/global-rank/proposal/learning-report/actual-hours/stats/summary/seiban すべて200）
  - global-rank の `targetLocation` / `actorLocation` / `rankingScope` 返却
  - actual-hours/stats の `totalRawRows` / `totalCanonicalRows` / `totalFeatureKeys` / `topFeatures` 返却
  - サイネージAPI（`/api/signage/content` 200、`layoutConfig` あり）
  - backup.json（14522 bytes）
  - マイグレーション（52件、up to date）
  - `LOCATION_SCOPE_PHASE3_ENABLED=true`（APIコンテナ）
  - Pi3/Pi4サービス（signage-lite / kiosk-browser / status-agent.timer）active


## Location Scope Phase5（due-management内の残存legacy配線整理、2026-03-15）

- **背景**:
  - Phase4 で scope 契約は導入済みだが、due-management の一部ルートに `deviceScopeKey` 直取りと未使用 legacy 注入配線が残っていた。
  - 破壊的変更を避けるため、互換解決は adapter に集約したまま、ルート境界の解決方式を統一した。
- **実装**:
  - `due-management-due-date.ts` / `due-management-note.ts` / `due-management-part-priorities.ts` / `due-management-processing.ts` / `due-management-processing-due-date.ts` / `due-management-actual-hours.ts` / `due-management-triage.ts` で `toDueManagementScopeFromContext()` + `resolveDueManagementStorageLocationKey()` を適用。
  - `KioskRouteDeps`（production-schedule shared）から未使用の `resolveLocationKey` 契約を削除。
  - `kiosk.ts` の production-schedule deps 注入から未使用 `resolveLocationKey` を削除。
- **検証**:
  - `pnpm --filter @raspi-system/api lint`: pass
  - `pnpm --filter @raspi-system/api test -- src/services/production-schedule/__tests__/due-management-location-scope-adapter.service.test.ts src/services/production-schedule/__tests__/due-management-triage.service.test.ts src/services/production-schedule/__tests__/due-management-scoring.service.test.ts src/services/production-schedule/__tests__/due-management-learning-evaluator.service.test.ts`: pass
  - `pnpm --filter @raspi-system/api build`: pass
  - `pnpm --filter @raspi-system/web lint`: pass
  - `pnpm --filter @raspi-system/web build`: pass
- **デプロイ**:
  - ブランチ: `feat/location-scope-phase5-due-mgmt-legacy-wire-cleanup`
  - Pi5 → raspberrypi4 → raspi4-robodrill01 の順に1台ずつ実行（Run ID `20260315-150720-6176` / `20260315-151510-9116` / `20260315-152306-24125`）
- **実機検証**:
  - APIヘルス（`status: degraded`、memory 使用率 95.7% の既知警告）
  - deploy-status（両Pi4で `isMaintenance: false`）
  - キオスクAPI（`/api/tools/loans/active` 200）
  - 納期管理API（triage/daily-plan/global-rank/proposal/learning-report/actual-hours/stats/summary/seiban すべて200）
  - global-rank の `targetLocation` / `actorLocation` / `rankingScope` 返却
  - actual-hours/stats の `totalRawRows` / `totalCanonicalRows` / `totalFeatureKeys` / `topFeatures` 返却
  - サイネージAPI（`/api/signage/content` 200、`layoutConfig` あり）
  - backup.json（14522 bytes）
  - マイグレーション（52件、up to date）
  - `LOCATION_SCOPE_PHASE3_ENABLED=true`（APIコンテナ）
  - Pi3/Pi4サービス（signage-lite / kiosk-browser / status-agent.timer）active

## Location Scope Phase10（compat内部限定化、2026-03-15）

- **背景**:
  - Phase9 で `kiosk/shared.ts` 側の互換公開整理は完了したが、`location-scope-resolver.ts` には互換コンテキストを返す公開シンボルが残っていた。
  - 公開境界を標準契約（`StandardLocationScopeContext`）へ固定し、互換情報を内部実装へ閉じ込める必要があった。
- **実装**:
  - `apps/api/src/lib/location-scope-resolver.ts`
    - `CompatLocationScopeContext` を非公開型へ変更（module内部限定）。
    - `resolveCompatLocationScopeContext()` を非公開関数へ変更し、互換解決を内部ヘルパー化。
    - `resolveStandardLocationScopeContext()` を追加し、標準契約の解決責務を分離。
    - 公開API `resolveLocationScopeContext()` は標準契約のみ返却し、`legacyLocationKey` を外部へ露出しない設計を維持。
  - `apps/api/src/lib/__tests__/location-scope-resolver.test.ts`
    - 互換公開関数の直接テストを削除。
    - 標準コンテキストに `legacyLocationKey` が含まれないことを検証する回帰テストへ更新。
- **検証**:
  - `pnpm --filter @raspi-system/api lint`: pass
  - `pnpm --filter @raspi-system/api test -- src/lib/__tests__/location-scope-resolver.test.ts src/services/production-schedule/__tests__/resource-category-policy.service.test.ts src/services/production-schedule/__tests__/due-management-location-scope-adapter.service.test.ts src/services/production-schedule/__tests__/due-management-triage.service.test.ts src/services/production-schedule/__tests__/due-management-scoring.service.test.ts src/services/production-schedule/__tests__/due-management-learning-evaluator.service.test.ts`: pass
  - `pnpm --filter @raspi-system/api build`: pass
  - `pnpm --filter @raspi-system/web lint`: pass
  - `pnpm --filter @raspi-system/web build`: pass
- **デプロイ（2026-03-15）**:
  - 対象: Pi5 + Pi4×2（raspberrypi4 / raspi4-robodrill01）。Pi3は影響なしのため対象外。
  - 手順: `scripts/update-all-clients.sh` で1台ずつ順番に実行（`--limit`）。
  - Run ID: `20260315-202628-23734`（Pi5）/ `20260315-203512-15802`（raspberrypi4）/ `20260315-204257-10897`（raspi4-robodrill01）
  - 所要時間: Pi5 約6分、raspberrypi4 約5分、raspi4-robodrill01 約5分
- **実機検証（2026-03-15）**:
  - リモート自動チェック全項目合格（APIヘルス degraded/memory 96%、deploy-status両Pi4、キオスクAPI、納期管理API群、global-rank targetLocation/rankingScope、Mac向け targetLocation 指定、actual-hours/stats、サイネージAPI、backup.json 15KB、マイグレーション52件、Pi3 signage-lite、Pi4×2 kiosk-browser/status-agent active）
- **知見**:
  - 互換ロジックを削除せず内部化する場合、公開関数を標準契約へ固定しつつ内部ヘルパーへ委譲する構成にすると、互換性を維持しながら責務分離（SRP）を進めやすい。
  - `kiosk/shared.ts` から互換再公開を行わない方針を継続することで、呼び出し側依存を標準契約へ収束できる。
  - デプロイ対象が複数台の場合は1台ずつ順番に実行する運用が安定（deployment.md の「1台ずつ順番デプロイ」を参照）。

## Location Scope 安全実装フォローアップ（Phase0-4、2026-03-15）

- **目的**:
  - Phase10 完了後の追加リファクタを「破壊なし」で進めるため、用語固定・境界単一化・移行監視を先行で整備する。
- **実装**:
  - `kiosk/production-schedule` 依存注入は `resolveLocationScopeContext` を単一入口として扱い、未使用の resolver 依存を削減。
  - `due-management-query.service.ts` の `getResourceCategoryPolicy()` 呼び出しを文字列直渡しから scope 形式（`{ deviceScopeKey }`）へ変更。
  - `resource-category-policy.service.ts` に `resolveResourceCategorySiteResolution()` を追加し、`siteKey` 解決経路（`siteKey` / `deviceScopeKey` / `default`）を返却可能化。
  - `siteKey` も `deviceScopeKey` も解決できない場合のみ `Resource category policy resolved via default fallback` を warning ログ出力し、例外検知として監視可能化。
- **運用**:
  - `deploy-status-recovery.md` のチェックリストに fallback 監視コマンドを追加し、`default fallback` 警告の増加を検知できるようにした。
- **意思決定（Phase4）**:
  - `ClientDevice.location` の即時廃止は見送り（No-Go）。
  - 既存互換を維持しつつ、resolver境界 + 監視で段階移行を継続する方針を採用。
  - 詳細は `ADR-20260315-location-scope-phase4-db-go-no-go.md` を参照。
- **デプロイ（2026-03-15）**:
  - ブランチ: `refactor/location-scope-safe-rollout-phase0-4`
  - 対象: Pi5 + Pi4×2（raspberrypi4 / raspi4-robodrill01）。Pi3は影響なしのため対象外。
  - 手順: `scripts/update-all-clients.sh` で1台ずつ順番に実行（`--limit`）。
  - Run ID: `20260315-212002-22974`（Pi5）/ `20260315-212725-14571`（raspberrypi4）/ `20260315-213409-8036`（raspi4-robodrill01）
- **実機検証（2026-03-15）**:
  - リモート自動チェック全項目合格（APIヘルス ok、deploy-status両Pi4 false、キオスクAPI・納期管理API群 200、global-rank targetLocation/rankingScope、Mac向け targetLocation 指定、actual-hours/stats、location scope fallback該当ログなし、サイネージAPI、backup.json 15K、マイグレーション52件、Pi3 signage + Pi4×2 kiosk/status-agent active、`verify-services-real.sh` 合格）
- **知見**:
  - Pi5に`rg`（ripgrep）は未導入のため、fallback 監視コマンドは`grep`を使用する（deploy-status-recovery.md に追記済み）

## Location Scope Phase11（完全収束、2026-03-15）

- **背景**:
  - Phase0-4 で境界整理と監視導入は完了したが、`resource-category-policy` と `due-management` の入力契約に `string` 互換が残り、境界契約が広い状態だった。
  - resolver も標準契約を返しつつ内部で compat コンテキスト経由になっており、責務が不必要に分散していた。
- **実装**:
  - `apps/api/src/services/production-schedule/policies/resource-category-policy.service.ts`
    - `getResourceCategoryPolicy()` / `resolveResourceCategorySiteResolution()` の入力を `ResourceCategoryPolicyScope` に固定（`string` 互換を排除）。
    - fallback ログを `default` のみで出力する仕様へ変更（warning）。
  - `apps/api/src/services/production-schedule/due-management-location-scope-adapter.service.ts`
    - `DueManagementLocationScopeInput` をオブジェクト契約（`deviceScopeKey` / `siteKey`）へ固定。
  - `apps/api/src/lib/location-scope-resolver.ts`
    - `resolveLocationScopeContext()` を compat 非依存の標準解決へ単純化。
  - `apps/api/src/routes/kiosk/production-schedule/shared.ts`
    - ルート依存の `ClientDeviceForScopeResolution` / `LocationScopeContext` を重複定義せず、`kiosk/shared` の型を利用する構成へ統一。
  - `apps/api/src/routes/kiosk/production-schedule/due-management-global-rank.ts`
    - `toDueManagementScopeFromContext()` 優先の呼び出しへ統一。
- **検証**:
  - `pnpm --filter @raspi-system/api lint`: pass
  - `pnpm --filter @raspi-system/api test -- src/lib/__tests__/location-scope-resolver.test.ts src/services/production-schedule/__tests__/resource-category-policy.service.test.ts src/services/production-schedule/__tests__/due-management-location-scope-adapter.service.test.ts src/services/production-schedule/__tests__/due-management-triage.service.test.ts src/services/production-schedule/__tests__/due-management-scoring.service.test.ts src/services/production-schedule/__tests__/due-management-learning-evaluator.service.test.ts`: pass
  - `pnpm --filter @raspi-system/api build`: pass
  - `pnpm --filter @raspi-system/web lint`: pass
  - `pnpm --filter @raspi-system/web build`: pass
- **デプロイ（2026-03-15）**:
  - 対象: Pi5 + Pi4×2（raspberrypi4 / raspi4-robodrill01）。Pi3は影響なしのため対象外。
  - 手順: `scripts/update-all-clients.sh` で1台ずつ順番に実行（`--limit`）。
  - Run ID: `20260315-223311-18659`（Pi5）/ `20260315-224040-6371`（raspberrypi4）/ `20260315-224829-13694`（raspi4-robodrill01）
- **実機検証（2026-03-15）**:
  - リモート自動チェック全項目合格（APIヘルス ok、deploy-status両Pi4 false、キオスクAPI・納期管理API群 200、global-rank targetLocation/rankingScope、Mac向け targetLocation 指定、actual-hours/stats、location scope fallback該当ログなし、サイネージAPI、backup.json 15K、マイグレーション52件、Pi3 signage + Pi4×2 kiosk/status-agent active、`verify-services-real.sh` 合格、PUT auto-generate 200）。
  - 監視コマンドは `default fallback` 警告ログを対象に更新（Pi5に`rg`は未導入のため`grep`を使用）。
- **知見**:
  - 互換入力を段階縮退する場合、**公開関数の入力契約を先に固定**し、互換は private ヘルパーへ閉じ込めると回帰範囲を限定しやすい。
  - Due management auto-tuning scheduler ログ（`Due management auto-tuning scheduler started`）は API 起動後ローテーションでコンテナログから見つからない場合がある。PUT auto-generate が 200 を返せば機能は正常と判断可能。
- **参照**: [deploy-status-recovery.md](../runbooks/deploy-status-recovery.md)

## Location Scope Phase12（完全体化、2026-03-16）

- **背景**:
  - Phase11 で契約収束は完了したが、運用面（再現検証、命名規約、横展開監査、UI最終確認記録）が分散していた。
- **実装**:
  - `scripts/deploy/verify-phase12-real.sh` を追加し、実機検証の主要API・fallback監視・`PUT /global-rank/auto-generate`・Pi3/Pi4サービス確認を1コマンド化。
  - `docs/guides/location-scope-naming.md` を新設し、`siteKey` / `deviceScopeKey` / `infraHost` の命名規約を固定。
  - `docs/plans/location-scope-phase12-cross-module-audit.md` を追加し、`production-schedule` ルート境界の命名監査結果を記録。
  - `apps/api/src/routes/kiosk/production-schedule/*.ts` のローカル変数命名を `locationKey` から `deviceScopeKey` 明示へ統一（サービス契約は不変）。
- **検証**:
  - `./scripts/deploy/verify-phase12-real.sh`: PASS 23 / WARN 1 / FAIL 0
  - WARN内容: `Due management auto-tuning scheduler started` ログは0件（ログローテーション想定）。`PUT /global-rank/auto-generate` 200 を代替正常判定として記録。
- **UI最終確認（手動項目）**:
  - 本作業ではリモート自動検証のみ実施。以下のUI手動項目は **現地実機での最終確認待ち** として記録:
    - 納期管理新UI（V2）
    - 納期管理UI Phase1/Phase2/Phase3
    - 左ペイン中規模改善（対象化/対象中導線）
    - 左ペイン3セクション色分け
    - 表面処理別納期の最終オペレーション確認
  - 手順は `deploy-status-recovery.md` セクション3に統一。
- **知見**:
  - 手動UI検証を除く運用検証は `verify-phase12-real.sh` で再現可能になった。
  - 境界変数名は `deviceScopeKey` / `siteKey` を使い、`locationKey` は既存サービス契約への橋渡し時のみ使用する方針が有効。

## Location Scope Phase13（安全リファクタ、2026-03-16）

- **背景**:
  - Phase12 のフォローアップとして、互換橋渡しを境界に集約し、`locationKey` 文字列再解釈の再発を防止する必要があった。
- **実装**:
  - `location-scope-resolver.ts`: 境界型（`SiteKey` / `DeviceScopeKey` / `DeviceName` / `InfraHost`）を明示化。`resolveStandardLocationScopeContext` で `asSiteKey` / `asDeviceName` によるブランド型キャストを追加。
  - `production-schedule/shared.ts`: `toLegacyLocationKeyFromDeviceScope()` を追加し、ルート境界で橋渡しを集約。
  - `production-schedule/*.ts`: 各ルートで `toLegacyLocationKeyFromDeviceScope(deviceScopeKey)` 経由に統一。
  - `shared.test.ts`: dedup と bridge ヘルパーの回帰テストを追加。
  - resource-category / due-management / ranking-scope にスコープ（site/device）のコメント・型を追加。
- **検証**:
  - CI: 初回は `resolveStandardLocationScopeContext` の `string` → ブランド型代入で型エラー。`asSiteKey` / `asDeviceName` で修正後 success。
  - デプロイ: Pi5 → raspberrypi4 → raspi4-robodrill01 の順に1台ずつ実行（Run ID `20260316-113951-26071` / `20260316-114704-25137` / `20260316-115552-26872`）。
- **実機検証**:
  - `verify-phase12-real.sh` は先頭の `ping` 判定で「Pi5に到達できません」と停止（ICMP ブロック環境）。runbook の curl/ssh 項目を手動実行して代替検証。
  - APIヘルス ok、deploy-status 両Pi4 false、キオスクAPI・納期管理API群 200、global-rank/actual-hours/stats、fallback 0件、PUT auto-generate 200、Pi3/Pi4 サービス active。
- **トラブルシューティング**: [KB-302](../knowledge-base/ci-cd.md#kb-302-location-scope-resolverのブランド型ciビルド失敗とverify-phase12-realのping失敗)

## Location Scope Phase9（compat呼び出し棚卸し・公開面縮小、2026-03-15）

- **背景**:
  - Phase8 で標準契約と互換契約の分離は完了したが、`kiosk/shared.ts` には未使用の互換公開面（`resolveLocationKey` / `resolveCompatLocationScopeContext`）が残っていた。
  - `csv-import-execution.service.ts` には別責務の同名関数 `resolveLocationKey` があり、保守時に誤読しやすい状態だった。
- **実装**:
  - `apps/api/src/routes/kiosk/shared.ts`
    - 未使用の互換公開 `resolveLocationKey` / `resolveCompatLocationScopeContext` を削除。
    - `CompatLocationScopeContext` の再エクスポートを削除し、標準契約中心の公開面へ整理。
  - `apps/api/src/services/imports/csv-import-execution.service.ts`
    - ローカル関数 `resolveLocationKey` を `resolveImportMetadataLocationKey` へ改名（機能変更なし）。
- **検証**:
  - `pnpm --filter @raspi-system/api lint`: pass
  - `pnpm --filter @raspi-system/api test -- src/lib/__tests__/location-scope-resolver.test.ts src/services/production-schedule/__tests__/resource-category-policy.service.test.ts src/services/production-schedule/__tests__/due-management-location-scope-adapter.service.test.ts src/services/production-schedule/__tests__/due-management-triage.service.test.ts src/services/production-schedule/__tests__/due-management-scoring.service.test.ts src/services/production-schedule/__tests__/due-management-learning-evaluator.service.test.ts`: pass
  - `pnpm --filter @raspi-system/api build`: pass
  - `pnpm --filter @raspi-system/web lint`: pass
  - `pnpm --filter @raspi-system/web build`: pass
- **受け入れ確認（Runbookチェック）**:
  - APIヘルス（`status: degraded`、memory 95.4% の既知警告）
  - deploy-status（raspberrypi4 / raspi4-robodrill01 ともに `isMaintenance:false`）
  - 納期管理API（triage / daily-plan / global-rank / proposal / learning-report / actual-hours/stats 200）
  - Mac向けシナリオ確認: `global-rank?targetLocation=%E7%AC%AC2%E5%B7%A5%E5%A0%B4&rankingScope=globalShared` で応答整合
  - サイネージAPI（`/api/signage/content` 200、`layoutConfig` あり）
  - backup.json（15KB）存在、マイグレーション（52件、up to date）
  - Pi3/Pi4サービス確認（`verify-services-real.sh` + 個別systemctl で active）
- **デプロイ（2026-03-15）**:
  - 対象: Pi5 + Pi4×2（raspberrypi4 / raspi4-robodrill01）。Pi3は影響なしのため対象外。
  - 手順: `scripts/update-all-clients.sh` で1台ずつ順番に実行（`--limit`）。
  - Run ID: `20260315-184658-22375`（Pi5）/ `20260315-185604-21505`（raspberrypi4）/ `20260315-190338-11172`（raspi4-robodrill01）
  - 所要時間: Pi5 約7分、raspberrypi4 約6分、raspi4-robodrill01 約5分
- **実機検証（2026-03-15）**:
  - チェックリスト全14項目合格（APIヘルス、deploy-status両Pi4、キオスクAPI、納期管理API群、global-rank targetLocation/rankingScope、Mac向け targetLocation 指定、actual-hours/stats、サイネージAPI、backup.json、マイグレーション、Pi3 signage-lite、Pi4×2 kiosk-browser/status-agent active）
- **知見**:
  - デプロイ対象が複数台の場合は1台ずつ順番に実行する運用が安定（deployment.md の「1台ずつ順番デプロイ」を参照）
  - 実機検証は `docs/runbooks/deploy-status-recovery.md` のチェックリストに従い、API・サービス・マイグレーションを網羅的に確認する

## Location Scope Phase8（resolver互換境界の明示化、2026-03-15）

- **背景**:
  - Phase7 で `production-schedule` 境界の契約整理は完了したが、基盤側 resolver には `legacyLocationKey` を含む公開型が残っていた。
  - ルート/サービスを標準契約へ依存させつつ、互換情報は専用レイヤーへ閉じ込める必要があった。
- **実装**:
  - `apps/api/src/lib/location-scope-resolver.ts`
    - `StandardLocationScopeContext`（標準契約）と `CompatLocationScopeContext`（互換契約）を追加。
    - `resolveLocationScopeContext()` は標準契約（`deviceScopeKey/siteKey/deviceName/infraHost/credentialIdentity`）のみ返却するよう変更。
    - `resolveCompatLocationScopeContext()` を新設し、`legacyLocationKey` は互換契約側でのみ返却。
  - `apps/api/src/routes/kiosk/shared.ts`
    - 標準契約の既定公開を維持しつつ、互換関数 `resolveCompatLocationScopeContext()` を明示公開。
  - `apps/api/src/lib/__tests__/location-scope-resolver.test.ts`
    - 標準契約テストへ更新し、互換契約テストを追加。
- **検証**:
  - `pnpm --filter @raspi-system/api lint`: pass
  - `pnpm --filter @raspi-system/api test -- src/lib/__tests__/location-scope-resolver.test.ts src/services/production-schedule/__tests__/resource-category-policy.service.test.ts src/services/production-schedule/__tests__/due-management-location-scope-adapter.service.test.ts src/services/production-schedule/__tests__/due-management-triage.service.test.ts src/services/production-schedule/__tests__/due-management-scoring.service.test.ts src/services/production-schedule/__tests__/due-management-learning-evaluator.service.test.ts`: pass
  - `pnpm --filter @raspi-system/api build`: pass
  - `pnpm --filter @raspi-system/web lint`: pass
  - `pnpm --filter @raspi-system/web build`: pass
- **デプロイ**:
  - ブランチ: `feat/location-scope-phase8-resolver-compat-boundary`
  - Pi5 → raspberrypi4 → raspi4-robodrill01 の順に1台ずつ実行（Run ID `20260315-175908-9572` / `20260315-180808-10083` / `20260315-181456-29949`）
- **実機検証**:
  - APIヘルス（`status: ok`、memory warning 94.7%）
  - deploy-status（raspberrypi4 / raspi4-robodrill01 ともに `isMaintenance:false`）
  - 納期管理API（triage / daily-plan / global-rank / proposal / learning-report / actual-hours/stats 200）
  - Mac向けシナリオ確認: `global-rank?targetLocation=第2工場&rankingScope=globalShared` は **URLエンコード付き** クエリで `targetLocation` / `actorLocation` / `rankingScope` 応答を確認
  - サイネージAPI（`/api/signage/content` 200、`layoutConfig` あり）
  - Pi3/Pi4サービス確認（`verify-services-real.sh` + 個別systemctl で active）
  - マイグレーション（52件、up to date）
- **トラブルシューティング**:
  - ターミナルで日本語クエリ文字列を未エンコードのまま `curl` すると 400 になるケースがある。  
    `targetLocation=%E7%AC%AC2%E5%B7%A5%E5%A0%B4` のようにURLエンコードして実行する。

## Location Scope Phase7（production-schedule境界のscope契約整理、2026-03-15）

- **背景**:
  - Phase6 で due-management adapter の legacy補助経路は整理できたが、`production-schedule` 境界には `legacyLocationKey` を含む型互換が一部残っていた。
  - 次段として、API境界の契約を `deviceScopeKey` / `siteKey` 中心へ寄せ、Mac/Pi3 を含む受け入れ条件で回帰確認する。
- **実装**:
  - `apps/api/src/routes/kiosk/production-schedule/shared.ts`
    - `LocationScopeContext` から `legacyLocationKey` を除外し、`production-schedule` ルート契約を `deviceScopeKey/siteKey` 中心へ整理。
  - `apps/api/src/services/production-schedule/policies/resource-category-policy.service.ts`
    - `ResourceCategoryPolicyScope` から `legacyLocationKey` を削除。
    - `resolveResourceCategorySiteKey()` の legacy fallback 分岐を削除し、`siteKey -> deviceScopeKey -> default` の順へ明確化。
- **検証**:
  - `pnpm --filter @raspi-system/api lint`: pass
  - `pnpm --filter @raspi-system/api test -- src/services/production-schedule/__tests__/resource-category-policy.service.test.ts src/services/production-schedule/__tests__/due-management-location-scope-adapter.service.test.ts src/services/production-schedule/__tests__/due-management-triage.service.test.ts src/services/production-schedule/__tests__/due-management-scoring.service.test.ts src/services/production-schedule/__tests__/due-management-learning-evaluator.service.test.ts`: pass
  - `pnpm --filter @raspi-system/api build`: pass
  - `pnpm --filter @raspi-system/web lint`: pass
  - `pnpm --filter @raspi-system/web build`: pass
- **デプロイ**:
  - ブランチ: `feat/location-scope-phase7-api-scope-harmonize`
  - Pi5 → raspberrypi4 → raspi4-robodrill01 の順に1台ずつ実行（Run ID `20260315-172516-21463` / `20260315-173234-4410` / `20260315-173936-23557`）
- **実機検証**:
  - APIヘルス（`status: ok`、memory warning 92.8%）
  - deploy-status（raspberrypi4 / raspi4-robodrill01 ともに `isMaintenance:false`）
  - 納期管理API（summary/triage/global-rank 200）
  - Mac向けシナリオ確認: `global-rank?targetLocation=第2工場&rankingScope=globalShared` で `targetLocation` / `actorLocation` / `rankingScope` 返却
  - サイネージAPI（`/api/signage/content` 200、`layoutConfig` あり）
  - `verify-services-real.sh` で Pi3 signage-lite/service timer と Pi4 kiosk-browser を確認（active）
  - マイグレーション（52件、up to date）
  - APIコンテナ環境変数: `LOCATION_SCOPE_PHASE3_ENABLED=UNSET`
- **トラブルシューティング**:
  - Pi5ホスト上で `apps/api` 直下から `pnpm prisma migrate status` を実行すると `db:5432` 到達不可（`P1001`）になる。  
    実機検証では `docker compose ... exec -T api pnpm prisma migrate status` を使う。

## Location Scope Phase6（adapter内legacy補助経路廃止、2026-03-15）

- **背景**:
  - Phase5 時点で due-management のルート境界統一は完了したが、adapter 内には `legacyLocationKey` 補助経路と `LOCATION_SCOPE_PHASE3_ENABLED` 分岐が残っていた。
  - Phase3/4/5 の実機運用で `deviceScopeKey` 経路が安定したため、互換のためだけに残していた分岐を段階廃止した。
- **実装**:
  - `due-management-location-scope-adapter.service.ts`
    - `DueManagementLocationScopeInput` / `DueManagementScopeContextInput` / `ResolvedDueManagementLocationScope` から `legacyLocationKey` を削除。
    - `resolveDueManagementStorageLocationKey()` を `deviceScopeKey` 固定返却へ変更。
    - `isLocationScopePhase3Enabled()` を削除し、フラグ依存を除去。
  - `due-management-location-scope-adapter.service.test.ts`
    - 期待値を新契約（device/siteのみ）へ更新。
    - Phase3フラグON/OFF分岐テストを削除し、「常にdeviceScopeKeyを使う」テストへ集約。
  - 設定配線整理:
    - `env.ts` / `.env.example` / `docker.env.j2` / `inventory.yml` から `LOCATION_SCOPE_PHASE3_ENABLED`（`location_scope_phase3_enabled`）を削除。
- **検証**:
  - `pnpm --filter @raspi-system/api lint`: pass
  - `pnpm --filter @raspi-system/api test -- src/services/production-schedule/__tests__/due-management-location-scope-adapter.service.test.ts src/services/production-schedule/__tests__/due-management-triage.service.test.ts src/services/production-schedule/__tests__/due-management-scoring.service.test.ts src/services/production-schedule/__tests__/due-management-learning-evaluator.service.test.ts`: pass
  - `pnpm --filter @raspi-system/api build`: pass
  - `pnpm --filter @raspi-system/web lint`: pass
  - `pnpm --filter @raspi-system/web build`: pass
  - 補足: フル `pnpm --filter @raspi-system/api test` はローカルDB未起動時に backup系テストで失敗（既知）
- **デプロイ**:
  - ブランチ: `feat/location-scope-phase6-adapter-legacy-retire`
  - Pi5 → raspberrypi4 → raspi4-robodrill01 の順に1台ずつ実行（Run ID `20260315-164754-9966` / `20260315-165800-14681` / `20260315-170453-7369`）
- **実機検証**:
  - APIヘルス（`status: ok`、memory warning 87.7%）
  - deploy-status（`isMaintenance: false`）
  - 納期管理API（summary/triage 200）
  - サイネージAPI（`/api/signage/content` 200）
  - backup.json（14522 bytes）
  - マイグレーション（52件、up to date）
  - Pi4サービス（`kiosk-browser.service` / `status-agent.timer` active）
  - APIコンテナ環境変数: `ACTUAL_HOURS_SHARED_FALLBACK_ENABLED=true` / `LOCATION_SCOPE_PHASE3_ENABLED=UNSET`


## 進捗一覧復活（2026-03-15）

- **背景**: Location Scope Phase1 と同一ブランチ（`refactor/location-scope-boundary-phase1`）で、`feat/kiosk-progress-overview` の進捗一覧を最小差分で復元した。
- **復元元**: `feat/kiosk-progress-overview` の最新コミット `b5f5a57c`（4列化・除外CD反映・ホバー・納期色分けを含む）。
- **実装**:
  - API: `GET /api/kiosk/production-schedule/progress-overview`、`ProgressOverviewQueryService`（切削除外適用後、有効資源CDを持たない部品を非表示、製番カード内を納期昇順ソート）
  - Web: `ProductionScheduleProgressOverviewPage`（4列レイアウト xl以上、資源CDホバー resourceNames、納期超過時は日付赤字・ラベル黄色）
  - キオスクヘッダーに「進捗一覧」リンクを追加
- **デプロイ**: Pi5 → raspberrypi4 → raspi4-robodrill01 の順に1台ずつ実行（Run ID `20260315-101803-4865` / `20260315-102542-16017` / `20260315-103331-6156`）、約20分。
- **実機検証**: APIヘルス、deploy-status（両Pi4で `isMaintenance: false`）、キオスクヘッダーから進捗一覧画面への遷移・表示を確認。
- **トラブルシューティング**:
  - **Docker 再起動後**: Cursor サンドボックス経由で `pnpm test:api` 実行時に Docker ソケット EOF が発生することがある。Mac 上で Docker を再起動後、ターミナルから直接実行すれば正常に動作する。
  - **postgres-test-local 競合**: 既存コンテナが残っている場合は `docker rm -f postgres-test-local` で削除してから再実行。

## 進捗一覧製番フィルタ（2026-03-18）

- **背景**: 進捗一覧で製番単位の表示/非表示を切り替えられるよう、製番フィルタドロップダウンを追加。
- **実装**: 手動更新ボタン左に「製番フィルタ (n/m)」ドロップダウン。候補は `scheduled` 製番のみ、製番＋機種名を複数列表示。ON/OFFでカード表示を絞り込み、全OFF時は「フィルタで非表示にしています」を表示。状態は `localStorage`（`kiosk-progress-overview-seiban-filter`、schemaVersion付き）で端末別保存。`useProgressOverviewSeibanFilter` フック、`ProgressOverviewSeibanFilterDropdown` コンポーネントを新設。
- **デプロイ**: ブランチ `feat/kiosk-progress-overview-seiban-filter-dropdown`、Pi5 → raspberrypi4 → raspi4-robodrill01 の順に1台ずつ実行。
- **実機検証**: Phase12 全24項目PASS（`verify-phase12-real.sh` に progress-overview API チェックを追加）、実機UIで製番フィルタ・永続化を確認OK。詳細は [KB-306](../frontend.md#kb-306-キオスク進捗一覧-製番フィルタドロップダウン端末別保存) / [deploy-status-recovery.md](../runbooks/deploy-status-recovery.md) を参照。

<a id="progress-overview-five-cols-layout-2026-03-22"></a>

## 進捗一覧 5列グリッド・「納期」「実」ラベル削除・presentation 分割（2026-03-22）

- **Context**:
  - 進捗一覧（`/kiosk/production-schedule/progress-overview`）で、カード内の黄色ラベル「納期」「実」が横方向を圧迫していた。広い画面では **1行あたり5カード**（`xl:grid-cols-5`）にし、ラベルを外して日付・資源CDチップのみ表示する。
- **Fix（仕様）**:
  - **Web のみ**（API 不変）。[`ProductionScheduleProgressOverviewPage.tsx`](../../apps/web/src/pages/kiosk/ProductionScheduleProgressOverviewPage.tsx) は取得・フィルタ・空状態・グリッド枠のみ。カード・行は [`ProgressOverviewSeibanCard.tsx`](../../apps/web/src/components/kiosk/progressOverview/ProgressOverviewSeibanCard.tsx) / [`ProgressOverviewPartRow.tsx`](../../apps/web/src/components/kiosk/progressOverview/ProgressOverviewPartRow.tsx)。純関数・GRID 定数は [`progressOverviewPresentation.ts`](../../apps/web/src/features/kiosk/productionSchedule/progressOverviewPresentation.ts)（`PROGRESS_OVERVIEW_CARD_GRID_CLASS` 等）。
  - 部品名列・資源CD列に **`min-w-0`**（狭いカードでも折り返しが効くように）。納期列は **`w-[84px] whitespace-nowrap`** のまま。資源CDは **`flex`** で全件表示・**`flex-wrap`** で段数制限なし。
- **Deploy / verify（実績、2026-03-22）**:
  - **初回デプロイ（機能ブランチ）**: **`feat/kiosk-progress-overview-five-cols-layout`**。[deployment.md](../guides/deployment.md) 標準の `scripts/update-all-clients.sh`。**対象**: Pi5 → raspberrypi4 のみ成功。**Run ID（ログ接頭辞）**: Pi5 `ansible-update-20260322-084633-25240`、raspberrypi4 `ansible-update-20260322-085040-1342`。**raspi4-robodrill01** は当時 SSH タイムアウトのため **未デプロイ**。
  - **本番追従（`main`・3台順次）**: 通信復旧後、`main` を Pi5 → raspberrypi4 → raspi4-robodrill01 のみ（**Pi3 除外**）・`--limit` 1台ずつ・`RASPI_SERVER_HOST`・`--detach --follow`。**Run ID**: `20260322-212809-1338`（Pi5）/ `20260322-213031-27169`（raspberrypi4）/ `20260322-213507-5127`（raspi4-robodrill01）、いずれも success。
  - **自動実機検証**: `./scripts/deploy/verify-phase12-real.sh` **PASS 27 / WARN 1 / FAIL 0**（2026-03-22）。**WARN**: auto-tuning scheduler ログ件数 0（スクリプト上 PUT auto-generate=200 を代替判定）。進捗一覧 API・両 Pi4・Pi3 signage・`verify-services-real.sh` は **PASS**。
  - **Phase12 冒頭の Pi5 到達判定（知見・TS）**: 旧実装は **`ping -c 1 -W 2`** のみ。Tailscale で RTT が大きいと **ICMP が偶発失敗**し、「Pi5に到達できません」で **verify-phase12-real.sh** または **`verify-services-real.sh`** だけが落ちることがある（API/SSH は成功しているのに失敗する場合は本件を疑う）。**対策（実装済み）**: `verify-phase12-real.sh` / `verify-services-real.sh` で **短い再試行**（最大5回・各 `ping -c 1 -W 5`・間隔1秒）。
- **ローカルテスト（知見）**:
  - `pnpm test:api` はシェルに **`NODE_ENV=production` が残る**と JWT Zod が本番強度を要求し失敗しうる → **`NODE_ENV=test`** を付与。
  - `scripts/test/run-tests.sh` が **5432 利用ありと判断して `POSTGRES_PORT=55432`** に切り替える一方、既存 **`postgres-test-local` が 5432** のときは **`POSTGRES_PORT=5432` を明示**すると接続一致する。
- **Troubleshooting**:
  - **RoboDrill01 に SSH 不能**: Tailscale・電源・ケーブル・`inventory` の `ansible_host` を確認。復旧後に **単体 `--limit "raspi4-robodrill01"`** でデプロイし、`verify-phase12-real.sh` を再実行。
  - **Phase12 が「Pi5に到達できません」だけ失敗**: 上記 **ICMP 再試行** 前のスクリプトでは再現しうる。最新の `verify-phase12-real.sh` / `verify-services-real.sh` を使うか、しばらく待って再実行。TCP（`curl`/`ssh`）は通るが ping だけ落ちる場合は本件と整合。

## デプロイ・実機検証（2026-03-07）

- **デプロイ**: Run ID `20260307-093857-20934`、`state: success`、約15分（Pi5+Pi4×2、`--limit "server:kiosk"`）
- **実機検証結果**:
  - APIヘルス: 200 OK / `status: ok`
  - Prismaマイグレーション: 36件適用済み、スキーマ最新
  - キオスクAPI: `/api/tools/loans/active`（両Pi4）200、`/api/kiosk/production-schedule` 200、`/api/kiosk/production-schedule/due-management/summary` 200
  - deploy-status: `GET /api/system/deploy-status` に `x-client-key` 付与で `isMaintenance: false`
  - Pi4サービス: raspberrypi4・raspi4-robodrill01 ともに kiosk-browser.service / status-agent.timer が active

## 追加実装デプロイ・実機検証（2026-03-07）

- **デプロイ**: Run ID `20260307-110456-19744`、`state: success`、約12分30秒（Pi5+Pi4×2、`--limit "server:kiosk"`）
- **実機検証結果**:
  - APIヘルス: 200 OK / `status: degraded`（メモリ94%、既知の環境要因）
  - Prismaマイグレーション: 37件適用済み、スキーマ最新
  - キオスクAPI: `/api/tools/loans/active` 200、`/api/kiosk/production-schedule` 200、`/api/kiosk/production-schedule/due-management/summary` 200
  - 新機能API: `/api/kiosk/production-schedule/processing-type-options` 200（LSLH/カニゼン/塗装/その他01/その他02）、`/api/kiosk/production-schedule/search-state` 200（history連携）
  - due-management seiban detail: `machineName`・`parts[].processes[]`（resourceCd, resourceNames, isCompleted）・`completedProcessCount`/`totalProcessCount` を確認
  - deploy-status: 両Pi4で `isMaintenance: false`
  - Pi4サービス: raspberrypi4・raspi4-robodrill01 ともに kiosk-browser.service / status-agent.timer が active
  - backup.json: 存在・15K
  - サイネージAPI: `/api/signage/content` layoutConfig 正常

## FSIGENマスタ導入・実機検証（2026-03-11）

- **デプロイ**: Pi5 → raspberrypi4 → raspi4-robodrill01 の順で1台ずつ成功
- **FSIGENマスタ投入**: 本番DBは既存Employee等でシード競合のため、dataSIGEN.csvをSQLで直接投入（125件）
- **API検証**:
  - `GET /api/system/health`: 200 OK / `status: ok`
  - `GET /api/kiosk/production-schedule/resources`: 200、`resourceNameMap` に資源CD→日本語名のマッピング確認（例: `"501":["東芝MPE-2130"]`, `"500":["5軸加工機","5軸加工機（Vertex)"]`）
- **手動確認項目**（Tailscale接続可能な端末から）:
  - 生産スケジュール画面: 資源CDボタンにホバーで日本語名（title/aria-label）が表示されること
  - 納期管理画面: 工程カードの資源CDにホバーで日本語名が表示されること
- **実機検証結果**: OK（両画面で `title` 属性による標準ツールチップでホバー表示を確認済み）
- **トラブルシューティング**:
  - **本番DBで `pnpm prisma db seed` 失敗**: 既存EmployeeのNFC UID等他シードと競合し、seed全体が失敗。FSIGENマスタ（`ProductionScheduleResourceMaster`）は `dataSIGEN.csv` をSQLで直接投入して対応（125件）。類似事例は [KB-203](../infrastructure/ansible-deployment.md#kb-203-本番環境でのprisma-db-seed失敗と直接sql更新) 参照。
  - **ローカル統合テスト**: DB未起動時は `docker run` でPostgreSQL（例: postgres-test-local）を起動してから `kiosk-production-schedule.integration.test.ts` を実行。
- **知見**: 同一 `seed.ts` 内で複数テーブルを投入する場合、既存データとの競合に注意。本番DBは既存データありのため、新規マスタ追加はSQL直接投入で柔軟に対応可能。ホバー表示は `title` 属性で標準ツールチップが動作し、追加ライブラリ不要。

## GroupCDマスタ統合とCSV一括登録（2026-03-07）

- **目的**: 実績基準時間（`actualPerPieceMinutes`）のヒット率向上のため、資源CDを `GroupCD` で束ねて `strict -> mapped -> grouped` の順で探索できるようにする。
- **DB拡張**:
  - `ProductionScheduleResourceMaster.groupCd`（nullable）を追加。
  - マイグレーション: `20260312103000_add_resource_master_group_cd`
  - `prisma/seed.ts` を拡張し、`dataSIGEN.csv` の `GroupCD` 列を取り込み可能化。
- **ワンショット投入**:
  - `pnpm --filter @raspi-system/api import:resource-groupcd -- <csv-path>` を追加。
  - `FSIGENCD` / `GroupCD` を読み、該当 `resourceCd` の `groupCd` を更新（CP932自動判定あり）。
- **管理コンソールCSV一括登録**:
  - `POST /api/production-schedule-settings/resource-code-mappings/import-csv`
  - 入力: `location`, `csvText`, `dryRun`
  - 出力: `totalRows`, `rowsWithGroupCd`, `generatedMappings`, `skipped*`, `skippedUnknownResourceCds`
  - 動作: `FSIGENCD + GroupCD` から同一Group内マッピングを自動生成し、`dryRun=false` で既存設定を一括置換。
- **Resolver拡張**:
  - `ActualHoursFeatureResolver` を `strict -> mapped -> grouped` へ拡張。
  - `grouped` は `resourceMaster.groupCd` 由来の候補資源CDを使って解決（DBアクセスはQuery層で完結、resolverは純粋ロジック維持）。
- **検証**:
  - `actual-hours-feature-resolver.service.test.ts` に grouped 経路を追加。
  - `production-schedule-query.service.test.ts` に GroupCD経由解決ケースを追加。
  - `pnpm --filter @raspi-system/api build`
  - `pnpm --filter @raspi-system/web build`

## 実績基準時間のlocation優先+sharedフォールバック導入（2026-03-13）

- **背景**:
  - `actualPerPieceMinutes` は `x-client-key -> clientDevice.location` で解決先が分かれるため、`kensakuMain` にのみ特徴量がある状態では `RoboDrill01` / `Pi5` / `Mac` で `null` になっていた。
  - 同一製番でも端末ごとに表示有無が変わり、現場確認で混乱が発生した。
- **設計**:
  - 共通ポリシー `actual-hours-location-scope.service` を追加し、候補locationを `actor location -> shared-global-rank` の順で返す。
  - Feature Flag `ACTUAL_HOURS_SHARED_FALLBACK_ENABLED`（既定 `false`）で段階導入を可能化。
  - 同一 `(fhincd, resourceCd)` が複数locationに存在する場合は actor側を優先採用。
- **適用範囲**:
  - `GET /api/kiosk/production-schedule`
  - `GET /api/kiosk/production-schedule/due-management/summary`
  - `GET /api/kiosk/production-schedule/due-management/seiban/:fseiban`
- **運用**:
  - 段階導入時は `ACTUAL_HOURS_SHARED_FALLBACK_ENABLED=true` を対象環境で有効化。
  - 影響があれば `false` に戻すだけで従来挙動（actor locationのみ参照）に即時切替可能。
- **回帰テスト**:
  - actorのみ参照（fallback無効）
  - actor欠損時のshared参照（fallback有効）
  - actor/shared重複時のactor優先

### RoboDrill01 Pi4 で実績基準時間が非表示だった事象（2026-03）

- **事象**: 研削メイン（kensakuMain）Pi4 では実績基準時間が表示されるが、RoboDrill01 Pi4 では表示されない。
- **症状**: 同一製番・同一資源CDでも端末ごとに `actualPerPieceMinutes` の有無が異なり、現場確認で混乱が発生。
- **調査**:
  - H1: `ACTUAL_HOURS_SHARED_FALLBACK_ENABLED` が `false` のまま → CONFIRMED（inventory で未設定だった）
  - H2: `ProductionScheduleActualHoursFeature` の特徴量が `第2工場 - kensakuMain` のみで `shared-global-rank` が空 → CONFIRMED
  - H3: RoboDrill01 の actor location は `第2工場 - RoboDrill01` のため、actor のみ参照だとヒットしない → CONFIRMED
- **根因**: フォールバックフラグが無効のまま、かつ `shared-global-rank` に特徴量が存在しなかった。
- **対処**:
  1. `infrastructure/ansible/inventory.yml` に `actual_hours_shared_fallback_enabled: "true"` を追加（server グループ）
  2. `shared-global-rank` へ kensakuMain の特徴量を SQL でバックフィル（[actual-hours-canonical-backfill.md](../runbooks/actual-hours-canonical-backfill.md#shared-global-rank-へのバックフィル) 参照）
- **再発防止**: 新規 location 追加時は `shared-global-rank` へのバックフィル手順を実行する。fallback 有効化後は `false` に戻すだけで従来挙動へ即時切替可能。

## P2-3 Web Split デプロイ・実機検証（2026-03-13）

- **対象**: `ProductionSchedulePage` の責務分離（displayRowDerivation / useProductionScheduleDerivedRows / useProductionScheduleQueryParams / useSharedSearchHistory / ProductionScheduleResourceFilters / ProductionScheduleHistoryStrip / ProductionScheduleTable）
- **デプロイ**: ブランチ `feat/p2-3-web-split-production-schedule-part1`、Pi5 → raspberrypi4 → raspi4-robodrill01 の順に1台ずつ実行（Run ID `20260313-083304-7855` / `20260313-084019-6793` / `20260313-085016-4776`）、Pi3除外、約18分
- **実機検証**: [deploy-status-recovery.md](../runbooks/deploy-status-recovery.md) のチェックリスト全項目合格。生産スケジュール画面の資源CDフィルタ・登録製番・検索履歴・テーブル表示が従来どおり動作することを実機で確認
- **知見**: 表示派生ロジックを純粋関数（`displayRowDerivation`）に抽出するとテスト容易性と責務分離が向上。Container責務を縮小し、query/mutationオーケストレーション中心に寄せる構成は保守性向上に寄与

## P2-4 Web Split Part 2（mutation・副作用分離、2026-03-13）

- **対象**: `apps/web/src/pages/kiosk/ProductionSchedulePage.tsx` の mutation・副作用
- **実装**:
  - `useProductionScheduleMutations.ts` を追加し、`complete/order/processing/note/dueDate` の mutation 実行と pending 集約、書き込みクールダウン制御を分離
  - `useMutationFeedback.ts` を追加し、備考/納期モーダルの開閉・入力値管理・onSettled 後のクリーンアップを分離
  - `ProductionSchedulePage.tsx` は query とイベント委譲中心へ縮退
  - テスト追加: `useProductionScheduleMutations.test.ts` / `useMutationFeedback.test.ts`
- **デプロイ**: ブランチ `feat/p2-4-sideeffects`、Pi5 → raspberrypi4 → raspi4-robodrill01 の順に1台ずつ実行、Pi3除外、約18分
- **実機検証**: [deploy-status-recovery.md](../runbooks/deploy-status-recovery.md) のチェックリスト全項目合格（APIヘルス、deploy-status両Pi4、キオスクAPI、納期管理API、global-rank、actual-hours/stats、サイネージAPI、backup.json、マイグレーション49件、Pi4×2/Pi3サービス稼働）
- **トラブルシューティング**:
  - `pnpm test:e2e:smoke` はローカル DB 未起動時に失敗（`/api/tools/loans/active` ほかが 500）。根因は実装不整合ではなく、`localhost:5432` に到達できない実行環境要因（`PrismaClientInitializationError`）。対処: `./scripts/test/start-postgres.sh` で DB 起動後、`prisma migrate deploy` と `prisma db seed` を実行してから再実行
- **知見**: UI 層は「状態表示とイベント委譲」に限定し、mutation 実行と副作用管理を hook 境界に分離すると、差分確認と回帰テストが局所化される

## P2-5 Boundary Guard デプロイ・実機検証（2026-03-13）

- **対象**: `import/no-restricted-paths` の段階強化（API: `routes/system <-> routes/kiosk` 横断依存禁止、Web: `features/components/hooks/lib/api/layouts/utils -> pages` 逆依存禁止）、`normalizeClientKey` の `apps/api/src/lib/client-key.ts` への集約
- **デプロイ**: ブランチ `feat/p2-5-boundary-guard`、Pi5 → raspberrypi4 → raspi4-robodrill01 の順に1台ずつ実行、Pi3除外、約20分
- **実機検証**: [deploy-status-recovery.md](../runbooks/deploy-status-recovery.md) のチェックリスト全項目合格。APIヘルス、deploy-status（両Pi4で `isMaintenance: false`）、キオスクAPI、納期管理API、global-rank、actual-hours/stats、生産スケジュールAPI、サイネージAPI、backup.json、マイグレーション49件、Pi4×2サービス稼働を確認。Pi3 signage は接続タイムアウトのためスキップ
- **知見**: 境界ルールは `target/from` の向きを誤ると大量誤検知を誘発するため、小さく追加して即 lint 確認する運用が有効

## 納期管理新レイアウト（V2）有効化・デプロイ・実機検証（2026-03-13）

- **目的**: 納期管理画面のレイアウトを左レール・アクティブコンテキストバー・詳細パネル構成へ最適化し、操作中視認性を向上させる。段階導入のため Feature Flag で新旧切替可能にした。
- **仕様**:
  - Feature Flag: `VITE_KIOSK_DUE_MGMT_LAYOUT_V2_ENABLED`（既定 `false`）
  - 新UI: `DueManagementLayoutShell` / `DueManagementLeftRail` / `DueManagementActiveContextBar` / `DueManagementDetailPanel` に責務分割
  - ViewModel: `dueManagementViewModel.ts` で API hook 依存をページコンテナに閉じ込め
  - 設定経路: `inventory.yml` の `web_kiosk_due_mgmt_layout_v2_enabled` → `docker.env.j2` → `infrastructure/docker/.env` → Docker ビルド引数
- **デプロイ**:
  - ブランチ `feat/due-mgmt-layout-hybrid-flag`
  - 1回目（旧UI検証）: Pi5 → raspberrypi4 → raspi4-robodrill01 の順に1台ずつ、約20分
  - 2回目（新UI切替）: inventory で `web_kiosk_due_mgmt_layout_v2_enabled: "true"` に設定後、Pi5（web 再ビルド）→ raspberrypi4 → raspi4-robodrill01 の順にデプロイ
- **実機検証**: 新レイアウト（左レール・アクティブコンテキストバー・詳細パネル）、操作中視認、主要操作（製番一覧・選択・詳細表示・編集）が正常に動作することを確認。動作確認OK。
- **トラブルシューティング**:
  - **VITE_ 変更時に web が再ビルドされない**: `docker.env.j2` 変更時は `docker_env_result.changed` で web を `--build --force-recreate` するタスクを server role に追加済み。従来は api のみ再起動していたため、web のビルド引数変更が反映されなかった。
  - **旧UIへ戻す**: `inventory.yml` の `web_kiosk_due_mgmt_layout_v2_enabled` を `"false"` に変更し、Pi5 へ再デプロイ（web 再ビルドが走る）。
- **知見**: VITE_ 系環境変数はビルド時に埋め込まれるため、変更時は web コンテナの再ビルドが必須。`VITE_KIOSK_TARGET_LOCATION_SELECTOR_ENABLED` と同様の経路（docker.env.j2 → docker-compose build args → Dockerfile.web）で追加した。

## 納期管理UI Phase1（左ペイン開閉式・詳細パネル重複削除）デプロイ・実機検証（2026-03-13）

- **目的**: 納期管理V2レイアウトの左ペインを開閉式にし、詳細パネルから製番・機種の重複表示を削除して視認性を向上させる。
- **仕様**:
  - 左ペイン3セクション（今日判断候補・今日の計画順・全体ランキング）を `CollapsibleSection` / `CollapsibleCard` で開閉可能に
  - `ProductionScheduleDueManagementPage` で開閉状態を管理（`expandedSections`）
  - `DueManagementDetailPanel` から製番・機種を削除（左ペインのカードで既に表示されているため重複を排除）
- **実装ファイル**:
  - 新規: `CollapsibleSection.tsx`, `CollapsibleCard.tsx`
  - 変更: `DueManagementLeftRail.tsx`, `DueManagementDetailPanel.tsx`, `ProductionScheduleDueManagementPage.tsx`
- **デプロイ**:
  - ブランチ `feat/due-management-ui-phase1-collapsible`
  - Pi5 → raspberrypi4（kensakuMain）→ raspi4-robodrill01 の順に1台ずつ実行、約20分
- **実機検証**: [deploy-status-recovery.md](../runbooks/deploy-status-recovery.md) のチェックリスト全項目合格。APIヘルス、deploy-status（両Pi4で `isMaintenance: false`）、キオスクAPI、納期管理API（triage・daily-plan・global-rank・actual-hours/stats）、サイネージAPI、backup.json（15K）、マイグレーション（50件 up to date）、Pi4×2/Pi3サービス稼働を確認。実機で左ペイン開閉・詳細パネル表示・主要操作が正常に動作することを確認。動作確認OK。
- **知見**: 開閉状態はページコンテナで一元管理し、子コンポーネントへコールバックで伝播する構成にすると状態の一貫性を保ちやすい。共通の `CollapsibleSection` / `CollapsibleCard` を切り出しておくと他セクションへの適用が容易。

## 納期管理UI Phase2（開閉アイコン化・デフォルト閉じ・状態記憶・最下段カード削除）（2026-03-13）

- **目的**: 左ペインの情報密度を最適化し、操作に不要な重複表示を削減する。あわせて、開閉状態を再訪時も保持し、現場の操作コンテキストを維持する。
- **仕様**:
  - `CollapsibleSection` / `CollapsibleCard` のトグルを文字（開く/閉じる）からアイコンに変更
  - 左ペイン3セクション（トリアージ/全体ランキング/今日の計画順）をデフォルト閉じに変更
  - セクション開閉状態を `localStorage`（`due-management-section-open`）で永続化
  - 左ペイン最下段の `visibleSummaries` カードを削除（製番登録・削除は検索チップで継続）
- **実装ファイル**:
  - 新規: `apps/web/src/components/kiosk/dueManagement/CollapsibleToggleIcon.tsx`
  - 新規: `apps/web/src/hooks/useCollapsibleSectionPersistence.ts`
  - 変更: `apps/web/src/components/kiosk/dueManagement/CollapsibleSection.tsx`
  - 変更: `apps/web/src/components/kiosk/dueManagement/CollapsibleCard.tsx`
  - 変更: `apps/web/src/components/kiosk/dueManagement/DueManagementLeftRail.tsx`
  - 変更: `apps/web/src/features/kiosk/productionSchedule/dueManagementViewModel.ts`
  - 変更: `apps/web/src/pages/kiosk/ProductionScheduleDueManagementPage.tsx`
- **検証**:
  - `pnpm --filter @raspi-system/web lint` を実行し成功
  - `visibleSummaries` / `buildVisibleSummaries` 参照が `apps/web/src` から除去されていることを確認
- **デプロイ**:
  - ブランチ `feat/due-management-ui-phase2-improvements`
  - Pi5 → raspberrypi4（kensakuMain）→ raspi4-robodrill01 の順に1台ずつ実行、約20分
- **実機検証（2026-03-13）**:
  - **リモート自動チェック**: [deploy-status-recovery.md](../runbooks/deploy-status-recovery.md) のチェックリスト全項目合格。APIヘルス（`status: ok`）、deploy-status（両Pi4で `isMaintenance: false`）、キオスクAPI、納期管理API（triage・daily-plan・global-rank・global-rank/proposal・global-rank/learning-report・actual-hours/stats）、サイネージAPI、backup.json（15K）、マイグレーション（50件 up to date）、Pi4×2/Pi3サービス稼働を確認。
  - **実機UI確認（手動）**: 開閉ボタンがアイコン化されていること、初回表示で全セクションが閉じていること、開閉操作後にリロードしても状態が復元されること、最下段カードが表示されず製番登録・削除がチップで動作すること、製番一覧・選択・詳細・編集が正常に動作することを確認。
- **知見**:
  - 開閉状態の永続化はページコンテナから `useCollapsibleSectionPersistence` へ切り出すと、UIコンポーネントは表示責務に集中できる
  - 選択中製番の解決ロジックは、表示用カード配列ではなく `sharedHistory` を基準にすることで、表示構造変更に影響されない

## 納期管理UI Phase3（左ペイン導線再構成: 入力→全体ランキング→当日反映）（2026-03-14）

- **目的**: 現場リーダーの実運用（製番登録/納期設定 → 全体ランキング生成・微調整 → 当日反映）に合わせ、左ペインを3セクション導線に再構成する。
- **仕様**:
  - 左ペイン上段を `製番登録・納期前提` とし、検索入力・登録済みチップ・候補件数サマリ（危険/注意/余裕）を集約
  - 中段を `全体ランキング（主作業）` とし、生成/再生成保存、フィルタ（全件/今日対象/危険・注意）、カード上で今日対象化を実行可能化
  - 下段を `当日計画への反映（補助）` とし、今日対象候補の選択と計画順保存を統合
  - トリアージは独立主セクションから降格し、ランキングカード属性・候補選択UIとして利用
- **設計互換性**:
  - `global-rank` 保存API経路は変更しない
  - `daily-plan` 保存API経路は変更しない
  - 生産スケジュール側の `globalRank` は既存の `ProductionScheduleGlobalRowRank` 経路を維持
- **実装ファイル**:
  - 変更: `apps/web/src/components/kiosk/dueManagement/DueManagementLeftRail.tsx`
  - 変更: `apps/web/src/pages/kiosk/ProductionScheduleDueManagementPage.tsx`
  - 変更: `apps/web/src/features/kiosk/productionSchedule/dueManagementViewModel.ts`
  - 変更: `apps/web/src/hooks/useCollapsibleSectionPersistence.ts`（`triage` 旧キーを `registration` へ後方互換マップ）
- **ローカル検証**:
  - `pnpm --filter @raspi-system/web lint` 成功
  - `pnpm --filter @raspi-system/web test -- src/features/kiosk/productionSchedule/dueManagement.test.ts` 成功
- **知見**:
  - 主導線を「全体ランキング中心」に寄せつつ、保存経路を維持すれば納期管理/生産スケジュールの反映互換性を崩さずにUI再編できる
  - セクション永続化キーは旧データを吸収する後方互換を入れておくと、初回表示崩れを回避しやすい

### 納期管理UI 左ペイン中規模改善（選択/対象化導線の統合、2026-03-14）

- **目的**:
  - 左ペイン内で分散していた「選択/対象化」操作を統合し、誤操作リスクと理解コストを下げる。
  - API契約を変更せずに、UI責務を分離して保守性・再利用性を高める。
- **実装概要**:
  - `useDueManagementSelectionActions` を追加し、選択状態判定・選択切替・更新中状態を一元化。
  - 左ペインの選択UIを部品化:
    - `DueManagementSelectionToggleButton`
    - `DueManagementGlobalRankCardActions`
    - `DueManagementDailyTriageCandidateList`
  - `DueManagementLeftRail` は表示責務中心に縮小し、選択処理はコールバック経由に統一。
- **UI統一**:
  - 選択トグルの文言を `対象化 / 対象中` に統一。
  - フィルタ文言を `対象中のみ` に統一。
  - disabled 条件を更新中状態に統一。
- **実装ファイル**:
  - 追加: `apps/web/src/features/kiosk/productionSchedule/useDueManagementSelectionActions.ts`
  - 追加: `apps/web/src/components/kiosk/dueManagement/DueManagementSelectionToggleButton.tsx`
  - 追加: `apps/web/src/components/kiosk/dueManagement/DueManagementGlobalRankCardActions.tsx`
  - 追加: `apps/web/src/components/kiosk/dueManagement/DueManagementDailyTriageCandidateList.tsx`
  - 変更: `apps/web/src/components/kiosk/dueManagement/DueManagementLeftRail.tsx`
  - 変更: `apps/web/src/pages/kiosk/ProductionScheduleDueManagementPage.tsx`
- **ローカル検証**:
  - `pnpm --filter @raspi-system/web lint` 成功
  - `pnpm --filter @raspi-system/web test` 成功（66 tests passed）
  - `pnpm --filter @raspi-system/web build` 成功

### 納期管理UI 左ペイン中規模改善 デプロイ・実機検証（2026-03-14）

- **デプロイ**: ブランチ `feat/due-mgmt-leftrail-selection-unify`、Pi5 → raspberrypi4 → raspi4-robodrill01 の順に1台ずつ実行、約12分。
- **実機検証結果**:
  - リモート自動チェック全項目合格（APIヘルス、deploy-status両Pi4、キオスクAPI、納期管理API、サイネージAPI、backup.json、マイグレーション、Pi4×2サービス稼働）
  - **実機UI確認（raspberrypi4）**: 左ペイン3セクション（製番登録・納期前提、全体ランキング（主作業）、当日計画への反映（補助））、ランキングカード・今日対象候補の「対象化/対象中」トグル、フィルタ「対象中のみ」⇔「全件表示」、サマリ（対象候補/対象中/危険/注意/余裕）、バッジ（今日対象/対象外/引継ぎ）、製番選択→右ペイン表示、セクション開閉状態のlocalStorage永続化を確認
- **知見**: 自動生成で保存した製番はすべて「対象中」になる。個別に「対象中」をクリックすると「対象化」に戻り、今日の計画から外れる。

### 納期管理UI 左ペイン3セクション色分け（2026-03-14）

- **目的**: 左ペイン3セクションを同一色で視認しづらい問題を解消し、導線（製番登録→全体ランキング→当日反映）を色で区別できるようにする。
- **仕様**:
  - `CollapsibleSection` に `accent` prop を追加（`emerald` / `blue` / `amber`）
  - 製番登録・納期前提: emerald（緑）
  - 全体ランキング: blue（青）
  - 当日計画への反映: amber（黄）
  - 当日計画セクションは `contentOpen: ''` でコンテンツ背景なし（赤「危険」の視認性のため）
- **実装**:
  - 変更: `apps/web/src/components/kiosk/dueManagement/CollapsibleSection.tsx`（`accent` prop、`ACCENT_CLASSES`）
  - 変更: `apps/web/src/components/kiosk/dueManagement/DueManagementLeftRail.tsx`（各セクションに accent 指定）
- **デプロイ**: ブランチ `feat/due-mgmt-leftrail-section-accent`、Pi5 → raspberrypi4 → raspi4-robodrill01 の順に1台ずつ実行、約12分。
- **実機検証結果**:
  - リモート自動チェック全項目合格（APIヘルス、deploy-status両Pi4、キオスクAPI、納期管理API、サイネージAPI、backup.json、マイグレーション、Pi4×2サービス稼働）
  - 実機UI確認: 左ペイン3セクションの色分け（emerald/blue/amber）、当日計画セクションのコンテンツ背景なし、開閉・製番選択・既存機能の動作確認
- **知見**: 当日計画セクションは「危険」ラベルが赤で表示されるため、コンテンツ背景を付けない方が視認性が高い。`ACCENT_CLASSES` で accent ごとに `contentOpen` を個別指定可能。

### 納期管理UI Phase3 デプロイ・実機検証（2026-03-14）

- **デプロイ**: ブランチ `feat/due-mgmt-leftpane-workflow-refactor`、Pi5 → raspberrypi4 → raspi4-robodrill01 の順に1台ずつ実行（Run ID `20260314-104634-11479` / `20260314-105037-20151` / `20260314-105548-29471`）、約12分。
- **実機検証結果**:
  - リモート自動チェック全項目合格（APIヘルス degraded・メモリ95.9%は既知環境要因、deploy-status両Pi4 `isMaintenance: false`、キオスクAPI、納期管理API（triage・daily-plan・global-rank・global-rank/proposal・actual-hours/stats）、サイネージAPI、backup.json 15K、マイグレーション51件 up to date、Pi4×2サービス稼働）
  - **実機UI確認**: 左ペイン3セクション（上段: 製番登録・納期前提、中段: 全体ランキング、下段: 当日計画への反映）、トリアージのランキングカード属性・フィルタ・当日候補選択UIへの統合、開閉・状態記憶・主要操作が正常に動作することを確認
- **知見**: デプロイは1台ずつ順番実行（`--limit`）で安定。リモート検証は deploy-status-recovery.md のチェックリストに従う。

## 表面処理別納期ボタン追加（2026-03-13）

- **目的**: 製番納期をデフォルトとして維持しつつ、製番内の表面処理（例: LSLH / カニゼン / 塗装）ごとに納期を個別上書きできるようにする。
- **仕様**:
  - 右ペインヘッダーに `製番納期` ボタンを維持したまま、`製番内で実際に使われている表面処理のみ` 納期ボタンを追加
  - 優先規則: `processingType別納期 > 製番納期`
  - 製番納期の更新時は `processingType別上書きが存在しない行` のみ writeback 対象とする（上書き保持）
  - processingType別納期の解除時はレコード削除で表現し、製番納期へフォールバック
  - 左ペイン summary / triage は最早有効納期（min effective due date）で表示・判定する
- **データモデル**:
  - `ProductionScheduleSeibanProcessingDueDate`（`csvDashboardId + fseiban + processingType` 一意）を追加
  - migration: `20260313190000_add_seiban_processing_due_date`
- **API**:
  - 追加: `PUT /api/kiosk/production-schedule/due-management/seiban/:fseiban/processing/:processingType/due-date`
  - 既存: `PUT /api/kiosk/production-schedule/due-management/seiban/:fseiban/due-date` は `excludeProcessingTypes` 対応へ拡張
- **トラブルシューティング**:
  - **症状**: 製番納期を更新すると processingType別納期が消える  
    **確認**: `ProductionScheduleSeibanProcessingDueDate` に対象 `fseiban + processingType` の行が存在するか  
    **対処**: processingType別納期APIで再設定し、summary/triage/detail の最早納期反映を確認
  - **症状**: processingType別納期解除後に納期が空になる  
    **確認**: 製番納期（`ProductionScheduleSeibanDueDate`）が未設定ではないか  
    **対処**: 製番納期を先に設定してから processingType別納期を解除

### 表面処理別納期 デプロイ・実機検証（2026-03-14）

- **デプロイ**: ブランチ `feat/seiban-processing-type-due-date`、Pi5 → raspberrypi4 → raspi4-robodrill01 の順に1台ずつ実行（Run ID `20260314-080702-3787` / `20260314-081421-8883` / `20260314-081939-26141`）、約25分。
- **実機検証結果**:
  - リモート自動チェック全項目合格（APIヘルス、deploy-status両Pi4、キオスクAPI、納期管理API、global-rank、actual-hours/stats、サイネージAPI、backup.json、マイグレーション51件、Pi4×2サービス稼働）
  - **表面処理別納期 API**: `PUT /seiban/:fseiban/processing/:processingType/due-date` で設定（200 OK）、`dueDate: ""` で解除→製番納期へフォールバック確認。detail の `processingTypeDueDates` 返却確認
  - **実機UI確認**: 右ペインヘッダーに「製番納期」と「製番内で使用中の表面処理別納期」ボタンが併存、設定・解除・フォールバック動作OK
- **知見**: processingType別納期の解除は DELETE ではなく `PUT` に `dueDate: ""` を送る。製番内に存在しない processingType を指定すると 404「指定された製番内に対象の表面処理が見つかりません」を返す（想定どおり）

## 追加実装（2026-03-07）

- 登録製番同期: 納期管理の左ペインを `search-state.history` 同期に変更し、検索追加・保持・×削除を生産スケジュール画面と共通化
- 機種名表示: 納期管理サマリと部品優先順位ヘッダに `machineName` を追加
- 工程進捗表示（案A）: 部品行ごとに `processes[]` を表示し、完了工程をグレーアウト
- FHINCD単位表面処理: `ProductionSchedulePartProcessingType` を追加し、生産スケジュール画面/納期管理画面の更新を同一マスタへ集約
- 候補値の編集可能化: `ProductionScheduleProcessingTypeOption` を追加し、管理コンソールの設定画面で候補（code/label/priority/enabled）を編集可能化
- 検証: API統合テスト `kiosk-production-schedule.integration.test.ts` と `apps/api`,`apps/web` lint を通過

## A修正（画面整合・同期・遷移認証、2026-03-07）

- 左ペイン: 登録製番を最小chip表示へ変更（ボタン見た目を廃止し、`×`削除のみ維持）
- 検索入力: 納期管理画面にもソフトウェアキーボード（`KioskKeyboardModal`）を導入
- 機種名表示: 生産スケジュールと同じ半角化＋大文字化（`toHalfWidthAscii + toUpperCase`）に統一
- 右ペイン: `FHINCD` が `MH`/`SH` で始まる機種名アイテムを非表示化し、`製造order番号（ProductNo）` 列を追加
- 工程進捗: 切削除外設定済み資源CD（例: `10`, `MSZ`）を除外し、完了工程の色味を生産スケジュール側に近いグレーアウトへ統一
- 備考同期: 納期管理の部品備考を「製番+部品（`fseiban+fhincd`）」で保存し、保存時に同キーの全工程row noteへ一括同期
- 遷移認証: 納期管理ボタン押下時にパスワード確認を追加。管理コンソール（生産スケジュール設定）からshared単位で変更可能。未設定時は初期値 `2520` を許可（後方互換）
- ヘッダ発色: 納期管理遷移時に生産スケジュールボタンのactive色が残る不具合を修正（`/kiosk/production-schedule` に `end` を付与）
- 検証: `pnpm --filter @raspi-system/api test -- src/routes/__tests__/kiosk-production-schedule.integration.test.ts`（35件成功）、`apps/api` / `apps/web` lint 成功

## 資源CD名称マスタ導入とホバー表示（2026-03-11）

- 目的: 資源CDのみでは現場オペレーターが設備を識別しづらいため、`FSIGENCD` に紐づく `FSIGENMEI` をDBで一元管理し、既存UIのホバー導線で表示できるようにする
- DB:
  - `ProductionScheduleResourceMaster` を追加（`resourceCd`, `resourceName`, `resourceClassCd`, `resourceGroupCd`）
  - 制約: `resourceCd + resourceName` ユニーク（同一CDに複数名称を保持）
  - 参照性能: `resourceCd` インデックスを追加
- 初回投入:
  - `apps/api/prisma/seeds/dataSIGEN.csv` を追加し、`prisma/seed.ts` で upsert 取り込み
  - 取り込み時は `resourceCd + resourceName` をキーに重複を吸収し、`resourceClassCd` / `resourceGroupCd` を更新可能にした
- API:
  - `GET /api/kiosk/production-schedule/resources` を後方互換拡張
  - 既存 `resources: string[]` は維持し、追加で `resourceNameMap: Record<string, string[]>` を返却
  - 納期管理詳細の `parts[].processes[]` に `resourceNames: string[]` を追加
- UI:
  - 生産スケジュールの資源CDボタンに `title` / `aria-label` を追加（備考ホバーパターン流用）
  - 納期管理の工程進捗バッジに `title` / `aria-label` を追加
  - 同一資源CDに複数名称がある場合は連結表示（`title` は改行、`aria-label` は ` / ` 区切り）
- 検証:
  - APIユニットテスト更新（`production-schedule-query.service.test.ts`）
  - 統合テスト更新（`kiosk-production-schedule.integration.test.ts`）
  - `pnpm --filter @raspi-system/api prisma:generate`
  - `pnpm --filter @raspi-system/api build`
  - `pnpm --filter @raspi-system/web build`

## A修正デプロイ・実機検証（2026-03-07）

- **デプロイ**: Run ID `20260307-141453-31000`、`state: success`、約40分（Pi5+Pi4×2、`--limit "server:kiosk"`）
- **実機検証結果**:
  - APIヘルス: 200 OK / `status: degraded`（メモリ96.2%、既知の環境要因）
  - deploy-status: 両Pi4（raspberrypi4・raspi4-robodrill01）で `isMaintenance: false`
  - キオスクAPI: `/api/tools/loans/active` 200、`/api/kiosk/production-schedule` 200、`/api/kiosk/production-schedule/due-management/summary` 200
  - 納期管理認証API: `POST /api/kiosk/production-schedule/due-management/verify-access-password`（password: 2520）→ `{"success":true}`
  - Prismaマイグレーション: 38件適用済み、スキーマ最新（`ProductionScheduleAccessPasswordConfig` 含む）
  - backup.json: 存在・15K
  - サイネージAPI: `/api/signage/content` layoutConfig 正常
  - Pi4サービス: raspberrypi4・raspi4-robodrill01 ともに kiosk-browser.service / status-agent.timer が active

## B第1段階（納期管理トリアージ、2026-03-07）

- 目的: リーダーが全件を俯瞰せず「今日判断すべき製番」を選べるようにする
- DB:
  - `ProductionScheduleTriageSelection`（拠点共有、`csvDashboardId + location + fseiban` 一意）
- API:
  - `GET /api/kiosk/production-schedule/due-management/triage`
    - 返却: `zones.danger/caution/safe`, `reasons[]`, `isSelected`, `selectedFseibans`
  - `PUT /api/kiosk/production-schedule/due-management/triage/selection`
    - 返却: `selectedFseibans`
- 判定ロジック（第1段階）:
  - 納期基準（`daysUntilDue`）で `danger/caution/safe` を分類
  - 高件数（部品/工程）で1段階エスカレーション
  - 理由には納期由来コード（`DUE_DATE_*`）を優先して付与
  - 表面処理優先ルール（`LSLH > カニゼン > 塗装`）は `SURFACE_PRIORITY` として理由表示
- UI:
  - 納期管理左ペインに「今日判断候補（トリアージ）」を追加
  - 候補カードの選択/解除と「選択済みのみ」表示トグルを追加
- 検証:
  - `pnpm --filter @raspi-system/api test -- src/routes/__tests__/kiosk-production-schedule.integration.test.ts`（37件成功）
  - `pnpm --filter @raspi-system/api lint` / `pnpm --filter @raspi-system/web lint` 成功

## B第2最小（今日の計画順、2026-03-07）

- 目的: トリアージで選んだ製番を、その日の実行順として並べ替え・保存・再表示できるようにする
- DB:
  - `ProductionScheduleDailyPlan`（拠点×日付の計画ヘッダ）
  - `ProductionScheduleDailyPlanItem`（製番と順位）
- API:
  - `GET /api/kiosk/production-schedule/due-management/daily-plan`
    - 返却: `planDate`, `status`, `orderedFseibans`
    - 初回（未保存）時はトリアージ選択済み製番をフォールバック返却
  - `PUT /api/kiosk/production-schedule/due-management/daily-plan`
    - 入力: `orderedFseibans[]`
    - 返却: `success`, `orderedFseibans`
- UI:
  - 納期管理左ペインに「今日の計画順（選択済み製番）」を追加
  - カードの上下操作で順位変更、保存ボタンでAPIへ永続化
  - カードクリックで右ペイン詳細を開ける
- 不具合修正:
  - トリアージカード選択が右ペインに反映されない問題を修正
  - `selectedFseiban` の維持判定を `visibleSummaries` のみ依存から、トリアージ候補/計画順も含める方式へ変更
- 検証:
  - `pnpm --filter @raspi-system/api test -- src/routes/__tests__/kiosk-production-schedule.integration.test.ts`（39件成功）
  - `pnpm --filter @raspi-system/api build` / `pnpm --filter @raspi-system/web build` 成功
  - `pnpm --filter @raspi-system/api lint` / `pnpm --filter @raspi-system/web lint` 成功

## B第2最小デプロイ・実機検証（2026-03-07）

- **デプロイ**: Run ID `20260307-171320-24942`、`state: success`、約12分（Pi5+Pi4×2、`--limit "server:kiosk"`）
- **実機検証結果**:
  - APIヘルス: 200 OK / `status: ok`
  - Prismaマイグレーション: 40件適用済み、スキーマ最新
  - deploy-status: 両Pi4（raspberrypi4・raspi4-robodrill01）で `isMaintenance: false`
  - キオスクAPI: `/api/tools/loans/active` 200（両Pi4）
  - 納期管理API: `/api/kiosk/production-schedule/due-management/triage` 200、`/api/kiosk/production-schedule/due-management/daily-plan` 200（`planDate`/`status`/`orderedFseibans` 返却確認）
  - サイネージAPI: `/api/signage/content` 200
  - backup.json: 存在・15K
  - Pi4サービス: raspberrypi4・raspi4-robodrill01 ともに kiosk-browser.service / status-agent.timer が active

## B第2最小の操作説明

納期管理画面の「今日の計画順」機能の操作手順（リーダー向け）。

### 前提

- 納期管理画面へ遷移済み（パスワード認証済み）
- 「今日判断候補（トリアージ）」で製番を選択済み（選択済み製番が「今日の計画順」に表示される）

### 操作手順

1. **計画順の確認**: 左ペインの「今日の計画順（選択済み製番）」に、トリアージで選んだ製番が表示される
2. **順位の変更**: 各製番カードの上下矢印（↑/↓）を押して、実行順を変更する
3. **保存**: 順位を変更したら「保存」ボタンを押してAPIへ永続化する（未保存の変更があるとボタンが有効になる）
4. **詳細確認**: 製番カードをクリックすると右ペインに製番詳細（部品・工程進捗など）が表示される

### 補足

- 計画順は拠点×日付単位で保存される（他拠点・他日付の計画には影響しない）
- 初回（未保存時）はトリアージ選択済み製番がそのまま表示される
- 日付が変わると新しい計画として扱われ、前日の計画順は引き継がれない

### トラブルシュート（B第2最小）

| 症状 | 想定原因 | 対処 |
|------|----------|------|
| トリアージカードをクリックしても右ペインが更新されない | 選択維持ロジックの不具合（B2で修正済み） | 最新版へデプロイ済みか確認。未対応の場合は画面をリロード |
| 保存ボタンが押せない | 変更がない、または保存済み | 上下矢印で順位を変更してから保存 |
| 計画順が空 | トリアージで製番を未選択 | 「今日判断候補」で製番を選択してから計画順を編集 |

### 知見（B第2実装時）

- **daily-plan API フォールバック**: 未保存時は `ProductionScheduleTriageSelection` の選択済み製番をフォールバック返却。計画テーブルとトリアージテーブルは別管理で、日付キーは JST 基準
- **統合テストのフォールバック順序**: GET の初回取得でトリアージ選択の順序が保証されないため、アサーションは `.sort()` で比較する設計が安全

## B第3段階（全体ランキング・引継ぎ、2026-03-07）

- **目的**: 日次計画の順序を拠点全体で共有し、前日未完了製番を「引継ぎ」として後段に配置できるようにする
- **DB**:
  - `ProductionScheduleGlobalRank`（拠点×製番の優先順位、`csvDashboardId + location + fseiban` 一意、`priorityOrder` でソート）
- **API**:
  - `GET /api/kiosk/production-schedule/due-management/global-rank`
  - `PUT /api/kiosk/production-schedule/due-management/global-rank`
- **ロジック**:
  - 日次計画未保存時: 前日計画＋全体ランキング＋当日トリアージで初期順を生成。トリアージ外は「引継ぎ」として後段に配置
  - 日次計画保存時に global rank へマージ
- **UI**:
  - 「今日の計画順」で引継ぎ製番に「引継ぎ」バッジを表示

### B第3段階デプロイ・実機検証（2026-03-07）

- **デプロイ**: Run ID `20260307-182958-1095`、`state: success`、約11分（Pi5+Pi4×2、`--limit "server:kiosk"`）
- **実機検証結果**:
  - APIヘルス: 200 OK / `status: degraded`（メモリ95.5%、既知の環境要因）
  - Prismaマイグレーション: 41件適用済み、スキーマ最新
  - deploy-status: 両Pi4で `isMaintenance: false`
  - キオスクAPI: `/api/tools/loans/active` 200（両Pi4）
  - 納期管理API: triage / daily-plan / global-rank いずれも 200
  - サイネージAPI: `/api/signage/content` 200、`layoutConfig` 含む
  - backup.json: 存在・15K
  - Pi4サービス: Pi5経由SSHで raspberrypi4・raspi4-robodrill01 ともに kiosk-browser.service / status-agent.timer が active

### 知見（B第3実装・実機検証時）

- **Pi4サービス確認**: Macから直接Pi4にSSHするとタイムアウトする。Pi5経由（`ssh denkon5sd02@100.106.158.2 "ssh tools03@100.74.144.79 '...'"`）で接続する（[deploy-status-recovery.md](../runbooks/deploy-status-recovery.md) 参照）

## B第3次段（全体ランキング可視化・閲覧専用、2026-03-07）

- **目的**: B3で追加済みの `global-rank` を画面で可視化し、リーダー/オペレーターが同じ優先順位を見ながら運用できる状態にする
- **UI追加**:
  - 左ペインに「**全体ランキング（親）**」セクションを追加（閲覧専用）
  - 既存「今日の計画順」を「**子：全体ランキングから切り出し**」として文言整理
  - 全体ランキングカードに「今日対象 / 対象外 / 引継ぎ」バッジを表示
- **設計上の位置づけ**:
  - 変更は `ProductionScheduleDueManagementPage.tsx` に局所化（API追加なし）
  - 既存 `GET /api/kiosk/production-schedule/due-management/global-rank` を再利用
  - 編集（`PUT /global-rank`）は次段スコープとして見送り
- **制約（今回の仕様）**:
  - 全体ランキングは**閲覧のみ**（並べ替え・保存は未提供）
  - 当日実行順の編集は引き続き「今日の計画順」で実施
- **検証**:
  - `pnpm --filter @raspi-system/web test -- src/features/kiosk/productionSchedule/dueManagement.test.ts`（3件成功）
  - `pnpm --filter @raspi-system/web lint` 成功
  - `pnpm --filter @raspi-system/api test -- src/routes/__tests__/kiosk-production-schedule.integration.test.ts`（41件成功）

### B第3次段デプロイ・実機検証（2026-03-07）

- **デプロイ**: Run ID `20260307-193451-27230`、`state: success`、約10〜15分（Pi5+Pi4×2、`--limit "server:kiosk"`）
- **ブランチ**: `feat/due-mgmt-b4-global-rank-visibility`
- **実機検証結果**:
  - APIヘルス: 200 OK / `status: ok`
  - deploy-status: 両Pi4（raspberrypi4・raspi4-robodrill01）で `isMaintenance: false`
  - キオスクAPI: `/api/tools/loans/active` 200（両Pi4）
  - 納期管理API: triage / daily-plan / global-rank いずれも 200
  - global-rank: データ未登録時は `{"orderedFseibans":[]}` を返却（UIは「全体ランキングはまだ作成されていません」と表示）
  - サイネージAPI: `/api/signage/content` 200、`layoutConfig` 含む
  - backup.json: 存在・15K
  - マイグレーション: 41件適用済み、未適用なし
  - Pi4サービス: Pi5経由SSHで raspberrypi4・raspi4-robodrill01 ともに kiosk-browser.service / status-agent.timer が active
  - Pi3 signage-lite: active

### 知見（B第3次段実装・デプロイ時）

- **deriveGlobalRankFlags**: `isCarryover` が true のとき `isInTodayTriage` は常に false になる（引継ぎは今日対象外）。`isOutOfToday` は `!isInTodayTriage` で導出
- **global-rank 空データ**: 製番が1件も登録されていない場合、API は `orderedFseibans: []` を返す。UI は「全体ランキングはまだ作成されていません」と表示
- **デプロイ対象**: Web/キオスク変更は Pi5 + Pi4（`--limit "server:kiosk"`）で十分。Pi3（サイネージ）はサーバー側レンダリングのため Pi5 のみで影響完結

### トラブルシュート（B第3次段）

| 症状 | 想定原因 | 対処 |
|------|----------|------|
| 全体ランキングが空 | 製番が未登録、または global-rank に1件もない | トリアージで製番を選択し、今日の計画順を保存すると global-rank へマージされる。初回は空のままでも正常 |
| バッジが表示されない | dailyPlanItemMeta や selectedSet の取得失敗 | トリアージ・daily-plan API の応答を確認。画面リロードで再取得 |
| 「今日の計画順」と全体ランキングの整合が取れない | 保存タイミングのずれ | 今日の計画順で「順序を保存」を押すと global-rank へマージされる。保存後に全体ランキングを再読込 |

## B第4段階（全体ランキング自動生成・根拠表示、2026-03-07）

- **目的**: 製番単位トリアージと既存運用を維持しつつ、資源所要量を最上位重みとして全体ランキングを自動生成できるようにする
- **追加API**:
  - `GET /api/kiosk/production-schedule/due-management/global-rank/proposal`
  - `PUT /api/kiosk/production-schedule/due-management/global-rank/auto-generate`
  - `GET /api/kiosk/production-schedule/due-management/global-rank/explanation/:fseiban`
- **追加サービス**:
  - `resource-load-estimator.service.ts`（資源能力/混雑/未完了量シグナル）
  - `completion-history-analyzer.service.ts`（完了実績由来シグナル）
  - `due-management-scoring.service.ts`（重み付きスコア計算）
  - `due-management-global-rank-auto.service.ts`（安全ガードつき自動保存）
- **スコア方針（初期係数）**:
  - 資源所要量 45%
  - 納期切迫度 20%
  - 実績補正 15%
  - 引継ぎ/継続性 10%
  - 製番内優先（上位部品カバレッジ）10%
- **安全策（write policy）**:
  - 最小候補件数ガード（`minCandidateCount`）
  - 並び替え差分率ガード（`maxReorderDeltaRatio`）
  - 既存尾部保持（`keepExistingTail`）
- **UI**:
  - 「全体ランキング（親）」に「自動生成して保存」ボタンを追加
  - 各製番カードに `score` と理由バッジ（`reasons[]`）を表示
- **検証**:
  - `pnpm --filter @raspi-system/api test -- src/routes/__tests__/kiosk-production-schedule.integration.test.ts`
  - `pnpm --filter @raspi-system/api lint`
  - `pnpm --filter @raspi-system/web lint`
  - `pnpm --filter @raspi-system/web test`

### 知見（B第4実装時）

- `proposal` は保存前シミュレーションとして利用できるため、現場運用ではまず提案を確認してから `auto-generate` を実行すると安全
- `auto-generate` はガードに抵触した場合 `applied=false` で返し、既存順位を維持する
- 候補未選択時でも summary 全件を対象に提案を返せるため、運用開始時の初期ランキング作成に使える

## B第4段階デプロイ・実機検証（2026-03-07）

- **デプロイ**: Run ID `20260307-214452-32001`、`state: success`、約12分（Pi5+Pi4×2、`--limit "server:kiosk"`）
- **ブランチ**: `feat/due-mgmt-b5-auto-global-rank`
- **実機検証結果**:
  - APIヘルス: 200 OK / `status: ok`
  - deploy-status: 両Pi4（raspberrypi4・raspi4-robodrill01）で `isMaintenance: false`
  - キオスクAPI: `/api/tools/loans/active` 200（両Pi4）
  - 納期管理API: triage / daily-plan / global-rank いずれも 200
  - B5 global-rank/proposal: `GET /api/kiosk/production-schedule/due-management/global-rank/proposal` 200（`generatedAt`、`orderedFseibans`、`candidateCount` 返却確認）
  - サイネージAPI: `/api/signage/content` 200
  - backup.json: 存在・15K
  - マイグレーション: 41件適用済み、未適用なし
  - Pi4サービス: Pi5経由SSHで raspberrypi4・raspi4-robodrill01 ともに kiosk-browser.service / status-agent.timer が active

### トラブルシュート（B第4段階）

| 症状 | 想定原因 | 対処 |
|------|----------|------|
| 「自動生成して保存」が無効 | ガード（最小候補件数・差分率・尾部保持）に抵触 | proposal を確認し、`applied=false` の理由をログで確認。必要ならガード閾値を調整 |
| スコア・理由が表示されない | proposal API の取得失敗 | ネットワーク・APIヘルスを確認。画面リロードで再取得 |
| 保存後に順位が変わらない | ガードで `applied=false` | 提案内容と既存順位の差分率が閾値を超えている可能性。手動で今日の計画順を編集して保存 |

## B第4段階補正（納期設定済み限定候補 + 即時除外、2026-03-07）

- **目的**: 全体ランキング（親）を現場運用に合わせ、「納期設定済み製番のみ」を候補に統一
- **仕様変更**:
  - `GET /api/kiosk/production-schedule/due-management/global-rank/proposal` の候補は `dueDate != null` の製番のみ
  - `PUT /api/kiosk/production-schedule/due-management/global-rank/auto-generate` で、既存global-rankに残る納期未設定製番を**即時除外**（方針A）
  - `keepExistingTail=true` でも、納期未設定製番は尾部保持しない
  - 日数計算は JST 日境界で評価
- **実装ファイル**:
  - `apps/api/src/services/production-schedule/due-management-scoring.service.ts`
  - `apps/api/src/services/production-schedule/due-management-global-rank-auto.service.ts`
- **検証（ローカル）**:
  - `pnpm --filter @raspi-system/api test -- src/routes/__tests__/kiosk-production-schedule.integration.test.ts`（44件成功）
  - `pnpm --filter @raspi-system/api lint` 成功
  - `pnpm --filter @raspi-system/web lint` 成功

## B第4段階補正デプロイ・実機検証（2026-03-08）

- **デプロイ**: Run ID `20260308-080355-17100`、`state: success`、約12分（Pi5+Pi4×2、`--limit "server:kiosk"`）
- **実機検証結果**:
  - APIヘルス: 200 OK / `status: ok`（メモリ91.6%警告は既知）
  - deploy-status: 両Pi4（raspberrypi4・raspi4-robodrill01）で `isMaintenance: false`
  - キオスクAPI: `/api/tools/loans/active` 200（両Pi4）
  - 納期管理API: triage / daily-plan / global-rank / global-rank/proposal / summary いずれも 200
  - global-rank/proposal: `candidateCount: 0`（納期未設定製番のみの環境では空が想定どおり）
  - サイネージAPI: `/api/signage/content` 200、`layoutConfig` 含む
  - backup.json: 存在・15K
  - マイグレーション: 41件適用済み、スキーマ最新
  - Pi4サービス: Pi5経由SSHで raspberrypi4・raspi4-robodrill01 ともに kiosk-browser.service / status-agent.timer が active

### 知見（B第4段階補正デプロイ・実機検証時）

- **proposal 空応答**: 納期設定済み製番が1件もない場合、`global-rank/proposal` は `orderedFseibans: []`、`candidateCount: 0` を返す。運用開始時や納期未登録時は正常挙動
- **実機検証チェックリスト**: [deploy-status-recovery.md](../runbooks/deploy-status-recovery.md) の「3. 実機検証チェックリスト」を参照

## References

- [ci-troubleshooting.md](../guides/ci-troubleshooting.md)（8.5. ユニットテストで Prisma モデル未モック）— A修正実装時の CI 初回失敗（KB-298）対策
- [KB-298](../knowledge-base/ci-cd.md#kb-298-ユニットテストでprismaモデル未モックtyperror-cannot-read-properties-of-undefined-reading-findmany): ユニットテストで Prisma モデル未モック
- `apps/api/prisma/schema.prisma`
- `apps/api/src/services/production-schedule/due-management-query.service.ts`
- `apps/api/src/services/production-schedule/due-management-command.service.ts`
- `apps/api/src/services/production-schedule/due-management-triage.service.ts`
- `apps/api/src/services/production-schedule/due-management-selection.service.ts`
- `apps/api/src/services/production-schedule/due-management-daily-plan.service.ts`
- `apps/api/src/services/production-schedule/due-management-global-rank.service.ts`
- `apps/api/src/services/production-schedule/due-management-carryover.service.ts`
- `apps/api/src/services/production-schedule/due-management-scoring.types.ts`
- `apps/api/src/services/production-schedule/resource-load-estimator.service.ts`
- `apps/api/src/services/production-schedule/completion-history-analyzer.service.ts`
- `apps/api/src/services/production-schedule/due-management-scoring.service.ts`
- `apps/api/src/services/production-schedule/due-management-global-rank-auto.service.ts`
- `apps/api/src/routes/kiosk/production-schedule/due-management-global-rank.ts`
- `apps/web/src/pages/kiosk/ProductionScheduleDueManagementPage.tsx`
- `apps/web/src/features/kiosk/productionSchedule/dueManagement.ts`（`deriveGlobalRankFlags`）
- `apps/web/src/api/client.ts`
- `apps/web/src/api/hooks.ts`
- `apps/web/src/pages/admin/ProductionScheduleSettingsPage.tsx`

## B第5段階（オフライン学習評価 + イベントログ、2026-03-08）

### 実装前議論（設計方針・コンテキスト共有）

- **目的**: 納期遅れ最小化を主目的として、提案順位/現場決定/完了変化を追記専用で保存し、重み更新はオフライン評価のみに限定する
- **方針**:
  - 本番で重みを自動更新しない（オンライン学習を無効）
  - 提案と現場決定の一致度は副指標（Top-K/Spearman/Kendall）
  - 主指標は遅延側（overdue件数、overdue日数）
- **設計方針の背景**:
  - **オフライン評価のみ**: 本番での即時自己学習は、データ品質やサンプル不足時に挙動が不安定化するリスクがある。既存データはCSV再取込や保持期間削除の影響を受けるため、学習/監査向けの履歴としては欠損しうる
  - **代替案検討**: オンライン学習（本番で重みを逐次更新）は却下。データ品質/件数が安定する前に導入すると過学習・挙動不安定化を招く。既存テーブルのみで学習を行う案も、履歴欠損時に再現性・監査性を担保しにくいため却下
  - **イベントモデル**: 追記専用の3テーブル（Proposal/Decision/Outcome）で一次データを保持し、既存 `ProductionScheduleGlobalRank` は運用表示向け投影として維持
- **追加データモデル**:
  - `DueManagementProposalEvent`
  - `DueManagementOperatorDecisionEvent`
  - `DueManagementOutcomeEvent`
- **追加API**:
  - `GET /api/kiosk/production-schedule/due-management/global-rank/learning-report`（クエリ: `from` / `to` オプション、ISO 8601）
- **実装ポイント**:
  - `auto-generate` / 手動global-rank保存時に proposal/decision イベントを記録
  - 完了トグル・CSV進捗同期時に outcome イベントを記録
  - `due-management-learning-evaluator.service.ts` で期間集計レポートを生成
- **運用メモ**:
  - イベントテーブルは分析・再学習・監査の一次データとして扱い、既存ランキングテーブルは投影（運用表示）として扱う
  - 学習重みの本番反映は別ステップ（承認付き）で行う

### デプロイ・実機検証（2026-03-08）

- **デプロイ**: Run ID `20260308-092421-13920`、`state: success`、約12分（Pi5+Pi4×2、`--limit "server:kiosk"`）
- **実機検証チェック**:
  - APIヘルス: `status: ok`
  - deploy-status: 両Pi4（raspberrypi4・raspi4-robodrill01）で `isMaintenance: false`
  - キオスクAPI: `/api/tools/loans/active` 200
  - 納期管理API: triage・daily-plan・global-rank・global-rank/proposal・**global-rank/learning-report**・summary すべて 200
  - サイネージAPI: 200
  - backup.json: 存在・15K
  - マイグレーション: 42件適用済み、未適用なし
  - Pi4サービス: Pi5経由SSHで raspberrypi4・raspi4-robodrill01 ともに kiosk-browser.service / status-agent.timer が active
- **learning-report 応答例**: `locationKey`、`range`（from/to）、`summary`（proposalCount、decisionCount、outcomeCount、overdueSeibanCount、overdueTotalDays、avgTopKPrecision、avgSpearmanRho、avgKendallTau）、`recommendation` を返却

### トラブルシューティング（Prisma JSON型CI失敗）

- **事象**: 初回プッシュ後、CIの`Build API`で `tsc -p tsconfig.build.json` が失敗
- **エラー**: `due-management-learning-event.repository.ts` で `Record<string, unknown> | null` が Prisma の `InputJsonValue` / `NullableJsonNullValueInput` に代入できない
- **原因**: Prisma の JSON カラムでは、`null` を明示するには `Prisma.JsonNull` を指定する必要がある。`Record<string, unknown>` は `Prisma.InputJsonValue` へのキャストが必要
- **対策**: [KB-299](./ci-cd.md#kb-299-prisma-jsonカラムへのrecordstring-unknown-やnullの代入でciビルド失敗) を参照
- **再発防止**: 新規 JSON カラムへの書き込みには、既存 `signage.service.ts` の `toPrismaLayoutConfig` パターン（`null` → `Prisma.JsonNull`、オブジェクト → `as Prisma.InputJsonValue`）を参照する

### 知見（B第5段階）

- **実機検証チェックリスト**: [deploy-status-recovery.md](../runbooks/deploy-status-recovery.md) の「3. 実機検証チェックリスト」を参照。`learning-report` は納期管理APIの一環として追加済み

## B第6段階（行単位全体順位スナップショット導入・Phase 1、2026-03-09）

- **目的**: 全体ランキングを「製番単位の親順位」から「行単位の通し順位」へ投影し、生産スケジュールキオスクと納期管理キオスクが同じ順位基準を参照できるようにする
- **方針**:
  - 既存 `processingOrder`（資源CD別の実行順）は維持
  - 新設 `globalRank`（行単位全体順位）は読み取り専用で表示
  - フィルタ（製番/資源CD）は**順位計算後の表示絞り込み**とし、再ランキングしない
- **追加データモデル**:
  - `ProductionScheduleGlobalRowRank`（`csvDashboardRowId` ごとの `globalRank` スナップショット）
- **実装ポイント**:
  - `row-global-rank-generator.service.ts` で行単位順位を生成（製番順位 -> 部品優先 -> 工順 -> ProductNo）
  - `due-management-global-rank.service.ts` の保存処理後に再生成を実行（manual/auto双方）
  - `GET /api/kiosk/production-schedule` に `globalRank` を追加
  - 生産スケジュール画面に `全体順位` 列を追加し、既存 `順番` は `資源順番` に改称
- **検証**:
  - APIユニットテスト（query / generator）
  - API統合テスト（kiosk-production-schedule）
  - `apps/api` lint/build、`apps/web` lint

### デプロイ・実機検証（B第6段階 Phase 1）

- **初回デプロイ**: `--limit "server:kiosk"` で Pi5 + Pi4 を並列実行。Pi5 フェーズ完了後に Pi4 キオスクフェーズでハング（`TASK [common : Ensure repository parent directory exists]` で応答停止）
- **復旧**: [deploy-status-recovery.md](../runbooks/deploy-status-recovery.md) の「Pi4デプロイハング時の復旧手順」に従い、ハングプロセス kill → ロック削除 → Pi4 を単体で `--limit "raspberrypi4"` / `--limit "raspi4-robodrill01"` により再デプロイ
- **デプロイ結果（初回復旧）**: Run ID `20260309-165843-1497`（raspberrypi4）、`20260309-170927-5242`（raspi4-robodrill01）、両端末とも `state: success`
- **2回目デプロイ（1台ずつ順番実施）**: ブランチ `feat/global-row-rank-phase1` で、Pi5 → raspberrypi4 → raspi4-robodrill01 の順に `--limit` で1台ずつデプロイ。Run ID `20260309-180244-10720`（Pi5、約2.7分）、`20260309-180529-15837`（raspberrypi4、約9.3分）、`20260309-181644-11063`（raspi4-robodrill01、約4.0分）、3台とも `state: success`。推奨運用は [deployment.md](../guides/deployment.md) の「1台ずつ順番デプロイ」を参照
- **実機検証**: [deploy-status-recovery.md](../runbooks/deploy-status-recovery.md) の「3. 実機検証チェックリスト」を実施。APIヘルス、deploy-status（両Pi4で `isMaintenance: false`）、キオスクAPI、納期管理API（triage・daily-plan・global-rank・global-rank/proposal・global-rank/learning-report）、サイネージAPI、backup.json、マイグレーション（43件）、Pi4/Pi3サービス稼働を確認
- **トラブルシューティング**: Pi4 ハングの詳細は [KB-300](../infrastructure/ansible-deployment.md#kb-300-pi4デプロイ時のキオスクフェーズハングserverkiosk-並列実行時) を参照

### 知見（B第6段階）

- **意味分離が重要**: `全体順位`（全体最適の参照）と `資源順番`（現場実行順）は目的が異なるため、同一列へ統合しない方が運用上安全
- **保存型が有効**: 行単位順位をスナップショット保存することで、将来の「直近数日の妥当性評価」に再現性を持たせやすい

### 現場リーダー向け機能説明（全体順位 Phase 1）

**対象読者**: 納期管理画面を使う現場リーダー、生産スケジュール画面を使うオペレーター

#### 全体順位とは

- **全体順位（保存値）**は、拠点内の全工程行を「納期・製番・部品・工順」で並べたときの**通し順位**（1, 2, 3, …）です
- リーダーが納期管理で決めた「今日の計画順」や「全体ランキング」を、**行単位**に展開したものです
- **生産スケジュール画面の表示**は、資源CDフィルタ中のみ「表示対象内での連番（1..N）」を表示します（保存値は保持）

#### リーダーのワークフローとの関係

1. **納期管理画面**で「今日判断候補（トリアージ）」から製番を選択
2. 「**今日の計画順**」で上下矢印で順位を編集し、**保存**ボタンを押す
3. （オプション）「**全体ランキング**」の「自動生成して保存」で提案順位を反映
4. 保存が成功すると、**行単位の全体順位**が自動で再計算・保存される
5. **生産スケジュール画面**の「全体順位」列に、同じ順位が表示される

→ オペレーターは生産スケジュール画面で、リーダーが決めた順位をそのまま参照できます。

#### 画面ごとの表示

| 画面 | 表示内容 |
|------|----------|
| **納期管理** | 「全体ランキング（親）」で製番単位の順位を閲覧。「今日の計画順」で編集・保存 |
| **生産スケジュール** | 「**全体順位**」列で行単位の通し順位を閲覧（読み取り専用） |

#### 全体順位と資源順番の違い

| 項目 | 全体順位 | 資源順番 |
|------|----------|----------|
| **意味** | 拠点全体での優先順（リーダーが決めた順） | 各資源CD（加工機）ごとの実行順 |
| **編集** | 読み取り専用（納期管理で決める） | 編集可能（現場で調整） |
| **用途** | 全体最適の参照・オペレーターへの指示 | 現場の実行順の調整 |

#### 運用上の注意

- 資源CDフィルタ中は、オペレーターが作業順として使いやすいように、**全体順位表示を表示対象内で1..Nに再採番**する（保存値は変更しない）
- 資源CDフィルタ中は、**行の並び順も表示順位（1..N）で昇順ソート**し、1, 2, 3… の順で表示する（2026-03-11 補正）
- 登録製番（検索条件）を起点に研削/切削で表示範囲を絞っている場合も、**表示対象内の表示順位として1..Nに再採番**してソートする（保存値は変更しない）
- 資源CDフィルタを外すと、保存されている全体通し順位の表示に戻る
- 納期管理で「今日の計画順」や「全体ランキング」を保存した直後に、生産スケジュールの「全体順位」列が更新される

### 実績工数列の表示拡張（2026-03-11）

- **方針**: 単純平均は採用せず、実績工数CSV特徴量（`中央値` / `p75` / 件数）から導く値のみをUIへ表示
- **生産スケジュール**:
  - `実績基準時間(分/個)`: `p75PerPieceMinutes`（未定義時は中央値）
  - `実績推定工数(分)`: `実績基準時間(分/個) × ロット数`
- **納期管理（製番一覧・全体ランキング・部品表）**:
  - `実績推定工数(分)` と `実績カバー率(%)` を追加
  - 部品表に `実績基準時間(分/個)` と `実績推定工数(分)` を追加
- **命名ルール**:
  - 単価指標は `分/個` を列名に明示
  - 製番・部品合算値は `分` を列名に明示

### 実績工数列の整合化（2026-03-11 追補）

- **背景**:
  - 生産日程CSV（Gmail取得）には `FSEZOSIJISU` が存在せず、`実績推定工数(分)` は定義不能だった
  - `実績基準時間(分/個)` は `FHINCD + FSIGENCD` の厳密一致のみだと欠損が多かった（例: `26M` vs `25M/27M`）
- **仕様修正**:
  - 生産スケジュール画面から `実績推定工数(分)` 列を廃止
  - 納期管理画面も `実績推定工数(分)` 表示を廃止し、`実績カバー率(%)` と `実績基準時間(分/個)` を維持
  - `actualHoursScore` は数量依存推定を使わず、カバー率とサンプル信頼度で評価
- **実装**:
  - `ActualHoursFeatureResolver` を新設し、`strict一致 -> 手動マッピング一致` の順で探索
  - `ProductionScheduleResourceCodeMapping` を追加し、管理コンソールから `resource-code-mappings` を設定可能化
  - 生産スケジュール/納期管理の両APIを resolver 経由に統一
- **運用ルール**:
  - 資源CD不一致は自動推定しない（必ず管理コンソールで明示マッピング）
  - 誤マッピング防止のため、`fromResourceCd -> toResourceCd` は優先順付きで管理する

### 実績工数列の整合化 デプロイ・実機検証（2026-03-11）

- **デプロイ**: ブランチ `feat/global-rank-resource-local-display`。Pi5 → raspberrypi4 → raspi4-robodrill01 の順に `--limit` で1台ずつ実行（Run ID `20260311-142346-26409` / `20260311-142902-25781` / `20260311-143429-2874`）。合計約13分。
- **実機検証結果**（[deploy-status-recovery.md](../runbooks/deploy-status-recovery.md) のチェックリスト準拠）:
  - APIヘルス: 200 OK / `status: ok`（メモリ89.6%警告は既知の環境要因）
  - deploy-status: 両Pi4で `isMaintenance: false`
  - キオスクAPI・生産スケジュールAPI・納期管理API（triage・daily-plan・global-rank・global-rank/proposal・global-rank/learning-report・actual-hours/stats）: すべて 200
  - 生産スケジュールAPI: `actualPerPieceMinutes`（実績基準時間）返却確認、`actualEstimatedMinutes` は廃止済み
  - actual-hours/stats: `totalRawRows`, `totalCanonicalRows`, `totalFeatureKeys`, `topFeatures` 返却確認
  - resource-code-mappings: `GET /api/production-schedule-settings/resource-code-mappings` は管理画面用のため認証必須。未認証で 401 が返るのは想定どおり（エンドポイント存在確認として有効）
  - サイネージAPI: 200、layoutConfig 含む
  - backup.json: 存在・15K
  - マイグレーション: 48件、up to date
  - Pi4/Pi3サービス: 両Pi4で kiosk-browser.service / status-agent.timer が active、Pi3 signage-lite が active
- **知見**: 実機検証チェックリストは [deploy-status-recovery.md](../runbooks/deploy-status-recovery.md) を参照。管理API（resource-code-mappings）は JWT 認証必須のため、キオスク検証では 401 応答でエンドポイント存在を確認する運用で可。

### 全体順位 ソート補正（2026-03-11）

- **事象**: 資源CDフィルタ時に表示順位は1..Nに再採番されていたが、**行の並び順がその順位に従っていなかった**（実機検証で判明）
- **修正**: `displayRows` を表示順位（1..N）で昇順ソートするように変更（`displayRank.ts` / `ProductionSchedulePage.tsx`）
- **デプロイ**: Pi5 → raspberrypi4 → raspi4-robodrill01 の順に1台ずつ実行（Run ID: `20260311-082311` / `20260311-082345` / `20260311-083018`）
- **実機検証**: 資源CD押下後、1から順位付けされ、ソートもその順位基準になっていることを確認済み
- **知見**: 表示順位の再採番と行ソートは別実装であり、両方を揃える必要がある

### B第7段階（実績工数CSV連携 + 全体ランキング連携、2026-03-10）

- **実装概要**:
  - `ProductionScheduleActualHoursRaw` / `ProductionScheduleActualHoursCanonical` / `ProductionScheduleActualHoursFeature` を導入し、Raw保存（append-only）とCanonical正規化（winner選定）と特徴量集約を責務分離
  - Gmail CSV取込フローに `productionActualHours` ターゲットを追加し、既存スケジューラ経由で月次自動取込できるように拡張
  - 取込後に Canonical を再構築し、`FHINCD × FSIGENCD` 単位で `中央値 + 件数 + p75` を再集約（除外条件: 直近30日、0工数、明確な外れ値）
  - 全体ランキングスコアへ `actualHoursScore` を追加し、上位重みの一要素として反映（単独決定因子にはしない）
- **追加API**:
  - `POST /api/kiosk/production-schedule/due-management/actual-hours/import`（手動CSV投入 + 再集約）
  - `GET /api/kiosk/production-schedule/due-management/actual-hours/stats`（集約キー件数・上位特徴量の確認）
- **運用メモ**:
  - Gmailの月次自動取込は `csvImports.targets[].type = productionActualHours` で設定し、`metadata.locationKey` でロケーションを明示できる
  - CP932 CSVを自動判別し、UTF-8と混在しても取り込み可能
  - Raw fingerprint は source非依存（`sourceFileKey` を重複判定に含めない）へ変更し、同一データの再送時に不要な増加を抑制
  - Canonical winner は `workDate > raw.updatedAt > raw.createdAt > rawId` の優先順で決定（明示更新時刻が無いCSVに対応）
  - 特徴量が不足する製番は既存ロジックへフォールバックするため、既存運用を破壊しない
  - **Canonical差分化（2026-03-10 実装完了）**: Raw append-only + Canonical winner選定 + Feature再集約へ責務分離。`ActualHoursImportOrchestratorService` で手動APIとスケジューラを統合。既存Rawからのバックフィルは [actual-hours-canonical-backfill.md](../runbooks/actual-hours-canonical-backfill.md) を参照

### B第7段階デプロイ・実機検証（2026-03-10）

- **デプロイ**: Pi5 → raspberrypi4 → raspi4-robodrill01 の順に `--limit` で1台ずつ実行（Run ID `20260310-154937-13894` / `20260310-155444-12790` / `20260310-155947-3485`）。推奨運用は [deployment.md](../guides/deployment.md) の「1台ずつ順番デプロイ」を参照。
- **実機検証結果**:
  - APIヘルス: 200 OK / `status: ok`（メモリ87.6%警告は既知）
  - deploy-status: 両Pi4（raspberrypi4・raspi4-robodrill01）で `isMaintenance: false`
  - キオスクAPI: `/api/tools/loans/active` 200（両Pi4）
  - 納期管理API: triage / daily-plan / global-rank / global-rank/proposal / global-rank/learning-report / summary すべて 200
  - 実績工数API: `GET /api/kiosk/production-schedule/due-management/actual-hours/stats` 200（`totalRawRows`, `totalCanonicalRows`, `totalFeatureKeys`, `topFeatures` 返却）
  - サイネージAPI: `/api/signage/content` 200、`layoutConfig` 含む
  - backup.json: 存在・15K
  - マイグレーション: 45件適用済み、スキーマ最新
  - Pi4サービス: raspberrypi4・raspi4-robodrill01 ともに kiosk-browser.service / status-agent.timer が active
  - Pi3 signage: `tailscale status` で offline のため SSH タイムアウト、signage-lite 確認は未実施（スキップ可能）
- **知見**:
  - `actual-hours/stats` はCSV未取込時 `totalRawRows: 0`, `totalCanonicalRows: 0`, `totalFeatureKeys: 0`, `topFeatures: []` を返す（想定どおり）。Gmail月次取込または `POST /actual-hours/import` で手動投入後に再集約され、特徴量が反映される
  - 実機検証チェックリストは [deploy-status-recovery.md](../runbooks/deploy-status-recovery.md) の「3. 実機検証チェックリスト」を参照
  - **本番DBバックフィル**: Deploy後に既存RawをCanonical/Featureへ反映する場合は [actual-hours-canonical-backfill.md](../runbooks/actual-hours-canonical-backfill.md) を参照。実行順序は「コミット→CI→Deploy→バックフィル」
  - **大容量CSV手動投入**: 約 6MB 超の一括送信で `413 Payload Too Large` になる。約 25 万文字ごとに分割して順次投入で回避（[KB-301](../knowledge-base/api.md#kb-301-実績工数csv手動投入で-413-payload-too-large-になる)）。CP932 の CSV は `iconv -f CP932 -t UTF-8` で変換してから投入
  - **locationKey**: デフォルトは `default`。client-key の location に紐づく。Gmail 取込の `metadata.locationKey` で指定可能
  - **Pi3 offline**: `tailscale status` で offline の場合、SSH がタイムアウトする。実機検証時は Pi3（signage）のサービス確認をスキップ可能

### B第7段階 CSV取り込み・バックフィル結果（2026-03-10）

- **本番DBバックフィル**: 初回は Raw が 0 件のため、Canonical/Feature も 0 件（想定どおり）
- **手動CSV取り込み**: `data_20210101_20221231.csv`（6.4MB）、`data_20230101_20241231.csv`（5.5MB）を分割投入（48チャンク、約25万文字/チャンク）で実施
- **結果**: `totalRawRows: 205766`, `totalCanonicalRows: 146644`, `totalFeatureKeys: 10436`

### 全端末共有優先順位（Mac対象ロケーション指定）デプロイ・実機検証（2026-03-10）

- **実装概要**: `global-rank` API に `targetLocation` / `rankingScope`（`globalShared` / `locationScoped` / `localTemporary`）を拡張。`ProductionScheduleGlobalRankTemporaryOverride` テーブルを追加。Mac から対象拠点を明示指定可能。移行手順は [mac-target-location-migration.md](../runbooks/mac-target-location-migration.md) を参照。
- **デプロイ**: Pi5 → raspberrypi4 → raspi4-robodrill01 の順に `--limit` で1台ずつ実行（Run ID `20260310-193632-10428` / `20260310-194407-20877` / `20260310-195055-32546`）。ブランチ `feat/due-mgmt-actual-hours-pipeline`。
- **実機検証結果**:
  - APIヘルス: 200 OK / `status: ok`
  - deploy-status: 両Pi4で `isMaintenance: false`
  - 納期管理API: triage / daily-plan / global-rank / global-rank/proposal / global-rank/learning-report / actual-hours/stats すべて 200
  - **global-rank targetLocation/rankingScope**: `GET /global-rank` で `targetLocation`, `actorLocation`, `rankingScope` 返却確認。`?targetLocation=第2工場&rankingScope=globalShared` および `rankingScope=localTemporary` で Mac 向けシナリオ動作確認
  - マイグレーション: 46件適用済み、未適用なし
  - Pi4サービス: 両端末で kiosk-browser.service / status-agent.timer が active
  - Pi3 signage: offline のためスキップ（deploy-status-recovery.md に準拠）
- **2回目デプロイ（feature flag 本番制御経路）**: `VITE_KIOSK_TARGET_LOCATION_SELECTOR_ENABLED` を web.env.j2 / Dockerfile.web / docker-compose.server.yml に追加（既定 `true`）。Pi5 → raspberrypi4 → raspi4-robodrill01 の順に1台ずつ実行（Run ID `20260310-205506-28891` / `20260310-205946-5022` / `20260310-210522-15455`）。実機検証: APIヘルス、deploy-status、納期管理API、global-rank targetLocation/rankingScope、Pi4サービス稼働を確認。feature flag の無効化は inventory / host_vars で `web_kiosk_target_location_selector_enabled: false` を指定可能（[mac-target-location-migration.md](../runbooks/mac-target-location-migration.md) 参照）。

### 全体順位表示拡張と実績工数列追加・デプロイ・実機検証（2026-03-11）

- **実装概要**:
  - **全体順位表示拡張**: 資源CDだけでなく、登録製番＋研削/切削フィルタ時も表示順位を 1..N に再採番するよう拡張。`isDisplayRankContext` を導入し、`isResourceRankFilterActive` を拡張（`ProductionSchedulePage.tsx`）
  - **実績工数列追加**: 生産スケジュールに `実績基準時間(分/個)`・`実績推定工数(分)` を追加。納期管理の全体ランキング・製番一覧・部品表に `実績推定工数(分)`・`実績カバー率(%)` を追加
- **デプロイ**: ブランチ `feat/global-rank-resource-local-display`。Pi5 → raspberrypi4 → raspi4-robodrill01 の順に `--limit` で1台ずつ実行（Run ID `20260311-090951-8646` / `20260311-091447-18995` / `20260311-092307-13455`）。合計約13分
- **実機検証結果**（[deploy-status-recovery.md](../runbooks/deploy-status-recovery.md) のチェックリスト準拠）:
  - APIヘルス: 200 OK / `status: ok`
  - deploy-status: 両Pi4で `isMaintenance: false`
  - キオスクAPI・生産スケジュールAPI・納期管理API（triage・daily-plan・global-rank・global-rank/proposal・global-rank/learning-report・actual-hours/stats）: すべて 200
  - global-rank: `targetLocation`, `actorLocation`, `rankingScope` 返却確認
  - actual-hours/stats: `totalRawRows`, `totalCanonicalRows`, `totalFeatureKeys`, `topFeatures` 返却確認
  - サイネージAPI: 200、layoutConfig 含む
  - backup.json: 存在・15K
  - マイグレーション: 46件、up to date
  - Pi4/Pi3サービス: 両Pi4で kiosk-browser.service / status-agent.timer が active、Pi3 signage-lite が active

### 進捗同期スコープ分離（2026-03-11）

- **背景**:
  - 日程更新用CSVと進捗管理用CSVのメール件名が同一で、従来実装では生産日程CSV取り込み時に `progress_sync` が一律で走り得た
  - `progress` 列が無いCSVでも `undefined -> '' -> isCompleted=false` と解釈され、手動完了の意図しない上書きリスクがあった
- **実装方針**:
  - `ProgressSyncEligibilityPolicy` を追加し、`progress` 列がマッピングされるCSVだけ `progress_sync` 対象に限定
  - `CsvDashboardIngestor` で同期前に判定し、対象外は取り込み成功のまま同期だけスキップ（理由をログ出力）
  - `ProgressSyncFromCsvService` に `hasProgressColumn` ガードを追加し、防御的に二重ガード
- **影響範囲**:
  - 日程更新用CSV（`progress` 列なし）: `ProductionScheduleProgress` を更新しない
  - 進捗管理用CSV（`progress` 列あり）: 従来どおり `updatedAt` 比較で新しいもののみ反映
  - ProductNo繰り上がり判定および DEDUP 挙動には影響しない
- **検証**:
  - `progress-sync-from-csv.service.test.ts`: `hasProgressColumn=false` で同期しないことを追加確認
  - `progress-sync-eligibility.policy.test.ts`: 生産日程＋`progress` 列有無の判定を追加確認

### 進捗同期スコープ分離・デプロイ・実機検証（2026-03-11）

- **デプロイ**: ブランチ `feat/global-rank-resource-local-display`、Pi5 → raspberrypi4 → raspi4-robodrill01 の順に1台ずつ実行（Run ID `20260311-115254-25003` / `20260311-115759-20603` / `20260311-120301-28447`）、約13分。
- **実機検証結果**:
  - APIヘルス: 200 OK / `status: ok`
  - deploy-status: 両Pi4で `isMaintenance: false`
  - キオスクAPI: loans/active・production-schedule 200
  - 納期管理API: triage・daily-plan・global-rank・actual-hours/stats 200
  - サイネージAPI: 200、layoutConfig 含む
  - backup.json: 存在・15K
  - マイグレーション: 46件、up to date
  - Pi4/Pi3サービス: 両Pi4で kiosk-browser.service / status-agent.timer が active、Pi3 signage-lite が active
- **知見**: 今回の変更はAPIのみ（DBスキーマ変更なし）のため、デプロイ対象は Pi5 のみでも十分。運用標準に従い Pi5 + Pi4×2 を1台ずつ順番デプロイした。
- **運用注意**: 日程更新用CSV（`progress` 列なし）を取り込んでも `ProductionScheduleProgress` は更新されない。進捗管理用CSV（`progress` 列あり）のみ同期対象。

### ロケーション間同期共有化（納期・備考・表面処理、2026-03-11）

- **背景**:
  - `完了status`（`ProductionScheduleProgress`）は location 非依存で同期される一方、`納期` / `備考` / `表面処理` は location 依存モデルで保持していたため、Mac と第2工場で値が分岐していた。
  - 現場要件として、上記3項目は端末・拠点を跨いで同一値を参照できる必要があった。
- **実装方針**:
  - 同期ジョブ追加ではなく、`ProductionScheduleRowNote` / `ProductionScheduleSeibanDueDate` / `ProductionSchedulePartProcessingType` を **shared（location 非依存）** に移行。
  - 競合解決は **Last-Write-Wins（`updatedAt` 優先）** を採用し、migration で重複データを畳み込み。
  - route 契約（APIパス・入力）は維持し、内部永続化のみ shared repository 経由へ差し替え。
- **実装詳細**:
  - Prisma migration `20260311133000_make_schedule_fields_shared` を追加。
  - `shared-schedule-fields.repository.ts` を新設し、write/read の共通永続化責務を集約。
  - `production-schedule-query` / `due-management-query` / `due-management-triage` で note/dueDate/processingType の location 絞り込みを除去。
  - `due-management-global-rank-auto` の「納期設定済み製番」判定も shared dueDate を参照するよう更新。
- **検証**:
  - API統合テスト `kiosk-production-schedule.integration.test.ts` にロケーション間共有回帰を追加（`row note/processing/dueDate`、`due-management dueDate/note/processing`）。
  - 実行結果: `49 passed`。
  - lint: `apps/api` / `apps/web` ともに成功。
- **デプロイ・実機検証（2026-03-11）**:
  - **デプロイ**: Pi5 → raspberrypi4 → raspi4-robodrill01 の順に1台ずつ実行（Run ID `20260311-124752-19099` / `20260311-125302-686` / `20260311-125806-26510`）、約13分。
  - **実機検証結果**: APIヘルス（`status: degraded`、メモリ96.1%は既知の環境要因）、deploy-status（両Pi4で `isMaintenance: false`）、キオスクAPI、生産スケジュールAPI、納期管理API（triage・daily-plan・global-rank・global-rank/proposal・global-rank/learning-report・actual-hours/stats）、global-rank の `targetLocation`/`actorLocation`/`rankingScope` 返却、actual-hours/stats の `totalRawRows`/`totalCanonicalRows`/`totalFeatureKeys`/`topFeatures` 返却、サイネージAPI（layoutConfig 含む）、backup.json（15K）、マイグレーション（47件、up to date）、Pi4/Pi3サービス（kiosk-browser.service / status-agent.timer / signage-lite すべて active）を確認。チェックリストは [deploy-status-recovery.md](../runbooks/deploy-status-recovery.md) を参照。

### 全体ランキング自動調整（安全ガード付き、2026-03-14）

- **目的**:
  - 全体ランキング（工程/行の実行順）を、日次で自動改善する。
  - 人手は最小化しつつ、悪化時は自動ロールバックする。
- **実装概要**:
  - `auto-tuning` モジュールを追加（候補生成 / 評価 / ガード / ロールバック / 日次オーケストレーション）。
  - スコア計算は既存 `due-management-scoring.service` を維持し、調整値（重み + 閾値）だけ外部化。
  - 安定版パラメータ・履歴・失敗履歴をDBへ保存:
    - `ProductionScheduleDueManagementTuningStableSnapshot`
    - `ProductionScheduleDueManagementTuningHistory`
    - `ProductionScheduleDueManagementTuningFailureHistory`
  - 既存決定イベントに `reasonCode`（選択式5項目）を追加し、手動微調整理由を記録可能化。
- **運用仕様（初期値）**:
  - 実行頻度: 1日1回（`DUE_MGMT_TUNING_CRON`, 既定 `15 2 * * *`）
  - 対象ロケーション: `DUE_MGMT_TUNING_LOCATIONS`（CSV指定）
  - 採用条件: 連続改善回数が閾値以上（`DUE_MGMT_TUNING_IMPROVEMENT_STREAK_REQUIRED`）
  - 特殊日除外: 明示日付（`DUE_MGMT_TUNING_EXCLUDED_DATES`）と週末除外（`DUE_MGMT_TUNING_EXCLUDE_WEEKENDS`）
  - 安全ガード: 重み変動量上限（`DUE_MGMT_TUNING_MAX_WEIGHT_DELTA`）
  - 失敗時: 直前安定版へ自動ロールバックし、失敗履歴に記録
- **互換性**:
  - API契約は維持（`/global-rank`, `/global-rank/auto-generate`）。
  - 手動並べ替えUIは維持。理由コードは任意入力（未指定でも従来動作）。
- **デプロイ・実機検証（2026-03-14）**:
  - **デプロイ**: ブランチ `feat/global-rank-auto-tuning-v1`、Pi5 → raspberrypi4 → raspi4-robodrill01 の順に1台ずつ実行、約12分。
  - **実機検証結果**: リモート自動チェック全項目合格（APIヘルス、deploy-status両Pi4、キオスクAPI、納期管理API、global-rank/proposal、PUT auto-generate、actual-hours/stats、サイネージAPI、backup.json、マイグレーション、Pi4×2・Pi3サービス）。Pi5 APIコンテナログで `Due management auto-tuning scheduler started` を確認。チェックリストは [deploy-status-recovery.md](../runbooks/deploy-status-recovery.md) を参照。
