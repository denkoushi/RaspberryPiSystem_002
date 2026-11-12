# 製番ボード Chromium 計測

リポジトリのルートで実行（既存の Node/pnpm 依存と Playwright bundled Chromium が必要）:

```sh
CPU_RATE=4 PERF_OUTPUT=/tmp/planning-board-browser-perf.json node apps/web/src/features/kiosk/grindingPlanningBoard/__perf__/browser/run.mjs
```

`CHROMIUM_EXECUTABLE` には `~/Library/Caches/ms-playwright/chromium_headless_shell-*/` 配下の既存の `chrome-headless-shell` を指定できる。
シェルで展開した絶対パスを渡す。インストール済み Google Chrome は使わない。
`TRACE=0` で Paint/Composite 採取を無効化、`SCREENSHOT_DIR=/tmp/board-shots` で初期・中間・右端とドラッグ中の画像を保存できる。
標準出力は中央値の表と DOM/CSS 内訳、標準エラーは進捗、JSON は全サンプルと各指標の中央値を保持する。

専用 Vite エントリーで本物のページと CSS を一時ディレクトリへ本番ビルドし、既存 fixture の hooks データを注入する。
生成物は Playwright route で返すため待受サーバーは不要。`.env` と既存 Vite 設定は読み込まず、外部通信と `/api/` は遮断する。
1920×1080、CPU 4倍、1回暖機＋3回測定。初回表示は navigation から、通常操作は入力直前から二重 rAF まで。
Playwright/CDP の通信時間を含み、実ディスプレイへの提示時刻ではない。通常ガントの選択は550msの長押しを含む。
工程切替は「工程」ドロップダウンを計測外で開き、選択肢を押すところから同じカテゴリ遷移を測る。

2台シナリオは既存の1,500件・80製番・20資源を使い、切削の310・311を選ぶ。
追加シナリオの準備時だけ、この2資源の `unitSplitEnabledByResource` を有効にする（fixtureの件数・値は変更しない）。
「1台」の資源選択で310を選び、ヘッダーの「2台」で311を下段に表示する。

- `two_initial`: 1台から2台への切替入力〜二重 rAF。
- `two_select_on/off`: 上段の棒をクリックして選択／解除。
- `two_legend_on/off`: 共通凡例の製番を押して強調／解除。
- `two_drag_move20`: 上段の棒をつかんだ後、20回移動。毎回二重 rAF。
- `two_drag_drop`: ボード外 `(1,1)` で離し、ghost消去と書込み呼出しゼロを検証。
- `two_scroll20`: 上段ペインを縦に20回スクロール。毎回二重 rAF。
- `toggle_one_two`: 1台→2台→1台。切替の間も二重 rAF。

既存の表示・選択・着フィルタ・ドラッグ・スクロール・工程切替・refetch・30秒時計更新と、最後の片分割／完了も同じ4周で測る。
`SWITCH=1` は追加の段階配信切替、`PROFILE=1` は非minifyビルドと切替CPU profile採取用。
refetchは同じpayloadのclone通知で、HTTP／query-cache／サーバー処理を含まない。
Paint/Compositeはtraceのcompleteイベントの合計（スレッド間重複あり）。イベント数ゼロは描画コストゼロを意味しない。
DOMはガント内のtestid別件数と子孫数、CSSはcomputed style件数を集計する。largeTransformは画面面積の1/4以上の変形要素。

起動失敗時も `status: incomplete` と失敗した `stage` の診断JSONを保存し、非ゼロ終了する。
この作業環境ではChromium起動が `MachPortRendezvousServer: Permission denied (1100)` で拒否されるため、実測は実行可能な端末で行う。
