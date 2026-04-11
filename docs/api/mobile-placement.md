# 配膳スマホ API（mobile-placement）

最終更新: 2026-04-11

## 概要

Android スマホ等から、**移動票・現品票の照合**および **製造order番号起点の部品配膳履歴（`OrderPlacementEvent`）** を行う。従来の **工具 `Item.storageLocation` 更新**（`MobilePlacementEvent`）API も併存する。

すべて **`x-client-key`**（登録済み `ClientDevice.apiKey`）必須。

## エンドポイント

### `GET /api/mobile-placement/schedule`

キオスクの `GET /api/kiosk/production-schedule` と同一のクエリパラメータ。

### `GET /api/mobile-placement/registered-shelves`

部品配膳の **`OrderPlacementEvent` に登場した `shelfCodeRaw` の distinct 一覧**を返す（読み取り専用）。UI の「登録済み棚番」候補用。

各要素:

- `shelfCodeRaw`: 保存値そのまま
- `isStructured`: `西-北-02` のように **エリア・列・番号（2桁）** を `-` で3分割できた場合 `true`
- `isStructured === true` のときのみ: `areaId`（`west` | `central` | `east`）、`lineId`（`north` | `central` | `south`）、`slot`（1..99）

### `POST /api/mobile-placement/verify-slip-match`

移動票・現品票それぞれについて、**製造order番号（ProductNo）** と **FHINMEI** のスキャン値から生産スケジュール行を解決し、**同一の `FSEIBAN` + `FHINMEI` ペア**か判定する（副作用なし）。

JSON:

```json
{
  "transferOrderBarcodeRaw": "移動票の製造order番号（1次元）",
  "transferFhinmeiBarcodeRaw": "移動票のFHINMEI（1次元）",
  "actualOrderBarcodeRaw": "現品票の製造order番号（1次元）",
  "actualFhinmeiBarcodeRaw": "現品票のFHINMEI（1次元）"
}
```

応答: `{ "ok": true }` または `{ "ok": false, "reason": "..." }`（`reason` はサーバ内部コード文字列）。

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
