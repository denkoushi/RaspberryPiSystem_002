---
title: KB-297: キオスク納期管理（製番納期・部品優先・切削除外設定）の実装
tags: [production-schedule, kiosk, due-management, priority]
audience: [開発者, 運用者]
last-verified: 2026-03-10
related:
  - ../decisions/ADR-20260307-kiosk-due-management-model.md
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
  - due-management seiban detail: `machineName`・`parts[].processes[]`（resourceCd, isCompleted）・`completedProcessCount`/`totalProcessCount` を確認
  - deploy-status: 両Pi4で `isMaintenance: false`
  - Pi4サービス: raspberrypi4・raspi4-robodrill01 ともに kiosk-browser.service / status-agent.timer が active
  - backup.json: 存在・15K
  - サイネージAPI: `/api/signage/content` layoutConfig 正常

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
