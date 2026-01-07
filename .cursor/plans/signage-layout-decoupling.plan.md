# サイネージ表示領域の疎結合化（全体/左右 + 任意コンテンツ）

## ゴール

- **Pi3は現行の軽量表示（`/api/signage/current-image`のJPEG取得 + `feh`表示）を維持**し、クライアント側にリッチ処理を追加しない。
- サイネージの **レイアウト（全体/左右）** と **各エリアのコンテンツ（PDF/持出一覧/将来のCSV可視化）** を分離し、
- 新しい可視化を足すときに **巨大な`if`分岐改修を避ける**
- **"コンテンツプロバイダ追加 + 管理画面で選択可能化"** で増やせる構造にする。
- 既存の `SignageContentType (TOOLS/PDF/SPLIT)` と `pdfId` を使った運用は **後方互換で維持**し、内部で新形式へ読み替える。

## 現状の課題（根拠）

- サーバー側レンダラーは `contentType` に強く依存し、`SPLIT` は **左=TOOLS / 右=PDF 固定**になっている（`apps/api/src/services/signage/signage.renderer.ts`）。
- スケジュール返却も `SignageContentType` のif分岐で固定され、新コンテンツ追加のたびに `SignageService`/`SignageRenderer` の両方を改修する必要がある（`apps/api/src/services/signage/signage.service.ts`）。

## 方針（最小の"自由度確保"）

- **DBに新しい設定（JSON）を追加**して、スケジュール単位で
- `layout: FULL | SPLIT`
- `slots: [{ position: FULL or LEFT/RIGHT, kind: 'pdf'|'loans'|..., config: {...}}]`

を保持する。

- `SignageService.getContent()` は新形式（layout+slots）を返す。
- `SignageRenderer` は **layoutレンダラー** と **slotコンテンツレンダラー** を組み合わせて1枚JPEGを生成する。

## 変更範囲（主要ファイル）

- DB/モデル
- `apps/api/prisma/schema.prisma`（`SignageSchedule` 等に JSON設定カラム追加）
- API/サービス
- `apps/api/src/services/signage/signage.service.ts`（新形式の`getContent()`返却 + 旧形式からの読み替え）
- `apps/api/src/services/signage/signage.renderer.ts`（レイアウト/スロット方式にリファクタ）
- ルート/UI
- `apps/api/src/routes/signage/schedules.ts`（スケジュールCRUDの入出力拡張）
- `apps/web/src/pages/admin/SignageSchedulesPage.tsx`（管理コンソールで左右/全体の割当を選択）
- 既存PDF管理UI（`SignagePdfManager`）は流用。

## データモデル案（後方互換のための"追加"）

- `SignageSchedule` に `layoutConfig Json?` を追加（nullの場合は旧`contentType/pdfId`から合成）。
- 例（SPLIT、左=持出一覧、右=PDF）:
- `layoutConfig = { "layout": "SPLIT", "slots": [{"pos":"LEFT","kind":"loans"},{"pos":"RIGHT","kind":"pdf","pdfId":"...","displayMode":"SLIDESHOW","slideInterval":15}] }`
- **将来のCSV可視化**は `kind: 'csv_dashboard'` 等を追加し、`config`に表示条件を持たせる（DB enum追加を回避）。

## 実装ステップ

1. **ブランチ作成**

- `feature/signage-layout-decoupling` ブランチを作成
- 実装開始前にブランチを切る

2. **Prisma migration**

- `layoutConfig` を `SignageSchedule` に追加。
- 必要なら `SignageEmergency` にも追加（緊急も同じ仕組みで左右/全体に出せるようにする）。

3. **サービス層の読み替え**

- `layoutConfig != null` ならそれを優先。
- `layoutConfig == null` なら旧 `contentType/pdfId` を新形式へ変換して返す（後方互換）。

4. **レンダラーの分割（疎結合化）**

- `layout`ごとのキャンバス割当（FULL or LEFT/RIGHT）を1箇所に集約。
- `slot.kind`ごとに「SVG片を生成する関数」を分離（例: `renderSlotPdf`, `renderSlotLoans`）。
- 既存の`buildToolsScreenSvg`/`buildSplitScreenSvg`は段階的に置換し、まずは内部で再利用して動作一致を確認。

5. **管理コンソールUI拡張**

- スケジュール編集で
    - レイアウト（全体/左右）
    - 左/右（または全体）に表示する種別（PDF or 持出一覧）
    - PDFの場合は対象PDFを選択（左右で別PDFも選べる）
    - スライド/単一、間隔（既存項目の流用）
- 旧スケジュールは表示時に読み替え、保存時に`layoutConfig`として保存（段階移行）。

6. **テスト/検証（軽量運用を崩さない）**

- APIの統合テストを追加/更新し、`layoutConfig`の各組合せで `/api/signage/current-image` が200で返ることを確認。
- Pi3のクライアント側は変更なし（`scripts/client/setup-signage-lite.sh`のまま）。

## 将来のCSV可視化への接続点（今回のゴール外だが設計に含める）

- `slot.kind` を増やすだけで拡張できるよう、
- `SignageSlotRenderer`（slotごとのSVG生成）をレジストリ化
- CSV可視化は `kind: csv_*` として別ファイル群に閉じ込める
- CSVは"リッチ禁止"のため、
- **集計済みの数値 + 上位Nのテキスト表**程度をSVGに描画（グラフは最小限、必要なら簡易棒）
- 画像生成はPi5側のみ。

## 成果物