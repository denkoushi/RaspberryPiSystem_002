# Runbook: 写真持出 GOOD 類似ギャラリー（埋め込み・バックフィル・シャドー観測）

## 目的

- 人レビュー **GOOD** の写真持出を **ベクトル化**して `photo_tool_similarity_gallery` に載せ、管理画面の類似候補 API と（任意で）VLM **シャドー補助**の入力とする。
- **本番ラベル（`photoToolDisplayName`）をシャドーで上書きしない**（現行仕様）。改善はログ評価 → 将来別 ADR で active 化を検討。

## 前提

- Pi5 API が [deployment.md](../guides/deployment.md) どおりデプロイ済み。
- Postgres が **pgvector** 対応（既存マイグレーション済み）。
- 埋め込み HTTP が API コンテナから到達可能（Tailscale / ローカル方針に合わせる）。

## 1. Ansible 本番配線（正規経路）

`infrastructure/docker/.env` は [infrastructure/ansible/templates/docker.env.j2](../../infrastructure/ansible/templates/docker.env.j2) から生成される。

第2工場 `inventory.yml` の `raspberrypi5` では vault 変数で上書きする:

| Vault 変数（例） | 説明 |
|------------------|------|
| `vault_photo_tool_embedding_enabled` | `true` / `false`（文字列） |
| `vault_photo_tool_embedding_url` | 埋め込み HTTP の URL（JSON: `jpegBase64` → `embedding`） |
| `vault_photo_tool_embedding_api_key` | 任意（Bearer） |
| `vault_photo_tool_embedding_model_id` | `PHOTO_TOOL_EMBEDDING_MODEL_ID`（enabled 時必須） |
| `vault_photo_tool_label_assist_shadow_enabled` | シャドー補助（ログのみ）。`true` には埋め込み有効も必要 |

その他の数値・閾値は inventory の `default(...)` か j2 の `default` で既定化済み。変更する場合は vault または host_vars で上書き。

**デプロイ後検証**: `roles/server` が `PHOTO_TOOL_EMBEDDING_ENABLED=true` のとき、API コンテナに `PHOTO_TOOL_EMBEDDING_URL` と `PHOTO_TOOL_EMBEDDING_MODEL_ID` が入っていることを検証する（`.env` 更新時）。

## 2. 既存 GOOD のバックフィル

埋め込みを後から ON にした場合、**過去に GOOD 済みだった Loan は自動ではギャラリーに入らない**（レビュー PATCH 時のフックのみが元データ）。そのため **一度だけ**（または pipeline 変更後に）バックフィルを実行する。

```bash
# Pi5 上の API コンテナ内（推奨）
docker compose -f /opt/RaspberryPiSystem_002/infrastructure/docker/docker-compose.server.yml exec -T api \
  pnpm backfill:photo-tool-gallery:prod
```

オプション:

- `PHOTO_TOOL_GALLERY_BACKFILL_BATCH_SIZE` — 1 バッチあたり件数（既定 25、最大 500）。

**終了コード**: `0` 成功、`1` 前提不備、`2` 一部行で失敗（ログ確認）。

実装: [PhotoToolSimilarityGalleryBackfillService](../../apps/api/src/services/tools/photo-tool-label/photo-tool-similarity-gallery-backfill.service.ts) が [PhotoToolGalleryIndexService](../../apps/api/src/services/tools/photo-tool-label/photo-tool-gallery-index.service.ts) の `syncFromSnapshot` を再利用する。

## 3. シャドー補助のログ評価（active 化しない）

1. `PHOTO_TOOL_EMBEDDING_ENABLED=true` かつ `PHOTO_TOOL_LABEL_ASSIST_SHADOW_ENABLED=true`。
2. 新規または既存の写真持出 VLM バッチが動いたあと、API ログで次を確認する。

| メッセージ | 意味 |
|------------|------|
| `Photo tool label shadow assist skipped` | 補助条件未満（debug）。`reason`（例: `too_few_neighbors`, `labels_not_converged`, `embedding_disabled`） |
| `Photo tool label shadow assist inference completed` | 2 回目 VLM 実行。`assistTriggered`, `currentLabel`, `assistedLabel`, `candidateLabels`, `reason`, `topDistance` など |

**評価観点（平易）**

- 一般工具で `assistTriggered: true` が異常に多くないか（閾値を厳しくする余地）。
- `assistedLabel` が現場の期待と近いか（工場固有工具に限定して効いているか）。
- VLM / 埋め込みの **レイテンシ・エラー率**。

**本番表示**: キオスク 1 行目は従来どおり **人 > VLM(`photoToolDisplayName`) > `撮影mode`**。シャドーは保存に使わない。

## 3.1 実機検証メモ（2026-03-29）

- **デプロイ**: 埋め込み・バックフィル・server 検証は **Pi5 API が正本**のため、[deployment.md](../guides/deployment.md) に従い **`--limit raspberrypi5`** のみ（Pi4 複数台・Pi3 は今回の機能反映に必須ではない）。`update-all-clients.sh` に **`RASPI_SERVER_HOST`**（例: `denkon5sd02@100.106.158.2`）が必要。
- **回帰**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 34 / WARN 0 / FAIL 0**（Tailscale 到達時）。
- **Ubuntu 埋め込み疎通**: LocalLLM ノードで nginx `/healthz` が `ok`、`/embed` が **`status=200 dim=512 modelId=clip-ViT-B-32`** を返すことを確認。
- **Pi5 反映**: `infrastructure/docker/.env` に `PHOTO_TOOL_EMBEDDING_ENABLED=True` と `PHOTO_TOOL_LABEL_ASSIST_SHADOW_ENABLED=True` が出力され、API コンテナ再作成まで完了。
- **バックフィル**: `pnpm backfill:photo-tool-gallery:prod` → **`loansSeen: 42, succeeded: 42, failed: 0`**、`photo_tool_similarity_gallery` は **42 行**。
- **シャドー実動**: 実機の新規写真持出 1 件で `Photo tool label shadow assist inference completed` を確認。`reason=converged_neighbors`、`candidateLabels=["マウス"]`、`currentLabel="マウス"`、`assistedLabel="マウス"`。保存された `photoToolDisplayName` も `マウス`。

## 4. 関連ドキュメント

- [KB-319](../knowledge-base/KB-319-photo-loan-vlm-tool-label.md)
- [ADR-20260330](../decisions/ADR-20260330-photo-tool-similarity-gallery-pgvector.md)
- [ADR-20260331](../decisions/ADR-20260331-photo-tool-label-good-assist-shadow.md)
- [photo-loan.md](../modules/tools/photo-loan.md)

## 5. トラブルシュート

| 症状 | 確認 |
|------|------|
| API 起動失敗 | `PHOTO_TOOL_EMBEDDING_ENABLED=true` なのに URL/model 欠落 |
| 候補 API が常に空 | 埋め込み無効、ギャラリー空、閾値 `PHOTO_TOOL_SIMILARITY_MAX_COSINE_DISTANCE` が厳しすぎる |
| バックフィルで失敗続き | 埋め込み HTTP 次元と `PHOTO_TOOL_EMBEDDING_DIMENSION` の一致、画像パス・Vision JPEG 読み込みログ |
| シャドーが一切出ない | 埋め込み OFF、シャドー OFF、GOOD 近傍不足（バックフィル未実施） |
| Mac で `vault.yml` を直して再デプロイしたのに Pi5 に反映されない | `infrastructure/ansible/host_vars/**/vault.yml` は Git 管理外。`update-all-clients.sh` のリモート実行は **Pi5 上の checkout** を使うため、ローカル編集だけでは届かない | 正規の secrets 配置を使うか、Pi5 側の `host_vars/raspberrypi5/vault.yml` を更新してから再デプロイする |
| `/healthz` は通るが `/embed` の単体確認で詰まる | `tailscale` コンテナに `python3` が無い | `embedding` コンテナ側で確認するか、HTTP の簡易確認は `wget` / `curl` に分ける |
