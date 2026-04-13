# 配膳スマホ API（mobile-placement）

最終更新: 2026-04-13（**V18 棚マスタ `MobilePlacementShelf`**・`GET/POST registered-shelves` 正本切替・`POST /mobile-placement/shelves`）／2026-04-12（**V16 部品名検索**・**V14 分配枝**・`OrderPlacementBranchState`／履歴は `OrderPlacementEvent` + `branchNo` / `actionType`）

**本番（2026-04-12・V16）**: ブランチ **`feat/mobile-placement-part-name-search`**（コミット **`62721227`**）を Pi5→Pi4×4 順次反映（**Pi3 除外**）・Phase12 **43/0/0**・部品名検索 API の spot check 済み。手順・知見・Detach Run ID の扱いは [mobile-placement-smartphone.md](../runbooks/mobile-placement-smartphone.md) §0（V16）。

## 概要

Android スマホ等から、**移動票・現品票の照合**および **製造order番号起点の部品配膳履歴（`OrderPlacementEvent`）** を行う。従来の **工具 `Item.storageLocation` 更新**（`MobilePlacementEvent`）API も併存する。

**V14（分配枝）**: 同一製造orderに対して **分配1・分配2…**（`branchNo` 1 始まり）を扱う。**現在棚**は `OrderPlacementBranchState`、**監査履歴**は `OrderPlacementEvent`（`CREATE_BRANCH` / `MOVE_BRANCH` / 導入前データは `LEGACY`）で分離する。

すべて **`x-client-key`**（登録済み `ClientDevice.apiKey`）必須。

## エンドポイント

### `GET /api/mobile-placement/schedule`

キオスクの `GET /api/kiosk/production-schedule` と同一のクエリパラメータ。

### `GET /api/mobile-placement/order-placement-branches`

**クエリ**: `manufacturingOrder`（必須・製造orderのスキャン値。trim 一致）

指定した製造orderに紐づく **分配枝の現在棚**（`OrderPlacementBranchState`）を **`branchNo` 昇順**で返す。

```json
{
  "branches": [
    {
      "id": "<uuid>",
      "manufacturingOrderBarcodeRaw": "0002178005",
      "branchNo": 1,
      "shelfCodeRaw": "西-北-02",
      "csvDashboardRowId": "<row uuid or null>",
      "updatedAt": "2026-04-12T00:00:00.000Z"
    }
  ]
}
```

該当が無い場合は **`{ "branches": [] }`**（不具合ではない）。

### `GET /api/mobile-placement/registered-shelves`

**`MobilePlacementShelf`（棚マスタ）**に登録された `shelfCodeRaw` 一覧を返す（読み取り専用）。UI の「登録済み棚番」候補用。**マイグレーション時に、既存の `OrderPlacementEvent` から出た棚番は一度だけ棚マスタへ取り込まれる**（重複は `shelfCodeRaw` 単位で除外）。**1件も無い場合は `{ "shelves": [] }`**（不具合ではない）。

各要素:

- `shelfCodeRaw`: 保存値そのまま
- `isStructured`: `西-北-02` のように **エリア・列・番号（2桁）** を `-` で3分割できた場合 `true`
- `isStructured === true` のときのみ: `areaId`（`west` | `central` | `east`）、`lineId`（`north` | `central` | `south`）、`slot`（1..99）

### `POST /api/mobile-placement/shelves`

棚マスタへ **新規の棚番**を登録する（キオスク **`/kiosk/mobile-placement/shelf-register`** の「棚番を登録」）。**`西-北-01` 形式（構造化棚）のみ**受け付ける。重複は **409**。

- **Body**: `{ "shelfCodeRaw": "西-北-01" }`
- **認証**: `x-client-key` 必須（登録端末を `createdByClientDeviceId` に記録）
- **応答**: `{ "shelf": { ... } }`（形は `GET registered-shelves` の要素と同じ）

### `GET /api/mobile-placement/part-search/suggest`

口頭問い合わせ向けの **部品名検索**（**現在棚 `OrderPlacementBranchState.scheduleSnapshot` を最優先**し、**生産スケジュール `CsvDashboardRow`（当該ダッシュボードの winner 行）を補助**）。表記ゆれは API 内の **管理された同義語辞書**で展開（例: `アシ` → `脚` / `足` を **同一トークン内**で OR 検索）。**空白区切りの複数語は AND**（例: `テーブル 脚` は `FHINMEI`/`FHINCD` に対し「テーブル」を含み、かつ「脚」系に一致する行）。辞書・正規化ロジックの共有実装は **`@raspi-system/part-search-core`**（`packages/part-search-core`）。**かなの表記ゆれ**（ひらがな/カタカナ統一・拗音・促音の扱いなど）も同パッケージで正規化する。**DB 上の部分一致（ILIKE）は、促音 `っ`/`ッ` を捨てずに比較用へ写像する `REPLACE` 連鎖**（`part-search-field-comparable-sql`・**`PART_SEARCH_SOKUON_COMPARABLE_REPLACEMENTS`**）で、**`ナット` と `ナットホルダー` のような表記差**を吸収する（V20）。

- **クエリ `q`**: 任意・最大 100 文字。**`q` が空かつ `machineName` も空なら** `{ currentPlacements: [], scheduleCandidates: [] }`。**`machineName` のみ指定**（`q` 空）でも **機種名集約に基づく候補**を返す（V20）。
- **クエリ `machineName`（任意）**: 最大 200 文字。**空なら無視**。**登録製番ボタン下段の機種名**と同系の **`CsvDashboardRow` 上の MH/SH 行 `FHINMEI` を製番（`FSEIBAN`）単位で集約した文字列**に対し、正規化後の **部分一致**で絞り込み、`q` があるときは **`q` の条件と AND**（`scheduleSnapshot` / 日程行の **`FSEIBAN` が一致集合に含まれる行**のみ）。
- **認証**: `x-client-key` 必須

応答（要点）:

- `currentPlacements[]`: `matchSource: "current"`。`shelfCodeRaw` あり。`scheduleSnapshot` の `FHINMEI` / `FHINCD` 等で部分一致。
- `scheduleCandidates[]`: `matchSource: "schedule"`。**現在棚に既に紐づく `csvDashboardRowId` は除外**（重複を避ける）。**キオスク「部品名で棚を探す」画面では一覧に使わない**（登録済み・現在棚のみ表示する想定）。棚未登録の可能性がある候補は API 互換のため残す。
- 各要素に `displayName` / `matchedQuery` / `aliasMatchedBy`（辞書適用時）/ `fhinmei` / `fhincd` / `fseiban` / `productNo` / `manufacturingOrderBarcodeRaw` / `branchNo` 等。

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
- **OCR 実装（V12・2026-04-12）**: `tesseract.js`（`ImageOcrPort`）。**紙現品票の固定レイアウト前提**で、前処理後画像を **正規化座標 ROI**（`genpyo-slip/genpyo-slip-template.ts` の `DEFAULT_GENPYO_SLIP_ROIS`）で切り出し、**領域ごとに** `actualSlipLabels` プロファイルで OCR する。**製造order**は **右上ヘッダ ROI（`moHeader`）を優先**し、欠落時のみ **下段 ROI（`moFooter`）** を参照。**製番（FSEIBAN）**は **左中盤 ROI（`fseibanMain`）** のみから抽出。フィールド確定は `genpyo-slip-resolver.ts` が `parseManufacturingOrder10Extraction` / `extractFseiban`（実装は `genpyo-slip/*`・`actual-slip-identifier-parser` は再エクスポートで互換）を呼ぶ。**V10**: 製造ラベル近傍の **10文字トークン**で **`O`/`I`/`l`/`|` と数字の誤認**を限定補正。**V11**: 同一行に **注文番号**と**枝番**がある行の 10 桁除外・**global-filter** 選別は **ROI 内テキスト**に対して従来どおり適用。**旧パイプライン（labels 早期終了・3 パス直列・二値化 `preprocessBytesBinary`）は V12 で置換**（履歴として V7〜V11 の説明は KB-339 を参照）。テスト用に `IMAGE_OCR_STUB_TEXT` を設定すると **各 ROI で同一固定テキスト**を返すスタブに切り替え可能。

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

- **`ocrText`**: **ROI ごとの OCR 結果**を `[moHeader]` / `[fseibanMain]` / `[moFooter]` 見出しで連結（デバッグ・後追い用。ログは文字数のみ）。
- **`ocrPreviewSafe`**: **確定した** `manufacturingOrder10` と `fseiban` を短く結合したプレビュー（いずれか欠ける場合は片方のみ）。クライアントは表示にこれを優先し、無い場合は `ocrText` にフォールバック可能。
- **`manufacturingOrder10` / `fseiban`**: OCR 品質により **null** になり得る。

- **観測性**: 処理完了時に API ログへ構造化出力（`inputBytes` / `preprocessBytes` / `ocrTextChars` / `hasManufacturingOrder10` / `hasFseiban` / `durationMs` / `engine` 等。**V8 以降**: `mo10Candidate10Count` / `mo10AfterOrderBlockFilterCount` / `mo10ParseSource`。**V12**: `mo10ResolvedFromRoi`（`moHeader` | `moFooter` | 欠落時は付かない）で製造order採用元を識別。**V12 では `preprocessBytesBinary` は出力しない**（二値化パス廃止）。OCR 全文はログに出さない（後追いは文字数・候補有無・パーサ経路で切り分け）。ルート層でも `parse-actual-slip-image completed` を記録する。

### `POST /api/mobile-placement/register-order-placement`

**新しい分配枝の追加**（`Item` は更新しない）。`manufacturingOrderBarcodeRaw` を **ProductNo** として `listScheduleRowsByProductNo` と同系の検索で日程行を1件特定し、**次の `branchNo`**（当該製造orderで未使用の最小の連番）で `OrderPlacementEvent`（`actionType: CREATE_BRANCH`）を保存し、対応する `OrderPlacementBranchState` を作成する。

JSON:

```json
{
  "shelfCodeRaw": "棚番（仮置きでも可）",
  "manufacturingOrderBarcodeRaw": "製造order番号のスキャン値"
}
```

応答（例）:

```json
{
  "event": {
    "id": "…",
    "branchNo": 2,
    "actionType": "CREATE_BRANCH",
    "…": "…"
  },
  "branchState": { "id": "…", "branchNo": 2, "shelfCodeRaw": "…" },
  "resolvedRowId": "…"
}
```

一致するスケジュール行が無い場合は **404**（`ORDER_PLACEMENT_SCHEDULE_NOT_FOUND`）。

### `PATCH /api/mobile-placement/order-placement-branches/:id/move`

**既存分配枝の棚変更**（移動）。`:id` は `OrderPlacementBranchState.id`。

JSON:

```json
{
  "shelfCodeRaw": "新しい棚番"
}
```

応答は `event`（`actionType: MOVE_BRANCH`）と更新後の `branchState`。対象が無い場合は **404**（`ORDER_PLACEMENT_BRANCH_NOT_FOUND`）。

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
