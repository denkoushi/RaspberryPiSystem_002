# 切削の指示数を片に分け、製番ボードで順番と完了を管理する


この ExecPlan は生きた文書である。実装時は `.agent/PLANS.md` に従い、`Progress`、`Surprises & Discoveries`、`Decision Log`、`Outcomes & Retrospective` を更新する。本文のパスはリポジトリルートからの相対パスである。

PR3 の作業場所は `/Users/tsudatakashi/RaspberryPiSystem_002-worktrees/feat--sessaku-split-pieces-ui`。2026-11-06 の依頼で PR3 のローカル実装・検証と本書更新が承認された。PR2 はユーザー申告で main マージ・本番反映済み。commit、push、PR 作成、merge、release、deploy は今回の範囲外。秘密情報や `.env` は読まない。

## Purpose / Big Picture


現場で、指示数5の工程を数量2と3の片に分け、2を先に加工して済みにし、別アイテムを間に挟んでから残り3に戻れるようにする。製番ボードで片ごとの位置と完了を操作でき、後工程の「着」、配膳、照合から見た工程全体の完了は全片が済むまで成立しない。

「片」は一つの通常アイテムの数量の一部であり、新しい生産指示や別工程ではない。「論理キー」は FSEIBAN（製番）、FHINCD（品番）、FSIGENCD（元資源CD）、FKOJUN（工程順）の組である。片は取り込みで入れ替わる CSV 行 ID ではなく、この組に属する。「投影」は保存データから画面の表示アイテムを作る処理をいう。「実効完了」は手動の済み、または取り込みの C/X による完了である。

未分割アイテムと順位ボードは従来の親1行を維持する。変更対象は、旧分割の撤去と、新しい片を製番ボードにだけ表示・操作する経路である。別機能を片対応に作り直すことや、旧テーブルの削除は含まない。

## Progress

- [ ] (2026-11-06 JST) 第7回の全件成功はAPI既存問題1件のみ未達。API対象は2506件成功 / 23件skip / `Loan_terminal_state_check` 1件失敗（baseでも既知の準備処理、変更なし）。web全6320件、指定DB統合40件、lint・型検査・取説・差分検査は成功。

- [x] (2026-11-06 JST) PR3 第7回レビュー Y1・Y2 / Z1・Z2 / C1〜C7を修正。保存→再取得→focus復帰をページの状態遷移へ集約し、片操作中のpolling停止、再取得settleまでの操作抑止、失敗時の即時エラーとfocus目標破棄、操作不能時も開いた小窓の維持、350ms全ボタンguard、不正片の完了disabled、対象親だけの通知解除、position優先順を回帰テストへ反映。Z3〜Z6は記録済みとしてコード変更なし。指定の最終検証は末尾へ記録する。

- [ ] (2026-11-06 JST) 第6回の指定検証はAPI全体のみ未達。再実行で2506件成功 / 23件skip / サイネージ既存準備処理1件失敗（Loan_terminal_state_check）。単独確認でも再現したため、依頼外のコードやDB状態を変更せず停止。web全6306件、指定DB統合40件、lint/型検査/取説/差分検査は成功。
- [x] (2026-11-06 JST) PR3 第6回レビュー V1〜V3 / W1〜W3・W5〜W7 / X1・X4を修正。待機はstore由来だけにし、全片の完了disabledを統一。小窓の成功close後に再取得し、復帰focusは次の成功取得1回まで、他入力へは移さない。負荷のWeb includePiecesを除去し、SQL/列挙/TSの加算順と兄弟間矢印を修正。W4・X2・X3・X5は記録のみ。

- [x] (2026-11-06 JST) PR3 第5回レビュー A1〜A3・U1〜U12・F1〜F4を対応。SQLの兄弟順、負荷GET重複/直列、未使用引数、小窓内の待機/失敗表示、操作範囲、選択保持、完了ガード、focus復帰、Escapeと連続tapを修正。指定の受入検証はすべて成功。

- [x] (2026-11-06 JST) PR3 第4回レビュー R1〜R5・G1〜G12・H1〜H4を修正。片の完了disabled、選択行だけの更新、整数互換の負荷表示、競合/失敗時処理、ウォームアップと集計キャッシュ、片なしの数量クリックを回帰テストへ反映。XHRは初期forward表示の稼働率取得で発生し、HEADの同じテストでも再現。既存110件は維持し、新規49件だけ稼働率取得をモックした。指定の受入検証はすべて成功。最終結果は末尾に記録した。

- [x] (2026-11-06 JST) PR3 第3回レビュー C1〜C7・P1〜P4・T1〜T5/T7〜T11・F1/F2/F4・N1 を修正。親単位のoverlay寿命、保存ガード、片なしのcallback安定性、全片の数量帯、結合focus、消費側無効化と1回GET、並び・計算・非丸めを回帰テストへ追加。指定の受入検証はすべて成功。結果は末尾の第3回レビュー検証記録を参照。

- [x] (2026-11-06 JST) PR3 再レビュー2回目 A〜H を修正。安定Contextと行prop、操作不可数量の文字列、通常行revision保持、兄弟完了の受付制限と版保持、片の負荷表示丸め、focus復帰抑止、片409非ロックと保存後GET失敗の分離、auto-order死catch撤去を回帰テストへ反映。指定5検証はすべて成功。詳細は末尾に記録した。


- [x] (2026-11-05 JST) 入口ルール、`.agent/PLANS.md`、関連品質・Git・ドキュメント・UI・境界ルールを確認した。開始時の `git status --short` と `git diff --stat` は出力なしで、既存 WIP はなかった。
- [x] (2026-11-05 JST) 製番ボード投影・順番・完了、ガント、着、補助CSV同期、旧分割の参照経路を読み取り調査した。
- [x] (2026-11-05 JST) PR ごとの安全境界、Prisma 定義案、API、競合・同期規則、検証案を本書に記録した。
- [x] (2026-11-06 JST) 段取りは追加せず数量按分だけとするユーザー決定で段取りの保留を解消。未採番の新規分割拒否は既存 API 契約を維持する。
- [ ] PR1 相当の旧分割撤去を実装し、対象検証を行う。
- [x] (2026-11-05 JST) PR1 の旧分割コード・画面・API・フラグ・実行時 SQL を撤去し、親専用の順位ロック・繰り上げを移設した。Prisma 定義・migration と PR2/PR3 は未変更。
- [ ] (2026-11-05 JST) PR1 DB 検証は専用 TEST_DATABASE_URL 未提供のため未実行（指定 integration 54件 skip）。指定 API 71件・web 114件・配置契約11件は成功、追加の既存 DB 依存自己検査2件と順位再調整 integration の setup は環境起因で失敗した。
- [x] (2026-11-05 JST) shared-types build、API/web lint・tsc、git diff --check は成功。旧フラグ参照0件、実行コードの旧分割参照0件（Prisma・migration・無視を証明するテスト fixture のみ残存）。
- [x] (2026-11-06 JST) PR2 の additive migration、保存・API・投影・既存書込対象解決・親完了集約・数量/外部/取り込み同期を実装した。UI・段取り加算は未変更。
- [x] (2026-11-06 JST) 追加契約テスト156件（実DB18件を含む）と、後続の片/負荷57件（実DBは追加1件を含む19件）・キー境界6件・CSV公開26件・web API/progressive24件が成功。全対象APIテストもDB skipは0件。
- [ ] (2026-11-06 JST) PR2 の「指定全対象コマンドが全件pass」は未達。API integration の既存snapshot ID・納期restoreの期待値不一致2件を残した。変更起因のモック2件はfocused検証で解消したが、全対象コマンドの追加反復は行わない。詳細は本書末尾。
- [x] (2026-11-06 JST) migration deploy と再deploy（pendingなし）、schema validate/generate、shared-types buildを確認。API/web lint・tsc と最終差分検査の結果は本書末尾に記録する。
- [x] (2026-11-06 JST) PR3 の数量小窓・片完了・能力ゲート・片GETを接続し、ガントの工程依存と数量按分を実装。5→2+3、3→1+2、未済み結合、片単独完了と取消、409再取得、40/60分・小数・0分・前詰めを component/client/layout テストで検証した。詳細は末尾 PR3 evidence。
- [x] (2026-11-06 JST) PR3 レビュー12件を修正。片0件時の HEAD の完了条件・競合通知・ピン保持fallback・直列依存・0分不明・explicitHeadを復元し、兄弟版の即時反映、重なり/工程数、操作skip、表示丸め、分割後focus、Mapとmemoの回帰テストを追加した。検証結果は末尾へ追記する。
- [ ] integrationPending: PR3 の commit / push / PR / merge / deploy は今回未実施。PR2 はユーザー申告で main 統合・本番反映済みであり、本タスクでは再確認・再実行しない。

## Surprises & Discoveries

PR3 (2026-11-06): API 投影が片の所要分を小数2桁へ丸めていた。web に元の親所要分は無いため、投影の丸めだけを除去した。ページの既存 ESLint 行数上限を守るため、今回変更した完了状態・pending・取消を `usePlanningBoardCompletion.ts` へ移した。既存 API client と includePieces の query key は PR2 に含まれており、その経路を利用した。

PR2 (2026-11-06): 計画後の #2580 の手動「当日着」は itemKey に親の row: を保存する。片GETでは parentItemId に解決して共通で読み、片での記録・取消も同じキーへ書く。#2574 の lslhSurface と材料着・配膳・D社担当は現行の後付け読取を共用し、片にも同じ親属性を返す。

PR2: 補助CSVの既存parseQuantityは0/不正/空をnullへ正規化し、更新時に旧数量を維持する。片を持つキーに限って別の正規化数量を受け渡し、0削除・INVALID_PLANNED_QUANTITYを実行する必要があった。片0件の通常行の既存数量ルールは維持した。

PR2: 既存DB test guardの一部はborrow_returnまたはplanning_due_scope_*だけを許可していた。今回明示された127.0.0.1:55432/sessaku_testをexact URLで追加許可し、他DBを使わず全対象のDB skipを0にした。

PR2: 全対象APIでは、既存の「初回読取ごとに新snapshot IDを作る」処理に対して同じIDを期待するテストと、restoreでdueDateCleared=falseに戻す処理に対してCSV未設定のままを期待するテストが失敗した。当該処理は今回変更していない。mainでの別baseline実行は行っておらず、main CI成功とは扱わない。


旧分割には片の完了列がない。`apps/api/prisma/schema.prisma` の `ProductionScheduleOrderSplit` は行 ID の FK と Cascade を持ち、投影 `buildItems` は全片に親の `rowCompleted` を設定する。そのため旧コードの延長では「2だけ済み」を表せない。

フラグ OFF は旧分割の処理が無いことを意味しない。`leaderboard-shell-snapshot-generation.ts` は旧片の件数・更新日時を常時読み、`source.ts` と shell hydrate は旧片を取得する。`grinding-planning-board-due-scope.service.ts`、順位の使用番号・解放・競合処理、補助CSV同期にも無条件参照がある。撤去の受入条件は画面のボタン消去だけでは足りない。

補助CSVの `allocateSplitQuantities` は、各片を最低1にした上で数量比と端数順によって再配分する。さらに `prepareSplitQuantityReconcileForSupplementUpdate` は winner（同じ論理キーのうち表示の正本に選ばれた行）が変わると `keepPreviousParent: true` によって supplement を旧行へ残す。どちらも今回の仕様に適合せず、引き継がない。

ガントは `FSIGENSHOYORYO` を所要分として読む。対象モジュール内の `setupMinutes`、`setupTime`、`段取` 検索に該当はなく、`buildForwardPlanningBoardGanttLayout` は `placeForward(..., item.requiredMinutes, ...)` としている。`planningBoardAutoOrder` も別経路で同じ分を使うため、描画だけの修正では提案順の評価が食い違う。

`forwardPlanningBoardPredecessors` は品番内を工程順と itemId で直列につなぐ。同一工程の片を渡すだけでは片間に偽の前工程依存ができる。全片終了時刻を前工程の終了とする工程単位の依存へ変更する必要がある。

通常製番の論理キーは4列だが、`buildGrindingPlanningBoardLogicalKey` と winner SQL は未採番製番 `********` に ProductNo を加える。新しい片の4列キーを無断で5列に変えることはしない。この例外の扱いは Decision Log に保留を残す。

完了の実効値は単なる `rowData.FKOJUNST` 判定ではない。`production-schedule-effective-completion.sql.ts` は Progress OR ExternalCompletion を使い、現行の外部完了正本は `FKOJUNST_Status` メールCSVの C/X である。メールキー消失・生産日程CSV消失による完了は廃止済みなので復活させない。

## Decision Log

- Decision: 第7回は分割・結合の成功後処理を小窓のeffectからページへ移し、idle / saving / refreshingで管理する。操作中はpollingを止め、成功再取得のsettleまで全片・数量・対象親の完了ゲートを維持し、無関係な通常行の完了は保つ。保存失敗は再取得を待たず小窓へ返し、成功後の再取得失敗はfocus目標を即破棄する（第5・6回の失敗後保持方針を置換）。行消失時は親/兄弟/一覧へ復帰し、operable低下だけなら開いた小窓を維持する。
  Rationale: Y1 / C1〜C4 / C7。小窓のunmountに保存完了処理を依存させず、無関係な完了取消通知を保持する。
  Date/Author: 2026-11-06 / PR3第7回レビュー修正担当。

- Decision: readyは書込pendingに依存させず、blocked / rankConflict / orderConflictで決める。兄弟の順序はpiecePositionをUUID比較より優先する。350msのguardを全操作ボタンへ広げ、識別子・版・親が欠けた片は完了disabledにする。Z2のContext分割はZ1修正で不要とし、Z3〜Z6（負荷加算順、小数1桁、boardキー/capabilities、ローリングwarmup）は記録済みのため変更しない。
  Rationale: Y2 / Z1・Z2 / C5・C6。片0件・ゲートOFFのpending切替では、追加の行再描画・片走査・polling変更を発生させない。共有Dialog、selection membership比較、起動includePieces:true、既存UI文言を維持する。
  Date/Author: 2026-11-06 / PR3第7回レビュー修正担当。

- Decision: 第6回の非エラー待機はfailureへ保存せず、小窓だけが購読するblockedとガードを通常行の完了pendingまで一致させる。片の完了disabledはpiecePending / !bulkReadyも含め、片0件では追加走査・行再描画を発生させない。保存成功のcloseと再取得を分離し、focus要求は成功close経路だけで設定し、次の成功取得で消費する。別入力やモーダルへ移った利用者のfocusは奪わない。
  Rationale: V1〜V3 / W1・W2・W7 / X1。共有DialogとHEADのselection membership比較、起動warmupのincludePieces:trueを維持する。
  Date/Author: 2026-11-06 / PR3第6回レビュー修正担当。

- Decision: 負荷のWeb URL・hook・query keyからincludePiecesを外し、旧端末のAPI引数は受理して無視する。includeLoadの負荷は常に片込み。集計SQL・行列挙・TS加算はsourceRowId / pieceIdの順に揃える。チェーン帯は同じ親の兄弟間に矢印を出さない。
  Rationale: W3・W5・W6 / X4。複数行×割り切れない片の一致をDB統合テストで固定する。
  Date/Author: 2026-11-06 / PR3第6回レビュー修正担当。

- Decision: W4・X2・X3・X5は記録のみでコードを変更しない。片0.04分は小数1桁方針により「0分」。片0件でも小数の合計は1桁表示になる（HEADの浮動小数の誤差表示も消える）。テーブルのContext購読・bulkDisabledによるスコープ切替/初回ロードの再描画は1回程度として維持し、ローリング中の古い端末によるincludePiecesなしの別boardキャッシュの一時的コールド生成も許容する。
  Rationale: 第6回の記録のみ指示と既決の表示方針を維持する。
  Date/Author: 2026-11-06 / PR3第6回レビュー修正担当。

- Decision: 第5回は片mutationでloadを独立に無効化し、呼出側の明示board再取得だけrevision由来の重複load取得を抑制する。書込pendingの理由は開いた数量小窓だけが購読し、全行へpending変更を伝播させない。待機は既存「保存中…」、実際の失敗は既存エラー文言と赤枠にする。
  Rationale: 片完了はboard versionが変わらず、board再取得が失敗してもloadの無効化が必要。piecePendingはwriteBlockedと片操作だけに使う。Dialog標準のreturnFocusを使い、行差替時のみ親/兄弟/表を補完し、再取得失敗中は復帰先を保持する。
  Date/Author: 2026-11-06 / PR3第5回レビュー修正担当。

- Decision: U10の未完了表示は変更しない。HEADの通常行も完了overlay適用後に未完了フィルターで消え、既存通知の「戻す」で取消できる。片は第3回決定どおり、GETに無い片を補完表示しない。
  Rationale: HEAD同等のフィルターと、他端末の分割/結合で消えた片を復活させない規則を維持し、通常行/片の両方で通知と取消を回帰確認する。
  Date/Author: 2026-11-06 / PR3第5回レビュー修正担当。

- Decision: 第4回は選択membership比較をHEADへ戻し、結合候補を行propから数量コントロールへ移す。通常行の片操作は書込pendingをrefで開く際に確認し、片だけ完了disabledを兄弟/書込待ちへ拡張する。起動payloadはページと同じincludePieces:trueで温め、結果が同じload集計のキャッシュキーからincludePiecesを除く。
  Rationale: 片0件では選択とpendingの追加再描画を避け、通常行の完了条件を維持する。分割/結合は全失敗でGETし、保存前の欠損はthrowで小窓を維持する。整数負荷の文字列は維持し、小数だけ1桁へ丸める。
  Date/Author: 2026-11-06 / PR3第4回レビュー修正担当。

- Decision: 片overlayは同じ親のGETが同版以上・片消失・親消失/import完了になった時点で親単位に破棄し、GETにない片を補完表示しない。revisionはGETの片集合が古い間だけ引き継ぐ（前回の一致GET後も版を下限として保持する決定を置換）。
  Rationale: 親CSVだけのrevision変更と他端末の分割/結合へ追従し、409ループと幽霊行を防ぐ。親Setで完了PUTを排他し、その間の書込を止める。mutationは二次消費側を更新し、全件board GETは呼出側の1回に揃える。片なしではpendingをref参照し、ガントの通常チェーンをHEAD同様に計算する。
  Date/Author: 2026-11-06 / PR3第3回レビュー修正担当。

- Decision: 片Contextは能力・資源分類・安定した関数に加え、選択片の親Mapと完了待ちの親Setを配る。結合候補は選択中の片の数量コントロールだけがContextから参照し、行propは選択とpendingのbooleanにする。数量小窓は開いた間だけDialogをマウントし、操作不可では数量文字列を返す。
  Rationale: 片0件の選択切替で他行へ再描画を波及させず、数量クリックの特別納期への伝播をHEADどおり保つ。完了overlayのrevision適用は片だけとし、片の応答版はGETの片集合が古い間だけ保持し、同版以上のGETまたは片の置換・消失で親単位に破棄する。分割/結合成功時も対象親のoverlayを破棄する。同一親の完了PUTは応答待ち中に次を受け付けない。片409は通知と再取得に留め、保存後のGET失敗は保存失敗にしない。
  Date/Author: 2026-11-06 / PR3再レビュー2回目修正担当。


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
- Decision: 前向きガントは片ごとに棒を出す。2026-11-05 の片ごとの段取り加算・連続時省略案は、2026-11-06 のユーザー確認で数量按分だけに置き換えた（後記）。
  Rationale: FSIGENSHOYORYO は全数量の合計で段取り1回を含み、追加加算はしない。
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
- Decision: 段取り保存の保留と resource-capacity の setupMinutes 暫定案を撤回する。列・migration・設定画面・連続時省略規則は作らない。
  Rationale: 2026-11-06 ユーザー確認の数量按分のみの決定に置き換えた。段取り値の取得・設定は PR3 の前提条件ではない。
  Date/Author: 2026-11-06 / ユーザー確認、PR3 実装担当記録。
- Decision: 保留: 未採番 `********` を新しい片の対象にするか。暫定的に既存未採番表示は維持し、新規分割だけ409で拒否する。
  Rationale: 既存は ProductNo を足すがユーザー確定キーは4列。複数の未採番指示を誤結合しないため、確認前に仕様を拡張しない。通常製番の実装は進行可能。
  Date/Author: 2026-11-05 / 調査担当、保留。

- Decision: PR1 は親専用の advisory lock・順位競合検証を `order-assignment/` に移し、世代 token の payloadVersion と製番 payloadFormat を2へ更新する。旧片と `split:` override は読み書きせず、Prisma の旧4モデル・relation・migration 履歴は保持する。
  Rationale: 親の409・繰り上げ・場所 fallback を維持し、撤去前の片入り snapshot は既存 stale 応答で再取得させる。補助同期は旧片を変更せず通常の winner へ追従する。補助同期の integration も他の製番テストと同じ専用 TEST_DATABASE_URL 判定を使い、未指定時は DB 検証未実行とする。
  Date/Author: 2026-11-05 / PR1 実装担当。

- Decision: PR2 migration は schema 間の `prisma migrate diff --script` で生成し、CHECK制約を追記した。
  Rationale: migrate dev --create-only のshadow DBを使わず、ユーザー指定の1DBだけに接続するため。履歴の変更・db push・既存表DROP/DMLはない。
  Date/Author: 2026-11-06 / PR2実装担当。
- Decision: 明示includePieces=trueの応答だけに `pieceCapabilities: { createEnabled, includePieces: true }` を追加する。
  Rationale: 既定の親GET応答の形を維持し、新クライアントには読取対応・作成ゲートを明示する。loadとpayload/query key・継続ページにもincludePiecesを通す。
  Date/Author: 2026-11-06 / PR2実装担当。
- Decision: 論理ロック後の再読にはReadCommittedを使う。複数siteのID置換/削除は専用advisory lockで直列化し、siteKey順に全board stateをロックする。
  Rationale: ロック待ち前のスナップショットを再利用せず、分割/結合のlane再採番と数量減少によるoverride削除が別親でも競争しないようにする。資源並べ替えは対象の論理キー群→site state→親行の順とする。
  Date/Author: 2026-11-06 / PR2実装担当。
- Decision: 生産日程の作成/更新/loser削除は100行単位で、同じtx内に片Progress公開を含める。同一ProductNoのwinner ID交換だけ、既存supplementとfkmailの行参照を付け替える。
  Rationale: 一時的な未完了の公開を避ける。製造orderが変わる場合の補助・メール照合は各正本の同期に任せ、別論理キーへの移行は行わない。補助同期のロック後に対象/winnerが変わっていたらSOURCE_ITEM_MISSINGで明示再計画を要求する。
  Date/Author: 2026-11-06 / PR2実装担当。
- Decision: 無変更の同期では集合versionを増やさず、外部完了中のcomplete再送は手動値を書かないno-opとする。
  Rationale: 古い版の誤受理を防ぐ墓標は維持しつつ、不必要な409と外部訂正後の偽の手動実績を防ぐ。
  Date/Author: 2026-11-06 / PR2実装担当。

- Decision: PR2 レビュー修正では、同期・公開・既存書込の片用 logical lock / board state lock を live pieces のある set に限定し、全 CsvDashboardRow 論理キーの列挙を廃止する。初回分割は分割側で既存の mail critical lock を logical lock より先に取得する。
  Rationale: Pi5 の既定共有ロック表を約7,200行分の advisory lock で消費しない。片なし・tombstone では片用ロックを追加せず、完了 no-op の tx 省略、CSV APPEND の createMany、DEDUP の既存 create / update / cleanup、CSV progress の非tx経路、並べ替えの RepeatableRead と親ロック順を維持する。set の判定は一括取得し、行ごとの winner / set 読取を増やさない。
  Date/Author: 2026-11-06 / PR2レビュー修正担当。
- Decision: live pieces があるメール同期だけ外部完了・片同期を置換 tx 内で一度公開し、後続の外部完了再同期を省略する。片なしのメール同期は従来の後続同期を使う。今回拡張した interactive tx は timeout=30秒 / maxWait=15秒を明示する（既存のメール・補助同期の専用値は維持）。
  Rationale: 同じ同期内で長い全件更新・片ロックを繰り返さず、片の公開整合性と既存の片なし経路を両立する。
  Date/Author: 2026-11-06 / PR2レビュー修正担当。
- Decision: pieces=0 は数量の妥当性より先に判定し、tombstone に数量警告・数量同期を書かない。親投影は墓標の警告を表示せず、補助CSVの0/null保存は従来 parser の結果に従う。set 読取は fseiban IN の1クエリで候補を取得して正確な論理キーで絞る。
  Rationale: 墓標は過去の分割版の競合検出に残すだけで、通常親の警告表示・数量保存規則を変えない。
  Date/Author: 2026-11-06 / PR2レビュー修正担当。

- Decision: 片の所要分は `sourceMinutes * piece.quantity / plannedQuantity` の浮動小数のままとし、片ごとに丸めず段取りを加算しない。続けて加工して早く終わった時間は、片の完了入力後に既存の前向き配置が後続予定を前へ詰めることで吸収する。
  Rationale: 移動票の FSIGENSHOYORYO は全数量分の合計で段取り1回分を既に含む。連続加工するかは実行時まで未確定。従前の段取り加算 Decision と Milestone 3 の保存案を置き換える。
  Date/Author: 2026-11-06 / ユーザー確認、PR3 実装担当記録。
- Decision: API の変更は投影 `expandSessakuPieces` の小数2桁丸め除去だけとする。
  Rationale: web には親の元所要分が渡らず、既存 API の丸めを画面だけでは復元できない。数量按分の合計保持に必要な最小修正。DB・API の入出力形は変えない。
  Date/Author: 2026-11-06 / PR3 実装担当。

- Decision: PR3 は片0件時の HEAD の動作を維持する。通常行の完了は納期/順番保存中も許可し、完了409は全体の編集停止にしない。片409は再取得と既存トーストに留める。工程/ピン競合時の既存フォールバックと explicitHead を維持し、兄弟片だけを同一工程として扱う。
  Rationale: 本番の作成ゲートOFF・片0件で既存操作を変えない。片の完了応答は全兄弟の版を直ちにoverlay/refへ反映する。数量按分は計算を丸めず表示だけ小数1桁とし、選択片を親Mapで一度集計しProvider値をmemo化する。分割後は最初の新片の数量へfocusを渡し、ガードで拒否した操作は小窓を閉じない。
  Date/Author: 2026-11-06 / PR3レビュー修正担当。

## Outcomes & Retrospective


調査と設計文書の作成を完了した。実装・テスト実行・migration 適用・PR・統合・本番反映は未実施である。旧分割の OFF 経路にも撤去対象があり、全片完了を Progress に書くだけでは、CSV progress 同期や既存親完了 API から上書きされることが分かった。本書ではそれらの書き手も同じ集約処理へ接続する。実装完了時は、数量5のシナリオ、競合、取り込み訂正、PR単独稼働の証拠をここへ追記する。

PR3 (2026-11-06): ローカル実装と要求された検証を完了。片の数量操作、itemId 単位の完了・取消、能力ゲート、全前工程待ち、按分所要分を接続した。実端末・実DBをつないだ通し操作、別site保存、再取り込みは今回実行していない。commit / push / PR / merge / deploy も行っていない。PR2 の実DB検証記録と PR3 の component/client/layout 検証を区別する。

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

`grinding-planning-board-load-summary.ts` の SQL 経路と fallback を同じ片数量・実効完了で計算し、親と片を二重計上しない。これは表示前の未選択製番を含む負荷にも適用する。負荷表示・ガントとも数量按分した所要分だけを使い、段取りを追加しない。

`grinding-planning-board-due-scope.service.ts` の読取・一括書込・revision は親の論理キーから片とその override を列挙する。既存納期一括変更による片の rank 失効や親納期の継承を維持する。`process-arrival.service.ts` の specialDue 用 itemKey は `piece:` を認識するが、着の完了計算 SQL は変えない。自己検査・順位 shell・配膳に新しい片展開を追加しない。

API 追加・完了・同期の詳細は後節どおり実装する。導入ゲート `SESSAKU_PIECES_CREATE_ENABLED` は API 側だけに新設し既定 false とする。旧 pilot / web build flag を再導入しない。false では新規分割と再分割だけ403、すでにある片の読み取り・結合・完了・取消・同期は有効のままとする。既存製番ボード GET は片を展開しない親応答を既定とし、`includePieces=true` を明示した要求だけ新しい投影を返す。同じ指定を load API、snapshot key、キャッシュキー、ページング継続に一貫して含める。

PR2 単独デプロイではゲート OFF、片0件の本番は従来と同じになる。隔離テスト環境でのみゲート ON にし、新APIから作った片を新形式GETで検証する。旧形式GETは親1行で全片集約完了を返し、既存親完了 API は全片へ作用するので、古い端末がいても整合を壊さない。片あり親に対する旧形式の製番ボードの rank/resource/due/pin/resource-order/bulk 書込は `PIECES_REQUIRE_PIECE_TARGET` の409で一括拒否し、通常の stale notice と再取得へ流す。親 override だけを更新して成功としない。製番順・資源capacity・明示した納期scopeの一括更新は引き続き許可し、scope更新は片へ展開する。順位ボードの親 assignment 更新は既存の親順位として維持する。この互換経路は端末更新期間のためであり、別画面への片表示はしない。

### Milestone 3 / PR3: 合意済みの製番ボードUIと前向きガントを接続する


`apps/web/src/api/domains/production-schedule/grinding-planning-board.ts`、`api/hooks/production-schedule/grinding-planning-board.ts` に新 API client / mutation と `includePieces=true` を追加する。新旧の反復ポーリングが混じってキャッシュを上書きしない query key にする。利用可能なサーバー能力は GET 応答の `pieceCapabilities`（作成可否、片応答対応）で判断し、旧サーバーの応答に無いときは分割操作を出さない。

`ProductionScheduleGrindingPlanningBoardPage.tsx:toggleCompletion` と completion overlay / pending / undo を itemId 単位に変更し、row は既存 API、piece は片 intent API に送る。親の数量・済みが変わる成功応答で同じ親の全表示と候補、負荷、工程チップ、着の query を無効化する。UI 操作は `usePlanningBoardWriteQueue.ts` の版・再取得パターンに合わせ、409時は古い操作を自動再送せず最新表示を取得し、必要なら既存 notice を使う。片が統合・削除された後の古い undo は409として何も変更しない。

`PlanningBoardItemTable.tsx` と資源・フォーカス表示の共通数量セルへ、小さな `PlanningBoardPiecePopover.tsx` を追加する。−/＋ は分け数2から対象数量まで、分ける処理は後節の決定的数量列を使う。通常行5なら [2,3]、未済み片3を2分割なら [1,2] とする。済み片の数量枠は再分割不可とし、複数の未済み片を選んでまとめられるよう既存の選択状態を使う。済みを含む結合は許さない。

数量セルは片の数量「2／5」と全片の数量比の細い帯を出す。warning は当該親に属する表示行とガント棒の赤枠で示し、説明のための補助テキストは足さない。`PlanningBoardCompletionButton` を片にも出し、外部完了は既存どおり取込表示・操作不可とする。小窓は既存のアクセシブルな popover/dialog パターンを使い、アイコンに aria-label、Escape とフォーカス復帰を付ける。新しいライブラリは不要である。

前向きガントでは `forwardPlanningBoardPredecessors` の返り値を、各アイテムから「厳密に前の工程の全未済みアイテムID集合」へ変える。論理親の兄弟片同士は前工程にしない。次工程の ready はその集合の end の最大値とし、一部完了で先へ流さない。資源の順番が工程依存と衝突する場合の既存フォールバックを維持しつつ、未配置の前工程を現在時刻扱いで黙って通さない。実現できない提案順は既存のエラー経路で差し戻す。

`planningBoardGanttLayout.ts:buildForwardPlanningBoardGanttLayout` と `planningBoardAutoOrder.ts:planningBoardAutoOrder` は API 投影の同じ `requiredMinutes` を既存 `placeForward` に渡す。段取り加算用の `resolvePlanningBoardRunMinutes` は作らない。

従前の resource-capacity への `setupMinutes Float?` 保存案は 2026-11-06 のユーザー確認で撤回した。列・migration・設定画面は追加せず、段取り未設定による不明時間も導入しない。

数量比例の加工分は浮動小数の分のまま `sourceMinutes * piece.quantity / plannedQuantity` とし、片ごとの Math.round で総所要時間を増減させない。0分は既知の0として扱い、現行の `!item.requiredMinutes` による「不明」判定を null/known 判定へ狭く修正する。元数量不明・0または数量不整合は所要分不明とする。休憩・日跨ぎの分割は既存 `placeForward` を使う。後ろ向きガントも同じ片別の按分所要分を使い、段取りを加算しない。

PR3 単独で PR2 上にデプロイしてもゲート OFF なら既存操作を維持する。能力応答を見て分割操作を有効にし、ゲート ON は全APIがPR2以降・新UI配信済みという確認後に、明示承認された本番設定変更として行う。ゲートを OFF に戻しても既存片を消したり親1行だけにして隠したりしない。

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

migration は `apps/api/prisma/migrations/<timestamp>_add_sessaku_pieces/migration.sql` とする。CREATE TABLE、FK、index に加え、quantity>0、position>0、version>0、nextPosition>0、plannedQuantity>=0またはnull、completedAt と isCompleted の整合の CHECK を付ける。warning は `COMPLETED_QUANTITY_EXCEEDS_PLAN` / `INVALID_PLANNED_QUANTITY` の既知値だけ許す。全片合計=指示数は行を跨ぐためサービスの同一トランザクションとテストで保証する。段取り列とその migration は追加しない（2026-11-06 ユーザー確認）。

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


以下の PR1 / PR2 手順は各段階の記録として保持する。2026-11-06 の PR3 では末尾 PR3 evidence のローカル実装・検証だけを実行した。作業前に `.cursor/rules/00-core-safety.mdc`、`10-quality-ci-and-tests.mdc`、`20-git-workflow.mdc` を読み、その段階に必要なルールを追加で読む。Git 操作は承認範囲を超えない。既存task worktreeを引き継ぎ、ユーザーWIPの reset / stash / checkout をしない。

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

前向きガントはAの片2の加工40分、片3の加工60分を別棒にする。同資源の A2→A3 は40+60=100分、A2→B→A3 もAの棒だけで40+60=100分となり、B自身の所要分は別に足される。別資源へ置いても片2=40分・片3=60分で加算しない。描画・提案順の評価で同じ時刻になり、次工程の棒はAの両片が終わるまで始まらない。休憩、日跨ぎ、不明所要時間、0分、pin・特別納期を含む既存テストも維持する。

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

PR3 終了時は `git status --short`、`git diff --check` と対象ファイルの差分を確認し、末尾の変更ファイル一覧と一致することを確認する。開始時 WIP は0件であり、今回の差分と他作業を混ぜない。

改訂記録: 2026-11-05、初版および整合性レビュー反映。ユーザー確定の片設計を基準に現行コードを調査し、旧分割のOFF経路、ガントの前工程依存、複数のProgress書き手、段階導入・ロールバックの制約を追加した。コード変更は行っていない。レビューでは、旧形式の親書込を409にする境界、片0件の墓標からの自動復活防止、外部完了訂正時の数量再補正、空メールCSVの既存skip方針を明記した。

### PR2 implementation evidence (2026-11-06 JST)

Migration: `20261106000000_add_sessaku_pieces`。新2表・FK・index・CHECKだけを追加し、旧4モデルと履歴を保持した。指定DBへの初回deployと再deploy（No pending migrations）を確認した。migration適用直前/直後の既存fixture件数比較は採取していない。

実行した主な検証（全DB接続は指定のsessaku_testのみ）:

| Command / scope | Result |
| --- | --- |
| `prisma migrate diff --from-schema /tmp/sessaku-before.prisma --to-schema prisma/schema.prisma --script` | additive SQL生成、レビュー済み |
| API `prisma validate` / `prisma generate` / `prisma migrate deploy` | 全てexit 0。再deployは適用なし |
| `pnpm --filter @raspi-system/shared-types build` | exit 0 |
| slip-match-core / shelf-layout-core / part-search-core build | 不足していた既存依存の生成物を準備、exit 0 |
| plan Concrete Stepsの純粋関数・既存投影・process-arrival | 43 passed |
| API `vitest run src/services/production-schedule src/routes/kiosk/production-schedule` | 最終の広い実行は1163 passed / 4 failed / 0 skipped（56.31秒） |
| sessaku-pieces全体、追加route、board unit、補助integration、CSV post/importを指定したfocused実行 | 156 passed / 0 skipped（14.82秒）。上記の変更起因board mock 2件は80件のunit内で解消 |
| 追加のpiece-key境界 | 6 passed（未採番409とBigInt桁保持を含む） |
| 片・小数負荷の最終追加検証（piece modulesとload-summary integration） | 57 passed / 0 skipped（9.54秒）。SQLとfallback/投影の丸めを一致させた |
| API `pnpm --filter @raspi-system/api lint` / `exec tsc --noEmit -p tsconfig.build.json` | いずれもexit 0。後続SQL/テストの対象eslintもexit 0 |
| web `pnpm --filter @raspi-system/web lint` / `exec tsc --noEmit -p tsconfig.json` | いずれもexit 0 |
| `git diff --check` | exit 0 |
| 最後のCSV post/import対象 | 26 passed（1.79秒） |
| web `vitest run src/features/kiosk/grindingPlanningBoard src/pages/kiosk src/api` | 最後の広い実行は1192 passed / 1 failed（41.91秒）。省略引数undefinedによる変更起因1件 |
| web API client / progressive hookの修正後focused検証 | 24 passed（2.62秒）。上記1件を解消 |
| web API/query-key・製番page・assembly pageのfocused検証 | 184 passed。初回広い実行のtimeout/一時失敗は再現しなかった |

残っている既存期待値との不一致（無関係な修正は禁止のため保持）:

- `grinding-planning-board.integration.test.ts:1114`: 初回読取ごとに新しいsnapshot IDを発行する既存処理に対して、旧片更新前後の同一IDを期待する。
- `grinding-planning-board-due-scope.integration.test.ts:716`: 既存restore処理が元納期へ戻してrankを消すのに対し、CSV未設定のnullとrank=5の保持を期待する。

ローカル実装の検証を記録したもので、全対象テスト成功・main統合・本番反映を示すものではない。commit / push / PR / merge / deploy は未実施。段取り時間・PR3 UIは未実装。開始時WIPなしで、以下は全て今回の差分。

Changed files:

- `apps/api/prisma/migrations/20261106000000_add_sessaku_pieces/migration.sql`
- `apps/api/prisma/schema.prisma`
- `apps/api/src/routes/kiosk/production-schedule/__tests__/sessaku-pieces.route.test.ts`
- `apps/api/src/routes/kiosk/production-schedule/grinding-planning-board.ts`
- `apps/api/src/routes/kiosk/production-schedule/index.ts`
- `apps/api/src/routes/kiosk/production-schedule/sessaku-pieces.ts`
- `apps/api/src/services/csv-dashboard/csv-dashboard-dedup-cleanup.service.ts`
- `apps/api/src/services/csv-dashboard/csv-dashboard-ingestor.ts`
- `apps/api/src/services/production-schedule/__tests__/fkojunst-status-mail-sync.pipeline.test.ts`
- `apps/api/src/services/production-schedule/__tests__/grinding-planning-board-due-scope.integration.test.ts`
- `apps/api/src/services/production-schedule/__tests__/grinding-planning-board-source.test.ts`
- `apps/api/src/services/production-schedule/__tests__/grinding-planning-board.service.unit.test.ts`
- `apps/api/src/services/production-schedule/__tests__/order-supplement-sync.service.test.ts`
- `apps/api/src/services/production-schedule/__tests__/production-schedule-command.service.test.ts`
- `apps/api/src/services/production-schedule/__tests__/progress-sync-from-csv.service.test.ts`
- `apps/api/src/services/production-schedule/d-schedule-minutes/apply-d-schedule-minutes.service.test.ts`
- `apps/api/src/services/production-schedule/d-schedule-minutes/board-due.sql.test.ts`
- `apps/api/src/services/production-schedule/external-completion/__tests__/fkojunst-external-completion-sync.service.test.ts`
- `apps/api/src/services/production-schedule/external-completion/fkojunst-external-completion-sync.repository.ts`
- `apps/api/src/services/production-schedule/external-completion/fkojunst-external-completion-sync.service.ts`
- `apps/api/src/services/production-schedule/fkojunst-status-mail-sync.pipeline.ts`
- `apps/api/src/services/production-schedule/grinding-planning-board-due-scope.service.ts`
- `apps/api/src/services/production-schedule/grinding-planning-board-load-summary.ts`
- `apps/api/src/services/production-schedule/grinding-planning-board-projection.ts`
- `apps/api/src/services/production-schedule/grinding-planning-board/read.ts`
- `apps/api/src/services/production-schedule/grinding-planning-board/shared.ts`
- `apps/api/src/services/production-schedule/grinding-planning-board/source.ts`
- `apps/api/src/services/production-schedule/grinding-planning-board/state.ts`
- `apps/api/src/services/production-schedule/grinding-planning-board/write.ts`
- `apps/api/src/services/production-schedule/order-supplement-sync.pipeline.ts`
- `apps/api/src/services/production-schedule/order-supplement-sync.service.ts`
- `apps/api/src/services/production-schedule/process-arrival.service.ts`
- `apps/api/src/services/production-schedule/production-schedule-command.service.ts`
- `apps/api/src/services/production-schedule/progress-sync-from-csv.service.ts`
- `apps/api/src/services/production-schedule/sessaku-pieces/__tests__/piece-completion.test.ts`
- `apps/api/src/services/production-schedule/sessaku-pieces/__tests__/piece-key.test.ts`
- `apps/api/src/services/production-schedule/sessaku-pieces/__tests__/piece-quantity.test.ts`
- `apps/api/src/services/production-schedule/sessaku-pieces/__tests__/sessaku-pieces.integration.test.ts`
- `apps/api/src/services/production-schedule/sessaku-pieces/piece-completion.ts`
- `apps/api/src/services/production-schedule/sessaku-pieces/piece-key.ts`
- `apps/api/src/services/production-schedule/sessaku-pieces/piece-load.sql.ts`
- `apps/api/src/services/production-schedule/sessaku-pieces/piece-quantity.ts`
- `apps/api/src/services/production-schedule/sessaku-pieces/piece-source-publication.ts`
- `apps/api/src/services/production-schedule/sessaku-pieces/piece-sync.ts`
- `apps/api/src/services/production-schedule/sessaku-pieces/sessaku-pieces.schemas.ts`
- `apps/api/src/services/production-schedule/sessaku-pieces/sessaku-pieces.service.ts`
- `apps/web/src/api/domains/production-schedule.grinding-planning-board.test.ts`
- `apps/web/src/api/domains/production-schedule/grinding-planning-board.ts`
- `apps/web/src/api/hooks/production-schedule/grinding-planning-board.ts`
- `apps/web/src/api/queryKeys/productionSchedule.ts`
- `docs/plans/2026-11-05-sessaku-split-pieces.md`
- `packages/shared-types/src/common/production-schedule-grinding-planning-board.ts`

改訂記録: 2026-11-06 PR3。ユーザー確認の数量按分のみの決定で旧段取り Decision・保存案・業務シナリオを置き換えた。ローカル実装・検証結果は PR3 evidence に記録する。

### PR3 implementation evidence (2026-11-06 JST)

API client / query key は PR2 の既存契約を使用し、ページ・load を includePieces=true にした。数量小窓は既存 Dialog を使用する。片作成は能力応答・切削区分で制御し、作成ゲート OFF でも未済み片の結合と完了・取消は可能。409 は再送せず最新ボードを取得する。

| Command / scope | Result |
| --- | --- |
| `pnpm -r --filter "./packages/**" build` | exit 0、5パッケージ。初回は依存未導入で tsc 不在、frozen-lockfile install 後に解消 |
| `pnpm --filter @raspi-system/web lint` | 最終 exit 0。初回の import 順とページ行数上限を修正 |
| `pnpm --filter @raspi-system/web exec tsc -p tsconfig.json --noEmit` | 最終 exit 0、約7秒 |
| web `vitest run src/features/kiosk/grindingPlanningBoard src/features/kiosk/productionSchedule src/features/kiosk/leaderOrderBoard src/pages/kiosk/ProductionSchedule src/api/domains/production-schedule src/api/hooks/production-schedule` | 141 files / 1161 passed、30.55秒 |
| 完了hook移設・画面追加ケース後の web `vitest run src/features/kiosk/grindingPlanningBoard src/pages/kiosk/ProductionScheduleGrindingPlanningBoardPage.test.tsx src/api/hooks/production-schedule-pieces.test.tsx` | 32 files / 455 passed、17.22秒。上記後に追加した赤枠2件と競合提案・分割409の2件を含む |
| API `vitest run src/services/production-schedule/__tests__/grinding-planning-board-projection.test.ts` | 19 passed、0.30秒。1/3+2/3=1と既知0を含む |
| `pnpm --filter @raspi-system/api lint` / `exec tsc --noEmit -p tsconfig.build.json` | いずれも exit 0 |
| `pnpm kiosk-sop:source-check` | exit 0、source digests current。manifest更新不要 |
| `git diff --check` | 最終 exit 0 |

初回 focused web の失敗3件は includePieces に伴う load 引数と数量セルの DOM に対する旧期待値であり、更新後は上記全体検証で成功。初期環境には node_modules と Prisma Client 生成物が無く、`pnpm install --frozen-lockfile` と `XDG_CACHE_HOME=/tmp/pr3-prisma-cache pnpm --filter @raspi-system/api exec prisma generate` で準備した。通常の Prisma cache は sandbox 外への utime で失敗したため一時cacheへ切り替えた。DB接続・migration・依存追加・lockfile変更はない。ブラウザーおよび実機の通し確認は未実施。

計画との差分はユーザー確認の段取り撤回、必要最小限の API 投影丸め除去、既存ページ行数制限に合わせた完了hook移設。開始時 WIP なし、以下は今回の変更ファイル（既存ファイルの変更と新規ファイルを含む）。

- `apps/api/src/services/production-schedule/__tests__/grinding-planning-board-projection.test.ts`
- `apps/api/src/services/production-schedule/grinding-planning-board-projection.ts`
- `apps/web/src/api/domains/production-schedule.grinding-planning-board.test.ts`
- `apps/web/src/api/hooks/production-schedule-pieces.test.tsx`
- `apps/web/src/api/hooks/production-schedule/grinding-planning-board.ts`
- `apps/web/src/features/kiosk/grindingPlanningBoard/PlanningBoardFocusView.tsx`
- `apps/web/src/features/kiosk/grindingPlanningBoard/PlanningBoardItemTable.tsx`
- `apps/web/src/features/kiosk/grindingPlanningBoard/PlanningBoardPageView.tsx`
- `apps/web/src/features/kiosk/grindingPlanningBoard/PlanningBoardPiecePopover.test.tsx`
- `apps/web/src/features/kiosk/grindingPlanningBoard/PlanningBoardPiecePopover.tsx`
- `apps/web/src/features/kiosk/grindingPlanningBoard/PlanningBoardResourceView.tsx`
- `apps/web/src/features/kiosk/grindingPlanningBoard/PlanningBoardSeibanPane.tsx`
- `apps/web/src/features/kiosk/grindingPlanningBoard/__tests__/PlanningBoardItemTable.completion.test.tsx`
- `apps/web/src/features/kiosk/grindingPlanningBoard/gantt/PlanningBoardChainStrip.tsx`
- `apps/web/src/features/kiosk/grindingPlanningBoard/gantt/PlanningBoardForwardGanttRow.tsx`
- `apps/web/src/features/kiosk/grindingPlanningBoard/gantt/PlanningBoardGanttRow.tsx`
- `apps/web/src/features/kiosk/grindingPlanningBoard/gantt/PlanningBoardGanttView.test.tsx`
- `apps/web/src/features/kiosk/grindingPlanningBoard/gantt/PlanningBoardGanttView.tsx`
- `apps/web/src/features/kiosk/grindingPlanningBoard/gantt/planningBoardAutoOrder.test.ts`
- `apps/web/src/features/kiosk/grindingPlanningBoard/gantt/planningBoardAutoOrder.ts`
- `apps/web/src/features/kiosk/grindingPlanningBoard/gantt/planningBoardGanttLayout.test.ts`
- `apps/web/src/features/kiosk/grindingPlanningBoard/gantt/planningBoardGanttLayout.ts`
- `apps/web/src/features/kiosk/grindingPlanningBoard/usePlanningBoardCompletion.ts`
- `apps/web/src/pages/kiosk/ProductionScheduleGrindingPlanningBoardPage.test.tsx`
- `apps/web/src/pages/kiosk/ProductionScheduleGrindingPlanningBoardPage.tsx`
- `docs/plans/2026-11-05-sessaku-split-pieces.md`

### PR3 review corrections evidence (2026-11-06 JST)

レビュー開始時は前回PR3の未コミットWIPが存在し、その差分を保持して追補した。今回の修正はwebと本計画書のみで、前回WIPのAPI投影変更には手を加えていない。DB・API契約・依存・秘密情報の変更、commit / push / PR / merge / deploy は行っていない。

通常行の完了条件・409通知と、ピン競合fallback・同一/欠損工順の直列・通常行0分不明・explicitHeadをHEADへ戻した。片は全兄弟の応答版をoverlay/refへ反映し、兄弟を重なりと工程数から除外（工程stripの件数も親単位）。拒否された分割/結合は既存通知を出して小窓を維持し、分割後は最初の新片の数量へfocusを渡す。数量1でそのボタンが無効な場合は同じ行の選択欄へ渡す。分の表示だけ小数1桁に整え、通常行の書式と計算値を保った。Provider値をmemo化し、選択片の親Mapと結合可能IDを一括集計して行側を定数時間の参照にした。

| Command / scope | Result |
| --- | --- |
| `pnpm --filter web lint` | 最終exit 0（約2分）。hook依存のwarningは追補の対象ESLintで解消、0 errors / 0 warnings |
| apps/web `pnpm exec tsc -p tsconfig.json --noEmit` | 最終exit 0、約8秒 |
| web `vitest run src/features/kiosk/grindingPlanningBoard src/features/kiosk/productionSchedule src/features/kiosk/leaderOrderBoard src/pages/kiosk/ProductionSchedule src/pages/admin/ProductionScheduleLoadBalancingSettingsSection.test.tsx src/api/domains/production-schedule src/api/hooks/production-schedule src/api/queryKeys/productionSchedule.test.ts` | 144 files / 1227 passed / 0 failed / 0 skipped、36.10秒 |
| 最終focus・1000行memo/親Mapのpage/popover検証 | 2 files / 136 passed、15.75秒。数量2→1+1のfocusを含む |
| 工程stripの件数追補後の `vitest run src/features/kiosk/grindingPlanningBoard/gantt/PlanningBoardGanttView.test.tsx` | 1 file / 137 passed。片なし2工程・兄弟片1工程を同じcomponentで比較 |
| 最終追補のpage・工程strip・対応テストの対象ESLint | exit 0、0 errors / 0 warnings |
| `pnpm kiosk-sop:source-check` | exit 0、source digests current |
| `git diff --check` | exit 0 |

初期のfocusedテストは、復元したfallbackの期待値と操作拒否raceのfixtureを修正して解消した。lintのページ行数上限は片のmemo/focus処理を同じfeatureのhookへまとめて解消した。工程stripの追加テストはforward専用の既存UIへ合わせて修正した。Pi4実機とブラウザーでの実測は未実施であり、1000行の線形集計・無関係な再描画でMap/Providerが安定するcomponent/hookテストを性能の根拠とする。

レビュー追補の対象（それ以外の開始時WIPは維持）:

- `apps/web/src/features/kiosk/grindingPlanningBoard/PlanningBoardPiecePopover.tsx` と対応test、`usePlanningBoardCompletion.ts`
- `apps/web/src/features/kiosk/grindingPlanningBoard/PlanningBoardItemTable.tsx`、`planningBoardLoad.ts`、`__tests__/PlanningBoardRequiredMinutes.test.tsx`
- `apps/web/src/features/kiosk/grindingPlanningBoard/gantt/planningBoardAutoOrder.ts`、`planningBoardGanttLayout.ts` と各対応test
- `apps/web/src/features/kiosk/grindingPlanningBoard/gantt/PlanningBoardForwardGanttRow.tsx`、`PlanningBoardForwardQueuePopover.tsx`、`PlanningBoardChainStrip.tsx`、`PlanningBoardGanttView.test.tsx`
- `apps/web/src/pages/kiosk/ProductionScheduleGrindingPlanningBoardPage.tsx` と対応test、本計画書


### PR3 second re-review corrections evidence (2026-11-06 JST)

A〜Hを対象に、Contextの安定参照化と行prop、閉じた数量Dialogの非mount、操作不可数量から特別納期へのclick伝播、通常行の完了overlayと順位/機械書込revisionの分離を修正した。同一親の兄弟片はPUT応答待ち中の2件目を拒否し、保存版は一致GETの後に古いGETが届いても保持する。新しいoverride版を優先し、分割/結合成功時は対象親のoverlayを消す。片を含む一括変更の負荷予測だけ表示を小数1桁へ丸める。数量DialogはreturnFocusを無効にし、取消時だけ自分のtriggerへ戻す。片409は再取得と既存通知に留め、保存後GET失敗は保存成功として小窓を閉じる。auto-orderの死catchを除去した。

回帰テストには、能力OFF/ONで片0件の選択変更が対象行だけを描画すること、数量Dialogが閉じている間は呼ばれないこと、別paneの選択で結合可否が変わること、全件読込前の3表示で片操作を禁止すること、応答前の兄弟完了、版の逆着、通常行の新revisionでの順位/機械保存、片/通常行の負荷書式、保存後focusの非上書き、分割/結合409の非ロック、保存済みGET失敗を含めた。

| Command / scope | Result |
| --- | --- |
| `pnpm --filter web lint` | 最終exit 0、0 errors / 0 warnings、約4分 |
| apps/web `pnpm exec tsc -p tsconfig.json --noEmit` | 最終exit 0、約1分（全件検証と並行） |
| apps/web `pnpm exec vitest run` | 最終696 files / 6212 tests passed、0 failed / 0 skipped、261.98秒 |
| `pnpm kiosk-sop:source-check` | exit 0、source digests current、約1秒 |
| `git diff --check` | exit 0、約1秒 |

最初の全件Vitestも696 files / 6208 tests pass（267.53秒）。読込制限と新override版優先を追補したため最終全件を1回再実行した。focused検証の新規テストで判明したラベル/fixtureと、lintのimport順・未使用変数・既存ページ行数上限は修正済み。編集中のソースを並行読取したlintは位置情報の不整合で失敗したため、ソース確定後に上記コマンドを再実行して成功を確認した。ブラウザー/実機計測は未実施。開始時のAPIその他WIPは維持し、今回API/DBの追加変更、commit/push/PR/merge/deployは行っていない。


### PR3 third review corrections evidence (2026-11-06 JST)

C1〜C7・P1〜P4・T1〜T5/T7〜T11・F1/F2/F4・N1 を対象とした。通常行の完了・描画は HEAD の規則を保ち、片 overlay の親単位破棄、同じ親の保存排他、callback/Map の安定参照、操作可否によらない数量帯、結合の新しい片/親行への focus、二次消費側の無効化と全件 GET 1回、比較順・計算割当・非丸めを修正し、各回帰テストを追加した。完了済み兄弟が先頭にある部分結合も、新しい未完了片へ focus する。

検証: `pnpm --filter web lint`（ソース確定後、約4分）、`pnpm --filter api lint`、web の `pnpm exec tsc -p tsconfig.json --noEmit`、API の `pnpm exec tsc -p tsconfig.build.json --noEmit`、`pnpm kiosk-sop:source-check`、`git diff --check` はすべて exit 0。web 全件 `pnpm exec vitest run --maxWorkers=4` は697 files / 6251 tests pass（294.88秒）。API の projection / load-summary の DB不要単体テスト33件 pass。最後の focus 追補は対象4件 pass。

初回 web 全件は無関係な組立PDF timeout と Service Worker Response.clone の2件が失敗したが、個別89件と上記の制限ワーカー全件で成功した。初回 lint のページ行数上限・import順は修正し、編集中の並行解析で生じた位置ずれはソース確定後の lint / tsc で再検証した。開始時 WIP は保持し、今回の API 追加変更は load-summary とそのテストだけ。DB/schema/migration、commit/push/PR/merge/deploy は実施していない。


## PR3 第4回レビュー修正記録（2026-11-06）

R1/G7は兄弟片の完了待ちと書込待ちを片だけのdisabledへ反映した。片0件・1000行ではpending切替による行走査とpending集合の変更がないことを確認する。R5/G1はHEADのmembership比較へ戻し、結合候補を数量コントロールへ移して、選択されている片だけに「まとめる」を出す。別pane/資源表示でも選択変更行だけが再描画されることを検証した。H3は特別納期モードで数量を文字列にし、H4は通常行の数量操作の書込ガードをrefで開く際に確認する。

R2は集計負荷の整数を従来どおり、小数を1桁で表示し、値自体は丸めない。R3は競合通知と操作不可を保存待ちから分け、R4は400/500/通信失敗もGETする。G6は欠損した結合入力をthrowし、小窓が成功扱いで閉じないようにした。G5の未使用引数、G11の到達不能分岐を削除し、G8のfocus理由をコメント化、G9の空配列と重なり判定を共通化、G10の親別overlay照合をMapで1回の走査へ変更した。G2/G3/G4はContext、版保持、変更証拠を実装に合わせ、H2はインデントを修正した。

H1は起動payload/loadをincludePieces:trueへ揃え、結果が同じload集計はincludePiecesによらず同じキャッシュを使う。ウォームアップ要求とfalse/true間のSQL再利用をテストした。G12はHEADのwebソースを一時ディレクトリへ展開し、同じ `records arrival from a grey queue card, shows the Gantt immediately, and allows cancellation` を実行して、1 passedとXHR AggregateErrorを確認した。初期forward表示の `/machine-signal/resource-uptime` が発生源であり、既存テストは指示どおり変更せず、新規Pageテスト49件は2つのdescribe内で稼働率取得をモックした（49 passed、AggregateErrorなし）。


第4回の最終検証は、`pnpm --filter web lint` / `pnpm --filter api lint`、webの `pnpm exec tsc -p tsconfig.json --noEmit` / APIの `pnpm exec tsc -p tsconfig.build.json --noEmit`、`pnpm kiosk-sop:source-check`、`git diff --check` が成功した。webの `pnpm exec vitest run --maxWorkers=4` は697 files / 6269 tests pass（最終280.85秒）。最初の全件も同数で成功したが、その実行中に片0件の走査防止・HTTPモックを確定したため、最終ソースで1回再確認した。

APIの `pnpm exec vitest run grinding-planning-board-projection grinding-planning-board-load-summary startup-warmup` は41 passed（1.25秒、DB用16件はこのコマンドではskip）。指定のTEST_DATABASE_URL / DATABASE_URLを使い、`grinding-planning-board-load-summary.integration.test.ts` と `sessaku-pieces.integration.test.ts` を別途実行して38 passed（16.10秒）を確認した。新規Pageテスト49件は稼働率HTTPなしで成功し、片0件1000行・親別overlay走査・小数負荷も対象検証で成功した。

開始時の未コミット変更を保持し、指摘対象へ修正を重ねた。最終auditは指定branch/worktreeをDIRTY_PROTECTEDと認識し、履歴とworktreeを維持している。commit/push/PR/merge/release/deployは未実施。ブラウザー・実機の計測は今回の検証に含めていない。


## PR3 第5回レビュー修正記録（2026-11-06）

A1はSQL集計とTS fallbackの兄弟片順をIDで固定し、7→[1,2,4]の非整数按分で両経路の完全一致を検証した。A2は二次GET完了待ちを外し、分割/結合のload GETを追加1回に固定した。片完了のload無効化、board失敗時のstale、load/boardの完了順をテストした。A3はloadの未使用includePiecesを除去し、HTTP query互換と起動boardのincludePieces:trueを維持した。

U1/U3/U12/F2は小窓の操作近くへ既存文言を出し、待機と失敗を分けた。U2はpiecePendingによる全画面ロックを除去、U4は有効数量の当たり判定を44pxへ広げた（ゲートOFFの通常数量は文字列のまま）。U5は対象親/片だけ選択を解除する。U6/F3はガント/チェーンからも片完了にbulkReadyを適用、通常行の条件は維持した。U7/U8/F1はDialogの標準focus復帰と差替時の親/兄弟/表fallbackへ変更し、取得失敗後の次回取得まで復帰先を保持する。U9は開いたdialogがあるEscapeをページ側で無視、U11は開いて350ms以内の背景tapを無視する。U10はDecision Logの根拠により変更せず、F4はrender中のpending参照をstate集合へ揃えた。

検証: `pnpm --filter web lint` / `pnpm --filter api lint`、web `pnpm exec tsc -p tsconfig.json --noEmit` / API `pnpm exec tsc -p tsconfig.build.json --noEmit`、`pnpm kiosk-sop:source-check`、`git diff --check` は成功。web全件 `pnpm exec vitest run --maxWorkers=4` は697 files / 6293 tests pass（235.68秒）、対象web回帰5ファイルは233件 pass（18.03秒）。APIのprojection / load-summary / startup-warmupとrouteの対象単体は113件 pass。指定TEST_DATABASE_URL / DATABASE_URL（127.0.0.1:55432/sessaku_test）で指定DB統合2ファイルは39件 pass。

最初のweb lintのimport空行2件は修正して全件lintを再確認した。新規Pageテストの2件は表示モードとpending単独切替のfixtureを修正し、対象・全件とも成功した。既存の稼働率XHR stderrは前回確認済みの範囲に留め、無関係なコードは変更していない。片0件のpending切替では追加行再描画なし、選択はHEADのmembership比較、起動board warmupはincludePieces:trueを維持した。

開始時WIPは保持し、第5回の変更を指摘対象に重ねた。最終auditは指定branch/worktreeをDIRTY_PROTECTEDと認識し、HEADは開始時と同じcab3d0e9のまま。共有Dialog、DB/schema/migration、秘密情報は変更していない。commit/push/PR/merge/release/deployは未実施。

## PR3 第6回レビュー検証記録（2026-11-06）

- `pnpm --filter web lint` / `pnpm --filter api lint`、web `pnpm exec tsc -p tsconfig.json --noEmit` / API `pnpm exec tsc -p tsconfig.build.json --noEmit`、`pnpm kiosk-sop:source-check`、`git diff --check` は成功。Pageの既存行数上限773は変更せず、追加箇所の整形で収めた。
- web `pnpm exec vitest run --maxWorkers=4` は697ファイル / 6306件成功（250.90秒）。片操作Page対象は58件成功。初回の依頼外の組立画面2件は単独確認で成功し、全件の再実行も成功した。並列負荷下の失敗として記録し、組立画面のコード・テストは変更していない。
- 指定の `TEST_DATABASE_URL` / `DATABASE_URL`（127.0.0.1:55432/sessaku_test）で指定DB統合2ファイルは40件成功（24.86秒）。追加の「複数行 × 割り切れない片」はSQL集計、逆順のwinnerRowIdsによる行列挙、TS投影の完全一致を確認した。
- APIの指定全体検証は起動済みのテストDBを `DATABASE_URL` に指定。既定localhost:5432では接続失敗のため中断した。最初のDB指定実行は2506件成功 / 23件skip、依頼外のCSV 10000行取込1件が30秒timeout。対象1件は単独実行で成功（テスト部分6.59秒）し、他の並列検証が終了した状態で全体を1回再実行した。再実行は2506件成功 / 23件skip / 1件失敗（337.07秒）。Dropbox取込14件は成功したが、未変更の `src/routes/__tests__/signage.integration.test.ts:1354` のbeforeEachが `prisma.loan.updateMany({ data: { returnedAt: new Date() } })` で `Loan_terminal_state_check`（23514）に違反した。対象1件の単独確認でも再現（8.53秒）した。片機能との因果がない既存テスト準備処理の問題として記録し、無関係変更禁止と再実行上限に従い修正・DB手編集・追加全面再実行は行わない。API全体の全件成功は未達。
- 最終auditは指定branch/worktreeをDIRTY_PROTECTEDと確認し、HEADは開始時と同じcab3d0e9。既存WIPを保持し、共有Dialog、秘密情報、schema/migrationは変更していない。commit/push/PR/merge/release/deployは未実施。

## PR3 第7回レビュー検証記録（2026-11-06）

- 関連web回帰4ファイルは298件成功（45.96秒）。保存中にGETでtriggerが消える分割/結合、再取得中の全片・対象親の操作抑止、失敗時の即時エラーとEscape、失敗後の定期GETによるfocus奪取防止、無関係な取消通知、片0件・ゲートOFFのblocked/pending切替描画回数、350ms全操作guard、不正片の完了disabled、position優先を確認した。
- web全件 `pnpm exec vitest run --maxWorkers=4` は697ファイル / 6320件成功（276.91秒）。最終コード前に開始した全件実行は、C2の対象親完了ゲート追加のため中断し、最終コードで上記1回を完走した。
- `pnpm --filter web lint` / `pnpm --filter api lint`、web `pnpm exec tsc -p tsconfig.json --noEmit` / API `pnpm exec tsc -p tsconfig.build.json --noEmit`、`pnpm kiosk-sop:source-check` は成功。ページの既存773行上限を維持した。
- API指定 `pnpm exec vitest run grinding-planning-board-projection grinding-planning-board-load-summary startup-warmup src/routes` は `DATABASE_URL` に指定DB（127.0.0.1:55432/sessaku_test）を明示し、2506件成功 / 23件skip / 既知1件失敗（579.39秒）。既定5432への接続失敗で最初の実行を中断し、上記環境で1回完走した。失敗はユーザー申告どおり `src/routes/__tests__/signage.integration.test.ts:1354` のbeforeEachにあるloan.updateManyと `Loan_terminal_state_check`（23514）。片機能との因果がない既存問題としてコード・DBを修正せず、追加のbaseline確認・再実行も行わない。
- 指定 `TEST_DATABASE_URL` / `DATABASE_URL` で、指定DB統合2ファイルは40件成功。`git diff --check` も成功。
- lifecycle auditと最終statusで指定branch/worktreeのDIRTY_PROTECTEDを確認。今回の追加変更はweb 8ファイルと本計画書だけで、APIを含む既存WIPは保持した。共有DialogとUI文言は変更せず、commit / push / PR / merge / release / deployは未実施。

- 2026-11-06: 保存中の全画面fieldset/captureを対象操作限定へ修正。常設の `display: contents` と属性CSS、最新状態をrefで読むhandlerにより、片0件・作成OFFへの遷移でも包みを出し入れしない。止めるのはperf-Bの `writeBlocked` 経由の順位・資源/納期保存・並べ替え等と✓/片操作の再保存。選択・開閉・戻る・ガント表示操作・小窓の±/Escape/背景閉じは利用可能。最新の単独8回計測（2026-11-07）は分ける388.9ms（tr 8）、まとめる310.4ms（tr 9）、✓274.7ms（tr 3）。片なし29場面の描画/commitは不変。ユーザー確認済みの同時間帯・基点との交互計測では時間差はほぼ無く、表表示のみ約5%だったため、先の別時刻比較を時間悪化の根拠としない。最新のlint・型検査・web全698ファイル/6347件（198.26秒）・差分検査は成功。詳細な範囲・最終数値・検証は[KB-439「片の操作と保存中切替の再描画削減」](../knowledge-base/KB-439-planning-board-due-sort-performance.md#2026-11-06-片の操作と保存中切替の再描画削減)を正本とする。
- 最新検証（2026-11-07）: web/API lint・型検査、web全698ファイル・6347件、API関連単体35件、指定DB統合20件（skipなし）、単独perf（8試行・178.15秒）、SOP source-check、diff check成功。既存WIPを保持し、共有Dialog・UI文言の変更とcommit・push等は未実施。

## PR3 第三者レビュー R1〜R5（2026-11-07）

R1〜R5はいずれも妥当。保存中のtd/trクリックと取消トーストを拒否し、readyを外部storeへ移してContextを安定化した。数量部品は関連値だけでmemo化し、計数を描画前へ移してready／orderPreview／blockedとDOM同一性を検証する。分割・結合の選択解除は全カテゴリに適用し、親0分の片を不明として投影・TS・SQLを揃えた（親nullの扱いは維持）。詳細と最新計測は[KB-439のR1〜R5記録](../knowledge-base/KB-439-planning-board-due-sort-performance.md#2026-11-07-第三者レビュー-r1r5)を参照。

## 片の新規作成を有効化（2026-11-07）

ユーザーの依頼「分配機能ONにして」により、本番の Pi5 で `SESSAKU_PIECES_CREATE_ENABLED=true` にする。経路は `infrastructure/ansible/inventory.yml` の `api_sessaku_pieces_create_enabled` → `infrastructure/ansible/templates/docker.env.j2` → `infrastructure/docker/.env` → API コンテナの環境変数。API 全体の設定なので端末ごとには分けられず、全キオスクの製番ボードで分割と再分割ができるようになる。戻すときは inventory の値を `"false"` にして通常のローリング更新を流す。false に戻しても、すでにある片の表示・結合・完了・取消は動く。

#2603 の反映(run 20261107-013719-7c3394)では API に届かなかった。標準の Pi5 反映は `infrastructure/docker/.env` を描き直さず、前回の compose.env を写して `roles/release_pi5/tasks/business-hermes-chat-prepare.yml` の一覧にある値だけを書き込むため。その一覧と `api.env.j2` に `SESSAKU_PIECES_CREATE_ENABLED` を足し、`scripts/deploy/tests/test_ansible_standard_release.py` で一覧に入っていることを確かめる。

## 2026-11-07 ガントの分ける／まとめる（ローカル実装）

現在の `feat--gantt-piece-split` worktree で実装。開始時の未コミット変更はなし。git の変更操作、秘密ファイルの参照、commit/push/PR/merge/deploy は実施していない。

- forward の工程帯と backward／製番行の完了ボタン直前へ、共通 `PlanningBoardPiecePopover` を追加。ガント専用 variant は操作可能時だけ数量・sky 枠・▾を表示し、表のトリガー外観は維持する。元の計画・特別納期モードの抑止もページから渡す。
- ガントの `onToggleItem` → ページの `selectedItemIds` → `selectedVisibleItems` → `usePlanningBoardPieceActions` が同じ選択を使用することを確認。帯へ同じ選択 ID を渡し、同親2片の長押し後に「まとめる」が出て選択片が送られることをテストした。
- 分け数変更で従来の均等配分（余りは後ろ）へ戻し、各片の数量調整は最後の片で吸収する。最後の±は visibility hidden、各片の下限は1。表示配列をそのまま送信し、44pxボタンと窓内スクロール・画面高さ上限を維持する。補助説明文は追加しない。
- 片の棒のドラッグ実装は変更不要だった。`piece:` ID のまま同加工機内並べ替え・別加工機への移動が呼び出されることをポインター操作テストで確認。ページの加工機許可・保存経路にも片除外はない。実機・実ブラウザー・実DBでの操作確認は実施していない。

追加テスト名（パラメーター展開前）:

- web: `shows only operable strip quantities: %s`、`splits from the chain strip into adjusted quantities [5,4,3]`、`offers merging after two gantt long presses use the shared piece selection`、`places the backward quantity control immediately before completion (resourceView=%s)`、`drags a piece bar to %s with its piece ID intact`。
- web 共通窓: `bounds every piece at one, balances the last and resets distribution when count changes`、`scrolls many piece rows inside the viewport-bounded dialog`。
- API 計算: `reconciles three pieces on decrease and increase (completed middle=%s)`、`preserves three completed pieces on decrease and appends a new position on increase`。
- API 統合: `merges non-adjacent first and third pieces at the first position, preserving the middle`、`re-splits a middle target into three pieces and renumbers surviving positions in order`。数量・生存ID・並び・position／nextPositionを検査する。

検証（約8分、全体の重いテストは未実行）:

- `pnpm --filter @raspi-system/web test src/features/kiosk/grindingPlanningBoard/PlanningBoardPiecePopover.test.tsx src/features/kiosk/grindingPlanningBoard/gantt/PlanningBoardGanttView.test.tsx`: 最終199件成功、6.43秒。途中は6件、次に9件失敗。棒端へのwrapper追加が既存の完了ボタンDOM位置を変えた点を修正し、追加テストの完了済み／無効状態で帯を開くfixture、layout.groups参照、merge callbackの引数期待を訂正した。
- `pnpm --filter @raspi-system/api test src/services/production-schedule/sessaku-pieces/__tests__/piece-quantity.test.ts src/services/production-schedule/sessaku-pieces/__tests__/sessaku-pieces.integration.test.ts`: 初回はPrisma Client未生成で収集失敗。`pnpm --filter @raspi-system/api exec prisma generate` 成功後、計算21件成功（4ms）、統合は共有パッケージ未buildで収集失敗。
- `pnpm --filter @raspi-system/shelf-layout-core --filter @raspi-system/slip-match-core --filter @raspi-system/part-search-core build`: 成功。再度の統合単独コマンド `pnpm --filter @raspi-system/api test src/services/production-schedule/sessaku-pieces/__tests__/sessaku-pieces.integration.test.ts`: 専用 `TEST_DATABASE_URL` 未設定のため24件skip（新規2件を含む）。Dockerの読み取り確認もソケットへの permission denied。実DBのa/c受入検証は未完了で、サービス本体の不具合の有無は断定しない。
- `pnpm --filter @raspi-system/web exec tsc -b --pretty false`: 初回は共有パッケージ成果物不足で失敗、上記build後に成功。
- `pnpm --filter @raspi-system/api exec tsc -p tsconfig.build.json --noEmit`: 成功。追加で試した `tsc -p tsconfig.json --noEmit` は既存include/rootDirのTS6059、`tsc -p tsconfig.json --rootDir . --noEmit` はJavaScript heap out of memory。これらの設定変更や大きなheapでの反復は行わない。
- `pnpm --filter @raspi-system/api lint`: 成功。`pnpm --filter @raspi-system/web lint`: import/order 3件失敗。修正前を読んだ再実行も同じ3件で失敗。import順修正後、`pnpm --filter @raspi-system/web exec eslint` に今回変更したwebの7ファイル（PageView、PiecePopover本体／テスト、ChainStrip、GanttRow、GanttView本体／テスト）を指定して成功。全体lintの追加反復はしない。
- `git diff --check`: 成功。サーバー実装・API・DB・フラグ・研削・表の見た目は変更しない。終了時の変更は今回のコード／テスト9ファイルと本書のみ。


## 2026-11-07 ガント追加修正（ローカル実装）

- 帯と forward 棒の工程番号は、同じ親の片を同じ番号にする（通常行＋3片は `1,2,2,2`）。通常行どうしは個別番号を維持する。
- GanttView の chain を `processOrder → piecePosition → itemId` 順へ揃える。
- gantt 数量トリガーは操作不能時だけ非表示とし、保存中などの disabled では同じボタンを残す（開いている小窓の扱いは維持）。
- 帯と backward 行の数量 disabled に、Context の `completionPendingParentIds` による同親の完了待ちを含める。

回帰テストは番号と片順、通常行の別番号、forward/backward の保存中ボタンのDOM同一性と無効化、同親完了待ちの無効化と別親への非波及・解除を確認した。

検証結果:

- `pnpm --filter @raspi-system/web test src/features/kiosk/grindingPlanningBoard/PlanningBoardPiecePopover.test.tsx src/features/kiosk/grindingPlanningBoard/gantt/PlanningBoardGanttView.test.tsx`: 最終 **2 files / 204 tests passed**（6.71秒、exit 0）。初回は203 passed / 1 failed（5.95秒）。追加テストの帯を開いた直後の `aria-current` 期待が既存挙動と異なったため修正し、片順は数量トリガーのID順で確認した。baseline-browser-mapping のデータが古い旨の警告あり。
- `pnpm --filter @raspi-system/web exec tsc -b --pretty false`: 出力なし、exit 0。
- `pnpm --filter @raspi-system/web exec eslint src/features/kiosk/grindingPlanningBoard/PlanningBoardPiecePopover.tsx src/features/kiosk/grindingPlanningBoard/gantt/PlanningBoardChainStrip.tsx src/features/kiosk/grindingPlanningBoard/gantt/PlanningBoardGanttView.tsx src/features/kiosk/grindingPlanningBoard/gantt/PlanningBoardGanttRow.tsx src/features/kiosk/grindingPlanningBoard/gantt/PlanningBoardGanttView.test.tsx`: 出力なし、exit 0。

既存作業の上に上記web 5ファイルと本書だけを編集。依頼どおり git 操作（status/diffを含む）と秘密ファイル参照は行っていない。commit/push/PR/merge/release/deploy、実ブラウザー検証は未実施。

### レビュー1回目の指摘と修正（2026-11-07）

- 開いた数量窓は指示数・revisionの更新で2分割へ戻し、送信直前にも各片1以上・合計一致・2片以上を検証する。分け数の±も保存中・blocked中は無効化した。
- APIの400 `PIECE_QUANTITY_CONFLICT` を既存409と同じ更新通知・再取得へ揃えた。ガント内のContextをuseMemoで包み、分割・結合ともcurrentBarsの最新itemを送る。
- 棒・帯のContext購読を数量窓へ集約し、同親完了待ちを共通部品内で判定する。棒端の数量はbackwardだけ表示しleftを0以上に丸める。線は帯・番号と同じ親キーで工程をまとめ、隣接工程間の全棒を結び、同親片間を結ばない。
- 回帰テストに総数5→3／3→2、revision更新、保存中の±、400の文言・再取得、forward/backwardの表示と位置、P→A/B→Nの4接続を追加。既存の保存中カウンター操作の期待は今回の無効化仕様へ更新した。

検証: `apps/web` で `pnpm exec vitest run src/features/kiosk/grindingPlanningBoard src/pages/kiosk` は72ファイル・1161件成功（59.44秒）。その後に追加した左端0pxの境界テストは単独1件成功（2.54秒）。`pnpm exec tsc -b --pretty false` と変更web 9ファイルのeslint（最後に追加したテストも再確認）は成功。初回の関連3ファイル検証は旧仕様のカウンター期待3件が失敗し、仕様に合わせた更新後に上記指定範囲で成功。eslintはページの行数上限を条件式の改行調整で解消した。検証は約4分。

既存WIPを引き継ぎ、今回の編集は上記web 9ファイルと本記録のみ。git操作・秘密ファイル参照・commit・push・PR・merge・release・deployは実施していない。実ブラウザー検証は未実施。

## 不具合時に操作を追う

`requestId` はAPI再起動でリセットされる連番のため、`createdAt` と組で検索する。端末認証に失敗した401は監査表に残らず、pinoログのみで追跡する。

片操作は `sessaku_piece.split` / `sessaku_piece.merge` / `sessaku_piece.complete` / `sessaku_piece.uncomplete` の固定eventで、成功・拒否・失敗を各操作1行記録する。APIのエラー応答の `requestId` はFastifyの `request.id` と同じ。例（APIコンテナ名は環境に合わせる）:

```sh
docker logs --since 1h <api-container> 2>&1 | grep -E '"event":"sessaku_piece\.(split|merge|complete|uncomplete)"'
docker logs --since 1h <api-container> 2>&1 | grep '"requestId":"req-xxx"'
```

操作ログは既存loggerの子loggerでINFO出力を有効にし、本番の既定 `LOG_LEVEL=warn` でも各操作を記録する。他のloggerのレベルは変更しない。監査DBもログレベルに依存せず保存する。

```sql
SELECT * FROM "ProductionScheduleSessakuPieceAuditLog"
WHERE "requestId" = 'req-xxx' ORDER BY "createdAt";
SELECT * FROM "ProductionScheduleSessakuPieceAuditLog"
WHERE "parentItemId" = '<parentItemId>' ORDER BY "createdAt" DESC LIMIT 100;
```

`beforeJson` / `afterJson` は片数 `count`、位置順の数量 `quantities` と対応する `pieceIds`、完了片ID `completedPieceIds`、親指示数 `plannedQuantity`。未分割・全片結合後の片数は0、配分は空配列。拒否・失敗では変更後も変更前と同じ値（rollback）、読める前に失敗した場合はJSON null。`expectedVersion` と `itemRevision` / `itemRevisions` は送信値、`resultVersion` は成功時だけ保存する。認証・入力検証前に失敗した場合や削除済みの片など、解決できないID・端末・数量は未記録/nullとなる。予期しない例外のメッセージは秘密情報を避けるため一般化する。

管理者など既存の閲覧権限で `GET /api/clients/logs?category=sessaku-pieces`（ルートは `/clients/logs?category=sessaku-pieces`）を開き、contextの `action`、`itemId` / `parentItemId`、`errorCode`、`status`、`requestId` を確認する。画面側の失敗だけを既存errorTelemetryのキュー経由で送る。通常は5秒周期で送信し、オフライン時は既存キューに保持する。従業員名、NFCタグ、トークン、ヘッダー全体、任意のエラーオブジェクトは送らない。

保持期間は既存 `ClientNetworkLogRetentionScheduler`（毎日03:20 JST）の30日・最大5000件×10バッチを共有する。ClientLogの対象categoryに `sessaku-pieces` を追加し、監査表も同じcutoffで別途最大10バッチを削除する。旧 `ProductionScheduleOrderSplitAuditLog` は利用・変更しない。

後の工程への分割は `runSessakuPieceOperation({ action: 'propagate', requestId, siteKey, actorClientDeviceId, actorDeviceName, parentItemId, pieceIds, expectedVersion }, async (audit) => { /* transaction内でaudit.beforeJson/afterJson/resultVersionを設定 */ })` を使える。外側にラップし、transactionの完了・rollback後に監査を書く。監査保存失敗は `sessaku_piece.audit_write_failed` のWARNだけを残し、元の応答・例外を維持する。実行中のauditを既存サービスに渡すと二重記録を防ぐ。

本変更のローカル検証: APIの監査・route・保持ジョブ対象21件、webのerrorTelemetry・ページ対象238件が成功（最終ページ再確認198件も成功）。web `tsc --noEmit` / 全体lint、API変更ファイルeslint / `tsc -p tsconfig.build.json --noEmit`、Prisma format / validate、`git diff --check` は成功。既存schemaの無関係な整形差分は残さず、新モデルの整形を確認した。webテストでは既存のjsdom通信エラー出力があるが全件成功。専用 `TEST_DATABASE_URL` がないためDB統合27件はskip（追加した成功・409、既存400への監査assertionを含む）。migration適用・本番反映は未実施。検証時はdotenv自動読込を止め、ViteのenvDirを空の一時パスへ向けた。
