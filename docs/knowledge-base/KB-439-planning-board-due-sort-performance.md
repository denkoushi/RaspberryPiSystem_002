# KB-439: Planning board 「納期順」 frontend performance

- Status: `implemented-local`
- Date: `2026-11-05`
- Scope: `apps/web/src/features/kiosk/grindingPlanningBoard/`, 前詰め / 代替 / 資源CD表示
- Evidence: [after.json](../../apps/web/src/features/kiosk/grindingPlanningBoard/__perf__/after.json)
  の現在値と `comparisonBefore`。前段のMap化前の履歴は [before.json](../../apps/web/src/features/kiosk/grindingPlanningBoard/__perf__/before.json)。
- Production verification: not performed; no git commands, commit, push or deployment

## Context

Raspberry Pi 4 の Chromium で「納期順」を押した後の表示切替が遅い。
製番80、品1500、資源20、分割89、特別納期52の合成データで、実際の
`usePlanningBoardPageGantt`、書き込みキュー、ガントを実行した。
500部品に各3工程を持たせ、資源間の依存と順番逆転を含める。
前段のMap化・レイアウト計算削減を残し、今回は背景DOMと保存応答時の描画を削減した。

## Measurement

Apple M3 / macOS arm64 / Node v24.3.0 / React / jsdom。同じ入力・計測で比較した。
フックと描画は1回ウォームアップを除いた3試行の中央値。配置単体は3回除外した5試行の中央値。
**Pi 4実機やブラウザのlayout/paintの時間ではない。** GCや端末負荷による試行間のばらつきもJSONに残す。
表示日数242→377日、棒1500本・区間3207は変更前後で一致する。

| Interval / JSON field | 今回変更前 | 今回変更後 |
| --- | ---: | ---: |
| 初回 mount / `medians.viewMountMs` | 1,427.830 ms | 445.174 ms |
| 並べ替え後のガント更新 / `medians.viewUpdateMs` | 937.400 ms | 393.984 ms |
| 保存応答ごとのガント更新 / `acknowledgementViewMedianMs` | 242.325 ms | 7.076 ms |
| 保存応答1件あたりの行描画 | 20行 | 0行 |
| 最終DOM要素数 | 67,788 | 22,648 |
| 並べ替え・検証・enqueue / `medians.handlerMs` | 5.426 ms | 3.839 ms |
| クリックからフックの楽観commit / `medians.firstDisplayMs` | 17.219 ms | 16.051 ms |
| 全保存応答のフック処理 / `medians.acknowledgementsMs` | 270.695 ms | 216.978 ms |

保存応答は20件を実際の順序で描画し、各試行の `acknowledgementViews` に時間と行描画数を保存する。
表の応答時間は3試行×20件の60更新の中央値。`viewAcknowledgementMs` は各試行内20件の中央値。
変更前に追加計測した最終同一snapshotの再描画時間は `repeatedFinalLayoutMs` として分離し、比較に使わない。
計測用 `useState` wrapperは `useCallback` でsetter参照を保ち、React本来の参照安定性を崩さない。
計測用の行wrapperはmemoを通過した行を数える。通常テストでも新規生成Contextと最新callbackを含めて検証する。

キューの更新要求61回（キュー41＋履歴20）、commit/レイアウト21回、楽観適用210回は両方で同じ。
保存の逐次実行や競合処理は変えず、同値の保存応答による行描画を止める。

## DOM Breakdown

下表は互いに重複しない分類で、合計が全要素数に一致することを計測時に検証する。

| 部品 | 今回変更前 | 今回変更後 |
| --- | ---: | ---: |
| 行内の日別背景ラッパー | 7,540 | 0 |
| 非稼働時間帯 | 15,080 | 40 |
| 休憩帯 | 22,620 | 60 |
| 日付見出し | 377 | 377 |
| 時刻見出し | 9,048 | 9,048 |
| 資源ラベルと操作ボタン等 | 140 | 140 |
| 棒ラッパー（棒の本数） | 1,500 | 1,500 |
| 棒区間（button） | 3,207 | 3,207 |
| 棒内の文字要素等 | 8,136 | 8,136 |
| 今日線 | 20 | 20 |
| 工程間の点線 | 53 | 53 |
| ★ | 0 | 0 |
| 日付区切り線・休日帯（前詰めでは元から描画なし） | 0 | 0 |
| その他のコンテナ等 | 67 | 67 |
| **合計** | **67,788** | **22,648** |

日別背景45,240要素を100要素に集約し、全体を66.6%削減した。
この合成データには処理出し日のContextがないため★は0。★を含む15条件の描画同値性検査と専用テストで位置・個数を確認する。
日付・時刻見出しと、棒・クリック・ドラッグ対象・★・今日線は維持する。

## Root Cause And Changes

- `PlanningBoardForwardGanttRow.tsx`: 非稼働帯は反復gradient、休憩帯は反復maskとハッチで描く。
  1日ごとの要素を、各行の非稼働2要素＋休憩3要素にまとめる。24Hでは描画せず、休憩なし設定も維持する。
  ハッチは1日幅で再開し、旧spanと同じ位相にする。`data-testid="planning-gantt-break"` は維持する。
- `planningBoardGanttSharing.ts`: 前詰めの表示内容が同じ行・group・layoutを再利用する。
  `version` と `itemRevision` のみ表示比較から除き、他の品情報・順位・区間・接続を比較する。
  保存用データやキューの参照は変更しない。
- `PlanningBoardGanttView.tsx`: 行をmemo化できるよう、同値のContext値・ラベル・製番色・callback参照を保つ。
  callbackは最新layoutの品をIDで引き直すため、再描画を省略しても古い版番号を保存操作へ渡さない。
  ドラッグ先一覧はrefで最新の位置を参照する。日付・時刻見出しのJSXも再利用する。
  データ更新でキューポップオーバーが閉じる既存挙動は、最新layoutを渡して維持する。
- 前段の `usePlanningBoardPageGantt.ts` / `usePlanningBoardWriteQueue.ts` のID検索・資源分類のMap化、
  `planningBoardGanttLayout.ts` のpush/先頭indexによる配置計算削減は維持した。
- API / DB / shared-types / 他画面のソースは変更していない。仮想化も追加していない。

## Validation And Visual Limits

- `cd apps/web && pnpm exec tsc --noEmit`: passed（約数秒）。
- `cd apps/web && pnpm exec vitest run src/features/kiosk/grindingPlanningBoard`: 25 files / 276 tests passed（5.73秒）。
- 変更した7個のTypeScript/TSXファイルへの `pnpm exec eslint`: passed。
- 専用計測: 3 checks passed（7.94秒）。`layoutParity` は前段と同じSHA-256を5条件で検証する。
- 新規 `renderParity`: 変更前から採取した15条件（8H/10H/24H×倍率1/2/4/14/56）の
  棒・★・今日線・納期マーカー・見出し・トラック・資源ラベルのstyle/class/aria/textと初期scroll位置のdigestに一致する。
- 背景帯は30条件（上記15条件×休憩あり/なし）で、各日の旧left/widthと反復周期・縦位置を照合する。
  元の色・opacity・pointer-eventsも検証する。既存の縦横スクロール、ズーム、ドラッグ当たり判定テストは全て成功した。
- 同値の保存応答＋新規生成Contextでは0行を描画し、最新callback・版情報を使用する。
  品名/固定状態が変わった場合は対象の1行だけ描画する。
- Playwright付属Chromium headless shellを使用した画素比較は、macOSの
  `MachPortRendezvous bootstrap_check_in Permission denied (1100)` で起動できず未実施。
  installed Chromeは起動していない。Pi 4実機検証も未実施。

見た目に差が出る可能性があるのはCSS化した非稼働・休憩帯の小数pixel境界とmaskの描画である。
位置・色・幅の計算は同値だが、実ブラウザのanti-aliasやpaintコストは上記jsdom検証では確認できない。

## Reproduction

```sh
cd apps/web
PLANNING_BOARD_PERF_OUTPUT=/tmp/planning-board-perf.json pnpm exec vitest run --config src/features/kiosk/grindingPlanningBoard/__perf__/vitest.config.ts
```

現在の実装で約8秒。`PLANNING_BOARD_PERF_BASELINE=1` は変更前実装の計測時だけ使い、0行描画のassertを外す。
`layoutParity` のみなら末尾に `layoutParity` を指定する。
`renderParity` の `PLANNING_BOARD_RENDER_OUTPUT=/tmp/planning-board-render` は比較用HTMLを出力する。
依存パッケージのdistがない場合のみ、既存ソースから生成物を準備する。

```sh
pnpm --filter @raspi-system/shared-types --filter @raspi-system/part-search-core --filter @raspi-system/shelf-layout-core --filter @raspi-system/slip-match-core build
```

## Deferred Verification

Pi 4上のlayout/paintを含む計測と背景帯の画素比較は未実施。
今回は仮想化、保存キューのバッチAPI、描画と因果のない改善は追加していない。

## 2026-11-05 ガント表示中の操作の追加調査

### 計測方法

`__perf__/pageInteractions.perf.tsx` を追加した。本物のページを 1500 品・80 製番・20 資源の合成データで描き、ネットワークのフックだけを mock する。操作ごとに、経過時間、Profiler の commit 数と actualDuration、行(`PlanningBoardForwardGanttRow`)の再描画数を取る。

```sh
cd apps/web
PLANNING_BOARD_PAGE_PERF_OUTPUT=/tmp/page-perf.json pnpm exec vitest run --config src/features/kiosk/grindingPlanningBoard/__perf__/vitest.config.ts pageInteractions
```

jsdom で計測したため、実ブラウザの layout と paint は含まない。混んだ Mac では数分かかるので、制限時間は 600 秒にした。経過時間は、マシンの負荷で 2 倍ほどぶれる。そのため、主な指標は行の再描画数にした。この数は負荷に左右されない。

### 原因

コミットごとの比較は、マシンの高負荷で一部しか完走していない。完走したのは SCAW の切替の前と 6fad0caa の 2 つで、b3939db2 と HEAD は試行版、57c73413(着)は未完走。比べられた範囲では、ドラッグ中の 400 回の再描画と、選択の切替で全行が再描画されることは、SCAW の切替より前からあった。新しく入った劣化として見えたのは #2559 の月平均だけ。原因は次の 3 つ。

- ドラッグ中は、指が動くたびに新しい `dragPreview` を全行の `preview` に渡していた。指を 20 回動かすと、行の再描画が 400 回になる。
- `selectedItemIds` を毎回 `new Set` で作り直し、全体の Set を全行に渡していた。そのため、選択の切替や盤面の定期再取得のたびに全行が再描画された。
- #2559 の月平均で、`uptime.data` が新しくなるたびに Map が作り直されていた。その結果、ラベル描画関数とラベルのキャッシュが無効になり、全行が再描画された。

### 変更

- 行には `preview` を渡さない。代わりに次の 2 つを渡す。
  - `draggedItemId`: ドラッグ元の品を含む行にだけ渡す。
  - `insertionLeft`: 挿入線の位置。ドロップ先の資源の行にだけ渡す。
- 行に渡す選択の Set は、その行の品だけにした。中身が同じ間は同じ Set を渡す(空なら共有の Set)。ページ側の `selectedItemIds` も、中身が同じなら前回の Set を返す。
- 月平均の Map は、中身が同じなら前回の Map を返す。

### 結果(行の再描画数。変更前は HEAD d67fefb2 の試行版の計測、変更後は同じテストの完走版)

| 操作 | 変更前 | 変更後 |
| --- | --- | --- |
| ドラッグ中に指を 20 回動かす | 400 | 18 |
| ドラッグ開始 / ドロップ | 20 / 20 | 1 / 1 |
| 長押しで選択の切替 | 20 | 1 |
| 盤面の定期再取得 / 全再取得 | 20 / 20 | 0 / 0 |
| 月平均の再取得 | 20 | 0 |
| 研削・切削の切替 | 40 | 20 |

ドラッグで指を 20 回動かしたときの経過時間は 3928ms から 611ms になった。変更後は高負荷の Mac で測っている。

製番の強調、30 秒ごとの now の更新、ガントの ON は、見た目が実際に変わるので全行を描き直す。今回は変えていない。

### 見た目の確認

`renderParity.perf.tsx` は、月平均のフックを mock して QueryClient なしで動くようにした。digest は HEAD の実装で取った値に更新した。変更前の 3 ファイルに戻した状態でも、変更後の状態でも、同じ digest で通ることを確かめた。

ドラッグ中の薄表示と枠、挿入線が 1 本だけ出ること、選択の緑枠と納期の ▲、月平均の表示、行の再描画数は、`PlanningBoardGanttMemo.test.tsx` と `PlanningBoardGanttView.test.tsx` で固定した。

## 2026-11-05 右端の「先の待ち」(画面外の作業を前へ引き寄せる)

1日表示のまま、画面の右端より先に始まる作業を前へ並べ替えられるようにした。前詰めガントの各資源レーンの右端に、幅 14px の細い帯を貼り付ける。帯には矢印だけを出し、件数やカードは出さない(2026-11-05、実機確認でガントの表示幅を狭めると指摘され、170px の「+N」と 2 件のミニカードから変更)。帯をタップすると、レーンの下にトレイが開く。トレイのカードをトラックへドラッグすると、既存と同じ挿入線が出る。離すと既存と同じ並べ替え(`onResourceReorder` / `onResourceMove`)になる。保存の経路は変えていない。

- 落とし先の判定は `planningBoardForwardDrop.ts` の `findForwardDrop` にまとめた。行のドラッグとトレイのドラッグで同じものを使う。特急の帯をまたぐなど、並べ替えできない組み合わせでは挿入線を出さない。右端の列とトレイの上(`data-later-queue`)でも出さない。
- 境界の時刻は、`表示の右端 - 列の幅` で計算する。列の下に隠れた作業も件数に入る。
- 横スクロールの位置は、`PlanningBoardForwardLaterQueue` だけが持つ。scroll を requestAnimationFrame でまとめて計算し、行は再描画しない。`PlanningBoardGanttMemo.test.tsx` で、スクロール中の行の再描画が 0 回であることを固定した。
- タッチでは、トレイのカードは縦に 8px 動いたときだけドラッグを始める。横の動きは、トレイの横スクロールに任せる。

実ブラウザと実機での見た目と操作は、まだ確かめていない。手元に画面を動かす仕組みがないため。反映後に、試験端末で確かめる。

## 2026-11-05 実ブラウザで測り直し、画面外のバーを描かないようにした

#2564 の反映後も、実機でガント表示中の操作が重かった。jsdom の計測(行の再描画数)だけでは見えない、ブラウザ側の時間を測った。

### 計測方法

`apps/web/src/features/kiosk/grindingPlanningBoard/__perf__/browser/` に、本物の Chromium で測る仕組みを置いた。データは `pageInteractions.perf.tsx` と同じ本番規模(1500 件、20 資源)。vite の本番ビルドを Playwright の chromium(headless shell)で開き、CDP で CPU を 4 倍に絞って、操作ごとに `Performance.getMetrics` の Script / Style / Layout と経過時間を取る。手順は同じフォルダの `README.md`。`SCREENSHOT_DIR` を付けると、初回表示、横スクロールの中ほど、右端付近、ドラッグ中の 4 枚を撮る(時刻固定、アニメーションとカーソルなし)。

- `scroll_20` は scrollLeft を直接書き換えるので、Style / Layout / Paint が 0 になる。数値は参考にとどめる。
- `item_selection_*` の経過時間の大半は、長押しで待つ 600ms。

### 原因

既定の倍率(画面に 6 時間分)では、ガントの横幅が約 167 万 px あるのに、見えている幅は約 1900px。それでも全部のバーと工程チップを描いていた。ガント ON の DOM は約 33,000 要素で、バーの配下が約 12,500、工程チップが 12,000。製番の強調、着、研削/切削の切替、now の更新のたびに、この全部の Style と Script が走っていた。

もう一つ、盤面・工程チップ・D 日程の分の再取得で、中身が同じでも派生データが作り直され、ガントのレイアウト計算と工程チップの計算が毎回走っていた。

### 変更

- 前詰め・後ろ詰めの両方のガント行で、横の表示範囲に重なるバー、その工程チップ、遅れの ★、処理出し日の ★ だけを描く(`usePlanningBoardGanttWindow.ts`)。見えている幅を `V`(ラベル幅を除く)、`C = floor(scrollLeft / V)` として、範囲は `[max(0, (C-1)V), (C+3)V]`。左右に最低 1 画面分の余白がある。scroll は requestAnimationFrame でまとめ、範囲が変わったときだけ行を描き直す。幅が測れない(clientWidth 0、jsdom を含む)ときは全部描く。
- ドラッグ中・つかんでいるバーと挿入線は、範囲外でも描く。
- 選択中のバーは範囲外でも描く。納期の ▲ はバーではなく納期の日に出るので、バーが画面外でも ▲ は画面内にあることがある。
- 初期位置・倍率変更・「遅れ」「重なり」で scrollLeft を書き換えたときは、同じ描画の前に範囲を測り直す(初期位置の設定は useLayoutEffect)。scroll イベントを待つと、移動先が 1 フレーム空になるため。
- 工程チップの段の割り付けは、行の高さを保つため全部のバーで計算したまま。
- 重なり・遅れへの移動、製番の強調や工程ステップでのスクロール、工程のつながり線は、DOM のバーを探さず、レイアウトのデータ(`planningBoardGanttGeometry.ts`)と行の位置から計算する。
- 盤面・工程チップ・D 日程の分の再取得は、JSON の中身(順序込み)が前回と同じなら前回の参照を返す(`usePlanningBoardQueryData.ts`)。

### 結果(実ブラウザ、M3、CPU 4 倍絞り、中央値。変更前は main 0a9b75e7)

- ガント ON の DOM: 32,917 → 9,008 要素
- 初回表示: 1417 → 747ms
- ガント ON: 1501 → 545ms
- 製番の強調: 465 / 383 → 96 / 94ms
- 着の切替: 527 / 702 → 206 / 223ms
- 研削・切削の切替: 558〜622 → 207〜271ms
- ドラッグ中に 20 回動かす: Script 518 → 246ms(経過 1310 → 1014ms)
- ドラッグ開始 / ドロップ: 173 / 143 → 94 / 63ms
- 中身が同じ再取得(盤面 / 工程チップ / 分 / 全部): 222 / 232 / 149 / 211 → 51 / 44 / 22 / 55ms
- 30 秒ごとの now の更新: 460 → 102ms
- ガント OFF への切替は 1310 → 1200ms で、ほぼ変わらない(ガント以外の一覧の描画)。
- レビュー指摘の 2 点を直した後に測り直した値も同じ程度だった(DOM 8,978、ガント ON 574ms、製番の強調 95ms、ドラッグ中に 20 回動かす 938ms、30 秒ごとの now の更新 112ms)。

### 見た目の確認

- 画面写真 4 枚(初回表示、中ほど、右端付近、ドラッグ中)は、変更前と変更後でピクセル単位で一致した。
- `renderParity` と `layoutParity` は、変更前の main と変更後で同じ digest を出した。どちらも、ファイルに書かれた期待値とは main の時点で一致していない(#2574 などで描く中身が変わった後に更新されていない)。期待値の更新はこの変更に含めていない。
- 範囲内外の描画、チャンク内のスクロールで行を描き直さないこと、ドラッグ元と挿入線、未描画のバーへの移動、中身が同じ / 違う再取得は、`PlanningBoardGanttWindow.test.tsx`、`PlanningBoardMinutesIdentity.test.tsx`、`PlanningBoardGanttView.test.tsx`、ページのテストで固定した。
- 実機(Pi の Chromium)での見た目と操作は、反映後に試験端末で確かめる。

## Arrival Filter And Forward Gap Filling Follow-up

「着」ONでは未着品のガントバーを描画しない。「次にやる順」は到着品を開始時刻順にし、
未着品を保存順位の枠へ差し込む。未着カードは灰色の文字・色帯と高さ36px以上の「着」ボタンで表示し、
ドラッグ対象から除外する。当日着のカードには開始時刻の下に「取り消し」を表示する。
一覧、遅れ件数、「納期順」「並べ替え」「↶ 戻す」は到着品だけを対象にし、
`mergeVisibleResourceOrder`で隠れた品の保存順位枠を保持する。

`PUT /kiosk/production-schedule/grinding-planning-board/arrival`で当日着を記録し、同じパスの
`DELETE`で取り消す。本文は`itemId`、`itemRevision`、任意の`overrideVersion`。
認証端末のsiteKeyとitemの現在のrevisionを確認し、
`ProductionScheduleGrindingPlanningBoardArrival`へdashboard・site・JST暦日・itemKeyの一意キーで保存する。
応答には当日の記録だけを`manualArrivalDate`として付与し、記録があれば`arrived: true`とする。
スナップショットへは保存しないため、全キオスクで共有され、翌日には前工程などの通常判定へ戻る。
Webは保存成功時に当日着を即時反映し、ボードのクエリを再取得する。元CSV・保存順位は変更しない。

### First-process Arrival State (2026-11-08)

製番ボードだけ、最初の工程は材料・配膳・スマートフォン照合・永続する手動状態で到着を判定する。
部品キーは製番・品番（未割当製番 `********` のみ ProductNo も含む）。
除外資源以外の前工程が完了済みを含めて存在しなければ最初の工程で、工順なしも同様に扱う。
優先順位は、手動「着」→有効な手動「外」→配膳あり、または照合一致あり→材料 `unordered` / `ordered` は未着→その他は到着。
照合は `MobileSlipVerifyRecord` の `outcome = 'match'` を `transferOrderBarcodeRaw` = ProductNo で引き、最新の `verifiedAt` を使う（照合一致は社内で加工する品の意味）。
「外」の記録時刻より後の配膳または照合一致があれば、GETではDBを書き換えず手動状態を `null` として自動判定へ戻す。
同時刻・過去の配膳では「外」を維持する。「着」「外」は日付で失効しない。

`PUT /kiosk/production-schedule/grinding-planning-board/first-process-arrival` は既存のitem識別・revisionに
`state: 'arrived' | 'excluded' | null` を加え、認証端末のsite内で記録・更新・削除する。
`ProductionScheduleGrindingPlanningBoardFirstProcessArrival` はdashboard・site・親itemKeyで一意にし、
既存arrivalと同じロック・revision確認を行う。完了済み・最初でない工程は409。
応答の `isFirstProcess` と実効 `firstProcessState` はスナップショット・itemRevisionへ含めない。
最初の工程のカードは到着有無によらず横並びの「着」「外」を表示し、選択中の再押下で自動へ戻す。
2工程目以降の当日着・取り消し、順位ボードの到着判定、ツールバーの着フィルターは従来どおり。

ローカル検証: process-arrival単体、製番ボードservice単体・route（207件）、
Ganttカード・ページ・arrival hook・API domain/mutation（434件）が成功。
Prisma Client生成、api/web/shared-typesの型検査とlintも成功。DBへのmigration適用は未実施。
DB migrationは `20261108140000_add_planning_board_first_process_arrival`。

前向き配置は未着工程を含む工程依存を保持する。先頭工程の前工程終了が資源cursorより後なら、
後続からcursorで開始できる最も順位の早い工程を先に配置する。前工程なし、または配置済み前工程が
cursorまでに終了した工程だけを候補にし、候補がなければ待ちと点線を残す。
保存順位、前工程未配置・循環時のfallbackは変更しない。

検証: Web関連32 files / 452 tests、API service/route 149 tests、変更ファイルのESLint、
Web型検査、APIの`tsconfig.build.json`による型検査が成功。`layoutParity`は既存5条件の期待値を維持した。
APIの指定`tsc --noEmit -p .`は既存のrootDir/include不整合（TS6059）で未完了。
既存の性能測定値はこの仕様変更前の値である。localhost:5432に応答がなくDBテスト・migration適用は未実施。
実ブラウザ・Pi実機検証も未実施。

### 着ONで未着の空きを詰める(2026-11-06)

着ONでは、前向き配置を到着済み工程だけで行う(資源cursorも前工程関係も到着済みだけで作る)。
未着工程の時間を空白として残さず、届いた工程を前に詰める。未着工程はフロート(`forwardQueue`)に
保存順位の位置で`arrivalPending`・時刻なしとして残り、「着」で到着済みになると次の配置で
その順位の位置に入り、後ろの工程が後ろへずれる。着OFFの配置は変更しない。
検証: Web型検査、製番ボード関連30 files / 435 tests、`layoutParity`(5条件の期待値は不変)。

## 2026-11-06 研削↔切削の切り替えが遅い(サーバーの着判定)

kensaku-stonebase01(版 4b355ada)で、研削と切削を切り替えたときにガントが変わるまでが遅かった。ふだんの操作は #2576 で十分。

### 計測方法

- 手元: `__perf__/browser/run.mjs` に `SWITCH=1`(別の品目の組を 160件→640件ずつ流し込む)と `PROFILE=1`(CPU プロファイル)を足した。CPU 14倍絞りで、描き直しは1回 0.6〜0.9秒、3回に分けて届く切り替えで約1.6秒。
- Pi5: API(blue コンテナ)の3時間分のログから `grindingPlanningBoardPerformance` の内訳を集計した。

### 原因

応答時間の9割以上が `processArrival`(各部品が前の工程から届いているかの判定、`process-arrival.service.ts`)だった。中央値で、最初のページ(約420件・160件返し)が約2秒、続きのページ(640件)が研削3.4秒・切削9.2秒・両方(約1,010件)16〜27秒。

部品を300件ずつ `(BTRIM(FSEIBAN)=… AND BTRIM(FHINCD)=…) OR …` でつないで問い合わせており、`BTRIM` の式に合う索引が無いため、区切りのたびに生産日程の全行を読み、行ごとに300個の OR を評価していた。640件の続きは3回読み直す。

研削→切削は一度「両方」を経るため、一番大きい「両方」の続き(27秒)が、研削を外した後も Pi5 で動き続けていた。

### 変更

部品の一覧を `unnest(text[], text[], text[])` で渡し、`EXISTS` で突き合わせる(Hash Semi Join)。1回の呼び出しで1回だけ読む。勝ち行の選び方(DISTINCT ON、並び順、完了の判定)は変えていない。未割当製番以外は ProductNo に NULL を渡し、ProductNo を条件にしない。DB の構造(索引)は変えていない。

### 結果

- 手元の Postgres(8万行、640件): 3.3秒(3回) → 16ms(1回)、返る行数は同じ(1,920行)。
- 実 DB の統合テスト `process-arrival.service.integration.test.ts`(6件)は、`TEST_DATABASE_URL` を専用 DB に向けたときだけ動く。CI では他の統合テストと同じく飛ばされる。
- Pi5 での確認は、反映後に同じログの `processArrival` の ms を見る。

### 残り

- 索引 `("csvDashboardId", BTRIM(FSEIBAN), BTRIM(FHINCD))` を足せば全行読みも無くなるが、マイグレーションと書き込みロックが要るので、反映後の数字を見て決める。
- 画面側で古いカテゴリの取得を中断しても、Pi5 の処理は止まらないため入れていない。

## 2026-11-06 「納期順」の保存が衝突した後、ボタンが灰色のまま戻らない

### 症状

ガントで「納期順に並べる」を押した後、「納期順に並べる」と「↶ 戻す」が灰色(押せない)のまま戻らず、再読み込みするまで操作できなかった。

### 原因

- 納期順は表示中の全資源の未完了品を保存するため、表示が古い(CSV 取り込みで itemRevision が進んだ等)と API が 409 を返しやすい。409 で画面は `rankConflict` を立て、明示的に最新状態を取り直すまで書き込みを止める(既存方針)。
- 復帰の手段は通知の中の ↻「最新状態を取得」だけだった。通知を ✕「通知を閉じる」で閉じる、または別の通知に置き換わる(成功通知は 2.5 秒で消える)と ↻ も消え、`rankConflict` / `orderConflict` は残るのでボタンが押せないまま固まった。
- 409 以外の保存失敗で書き込みキューの自動再取得も失敗した場合も、`writeQueue.blocked` が残るのに ↻ が出ず、同じく戻せなかった。

### 変更

- `ProductionScheduleGrindingPlanningBoardPage.tsx`: `orderConflict || rankConflict || (writeQueue.blocked && !writeQueue.pending)` の間は、通知が無くても通知欄に既存文言「表示中のデータが更新されています。最新状態を取得してください。」と ↻ を出し続ける(この状態では ✕ は出さない)。↻ は既存の `refreshAfterOrderConflict` を使い、取得に成功すると衝突の印とキューの停止が解ける。取得に失敗しても ↻ は残る。
- 409 後に自動で再送・自動解除しない方針は変えていない。

### 確認

- ページテスト `keeps explicit refresh available after dismissing %s feedback`(409 と、409 以外+自動再取得失敗の 2 件)。修正前のコードでは 2 件とも失敗、修正後は成功。
- 製番ボードのページ・機能・取得フックのテスト 31 ファイル 461 件成功、`tsc --noEmit` と ESLint 成功。

## 2026-11-06 片の操作と保存中切替の再描画削減

1500行／片あり1650行、jsdom、ウォームアップ1回・8試行の中央値。ブラウザのlayout/paintは含まない。
前回修正後の安定計測は、ユーザー提供の `perf8-b.json`（Node v24.3.0、Apple M3）を読み取り専用で参照した。
今回の結果は [pieces-after.json](../../apps/web/src/features/kiosk/grindingPlanningBoard/__perf__/pieces-after.json) に全サンプルを保存する。
全件テスト・lint・型検査などの重い処理と計測を同時実行しない。

### 原因と今回の変更

- 前回まで: `usePlanningBoardWriteQueue.ts` の配列更新が Page の `chipsByPart` を作り直し、各行の全Map購読へ波及していた。data依存callbackもmemoを無効化していた。前回修正で部品別チップ配列、itemId単位の `replaceEqualDeep`、最新版参照の安定handler、閉じた順位メニューの遅延生成を適用した。
- 保存中の順位・表の資源ドラッグの行propを固定し、常設の `display: contents` に `data-planning-board-pieces-writing` を付ける。対象の順位・資源・✓だけを属性セレクタで薄く表示し、refを読む安定captureでclick/change/keydown/pointer開始を拒否する。pointer-eventsは維持し、下のtd/trへのすり抜けを防ぐ。`fieldset disabled` と片の有無による包みの出し入れは廃止した。順位Portalは行のpanel refと表の安定handlerで拒否する。選択は利用可能とし、特別納期の行callbackは書込み中の包み属性を確認して拒否する。
- perf-Bの読み取り専用差分 `perf-b2.patch:3413–3420` と現コードの `writeBlocked` 利用箇所を確認した。止める範囲は個別順位、製番順位/登録変更、部品の資源変更・同資源内並べ替え（表/ガント）、ガント納期移動、納期/特別納期の保存、一括変更、納期順・並べ替え・固定の保存と取消、分ける/まとめるの再保存。✓は今回の受入条件どおり書込み中に拒否する。通常キュー保存中の通常行✓は従来どおり利用可能。
- 選択、製番ペイン開閉、フォーカスの戻る、ガントの拡大縮小・スクロール・工程表示/閉じは止めない。Portalの数量小窓の±、Escape、背景閉じも利用可能とし、保存ボタンだけを既存storeとpendingで抑止する。350msの初期gesture guardと数量上限/下限は維持する。数量小窓に✕ボタンは元々ないため追加せず、既存の工程小窓の「× 閉じる」を回帰確認した。
- 対象親・兄弟だけのpending props、itemId単位の構造共有、最新版参照callbackを維持する。行ごとの `aria-disabled` 更新は全行の再描画になるため追加せず、CSSとhandlerで拒否する（対象親の既存native disabledは維持）。ボード全体に `aria-disabled` は出さない。
- 今回B: `Dialog.tsx:83–91` の body overflow書換えと `98–102` の初期focus候補探索（`38` のoffsetParent参照）が、表示直後にレイアウトへ影響する経路だった。`inert`、背景のaria-hidden、backdrop-filterはこのDialogにない。この画面は既に `index.css:9–10` でhtmlのscrollを固定しているため、小窓側だけ `lockScroll={false}` にし、初期focus先を明示して候補探索を避けた。共有Dialogは変更していない。197msの内訳の寄与率とChromiumでの改善幅は未実測であり、body変更を主因と断定しない。共有側の `focus()`（`Dialog.tsx:101`）とfocus復帰（`107`）は引数なしのまま残る。

### 計測手順

`apps/web` で `PLANNING_BOARD_PAGE_PERF_REPS=8 PLANNING_BOARD_PAGE_PERF_OUTPUT=<json> pnpm exec vitest run --config src/features/kiosk/grindingPlanningBoard/__perf__/vitest.config.ts pageInteractions` を実行する。
`PLANNING_BOARD_PAGE_PERF_REPS` で暖機後の繰り返し回数を変更できる（既定3、安定比較は8）。
実ブラウザの実行方法と `CHROMIUM_EXECUTABLE` の指定は [browser/README.md](../../apps/web/src/features/kiosk/grindingPlanningBoard/__perf__/browser/README.md) を参照する。今回はjsdomのみ計測し、実ブラウザのlayout/paintは未計測。

### 今回の8回計測と検証

2026-11-07のR1〜R5修正後、指定コマンドを単独で1回実行した（8試行、178.15秒）。分ける388.9ms／tr 8回、まとめる310.4ms／tr 9回、✓274.7ms／tr 3回（いずれも中央値）。
片なし29場面の描画回数・commit数は基点と不変。先の別時刻の比較では23場面に時間増加が見えたが、ユーザー確認済みの同時間帯・基点との交互計測では差はほぼ無く、表表示のみ約5%の差だった。先の結果だけで「片なしで時間悪化」とは判断しない。今回の単独計測は交互比較ではなく、その確認済み結果とは区別する。以下に最新の全場面の実測値を記録する。

| 場面 | 経過ms（前 → 後） | commit（前 → 後） | tr（前 → 後） | ガント行（前 → 後） |
| --- | ---: | ---: | ---: | ---: |
| `gantt_off` | 836.5 → 817.6 | 3 → 3 | 1500 → 1500 | 0 → 0 |
| `gantt_on` | 737.5 → 727.0 | 2 → 2 | 0 → 0 | 40 → 40 |
| `left_lane_click` | 0.3 → 0.4 | 0 → 0 | 0 → 0 | 0 → 0 |
| `focus_seiban_on` | 254.3 → 243.9 | 1 → 1 | 0 → 0 | 20 → 20 |
| `focus_seiban_off` | 321.0 → 312.2 | 1 → 1 | 0 → 0 | 20 → 20 |
| `item_selection_on` | 56.9 → 64.2 | 1 → 1 | 0 → 0 | 1 → 1 |
| `item_selection_off` | 56.6 → 73.2 | 1 → 1 | 0 → 0 | 1 → 1 |
| `arrival_on` | 263.4 → 302.6 | 2 → 2 | 0 → 0 | 20 → 20 |
| `arrival_off` | 371.4 → 372.5 | 2 → 2 | 0 → 0 | 20 → 20 |
| `drag_start` | 132.0 → 125.3 | 1 → 1 | 0 → 0 | 1 → 1 |
| `drag_hover_20` | 2543.7 → 2401.0 | 35 → 35 | 0 → 0 | 18 → 18 |
| `drag_drop` | 36.1 → 36.8 | 1 → 1 | 0 → 0 | 1 → 1 |
| `scroll_20` | 110.1 → 98.4 | 20 → 20 | 0 → 0 | 0 → 0 |
| `cutting_on` | 437.7 → 405.6 | 3 → 3 | 0 → 0 | 20 → 20 |
| `grinding_off` | 349.2 → 367.0 | 3 → 3 | 0 → 0 | 20 → 20 |
| `grinding_on` | 312.7 → 292.1 | 3 → 3 | 0 → 0 | 20 → 20 |
| `cutting_off` | 383.4 → 295.3 | 3 → 3 | 0 → 0 | 20 → 20 |
| `refetch_board` | 14.9 → 14.7 | 1 → 1 | 0 → 0 | 0 → 0 |
| `refetch_chips` | 10.6 → 11.1 | 1 → 1 | 0 → 0 | 0 → 0 |
| `refetch_minutes` | 0.3 → 0.3 | 1 → 1 | 0 → 0 | 0 → 0 |
| `refetch_uptime` | 6.8 → 6.5 | 1 → 1 | 0 → 0 | 0 → 0 |
| `refetch_all` | 15.9 → 15.5 | 1 → 1 | 0 → 0 | 0 → 0 |
| `now_tick_30s` | 343.8 → 350.2 | 2 → 2 | 0 → 0 | 20 → 20 |
| `scaw_on` | 208.0 → 202.6 | 1 → 1 | 0 → 0 | 0 → 0 |
| `scaw_off` | 289.2 → 211.2 | 1 → 1 | 0 → 0 | 0 → 0 |
| `plain_gantt_queue_pending_true_to_false` | 59.3 → 61.5 | 4 → 4 | 0 → 0 | 0 → 0 |
| `plain_gantt_refetch_same` | 14.8 → 7.3 | 1 → 1 | 0 → 0 | 0 → 0 |
| `plain_table_queue_pending_true_to_false` | 82.9 → 83.3 | 4 → 4 | 0 → 0 | 0 → 0 |
| `plain_table_refetch_same` | 10.8 → 14.8 | 1 → 1 | 0 → 0 | 0 → 0 |
| `pieces_gantt_queue_pending_true_to_false` | 102.1 → 87.1 | 4 → 4 | 0 → 0 | 0 → 0 |
| `pieces_gantt_refetch_same` | 16.8 → 15.1 | 1 → 1 | 0 → 0 | 0 → 0 |
| `pieces_table_queue_pending_true_to_false` | 140.1 → 110.5 | 4 → 4 | 250 → 250 | 0 → 0 |
| `pieces_table_refetch_same` | 7.8 → 6.8 | 1 → 1 | 0 → 0 | 0 → 0 |
| `pieces_table_popup_open` | 1.6 → 1.0 | 1 → 1 | 0 → 0 | 0 → 0 |
| `pieces_table_refetch_same_popup_open` | 9.8 → 7.0 | 1 → 1 | 0 → 0 | 0 → 0 |
| `pieces_table_popup_plus` | 1.0 → 0.7 | 1 → 1 | 0 → 0 | 0 → 0 |
| `pieces_table_popup_minus` | 0.6 → 0.5 | 1 → 1 | 0 → 0 | 0 → 0 |
| `pieces_table_popup_close` | 0.7 → 0.6 | 1 → 1 | 0 → 0 | 0 → 0 |
| `pieces_table_split_success` | 1031.3 → 388.9 | 6 → 6 | 3304 → 8 | 0 → 0 |
| `pieces_table_merge_success` | 1013.3 → 310.4 | 6 → 6 | 3305 → 9 | 0 → 0 |
| `pieces_table_piece_complete` | 781.9 → 274.7 | 6 → 6 | 3299 → 3 | 0 → 0 |

- テスト7件追加: 保存中の選択・製番ペイン開閉・フォーカスから戻る・順位selectの拒否、小窓±/Escape/背景閉じ、作成OFFで最後の片をまとめる時の表/ガントのDOM同一性、ガントの長押し選択・左右送り・幅変更・工程小窓の「× 閉じる」とドラッグ保存拒否、自身の保存中の数量変更/閉じと二重送信拒否。
- 既存の分割・結合・完了中のクリック/Enter/Space/ドラッグ開始/既存順位Portalの拒否、開始/終了時の無関係行の非再描画、最新callback/版の参照、小窓focus復帰のテストを維持。全画面disabledに依存した期待だけを、対象handlerの拒否と選択の利用可能性へ修正した。
- 最新検証（2026-11-07）: web/API lint・型検査、web全件698ファイル／6347件（198.26秒）、API投影・負荷単体35件（0.997秒）、指定DB負荷統合20件（skipなし、0.899秒）、SOP source-check、`git diff --check`成功。共有DialogとUI文言は変更していない。commit / push / PR / merge / deployは未実施。

### 2026-11-07 第三者レビュー R1〜R5

- R1: 書込み部品の `pointer-events-none` を撤去し、行の特別納期クリックも包みの最新属性で拒否する。見た目は維持し、td/trを発生元にしたすり抜けの回帰テストを追加した。
- R2: 完了取消トーストは `piecesWriting` 中もdisabled。保存と再取得の両方で拒否し、終了後は利用できる。別の親の分割後もトーストが残る既存テストは維持した。
- R3: readyはblockingStoreへ移し、Contextの値から除去。操作可能な数量ボタンだけreadyを、開いたDialogだけblockingを購読する。数量JSXも関連値でmemo化し、片0件・作成OFFでready／orderPreview／blockedが変わっても数量部品を描き直さない。計数は描画前のmock wrapperでContextによる自己再描画も捕捉し、実際の書込み包み・表・ガントのDOM同一性を検証した。
- R4: 分割・結合後、影響する親と片の選択を全カテゴリから除去する。別カテゴリの無関係な選択を保つテストを追加した。
- R5: 親の所要分0から作る片はnull／unknownへ統一した。親nullと片なし行の従来処理は維持し、投影・TS列挙・SQL集計の一致を指定DBで検証した。

検証コマンド: `pnpm --filter web lint` / `pnpm --filter api lint`、web `pnpm exec tsc -p tsconfig.json --noEmit`、API `pnpm exec tsc -p tsconfig.build.json --noEmit`、web `pnpm exec vitest run --maxWorkers=4`。
APIは `pnpm exec vitest run src/services/production-schedule/__tests__/grinding-planning-board-projection.test.ts src/services/production-schedule/__tests__/grinding-planning-board-load-summary.test.ts`、DB統合は両URLを `postgresql://postgres:postgres@127.0.0.1:55432/sessaku_test` に指定して `pnpm exec vitest run src/services/production-schedule/__tests__/grinding-planning-board-load-summary.integration.test.ts` を実行した。lifecycle auditは基点 `cab3d0e9` の指定branch/worktreeを `DIRTY_PROTECTED` と確認。開始時の未コミット・未追跡WIPを保持し、変更はR1〜R5の関連コード・テスト・計測JSON・本KBと計画書だけに限定した。

## 2026-11-08 到着判定と工程チップの部品検索用索引

- 本番 Pi5 のログ(変更前): processArrival 0.45〜1.36秒/回、process-chips 0.45〜1.3秒/回、切り替え1回で合計約3〜4秒。
- `CsvDashboardRow` に dashboard ID・空白を除いた FSEIBAN・FHINCD の複合式索引を追加した（`20261108130000_add_planning_board_part_lookup_index`）。既存の leaderboard 用式索引と同様、migration SQL だけで管理し、`schema.prisma` は変更しない。
- 到着判定は一意な部品キーから JOIN する形へ変更した。工程チップはキーが空でない条件と `BTRIM` の等値比較に変更した。勝ち行、並び順、完了判定、ProductNo の条件は維持する。NULL・空文字・空白だけの値は従来どおり結合しない。
- [Prisma v7 の機能表](https://www.prisma.io/docs/orm/v7/reference/database-features)では式索引は未対応で、[migrate diff](https://www.prisma.io/docs/cli/v7/migrate/diff)は未対応機能の差分を出さない。実DBでの削除提案の有無は未確認（ローカル接続が P1001）。
- ローカル計測(Mac・PostgreSQL 14、12万行・部品キー160件の最小テーブル): 従来の到着判定は索引なしで 45.6ms(全件走査)、索引を足しても従来の書き方では索引を使わず 73ms。新しい書き方と索引で 3.9ms(索引を使う入れ子ループ)、結果は同じ 432 行。工程チップの結合も索引を使い 1.3ms。migration 全体の適用と統合テストは、ローカル DB に pgvector が無く未実施(CI で実行する)。
- 変更後の値: 反映後に同じログで測る。

## 2026-11-08 負荷集計の override 件数による遅延

- 本番 Pi5 の API 起動直後、`loadSummaryCompute` が70〜84秒。ローカル PostgreSQL 18、約13.7万行・override 1,847件では、`ROW_NUMBER() = 1` が重複除去後の件数を450行（実際34,640行）と過小推定し、row override との Nested Loop Left Join で比較が増えていた。
- `grinding-planning-board-load-summary.ts` の重複除去だけを `DISTINCT ON` へ変更した。同じ分割キーの式（NULL/空文字、`********` の場合だけ ProductNo を含む）と sourceRowId 順の先頭行を維持する。override の照合・piece 優先順位、分の加算順、JS フォールバック、キャッシュ・ウォームアップは変更しない。セッションの結合設定も変更しない。
- `src/__bench_tmp__/bench.ts time` の結果（grinding / cutting / all）: 修正前 5,814 / 6,276 / 5,574ms、修正後 298 / 277 / 284ms。ハッシュは修正前後で `7861768ac727b10b` / `679309d3397cffed` / `d7fbdfd1f3f23a8f` と一致した。unknown 件数も459 / 2,547 / 3,006で一致。
- 同スクリプトの `explain`: 重複除去の推定90,000行、実際34,640行。row override は Hash Left Join、実行234.455ms。Nested Loop と Rows Removed by Join Filter は出ていない。計測前に ANALYZE は実行せず、元 DB への書込みも行っていない。
- 検証用 DB は元 DB のスキーマだけを複製した `grinding_load_sql_test_20261108`。負荷集計の統合20件・ユニット16件が成功。対象 ESLint と `git diff --check` も成功。指定 typecheck は既存 tsconfig の `rootDir: src` と src 外の include による TS6059 で失敗（設定は変更しない）。
- 指定のボード・片の統合テストは、既存 workspace 依存のビルドと migration の raw revision 初期行を専用 DB に準備して実行し、177件中176件成功（40.31秒）。残る1件は `keeps an override on a same-logical-key winner and ignores legacy record changes` の snapshotId 一致チェック（1114行）。変更前の load-summary モジュールを `git show HEAD:...` から一時 Vite transform で読み込んだ単独テストでも同じ失敗を確認した（1.24秒）。今回の集計変更では修正しない。
