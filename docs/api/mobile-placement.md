# 配膳スマホ API（mobile-placement）

最終更新: 2026-05-24（**棚マスタ編集 UI**: Zero2W **インライン Pi セレクト** + **地図外 preset 解除** — [KB-382](../knowledge-base/KB-382-mobile-placement-shelf-layout-master.md)）／2026-05-24（**`PUT …/preset-shelf` の `shelfCodeRaw: null` 解除** — `feat/kiosk-shelf-master-zero2w-inline-preset`）／2026-05-23（**V22 棚レイアウトマスタ**・`shelf-layout` / `relocate` / `client-capabilities` / `machine-masters`・`displayLabel`・`shelfLayoutEditEnabled`）／2026-04-13（**V18 棚マスタ `MobilePlacementShelf`**・`GET/POST registered-shelves` 正本切替・`POST /mobile-placement/shelves`）／2026-04-12（**V16 部品名検索**・**V14 分配枝**・`OrderPlacementBranchState`／履歴は `OrderPlacementEvent` + `branchNo` / `actionType`）／2026-05-04（Zero2W 配膳 `haizen-*` API・`HaizenScanEvent` / `HaizenCurrentPlacement`）／**2026-05-07（`ClientDevice.haizenEdgeEnabled`・キオスク `/zero2w-status`・分配モード `HAIZEN_DISTRIBUTION_MODE`）**

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
- **V22 追加（任意）**: `displayLabel`, `macroZoneId`, `tier`（4 セグメント `西-北-02-1` 形式のときパース結果と一致）

### `GET /api/mobile-placement/client-capabilities`

キオスク UI のモード切替用。**`x-client-key`** 必須。

```json
{
  "shelfLayoutEditEnabled": false,
  "haizenEdgeEnabled": true
}
```

### `GET /api/mobile-placement/machine-masters`

区画レイアウト編集の加工機選択肢（`ProductionScheduleResourceMaster`）。

```json
{
  "machines": [{ "resourceCd": "...", "resourceName": "Robodrill01" }]
}
```

### `GET /api/mobile-placement/shelf-layout`

9 マクロ区画のサマリ（`gridSize`・棚/加工機件数）。

### `GET /api/mobile-placement/shelf-layout/zones/:macroZoneId`

区画詳細（`entities[]`・`zero2wDeviceCountByShelfCode`）。`:macroZoneId` は `nw` | `n` | `ne` | `w` | `c` | `e` | `sw` | `s` | `se`。

### `PUT /api/mobile-placement/shelf-layout/zones/:macroZoneId`

区画レイアウト一括更新。**`ClientDevice.shelfLayoutEditEnabled === true`** の端末のみ（403）。Body: `{ gridSize: 3|4, expectedUpdatedAt?, entities: [...] }`。

### `POST /api/mobile-placement/shelves/:shelfCodeRaw/relocate`

稼働データの棚間移動（再割当）。Body: `{ targetShelfCodeRaw }`。`OrderPlacementBranchState` / `HaizenCurrentPlacement` / Zero2W preset を更新。

### `POST /api/mobile-placement/shelves`

棚マスタへ **新規の棚番**を登録する（互換維持。**V22 以降は `/kiosk/mobile-placement/shelf-master` 推奨**）。**`西-北-01` 形式（構造化棚）のみ**受け付ける。重複は **409**。

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

移動票・現品票それぞれについて、日程行または購買照会の行を解決し、**同一の `FSEIBAN` + `FHINCD` ペア**か判定する（副作用なし）。

- **移動票**: `transferOrderBarcodeRaw` を **ProductNo** として `listScheduleRowsByProductNo` と同系で解決。
- **現品票**:  
  - `actualOrderBarcodeRaw` が **空でない**ときは **ProductNo**（製造order番号）で先に解決。未解決で前後空白を除いた値が10桁数字なら、購買照会と共通の読取で `PurchaseOrderLookupRow.purchaseOrderNo` を検索する。
  - 注文番号の候補のうち、製番が移動票の `FSEIBAN` と一致（前後空白・大文字小文字を無視）し、`purchasePartCodeMatchKey` が移動票の `FHINCD` の照合キーと一致する行が必要。キーは購買照会と同じ括弧内表記・末尾数値枝番の除去を使う。単一候補でも一致検査を省略しない。
  - 注文番号に行があってもペアが一致しなければ `FSEIBAN_OR_PART_PAIR_MISMATCH`、どちらの検索でも見つからなければ `ACTUAL_ORDER_UNRESOLVED`。
  - **空**のときは `actualFseibanRaw` を **FSEIBAN** として `listScheduleRowsByFseiban` と同系で解決。  
  - **`actualOrderBarcodeRaw` と `actualFseibanRaw` の少なくとも一方が必須**（両方空は 400）。
- 部品側のスキャンは **`actualPartBarcodeRaw`**（FHINBAN バーコード等。日程行の `FHINCD` と照合）。

JSON:

```json
{
  "transferOrderBarcodeRaw": "移動票の製造order番号（1次元）",
  "transferPartBarcodeRaw": "移動票のFHINBAN/FHINCD（1次元）",
  "actualOrderBarcodeRaw": "現品票の注文番号または製造order番号（1次元または空）",
  "actualFseibanRaw": "現品票の製番 FSEIBAN（任意。製造orderが空のときに使用）",
  "actualPartBarcodeRaw": "現品票のFHINBAN/FHINCD（1次元）"
}
```

応答: `{ "ok": true }` または `{ "ok": false, "reason": "..." }`（`reason` はサーバ内部コード文字列）。解決経路が判明した場合は成功・失敗とも任意フィールド `actualResolvedBy: "productNo" | "purchaseOrder" | "fseiban"` を返す。注文番号経由でも、両票の部品バーコード検査は従来どおり行う。

### `POST /api/mobile-placement/parse-actual-slip-image`

現品票の**撮影画像**を OCR し、製造order（10桁）と製番（FSEIBAN）の**候補**を返す（副作用なし）。UI は候補を確認し、必要に応じて手修正してから `verify-slip-match` を呼ぶ。

- **Content-Type**: `multipart/form-data`
- **フィールド名**: `image`（JPEG / PNG / WebP）。
- **OCR 実装（V12・2026-04-12）**: `tesseract.js`（`ImageOcrPort`）。**紙現品票の固定レイアウト前提**で、前処理後画像を **正規化座標 ROI**（`genpyo-slip/genpyo-slip-template.ts` の `DEFAULT_GENPYO_SLIP_ROIS`）で切り出し、**領域ごとに** `actualSlipLabels` プロファイルで OCR する。**製造order**は **右上ヘッダ ROI（`moHeader`）を優先**し、欠落時のみ **下段 ROI（`moFooter`）** を参照。**製番（FSEIBAN）**は **左中盤 ROI（`fseibanMain`）** のみから抽出。フィールド確定は `genpyo-slip-resolver.ts` が `parseManufacturingOrder10Extraction` / `extractFseiban`（実装は `genpyo-slip/*`・`actual-slip-identifier-parser` は再エクスポートで互換）を呼ぶ。**V10**: 製造ラベル近傍の **10文字トークン**で **`O`/`I`/`l`/`|` と数字の誤認**を限定補正。**V11**: 同一行に **注文番号**と**枝番**がある行の 10 桁除外・**global-filter** 選別は **ROI 内テキスト**に対して従来どおり適用。**旧パイプライン（labels 早期終了・3 パス直列・二値化 `preprocessBytesBinary`）は V12 で置換**（履歴として V7〜V11 の説明は KB-339 を参照）。テスト用に `IMAGE_OCR_STUB_TEXT` を設定すると **各 ROI で同一固定テキスト**を返すスタブに切り替え可能。

応答例:

```json
{
  "engine": "tesseract.js",
  "ocrText": "…",
  "ocrPreviewSafe": "0002178005 BE1N9321",
  "manufacturingOrder10": "0002178005",
  "fseiban": "BE1N9321",
  "fseibanRaw": "8E1N9321",
  "fseibanMatch": "corrected",
  "fseibanCandidates": ["BE1N9321"]
}
```

- **`ocrText`**: **ROI ごとの OCR 結果**を `[moHeader]` / `[fseibanMain]` / `[moFooter]` 見出しで連結（デバッグ・後追い用。ログは文字数のみ）。
- **`ocrPreviewSafe`**: **確定した** `manufacturingOrder10` と `fseiban` を短く結合したプレビュー（いずれか欠ける場合は片方のみ）。クライアントは表示にこれを優先し、無い場合は `ocrText` にフォールバック可能。
- **`fseibanRaw`**: 補正前の既存OCR抽出値（string | null）。`ocrPreviewSafe` も補正前の抽出値を維持する。
- **`fseibanMatch`**: `exact` / `corrected` / `ambiguous` / `none`。`fseibanCandidates` は近い順に最大3件。`exact` / `corrected` のとき `fseiban` は日程の製番、それ以外は従来の抽出値を返す。
- **補正規則**: 既存抽出値と `fseibanMain` ROI の6〜10文字英数字トークンを正規化（全角→半角、大文字化、空白・ハイフン・アンダースコア除去）。同一ダッシュボード・max ProductNo勝者条件の非空製番を重複除去して取得し、5分キャッシュする。
  完全一致を最優先。最良距離0.6以内（類似文字の置換2文字まで、挿入・削除なし）かつ次点との差0.5以上で自動補正。
  移動票の製番は補正のヒントに**使わない**（別の製番を移動票側へ寄せて誤ってOKにしないため。照合は `verify-slip-match` が行う）。最良距離2.0以内なら `ambiguous` として2.0以内の候補を最大3件提示し、UIで選択する。それ以外は `none`。
  距離は重み付きLevenshtein（挿入・削除・通常置換1、類似文字置換0.3）。類似群は `0ODQ / 1IL / 2Z / 5S / 8B / 6G / UV`（7・3・4・M/N/H など実在製番どうしで取り違えると危険な組は含めない）。長さ差2超は除外する。
- **取得失敗**: 警告ログを記録し、`fseibanMatch: none`・候補空配列で従来のOCR値を返す。追加ログは判定種別・候補件数のみで、OCR本文を記録しない。
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

### キオスク「配膳の場所」と `GET /api/mobile-placement/haizen-overview`

在庫画面の「配膳の場所」から `/kiosk/inventory/haizen` を開く。登録済み棚を棚コード順に外観写真・件数・製番・品名で表示し、空の棚は「空き」として薄く表示する。写真サイズは小／中／大。棚を押すと左に写真、右に新しく置いた順の部品詳細と、同じ製造オーダーの別枝がある棚へのリンクを表示する。在庫タブ配下で動作する。過去の枝が現在の棚マスタにない棚を参照する場合も、「棚マスタ未登録」の写真なしカードとして場所を確認できる。

番号検索は機種名／品番／製番のキー入力・候補選択に対応し、全角英数字、大小文字、ハイフン、空白の違いを吸収する。1棚だけに一致した場合はその棚を直接開く。音声検索は既存のキオスク音声経路を利用し、「製番 BA1S2320」「品番 K0381」「機種 RV-12A」の先頭語で種類を選ぶ。先頭語がなければ製番→品番→機種名の順で照合する。機種名は半角表示、マイクや音声認識が使えないときは番号検索を案内する。棚・配膳情報は60秒ごとに再取得し、更新時刻を表示する。経過日数による強調や区画フィルタは設けない。

**新規API** は `x-client-key` 必須の読み取り専用で、クエリ不要。応答は `{ rows, truncated }`。`rows[]` は `id`、`shelfCodeRaw`、`manufacturingOrderBarcodeRaw`、`branchNo`、`fseiban`（FSEIBAN）、`fhincd`（FHINCD）、`fhinmei`（FHINMEI）、`machineName`、ISO形式の `updatedAt` を返す。品目文字列が欠けていれば `null`。機種名は既存の製番バッチ解決（MH/SH→補完→未登録表示）を使用する。更新日時降順・同時刻はID順で最大3,000枝を返し、超過時は `truncated: true`。画面も取得範囲が限定された旨を表示するため、この場合の検索結果・空き表示は全件を保証しない。

**現在棚の正本**はAndroidの `register-order-placement` / `move-order-placement-branch` が更新する `OrderPlacementBranchState`。`HaizenCurrentPlacement` は下記Zero2W専用の製造オーダー単位の別系統であり、枝番を失う・二重計上することを避けるため混ぜない。既存 `haizen-current` の契約は変更しない。

### Zero 2 W 配膳追跡（専用。`OrderPlacementBranchState` とは別テーブル）

**目的**: 棚番固定エッジ（1 台 1 棚）からのスキャンで、**製造 order ごとの現在値**（`HaizenCurrentPlacement`）を上書きしつつ、**履歴**（`HaizenScanEvent`）を残す。日程行は `listScheduleRowsByProductNo` 系で解決。未照合でもイベント・現在値は保存される（`resolutionStatus` / `csvDashboardRowId` で区別）。

- **`GET /api/mobile-placement/haizen-preset-shelf`** — 認証端末の **`ClientDevice.haizenPresetShelfCodeRaw`**（構造化棚 `西-北-01` 形式）を返す。未設定は `{ "shelfCodeRaw": null }`。
- **`PATCH /api/mobile-placement/haizen-preset-shelf`** — Body `{ "shelfCodeRaw": "西-北-01" }` でプリセット更新（構造化棚のみ）。**棚マスタ（`MobilePlacementShelf`）に登録済みの棚のみ**許可（未登録は `HAIZEN_PRESET_SHELF_NOT_REGISTERED`）。
- **`POST /api/mobile-placement/haizen-scans`** — Body 例: `{ "manufacturingOrderBarcodeRaw": "…", "distributionNumber": 1, "rawBarcode": "…" }`。分配番号は **1〜999 の整数**（省略可）。エージェント側では **`HAIZEN_DISTRIBUTION_MODE`**（既定は単独整数ヒューリスティック／省略時 **`legacy_short_numeric`**）で入力規則が変わる。**プリセット棚が未設定なら 400**（`HAIZEN_PRESET_SHELF_REQUIRED`）。
- **`GET /api/mobile-placement/haizen-current`** — クエリ **`shelfCodeRaw`**（推奨）または **`shelfCode`**（後方互換・同等）、`limit`（1〜200、既定 50）。**棚パラメータ省略時は全棚から最新 N 件**。応答 `rows[]` に製造 order・棚・分配・日程スナップショット由来の品目表示・`resolutionNote`（`RESOLVED` | `UNRESOLVED`）。
- **`GET /api/mobile-placement/haizen-target-devices`** — Android キオスクの専用設定画面向け。**`ClientDevice.haizenEdgeEnabled === true` の端末だけ**を返す。各要素は `id` / `name` / `location` / `shelfCodeRaw` / `lastSeenAt`。
- **`PUT /api/mobile-placement/haizen-target-devices/:clientDeviceId/preset-shelf`** — **対象 Zero2W** の担当棚を更新する。Body `{ "shelfCodeRaw": "西-北-01" }` または **`{ "shelfCodeRaw": null }` で担当解除**（空文字は不可）。非 null のとき **棚マスタに登録済みの構造化棚のみ**許可し、対象が **`haizenEdgeEnabled` 無効**の場合はエラー。**呼び出し元**: (1) Android エージェント／旧専用設定画面、(2) **棚マスタ編集 Dialog**（`/kiosk/mobile-placement/shelf-master` — **担当を反映** または **地図外担当パネルの「担当を外す」**）。**フラグの付け替え**は **管理画面「クライアント端末管理」** または **`PUT /api/clients/:id`**（`haizenEdgeEnabled`）。

**キオスク棚マスタ UI（API ではなく Web）**: preset が **当区画レイアウトの SHELF 一覧に無い**とき、編集 Dialog に **「この区画の地図にない担当棚」** を表示し、上記 **PUT + `null`** で端末単位解除する（**`bd4ab988`** 以降）。詳細は [KB-382 §オーファン](../knowledge-base/KB-382-mobile-placement-shelf-layout-master.md#orphan-zero2w-preset-clear-2026-05-24)。

**クライアント**: `clients/haizen-agent/`（HID → POST）。**ナレッジ**: [KB-368](../knowledge-base/KB-368-zero2w-haizen-placement-tracking.md)・[KB-382](../knowledge-base/KB-382-mobile-placement-shelf-layout-master.md)。

## 関連

- Runbook: [mobile-placement-smartphone.md](../runbooks/mobile-placement-smartphone.md)
- Zero 2 W エッジ: [zero2w-tanaban-edge-setup.md](../runbooks/zero2w-tanaban-edge-setup.md)
- バーコード調査: [KB-339](../knowledge-base/KB-339-mobile-placement-barcode-survey.md)
