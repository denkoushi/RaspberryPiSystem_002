---
title: 'KB-368: Zero 2 W 配膳追跡（haizen API・エージェント・キオスク表示）'
tags: [Zero2W, mobile-placement, 配膳, HID, API]
audience: [開発者, 運用者]
last-verified: 2026-05-04
category: knowledge-base
---

# KB-368: Zero 2 W 配膳追跡（haizen API・エージェント・キオスク表示）

## Context

- Zero 2 W は **1 台 1 棚番**前提で、USB HID バーコードリーダーから **製造 order（＋任意で分配番号）**を Pi 5 API へ送る。
- 既存の **分配枝**（`OrderPlacementBranchState`）とは **別モデル**で、Zero2W 専用に **現在値**と**履歴**を分離して保持する。

## データ（Prisma）

- **`HaizenScanEvent`**: 1 スキャン 1 行の履歴（端末・プリセット棚・製造 order・分配・日程解決結果など）。
- **`HaizenCurrentPlacement`**: **`manufacturingOrderBarcodeRaw` を一意キー**とする最新行（棚・分配・日程スナップショットを上書き）。
- **`ClientDevice.haizenPresetShelfCodeRaw`**: 端末に紐づく **構造化棚**（`西-北-01` 形式）。`POST …/haizen-scans` の前に必須。

## API（すべて `x-client-key`）

| メソッド | パス | 説明 |
|--------|------|------|
| GET | `/api/mobile-placement/haizen-preset-shelf` | 端末の棚プリセット取得 |
| PATCH | `/api/mobile-placement/haizen-preset-shelf` | `{ "shelfCodeRaw": "西-北-01" }` |
| POST | `/api/mobile-placement/haizen-scans` | `{ "manufacturingOrderBarcodeRaw", "distributionNumber?", "rawBarcode?" }` |
| GET | `/api/mobile-placement/haizen-current` | `shelfCode?`, `limit?`（省略時は全棚から最新 N 件） |

仕様の詳細: [api/mobile-placement.md](../api/mobile-placement.md)

## キオスク（Android 向け配膳 Web）

- **`/kiosk/mobile-placement`** に **「棚番配膳（Zero2W）」**パネル（`MobilePlacementHaizenPanel`）。
- 選択中の棚で一覧を絞り込む **表示専用パネル**。棚番プリセット更新は **対象端末の `x-client-key`** で `PATCH /api/mobile-placement/haizen-preset-shelf` を実行する。

## エッジエージェント

- **`clients/haizen-agent/`**: `evdev` または stdin フォールバック、分配番号ゲート、分類、HTTP POST。
- **注意**: 分配番号は **短い数値スキャンをヒューリスティック**で認識する。現場のチケット／スキャン値と **衝突し得る**ため、ログとサンプルで早期に正規化を確認すること（README 参照）。

## 調査・テスト

- API サービス: `apps/api/src/services/mobile-placement/__tests__/haizen-placement.service.test.ts`（Vitest）。
- エージェント: `clients/haizen-agent/tests/`（pytest）。

## References

- Runbook: [mobile-placement-smartphone.md](../runbooks/mobile-placement-smartphone.md)（curl 例・UI 節）
- Zero 2 W セットアップ: [zero2w-tanaban-edge-setup.md](../runbooks/zero2w-tanaban-edge-setup.md)
- 既存配膳経路: [KB-339](./KB-339-mobile-placement-barcode-survey.md)
