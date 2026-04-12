# KB-339: 配膳スマホ版 V1 — 現場バーコードの意味確定（調査ゲート）

最終更新: 2026-04-12

## Context

配膳スマホで **アイテム／現物のバーコード**を読み取り、既存の `Item` または生産スケジュール行と突き合わせる前に、**ラベル上のコードが何を表すか**を固定する必要がある。

## Symptoms

- スキャン値は取れるが、マスタやスケジュールと一致しない
- 同一現物で複数ラベル（製番・品番・社内コード）があり、どれを正とするか不明

## Investigation

現場で **3〜5 件**について次を記録する。

1. **スキャン文字列**（そのまま。前後空白は除去してもよい）
2. **同じ現物に貼られた別ラベル**があればその値も
3. 管理画面または CSV 上の **`Item.itemCode`**（工具マスタ）
4. 生産スケジュール行の **`ProductNo` / `FSEIBAN` / `FHINCD`**（当該行が分かる場合）

### 判定（CONFIRMED の例）

- スキャン値が **`Item.itemCode` と一致**（大文字小文字のみ差）  
  → **V1 の主キーは itemCode として実装する**

- スキャン値が **`FHINCD` や `ProductNo` と一致**し、`Item` に無い  
  → **Item 側に itemCode を揃えるか、別テーブルでコード変換が必要**（V1 では手運用またはマスタ整備を優先）

## Root cause

バーコードが **どのマスタキーをエンコードしているか**が運用定義されていないと、自動突合が成立しない。

## Fix（最小）

1. 上記サンプルでパターンを CONFIRMED にする。
2. CONFIRMED になったキーを、API `resolve-item` と `register` の突合ロジックに反映する（コード側コメントに根拠を残す）。

## Prevention

- 新ラベル導入時は **サンプル1件＋ KB 追記**
- ラベル印刷システムと **`Item.itemCode` の単一ソース**を揃える

## 本番反映・検証（2026-04-10）

- **デプロイ**: [deployment.md](../guides/deployment.md) に従い **`raspberrypi5` → Pi4 キオスク 4 台**を **`--limit` 1 台ずつ**・`--foreground`（**Pi3 は対象外**）。実装ベースコミット **`8e1d0e3f`**（`main`）。
- **自動回帰**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**。
- **突合の正本（コード）**: `csvDashboardRowId` 付き `register` は、スキャン値が行の **`ProductNo` / `FSEIBAN` / `FHINCD`** のいずれかと一致するか、**解決された `Item.itemCode` がそのいずれかと一致**すること。**欠陥対策**: 以前は「スキャンで解決した `itemCode` が行のどのフィールドとも違っても、別工具の `itemCode` とスキャンが一致すれば通過」し得たため、`Item.itemCode` 側の一致は **行キーとの一致**に限定した（`MOBILE_PLACEMENT_SCHEDULE_MISMATCH`）。

## V2（部品配膳・移動票/現品票照合）

- **UI**: `/kiosk/mobile-placement` 単一画面。上半分は移動票の **製造order + FHINBAN/FHINCD（1次元）**、現品票は **製造order（印字／画像OCR／手入力）+ 任意の製番 FSEIBAN + 部品（FHINBAN 等・1次元）** と **OK/NG**。下半分は仮棚（TEMP-A〜D または QR）+ 製造orderスキャン + **登録**（`OrderPlacementEvent`。**`Item` は更新しない**）。
- **API**: `POST /api/mobile-placement/verify-slip-match`・`POST /api/mobile-placement/register-order-placement`・`POST /api/mobile-placement/parse-actual-slip-image`（[api/mobile-placement.md](../api/mobile-placement.md)）。
- **照合**: 移動票は **ProductNo** で行解決。現品票は **ProductNo が空でなければ ProductNo**、**空なら FSEIBAN** で行解決。スキャンした **FHINBAN/FHINCD** が行の **`FHINCD`** と一致したうえで、両票の **`FSEIBAN` + `FHINCD`** ペアが一致するか判定。
- **現品票画像 OCR**: `tesseract.js`（`services/ocr` の `ImageOcrPort`）。**2026-04-11 以降（ブランチ `feat/mobile-placement-ocr-pipeline-hardening`）**: 汎用 `jpn+eng` 一発ではなく、**ラベル文脈（`jpn+eng`）・数字専用（`eng`+whitelist）・英数字補助（`eng`+whitelist）**の **3 パス**を順に実行し結合してパース。前処理（グレースケール・正規化・余白・二値化など）は **mobile-placement** サービス内。API 応答の **`ocrPreviewSafe`** は数字・英数字パスのみ（UI のノイズ表示抑制）。テストは `IMAGE_OCR_STUB_TEXT` でスタブ可能。印字から **製造order（10桁）** を第一候補、**FSEIBAN** を第二候補としてパース（**注文番号（9桁）行の誤採用を抑制**）。

### 本番反映・検証（2026-04-11）

- **デプロイ**: [deployment.md](../guides/deployment.md) に従い **`raspberrypi5` → Pi4 キオスク 4 台**を **`--limit` 1 台ずつ**・ブランチ **`feat/mobile-placement-order-based-flow`**・`--foreground`（**Pi3 は対象外**）。実装ベースコミット **`da613487`**（**`main` へ PR マージ**）。
- **自動回帰**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**。
- **DB**: `OrderPlacementEvent`（マイグレーション `20260411120000_add_order_placement_event`）。

### 本番反映・検証（2026-04-11・V5 現品票画像 OCR）

- **デプロイ**: [deployment.md](../guides/deployment.md) に従い **`raspberrypi5` → Pi4 キオスク 4 台**を **`--limit` 1 台ずつ**・ブランチ **`feat/mobile-placement-actual-slip-image-ocr`**・**`--detach --follow`**（**Pi3 は対象外**）。実装ベースコミット **`f7342dd3`**（**`main` へマージして本番ドキュメントと同期**）。
- **Detach Run ID（ログ接頭辞 `ansible-update-`）**: `20260411-183841-16996`（`raspberrypi5`）→ `…184924-28557`（`raspberrypi4`）→ `…185416-11344`（`raspi4-robodrill01`）→ `…185819-3299`（`raspi4-fjv60-80`）→ `…190608-28569`（`raspi4-kensaku-stonebase01`）、各 **`failed=0` / `unreachable=0`**。
- **自動回帰**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **55s**）。
- **知見**: **同一 Pi5 へ `update-all-clients.sh` を並列起動しない**（[deployment.md](../guides/deployment.md)）。OCR は **初回ワーカ起動**で遅延し得る。

### 本番反映・検証（2026-04-11・V6 現品票 OCR 可観測性・UI）

- **デプロイ**: [deployment.md](../guides/deployment.md) に従い **`raspberrypi5` → Pi4 キオスク 4 台**を **`--limit` 1 台ずつ**・ブランチ **`feat/mobile-placement-ocr-debug-fix`**・**`--detach --follow`**（**Pi3 は対象外**）。実装ベースコミット **`e6806d28`**。
- **Detach Run ID（ログ接頭辞 `ansible-update-`）**: `20260411-200637-30031`（`raspberrypi5`）→ `20260411-201900-24559`（`raspberrypi4`）→ `20260411-202426-10094`（`raspi4-robodrill01`）→ `20260411-202844-23208`（`raspi4-fjv60-80`）→ `20260411-203518-31439`（`raspi4-kensaku-stonebase01`）、各 **`failed=0` / `unreachable=0`**。
- **自動回帰**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **85s**）。
- **仕様**: 撮影 OCR 後に **成功／候補なし／エラー**を UI 表示。API は **`parse-actual-slip-image` 完了ログ**で後追い（OCR 全文は出さない）。パーサは **桁間空白・O/0 等の限定補正**と **注文番号ブロックのみの 10 桁は採用しない**ガード。

### 本番反映・検証（2026-04-11・V7 現品票 OCR 用途別パイプライン）

- **デプロイ**: [deployment.md](../guides/deployment.md) に従い **`raspberrypi5` → Pi4 キオスク 4 台**を **`--limit` 1 台ずつ**・ブランチ **`feat/mobile-placement-ocr-pipeline-hardening`**・**`--detach --follow`**（**Pi3 は対象外**）。実装ベースコミット **`8c1cc13d`**（**`main` へ PR マージ**）。
- **Detach Run ID（ログ接頭辞 `ansible-update-`）**: `20260411-211922-10561`（`raspberrypi5`）→ `20260411-212830-9591`（`raspberrypi4`）→ `20260411-213306-11155`（`raspi4-robodrill01`）→ `20260411-213638-10529`（`raspi4-fjv60-80`）→ `20260411-214942-8793`（`raspi4-kensaku-stonebase01`）、各 **`failed=0` / `unreachable=0`**。
- **自動回帰**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **50s**）。
- **知見**: **3 パス直列**のため **単一 OCR 時より遅くなり得る**（初回ワーカ起動も重畳）。UI は **`ocrPreviewSafe`** でプレビューのノイズを抑制。構造化ログに **`preprocessBytesBinary`**（二値化後バイト長）あり。

### 本番反映・検証（2026-04-11・V8 製造order抽出パーサ・診断ログ）

- **デプロイ**: [deployment.md](../guides/deployment.md) に従い **`raspberrypi5` → Pi4 キオスク 4 台**を **`--limit` 1 台ずつ**・ブランチ **`fix/mobile-placement-ocr-manufacturing-order-parser`**・**`--detach --follow`**（**Pi3 は対象外**）。実装ベースコミット **`a9e75cd8`**（**`main` へ PR マージ**）。
- **Detach Run ID（ログ接頭辞 `ansible-update-`）**: `20260411-223115-29480`（`raspberrypi5`）→ `20260411-224346-24116`（`raspberrypi4`）→ `20260411-224823-19592`（`raspi4-robodrill01`）→ `20260411-225152-29858`（`raspi4-fjv60-80`）→ `20260411-225741-29730`（`raspi4-kensaku-stonebase01`）、各 **`failed=0` / `unreachable=0`**。
- **自動回帰**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **98s**）。
- **仕様**: `actual-slip-identifier-parser` が **製造オーダラベルの空白分断**（例: `製造 オー ダ`）を許容し、**注文番号ブロック近傍の誤除外**で製造orderが null になるケースを減らす。`parse-actual-slip-image` 完了ログに **`mo10Candidate10Count` / `mo10AfterOrderBlockFilterCount` / `mo10ParseSource`** を追加（OCR 全文はログに出さない）。
- **知見・トラブルシュート**: 旧パーサでは **「製造オーダ」連続表記と一致しないラベル行**が注文番号行と同時に読めたとき、**製造ラベル未検出**となり **global-filter 経路で注文番号の10桁を除外**して **製造orderが null** になることがあった。**切り分け**: Pi5 API の `parse-actual-slip-image ocr completed` で **`mo10ParseSource`** を確認（`none` かつ候補ありは要再撮影・パーサ追従検討）。

### 本番反映・検証（2026-04-12・V9 labels 早期終了・成功時プレビュー抑制）

- **デプロイ**: [deployment.md](../guides/deployment.md) に従い **`raspberrypi5` → Pi4 キオスク 4 台**を **`--limit` 1 台ずつ**・ブランチ **`feat/mobile-placement-ocr-preview-and-early-exit`**・**`--detach --follow`**（**Pi3 は対象外**）。実装ベースコミット **`c6aa2ee5`**。
- **Detach Run ID（ログ接頭辞 `ansible-update-`）**: `20260412-085956-22755`（`raspberrypi5`）→ `20260412-091508-16092`（`raspberrypi4`）→ `20260412-092057-26505`（`raspi4-robodrill01`）→ `20260412-092542-10876`（`raspi4-fjv60-80`）→ `20260412-093134-32374`（`raspi4-kensaku-stonebase01`）、各 **`failed=0` / `unreachable=0`**。
- **自動回帰**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **98s**）。
- **仕様**: **`jpn+eng`（labels）パス**のテキストだけで **製造order10 + FSEIBAN** が揃えば **早期 return**（追加パス・二値化前処理をスキップ）。ログは従来どおり（早期終了時は **`preprocessBytesBinary` なし**）。キオスク UI は **成功時**に **`OCR:`** の raw プレビュー行を出さない。
- **知見**: 読みやすいラベルでは **後段 OCR を省略**でき、Pi5 CPU 負荷と待ち時間を抑えられる。切り分けで **`preprocessBytesBinary` が無い完了ログ**が出たら早期終了経路を疑う。

### 本番反映・検証（2026-04-12・V10 製造order 先頭 `O`/`0` 誤認のラベル近傍補正）

- **実装**: `apps/api/src/services/mobile-placement/actual-slip-identifier-parser.ts` — 製造ラベル直後・行スキャンで **10文字トークン**を `[0-9OoIl|]` まで許容し、`normalizeLooseDigitToken`（`O→0` / `I|l|→1`）後に **10桁数字**か判定。正規化で確定できない場合は **line-scan / global-filter** にフォールバック。コミット **`c09ebc8a`**（`main`）。
- **仕様（要点）**: OCR が **`0002178005` を `OOO2178OO5` のように読んだ**場合でも、**製造orderラベル付近**なら **製造order（10桁）**として復元しやすくする（**注文番号行の誤採用抑制**は V8 以降のまま）。
- **初回デプロイ試行（2026-04-12）**: [deployment.md](../guides/deployment.md) の **`update-all-clients.sh`**・`export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`・`./scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`。**結果**: **失敗** — Pi5 上の `git` が **`Please move or remove them before you merge. Aborting`** で **`Updating 8e1d0e3f..c09ebc8a`** を中止。ログに **`apps/web/src/features/mobile-placement/...`** 等のパスが列挙された（**未整理の作業ツリー／未追跡**がマージと衝突）。**Detach Run ID（試行）**: **`20260412-102516-4172`**。
- **トラブルシュート（実施）**: Pi5 で **`cd /opt/RaspberryPiSystem_002 && git status`** を確認したところ、mobile-placement 関連ファイルと migration が残存し、対象ディレクトリの所有者が **`root:root`** だった。**対処**: `apps/api/src/routes/mobile-placement`・`apps/api/src/services/mobile-placement`・`apps/web/src/features/mobile-placement`・`apps/api/prisma/migrations/20260411120000_add_order_placement_event` を **`chown -R denkon5sd02:denkon5sd02`** → **`git stash push -u`**。さらに **Mac 側の古い `--follow` プロセス**による **local lock** と、Pi5 の **stale remote lock**（`runPid` 不在・`tail -f` だけ残存）を死活確認後に解放した。
- **本番デプロイ（成功・2026-04-12）**: [deployment.md](../guides/deployment.md) に従い **`raspberrypi5` → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` → `raspi4-kensaku-stonebase01`** を **`--limit` 1 台ずつ**・**`--detach --follow`**。**Detach Run ID**: `20260412-104606-29623` → `20260412-105905-22423` → `20260412-110542-32610` → `20260412-111033-18779` → `20260412-111904-8812`、各 **`Summary success check: true`**・`PLAY RECAP` **`failed=0` / `unreachable=0`**。**Pi3 は本機能の必須対象外**。
- **自動回帰（本番反映後）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **98s**）。
- **実機検証**: 自動回帰は完了。**Android 手動確認**は [mobile-placement-smartphone.md](../runbooks/mobile-placement-smartphone.md) の手順で継続（V10 の **`O`→`0` 補正** と、V9 の **成功時 `OCR:` 非表示** を目視）。

## References

- 実装（工具配置）: `apps/api/src/services/mobile-placement/mobile-placement.service.ts`
- 実装（部品配膳・照合）: `apps/api/src/services/mobile-placement/mobile-placement-slip-match.ts` ほか
- Runbook: [mobile-placement-smartphone.md](../runbooks/mobile-placement-smartphone.md)
