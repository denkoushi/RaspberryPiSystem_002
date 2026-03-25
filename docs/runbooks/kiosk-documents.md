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

## キオスク表示確認

- URL: `/kiosk/documents`（沉浸式レイアウト。最上段メニューは上端ホバーで表示、[KB-311](../knowledge-base/KB-311-kiosk-immersive-header-allowlist.md)）
- 左: 検索・取込元フィルタ・一覧（**既定は表示**。**一覧を隠す**で閉じ、表示領域をビューアに譲る）
- 右: **1ページ** / **見開き**、**標準幅** / **幅いっぱい**、**拡大**（**標準幅** のときのみ有効。**幅いっぱい** 時は無効・仕様）、スクロール
- ツールバー: 文書タイトルは **2行目** に回し、操作ボタンと競合しにくい（`KioskDocumentsViewerToolbar`）。ダーク背景では **`ghostOnDark`** ボタンで視認性を確保（`ghost` 単体は薄く見えることがある）。
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

1. **一括自動（推奨）**: リポジトリルートで `./scripts/deploy/verify-phase12-real.sh` を実行する。キオスク要領書向けに **`GET /api/kiosk-documents` が 200** かつ **`documents` 配列** を含むこともここで検証される（[deployment.md](../guides/deployment.md) の実機検証方針に準拠）。
2. **期待サマリ（参考）**: 全ホスト到達時 **PASS 30 / WARN 0 / FAIL 0**。要領書初回デプロイおよび **ビューア改修**（コントラスト・スクロール最適化）反映後の再実行でも同サマリを確認済み（2026-03-25、実測ログ）。Pi3 offline 時は **WARN 1**・PASS は 1 減る想定。`FAIL > 0` のときは [deploy-status-recovery.md](./deploy-status-recovery.md) の Phase12 行と [KB-313](../knowledge-base/KB-313-kiosk-documents.md) の「知見・トラブルシュート」を参照。
3. **UI**: 上記「キオスク表示確認」のとおり、実機/VNC でタブ遷移・一覧・閲覧・表示モードを確認する。**追加**: ツールバー操作が **暗背景でも読める**こと、長文書で **スクロールが極端に重くない**こと（Pi4）。詳細は [KB-313](../knowledge-base/KB-313-kiosk-documents.md)。

## トラブルシュート

| 事象 | 確認 |
|------|------|
| 一覧が空 | ドキュメントが `enabled` か、キオスクは無効行を非表示 |
| 拡大できない | **幅いっぱい** 表示中は仕様で無効。**標準幅** に切り替える |
| ツールバーが見えない／極端に薄い | ダーク UI では `ghost` ではなく **`ghostOnDark`** を使う設計。再発時は当該 `Button` variant を確認（[KB-313](../knowledge-base/KB-313-kiosk-documents.md)） |
| 画像 broken | `GET /api/storage/pdf-pages/...` が 200 か、JPEG の Content-Type が `image/jpeg` か |
| Gmail 取り込み 400 | `storage.provider=gmail` かトークンがあるか |
| 重複しない | 同一 `messageId`+ファイル名は意図的にスキップ |

詳細は [KB-313](../knowledge-base/KB-313-kiosk-documents.md) を参照。

## 関連マイグレーション

- `20260325120000_add_kiosk_documents`
