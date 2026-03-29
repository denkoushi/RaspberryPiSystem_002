# KB-319: 写真持出 VLM 工具名ラベルの運用・実機確認

## Context

- **いつ**: 2026-03-28
- **どこ**: Pi5 API（写真持出ジョブ）、Ubuntu LocalLLM、キオスク持出一覧、サイネージ
- **背景**: `feat/photo-loan-vlm-tool-label` で、写真付き持出のサムネイルを LocalLLM の VLM に渡し、短い日本語の表示名を `Loan.photoToolDisplayName` に非同期保存する初版を実装・デプロイした。

## Symptoms

- 写真持出カードが **`撮影mode`** のまま変わらないことがある
- VLM 機能が本番 checkout / DB / API コンテナへ反映済みか判断しづらい
- LocalLLM の通常チャット運用と、写真持出の内部ジョブ運用が混同されやすい

## Investigation

- **CONFIRMED**: 実装ブランチ `feat/photo-loan-vlm-tool-label` には以下が含まれる
  - Prisma `Loan.photoToolDisplayName` / `photoToolLabelRequested` / `photoToolLabelClaimedAt`
  - `PhotoToolLabelingService` / `PhotoToolLabelScheduler`
  - `LlamaServerVisionCompletionAdapter`
  - キオスク持出一覧・サイネージの表示優先順位更新
- **CONFIRMED**: Pi5 上の checkout `5e6531c1` は、VLM 機能コミット `23a14e3f` / `c7576526` を祖先として含む
- **CONFIRMED**: 本番 DB に VLM 用 3 カラムが存在する
- **CONFIRMED**: 本番 API コンテナに `LOCAL_LLM_BASE_URL` / `LOCAL_LLM_SHARED_TOKEN` / `LOCAL_LLM_MODEL` が入っている
- **CONFIRMED**: 2026-03-28 時点の本番 DB 集計は `requested=8` / `labeled=8` / `claimed=0`
- **CONFIRMED**: 保存済みラベルの例として `マウス` / `接着剤` / `マーカー` / `リモコン` / `定規` を確認した
- **CONFIRMED**: `curl -sk https://localhost/api/system/health` は `status=ok`、`checks.database.status=ok`

## Root Cause

- ランタイム不具合ではなく、**デプロイ後のドキュメント反映が未実施**だった
- そのため、現行仕様（VLM ラベル優先、未付与時は `撮影mode`）と運用確認手順が既存ドキュメントへ反映されていなかった

## Fix

- 写真持出仕様書 `photo-loan.md` に VLM 表示名フローとデータモデルを追記
- LocalLLM Runbook に写真持出 VLM ジョブの確認手順を追記
- 既存表示仕様 KB（KB-314）を、**VLM ラベル優先 + `撮影mode` フォールバック**の現行仕様へ更新
- 本 KB と各索引（`docs/INDEX.md` / `docs/knowledge-base/index.md`）を追加更新

## Prevention

- LocalLLM を使う**内部ジョブ**を本番へ出したら、同日中に
  - 仕様書
  - Runbook
  - KB
  - 索引
  を最低限更新する
- 実機確認は UI 目視だけでなく、DB 集計
  - `photoToolLabelRequested`
  - `photoToolDisplayName`
  - `photoToolLabelClaimedAt`
  を併用する

## Verification Snippets

### 1. 本番 DB 集計

```bash
docker compose -f /opt/RaspberryPiSystem_002/infrastructure/docker/docker-compose.server.yml exec -T db \
  psql -U postgres -d borrow_return -v ON_ERROR_STOP=1 -P pager=off -F $'\t' -A -c \
  "SELECT COUNT(*) FILTER (WHERE \"photoToolLabelRequested\" IS TRUE) AS requested,
          COUNT(*) FILTER (WHERE \"photoToolDisplayName\" IS NOT NULL) AS labeled,
          COUNT(*) FILTER (WHERE \"photoToolLabelClaimedAt\" IS NOT NULL) AS claimed
   FROM \"Loan\";"
```

### 2. API コンテナの LocalLLM 設定

```bash
docker compose -f /opt/RaspberryPiSystem_002/infrastructure/docker/docker-compose.server.yml exec -T api \
  node -e "const b=process.env.LOCAL_LLM_BASE_URL; const t=process.env.LOCAL_LLM_SHARED_TOKEN; const m=process.env.LOCAL_LLM_MODEL; console.log(JSON.stringify({hasBaseUrl:Boolean(b), hasToken:Boolean(t), model:m||null}, null, 2));"
```

## Troubleshooting

| 症状 | 想定原因 | 対処 |
|------|----------|------|
| `requested > 0` なのに `labeled = 0` | LocalLLM 未設定、scheduler 未起動、upstream 到達不可 | `LOCAL_LLM_*` を API コンテナ内で確認し、Runbook の `/healthz` 手順で Pi5 → Ubuntu 経路を確認 |
| `claimed > 0` が長時間戻らない | 推論中断やプロセス停止で claim がスタック | `PHOTO_TOOL_LABEL_STALE_MINUTES` 経過後に自動解放されるか確認。必要なら API 再起動後に次回 cron を待つ |
| ラベルが空で保存されない | VLM 応答が空、改行だけ、または正規化後に空 | ジョブは `photoToolDisplayName` を保存せず claim を解放する。ジョブログの `responseCharLen` を確認 |
| ラベルが期待した工具名と違う | 初版仕様が「**最も目立つ 1 つ**」であり、Item マスタ照合もしていない | 仕様どおり。マスタ照合や候補提示は将来拡張として別途設計する |
| サムネイル読み込みで失敗する | `photoUrl` と thumbnail パス規則の不整合 | `PhotoStorage.readThumbnailBuffer()` の規則と実ファイル配置を確認する |
| マルチモーダル推論だけ失敗する | llama-server の `messages[].content` JSON 形が実機ビルドと異なる | `llama-server-vision-completion.adapter.ts` の `image_url + text` payload を、そのビルドの仕様に合わせて調整する |

## フェーズ1（2026-03-29）: 人レビュー・Vision 入力（高解像 JPEG）・表示統一

### Context

- **ブランチ**: `feat/photo-loan-vlm-human-review-and-vision-input`
- **内容**: `Loan` に人レビュー列（`photoToolHumanDisplayName` / `PhotoToolHumanLabelQuality` / `photoToolHumanReviewedAt` / `photoToolHumanReviewedByUserId`）、管理 API、管理画面 `/admin/photo-loan-label-reviews`。VLM 入力は既定で元画像から長辺リサイズした JPEG（`PhotoStorageVisionImageSource`）。キオスク・サイネージの1行目は **`packages/shared-types` の `resolvePhotoLoanToolDisplayLabel`** で **人レビュー表示名 > VLM (`photoToolDisplayName`) > `撮影mode`**。

### 実機確認（Pi5 SSH・2026-03-29）

- **CONFIRMED**: `GET https://127.0.0.1/api/system/health` → `status=ok`（メモリ高使用率警告のみの運用パターンあり）
- **CONFIRMED**: `Loan` に `photoToolHuman*` 列が存在（`information_schema`）
- **CONFIRMED**: 未認証 `GET /api/tools/loans/photo-label-reviews` → **401**
- **CONFIRMED**: 本番 checkout `e93cef83`・ブランチ `feat/photo-loan-vlm-human-review-and-vision-input`
- **CONFIRMED**: 写真付き Loan **154** 件のうち **`photoToolHumanReviewedAt` あり 15** 件（運用で人レビュー済みデータが存在）
- **CONFIRMED**: `PHOTO_TOOL_LABEL_VISION_SOURCE` / `PHOTO_TOOL_LABEL_USER_PROMPT` は **未設定時はコード既定**（本番では `VISION_SOURCE` 既定 `original`・長辺既定 768 等。帯域節約でサムネのみにしたい場合は `thumbnail` を明示）

### 管理 API（ADMIN / MANAGER）

| 操作 | メソッド・パス |
|------|----------------|
| レビュー待ち一覧 | `GET /api/tools/loans/photo-label-reviews?limit=…` |
| レビュー送信 | `PATCH /api/tools/loans/:id/photo-label-review`（body: `quality`, 任意 `humanDisplayName`） |

### Troubleshooting（追記）

| 症状 | 想定原因 | 対処 |
|------|----------|------|
| 管理のレビュー一覧が重い | 一覧は**サムネ URL**を参照（元画像直リンクではない）。それでも遅い場合はネットワーク・同時表示件数を確認 | `PhotoLoanLabelReviewsPage` の `limit`・キャッシュ。VLM 入力解像度は `PHOTO_TOOL_LABEL_VISION_MAX_LONG_EDGE` で調整 |
| 人レビュー後もキオスクが古い | ブラウザキャッシュ・別 Loan 行 | 該当 Loan の `photoToolHumanDisplayName` を DB で確認し、`active` 一覧を再取得 |

### References（フェーズ1）

- `feat/photo-loan-vlm-human-review-and-vision-input`
- `apps/api/src/services/tools/photo-tool-label/photo-tool-label-review.service.ts`
- `apps/api/src/routes/tools/loans/photo-label-reviews.ts`
- `packages/shared-types/src/tools/loan-card-display.ts`

## 類似候補ギャラリー（pgvector）

### Context

- **ブランチ**: `feat/photo-tool-label-similarity-gallery`
- **目的**: GOOD と判定した写真の埋め込みを DB に保持し、管理画面で **類似貸出候補** を参照する（表示のみ。キオスクの確定ラベルは変えない）。
- **前提**: Postgres は **pgvector 対応イメージ**（例 `pgvector/pgvector:pg15`）。テーブル `photo_tool_similarity_gallery` はマイグレーション生 SQL。

### 実機確認（Mac・Tailscale・2026-03-29）

- **CONFIRMED**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 34 / WARN 0 / FAIL 0**（実行時間の目安: 約 47s。Pi5 `100.106.158.2`、Network mode `tailscale`）
- **CONFIRMED**: 未認証 `GET https://<Pi5>/api/tools/loans/00000000-0000-4000-8000-000000000001/photo-similar-candidates` → **401**（Loan の有無に先立ち認可で拒否される経路であることのスモーク）
- **注**: 候補配列の中身は `PHOTO_TOOL_EMBEDDING_ENABLED`・埋め込み HTTP・GOOD ギャラリー件数に依存。本番で空配列でも API 契約・認可が正しければフェーズ12の FAIL にはならない

### 運用フラグ（API `apps/api/src/config/env.ts`）

| 変数 | 説明 |
|------|------|
| `PHOTO_TOOL_EMBEDDING_ENABLED` | `false`（既定）でギャラリー更新・候補 API は実質 no-op |
| `PHOTO_TOOL_EMBEDDING_URL` | 埋め込み HTTP の URL（enabled 時必須） |
| `PHOTO_TOOL_EMBEDDING_MODEL_ID` | DB の `embeddingModelId` と一致させる（enabled 時必須） |
| `PHOTO_TOOL_EMBEDDING_DIMENSION` | **DB の `vector(d)` と一致**（既定 512） |
| `PHOTO_TOOL_SIMILARITY_MAX_CANDIDATES` | 返す候補の最大件数 |
| `PHOTO_TOOL_SIMILARITY_MAX_COSINE_DISTANCE` | pgvector **cosine 距離**（`<=>`）の上限。小さいほど厳しい |
| `PHOTO_TOOL_SIMILARITY_PIPELINE_VERSION` | JPEG 前処理変更時のメタデータ |

### 本番配線・バックフィル（Ansible / 2026-03-29）

- **配線**: `PHOTO_TOOL_EMBEDDING_*` / 類似閾値 / シャドー補助フラグは [infrastructure/ansible/templates/docker.env.j2](../../infrastructure/ansible/templates/docker.env.j2) から `infrastructure/docker/.env` へ出力する。第2工場は [inventory.yml](../../infrastructure/ansible/inventory.yml) の `raspberrypi5` で `vault_photo_tool_*` を設定（無効時は `enabled=false` のまま）。
- **デプロイ検証**: `PHOTO_TOOL_EMBEDDING_ENABLED=true` のとき、API コンテナに `PHOTO_TOOL_EMBEDDING_URL` と `PHOTO_TOOL_EMBEDDING_MODEL_ID` が入っていること（未設定ならデプロイ fail-fast）。
- **既存 GOOD の再投入**: 埋め込みを後から ON にした場合は `pnpm backfill:photo-tool-gallery`（コンテナ内は `backfill:photo-tool-gallery:prod`）。詳細は [photo-tool-similarity-gallery.md](../runbooks/photo-tool-similarity-gallery.md)。

### 実機検証（埋め込み配線ブランチ・Pi5 のみ・2026-03-29）

- **CONFIRMED**: 本番反映は **Pi5 のみ**（[deployment.md](../guides/deployment.md) の **API/DB のみ**パターン）。`./scripts/update-all-clients.sh feat/photo-tool-embedding-rollout-shadow-eval infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`（事前に `export RASPI_SERVER_HOST=...`）。Ansible の Pi4/Pi3 play は **`--limit` により対象外**（`skipping: no hosts matched`）。
- **CONFIRMED**: マージ前後の回帰として Mac / Tailscale から `./scripts/deploy/verify-phase12-real.sh` → **PASS 34 / WARN 0 / FAIL 0**（約 45s・Pi5 `100.106.158.2`）。
- **注**: `PHOTO_TOOL_EMBEDDING_ENABLED` は vault 未設定時 **既定 false** のまま。候補 API の中身・ギャラリー件数は **有効化・バックフィル後**に初めて意味を持つ（401 と Phase12 回帰は従来どおり確認可能）。

### ローカルテスト（開発者向け・2026-03-29）

| 症状 | 想定原因 | 対処 |
|------|----------|------|
| `run-tests.sh` が **P1001**（`localhost:55432`） | 既に `postgres-test-local` が **5432** で動いており、スクリプトが **55432** を選んだ | **`POSTGRES_PORT=5432 bash scripts/test/run-tests.sh`** または `bash scripts/test/stop-postgres.sh` 後に再実行 |

### 症状と対処

| 症状 | 想定原因 | 対処 |
|------|----------|------|
| 候補が常に空 | 埋め込み無効、URL 未到達、閾値が厳しすぎる、GOOD ギャラリーが空 | `PHOTO_TOOL_EMBEDDING_*` と API ログを確認。閾値は `PHOTO_TOOL_SIMILARITY_MAX_COSINE_DISTANCE` を段階的に調整 |
| レビュー後もギャラリーに載らない | GOOD 以外にした、非同期インデックス失敗 | API ログの `Photo tool similarity gallery index failed`。JPEG 読み込み・埋め込み HTTP の応答次元を確認 |
| マイグレーションエラー | 既存 DB が vector 拡張なし | pgvector 同梱イメージへ切替えたうえで `prisma migrate deploy` |

### VLM シャドー補助（GOOD 類似・条件付き・2026-03-31）

- **目的**: 工場固有工具向けに、人レビュー **GOOD** の近傍が**厳しめ条件で収束**するときだけ、VLM に参考ラベルを短く渡した**2 回目推論**を走らせ、**ログで `currentLabel`（従来1回目）と `assistedLabel` を比較**する。`Loan.photoToolDisplayName` は **1 回目のまま**（本番ラベルは変えない）。
- **有効化**: `PHOTO_TOOL_LABEL_ASSIST_SHADOW_ENABLED=true` **かつ** `PHOTO_TOOL_EMBEDDING_ENABLED=true`（どちらか欠けるとシャドーは動かない）。**既定は false**。
- **調整**: `PHOTO_TOOL_LABEL_ASSIST_MAX_COSINE_DISTANCE`（管理 UI 向け `PHOTO_TOOL_SIMILARITY_MAX_COSINE_DISTANCE` より厳しめ推奨）、`PHOTO_TOOL_LABEL_ASSIST_MIN_NEIGHBORS`、`PHOTO_TOOL_LABEL_ASSIST_CONVERGENCE_TOP_K`、`PHOTO_TOOL_LABEL_ASSIST_QUERY_NEIGHBOR_LIMIT`。
- **ログ**: `Photo tool label shadow assist inference completed`（`assistTriggered` / `reason` / `candidateLabels` / `currentLabel` / `assistedLabel`）。未発火時は `Photo tool label shadow assist skipped`（debug）。
- **参照**: [ADR-20260331](../decisions/ADR-20260331-photo-tool-label-good-assist-shadow.md)

#### 実機確認（デプロイ後・2026-03-29）

- **CONFIRMED**: ブランチ `feat/photo-tool-label-good-assist-shadow` を Pi5→Pi4×4 のみ順次デプロイ（`docs/guides/deployment.md`・各回 `failed=0`）。Pi3 は今回対象外。
- **CONFIRMED**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 34 / WARN 0 / FAIL 0**（Tailscale・Pi5 到達時）。
- **CONFIRMED**: 未認証 `GET …/photo-similar-candidates` → **401**（回帰）。

#### Troubleshooting（シャドー補助）

| 症状 | 想定原因 | 対処 |
|------|----------|------|
| ログに shadow が一切出ない | シャドー OFF、埋め込み OFF、または補助条件未満（近傍不足・canonical 不一致・距離超過） | `PHOTO_TOOL_LABEL_ASSIST_SHADOW_ENABLED` と `PHOTO_TOOL_EMBEDDING_ENABLED` を確認。debug ログで `skipped` の `reason` を見る |
| VLM 負荷が急増 | シャドー ON で対象ローンが多い | しきい値を厳しくするか、シャドーを限定時間のみ ON。別 ADR で active 化を検討する前にログ評価 |
| 本番ラベルが変わった | バグまたは別機能 | 本仕様では `photoToolDisplayName` は 1 回目のみ保存。挙動が違う場合はデプロイ版コミットと `PhotoToolLabelingService` を確認 |

### References

- [ADR-20260330](../decisions/ADR-20260330-photo-tool-similarity-gallery-pgvector.md)
- [ADR-20260331](../decisions/ADR-20260331-photo-tool-label-good-assist-shadow.md)
- [photo-tool-similarity-gallery.md](../runbooks/photo-tool-similarity-gallery.md)
- `apps/api/src/routes/tools/loans/photo-similar-candidates.ts`

## References

- `feat/photo-loan-vlm-tool-label`
- `feat/photo-loan-vlm-human-review-and-vision-input`（フェーズ1）
- `apps/api/src/services/tools/photo-tool-label/`
- `apps/api/src/services/vision/llama-server-vision-completion.adapter.ts`
- [photo-loan.md](../modules/tools/photo-loan.md)
- [local-llm-tailscale-sidecar.md](../runbooks/local-llm-tailscale-sidecar.md)
- [KB-314](./KB-314-kiosk-loan-card-display-labels.md)
