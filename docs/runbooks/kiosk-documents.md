# Runbook: キオスク要領書（PDF）

## 目的

要領書 PDF の手動登録、Gmail からの取り込み、キオスク表示の確認と復旧手順を記録する。

## 手動アップロード

1. 管理コンソール → **要領書（キオスク）**（`/admin/kiosk-documents`）
2. PDF を選択し、必要なら表示タイトルを入力 → **アップロード**
3. キオスク `/kiosk/documents` で一覧に表示されることを確認

## Gmail 取り込み

### 前提

- `backup.json`（または管理画面から保存されるバックアップ設定）で `storage.provider` が **`gmail`**
- Gmail OAuth トークンが有効
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

- API 再起動後、内部スケジューラが cron を登録する。設定保存時はバックアップ関連スケジューラが再読み込みされる。

### 手動実行

1. `/admin/kiosk-documents` → **Gmailから取り込み（手動実行）**
2. 特定スケジュールのみなら **スケジュールID** を入力して **取り込み実行**

### 処理後のメール

各メッセージについて PDF を保存した後、**既読化＋アーカイブ（INBOX から除去）** を試行する。同一メール・同一添付名は `gmailDedupeKey` で再取り込みされない。

## OCR / 自動ラベリング運用

- 新規登録文書は `ocrStatus=PENDING` で登録される（公開は継続）。
- 夜間バッチ（既定 `KIOSK_DOCUMENT_OCR_CRON="30 2 * * *"`）が FIFO / 1並列 / 1リトライで処理。
- 管理画面の要領書一覧で `抽出待ち / 処理中 / 完了 / 失敗` を確認できる。
- 失敗時は Slack 連携（alerts DB dispatcher）へ `kiosk-document-ocr-*` アラートを作成する。
- **エンジン契約（重要）**: 既定では API が **PDF を `pdftoppm` で画像化**し、**NDLOCR-Lite 公式 CLI**（ページごとに `ndlocr-lite --sourceimg <画像> --output <dir>` または `python3 <path/to/ocr.py> …`）で処理し、出力先の **`.txt` をページ順で結合**する。**API Docker イメージに NDLOCR-Lite を同梱**する運用を標準とし、ホスト手作業導入は前提にしない。stdout に1本で PDF を渡す独自コマンドだけ使う場合は `KIOSK_DOCUMENT_OCR_LEGACY_STDOUT=true` と `KIOSK_DOCUMENT_OCR_COMMAND` をセット。詳細は [KB-313](../knowledge-base/KB-313-kiosk-documents.md) の環境変数表。

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
- 左: 検索・取込元フィルタ・一覧（**既定は表示**。ツールバー左の **一覧アイコン** で開閉し、表示領域をビューアに譲る）
- 右: **1ページ** / **見開き**（テキスト）、**標準幅** / **幅いっぱい**（**アイコン**）、**拡大**（**標準幅** のときのみ有効。**幅いっぱい** 時は無効・仕様。無効時は `%` が `—` のみ）、スクロール
- ツールバー: ビューア直下の **重複タイトル行は無し**（一覧で文書名を確認）。ダーク背景では **`ghostOnDark`** ボタンで視認性を確保（`ghost` 単体は薄く見えることがある）。**検索語があるときだけ** ツールバー右に **`extractedText` のヒット抜粋**（最大3・`<mark>`）または「一致なし」メッセージ（[KB-313](../knowledge-base/KB-313-kiosk-documents.md)）。
- 長い PDF: スクロール時は **近傍のページ画像のみ** DOM に載る（Pi4 の負荷対策）。オフスクリーンはプレースホルダ＋ `loading="lazy"`。

## 要領書用 JPEG 設定（API）

- `KIOSK_DOCUMENT_PDF_DPI`（既定 120）、`KIOSK_DOCUMENT_JPEG_QUALITY`（既定 78）で Pi4 負荷を抑える。サイネージの `SIGNAGE_PDF_DPI` とは独立。
- 設定変更後も `pdf-pages/{id}` に古い JPEG が残っていると **見た目は変わらない**。必要なら該当フォルダ削除または文書の再登録。詳細は [KB-313](../knowledge-base/KB-313-kiosk-documents.md)。

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
2. **期待サマリ（参考）**: 全ホスト到達時 **PASS 30 / WARN 0 / FAIL 0**。**OCR・メタデータ**（`feature/kiosk-documents-ocr-metadata-v1`、2026-03-26 デプロイ後）も再実行で同サマリを確認済み。**`main` 追従**（2026-03-26、Pi5→Pi4×2 のみ順次・Pi3 除外）後も **PASS 30/0/0** を実測。**要領書ツールバー改修・検索抜粋**（`feat/kiosk-documents-toolbar-search-snippets`、2026-03-26 デプロイ後）は Pi3 が SSH 未到達のとき **PASS 29 / WARN 1 / FAIL 0**（exit 0）を実測。デプロイ直後の OCR 同梱確認は本 Runbook「OCR ヘルスチェック」または Pi5 上の `docker compose ... exec -T api ndlocr-lite --help`（stderr の ONNX WARN は [KB-313](../knowledge-base/KB-313-kiosk-documents.md) 参照）。Pi3 の SSH が一時的に `Connection closed` になると、古いスクリプトでは FAIL になりうるが、**再実行**または最新の `verify-phase12-real.sh`（`Connection closed` を WARN 扱い）で切り分け可能。要領書初回・**ビューア改修**反映後（2026-03-25）も同様に **PASS 30** を実測済み。Pi3 長期 offline 時は **WARN 1**・PASS は 1 減る想定。`FAIL > 0` のときは [deploy-status-recovery.md](./deploy-status-recovery.md) の Phase12 行と [KB-313](../knowledge-base/KB-313-kiosk-documents.md) の「知見・トラブルシュート」を参照。
3. **UI**: 上記「キオスク表示確認」のとおり、実機/VNC でタブ遷移・一覧・閲覧・表示モード・**検索＋抜粋**を確認する。**追加**: ツールバー操作が **暗背景でも読める**こと、長文書で **スクロールが極端に重くない**こと（Pi4）。詳細は [KB-313](../knowledge-base/KB-313-kiosk-documents.md)。

## トラブルシュート

| 事象 | 確認 |
|------|------|
| 一覧が空 | ドキュメントが `enabled` か、キオスクは無効行を非表示 |
| 拡大できない | **幅いっぱい** 表示中は仕様で無効。**標準幅** に切り替える（無効時は `%` が `—` のみ） |
| 一覧に出るのに抜粋が空（または逆） | [KB-313](../knowledge-base/KB-313-kiosk-documents.md) の「一覧 API の `q` との差」と `extractedText` / `ocrStatus` を確認 |
| ツールバーが見えない／極端に薄い | ダーク UI では `ghost` ではなく **`ghostOnDark`** を使う設計。再発時は当該 `Button` variant を確認（[KB-313](../knowledge-base/KB-313-kiosk-documents.md)） |
| 画像 broken | `GET /api/storage/pdf-pages/...` が 200 か、JPEG の Content-Type が `image/jpeg` か |
| Gmail 取り込み 400 | `storage.provider=gmail` かトークンがあるか |
| OCR 完了しない／本文が空 | API コンテナ内で `which ndlocr-lite` と `ndlocr-lite --help` を確認。`ndlocr-lite --help` 時に stderr へ ONNX の GPU discovery WARN が出ても **終了コード 0 なら無視可**（[KB-313](../knowledge-base/KB-313-kiosk-documents.md)）。`KIOSK_DOCUMENT_NDLOCR_SCRIPT` 運用時はスクリプトパスと Python 実行可否を確認。スキャン PDF は `pdftotext` が空→OCR 必須。 |
| 重複しない | 同一 `messageId`+ファイル名は意図的にスキップ |
| Phase12 が Pi3 で FAIL（`Connection closed`） | 一時的な SSH 切断のことがある。**数分後に `./scripts/deploy/verify-phase12-real.sh` を再実行**。最新スクリプトでは当該文言を **WARN** 扱い（[KB-313](../knowledge-base/KB-313-kiosk-documents.md)） |

詳細は [KB-313](../knowledge-base/KB-313-kiosk-documents.md) を参照。

## 関連マイグレーション

- `20260325120000_add_kiosk_documents`
- `20260326100000_add_kiosk_document_ocr_metadata`
