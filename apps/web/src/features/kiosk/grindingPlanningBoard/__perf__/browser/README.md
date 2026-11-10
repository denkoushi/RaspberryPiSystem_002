# 製番ボード Chromium 計測

リポジトリのルートで実行（既存の Node/pnpm 依存と Playwright bundled Chromium が必要）:

```sh
CPU_RATE=4 PERF_OUTPUT=/tmp/planning-board-browser-perf.json node apps/web/src/features/kiosk/grindingPlanningBoard/__perf__/browser/run.mjs
```

必要なら `CHROMIUM_EXECUTABLE=/絶対パス/ms-playwright/chromium_headless_shell-*/.../chrome-headless-shell` で既存の bundled browser を指定する。
`TRACE=0` で Paint/Composite の採取を無効化できる。標準出力は中央値の表と DOM/CSS 内訳、標準エラーは進捗。

専用 Vite エントリーを一時ディレクトリへ本番ビルドし、本物のページと CSS に既存 jsdom 計測相当の hooks データを注入する。
生成済みファイルは Playwright route から localhost URL に返すため、待受サーバーは不要。`.env` と既存 Vite 設定は読み込まない。外部通信と `/api/` は遮断する。
1920×1080、CPU 4倍、1回暖機＋3回測定。JSON は全サンプル、各指標の中央値、TaskDuration、CompositeLayers イベント数も保持する。
初回表示は navigation から、通常操作は入力直前から二重 rAF まで。Playwright の通信時間を含み、実ディスプレイへの提示時刻ではない。
長押しは意図的な550ms待機を含む。20回の移動／スクロールは毎回二重 rAF を待つ。
ドラッグ終了はボード外への無効ドロップで、書込み呼出しゼロを検証する。時計は Playwright clock の fastForward で30秒進め、現在線の変化を検証する。
refetch は同一データを clone して hooks の購読者へ通知する方式で、HTTP／React Query キャッシュ／サーバー処理の計測ではない。
Paint/Composite は trace の complete イベントの合計（スレッド間の重複あり）。イベント数ゼロは処理コストゼロを保証しない。
DOM はガント配下の testid を item／lane ごとに正規化した直接件数と、最近傍 testid に所属する子孫件数の上位を出す。
CSS 件数はガント配下の computed style を集計。largeTransform は変形要素の border box 面積が画面の1/4以上という基準で、描画負荷そのものではない。

Chromium の起動権限がない環境では測定できない。失敗時は `status: incomplete` の診断 JSON を保存し、非ゼロで終了する。
この作業環境では bundled headless shell の起動が `MachPortRendezvousServer: Permission denied (1100)` で拒否されたため、実測の表と DOM/CSS 件数は未取得。
