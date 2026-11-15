# 機能のつながりを AI が一度に読める範囲に区切り直す計画

この ExecPlan は生きた文書である。`Progress`、`Surprises & Discoveries`、`Decision Log`、`Outcomes & Retrospective` は作業の進行に合わせて更新する。書き方は `.agent/PLANS.md` に従う。

## Purpose / Big Picture

このシステムは、現場の要望に応えて毎日のように直し続けることで良くなってきた。これからも変え続ける。実装の大半は AI(Claude と Codex)が行う。AI は、一度の作業で読める量を超えた範囲を正しく扱えない。読み切れないまま直すと、見ていない所との食い違いが残る。

そこでこの計画では、機能ごとに「そこから呼ばれているファイルとテストの量」を測る。量が大きすぎる所だけを、ふだんの機能追加と並行して区切り直す。区切り直しの手本は、これまでの分割の PR である。動きを変えずにファイルを移すだけにし、その前に、今の動きを固定するテストを置く。この型の PR 8本は、その後の直しが0件だった。

この計画が終わると、次のことができるようになる。

- 誰でも1つのコマンドで、機能ごとの量の一覧を出せる。
- 製番ボードの保存の流れ(画面の保存、API の書き込み、裏の自動分割)を、AI が一度の作業で読み切れる。今は合計約58万トークンで、読み切れない。
- 多くの機能を巻き込んで大きくしているファイル数本が、必要な分だけを渡す作りに変わる。

量は、手を入れる場所を見つけるための道具である。目標の数値にはしない。CI で量に上限をかけることもしない。

## 用語

「つながりの量」とは、ある入口のファイルから import をたどって届くファイル全部の文字数のことである。入口は、画面のページ、API の窓口ファイル、定期処理のファイルの3種類とする。

文字数を3.5で割った値を、AI のトークン数の目安とする。日本語のコメントが多いファイルでは実際より少なく出るので、粗い比較にだけ使う。

「まとめ役の index」とは、他のファイルの中身を並べて再輸出するだけのファイルである。例えば `apps/web/src/api/client.ts` は、45の分野をまとめて再輸出している。import の行だけを数えると、どの画面も API の全分野を含むことになり、量が2倍前後に膨らむ。そこで、import した名前ごとに、その名前が定義されているファイルまでたどって数える。

「型だけのつながり」とは、`import type` で型の定義だけを読む import のことである。実行時には何も読み込まない。

## Context and Orientation

2026-11-16 に、main の 9db0599e で測った結果は次のとおりである。測り方は上の用語のとおりで、型だけのつながりは除いた。

画面は102件ある。そのうち65件は5万トークン未満で、20万を超えるのは製番ボード(`apps/web/src/pages/kiosk/ProductionScheduleGrindingPlanningBoardPage.tsx`)の約31万だけである。典型的な画面では、貸出が約8万、部品測定が約5万、機械一覧が約4万である。

API の窓口は、数えた165件のうち91件が5万未満である。20万を超えるのは17件で、サイネージの表示(`routes/signage/render.ts` など、約58万)、組立の手順資料(`routes/assembly/procedure-materials.ts`、約60万)、CSV の取り込み(`routes/imports/schedule.ts`、約58万)、業務 Hermes(`routes/assembly/business-hermes.ts`、約52万)などである。`apps/api/src/routes` 配下には、テストと `index.ts` を除いて202本のファイルがある。ただしこの中には、窓口を登録しない型やスキーマだけのファイル(例: `routes/webrtc/types.ts`、`routes/gmail/schemas.ts`)も入っている。集計に入らなかった37本のうち何本が、書き方の違い(型引数付きの `.get<...>(` や `route({ method })`)で集計から漏れた本物の窓口かは、まだ確かめていない。最初の段階で数え直す。

製番ボードの量は、画面側が約31万、API と裏の処理が約28万で、合計約58万である。画面側のうち約21万は、ボード自身のフォルダ `apps/web/src/features/kiosk/grindingPlanningBoard`(70ファイル)が占めている。大きいデータのファイルで水増しされているわけではなく、最大でも約1.8万のファイルが散らばっている。API 側のおもな中身は、切削の片(`services/production-schedule/sessaku-pieces`)が約6万、ボード(`services/production-schedule/grinding-planning-board`)が約4万、生産日程の一覧の表示(`services/production-schedule/leaderboard`)が約3万である。

90日のあいだに、保存が消える、上書きされる、409、待ち行列が止まる、他の端末に届かない、という同じ型の不具合の直しが12件あった。コミットは 9b3f18df、6c9dd60e、9031af96、02768544、f302a0f4、e7318fa3、520d98e2、c55f9e9a、611241d3、d1903d19、1b87230d、78d41a3f である。12件のうち5件は、画面と API の両方を直していた。いちばん多く直されたのは、画面と API の間でやり取りするデータの形を決めた `packages/shared-types/src/common/production-schedule-grinding-planning-board.ts`(506行)で、12件中5件である。

一方、量がもっと大きいサイネージ、組立、取り込み、業務 Hermes では、同じ90日の保存系の直しは0〜1件だった。だから、量が大きいことだけで不具合は説明できない。製番ボードで目立つのは、画面と API の境目である。ただしこれは1画面の観察であり、原因とまでは言えない。

型だけのつながりまで含めると、9つのファイルが互いの型を読み合って輪になっている。輪に入っているのは、ボードの状態(`grinding-planning-board/state.ts`、`shared.ts`)、ボードの表示用の変換(`grinding-planning-board-projection.ts`、`grinding-planning-board-missing-standard-hours-projection.ts`)、標準工数の未入力(`missing-standard-hours-process.ts`)、メールからの取り込み(`fkojunst-status-mail-sync.pipeline.ts`、`external-completion/fkojunst-external-completion-sync.repository.ts`)、切削の片(`sessaku-pieces/piece-sync.ts`、`piece-quantity.ts`)である。例えば `piece-quantity.ts` は `grinding-planning-board/state.ts` から `stateOrder` を読み、`missing-standard-hours-process.ts` はメール取り込みの `FkojunstMailNormalizedRow` 型を読む。保存にかかわる決まりが、3つの処理に散っている形である。

多くの API の入口を巻き込んで大きくしているファイルもある。1本ずつ外した場合を試算した結果は次のとおりである。作業指示の部品を組み立てる `services/work-instructions/work-instruction-service.factory.ts` への依存を外すと、12の入口で1万以上減る(業務 Hermes が約52万から約38万)。生産日程の一覧の表示を整える `services/production-schedule/production-schedule-query/leaderboard-decoration.ts` を外すと、8つの入口で減る(`leaderboard-phased-read.ts` が約27万から約19万)。サイネージから生産日程への依存(`services/signage/signage.renderer.ts` の32行目)を切ると、5つの入口で約7万減る。ただし、サイネージは51万台のまま残る。`services/signage/signage-a2ui-data.service.ts` の先が約31万あるためである。

測るためのスクリプトは、今はリポジトリの外の共有メモにある。本体は `reach2.cjs` である。TypeScript の型チェッカーでプログラムを作り、名前ごとに定義元のファイルまで解決して、ファイルどうしのつながりの一覧を作る。メモリは約1.8GB 使い、API と画面それぞれ1分以内で終わる。

既存のリントで、すでに次のことが止められている。新しいファイルの600行上限、既存の大きいファイルの行数の頭打ち、import の循環、層の依存方向である(`apps/api/eslint.config.mjs`)。この計画では、これらに新しい数値の上限を足さない。

## Plan of Work

作業は4つの段階に分ける。各段階は、独立した小さな PR の積み重ねで進める。どの PR も、ふだんの機能追加の流れを止めない。現場の要望の PR と同じファイルを触る場合は、要望の PR を先に通す。

段階1は、測る道具をリポジトリに置くことである。スクリプトを `scripts/analysis/feature-reach/` に移し、漏れていた37本の窓口ファイルも入口として拾う。出力は、入口ごとの量の一覧、多くの入口を巻き込んでいるファイルの一覧、輪の一覧の3つとする。CI には組み込まず、手で流す道具とする。月に1回流して、結果を `docs/knowledge-base/` の記録に残す。

段階2は、製番ボードの保存の流れを1本にまとめ、読める大きさにすることである。この段階が計画の中心である。

最初に、9ファイルの輪をほどく。目指すのは輪を無くすことで、3つの処理の間のつながりを全部無くすことではない。メールの取り込みが外部完了の同期を呼び、その同期が切削の片を更新する流れ(`fkojunst-status-mail-sync.pipeline.ts` から `external-completion/fkojunst-external-completion-sync.repository.ts` を経て `sessaku-pieces`)は、業務に必要な一方向の呼び出しなので残す。無くすのは、逆向きに戻ってくる読み込みである。

輪を作っている戻りの読み込みは2本ある。1本目は、切削の片の `piece-quantity.ts` が、ボードの `grinding-planning-board/state.ts` から `stateOrder` を実行時に読んでいるものである。`stateOrder` は `uniqueFseibans` を呼び、`uniqueFseibans` は `shared.ts` の正規化の関数と定数を使う。そこで、`stateOrder`、`uniqueFseibans`、それらが使う正規化の関数と定数をまとめて、新しいファイル `services/production-schedule/planning-order/planning-order.ts` へ移す。このファイルは、外の処理(ボード、切削の片、メールの取り込み)を一切 import しない。元の場所からは、このファイルを読んで使う。2本目は、標準工数の未入力 `missing-standard-hours-process.ts` が、メールの取り込みの `FkojunstMailNormalizedRow` 型を読んでいるものである。この型を、メールの取り込みの外の型だけのファイルへ移す。

このほかに、ボードの表示用の変換の2ファイル(`grinding-planning-board-projection.ts` と `grinding-planning-board-missing-standard-hours-projection.ts`)も、型だけで読み合う小さな輪になっている。共通の型を片方から出して、もう片方が読むだけの形にする。

既存のリントの import 循環の検査は、型だけの import を見ない。輪が無くなったかは、段階1の道具の輪の一覧(型を含めて測る)で確かめる。

次に、画面と API の間の取り決めを、操作ごとに分ける。`packages/shared-types/src/common/production-schedule-grinding-planning-board.ts` を、読み出しの形と保存の形に分ける。保存の形は、保存の操作ごとにまとめる。保存の流れを直すときに、表示の形を読まずに済むようにするためである。

さらに、画面側のボードのフォルダを、保存の流れと描画に分ける。保存の流れとは、書き込みの待ち行列(`usePlanningBoardWriteQueue.ts`)、オフラインのとき(`offline/`)、API を呼ぶ部分(`apps/web/src/api/hooks/production-schedule/grinding-planning-board*.ts`)のことである。描画とは、ガント(`gantt/`)、表、ツールバーのことである。保存の流れのファイルが、描画のファイルを import しないようにする。

ただし今の `offline/PlanningBoardOfflineProvider.tsx` は、つながりの状態の管理と、つながりの案内の表示(`PlanningBoardConnectivityBanner`)を1つのファイルでしている。書き込みの待ち行列は、このファイルの Context を読む。そこで先に、このファイルを2つに分ける。1つは Context とつながりの状態の管理だけを持つファイル、もう1つはそれを包んで案内を表示するファイルである。待ち行列は前者だけを読む。

最後に、保存の流れを1つの入口のまとまりとして測る。入口は、画面の保存の流れのフォルダ、API の書き込み(`grinding-planning-board/write.ts`、`write-source.ts`、`write-arrival.ts`)、切削の片の数の書き込み(`sessaku-pieces/piece-quantity.ts`)、自動分割の定期処理(`sessaku-pieces/auto-unit-split.scheduler.ts`)とする。

段階2で決めないことがある。サーバーを唯一の書き手にすること、つまり定期処理も画面と同じ書き込みの経路で書くようにすることは、別の計画で扱う。この段階では、その作業を AI が読み切れる大きさに整えるところまでを行う。

段階3は、多くの入口を巻き込んでいるファイルを細くすることである。対象は、上の試算で効果の大きい順に、`work-instruction-service.factory.ts`、`leaderboard-decoration.ts`、`signage.renderer.ts` から生産日程への依存の3つとする。どれも、使う側が実際に使っている関数だけを、小さな入口として受け取る形に変える。例えば業務 Hermes は、作業指示の全部品を組み立てる関数ではなく、必要な検索の関数だけを受け取る。

上の試算は、依存を丸ごと外した場合の上限であり、減る量の見込みにすぎない。小さな入口に変えても、その入口の先で同じ実装を import すれば、量は減らない。例えばサイネージは、すでに生産日程の関数を1つだけ直接読んでいる(`signage.renderer.ts` の32行目と951行目)。量を減らすには、その関数が引き連れている実装のうち、サイネージに要らない部分を関数の外へ出す必要がある。そこで各 PR の前に、残す実装、切り離す実装、新しい入口を組み立てる場所を書き出し、道具で減る量を測り直してから着手する。測り直して減らないものは、やらない。

段階4は、サイネージの `signage-a2ui-data.service.ts`、CSV の取り込みの定期処理(`services/imports/csv-import-scheduler.ts`、約57万)、業務 Hermes の夜間処理(約41万)を調べることである。調べた結果、区切り直す価値があるかを決める。これらは保存系の不具合が少ないので、段階2と3より後にする。調べる中身は、対象ごとに、量の大きい先のファイル上位10本、そこへ至る道筋(道具の道筋の表示で出す)、90日の直しのコミットのうちその対象を触ったものである。区切り直すと決める基準は、直しの多くが一部のファイルに集まっていて、その部分だけを読めば直せる形に分けられる見込みがあることとする。直しが散らばっている、または直しが少ない場合は、今のままにする。

どの段階でも、次の2つを守る。

1つ目は、間をつなぐだけの層を作らないことである。Shopify は、部品どうしの依存を検査する道具を使った結果、違反を消すためだけの層が増えたと振り返っている。量を減らすためだけに、何もしない中継のファイルを足してはいけない。区切り直しは、読む人が読む範囲を本当に狭められるときだけ行う。

2つ目は、一斉に作り替えないことである。1つの PR では、ファイルを移すか、依存を1本付け替えるかのどちらかだけを行う。動きを変える PR と混ぜない。

## Concrete Steps

段階1では、まず共有メモのスクリプトを `scripts/analysis/feature-reach/` に置く。今の置き場所は `~/Library/Application Support/Claude/side-session-notes/local_f278a197-7ca5-4ffe-afc5-bb9d6cc3de14/reach-tool/` で、`reach2.cjs`(つながりの一覧を作る)、`final.cjs`(入口ごとの量)、`hubs.cjs`(多くの入口を巻き込むファイル)、`scc.cjs`(輪)、`path.cjs`(2つのファイルの間の道筋)と、入口の定義 `g-api.json`、`g-web.json`、`g-sched.json` がある。次に、入口の集め方を、窓口の登録の書き方によらない形に直す。窓口ファイルの一覧は `apps/api/src/routes` 配下で、テストと `index.ts` を除いたものとする。リポジトリの直下で、次のように流せるようにする。

    TSPATH=apps/api/node_modules/typescript node scripts/analysis/feature-reach/run.cjs --app api --runtime-only
    TSPATH=apps/api/node_modules/typescript node scripts/analysis/feature-reach/run.cjs --app web --runtime-only

期待する出力は、入口ごとの1行(名前、ファイル数、行数、トークンの目安、関係するテストの本数)である。製番ボードの画面の行が約30万前後になれば、今回の測定と一致している。

段階2の各 PR では、先に今の動きを固定するテストを置く。API 側の既存のテストは `apps/api/src/services/production-schedule/__tests__/grinding-planning-board.integration.test.ts` と `sessaku-pieces/__tests__/sessaku-pieces.integration.test.ts` である。この2つは、専用のテスト用 DB の接続先(環境変数 `TEST_DATABASE_URL`)が無いと全件を飛ばす。手元では CI と同じテスト用 DB を立てて流し、出力に飛ばした件数が0であることを確かめる。CI でも、この2つが飛ばされずに流れたことをログで確かめる。画面側は、書き込みの待ち行列とオフラインのテスト(`apps/web/src/features/kiosk/grindingPlanningBoard` 配下の `*.test.ts(x)`)を、移す前と後で同じ顔ぶれで流す。触るファイルのテストが無い場合は、移す前に足す。

段階3の各 PR では、付け替えた依存を戻せないように、`apps/api/eslint.config.mjs` の `import/no-restricted-paths` に1行足す。例えば、サイネージから生産日程の中身を直接読むことを禁じる。足すのは、付け替えたその1本だけとする。

## Validation and Acceptance

段階1は、2つのコマンドが入口ごとの一覧を出し、`apps/api/src/routes` 配下で窓口を登録しているファイルがすべて入口に入っていれば完了とする。入口にしなかったファイルは、理由(型だけ、スキーマだけなど)とともに一覧に出す。

段階2は、次の3つで完了とする。

- 保存の流れのまとまりの量が、AI が一度に読める量に収まっている。今の目安は20万トークン以下である。この値は合否の線ではなく、読み切れるかの目安である。超えた場合は、どこが大きいかを記録して次の手を決める。
- 輪の一覧に、ボードの状態、切削の片、メールの取り込みの間の輪が出ない。
- 製番ボードと切削の片の結合テストが、飛ばされずに全件通る。件数は、移す前の件数に、この段階で足したテストの件数を加えたものになる。画面側の待ち行列とオフラインのテストも全件通る。

段階3は、付け替えた依存ごとに、着手前に測り直した見込みのとおり入口の量が減り、リントの禁止が1行入っていれば完了とする。

段階4は、3つの対象それぞれについて、調べた中身と、区切り直すかどうかの決定とその理由が、knowledge-base の記録に書かれていれば完了とする。区切り直すと決めたものは、この計画に段階を足すか、別の計画を作る。

効き目は、量ではなく作業の結果で判断する。段階2が終わってから90日の間に、製番ボードの保存系の直しで画面と API の両方を直したものを数え、今の12件中5件と比べる。直しの件数そのものは、現場の要望の多さで増えるので、物差しにしない。

## Idempotence and Recovery

測るスクリプトは読むだけで、何度流しても結果は同じである。区切り直しの PR は、ファイルの移動と依存の付け替えだけなので、問題が出たら PR ごとに戻せる。本番のデータ、DB の形、画面の見た目は変えない。

## Progress

- [ ] 段階1: 測る道具をリポジトリに置き、窓口を登録するファイルをすべて入口にする
- [ ] 段階1: 初回の一覧を knowledge-base に記録する
- [ ] 段階2: 9ファイルの輪の型と決まりを、型と決まりだけのファイルへ移す
- [ ] 段階2: 画面と API の取り決めを、読み出しと保存の操作ごとに分ける
- [ ] 段階2: 画面のボードのフォルダを、保存の流れと描画に分ける
- [ ] 段階2: 保存の流れのまとまりを測り、結果を記録する
- [ ] 段階3: work-instruction-service.factory.ts への依存を細くする
- [ ] 段階3: leaderboard-decoration.ts への依存を細くする
- [ ] 段階3: サイネージから生産日程への依存を細くする
- [ ] 段階4: サイネージ、CSV の取り込み、業務 Hermes の夜間処理を調べ、区切り直すかを決める

## Surprises & Discoveries

最初の測定では、まとめ役の index のせいで、どの画面も約15万トークン分の API の全分野を含んでいた。名前ごとに定義元まで解決するやり方に変えたところ、量は半分前後になった。

## Decision Log

- 2026-11-16: 量を目標や CI の合否にしない。量を減らすこと自体が目的になると、違反を消すためだけの層が増えるためである(Shopify の振り返り)。
- 2026-11-16: 製番ボードの保存の流れを最初の対象にする。量が最大で、保存系の不具合が集まり、その直しの半分近くが画面と API の境目をまたいでいるためである。
- 2026-11-16: 輪をほどく目的は戻りの読み込みを無くすことで、メールの取り込みから切削の片への一方向の呼び出しは残す。業務に必要な流れだからである(Codex のレビューで指摘)。
- 2026-11-16: 段階3の試算は上限の見込みとし、着手前に測り直す。小さな入口に変えても、その先で同じ実装を読めば量は減らないためである(Codex のレビューで指摘)。
- 2026-11-16: サーバーを唯一の書き手にする変更は、この計画に入れない。それは動きを変える作業なので、読める大きさに整えてから別の計画で行う。

## Outcomes & Retrospective

まだ無い。

## Artifacts and Notes

測定の詳しい結果は、共有メモの `feature-reach-survey-2026-11-16.md` にある。そこには、入口ごとの一覧(`reach-tool/tR-api.tsv`、`tR-web.tsv`、`tR-sched.tsv`)と、測り方の注意も書いてある。段階1でリポジトリに移したあとは、knowledge-base の記録を正本とする。

## Interfaces and Dependencies

新しい外部の道具は入れない。測るスクリプトは、`apps/api/node_modules/typescript` にすでにある TypeScript の型チェッカーだけを使う。

共有メモのスクリプトが手に入らない場合でも作り直せるように、中身の決まりをここに書いておく。

1. API なら `apps/api/tsconfig.json`、画面なら `apps/web/tsconfig.json` から、型チェッカーのプログラムを作る。
2. 各ファイルの import と再輸出の文ごとに、読んでいる名前を型チェッカーで定義元の宣言まで解決し、宣言のあるファイルへのつながりとする。まとめ役の index は、名前が素通りするだけなら、つながりに入れない。`import * as` や副作用だけの import は、そのファイルへのつながりとする。
3. 実行時だけを数える場合は、`import type` と、型としてしか使われない名前を除く。
4. 入口から、つながりを推移的にたどって届くファイルを集め、文字数の合計を3.5で割ってトークンの目安とする。`node_modules` と生成物(`apps/web/src/generated`)は数えない。
5. 入口の種類は3つとする。画面は `apps/web/src/pages` 配下のページ、API は `apps/api/src/routes` 配下で窓口を登録するファイル、定期処理は `apps/api/src` 配下の `*.scheduler.ts` と、起動時に定期処理を登録するファイルである。名前付きの入口のまとまり(段階2の保存の流れなど)は、複数のファイルを1つの入口として扱う。
6. 関係するテストの本数は、届いたファイルのどれかを import しているテストファイルの数とする。
7. 輪は、つながり(型を含む)の強連結成分のうち、2ファイル以上のものとする。

確かめの目安として、main 9db0599e で実行時だけを数えると、製番ボードの画面は約30.8万、貸出の画面は約8.1万になる。
