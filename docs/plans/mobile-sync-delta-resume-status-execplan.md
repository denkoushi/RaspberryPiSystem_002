# スマホのデータ同期: 分割保存と再開、購買の差分取得、1分ごとの確認、同期状態の表示

この ExecPlan は生きた文書である。`Progress`、`Surprises & Discoveries`、`Decision Log`、`Outcomes & Retrospective` は作業の進みに合わせて更新する。書式と進め方は `.agent/PLANS.md` に従う。前段の計画は `docs/plans/mobile-local-first-sync-execplan.md`(スマホ全機能のローカル優先化)であり、本計画はその上に積む。

## Purpose / Big Picture

工場のスマホ(配膳、照合、部品検索を行う Android アプリの中の Web 画面)は、購買、生産日程、配膳の置き場所のデータを端末の中(IndexedDB というブラウザ内のデータベース)に持ち、通信が切れても照合できる。2026-10-29 に本番へ入った PR #2382 で、購買と、日程から作る補助データ(着手日、機種名など。以下「購買の補助データ」)を別々の版で配るようになった。それでも次の四つの困りごとが残っている。

一つ目は、ダウンロードが途中で切れると最初からやり直しになること。今は全行を受け取ってから一つのトランザクションで書き込むので、工場の Wi-Fi が弱い場所で数分かかる取得が切れると、それまでの通信が無駄になる。二つ目は、購買の取り込みのたびにスマホが購買を全行取り直すこと。調べると、購買の取り込みは中身が同じ行でも更新時刻を書き換えるので、版が毎回変わっていた。三つ目は、新しいデータに気づくのが遅いこと。確認は画面を開いたときと通信が戻ったとき以外は 30 分おきである。四つ目は、どのスマホがどの版まで持っているのか、管理側から見えないこと。

この計画を終えると、次のことができる。ダウンロードが途中で切れても、次に通信できたときに続きから受け取る。購買の取り込みで変わった行だけがスマホに届く。新しいデータには約 1 分で気づき、配膳の置き場所のように急ぐものから先に取りに行く。管理画面の端末一覧で、各スマホが持っているデータの版が最新か、最後に同期できた時刻、送り待ちの操作の数、最後の失敗理由を見られる。

ユーザーと合意した順番は、分割保存と再開(提案 3)、購買の差分取得(提案 2)、1 分ごとの確認と優先順(提案 5)、同期状態の報告と表示(提案 7)である。提案 1(データごとの版)と提案 4(見つからないときはサーバーで確かめる)は PR #2382 で本番に入った。提案 6 はユーザーの指示で行わない。

## Progress

- [x] (2026-10-29) 今の同期の仕組みを読み、購買の取り込みが中身の同じ行の更新時刻も書き換えることを確かめた。
- [x] (2026-10-29) 計画文書を書き、別のモデルにコードと照らし合わせて見てもらい、指摘 10 件を反映した。
- [ ] マイルストーン 1: サーバーのページ分け配信と、スマホの分割保存・続きからの再開。
- [ ] マイルストーン 2: 購買の取り込みで、中身が変わった行だけ更新時刻を進める。
- [ ] マイルストーン 3: 購買の差分取得。
- [ ] マイルストーン 4: 約 1 分ごとの版の確認と、データの優先順。
- [ ] マイルストーン 5: スマホの同期状態の報告と、管理画面の端末一覧での表示。

## Surprises & Discoveries

- 観察: 購買の取り込み(`apps/api/src/services/purchase-order-lookup/purchase-order-lookup-sync.service.ts` の `INSERT ... ON CONFLICT DO UPDATE`)は、条件が `EXCLUDED."sourceUpdatedAt" >= "PurchaseOrderLookupRow"."sourceUpdatedAt"` なので、同じ CSV を取り込み直すと全行で `"updatedAt" = CURRENT_TIMESTAMP` が書かれる。版は `updatedAt` の最大値と行数から作るので、取り込みのたびに購買の版が変わり、スマホは全行を取り直していた。
  証拠: 同ファイルの upsert 文。版の計算は `apps/api/src/services/mobile-placement/mobile-local-data.service.ts` の `version()`。
- 観察: 購買の行は削除されない。`PurchaseOrderLookupRow` を消すコードは見つからなかった。生産日程の行(`CsvDashboardRow`)は取り込みで作成と更新があり、保存期間切れの掃除(`apps/api/src/services/production-schedule/retention/production-schedule-cleanup.service.ts`)で削除される。配膳の置き場所(`OrderPlacementBranchState`)も削除があり、削除の記録(墓標)は残らない。
- 観察: スマホの書き込み(`apps/web/src/features/mobile-placement/local-data/mobileLocalDataStore.ts` の `replace`)は、全データを一つの readwrite トランザクションで消してから書く。IndexedDB のトランザクションは、通信など IndexedDB 以外を待つと自動で確定してしまうので、受け取りながら同じトランザクションで書き続けることはできない。

## Decision Log

- Decision: 差分取得は購買だけに入れる。生産日程、購買の補助データ、配膳の置き場所は、版が変わったら全体を取り直す方式のまま、ページ分けと再開だけを入れる。
  Rationale: 購買は行が削除されないので、更新時刻より後の行を受け取るだけで正しく追いつける。日程と置き場所は削除があり墓標が無いので、差分にすると消えた行がスマホに残る。墓標の表を新しく作るより、全体の取り直しを途中から再開できるようにする方が変更が小さく、安全である。購買の補助データは日程から毎回計算する派生データなので、行ごとの差分の意味が薄い。
  Date/Author: 2026-10-29 / Claude

- Decision: 購買の差分の後で、サーバーの行数とスマホの行数を比べる。違っていたら差分をやめて全体を取り直す。
  Rationale: 将来、購買の行を消す処理が入ったときや、スマホ側の保存が壊れたときに、ずれたまま使い続けないための安い安全網である。行数は版の計算ですでに数えている。
  Date/Author: 2026-10-29 / Claude

- Decision: 購買の取り込みでは、比べる列(部品コードの原文と正規化、品名、受入数、購買ステイタス、元システムの更新日時、行番号)のどれかが変わったときだけ `updatedAt` を進める。新旧の判断(元システムの更新日時が古い行は上書きしない)は今のまま変えない。
  Rationale: 差分取得の前提であり、これだけでも取り込みのたびの全行取り直しが止まる。照合で何を一致とみなすかは変えない。ユーザーには、取り込みの書き方を一つ変えることを平易に伝える。
  Date/Author: 2026-10-29 / Claude

- Decision: 受け取ったページは、表示用とは別の「受け取り中」の保存場所に、ページごとの小さなトランザクションで書く。最後のページを書いたら、一つのトランザクションで表示用と入れ替え、版の印を書き換える。差分のページは表示用の保存場所へ直接書き足し、差分の続きの位置(カーソル)も同じトランザクションで書く。
  Rationale: 照合は「一つの読み取りトランザクションで、版の印と行を同時に読む」ことで、途中までの版を見ないようにしている(`mobileLocalDataStore.ts` の照合の読み取り)。入れ替え方式ならこの約束が保たれる。購買の差分は行の追加と更新だけで、途中で止まっても古い版の行と新しい行が混ざるだけで、照合の結果が壊れることはない。版の印は最後のページを書くまで進めない。
  Date/Author: 2026-10-29 / Claude

- Decision: 版の確認は約 1 分ごとにする。失敗したときの待ち時間を延ばす仕組み(30 分から最大 6 時間)は、データの取得の失敗だけに使い、版の確認には使わない。
  Rationale: 版の確認は小さな応答で、サーバーは 30 秒間の結果を使い回すので負荷が軽い。キオスクの入口の回数制限は IP、URL、端末の鍵(`x-client-key`)の組ごとに数える(`apps/api/src/plugins/rate-limit.ts`)ので、同じ Wi-Fi のスマホどうしで枠を取り合わない。`/versions` は端末ごとに 1 分 60 回までなので、1 分 1 回は十分に収まる。一方、データの入口(`/:dataset`)は端末ごとに 1 分 30 回までなので、ページ分けではページの数がこれを超えないようにする(マイルストーン 1 を参照)。
  Date/Author: 2026-10-29 / Claude

- Decision: 取りに行く順番は、配膳の置き場所、購買、購買の補助データ、生産日程とする。
  Rationale: 置き場所は棚に置いた直後に別のスマホで探されるので、遅れると困る。データも小さい。購買は照合の中心で、差分になれば小さい。補助データは着手日などの表示用で、古くても照合はできる。日程は最も大きく、変わる頻度も高いので最後にする。
  Date/Author: 2026-10-29 / Claude

- Decision: 同期状態は新しい表に、端末ごとに 1 行で保存する。既存の `ClientStatus`(Raspberry Pi の CPU や温度の記録)には混ぜない。表示は管理画面の端末一覧(`apps/web/src/pages/admin/ClientsPage.tsx`)に列を足すだけにし、説明文は付けない。
  Rationale: `ClientStatus` は Pi の監視用で、スマホの同期とは意味も更新の契機も違う。画面に説明文を足さないのはこのリポジトリの UI の決まりである。
  Date/Author: 2026-10-29 / Claude

## Outcomes & Retrospective

まだ実装していない。各マイルストーンの完了時に、何ができるようになったか、何が残ったかをここに書く。

## Context and Orientation

スマホの画面は `apps/web/src/features/mobile-placement/` にある。Android アプリ(APK)はこの Web 画面を表示する入れ物で、本計画では APK を変えない。

端末内のデータベースは `apps/web/src/features/mobile-placement/local-data/mobileLocalDataStore.ts` が扱う。保存場所(object store)は `metadata`(各データの版と、データの更新時刻)、`purchase`(購買の行)、`purchaseEnrichment`(購買の補助データ)、`schedule`(日程の行)、`known`(既知の製番)、`placements`(置き場所)である。今の版は 3 で、書き込みは `replace` が全部を消してから書き直す。

同期の本体は `apps/web/src/features/mobile-placement/local-data/mobileLocalDataSync.ts` の `createMobileDataSync` である。まずサーバーの版を聞き、スマホの版と違うデータだけを取りに行き、取り終えたら `replace` で保存する。失敗すると 30 分待ち、続けて失敗すると待ちを 2 倍ずつ、最大 6 時間まで延ばす。同期を呼ぶ時機は `apps/web/src/features/mobile-placement/sync/syncScheduler.ts` が決める。画面を開いたとき、通信が戻ったとき、それ以外は 30 分ごと(送り待ちの操作があれば 30 秒ごと)である。送り待ちの操作とは、通信が切れている間にスマホで行った置き場所の登録や削除で、通信が戻るとサーバーへ送る。

サーバー側は `apps/api/src/routes/kiosk/mobile-local-data.ts` が二つの入口を持つ。`GET /kiosk/mobile-local-data/versions` は各データの版を返し、`GET /kiosk/mobile-local-data/:dataset` はデータ全体を gzip で返す。スマホが送った版がサーバーの版と同じなら 304 を返す。データの組み立てと版の計算は `apps/api/src/services/mobile-placement/mobile-local-data.service.ts` にある。版は、もとになる表の行数と更新時刻の最大値から作る。組み立てたデータは版ごとにメモリに一つ置いて使い回す。購買の補助データは `apps/api/src/services/mobile-placement/mobile-purchase-enrichment.service.ts` が作る。行の詰め方(タプル)と型は `packages/slip-match-core/src/snapshot.ts` にある。

古いスマホとの互換は `format=2` という引数で取っている。版の確認に `format=2` を付けたスマホだけが新しい配り方を受け取る。本計画で増やす引数も同じ考え方で、付けないスマホには今の動きを返す。

どの入口も `x-client-key` ヘッダーで端末(`ClientDevice` 表)を確かめる(`deps.requireClientDevice`)。

## Plan of Work

### マイルストーン 1: ページ分け配信と、分割保存・続きからの再開

このマイルストーンの終わりには、スマホがデータを数千行ずつのページで受け取り、ページごとに保存するようになる。通信が切れても、次の同期では続きのページから受け取る。

サーバーでは、`GET /kiosk/mobile-local-data/:dataset` に `page` と `pageSize` を受け付ける形を足す。応答は、今の全体応答と同じ形の一部の行に、`page`、`pageCount`、`pageSize`、`version` を加えたものにする。今のメモリ上の使い回し(`createMobileDataCache`)は gzip にした全体だけを持ち、行の配列は捨てている。そこで、版ごとに、ページに切り分けて gzip にしたものも一緒に持つように変える。ページの境目は組み立てた行の並び順で決まり、同じ版なら何度聞いても同じ行が返る。ページの大きさはサーバーが決め、全体が 20 ページ以内に収まるようにする(データの入口は端末ごとに 1 分 30 回までなので、やり直しを含めても枠を超えない)。受け取り中の版は、今の「持っている版」を表す `version`(同じなら 304)とは別の引数 `pageVersion` で送る。`pageVersion` がサーバーの今の版と違うとき(途中で版が変わったとき)は 409 を返し、スマホは最初のページからやり直す。日程の既知の製番(`knownFseibans`)は最初のページだけに載せる。`page` を付けないスマホには今の全体応答を返す。ページ分けは `format=2` に加えて、版の確認の応答に `paged: true` を載せたときだけ使う。

`purchaseEnrichment` は行の配列ではなく、辞書をまとめた一つのデータなので、ページ分けせず今のまま一度で受け取る。大きさは本番の記録(API のログの `Mobile local data snapshot` 行の `gzipBytes`)で確かめ、大きければ後で分ける。

スマホでは、`mobileLocalDataStore.ts` を版 4 に上げ、受け取り中の保存場所 `stagingPurchase`、`stagingSchedule`、`stagingPlacements` を足す。版の上げ方は版 3 と同じく、保存場所を作るだけで既存のデータは消さない。`metadata` に、受け取り中の印として `staging:<データ名>` の鍵で `{ version, nextPage, pageCount }` を書く。各ページは一つのトランザクションで、受け取り中の保存場所への書き込みと `nextPage` の更新を同時に行う。印には `pageSize` も入れ、同じ版の間はページの大きさが変わらないことを前提に、行の並び順(`ordinal`)をページ番号とページの大きさから決める。日程の最初のページの既知の製番は、印と一緒に受け取り中として保存する。最後のページを書いたら、一つのトランザクションで表示用の保存場所を消し、受け取り中の行を移し、日程なら既知の製番(`known`)も書き換え、版の印を書き換え、受け取り中の印を消す。移す行数が多いのでこのトランザクションは数秒かかることがあるが、通信を待たないので途中で確定することはない。

同期の本体は、受け取り中の印があり、その版がサーバーの今の版と同じなら `nextPage` から続ける。違えば受け取り中の保存場所を消して最初から受け取る。今の「受け取っている間に版が変わった」ときの確認は、ページごとに応答の `version` を印の版と比べる形で保つ。照合の読み取りは表示用の保存場所だけを見るので、今の約束(一つの読み取りトランザクションで版と行を同時に読む)はそのまま守られる。購買の補助データのメモリ上の使い回しも版で確かめているので変えなくてよい。

受け入れ条件は次のとおり。ページを 2 枚受け取ったところで通信を切り、通信を戻すと 3 枚目から受け取って、最後に表示用が新しい版に入れ替わる。途中で版が変わると最初からやり直す。入れ替わるまでは照合が古い版で動き続ける。

### マイルストーン 2: 購買の取り込みで、中身が変わった行だけ更新時刻を進める

このマイルストーンの終わりには、同じ購買 CSV を取り込み直しても、購買の版が変わらない。

`purchase-order-lookup-sync.service.ts` の upsert 文の `WHERE` に、比べる列のどれかが前の値と違う(`IS DISTINCT FROM`)という条件を `AND` で足す。今の条件は `A IS NULL OR B >= C` の形なので、全体を括弧で囲んでから `AND` を付ける。比べる列は `purchasePartCodeRaw`、`purchasePartCodeNormalized`、`purchasePartName`、`acceptedQuantity`、`sourceUpdatedAt`、`lineIndex`、そして購買ステイタスである。購買ステイタスは書き込むときに COALESCE で前の値を残すので、`COALESCE(EXCLUDED."purchaseStatus", 前の値) IS DISTINCT FROM 前の値` で比べる。元システムの更新日時が古い行は上書きしないという今の条件は残す。戻り値の `skippedStale` は「書かなかった行」の数になり、古いので書かなかった行と、同じなので書かなかった行が合わさる。取り込み結果の表示でこの数を「古い行」と説明している所があれば、意味がずれるので、数を二つに分けるか説明を直す。

受け入れ条件は、同じ CSV を 2 回取り込んだ後で `getMobileDataVersions()` の `purchase` の版が変わらないこと、1 行だけ受入数を変えた CSV を取り込むと、その 1 行だけ `updatedAt` が進むこと。統合テストは既存の `purchase-order-lookup-sync.integration.test.ts` に足す(テスト用データベースが要る)。今のテストには同じ行を取り込み直す場合が無いので、その場合を加える。

### マイルストーン 3: 購買の差分取得

このマイルストーンの終わりには、購買の版が変わったとき、スマホは変わった行だけを受け取る。

サーバーでは、`GET /kiosk/mobile-local-data/purchase` に `since` を受け付ける。`since` は前回受け取った最後の行の `updatedAt` と `id` の組を文字列にしたものである。差分の取得は一回ごとにまとまり(以下「差分の回」)を持つ。回の始めにだけ、保存してある `since` の時刻から 5 分戻した位置を起点にする。5 分の重なりを持たせるのは、取り込みが複数の文に分かれていて、時刻の早い文が遅れて確定することがあるからである。回の中のページは、`(updatedAt, id)` が前のページの最後の行より厳密に後の行を、`updatedAt`、`id` の順に返す。一つの文で書いた数千行は同じ `updatedAt` を持つので、ページごとに 5 分戻すと同じ行の塊が何度も返って終わらなくなる。回の中の位置は `metadata` に保存して、切れても続きから受け取る。保存する `since` は回の最後のページを書いたときだけ進める。重なった行はスマホ側で同じ行として上書きされるだけなので害はない。差分の行はメモリの全体データからではなく、表から直接読み、全体の行数も同じ読み取りトランザクションで数える。読み終えたら、版を使い回しなしで読み直し(`getMobileDataVersions(true)`)、読む前の版と違えば 409 を返す。版を使い回しのまま返すと、新しい取り込みの前の行に新しい版の印を付けてしまうことがあるからである。`(updatedAt, id)` の索引を足す移行(Prisma のマイグレーション)が要る。

スマホでは、購買の行をサーバーの行の `id` で上書きできるようにする。今の購買の詰め方(`BasePurchaseTuple`)には行の `id` も取り込み元も入っていないので、差分を使うスマホ向けには末尾に `id` を足した詰め方で、全体の取り直しと差分の両方を配る。版の印の `format` は 2 のままにし、`keyed: true` という別の印で `id` 付きであることを示す。スマホのコードは `format === 2` で補助データとの組み合わせを決めている所が多い(`mobileLocalDataStore.ts` の照合の読み取り、`mobileLocalDataSync.ts` の版の比べ方)ので、`format` の値を増やすとそれらが全部ずれるからである。サーバーでは `id` 付きの購買を、`legacyPurchase` と同じように別のデータ名(`keyedPurchase`)としてメモリに持つ。同じ名前にすると、古いスマホ向けの購買と互いに追い出し合う。今の `purchase` の保存場所は並び順(`ordinal`)を鍵にしているので、版 4 の上げ方で `id` の索引を足し、差分の行は索引で前の行を探して置き換える。`id` 付きの全体を一度受け取るまでは、差分は使わない。新しく増えた行には、`metadata` に持つ次の並び順(`nextOrdinal`)を使い、同じトランザクションで数を進める。差分の行は表示用の `purchase` に直接書き、同じトランザクションで `metadata` の続きの位置を書く。最後のページを書いたら、版の印を書く前に、サーバーの全体の行数とスマホの行数を比べる。同じなら版の印を新しい版にする。違えば版の印は古いままにし、続きの位置を消して、その場で全体の取り直しに切り替える。版の印を先に新しくすると、版が同じなので次の同期で取り直しが起きず、ずれたまま残るからである。`since` を持っていないスマホや、`since` が 30 日より古いスマホは、マイルストーン 1 の全体の取り直しを使う。

受け入れ条件は、1 行だけ変えた CSV を取り込んだ後の同期で、スマホが受け取る購買の行が数行(重なり分を含む)であること、スマホの行数とサーバーの行数が同じこと、その行で照合した結果が新しい値になること。

### マイルストーン 4: 約 1 分ごとの版の確認と、データの優先順

このマイルストーンの終わりには、スマホを開いている間、約 1 分ごとに版を確かめ、新しいデータがあれば置き場所、購買、購買の補助データ、日程の順に取りに行く。

`syncScheduler.ts` の普段の間隔(30 分)は変えない。この間隔は、置き場所や棚の送り待ち、読み取り画像、照合記録など、登録されたすべての仕事(`MobileSyncProvider.tsx`)を動かすので、60 秒にするとそれらまで毎分動いてしまう。代わりに、`registerSyncJob` に仕事ごとの間隔(`intervalMs`)を持たせ、端末内データの仕事(`local-data`)だけを 60 秒ごとに動かす。画面が見えていないとき(`document.visibilityState` が `visible` でないとき)は、この仕事も 30 分のままにして、電池と通信を減らす。`mobileLocalDataSync.ts` では、失敗時の待ち(30 分から 6 時間)を版の確認には使わず、データの取得にだけ使う。今もこの考え方の一部(待ちの間でも版が変われば取りに行く)があるので、それを整理する形にする。取得の順番は上の決定のとおりにし、一つのデータの取得が失敗しても、その後のデータは取りに行く。置き場所は今は購買の後に取っているので順番を入れ替える。

受け入れ条件は、テストで時計を進めたとき、画面が見えていれば 60 秒ごとに版を聞き、見えていなければ 30 分ごとであること。ほかの仕事は今と同じ 30 分ごと(送り待ちがあれば 30 秒ごと)のままであること。購買の取得が失敗しても置き場所は新しくなること。

### マイルストーン 5: スマホの同期状態の報告と、管理画面での表示

このマイルストーンの終わりには、管理画面の端末一覧で、スマホごとに、データが最新かどうか、最後に同期できた時刻、送り待ちの操作の数、最後の失敗理由が見える。

新しい表 `MobileDataSyncStatus` を足す。列は、端末(`ClientDevice` の id、一意)、各データの持っている版(JSON)、最後に同期できた時刻、最後に試した時刻、送り待ちの操作の数、最後の失敗理由(短い文字列)、更新時刻である。入口は `POST /kiosk/mobile-local-data/status` で、`x-client-key` で端末を確かめ、その端末の行を上書きする。回数制限は 1 分に数回で足りる。スマホは同期を一回終えるたびに(成功でも失敗でも)送る。送り待ちの操作の数は、`syncScheduler.ts` に登録された各仕事の `hasPendingWork` と、各送り待ちの保存場所の件数から数える。報告自体が失敗しても、同期には影響させない。

管理側は、端末一覧の取得 API(`apps/api/src/routes/clients/` 配下)の応答にこの行を付け、`getMobileDataVersions()` の今の版と比べて「最新」か「遅れ」かを決める。`apps/web/src/pages/admin/ClientsPage.tsx` に列を足す。スマホでない端末は空欄にする。説明文や補助ラベルは足さない。

受け入れ条件は、スマホで同期した後、管理画面の端末一覧のそのスマホの行に、最後に同期できた時刻が出ること。サーバーで購買を取り込んだ直後は「遅れ」になり、1 分ほどで「最新」に戻ること。

## Concrete Steps

作業は main から作った専用の worktree で行う。リポジトリの決まりどおり `python3 -m scripts.git_lifecycle.cli start --branch feat/<名前>` で作る。マイルストーンごとに別の PR にしてよいが、マイルストーン 3 はマイルストーン 1 と 2 の後に出す。

各マイルストーンで、次のコマンドを worktree の最上位で実行する。

    pnpm --filter @raspi-system/slip-match-core test
    pnpm --filter web test -- src/features/mobile-placement
    pnpm --filter api test -- mobile-local-data purchase-order-lookup
    pnpm --filter web exec tsc --noEmit
    pnpm --filter api exec tsc --noEmit
    pnpm lint

API の統合テストはテスト用データベースが要る。手元に無いときは CI の結果で確かめる。

## Validation and Acceptance

本番への反映後、次を確かめる。読み取りだけで確かめ、新しい本番の接続方法は作らない。

マイルストーン 1 の後、スマホで配膳の画面を開き、購買の取り込みの直後に通信を一度切って戻しても、照合が「該当無し」にならずに続けられること。API のログで、同じ版のページが 2 回取られていないこと。

マイルストーン 2 と 3 の後、購買の取り込みの後の API のログ(`Mobile local data snapshot` と差分の記録)で、スマホが受け取った購買の行数が取り込みで変わった行数に近いこと。

マイルストーン 4 の後、スマホで配膳の画面を開いたまま購買を取り込み、通信を切ってから約 1 分後に、新しい行が照合できること。

マイルストーン 5 の後、管理画面の端末一覧で各スマホの同期状態が見えること。

## Idempotence and Recovery

ページの書き込みはページ番号ごとに上書きなので、同じページを 2 回書いても結果は同じである。受け取り中の印と保存場所は、版が違えば消して作り直すので、途中で止まっても次の同期で正しい状態に戻る。差分は行を一意な鍵で上書きするので、重なった行や同じ差分を何度受け取っても同じ結果になる。行数が合わないときは全体を取り直す。

スマホのデータベースをまっさらにしたいときは、今と同じく、アプリのデータ消去で消せる。消しても次の同期で全体を取り直す。

サーバーの upsert の変更(マイルストーン 2)は、戻せば今の動き(毎回全行の更新時刻が進む)に戻るだけで、データは壊れない。新しい表と索引は追加だけで、既存の表は変えない。

## Interfaces and Dependencies

`packages/slip-match-core/src/snapshot.ts` に、ページの応答の型を足す。

    export type SnapshotPage<T> = DatasetVersion & { page: number; pageCount: number; pageSize: number; rows: T[]; knownFseibans?: string[] };
    export type KeyedPurchaseTuple = [...BasePurchaseTuple, string];
    export type PurchaseDeltaPage = DatasetVersion & { format: 2; keyed: true; rows: KeyedPurchaseTuple[]; next: string; total: number; done: boolean };

`MobileDataVersions` に `paged?: true` と `purchaseDelta?: true` を足し、サーバーがその機能を持つことをスマホに知らせる。古いサーバーはこれを返さないので、スマホは今の全体の取り直しを使う。

`apps/web/src/features/mobile-placement/local-data/mobileLocalDataStore.ts` の `MobileLocalDataStore` に、`writeStagingPage(kind, version, page, pageCount, rows)`、`promoteStaging(kind)`、`stagingState(kind)`、`applyPurchaseDelta(page)`、`count(kind)` を足す。`replace` は古いサーバーとの互換のために残す。

`apps/api/prisma/schema.prisma` に `MobileDataSyncStatus` モデルと、`PurchaseOrderLookupRow` の `(updatedAt, id)` 索引を足す。
