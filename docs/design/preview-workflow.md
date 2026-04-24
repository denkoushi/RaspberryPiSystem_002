# HTMLとSVGの整合プレビュー運用

目的: 事前打ち合わせ(HTMLなど)と、実機表示(サーバ側SVG->JPEG + Pi3表示)が一致するように、差異要因を事前に可視化し、設計の合意と実装が乖離しない運用を作る。

対象(第一段階):
- 可視化レンダラー: `apps/api/src/services/visualization/renderers/*`
- サイネージ合成: `apps/api/src/services/signage/signage.renderer.ts` の FULL/SPLIT のうち、SPLITペイン内レンダリングの縮尺と配置

## 前提: 実機表示経路はSVG直表示ではない

Pi3(軽量サイネージ)はSVGを直接描画しない。

- Pi5(APIコンテナ)がサイネージ画像を生成: SVG -> JPEG
- Pi3は `GET /api/signage/current-image` を取得し、`feh` で全画面表示する

関連:
- `apps/api/src/services/signage/signage.renderer.ts`
- `infrastructure/ansible/templates/signage-update.sh.j2`
- `infrastructure/ansible/templates/signage-display.sh.j2`

このため、HTML(ブラウザ描画)と見え方がズレる要因が複数ある。ズレを「仕様として許容する」のか「契約として固定する」のかを明確にする必要がある。

## ズレが生じる主な要因(チェックリスト)

1) 表現単位の不一致(セル塗り vs チップ/バッジ)
- HTMLでは `span` に `border-radius + padding` を付けて「チップ」として表現していたが、SVG実装がセル全面の `rect fill` だと丸角にならない。
- 対策: SVG側もチップをプリミティブ化し、表現単位を揃える。

実装:
- `apps/api/src/services/visualization/renderers/_design-system/svg-primitives.ts`
- `apps/api/src/services/visualization/renderers/uninspected-machines/uninspected-machines-renderer.ts`

2) 解像度/スケールの不一致(FULL vs SPLITペイン幅)
- MD3トークンの `scale = width / 1920` は「幅」に依存する。
- サイネージSPLITでは、ペイン内レンダリングは「ペイン幅」で行われるため、FULL想定のHTMLより文字が小さく見えやすい。

対策:
- SPLIT幾何計算を純関数化し、プレビュー生成と実運用で同一ロジックを使う。
- FULLとSPLITを両方プレビューし、合意する。

実装:
- `apps/api/src/services/signage/signage-layout-math.ts`

3) フォント契約の不在(HTMLフォント vs サーバのsans-serif)
- HTMLは `Roboto` / `Noto Sans JP` を使って見えるが、SVG->JPEGはサーバ上のフォント環境に依存しやすい。
- `font-family="sans-serif"` はフォールバックが環境依存で、字幅や太さが変わる。

対策(第一段階は可視化のみ):
- 「フォント差は残る」ことを前提に、トークンとレイアウトの整合を優先してプレビューする。

次段階(必要になったら):
- Pi5側にフォントをインストールして固定する、またはレンダリング側でフォントを指定する(ただし運用/配布の管理が必要)。

4) SVG->JPEGラスタライズの差
- `sharp` のラスタライズ密度やリサイズ方法で、太さ/にじみ/見え方が変わることがある。
- 実機経路(サーバ側変換)でプレビューを出しておくことで、打ち合わせ段階で差を検出できる。

## 整合プレビューの使い方

コマンド:
- `pnpm --filter @raspi-system/api design:preview`（または `cd apps/api && pnpm design:preview`）

**重要**: 出力先 `tmp/design-preview` は **`.gitignore` 対象**のため、リポジトリ clone / pull 直後は **ファイルが存在しない**。コードを更新したあとも、**毎回このコマンドで再生成**する。古い `index.html` を開いたままだと表示が古い場合があるため、**再実行後にブラウザを再読み込み**する（`index.html` には生成時刻と `cacheBust` が出る）。

出力（**計測機器持出状況**向けの最小セット）:
- `tmp/design-preview/index.html` — HTML モックと SVG→JPEG（FULL / pane）の対照
- `tmp/design-preview/measuring-loan-inspection-html-preview.html` — 実装前の **帯＋帯下の余白** などを CSS（`--mi-header-body-gap` 等）で合意する用
- `tmp/design-preview/measuring-loan-inspection-band-samples.html` — **帯色**（**R1〜R5** 視認性バランス・**T1〜T4** 地に馴染む薄色味・空 **E1〜E3**）を同一中身で並べ、採用 ID を選ぶ用
- `tmp/design-preview/measuring-loan-inspection-full.jpg` — 現行 `MeasuringInstrumentLoanInspectionRenderer`（1920×1080）
- `tmp/design-preview/measuring-loan-inspection-pane.jpg` — 同レンダラーを SPLIT ペイン相当サイズで
- `tmp/design-preview/summary.json`

開き方:
- ブラウザで `tmp/design-preview/index.html` を開く

プレビューの意味:
- **HTML モック**: 同 MD3 トークン（CSS 変数）でカード帯と本文の区切りをいじる。SVG 実装のたたき台。帯下の空き（`--mi-header-body-gap`）と `MI_NAMES_START_YPX` は [`mi-instrument-card-metrics.ts`](../../apps/api/src/services/visualization/renderers/measuring-instrument-loan-inspection/mi-instrument-card-metrics.ts) を単一参照。
- **帯色サンプル**: R / T / E の各 ID でレシピを比較。本番の貸出あり帯は **T4**（`mi-instrument-card-palette.ts` の `warning` 22% + `infoContainer`）で、フルグリッド HTML モックの帯も同じ `color-mix` に揃える。
- **SVG→JPEG**: 現行レンダラー出力。HTML 合意内容を `measuring-instrument-loan-inspection-renderer.ts` へ写す際の差分確認用

## 運用ルール(おすすめ)

- 事前打ち合わせで「丸角」「チップ」「フォントサイズ」などを決めたら、必ず `design:preview` を更新してプレビューで一致を確認する。
- 「FULLで良い」ではなく、実機がSPLITなら必ず `viz-pane` を合意対象に含める。
- 表現単位(チップ/バッジ/セル塗り)は、HTMLとSVGの両方で同じプリミティブに寄せる。

## 実装の入口(コード)

- MD3 tokens: `apps/api/src/services/visualization/renderers/_design-system/md3.ts`
- MD3->CSS vars: `apps/api/src/services/visualization/renderers/_design-system/md3-css.ts`
- SVG primitives(chip): `apps/api/src/services/visualization/renderers/_design-system/svg-primitives.ts`
- SPLIT geometry: `apps/api/src/services/signage/signage-layout-math.ts`
- Preview generator: `apps/api/scripts/design-preview.ts`

