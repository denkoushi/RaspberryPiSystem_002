# 配膳スマホ（Android）セットアップ・検証 Runbook

最終更新: 2026-04-11（現品票画像 OCR・FSEIBAN 照合）

## 0. 本番デプロイ後の確認（運用）

**対象ホスト（配膳 API/SPA を反映する最小セット）**: `raspberrypi5` → 各 Pi4 キオスク（`raspberrypi4`・`raspi4-robodrill01`・`raspi4-fjv60-80`・`raspi4-kensaku-stonebase01`）。**Pi3 サイネージは必須ではない**（本機能は `/kiosk/...`）。手順は [deployment.md](../guides/deployment.md) の **`update-all-clients.sh`**。複数台のときは **inventory のホストを `--limit` で 1 台ずつ**（例: `--detach --follow` または `--foreground`）。**2026-04-11（V2）**: ブランチ **`feat/mobile-placement-order-based-flow`** を上記順で反映済み（Mac 側サマリ例: `logs/ansible-update-20260411-093207.summary.json` ほか5本・各 `success: true`）。**2026-04-11（V3・棚番登録専用ページ）**: ブランチ **`feat/mobile-placement-shelf-register-page`**（コミット例 **`d18d3688`**）を同順で反映済み（Mac 側サマリ: `logs/ansible-update-20260411-122754.summary.json`（`raspberrypi5`）・`…-123258.summary.json`（`raspberrypi4`）・`…-123740.summary.json`（`raspi4-robodrill01`）・`…-124208.summary.json`（`raspi4-fjv60-80`）・`…-125020.summary.json`（`raspi4-kensaku-stonebase01`）、各 **`success: true`**）。**2026-04-11（V4・登録済み棚番一覧・フィルタ）**: ブランチ **`feat/mobile-placement-registered-shelves-ui`**（コミット例 **`43bc3fa7`**）を同順で反映済み（Mac 側サマリ: `logs/ansible-update-20260411-140348.summary.json`（`raspberrypi5`）・`…-141237.summary.json`（`raspberrypi4`）・`…-141659.summary.json`（`raspi4-robodrill01`）・`…-142020.summary.json`（`raspi4-fjv60-80`）・`…-142547.summary.json`（`raspi4-kensaku-stonebase01`）、各 **`success: true`**）。**2026-04-11（V5・現品票画像 OCR + FHINCD 照合）**: ブランチ **`feat/mobile-placement-actual-slip-image-ocr`**（コミット **`f7342dd3`**）。**Detach Run ID（Pi5→Pi4×4・順）**: `20260411-183841-16996` → `20260411-184924-28557` → `20260411-185416-11344` → `20260411-185819-3299` → `20260411-190608-28569`（各 Pi5 リモートログ **`Summary success check: true`**・`PLAY RECAP` **`failed=0`**）。**コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`・`./scripts/update-all-clients.sh feat/mobile-placement-actual-slip-image-ocr infrastructure/ansible/inventory.yml --limit <host> --detach --follow`。**Pi3** は本機能の必須対象外。**Phase12（本番反映後）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **55s**）。自動回帰はリポジトリ直下で `./scripts/deploy/verify-phase12-real.sh`。API の spot check（`x-client-key` は端末の `apiKey`）例:

**2026-04-11（V6・現品票 OCR 可観測性・UI 案内・パーサ強化）**: ブランチ **`feat/mobile-placement-ocr-debug-fix`**（コミット **`e6806d28`**）。**仕様**: 撮影 OCR 後に **成功／候補なし／エラー**を現品票列下に表示（無言失敗を解消）。API は **`parse-actual-slip-image` 完了時の構造化ログ**（入力・前処理バイト・OCR 文字数・候補有無・所要時間・`requestId` 相関。OCR 全文はログに出さない）。サーバは **桁間空白・O/0 等の限定補正**と **注文番号ブロックの単一候補でも誤採用しない**ガード。**Detach Run ID（Pi5→Pi4×4・順・Pi3 除外）**: `20260411-200637-30031` → `20260411-201900-24559` → `20260411-202426-10094` → `20260411-202844-23208` → `20260411-203518-31439`（各 **`Summary success check: true`**・`PLAY RECAP` **`failed=0`**）。**Phase12**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **85s**・Mac / Tailscale）。

```bash
curl -sk -X POST "https://<Pi5>/api/mobile-placement/verify-slip-match" \
  -H "Content-Type: application/json" -H "x-client-key: <key>" \
  -d '{"transferOrderBarcodeRaw":"…","transferPartBarcodeRaw":"…","actualOrderBarcodeRaw":"…","actualFseibanRaw":"","actualPartBarcodeRaw":"…"}'

# 登録済み棚（OrderPlacementEvent 由来の distinct。履歴が無いと { "shelves": [] }）
curl -sk "https://<Pi5>/api/mobile-placement/registered-shelves" -H "x-client-key: <key>"

# 現品票画像 OCR（multipart・JPEG/PNG/WebP）
curl -sk -X POST "https://<Pi5>/api/mobile-placement/parse-actual-slip-image" \
  -H "x-client-key: <key>" -F "image=@/path/to/slip.jpg"
```

## 前提

- Pi5 が稼働し、通常どおり **HTTPS** で API/Web が応答すること
- Android を **Tailscale** で Pi5 と同じ tailnet に参加させ、ACL で **`tag:server` の tcp:443** が端末から許可されていること（[tailscale-policy.md](../security/tailscale-policy.md)）
- 端末に **Chrome** を使用する

## 1. 端末登録（ClientDevice）

`POST /api/clients/heartbeat` で `apiKey` / `name` / `location` を登録する（型落ち Android タブレットのサイネージ手順と同じ）。詳細は [signage-client-setup.md](../guides/signage-client-setup.md#android-signage-lite)。

## 2. 疎通

1. `https://<Pi5-Tailscale-IP>/api/system/health` が JSON `status: ok` を返すこと
2. ブラウザで `https://<Pi5-Tailscale-IP>/kiosk/mobile-placement?clientKey=<apiKey>` を開くこと

## 3. 業務フロー（V2・既定）

**単一画面 `/kiosk/mobile-placement`**

**上半分（照合）**

1. 移動票: 製造order番号・**部品番号（FHINBAN/FHINCD）** を **1次元バーコード**でスキャン（または手入力）
2. 現品票: **部品番号（FHINBAN 等）** を **1次元バーコード**でスキャン（または手入力）
3. 現品票の **製造order番号** は印字または **「画像OCR」**で候補取得（**注文番号（9桁）と取り違えないよう**サーバ側パーサで抑制。候補は必ず目視確認）
4. 製造orderが読めない場合は **製番（FSEIBAN）** を手入力 or OCR 候補で埋める（**`actualOrderBarcodeRaw` 空 + `actualFseibanRaw` で日程解決**）
5. 「照合」で **OK / NG** を表示（サーバが `FSEIBAN` + `FHINCD` ペアを突合）

**下半分（配膳登録）**

1. 棚番: **`GET /api/mobile-placement/registered-shelves`** に基づく **エリア／列フィルタ**と候補一覧から選ぶか、**「棚番を選ぶ」**で **`/kiosk/mobile-placement/shelf-register`** に遷移し、**エリア → 列 → 番号**の3段階で確定（表示は `formatShelfCodeRaw` 由来の **`西-北-02`** 形式）。履歴に一度も出ていない棚は一覧に出ない（**`shelves` が空**は正常）。戻ると親画面の棚欄に反映される。従来どおり **TEMP-A〜D** の直接タップ、または **QR** で棚コードをスキャン（QR は棚のみ）も可
2. 移動票の **製造order番号**を **1次元**でスキャン
3. 「登録」→ `OrderPlacementEvent` 保存（**工具 `Item` は更新しない**）

旧 `/kiosk/mobile-placement/register` は `/kiosk/mobile-placement` へリダイレクトする。

## 4. 業務フロー（V1・工具配置・レガシー API）

一覧で行を選ぶ UI は廃止。API `POST /api/mobile-placement/register` は **互換のため維持**（工具 `Item.itemCode` と棚）。

1. **棚番**・**工具バーコード**・任意で **`csvDashboardRowId`**
2. `Item.storageLocation` と `MobilePlacementEvent`

## 5. トラブルシュート

- **401 / 無効なクライアントキー**: `heartbeat` 未登録、または `x-client-key` と URL の `clientKey` がずれている
- **ネットワーク不可**: Tailscale 未接続、ACL で 443 が拒否、Pi5 停止
- **照合 NG / reason**: 製造order番号がスケジュールに無い、**部品番号（FHINBAN/FHINCD）** が行と一致しない、両票の `FSEIBAN` が一致しない等。API 応答の `reason` を参照
- **部品配膳 404 `ORDER_PLACEMENT_SCHEDULE_NOT_FOUND`**: 製造order番号に紐づく `CsvDashboardRow` が見つからない（生産スケジュール CSV 側を確認）
- **工具登録 404（工具マスタに無い）**: `itemCode` とラベルを揃える（KB-339）
- **400 `MOBILE_PLACEMENT_SCHEDULE_MISMATCH`**: （V1 register）一覧行と工具スキャンが一致しない
- **棚番登録ページで戻ったあと値が空**: router state の復元失敗時は親 URL の `clientKey` とクエリを維持して `/kiosk/mobile-placement` を再読み込みする。Chrome で不整合が続く場合はサイトデータ削除（V1 節の heartbeat 系と同型の切り分け）
- **登録済み棚が常に空**: `OrderPlacementEvent` にまだ行が無いと **`registered-shelves` は `{ "shelves": [] }`**（不具合ではない）。部品配膳を1件でも登録すると `shelfCodeRaw` が候補に現れる
- **デプロイが `未commit変更` で止まる**: Mac 側に **未追跡ファイル**もブロック対象。`git stash push -u` またはコミットしてから [deployment.md](../guides/deployment.md) の `update-all-clients.sh` を再実行
- **画像OCRが遅い／初回だけ長い**: Pi5 API コンテナで **tesseract.js ワーカ初回起動**で数十秒かかることがある。連続利用ではキャッシュされやすい。現品票 OCR は **用途別に複数パス**（`jpn+eng` + `eng`×2）を **直列**で回すため、初回以外も **単一パス時より時間がかかる**場合がある。極端に大きい画像はサーバ側で縮小されるが、**ピント・コントラスト**を確保すると精度が上がる
- **画像OCR後に欄が空のまま／無反応に見える**: 撮影後、現品票列の下に **成功（抽出値の表示）／候補なし／エラー**のいずれかが出ること。候補なしのときは再撮影または手入力。API 側は `parse-actual-slip-image` 完了時に構造化ログ（入力サイズ・OCR 文字数・候補有無・所要時間）が出るので、Pi5 の API ログで後追い可能

## 6. API 契約

[api/mobile-placement.md](../api/mobile-placement.md)
