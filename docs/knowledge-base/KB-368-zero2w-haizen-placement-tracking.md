---
title: 'KB-368: Zero 2 W 配膳追跡（haizen API・エージェント・キオスク表示）'
tags: [Zero2W, mobile-placement, 配膳, HID, API]
audience: [開発者, 運用者]
last-verified: 2026-05-05
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
| PATCH | `/api/mobile-placement/haizen-preset-shelf` | `{ "shelfCodeRaw": "西-北-01" }`。**棚マスタ未登録棚は拒否**（`HAIZEN_PRESET_SHELF_NOT_REGISTERED`）。キオスク経由の target 更新と **同一のマスタ規則** |
| POST | `/api/mobile-placement/haizen-scans` | `{ "manufacturingOrderBarcodeRaw", "distributionNumber?", "rawBarcode?" }` |
| GET | `/api/mobile-placement/haizen-current` | クエリ **`shelfCodeRaw`**（推奨）または **`shelfCode`**（後方互換）、`limit?`（省略時は全棚から最新 N 件） |
| GET | `/api/mobile-placement/haizen-target-devices` | キオスク設定用。**`apiKey` または `name` に `zero2w` を含む** `ClientDevice` のみ。要素は `id` / `name` / `location` / `shelfCodeRaw` / `lastSeenAt`（**`apiKey` は返さない**） |
| PUT | `/api/mobile-placement/haizen-target-devices/:clientDeviceId/preset-shelf` | `{ "shelfCodeRaw" }`。**対象は上記と同様の Zero2W 候補に限定**。**棚マスタ未登録棚は拒否**（`HAIZEN_PRESET_SHELF_NOT_REGISTERED`） |

仕様の詳細: [api/mobile-placement.md](../api/mobile-placement.md)

## キオスク（Android 向け配膳 Web）

- **`/kiosk/mobile-placement`** に **「棚番配膳（Zero2W）」**パネル（`MobilePlacementHaizenPanel`）。
- Top 上辺の **「Zero2W担当棚」** から **`/kiosk/mobile-placement/zero2w-assignment`** へ遷移し、**Zero2W 候補端末**に **棚マスタの登録済み構造化棚**を割り当てる。
- Top 上の **「棚番配膳（Zero2W）」** パネル自体は、選択中の棚で一覧を絞り込む **表示専用パネル**のまま維持する。

## エッジエージェント

- **`clients/haizen-agent/`**: `evdev` または stdin フォールバック、分配番号ゲート、分類、HTTP POST。Ansible は **`roles/client/tasks/haizen-agent.yml`**（`haizen_agent_enabled`）で **unit + `/etc/raspi-haizen-agent.conf`** を配布。
- **TLS**: 設定 **`HAIZEN_TLS_VERIFY_MODE`**（`insecure` \| `system`）と、互換の **`TLS_SKIP_VERIFY`**（`1` = 検証スキップ）。運用は [zero2w-tanaban-edge-setup.md](../runbooks/zero2w-tanaban-edge-setup.md) 参照。
- **注意**: 分配番号は **短い数値スキャンをヒューリスティック**で認識する。現場のチケット／スキャン値と **衝突し得る**ため、ログとサンプルで早期に正規化を確認すること（クライアント README 参照）。

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

3. **一覧**: `GET /api/mobile-placement/haizen-current?shelfCodeRaw=<URLエンコードした棚>&limit=5`（後方互換として **`shelfCode=`** も可）で **当該製造 order 行が返る**こと。

4. **Zero 側**: `systemctl is-enabled haizen-agent.service` / `is-active` が **enabled / active**、`journalctl -u haizen-agent.service` に **`haizen-agent start base=https://… hid=…`** の起動ログがあること（`/dev/input/by-id/...-event-kbd` 等。README 参照）。

**知見**: キオスク（Android）の `x-client-key` で既存 self API をそのまま叩くと **別端末のキーで誤設定**しうるため、**Top の配膳パネルは表示専用**に保ち、**専用ページ + 対象 Zero2W 指定 API** に分離した。

## 本番デプロイ・広域検証（2026-05-04 evening・Pi5 のみ）

- **変更**: キオスク **Zero2W 担当棚** ページ・`haizen-target-devices` / `…/preset-shelf` API（一覧はブラウザへ **`apiKey` を載せない**）。
- **標準デプロイ**: [deployment.md](../guides/deployment.md)。**対象インベントリ名**: **`raspberrypi5` のみ**（`./scripts/update-all-clients.sh <ref> infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`）。**Pi4／Pi3 は当該 play にマッチしない**ため **個別 Pi3 手順は不要**。
- **実績**: **`main`** へ fast-forward **`8c2dfbf4`**（実装基底 **`153af161`**）。**Detach Run ID** **`20260504-183939-27983`**（**`PLAY RECAP` `ok=134` `changed=4` `failed=0` / `unreachable=0`**・リモート exit **`0`**）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（所要 **約 95s**・Tailscale）。
- **実機（手動・任意）**: キオスク URL で **`/kiosk/mobile-placement/zero2w-assignment`** を開き **4 つ目ボタン**の有無を確認。Android で **古いバンドル**が残る場合は [verification-checklist.md](../guides/verification-checklist.md) §6.6.4 の **強制リロード**。API スモーク: キオスクの `x-client-key` で `GET /api/mobile-placement/haizen-target-devices` が **200**（候補は DB 次第で 0 件もあり得る）。
- **トラブルシュート**
  - **候補端末が常に 0 件**: `ClientDevice` の **`name` または `apiKey` に `zero2w`（大小無視）** が含まれるかを確認（抽出ルールは API 実装の正本）。
  - **保存が 400 `HAIZEN_PRESET_SHELF_NOT_REGISTERED`**: 選択棚が **`MobilePlacementShelf` 未登録**。既存の棚番登録フロー（`POST /api/mobile-placement/shelves`）でマスタ投入後に再試行。
  - **保存が 400 `HAIZEN_TARGET_DEVICE_INVALID`**: 指定 `clientDeviceId` が Zero2W 候補に当てはまらない（一覧外の ID を直接叩いていないか）。

**トラブル**: Zero のリポジトリが **`main` のまま**だと `clients/haizen-agent` が無く `WorkingDirectory` の **CHDIR 失敗**で `haizen-agent` がループする。**対処**: Pi5 で `ANSIBLE_REPO_VERSION=feat/zero2w-haizen-tracking`（マージ後は `main`）を指定して `zero2w-edge-setup.yml` を再実行する。現行標準の Ansible 配備では設定ファイルは **`/etc/raspi-haizen-agent.conf` = `root:root` + `640`**。**独自に非 root 実行へ変えている場合のみ**、その実行ユーザーが読める最小権限へ調整する（[KB-367](./KB-367-zero2w-tanaban-edge-tailscale-ansible.md)・Runbook）。

## 本番ロールアウト記録（2026-05-05 · **`feat/zero2w-haizen-edge-hardening`**）

- **Pi5（標準 `update-all-clients.sh`）**: **`raspberrypi5` のみ**・**Detach Run ID** **`20260505-201203-6644`**（**`PLAY RECAP` `ok=134` `changed=4` `failed=0` / `unreachable=0`**・exit **`0`**）。ブランチ先端検証時の代表コミット **`1237f37a`**。**CI**: GitHub Actions **`25372469180`** **success**。
- **広域自動検証**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（**約 102s**）。
- **Zero2W `zero2w-tanaban01`**:
  - 初回: `ansible_host` への SSH `:22 Connection timed out` で `UNREACHABLE`。
  - 復旧: 端末再起動後に Pi5 から `ssh` と `ansible ping` が復旧。
  - 追加トラブル: `zero2w-edge-setup.yml` 再実行時に **`Missing sudo password`**。また `haizen_agent_hid_device` 未指定で `hid=stdin` 起動となり `haizen-agent.service` が `inactive`。
  - 対処: `-e ansible_become_password='...'` を付与し、断片インベントリへ **`haizen_agent_hid_device: /dev/input/by-id/usb-TMC_HIDKeyBoard_1234567890abcd-event-kbd`** を追記して再実行。
  - 最終: playbook **成功**（`ok=81 changed=11 failed=0 unreachable=0`）、`haizen-agent.service` / `status-agent.timer` とも **active + enabled**。
- **Zero2W E2E（Pi5 実行）**: `PATCH /api/mobile-placement/haizen-preset-shelf` → `POST /api/mobile-placement/haizen-scans` → `GET /api/mobile-placement/haizen-current?shelfCodeRaw=西-北-01&limit=5` で、Zero2W キー (`client-key-zero2w-tanaban01-edge1`) の新規イベント (`eventId`) と `rows` 反映を確認。`UNRESOLVED` は日程未一致時の契約どおり。

## References

- Runbook: [mobile-placement-smartphone.md](../runbooks/mobile-placement-smartphone.md)（curl 例・UI 節）
- Zero 2 W セットアップ: [zero2w-tanaban-edge-setup.md](../runbooks/zero2w-tanaban-edge-setup.md)
- 既存配膳経路: [KB-339](./KB-339-mobile-placement-barcode-survey.md)
