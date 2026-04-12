# 配膳スマホ API（mobile-placement）

最終更新: 2026-04-11（現品票画像 OCR・FSEIBAN 照合）

## 概要

Android スマホ等から、**移動票・現品票の照合**および **製造order番号起点の部品配膳履歴（`OrderPlacementEvent`）** を行う。従来の **工具 `Item.storageLocation` 更新**（`MobilePlacementEvent`）API も併存する。

すべて **`x-client-key`**（登録済み `ClientDevice.apiKey`）必須。

## エンドポイント

### `GET /api/mobile-placement/schedule`

キオスクの `GET /api/kiosk/production-schedule` と同一のクエリパラメータ。

### `GET /api/mobile-placement/registered-shelves`

部品配膳の **`OrderPlacementEvent` に登場した `shelfCodeRaw` の distinct 一覧**を返す（読み取り専用）。UI の「登録済み棚番」候補用。**1件も無い場合は `{ "shelves": [] }`**（不具合ではない）。

各要素:

- `shelfCodeRaw`: 保存値そのまま
- `isStructured`: `西-北-02` のように **エリア・列・番号（2桁）** を `-` で3分割できた場合 `true`
- `isStructured === true` のときのみ: `areaId`（`west` | `central` | `east`）、`lineId`（`north` | `central` | `south`）、`slot`（1..99）

### `POST /api/mobile-placement/verify-slip-match`

移動票・現品票それぞれについて、日程行を解決し、**同一の `FSEIBAN` + `FHINCD` ペア**か判定する（副作用なし）。

- **移動票**: `transferOrderBarcodeRaw` を **ProductNo** として `listScheduleRowsByProductNo` と同系で解決。
- **現品票**:  
  - `actualOrderBarcodeRaw` が **空でない**ときは **ProductNo**（製造order番号）で解決。  
  - **空**のときは `actualFseibanRaw` を **FSEIBAN** として `listScheduleRowsByFseiban` と同系で解決。  
  - **`actualOrderBarcodeRaw` と `actualFseibanRaw` の少なくとも一方が必須**（両方空は 400）。
- 部品側のスキャンは **`actualPartBarcodeRaw`**（FHINBAN バーコード等。日程行の `FHINCD` と照合）。

JSON:

```json
{
  "transferOrderBarcodeRaw": "移動票の製造order番号（1次元）",
  "transferPartBarcodeRaw": "移動票のFHINBAN/FHINCD（1次元）",
  "actualOrderBarcodeRaw": "現品票の製造order番号（1次元または空）",
  "actualFseibanRaw": "現品票の製番 FSEIBAN（任意。製造orderが空のときに使用）",
  "actualPartBarcodeRaw": "現品票のFHINBAN/FHINCD（1次元）"
}
```

応答: `{ "ok": true }` または `{ "ok": false, "reason": "..." }`（`reason` はサーバ内部コード文字列）。

### `POST /api/mobile-placement/parse-actual-slip-image`

現品票の**撮影画像**を OCR し、製造order（10桁）と製番（FSEIBAN）の**候補**を返す（副作用なし）。UI は候補を確認し、必要に応じて手修正してから `verify-slip-match` を呼ぶ。

- **Content-Type**: `multipart/form-data`
- **フィールド名**: `image`（JPEG / PNG / WebP）
- **OCR 実装**: `tesseract.js`（`ImageOcrPort`）。現品票は **用途別に 3 パス**（ラベル文脈: `jpn+eng`・製造 order 向け数字: `eng` + whitelist・FSEIBAN 向け英数字: `eng` + whitelist）を **順に実行**し、結合テキストを `actual-slip-identifier-parser` に渡す。前処理（グレースケール・正規化・余白・リサイズ、数字パスは二値化）は **mobile-placement サービス層**。**V9（2026-04-12）**: **labels パス（`jpn+eng`）の結合テキストのみ**で **製造order（10桁）と FSEIBAN の両方がパースできた場合**は **以降のパスと二値化前処理をスキップ**（早期終了）。このとき完了ログに **`preprocessBytesBinary` は付かない**（後段パス未実行のため）。`profile` 省略時の単一 `jpn+eng` は adapter の後方互換用。テスト用に `IMAGE_OCR_STUB_TEXT` を設定すると固定テキストを返すスタブに切り替え可能。

応答例:

```json
{
  "engine": "tesseract.js",
  "ocrText": "…",
  "ocrPreviewSafe": "0002178005 BE1N9321",
  "manufacturingOrder10": "0002178005",
  "fseiban": "BE1N9321"
}
```

- **`ocrText`**: 全パス結合（パーサ入力・ログは文字数のみ）。
- **`ocrPreviewSafe`**: **数字・英数字 OCR のみ**を結合した短いプレビュー用文字列（ひらがな誤認が多いラベルパスは含めない）。クライアントは表示にこれを優先し、無い場合は `ocrText` にフォールバック可能。
- **`manufacturingOrder10` / `fseiban`**: OCR 品質により **null** になり得る。

- **観測性**: 処理完了時に API ログへ構造化出力（`inputBytes` / `preprocessBytes` / `ocrTextChars` / `hasManufacturingOrder10` / `hasFseiban` / `durationMs` / `engine` 等。**V8 以降**: `mo10Candidate10Count` / `mo10AfterOrderBlockFilterCount` / `mo10ParseSource`。**V9**: 早期終了時は **`preprocessBytesBinary` を付けない**（後段パス未実行）。OCR 全文はログに出さない（後追いは文字数・候補有無・パーサ経路で切り分け）。ルート層でも `parse-actual-slip-image completed` を記録する。

### `POST /api/mobile-placement/register-order-placement`

**部品配膳**（`Item` は更新しない）。`manufacturingOrderBarcodeRaw` を **ProductNo** として `listScheduleRowsByProductNo` と同系の検索で日程行を1件特定し、`OrderPlacementEvent` を保存する。

JSON:

```json
{
  "shelfCodeRaw": "棚番（仮置きでも可）",
  "manufacturingOrderBarcodeRaw": "製造order番号のスキャン値"
}
```

一致するスケジュール行が無い場合は **404**（`ORDER_PLACEMENT_SCHEDULE_NOT_FOUND`）。

### `GET /api/mobile-placement/resolve-item?barcode=...`

`Item.itemCode` を **大文字小文字無視**で検索（工具配置フロー用）。突合ロジックの調査は [KB-339](../knowledge-base/KB-339-mobile-placement-barcode-survey.md)。

### `POST /api/mobile-placement/register`

**工具配置**（従来）。`Item.storageLocation` 更新 + `MobilePlacementEvent`。

JSON:

```json
{
  "shelfCodeRaw": "棚ラベルのスキャン値",
  "itemBarcodeRaw": "工具ラベル（Item.itemCode と一致すること）",
  "csvDashboardRowId": "任意。選択したスケジュール行の id（CsvDashboardRow）"
}
```

`csvDashboardRowId` 指定時は、(1) スキャン値が当該行の `ProductNo` / `FSEIBAN` / `FHINCD` のいずれかと一致する、または (2) マスタへ解決した **`Item.itemCode` が、上記3フィールドのいずれかと一致**すること（**行と無関係な `itemCode` のみの一致では `MOBILE_PLACEMENT_SCHEDULE_MISMATCH`**）。

## 関連

- Runbook: [mobile-placement-smartphone.md](../runbooks/mobile-placement-smartphone.md)
- バーコード調査: [KB-339](../knowledge-base/KB-339-mobile-placement-barcode-survey.md)
