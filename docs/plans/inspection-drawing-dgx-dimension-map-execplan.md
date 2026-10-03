---
id: inspection-drawing-dgx-dimension-map-execplan
status: active
scope: kiosk inspection drawing nightly DGX dimension map and marker pre-placement
date: 2026-10-03
source_of_truth: true
related_code:
  - apps/api/src/lib/part-measurement-drawing-import.ts
  - apps/api/src/lib/part-measurement-drawing-storage.ts
  - apps/api/src/services/part-measurement/part-measurement-drawing-ocr-engine.ts
  - apps/api/src/services/part-measurement/part-measurement-drawing-ocr-ranking.ts
  - apps/api/src/services/part-measurement/part-measurement-drawing-ocr.scheduler.ts
  - apps/api/src/services/inference/ports/vision-completion.port.ts
  - apps/api/src/services/inference/adapters/routed-vision-completion.adapter.ts
related_docs:
  - docs/decisions/ADR-20260702-part-measurement-drawing-ocr-cache.md
  - docs/plans/inspection-drawing-ocr-local-candidates.md
  - docs/plans/inspection-drawing-ocr-rapidocr-local.md
validation: >
  Milestone 1: API unit tests for drawing import/source storage, API typecheck and lint.
  Integration test assertion added for PDF source retention (runs in CI with pdftoppm and Postgres).
  Milestone 2 (first round, 2026-10-03): offline experiment on 30 drawings / 330 items, no production change.
  Milestone 2 (second round and full-drawing ground truth, 2026-10-03): offline, no production change.
open_items:
  - Grouping nominal and tolerance into one dimension (structuring) is not measured yet (next experiment)
  - Exact thread-size thresholds of the depth limit rule are not tabulated yet
  - Hit rate of route B (drawings without a sibling) is not measured yet
  - 7161 and 3351 drawings were imported before source retention and need a separate path
---

```md
# 検査図面の夜間寸法解析（DGX）と丸数字の先回り配置

この ExecPlan は生きた文書である。`Progress`、`Surprises & Discoveries`、`Decision Log`、`Outcomes & Retrospective` は作業の進行に合わせて更新する。書式と運用はリポジトリ直下の `.agent/PLANS.md` に従う。

## Purpose / Big Picture

キオスクの検査図面作成では、人が図面上に丸数字（測定箇所の番号）を置き、近くの寸法を基準値として選ぶ。いまの OCR（画像から文字を読む処理）は、単独の数字なら読めるが、データム記号や寸法線と交差した数字、ノイズの多い数字を読み違える。さらに数字を一個ずつ拾うだけで、「φ20 ±0.02」を基準値と上下公差の一組として扱えない。

この計画の目的は二つある。一つ目は、図面を取り込んだ後、DGX Spark（社内の GPU 推論機）が空いている夜間に図面全体を解析し、寸法ごとに「値・公差・種類・位置」をまとめた一覧（以下、寸法マップ）を保存しておくことである。丸数字を置いた瞬間に寸法マップから近い寸法を引けるので、AI の応答待ちは発生しない。二つ目は、既に作成済みの検査図面と似た部品の新図面で、寸法マップを使って丸数字を先回りで仮配置し、人は微調整だけを行う流れを作ることである。

完成後の利用者の体験は次のとおり。新しい図面を取り込むと、翌朝には寸法マップができている。似た部品の既存検査図面を選ぶと、各項目の丸数字が新図面の同じ寸法の位置へ移った状態で表示され、見つからなかった項目だけ「未確認」として元の位置に残る。

## Progress

- [x] (2026-10-03) Milestone 1: PDF/TIFF 取込時に原本を保持する。表示用画像と既存の丸数字座標は変えない。
- [ ] Milestone 2: DGX で丸数字周辺の切り出しを読ませる精度実験。
  - [x] (2026-10-03) 1 回目: 30 図面 330 項目で、画像 AI・PP-OCRv5・既存 OCR を比較し、組み合わせと「指定値の図面全体探索」を採点した（結果は Artifacts and Notes）。
  - [x] (2026-10-03) 2 回目: 丸数字の周辺の候補に番号を振った画像を画像 AI に見せ、項目名を添えて選ばせた。重みは別の部品群で確かめ直した。
  - [x] (2026-10-03) 図面そのものの読み取り精度: 脚（R）と脚（L）の 2 図面で、図面上の全寸法の正解（109 件と 71 件）を人手で作り、OCR の拾い漏れを測った。
  - [x] (2026-10-03) 項目の種類ごとの分類、上下限の決まり方、左右違いの図面への写し替えを測った。
  - [ ] 寸法の組み立て（基準値と公差を一組にし、種類を付ける）の精度を測る。
- [ ] Milestone 3: 寸法マップの保存先と夜間キュー（2026-10-03 に設計を見直し、利用者が承認）。
- [ ] Milestone 4: 丸数字を置いたときに寸法マップから候補と上下限の案を出す（同上）。
- [ ] Milestone 5: 丸数字の案を先に置き、人が確認して承認する（同上）。

## Surprises & Discoveries

- 観察: PDF は取込時に 144dpi の JPEG へ変換され、元の PDF は捨てられていた。TIFF は縮小しないが JPEG 化していた。
  証拠: `apps/api/src/lib/part-measurement-drawing-import.ts`、`PART_MEASUREMENT_PDF_RENDER_DPI = 144`。
- 観察: 図面閲覧システムから出力される PDF/TIFF は文字情報を持たない画像であり、出力側の解像度は上げられない。したがって PDF から文字を直接抜く方法（`pdftotext`）は使えず、原本からの高解像度再描画と画像 AI が主な手段になる。
- 観察: OCR の前処理で長い線を白く塗りつぶしており、線に接した数字の一部まで消えることがある。交差箇所で弱い一因と考える。
  証拠: `part-measurement-drawing-ocr-engine.ts` の `suppressLongDrawingLines`。
- 観察: 画像を DGX の画像 AI に渡す境界 `VisionCompletionPort` と、DGX を空き時間だけ使う `background` 指定（モデル別名 `dgx-background-preparation`）は既にある。現在の利用は写真持出ラベルのみ。
- 観察: 7161 と 3351 の保存画像は大半が幅 3,000〜13,000px あり、切り出しを拡大しても文字は鮮明だった。外れの主因は解像度ではなく、正解の寸法が丸数字から離れていること、または候補にあるのに別の寸法を選ぶことだった。AI 超解像は数字の書き換え（3→8 など）の危険があり採らない。
  証拠: 切り出し `148695d7_02`（厚み 51.5 が範囲外）、`7b31d2ce_04`（「25」が鮮明なのに該当なしと回答）。
- 観察: PP-OCRv5 大型モデルは、切り出し単位では丸数字に最も近い数字を選ぶと弱い（一位 22.7%）が、図面全体をタイルで読ませると既存 OCR より多く拾う（丸数字の近くで正解値を拾えた割合 66.7%、既存 OCR は 60.0%）。両方を合わせると 73.0%。
- 観察: 同じ種類の部品の別図面で「項目名と基準値が同じ項目」があるのは 308 件中 42 件だけだった。部品が似ていても寸法値と配置は違う。
- 観察: 正解値 0 で登録された項目が 3 件あり、「3-M4深8」のように深さがねじ表記の中にある項目は数字の取り出し方で採点が変わる。
- 観察: 図面全体の正解を作ると、寸法の値そのものはほぼ読めていた。脚（R）109 件のうち PP-OCRv5 が正しい区画で拾えたのは 106 件（97.2%）、脚（L）71 件では既存 OCR と合わせて 68 件（95.8%）。落ちたのは角度、上下に重ねた公差（φ10.1 +0.1/0）、縦に接した二つの寸法（「29」と「50」が「2950」になる）だった。
  証拠: 開発端末の `gt_full_4e69cd18.json`、`gt_full_b34882d6.json`、`score_full_gt.py`、`score_full_gt_merged.py`。
- 観察: 字間の広い寸法（「5 0」など）を PP-OCRv5 は一文字ずつ別に返す。同じ行に並ぶ数字のかけらをつなぎ直すだけで、脚（L）の PP-OCRv5 単体は 78.9% から 87.3% に上がった。脚（R）は変化なし。
- 観察: 丸数字の項目は、図面に印字された寸法を選ぶとは限らない。脚（R）の 13 項目のうち 3 項目（厚み 230、穴ピッチ 165、ネジ穴ピッチ 156）は図面に書かれておらず、人が計算した値だった。
- 観察: 上下限の約 4 分の 3 は図面と社内の決まりから導ける。330 項目のうち、図面の普通公差表どおりが 183 件、深さ（下限は基準値、上限は +0・+3・+5 のいずれか）が 78 件、幾何公差（0〜指定値）が 25 件、それ以外（明記された公差やはめあい、人の判断）が 39 件。脚（L）の深さは M6深12 が +3、M12深24 が +5、脚（R）の M5深10 は +3 だった。
- 観察: 左右違いの部品でも形は別物のことがある。脚（R）と脚（L）は質量が 105kg と 45kg で、検査項目は 13 件と 12 件、項目名と基準値の両方が一致するのは 4 件だけだった。一方、注記どうしが相手の図番を名指ししており（「※寸法(540)は、脚R(M1-00044296**)との相互差」）、兄弟図面は注記から見つけられる。
- 観察: 人は検査項目を選んで付けている。X軸スライダはねじ表記 15 か所に対して深さの項目が 5 件、7161 サドルはねじ表記 26 か所に対して 0 件だった。図面に書かれた寸法をすべて項目にするわけではない。
- 観察: 丸数字は寸法線の上ではなく、寸法の文字の横の余白に置かれている。脚（L）では、正解の寸法の文字から丸数字までの距離は多くが図面幅の 2〜9% で、11% と 22% 離れたものもあった。指差し先端は文字ではなく形状を指す。

## Decision Log

- 決定: 表示用画像は変えず、原本 PDF/TIFF を `part-measurement-drawings/sources/{uuid}.pdf|.tif` に別保存し、`PartMeasurementVisualTemplate.drawingSourceStorageKey` に記録する。
  理由: 表示画像の解像度を変えると、既存の丸数字座標、OCR キャッシュ、キオスク表示の負荷に影響する。原本を別に持てば、解析だけを高解像度にできる。既存の `part-measurement-drawings` 配下なので、バックアップ、DR、本番ボリュームの設定変更が不要である。配信ルートは `/` を含むファイル名を拒否するため、原本は API から配信されない。
  日付: 2026-10-03
- 決定: 原本の保存に失敗したら取込自体を失敗させ、保存済みの表示画像を消す。
  理由: 原本のない図面が静かに混ざると、夜間解析の対象から黙って漏れる。保存失敗はディスク障害など表示画像の保存も危うい状況でしか起きない。
  日付: 2026-10-03
- 決定: 図面全体を一度に AI へ見せて指摘文を出させる「検図 AI」方式は採らない。
  理由: その方式は文章の指摘は出せても、寸法の正確な値と位置を返さない。必要なのは位置付きの寸法一覧である。
  日付: 2026-10-03
- 決定: 位置は OCR の座標を使い、画像 AI は読み取りと組み立て（基準値と公差の対応付け、種類の判定）に使う。両者が食い違えば「未確認」にする。
  理由: 画像 AI は文字の読みは強いが、返す座標は粗い。
  日付: 2026-10-03
- 決定: 既存の 7161 と 3351 は原本を持たないため、この計画の対象外とし、別手段で扱う。
  日付: 2026-10-03
- 決定: 候補は一つの読み取り方式に頼らず、画像 AI の判定、既存 OCR、PP-OCRv5 を合算して順位付けする方向で進める。
  理由: 1 回目の実験で、一位一致は画像 AI 単独 42.1%、多数決 47.6%、重み付き合算 54.8% だった。三方式のどれかが一位で当てた割合は 60.0% で、方式ごとに当たる項目が違う。
  日付: 2026-10-03
- 決定: 寸法マップの読み取りには、図面全体を既存 OCR と PP-OCRv5（DGX の CPU で可）の両方で読ませる。
  理由: 図面全体での拾い漏れが両方式で補い合う（丸数字の近くで正解値を拾えた割合 60.0% → 73.0%）。
  日付: 2026-10-03
- 決定: Milestone 5 の「基準値が一致する寸法を新図面から探す」方式は主手段にしない。既存テンプレートの「丸数字位置と指定値」は、丸数字と寸法の対応を学ぶ正解データとして使う。
  理由: 似た部品間で項目名と基準値が一致するのは 308 件中 42 件で、試した配置は 42 件中 7 件（16.7%）しか合わなかった。先回り配置には、項目の種類と図の形・位置関係から探す仕組みが要る（方式は未定）。
  日付: 2026-10-03
- 決定: 丸数字の候補選びは、候補に番号を振った画像と項目名（「穴径」「全長」など）を画像 AI に渡す方式を主にする。他方式との合算はしない。
  理由: 2 回目の一位一致は 57.0%（項目名なしは 43.6%）。1 回目の方式と合算すると、重みを決めた部品群では上がるが、別の部品群で確かめると 56.7% で上積みがなかった。
  日付: 2026-10-03
- 決定: 画像 AI の思考モード（答える前に考えさせる設定）は使わない。
  理由: 同じ 64 項目で通常 62.5% に対し思考モード 57.8%、1 件あたり約 60 秒かかり、本番モデルの負荷になる。最初の 30 件での優位（73.3% 対 66.7%）は偶然の揺れだった。
  日付: 2026-10-03
- 決定: 図面専用 OCR の eDOCr2 と、寸法線を直線検出してたどる方式は採らない。
  理由: eDOCr2 は 30 図面中 18 図面で内部エラーになり、動いた 12 図面での上積みは 76 件中 2 件だった。「深」などの日本式の表記も読めない。直線をたどる方式は 330 項目中 107 件で寸法を選べたが、正しかったのは 27 件だった。
  日付: 2026-10-03
- 決定: 寸法マップを作るとき、PP-OCRv5 が一文字ずつ返した数字のかけらを同じ行どうしでつなぎ直す。
  理由: 脚（L）で PP-OCRv5 単体の拾える割合が 78.9% から 87.3% に上がり、悪化した図面はなかった。
  日付: 2026-10-03
- 決定: 上下限は丸数字の候補と一緒に「案」として出す。普通公差表、明記された公差、深さの社内ルールから導けないものは空欄にし、兄弟図面に同じ項目があればその上下限を写す。
  理由: 上下限の約 4 分の 3 はルールで決まる。全長 540 の 540.1〜540.3 のような人の判断は図面からは導けないが、脚（R）と脚（L）では同じ値だった。
  日付: 2026-10-03
- 決定: 見直した Milestone 3〜5 の設計（読む・結ぶ・AI 案を置く・人が承認する）で進める。
  理由: 利用者が承認した。
  日付: 2026-10-03
- 決定: 丸数字の候補の合格基準は「上位 3 件に正解がある割合」とする。
  理由: 利用者の判断。人は上位 3 件からタップで選べれば足りる。
  日付: 2026-10-03
- 決定: 深さの上限（+0・+3・+5）は、ねじの太さで決まる社内ルールとして扱う。
  理由: 利用者が確認した。太さごとの境目は承認済みテンプレートから表にして確かめる。
  日付: 2026-10-03

## Outcomes & Retrospective

Milestone 1 完了時点: 新しく取り込む PDF/TIFF 図面は原本が残るようになった。既存の表示、丸数字、OCR キャッシュの動作は変わらない。

Milestone 2 の 1 回目（2026-10-03）: 組み合わせで一位一致が既存 OCR の 24.8% から約 55% まで上がる見込みを得たが、実用水準には届かない。残りの約 3 割は、正解の寸法が切り出しの外にあるか図面に書かれていない項目で、切り出し単位の改良では取れない。2 回目は図面全体の寸法一覧を使って選ばせる。

Milestone 2 の 2 回目と図面全体の正解（2026-10-03）: 分かったのは、弱いのが「図面の文字を読むこと」ではなく「丸数字がどの寸法を指すかを当てること」と「どの寸法を検査項目にするかを決めること」だという点である。文字は 2 図面で 96〜97% 拾えた。丸数字と寸法の対応は、項目名を添えた画像 AI で一位 57.0%、候補に正解が含まれる割合は 81.8% だった。どの寸法を項目にするかは人が選んでおり、類似部品間でもほとんど重ならない。この結果を受けて Milestone 3〜5 の設計を見直した（Plan of Work）。

## Context and Orientation

図面は `PartMeasurementVisualTemplate`（`apps/api/prisma/schema.prisma`）が一枚ずつ表す。`drawingImageRelativePath` は表示用画像の URL で、キオスクは `apps/api/src/lib/part-measurement-drawing-storage.ts` が作る幅 1280/1920/2560 の WebP 縮小版を表示する。検査項目は `PartMeasurementTemplateItem` で、丸数字位置 `markerXRatio/markerYRatio`、指差し先端 `calloutTipXRatio/calloutTipYRatio`、`nominalValue`、`lowerLimit`、`upperLimit` を持つ。座標はすべて画像の幅と高さに対する 0〜1 の比率なので、同じページを高解像度で再描画しても座標はそのまま対応する。

既存 OCR は `PartMeasurementDrawingOcrEngine` が図面全体・3×3 タイル・枠内を回転させて読み、数字を含む文字だけを座標付きで `PartMeasurementDrawingOcrCache` に圧縮保存する。キャッシュは図面の指紋（fingerprint）と OCR 版（`ocrVersion`）で区別され、`part-measurement-drawing-ocr.scheduler.ts` が cron でキューを処理し、失敗時は `nextAttemptAt` で再試行する。寸法マップはこの方式に倣う。

DGX 側の Lease や Job の調停は別リポジトリ `denkoushi/DGXSparkControlPlane` の責務である。新しい workload 識別子やモデル profile が必要になったら、先に Control Plane 側の責任分界を確認する（`AGENTS.md` の DGX Spark Control Plane Boundary）。

## Plan of Work

Milestone 1（完了）では、`importDrawingAndSave` が PDF/TIFF のとき原本を `PartMeasurementDrawingStorage.saveDrawingSource` で保存し、`sourceStorageKey` を返すようにした。図面を作る二つの経路（`routes/part-measurement/visual-templates.ts` と `routes/part-measurement/inspection-drawing-templates.ts` から呼ぶ `createInspectionDrawingEvaluationTemplate`）がこのキーを保存し、図面を消す三つの経路（作成失敗時の後始末、`deleteIfUnused`、`cleanupInspectionDrawingEvaluationTemplate`）が原本も消す。

Milestone 2 は精度実験であり、本番コードは変えない。今うまく読めていない図面 10〜20 枚について、既存の丸数字位置の周辺を原本から高解像度（目安 400dpi 相当）で切り出し、DGX の画像 AI に「この範囲の寸法の基準値・上下公差・種類」を JSON で答えさせる。正解は既存テンプレートの `nominalValue/lowerLimit/upperLimit` とする。既存 OCR の上位候補と、完全一致率を比べる。ここで十分読めない場合は Milestone 3 以降へ進まず、前処理（線消しの見直しなど）を先に検討する。

以下の Milestone 3〜5 は、Milestone 2 の結果を受けて 2026-10-03 に見直し、利用者が承認した設計である。全体は「図面を読む → 丸数字と寸法を結ぶ → 案を先に置く → 人が承認する」の 4 段で、どの段も AI の結果は「案」として扱い、人の承認なしに確定しない。

Milestone 3（図面を読む）では、図面ごとに次の三つを夜間に作って保存する。一つ目は寸法マップで、図面全体を既存 OCR と PP-OCRv5（DGX の CPU）の両方で読み、数字のかけらをつなぎ直し、座標付きの文字の一覧にする。二つ目は寸法の組み立てで、画像 AI に区画ごとの画像と文字の一覧を渡し、基準値・上下公差・種類（長さ、穴径、ねじと深さ、角度、幾何公差、参考寸法）を一組にさせる。座標は OCR の値を使い、画像 AI と OCR の読みが食い違う寸法は「未確認」にする。三つ目は図面全体の情報で、普通公差表、注記、表題欄（材質、図番、品名）を読む。注記に出てくる他の図番は兄弟図面の手がかりとして残す。保存先は `PartMeasurementDrawingOcrCache` と同じ考え方の別テーブル（図面 ID、原本指紋、解析版、状態、圧縮 JSON、再試行情報）で、夜間だけ動く scheduler が処理する。DGX の呼び出しは `VisionCompletionPort` を `background: true` で使い、DGX が使えない夜はキューに残して翌晩に回す。Pi 側の表示や既存 OCR には影響させない。組み立ての精度は未測定なので、この Milestone の最初に脚（R）と脚（L）の正解で測る。

Milestone 4（丸数字と寸法を結ぶ）では、人が丸数字を置き項目名を選んだとき、寸法マップから丸数字の近くの候補を出し、項目名を添えて画像 AI に順位を付けさせ、上位数件を提示する。応答待ちを避けるため、画像 AI は丸数字を置いた時点で呼ぶのではなく、夜間に作った候補の中から選ぶ軽い処理にするか、候補の距離順だけを即時に出して AI の順位は後から差し替える。あわせて上下限の案を出す。普通公差表と明記された公差から導き、深さは社内ルール（下限は基準値、上限は +0・+3・+5）に従い、導けないものは空欄にする。UI は従来どおり候補提示のみで、自動確定しない。

Milestone 5（案を先に置き、人が承認する）は二つの経路に分ける。

経路 A は兄弟図面（左右違い、同じ型式の別サイズ、改訂前後など）。注記の相互参照、品番・品名照合の既存ルール `template-candidate-rules.ts`、図番の近さで既存の検査図面を探し、同じ項目名・基準値の寸法が新図面の寸法マップにあれば、元の位置関係に最も近い候補の横へ丸数字を置き、上下限も写す。見つからない項目は置かずに一覧へ「未配置」として残す。

経路 B は兄弟のない新しい図面。承認済みテンプレートから「どの種類の寸法が項目になりやすいか」（公差が明記された穴径、全長、幾何公差など）を集計し、該当する寸法へ丸数字の案を置く。ピッチのように人が計算して決める項目や、どれを選ぶか人によって違う項目は、当面は人が追加する。経路 B の当たり率は未測定で、承認済みテンプレートを使った試算を先に行う。

どちらの経路でも丸数字は「AI 案」の状態で表示し、人が一件ずつ（またはまとめて）承認すると通常の項目になる。案のまま保存された項目は検査には使わない。この状態を持たせるには `PartMeasurementTemplateItem` への列追加か下書き用の別テーブルが要り、どちらにするかは Milestone 5 の着手時に決める。指差し先端は自動で作らない。

この設計は 2026-10-03 に利用者が承認した。あわせて、候補の合格基準を「上位 3 件に正解がある割合」とし、深さの上限をねじの太さで決まる社内ルールとして扱うことが決まった。

## Concrete Steps

Milestone 1 の検証（作業ディレクトリ `apps/api`）:

    pnpm exec prisma generate
    pnpm exec tsc --noEmit -p tsconfig.build.json
    pnpm exec vitest run src/lib/__tests__/part-measurement-drawing-import.test.ts src/lib/__tests__/part-measurement-drawing-source-storage.test.ts

期待結果: 型エラーなし、2 ファイル 9 テスト成功。`part-measurement.integration.test.ts` の PDF 取込テストは pdftoppm と Postgres がある CI で原本キーの保存を確認する。

## Validation and Acceptance

Milestone 1 の受入: PDF を取り込むと `drawingSourceStorageKey` が `part-measurement-drawings/sources/{uuid}.pdf` 形式で入り、原本のバイト列を読み戻せる。PNG/JPEG 直接取込では null。表示 URL、OCR キュー投入、既存の丸数字は従来どおり動く。

Milestone 2 の受入目安: 対象の丸数字のうち、基準値と上下公差が完全一致する割合が既存 OCR の一位候補を明確に上回ること。数値目標は実験結果を見て決め、この節に記録する。

1 回目の結果: 基準値の一位一致は既存 OCR 24.8% に対し、重み付き合算 54.8%（同じデータで重みを決めたため甘め、重みなしの目安 52.4%）。上下公差は図面に明記されたものが少なく（多くは普通公差）、比較できる件数が足りないため、基準値を主指標とする。数値目標は 2 回目の結果を見て決める。

2 回目の結果: 一位一致 57.0%、候補の中に正解がある割合 81.8%。合格基準は「上位 3 件に正解がある割合」とする（利用者決定）。目標値は Milestone 4 の実装前に、上位 3 件の割合を測ってから決める。

## Idempotence and Recovery

Milestone 1 の migration は nullable 列の追加だけで、既存行は null のまま動く。戻す場合は列を使うコードを戻せば足り、列は残しても害がない。原本ファイルは図面と同じ寿命で、未参照時だけ消す。

## Artifacts and Notes

Milestone 2 の 1 回目（2026-10-03、本番コード変更なし）:

- 対象: 7161 と 3351 の 30 図面、333 項目（正解値 0 の 3 件を除き 330 項目で採点）。正解は Pi5 DB の既存テンプレートを読み取り専用で取得した。原本がないため、保存済みの表示用画像から丸数字中心に幅 14% 相当を切り出し、幅 1,400px に拡大して丸数字位置に赤い小円を描いた。
- 画像 AI: DGX の `system-prod-primary`（推論思考なし、温度 0、4 並列）に、切り出し内の寸法をすべて位置付き JSON で挙げさせ、赤丸の寸法の番号を答えさせた。1 件平均 31 秒（4 並列時）。
- PP-OCRv5: RapidOCR 3.8.4 に PP-OCRv5 server の検出・認識モデルを指定し、DGX の CPU で 0°・左右 90° の 3 方向を読ませた。図面全体は 1,600px のタイル（重なり 240px）で読み、30 図面に約 1 時間かかった。

基準値の一位一致（330 項目）:

    既存 OCR（本番キャッシュの一位）     24.8%
    PP-OCRv5（切り出し内で丸数字に最も近い数字、深さ項目はねじ表記の深さを優先）  22.7%
    画像 AI                              42.1%
    3 方式の多数決                       47.6%
    3 方式の重み付き合算                 54.8%（重みなし目安 52.4%）
    3 方式のどれかが一位で当てた割合     60.0%

指定値を図面全体から探す（330 項目、丸数字の近く = 図面幅の 7% 以内）:

    既存 OCR のみ        図面内で発見 87.6%   丸数字の近くで発見 60.0%
    PP-OCRv5 のみ        図面内で発見 90.0%   丸数字の近くで発見 66.7%
    両方                 図面内で発見 92.1%   丸数字の近くで発見 73.0%

「図面内で発見」は「5」のように何度も出る小さな数字も含むため、正しい位置の発見率ではない。

似た部品の別図面への配置（同じ部品名の図面どうし、6 種類 18 図面）: 試した項目 308 件のうち、相手の図面に同じ項目名・基準値の項目があったのは 42 件、正しい位置（図面幅の 5% 以内）に置けたのは 7 件。

Milestone 2 の 2 回目（2026-10-03、本番コード変更なし）:

- 方式: 丸数字の周辺（幅 24% 相当）を幅 1,600px で切り出し、図面全体の OCR（既存と PP-OCRv5）で拾った数字に青い番号札を最大 20 個付け、丸数字位置に赤い輪を描いた。画像 AI に項目名と画像を渡し、番号と値を JSON で答えさせた。

基準値の一位一致（330 項目）:

    項目名あり                         57.0%（番号での一致 51.5%、値か番号のどちらかで一致 60.6%）
    項目名なし                         43.6%
    丸数字に最も近い候補               39.4%
    候補の中に正解がある（上限）       81.8%
    1 回目の方式との合算（別の部品群で確認）  56.7%
    思考モード（64 項目のみ、同じ項目で通常は 62.5%）  57.8%
    寸法線の直線をたどる方式           8.2%（選べた 107 件中 27 件が正解）

外れ 142 件の内訳: 正解が候補にない 52 件、正解が最も近い候補なのに別を選んだ 68 件、正解より近い候補を選んだ 22 件。

図面全体の正解による読み取り精度（正しい区画で値を拾えた割合）:

    図面          寸法数   既存 OCR   PP-OCRv5            両方
    脚（R）        109     87.2%      97.2%               97.2%
    脚（L）         71     90.1%      78.9%（つなぎ直し後 87.3%）  95.8%

公差の文字（±0.3 など）まで読めたのは、脚（R）で PP-OCRv5 が 4 件中 3 件。脚（L）の上下に重ねた公差は両 OCR とも崩れた。

左右違いの図面への写し替え（脚（R）→ 脚（L）と、その逆）: 項目名と基準値が一致する項目は双方向とも 4 件。元の位置関係で候補を選び、正しい寸法を選べたのは 8 件中 7 件（外れた 1 件は、脚（R）の丸数字の近くの穴径を OCR が読めていなかった）、上下限は 8 件とも正しく写せた。同じ寸法を二つの OCR が別の文字列で読むため（「540+40.」と「5 4 0± 0. 3」など）、寸法マップでは近い位置の読みを一つの寸法にまとめる必要がある。脚（L）の 12 項目の上下限は、普通公差表 7 件、深さの社内ルール 2 件、明記された公差 2 件、兄弟図面からの写し 1 件（全長）で、すべて決められた。

実験ファイルは開発端末の `/tmp/pm-exp/` と DGX の `/tmp/pm-exp-20261003/` にあり、リポジトリには含めない（図面画像と正解データを含むため）。

## Interfaces and Dependencies

`apps/api/src/lib/part-measurement-drawing-storage.ts`:

    PartMeasurementDrawingStorage.saveDrawingSource(buffer: Buffer, kind: 'pdf' | 'tiff'): Promise<{ storageKey: string }>
    PartMeasurementDrawingStorage.readDrawingSource(storageKey: string): Promise<Buffer>
    PartMeasurementDrawingStorage.deleteDrawingSource(storageKey: string): Promise<void>

`apps/api/src/lib/part-measurement-drawing-import.ts`:

    importDrawingAndSave(input): Promise<{ relativeUrl; contentType; sourceStorageKey: string | null }>
    deleteImportedDrawing(result: { relativeUrl; sourceStorageKey }): Promise<void>

Milestone 3 以降で寸法マップの型（寸法 1 件 = 原文、基準値、上公差、下公差、種類、位置比率、読み取り元、一致状態）を定義する。
```

改訂メモ: 2026-10-03 初版。Milestone 1 を実装し、以降を DGX 空き待ちとして記録した。
改訂メモ: 2026-10-03 Milestone 2 の 1 回目の実験結果を記録し、候補の合算方針、寸法マップの読み取り方式、Milestone 5 の方式見直しを Decision Log に追加した。
改訂メモ: 2026-10-03 2 回目、図面全体の正解による読み取り精度、上下限の決まり方、左右違いの写し替えを記録した。Milestone 3〜5 を「読む・結ぶ・案を置く・人が承認する」の構成に書き直した。同日、利用者が設計、候補の合格基準（上位 3 件）、深さルールの扱いを承認したので Decision Log に記録した。
