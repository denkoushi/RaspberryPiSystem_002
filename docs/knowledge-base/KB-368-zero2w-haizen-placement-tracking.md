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
- Top 上辺の **「Zero2W担当棚」** から **`/kiosk/mobile-placement/zero2w-assignment`** へ遷移し、**Zero2W 候補端末**に **棚マスタの登録済み構造化棚**を割り当てる。
- Top 上の **「棚番配膳（Zero2W）」** パネル自体は、選択中の棚で一覧を絞り込む **表示専用パネル**のまま維持する。

## エッジエージェント

- **`clients/haizen-agent/`**: `evdev` または stdin フォールバック、分配番号ゲート、分類、HTTP POST。
- **注意**: 分配番号は **短い数値スキャンをヒューリスティック**で認識する。現場のチケット／スキャン値と **衝突し得る**ため、ログとサンプルで早期に正規化を確認すること（README 参照）。

## 調査・テスト

- API サービス: `apps/api/src/services/mobile-placement/__tests__/haizen-placement.service.test.ts`（Vitest）。
- エージェント: `clients/haizen-agent/tests/`（pytest）。

## 実機検証（2026-05-04・工場 Pi5 + Zero2W `zero2w-tanaban01`）

**前提**: Pi5 に当該機能ブランチ相当がデプロイ済み（API に `haizen-*` ルート・Prisma マイグレーション適用済み）。`ClientDevice` の `apiKey` がインベントリ断片の `status_agent_client_key`（例: `client-key-zero2w-tanaban01-edge1`）と一致。

1. **Pi5 上**（自己署名 TLS のため `-k` 相当）で **棚プリセット**を設定する。  
   `PATCH /api/mobile-placement/haizen-preset-shelf`、ボディ `{ "shelfCodeRaw": "西-北-01" }`、ヘッダ `x-client-key: <端末の apiKey>`。  
   **200** で `shelfCodeRaw` が返ること。

2. 同じキーで **スキャン相当**の POST。  
   `POST /api/mobile-placement/haizen-scans`、例 `{ "manufacturingOrderBarcodeRaw": "E2E-HAIZEN-20260504", "rawBarcode": "E2E-HAIZEN-20260504" }`。  
   **200**、`resolutionStatus` が `RESOLVED` または `UNRESOLVED`（日程未一致時は後者で正常）、`current` に同梱されること。

3. **一覧**: `GET /api/mobile-placement/haizen-current?shelfCode=<URLエンコードした棚>&limit=5` で **当該製造 order 行が返る**こと。

4. **Zero 側**: `systemctl is-enabled haizen-agent.service` / `is-active` が **enabled / active**、`journalctl -u haizen-agent.service` に **`haizen-agent start base=https://… hid=…`** の起動ログがあること（`/dev/input/by-id/...-event-kbd` 等。README 参照）。

**知見**: キオスク（Android）の `x-client-key` で既存 self API をそのまま叩くと **別端末のキーで誤設定**しうるため、**Top の配膳パネルは表示専用**に保ち、**専用ページ + 対象 Zero2W 指定 API** に分離した。

**トラブル**: Zero のリポジトリが **`main` のまま**だと `clients/haizen-agent` が無く `WorkingDirectory` の **CHDIR 失敗**で `haizen-agent` がループする。**対処**: Pi5 で `ANSIBLE_REPO_VERSION=feat/zero2w-haizen-tracking`（マージ後は `main`）を指定して `zero2w-edge-setup.yml` を再実行する。設定ファイル **`/etc/raspi-haizen-agent.conf` を `root` の `600` のまま**にすると当該サービス実行ユーザーが読めず **PermissionError**。**対処**: `chown root:<haizen 実行ユーザー>` と **`chmod 640`**（[KB-367](./KB-367-zero2w-tanaban-edge-tailscale-ansible.md)・Runbook）。

## References

- Runbook: [mobile-placement-smartphone.md](../runbooks/mobile-placement-smartphone.md)（curl 例・UI 節）
- Zero 2 W セットアップ: [zero2w-tanaban-edge-setup.md](../runbooks/zero2w-tanaban-edge-setup.md)
- 既存配膳経路: [KB-339](./KB-339-mobile-placement-barcode-survey.md)
