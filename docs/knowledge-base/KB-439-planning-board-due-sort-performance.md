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
