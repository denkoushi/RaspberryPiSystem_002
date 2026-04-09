# Runbook: キオスク要領書（PDF）

## 目的

要領書 PDF の手動登録、Gmail からの取り込み、キオスク表示の確認と復旧手順を記録する。

## 本番デプロイ（HTML 取り込みを含む API 変更時）

- **DB マイグレーション**: `gmailLogicalKey` / `gmailInternalDateMs` を追加するマイグレーション（例: `20260408100000_kiosk_document_gmail_logical_key`）を **本番 DB に適用**してから API を起動する（既存 Gmail 行は移行 SQL で論理キー付与・重複時は古い行を `enabled=false` でキー解除）。
- **運用確認（2026-04-08）**: Gmail 要領書 **同名添付の上書き**（`gmailLogicalKey`・`messages.get` `internalDate` 比較）・Prisma `20260408100000_kiosk_document_gmail_logical_key`・ブランチ `feat/kiosk-gmail-logical-key-upsert`・**Pi5 のみ** `--limit raspberrypi5`。**Detach Run ID**: `20260408-215226-25074`（**`PLAY RECAP` `failed=0` / `unreachable=0`**・リモートログ basename: `ansible-update-20260408-215226-25074`・Mac 側フォロー完走まで **約 22 分**）。**Phase12**: `./scripts/deploy/verify-phase12-real.sh`（`RASPI_SERVER_HOST` 設定済み）→ **PASS 43 / WARN 0 / FAIL 0**（約 **114s**）。**手順**: [deployment.md](../guides/deployment.md)・`export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`・`./scripts/update-all-clients.sh <branch> infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`（本記録時点の検証ブランチは feature。`main` マージ後はブランチを `main` に読み替え）。
- **実機データ確認（2026-04-08 JST 夜〜09・Pi5 本番 DB / API ストレージ）**: 運用で **同一 HTML を別メール**から再送した事例。タイトル **`SD000032603_研削_OP-01`**。**有効行**（例: id `eecbd587-cdca-45c3-b178-c5073569f0c0`）に **`gmailLogicalKey`**=`sd000032603_研削_op-01.html`、**`gmailInternalDateMs`**=`1775654906000`（**2026-04-08 22:28:26 JST** 相当）、**`gmailMessageId`** が **新メール側**（先頭 `19d6d47e…`）へ更新、**`updatedAt`** **2026-04-08 17:30:26 UTC** 前後。**別行**（例: id `35e6594f-…`・旧メール）は **`enabled=false`**・論理キーなし・別 **`gmailMessageId`**（`19d6c661…`）。**ページ画像**は API コンテナ内 `/app/storage/pdf-pages/{文書UUID}/…-1.jpg` が **2026-04-08 13:30 UTC** 前後に更新され、**ピクセル 1490×2108**（180dpi 相当）を確認（`docker cp` + ホストで JPEG SOF 読取の例: [KB-313](../knowledge-base/KB-313-kiosk-documents.md)）。
- **トラブルシュート（上書きが動かないように見える）**: API は **`internalDate` が取得できない／0 のメール**では **既存行を上書きしない**（誤上書き防止）。運用では `getMessageInternalDateMs` が **0 を返していないか**（Gmail API 応答・レート制限）をログで確認する。**ローカル DB で全マイグレーションを試す**ときは **pgvector 同梱 Postgres**が必要（素の `postgres:16` だと `extension "vector" is not available`）。例: `pgvector/pgvector:pg16`（本リポジトリの検証知見と同型）。
- **影響ホスト**: API コンテナは **Pi5（`raspberrypi5`）のみ**更新すればよい（キオスク UI は既存の PDF 表示経路のまま。[deployment.md](../guides/deployment.md) の **「API/DBのみ: Pi5のみ」**）。
- **標準コマンド例**（1 台のみ・デタッチ＋フォロー）:

```bash
export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"
./scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow
```

## 本番デプロイ（キオスク **要領書ビューア**・`apps/web` のみ・Pi5 配信）

- **運用確認（2026-04-09）**: キオスク `/kiosk/documents` の **縦スクロール安定化**（`useKioskDocumentNearVisibleRows`・`KioskDocumentViewerPageRow`・`kioskDocumentViewerVisibility.ts`）。ブランチ **`fix/kiosk-documents-viewer-scroll-stability`**。**Pi5 のみ** `--limit raspberrypi5`・Detach **`20260409-185355-5342`**（**`PLAY RECAP` `failed=0`**・所要 **約 7 分**）。**Phase12**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **120s**）。**Pi4 Ansible は不要**（SPA は Pi5 の `web` コンテナから配信。[deployment.md](../guides/deployment.md) の **Web のみ・Pi5 のみ**判断と同型）。CI は web イメージ Trivy 向け **`.trivyignore`（CVE-2026-39883）** を含む。**手動（推奨）**: 各 Pi4 Firefox で長文書をスクロールし、**ガタつき・行高の跳ね**が改善しているか目視。詳細は [KB-313](../knowledge-base/KB-313-kiosk-documents.md)。

## 本番デプロイ（要領書**管理画面**のみ・`apps/web` のみの変更時）

- **影響ホスト**: 管理コンソールの Web バンドルは **Pi5（`raspberrypi5`）** に載るため、通常は **Pi5 のみ**で足りる（[deployment.md](../guides/deployment.md) の **「Webアプリのみ: … Pi5 のみ」** の判断と同型）。
- **運用確認（2026-04-08）**: 要領書 **PDF→JPEG 既定**を **180 DPI / 品質 88** に引き上げ（ブランチ `feat/kiosk-document-pdf-render-defaults-180dpi`・**Pi5 のみ** `--limit raspberrypi5`）。Detach Run ID: `20260408-201253-19203`（`failed=0`）。Phase12: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**。既存 JPEG キャッシュは自動では張り替わらない（要領書再登録 or `pdf-pages` 削除が必要な場合あり・[KB-313](../knowledge-base/KB-313-kiosk-documents.md)）。
- **運用確認（2026-04-08）**: 要領書 **ページ画像配信ルート**を、変換側と同じ保存先に統一（ブランチ `fix/kiosk-pdf-pages-route-storage-path`・**Pi5 のみ** `--limit raspberrypi5`）。Detach Run ID: `20260408-204640-13669`（`failed=0`）。Phase12: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**。対象 HTML 要領書 `SD000032603_研削_OP-01` は、配信 URL が **HTTP 200** に復帰し、再生成 JPEG は **`1490 x 2108`** を確認。
- **運用確認（2026-04-08）**: `feat/kiosk-doc-gmail-schedules-list` を **`--limit raspberrypi5`** で反映。Ansible サマリ例: `ansible-update-20260408-185957-2678`（`failed=0`）。Phase12: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**。
- **ブラウザ確認**: `/admin/kiosk-documents` の **要領書Gmailスケジュール一覧**と **手動取り込み**の **ID 反映**ボタン。

- **デプロイ失敗（Pi5 で `git` が `unable to unlink` / `pull` 中止）**: 一部パスが **root 所有**になっている典型。 [deployment.md](../guides/deployment.md) の **「ワークツリー権限」**・[KB-325](../knowledge-base/infrastructure/signage.md#kb-325-split-compact24-loan-cards-pi5-git) を参照し **`chown`** のうえ、運用で許容できる場合は **`git reset --hard origin/<branch>`** と **`git clean -fd`** でリポジトリをリモートと一致させてから **再デプロイ**（**`git clean` は未追跡ファイルを削除**する。ホスト専用の未バックアップ作業物がある場合は事前に退避）。
- **実機スモーク**: `./scripts/deploy/verify-phase12-real.sh`（**キオスク要領書 API** を含む）。**2026-04-08**: 匿名 **サイネージ**が **`contentType: TOOLS`** の時間帯は **`layoutConfig` 無しで正常**（スクリプトで分岐済み）。**同日（Pi5 のみ・運用指示）**: サマリ `ansible-update-20260408-154206-25754`・Phase12 **PASS 42 / WARN 1 / FAIL 0**。**同日（Web のみ・Gmail スケジュール一覧 UI）**: サマリ `ansible-update-20260408-185957-2678`・Phase12 **PASS 43 / WARN 0 / FAIL 0**。

## 手動アップロード

1. 管理コンソール → **要領書（キオスク）**（`/admin/kiosk-documents`）
2. PDF を選択し、必要なら表示タイトルを入力 → **アップロード**
3. 一覧の **文書番号**・**要約**列で、OCR 候補（`candidateDocumentNumber`・`summaryCandidate1`〜`3`）を参照し、**確定文書番号**・**確定要約**を編集して保存する（形式は [KB-313 §確定文書番号](../knowledge-base/KB-313-kiosk-documents.md) の正規表現に従う。**接尾は大文字英数字のみ**。不一致は API が **400**）
4. キオスク `/kiosk/documents` で一覧に表示されることを確認（左一覧の上段が確定文書番号優先、下段が確定要約）

## Gmail 取り込み

### 前提

- `backup.json`（または管理画面から保存されるバックアップ設定）で `storage.provider` が **`gmail`**
- Gmail OAuth トークンが有効（[Gmail セットアップガイド](../guides/gmail-setup-guide.md) の Client ID/Secret・コールバック URL・OAuth 実行）
- `kioskDocumentGmailIngest` にエントリを追加する:

```json
"kioskDocumentGmailIngest": [
  {
    "id": "kiosk-docs-main",
    "name": "要領書メール",
    "subjectPattern": "[Pi5] 要領書",
    "fromEmail": "optional@example.com",
    "schedule": "0 * * * *",
    "enabled": true
  }
]
```

### HTML 添付（要領書）— 研削用件名例

- **未読**メールで、件名がスケジュールの `subjectPattern` に一致し、**PDF** または **HTML**（`text/html` / `.html` / `.htm`）が添付されていれば取り込む。
- HTML は API 内で **Playwright（Chromium）により PDF 化**したうえで、既存の要領書 PDF パイプライン（保存・ページ画像化・OCR）へ載せる。Docker API イメージには Chromium が同梱済み（`Dockerfile.api` の `playwright install chromium`）。
- **同一メール内**の二重取り込みは `gmailMessageId` + **元の添付ファイル名**（`gmailDedupeKey`）でスキップする。
- **別メール**で **同名添付**（例: Power Automate で固定命名）のときは **`gmailLogicalKey`** で既存行を **新しいメール**（Gmail `internalDate`）で上書きする。運用結果 JSON に **`pdfsUpdated` / `htmlUpdated`**（上書き）および **`pdfsSkippedOlderMail` / `htmlSkippedOlderMail`**（古いメールを捨てた件数）が含まれる。
- 件名例（運用で合わせる）:

```json
"kioskDocumentGmailIngest": [
  {
    "id": "kiosk-doc-html-grinding",
    "name": "要領書HTML研削",
    "subjectPattern": "要領書HTML研削",
    "schedule": "*/10 * * * *",
    "enabled": true
  }
]
```

手動取り込み結果の JSON に、**PDF**: `pdfsImported` / `pdfsUpdated` / `pdfsSkippedDuplicate` / `pdfsSkippedOlderMail`、**HTML**: `htmlImported` / `htmlUpdated` / `htmlSkippedDuplicate` / `htmlSkippedOlderMail` が含まれる。

**環境変数（任意）**

- `KIOSK_DOCUMENT_HTML_TO_PDF_TIMEOUT_MS` — `setContent` のタイムアウト（ミリ秒、既定 120000）

**検証項目**（Vitest・API・手動の一覧）: [kiosk-html-gmail-ingest-verification.md](../plans/kiosk-html-gmail-ingest-verification.md)

- API 再起動後、内部スケジューラが cron を登録する。設定保存時はバックアップ関連スケジューラが再読み込みされる。

### 手動実行

1. `/admin/kiosk-documents` → **Gmailから取り込み（手動実行）**
2. 特定スケジュールのみなら **スケジュールID** を入力して **取り込み実行**

### 処理後のメール

各メッセージについて **PDF および HTML 添付**を順に処理した後、**既読化＋アーカイブ（INBOX から除去）** を試行する。同一メール・同一添付名は `gmailDedupeKey` で再取り込みされない。別メールの **同名添付**は `gmailLogicalKey` の **上書きルール**（上記）に従う。

## OCR / 自動ラベリング運用

- 新規登録文書は `ocrStatus=PENDING` で登録される（公開は継続）。
- 夜間バッチ（既定 `KIOSK_DOCUMENT_OCR_CRON="30 2 * * *"`）が FIFO / 1並列 / 1リトライで処理。
- 管理画面の要領書一覧で `抽出待ち / 処理中 / 完了 / 失敗` を確認できる。
- 失敗時は Slack 連携（alerts DB dispatcher）へ `kiosk-document-ocr-*` アラートを作成する。
- **エンジン契約（重要）**: 既定では API が **PDF を `pdftoppm` で画像化**し、**NDLOCR-Lite 公式 CLI**（ページごとに `ndlocr-lite --sourceimg <画像> --output <dir>` または `python3 <path/to/ocr.py> …`）で処理し、出力先の **`.txt` をページ順で結合**する。**API Docker イメージに NDLOCR-Lite を同梱**する運用を標準とし、ホスト手作業導入は前提にしない。stdout に1本で PDF を渡す独自コマンドだけ使う場合は `KIOSK_DOCUMENT_OCR_LEGACY_STDOUT=true` と `KIOSK_DOCUMENT_OCR_COMMAND` をセット。詳細は [KB-313](../knowledge-base/KB-313-kiosk-documents.md) の環境変数表。

### 要約候補のテキスト推論（任意・フェーズ1）

- **既定は無効**。`KIOSK_DOCUMENT_SUMMARY_INFERENCE_ENABLED=true` かつ推論プロバイダが解決できるとき、OCR 完了後に **OpenAI 互換 `/v1/chat/completions`（テキスト）** で `summaryCandidate1` を生成し、2〜3 は従来の機械スニペットで補完する。
- 推論失敗・タイムアウト時は **機械スニペットのみ**にフォールバックし、**OCR 完了や DB 更新は継続**する（推論は補助）。
- 複数推論先・モデルは `INFERENCE_PROVIDERS_JSON` と用途別 env で指定する。詳細は [ADR-20260402](../decisions/ADR-20260402-inference-foundation-phase1.md) と [KB-313](../knowledge-base/KB-313-kiosk-documents.md) の環境変数表。
- **`LOCAL_LLM_RUNTIME_MODE=on_demand` 時**: 推論前に Pi5 が Ubuntu 側で `llama-server` を起動する。**ログ**に `upstream_http_403` が出たら **推論トークンと Ubuntu `api-token` の整合**、[local-llm-tailscale-sidecar.md](./local-llm-tailscale-sidecar.md) の **on_demand / 503** 節を参照。

### OCR ヘルスチェック（デプロイ直後）

```bash
cd /opt/RaspberryPiSystem_002
docker compose -f infrastructure/docker/docker-compose.server.yml exec -T api which ndlocr-lite
docker compose -f infrastructure/docker/docker-compose.server.yml exec -T api ndlocr-lite --help >/dev/null
```

上記が失敗する場合、API イメージが古い可能性が高い。最新イメージで再デプロイ後に再確認する。**補足**: `ndlocr-lite --help` 実行時、stderr に ONNX Runtime の GPU device discovery 警告が出ることがある。**終了コード 0** ならコンテナ CPU 推論運用上は問題にしない（[KB-313](../knowledge-base/KB-313-kiosk-documents.md)）。

### 手動再処理

1. 管理画面 `/admin/kiosk-documents` で対象行の **再処理** を実行
2. API 直叩きの場合:

```bash
curl -X POST "https://<host>/api/kiosk-documents/<document-id>/reprocess" \
  -H "Authorization: Bearer <admin-or-manager-jwt>"
```

### Nightly バッチ手動実行

```bash
curl -X POST "https://<host>/api/kiosk-documents/run-nightly-ocr" \
  -H "Authorization: Bearer <admin-or-manager-jwt>"
```

## キオスク表示確認

- URL: `/kiosk/documents`（沉浸式レイアウト。最上段メニューは上端ホバーで表示、[KB-311](../knowledge-base/KB-311-kiosk-immersive-header-allowlist.md)）
- 左: 検索・取込元フィルタ・一覧（**既定は表示**。ツールバー左の **一覧アイコン** で開閉し、表示領域をビューアに譲る）。**2026-03-29 追記**: 検索欄横の **スキャン** でカメラセッションを開き、一次元バーコードを読取って **trim 後に検索欄へ反映し即検索**（詳細・仕様・トラブルシュートは [KB-313](../knowledge-base/KB-313-kiosk-documents.md)・[ADR-20260329](../decisions/ADR-20260329-kiosk-document-barcode-scan-zxing.md)）。**2026-03-27 以降**: 各行 **上段**は確定文書番号があればそれを、無ければ表示タイトル系。**下段**は確定要約（[KB-313](../knowledge-base/KB-313-kiosk-documents.md)）。**2026-03-27 追記**: 要約は 2 行で切れるが、**マウスオーバーで `title` ツールチップ**に全文（[KB-313](../knowledge-base/KB-313-kiosk-documents.md)）。
- 右: **1ページ** / **見開き**（テキスト）、**標準幅** / **幅いっぱい**（**アイコン**）、**拡大**（**標準幅** のときのみ有効。**幅いっぱい** 時は無効・仕様。無効時は `%` が `—` のみ）、スクロール
- ツールバー: ビューア直下の **重複タイトル行は無し**（一覧で文書名を確認）。ダーク背景では **`ghostOnDark`** ボタンで視認性を確保（`ghost` 単体は薄く見えることがある）。**検索語があるときだけ** ツールバー右に **`extractedText` のヒット抜粋**（最大3・`<mark>`）または「一致なし」メッセージ（[KB-313](../knowledge-base/KB-313-kiosk-documents.md)）。**2026-03-27 追記（イマーシブ時）**: 上記コントロールと抜粋を含む **帯全体**は既定で折りたたみ。**「表示オプション」行の右端スライダー型アイコン**へマウスを載せると展開（[KB-313](../knowledge-base/KB-313-kiosk-documents.md)）。タッチのみ端末では展開しづらい（既存 `useTimedHoverReveal` と同趣旨）。
- 長い PDF: スクロール時は **近傍のページ画像のみ** DOM に載る（Pi4 の負荷対策）。オフスクリーンはプレースホルダ＋ `loading="lazy"`。**2026-03-26 以降**: 一覧行 **ホバー**で **詳細 API をデバウンス付きプリフェッチ**、IO 更新は **rAF で間引き**、ページ画像は **ETag + Cache-Control**（`PDF_PAGES_CACHE_CONTROL`）で再利用しやすい（[KB-313](../knowledge-base/KB-313-kiosk-documents.md)）。**2026-03-27 以降**: キオスク一覧は **フォーカス経路の先読みを外し**（タッチ時の二重イベント抑止）、`useQuery` と `prefetchQuery` で **同一の `staleTime`（60s）等**を共有（[ADR-20260327](../decisions/ADR-20260327-kiosk-document-detail-react-query-cache.md)）。別文書選択時は **スクロールと近傍インデックスをリセット**（ページ位置ずれ防止）。

## 要領書用 JPEG 設定（API）

- `KIOSK_DOCUMENT_PDF_DPI`（既定 **180**）、`KIOSK_DOCUMENT_JPEG_QUALITY`（既定 **88**）で Pi4 閲覧の細部と負荷のバランスを取る（未設定時のコード既定。現場では env で上書き可）。サイネージの `SIGNAGE_PDF_DPI` とは独立。
- 設定変更後も `pdf-pages/{id}` に古い JPEG が残っていると **見た目は変わらない**。必要なら該当フォルダ削除または文書の再登録。詳細は [KB-313](../knowledge-base/KB-313-kiosk-documents.md)。
- `GET /api/kiosk-documents/:id` で `pageUrls` が返るのに、実際の画像 URL が **404** のときは、**配信ルートの保存先と変換先の不一致**を疑う。2026-04-08 の Pi5 では `routes/storage/pdf-pages.ts` の個別既定値が原因で、変換済み JPEG が見えなかった。まず対象 URL の `curl -I`、次に API コンテナ内の `pdf-pages/{id}` 実在を確認する。

## 孤児 PDF / ページ画像の掃除（任意）

ストレージ上に残った未参照ファイルを減らす（**既定は dry-run**）。

```bash
pnpm --filter @raspi-system/api run cleanup:pdf-orphans
# 実削除する場合のみ
pnpm --filter @raspi-system/api exec tsx src/scripts/cleanup-pdf-storage-orphans.ts --execute
```

`PDF_STORAGE_DIR` が本番と一致していること（API と同じ環境）を確認してから `--execute` を使うこと。

## デプロイ後確認（本番・実機）

1. **一括自動（推奨）**: リポジトリルートで `./scripts/deploy/verify-phase12-real.sh` を実行する。キオスク要領書向けに **`GET /api/kiosk-documents` が 200** かつ **`documents` 配列** を含むこともここで検証される（[deployment.md](../guides/deployment.md) の実機検証方針に準拠）。**フリーワード検索**の契約（`q`・部分一致・並び `createdAt` 降順・`%` 除去など）は [KB-313 §フリーワード検索](../knowledge-base/KB-313-kiosk-documents.md#フリーワード検索q) / [ADR-20260326](../decisions/ADR-20260326-kiosk-document-free-text-substring-search.md)。
2. **期待サマリ（参考）**: スクリプト拡張後は **部品測定・4 キオスク deploy-status** 等を含み **PASS 37 / WARN 0 / FAIL 0** が目安（2026-03-30 実測・推論基盤フェーズ1反映後・約 95s）。以前の記録: 要領書中心で **PASS 34 / WARN 0 / FAIL 0**（2026-03-29 実測・約 47s）、さらに以前は **PASS 30 / WARN 0 / FAIL 0**。**要領書: 文書番号・要約（DB/API/Web）**（`feat/kiosk-documents-doc-number-summary`、マイグレーション `20260327120000_add_kiosk_document_number_summary`）反映後も **PASS 30 / WARN 0 / FAIL 0**（約22s・2026-03-27 実測）を確認済み。**OCR・メタデータ**（`feature/kiosk-documents-ocr-metadata-v1`、2026-03-26 デプロイ後）も再実行で同サマリを確認済み。**`main` 追従**（2026-03-26、Pi5→Pi4×2 のみ順次・Pi3 除外）後も **PASS 30/0/0** を実測。**要領書ビューア速度・スクロール改善**（`feat/kiosk-documents-viewer-perf`、2026-03-26 デプロイ後）は Pi3 WARN 時 **PASS 29 / WARN 1 / FAIL 0**（exit 0・約105s）を実測。**要領書ツールバー改修・検索抜粋**（`feat/kiosk-documents-toolbar-search-snippets`、2026-03-26 デプロイ後）も同様に Pi3 が SSH 未到達のとき **PASS 29 / WARN 1 / FAIL 0**（exit 0）を実測。**要領書: ページ位置リセット + 詳細キャッシュ共有**（`feat/kiosk-documents-viewer-reset-on-switch`、2026-03-27）デプロイ後も **PASS 29 / WARN 1 / FAIL 0**（約 38s・Pi3 WARN）を実測。**要領書: ビューア折りたたみツールバー + 一覧要約 `title`**（`feat/kiosk-documents-hover-toolbar-and-summary-tooltip`、2026-03-27 デプロイ後）も **PASS 29 / WARN 1 / FAIL 0**（約 41s・Pi3 WARN）を実測。デプロイ直後の OCR 同梱確認は本 Runbook「OCR ヘルスチェック」または Pi5 上の `docker compose ... exec -T api ndlocr-lite --help`（stderr の ONNX WARN は [KB-313](../knowledge-base/KB-313-kiosk-documents.md) 参照）。Pi3 の SSH が一時的に `Connection closed` になると、古いスクリプトでは FAIL になりうるが、**再実行**または最新の `verify-phase12-real.sh`（`Connection closed` を WARN 扱い）で切り分け可能。要領書初回・**ビューア改修**反映後（2026-03-25）も同様に **PASS 30** を実測済み。Pi3 長期 offline 時は **WARN 1**・PASS は 1 減る想定。`FAIL > 0` のときは [deploy-status-recovery.md](./deploy-status-recovery.md) の Phase12 行と [KB-313](../knowledge-base/KB-313-kiosk-documents.md) の「知見・トラブルシュート」を参照。
3. **UI**: 上記「キオスク表示確認」のとおり、実機/VNC でタブ遷移・一覧・閲覧・表示モード・**検索＋抜粋**を確認する。**2026-03-29 追記**: **バーコードスキャン**（HTTPS・カメラ許可・実ラベル）が要件どおりか（成功時の即検索、キャンセル時の検索欄クリア）。**追加**: ツールバー操作が **暗背景でも読める**こと、長文書で **スクロールが極端に重くない**こと（Pi4）。**文書を切り替えたとき**に先頭付近から表示されること（ページ位置ずれなし）。**一覧を素早く切り替えたとき**に右ペインが **縦にガタつかない**こと（チャタリング）。**2026-03-27 追記**: イマーシブ時は **スライダーアイコンでツールバーが展開**すること、一覧要約の **`title` で全文が出る**こと。詳細は [KB-313](../knowledge-base/KB-313-kiosk-documents.md)。

## トラブルシュート

| 事象 | 確認 |
|------|------|
| 一覧が空 | ドキュメントが `enabled` か、キオスクは無効行を非表示 |
| 拡大できない | **幅いっぱい** 表示中は仕様で無効。**標準幅** に切り替える（無効時は `%` が `—` のみ） |
| 一覧に出るのに抜粋が空（または逆） | [KB-313](../knowledge-base/KB-313-kiosk-documents.md) の「一覧 API の `q` との差」と `extractedText` / `ocrStatus` を確認 |
| ツールバーが見えない／極端に薄い | ダーク UI では `ghost` ではなく **`ghostOnDark`** を使う設計。再発時は当該 `Button` variant を確認（[KB-313](../knowledge-base/KB-313-kiosk-documents.md)） |
| イマーシブ時、見開き・ズームが出てこない | **「表示オプション」右のスライダー型アイコン**へホバーして帯を展開（[KB-313](../knowledge-base/KB-313-kiosk-documents.md)） |
| 画像 broken | `GET /api/storage/pdf-pages/...` が 200 か、JPEG の Content-Type が `image/jpeg` か |
| Gmail 取り込み 400 | `storage.provider=gmail` かトークンがあるか |
| HTML が取り込めない・PDF 化で失敗 | API ログ `[PlaywrightHtmlToPdf]`。コンテナに Chromium があるか（本番 `Dockerfile.api`）。`KIOSK_DOCUMENT_HTML_TO_PDF_TIMEOUT_MS` を延ばす。HTML が外部 URL 依存のみの場合はオフラインで描画できない |
| OCR 完了しない／本文が空 | API コンテナ内で `which ndlocr-lite` と `ndlocr-lite --help` を確認。`ndlocr-lite --help` 時に stderr へ ONNX の GPU discovery WARN が出ても **終了コード 0 なら無視可**（[KB-313](../knowledge-base/KB-313-kiosk-documents.md)）。`KIOSK_DOCUMENT_NDLOCR_SCRIPT` 運用時はスクリプトパスと Python 実行可否を確認。スキャン PDF は `pdftotext` が空→OCR 必須。 |
| 重複しない | 同一 `messageId`+ファイル名は意図的にスキップ |
| Phase12 が Pi3 で FAIL（`Connection closed`） | 一時的な SSH 切断のことがある。**数分後に `./scripts/deploy/verify-phase12-real.sh` を再実行**。最新スクリプトでは当該文言を **WARN** 扱い（[KB-313](../knowledge-base/KB-313-kiosk-documents.md)） |
| 別文書にしたのに表示位置がずれる | [KB-313](../knowledge-base/KB-313-kiosk-documents.md) の `documentKey` / `scrollTop` リセット実装を確認 |
| 一覧操作で右ペインがチャタリング／Network に詳細 GET が短間隔で複数本 | **意図的な二重 API ではない**場合が多い。React Query の **`staleTime` 共有**と **pointer のみ先読み**を確認（[ADR-20260327](../decisions/ADR-20260327-kiosk-document-detail-react-query-cache.md)・[KB-313](../knowledge-base/KB-313-kiosk-documents.md)） |
| 確定文書番号の保存が 400 | [KB-313](../knowledge-base/KB-313-kiosk-documents.md) の形式（漢字1＋数字＋ハイフン＋**大文字**英数字）。小文字は不可 |
| スキャンでカメラが出ない／すぐ閉じる | **HTTPS** とブラウザの **カメラ権限**（Firefox キオスク）を確認。エラーは短文のみ → [KB-313](../knowledge-base/KB-313-kiosk-documents.md) のバーコード節 |
| バーコードが認識されない | 照明・距離・汚れ・対象形式（要領書は **一次元のみ**）。`formatPresets`・`zxingVideoReader` の調整余地は [KB-313](../knowledge-base/KB-313-kiosk-documents.md) |

詳細は [KB-313](../knowledge-base/KB-313-kiosk-documents.md) を参照。

## 関連マイグレーション

- `20260325120000_add_kiosk_documents`
- `20260326100000_add_kiosk_document_ocr_metadata`
- `20260327120000_add_kiosk_document_number_summary`
