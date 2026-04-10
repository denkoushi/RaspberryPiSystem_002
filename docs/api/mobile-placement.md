# 配膳スマホ API（mobile-placement）

最終更新: 2026-04-10

## 概要

Android スマホ等から、**生産スケジュール行の選択（任意）**と **棚番・アイテムバーコード**による **`Item.storageLocation` 更新**と **履歴（`MobilePlacementEvent`）** を行う。

すべて **`x-client-key`**（登録済み `ClientDevice.apiKey`）必須。

## エンドポイント

### `GET /api/mobile-placement/schedule`

キオスクの `GET /api/kiosk/production-schedule` と同一のクエリパラメータ。

### `GET /api/mobile-placement/resolve-item?barcode=...`

`Item.itemCode` を **大文字小文字無視**で検索。突合ロジックの調査は [KB-339](../knowledge-base/KB-339-mobile-placement-barcode-survey.md)。

### `POST /api/mobile-placement/register`

JSON:

```json
{
  "shelfCodeRaw": "棚ラベルのスキャン値",
  "itemBarcodeRaw": "工具ラベル（Item.itemCode と一致すること）",
  "csvDashboardRowId": "任意。選択したスケジュール行の id（CsvDashboardRow）"
}
```

`csvDashboardRowId` 指定時は、スキャン値が当該行の `ProductNo` / `FSEIBAN` / `FHINCD` のいずれか、または解決済み `itemCode` と一致すること。

## 関連

- Runbook: [mobile-placement-smartphone.md](../runbooks/mobile-placement-smartphone.md)
- バーコード調査: [KB-339](../knowledge-base/KB-339-mobile-placement-barcode-survey.md)
