# 切削の指示数を片に分け、製番ボードで順番と完了を管理する


この ExecPlan は生きた文書である。実装時は `.agent/PLANS.md` に従い、`Progress`、`Surprises & Discoveries`、`Decision Log`、`Outcomes & Retrospective` を更新する。本文のパスはリポジトリルートからの相対パスである。

本書の作業場所は `/Users/tsudatakashi/RaspberryPiSystem_002-worktrees/feat--sessaku-split-pieces`。2026-11-05 の依頼は調査と本書作成までであり、実装、commit、push、PR 作成、merge、release、deploy は未承認である。今回の唯一の書き込み先は本書とする。索引追加も今回は行わない。秘密情報や `.env` は読まない。将来の実装者も、その時点で承認された段階までにとどめる。

## Purpose / Big Picture


現場で、指示数5の工程を数量2と3の片に分け、2を先に加工して済みにし、別アイテムを間に挟んでから残り3に戻れるようにする。製番ボードで片ごとの位置と完了を操作でき、後工程の「着」、配膳、照合から見た工程全体の完了は全片が済むまで成立しない。

「片」は一つの通常アイテムの数量の一部であり、新しい生産指示や別工程ではない。「論理キー」は FSEIBAN（製番）、FHINCD（品番）、FSIGENCD（元資源CD）、FKOJUN（工程順）の組である。片は取り込みで入れ替わる CSV 行 ID ではなく、この組に属する。「投影」は保存データから画面の表示アイテムを作る処理をいう。「実効完了」は手動の済み、または取り込みの C/X による完了である。

未分割アイテムと順位ボードは従来の親1行を維持する。変更対象は、旧分割の撤去と、新しい片を製番ボードにだけ表示・操作する経路である。別機能を片対応に作り直すことや、旧テーブルの削除は含まない。

## Progress


- [x] (2026-11-05 JST) 入口ルール、`.agent/PLANS.md`、関連品質・Git・ドキュメント・UI・境界ルールを確認した。開始時の `git status --short` と `git diff --stat` は出力なしで、既存 WIP はなかった。
- [x] (2026-11-05 JST) 製番ボード投影・順番・完了、ガント、着、補助CSV同期、旧分割の参照経路を読み取り調査した。
- [x] (2026-11-05 JST) PR ごとの安全境界、Prisma 定義案、API、競合・同期規則、検証案を本書に記録した。
- [ ] 実装前の保留事項を解決する。段取り時間の値と設定粒度、未採番製番の対象範囲を確定する。
- [ ] PR1 相当の旧分割撤去を実装し、対象検証を行う。
- [ ] PR2 相当の保存・API・投影・完了・取り込み同期を実装し、独立デプロイの互換性を検証する。
- [ ] PR3 相当の製番ボード画面と前向きガントを実装し、数量5→2+3の業務シナリオを検証する。
- [ ] integrationPending: 各 PR の作成、push 済み SHA、checks、main の merge SHA と CI、稼働確認は、その段階の明示依頼後に別々に記録する。現在は全て未実施。

## Surprises & Discoveries


旧分割には片の完了列がない。`apps/api/prisma/schema.prisma` の `ProductionScheduleOrderSplit` は行 ID の FK と Cascade を持ち、投影 `buildItems` は全片に親の `rowCompleted` を設定する。そのため旧コードの延長では「2だけ済み」を表せない。

フラグ OFF は旧分割の処理が無いことを意味しない。`leaderboard-shell-snapshot-generation.ts` は旧片の件数・更新日時を常時読み、`source.ts` と shell hydrate は旧片を取得する。`grinding-planning-board-due-scope.service.ts`、順位の使用番号・解放・競合処理、補助CSV同期にも無条件参照がある。撤去の受入条件は画面のボタン消去だけでは足りない。

補助CSVの `allocateSplitQuantities` は、各片を最低1にした上で数量比と端数順によって再配分する。さらに `prepareSplitQuantityReconcileForSupplementUpdate` は winner（同じ論理キーのうち表示の正本に選ばれた行）が変わると `keepPreviousParent: true` によって supplement を旧行へ残す。どちらも今回の仕様に適合せず、引き継がない。

ガントは `FSIGENSHOYORYO` を所要分として読む。対象モジュール内の `setupMinutes`、`setupTime`、`段取` 検索に該当はなく、`buildForwardPlanningBoardGanttLayout` は `placeForward(..., item.requiredMinutes, ...)` としている。`planningBoardAutoOrder` も別経路で同じ分を使うため、描画だけの修正では提案順の評価が食い違う。

`forwardPlanningBoardPredecessors` は品番内を工程順と itemId で直列につなぐ。同一工程の片を渡すだけでは片間に偽の前工程依存ができる。全片終了時刻を前工程の終了とする工程単位の依存へ変更する必要がある。

通常製番の論理キーは4列だが、`buildGrindingPlanningBoardLogicalKey` と winner SQL は未採番製番 `********` に ProductNo を加える。新しい片の4列キーを無断で5列に変えることはしない。この例外の扱いは Decision Log に保留を残す。

完了の実効値は単なる `rowData.FKOJUNST` 判定ではない。`production-schedule-effective-completion.sql.ts` は Progress OR ExternalCompletion を使い、現行の外部完了正本は `FKOJUNST_Status` メールCSVの C/X である。メールキー消失・生産日程CSV消失による完了は廃止済みなので復活させない。

## Decision Log


- Decision: 通常アイテムの4列論理キーに、全端末共通の子として片を保存する。行 ID の FK にしない。
  Rationale: ユーザー確定事項1。再取り込み後も分け方を失わず、元資源CDをキーとし代替資源はキーにしない。
  Date/Author: 2026-11-05 / ユーザー確定、調査担当記録。
- Decision: 片は正整数数量と済みを持ち、多数への分割、未済み片の再分割、未済み片同士の結合を許す。未分割アイテムは片0件とする。
  Rationale: ユーザー確定事項2。済み片の実績数量を分割・結合で書き換えない。
  Date/Author: 2026-11-05 / ユーザー確定、調査担当記録。
- Decision: 分け方と完了は全端末共通、表示位置は既存の siteKey 別 override の alternateRank に片 ID を載せる。新しい独立順位表は作らない。
  Rationale: ユーザー確定事項3。全端末共通の末尾判定と場所ごとの画面順を分離する。
  Date/Author: 2026-11-05 / ユーザー確定、調査担当記録。
- Decision: キオスクは片ごとに完了でき、外部 C/X は全片の実効完了とする。片がある親の Progress.isCompleted は全片の実効完了に同期する。配膳・照合など読み手の契約は変えない。
  Rationale: ユーザー確定事項4。行単位の既存読み手へ同じ結果を供給する。
  Date/Author: 2026-11-05 / ユーザー確定、調査担当記録。
- Decision: 後工程の「着」は全片完了で成立する。`process-arrival.service.ts` の行単位判定と配膳済み等の既存例外は維持する。
  Rationale: ユーザー確定事項5（PR #2554 の判定）。着の読み側で片を独自集計しない。
  Date/Author: 2026-11-05 / ユーザー確定、調査担当記録。
- Decision: 指示数差分は共通の片順の最後の未済み片で吸収し、減少は後ろの未済み片から減らし0を削除する。済み合計超過時は数量を変えず警告を保存し赤枠にする。
  Rationale: ユーザー確定事項6。場所別 alternateRank は同期の末尾判定に使わない。
  Date/Author: 2026-11-05 / ユーザー確定、調査担当記録。
- Decision: 前向きガントは片ごとに棒を出す。加工時間を数量比で按分し、段取りを片ごとに加えるが同一資源の実行順の直前が同じ論理親の片なら加えない。
  Rationale: ユーザー確定事項7。別アイテムを挟むと再段取りが必要になる。
  Date/Author: 2026-11-05 / ユーザー確定、調査担当記録。
- Decision: 片の画面は製番ボードだけとする。順位ボードの表示・件数・自己検査導線は親1行を維持する。
  Rationale: ユーザー確定事項8。旧分割の順位ボード展開を新機能へ流用しない。
  Date/Author: 2026-11-05 / ユーザー確定、調査担当記録。
- Decision: 指示数の枠から −/＋ の小窓と「分ける」、複数片時の「まとめる」を開く。片ごとに完了ボタン、数量の横に「／元の指示数」、細い割合帯を出す。補助ラベル・説明文を追加しない。
  Rationale: ユーザー確定事項9。内部用の piece/version/logicalKey を画面文言にしない。
  Date/Author: 2026-11-05 / ユーザー確定、調査担当記録。
- Decision: 旧分割の4モデルと migration 履歴は残す。コード・旧フラグ・画面・API・実行時 SQL 参照を PR1 で撤去し、旧データを自動移行しない。
  Rationale: 旧機能は本番 OFF で廃棄可能とのユーザー決定。ただしテーブル削除は後日の明示承認と別 migration が必要。
  Date/Author: 2026-11-05 / 調査担当提案。
- Decision: 3 PR とし、PR2 の新規分割作成は新しいサーバー側導入ゲートで既定 OFF にする。既存クライアント向け GET は親応答を維持し、新クライアントだけ明示的に片応答を要求する。
  Rationale: PR2 と旧画面、PR3 と残存端末キャッシュが混在しても親完了の整合を保つ。既存片の読み取り・結合・完了はゲート OFF でも止めない。
  Date/Author: 2026-11-05 / 調査担当提案。
- Decision: 外部完了は手動済みを破壊しない上書き表示とする。外部 C/X 解除時は手動済みを再表示し、親 Progress も再計算する。外部完了中の手動取消は409にする。
  Rationale: C/X を全片の手動 true として保存すると、取り込み訂正時に元の手動実績を復元できなくなる。
  Date/Author: 2026-11-05 / 調査担当提案。
- Decision: 既存の親完了 API は、片がある場合には全片への明示完了・全片の手動取消として同じトランザクションで処理する。未分割は従来どおり。
  Rationale: 順位ボードや古い端末から親だけ true/false が書かれる穴を塞ぎ、片を他画面へ表示せずに整合を守る。取消では全片が未済みに戻る。
  Date/Author: 2026-11-05 / 調査担当提案。全片取消の業務意味は実装レビュー時に再確認するが、片だけ残して親 false にする実装は認めない。
- Decision: 分け数 n は元数量 q を floor(q/n)、余りを末尾側から1ずつ加える決定的な数量列にする。q=5,n=2 の結果は [2,3] とする。
  Rationale: API は明示数量列を受け、UI は均等分割を組み立てる。未合意の数量入力画面を追加しない。
  Date/Author: 2026-11-05 / 調査担当提案。
- Decision: 保留: 段取り時間の正本と値の粒度。暫定案は既存 resource-capacity に資源別 setupMinutes（分、null=未設定）を追加する。数量按分の元 FSIGENSHOYORYO に段取りが含まれるかも確認する。
  Rationale: 現行ガントに値も概念も無い。架空の時間や未設定=0を本番仕様にしない。段取り加算規則は確定であり、値の取得だけが未確定。PR3 の本番有効化条件とし、テストは10分等の明示値で進められる。
  Date/Author: 2026-11-05 / 調査担当、保留。
- Decision: 保留: 未採番 `********` を新しい片の対象にするか。暫定的に既存未採番表示は維持し、新規分割だけ409で拒否する。
  Rationale: 既存は ProductNo を足すがユーザー確定キーは4列。複数の未採番指示を誤結合しないため、確認前に仕様を拡張しない。通常製番の実装は進行可能。
  Date/Author: 2026-11-05 / 調査担当、保留。

## Outcomes & Retrospective


調査と設計文書の作成を完了した。実装・テスト実行・migration 適用・PR・統合・本番反映は未実施である。旧分割の OFF 経路にも撤去対象があり、全片完了を Progress に書くだけでは、CSV progress 同期や既存親完了 API から上書きされることが分かった。本書ではそれらの書き手も同じ集約処理へ接続する。実装完了時は、数量5のシナリオ、競合、取り込み訂正、PR単独稼働の証拠をここへ追記する。

## Context and Orientation


### 製番ボードの投影と読み取り


`apps/api/src/services/production-schedule/grinding-planning-board.service.ts` は入口で、実体は同階層 `grinding-planning-board/` の `read.ts`、`source.ts`、`state.ts`、`write.ts` に分かれる。`source.ts:readPlanningSource` が winner を取り、`readRowDetails` が supplement、Progress、ExternalCompletion、旧 orderSplits を読み、`readRanks` が親 assignment と旧片 assignment を場所選好つきで解決する。

`grinding-planning-board-projection.ts:projectGrindingPlanningBoard` → `buildItems` は未分割を `kind: 'row'`、旧片がある場合は親を置換して `kind: 'split'` とする。親 itemId は `buildGrindingPlanningBoardRowItemId` による `row:<論理キーJSONのbase64url>`、旧片は `split:<旧UUID>`。旧片数量の表示・時間は `order-split/split-display-required-minutes.ts:applySplitQuantityToProductionScheduleRowDisplayFields` で按分し丸める。旧片の完了は全て親と同じである。

`buildProgressProjection` の進捗は親工程を一度だけ数える。片の数で分母を増やしてはならない。`buildLoad` は未完了表示アイテムの時間を資源別に集計する。`read.ts:getGrindingPlanningBoard` は保存済み投影に最新の着・配膳等を付ける。`state.ts:readPlanningSnapshotGenerationDetails` は shell 世代、override、board state 等でキャッシュ失効を決める。新しい片の変更は全 siteKey の世代に効かせる必要がある。

### 順番と更新の保存


`ProductionScheduleGrindingPlanningBoardState` は dashboard × siteKey の製番順 `seibanOrder` と version を持つ。`ProductionScheduleGrindingPlanningBoardOverride` は dashboard × siteKey × itemKey の unique を持ち、代替資源・納期・alternateRank・pin・version を保存する。実際のキオスクルートは `apps/api/src/routes/kiosk/production-schedule/grinding-planning-board.ts` で、端末から解決した `scope.siteKey` をサービスへ渡す。要求本文の siteKey は信用しない。

`write.ts:updateGrindingPlanningBoardRank`、`updateGrindingPlanningBoardResourceOrder`、`updateGrindingPlanningBoardResourceOrderBulk` は override を保存し、`writeOverrideIfChanged` が version を増やす。`assertItemRevision` は投影ハッシュと overrideVersion を照合し、並べ替えは `state.ts:lockState` と `assertBoardRevision` も用いる。`sortGrindingPlanningBoardProjectionItems` は資源表示・代替配置で specialDue → alternateRank 等の既存規則を適用する。新片でもこの仕組みと制約を使う。

### 完了・着・取り込み


`apps/web/src/pages/kiosk/ProductionScheduleGrindingPlanningBoardPage.tsx:toggleCompletion` は現在 `item.kind !== 'row'` を拒否する。pending と楽観表示も sourceRowId 単位であり、そのまま片へ広げると兄弟片を一括表示更新してしまう。`PlanningBoardCompletionButton.tsx:PlanningBoardCompletionButton` は import 完了を無効にする。`apps/web/src/api/domains/production-schedule/schedule.ts:setKioskProductionScheduleRowCompletion` は PUT `/kiosk/production-schedule/:rowId/completion` に明示 intent を送る。

`apps/api/src/routes/kiosk/production-schedule/complete.ts:registerProductionScheduleCompleteRoute` は上記と旧トグル PUT `/:rowId/complete` を登録する。`production-schedule-command.service.ts:driveProductionScheduleRowCompletion` が Progress を upsert し、親 assignment を解放し、学習イベントを保存する。現状はトランザクション前の Progress 読みから次値を決めるので、新片ではそのまま流用しない。

`process-arrival.service.ts:enrichRowsWithProcessArrival` は品番の全工程を取得し、`buildProcessArrivalByRowId` が除外資源以外の厳密に前の工程の未完了を見て「着」を決める。実効完了 SQL は `production-schedule-effective-completion.sql.ts:buildProductionScheduleEffectiveCompletedSql` の Progress OR ExternalCompletion。配膳済み等の既存例外は保持する。

補助CSVは `order-supplement-sync.service.ts:ProductionScheduleOrderSupplementSyncService` → `order-supplement-sync.pipeline.ts:runOrderSupplementReplacementTransaction`。ProductNo・resource・processOrder から winner に照合して `plannedQuantity` を更新する。旧分割補正は `allocateSplitQuantities`、`reconcileOrderSplitQuantitiesForSupplementUpdate`、`collectSplitParentIdsForSupplementUpdates`、`prepareSplitQuantityReconcileForSupplementUpdate` にまとまる。PR1 ではこれらを除去し、新片の補正は論理親から行う。

`csv-dashboard/csv-dashboard-ingestor.ts:CsvDashboardIngestor.ingestFromGmail` は追加・更新・重複 loser 削除を行い、完了公開トランザクションを持つ。`csv-dashboard/csv-dashboard-post-ingest.service.ts:CsvDashboardPostIngestService.runAfterSuccessfulIngest` は補助、FKOJUNST、メール状態、外部完了の後処理を振り分ける。`progress-sync-from-csv.service.ts:ProgressSyncFromCsvService.sync` も Progress の書き手であり、片がある工程へ CSV progress を直接書かせてはならない。

外部完了の `external-completion/fkojunst-external-completion-sync.repository.ts:replaceAllWinnerExternalCompletionStatesFromMailSync` と `fkojunst-status-mail-sync.pipeline.ts:runFkojunstMailReplacementTransaction` / `runFkojunstMailClearTransaction`、`external-completion/fkojunst-external-completion-sync.service.ts:FkojunstExternalCompletionSyncService.syncFromCurrentStatusMailDashboard` を、新片の完了再集約へつなぐ。単に生産日程の rowData に C が見えたことを新しい完了根拠にはしない。

### ガント


`apps/web/src/features/kiosk/grindingPlanningBoard/gantt/planningBoardGanttLayout.ts:buildForwardPlanningBoardGanttLayout` は未完了アイテムを資源レーンに並べ、前工程と資源の空きを待ち、`placeForward` で休憩・日稼働時間を跨いで配置する。`forwardPlanningBoardPredecessors` は現状1アイテム→直前1アイテムの Map を返す。`planningBoardAutoOrder.ts:planningBoardAutoOrder` は独自に同じ依存と配置時間を使い、pin を守って提案順を作る。`usePlanningBoardPageGantt.ts`、`gantt/usePlanningBoardGantt.ts` がページと描画をつなぐ。

### 旧分割の撤去範囲


旧モデルの正式名は全て `ProductionScheduleOrderSplit*` で、`apps/api/prisma/schema.prisma` の `ProductionScheduleOrderSplit`、`ProductionScheduleOrderSplitAssignment`、`ProductionScheduleOrderSplitAuditLog`、`ProductionScheduleOrderSplitPilotConfig`。PR1 はこれらと既存 migration を残す。

サービス `order-split/production-schedule-order-split.service.ts`、schemas、feature、display ID、scope preference、時間按分は撤去対象。`production-schedule-order-split-feature.ts:isProductionScheduleOrderSplitEnabled` は deployment flag と DB pilot の AND であり、`apps/api/src/app.ts` の pilot cache 初期化も消す。`routes/kiosk/production-schedule/order-split.ts:registerProductionScheduleOrderSplitRoutes` と同 `index.ts` の登録、`routes/production-schedule-settings.ts:registerProductionScheduleSettingsRoutes` 内の pilot GET/PUT も撤去する。

順位ボードは `leaderboard/leaderboard-split-expansion.service.ts` の `expandLeaderboardParentRowsForResponse`、`expandLeaderboardParentRowIdsForSnapshot`、`fetchLeaderboardScheduleHydratedRowsOrderedByDisplayItemIds` と legacy continue 補完を撤去する。呼び手 `production-schedule-query/leaderboard-shell.ts:listLeaderboardShellProductionScheduleRows` / `listLeaderboardShellContinuationProductionScheduleRows` を親 ID 専用に戻す。

SQL は `leaderboard/leaderboard-shell-rank-join.sql.ts:buildLeaderboardShellRankJoinContext` の split assignment UNION、`leaderboard-shell-manual-where.sql.ts:buildLeaderboardShellManualPriorityWhereSql` の旧片 EXISTS / UNION、`leaderboard-row-selection.service.ts` の splitEnabled、`leaderboard-shell-display-item-prefix.service.ts:resolveLeaderboardShellDisplayItemPrefix` と `buildDisplayItemPrefixGapManualAssignmentExistsSql` の片補完を除去する。親候補配列による索引利用と site/location fallback は維持する。

`production-schedule-query/filters.ts:buildResourceConditions` / `buildQueryWhere` の旧片資源・納期条件、`production-schedule-list-count.service.ts:countProductionScheduleDashboardVisibleDisplayItems` / `countProductionScheduleDashboardVisibleLeaderboardUnits` の片件数、`production-schedule-query/order-usage.ts:getProductionScheduleOrderUsage` の無条件旧片順位 UNION を消す。`leaderboard-footer-part-key-collector.ts:resolveLeaderboardFooterPreferredRowIds` と `routes/kiosk/production-schedule/shared.ts:displayItemIdSchema` の旧片 ID 変換も不要になる。

`leaderboard/leaderboard-shell-hydrate.service.ts:fetchLeaderboardScheduleHydratedRowsSingleBatch` の旧片 JSON、`leaderboard-shell-snapshot-generation.ts:readMainAndAuxGenerationRow` / `buildLeaderboardShellSnapshotGenerationToken` の旧片 COUNT/MAX を除去する。キャッシュの payload 形式識別を更新して、デプロイ前の split ID を含む shell 続き要求は既存 stale snapshot 応答で再取得させる。

`apps/api/src/services/part-measurement/self-inspection/decoration.ts:buildLeaderboardDecorations` は split ID を session preload から外して空 decoration を返している。この分岐を消して通常の親自己検査 decoration を維持する。`grinding-planning-board-load-summary.ts:readAggregatedLoadSummary`、`readGrindingPlanningBoardLoadSummary`、`buildGrindingPlanningBoardLoadSummary` と `decodeAggregateOverride` は旧片 SQL UNION、親除外、按分、override 解決を含む。PR1 は親専用、PR2 は新片対応に置換する。

`grinding-planning-board-due-scope.service.ts:readTargetOverrideRows` / `readSnapshotParts` / `readWriteTargets` / `buildScopeRevision` も gate なしで旧片を読む。PR1 では親だけにし、PR2 では論理親から新片を列挙する。旧 `split:<id>` override レコードは消さず無視する。

`order-split/production-schedule-unified-order-slot.service.ts:assertUnifiedOrderSlotAvailableInTransaction` は旧片順位の競合を読む。親に必要な advisory lock（トランザクション内で同じキーの同時処理を直列化する PostgreSQL のロック）・親順位検証を `order-assignment/` へ移して維持する。`production-schedule-command.service.ts:upsertProductionScheduleOrder` の旧片件数・旧 assignment 削除、`order-assignment/order-assignment-release.repository.ts:shiftHigherOrderSlotsAfterRelease` / `findStaleSplitOrderAssignmentCandidates` / `releaseSplitOrderAssignmentAtLocation`、`order-assignment-reconciliation.service.ts:reconcileStaleProductionScheduleOrderAssignments` の旧片処理だけを外す。`production-schedule-parent-row-lock.service.ts` の親ロックも現行呼び手が残る限り同じ意味で `order-assignment/` に移す。

web は `apps/web/src/pages/kiosk/ProductionScheduleLeaderOrderBoardPage.tsx`、`features/kiosk/leaderOrderBoard/LeaderOrderSplitModal.tsx`、`LeaderOrderResourceRow.tsx` の数量ボタンと片用の完了・備考・自己検査抑止、`normalizeLeaderBoardRow.ts`、`types.ts`、`displayItemId.ts` を親専用にする。`api/domains/production-schedule/order-splits.ts` と barrel、query keys、`api/hooks/production-schedule/settings.ts` の pilot/status hooks、`api/domains/production-schedule/settings.ts`、`pages/admin/ProductionScheduleSettingsPage.tsx` の pilot switch を撤去する。

フラグは API `config/env/kiosk-flags.ts`、web `config/productionBuildConfig.ts` / `productionBuildDefaults.generated.ts` / `vite-env.d.ts` に加え、`infrastructure/docker/Dockerfile.web` / `docker-compose.server.yml`、Ansible の `docker.env.j2` / `web.env.j2` / `release-build-contract.json.j2`、`scripts/deploy/production_config_contract.py` と `scripts/deploy/tests/test_ansible_template_contracts.py` に波及する。生成物は生成元を直して既定生成手順で更新し、秘密設定ファイルは読まない。削除漏れは旧モデル名・OrderSplit・order-split・旧フラグ名の `rg` で確認し、残してよいのは Prisma モデル、migration 履歴、本書等の履歴文書、残存DBが無視されることを証明する fixture だけとする。

## Plan of Work


### Milestone 1 / PR1: 旧分割を撤去し、親1行の既存動作を確立する


前節の旧分割コード・画面・API・フラグ・SQL参照を削除する。旧4モデル、既存 relation と migration は残す。DB の DROP / DELETE は含めない。旧片 ID や旧 override を新片へ再利用せず、旧記録が DB に残っても表示・件数・順位・同期に影響しない状態にする。製番ボードの shared type は一度 `kind: 'row'` に戻し、旧 split 入力を受ける分岐を消す。

削除だけで親の順位ロックまで失わないよう、上記の必要な親専用関数を `order-assignment/` に移す。親の同順位409、解放時の繰上げ、場所 fallback、通常納期・製番順・負荷・自己検査を維持する。補助同期は winner の変更先へ通常どおり追従する。

本番フラグ OFF 時の親表示が基準である。旧レコードを入れたテストで親1件・親数量5・親の所要時間・正常な自己検査導線を確認する。現行 `ProductionScheduleLeaderOrderBoardPage.tsx` は status query の失敗時も `effectiveEnabled === true` を満たさず分割だけ無効となり、通常ボードは表示を続ける。旧 status API の404時に親の基本操作が使える回帰テストも加える。未知の過去版まで互換APIを増設しない。

### Milestone 2 / PR2: 新片の保存・API・集約を追加する


後述の新2モデルと必要な additive migration（既存列を壊さずテーブル・列を足す migration）を作る。新ディレクトリ `apps/api/src/services/production-schedule/sessaku-pieces/` に `piece-key.ts`、`piece-quantity.ts`、`piece-completion.ts`、`sessaku-pieces.service.ts`、`sessaku-pieces.schemas.ts` を置く。旧 order-split API の別名や adapter は作らない。フロントと共有する型は `packages/shared-types/src/common/production-schedule-grinding-planning-board.ts` に追加する。

`source.ts` で winner の4列論理キーから親集合を一括取得し、片も一括取得する。行ごとの N+1 query は避ける。`buildItems` は片なしなら通常行、片ありなら親を置換した `kind: 'piece'` を作る。itemId は `piece:<新UUID>` とし、sourceRowId は毎回の winner から応答する一時的な参照だけとする。片には parentItemId、pieceId、pieceSetVersion、quantity、parentPlannedQuantity、quantityWarning、manualIsCompleted を持たせ、既存 plannedQuantity は片数量、requiredMinutes は加工分、isCompleted は実効完了を返す。親工程進捗は親1件で集計する。

`write.ts:discoverSourceRows` / `resolveCurrentProjectionInTransaction` と resource-order/bulk/pins/overrides は `piece:` を論理親へ解決する。itemRevision には共通集合 version、数量、済み、warning、現在の winner/補助数量/外部状態、親 override 継承、片 override version を含める。`sourceRevision` は製番順の版であり、別端末の無関係な製番並べ替えで片の数量操作を拒否する鍵にしない。

`state.ts:readPlanningSnapshotGenerationDetails` に全端末共通の片集合の版を加え、payload の形式版も上げる。件数と MAX(updatedAt) だけに頼らず、親集合に残す単調増加 version の集計（件数と SUM(version) 等）で削除・同時刻更新も検出する。片の変更・数量同期・外部状態変更では同じトランザクションで親集合 version を増やす。SUM はDBの bigint / PrismaのBigIntとして扱い、JSONには10進文字列で含め、Numberへの桁落ち変換をしない。場所別 override の世代は従来どおりとする。全 siteKey の古い reusable payload が再利用されないテストを置く。

`grinding-planning-board-load-summary.ts` の SQL 経路と fallback を同じ片数量・実効完了で計算し、親と片を二重計上しない。これは表示前の未選択製番を含む負荷にも適用する。負荷表示は従来の加工所要分を使い、順序に依存する段取り込み所要時間はガントの配置評価に使う。両者の意味を型・テストで分け、順序を知らない SQL 集計に固定の段取りを足さない。

`grinding-planning-board-due-scope.service.ts` の読取・一括書込・revision は親の論理キーから片とその override を列挙する。既存納期一括変更による片の rank 失効や親納期の継承を維持する。`process-arrival.service.ts` の specialDue 用 itemKey は `piece:` を認識するが、着の完了計算 SQL は変えない。自己検査・順位 shell・配膳に新しい片展開を追加しない。

API 追加・完了・同期の詳細は後節どおり実装する。導入ゲート `SESSAKU_PIECES_CREATE_ENABLED` は API 側だけに新設し既定 false とする。旧 pilot / web build flag を再導入しない。false では新規分割と再分割だけ403、すでにある片の読み取り・結合・完了・取消・同期は有効のままとする。既存製番ボード GET は片を展開しない親応答を既定とし、`includePieces=true` を明示した要求だけ新しい投影を返す。同じ指定を load API、snapshot key、キャッシュキー、ページング継続に一貫して含める。

PR2 単独デプロイではゲート OFF、片0件の本番は従来と同じになる。隔離テスト環境でのみゲート ON にし、新APIから作った片を新形式GETで検証する。旧形式GETは親1行で全片集約完了を返し、既存親完了 API は全片へ作用するので、古い端末がいても整合を壊さない。片あり親に対する旧形式の製番ボードの rank/resource/due/pin/resource-order/bulk 書込は `PIECES_REQUIRE_PIECE_TARGET` の409で一括拒否し、通常の stale notice と再取得へ流す。親 override だけを更新して成功としない。製番順・資源capacity・明示した納期scopeの一括更新は引き続き許可し、scope更新は片へ展開する。順位ボードの親 assignment 更新は既存の親順位として維持する。この互換経路は端末更新期間のためであり、別画面への片表示はしない。

### Milestone 3 / PR3: 合意済みの製番ボードUIと前向きガントを接続する


`apps/web/src/api/domains/production-schedule/grinding-planning-board.ts`、`api/hooks/production-schedule/grinding-planning-board.ts` に新 API client / mutation と `includePieces=true` を追加する。新旧の反復ポーリングが混じってキャッシュを上書きしない query key にする。利用可能なサーバー能力は GET 応答の `pieceCapabilities`（作成可否、片応答対応）で判断し、旧サーバーの応答に無いときは分割操作を出さない。

`ProductionScheduleGrindingPlanningBoardPage.tsx:toggleCompletion` と completion overlay / pending / undo を itemId 単位に変更し、row は既存 API、piece は片 intent API に送る。親の数量・済みが変わる成功応答で同じ親の全表示と候補、負荷、工程チップ、着の query を無効化する。UI 操作は `usePlanningBoardWriteQueue.ts` の版・再取得パターンに合わせ、409時は古い操作を自動再送せず最新表示を取得し、必要なら既存 notice を使う。片が統合・削除された後の古い undo は409として何も変更しない。

`PlanningBoardItemTable.tsx` と資源・フォーカス表示の共通数量セルへ、小さな `PlanningBoardPiecePopover.tsx` を追加する。−/＋ は分け数2から対象数量まで、分ける処理は後節の決定的数量列を使う。通常行5なら [2,3]、未済み片3を2分割なら [1,2] とする。済み片の数量枠は再分割不可とし、複数の未済み片を選んでまとめられるよう既存の選択状態を使う。済みを含む結合は許さない。

数量セルは片の数量「2／5」と全片の数量比の細い帯を出す。warning は当該親に属する表示行とガント棒の赤枠で示し、説明のための補助テキストは足さない。`PlanningBoardCompletionButton` を片にも出し、外部完了は既存どおり取込表示・操作不可とする。小窓は既存のアクセシブルな popover/dialog パターンを使い、アイコンに aria-label、Escape とフォーカス復帰を付ける。新しいライブラリは不要である。

前向きガントでは `forwardPlanningBoardPredecessors` の返り値を、各アイテムから「厳密に前の工程の全未済みアイテムID集合」へ変える。論理親の兄弟片同士は前工程にしない。次工程の ready はその集合の end の最大値とし、一部完了で先へ流さない。資源の順番が工程依存と衝突する場合の既存フォールバックを維持しつつ、未配置の前工程を現在時刻扱いで黙って通さない。実現できない提案順は既存のエラー経路で差し戻す。

`planningBoardGanttLayout.ts:buildForwardPlanningBoardGanttLayout` と `planningBoardAutoOrder.ts:planningBoardAutoOrder` が同じ小さな純粋関数 `resolvePlanningBoardRunMinutes` を使うようにする。入力は加工所要分、段取り分、同資源の実行直前アイテムの parentItemId、現在の parentItemId。通常行は従来どおり、片は加工分+段取り分、直前が同じ親の片なら加工分だけとする。直前判定は itemId 順や全体表示順でなく、各資源で実際に配置される未完了キューの順番を使う。別資源の同じ親は段取りを省かない。

段取りの暫定保存案は既存 `ProductionScheduleGrindingPlanningBoardResourceCapacity` への `setupMinutes Float?` 追加、既存 resource-capacity GET/PUT への任意の非負有限数の入出力追加である。default は null とし、未設定を0分とみなさない。新しい settings 画面は作らない。段取り未確定の片はガント上の所要時間不明として既存不明表示・提案不可の経路へ流し、明示0なら0分として扱う。元所要分が既に段取りを含むと確認された場合は二重加算を避ける加工分の抽出規則を Decision Log に追記してから実装する。

数量比例の加工分は浮動小数の分のまま `sourceMinutes * piece.quantity / plannedQuantity` とし、片ごとの Math.round で総所要時間を増減させない。0分は既知の0として扱い、現行の `!item.requiredMinutes` による「不明」判定を null/known 判定へ狭く修正する。元数量不明・0または数量不整合は所要分不明とする。休憩・日跨ぎの分割は既存 `placeForward` を使う。後ろ向きガントも片別の加工分を使うが、今回の段取り加算は前向き配置だけに限定する。

PR3 単独で PR2 上にデプロイしてもゲート OFF なら既存操作を維持する。能力応答を見て分割操作を有効にし、ゲート ON は全APIがPR2以降・新UI配信済み・段取りの保留解決済みという確認後に、明示承認された本番設定変更として行う。ゲートを OFF に戻しても既存片を消したり親1行だけにして隠したりしない。

## Interfaces and Dependencies


### Prisma と migration の定義案


`apps/api/prisma/schema.prisma` に次の2モデルを加える。長い複合制約名には明示 map を付ける。元キー文字列は現行 winner と同じ文字列化を用い、勝手な大文字化・trim は行わない。`CsvDashboard` に `sessakuPieceSets ProductionScheduleSessakuPieceSet[]` の逆 relation を加える。通常製番だけが対象で、4キーに空要素があるときも新規作成を拒否する。

    model ProductionScheduleSessakuPieceSet {
      id                 String   @id @default(uuid())
      csvDashboardId     String
      fseiban            String
      fhincd             String
      fsigencd           String
      fkojun             String
      version            Int      @default(1)
      nextPosition       Int      @default(1)
      plannedQuantity    Int?
      quantityWarning    String?  @db.VarChar(40)
      createdAt          DateTime @default(now())
      updatedAt          DateTime @updatedAt
      csvDashboard       CsvDashboard @relation(fields: [csvDashboardId], references: [id], onDelete: Cascade, map: "PSSPieceSet_dashboard_fk")
      pieces             ProductionScheduleSessakuPiece[]
      @@unique([csvDashboardId, fseiban, fhincd, fsigencd, fkojun], map: "PSSPieceSet_logical_key")
      @@index([csvDashboardId, fseiban], map: "PSSPieceSet_seiban_idx")
    }

    model ProductionScheduleSessakuPiece {
      id                 String   @id @default(uuid())
      pieceSetId         String
      position           Int
      quantity           Int
      isCompleted        Boolean  @default(false)
      completedAt        DateTime?
      createdAt          DateTime @default(now())
      updatedAt          DateTime @updatedAt
      pieceSet           ProductionScheduleSessakuPieceSet @relation(fields: [pieceSetId], references: [id], onDelete: Cascade, map: "PSSPiece_set_fk")
      @@unique([pieceSetId, position], map: "PSSPiece_position_key")
    }

`position` は全端末共通の数量補正の順番であり、画面位置ではない。再分割時は元片を消し、その位置に新しい片を並べ、後続の position を衝突しない二段階更新で詰め直し、nextPosition を最大position+1以上へ更新する。末尾追加は nextPosition から採番する。新IDは再使用しない。片1件だけ残った場合も、実績や位置を守るため片として残す。「まとめる」で全ての未済み片を選び、済み片が0件なら全片削除して通常行に戻す。

片0件に戻しても集合を版の墓標として残す。次の分割で version を初期値に戻して古い要求を誤受理しないためであり、「未分割は片を持たない」に反しない。集合は CSV 行への FK を持たず、winner 不在中も消さない。別論理キーへ自動付け替えしない。

場所ごとの順番は新テーブルを作らず、既存 `ProductionScheduleGrindingPlanningBoardOverride` の `itemKey = piece:<id>` と `alternateRank` を使う。これが Prisma 上の場所別保存定義であり、unique は既存 `[csvDashboardId, siteKey, itemKey]` を用いる。不要になった片の override は全 siteKey 分を同じトランザクションで削除する。旧 split override は削除せず無視する。

migration は `apps/api/prisma/migrations/<timestamp>_add_sessaku_pieces/migration.sql` とする。CREATE TABLE、FK、index に加え、quantity>0、position>0、version>0、nextPosition>0、plannedQuantity>=0またはnull、completedAt と isCompleted の整合の CHECK を付ける。warning は `COMPLETED_QUANTITY_EXCEEDS_PLAN` / `INVALID_PLANNED_QUANTITY` の既知値だけ許す。全片合計=指示数は行を跨ぐためサービスの同一トランザクションとテストで保証する。段取り列を採用する場合は setupMinutes が null または非負有限数となる CHECK を同じ additive migration または PR3 の追加 migration に入れる。

旧モデルの DROP や移し替えSQLを含めず、既存行へ片を自動生成しない。隔離DBで migration 前後の旧4テーブル・親データが保持されること、追加 migration を2回 deploy して2回目は適用なしになることを検証する。履歴を書き換えたり `prisma db push` で代用したりしない。

### API の契約案


`apps/api/src/routes/kiosk/production-schedule/sessaku-pieces.ts:registerSessakuPiecesRoutes` を新設し、同 `index.ts` で登録する。Zod 検証、既存 `requireClientDevice`、サーバー解決の siteKey と既存カテゴリ判定を使う。初期の作成・再分割対象は cutting の通常アイテムだけとし、grinding や未採番へ仕様を拡張しない。片の完了等は後にカテゴリ設定が変わっても既存片を操作不能にしない。

    POST /kiosk/production-schedule/grinding-planning-board/pieces/split
    { parentItemId, targetPieceId?: string,
      quantities: number[], expectedPieceSetVersion: number,
      itemRevision: string }

    POST /kiosk/production-schedule/grinding-planning-board/pieces/merge
    { parentItemId, pieceIds: string[], expectedPieceSetVersion: number,
      itemRevisions: Record<string, string> }

    PUT /kiosk/production-schedule/grinding-planning-board/pieces/:pieceId/completion
    { intent: "complete" | "incomplete", expectedPieceSetVersion: number,
      itemRevision: string }

未作成集合は expectedPieceSetVersion=0 とする。split は未分割親、または指定した未済み片だけを対象に、quantities の合計が対象数量、全て正整数、要素2件以上であることを確認する。有限のリクエスト上限は既存API方針に合わせるが、「最大2分割」等の固定業務制約は加えない。merge は同じ論理親の未済み片2件以上だけを受け付ける。一部結合は共通 position の最小位置に新片1件を作り、済み片を含む全結合は409にする。

応答は共通に `{ parentItemId, pieceSetVersion, quantityWarning, pieces, parentIsCompleted, sourceRowId }` と、操作siteの最新表示 itemRevision を返す。GET は既存ボードの `includePieces=true` で取得し、専用の全件一覧APIは作らない。削除は merge または数量同期でのみ行い、任意DELETEで数量を失わせない。

400 は数量形式・合計・キー不正、401/403 は既存認証・カテゴリ・導入ゲート、409 は `STALE_SESSAKU_PIECES` / `EXTERNALLY_COMPLETED_ITEM` / `COMPLETED_PIECE` / `PIECE_QUANTITY_CONFLICT` / `SOURCE_ITEM_MISSING` とする。削除済み pieceId の古い mutation は409で再取得させる。外部完了中、数量warning中は split/merge を拒否し、warning解除に必要な手動取消は外部完了でなければ許す。

### 同時操作と並び順の規則


`piece-key.ts` に4列キーの encode/decode と `acquireSessakuPieceLogicalLocks(tx, keys)` を定義し、dashboard + キーJSONを advisory lock にする。初回の集合がない状態も同じキーで排他し、集合作成の unique 違反と Prisma P2034/P2002 は409に変換する。片の数量・済みは集合単位の version を比較して更新する。別片を同時操作しても同じ集合なら後着409として再取得させる。勝手に別片へ操作を適用しない。

ロック順を全書き手でそろえる。既存メール公開 lock が必要な処理はそれを先頭にし、次に4列キー順の論理ロック、次に対象siteKey順の board state、最後に winner 行と override をロックする。既存 resource-order/bulk/due-scope の site state を先に取る経路も合わせて修正し、部分的に逆順を残さない。ロック前に発見した対象集合は取得後に再読し、増減・winner差替えがあれば409またはジョブの明示的再計画にする。

数量操作は最新 winner、補助数量、外部状態をロック内で読み直し、itemRevision も照合する。画面順は場所ごとの版で比較する。数量同期と import はユーザーの expected version を持たないが、同じ論理ロックと current version 更新を使う。処理の途中失敗は全て rollback する。

初回分割では各siteの現在の親位置を基準に、新片を親がいた位置へ連続挿入する。親の資源・納期・pin・特別納期 override は各siteで継承し、後続 alternateRank を既存 resource-order の規則で詰め直す。未済み片の再分割では元片の各siteの位置へ子を連続挿入する。一部結合は各siteで選択片のうち表示上先頭の位置・資源・override を採り、他を除く。未選択片の相対順を保つ。全結合時は同様に通常親の override を更新してから片 override を消す。

site が未作成なら集合の position 順を同順位時の安定した初期並びに使い、最初の並べ替え時に当該siteの override を作る。共通の分割・結合処理で他siteの既存位置を一律にコピーしない。親集合の version は位置だけの更新では増やさず、各siteの overrideVersion と boardRevision で競合検出する。ただし分割・結合による ID 置換は全siteの override を変えるので双方の版を更新する。

### 完了の集約と取消


`piece-completion.ts:reconcileSessakuPieceProgress(tx, logicalKey)` を、片あり親の Progress を書く唯一の処理にする。piece.isCompleted は手動の済みを保存する。画面の実効済みは `manualIsCompleted || externalCompleted`、親 Progress は `pieces.length > 0 && pieces.every(effectiveCompleted)`。外部 C/X 中は全片が import 完了となり、Progress も true を書く。外部が未完了へ訂正されたら、最新の補助数量で数量補正・warning解除を先に行い、手動値から再集約して、途中片が未済みなら false を upsert する。

片の完了・取消・分割・結合・数量補正、外部同期、winner の公開で必ずこの処理を同一トランザクション内で呼ぶ。片が0件へ戻る全結合は未済みだけなので親 false を明示する。以後その集合が墓標だけなら片由来の集約対象から外し、通常行の完了書き込みへ戻す。数量0で未済み片が全消去された場合も false とし、空集合を every=true として完了にしない。片が済んだことで親が false→true になった時だけ既存の親 assignment 解放・学習イベントの副作用を実施する。片1つの完了だけでは親順位を解放しない。取消は親 false に戻すが、解放済み親順位を勝手に復元しない。製番ボードの片 override は完了・取消で保持する。

`production-schedule-command.service.ts:driveProductionScheduleRowCompletion` は、片ありの場合、論理ロック後に全片を明示 intent に更新して再集約する。旧トグルはロック内の集約値を反転する。外部完了中は取消で外部値を書き換えず409とする。片なしは既存挙動を維持する。`ProgressSyncFromCsvService.sync` は片ありの対象を同じロック内で検出し、CSV progress の直接上書きを止め、片由来の再集約だけを行う。片のない行の時刻比較・既存CSV進捗仕様は維持する。

### 数量同期・再取り込み・外部状態の公開


`piece-quantity.ts:reconcileSessakuPieceQuantities(tx, logicalKey, nextTotal)` は、手動値と外部状態を読み、共通 position 順の未済みを決める。有効な新指示数が現在の済み合計未満なら、全片の数量・ID・順を保持し `COMPLETED_QUANTITY_EXCEEDS_PLAN` を保存する。quantityWarning がある親と片は、完了フィルターによる非表示より警告表示を優先し、未完了表示でも赤枠を確認できる。実効完了値や後工程の着を警告表示のために false にしない。指示数不明・負値・非整数なら `INVALID_PLANNED_QUANTITY`、黙って0扱いはしない。

集合だけが存在し片0件なら、数量の記録だけ更新し、片を自動復活させない。新片を作れるのは明示splitと、片が1件以上存在する状態の全済み後増加だけとする。正常な増加は最後の未済み片に加える。全片手動済みだが新指示数が増えた場合は差分の未済み片を末尾に作り、親 false に戻す。外部 C/X 中は新片も実効完了だが手動済みにはしない。正常な減少は最後の未済み片から0まで減らし、必要なら前へ進む。済み合計が新指示数と一致するまで未済みを削り切ったら、残った済み片により親 true となる。外部 C/X で全片が実効済みの時の減少は、まず超過警告にして片を縮めない。

例として [済2,未3] の5→7は [済2,未5]、5→4は [済2,未2]、5→2は [済2]、5→1は元の [済2,未3] を保持して警告とする。[未2,未3] の5→1は [未1]。新数量が0で済みが無ければ全未済み片を削除する。補正後は合計、済み保持、warning の解除条件を確認し、同じ入力の再実行は版も数量も変えない。

警告後、指示数が済み合計以上へ戻るか、手動取消または外部完了訂正で済み合計が収まった場合は最新数量に対してこの補正を再実行して warning を解除する。warning 自体で外部完了や完了実績を取り消さない。不正な数量の間は所要時間を不明扱いとし、棒の長さに偽の数量比を使わない。

`order-supplement-sync.pipeline.ts:runOrderSupplementReplacementTransaction` の create/update の双方で、補助数量更新と片補正・Progress 再集約を同じ tx に入れる。旧 keepPreviousParent は使わず現在 winner へ supplement を付ける。新しい winner への付け替えだけでも再集約する。補助CSVの ProductNo 照合キーと片の4列キーは別物なので、supplement のキー文字列を片の親キーとして流用しない。

生産日程の winner 差替えでは論理キーを変えず、新 winner の Progress を片から復元する。キーが消えたら片集合を保持し、操作は SOURCE_ITEM_MISSING で拒否する。同じキーが戻れば再接続する。元資源や工程順が変更され別キーになったものを推測で移行しない。通常行の手動済み引継ぎをこの作業で一般化しない。

`CsvDashboardIngestor.ingestFromGmail` の生産日程行の追加・更新・loser削除で、新 winner が他機能へ見える前に片由来 Progress を作る。後処理の `runAfterSuccessfulIngest` に呼び足すだけでは、一時的な false の窓ができる。対象キーを事前計画し、既存の行書込チャンクを論理ロック付き tx とし、そのチャンクの winner 再解決・Progress 作成までを commit の単位にする。全件を長大な1 tx にまとめることは避ける。元行削除も同じ境界で実行する。

外部完了も `replaceAllWinnerExternalCompletionStatesFromMailSync` の external upsert → 最新補助数量による片数量補正・warning更新 → Progress再集約 → 集合version更新を同一 tx に含める。例えば手動済2・未3の外部C中に5→4で警告となった後、外部C解除時には [済2,未2] へ補正して警告を解除する。メール同期の replacement/clear と外部完了公開の呼び手にその境界を作り、C→未完了訂正で Progress true が残る瞬間を作らない。既存 FKOJUNST の公開 lock は維持する。なお `syncFromStatusMailDashboard` / `syncFromDedupedStatusMailRows` の正規化後0件は現行では異常として外部完了同期を skip する。clear transaction でもこの例外を維持し、空CSVを未完了訂正と解釈しない。有効な未完了状態を持つメール行による訂正だけを再集約の起点とする。取り込み・同期入口全体の raw 公開方式を作り直すことはせず、片を持つキーへの書き込み境界だけを必要最小限で補強する。

## Concrete Steps


今回実行するのは本書の作成と差分確認だけである。以下は実装が依頼された後の手順であり、今この場で実行しない。作業前に `.cursor/rules/00-core-safety.mdc`、`10-quality-ci-and-tests.mdc`、`20-git-workflow.mdc` を読み、その段階に必要なルールを追加で読む。Git 操作は承認範囲を超えない。既存task worktreeを引き継ぎ、ユーザーWIPの reset / stash / checkout をしない。

全コマンドの cwd は上記リポジトリルート。依存関係が導入済みでなければ承認された開発環境を用意する。テスト接続先は運用DBから隔離した専用 PostgreSQL とし、TEST_DATABASE_URL は管理された環境から渡す。資格情報をログへ表示しない。`grinding-planning-board.integration.test.ts` は専用 TEST_DATABASE_URL がないと skip するため、exit 0 だけではDB検証成功ではない。

PR1 の最初の対象検証は次とする。列挙したテストの旧片前提ケースは削除でなく、親動作と旧データ無視の回帰ケースへ置き換える。旧片 CRUD 専用テストだけは実装とともに撤去する。

    pnpm --filter @raspi-system/api exec vitest run src/services/production-schedule/__tests__/production-schedule-query.service.test.ts src/services/production-schedule/__tests__/production-schedule-command.service.test.ts src/services/production-schedule/__tests__/order-supplement-sync.service.test.ts src/services/production-schedule/leaderboard/__tests__/leaderboard-shell-manual-where.sql.test.ts src/services/production-schedule/leaderboard/__tests__/leaderboard-shell-snapshot-generation.test.ts src/services/production-schedule/leaderboard/__tests__/leaderboard-shell-hydrate.canonical-cache.test.ts src/services/production-schedule/order-assignment/__tests__/order-assignment-release.repository.test.ts
    pnpm --filter @raspi-system/web exec vitest run src/features/kiosk/leaderOrderBoard/__tests__/LeaderOrderResourceRow.test.tsx src/config/productionBuildConfig.test.ts src/pages/kiosk/ProductionScheduleGrindingPlanningBoardPage.test.tsx
    python3 -m pytest scripts/deploy/tests/test_ansible_template_contracts.py -q

追加する親1行・続きページ境界の回帰テストは既存 query/shell テストへ、親自己検査は `apps/api/src/services/part-measurement/__tests__/self-inspection-decoration-fkojun.test.ts`、`self-inspection-expected-entry-count.test.ts` と `production-schedule/__tests__/list-self-inspection-eligible-scan.test.ts` に置く。旧片が残る隔離DBの確認は次を使う。

    pnpm --filter @raspi-system/api exec vitest run src/services/production-schedule/__tests__/grinding-planning-board.integration.test.ts src/services/production-schedule/__tests__/grinding-planning-board-load-summary.integration.test.ts src/services/production-schedule/__tests__/grinding-planning-board-due-scope.integration.test.ts src/services/production-schedule/__tests__/order-supplement-sync.integration.test.ts

PR2 は migration を専用DBで作成・レビューし、schema validate / generate、共有型 build 後に純粋関数、サービス、ルート、実DB競合の順に実行する。migrate dev は本番接続先で実行しない。環境が整わなければ省略成功とはせず阻害として報告する。

    pnpm --filter @raspi-system/api exec prisma migrate dev --create-only --name add_sessaku_pieces
    pnpm --filter @raspi-system/api exec prisma validate
    pnpm --filter @raspi-system/api exec prisma generate
    pnpm --filter @raspi-system/shared-types build
    pnpm --filter @raspi-system/api exec prisma migrate deploy
    pnpm --filter @raspi-system/api exec vitest run src/services/production-schedule/sessaku-pieces/__tests__/piece-quantity.test.ts src/services/production-schedule/sessaku-pieces/__tests__/piece-completion.test.ts src/services/production-schedule/__tests__/grinding-planning-board-projection.test.ts src/services/production-schedule/__tests__/process-arrival.service.test.ts
    pnpm --filter @raspi-system/api exec vitest run src/routes/kiosk/production-schedule/__tests__/sessaku-pieces.route.test.ts src/services/production-schedule/sessaku-pieces/__tests__/sessaku-pieces.integration.test.ts src/services/production-schedule/__tests__/grinding-planning-board.integration.test.ts src/services/production-schedule/__tests__/grinding-planning-board-load-summary.integration.test.ts src/services/production-schedule/__tests__/grinding-planning-board-due-scope.integration.test.ts
    pnpm --filter @raspi-system/api exec vitest run src/services/production-schedule/__tests__/order-supplement-sync.integration.test.ts src/services/production-schedule/__tests__/progress-sync-from-csv.service.test.ts src/services/csv-dashboard/__tests__/csv-dashboard-post-ingest.service.test.ts src/services/csv-dashboard/__tests__/csv-dashboard-import.service.ingest-behavior.test.ts src/services/production-schedule/external-completion/__tests__/fkojunst-external-completion-sync.service.test.ts src/services/production-schedule/__tests__/fkojunst-status-mail-sync.pipeline.test.ts
    pnpm --filter @raspi-system/web exec vitest run src/api/domains/production-schedule.grinding-planning-board.test.ts src/pages/kiosk/ProductionScheduleGrindingPlanningBoardPage.test.tsx

`piece-quantity.test.ts` は済み固定、末尾吸収、0削除、全済み後増加、警告・解除・無効数量・同一入力再実行を検証する。`piece-completion.test.ts` と新 integration は全片集約、外部 C/X の訂正、親 API 経由の完了/取消、CSV progress の上書き防止、取り込み行ID変更を検証する。import の一時不整合は2接続の barrier を使い、未commit中の読み取りに古い整合状態、新commit後に新しい整合状態だけが見えることを確認する。

新 `sessaku-pieces.integration.test.ts` では、同時初回分割、同じ集合の別片完了、分割対数量同期、取消対外部C、並べ替え対結合、別site同時編集を2接続で競争させる。一方の409または直列実行後の正しい合計を期待し、欠落・重複・済み数改変・deadlock の常態化を許さない。load-summary のSQLとfallbackと通常投影の未済み加工分を同じfixtureで比較する。

PR3 で追加する `PlanningBoardPiecePopover.test.tsx`、既存 table completion/page/API テスト、ガント layout/auto order テストを次で検証する。

    pnpm --filter @raspi-system/web exec vitest run src/features/kiosk/grindingPlanningBoard/PlanningBoardPiecePopover.test.tsx src/features/kiosk/grindingPlanningBoard/__tests__/PlanningBoardItemTable.completion.test.tsx src/pages/kiosk/ProductionScheduleGrindingPlanningBoardPage.test.tsx src/api/domains/production-schedule.grinding-planning-board.test.ts
    pnpm --filter @raspi-system/web exec vitest run src/features/kiosk/grindingPlanningBoard/gantt/planningBoardGanttLayout.test.ts src/features/kiosk/grindingPlanningBoard/gantt/planningBoardAutoOrder.test.ts src/features/kiosk/grindingPlanningBoard/gantt/planningBoardForwardQueue.test.ts src/features/kiosk/grindingPlanningBoard/usePlanningBoardPageGantt.test.tsx src/features/kiosk/grindingPlanningBoard/usePlanningBoardWriteQueue.test.ts
    pnpm --filter @raspi-system/api exec vitest run src/routes/kiosk/production-schedule/__tests__/grinding-planning-board.route.test.ts src/services/production-schedule/__tests__/grinding-planning-board-resource-capacity.service.unit.test.ts src/services/production-schedule/__tests__/process-arrival.service.test.ts
    pnpm kiosk-sop:source-check

各PRのコード変更後に、対象契約テストが通った時点で次の lint / typecheck を1回実行する。API に typecheck script は無いので build 用 tsconfig に noEmit を指定する。web は共有型を build 済みにし、既存 composite 設定に従う。

    pnpm --filter @raspi-system/shared-types build
    pnpm --filter @raspi-system/api lint
    pnpm --filter @raspi-system/api exec tsc --noEmit -p tsconfig.build.json
    pnpm --filter @raspi-system/web lint
    pnpm --filter @raspi-system/web exec tsc --noEmit -p tsconfig.json
    git diff --check

API や web を変更しない段階ではそのパッケージの検証を無目的に繰り返さない。PR1 のビルド設定撤去には配置契約の対象テスト、PR3 のUI変更には SOP source-check を適用する。SOP が stale なら画面変更範囲を確認し、実装依頼の書込範囲内で既定手順により更新する。本書だけを作成する今回にこれらを実行しない。

対象テストは全件 pass、DB tests は skip なし、lint/typecheck は exit 0 を期待する。件数は実装時の新規ケースにより変わるので実行結果を記録する。PR1 とPR3の通常変更は20分、DBを含むPR2は45分を既定のローカル検証予算とし、CI分類でDB/CI/infraの検証が必要になったPR1は45分の区分を適用する。失敗再実行は関連修正後または妥当な一時要因で1回まで。無関係な失敗は修正せず記録し、既知の必須検査が残れば検証未完了として停止する。広いsuite/build/E2Eを惰性で追加せず、選択されたCIを最終証拠に使う。

## Validation and Acceptance


隔離環境で API と web をそれぞれ `pnpm --filter @raspi-system/api dev`、`pnpm --filter @raspi-system/web dev` で起動する。API の認証・マスタ・端末スコープは既存fixture/seedで用意し、テスト用の同一論理キーを持つ切削工程A（指示5、加工100分）と別アイテムB、Aの後工程を作る。画面は既存ルーターの `ProductionScheduleGrindingPlanningBoardPage` のURLを開く。新しい仮URLや新規画面は作らない。

PR1 は旧テーブルに旧片や旧 assignment があっても、製番・順位の両ボードで A は1行、数量5、加工100分となる。順位の親完了・備考・自己検査・並び替え、製番の納期変更・負荷が正常で、旧設定スイッチ・分割API・分割UIが無い。旧片の更新は shell 世代や使用順位に影響しない。

PR2 は gate OFF で新規分割403、既存行は不変。隔離環境の gate ON で split API に [2,3] を送ると片形式GETに2片、既定GETと順位ボードに親1行が返る。片2を complete にしても親 Progress=false、後工程は未着（配膳済み等の既存例外がないfixture）、負荷は未済み3の60分となる。片3も complete にすると親 Progress=true・後工程は着となる。片3を incomplete に戻すと親 false・未着へ戻る。親 API で取消した場合は全片の手動済みが false となる。

PR3 は数量枠から分け数2を選び「分ける」で2／5と3／5、割合帯が出る。片2を済みにして、片3をBの後ろへ動かし、端末を再読込してもその位置と状態が残る。別siteでは数量と済みだけ共通で、そのsite固有の並びを保つ。未済み3を [1,2] に再分割でき、未済み同士だけを結合できる。全未済みを結合して通常行へ戻した場合は片0件、従来の数量枠に戻る。済み片の分割・結合はできない。

前向きガントはAの片2の加工40分、片3の加工60分を別棒にする。明示段取り10分の場合、同資源の A2→A3 は50+60=110分、A2→B→A3 はAの棒だけで50+70=120分となり、B自身の所要分は別に足される。別資源のA3にも段取り10分を加える。描画・提案順の評価で同じ時刻になり、次工程の棒はAの両片が終わるまで始まらない。休憩、日跨ぎ、不明所要時間、0分、pin・特別納期を含む既存テストも維持する。

再取り込みでAの row ID を入れ替えても pieceId と数量・済み・site別 override は保たれ、新 winner の Progress が正しい。補助CSV5→7/4/2/1、全片済みからの増加、0、不明数量を上記規則で検証する。済2に対して指示1なら数量を維持して赤枠となり、無断縮小はない。全片が外部完了の数量警告も未完了フィルターで見えるが、完了値はtrueのままとする。外部メール C/X は全片import完了で取消不可、未完了訂正時は手動実績が残り、親 Progress と着が一致する。

旧端末の親への製番ボードrank/resource/due/pin/resource-order/bulk書込は片ありなら409で何も更新しない。正常な親完了とscope納期更新は定義した全片操作として動く。

同じ版を持つ2端末で同じ親に操作したら、後着は409で再取得を促し、合計と済み実績を失わない。分割→結合→再分割後の最初の古い要求も409になる。ゲートを OFF に戻しても作成済み片の読み・完了・取消・まとめるが動き、非対応サーバーへの新UIは分割操作を出さない。

ブラウザー確認を行うなら Playwright 同梱 Chromium を使う。インストール済み Google Chrome や `/Applications/` 配下のブラウザーを起動しない。利用可能な同梱ブラウザーが無ければブラウザー確認は未実施と報告し、component / API / DB の証拠と区別する。

## Idempotence and Recovery


API はトグルでなく明示 intent を基本とし、同じ版の再送は二重分割せず409になる。ネットワーク切断後は最新集合をGETして結果を確認し、版を取り直すまで再送しない。同じ完了意図を最新の版で送り直した場合は unchanged とし、学習イベント・assignment解放を重複させない。数量・外部同期は差分がある時だけ版を更新する。

migration は additive のためアプリロールバック時も追加テーブルを残す。旧4テーブル削除は本計画外で、ユーザー承認後にバックアップ・復元検証を備えた別 migration とする。テストでも旧履歴の手編集をしない。

PR1 で問題があれば旧データは保持されているため対応する旧アプリへ戻せるが、旧分割フラグは OFF のままとする。PR2/PR3 は片がまだ作られていなければ作成ゲートを OFF にし、直前の互換版へ戻せる。片作成後は PR1 以前の片非対応APIへロールバックすると Progress の書き手が整合を壊すので禁止する。PR2以降のデータ対応APIを維持し、作成停止・片操作可能なUIへの復帰で復旧する。全片未済みの通常結合以外で、運用データを削除して戻さない。済み実績がある場合はデータ対応版による前方修正を選ぶ。

同期の途中失敗は該当txをrollbackし、次回取り込み/再試行で同じ論理キーを再計算する。ジョブの全件再実行で済み数量を再配分しない。運用DBへ直接修正SQLを流す、既存 lock や migration 台帳を手編集する、秘密情報を文書に残す方法は取らない。

## Artifacts and Notes


調査時の証拠はソース読取と `rg` による参照確認であり、実行した機能テストの成功証拠ではない。代表的な一致は次のとおりである。

    grinding-planning-board-projection.ts / buildItems:
      kind: split == null ? 'row' : 'split'
      isCompleted: rowCompleted
    ProductionScheduleGrindingPlanningBoardPage.tsx / toggleCompletion:
      item.kind !== 'row' を拒否
    order-supplement-sync.pipeline.ts:
      allocateSplitQuantities / keepPreviousParent
    planningBoardGanttLayout.ts / buildForwardPlanningBoardGanttLayout:
      placeForward(Math.max(cursor, ready), unknown ? 0 : item.requiredMinutes!, ...)
    production-schedule-effective-completion.sql.ts:
      Progress.isCompleted OR ExternalCompletion.isExternallyCompleted

実装者は各PRで変更ファイル、対象テスト名とpass/skip件数、lint/typecheck結果、migration適用先が隔離DBであること、互換動作の確認を短く残す。承認された場合のみPR URL、push SHA、checks、main merge SHA、deploy run IDとhealth等を段階別に追記する。ローカル成功を統合・本番成功と書かない。

本書作成後は `git status --short`、`git diff --check` と対象ファイルの構造・参照確認で、書込が本書1つだけであることを確認する。開始時の WIP は0件だったため、他ファイルの差分が出たら今回の成果に含めず原因を確認する。

改訂記録: 2026-11-05、初版および整合性レビュー反映。ユーザー確定の片設計を基準に現行コードを調査し、旧分割のOFF経路、ガントの前工程依存、複数のProgress書き手、段階導入・ロールバックの制約を追加した。コード変更は行っていない。レビューでは、旧形式の親書込を409にする境界、片0件の墓標からの自動復活防止、外部完了訂正時の数量再補正、空メールCSVの既存skip方針を明記した。
