# 業務モデルが見本データを使って丸数字案を出す（reference placement）

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds. It follows `.agent/PLANS.md`.


## Purpose / Big Picture

検査図面の作成画面（キオスクの検査図面作成、`apps/web/src/features/part-measurement/inspection-drawing/`）には、まだ丸数字の付いていない図面に「AI案」を出す機能がある。現在の AI案は「兄弟図面」（似た図面）で人が付けた丸数字を、同じ数値の寸法へ写す方式（transfer、`part-measurement-drawing-placement-transfer.ts`）で作っている。2026-10-26 の読み取り専用検証では、この方式は人の丸数字の約13%しか当てられなかった。原因は「同じ数値の寸法を写す」こと自体で、似た図面でも寸法の数値は違う。

この変更の後は、DGX の業務モデル（GLM、テキスト生成）が「見本データ」を読んで、対象図面の寸法一覧（寸法マップ）から丸数字を付ける寸法を選び、項目名を付ける。見本データは二つでできている。一つは人が付けた30図面から作った「項目名の付け方」と「選び方」の決まり（`apps/api/src/services/part-measurement/part-measurement-drawing-reference-guide.ts`）、もう一つは実行時にデータベースから取る、人が丸数字を付けた別の図面の実例（few-shot）。上下限は JIS 普通公差などの決まりでプログラムが計算する。

Opus による同じ方式の試行（6図面、人の丸数字87個）では、数値と項目名の両方が一致したものが31個（transfer は8個）だった。半分は項目名の言い方違い（ピッチ と ネジ穴ピッチ など）で外れていたため、項目名の付け方を見本に入れる。

動作の確かめ方: フラグ `INSPECTION_DRAWING_REFERENCE_PLACEMENT_ENABLED=true` の環境で夜間処理（またはスクリプト）が reference run を作ると、作成画面の AI案に業務モデルの案が出る。評価は `apps/api/src/scripts/evaluate-drawing-placement-loo.ts --method reference` で、人の丸数字に対する一致数を transfer と比べる。


## Progress

- [x] (2026-10-26) 本番の30図面を読み取り専用で集計し、項目名の付け方・上下限の決まりを確認した。
- [x] (2026-10-26) 見本の決まりを `part-measurement-drawing-reference-guide.ts` に書いた。
- [x] (2026-10-26) Milestone 1: プロンプト組み立て、応答検証、決定的な項目名・上下限、ガイド関数のテスト。
- [x] (2026-10-26) Milestone 2: reference run の保存、フラグによる優先表示、夜間処理、推論延期時の未保存、デプロイ設定の配線。
- [x] (2026-10-26) Milestone 3 の実装: LOO の `--method reference`、同機種除外、数値のみの一致数、延期時の3回リトライと読み取り専用テスト。
- [x] (2026-10-26) Milestone 3 の実測: 本番データ（読み取り専用）で reference を同機種除外あり・なしで測った（結果は Artifacts and Notes）。
- [x] (2026-10-26) 検証: `vitest run src/services/part-measurement src/scripts src/config` 81ファイル508件成功、`tsc --noEmit -p tsconfig.build.json` 成功、変更ファイルの ESLint 成功、deploy テスト92件成功。
- [x] (2026-10-26) 第三者レビューの指摘2件を修正（下記 Decision Log）。
- [x] (2026-10-26) PR #2309 をマージし Pi5 へ反映した（main 1386db85、run 20261026-035224-6ee96c、フラグ false を確認）。
- [ ] 本番 inventory でフラグを有効にし、夜間処理で reference run ができることを確かめる。


## Surprises & Discoveries

- Observation: 公差の書かれていない長さ寸法の上下限は、JIS B 0405 中級（6以下 ±0.1、30以下 ±0.2、120以下 ±0.3、400以下 ±0.5、1000以下 ±0.8）で人の入力と一致する。
  Evidence: 公差なし寸法の人の項目 359 個のうち 246 個が一致。外れの多くはネジ深さ（上下限が同じ値）と、注記で ±0.1 にしたピッチ。
- Observation: ネジ穴深さの上下限は「深さ〜深さ」が 75 個、「深さ〜深さ+3」が 39 個。
- Observation: 人の上下限には入力誤り（27±0.1 → 27.1〜27.1 など）がある。見本の上下限は使わず、プログラムで計算する。
- Observation: 幾何公差の項目名は記号で決まる（// 平行度、⊥ 直角度、□ 平面度、— 真直度、⌖ 位置度）。記号のある91個中76個が一致し、外れは同じ値の別の幾何公差との取り違えだった。
- Observation: 穴の間隔の項目名（ネジ穴ピッチ／キリ穴ピッチ／ザグリ穴ピッチ／穴ピッチ／ピッチ）は、寸法のそばにある穴の呼び（「M6深12」「φ11キリ」）でおおむね決まる。そばの呼びをプロンプトに添える。


## Decision Log

- Decision: `findRun` は OCR の新しい `getCurrentFingerprint` で現在画像の指紋だけを読み取る。
  Rationale: 既存の `getCurrentStatus` は `enqueueVisualTemplate` を呼び、OCRキューを書き換えるため、読み取り専用の要件を満たさない。
  Date/Author: 2026-10-26 / Codex
- Decision: 見本が120寸法を超えて選択されている場合は、最初の120個の異なる寸法と、その寸法を参照する回答だけを表示する。
  Rationale: 120行の上限を守り、プロンプトから省略した寸法番号を回答に残さない。通常の見本では選択寸法をすべて残し、非選択寸法を最大25行添える。
  Date/Author: 2026-10-26 / Codex
- Decision: 業務モデルに任せるのは「どの寸法を選ぶか」「数値を寸法値と深さのどちらから取るか」「項目名」だけにし、上下限・幾何公差の項目名・ネジ穴深さの項目名はプログラムで決める。
  Rationale: 決まりで決まるものをモデルに任せると誤りが増える。プロンプトも短くなる。
  Date/Author: 2026-10-26 / Claude
- Decision: 推論は `business_hermes` の use case、`background: true`、`jsonOutput: true`、`enableThinking: false`、`temperature: 0` で呼ぶ（`apps/api/src/services/knowledge/procedure-inference.ts` と同じ形）。
  Rationale: 新しい use case を足すと推論ルーターの配線が要る。既存の背景ジョブと同じ経路なら DGX の受け入れ制御（InferenceDeferredError）にも乗る。
  Date/Author: 2026-10-26 / Claude
- Decision: reference run は既存の placement run テーブルに `placementVersion = reference-v1:<工程>`、`rankingMethod = 'reference'`、`sourceVisualTemplateId = null`、`sourceTemplateId = null` で保存する。スキーマ変更はしない。
  Rationale: 一意キーに placementVersion が入っているので transfer と並べて持てる。承認・却下の記録（recordDecisions）もそのまま使える。
  Date/Author: 2026-10-26 / Claude
- Decision: 作成画面（listForEditor）は業務モデルを呼ばない。フラグが有効で reference run があればそれを返し、無ければ今の transfer を返す。reference run は夜間処理で作る。
  Rationale: 業務モデルの応答には1分以上かかることがあり、画面の HTTP 要求の中で待てない。
  Date/Author: 2026-10-26 / Claude
- Decision: 見本の実例は対象図面と同じ工程の、人が丸数字を付けた別図面から最大2枚選ぶ。評価では対象図面を除くだけでなく、対象と同じ機種（図面名の先頭の数字、例 3351 と 7161）を除く設定も測る。
  Rationale: 3機種目は人の丸数字がまだ無い。同じ機種の見本が使えない条件の成績が、本番で期待できる成績になる。
  Date/Author: 2026-10-26 / Claude
- Decision: 応答が使えない（JSONとして読めない）ときは、案0個の reference run を保存する。作成画面は PROPOSED の案が1つも無い reference run を無視して transfer を返す。
  Rationale: 保存しないと夜間処理（古い順に3組）が同じ図面を毎晩選び続け、他の図面へ進まない。空の run を優先表示すると transfer 案まで隠れる。延期（InferenceDeferredError）だけは保存せず次回に回す。
  Date/Author: 2026-10-26 / Claude
- Decision: 評価スクリプトに `--interactive` を足し、昼間でも通常枠で採点できるようにする。
  Rationale: 昼間は DGX の背景枠（dgx-background-preparation）が延期を返す。夜間処理は背景枠のまま。
  Date/Author: 2026-10-26 / Claude
- Decision: 本番 inventory で `inspection_drawing_reference_placement_enabled: true` にする（利用者承認済み）。
  Rationale: 30図面の採点で一致32%（同機種除外28%）と、今の方式の約13%を上回った。夜間に背景枠で1回最大3組だけ作り、作成画面は業務モデルを呼ばない。
  Date/Author: 2026-10-26 / 利用者・Claude


## Outcomes & Retrospective

業務モデルが見本（項目名の付け方のガイドと、人が丸数字を付けた別図面）を使って丸数字案を出す仕組みを、既定オフのフラグ `INSPECTION_DRAWING_REFERENCE_PLACEMENT_ENABLED` の裏に入れた。本番の30図面での一致は transfer の約2倍（Artifacts and Notes）。案の数が多く適合率は約2割なので、作成画面で人が選ぶ前提の「案」として使う。フラグを有効にするまで動作は変わらない。

残り: フラグを有効にして夜間処理で reference run を作り、3機種目の図面で作成画面の案を確かめる。案の数を絞る（選ぶ割合の指示、見本の枚数）のは次の改善候補。

## Context and Orientation

寸法マップ（dimension map）は、DGX の画像モデルが図面画像から読み取った寸法の一覧で、`apps/api/src/services/part-measurement/part-measurement-drawing-dimension-map-payload.ts` の `PartMeasurementDrawingDimensionMapPayload` 型で保存される。各寸法は `text`（図面の表記、例「φ10.1+0.1/0深15」）、`nominal`、`upperTolerance`、`lowerTolerance`、`kind`（len, ref, basic, angle, radius, hole, thread, gdt, other）、`depth`、`xRatio`/`yRatio`（図面全体に対する文字中心の位置、0〜1）を持つ。完了済みのマップは `getPartMeasurementDrawingDimensionMapService().getCompletedPayload(visualTemplateId, fingerprint)` で取れる。

丸数字の案（placement）は `apps/api/src/services/part-measurement/part-measurement-drawing-placement.service.ts` の `PartMeasurementDrawingPlacementService` が扱う。`ensureRun` が transfer 方式の run（`PartMeasurementDrawingPlacementRun`）と案（`PartMeasurementDrawingPlacementProposal`）を1トランザクションで作る。run の一意キーは (visualTemplateId, drawingImageFingerprint, analysisVersion, placementVersion)。案の `sourceItemId` は run 内で一意な文字列で、外部キーではない。`listForEditor` が作成画面向けの結果（`PartMeasurementDrawingPlacementEditorResult`）を返し、`backfill` が夜間処理（`part-measurement-drawing-dimension-map.scheduler.ts` から呼ばれる）で兄弟判定と run 作成を進める。

業務モデルの呼び出しは `getInferenceRuntime().createTextCompletionPort()` の `complete({ useCase, messages, maxTokens, temperature, enableThinking, jsonOutput, background, signal })` で、`{ rawText, model }` を返す。DGX が混んでいて背景ジョブを受け付けないときは `InferenceDeferredError` を投げる。

人が付けた丸数字は、有効な `PartMeasurementTemplate`（工程 `processGroup` が CUTTING か GRINDING）の `items` のうち `markerXRatio`/`markerYRatio` があるもの。項目名の候補は `InspectionDrawingMeasurementLabelSettingsService.listSettings()`（管理画面の測定点名称設定）と、見本の語彙 `DRAWING_REFERENCE_LABEL_VOCABULARY`。

評価は `apps/api/src/scripts/evaluate-drawing-placement-loo.ts`（読み取り専用の leave-one-out、1図面ずつ人の丸数字を隠して当てる）と、指標の `apps/api/src/scripts/drawing-placement-loo-metrics.ts` の `comparePlacementMarkers`（数値一致かつ項目名一致を「一致」、位置が許容内なら「位置OK」）。


## Plan of Work

Milestone 1 では純粋関数のモジュール `apps/api/src/services/part-measurement/part-measurement-drawing-reference-proposer.ts` を作る。中身は、寸法マップを番号付きの短い行にする関数（そばの穴の呼びを最大2つ添える）、人の丸数字をマップの寸法番号に対応づけて見本の実例を作る関数、ガイド文・項目名一覧・実例・対象の寸法一覧からメッセージを組み立てる関数、モデルの JSON 応答を検証して案の行に変える関数。応答の検証では、範囲外の番号、重複、一覧にない項目名、深さが無いのに depth を指定したものを捨てる。項目名はガイドの決まり（`deterministicReferenceLabel`）があればそれで上書きし、上下限は `referenceLimits` で計算する。

Milestone 2 では `apps/api/src/services/part-measurement/part-measurement-drawing-reference-placement.service.ts` に reference run を作るサービスを置き、`PartMeasurementDrawingPlacementService` の `listForEditor` と `backfill` から使う。フラグ `INSPECTION_DRAWING_REFERENCE_PLACEMENT_ENABLED`（既定 false）が無効なら今の動きと完全に同じにする。

Milestone 3 では評価スクリプトに `--method transfer|reference`（既定 transfer）と `--exclude-same-machine` を足し、本番で読み取り専用に走らせて結果をこの文書に記録する。


## Concrete Steps

作業ディレクトリは `apps/api`。テストは次で走らせる。

    pnpm exec vitest run src/services/part-measurement/part-measurement-drawing-reference src/services/part-measurement/part-measurement-drawing-placement src/scripts
    pnpm exec tsc --noEmit -p .
    pnpm exec eslint src/services/part-measurement src/scripts


## Validation and Acceptance

フラグ無効では既存テストがすべて通り、`listForEditor` と `backfill` の結果が変わらない。フラグ有効では、モデル応答を差し替えたテストで reference run が作られ、`listForEditor` が status `ready` でその案を返す。`InferenceDeferredError` のときは run を作らず、次の夜間処理で再試行される。評価スクリプトの reference 方式で、人の丸数字との一致数が transfer 方式より多いこと。


## Idempotence and Recovery

reference run は一意キーで1つだけ作られ、同時作成は P2002 を受けて勝った run を読み直す。応答の解析に失敗したときは run を保存せず、次回に再試行する。フラグを false に戻せば作成画面は transfer の案に戻り、保存済みの reference run は使われないだけで害はない。


## Artifacts and Notes

2026-10-26 の Opus 試行（6図面、人の丸数字87個、位置の許容 0.08）: Opus 案87個のうち一致31、位置OK24。transfer は案18個のうち一致8。数値だけの一致は56。

2026-10-26 の業務モデル（GLM、reference-guide-2026-10-26、見本最大2枚、`--interactive --vision none`、本番読み取り専用）。「一致」は数値と項目名の両方が合ったもの。

| 条件 | 人の丸数字 | 案 | 一致 | 数値だけ一致 | 失敗 |
| --- | --- | --- | --- | --- | --- |
| Opus と同じ6図面 | 87 | 104 | 22 | 49 | 0 |
| 30図面（同機種の見本あり） | 614 | 943 | 196（32%） | 297（48%） | 0 |
| 30図面（同機種の見本なし） | 544 | 829 | 154（28%） | 261（48%） | 3組（応答が読めない） |

比較: transfer の LOO は再現率約13%。同機種の見本が無い条件（3機種目と同じ状況）でも一致は約2倍。案の数は人の約1.5倍で、適合率は約2割。位置の許容0.03での位置OKは1割未満（丸数字は寸法文字から約0.04離れて置かれるため）。


## Interfaces and Dependencies

`part-measurement-drawing-reference-guide.ts` は `DRAWING_REFERENCE_GUIDE_VERSION`、`DRAWING_REFERENCE_LABEL_VOCABULARY`、`DRAWING_REFERENCE_GUIDE_TEXT`、`geometricToleranceLabel`、`generalTolerance`、`referenceLimits`、`deterministicReferenceLabel` を出す。新しい依存パッケージは使わない。

更新記録（2026-10-26 / Codex）: Milestone 1〜3のローカル実装と検証結果を追記し、本番比較と未完了の検証を実装完了と分けた。
