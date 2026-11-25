# 製造オーダー番号をすべて残す(番号が大きいほうだけ残す決まりの撤廃)

この ExecPlan は `.agent/PLANS.md` に従う。作業中は Progress、Surprises & Discoveries、Decision Log を更新し続ける。

## Purpose / Big Picture

生産日程の取り込みでは、製番・品番・資源・工程(`FSEIBAN + FHINCD + FSIGENCD + FKOJUN`)が同じ行が複数あると、`ProductNo` が最大の1行だけを残している(2026-02-10、`fb95b9ca`「製造order番号の繰り上がりルール」)。

ところが、この業態では同じ部品・同じ工程に製造オーダー番号が複数あるのは普通のことである。番号が違えば別の注文なので、すべて残す必要がある。

2026-11-25 には次の不具合が起きた。

- aquos-sense4-lite の照合で、0004146538(ベアリング押え BA1SC381、MD005279290)が「未登録」になった。
- 同じキーの 0004146555 が勝ち、…538 は DB に入っていなかった。
- 2件とも工程 200/300 が作業中で、数量 CSV にもそれぞれ3個で載っている。つまり実在する別注文である。

完了後に見える姿は次のとおり。

- 番号が違う注文は、日程・ボード・負荷・照合・配膳・端末データのどこでも別々の行として現れる。
- 2月の決まりが想定していた「振り直しで古くなった番号」には、工程状態 `X` が付いている。これには印を付け、今と同じく見えないままにする。

## 根拠データ(2026-11-24 夜の日程 CSV と本番 DB、読み取りのみ)

- 確定製番の行は 71,875 行、キーは 63,816 組。
- 番号が2つ以上あるキーは 7,827 組。捨てていた行は 8,059 行、捨てていた番号は 1,619 件。
- 捨てていた行の工程状態(捨てた番号, 残した番号)の内訳は次のとおり。
  - (X, P/C/R/S/O): 7,497 行。振り直しで古くなった番号と見られる。
  - (C, C) 228、(P, P) 190、(R, R) 45、(R, C) 2: 合わせて約 465 行。同時に生きている別注文。
  - (X, X): 97 行。
- 数量 CSV(`部品納期個数`)には 0004146538 と 0004146555 がどちらも3個で載っている。補助同期が winner にしか付けないため、今は捨てた番号の数量が負荷から抜けている。

## Progress

- [x] (2026-11-25) 原因調査、本番データでの影響測定、利用箇所の洗い出し
- [x] (2026-11-25) 計画書の第三者レビューと反映
- [x] (2026-11-25) M0 回帰テストを先に書く(失敗することを確認)
- [x] (2026-11-25) M1 キーの定義と取り込み・移行
- [x] (2026-11-25) M2 独自にキーを組む箇所の修正
- [x] (2026-11-25) M2b 入れ替わった古い番号の印と引き継ぎ
- [x] (2026-11-25) M3 切削の分割(sessaku pieces)の親の特定
- [x] (2026-11-25) M4 Web 側のキー。旧4要素の行 ID は書き込みで 409 `STALE_PLANNING_BOARD_ITEM`、画面が読み直す
- [x] (2026-11-25) 第三者レビュー(Fable)の指摘を修正(ロック順、メール同期の継続、0件時の印、印付き行への完了操作、移行のロック)
- [x] (2026-11-25) M5 本番の写し(生産日程 106,828 行)で、事前検証の中止条件すべて0件・ハッシュ不一致0件。移行は22秒、研削ボードの4要素キー 42,486 件を5要素へ、切削の組で番号が空のものは0件。印付けは約1.5秒、見える行の条件は全件で約0.6秒(既存の索引を使用)
- [ ] M6 PR、第三者レビュー、デプロイ、デプロイ後の確認

## Surprises & Discoveries

- 2月の決まりと、同時に生きている別注文は、結果だけ見ると同じ現象(同じキーに複数番号)になる。区別できるのは工程状態 `X` で、捨てていた行の約93%が `X` だった。
- 仮製番 `********` は 2026-09-24(`c7c90747`)から、すでに番号ごとに残している。今回はこの例外を全製番に広げる形になる。
- 第三者レビュー(2026-11-25)で、計画に無かったものが見つかった。
  - `ProductionScheduleRowSeen`(主キー `dataHash`):
    - 製番ボードと負荷集計は、この表で行の存在を見ている(`schedule-row-presence.service.ts:38-42`)。
    - 行のハッシュだけを変えると、次の取り込みまで行が消える。
    - 移行で、新しいハッシュの行を旧 `lastSeenAt` 付きで入れる。
  - 研削ボードの itemKey を保存する3表(`ProductionScheduleGrindingPlanningBoardOverride` / `Arrival` / `FirstProcessArrival`):
    - 完全一致で引いている。
    - 移行で5要素に書き換える。0924 の移行は Override だけを書き換えていた。
  - 移行 SQL と TS のハッシュの一致:
    - 移行 SQL のハッシュが TS の `calculateProductionScheduleDataHash` と1文字でもずれると、取り込みが別 id の新しい行を作り、関連が古い行に取り残される。
    - 反映前に、全行で TS の計算と突き合わせる。
  - 独自にキーを組む箇所の追加分:
    - `grinding-planning-board-projection.ts:102-118`
    - `process-arrival.service.ts:18`(部品キーが製番+部品なので、2注文の工程が混ざる)
    - `grinding-planning-board-load-summary.ts:115-127,405-409`
    - `grinding-planning-board/shared.ts:96-108`
  - 外注の名指し先 `ProductionScheduleOutsourceNamedTarget.key` は、Web の部品キー文字列を保存している。部品単位のままで正しいので変えない。
  - 購買票は、製番+部品ごとに最大番号の行に結び付いている(`purchase-order-lookup-planned-start.service.ts:55-88`)。別注文の番号にも結び付ける。
  - 切削の分割は `rows[0]` を順序なしで採っている(`piece-key.ts:97-107`)。複数行になると結果が決まらない。
  - 取り込みの L425-428 の「キーの食い違い」は実害が無かった。SQL 側も仮製番のときだけ ProductNo を使う。

## Decision Log

- 決定: 行の識別を `FSEIBAN + FHINCD + FSIGENCD + FKOJUN + ProductNo` にする(全製番)。
  - 理由: 番号が違えば別注文、というユーザーの業務上の前提(2026-11-25)。
  - 仮製番で前例があり、同じ形で広げられる。
- 決定(第三者レビューで改訂): 取り込みでは全番号を保存し、「入れ替わった古い番号」に印を付けて、中心の winner 条件で除く。
  - 印は `CsvDashboardRow` の列(例 `supersededAt`)にする。
  - winner 条件は `buildMaxProductNoWinnerCondition` と winner キャッシュ。約60の利用箇所は今と同じ見え方を保ち、本当に別注文の番号だけが新たに現れる。
  - 「入れ替わった古い番号」の定義: その行の工程の工程状態が `X` で、同じキーに `X` でない別の番号がある。(X, X) の97行は両方 `X` なので、両方見える(完了扱い)。
  - 印付けは `(ProductNo, FKOJUN, FSIGENCD)` に一致するメールの最新状態を優先する。一致がなければ `(ProductNo, FKOJUN)` に最新状態が1件以上あり、すべて `X` の場合だけ `X` と判定する。
  - 同じ4列キーに異なる番号がある組のメールだけを読み込む。読み込み可能なメール行が全体で0件の場合は既存の印を保持し、メール行がある場合は候補が0件でも不要になった印を外す。
  - 印は2か所で付け直す: 生産日程の取り込みの後と、工程状態の取り込みの後。古い番号の `X` は以前のメールで DB に入っているので、反映後の最初の取り込みでもすぐ印が付く。
  - 理由: `X` を完了扱いにするだけでは、次の所の数え方が変わる(レビュー指摘)。
    - 手動完了だけを見る負荷見積もりと完了履歴分析
    - 全行を数える納期管理
    - 製番進捗の分母
    - モバイルの製番状況の部品数
- 決定: 本当の振り直しで切れる引き継ぎを、印を付けるときに補う。
  - これまでは、振り直すと同じ行のまま番号だけが変わっていた。そのため、備考・割当(順位)・研削ボードの上書きと到着が、新しい番号へ自然に引き継がれていた。
  - 全番号を別の行にすると、この引き継ぎが切れる。
  - そこで、古い番号に印を付けるとき、新しい番号の行に備考・割当が無ければ移す。
  - 移す対象(2026-11-25 ユーザー決定「今と同じに全部移す」): 備考(RowNote)、手動の順番(OrderAssignment)、全体順位(GlobalRowRank)、研削ボードの上書き・着・最初の工程の着(itemKey 3表)、数量の分割(OrderSplit)、手動の完了(Progress)。新しい番号の行に無いものだけ移す。
  - 移さない(取り込みで自動で付く): 数量・納期の補助(OrderSupplement)、工程状態(FkojunstStatus / FkojunstMailStatus)、外部完了(ExternalCompletion)。
- 決定: 既存行の ID と関連(備考・納期・割当・進捗・完了・順位)は保持する。
  - 方法: 移行で `dataHash` だけを新しい識別に計算し直す(20260924 の移行と同じ方式)。
  - 既存行は今の winner なので、キーごとに1行しかなく衝突しない。
- 決定: 部品・工程単位で正しい集計(標準工数 `actual-hours`、工数 `labor-minutes`)は4列キーのまま変えない。
  - 理由: 注文ではなく部品の性質だから。
- 却下した案:
  - 照合だけ別表で引く案: 日程・ボード・負荷に出ないまま。
  - 作業中の注文だけ決まりから外す案: 届く順番に依存し、影響範囲も読みにくい。

## Context and Orientation

中心の定義(`apps/api/src/services/production-schedule/row-resolver/`):

- `constants.ts`: `productionScheduleKeyColumnsForRow`(仮製番のときだけ `ProductNo` を足す)と `calculateProductionScheduleDataHash`。
- `max-product-no-winner-spec.ts`: `buildMaxProductNoLogicalKeyPartitionExprs` と `buildMaxProductNoLogicalKeyMatchAndSql`。`'********'` の CASE が直書きされている。
- `max-product-no-sql.ts`: `buildMaxProductNoWinnerCondition`。約60ファイルが使う。spec を変えれば「キーごとに1行 = 全行」になって自動で追従する。
- `max-product-no-resolver.ts`: `resolveToMaxProductNoPerLogicalKey`。取り込み時の間引き。
- `max-product-no-winner-materialization.ts`: 順位ボードの winner キャッシュ。

取り込み(`apps/api/src/services/csv-dashboard/csv-dashboard-ingestor.ts`):

- L182 で間引き、L156/212 でハッシュを作る。
- L425-428 は `deleteDuplicateLosers` に4列 + ProductNo を渡しており、resolver のキーと食い違っている。要確認。

日次の掃除: `retention/production-schedule-cleanup.service.ts`

- L187-211、L300 で仮製番の条件を独自に持つ。
- 重複とみなした行を消すと、関連表もカスケードで消える。

`CsvDashboardRow.id` をカスケードで参照する表: `ProductionScheduleOrderSupplement`、`ProductionScheduleFkojunstStatus`、`ProductionScheduleFkojunstMailStatus`、`ProductionScheduleRowNote`、`ProductionScheduleOrderSplit`、`ProductionScheduleOrderAssignment`、`ProductionScheduleProgress`、`ProductionScheduleExternalCompletion`、`ProductionScheduleGlobalRowRank`。

独自にキーや winner を組む箇所(手で直す。いずれも 2026-11-25 時点の行番号):

API:

- `process-arrival.service.ts:77-93`: 独自の DISTINCT ON。
- `grinding-planning-board-load-summary.ts`: :119、:328、:355-364、:409、:552-553。
- `grinding-planning-board/shared.ts:101-102`: rowItemId の 4/5 要素の判定。
- `production-schedule-query/raw-page.ts:93`、`d-schedule-minutes/board-due.sql.ts:60`: 補助データの結合での仮製番の条件。
- `order-supplement-sync.pipeline.ts:206-290`: winnerRank=1 だけに付与。spec 経由なので追従するが、兄弟からの数量の流用(fallback)の挙動を確認する。
- `sessaku-pieces/*`: 4列キーで分割セットを保存している(下の M3)。

Web:

- `apps/web/src/features/kiosk/grindingPlanningBoard/gantt/planningBoardGanttLayout.ts:36`
- `apps/web/src/features/kiosk/loadBalancing/loadBalancingNamedTargets.ts:6`

要精査:

- `packages/slip-match-core/src/slip-match.ts`
- `leaderboard-part-footer-processes.service.ts:100-122`(すでに ProductNo を含む)

影響を受けないもの:

- `fkojunst-status-mail-superseded-prune.service.ts`。消すのは工程状態メールの生データで、日程の行は触らない。

## Plan of Work

M0 回帰テスト(実装の前に書き、失敗を確かめる):

- 取り込み: 同じキーで ProductNo が 0004146538 と 0004146555 の2行を入れると、2行とも保存される。
- 照合: 移動票 0004146538 と現品票(購買)0006073893 が `match` になる。
- 照合: 0004189911(支持ブラケット)と 0004146538 は、引き続き部品違いになる。
- 工程状態: 同じキーに生きている番号があるとき、`X` の古い番号は印が付いて見えない。両方 `X` なら両方見える。
- 数量: 2行それぞれに補助データの数量が付く。

M1 キーの定義と取り込み・移行:

- `productionScheduleKeyColumnsForRow` を常に ProductNo 込みにする。
- spec の CASE と条件を、常に ProductNo で比べる形にする。
- `resolveToMaxProductNoPerLogicalKey` は完全に同じ行の重複除去だけにする。
- 移行 SQL で全行の `dataHash` を計算し直す。ID は保つ。重複や衝突があれば、更新の前に中止する。
- 日次の掃除の「重複loser削除」は新しいキーでは対象が無くなる。仮製番の分岐を除いて共通化する。
- 移行で `ProductionScheduleRowSeen` に新しいハッシュの行を旧 `lastSeenAt` で入れる。
- 移行で研削ボードの itemKey 3表を5要素に書き換える。
- 移行の前に、全行で SQL のハッシュと TS の計算が一致するかを確かめるスクリプトを用意する。本番の写しで不一致0件を確認する。

M2 独自にキーを組む箇所を、上の一覧と Surprises の追加分どおりに直す。各箇所の既存テストを通し、足りなければ足す。購買票も別注文の番号に結び付ける。

M2b 入れ替わった古い番号の印:

- `CsvDashboardRow` に印の列を足す。
- 上の定義で印を付け直す関数を1つ作り、生産日程と工程状態の両方の取り込み後処理から呼ぶ。
- `buildMaxProductNoWinnerCondition` と winner キャッシュが「印の無い行」を返すようにする。
- 新しい番号の行に備考・割当(順位)が無ければ、古い行から移す。
- 移す/移さないの一覧(手動完了、研削ボードの上書き・到着を含む)をユーザーに見せて決める。

M3 切削の分割:

- 分割セットが4列キーで保存されているため、同じキーに注文が2件あると、どちらの分割か決められない。
- `ProductionScheduleSessakuPieceSet` などに ProductNo を持たせる。既存セットは、移行時点の winner の ProductNo で埋める。
- rowItemId を5要素に統一する。古い4要素の ID は、どの書き込みでも 409 `STALE_PLANNING_BOARD_ITEM` にし、画面に読み直させる(レビューで方針を統一)。
- 仮製番の「分割できません」は、要否を確認してから外す。

M4 Web と保存済みキーの互換:

- Web の部品キーを製番+品番+製造オーダー番号にする。負荷調整の名前付き対象は部品単位のまま(注文ごとには分けない)。保存済みの研削ボードのキーは移行で5要素に書き換える。

M5 本番データの写しでの比較(デプロイ前の必須条件):

- 移行の前と後で、次の画面の API 応答件数と差分を比べる:
  - 製番進捗
  - 順位ボード
  - 研削の計画ボード
  - 負荷調整
  - 納期管理
  - 照合・配膳の端末データ
- 期待:
  - 見える行は約 560 行だけ増える。内訳は、生きている別注文 約465、(X, X) 97。
  - 入れ替わった古い番号 約7,500 行は保存されるが、印付きで見えない。
  - 0004146538 が見える。
- 主要な問い合わせの時間を比べる(行数が約13%増える)。

M6 PR → 第三者レビュー(Fable。本番データに影響するため)→ デプロイ:

- デプロイ後、最初の夜の取り込みで、捨てていた番号が新しい行として入る。
- その後の工程状態と数量の同期で、新しい行に状態と数量が付く。
- 翌朝、0004146538 が日程にあり、照合が `match` になることを確かめる。

## Concrete Steps

作業フォルダ: `~/RaspberryPiSystem_002-worktrees/feat--keep-all-manufacturing-orders`

    pnpm --filter @raspi-system/api test -- row-resolver csv-dashboard-ingestor production-schedule-cleanup sessaku-pieces
    pnpm --filter @raspi-system/slip-match-core test

(コマンドは実装時に package 名を確かめて直す。)

## Validation and Acceptance

- M0 のテストがすべて通る。
- M5 の比較で、増えた行が上の期待の範囲に収まる。
- デプロイ翌朝の本番で次を確かめる:
  - `CsvDashboardRow` に 0004146538 の行がある。
  - 端末の照合で 0004146538 と 0006073893 が一致になる。

## Idempotence and Recovery

- 移行は `dataHash` の更新だけで、ID と関連は変えない。
- 移行後に旧 API へ戻さない。旧コードが取り込むと4要素のハッシュで別の行を作り、元の行が消えて備考・割当もカスケードで消える。
- 同じ理由で、移行から新 API の起動までの間に日次の取り込み(13時台)が重ならないよう、12:45〜13:45 を避けてデプロイする。
- 不具合は前へ直す(修正版をデプロイする)。

## Artifacts and Notes

- 測定に使った CSV と集計は 2026-11-25 の調査会話で取得した(読み取りのみ)。
- 状態コードの件数(工程状態の全行): C 217,900、P 661,866、R 30,032、S 1,684、O 35,004、X 17,886。

## Interfaces and Dependencies

- 公開 API の形は変えない。
- rowItemId の要素数は変わる(4→5)。古い形は書き込みで 409 を返し、画面が読み直す。
- DGX Control Plane には関係しない。
