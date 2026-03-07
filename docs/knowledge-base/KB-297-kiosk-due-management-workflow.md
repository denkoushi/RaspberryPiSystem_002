---
title: KB-297: キオスク納期管理（製番納期・部品優先・切削除外設定）の実装
tags: [production-schedule, kiosk, due-management, priority]
audience: [開発者, 運用者]
last-verified: 2026-03-07
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
