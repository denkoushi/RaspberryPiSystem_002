# 機能のつながりを AI が一度に読める範囲に区切り直す計画

この ExecPlan は生きた文書である。`Progress`、`Surprises & Discoveries`、`Decision Log`、`Outcomes & Retrospective` は作業の進行に合わせて更新する。書き方は `.agent/PLANS.md` に従う。

## Purpose / Big Picture

このシステムは、現場の要望に応えて毎日のように直し続けることで良くなってきた。これからも直し続ける。実装の大半は AI(Claude と Codex)が行う。AI は、一度の作業で読める量を超えた範囲を正しく扱えない。読み切れないまま直すと、見ていない所との食い違いが残る。

そこでこの計画では、機能ごとに、入口から呼ばれているファイルとテストの量を測る。量が大きすぎる所と、同じ型の不具合がくり返す所だけを、ふだんの機能追加と並行して区切り直す。区切り直しは、動きを変えずにファイルを移すか、依存を1本付け替えるだけの小さな PR で進め、その前に今の動きを固定するテストを置く。これまでのファイル分割の PR はこの進め方で、後から直しが要ったものは見つかっていない(調べた結果は、下の Artifacts and Notes の調査メモにある)。

この計画が終わると、次のことができるようになる。

- 誰でも1つのコマンドで、機能ごとの量の一覧、多くの機能を巻き込んでいるファイルの一覧、ファイルどうしの輪の一覧を出せる。
- 製番ボードの保存の約束ごと(版、競合、再送、他の端末への反映)が1か所にまとまり、画面と API の境目のテストで守られる。保存の流れを直す AI は、そこと保存の流れのファイルだけを読めばよくなる。
- 多くの機能を巻き込んで大きくしているファイル数本が、必要な分だけを渡す作りに変わる。

量は、手を入れる場所を見つけるための道具である。目標の数値にはしない。CI で量に上限をかけることもしない。

2026-11-16 に海外の知見を調べた(出典は Artifacts and Notes)。import でたどれる量が小さいほど AI の作業がうまくいく、と直接示した研究は見つからなかった。AI はファイルを全部読むのではなく、探して必要な所だけを読む。助けになるとされるのは、1つの変更に要るファイルが近くにまとまっていること、読まずに済む境目があること、今の動きをテストが固定していることである。そこでこの計画の効き目は、量ではなく「よく直す機能で、1回の変更が触るファイルが少ないこと」と「その動きをテストが守っていること」で見る。手を入れる順番も、量の大きさではなく、実際によく変わり、変更が広く散らばる所から選ぶ。

## 用語

「つながりの量」とは、ある入口のファイルから import をたどって届くファイル全部の文字数のことである。入口は、画面のページ、API の窓口を登録するファイル、定期処理のファイルの3種類とする。複数のファイルを1つの入口として扱う「入口のまとまり」も使う。

文字数を3.5で割った値を、AI のトークン数の目安とする。日本語のコメントが多いファイルでは実際より少なく出るので、粗い比較にだけ使う。以下で「約31万」のように書く数は、このトークンの目安である。

「まとめ役の index」とは、他のファイルの中身を並べて再輸出するだけのファイルである。例えば `apps/web/src/api/client.ts` は、45の分野をまとめて再輸出している。import の行だけを数えると、どの画面も API の全分野を含むことになり、量が2倍前後に膨らむ。そこで、import した名前ごとに、その名前が定義されているファイルまでたどって数える。

「型だけのつながり」とは、`import type` または `import { type X }` で型だけを読む import のことである。実行時には何も読み込まない。「実行時のつながり」は、これを除いたものである。

「輪」とは、ファイル A が B を読み、B がたどって A を読み戻す形のことである。型だけのつながりも含めて数える。既存のリントの import 循環の検査(`import/no-cycle`)は型だけの import を見ないので、型を含む輪はリントでは見つからない。

## Context and Orientation

測る道具は `scripts/analysis/feature-reach/` にある(この計画の PR で追加した)。中身は Interfaces and Dependencies に書く。

2026-11-16 に、main の b4ae9625 で実行時のつながりを測った結果は次のとおりである。

画面は、`apps/web/src/pages` 配下のページ115件である。5万未満が74件、5〜10万が28件、10〜20万が12件、20万以上は製番ボード(`apps/web/src/pages/kiosk/ProductionScheduleGrindingPlanningBoardPage.tsx`)の約31万の1件だけである。典型的な画面では、貸出(`KioskBorrowPage.tsx`)が約8万である。

API は、`apps/api/src/routes` 配下で窓口を登録するファイル168件である。5万未満が93件、5〜10万が33件、10〜20万が25件、20万以上が17件である。20万以上の例は、組立の手順資料(`routes/assembly/procedure-materials.ts`、約60万)、サイネージ(`routes/signage/render.ts` など、約58万)、CSV の取り込み(`routes/imports/schedule.ts`、約58万)、業務 Hermes(`routes/assembly/business-hermes.ts`、約52万)である。同じフォルダには、窓口を登録しないファイルが34本ある(型やスキーマだけのファイル、窓口をまとめて登録するだけのファイル)。道具はこれらを入口にせず、名前を出す。

定期処理では、CSV の取り込み(`services/imports/csv-import-scheduler.ts`)が約58万、業務 Hermes の夜間処理(`services/business-hermes/business-hermes-nightly.scheduler.ts`)が約41万である。定期処理を起動するだけのファイル(`bootstrap/scheduler-leader.ts` など)は、全部の定期処理を読むので約117万になるが、これは数え方による見かけで、手を入れる対象ではない。

製番ボードの画面の約31万のうち、約21万はボード自身のフォルダ `apps/web/src/features/kiosk/grindingPlanningBoard` の中身である。大きいデータのファイルによる水増しではなく、最大でも約1.8万のファイルが多数ある。

製番ボードの「保存の流れ」の入口のまとまり(定義は `scripts/analysis/feature-reach/groups/`)の量は次のとおりである。画面側は、書き込みの待ち行列(`usePlanningBoardWriteQueue.ts`)だけなら約2万、それにオフラインの処理と API を呼ぶ部分を足すと約7万である。API 側は、書き込みの3ファイル(`services/production-schedule/grinding-planning-board/write.ts`、`write-source.ts`、`write-arrival.ts`)と切削の片の数の書き込み(`sessaku-pieces/piece-quantity.ts`)で約16万、自動分割の定期処理(`sessaku-pieces/auto-unit-split.scheduler.ts`)を足すと約20万である。自動分割の定期処理は単独でも約20万あり、`auto-unit-split.service.ts` の9〜12行目でボードの表示用の変換、元データ、状態、機械の能力を実行時に読んでいる。

製番ボードでは、保存が消える、上書きされる、409 になる、待ち行列が止まる、他の端末に届かない、という同じ型の不具合の直しが12件あった。コミットは 9b3f18df、6c9dd60e、9031af96、02768544、f302a0f4、e7318fa3、520d98e2、c55f9e9a、611241d3、d1903d19、1b87230d、78d41a3f で、日付は 2026-11-10 から 11-13 の4日間に集中している。件名を見ると、多くは古い版をもとにした保存、版の食い違いによる 409、保存後の読み直しの取り違えで、保存の約束ごと(版、競合、再送、反映)にかかわる。12件のうち5件は画面と API の両方を直していた。また12件中5件が、画面と API の間でやり取りするデータの形を決めた `packages/shared-types/src/common/production-schedule-grinding-planning-board.ts`(528行)を直していた。

一方、量がもっと大きいサイネージ、組立、取り込み、業務 Hermes では、同じ90日の保存系の直しは0〜1件だった。だから、量が大きいことだけでは不具合は説明できない。製番ボードで目立つのは、画面と API の境目にある保存の約束ごとである。ただし、これは1画面の、しかも短い期間の観察であり、原因とまでは言えない。

製番ボードのまわりには、型だけのつながりを含めると、次の輪がある。

1つ目は9つのファイルの輪である。ボードの状態(`grinding-planning-board/state.ts`、`shared.ts`)、表示用の変換(`grinding-planning-board-projection.ts`、`grinding-planning-board-missing-standard-hours-projection.ts`)、標準工数の未入力(`missing-standard-hours-process.ts`)、メールからの取り込み(`fkojunst-status-mail-sync.pipeline.ts`、`external-completion/fkojunst-external-completion-sync.repository.ts`)、切削の片(`sessaku-pieces/piece-sync.ts`、`piece-quantity.ts`)からなる。この輪を閉じているのは、`missing-standard-hours-process.ts` の6行目が、メールの取り込みの `FkojunstMailNormalizedRow` 型を読む1本である。道具でこの1本を外して数え直すと、9ファイルの輪は消える。

2つ目以降は小さな輪である。表示用の変換の2ファイル(`grinding-planning-board-projection.ts` が実行時に `grinding-planning-board-missing-standard-hours-projection.ts` を読み、逆向きは型だけ)、書き込みとテスト加工の棒(`grinding-planning-board/write.ts` の3行目と `test-bars.ts` の15行目)、切削の片の工程の分割(`piece-op-splits.ts`、`piece-op-configuration.ts`、`sessaku-pieces.service.ts`)、ボードの読み込み(`grinding-planning-board-load-test-bars.ts`、`-load-items.ts`、`-load-summary.ts`)である。

ボードと切削の片は、フォルダの単位では1つのかたまりと考えたほうがよい。`sessaku-pieces` 配下から `grinding-planning-board` 配下への実行時の import は20本近くあり(例: `sessaku-pieces.service.ts` の22〜25行目、`piece-operation-definitions.ts` の8・12・13行目、`auto-unit-split.service.ts` の9〜12行目)、逆向きの import もある。この計画では、2つを別々の部品に分けることは目指さない。

多くの API の入口を巻き込んで大きくしているファイルもある。依存を1本丸ごと外したと仮定した試算は次のとおりである。作業指示の部品を組み立てる `services/work-instructions/work-instruction-service.factory.ts` への依存を外すと、12の入口で1万以上減る(業務 Hermes が約52万から約38万)。生産日程の一覧の表示を整える `services/production-schedule/production-schedule-query/leaderboard-decoration.ts` を外すと、8つの入口で減る(`apps/api/src/routes/kiosk/production-schedule/leaderboard-phased-read.ts` が約27万から約19万)。サイネージから生産日程への依存(`services/signage/signage.renderer.ts` の32行目)を切ると、5つの入口で約7万減るが、サイネージは51万台のまま残る。`services/signage/signage-a2ui-data.service.ts` の先が約31万あるためである。これらは丸ごと外した場合の上限であり、実際に減る量ではない。

テストについて。ボードの結合テスト `apps/api/src/services/production-schedule/__tests__/grinding-planning-board.integration.test.ts` は、15〜23行目と44行目で環境変数 `TEST_DATABASE_URL` を必須にしており、無ければ全件を飛ばす。CI(`.github/workflows/ci.yml` の221行目付近)は `API_TEST_DB_PER_WORKER: '1'` と `DATABASE_URL` を渡すだけで `TEST_DATABASE_URL` を渡さないので、このテストは CI では一度も流れていない。切削の片の結合テスト `sessaku-pieces/__tests__/sessaku-pieces.integration.test.ts` は、66〜69行目で、CI のときは `API_TEST_DB_PER_WORKER` の作業者ごとの DB を使うので、CI でも流れる。手元でテスト用 DB を用意するスクリプトは `scripts/ci/prepare-api-test-databases.sh` である。

既存のリント(`apps/api/eslint.config.mjs`)は、新しいファイルの600行上限、既存の大きいファイルの行数の頭打ち、import の循環(実行時のみ)、層の依存方向を止めている。この計画では、量に新しい数値の上限を足さない。

### 変更の多さと広さ(2026-11-16 追記)

main の 83678cbf で、2026-10-17 の 00:00 以降の1か月の変更を `scripts/analysis/feature-reach/change-width.sh` で数えた。テスト、生成物、文書、画像、`pnpm-lock.yaml` は数えない。区画は `apps/<app>/src` の最上位フォルダで、それ以外は先頭2段(`packages/<名前>`、`scripts/deploy` など)である。

製番ボードの画面のフォルダ(`apps/web/src/features/kiosk/grindingPlanningBoard`)を触ったコミットは102件で、1件あたりのファイル数は中央値5、75%点13、3区画以上にまたがったものが41件だった。ボードの API のフォルダ(`services/production-schedule/grinding-planning-board`)は43件で、中央値8、75%点21、3区画以上25件である。組立は画面26件・API 38件、CSV の取り込みは24件、サイネージは7件、業務 Hermes は9件だった。量が大きいサイネージと業務 Hermes は、ほとんど変わっていない。取り込みは組立と同じくらい変わっている。変更が最も多いのは製番ボードである。

ボードの中では、ガントの画面 `gantt/PlanningBoardGanttView.tsx`(629行)がこの1か月に45回、ページ `ProductionScheduleGrindingPlanningBoardPage.tsx`(813行)が42回変わった。ガントの画面と一緒に変わったのは、前向きの行 `PlanningBoardForwardGanttRow.tsx`(22回)、ページ(16回)、待ちの一覧 `PlanningBoardForwardQueuePopover.tsx`(13回)、`PlanningBoardPageView.tsx`(13回)、`PlanningBoardGanttDisplay.tsx`(12回)、行 `PlanningBoardGanttRow.tsx`(11回)、受け渡しの型 `planningBoardGanttViewTypes.ts`(10回)である。ガントの画面は78個の値を受け取り(`planningBoardGanttViewTypes.ts` の `PlanningBoardGanttProps`。本体71個と `Pick` の7個)、`PlanningBoardPageView.tsx` はそれをページから受けて渡している。行に1つ機能を足すと、ページ、ページの表示、ガントの画面、行、受け渡しの型を順に直すことになる。変更が広がる主な理由は、この値の受け渡しの長さだと見ている。ガントのフォルダにはテストのファイルが34本あり(`PlanningBoardGanttView.test.tsx` など)、表示の動きはある程度固定されている。描き直しの回数を数えるテストも `PlanningBoardGanttMemo.test.tsx` に6本ある。

API 側の保存の流れ(自動分割を除く約15万)の中身も分けた。1ファイルを外すと減る量で見ると、ボードの読み出し `grinding-planning-board/source.ts` が約3.3万で最も大きい。`write.ts` と `write-source.ts` は、行や順位や上書きを数件ずつ読む小さな関数(`readWinnerRowsByIds`、`readRowDetails`、`readRanks`、`readOverrides` など)だけを使うが、同じファイルにボード全体を読む `readPlanningSource`(125〜266行)があり、その先の順位ボードの読み込み(`leaderboard/` 約2.3万)まで届く。順位ボードの読み込みの関数 `fetchLeaderboardScheduleHydratedRowsOrderedByIds` を使うのは `readPlanningSource` の中だけで、小さな関数の側(`readRowDetails`、`readRanks`)は分け方の関数 `chunkLeaderboardRowIdsForHydrate`(`leaderboard/leaderboard-display-row-scope.ts`。import を持たない)しか使わない。だから分ければ減る見込みは高いが、ほかの import も絡むので、量は写しで測ってから決める。次は、設定の読み込み `config/env.ts`(約1.7万。DB の接続 `lib/prisma.ts` 経由で全員が読む)、機械の能力 `grinding-planning-board-resource-minutes.service.ts`(約1.2万)、負荷調整の設定 `load-balancing/load-balancing-settings.service.ts`(約0.8万)である。設定の読み込みは、保存を直す AI が読む必要の無いファイルなので、手を入れない。

## Plan of Work

作業は4つの段階に分ける。各段階は、独立した小さな PR の積み重ねで進める。どの PR も、ふだんの機能追加の流れを止めない。現場の要望の PR と同じファイルを触る場合は、要望の PR を先に通す。

### 段階1: 測る道具

この計画の PR で、道具を `scripts/analysis/feature-reach/` に置いた。月1回の測定手順と記録は [KB-453](../knowledge-base/KB-453-feature-reach-measurement.md) にあり、最初の基準の数はこの計画の Context and Orientation から引き継いでいる。CI には組み込まない。

### 段階2: 製番ボードの保存の流れ

この段階が計画の中心である。順番に意味があるので、上から順に進める。

最初の PR では、ボードの結合テストを CI で流れるようにする。切削の片の結合テストと同じく、CI のときは `API_TEST_DB_PER_WORKER` の作業者ごとの DB を使う判定を入れる。今の動きを固定するテストが CI で働かないまま移動を始めると、壊しても気づけないからである。この PR は、テストの準備の部分だけを変え、テストの中身は変えない。

2つ目に、保存の約束ごとを1か所にまとめる。今、版の付け方、古い版で保存したときの扱い(409)、保存後の読み直し、待ち行列の再送の決まりは、画面側(`usePlanningBoardWriteQueue.ts`、`usePlanningBoardCompletion.ts` などの保存をする hook)と、API 側(`write.ts` など)と、共有の型のファイルに分かれて書かれている。まず、共有の型のファイル `packages/shared-types/src/common/production-schedule-grinding-planning-board.ts` を、読み出しの形と保存の形の2つのファイルに分ける。保存の形のファイルには、保存の操作ごとの要求と応答の型、版の型、409 の応答の型を置く。次に、12件の直しで壊れた場面(古い版での保存、保存中の読み直し、他の端末の変更との競合、オフラインからの再送)を、画面と API の境目のテストとして書く。テストは、API の結合テストで保存の操作を順に呼び、版と応答を確かめる形にする。この2つ目の作業は、動きを変えない。変えたくなる所が見つかったら、記録して別の PR にする。

3つ目に、9ファイルの輪をほどく。`FkojunstMailNormalizedRow` 型を、メールの取り込みのパイプラインの外にある型だけのファイル(`services/production-schedule/fkojunst-mail-row.types.ts`)へ移し、パイプラインと `missing-standard-hours-process.ts` の両方がそこを読む形にする。移すのは型だけで、1つの PR にする。移したあと、道具の輪の一覧で9ファイルの輪が消えたことを確かめる。メールの取り込みが外部完了の同期を呼び、その同期が切削の片を更新する流れは、業務に必要な一方向の呼び出しなので残す。

`stateOrder` を `state.ts` から外へ出す案は、輪をほどくためには要らない。切削の片の `piece-quantity.ts` から読む量を減らす手としては効く見込みがあるので、道具でどれだけ減るかを測ってから、やるかを決める。`stateOrder` は `uniqueFseibans` を呼び、`uniqueFseibans` は `shared.ts` の159行目にあって同じファイルの正規化の関数と定数を使うので、出すならこれらを一緒に、外の処理を一切 import しないファイルへ移す。`stateOrder` は、ボードの読み書き(`read.ts`、`write.ts`、`completion.ts`、`test-bars.ts`)、切削の片(`piece-quantity.ts`、`sessaku-pieces.service.ts`、`piece-operation-definitions.ts`、`auto-unit-split.service.ts`)、D社日程の自動登録(`d-schedule-minutes/auto-register-d-schedule-minutes.service.ts`)が読んでいるので、全部の読み手を付け替える。

小さな輪のうち、保存の流れに入る2つ(書き込みとテスト加工の棒、切削の片の工程の分割)は、この段階で記録だけして、ほどくかは段階2の最後に決める。表示用の変換の2ファイルの輪は、逆向きの型だけの import を、型を片方に寄せて無くす。

4つ目に、画面側の保存の流れと描画を分ける。今の分け方のままでは、保存の流れに読み出しや表示が混ざる。具体的には次の3つを先に行う。

- `apps/web/src/api/hooks/production-schedule/grinding-planning-board.ts` は、読み出しの hook(段階読み込みなど)と保存の mutation が同じファイルにある。読み出しのファイルと保存のファイルに分ける。
- `offline/PlanningBoardOfflineProvider.tsx` は、つながりの状態の管理と、つながりの案内の表示(`PlanningBoardConnectivityBanner`)を1つのファイルでしている。Context とつながりの状態の管理だけを持つファイルと、それを包んで案内を表示するファイルに分ける。書き込みの待ち行列は前者だけを読む。
- `offline/planningBoardOfflineQueries.ts` は、4〜5行目で読み出しの hook と工程の表示用のデータ(`planningBoardProcessChipData`)を読む。これは読み出しの側に置く。

そのうえで、保存の流れに入るファイルを名前で決める。候補は、`usePlanningBoardWriteQueue.ts`、`usePlanningBoardCompletion.ts`、`usePlanningBoardArrival.ts`、`usePlanningBoardDueActions.ts`、`usePlanningBoardTestBars.ts`、`planningBoardPieceOps.ts`、`offline/planningBoardWriteGate.ts`、`offline/planningBoardConnectivity.ts`、分けたあとの Context のファイルと保存の hook のファイルである。各ファイルが描画(`gantt/`、表、ツールバー、ダイアログ)を import していないかを確かめ、している所を付け替える。決めた一覧は `scripts/analysis/feature-reach/groups/save-flow-web.json` に書き、測った結果を Progress に記録する。

この段階で決めないことがある。サーバーを唯一の書き手にすること、つまり自動分割の定期処理も画面と同じ書き込みの経路で書くようにすることは、別の計画で扱う。API 側の保存の流れが約20万あり、その大半が自動分割の定期処理の読み込みなのは、この経路が別にあるためでもある。この段階は、その作業を AI が読み切れる形に整えるところまでを行う。

段階2の最後に残っていた、ガントの hook(`gantt/usePlanningBoardGantt.ts`、`usePlanningBoardPageGantt.ts`)と `gantt/PlanningBoardUnitOpEditor.tsx` をほどくかは、次の段階2bで扱う。保存の流れの一覧には入れないままにする。

API 側の保存の流れについては、`source.ts` を「数件ずつ読む関数」と「ボード全体を読む `readPlanningSource`」の2つのファイルに分ける案を、`stateOrder` と同じやり方で測ってから決める。写しの上で分け、`write.ts` と `write-source.ts` を数件ずつ読む側へ付け替え、`RUNTIME=1` で保存の流れのまとまりを比べる。順位ボードの読み込みが保存の流れから外れ、保存の流れが目に見えて小さくなるときだけ、移動の PR を作る。小さくならないなら、`stateOrder` と同じく見送り、理由を Progress に書く。

### 段階2b: ガントへの値の受け渡しを短くする

製番ボードは、この1か月で最もよく変わった機能であり、その変更は、ページからガントの行までの値の受け渡しに沿って広がっている(Context の「変更の多さと広さ」)。ここを短くすると、ふだんの機能追加で触るファイルが減る見込みがある。

最初に、今の動きを固定する。ガントの34本のテストのファイルで足りない所を確かめ、足りなければテストだけを足す PR を先に出す。見る場面は、1台表示と2台表示、ドラッグ、待ちの一覧、加工時間シート、製番のフォーカスである。描き直しの回数は、既存の `PlanningBoardGanttMemo.test.tsx`(行や棚の描き直しを数える6本)で足りない場面だけを足す。値をまとめて渡すと、関係の無い値が変わったときにも描き直しが起きて遅くなることがあるからである。この計画の大もとは「直し続けても遅くならないこと」なので、描き直しの回数が増える変更は採らない。

次に、78個の値を、何に使うかでまとめる。候補は、保存の操作、表示の設定、選択とフォーカス、機械の能力と日程である。まとめ方は、1つの PR で1つのまとまりだけを扱い、ページから値を1つずつ渡す代わりに、まとまりを1つ渡すか、ガントの中で直接読む形にする。何もせずに値を中継するだけのファイルは作らない。各 PR の前後で、描き直しの回数のテストと、ガントのテストが同じ結果になることを確かめる。

ページ `ProductionScheduleGrindingPlanningBoardPage.tsx` と `usePlanningBoardPageGantt.ts` の中身の整理は、値のまとまりが決まってから、まとまりごとに行う。

効き目は、段階2bが終わってから1か月の変更を `change-width.sh` で数え、ガントの画面とページのそれぞれについて、触ったコミットのファイル数の中央値と75%点が、今回の数より小さくなったかで見る。今回の数は、`PlanningBoardGanttView.tsx` が45件・中央値6・75%点18、ページが42件・中央値11・75%点19である(KB-453)。現場の要望の中身によって変わる数なので、この比較は判断の材料にとどめ、合否にはしない。jsdom の描き直しの回数は実機の速さそのものではないので、まとめ方を変えた PR の後に Pi4 のキオスクで1回動きを見る。

### 段階3: 多くの入口を巻き込んでいるファイル

この段階は後回しにする。対象の3つが量を大きくしている機能(業務 Hermes、生産日程の一覧の一部、サイネージ)は、この1か月にほとんど変わっていない(`services/business-hermes` 9件、`routes/assembly/business-hermes.ts` 5件、`services/work-instructions` 9件、`production-schedule-query` 6件、`leaderboard-phased-read.ts` 2件、`services/signage` 7件)。読む量を減らしても、それを読む作業がほとんど無いので、効き目が小さい。これらの機能に大きな変更の依頼が来たときに、その作業の前に該当する1つを行う。行うときの決まりは次のとおりである。

対象は、試算で効果の大きい順に、`work-instruction-service.factory.ts`、`leaderboard-decoration.ts`、`signage.renderer.ts` から生産日程への依存の3つとする。どれも、使う側が実際に使っている関数だけを、小さな入口として受け取る形に変える。例えば業務 Hermes は、作業指示の全部品を組み立てる関数ではなく、必要な検索の関数だけを受け取る。

試算は上限にすぎない。小さな入口に変えても、その入口の先で同じ実装を import すれば、量は減らない。例えばサイネージは、すでに生産日程の関数を1つだけ直接読んでいる(`signage.renderer.ts` の32行目と951行目)。量を減らすには、その関数が引き連れている実装のうち、サイネージに要らない部分を関数の外へ出す必要がある。そこで各 PR の前に、残す実装、切り離す実装、新しい入口を組み立てる場所を書き出し、道具で減る量を測り直してから着手する。測り直して減らないものは、やらない。

### 段階4: 大きい入口の調査

この段階も、段階3と同じ理由で後回しにする。月1回の測定(KB-453)で `change-width.sh` も流し、変更が多く広く散らばる機能が新しく出てきたら、その機能をここの調査の対象にする。取り込みは組立と同じくらい変わっている(24件)ので、次の測定でも同じかそれ以上なら、取り込みを最初の対象にする。下は、サイネージ、取り込み、業務 Hermes を調べるときのやり方として残す。

サイネージの `signage-a2ui-data.service.ts`、CSV の取り込みの定期処理、業務 Hermes の夜間処理を調べ、区切り直す価値があるかを決める。これらは保存系の不具合が少ないので、段階2と3より後にする。調べる中身は、対象ごとに、量の大きい先のファイル上位10本、そこへ至る道筋(道具の `path.cjs` で出す)、90日の直しのコミットのうちその対象を触ったものである。直しの多くが一部のファイルに集まっていて、その部分だけを読めば直せる形に分けられる見込みがあるなら、区切り直す。直しが散らばっている、または少ないなら、今のままにする。

### どの段階でも守ること

この計画の後も使う決まりは [ADR-20261116](../decisions/ADR-20261116-refactoring-target-selection.md) を正本とする。下はこの計画での書き方である。

1つ目は、間をつなぐだけの層を作らないことである。Shopify は、部品どうしの依存を検査する道具(Packwerk)を使った結果、違反を消すためだけの層が増えたと振り返っている。量を減らすためだけに、何もしない中継のファイルを足してはいけない。区切り直しは、読む人が読む範囲を本当に狭められるときだけ行う。

2つ目は、一斉に作り替えないことである。1つの PR では、ファイルを移すか、依存を1本付け替えるか、テストを足すかのどれか1つだけを行う。動きを変える PR と混ぜない。

3つ目は、取り入れない案を蒸し返さないことである。調べた知見のうち次の3つは、このリポジトリでは取り入れない。index による再輸出をやめる作業は、道具が再輸出を定義のファイルまでたどって数えるので量が変わらず、段階2で試した付け替えでもテストの mock が増えただけだった。依存の向きの検査を新しく足すことは、API と画面のリント(`apps/api/eslint.config.mjs` と `apps/web/eslint.config.mjs` の `import/no-restricted-paths`)に層の向きの禁止が両方にあり、機能の境目の禁止も API の routes どうしにあるので要らない。画面側に機能の境目の禁止は無いが、段階2bは境目ではなく値の受け渡しの長さを扱うので、足さない。機能ごとに長い説明の文書を置くことは、効き目が小さく、AI に書かせた概要はかえって悪いという報告がある(Artifacts and Notes の出典。検証していない)。

4つ目は、すべての PR に第三者レビューを入れることである。4つの段階のどれでも、1本ずつの PR ごとに、実装した者とは別のレビュー役(Fable。枠が足りないときは Codex)に、差分とコードだけを渡して読んでもらう。指摘は実物で確かめてから直し、レビューを通してからマージする。

## Concrete Steps

コマンドはすべてリポジトリの直下で流す。メモリを約1.8GB 使い、1回1分前後かかる。

入口の一覧を作る。

    node scripts/analysis/feature-reach/entries.cjs web /tmp/fr/e-web.json
    node scripts/analysis/feature-reach/entries.cjs api /tmp/fr/e-api.json
    node scripts/analysis/feature-reach/entries.cjs sched /tmp/fr/e-sched.json

標準エラーに画面は `web 115 件`、API は `api 168 件`、定期処理は `b4ae9625` では `sched 28 件`、`8cffcefb` では `sched 29 件` と件数が出る。`api` では、入口にしなかったファイルが1本ずつ「入口にしない(窓口の登録が無い)」として出る。

量を測る。実行時のつながりだけを数えるときは `RUNTIME=1` を付ける。

    RUNTIME=1 node scripts/analysis/feature-reach/reach.cjs web /tmp/fr/e-web.json /tmp/fr/r-web.json
    RUNTIME=1 node scripts/analysis/feature-reach/reach.cjs api /tmp/fr/e-api.json /tmp/fr/r-api.json

標準出力に、入口ごとに、名前、ファイル数、行数、トークンの目安、関係するテストの本数、テストのトークンの目安が、大きい順に1行ずつ出る。b4ae9625 では、製番ボードの画面の行が `174 20246 312k` で始まる。

保存の流れを測るときは、入口の一覧の代わりに `scripts/analysis/feature-reach/groups/save-flow-web.json` と `save-flow-api.json` を渡す。b4ae9625 では、画面側の「待ち行列+offline+API hooks」が約73k、API 側が約200k、自動分割を除くと約155k になる。

輪を出す。型も含めるので `RUNTIME` を付けず、`DUMP` でつながりの一覧を書き出してから数える。

    DUMP=/tmp/fr/adj-api.json node scripts/analysis/feature-reach/reach.cjs api /tmp/fr/e-api.json /tmp/fr/rt-api.json
    TOP=20 node scripts/analysis/feature-reach/cycles.cjs /tmp/fr/adj-api.json

b4ae9625 では、`輪 9 files 34k` から始まり、最後に `輪の数 12` と出る。

多くの入口を巻き込んでいるファイルを出す。

    RUNTIME=1 DUMP=/tmp/fr/adjR-api.json node scripts/analysis/feature-reach/reach.cjs api /tmp/fr/e-api.json /tmp/fr/r-api.json
    node scripts/analysis/feature-reach/hubs.cjs /tmp/fr/adjR-api.json /tmp/fr/r-api.json

2つのファイルの間の道筋を出す。

    node scripts/analysis/feature-reach/path.cjs /tmp/fr/adjR-api.json apps/api/src/routes/signage/render.ts production-schedule/

変更の多さと広さを数える。起点の日付と、数えたいフォルダかファイルを渡す。

    REV=83678cbf sh scripts/analysis/feature-reach/change-width.sh 2026-10-17 apps/web/src/features/kiosk/grindingPlanningBoard

`apps/web/src/features/kiosk/grindingPlanningBoard: コミット 102、ファイル数 中央値 5・75%点 13・最大 92、3区画以上 41` と出る。`REV` を省くと手元の `origin/main` を数えるので、記録には SHA を渡す。

テストを流す。段階2の最初の PR より前は、ボードの結合テストは手元でしか流れない。手元では `scripts/ci/prepare-api-test-databases.sh` でテスト用 DB を用意し、`TEST_DATABASE_URL` にその接続先を入れてから、次を流す。

    pnpm --filter @raspi-system/api exec vitest run src/services/production-schedule/__tests__/grinding-planning-board.integration.test.ts src/services/production-schedule/sessaku-pieces/__tests__/sessaku-pieces.integration.test.ts
    pnpm --filter @raspi-system/web exec vitest run src/features/kiosk/grindingPlanningBoard

出力の「skipped」が0であることを確かめる。移す PR の前と後で、通った件数を Progress に書く。

段階3の各 PR では、付け替えた依存を戻せないように、`apps/api/eslint.config.mjs` の `import/no-restricted-paths` に1つ足す。フォルダ単位の禁止では、付け替えていない他のファイルまで止めてしまう(例えば `services/signage` から生産日程を読むファイルは6本ある)。そこで、付け替えたファイルを `target` に、読まなくなった先を `from` に、ファイル単位で書く。

## Validation and Acceptance

段階1は、Concrete Steps のコマンドがそのとおりの件数と量を出し、最初の記録が knowledge-base にあれば完了とする。

段階2は、次の4つがそろえば完了とする。

- ボードの結合テストと切削の片の結合テストが、CI で飛ばされずに流れている。CI のログで、2つのファイルの skipped が0であることを確かめる。
- 保存の形の型が、読み出しの形と別のファイルにあり、12件の直しで壊れた場面が境目のテストとして CI で通っている。
- 道具の輪の一覧に、9ファイルの輪が出ない。
- 画面側の保存の流れの一覧のファイルが、描画のファイルを import していない。

量は完了の条件にしない。保存の流れのまとまりの量は、段階2の前と後で測って Progress に記録し、読み切れる大きさになったかを人が判断する材料にする。

段階2bは、次の3つがそろえば完了とする。ガントの画面が受け取る値が、何に使うかのまとまりごとに分かれている。ガントのテストと描き直しの回数のテスト(`PlanningBoardGanttMemo.test.tsx` と足した分)が、各 PR の前後で同じ結果である。段階2bの後の1か月の `change-width.sh` の数が KB-453 に記録されている。

段階3は、付け替えた依存ごとに、着手前に測り直した見込みのとおり入口の量が減り、リントの禁止が1つ入っていれば完了とする。

段階4は、月1回の測定で対象に選んだ機能それぞれについて、調べた中身と、区切り直すかどうかの決定とその理由が knowledge-base の記録に書かれていれば完了とする。区切り直すと決めたものは、この計画に段階を足すか、別の計画を作る。

効き目は、段階2が終わってから90日の間に、今回の12件と同じ型の保存の消失・上書きの不具合が再発したかで見る。fix の件数や割合を危険の指標にせず、件数や割合は比べない。

## Idempotence and Recovery

測る道具は読むだけで、何度流しても同じ結果になる。書き出すのは指定した出力ファイルだけである。区切り直しの PR は、ファイルの移動、依存の付け替え、テストの追加だけなので、問題が出たら PR ごとに戻せる。本番のデータ、DB の形、画面の見た目は変えない。

## Progress

- [x] (2026-11-16 15:00Z) 段階1: 測る道具を `scripts/analysis/feature-reach/` に置き、窓口を登録するファイル168件を入口にした。
- [x] (2026-11-16) 段階1: 最初の記録を `docs/knowledge-base/KB-453-feature-reach-measurement.md` に置いた。基準 b4ae9625 の数と、main 8cffcefb を取り込んだ 95b44853 で測り直した数(輪 11、保存の流れは画面の一覧 60k・API 197k)、調査メモの要点、月1回の手順を写した。以後の測定記録はこの KB を正本とする。次の測定は 2026-12-16 頃。
- [x] (2026-11-16 01:45Z) 段階2: ボードの結合テストを CI で流れるようにした(#2843、マージ済み)。
- [x] 段階2: 共有の型を読み出しの形と保存の形に分ける。保存の要求と応答の型44件を `production-schedule-grinding-planning-board-write.ts` へ移した PR #2847(2026-11-16 マージ、dbbb1d1e)。
- [x] 段階2: 12件の直しで壊れた場面を、画面と API の境目のテストにする。保存の直し7件を守る結合テスト12件を足した PR #2849(2026-11-16 マージ、0ff5331b)。画面側だけの直し5件は対象外で、web のテストに任せる。
- [x] 段階2: `FkojunstMailNormalizedRow` 型を移して9ファイルの輪をほどく。型を `fkojunst-mail-row.types.ts` へ移し、読み手10ファイルを付け替えた PR #2850(2026-11-16 マージ、700b8821)。0ff5331b との比較で9ファイルの輪が消え、その中にあった表示用の変換の2ファイルの輪が単独で出た。輪の数は前後とも12。
- [x] (2026-11-16) 段階2: `stateOrder` を外へ出すかを測り、見送ると決めた。700b8821 の写しで、`stateOrder`・`uniqueFseibans`・`normalizeUniqueFseibans` を外の処理を import しないファイルへ移し、`stateOrder` だけを読む2ファイル(`piece-quantity.ts`、`piece-operation-definitions.ts`)を付け替えて、`RUNTIME=1` で比べた。`piece-quantity.ts` 単独は 70ファイル 74k → 50ファイル 40k、`piece-operation-definitions.ts` は 114k → 104k に減るが、保存の流れのまとまりは 198k(自動分割を除くと約152k)のまま変わらない。`write.ts` などほかの7つの読み手は `state.ts` の別の関数も読むので、付け替えても減らない。入口168件のうち減ったのは、保存の流れの外の13件(`complete.ts`、`due-date.ts`、`note.ts`、`order.ts`、`processing.ts`、納期管理の5件、`leaderboard-phased-read.ts`、`production-schedule-settings.ts` など)で、各 9〜11k(約7%)にとどまり、ボードの窓口と切削の片の窓口は変わらない。この段階の目的である保存の流れが小さくならないので、9つの読み手を付け替える PR は作らない。
- [x] 段階2: API hooks のファイルを分ける。`grinding-planning-board.ts` を読み出し(9 export)と `grinding-planning-board-mutations.ts`(保存 14 export)に分け、2ファイルは互いを import しない PR #2852(2026-11-16 マージ、017fcc21)。barrel `hooks/production-schedule.ts` は両方を再公開する。
- [x] 段階2: offline の Provider を分ける。Context と状態・書き込みの門を `offline/planningBoardOfflineContext.tsx` へ移し、`PlanningBoardOfflineProvider.tsx` はそれを包んで接続状態のバナーを出すだけにした PR #2853(2026-11-16 マージ、24004b6b。Pi5 へ反映済み、run 20261116-063807-9f667a)。保存の hook はバナーを依存に持たなくなった。
- [x] (2026-11-16) 段階2: 保存の流れのファイルの一覧を決めた。`groups/save-flow-web.json` の「保存の流れ(画面) 一覧」に、候補の9ファイル(待ち行列、完了、到着、納期、テスト加工の棒、片の操作、書き込みの門、つながりの状態、offline の Context)と保存の hook のファイル `grinding-planning-board-mutations.ts` の10本を入口として書いた。`RUNTIME=1` の閉包は31ファイル 4369行 60k で、描画(`gantt/`、表、ツールバー、ダイアログ、接続状態のバナー)も `planningBoardOfflineQueries.ts` も含まない。`planningBoardOfflineQueries.ts` は保存の流れのどのファイルからも読まれていないので、移さずに読み出しの側として一覧から外した。閉包に混じる読み出しは、完了の hook が鍵のために読む `usePlanningBoardChainItems.ts` と、行の完了の保存がある `hooks/production-schedule/schedule.ts`(とキャッシュの書き換えのファイル)だけである。
- [x] (2026-11-16) 段階2: 保存の流れのまとまりを 24004b6b で測り直した。旧定義の「待ち行列+offline+API hooks」は b4ae9625 の約73k から 36ファイル 67k に減った(#2852 と #2853 の分)。新しい一覧は 60k。保存の hook が barrel `api/hooks` を読む所(到着と完了の2本)を定義のファイルの直接 import へ付け替える案は、道具が barrel の再公開を定義のファイルまでたどって数えるので量が変わらず、テストの mock の二重化だけが増えるため、やらない。一覧の外で保存を始める所として、`gantt/usePlanningBoardGantt.ts`(40ファイル 71k)、`usePlanningBoardPageGantt.ts`(45ファイル 88k)、`gantt/PlanningBoardUnitOpEditor.tsx`(25ファイル 46k、描画の部品)がある。どれも配置の計算や読み出しと保存を1つの hook や部品で持つので、一覧には入れず、ほどくかは段階2の最後に決める(のちに段階2bへ移した)。`createPlanningBoardSeibanActions.ts`、`planningBoardPageModel.ts`、`usePlanningBoardPageItems.ts` は待ち行列を受け取るだけで、各 2ファイル 3k 以下である。
- [x] 段階2: 表示用の変換の2ファイルの輪をほどく。入力側の8つの型を `grinding-planning-board-projection-input.types.ts` へ中身を変えずに移し、再公開せずに読み手(本番3ファイルとテスト4本)を付け替えた PR #2854(2026-11-16 マージ、8cffcefb)。2ファイルを1つにまとめる案は、`grinding-planning-board-projection.ts` が行数の上限(600)ちょうどなので取らなかった。輪の数は 12 から 11 に減った。
- [x] (2026-11-16) 計画の見直し: 海外の知見を調べ、変更の多さと広さを数える道具 `change-width.sh` を足した。量が大きくてもほとんど変わらない機能が多いと分かったので、段階2bを足し、段階3と段階4を後回しにした。
- [ ] 段階2: `source.ts` を分けて保存の流れが小さくなるかを測り、やるかを決める。
- [ ] 段階2b: ガントの動きを固定するテストと、描き直しの回数のテストで足りない場面を足す。
- [ ] 段階2b: ガントの画面が受け取る値を、まとまりごとに1つずつ整理する。
- [ ] 段階2b: 終わってから1か月の変更の広さを測り、KB-453 に記録する。
- [ ] 段階3(後回し): work-instruction-service.factory.ts への依存を細くする。
- [ ] 段階3(後回し): leaderboard-decoration.ts への依存を細くする。
- [ ] 段階3(後回し): サイネージから生産日程への依存を細くする。
- [ ] 段階4(後回し): サイネージ、CSV の取り込み、業務 Hermes の夜間処理を調べ、区切り直すかを決める。

## Surprises & Discoveries

- Observation: 最初の測定では、まとめ役の index のせいで、どの画面も約15万トークン分の API の全分野を含んでいた。
  Evidence: 名前ごとに定義元まで解決するやり方に変えたところ、量は半分前後になった。

- Observation: 9ファイルの輪は、型の import 1本で閉じていた。
  Evidence: `missing-standard-hours-process.ts` の6行目の `FkojunstMailNormalizedRow` を外してつながりの一覧を数え直すと、9ファイルの輪が消え、表示用の変換の2ファイルと、書き込みとテスト加工の棒の2ファイルの小さな輪が残った。

- Observation: ボードの結合テストは CI で一度も流れていない。
  Evidence: テストは `TEST_DATABASE_URL` を必須にしているが、`.github/workflows/ci.yml` はこの変数を渡していない。

## Decision Log

- Decision: 量を目標や CI の合否にしない。
  Rationale: 量を減らすこと自体が目的になると、違反を消すためだけの層が増える(Shopify の Packwerk の振り返り)。
  Date/Author: 2026-11-16 / Claude

- Decision: 製番ボードの保存の流れを最初の対象にし、その先頭に保存の約束ごとの集約と境目のテストを置く。
  Rationale: 保存系の不具合が集まり、その直しの半分近くが画面と API の境目をまたいでいる。12件の件名は版、競合、読み直しの約束ごとにかかわり、ファイルを移すだけでは減らない恐れがある(第三者レビューで指摘)。
  Date/Author: 2026-11-16 / Claude

- Decision: ボードの結合テストを CI で流すことを、段階2の最初の PR にする。
  Rationale: 今の動きを固定するテストが CI で働かないまま移動を始めると、壊しても気づけない(第三者レビューで指摘)。
  Date/Author: 2026-11-16 / Claude

- Decision: 輪をほどく手は `FkojunstMailNormalizedRow` 型の移動だけにし、`stateOrder` の移動は量を減らす手として別に測って決める。メールの取り込みから切削の片への一方向の呼び出しは残す。
  Rationale: 道具で確かめると、型の移動だけで9ファイルの輪は消える。一方向の呼び出しは業務に必要である(Codex と第三者レビューで指摘)。
  Date/Author: 2026-11-16 / Claude

- Decision: ボードと切削の片を別々の部品に分けることは目指さない。
  Rationale: 両方向に20本近い実行時の import があり、1つのかたまりとして扱うほうが実情に合う。
  Date/Author: 2026-11-16 / Claude

- Decision: 段階3の試算は上限とし、着手前に測り直す。
  Rationale: 小さな入口に変えても、その先で同じ実装を読めば量は減らない(Codex のレビューで指摘)。
  Date/Author: 2026-11-16 / Claude

- Decision: サーバーを唯一の書き手にする変更は、この計画に入れない。
  Rationale: 動きを変える作業なので、読める形に整えてから別の計画で行う。
  Date/Author: 2026-11-16 / Claude

- Decision: 測る道具はこの計画の PR に入れる。
  Rationale: 道具がリポジトリの外にあると、この計画だけでは同じ数を出せない(Codex と第三者レビューで指摘)。
  Date/Author: 2026-11-16 / Claude

- Decision: 4つの段階のすべての PR に第三者レビューを入れる。
  Rationale: ユーザーの指示(2026-11-16)。区切り直しは動きを変えないことが前提で、実装した者だけでは見落としが残るため。
  Date/Author: 2026-11-16 / Claude

- Decision: 手を入れる順番を、量の大きさではなく、変更の多さと広さで選ぶ。段階2bを足し、段階3と段階4を後回しにする。
  Rationale: import でたどれる量と AI の作業の出来を直接結んだ研究は見つからず、量は目安にとどまる(Artifacts and Notes の出典)。数えると、変更は製番ボードに集まり(画面のフォルダで1か月102件)、量の大きいサイネージと業務 Hermes はほとんど変わっていない(取り込みは組立と同じくらい)。CodeScene などが勧める「よく変わる所から直す」考え方に合わせた。
  Date/Author: 2026-11-16 / Claude

- Decision: ガントの値の受け渡しを整理するときは、描き直しの回数をテストで固定し、増える変更は採らない。
  Rationale: 計画の大もとは「直し続けても遅くならないこと」であり、値をまとめて渡す作りは、関係の無い値の変化でも描き直しを起こしうる。
  Date/Author: 2026-11-16 / Claude

## Outcomes & Retrospective

まだ無い。

## Artifacts and Notes

最初の調査の詳しい結果は、作業をした端末の共有メモ(`feature-reach-survey-2026-11-16.md` と、10年もたせる構想の検討 `ten-year-architecture-council3.md`)にある。調査メモの1行目にある基準のコミット 9db0599e は main に無いので、この計画の数は b4ae9625 で測り直した値を使う。ファイル分割の PR のその後の直しの数え方もそこに書いてある。これらは手元の端末にしか無いので、段階1の knowledge-base の記録に要点を写し、以後はそれを正本とする。

2026-11-16 の海外の知見の調査で使った主な出典は次のとおりである。「二次」と書いたものは原文を取得できず、紹介記事で読んだ。

- Anthropic「How Claude Code works in large codebases」: AI は索引を使わずにファイルをたどって読み、どこを見るかの手がかりが要る。ディレクトリをまたぐ深い依存は不利。https://claude.com/blog/how-claude-code-works-in-large-codebases-best-practices-and-where-to-start
- Anthropic「Effective context engineering for AI agents」: 必要な分だけを必要な時に読む。読む量が増えると思い出す力が落ちる。https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
- Chroma「Context Rot」: 入力が長いほど、紛らわしい記述が混じるほど、モデルの出来が不安定になる。https://trychroma.com/research/context-rot
- OpenAI「Harness engineering」(二次): 層の向きをリントで止め、エラー文に直し方を書く。AGENTS.md は短い地図にする。https://yage.ai/share/harness-engineering-survey-en-20260312.html
- AGENTS.md 類の効き目の実証(arXiv 2602.11988、検証していない): 人が書いたもので小さな改善、AI に書かせたものはわずかに悪化。https://arxiv.org/abs/2602.11988
- Shopify「A Packwerk retrospective」: 違反を消すための層が増えた。単独で読み込めてテストが通ることを進み具合の物差しにする。https://shopify.engineering/a-packwerk-retrospective
- Jimmy Bogard「Vertical Slice Architecture」: 機能の中の結びつきは強く、機能どうしは弱く。https://jimmybogard.com/vertical-slice-architecture/
- Martin Fowler「StranglerFigApplication」「ParallelChange」: 一斉に作り替えず、小さく置き換える。https://www.martinfowler.com/bliki/StranglerFigApplication.html
- CodeScene「Change coupling」: 一緒に変わるファイルと、よく変わる所から直す。https://codescene.com/blog/change-coupling-visualize-the-cost-of-change
- index による再輸出の害(Atlassian、TkDodo): https://www.atlassian.com/blog/atlassian-engineering/faster-builds-when-removing-barrel-files 、https://tkdodo.eu/blog/please-stop-using-barrel-files

## Interfaces and Dependencies

新しい外部の道具は入れない。道具は、`apps/api/node_modules/typescript` にすでにある TypeScript の型チェッカーだけを使う(環境変数 `TSPATH` で別の場所を指せる)。ファイルは次のとおりである。

- `entries.cjs`: 入口の一覧を作る。画面は `apps/web/src/pages` 配下の `.tsx`(テストを除く)。API は `apps/api/src/routes` 配下で、`.get(`、`.post(` などや `.route(` で窓口を登録するファイル(型引数付きの書き方も拾う。`index.ts` とテストを除く)。定期処理は `apps/api/src` 配下で、ファイル名に `scheduler` を含むもの(テストを除く)。
- `reach.cjs`: 入口ごとの量を出す。決まりは次のとおりである。`apps/<app>/tsconfig.json` から型チェッカーのプログラムを作り、`apps/<app>/src` 配下のテストも入れる。共有パッケージは `packages/*/src` を見る。各ファイルの import と再輸出の文ごとに、読んでいる名前を定義元の宣言まで解決し、宣言のあるファイルへのつながりとする。`import * as`、副作用だけの import、動的な `import()`、名前の無い `export *` は、そのモジュールへのつながりとする。`RUNTIME=1` のときは、`import type`、`import { type X }`、`export type` を除く。型としてしか使っていない普通の import は除かない。`node_modules`、`.d.ts`、`dist`、`generated` は数えない。届いたファイルの文字数の合計を3.5で割ってトークンの目安とする。関係するテストは、届いたファイルのどれかを直接 import しているテストファイルとする。`DUMP=<パス>` を付けると、ファイルごとのつながりの一覧を JSON で書き出す。
- `cycles.cjs`: つながりの一覧から輪(強連結成分のうち2ファイル以上のもの)を、大きい順に `TOP` 件(既定6)出す。
- `hubs.cjs`: 15万を超える入口の3割以上に入り、先が4万以上あるファイルを、先の大きい順に出す。
- `path.cjs`: 2つのファイルの間の最短の道筋を出す。
- `change-width.sh`: git の履歴から、指定したパスを触ったコミットの数と、1件あたりのファイル数と区画の数を出す。読むだけで、型チェッカーは使わない。
- `groups/save-flow-web.json`、`groups/save-flow-api.json`: 製番ボードの保存の流れの入口のまとまり。形は `[{ "name": "...", "entries": ["ファイルのパス", ...] }]` である。
