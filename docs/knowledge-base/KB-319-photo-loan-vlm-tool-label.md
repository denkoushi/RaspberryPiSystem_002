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
| `requested > 0` なのに `labeled = 0` | LocalLLM 未設定、scheduler 未起動、upstream 到達不可、`X-LLM-Token` 不一致（403）、`on_demand` 起動直後の chat 未 ready（503） | `LOCAL_LLM_*` を API コンテナ内で確認し、Runbook の `/healthz` 手順で Pi5 → Ubuntu 経路を確認。ログに **`upstream_http_403`** が出たら **Ubuntu `api-token` と Pi5 の `LOCAL_LLM_SHARED_TOKEN` を同一に**（[KB-318](./infrastructure/ansible-deployment.md#kb-318-pi5-local-llm-via-docker-env)）。**`on_demand`** 時は `component: localLlmRuntimeControl` の `runtime_ready` 後でも推論が 503 になる事例があり、API は chat ベースの readiness を行う（2026-03-31・[local-llm-tailscale-sidecar.md](../runbooks/local-llm-tailscale-sidecar.md)） |
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
- **CONFIRMED**: Ubuntu LocalLLM ノードの nginx `/healthz` は `ok`、`/embed` は **`status=200 dim=512 modelId=clip-ViT-B-32`** を返した。
- **CONFIRMED**: Pi5 API の `PHOTO_TOOL_EMBEDDING_ENABLED=True`、`PHOTO_TOOL_LABEL_ASSIST_SHADOW_ENABLED=True`、既存 GOOD のバックフィルは **42 件成功 / 0 件失敗**、`photo_tool_similarity_gallery` は **42 行**。

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

### 運用知見・人レビューとギャラリー（2026-03-30）

- **CONFIRMED**: 人レビュー PATCH は **VLM をファインチューニングしない**（`photoToolDisplayName` は VLM ジョブが書き込むのみ。レビューでモデル重みは更新されない）。
- **CONFIRMED**: GOOD ギャラリーへ載せる **`canonicalLabel` は `photoToolHumanDisplayName` を最優先**し、空なら `photoToolDisplayName`（VLM）、さらに欠落時は `撮影mode`（`PhotoToolGalleryIndexService.syncFromSnapshot`）。
- **運用（推奨）**: **正解が分かっている**なら `上書き表示名` に正解を入れ、**`品質=GOOD`** で保存すると、キオスク表示（人 > VLM）とギャラリーの教師ラベルが一致し、**類似候補の母集団が健全に育つ**。逆に **VLM が誤りで上書き名が空のまま `GOOD`** にすると、ギャラリーに **誤った VLM ラベルが canonical として入りうる**（避ける）。
- **意味の割り切り**: 画面の **品質ドロップダウン**は「VLM が正しかった」だけでなく、**「この貸出を GOOD 教師としてギャラリーに載せてよいか」** の判定にも使う。厳密な VLM 単体の成績表にしたい場合は別集計（将来拡張）が必要。
- **類似候補 API の `score`**: 応答の `score` は **`1 - cosineDistance`**（pgvector のコサイン距離 `<=>`）。管理 UI では距離上限 **`PHOTO_TOOL_SIMILARITY_MAX_COSINE_DISTANCE`**（既定 **0.22**）までを表示対象にする。
- **シャドー補助との差**: シャドーは **`PHOTO_TOOL_LABEL_ASSIST_MAX_COSINE_DISTANCE`**（既定 **0.14**）などで **より厳しく**近傍を切る。よって **類似候補では正解が上位に来るのに、シャドー ログが増えない**ことは設計上不整合ではない（閾値と件数・収束条件が異なる）。
- **観測例（管理コンソール）**: VLM が誤るケースでも、上位候補が同一正解ラベルに揃う（例: 「ラジオペンチ」が score ~0.96 で上位 2 件）。これは **GOOD ギャラリー＋埋め込み検索が人手補助に効いている**サインとして扱える。

### VLM シャドー補助（GOOD 類似・条件付き・2026-03-31）

- **目的**: 工場固有工具向けに、人レビュー **GOOD** の近傍が**厳しめ条件で収束**するときだけ、VLM に参考ラベルを短く渡した**2 回目推論**を走らせる。**シャドーのみ**のときは **ログで `currentLabel`（1 回目）と `assistedLabel` を比較**し、`Loan.photoToolDisplayName` は **1 回目を保存**（従来どおり）。
- **有効化（シャドー）**: `PHOTO_TOOL_LABEL_ASSIST_SHADOW_ENABLED=true` **かつ** `PHOTO_TOOL_EMBEDDING_ENABLED=true`（どちらか欠けるとシャドー相当の 2 回目は動かない）。**既定は false**。
- **調整**: `PHOTO_TOOL_LABEL_ASSIST_MAX_COSINE_DISTANCE`（管理 UI 向け `PHOTO_TOOL_SIMILARITY_MAX_COSINE_DISTANCE` より厳しめ推奨）、`PHOTO_TOOL_LABEL_ASSIST_MIN_NEIGHBORS`、`PHOTO_TOOL_LABEL_ASSIST_CONVERGENCE_TOP_K`、`PHOTO_TOOL_LABEL_ASSIST_QUERY_NEIGHBOR_LIMIT`。
- **ログ**: `Photo tool label shadow assist inference completed`（`assistTriggered` / `reason` / `candidateLabels` / `currentLabel` / `assistedLabel` / **`galleryRowCount`** / **`activePersistEligible`** / **`activePersistApplied`**）。未発火時は `Photo tool label shadow assist skipped`（debug）。2 回目を抑止した場合は `Photo tool label assist second vision skipped`（debug）。
- **参照**: [ADR-20260331](../decisions/ADR-20260331-photo-tool-label-good-assist-shadow.md) / [ADR-20260404](../decisions/ADR-20260404-photo-tool-label-assist-active-gate.md)

#### VLM アクティブ補助（本番保存・ギャラリー行数ゲート）

- **目的**: 収束した **`canonicalLabel` ごと**に `photo_tool_similarity_gallery` の行数が一定以上のラベルから、**収束した `canonical` を正規化した値を `photoToolDisplayName` に保存**できるようにする（ラベルごとの段階導入）。**2 回目 VLM は呼ばない**（コスト抑制）。シャドー ON のときは **2 回目をログ用に実行**しうるが、**本番表示名は収束ラベル採用**。
- **有効化**: `PHOTO_TOOL_LABEL_ASSIST_ACTIVE_ENABLED=true` **かつ** `PHOTO_TOOL_EMBEDDING_ENABLED=true`。**既定は false**。
- **ゲート**: 収束ラベル `L` について `BTRIM("canonicalLabel") = L` の行数が **`PHOTO_TOOL_LABEL_ASSIST_ACTIVE_MIN_GALLERY_ROWS`（既定 5）** 以上のときのみ、**本番へ収束ラベル直採用**（`photoToolVlmLabelProvenance = ASSIST_ACTIVE_CONVERGED`）。未満のとき **アクティブのみ ON なら** 1 回目のみ（負荷抑制）。`PHOTO_TOOL_LABEL_ASSIST_SHADOW_ENABLED=true` のときはゲート不通過でも **2 回目をログ用に実行**しうるが、**アクティブ保存はゲート通過時のみ**。
- **参照**: [ADR-20260404](../decisions/ADR-20260404-photo-tool-label-assist-active-gate.md)

#### 実機確認（アクティブ補助・収束直採用・Prisma enum 拡張・2026-04-07）

- **ブランチ**: `feat/photo-tool-active-assist-converged-label`（コミット例: `94d71f57` 付近）。
- **仕様差分**: ゲート通過時の本番表示名は **2 回目 VLM ではなく** 正規化済み **収束 canonical**。`photoToolVlmLabelProvenance = ASSIST_ACTIVE_CONVERGED`。シャドー ON 時のみ 2 回目 VLM（ログ用）。DB はマイグレーション `20260407120000_add_photo_tool_vlm_provenance_assist_active_converged`。
- **デプロイ**: [deployment.md](../guides/deployment.md) の `update-all-clients.sh`・`RASPI_SERVER_HOST`・**`--detach --follow`**。対象は **Pi5 → Pi4 キオスク 4 台を `--limit` 1 台ずつ順番**（`raspberrypi5` → `raspberrypi4` → `raspi4-robodrill01` → `raspi4-fjv60-80` → `raspi4-kensaku-stonebase01`）。**Pi3（サイネージ）は今回の写真レビュー UI / 本変更の対象外のためデプロイしない**（前回答の対象デバイスどおり）。
- **知見**: キオスク PLAY は `server` を含まないため `Deploy ... to Raspberry Pi server` が **`skipping: no hosts matched`** になるのは正常。各 Pi4 で `PLAY RECAP` **`failed=0`** を確認。
- **トラブルシュート**: マイグレーション未適用で API が Enum エラーになる場合は Pi5 で `pnpm prisma migrate deploy`（運用標準は Ansible 経由。切り分けは [deployment.md](../guides/deployment.md) の DB 整合性）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（Mac / Tailscale・Pi5 `100.106.158.2`・約 26s）。

#### 実機確認（アクティブ補助ゲート・Pi5 のみ・2026-04-02）

- **CONFIRMED**: ブランチ `feat/photo-tool-label-assist-active-gate`。本番反映は **Pi5 のみ**（[deployment.md](../guides/deployment.md) の `update-all-clients.sh` + **`--limit raspberrypi5`** + **`--detach --follow`**）。Pi4/Pi3 は **`no hosts matched`**。対象 PLAY は **`failed=0`**。
- **CONFIRMED**: `PHOTO_TOOL_LABEL_ASSIST_ACTIVE_*` は **既定 false**。有効化しない限り、本番の表示・1 回目 VLM 保存は従来と整合（アクティブ保存は **オプトイン**）。
- **CONFIRMED**: Mac / Tailscale から `./scripts/deploy/verify-phase12-real.sh` → **PASS 40 / WARN 0 / FAIL 0**（約 51s・Pi5 `100.106.158.2`）。未認証 `photo-similar-candidates`・`photo-gallery-seed` 等の既存スモークを含む。

#### Ansible 配線（`PHOTO_TOOL_LABEL_ASSIST_ACTIVE_*`・vault→inventory→docker `.env`・2026-04-07）

- **症状**: アプリ側は `PHOTO_TOOL_LABEL_ASSIST_ACTIVE_ENABLED` を解釈するが、Pi5 の生成 `infrastructure/docker/.env` が **常に `false`（テンプレ default）**のまま。vault に `vault_photo_tool_label_assist_active_*` を置いても反映されない。
- **根本原因（CONFIRMED）**: `infrastructure/ansible/templates/docker.env.j2` は既に `PHOTO_TOOL_LABEL_ASSIST_ACTIVE_*` を出力している一方、**`infrastructure/ansible/inventory.yml` の Pi5 ホスト変数に `photo_tool_label_assist_active_*` が無かった**。shadow 系と同型の **`vault_* | default(...)` 行が欠落**していた。
- **修正**: `inventory.yml` に `photo_tool_label_assist_active_enabled` / `photo_tool_label_assist_active_min_gallery_rows` を追加（`vault_photo_tool_label_assist_active_*`・既定は従来どおり OFF）。`host_vars/raspberrypi5/vault.yml.example` にキー例をコメント追記。
- **デプロイ**: [deployment.md](../guides/deployment.md) の **`update-all-clients.sh`**・**`--limit raspberrypi5`**・**`RASPI_SERVER_HOST`**・**`--detach --follow`**。ブランチ例: `feat/ansible-photo-tool-assist-active-env`（`main` 取込後は `main`）。
- **実機検証**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（2026-04-07・Mac / Tailscale・Pi5 `100.106.158.2`）。`PLAY RECAP` **`raspberrypi5` `failed=0`**。

#### 本番オペレーション: アクティブ補助の有効化（Pi5・2026-04-09）

- **Context**: 管理 UI の**類似候補**は参考表示。**本番の `Loan.photoToolDisplayName` を収束 canonical で上書き**するのは **`PHOTO_TOOL_LABEL_ASSIST_ACTIVE_ENABLED=true`** かつ埋め込み ON・補助条件・**ギャラリー行数ゲート**を満たす場合のみ（[ADR-20260404](../decisions/ADR-20260404-photo-tool-label-assist-active-gate.md)）。
- **症状**: 候補が強いのに、キオスク／DB 上の表示ラベルが **1 回目 VLM のまま**・`photoToolVlmLabelProvenance` が **`ASSIST_ACTIVE_CONVERGED` にならない**。
- **Investigation（実測例・CONFIRMED）**:
  - **類似候補**は `PHOTO_TOOL_SIMILARITY_MAX_COSINE_DISTANCE`（既定 **0.22** 前後）で切る一方、**ラベル補助／アクティブ採用**は `PHOTO_TOOL_LABEL_ASSIST_MAX_COSINE_DISTANCE`（既定 **0.14** 前後）＋近傍数・ラベル収束・active フラグ・ゲートで絞るため、**「候補が当たる」ことと「本番採用」は別**（本 KB 冒頭の「シャドー補助との差」と同型）。
  - canonical ラベル例 **`リングゲージ`** について `photo_tool_similarity_gallery` の **`BTRIM("canonicalLabel")` 一致行数** を数えると **8**（`PHOTO_TOOL_LABEL_ASSIST_ACTIVE_MIN_GALLERY_ROWS` 既定 **5** を満たす）。**にもかかわらず**当環境では **`PHOTO_TOOL_LABEL_ASSIST_ACTIVE_ENABLED=false`** のみが残っており、**ボトルネックはギャラリー件数不足ではなく active OFF** だった。
- **Fix（Pi5・手動反映／Ansible 再デプロイと同じ環境変数になるよう揃える）**:
  1. 変更前に Pi5 上で **`host_vars/raspberrypi5/vault.yml`** および **`infrastructure/docker/.env`** のバックアップ（例: `*.backup-YYYYMMDD-HHMMSS`）。
  2. vault に `vault_photo_tool_label_assist_active_enabled: "true"`（既存配線どおり）を追加し、`infrastructure/docker/.env` に **`PHOTO_TOOL_LABEL_ASSIST_ACTIVE_ENABLED=true`** を記載。
  3. API 再作成: `docker compose -f infrastructure/docker/docker-compose.server.yml up -d --force-recreate api`（compose ログに **db 等の再作成**が出ることがある。運用者は出力を確認する）。
- **Verification**: Pi5 上で `curl -sk https://localhost/api/system/health` → **status ok** 相当。`docker compose -f infrastructure/docker/docker-compose.server.yml exec -T api /bin/sh -lc 'printenv | grep PHOTO_TOOL_LABEL_ASSIST'` で **ACTIVE=true**・**EMBEDDING**・**SHADOW**・**MIN_GALLERY_ROWS** が期待どおりか確認。
- **恒久**: 手編集と Ansible 生成物の**ドリフト**を避けるため、正規手順は [deployment.md](../guides/deployment.md) の **Pi5 のみ `--limit raspberrypi5`** デプロイで vault→`docker.env.j2`→`.env` を再生成すること。

##### Troubleshooting（開発・型）

| 症状 | 想定原因 | 対処 |
|------|----------|------|
| `PhotoToolLabelAssistDecision` 追加直後に tsc / Vitest が落ちる | `convergedCanonicalLabel` を足したが、`too_few_neighbors` 等の早期 return で **フィールド欠落** | 各分岐で `convergedCanonicalLabel: null`（または収束時は文字列）を **必ず**返す |

#### 実機確認（デプロイ後・2026-03-29）

- **CONFIRMED**: ブランチ `feat/photo-tool-label-good-assist-shadow` を Pi5→Pi4×4 のみ順次デプロイ（`docs/guides/deployment.md`・各回 `failed=0`）。Pi3 は今回対象外。
- **CONFIRMED**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 34 / WARN 0 / FAIL 0**（Tailscale・Pi5 到達時）。
- **CONFIRMED**: 未認証 `GET …/photo-similar-candidates` → **401**（回帰）。
- **CONFIRMED**: 実機の新規写真持出 1 件で `Photo tool label shadow assist inference completed` を確認。`reason=converged_neighbors`、`candidateLabels=["マウス"]`、`currentLabel="マウス"`、`assistedLabel="マウス"`。保存された `photoToolDisplayName` も `マウス`。

#### Troubleshooting（シャドー補助）

| 症状 | 想定原因 | 対処 |
|------|----------|------|
| 類似候補は良いのに本番ラベルが収束しない（active 期待時） | **アクティブ補助 OFF**（`PHOTO_TOOL_LABEL_ASSIST_ACTIVE_ENABLED=false`）なら、候補が良くても **1 回目 VLM のまま**。ギャラリー行数は足りていても **active=false では直採用されない** | API コンテナ `printenv` で **ACTIVE**。canonical ごとの行数切り分け・手動有効化は「本番オペレーション: アクティブ補助の有効化（2026-04-09）」節 |
| 類似候補は良いのに shadow が増えない | **管理 UI 表示**は `PHOTO_TOOL_SIMILARITY_MAX_COSINE_DISTANCE`（広め）、シャドーは `PHOTO_TOOL_LABEL_ASSIST_MAX_COSINE_DISTANCE`（狭め）等で **別閾値**。近傍数・ラベル収束条件も追加フィルタ | 期待どおりの可能性大。シャドー観測を増やすなら env を段階調整し、別 ADR で根拠を残す |
| ログに shadow が一切出ない | シャドー OFF、埋め込み OFF、または補助条件未満（近傍不足・canonical 不一致・距離超過） | `PHOTO_TOOL_LABEL_ASSIST_SHADOW_ENABLED` と `PHOTO_TOOL_EMBEDDING_ENABLED` を確認。debug ログで `skipped` の `reason` を見る |
| VLM 負荷が急増 | シャドー ON で対象ローンが多い | しきい値を厳しくするか、シャドーを限定時間のみ ON。別 ADR で active 化を検討する前にログ評価 |
| 本番ラベルが変わった | **アクティブ補助**（`PHOTO_TOOL_LABEL_ASSIST_ACTIVE_ENABLED`・ゲート通過）で **収束 canonical が直採用**された | 意図どおりならログの `activePersistApplied: true`・`convergedPersistLabel` を確認。意図しないならフラグ・閾値・[ADR-20260404](../decisions/ADR-20260404-photo-tool-label-assist-active-gate.md) を参照 |
| vault に `vault_photo_tool_label_assist_active_enabled=true` があるのに `.env` が `false` | **2026-04-07 以前**: inventory に `photo_tool_label_assist_active_*` が無くテンプレ default のみ。**現在**: 配線済み。再デプロイ後も `false` なら Pi5 側 **`host_vars/raspberrypi5/vault.yml`** の実体・ansible-vault 復号・`docker/.env` 再生成を確認（[deployment.md](../guides/deployment.md)） |
| ローカルの `host_vars/raspberrypi5/vault.yml` を更新しても Pi5 に反映されない | `infrastructure/ansible/host_vars/**/vault.yml` は Git 管理外で、Pi5 リモート実行時は **Pi5 側 checkout** のファイルが使われる | 正規の secrets 配置を使うか、Pi5 上の `host_vars/raspberrypi5/vault.yml` を更新してから再デプロイ |
| `/healthz` は通るが `/embed` の Python ワンライナー確認が失敗する | `tailscale` コンテナに `python3` が無い | `embedding` コンテナ側で単体確認するか、`wget` / `curl` で疎通確認と payload 確認を分ける |

### 管理コンソール ギャラリー教師登録（`photo-gallery-seed`・2026-04-01）

#### Context

- **ブランチ**: `feat/admin-photo-gallery-seed`
- **目的**: キオスクからの実貸出なしに、**JPEG + 教師ラベル（正規化後の表示名）** だけで `Loan` を1件作り、**類似ギャラリー**の母集団を増やす（`PHOTO_TOOL_EMBEDDING_ENABLED=true` のとき `PhotoToolGalleryIndexService` が非同期で反映）。
- **実貸出ではない**: `Loan.photoToolGallerySeed = true`。同日時刻で **`returnedAt` を立て**キオスク `active` 一覧から除外。`photoToolHumanQuality = GOOD`・`photoToolHumanDisplayName` に教師ラベルを入れたうえでレビュー通知経路を再利用。

#### API・管理 UI

| 操作 | 内容 |
|------|------|
| 登録 | `POST /api/tools/loans/photo-gallery-seed`（**ADMIN / MANAGER**・`multipart/form-data`・フィールド **`image`**（JPEG）・**`canonicalLabel`**（テキスト）） |
| 応答 | `{ loanId, photoUrl, canonicalLabel }`（正規化後ラベル） |

#### 実機確認（Mac・Tailscale・2026-04-01）

- **CONFIRMED**: 本番は **Pi5 → Pi4×4 → Pi3** を [deployment.md](../guides/deployment.md) に従い **`--limit` 1 台ずつ**・**`--detach --follow`**（Pi3 はサイネージ専用手順）。各 PLAY **`failed=0`**。
- **CONFIRMED**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 39 / WARN 0 / FAIL 0**（未認証 **`POST …/photo-gallery-seed` → 401** のスモークをスクリプトに追加）。
- **手動（推奨）**: `https://<Pi5>/admin/photo-gallery-seed` で画像アップロード・成功メッセージ・返却 `loanId` を確認。埋め込み OFF の環境ではギャラリー行が増えないことは仕様（API・DB・写真保存は成功しうる）。

#### 実機確認（運用者・本番管理 UI・2026-04-01）

- **CONFIRMED**: `https://<Pi5>/admin` の **ADMIN/MANAGER** で `/admin/photo-gallery-seed` を開き、**JPEG 1 件**と教師ラベル（例: 「ロックナット締付工具」）を送信。**直近の登録結果**に **貸出ID（UUID）** が表示され、登録フローは成功。
- **CONFIRMED**: 同一画面の **類似候補** が「ありません」と出ても、**登録失敗とは限らない**。`PHOTO_TOOL_EMBEDDING_ENABLED=false`（既定）・閾値・ギャラリー件数不足のいずれかで **候補配列が空**になりうる（画面説明文どおり。Phase12 の **401** は認可の回帰として別途担保）。

#### Troubleshooting

| 症状 | 想定原因 | 対処 |
|------|----------|------|
| 登録できたのに **類似候補はありません** だけが表示される | 埋め込み無効、近傍が閾値外、教師が 1 件のみで自己類似が返らない設計 | **貸出IDが出ていれば API・DB・写真保存は成功**のことが多い。候補を見たい環境では `PHOTO_TOOL_EMBEDDING_*` と [photo-tool-similarity-gallery.md](../runbooks/photo-tool-similarity-gallery.md) を確認 |
| **400** `JPEG 画像をアップロード` | PNG 等 | JPEG に変換して再送 |
| **400** 教師ラベルが空 | `canonicalLabel` 未送信・空白のみ | 正規化後に空にならない文字列を送る |
| **401** | 未ログイン・VIEWER | ADMIN/MANAGER でログイン（または Bearer） |
| DB エラー後にストレージにだけ画像 | 稀な不整合 | 実装は `prisma.loan.create` 失敗時に **`PhotoStorage.deletePhoto`** でロールバック。ログとストレージを照合 |
| 登録したが類似候補に出ない | 埋め込み無効・閾値・バックフィル未実施 | `PHOTO_TOOL_EMBEDDING_*`・[photo-tool-similarity-gallery.md](../runbooks/photo-tool-similarity-gallery.md) |

#### References（実装）

- `apps/api/src/routes/tools/loans/photo-gallery-seed.ts`
- `apps/api/src/services/tools/photo-tool-label/photo-gallery-seed.service.ts`
- `apps/web/src/pages/admin/PhotoGallerySeedPage.tsx`
- Prisma: `Loan.photoToolGallerySeed`（マイグレーション `20260401140000_add_loan_photo_tool_gallery_seed`）

### References

- [ADR-20260330](../decisions/ADR-20260330-photo-tool-similarity-gallery-pgvector.md)
- [ADR-20260331](../decisions/ADR-20260331-photo-tool-label-good-assist-shadow.md)
- [ADR-20260404](../decisions/ADR-20260404-photo-tool-label-assist-active-gate.md)
- [photo-tool-similarity-gallery.md](../runbooks/photo-tool-similarity-gallery.md)
- `apps/api/src/routes/tools/loans/photo-similar-candidates.ts`

### 推論基盤フェーズ1（ルーテッド vision・2026-03-30）

- **変更**: 写真持出ラベルの vision 呼び出しは **`RoutedVisionCompletionAdapter`** 経由で用途 **`photo_label`**（[ADR-20260402](../decisions/ADR-20260402-inference-foundation-phase1.md)）。既定の接続先は従来どおり **`LOCAL_LLM_*`** または **`INFERENCE_PROVIDERS_JSON`** の解決結果。
- **実機（Pi5 + Phase12）**: ブランチ `feat/inference-foundation-phase1` を **`--limit raspberrypi5` のみ**デプロイ後、`./scripts/deploy/verify-phase12-real.sh` → **PASS 37 / WARN 0 / FAIL 0**（2026-03-30・約 95s）。未認証 `photo-similar-candidates` の **401** 等の既存チェックを含む。
- **観測**: ラベルジョブまわりの失敗切り分けは API ログの **`component: inference`**・`useCase: photo_label`（本文・画像は出さない）を参照。upstream・モデル・タイムアウトは [local-llm-tailscale-sidecar.md](../runbooks/local-llm-tailscale-sidecar.md) と併読。

### オンデマンド llama-server と VRAM（ComfyUI 等・2026-03-30）

- **事象**: `llama-server` が常駐すると `nvidia-smi` で **数 GB の `used_gpu_memory`** を専有し、同一 GPU で ComfyUI（例: FLUX）が **CUDA OOM** になりやすい。
- **切り分け**: Ubuntu で `nvidia-smi` の **Processes** に `/app/llama-server` が出ていれば、本システム用コンテナが VRAM を保持している（CONFIRMED 例: 約 4162 MiB / 8GB）。
- **対応方針**: [ADR-20260403](../decisions/ADR-20260403-on-demand-local-llm-runtime-control.md)。Pi5 で `LOCAL_LLM_RUNTIME_MODE=on_demand` とし、Ubuntu に [scripts/ubuntu-local-llm-runtime/control-server.mjs](../../scripts/ubuntu-local-llm-runtime/control-server.mjs) 等の **起動・停止 HTTP** を配線する。写真登録後は `PhotoToolLabelScheduler` が **直列化された `runOnce`** で処理し、ジョブごとに ensure/release する（初回は起動待ちが乗る）。
- **ログ**: 起動待ち・停止は `component: localLlmRuntimeControl`（`action: runtime_ready` / `runtime_stopped` 等）。
- **本番デプロイ後の回帰（2026-03-30）**: ブランチ `feat/on-demand-llm-runtime-control` を Pi5→Pi4×4 のみ順次反映後、Mac / Tailscale で `./scripts/deploy/verify-phase12-real.sh` → **PASS 37 / WARN 0 / FAIL 0**（約 100s）。**既定 `LOCAL_LLM_RUNTIME_MODE=always_on`** のままなら制御 HTTP は no-op（従来の常駐運用）。
- **本番有効化の確認（2026-03-30）**: `main` で Pi5 を再デプロイし、Pi5 → Ubuntu の **`/start` / `/stop` がともに HTTP 200** を確認。運用者の実機確認では **ComfyUI は従来手順で起動・生成成功、OOM / GPU メモリ不足なし**。さらに Ubuntu でアイドル時 `docker compose ps` を確認し、**`compose-llama-server-1` が不在**であることを確認した。
- **トラブルシュート（今回の実測）**:
  - Pi5 の制御 URL を **`100.107.223.92:39091`** に向けても timeout した。**原因**: tailnet IP `100.107.223.92` は Ubuntu ホストではなく `local-llm-system` の `compose-nginx-1` 側。**対処**: 制御 URL を **`http://100.107.223.92:38081/start|stop`** に統一。
  - `compose-nginx-1` が **`unknown "llm_runtime_control_token" variable`** で再起動ループした。**原因**: `envsubst` の対象に `LLM_RUNTIME_CONTROL_TOKEN` を足していなかった。**対処**: `compose.yaml` の nginx `command` を修正。
  - `/start` が **502** になった。**原因**: `network_mode: service:tailscale` の nginx から `127.0.0.1:39090` を向くとコンテナ自身を見に行く。**対処**: `control-server.mjs` を **`0.0.0.0:39090`** で待たせ、nginx は Docker bridge gateway（実測 `172.19.0.1`）へ `proxy_pass` する。

## VLM ラベル出自（provenance・管理レビュー・2026-04-03）

### Context

- **ブランチ**: `feat/photo-tool-vlm-label-provenance-admin`
- **目的**: `Loan.photoToolDisplayName` が**どの VLM 経路で最後に確定したか**を DB に保持し、管理画面の人レビュー一覧で運用者が判断できるようにする（キオスクの1行目表示優先順位は変更しない）。
- **契約**: `packages/shared-types` の `PHOTO_TOOL_VLM_LABEL_PROVENANCE`（`UNKNOWN` / `FIRST_PASS_VLM` / `ASSIST_ACTIVE_VLM` / `ASSIST_ACTIVE_CONVERGED`）と Prisma enum を同値にそろえる。

### 仕様（要点）

- **DB**: `Loan.photoToolVlmLabelProvenance`。マイグレーション追加時の既存行は **`UNKNOWN`**。
- **保存**: `PhotoToolLabelingService` が VLM 結果を `completeWithLabel` へ渡す際、1 回目確定 → `FIRST_PASS_VLM`、アクティブ補助で **収束 canonical を本番表示名に直採用**した場合 → `ASSIST_ACTIVE_CONVERGED`。**`ASSIST_ACTIVE_VLM`** は過去行・将来の互換用に DB 上は残す（実装詳細は `prisma-photo-tool-label.repository.ts` / labeling サービス）。
- **API**: `GET /api/tools/loans/photo-label-reviews`・`PATCH …/photo-label-review` の応答に `photoToolVlmLabelProvenance` を含む。
- **Web**: `/admin/photo-loan-label-reviews` でバッジと説明文を表示。

### 実機確認（Mac・Tailscale・2026-04-03）

- **CONFIRMED**: 本番は [deployment.md](../guides/deployment.md) に従い **`raspberrypi5` → Pi4×4** を **`--limit` 1 台ずつ**・**`--foreground`** で反映（Pi3 は今回の変更対象外）。Pi5 checkout **`c02f7b14`**・ブランチ `feat/photo-tool-vlm-label-provenance-admin`。
- **CONFIRMED**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 41 / WARN 0 / FAIL 0**（`未認証 GET …/photo-label-reviews` → **401** をスクリプトに追加済み）。
- **CONFIRMED**: 未認証 `GET https://<Pi5>/api/tools/loans/photo-label-reviews?limit=1` → **401**。
- **CONFIRMED**: `information_schema` で `Loan.photoToolVlmLabelProvenance` 列が **`PhotoToolVlmLabelProvenance`** 型で存在。
- **CONFIRMED**: 本番集計例（デプロイ直後）: `UNKNOWN=390`、`FIRST_PASS_VLM=2`（`ASSIST_ACTIVE_VLM` / `ASSIST_ACTIVE_CONVERGED` は環境・運用次第）。マイグレーション直後は `UNKNOWN` が大半になるのが通常。

### Troubleshooting

| 症状 | 想定原因 | 対処 |
|------|----------|------|
| 一覧の出自がすべて `UNKNOWN` | マイグレーション直後でまだ VLM 保存ジョブが走っていない、または既存行が既定のまま | 新規ラベル付与後に `FIRST_PASS_VLM` 等へ更新されることを確認。集計は `GROUP BY "photoToolVlmLabelProvenance"` |
| 管理 UI に項目が出ない | Web デプロイ未反映・ブランチ不一致 | Pi5＋キオスク対象の Pi4 まで [deployment.md](../guides/deployment.md) どおり配布。Pi5 だけでは API のみ更新され admin バンドルが古いことがある |
| API は新しいが DB に列がない | `prisma migrate deploy` 未適用・別 DB を見ている | Pi5 の `docker compose` 経由で `migrate status` / マイグレーションログを確認 |

### References（実装）

- `apps/api/prisma/migrations/20260403120000_add_loan_photo_tool_vlm_label_provenance/`
- `apps/api/prisma/migrations/20260407120000_add_photo_tool_vlm_provenance_assist_active_converged/`
- `packages/shared-types/src/tools/photo-tool-vlm-label-provenance.ts`
- `apps/api/src/services/tools/photo-tool-label/photo-tool-label-review.service.ts`
- `apps/web/src/pages/admin/PhotoLoanLabelReviewsPage.tsx`

## References

- `feat/photo-loan-vlm-tool-label`
- `feat/photo-loan-vlm-human-review-and-vision-input`（フェーズ1）
- `feat/photo-tool-vlm-label-provenance-admin`
- `apps/api/src/services/tools/photo-tool-label/`
- `apps/api/src/services/vision/llama-server-vision-completion.adapter.ts`
- [photo-loan.md](../modules/tools/photo-loan.md)
- [local-llm-tailscale-sidecar.md](../runbooks/local-llm-tailscale-sidecar.md)
- [KB-314](./KB-314-kiosk-loan-card-display-labels.md)
