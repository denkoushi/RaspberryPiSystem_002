---

## title: Runbook: DGX Spark system-prod LocalLLM 段階切替

tags: [運用, DGX Spark, LocalLLM, llama.cpp, Tailscale, on_demand]
audience: [運用者, 開発者]
 last-verified: 2026-04-26
related:

- ./local-llm-tailscale-sidecar.md
- ../plans/dgx-spark-local-llm-migration-execplan.md
- ../decisions/ADR-20260329-local-llm-pi5-api-operations.md
- ../decisions/ADR-20260402-inference-foundation-phase1.md
- ../decisions/ADR-20260403-on-demand-local-llm-runtime-control.md
category: runbooks
update-frequency: high

# Runbook: DGX Spark system-prod LocalLLM 段階切替

## 目的

- Ubuntu PC 上の現行 LocalLLM を、DGX Spark の `system-prod` へ安全に置き換える
- ただし写真持出 VLM を壊さないため、**途中経路として text 先行の段階切替も取れる**ようにしておく
- Pi5 API が期待する `/healthz`、`/v1/chat/completions`、`/start`、`/stop` の運用形を維持する

## 現時点の判断（2026-04-26）

- DGX Spark / GB10 では `llama.cpp + GGUF` が安定して起動する
- 実測済みモデルは `Qwen3.5-35B-A3B-UD-Q4_K_XL.gguf`
- Pi5 管理 Chat の既定は `enableThinking=false`、`maxTokens=512` なので、DGX 側も **thinking 無効前提**で合わせる
- `photo_label` の current payload は、**まず現行 `Qwen3.5-35B-A3B-UD-Q4_K_XL.gguf` に `mmproj` を足して同じ endpoint で受けられるか**を最優先で確認する
- すでに行った text 先行の段階切替は **移行保険**であり、最終形ではない
- DGX 実機には `node` が無いため、最初の localhost smoke は **Python 版** `control-server.py` / `gateway-server.py` を使う

### 2026-04-26 時点の到達点

- `mmproj-F16.gguf` を DGX `Qwen3.5-35B-A3B-UD-Q4_K_XL.gguf` と同じディレクトリへ配置した
- `system-prod-primary` を `mmproj` 付きで起動し、`scripts/dgx-local-llm-system/probe-photo-label-vlm.py` による current payload の direct probe は **200** で成功した
- 応答例: `穴あけドリル`
- さらに Pi5 API コンテナ内の one-off synthetic で、`photo_label -> dgx_primary` を仮設定した `ensureReady('photo_label') -> vision.complete() -> release('photo_label')` は成功した
- 連続 3 回の synthetic でも `runtime_ready` / `inference` / `runtime_stopped` はすべて成功した

要するに、**Spark 単一 endpoint で `photo_label` current payload を受ける技術経路は確認済み**であり、残る主タスクは **代表画像セット品質**、**ジョブ統合**、**最終切替** である。

### 2026-04-26 代表画像 5 件の初回比較

- Pi5 API コンテナ内で、**人レビュー `GOOD` 済みの最近 5 件**を read-only で再評価した
- DGX `system-prod-primary` も Ubuntu fallback も **5/5 件で 200 / 非空応答**だった
- 初回の比較結果は次のとおり
  - `マーカーペン -> マーカー`: 近似
  - `マスキングテープ -> 養生テープ`: 近似。Ubuntu は `黄色いテープ`
  - `取手付ヤスリ -> ノミ`: 明確な誤判定。Ubuntu も `彫刻刀`
  - `デジタルデプスノギス -> デジタルノギス`: 近似
  - `ホールテスト -> デジタルマイクロメータ`: 明確な誤判定。Ubuntu も `マイクロメータ`
- 現時点の判断として、**DGX は Ubuntu 現行より明確に悪化していない**が、**5 件中 2 件は明確ミス**のため、そのまま Spark 一本化を決める段階ではない
- 次は、件数を増やした品質比較と `PhotoToolLabelScheduler` 経由の claim / release / DB 保存確認を続ける

### 2026-04-26 `PhotoToolLabelScheduler` 統合確認

- live の pending は 0 件だったため、既存 `GOOD` 画像を参照する **一時 Loan** を 1 件だけ作成して検証した
- Pi5 API コンテナ内で `photo_label` の provider を一時的に DGX `system-prod-primary` へ向け、`PhotoToolLabelScheduler.runOnce()` を実行した
- 実測:
  - `runtime_ready`: 約 `7.2s`
  - 1 回目 inference: 約 `4.5s`
  - シャドー補助 inference: 約 `1.6s`
  - 保存結果: `photoToolDisplayName = マーカーペン`
  - provenance: `ASSIST_ACTIVE_CONVERGED`
  - `photoToolLabelClaimedAt` は `null` に戻り、`runtime_stopped` まで成功
- 1 回目応答は `マーカー` だったが、既存 GOOD 類似補助と active gate により `マーカーペン` へ収束して保存できた
- 検証後、その一時 Loan は削除済み

要するに、**Spark 単一 endpoint は scheduler 経由でも claim / inference / assist / DB 保存 / release まで成立した**。

### 2026-04-26 Spark 一本化反映

- Pi5 の `infrastructure/ansible/inventory.yml` を **DGX 単一 provider (`dgx_primary`)** 構成へ更新した
- Pi5 上で `manage-app-configs.yml` を実行し、`apps/api/.env` と `infrastructure/docker/.env` の `**LOCAL_LLM_*` / `INFERENCE_*` をともに DGX `system-prod-primary`** に揃えた
- API コンテナ内の router でも
  - `photo_label -> dgx_primary`
  - `document_summary -> dgx_primary`
  - 管理 Chat / status 用 `LOCAL_LLM_BASE_URL -> http://100.118.82.72:38081`
  を確認した
- Spark 一本化反映後に `./scripts/deploy/verify-phase12-real.sh` を再実行し、**PASS 43 / WARN 0 / FAIL 0** を確認した

したがって、**Pi5 の本番構成は `admin chat` / `document_summary` / `photo_label` ともに DGX Spark `system-prod-primary` へ一本化済み**である。

### 2026-04-26 代表画像 10 件の実運用相当評価

- 人レビュー `GOOD` 済みの最近データから **期待ラベル重複なし 10 件**を選び、**一時 Loan を作成して `PhotoToolLabelingService` を通す**形で read-only 評価した
- 結果は **exact match 2 / 10**
  - 一致: `マスキングテープ`, `デジタルノギス`
  - 近似: `マーカーペン -> マーカー`, `デジタルデプスノギス -> デジタルノギス`, `金属棒 -> 金属定規`
  - 明確ミス: `取手付ヤスリ -> ノミ`, `ホールテスト -> デジタルマイクロメータ`, `栓ゲージ -> レンチ`, `ねじゲージ -> 六角棒スパナ`, `てこ式ダイヤルゲージ -> マイクロメーター`
- provenance は **すべて `FIRST_PASS_VLM`** で、今回の 10 件では GOOD 類似補助による補正保存は入らなかった

この結果から、**構造面の一本化は完了したが、品質面では特にゲージ・測定器系に改善余地が大きい**と判断できる。

### 2026-04-26 runtime control token drift

- Spark 一本化後の追加評価で、`ensureReady('photo_label')` が `**/start -> 403 forbidden`** になる事象を検出した
- 切り分けの結果、Pi5 側の `LOCAL_LLM_SHARED_TOKEN` / `LOCAL_LLM_RUNTIME_CONTROL_TOKEN` が DGX `system-prod` 実 secret とずれていた
- DGX 側の `api-token` / `runtime-control-token` に合わせて Pi5 `vault.yml` を更新し、`manage-app-configs.yml` を再実行したところ、`/start` は **200** に復帰した
- 以後の代表画像 10 件評価では、各件で `runtime_ready` / inference / `runtime_stopped` まで成功した

要するに、**DGX 一本化後の on-demand 制御では secret drift 監視が重要**である。

### 2026-04-26 active assist OFF の影響

- Pi5 API 本番 env を確認したところ、
  - `PHOTO_TOOL_EMBEDDING_ENABLED=true`
  - `PHOTO_TOOL_LABEL_ASSIST_SHADOW_ENABLED=false`
  - `PHOTO_TOOL_LABEL_ASSIST_ACTIVE_ENABLED=false`
  だった
- つまり、類似ギャラリーは使えるが、**収束 canonical を `photoToolDisplayName` に保存しうる active assist は無効**である
- 同じ代表画像 10 件を read-only で再評価すると、**5/10 件**は active を有効にすれば gate 通過で保存候補になり、うち **4/10 件**は期待ラベルと一致した
  - `マーカーペン`（rowCount `10`）
  - `取手付ヤスリ`（rowCount `5`）
  - `ホールテスト`（rowCount `23`）
  - `栓ゲージ`（rowCount `27`）
- 一方で `ねじゲージ` は active を有効にしても `棒ヤスリ` へ収束しており、別途改善が必要
- `マスキングテープ` は収束 canonical は正しいが rowCount `4` のため、現行 gate (`minGalleryRows=5`) ではまだ保存採用されない

したがって、**品質課題の一部はモデル限界ではなく、active assist が OFF であることによる取りこぼし**である。

### 2026-04-26 active assist 本番有効化

- Pi5 `vault.yml` に `vault_photo_tool_label_assist_active_enabled: "true"` と `vault_photo_tool_label_assist_active_min_gallery_rows: "5"` を追加し、`manage-app-configs.yml` を再実行して反映した
- 同じ代表画像 10 件を read-only で再評価した結果、
  - **exact match 5 / 10**（有効化前は **2 / 10**）
  - provenance は `**ASSIST_ACTIVE_CONVERGED` 5 件 / `FIRST_PASS_VLM` 5 件**
  まで改善した
- 代表的な改善:
  - `マーカーペン`
  - `取手付ヤスリ`
  - `ホールテスト`
  - `栓ゲージ`
  - `デジタルノギス`
- なお未改善の主例は `ねじゲージ`、`金属棒`、`てこ式ダイヤルゲージ` で、これは active assist だけでは救えていない
- 反映後に `./scripts/deploy/verify-phase12-real.sh` を再実行し、**PASS 43 / WARN 0 / FAIL 0** を確認した

要するに、**active assist は本番有効化しても回帰なく、品質改善の寄与が確認できた**。

### 2026-04-26 hard case の切り分け

- active assist ON 後も残った主例 `ねじゲージ` / `金属棒` / `てこ式ダイヤルゲージ` について、Pi5 本番 API コンテナ内で `PhotoToolLabelAssistService.evaluateForShadow()` と gallery 近傍を直接確認した
- 現在の主要条件は次のとおり
  - `PHOTO_TOOL_LABEL_ASSIST_MAX_COSINE_DISTANCE=0.14`
  - `PHOTO_TOOL_LABEL_ASSIST_CONVERGENCE_TOP_K=2`
  - `PHOTO_TOOL_LABEL_ASSIST_ACTIVE_MIN_GALLERY_ROWS=5`
- 切り分け結果:
  - `ねじゲージ`: expected row count **1**。assist 自体は発火するが、収束 canonical が `**棒ヤスリ`**。gallery 側の教師不足と embedding 近傍の偏りが主因
  - `金属棒`: expected row count **2**。assist 自体は発火するが、収束 canonical が `**Tレンチ`**。正解ラベルは近傍に出るが top を取れない
  - `てこ式ダイヤルゲージ`: expected row count **23**。正解近傍は十分あるが、top 近傍に `棒ヤスリ` が混ざり `**labels_not_converged`** で落ちる
- つまり、残課題は一括ではなく
  - **gallery 行数を増やす系** (`ねじゲージ` / `金属棒`)
  - **収束条件または prompt/embedding を見直す系** (`てこ式ダイヤルゲージ`)
  に分かれている

### 2026-04-26 ここで一区切りとする判断

- 現時点では、`photo_label` の**生の初期判定精度をこれ以上追い込むこと**は優先しない
- 本件の主戦略は、VLM 単体の正答率向上ではなく、**active assist + 人レビュー済み gallery の蓄積**によって実運用精度を上げることに置く
- すでに次は成立済み:
  - DGX `system-prod-primary` の**単一 endpoint** で text + image を処理できる
  - Pi5 本番は **DGX 一本化**できている
  - `active assist` 本番有効化で **exact match 2/10 -> 5/10** の改善を確認済み
  - `./scripts/deploy/verify-phase12-real.sh` は **PASS 43 / WARN 0 / FAIL 0**
- したがって、本件は**構造・運用の成立確認まで完了した段階でいったん区切り**、残る hard case は**将来課題**として扱う
- 将来の改善軸は次の 2 本に限定して保持する
  - 人レビュー `GOOD` gallery の継続蓄積
  - 必要になった時点での `Qwen3.6` 系または assist 条件の見直し

### 2026-04-26 `/embed` も DGX へ移管

- Ubuntu 退役前の最後の live 依存は `PHOTO_TOOL_EMBEDDING_URL=http://100.107.223.92:38081/embed` だった
- DGX `system-prod` に `/embed` 経路を追加し、
  - 外部入口: `http://100.118.82.72:38081/embed`
  - 内部 backend: `127.0.0.1:38100`
  の構成で **Pi5 API の既存契約** (`POST { jpegBase64, modelId } -> { embedding, modelId }`) を受けられるようにした
- embedding backend は `lmsysorg/sglang:latest` container 内で `openai/clip-vit-base-patch32` を使う。現時点では **GB10 + 当該 image の CUDA capability 警告を避けるため `EMBEDDING_DEVICE=cpu`** を既定とする
- Pi5 `vault.yml` / `infrastructure/docker/.env` / `apps/api/.env` の `PHOTO_TOOL_EMBEDDING_URL` は **DGX `100.118.82.72`** へ更新済みで、Pi5 API コンテナ内の direct probe でも `**status=200` / `dim=512**` を確認した
- DGX `/embed` 移管後は、既存 `photo_tool_similarity_gallery` が **Ubuntu 側 embedding 空間**のまま残るため、`**pnpm backfill:photo-tool-gallery:prod` の再実行を前提**とする
- 移管後も `./scripts/deploy/verify-phase12-real.sh` は **PASS 43 / WARN 0 / FAIL 0** だった

したがって、**Ubuntu PC を残す理由は `/embed` 依存としては解消**した。残る確認点は、DGX embedding で再投入した gallery を使う運用観測のみである。

### 2026-04-26 Ubuntu PC 停止後の最終確認

- Ubuntu PC を**通常手順で停止**したあと、Pi5 / DGX 側で再確認した
- 停止後の確認結果:
  - `./scripts/deploy/verify-phase12-real.sh` は **PASS 43 / WARN 0 / FAIL 0**
  - Pi5 の `LOCAL_LLM_BASE_URL` は `**http://100.118.82.72:38081`**
  - Pi5 の `PHOTO_TOOL_EMBEDDING_URL` は `**http://100.118.82.72:38081/embed`**
  - Pi5 から DGX への direct smoke で
    - `POST /start` -> **200**
    - `POST /v1/chat/completions` -> **200**
    - `POST /embed` -> **200 / dim=512**
    - `POST /stop` -> **200**
  - 旧 Ubuntu endpoint `http://100.107.223.92:38081/healthz` は **timeout** し、停止状態を確認できた
- また、DGX `/embed` へ切り替えた後の gallery 再投入 `pnpm backfill:photo-tool-gallery:prod` は `**loansSeen: 331, succeeded: 331, failed: 0`** で完了した

したがって、**Ubuntu PC を停止した状態でも、本システム用 LocalLLM は DGX Spark 単独で正常動作している**。この時点で、Ubuntu PC の退役判断は成立したと扱ってよい。

### 2026-04-26 DGX 再起動で見えた起動常駐の穴と修正

- その後 DGX Spark 自体を再起動したところ、`llama-server` の on-demand 起動自体は問題なかったが、`**control-server.py` と `gateway-server.py` が自動復帰していない**ことを確認した
- 症状:
  - `./scripts/deploy/verify-phase12-real.sh` は通る一方、Pi5 からの LocalLLM 直 smoke では `**Connection refused`** が出た
  - DGX 側では `127.0.0.1:38100` の embedding backend は listen していたが、`39090` と `38081` は不在だった
- 原因:
  - これまでの DGX 構成は **手動起動前提**で、`control-server.py` / `gateway-server.py` の**再起動時自動復帰**を持っていなかった
  - DGX ユーザー `ubudgxkoushi` には `sudo` がなく、`loginctl enable-linger` も使っていないため、systemd 常駐化を前提にしない最小策が必要だった
- 対処:
  - `start-control-server.sh` と `start-gateway-server.sh` を追加し、token file を読んで PID 管理付きで常駐起動できるようにした
  - DGX ユーザー `crontab` に
    - `@reboot /srv/dgx/system-prod/bin/start-control-server.sh`
    - `@reboot /srv/dgx/system-prod/bin/start-gateway-server.sh`
    - `@reboot /srv/dgx/system-prod/bin/start-embedding-server.sh`
    を登録した
- 修正後確認:
  - DGX 側で `39090` / `38081` / `38100` の listen を確認
  - Pi5 -> DGX の `POST /start` -> `GET /v1/models` ready -> `POST /v1/chat/completions` -> `POST /embed` -> `POST /stop` は成功
  - `./scripts/deploy/verify-phase12-real.sh` も再度 **PASS 43 / WARN 0 / FAIL 0**

したがって、**現在の DGX 単独運用は復旧済み**であり、今後の再起動は `@reboot` 登録済みの起動ラッパーで吸収する方針とする。

### 2026-04-26 DGX 再起動 2 回目で `@reboot` 実効確認

- `@reboot` 登録後に、DGX Spark を**もう一度再起動**して確認した
- 再起動後の DGX 側状態:
  - `0.0.0.0:38081` (`gateway-server.py`) が listen
  - `127.0.0.1:39090` (`control-server.py`) が listen
  - `127.0.0.1:38100` (`embedding-server`) が listen
  - `crontab -l` には
    - `@reboot /srv/dgx/system-prod/bin/start-control-server.sh`
    - `@reboot /srv/dgx/system-prod/bin/start-gateway-server.sh`
    - `@reboot /srv/dgx/system-prod/bin/start-embedding-server.sh`
    が残っていた
- Pi5 -> DGX の再確認結果:
  - `POST /start` -> **200**
  - `GET /v1/models` は `**503 Loading model` を数回返した後に `200 ready`**
  - `POST /v1/chat/completions` -> **200**
  - `POST /embed` -> **200 / dim=512**
  - `POST /stop` -> **200**
- その後の `./scripts/deploy/verify-phase12-real.sh` も再度 **PASS 43 / WARN 0 / FAIL 0** だった

したがって、`**@reboot` による自動復帰は実機で確認済み**であり、DGX Spark 単独運用は**再起動耐性まで含めて成立**したと扱ってよい。

### 2026-04-26 DGX 上の不要物を整理

- DGX Spark の本番稼働確認後、**その時点で未使用と確認できた試験残骸だけ**を削除した
- 削除したもの:
  - 未使用 Docker image
    - `nvcr.io/nvidia/vllm:26.02-py3`
    - `nvcr.io/nvidia/cuda:13.0.1-devel-ubuntu24.04`
  - 試験用 GGUF
    - `/srv/dgx/shared-models/llm/gguf/qwen2.5-0.5b-instruct-q4_k_m-00001-of-00001.gguf`
  - 実験 build
    - `/srv/dgx/lab-experiments/data/llama-cpp/llama.cpp/build`
  - 旧 Hugging Face cache
    - `/srv/dgx/shared-models/cache/huggingface/models--Qwen--Qwen2.5-1.5B-Instruct`
    - `/srv/dgx/shared-models/cache/huggingface/models--Qwen--Qwen2.5-Math-1.5B-Instruct`
- 削除後確認:
  - DGX 空き容量は `738GB -> 764GB`
  - `http://127.0.0.1:38081/healthz` は `ok`
  - `http://127.0.0.1:38100/healthz` は `ok`
  - `39090` は認証なし probe で `401` を返し、control server の生存を確認できた
- 現時点で **削除しないもの**:
  - `/srv/dgx/shared-models/llm/gguf/Qwen3.5-35B-A3B-UD-Q4_K_XL.gguf`
  - `/srv/dgx/shared-models/llm/gguf/mmproj-F16.gguf`
  - `/srv/dgx/system-prod/data/hf-cache/` 配下の `openai/clip-vit-base-patch32`
  - 実行中 container `system-prod-embedding` が使う `lmsysorg/sglang:latest`
  - 現行 `llama-server` 実行バイナリを含む `/srv/dgx/lab-experiments/data/llama-cpp/llama.cpp/build-sm121`

したがって、**今回の不要物整理は本番サービスを維持したまま実施済み**であり、以後は「現行 runtime / embedding backend が参照していないこと」を確認できたものだけを削除対象にする。

## 推奨ポートと役割

Ubuntu 現行構成との互換を優先し、DGX 側でも次を基本にする。

- 外部入口: `38081` (`nginx` / 認証 / `/healthz` / `/v1/`* / `/start` / `/stop`)
- 内部推論: `127.0.0.1:38082` (`llama-server`)
- 内部制御: `39090` (`control-server.mjs`)
- 内部埋め込み: `127.0.0.1:38100` (`embedding-server`)

この割当なら、Pi5 側の `LOCAL_LLM`_* は **接続先 IP だけ差し替える**構成にしやすい。

## 推奨 alias とモデル

- DGX の `llama-server --alias` は `**system-prod-primary`**
- Pi5 の `LOCAL_LLM_MODEL` も `**system-prod-primary`**

実モデル名を alias に埋め込まないことで、将来 `Qwen3.6` や別モデルへ差し替えても、Pi5 側の設定変更を最小化できる。

## 優先する完成形

- `system-prod-primary` を **単一 VLM endpoint** として運用する
- `admin chat` / `document_summary` / `photo_label` を **同じ Spark provider / 同じ alias** に寄せる
- Pi5 側は alias を固定し、モデル差し替えは DGX 側だけで完結させる
- その後、必要になった時点で `Qwen3.6` 系へ **1 対 1 で置き換える**

## 段階切替の基本方針（暫定 fallback）

### Phase A: text 系のみ DGX へ切替

- `LOCAL_LLM`_* は DGX を向ける
- `INFERENCE_DOCUMENT_SUMMARY`_* は DGX を向ける
- `INFERENCE_PHOTO_LABEL`_* は Ubuntu を向ける

これにより:

- 管理コンソール Chat は DGX
- 要領書 text 要約は DGX
- 写真持出 VLM ラベルは Ubuntu

という **ハイブリッド運用**が可能になる。

### Phase B: 現行 `Qwen3.5-35B` を VLM 化して photo_label も DGX へ

以下が確認できたら `photo_label` も DGX へ寄せる。

- 画像付き `/v1/chat/completions` が通る
- `photo_label` の代表ケースで空応答や 4xx/5xx がない
- on-demand 起動直後でも readiness が安定する
- 可能なら **同じ `system-prod-primary` alias** のまま text / image を両方処理できる

## DGX 側の推奨ディレクトリ

```text
/srv/dgx/system-prod/
  compose/
  data/
  logs/
  outputs/
  secrets/

/srv/dgx/shared-models/llm/gguf/
  Qwen3.5-35B-A3B-UD-Q4_K_XL.gguf
```

## `llama-server` 推奨起動パラメータ（現行 `Qwen3.5-35B` を単一 VLM endpoint に寄せる前提）

```bash
/srv/dgx/lab-experiments/data/llama-cpp/llama.cpp/build-sm121/bin/llama-server \
  --model /srv/dgx/shared-models/llm/gguf/Qwen3.5-35B-A3B-UD-Q4_K_XL.gguf \
  --mmproj /srv/dgx/shared-models/llm/gguf/mmproj-F16.gguf \
  --alias system-prod-primary \
  --host 127.0.0.1 \
  --port 38082 \
  --ctx-size 2048 \
  -ngl 99 \
  -fa on \
  --no-mmap \
  --parallel 1
```

メモ:

- `CMAKE_CUDA_ARCHITECTURES=121` build を使う
- `--no-mmap` は GB10 での実測ベースで維持する
- thinking は Pi5 から `chat_template_kwargs.enable_thinking=false` を送る
- `scripts/dgx-local-llm-system/start-llama-server.sh` は `LLAMA_SERVER_MMPROJ` 未指定時でも、model と同じディレクトリの `mmproj-F16.gguf` などを自動検出する

## Pi5 側の推奨 env（Phase A: 段階切替）

この runbook の **現在フェーズ** は「text 系を Spark へ寄せ、`photo_label` だけを Ubuntu fallback に残す」段階切替である。ただし、これは恒久構成ではない。**次の優先タスクは、現行 `Qwen3.5-35B` を `mmproj` 付きで単一 VLM endpoint 化すること**であり、Ubuntu はその実証が終わるまでの暫定 fallback として扱う。

### LocalLLM gateway（管理 Chat / status / on-demand）

```env
LOCAL_LLM_BASE_URL=http://<dgx-tailnet-ip>:38081
LOCAL_LLM_SHARED_TOKEN=<dgx-system-prod-token>
LOCAL_LLM_MODEL=system-prod-primary
LOCAL_LLM_TIMEOUT_MS=60000

LOCAL_LLM_RUNTIME_MODE=on_demand
LOCAL_LLM_RUNTIME_CONTROL_START_URL=http://<dgx-tailnet-ip>:38081/start
LOCAL_LLM_RUNTIME_CONTROL_STOP_URL=http://<dgx-tailnet-ip>:38081/stop
LOCAL_LLM_RUNTIME_CONTROL_TOKEN=<dgx-runtime-control-token>
LOCAL_LLM_RUNTIME_HEALTH_BASE_URL=http://<dgx-tailnet-ip>:38081
```

### 用途別推論ルーティング

```env
INFERENCE_PROVIDERS_JSON=[
  {
    "id":"dgx_primary",
    "baseUrl":"http://<dgx-tailnet-ip>:38081",
    "sharedToken":"<dgx-system-prod-token>",
    "defaultModel":"system-prod-primary",
    "timeoutMs":60000,
    "runtimeControl":{
      "mode":"on_demand",
      "startUrl":"http://<dgx-tailnet-ip>:38081/start",
      "stopUrl":"http://<dgx-tailnet-ip>:38081/stop",
      "controlToken":"<dgx-runtime-control-token>",
      "healthBaseUrl":"http://<dgx-tailnet-ip>:38081"
    }
  }
]

INFERENCE_DOCUMENT_SUMMARY_PROVIDER_ID=dgx_primary
INFERENCE_DOCUMENT_SUMMARY_MODEL=system-prod-primary

INFERENCE_PHOTO_LABEL_PROVIDER_ID=dgx_primary
INFERENCE_PHOTO_LABEL_MODEL=system-prod-primary
```

### 目標形（Phase B: Spark 集中）

`photo_label` の代表ケースが Spark 側の vision payload / runtime で安定したら、provider 構成は次の方向へ畳む。

- `admin chat` / `document_summary` / `photo_label` を **すべて Spark provider** に寄せる
- `INFERENCE_PROVIDERS_JSON` の Ubuntu provider を削除する
- Ubuntu 用 shared token / runtime control token / rollback 手順を縮退または廃止する
- Ubuntu PC は fallback が不要になった時点で退役候補にする

要するに、**Ubuntu を残す理由は性能ではなく移行保険**である。Spark 側で `photo_label` が通れば、運用上は一本化する方が自然である。

### Ansible inventory / vault で使う変数名

`infrastructure/ansible/inventory.yml` では次のキーを使う。

```yaml
api_local_llm_base_url: "http://<dgx-tailnet-ip>:38081"
api_local_llm_shared_token: "{{ vault_api_local_llm_shared_token | default('') }}"
api_local_llm_model: "system-prod-primary"
api_local_llm_timeout_ms: "60000"
api_local_llm_runtime_mode: "on_demand"
api_local_llm_runtime_control_start_url: "http://<dgx-tailnet-ip>:38081/start"
api_local_llm_runtime_control_stop_url: "http://<dgx-tailnet-ip>:38081/stop"
api_local_llm_runtime_control_token: "{{ vault_api_local_llm_runtime_control_token | default('') }}"
api_local_llm_runtime_health_base_url: ""

inference_providers_json: >-
  [{"id":"dgx_primary","baseUrl":"http://<dgx-tailnet-ip>:38081","sharedToken":"<dgx-token>","defaultModel":"system-prod-primary","timeoutMs":60000,
    "runtimeControl":{"mode":"on_demand","startUrl":"http://<dgx-tailnet-ip>:38081/start","stopUrl":"http://<dgx-tailnet-ip>:38081/stop","controlToken":"<dgx-runtime-token>","healthBaseUrl":"http://<dgx-tailnet-ip>:38081"}}]
inference_document_summary_provider_id: "dgx_primary"
inference_document_summary_model: "system-prod-primary"
inference_photo_label_provider_id: "dgx_primary"
inference_photo_label_model: "system-prod-primary"
```

secret は少なくとも次を vault で持つ。

- `vault_api_local_llm_shared_token`
- `vault_api_local_llm_runtime_control_token`

`inference_providers_json` 内の token は、そのまま inventory に平文で書かず、vault 変数から組み立てる。

2026-04-25 時点の実値に寄せるなら、`<dgx-tailnet-ip>` は `100.118.82.72`。

## 2026-04-25 の実反映メモ

標準の `update-all-clients.sh` は **未commit/未push 変更があると fail-fast** するため、この時点の Pi5 反映は **例外経路**で実施した。

1. Pi5 の `infrastructure/docker/.env` を `.env.before-dgx-local-llm-<timestamp>` へ退避
2. `LOCAL_LLM_`* と `INFERENCE_`* を DGX text / Ubuntu VLM の段階切替値へ更新
3. `docker compose -f infrastructure/docker/docker-compose.server.yml up -d --force-recreate api`

この例外経路は **rollback しやすい一方で Ansible 生成物とドリフトしうる**。恒久運用にする前に、repository 側の変更を commit / push し、Pi5 を Ansible 正規経路へ収束させる。

## 重要な注意

- `LOCAL_LLM_`* は **管理 Chat / status / on-demand 制御**の正本であり、`INFERENCE_PROVIDERS_JSON` だけでは置き換わらない
- `INFERENCE_PROVIDERS_JSON` は **photo_label / document_summary の用途別ルーティング**に加え、**provider ごとの runtimeControl** を持てる
- Pi5 API の runtime 制御は、`document_summary` / `photo_label` / `admin_console_chat` が解決した **provider 単位**で start/stop を叩く
- `photo_label` を DGX / Spark へ切り替える前に、**現行 `Qwen3.5-35B` + `mmproj` で vision payload が同じ入口で通るか**を必ず確認する
- Ubuntu fallback は **暫定運用**であり、Spark が `photo_label` まで担えると確認できたら、Ubuntu 前提の token / runtimeControl / rollback は縮退対象になる
- rollback は、Pi5 の `LOCAL_LLM_BASE_URL` と `LOCAL_LLM_RUNTIME_CONTROL`_* を Ubuntu 側へ戻せばよい形にしておく

## localhost smoke 実績（2026-04-25）

DGX 上で次を配置し、tailnet 参加前に localhost だけで経路確認済み。

- `127.0.0.1:39090`: `control-server.py`
- `127.0.0.1:38082`: `llama-server`
- `127.0.0.1:38081`: `gateway-server.py`

確認済み項目:

- `GET /healthz` → `ok`
- `POST /start` → `{"ok": true, "action": "start"}`
- `GET /v1/models` → `system-prod-primary`
- `POST /v1/chat/completions` → `疎通確認 OK`
- `POST /stop` → `{"ok": true, "action": "stop"}`

chat 実測の一例:

- `time_total=0.372736`
- `prompt_tokens=28`
- `completion_tokens=5`
- `enable_thinking=false`

## tailnet 実績（2026-04-25）

- node 名: `dgx-local-llm-system`
- tailnet IPv4: `100.118.82.72`
- tag: `tag:llm`

確認済み項目:

- Pi5 (`tag:server`) → `GET /healthz` は `ok`
- Pi5 (`tag:server`) → `POST /start` は `{"ok": true, "action": "start"}`
- Pi5 (`tag:server`) → `GET /v1/models` は `system-prod-primary`
- Pi5 (`tag:server`) → `POST /v1/chat/completions` は `Pi5 疎通 OK`
- Pi5 (`tag:server`) → `POST /stop` は `{"ok": true, "action": "stop"}`

補足:

- 運用 Mac (`tag:admin`) からの直 curl は timeout だったが、これは [tailscale-policy.md](../security/tailscale-policy.md) の allowlist（`tag:server -> tag:llm: tcp:38081` のみ許可）どおりで想定内
- 現在の tailnet 公開入口は Python の `gateway-server.py` を `0.0.0.0:38081` で待たせている
- `POST /start` の直後は `v1/models` が未準備のことがあるので、Pi5 側では既存の readiness 待ちを前提にする

## 最小確認

### DGX 側

```bash
curl -fsS http://127.0.0.1:38082/health
curl -fsS http://127.0.0.1:38082/v1/models
```

### DGX 側で `photo_label` current payload を直接確認

`Qwen3.5-35B-A3B-UD-Q4_K_XL.gguf` に `mmproj` を置いたら、まず Pi5 全体へ入れる前に **同じ `system-prod-primary` alias** へ current payload を直接送る。

```bash
export LLM_BASE_URL='http://127.0.0.1:38081'
export LLM_SHARED_TOKEN='<dgx-system-prod-token>'
export LLM_MODEL='system-prod-primary'
export LLM_RUNTIME_CONTROL_TOKEN='<dgx-runtime-control-token>'
python3 ./scripts/dgx-local-llm-system/probe-photo-label-vlm.py \
  /path/to/sample-tool.jpg \
  --start-runtime \
  --stop-runtime
```

期待:

- `/start -> 200`
- `/v1/models ready`
- `/v1/chat/completions -> 200`
- JSON の `choices[0].message.content` または `assistant_text` が **空でない**
- 工具名らしい短い日本語が返る

この確認でまだ `image input is not supported` や `mmproj` 不足が出るなら、Pi5 側 routing を触る前に **DGX 側の起動構成が未完** と判断する。

### Pi5 API コンテナから DGX `/healthz`

```bash
docker compose -f infrastructure/docker/docker-compose.server.yml exec -T api node -e "
const b = process.env.LOCAL_LLM_BASE_URL;
const t = process.env.LOCAL_LLM_SHARED_TOKEN;
fetch(new URL('/healthz', b), { headers: { 'X-LLM-Token': t } })
  .then(async r => { console.log('status', r.status, 'body', await r.text()); })
  .catch(e => { console.error(e); process.exit(1); });
"
```

### Pi5 API コンテナから status / chat / route を確認

```bash
docker compose -f infrastructure/docker/docker-compose.server.yml exec -T api node --input-type=module - <<'NODE'
import jwt from 'jsonwebtoken';
import { getInferenceRuntime } from '/app/apps/api/dist/services/inference/inference-runtime.js';

const token = jwt.sign(
  { sub: 'manual-check', username: 'manual-check', role: 'ADMIN' },
  process.env.JWT_ACCESS_SECRET,
  { expiresIn: '15m' }
);

const headers = {
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
};

const statusResp = await fetch('http://127.0.0.1:8080/api/system/local-llm/status', {
  headers: { Authorization: headers.Authorization },
});
console.log('status', statusResp.status, await statusResp.text());

const chatResp = await fetch('http://127.0.0.1:8080/api/system/local-llm/chat/completions', {
  method: 'POST',
  headers,
  body: JSON.stringify({
    messages: [{ role: 'user', content: '日本語で短く、疎通確認成功とだけ返答してください。' }],
    maxTokens: 48,
    temperature: 0.2,
    enableThinking: false,
  }),
});
console.log('chat', chatResp.status, await chatResp.text());

const rt = getInferenceRuntime();
console.log(
  JSON.stringify({
    photo_label: rt.router.resolve('photo_label'),
    document_summary: rt.router.resolve('document_summary'),
  })
);
NODE
```

2026-04-25 の実測結果:

- upstream health: DGX / Ubuntu ともに `ok`
- `GET /api/system/local-llm/status`: `configured=true`, `health.ok=true`, `baseUrl=http://100.118.82.72:38081`
- `POST /api/system/local-llm/chat/completions`: `system-prod-primary`, `content="疎通確認成功"`
- route 解決: `document_summary -> dgx_text`, `photo_label -> ubuntu_vlm`
- provider runtimeControl 導入後は、`document_summary` が **DGX の `/start` `/stop`**、`photo_label` が **Ubuntu の `/start` `/stop`** をそれぞれ使う
- 実反映では `.env` だけ先に入れると Pi5 API 実装が古いままで `photo_label=502` になった。`apps/api` の provider-aware runtime control 実装を Pi5 側 checkout に同期して `api` を rebuild 後、`document_summary` / `photo_label` の synthetic on-demand check は両方 `200` で成功した
- 再確認後の `./scripts/deploy/verify-phase12-real.sh` は **PASS 43 / WARN 0 / FAIL 0**

### Spark 一本化の確認

- `INFERENCE_PHOTO_LABEL_PROVIDER_ID` が意図どおり `dgx_primary` になっていること
- `INFERENCE_DOCUMENT_SUMMARY_PROVIDER_ID` も `dgx_primary` になっていること
- API ログで `component: inference` / `useCase: photo_label` の `providerId` を確認すること

## rollback

1. Pi5 の `LOCAL_LLM_BASE_URL`、`LOCAL_LLM_RUNTIME_CONTROL_`* を Ubuntu 側へ戻す
2. `INFERENCE_DOCUMENT_SUMMARY_PROVIDER_ID` も Ubuntu 側へ戻す
3. `INFERENCE_PHOTO_LABEL_PROVIDER_ID` は変更しないか、必要に応じて Ubuntu を維持する
4. Pi5 `api` コンテナを再作成し、`/api/system/local-llm/status` と代表 chat を確認する
5. 例外経路で反映していた場合は、Pi5 上の `.env.before-dgx-local-llm-<timestamp>` を `infrastructure/docker/.env` へ戻してから `api` を再作成する

## 次にやること

1. 本件はひとまずここで区切り、`photo_label` の初期判定精度を追加で追い込む作業は開始しない
2. 通常運用の中で、人レビュー `GOOD` gallery を継続蓄積する
3. DGX 一本化後の運用観測として、API ログの `component: inference` / `useCase: photo_label` と `component: localLlmRuntimeControl` を数回分 spot check する
4. Ubuntu fallback の rollback 手順と token 依存を縮退し、退役判断の条件を明文化する
5. `ねじゲージ` / `金属棒` / `てこ式ダイヤルゲージ` などの hard case は、困りごととして再浮上した時点で将来課題として再開する
6. 最後に必要になった時点で、同じ alias / 同じ入口のまま `Qwen3.6` 系へ置き換えるかを判断する

