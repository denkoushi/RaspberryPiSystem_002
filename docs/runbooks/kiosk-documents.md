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

- URL: `/kiosk/documents`
- 左: 検索・取込元フィルタ・一覧
- 右: 1ページ / 見開き、拡大、スクロール

## デプロイ後確認（本番・実機）

1. **一括自動（推奨）**: リポジトリルートで `./scripts/deploy/verify-phase12-real.sh` を実行する。キオスク要領書向けに **`GET /api/kiosk-documents` が 200** かつ **`documents` 配列** を含むこともここで検証される（[deployment.md](../guides/deployment.md) の実機検証方針に準拠）。
2. **期待サマリ（参考）**: 全ホスト到達時 **PASS 30 / WARN 0 / FAIL 0**（2026-03-25）。Pi3 offline 時は **WARN 1**・PASS は 1 減る想定。`FAIL > 0` のときは [deploy-status-recovery.md](./deploy-status-recovery.md) の Phase12 行と [KB-313](../knowledge-base/KB-313-kiosk-documents.md) の「知見・トラブルシュート」を参照。
3. **UI**: キオスクで「要領書」タブから一覧・閲覧ができること（沉浸式ヘッダーは上端ホバーで表示、[KB-311](../knowledge-base/KB-311-kiosk-immersive-header-allowlist.md)）。

## トラブルシュート

| 事象 | 確認 |
|------|------|
| 一覧が空 | ドキュメントが `enabled` か、キオスクは無効行を非表示 |
| 画像 broken | `GET /api/storage/pdf-pages/...` が 200 か、JPEG の Content-Type が `image/jpeg` か |
| Gmail 取り込み 400 | `storage.provider=gmail` かトークンがあるか |
| 重複しない | 同一 `messageId`+ファイル名は意図的にスキップ |

詳細は [KB-313](../knowledge-base/KB-313-kiosk-documents.md) を参照。

## 関連マイグレーション

- `20260325120000_add_kiosk_documents`
