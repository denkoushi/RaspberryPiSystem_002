---

## title: DGX Spark photo_label VLM 検証計画

tags: [DGX Spark, LocalLLM, photo_label, VLM, 検証計画]
audience: [開発者, 運用者]
last-verified: 2026-04-26
related:

- ./dgx-spark-local-llm-migration-execplan.md
- ../runbooks/dgx-system-prod-local-llm.md
- ../runbooks/local-llm-tailscale-sidecar.md
- ../knowledge-base/KB-319-photo-loan-vlm-tool-label.md
category: plans
update-frequency: high

# DGX Spark photo_label VLM 検証計画

## 目的

`photo_label` を Ubuntu fallback から DGX Spark へ移し、**本システム用 LocalLLM を Spark へ集中**できるかを判断する。

この計画で確認したいのは「モデルの格」ではなく、**現在の Pi5 API 実装と本番運用条件で `photo_label` が壊れず通るか**である。

## 現在地

- `admin chat` と `document_summary` は DGX Spark で成功済み
- `photo_label` は Ubuntu provider を暫定 fallback として残している
- Pi5 API の VLM 呼び出しは、`RoutedVisionCompletionAdapter` が **OpenAI 互換 `/v1/chat/completions`** へ次の payload を送る
  - `messages[0].content = [{ type: "image_url", image_url: { url: data:...base64 } }, { type: "text", text: ... }]`
  - 参照: `apps/api/src/services/inference/adapters/routed-vision-completion.adapter.ts`

### 2026-04-26 初回プローブ結果

- Pi5 経由で DGX `system-prod-primary` endpoint へ current payload 相当を直接送った
- runtime 未起動時は `502 Connection refused`
- `POST /start` 後は一時的に `503 Loading model`
- ready 後の画像付き `/v1/chat/completions` は `**500**`
- upstream 要点: `**image input is not supported**` / `**mmproj` が必要** という示唆

したがって、現時点の Spark `system-prod-primary` は **photo_label の current payload を処理できる VLM 構成ではない**。まず解くべき問題は prompt や routing ではなく、**vision 対応モデル + `mmproj` を備えた serving 構成を DGX 側に用意すること**である。

### 2026-04-26 `mmproj` 反映後の再プローブ結果

- DGX `system-prod` に `mmproj-F16.gguf` を配置し、`Qwen3.5-35B-A3B-UD-Q4_K_XL.gguf` を `mmproj` 付きで再起動した
- DGX localhost で `scripts/dgx-local-llm-system/probe-photo-label-vlm.py` を実行し、current payload と同形の `POST /v1/chat/completions` が **200** で成功した
- 応答例: `穴あけドリル`
- 続いて Pi5 API コンテナ内の one-off synthetic で、`photo_label -> dgx_primary` を仮設定して
  - `ensureReady('photo_label')`
  - `vision.complete()`
  - `release('photo_label')`
  - を確認した
- 連続 3 回の synthetic はすべて成功した
  - `runtime_ready`: 約 `6.3s` - `9.4s`
  - `inference`: 約 `3.3s` - `4.8s`
  - 応答例: `ドリル`, `穴あけドリル`

したがって、**current `photo_label` payload を Spark の単一 `system-prod-primary` endpoint で受ける技術的経路は成立した**。次の主眼は routing ではなく、**代表画像セットでの品質確認** と **ジョブ統合確認** である。

### 2026-04-26 代表画像 5 件の初回品質比較

- Pi5 API コンテナ内で、**人レビュー `GOOD` 済みの最近 5 件**を read-only で抽出し、同じ画像を
  - DGX `system-prod-primary` (`Qwen3.5-35B-A3B-UD-Q4_K_XL.gguf + mmproj`)
  - 現行 Ubuntu fallback (`Qwen_Qwen3.5-9B-Q4_K_M.gguf`)
  の両方へ投入した
- DGX 側は **5/5 件とも 200 / 非空応答** で、少なくとも経路・起動停止・画像前処理は安定していた
- 初回の目視比較では、DGX は Ubuntu に対して **明確に悪化しているとは言い切れない**
  - `マーカーペン -> マーカー`: 近似
  - `マスキングテープ -> 養生テープ`: 近似で、Ubuntu の `黄色いテープ` よりは用途語に寄っている
  - `取手付ヤスリ -> ノミ`: 明確な誤判定（Ubuntu も `彫刻刀` で誤判定）
  - `デジタルデプスノギス -> デジタルノギス`: 近似
  - `ホールテスト -> デジタルマイクロメータ`: 明確な誤判定（Ubuntu も `マイクロメータ` で誤判定）
- したがって、**DGX 単一 endpoint は Ubuntu 現行と同等帯の初期品質には入っている可能性がある**が、**5 件中 2 件は明確ミス**のため、この結果だけで Ubuntu fallback を外すにはまだ根拠が足りない
- 次は、件数を増やして **工具カテゴリの偏り（細長い工具、測定器、テープ類など）** を含めた比較と、`PhotoToolLabelScheduler` 経由の統合確認へ進む

### 2026-04-26 `PhotoToolLabelScheduler` の一時 Loan 統合確認

- live の pending queue は 0 件だったため、既存の人レビュー `GOOD` 画像を参照する **一時 Loan** を 1 件だけ作成して検証した
- Pi5 API コンテナ内で `INFERENCE_PHOTO_LABEL_*` を DGX `system-prod-primary` へ一時上書きし、`PhotoToolLabelScheduler.runOnce()` を実行した
- 結果:
  - `localLlmRuntimeControl.ensureReady('photo_label')` 成功
  - 1 回目 VLM 応答は `マーカー`
  - GOOD 類似補助 + active gate が作動し、収束 canonical `マーカーペン` が保存された
  - `photoToolDisplayName = マーカーペン`
  - `photoToolVlmLabelProvenance = ASSIST_ACTIVE_CONVERGED`
  - `photoToolLabelClaimedAt = null` に戻り、`release('photo_label')` まで成功した
- 検証後、その一時 Loan は削除済みで、既存データは残していない

したがって、**DGX 単一 endpoint は `PhotoToolLabelScheduler` 経由でも claim / inference / assist / DB 保存 / release まで成立する**。残る主タスクは、**より広い代表画像セット品質** と **Spark 一本化した実構成での最終確認** である。

### 2026-04-26 Spark 一本化後の本番確認

- Pi5 の `infrastructure/ansible/inventory.yml` を **DGX 単一 provider (`dgx_primary`)** へ更新した
- Pi5 上で `manage-app-configs.yml` を実行し、`LOCAL_LLM_*` / `INFERENCE_*` をともに DGX `system-prod-primary` へ揃えた
- API コンテナ内で
  - `photo_label -> dgx_primary`
  - `document_summary -> dgx_primary`
  - 管理 Chat / status 用 `LOCAL_LLM_BASE_URL -> http://100.118.82.72:38081`
  を確認した
- その状態で `./scripts/deploy/verify-phase12-real.sh` を再実行し、**PASS 43 / WARN 0 / FAIL 0** を確認した

したがって、**Spark 一本化した本番構成でも Phase12 回帰は発生していない**。この計画で残る焦点は、**品質の裾野確認** と **Ubuntu 退役判断** である。

### 2026-04-26 代表画像 10 件の実運用相当評価

- `vision.complete()` 単体ではなく、**一時 Loan を 1 件ずつ作成して `PhotoToolLabelingService` を通し、最終保存ラベル相当**を read-only で評価した
- 対象は、人レビュー `GOOD` 済みの最近データから **期待ラベル重複なしで 10 件**
  - `マーカーペン`
  - `マスキングテープ`
  - `取手付ヤスリ`
  - `デジタルデプスノギス`
  - `ホールテスト`
  - `栓ゲージ`
  - `デジタルノギス`
  - `ねじゲージ`
  - `金属棒`
  - `てこ式ダイヤルゲージ`
- 結果は **exact match 2 / 10**
  - 一致: `マスキングテープ`, `デジタルノギス`
  - 近似: `マーカーペン -> マーカー`, `デジタルデプスノギス -> デジタルノギス`, `金属棒 -> 金属定規`
  - 明確ミス: `取手付ヤスリ -> ノミ`, `ホールテスト -> デジタルマイクロメータ`, `栓ゲージ -> レンチ`, `ねじゲージ -> 六角棒スパナ`, `てこ式ダイヤルゲージ -> マイクロメーター`
- 今回の 10 件では provenance は **すべて `FIRST_PASS_VLM`** で、GOOD 類似補助による補正保存までは入らなかった

したがって、**Spark 一本化の構造は成立したが、`photo_label` 品質はまだ実運用で十分とは言い切れない**。次に詰めるべきは、**測定器・ゲージ類の誤認に対する改善策** と **assist が効く条件の見直し** である。

### 2026-04-26 active assist OFF による取りこぼし評価

- 本番 env を確認したところ、Pi5 API は
  - `PHOTO_TOOL_EMBEDDING_ENABLED=true`
  - `PHOTO_TOOL_LABEL_ASSIST_SHADOW_ENABLED=false`
  - `PHOTO_TOOL_LABEL_ASSIST_ACTIVE_ENABLED=false`
  だった
- つまり、**類似ギャラリーの照合は動いているが、収束 canonical を本番保存へ採用する active assist は無効**である
- 同じ 10 件に対して read-only で `labelAssist.evaluateForShadow()` と gate 判定を再計算したところ、
  - **5/10 件**は「active を有効にすれば gate 通過で保存候補にできる」
  - そのうち **4/10 件**は、収束 canonical が **期待ラベルそのもの**だった
- 具体例:
  - `マーカーペン`: rowCount `10` で gate 通過可能、収束 canonical は期待どおり `マーカーペン`
  - `取手付ヤスリ`: rowCount `5` で gate 通過可能、収束 canonical は期待どおり `取手付ヤスリ`
  - `ホールテスト`: rowCount `23` で gate 通過可能、収束 canonical は期待どおり `ホールテスト`
  - `栓ゲージ`: rowCount `27` で gate 通過可能、収束 canonical は期待どおり `栓ゲージ`
- 一方で `ねじゲージ` は、active を有効にしても収束 canonical 自体が `棒ヤスリ` なので改善しない
- `マスキングテープ` は収束 canonical 自体は正しいが rowCount `4` で、現行 gate (`minGalleryRows=5`) ではまだ通らない

したがって、**現時点の品質課題の一部はモデル限界ではなく、active assist が OFF であることによる運用上の取りこぼし**である。次の有力候補は、**Pi5 本番で `PHOTO_TOOL_LABEL_ASSIST_ACTIVE_ENABLED=true` を段階有効化して再評価すること**である。

### 2026-04-26 active assist 本番有効化後の再評価

- Pi5 `vault.yml` に
  - `vault_photo_tool_label_assist_active_enabled: "true"`
  - `vault_photo_tool_label_assist_active_min_gallery_rows: "5"`
  を追加し、`manage-app-configs.yml` を再実行して本番へ反映した
- 同じ代表画像 10 件を、再び **一時 Loan + `PhotoToolLabelingService`** で read-only 評価した
- 結果:
  - **exact match 5 / 10**（有効化前は **2 / 10**）
  - provenance は **`ASSIST_ACTIVE_CONVERGED` 5 件 / `FIRST_PASS_VLM` 5 件**
  - 改善した代表例:
    - `マーカーペン`
    - `取手付ヤスリ`
    - `ホールテスト`
    - `栓ゲージ`
    - `デジタルノギス`
  - なお未改善:
    - `マスキングテープ -> 養生テープ`
    - `デジタルデプスノギス -> デジタルノギス`
    - `ねじゲージ -> 六角棒スパナ`
    - `金属棒 -> ニッパー`
    - `てこ式ダイヤルゲージ -> マイクロメーター`
- active assist 本番有効化後に `./scripts/deploy/verify-phase12-real.sh` を再実行し、**PASS 43 / WARN 0 / FAIL 0** を確認した

したがって、**active assist の本番有効化は回帰なく適用でき、代表 10 件では exact match を 2/10 から 5/10 へ改善した**。残る主課題は、**assist でも救えない誤認カテゴリ** の対処である。

### 2026-04-26 active assist でも救えない 3 系統の切り分け

- 対象:
  - `ねじゲージ`
  - `金属棒`
  - `てこ式ダイヤルゲージ`
- Pi5 本番 API コンテナ内で、同一画像に対する `PhotoToolLabelAssistService.evaluateForShadow()` と `photo_tool_similarity_gallery` の近傍を直接確認した
- 現在の assist 条件:
  - `PHOTO_TOOL_LABEL_ASSIST_MAX_COSINE_DISTANCE=0.14`
  - `PHOTO_TOOL_LABEL_ASSIST_MIN_NEIGHBORS=2`
  - `PHOTO_TOOL_LABEL_ASSIST_CONVERGENCE_TOP_K=2`
  - `PHOTO_TOOL_LABEL_ASSIST_ACTIVE_MIN_GALLERY_ROWS=5`
- 結果:
  - `ねじゲージ`
    - expected row count は **1**
    - assist 判定は **`converged_neighbors`** だが、収束 canonical は **`棒ヤスリ`**
    - top 近傍も `棒ヤスリ` / `取手付ヤスリ` に偏っており、**教師データ不足 + embedding 近傍の偏り**が主因
  - `金属棒`
    - expected row count は **2**
    - assist 判定は **`converged_neighbors`** だが、収束 canonical は **`Tレンチ`**
    - 正解 `金属棒` 自体は近傍に出るものの 3 位で、**正解 gallery 行数不足**により top 収束を奪い返せていない
  - `てこ式ダイヤルゲージ`
    - expected row count は **23**
    - assist 判定は **`labels_not_converged`**
    - top 近傍は `棒ヤスリ` と `てこ式ダイヤルゲージ` が混在しており、**正解データは十分でも top-2 収束条件が厳しくて発火していない**
- したがって、残課題は 1 種類ではなく、少なくとも次の 2 系統に分かれる
  - **gallery 行数を増やすべき系**: `ねじゲージ`、`金属棒`
  - **収束条件または prompt/embedding の見直し余地がある系**: `てこ式ダイヤルゲージ`

### 2026-04-26 ここで一区切りとする判断

- 現時点では、`photo_label` の**生の初期判定精度をさらに詰めること**は本計画の主目的ではない
- この計画で確認したかったのは次の 2 点であり、どちらも満たせた
  - DGX `system-prod-primary` の**単一 VLM endpoint** で current `photo_label` payload を扱えること
  - VLM 単体ではなく、**active assist + 人レビュー済み gallery** を前提に実運用精度を改善できること
- 実績として、
  - DGX 単一 endpoint で text + image の経路が成立した
  - Pi5 本番の Spark 一本化が成立した
  - `active assist` 有効化で **exact match 2/10 -> 5/10** を確認した
  - `./scripts/deploy/verify-phase12-real.sh` は **PASS 43 / WARN 0 / FAIL 0**
- したがって、本計画は**構造と運用の成立確認までで一旦完了**とし、hard case の改善は**将来課題**へ移す
- 以後の基本方針は、**人レビュー `GOOD` gallery の蓄積で実用精度を上げる**こととし、モデルの置換や収束条件の見直しは必要時にのみ再開する

### 2026-04-26 runtime control token drift の発見と修正

- Spark 一本化後の追加評価で、`PhotoToolLabelingService` の `ensureReady('photo_label')` が **`/start -> 403 forbidden`** になる事象を検出した
- 切り分けの結果、Pi5 側 `LOCAL_LLM_SHARED_TOKEN` / `LOCAL_LLM_RUNTIME_CONTROL_TOKEN` が、DGX `system-prod/secrets/{api-token,runtime-control-token}` の実値と **不一致**だった
- Pi5 の `host_vars/raspberrypi5/vault.yml` を DGX 実値へ更新し、`manage-app-configs.yml` を再実行したところ、`/start` は **200** に復帰した
- その後の代表画像 10 件評価では、各件で `runtime_ready` / inference / `runtime_stopped` まで成功した

したがって、**DGX 一本化後の on-demand 制御に必要なのは routing だけではなく、Pi5 側 secret と DGX 実 secret の同期維持**である。

### 2026-04-26 `/embed` 移管後の backfill と Ubuntu 停止確認

- Ubuntu 退役前の最後の live 依存だった `PHOTO_TOOL_EMBEDDING_URL` を、Pi5 で **`http://100.118.82.72:38081/embed`** へ切り替えた
- DGX 側は
  - 外部入口: `http://100.118.82.72:38081/embed`
  - 内部 backend: `127.0.0.1:38100`
  の構成で、Pi5 API の既存契約 `POST { jpegBase64, modelId } -> { embedding, modelId }` を受けるようにした
- Pi5 API コンテナ内の direct probe では **`status=200` / `dim=512`** を確認した
- embedding 空間の切替後、`pnpm backfill:photo-tool-gallery:prod` を再実行し、**`batches: 14, loansSeen: 331, succeeded: 331, failed: 0`** で完了した
- その後に Ubuntu PC を実際に停止し、停止後も
  - `./scripts/deploy/verify-phase12-real.sh` -> **PASS 43 / WARN 0 / FAIL 0**
  - Pi5 -> DGX の `POST /start` / `/v1/chat/completions` / `/embed` / `/stop` は成功
  - 旧 Ubuntu endpoint `http://100.107.223.92:38081/healthz` は **timeout**
  を確認した

したがって、**本計画で必要だった「Ubuntu PC を停止しても DGX 単独で current system が維持できること」の確認まで完了**した。本計画における Ubuntu fallback は、役割を終えたと判断してよい。

## 検証対象

### 1. 互換性

- Spark 上の候補 runtime / model が、現在の `photo_label` payload をそのまま受けられるか
- `mimeType=image/jpeg`、base64 data URL、`enable_thinking=false` を含む現在の契約を壊さないか
- 少なくとも `**image_url` 入力を受け、`mmproj` 不足で 500 にならない構成**であること

### 2. 安定性

- on-demand 起動直後でも `photo_label` が 4xx/5xx にならないか
- 同一画像で空応答・極端な長文・説明文混入が増えないか
- cron 実行 (`PhotoToolLabelScheduler`) と単発実行の両方で破綻しないか

### 3. 品質

- 代表画像セットで Ubuntu 現行より明確に悪化しないか
- 工具名が短い日本語 1 件へ正規化できるか
- GOOD 類似補助・アクティブ保存ゲートと組み合わせても想定どおり動くか

## 候補パス

### パスA: 最優先

- Spark 上の **現行 `Qwen3.5-35B-A3B-UD-Q4_K_XL.gguf`** を、`mmproj` 付きの **単一 VLM endpoint** として成立させる
- 条件:
  - 既存の `system-prod-primary` alias を維持できること
  - text と `photo_label` を同じ入口で扱えること
  - 現在の OpenAI 互換 vision payload を受けられること

### パスB: 本命モデルへの置換

- 構造が安定したあとで、Spark 上の同じ endpoint を **Qwen3.6 系 VLM** へ置き換える
- 条件:
  - Pi5 側の alias / ルーティング / on-demand 制御を変えずに差し替えられること
  - GB10 で安定する runtime が得られること

### パスC: 中間到達点

- 先に **Spark 上で別の vision 対応 runtime / model** で `photo_label` を成立させる
- 条件:
  - Pi5 API の payload 契約と on-demand 制御に乗ること
  - Ubuntu fallback を外せるだけの安定性があること

### 現時点で有力な中間候補（現行 `Qwen3.5-35B` の VLM 化で詰まった場合のみ）

- `llama.cpp` の **multimodal 対応 build** を使い、`llama-server` を `**--mmproj` 付き**で起動する
- 候補モデルは、少なくとも upstream docs 上で multimodal GGUF が案内されているものを優先する
  - 例: `Qwen2.5-VL-`*
  - 例: `Qwen2.5-Omni-`*
  - 例: `Gemma 3/4` 系 VLM

補足:

- 現在の `scripts/dgx-local-llm-system/start-llama-server.sh` は **既定では `--model` 起動**で、VLM 化には `--mmproj` を明示または自動検出させる必要がある
- upstream の `llama.cpp` multimodal docs では、`llama-server -m <text-model.gguf> --mmproj <mmproj.gguf>`、または `-hf <supported multimodal GGUF>` が前提
- `Qwen3.5-35B-A3B` 系 GGUF には `mmproj-F16.gguf` などが存在するため、**最初に試すべきは現行 `system-prod-primary` を同じ alias のまま VLM 化する経路**である

## 検証手順

1. **単体 payload 検証**
  - Spark 上の候補 endpoint に対し、現在の `photo_label` と同形の `/v1/chat/completions` を直接送る
  - まず 1 枚で 200 / 非空応答 / 工具名らしい短文を確認する
  - `500 image input is not supported` や `mmproj` 示唆が出る候補は、この時点で不採用とする
  - ここで現行 `Qwen3.5-35B` の VLM 化が詰まる、または品質/安定性が足りない場合に限り、**中間候補の VLM で `photo_label` だけ成立させる**選択肢を許容する
2. **Pi5 API synthetic 検証**
  - `photo_label` use case が Spark provider を解決する構成で
  - `ensureReady('photo_label') -> vision.complete() -> release('photo_label')`
  - を複数回確認する
3. **代表画像セット検証**
  - 少数でもよいので、現場で実際に混ざる工具画像を使う
  - 期待:
    - 空応答がない
    - 工具名以外の説明文が大幅に増えない
    - 明らかな誤判定が Ubuntu 現行より悪化しない
4. **ジョブ統合検証**
  - `PhotoToolLabelScheduler` 経由で claim / release / DB 保存まで通す
  - assist pipeline 有効時も回帰がないか確認する
5. **退役判断**
  - Ubuntu provider を外した構成で
    - `photo_label`
    - `document_summary`
    - admin chat
    - `./scripts/deploy/verify-phase12-real.sh`
  - が通ることを確認する

## 完了条件

次を満たしたら、Ubuntu fallback を外す判断に進んでよい。

- Spark provider だけで `photo_label` の synthetic check が安定成功する
- 代表画像セットで品質が実運用許容内である
- on-demand start / ready / stop が連続実行でも破綻しない
- `document_summary` / admin chat / Phase12 に回帰がない

## 非目標

- ここでは Ubuntu 退役そのものは実施しない
- ここでは最終モデル名を固定しない
- ここでは photo_label 以外の新用途追加までは扱わない

## 次の具体タスク

1. 本計画はここで一区切りとし、`photo_label` の初期判定精度を追加で追い込む実験は始めない
2. 通常運用の中で、人レビュー `GOOD` gallery を継続蓄積する
3. DGX 一本化後の運用観測として、`component: inference` / `useCase: photo_label` と `component: localLlmRuntimeControl` のログを数回分確認する
4. Ubuntu fallback の rollback 条件を縮退し、退役判断条件を明文化する
5. `ねじゲージ` / `金属棒` / `てこ式ダイヤルゲージ` の hard case は、必要になった時点で将来課題として再開する
6. 最後に同じ alias / 同じ入口のまま `Qwen3.6` 系へ置換するかを判断する