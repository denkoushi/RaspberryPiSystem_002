---
title: "DGX system-prod LocalLLM 移行履歴（2026-04〜06）"
category: archive
status: historical
---

# DGX system-prod LocalLLM 移行履歴（2026-04〜06）

この文書は [DGX system-prod LocalLLM Runbook](../../runbooks/dgx-system-prod-local-llm.md) から移設した当時の判断ログ・実績・段階切替・Ubuntu への rollback の記録です。現行手順には使用しません。

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
  - 管理 Chat / status 用 `LOCAL_LLM_BASE_URL -> http://<dgx-tailscale-ip>:38081`
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

- Ubuntu 退役前の最後の live 依存は `PHOTO_TOOL_EMBEDDING_URL=http://<ubuntu-tailscale-ip>:38081/embed` だった
- DGX `system-prod` に `/embed` 経路を追加し、
  - 外部入口: `http://<dgx-tailscale-ip>:38081/embed`
  - 内部 backend: `127.0.0.1:38100`
  の構成で **Pi5 API の既存契約** (`POST { jpegBase64, modelId } -> { embedding, modelId }`) を受けられるようにした
- embedding backend は `lmsysorg/sglang:latest` container 内で `openai/clip-vit-base-patch32` を使う。現時点では **GB10 + 当該 image の CUDA capability 警告を避けるため `EMBEDDING_DEVICE=cpu`** を既定とする
- Pi5 `vault.yml` / `infrastructure/docker/.env` / `apps/api/.env` の `PHOTO_TOOL_EMBEDDING_URL` は **DGX `<dgx-tailscale-ip>`** へ更新済みで、Pi5 API コンテナ内の direct probe でも `**status=200` / `dim=512**` を確認した
- DGX `/embed` 移管後は、既存 `photo_tool_similarity_gallery` が **Ubuntu 側 embedding 空間**のまま残るため、`**pnpm backfill:photo-tool-gallery:prod` の再実行を前提**とする
- 移管後も `./scripts/deploy/verify-phase12-real.sh` は **PASS 43 / WARN 0 / FAIL 0** だった

したがって、**Ubuntu PC を残す理由は `/embed` 依存としては解消**した。残る確認点は、DGX embedding で再投入した gallery を使う運用観測のみである。

### 2026-04-26 Ubuntu PC 停止後の最終確認

- Ubuntu PC を**通常手順で停止**したあと、Pi5 / DGX 側で再確認した
- 停止後の確認結果:
  - `./scripts/deploy/verify-phase12-real.sh` は **PASS 43 / WARN 0 / FAIL 0**
  - Pi5 の `LOCAL_LLM_BASE_URL` は `**http://<dgx-tailscale-ip>:38081`**
  - Pi5 の `PHOTO_TOOL_EMBEDDING_URL` は `**http://<dgx-tailscale-ip>:38081/embed`**
  - Pi5 から DGX への direct smoke で
    - `POST /start` -> **200**
    - `POST /v1/chat/completions` -> **200**
    - `POST /embed` -> **200 / dim=512**
    - `POST /stop` -> **200**
  - 旧 Ubuntu endpoint `http://<ubuntu-tailscale-ip>:38081/healthz` は **timeout** し、停止状態を確認できた
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

### 本番既定 backend の判断ログ（2026-04-28）

- **方針（ADR）**: リポジトリ上の **本番既定**は **`ACTIVE_LLM_BACKEND=green`**（`llama.cpp` + `mmproj` の `system-prod-primary`）を正とする（[ADR-20260428](../../decisions/ADR-20260428-dgx-active-backend-prod-default.md)）。
- **実機の確認**: **DGX 実機が green か blue かは設定次第**。ドキュメントより **`POST /start` の JSON `backend`** と **`GET /v1/models` の `root`**（例: `sakamakismile/Qwen3.6-27B-NVFP4`）を **正**とする。
- **理由（方針で green を正とする要約）**: blue（`vLLM` + NVFP4）は疎通・VLM プローブまで到達済みだが、**cold start が ~12 分規模**になり得ること、**GPU/メモリ占有**、VLM/画像経路のトラブルシュートを、**SLA として一括で締める前に**材料として残したい。
- **blue を本番方針の既定にする場合**: 上記を運用で受容した判断を **ADR** と本 Runbook に追記してから切り替える。
- **Pi5 側の耐性**: `photo_label` 向けに、画像ロード/デコード・大きさ由来など **条件付き 400** に限り **JPEG の再エンコードで最大 1 回再試行**する実装を API に入れた（[`RoutedVisionCompletionAdapter`](../../../apps/api/src/services/inference/adapters/routed-vision-completion.adapter.ts) / `vision-vlm-fallback.util.ts`）。**400 の根本原因を消すものではない**ため、DGX `docker logs` との併用が前提。

### 当初運用方針との対応関係（要約）

- **ホストを汚さない / 用途ごとにコンテナ**: 推論・埋め込み等の実体は **コンテナ**に置き、重みは **`/srv/dgx/shared-models` 等へ bind mount** する前提（ホストへの手作業 CUDA 導入は前提にしない）。
- **データ混在防止**: `system-prod` は **ディレクトリ・`secrets`・Docker network** を用途別に分離する。ただし **GPU/CPU/統一メモリは物理共有**であり、別コンテナの負荷は性能面で相互に影響し得る（通信分離と同義ではない）。
- **単一 alias・差し替え容易**: 外部は **`38081` + `system-prod-primary` を固定**し、モデル差し替えは DGX 側（green/blue 切替・起動コマンド）で完結させる。

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

### 2026-04-27 Pi5 本番：repo 差分の「正規 + 手元同期」で収束した例

- **状況**: Pi5 の checkout が `main` より古いと、`/opt/.../infrastructure/ansible` だけ `manage-app-configs` しても **生成 `.env` が意図どおりに上がらない**（Zod 上限や `api_local_llm_runtime_ready_timeout_ms` の反映遅れ）ことがある。
- **手順（実施済み）**:
  1. 開発端末のリポジトリから、少なくとも **`apps/api/src/`** と **Ansible**（`inventory.yml`、`playbooks/manage-app-configs.yml`、`templates/api.env.j2`、`templates/docker.env.j2`）を Pi5 の同パスへ `rsync` 等で同期
  2. Pi5 上で `cd /opt/RaspberryPiSystem_002/infrastructure/ansible && ansible-playbook -i inventory.yml playbooks/manage-app-configs.yml --limit raspberrypi5`（**PLAY RECAP `failed=0`** を確認）
  3. `infrastructure/docker` で `docker compose -f docker-compose.server.yml build api` のあと `up -d --force-recreate api`（**実行中の API が新イメージ**になるよう再作成）
- **検証**: 開発端末で `./scripts/deploy/verify-phase12-real.sh` → 実測 **`PASS 42 / WARN 1 / FAIL 0`**（WARN は `auto-tuning scheduler` ログ 0 件。スクリプトは `PUT auto-generate=200` を代替合格とする）。
- **恒久化**: 上記の「手元同期」は**例外**。リモートを **`main` に追従**（`update-all-clients` 等）してから、同じ playbook だけで再現できる状態に戻すのが望ましい。

### 2026-04-27 DGX 本番: `runtime_stop_policy` 同梱の `control-server.py` 反映と到達経路

- **目的**: repo の `scripts/dgx-local-llm-system/`（`control-server.py` + **`runtime_stop_policy.py` 同梱必須**）を DGX の `/srv/dgx/system-prod/bin/` に揃え、`BLUE_LLM_RUNTIME_STOP_MODE` / 互換 `BLUE_LLM_RUNTIME_KEEP_WARM` による **blue `/stop` 方針**を本番で有効にする。
- **Tailscale / SSH**: 既定 ACL では **Pi5 → DGX の `38081` は通るが `22` は通らない**ことが多い（`38081` のみ許可のため）。ホストへ直接配置する場合は **一時 grant**（`tag:server` → `tag:llm`, `tcp:22`）→ 作業後 **grants から除去**。[tailscale-policy.md](../../security/tailscale-policy.md)・[KB-357](../../knowledge-base/infrastructure/security.md)。
- **到達経路の例**: `tag:admin`（Mac）から DGX tailnet IP への直 **HTTP は ACL で届かない**ことが多い → **Pi5 経由**の疎通確認、または **工場 LAN**（例: `192.168.128.156`）と **登録済み SSH 鍵**（LAN と tailnet で同じ公開鍵を `authorized_keys` に載せる必要あり）。
- **疎通時の注意（blue / vLLM）**: cold start 中は **`127.0.0.1:38083`** および gateway 経由の **`/v1/models`** が **502** や **connection reset** になり得る。`docker logs`（`system-prod-trtllm` 等）で **重み load・`torch.compile`・autotune** 完了まで待つ。最小チャット検証では **`chat_template_kwargs: { "enable_thinking": false }`** を付けないと **`message.content` が空**になりやすい。
- **gateway 既定注入（2026-05-24・私用 Pi5 Hermes）**: `ACTIVE_LLM_BACKEND=blue` のとき、`gateway-server.py` の **`inject_blue_chat_completions_defaults`** が **`POST /v1/chat/completions`** 本文に **`enable_thinking: false`** を付与（クライアントが省略した場合）。Hermes は `request_overrides` を毎ターン空で上書きするため **Pi5 config だけでは不足**し得る。**記録**: DGXSparkControlPlane `docs/private-history/knowledge-base/KB-private-pi5-hermes-discord-e2e-and-latency.md`。
- **`keep_warm`**: `BLUE_LLM_RUNTIME_STOP_MODE=keep_warm`（または互換 `BLUE_LLM_RUNTIME_KEEP_WARM=true`）かつ active backend が blue のとき、**`POST /stop` 後も** trtllm コンテナと **`/v1/models` が生存**する挙動を確認できる（本番ではリソース方針に合わせ ADR のとおり）。

### 2026-05-03 blue vLLM と ComfyUI の GPU 競合（502・inference-backend WARN）

- **起きうること**: 同一 DGX 上で **私用 ComfyUI**（例: `dgx-private-comfyui`）が GPU メモリを占有していると、blue（`system-prod-trtllm`）が **`ValueError: Free memory on device cuda:0 … is less than desired GPU memory utilization`** で**即死**し、**gateway 先が listen しない** → Pi5 経由の **502**（本文に **`Connection refused`**）、管理 UI の **`inference-backend` WARN** が**更新周期どおりにポーリングしても直らない**（裏側が変わっていないため）。
- **cold start との見分け**: ログに上記 **`ValueError`** が出るなら **GPU 不足が第一候補**。cold start のみなら **重みロード／compile／autotune** の進行ログが主で、**`nvidia-smi` に ComfyUI 等の大きな占有**が典型。
- **復旧の例（業務優先時）**: ComfyUI コンテナを停止して VRAM を空け、**`POST /start`** をやり直す → cold start 経過後 **`127.0.0.1:38083` / gateway `/v1/models` が 200** まで確認。**私用で ComfyUI を再開する場合は blue と再衝突しうる**（プロファイル `private_ok` vs `business_first` の意味と整合）。
- **切り分けのコツ**: Pi5 **API コンテナ内**に `curl` が無いことがある → **ホストの `python3`** で `.env` の **`LOCAL_LLM_SHARED_TOKEN`** を読み **`X-LLM-Token`** 付きで gateway を叩く、または **DGX SSH** で `docker logs` / `nvidia-smi` を見る。
- **記録**: [KB-364](../../knowledge-base/KB-364-dgx-blue-vllm-comfyui-gpu-contention.md)。

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

## 2026-04-25 の実反映メモ

標準の `update-all-clients.sh` は **未commit/未push 変更があると fail-fast** するため、この時点の Pi5 反映は **例外経路**で実施した。

1. Pi5 の `infrastructure/docker/.env` を `.env.before-dgx-local-llm-<timestamp>` へ退避
2. `LOCAL_LLM_`* と `INFERENCE_`* を DGX text / Ubuntu VLM の段階切替値へ更新
3. `docker compose -f infrastructure/docker/docker-compose.server.yml up -d --force-recreate api`

この例外経路は **rollback しやすい一方で Ansible 生成物とドリフトしうる**。恒久運用にする前に、repository 側の変更を commit / push し、Pi5 を Ansible 正規経路へ収束させる。

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
- tailnet IPv4: `<dgx-tailscale-ip>`
- tag: `tag:llm`

確認済み項目:

- Pi5 (`tag:server`) → `GET /healthz` は `ok`
- Pi5 (`tag:server`) → `POST /start` は `{"ok": true, "action": "start"}`
- Pi5 (`tag:server`) → `GET /v1/models` は `system-prod-primary`
- Pi5 (`tag:server`) → `POST /v1/chat/completions` は `Pi5 疎通 OK`
- Pi5 (`tag:server`) → `POST /stop` は `{"ok": true, "action": "stop"}`

補足:

- 運用 Mac (`tag:admin`) からの直 curl は timeout だったが、これは [tailscale-policy.md](../../security/tailscale-policy.md) の allowlist（`tag:server -> tag:llm: tcp:38081` のみ許可）どおりで想定内
- 現在の tailnet 公開入口は Python の `gateway-server.py` を `0.0.0.0:38081` で待たせている
- `POST /start` の直後は `v1/models` が未準備のことがあるので、Pi5 側では既存の readiness 待ちを前提にする

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
