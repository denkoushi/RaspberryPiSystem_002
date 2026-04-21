# 配膳スマホ（Android）セットアップ・検証 Runbook

最終更新: 2026-04-20（**V23 モバイル注文入力スキャン専用・棚チップ `grid-cols-3 sm:grid-cols-4`**・デプロイ Detach `20260420-211100-899` → `20260420-213004-29970`・fjv60 未・stale lock runId `20260420-212814-6231` は [deploy-status-recovery.md](./deploy-status-recovery.md) §5.2）／2026-04-18（**V22 キオスク高視認テーマ・プレビュー整合・Register/Verify 分割**／**Android ブラウザ殻方針: Chrome 継続 + Web UI/UX 改善（ADR/KB 追記）**）／2026-04-13（**V21 部品検索 UI（SOLID 寄りモジュール化・`QueryClientProvider` スモーク）**・**V20 部品検索（促音 `っ`/`ッ` の比較用写像・`q` 空でも機種名 `machineName` で suggest）**・**V19 部品検索（機種名 `machineName` AND・かな正規化拡張・数字パレット・プリセット追加）**・**V18 棚マスタ（`MobilePlacementShelf`・`GET/POST …/registered-shelves` / `POST …/shelves`）**・**V17 部品検索最終（AND・登録済みのみ・剪定・`part-search-core` + CI/Docker）**・**V16 部品名検索**・**V15 照合折りたたみ・登録レイアウト**・V14 分配枝・V13 棚番登録 UI・V12 現品票 ROI・Schema 集約・V11 製造orderパーサ・global-filter／注文行除外・V10 本番反映・Pi5 worktree/root ownership・stale lock）

## Android ブラウザ殻（キオスク）方針メモ（2026-04-18）

**背景**: 一般ブラウザ（Chrome）運用では、アドレスバー・検索 UI・タブ操作など **ブラウザ由来の誤操作**が起きうる。一方で配膳スマホは **紙票のフォーマット固定**・**スマホ 1 台**・**有償キオスクアプリ不可**・**端末機種バラつき**という制約がある。

**当面の正（このリポジトリの運用意思）**:

- **Chrome を継続**し、**Web アプリ側の UI/UX 改善**で現場リスクを下げる（誤操作しにくい導線・表示・ガード）。
- OSS の専用キオスクブラウザ（例: `FreeKiosk` / F-Droid の `Webview Kiosk`）は **即時必須ではない**。再検討する場合の **合否ゲート**は **カメラ2系統**（バーコード `getUserMedia` と 現品票撮影 `input[type=file][capture]`）が **対象端末で通ること**。

**根拠・詳細**: [ADR-20260418](../decisions/ADR-20260418-mobile-placement-android-browser-shell.md) / [KB-351](../knowledge-base/KB-351-mobile-placement-android-browser-kiosk-research.md)

**2026-04-20（V23・スキャン専用・棚チップ）**: ブランチ **`feat/scan-only-order-inputs-and-shelf-chip-mobile`**（**`423e32bb`**）。**仕様**: メイン下半 **製造order** は **`readOnly` + `inputMode="none"`**（スキャンのみ）。**棚番チップ**は `mobilePlacementKioskTheme` で **`grid-cols-3 sm:grid-cols-4`**。**デプロイ**: **`raspberrypi5` → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-kensaku-stonebase01`** を **`--limit` 1 台ずつ** `update-all-clients.sh`（**`raspi4-fjv60-80`** は SSH timeout で **今回未**・**Pi3** 除外）・Detach **`20260420-211100-899` → `20260420-211743-28526` → `20260420-212322-14477` → `20260420-213004-29970`**。**知見**: fjv60 プレフライト失敗後、Pi5 に **`runPid: null` の stale lock**（例: runId **`20260420-212814-6231`**）が残ると **次ホストでロック取得不能** → §5.2。**Phase12**: **PASS 42 / WARN 1 / FAIL 0**。**ナレッジ**: [KB-339 §V23](../knowledge-base/KB-339-mobile-placement-barcode-survey.md#v23-scan-only-shelf-chip-2026-04-20)。**購買照会**側の同変更は [KB-297 §FKOBAINO](../knowledge-base/KB-297-kiosk-due-management-workflow.md#fkobaino-purchase-order-lookup-from-gmail-csv-2026-04-20)。

## 0. 本番デプロイ後の確認（運用）

**対象ホスト（配膳 API/SPA を反映する最小セット）**: `raspberrypi5` → 各 Pi4 キオスク（`raspberrypi4`・`raspi4-robodrill01`・`raspi4-fjv60-80`・`raspi4-kensaku-stonebase01`）。**Pi3 サイネージは必須ではない**（本機能は `/kiosk/...`）。手順は [deployment.md](../guides/deployment.md) の **`update-all-clients.sh`**。複数台のときは **inventory のホストを `--limit` で 1 台ずつ**（例: `--detach --follow` または `--foreground`）。**2026-04-11（V2）**: ブランチ **`feat/mobile-placement-order-based-flow`** を上記順で反映済み（Mac 側サマリ例: `logs/ansible-update-20260411-093207.summary.json` ほか5本・各 `success: true`）。**2026-04-11（V3・棚番登録専用ページ）**: ブランチ **`feat/mobile-placement-shelf-register-page`**（コミット例 **`d18d3688`**）を同順で反映済み（Mac 側サマリ: `logs/ansible-update-20260411-122754.summary.json`（`raspberrypi5`）・`…-123258.summary.json`（`raspberrypi4`）・`…-123740.summary.json`（`raspi4-robodrill01`）・`…-124208.summary.json`（`raspi4-fjv60-80`）・`…-125020.summary.json`（`raspi4-kensaku-stonebase01`）、各 **`success: true`**）。**2026-04-11（V4・登録済み棚番一覧・フィルタ）**: ブランチ **`feat/mobile-placement-registered-shelves-ui`**（コミット例 **`43bc3fa7`**）を同順で反映済み（Mac 側サマリ: `logs/ansible-update-20260411-140348.summary.json`（`raspberrypi5`）・`…-141237.summary.json`（`raspberrypi4`）・`…-141659.summary.json`（`raspi4-robodrill01`）・`…-142020.summary.json`（`raspi4-fjv60-80`）・`…-142547.summary.json`（`raspi4-kensaku-stonebase01`）、各 **`success: true`**）。**2026-04-11（V5・現品票画像 OCR + FHINCD 照合）**: ブランチ **`feat/mobile-placement-actual-slip-image-ocr`**（コミット **`f7342dd3`**）。**Detach Run ID（Pi5→Pi4×4・順）**: `20260411-183841-16996` → `20260411-184924-28557` → `20260411-185416-11344` → `20260411-185819-3299` → `20260411-190608-28569`（各 Pi5 リモートログ **`Summary success check: true`**・`PLAY RECAP` **`failed=0`**）。**コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`・`./scripts/update-all-clients.sh feat/mobile-placement-actual-slip-image-ocr infrastructure/ansible/inventory.yml --limit <host> --detach --follow`。**Pi3** は本機能の必須対象外。**Phase12（本番反映後）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **55s**）。自動回帰はリポジトリ直下で `./scripts/deploy/verify-phase12-real.sh`。API の spot check（`x-client-key` は端末の `apiKey`）例:

**2026-04-11（V6・現品票 OCR 可観測性・UI 案内・パーサ強化）**: ブランチ **`feat/mobile-placement-ocr-debug-fix`**（コミット **`e6806d28`**）。**仕様**: 撮影 OCR 後に **成功／候補なし／エラー**を現品票列下に表示（無言失敗を解消）。API は **`parse-actual-slip-image` 完了時の構造化ログ**（入力・前処理バイト・OCR 文字数・候補有無・所要時間・`requestId` 相関。OCR 全文はログに出さない）。サーバは **桁間空白・O/0 等の限定補正**と **注文番号ブロックの単一候補でも誤採用しない**ガード。**Detach Run ID（Pi5→Pi4×4・順・Pi3 除外）**: `20260411-200637-30031` → `20260411-201900-24559` → `20260411-202426-10094` → `20260411-202844-23208` → `20260411-203518-31439`（各 **`Summary success check: true`**・`PLAY RECAP` **`failed=0`**）。**Phase12**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **85s**・Mac / Tailscale）。

**2026-04-11（V7・現品票 OCR 用途別パイプライン・`ocrPreviewSafe`）**: ブランチ **`feat/mobile-placement-ocr-pipeline-hardening`**（コミット **`8c1cc13d`**）。**仕様**: `jpn+eng` ラベルパス + `eng` 数字／英数字 whitelist の **3 パス直列**、前処理（グレースケール・正規化・余白・数字パスは二値化）、応答 **`ocrPreviewSafe`**（UI はひらがなノイズを抑えたプレビュー）。構造化ログに **`preprocessBytesBinary`**（二値化後 JPEG サイズ）を追加。**Detach Run ID（Pi5→Pi4×4・順・Pi3 除外）**: `20260411-211922-10561` → `20260411-212830-9591` → `20260411-213306-11155` → `20260411-213638-10529` → `20260411-214942-8793`（各 **`failed=0`**）。**Phase12**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **50s**）。**トラブルシュート**: OCR が遅い／初回のみ長い → 下記 **「5. トラブルシュート」**（`tesseract.js` ワーカ初回・**3 パスで処理時間増**の可能性）。**Pi3** は本機能の必須対象外。

**2026-04-11（V8・製造order抽出パーサ強化・OCR診断ログ）**: ブランチ **`fix/mobile-placement-ocr-manufacturing-order-parser`**（コミット **`a9e75cd8`**）。**仕様**: 製造オーダラベルが OCR で **`製造 オー ダ` のように分断**しても **10桁を抽出**しやすい。**`parse-actual-slip-image` 完了ログ**に **`mo10Candidate10Count` / `mo10AfterOrderBlockFilterCount` / `mo10ParseSource`** を追加（OCR 全文は出さない）。**Detach Run ID（Pi5→Pi4×4・順・Pi3 除外）**: `20260411-223115-29480` → `20260411-224346-24116` → `20260411-224823-19592` → `20260411-225152-29858` → `20260411-225741-29730`（各 **`failed=0`**）。**Phase12**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **98s**）。**トラブルシュート**: 製造orderが空のとき Pi5 API ログで **`mo10ParseSource`**（`label-regex` / `line-scan` / `global-filter` / `none`）を確認。

**2026-04-12（V9・labels パス早期終了・成功時 OCR プレビュー非表示）**: ブランチ **`feat/mobile-placement-ocr-preview-and-early-exit`**（コミット **`c6aa2ee5`**）。**仕様**: **最初の `jpn+eng`（labels）パス**の結合テキストだけで **製造order（10桁）と FSEIBAN の両方が取れた場合**は **以降の OCR パスと二値化前処理をスキップ**（負荷低減）。構造化ログは従来どおり（早期終了時は **`preprocessBytesBinary`** を付けない）。**Web**: OCR **成功時**は **`OCR:`** 行の raw プレビューを出さない（候補なし／エラー時は従来どおり案内）。**Detach Run ID（Pi5→Pi4×4・順・Pi3 除外）**: `20260412-085956-22755` → `20260412-091508-16092` → `20260412-092057-26505` → `20260412-092542-10876` → `20260412-093134-32374`（各 **`Summary success check: true`**・`PLAY RECAP` **`failed=0`**）。**Phase12**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **98s**・Mac / Tailscale）。**知見**: ラベルが読めれば **後段パスを省略**でき、初回以外の体感待ち時間を短くし得る。

**2026-04-12（V10・製造order `O/0` 誤認補正）**: コミット **`c09ebc8a`**（`main`）。**初回試行** `20260412-102516-4172` は Pi5 `/opt/RaspberryPiSystem_002` の **未追跡/ローカル変更**と **`root:root` 所有の mobile-placement 関連ディレクトリ**により `git merge` 中止。**復旧**: `git status` で確認後、対象パスを `chown -R denkon5sd02:denkon5sd02` → `git stash push -u`。さらに **Mac 側の local lock** と **Pi5 側の stale remote lock** を死活確認後に解放して再実行。**Detach Run ID（成功・Pi5→Pi4×4・順・Pi3 除外）**: `20260412-104606-29623` → `20260412-105905-22423` → `20260412-110542-32610` → `20260412-111033-18779` → `20260412-111904-8812`（各 **`Summary success check: true`**・`PLAY RECAP` **`failed=0`**）。**Phase12**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **98s**）。

**2026-04-12（V12・現品票 ROI・Schema 集約 `genpyo-slip` 本番反映）**: ブランチ **`feat/genpyo-slip-schema-roi`**（コミット **`1e034057`**）。**仕様**: `actual-slip-image-ocr.service` を **既定 ROI（`DEFAULT_GENPYO_SLIP_ROIS`）で `sharp` 切り出し** → 領域別 OCR → **`genpyo-slip-resolver`** で製造order（ヘッダ優先・欠落時はフッタ）と FSEIBAN を集約。V10/V11 の桁補正・注文行除外は **ROI 内テキスト**に適用。**Detach Run ID（Pi5→Pi4×4・順・Pi3 除外）**: `20260412-142159-22500` → `20260412-143647-5719` → `20260412-144237-23679` → `20260412-144730-23697` → `20260412-145643-23971`（各 **`Summary success check: true`**・`PLAY RECAP` **`failed=0`**）。**コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`・`./scripts/update-all-clients.sh feat/genpyo-slip-schema-roi infrastructure/ansible/inventory.yml --limit <host> --detach --follow`。**Phase12**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **103s**・Mac / Tailscale）。

**2026-04-12（V13・棚番登録 UI レイアウト・コンポーネント分割）**: ブランチ **`feat/kiosk-shelf-register-layout`**（コミット **`fbcca8ad`**）。**仕様**: `/kiosk/mobile-placement/shelf-register` を **`ShelfRegisterHeader` / `ShelfRegisterChoiceGrid` / `ShelfRegisterSlotGrid`** に分割し、[デザインプレビュー](../design-previews/mobile-placement-shelf-register-layout-preview.html) に沿ってヘッダ・3 択グリッド・番号グリッドの密度を調整。**API 契約変更なし**（従来どおり `formatShelfCodeRaw`・router state 往復）。**Detach Run ID（Pi5→Pi4×4・順・Pi3 除外）**: `20260412-162015-11134` → `20260412-162729-5630` → `20260412-163310-3759` → `20260412-163742-9462` → `20260412-164944-23223`（各 **`Summary success check: true`**・`PLAY RECAP` **`failed=0`**）。**コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`・`./scripts/update-all-clients.sh feat/kiosk-shelf-register-layout infrastructure/ansible/inventory.yml --limit <host> --detach --follow`。**Phase12**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **109s**・Mac / Tailscale）。**知見**: 本変更は **Web のみ**のため Pi3 デプロイは不要（`/kiosk/...` は Pi5 の SPA 配信が正）。

**2026-04-12（V14・製造order配下の分配枝・`OrderPlacementBranchState`・新規/移動 API）**: ブランチ **`feat/mobile-placement-order-branches`**（コミット **`72255bc7`**）。**仕様**: `GET …/order-placement-branches`・`POST …/register-order-placement`（**新規分配枝のみ**）・`PATCH …/order-placement-branches/:id/move`（**既存枝の棚更新**）。DB マイグレーション **`20260412120000_order_placement_branch_state`**。**Detach Run ID（Pi5→Pi4×4・順・Pi3 除外）**: `20260412-181344-4740` → `20260412-182622-13897` → `20260412-183213-6611` → `20260412-183659-23626` → `20260412-184407-12516`（各 **`failed=0`**）。**コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`・`./scripts/update-all-clients.sh feat/mobile-placement-order-branches infrastructure/ansible/inventory.yml --limit <host> --detach --follow`。**Phase12**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **104s**・Mac / Tailscale）。**Pi3** は本機能の必須対象外（`/kiosk` SPA は Pi5 配信）。

**2026-04-12（V15・照合の折りたたみ・登録ティール枠のレイアウト・API 変更なし）**: ブランチ **`feat/mobile-placement-verify-collapsible-register-layout`**（コミット **`ba49160d`**）。**仕様（Web のみ）**: 上半 **照合は既定で閉じ**、**「展開」**で従来の2列入力・照合・OK/NG・**「閉じる」**。型は `mobile-placement-verify-section.types.ts` に分離し展開パネルと共有（循環参照回避）。下半 **製造order行**は **`flex-1 min-w-0`**、**新規分配／既存移動／登録（または移動を確定）**を **同一行**に配置（見出し「分配の操作」・製造order空時の説明文は撤去。[デザインプレビュー](../design-previews/mobile-placement-verify-collapsible-preview.html) 準拠）。**API / DB 変更なし**。**Detach Run ID（Pi5→Pi4×4・順・Pi3 除外）**: `20260412-193820-22310`（`raspberrypi5`）→ `20260412-194534-25173`（`raspberrypi4`）→ `20260412-195118-15218`（`raspi4-robodrill01`）→ `20260412-195555-16494`（`raspi4-fjv60-80`）→ `20260412-200127-28015`（`raspi4-kensaku-stonebase01`）、各 **`Summary success check: true`**・`PLAY RECAP` **`failed=0`**。**コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`・`./scripts/update-all-clients.sh feat/mobile-placement-verify-collapsible-register-layout infrastructure/ansible/inventory.yml --limit <host> --detach --follow`。**Phase12**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **102s**・Mac / Tailscale）。**知見**: 折りたたみ時も **`id="mp-verify-expanded-panel"`** を DOM に残し **`hidden`**（`aria-controls` と整合）。**Pi3** は対象外（`/kiosk` は Pi5 の SPA 配信）。**残作業（手動）**: Android で **折りたたみ既定**・**展開後の照合**・**3ボタン行の登録**を目視。

**2026-04-12（V16・部品名検索 API + キオスク `/kiosk/mobile-placement/part-search`）**: ブランチ **`feat/mobile-placement-part-name-search`**（コミット **`62721227`**）。**仕様**: **`GET /api/mobile-placement/part-search/suggest`** — **現在棚**（`OrderPlacementBranchState.scheduleSnapshot`）を最優先、**生産スケジュール**（`CsvDashboardRow` の winner 行）を補助。**同義語**は API 内辞書（`apps/api/src/services/mobile-placement/part-search/part-search-aliases.ts`）で展開。Web: **`/kiosk/mobile-placement/part-search`**（五十音・A–Z・プリセット入力）。**DB マイグレーション追加なし**（V14 前提）。**デプロイ**: [deployment.md](../guides/deployment.md)・`export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`・`./scripts/update-all-clients.sh feat/mobile-placement-part-name-search infrastructure/ansible/inventory.yml --limit <host> --detach --follow` を **`raspberrypi5` → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` → `raspi4-kensaku-stonebase01`** の順に **1 台ずつ**（**Pi3 除外**）。**Detach Run ID**: 本リポジトリの Mac 側 `logs/ansible-update-*.summary.json` は未コミット。**各ホストとも** `Summary success check: true`・`PLAY RECAP` **`failed=0`** で完了。Run ID をナレッジに固定する場合は Pi5 の `/opt/RaspberryPiSystem_002/logs/ansible-update-*` のタイムスタンプをホスト順に照合。**Phase12**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **110s**・Mac / Tailscale）。**スポット（API）**: `curl -sk "https://<Pi5>/api/mobile-placement/part-search/suggest?q=脚" -H "x-client-key: <端末の apiKey>"` → `currentPlacements` / `scheduleCandidates`・`aliasMatchedBy` 等。**知見**: Pi5 初回は **Docker 再ビルドで時間がかかり**、`--follow` が長く見えることがあるが、**ログ上 `failed=0` なら成功**。**トラブルシュート**: 401 → `heartbeat` と `x-client-key` の整合。候補が薄い → クエリ短さ・現場データ・同義語辞書を確認（[KB-339](../knowledge-base/KB-339-mobile-placement-barcode-survey.md) V16）。

**2026-04-13（V17・部品検索最終: AND トークングループ・登録済みのみ・剪定・`part-search-core` + CI/Docker）**: ブランチ **`feature/mobile-placement-part-search-final`**（先端コミット **`4d34f5fa`**）。**仕様**: API は **空白区切り AND**（グループ内 OR・同義語は **`packages/part-search-core`**）。キオスクは **登録済みヒットのみ**・**パレットはヒットが無くなったら非表示**・剪定は `partSearchPalettePruner`。**CI/Docker** で `part-search-core` を先ビルド（モジュール解決エラー回避）。**デプロイ**: 上記と同じ **`update-all-clients.sh`**・`--limit` を **`raspberrypi5` → … → `raspi4-kensaku-stonebase01`** の順。**Detach Run ID**: `20260413-100158-12333` → `20260413-101643-3896` → `20260413-102109-32432` → `20260413-102432-4099` → `20260413-102904-13288`（各 **`failed=0`**）。**Phase12**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **25s**）。**ナレッジ**: [KB-339](../knowledge-base/KB-339-mobile-placement-barcode-survey.md) V17。

**2026-04-13（V18・棚マスタ `MobilePlacementShelf`・`POST …/shelves`）**: ブランチ **`feature/mobile-placement-shelf-master`**（コミット **`113147f1`**）。**仕様**: `GET …/registered-shelves` の正本は **`MobilePlacementShelf`**。`+` で **`POST /api/mobile-placement/shelves`**（**`西-北-01` 形式のみ**・重複 **409**）。**Prisma** `20260413140000_add_mobile_placement_shelf_master`。**デプロイ**: [deployment.md](../guides/deployment.md) の **`update-all-clients.sh`**・`--limit` を **`raspberrypi5` → … → `raspi4-kensaku-stonebase01`** の順に **1 台ずつ**（**Pi3 除外**）。**Detach Run ID**: `20260413-124042-32510` → `20260413-125217-7318` → `20260413-125648-60` → `20260413-130037-12380` → `20260413-130456-12201`（各 **`failed=0`**）。**Phase12**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **25s**）。**ナレッジ**: [KB-339](../knowledge-base/KB-339-mobile-placement-barcode-survey.md) V18 本番反映節。**残作業（手動）**: Android で **`+` → 棚番登録**→ トップの **登録済み棚**に反映することを目視。

**2026-04-13（V19・部品検索: 機種名 AND・かな正規化拡張・数字パレット・プリセット追加）**: ブランチ **`feat/mobile-placement-part-search-machine-filter`**（コミット **`5bfab6c8`**）。**仕様**: **`GET /api/mobile-placement/part-search/suggest`** に任意クエリ **`machineName`**（後方互換）。機種名は **`CsvDashboardRow` の MH/SH 行 `FHINMEI` を製番単位で集約**した文字列へ正規化後 **部分一致**し、**`q` と AND**。表記ゆれは **`packages/part-search-core`**（ひら/カタ・拗音・促音など）。キオスクは **部品名・機種名の2入力**・**0–9 行**・プリセット（ナット／サドル／ベース／カラー／ベアリング／モータ 等）。**機種名欄フォーカス時はパレット剪定を行わない**（ヒット DTO に機種表示名が無いため）。**デプロイ**: [deployment.md](../guides/deployment.md)・`export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`・`./scripts/update-all-clients.sh feat/mobile-placement-part-search-machine-filter infrastructure/ansible/inventory.yml --limit <host> --detach --follow` を **`raspberrypi5` → … → `raspi4-kensaku-stonebase01`** の順に **1 台ずつ**（**Pi3 除外**）。**Detach Run ID**: `20260413-143256-27604` → `20260413-144431-6108` → `20260413-144847-8016` → `20260413-145200-25161` → `20260413-145658-5761`（各 **`failed=0`**）。**Phase12**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **24s**）。**ナレッジ**: [KB-339](../knowledge-base/KB-339-mobile-placement-barcode-survey.md) V19・[api/mobile-placement.md](../api/mobile-placement.md)。**残作業（手動）**: Android で **`/kiosk/mobile-placement/part-search`** の **2 入力・数字行・機種名 AND** を目視。

**2026-04-13（V20・部品検索: 促音比較・機種名のみ suggest）**: ブランチ **`feat/part-search-sokuon-comparable-and-optional-sides`**（コミット **`8a4c8ffe`**）。**仕様**: 促音 **`っ` / `ッ`** を **除去せず**、DB/クライアント比較用に **`ツ` へ写像**（`part-search-core` の **`PART_SEARCH_SOKUON_COMPARABLE_REPLACEMENTS`**）。API は **`part-search-field-comparable-sql`** で `FHINMEI`/`FHINCD` 等に **ILIKE 用の REPLACE 連鎖**を適用。**`q` が空でも `machineName` があれば** `suggest` を実行（キオスクは機種名のみでも候補取得）。**デプロイ**: [deployment.md](../guides/deployment.md)・`export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`・`./scripts/update-all-clients.sh feat/part-search-sokuon-comparable-and-optional-sides infrastructure/ansible/inventory.yml --limit <host> --detach --follow` を **`raspberrypi5` → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` → `raspi4-kensaku-stonebase01`** の順に **1 台ずつ**（**Pi3 除外**）。**Detach Run ID**: `20260413-154338-19890` → `20260413-155401-995` → `20260413-155851-30629` → `20260413-160214-659` → `20260413-160637-3548`（各 **`Summary success check: true`**・`PLAY RECAP` **`failed=0`**）。**Phase12**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **23s**・Mac / Tailscale）。**ナレッジ**: [KB-339](../knowledge-base/KB-339-mobile-placement-barcode-survey.md) V20・[api/mobile-placement.md](../api/mobile-placement.md)。**残作業（手動）**: Android で **`ナット` と `ナットホルダー`** のように **促音表記差**が吸収されること・**機種名のみ**でヒントが出ることを目視。

**2026-04-13（V21・部品検索 UI: SOLID 寄りモジュール化・Vitest スモーク修正）**: ブランチ **`refactor/part-search-solid-modular`**（コミット **`d4467b1a`**）。**仕様**: **`/kiosk/mobile-placement/part-search`** を **`PartSearchHeaderToolbar` / `PartSearchQueryInputs` / `PartSearchResultsSection`** / **`partSearchUiTokens`** に分割し、パレット操作を **`useMobilePlacementPartSearch`** に集約。**API/DB 契約不変**。Vitest: **`KioskMobileShelfRegisterPage`** スモークを **`QueryClientProvider`** でラップ。**デプロイ**: [deployment.md](../guides/deployment.md)・`export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`・`./scripts/update-all-clients.sh refactor/part-search-solid-modular infrastructure/ansible/inventory.yml --limit <host> --detach --follow` を **`raspberrypi5` → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` → `raspi4-kensaku-stonebase01`** の順に **1 台ずつ**（**Pi3 除外**）。**Detach Run ID**: `20260413-175621-27099` → `20260413-180137-22828` → `20260413-180628-4330` → `20260413-181025-11891` → `20260413-181724-25138`（各 **`failed=0`**）。**Phase12**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **50s**）。**ナレッジ**: [KB-339](../knowledge-base/KB-339-mobile-placement-barcode-survey.md) V21。**残作業（手動）**: Android で **ヘッダの空白/削除/戻る**・**入力と結果**が従来どおりであることを目視。

**2026-04-18（V22・キオスク高視認テーマ・静的プレビュー整合・Register/Verify 分割）**: ブランチ **`feature/mobile-placement-contrast-refactor`**（コミット **`2d2528ec`**）。**仕様**: `mobilePlacementKioskTheme.ts` にトークン集約、`MobilePlacementRegisterShelfPanel` / `RegisterOrderPanel` / `MobilePlacementVerifySection` 等へ分割、文言・コントラストを [mobile-placement-main-page-detail-preview.html](../design-previews/mobile-placement-main-page-detail-preview.html) に寄せる。**API/DB 契約不変**。**デプロイ**: [deployment.md](../guides/deployment.md)・`export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`・`./scripts/update-all-clients.sh feature/mobile-placement-contrast-refactor infrastructure/ansible/inventory.yml --limit <host> --detach --follow` を **`raspberrypi5` → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` → `raspi4-kensaku-stonebase01`** の順に **1 台ずつ**（**Pi3 除外**）。**Detach Run ID**: `20260418-111058-3228` → `20260418-111559-19394` → `20260418-112049-24881` → `20260418-112437-2591` → `20260418-113342-26169`、各 **`Summary success check: true`**・`PLAY RECAP` **`failed=0`**。**Phase12**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **47s**・Mac / Tailscale）。**ナレッジ**: [KB-339](../knowledge-base/KB-339-mobile-placement-barcode-survey.md) V22・[plans/mobile-placement-main-page-preview-parity.md](../plans/mobile-placement-main-page-preview-parity.md)。**残作業（手動）**: Android で **`/kiosk/mobile-placement`** の **視認性・登録/照合ブロック**を目視。

```bash
curl -sk -X POST "https://<Pi5>/api/mobile-placement/verify-slip-match" \
  -H "Content-Type: application/json" -H "x-client-key: <key>" \
  -d '{"transferOrderBarcodeRaw":"…","transferPartBarcodeRaw":"…","actualOrderBarcodeRaw":"…","actualFseibanRaw":"","actualPartBarcodeRaw":"…"}'

# 登録済み棚（MobilePlacementShelf 棚マスタ。マイグレーションで履歴からの取り込みあり。未登録なら { "shelves": [] }）
curl -sk "https://<Pi5>/api/mobile-placement/registered-shelves" -H "x-client-key: <key>"

# 棚マスタへ新規登録（西-北-01 形式のみ・重複は 409）
curl -sk -X POST "https://<Pi5>/api/mobile-placement/shelves" \
  -H "Content-Type: application/json" -H "x-client-key: <key>" \
  -d '{"shelfCodeRaw":"西-北-01"}'

# 製造orderに紐づく分配枝の現在棚（V14）
curl -sk "https://<Pi5>/api/mobile-placement/order-placement-branches?manufacturingOrder=0002178005" -H "x-client-key: <key>"

# 既存分配枝の棚移動（V14・:id は OrderPlacementBranchState.id）
curl -sk -X PATCH "https://<Pi5>/api/mobile-placement/order-placement-branches/<id>/move" \
  -H "Content-Type: application/json" -H "x-client-key: <key>" \
  -d '{"shelfCodeRaw":"西-北-03"}'

# 現品票画像 OCR（multipart・JPEG/PNG/WebP）
curl -sk -X POST "https://<Pi5>/api/mobile-placement/parse-actual-slip-image" \
  -H "x-client-key: <key>" -F "image=@/path/to/slip.jpg"

# 部品名検索（V16・現在棚優先 + スケジュール補助 + 同義語）
curl -sk "https://<Pi5>/api/mobile-placement/part-search/suggest?q=%E8%84%9A" -H "x-client-key: <key>"
```

## 前提

- Pi5 が稼働し、通常どおり **HTTPS** で API/Web が応答すること
- Android を **Tailscale** で Pi5 と同じ tailnet に参加させ、ACL で **`tag:server` の tcp:443** が端末から許可されていること（[tailscale-policy.md](../security/tailscale-policy.md)）
- 端末に **Chrome** を使用する

## 1. 端末登録（ClientDevice）

`POST /api/clients`（管理者 JWT）で `apiKey` / `name` / `location` を登録する（型落ち Android タブレットのサイネージ手順と同じ）。詳細は [signage-client-setup.md](../guides/signage-client-setup.md#android-signage-lite)。

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

1. 棚番: **`GET /api/mobile-placement/registered-shelves`**（**`MobilePlacementShelf` 棚マスタ**）に基づく **エリア／列フィルタ**と候補一覧から選ぶか、**`+`** で **`/kiosk/mobile-placement/shelf-register`** に遷移し、**エリア → 列 → 番号**を選んで **「棚番を登録」**（**`POST /api/mobile-placement/shelves`** でマスタ登録・既登録番号はグレーアウト）。表示は `formatShelfCodeRaw` 由来の **`西-北-02`** 形式。マスタに無い棚は一覧に出ない（**`shelves` が空**は、マスタ未登録かつ履歴からの取り込みも無い場合に正常）。戻ると親画面の棚欄に反映される。従来どおり **TEMP-A〜D** の直接タップ（マスタにあれば）、または **QR** で棚コードをスキャン（QR は棚のみ）も可
2. 移動票の **製造order番号**を **1次元**でスキャン
3. **V14**: **「新規分配を追加」** か **「既存分配を移動」** を選ぶ。新規は **次の `branchNo`** で `POST …/register-order-placement`。移動は **`GET …/order-placement-branches`** で一覧を出し、枝を選んで **`PATCH …/order-placement-branches/:id/move`**（UI は「移動を確定」）。
4. 「登録」または「移動を確定」→ `OrderPlacementEvent` に履歴追記（**工具 `Item` は更新しない**）。現在棚は `OrderPlacementBranchState`（詳細は [api/mobile-placement.md](../api/mobile-placement.md)）

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
- **登録済み棚が常に空**: **`MobilePlacementShelf` に1件も無い**と **`registered-shelves` は `{ "shelves": [] }`**（不具合ではない）。**マイグレーション**で過去の `OrderPlacementEvent` 由来棚は取り込まれる。新規は **`+` → 棚番登録画面**で **`POST /api/mobile-placement/shelves`** する
- **デプロイが `未commit変更` で止まる**: Mac 側に **未追跡ファイル**もブロック対象。`git stash push -u` またはコミットしてから [deployment.md](../guides/deployment.md) の `update-all-clients.sh` を再実行
- **Pi5 で `Please move or remove them before you merge. Aborting`（`git pull`/`merge` 中止）**: Pi5 `/opt/RaspberryPiSystem_002` の作業ツリーに **未追跡・ローカル変更**があり、取り込みと衝突している典型。[deployment.md](../guides/deployment.md) の **ワークツリー**、[KB-339](../knowledge-base/KB-339-mobile-placement-barcode-survey.md) **V10**、必要に応じ [kiosk-documents.md](./kiosk-documents.md)（Pi5 `git` 復旧パターン）を参照してから **再デプロイ**
- **Pi5 で `git stash push -u` しても `failed to remove ... 許可がありません`**: 変更ファイルが **`root:root` 所有**の典型。`apps/api/src/services/mobile-placement`、`apps/web/src/features/mobile-placement`、migration などの対象パスを **`sudo chown -R denkon5sd02:denkon5sd02 ...`** してから再度 `git stash push -u`
- **`Another update-all-clients.sh process is already running` / `Failed to acquire remote lock`**: 前回の `--follow` や remote detach が **途中失敗で lock だけ残存**した可能性。**local lock** は Mac 側の残存 `update-all-clients.sh` を終了して解放。**remote lock** は Pi5 の `/opt/RaspberryPiSystem_002/logs/.update-all-clients.lock` の **`runPid` が実在するか確認**し、**本体不在で `tail -f` だけ残っている場合のみ**削除する（[deploy-status-recovery.md](./deploy-status-recovery.md) と同型）
- **画像OCRが遅い／初回だけ長い**: Pi5 API コンテナで **tesseract.js ワーカ初回起動**で数十秒かかることがある。連続利用ではキャッシュされやすい。現品票 OCR は **用途別に複数パス**（`jpn+eng` + `eng`×2）を **直列**で回すため、初回以外も **単一パス時より時間がかかる**場合がある。極端に大きい画像はサーバ側で縮小されるが、**ピント・コントラスト**を確保すると精度が上がる
- **画像OCR後に欄が空のまま／無反応に見える**: 撮影後、現品票列の下に **成功（抽出値の表示）／候補なし／エラー**のいずれかが出ること。候補なしのときは再撮影または手入力。API 側は `parse-actual-slip-image` 完了時に構造化ログ（入力サイズ・OCR 文字数・候補有無・所要時間・**V8 以降**: `mo10ParseSource` / `mo10Candidate10Count` 等）が出るので、Pi5 の API ログで後追い可能。**製造ラベルが分断**されて製造orderが取れないケースは V8 パーサで緩和（[KB-339](../knowledge-base/KB-339-mobile-placement-barcode-survey.md)）
- **`mo10ParseSource` が `global-filter` だが製造orderが空／誤り**: **V11** 以降、同一行に **注文番号＋枝番**があるとその行の 10 桁は除外され、残り候補から文脈スコアで選ぶ。ログの `mo10Candidate10Count` / `mo10AfterOrderBlockFilterCount` と [KB-339](../knowledge-base/KB-339-mobile-placement-barcode-survey.md) **V11** を参照
- **V12 以降の現品票 OCR で欄が空になりやすい**: **ROI 切り出し**が帳票レイアウトとズレると、その領域の OCR が空になり製造order／製番が取れない。Pi5 ログの **`mo10ResolvedFromRoi`**（`moHeader` / `moFooter`）と [KB-339](../knowledge-base/KB-339-mobile-placement-barcode-survey.md) **V12** を参照。撮影は **正面・全体が枠内**になるよう寄せる

## 6. API 契約

[api/mobile-placement.md](../api/mobile-placement.md)
