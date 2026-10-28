# スマホ全機能のローカル優先化と Wi-Fi 時だけの裏同期

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds. It is maintained in accordance with `.agent/PLANS.md` at the repository root.


## Purpose / Big Picture

工場の Wi-Fi は場内のすべてに届かない。スマホ(配膳スマホ。Android の Chrome、または `apps/android-haizen-shell` の WebView アプリ)で動く画面が通信を待つと、その間は画面が固まり作業が止まる。2026-10-26 に承認された計画で、照合と購買のデータは端末に保存され、「ここに置く」は保存してから裏で送るようになった。しかし部品検索、棚マスタの編集、棚写真、Zero2W 配膳状況、パレット、未読の製造orderの分配枝などは、いまも通信を待つ。

2026-10-28 にユーザーは範囲を「スマホの全機能」に広げた。この計画が終わると、次のことが成り立つ。スマホのすべての画面は、端末の中の保存先(以後「ローカル」と呼ぶ。IndexedDB というブラウザ内のデータベース)だけを読み書きする。Pi5 サーバーとのやり取り(以後「同期」と呼ぶ)は、画面と切り離した裏の処理だけが行い、それもスマホが Wi-Fi につながっているときだけ行う。押したボタンは通信の成否に関係なく、すぐに次の状態へ進む。同期の状態は、既にある「圏外」チップと「未送信 N」「要確認 N」チップで見える。説明の文言は増やさない。

動作の見え方は次のとおり。スマホの Wi-Fi を切り、どの画面を開いても、操作がすぐ反映される。Wi-Fi に戻すと、数十秒以内に未送信の件数が 0 になり、別のスマホやキオスクにも結果が出る。


## Progress

- [x] (2026-10-28 09:00Z) スマホ機能と mobile API の棚卸し(下の Context and Orientation に記載)。
- [x] (2026-10-28 09:30Z) この ExecPlan の初版。
- [x] ユーザー判断の回答を Decision Log に記録した(2026-10-28)。
- [ ] Milestone 1: 共通の同期層(アプリ全体で 1 つの同期係、Wi-Fi 判定、送信待ち箱の共通化、棚番登録の待ちを外す)。
- [x] (2026-10-28) Milestone 1 の部分実装: 共通同期係、Provider、共有送信 runner、棚の保存直後の pending 応答、ローカル結果優先。DB/記録形式と outbox.ts の共通化は変更していない。回線判定は Decision Log のとおり Wi-Fi(または有線)と判定できたときだけ同期する。ローカルデータが一度も無いときだけ、同期できる状態ならサーバーに 3 秒問い合わせる。
- [ ] Milestone 2: 配膳の読み取りをローカル化(現在の置き場データの版付き取得、棚写真の端末保存)。
- [x] (2026-10-28) Milestone 3 実装: placements の版付き全件取得、DB v2 と既存同期への追加、片手 UI の端末内検索、未送信の製造order表示、専用削除アウトボックスを接続。実機確認・本番反映は未実施。
- [ ] Milestone 4: サーバーの汎用二重実行防止と、棚マスタ編集の送信待ち箱。
- [ ] Milestone 5: Zero2W 配膳状況とパレットのローカル化。
- [ ] Milestone 6: 残り(現品票の撮影 OCR の扱い、古い通信経路の削除、KB 更新)。


## Surprises & Discoveries

- Observation: スマホ(1台)は Tailscale の名前 `raspberrypi.tail7312a3.ts.net:8443` で Pi5 に入る。サーバーから見た送信元はどの端末も Tailscale のアドレスになり、Wi-Fi かモバイル回線かをサーバー側では見分けられない。
  Evidence: `apps/android-haizen-shell/app/build.gradle.kts:13` の `HAIZEN_ORIGIN`、`docs/runbooks/mobile-placement-smartphone.md`。
- Observation: 既存の同期と送信は、その画面が開いている間しか動かない。照合と購買の取得は `useMobileLocalData` を使う画面(配膳ハブ、購買照会)の中、配膳の送信待ち箱は `HaizenHub` の中、棚の送信待ち箱は棚マスタの中で動く。部品検索の画面にいる間は、未送信の「ここに置く」は送られない。
  Evidence: `apps/web/src/features/mobile-placement/local-data/useMobileLocalData.ts`、`haizen/offline/useHaizenOfflineQueue.ts` の `useEffect`。
- Observation: 棚番登録の「保存」は、送信待ち箱に入れたあと最初の送信を最長 60 秒待つ。
  Evidence: `apps/web/src/features/mobile-placement/shelfMaster/offline/useShelfOfflineQueue.ts` の `submit` が `return send(record)`、`shelfRequestTimeoutMs = 60_000`。
- Observation: 照合と購買の「ローカルに無いときはサーバーに聞く」補助は、操作の途中で 3 秒まで通信を待つ。
  Evidence: `local-data/localFirstLookup.ts`。


- Observation (Milestone 1 のレビュー、2026-10-28): 棚の送信待ちに残る課題が三つある。一つ目は、送れない記録が1件あると後ろの記録も止まること(棚には順序の要件が無い)。二つ目は、送信中の棚と同じ棚番をもう一度登録すると、2回目が捨てられること。三つ目は、送信のたびに全部の仕事が動き、版の確認が毎回出ること。いずれも Milestone 4 で棚の送信待ちを作り直すときに直す。
  Evidence: 第三者レビューの指摘。`shelfOutboxRunner.ts` の flush と submit。

## Decision Log

- Decision (2026-10-28 / Codex): `placements` dataset と DB v2 の追加は部品検索の作業が担当する。配膳側は `listPlacementsByManufacturingOrder` を後続作業で使う。
  Rationale: 部品検索を端末内で完結させるため、現在配置を先に端末へ持つ。v1 の購買・予定・metadata・known は保持する。
- Decision (2026-10-28 / Codex): placements は版ごとの全件スナップショットにし、since-diff は実装しない。
  Rationale: 削除に tombstone がないため差分だけでは削除を反映できない。小規模データなので全件置換を使い、件数・更新日時・ID/更新日時チェックサムを版に含める。
- Decision (2026-10-28 / Codex): 機種名は既存サーバー検索と同じ MH/SH FHINMEI → 補完表の解決処理を共有し、表示用の半角英数・大文字にそろえて placements 行へ格納する。
  Rationale: 端末側の検索に追加通信を要求せず、検索用のかな畳み込みで表示名を壊さない。機種名参照元の更新も placements の版に含める。
- Decision (2026-10-28 / Codex): 削除は専用 `placement-delete-queue` に保存し、既存 `registerSyncJob` と Wi-Fi gate で送る。404 は完了、通信障害・5xx・408・429 は pending、その他の4xxは needs_check として行を復元する。
  Rationale: haizen queue の schema を変えず、pending ID はスナップショット再取得後も隠す。送信成功後は `requestSync` で配置更新を要求する。サーバー削除成功・404時は版キャッシュを無効化し、削除前のスナップショットによる再表示を防ぐ。

- Decision: 同期係は画面ではなく、スマホ用の画面群全体で 1 つだけ動かす。
  Rationale: 上の発見のとおり、画面ごとの同期では「裏で送る」が成り立たない。
  Date/Author: 2026-10-28 / Claude
- Decision: Wi-Fi の判定はスマホ側で行う。`navigator.connection.type`(Android の Chrome と WebView で使える)が `wifi` か `ethernet` のときだけ同期する。`cellular`、`none`、値が取れない、`unknown`/`other` のときは同期しない。
  Rationale: サーバー側では見分けられない(発見 1)。ブラウザの判定は Android では実用になり、判定できない場合は同期しない側に倒す。WebView アプリにネイティブの判定(`ConnectivityManager`)を足す案は APK の再配布が要るため、後で必要になったときの選択肢として残す。
  Date/Author: 2026-10-28 / Claude
- Decision: 操作中にサーバーへ聞く補助(照合と購買の「見つからない時だけサーバー」)はやめ、ローカルの結果をそのまま出す。見つからなかった番号は、次の同期で版が上がっていれば自動で取り直す。
  Rationale: 「通信は同期だけ」というユーザーの指示に合わせる。サーバーへの問い合わせはどの画面でも待ちになる。
  Date/Author: 2026-10-28 / Claude
- Decision: 二台のスマホが同じ製造orderの枝を動かしたときは、既存の規則どおり、置いた時刻(`placedAt`)が新しい方を正とする。棚のメモ・写真の編集も、端末で操作した時刻が新しい方を正とする。削除された棚への編集が後から届いたら「要確認」に回す。
  Rationale: 配膳は既にこの規則で動いており、現場で問題になっていない。棚の編集は管理者が少数で行うため衝突はまれで、同じ規則にそろえるのが分かりやすい。
  Date/Author: 2026-10-28 / Claude
- Decision: 再送された書き込みの二重実行は、サーバー側で防ぐ。新しい書き込みはすべて端末が作る操作 ID(UUID)を `Idempotency-Key` ヘッダーで送る。サーバーは新しい表 `MobileClientOperation`(操作 ID を一意キーにし、種類、結果の要約、作成日時を持つ)に記録し、同じ ID が再び来たら前回の結果を返して何もしない。既に `clientRecordId` で防いでいる配膳の登録はそのまま使う。
  Rationale: 棚の新規登録は再送で 409 になり、棚の移動は再送で二回動く(Context 参照)。機能ごとに作るより、一つの仕組みでそろえる方が漏れが少ない。
  Date/Author: 2026-10-28 / Claude
- Decision: 現品票の写真をサーバーで読む OCR(ブラウザの撮影経由)は、計算を Pi5 でしか行えないため、ローカル化しない。圏外のときは、その撮影ボタンを押せない状態にする。WebView アプリのネイティブ読取は既にローカルで動く。
  Rationale: 端末で同じ精度の OCR を動かすのは別の大きな作業で、この計画の目的(待たない)はボタンを押せなくすることで満たせる。
  Date/Author: 2026-10-28 / Claude
- Decision: 回線方針の切り替え設定(以前の案の `wifi_only_strict` など)は作らない。スマホは1台で、上の規則だけで判定する。
  Rationale: ユーザー指摘(2026-10-28)。対象のスマホは配膳と照合で使っている1台だけで、端末の区別は要らない。
  Date/Author: 2026-10-28 / ユーザー、記録 Claude
- Decision: 棚マスタの配置編集(区画のレイアウト編集、棚の移動、Zero2W の割り当て)もスマホの機能なので例外にしない。圏外でも操作を受け付けて端末にすぐ反映し、Wi-Fi に戻ったら裏で送る。再送に安全でない点は Milestone 4 の操作 ID(`MobileClientOperation`)で解消する。
  Rationale: ユーザー指摘(2026-10-28)「スマートフォンの話だぞ」。スマホの全機能をローカル優先にする。


## Outcomes & Retrospective

(未記入。各 Milestone の完了時に書く。)


## Context and Orientation

スマホの画面は `apps/web`(React)にあり、ルートは `apps/web/src/App.tsx` の `KioskLayout` の下に並ぶ。スマホが使うのは `/kiosk/mobile-placement`(配膳ハブ。照合タブと配膳タブ)、`/kiosk/mobile-placement/part-search`(部品検索)、`/kiosk/mobile-placement/shelf-master`(棚マスタ)、`/kiosk/mobile-placement/zero2w-status`(Zero2W 配膳状況)、`/kiosk/mobile-placement/pallet-viz`(パレット)、`/kiosk/purchase-order-lookup`(購買照会)。機能のコードは主に `apps/web/src/features/mobile-placement/`。サーバーは `apps/api`(Fastify と Prisma)で、スマホ用の API は `apps/api/src/routes/mobile-placement/index.ts` と `apps/api/src/routes/kiosk/mobile-local-data.ts`。

既にある部品は次のとおり。`apps/web/public/sw.js` は Service Worker(ブラウザが画面と別に動かす小さなプログラム)で、圏外でも画面の骨組み(index.html と `/assets`)を出す(#2313)。API の応答はキャッシュしない。`apps/web/src/features/mobile-placement/connectivity.ts` は「圏外」かどうかを決める。`navigator.onLine` が偽か、直前の要求が 3 秒以内に応答しなかったときに圏外とし、15 秒ごとに `GET /kiosk/mobile-local-data/versions` で回復を確かめる。`mobileRequest` は要求を 3 秒で打ち切る包み。`local-data/MobileOfflineChip.tsx` が「圏外 M/D」チップ(M/D はデータの日付)。

照合と購買のデータは `local-data/mobileLocalDataStore.ts` が IndexedDB `mobile-local-data-v1` に持つ。表は `metadata`、`known`、`purchase`(注番で索引)、`schedule`(製造order と製番で索引)。`local-data/mobileLocalDataSync.ts` が版(データの中身から作るハッシュ)を比べ、変わった表だけを丸ごと取り直す。購買は本番で約 22.5 万行。照合の判定は共有パッケージ `@raspi-system/slip-match-core` の `verifySlipMatch` を端末で動かす。

送信待ち箱(以後「アウトボックス」。送る前の書き込みを端末に保存しておく箱)は二つある。配膳用は IndexedDB `haizen-offline-queue`(`haizen/offline/`)。「ここに置く」は箱に入れてすぐ画面が進み(#2358)、裏で `POST /mobile-placement/register-order-placement` に送る。この API は `clientRecordId` が一意なので、再送しても二重にならない(`apps/api/src/services/mobile-placement/mobile-placement-order-placement.service.ts`、`prisma/schema.prisma` の `OrderPlacementEvent`)。4xx(408 と 429 を除く)は「要確認」、それ以外は「未送信」のまま 30 秒ごとに再送する。棚用は IndexedDB `shelf-offline-queue`(`shelfMaster/offline/`)で、新しい棚の登録(`POST /mobile-placement/shelves` のあと `PUT .../photo`)だけを扱う。

一覧の控えは localStorage にある。登録済みの棚(`mobile-placement-registered-shelves-v1`)と機種(`mobile-placement-shelf-machines-v1`)は `shelfListCache.ts`、製造orderごとの分配枝は `orderPlacementBranchesCache.ts`(`mobile-placement-order-branches-v1:<製造order>`。消されずにたまり続け、端末で一度も見ていない製造orderは圏外だと分からない)。

機能ごとの現状は次のとおり。照合は、端末にデータがあればローカルで判定する。データが無い初回はサーバーを待つ。配膳(「ここに置く」と分配)は書き込みがアウトボックス経由でローカル優先。読み取りは製造orderごとの控えだけなので、初めて見る製造orderは圏外だと枝が分からない。購買照会はローカル優先(初回だけサーバー待ち)。棚番登録は新しい棚の登録だけがアウトボックスを通るが、保存ボタンが最初の送信を待つ。棚マスタの編集(メモ、写真の差し替え、削除、目印、Zero2W の割り当て、区画のレイアウト、棚の移動)は、すべて通信が終わるまで「保存中」のまま待つ。棚写真の表示はメモリとブラウザの HTTP キャッシュだけで、圏外では出ないことがある。部品検索は入力のたびに `GET /mobile-placement/part-search/suggest` を待つ(サーバーで置き場、日程、同義語辞書を合わせて探す)。Zero2W 配膳状況とパレットは 15 秒ごとに取り直し、圏外では空になる。パレットの追加・差し替え・削除は通信を待つ。現品票の撮影 OCR は、WebView アプリのネイティブ読取ならローカル、ブラウザの撮影ならサーバー待ち。工具配置という独立した画面はスマホ側に無い。

サーバー側で再送に安全でないのは次のとおり。`POST /mobile-placement/shelves` は同じ棚を再送すると 409 を返す(端末は `stage` で回避)。`DELETE /mobile-placement/shelves/:code` は再送で 404。`POST /mobile-placement/shelves/:code/relocate` は再送で二回動く。古い `PATCH .../order-placement-branches/:id/move` と `POST /mobile-placement/register` には端末の ID が無い。パレットの追加にも端末の ID が無い。


## Plan of Work

### Milestone 1: 共通の同期層

この Milestone の終わりには、スマホのどの画面にいても、未送信の書き込みが Wi-Fi のときだけ裏で送られ、照合・購買のデータも裏で更新される。棚番登録の保存ボタンは待たなくなる。

新しいフォルダ `apps/web/src/features/mobile-placement/sync/` を作る。`networkGate.ts` は「いま同期してよいか」を返す。`connectivity.ts` の到達判定(圏外でないこと)に、Decision Log の Wi-Fi 判定を重ねる。`navigator.connection` の `change` イベントで状態を更新し、購読できる形(`useSyncExternalStore` 用の `subscribe` と `getSnapshot`)にする。

`syncScheduler.ts` はアプリ全体で 1 つだけ動く同期係。登録された「同期の仕事」(アウトボックスの送信、版付きデータの取得)を順に実行する。実行のきっかけは、起動時、`networkGate` が許可に変わったとき、画面が前面に戻ったとき(`visibilitychange`)、未送信があるときは 30 秒ごと、無いときは 30 分ごと。失敗したら仕事ごとに待ち時間を倍にして(上限 6 時間、データ取得は既存の値)再試行する。同時に二つの仕事は走らせない。

`outbox.ts` は既存の二つのアウトボックスの共通部分を取り出したもの。記録には `opId`(UUID)、`kind`、`payload`、`createdAt`、`status`(`pending` または `needs_check`)、`message` を持たせる。種類ごとの送り方は `kind` に対応する送信関数で登録する。既存の `haizen-offline-queue` と `shelf-offline-queue` の DB 名とデータ形式は変えない(反映前に端末に残っている未送信を失わないため)。共通の型と処理はアダプタとして包む。

`MobileSyncProvider.tsx` を作り、`App.tsx` でスマホのルート群(上の 6 つと `/kiosk/inventory/haizen`)を包む。ここで同期係を起動し、既存の `useMobileLocalData`、`useHaizenOfflineQueue`、`useShelfOfflineQueue` の中にある起動・タイマー・`online` イベントの処理を同期係への登録に置き換える。画面側のフックは、件数と状態を読むだけにする。

`useShelfOfflineQueue` の `submit` は、箱に入れたら最初の送信を待たずに返す。結果は配膳と同じく、あとから知らせる。`localFirstLookup.ts` のサーバー補助は Decision Log のとおりやめる。データが一度も無い端末(初回)は、照合の結果を「データ無し」として扱い、待たない。

同期の状態の見せ方は、`MobileOfflineChip` を共通のチップにまとめる。圏外(または Wi-Fi でない)ときは「圏外 M/D」、未送信があるときは「未送信 N」、要確認があるときは「要確認 N」を、スマホの各画面の見出しの同じ位置に出す。既存の配膳タブのチップの見た目と文言は変えない。新しい説明文は足さない。

受け入れ: Wi-Fi を切った状態(テストでは `navigator.connection.type = 'cellular'` を模擬)で「ここに置く」を押すとすぐ次へ進み、部品検索の画面へ移ってから Wi-Fi に戻すと、その画面のまま未送信が 0 になる。`type` が取れないときも送らない。

### Milestone 2: 配膳の読み取りをローカル化

この Milestone の終わりには、端末で一度も見ていない製造orderでも、圏外で分配枝が分かる。棚写真は圏外でも出る。

`placements` のサーバー取得・端末DB v2は Milestone 3 が担当する（Decision Log 参照）。この Milestone では `useOrderPlacementBranches` を `listPlacementsByManufacturingOrder` とアウトボックスの未送信の重ね合わせへ切り替える。`orderPlacementBranchesCache.ts` の localStorage の控えは読むのをやめ、移行時に一度だけ消す。

棚写真は新しい IndexedDB `mobile-shelf-photos-v1` に、棚コードと `photoUpdatedAt` をキーにして画像(Blob)で持つ。同期係は登録済みの棚の一覧を見て、写真の版が変わった棚だけを Wi-Fi のときに取り直し、古い版は消す。`useShelfPhoto` はこの保存先だけを読む。

受け入れ: 端末のデータを消して Wi-Fi で一度同期したあと Wi-Fi を切り、その端末で見ていない製造orderを読むと、ほかの端末で置いた枝が出る。棚写真の一覧が圏外でも全部出る。

### Milestone 3: 部品検索をローカル化

承認済みの `PartSearchOneHandView` と `packages/part-search-core` の純粋検索を使い、端末の `placements` を検索する。pending の製造order配膳登録も `schedule` の ProductNo で結合して表示する。濁点・半濁点・長音の検索表記ゆれは共有コアで吸収する。サーバー suggest API は残し、スマホからの呼び出しと旧キーボード・palette は削除する。削除は専用アウトボックス経由とし、読み取り・入力操作は通信を待たない。受け入れ: オフライン検索、削除キュー、再取得時の pending 非表示、needs_check 復元がテストで確認できる。

### Milestone 4: サーバーの二重実行防止と棚マスタの編集

まずサーバーに `MobileClientOperation` 表(Prisma の移行を追加)と、Fastify のルートで使う小さな包み `withClientOperation(request, kind, handler)` を作る。`Idempotency-Key` ヘッダーがあれば表を見て、記録済みなら前回の結果を返す。無ければ処理して結果を同じ取引の中で記録する。ヘッダーが無い要求は今までどおり動く(キオスクや管理画面を壊さない)。記録は 30 日で消す(既存の定期処理に追加)。

次に棚マスタの編集(メモ、写真の差し替え、削除、目印の追加と削除、Zero2W の割り当て、区画のレイアウト編集、棚の移動)をアウトボックスに通す。端末は操作をすぐ控え(localStorage の棚一覧)に反映し、裏で送る。

受け入れ: 同じ `Idempotency-Key` で 2 回送ったとき、2 回目は 1 回目と同じ応答を返し、DB の行は 1 回分だけ変わる(API の結合テスト)。圏外でメモを保存すると、すぐ一覧に反映され、Wi-Fi に戻ると送られる。

### Milestone 5: Zero2W 配膳状況とパレット

Zero2W 配膳状況は Milestone 2 の `placements` 表から作り、15 秒ごとの取り直しをやめる。パレットは現在の状態を版付きデータとして端末に持ち、追加・差し替え・削除をアウトボックスに通す。サーバーの追加 API には Milestone 4 の包みを付ける。

### Milestone 6: 仕上げ

ブラウザ撮影の現品票 OCR は、同期できないときに撮影ボタンを押せなくする。使われなくなった古い経路(`useMobilePlacementPageState.ts` の `runRegister` が呼ぶ `registerOrderPlacement` の直接送信と `moveOrderPlacementBranch`)を消す。`docs/knowledge-base/KB-339-mobile-placement-barcode-survey.md` にローカル優先の仕組みと実機確認の結果を記録する。


## Concrete Steps

作業はこのリポジトリの worktree(例 `.claude/worktrees/sharp-galileo-3d866f`)で行う。最初に依存を入れる。

    pnpm install --offline --frozen-lockfile
    pnpm -r --filter './packages/*' build

Web の対象テストは次で動かす。

    pnpm --filter web exec vitest run src/features/mobile-placement

API の対象テストは次で動かす(DB が要るものは CI と同じ手順に従う)。

    pnpm --filter api exec vitest run src/routes/__tests__/mobile-placement

型と lint は `pnpm --filter web typecheck`、`pnpm --filter api typecheck`、`pnpm lint`。


## Validation and Acceptance

各 Milestone の受け入れは上に書いた。自動テストとして必ず足すものは三つ。一つ目は回線の切り替え。`navigator.connection` と `navigator.onLine` を模擬し、`cellular` から `wifi` への変化で同期係が動き、逆の変化で止まり、`type` が無いときは動かないこと。二つ目は再送。同じ操作 ID を 2 回送ってもサーバーの状態が 1 回分しか変わらないこと(API の結合テスト)と、端末で送信の途中に失敗した記録が、次の同期で一度だけ送られること。三つ目は待たないこと。送信関数が永遠に終わらない模擬で、保存ボタンが押せる状態に戻り、画面が次へ進むこと。

本番での確認は、反映後に実機で行う。Wi-Fi を切ってその画面の操作がすぐ反映されること、Wi-Fi に戻して未送信の件数が 0 になり、別の端末に結果が出ることを見る。


## Idempotence and Recovery

端末の DB の版上げは、既存の表を消さず足すだけにする。localStorage の古い控えを消すのは、新しい表への取得が一度成功してからにする。サーバーの移行は表の追加だけで、戻すときは新しいルートの包みを外せば元の動きに戻る。各 Milestone は 1 つの PR にし、戻すときはその PR を戻す。


## Data Size and Retention on the Device

購買は約 22.5 万行で、既に端末に入っている。日程も同じく既存。現在の置き場は有効な枝だけなので数千行程度で、差分取得にする。棚写真は 1 枚 1.5MB 以下(サーバーの上限)で、登録済みの棚の数だけ持ち、古い版は消す。合計で 300MB を超えたら、長く見ていない写真から消す。アウトボックスは送れた記録をすぐ消し、「要確認」は人が消すまで残す。起動時に `navigator.storage.persist()` を呼び、ブラウザが勝手にデータを消さないよう頼む。スマホには 20GB 以上の空きがある。


## Interfaces and Dependencies

端末側の主な形は次のとおり(名前は実装で多少変えてよいが、変えたら Decision Log に書く)。

    // apps/web/src/features/mobile-placement/sync/networkGate.ts
    export function canSyncNow(): boolean;
    export function useCanSync(): boolean;

    // apps/web/src/features/mobile-placement/sync/syncScheduler.ts
    export type SyncJob = { name: string; run(): Promise<void>; hasPendingWork(): Promise<boolean> };
    export function registerSyncJob(job: SyncJob): () => void;
    export function requestSync(reason: string): void;

    // apps/web/src/features/mobile-placement/sync/outbox.ts
    export type OutboxRecord<P> = { opId: string; kind: string; payload: P; createdAt: string;
      status: 'pending' | 'needs_check'; message?: string };

サーバー側の包みは次のとおり。

    // apps/api/src/lib/client-operation.ts
    export async function withClientOperation<T>(request: FastifyRequest, kind: string,
      handler: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T>;

外部ライブラリは既に使っている `idb` だけを使う。
