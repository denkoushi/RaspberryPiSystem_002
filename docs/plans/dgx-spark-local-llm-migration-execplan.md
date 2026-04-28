---

## title: DGX Spark LocalLLM 移行・多用途分離運用 ExecPlan

tags: [DGX Spark, LocalLLM, NVIDIA, Docker, Tailscale, セキュリティ, 運用, 計画]
audience: [運用者, 開発者, AIアシスタント]
last-verified: 2026-04-29
related:

- ../runbooks/local-llm-tailscale-sidecar.md
- ../runbooks/dgx-private-comfyui.md
- ../decisions/ADR-20260328-ubuntu-local-llm-tailnet-sidecar.md
- ../decisions/ADR-20260329-local-llm-pi5-api-operations.md
- ../decisions/ADR-20260403-on-demand-local-llm-runtime-control.md
- ../decisions/ADR-20260427-blue-llm-runtime-stop-policy.md
- ../security/tailscale-policy.md
- ../../infrastructure/ansible/inventory.yml
category: plans
update-frequency: high

# DGX Spark LocalLLM 移行・多用途分離運用 ExecPlan

この ExecPlan は生きたドキュメントであり、作業の進行に合わせて `Progress`、`Surprises & Discoveries`、`Decision Log`、`Outcomes & Retrospective` を更新する。`.agent/PLANS.md` に従い、後続の担当者がこの文書だけを読んでも、Ubuntu PC 上の現行 LocalLLM を DGX Spark へ安全に移行し、さらに業務・私用・実験用途を混流させずに運用できる状態を目指す。

## Purpose / Big Picture

本プロジェクトでは、現在 Ubuntu PC 上の LocalLLM を Pi5 API から Tailscale 経由で利用している。DGX Spark 到着に伴い、この計算資源を DGX Spark へ置き換える。ただし DGX Spark は本システム専用機ではなく、プライベート用途や独立した実験用途にも使う想定である。そのため、単なる「接続先変更」ではなく、NVIDIA 公式の標準環境を優先しながら、用途ごとの気密性、性能、ストレージ効率、更新容易性を両立する運用基盤として設計する。

完了後、運用者は Pi5 API から DGX Spark 上の LocalLLM を安全に呼び出せる。さらに DGX Spark 上では、本システム用、私用、実験用の実行環境が明確に分かれ、プロンプト、ログ、RAG データ、API キー、アップロード資料が混ざらない。巨大モデルの重みファイルなど共有してよい資産は効率よく共有し、秘密情報や業務データは共有しない。

## Progress

- (2026-04-29 JST) **private用途 ComfyUI**: repo にコンテナ雛形を追加した（[`scripts/dgx-private-comfyui`](../../scripts/dgx-private-comfyui)、Runbook [`dgx-private-comfyui.md`](../runbooks/dgx-private-comfyui.md)）。公式 Playbook（CUDA 13 / PyTorch `cu130` / ComfyUI GitHub）に沿った **`Dockerfile.example`**。ホスト公開は **127.0.0.1 のみ**、Tailscale は **SSH ポートフォワード**前提。**未実施**: DGX 実機での `docker compose build/up`、Mac ブラウザによるワークフロー検証。
- (2026-04-25 14:37 JST) ドキュメント作業ブランチ `docs/dgx-spark-operations-plan` を作成した。
- (2026-04-25 14:45 JST) 現行 LocalLLM 構成を確認した。Pi5 API は `LOCAL_LLM_*` により Ubuntu LocalLLM を利用し、`LOCAL_LLM_RUNTIME_MODE=on_demand` と `/start` `/stop` 制御を使う。
- (2026-04-25 14:55 JST) NVIDIA 公式情報を確認した。DGX Spark は DGX OS、Docker、NVIDIA Container Runtime、NGC を前提にするのが正規ルートである。
- (2026-04-25 15:05 JST) 議論内容を本 ExecPlan に整理した。
- (2026-04-25 15:16 JST) DGX Spark 初期セットアップ、SSH 鍵登録、`docker` グループ反映、firmware 更新、公式 CUDA コンテナ GPU 確認まで完了した。ホスト名は `gx10-5ef3`、Local IP は `192.168.128.156`。
- (2026-04-25 15:16 JST) DGX Spark 上で `docker run --rm --gpus=all nvcr.io/nvidia/cuda:13.0.1-devel-ubuntu24.04 nvidia-smi` が成功し、コンテナ内から `NVIDIA GB10` を確認した。
- (2026-04-25 15:21 JST) DGX Spark 上に用途分離の土台を作成した。ディレクトリは `/srv/dgx/system-prod`、`/srv/dgx/private-personal`、`/srv/dgx/lab-experiments`、`/srv/dgx/shared-models`。Docker network は `dgx_system_prod_net`、`dgx_private_personal_net`、`dgx_lab_experiments_net`。
- (2026-04-25 15:36 JST) `lab` 領域の軽量 LLM 検証候補として、NVIDIA 公式 `vLLM` コンテナ `nvcr.io/nvidia/vllm:26.02-py3` を取得した。取得後の Docker image は `vLLM` 約 `14.7GB`、CUDA 検証用 image 約 `6.59GB`、空き容量は約 `802GB`。
- (2026-04-25 15:59 JST) `lab-experiments` network 上で `vLLM` と `Qwen/Qwen2.5-1.5B-Instruct` を起動し、DGX Spark ローカル `127.0.0.1:18000` の OpenAI 互換 API で `/v1/models` と `/v1/chat/completions` の疎通を確認した。応答例は `こんにちは！`。
- (2026-04-25 16:00 JST) 検証後、`dgx-lab-vllm-qwen15b` コンテナを停止した。Docker image と Hugging Face cache は残し、メモリは約 `3.2GiB` 使用、`110GiB` free、ストレージは約 `796GB` 空きに戻った。
- (2026-04-25 17:12 JST) 本システム用 LocalLLM の本命候補を `Qwen/Qwen3.6-35B-A3B` に決めた。Hugging Face model card では `vLLM>=0.19.0` または `SGLang>=0.5.10` が推奨される。一方、取得済み NVIDIA `nvcr.io/nvidia/vllm:26.02-py3` は `vLLM=0.15.1+nv26.2` のため、巨大モデル取得前に対応ランタイムを確認する。
- (2026-04-25 17:22 JST) NVIDIA Spark 公式 SGLang playbook の `lmsysorg/sglang:spark` 取得を試したが、Docker pull が長時間停滞したため中断した。中断後、SGLang image は残らず、実行中コンテナもない。DGX Spark の Docker image は CUDA 検証用と `vLLM:26.02-py3` の2つのみ。
- (2026-04-25 18:14 JST) Qwen3.6 対応ランタイムとして `lmsysorg/sglang:latest` を取得した。image size は約 `33.4GB`、中身は `sglang=0.5.10.post1`、`transformers=5.3.0`、`torch=2.9.1+cu129`。Qwen3.6 の要求条件 `SGLang>=0.5.10` を満たす。
- (2026-04-25 18:18 JST) `lmsysorg/sglang:latest` が DGX Spark の GPU を認識し、軽い CUDA 行列計算に成功することを確認した。ただし PyTorch は `NVIDIA GB10` の CUDA capability `12.1` に対し、対応範囲 `(8.0) - (12.0)` という警告を出すため、Qwen3.6 本体起動時に追加確認が必要である。
- (2026-04-25 18:23 JST) `lmsysorg/sglang:latest` で小型モデル `Qwen/Qwen2.5-1.5B-Instruct` の SGLang server 起動を試したが、Triton/PTX が `sm_121a` を認識できず停止した。`SGLang>=0.5.10` だけでは DGX Spark / GB10 適合を保証しないため、`spark` tag、自前 build、または llama.cpp/GGUF 保険を再評価する。
- (2026-04-25 18:24 JST) `--disable-cuda-graph` と `--disable-piecewise-cuda-graph` を追加して再試行したが、別の Triton kernel で同じ `ptxas fatal: Value 'sm_121a' is not defined for option 'gpu-name'` が出て停止した。`lmsysorg/sglang:latest` は現状のままでは DGX Spark / GB10 serving 用に採用しない。
- (2026-04-25 18:28 JST) 既知回避策として host 側 CUDA 13.0 の `ptxas` を container に read-only mount し、`TRITON_PTXAS_PATH` に指定した。これで `sm_121a` の `ptxas` エラーは進んだが、実推論 path で `CUDA error: no kernel image is available for execution on the device` が発生した。結論として `lmsysorg/sglang:latest` は不採用とし、GB10 対応済み SGLang image/build または llama.cpp/GGUF へ切り替える。
- (2026-04-25 18:44 JST) Qwen3.6 を諦めずに、保険兼ベースラインとして `llama.cpp + GGUF` を先に検証する方針に進んだ。`/srv/dgx/lab-experiments/data/llama-cpp/llama.cpp` に `llama.cpp` を取得し、CUDA 13.0 で `CMAKE_CUDA_ARCHITECTURES=121` の `build-sm121` を作成した。
- (2026-04-25 18:45 JST) `build-sm121` の `llama-server` と小型 `Qwen2.5-0.5B-Instruct-Q4_K_M-GGUF` で、DGX Spark ローカル `127.0.0.1:18200` の OpenAI 互換 API を確認した。`/v1/models`、`/health`、`/v1/chat/completions` が成功し、応答例は `こんにちは。`。検証後、`llama-server` を停止した。
- (2026-04-25 19:26 JST) `Qwen3.5-35B-A3B-UD-Q4_K_XL.gguf` の取得が完了した。配置先は `/srv/dgx/shared-models/llm/gguf/Qwen3.5-35B-A3B-UD-Q4_K_XL.gguf`、サイズは `22,241,950,336 bytes`（約 `20.7 GiB`）。sha256 は `1b0ac637dfa092bbba2793977db9485a40c4f8b42df5fe342f0076d61b66ae83`。
- (2026-04-25 19:56 JST) `build-sm121/bin/llama-server` で `Qwen3.5-35B-A3B-UD-Q4_K_XL.gguf` を `127.0.0.1:18200` に起動し、`/health` と `/v1/models`、`/v1/chat/completions` を確認した。chat は約 `0.60s` で返り、`prompt_tokens=17`、`completion_tokens=32`、推論速度は約 `62 tok/s` だった。検証後、`llama-server` を停止した。
- (2026-04-25 20:10 JST) `system-prod` 切替の方針を整理した。Pi5 管理 Chat と `document_summary` は DGX text provider を向け、`photo_label` は DGX vision が通るまで Ubuntu provider に残す段階切替を採用する。これに合わせ、Ansible `docker.env.j2` に `INFERENCE_PROVIDERS_JSON` と用途別 provider/model の出力口を追加し、DGX 用 runbook `docs/runbooks/dgx-system-prod-local-llm.md` を作成した。
- (2026-04-25 21:03 JST) DGX 上に `system-prod` 実体の localhost smoke を構築した。`/srv/dgx/system-prod/bin` に `control-server.py`、`gateway-server.py`、`start-llama-server.sh`、`stop-llama-server.sh` を配置し、token を `secrets/` に生成した。`127.0.0.1:39090` の control server、`127.0.0.1:38081` の local gateway、`127.0.0.1:38082` の `llama-server` を連携させ、`/healthz`、`/start`、`/v1/models`、`/v1/chat/completions`、`/stop` の一連を確認した。
- (2026-04-25 21:24 JST) DGX を Tailscale sidecar で tailnet に参加させた。node 名は `dgx-local-llm-system`、tailnet IPv4 は `100.118.82.72`、タグは `tag:llm`。Mac からの直 curl は ACL により timeout だったが、Pi5 (`tag:server`) からは `http://100.118.82.72:38081` の `/healthz`、`/start`、`/v1/models`、`/v1/chat/completions`、`/stop` が成功した。
- (2026-04-25 21:28 JST) Pi5 の Ansible `inventory.yml` を、text は DGX (`100.118.82.72:38081` / `system-prod-primary`)・`photo_label` は Ubuntu (`100.107.223.92:38081`) に残す段階切替案へ更新した。`inference_providers_json` は `dgx_text` と `ubuntu_vlm` の2 provider 構成とし、追加 secret 名として `vault_api_local_llm_ubuntu_shared_token` を runbook に明記した。
- (2026-04-25 21:39 JST) 標準の `update-all-clients.sh` は未commit/未push 変更で fail-fast するため、今回は Pi5 だけを例外経路で反映した。Pi5 上の `infrastructure/docker/.env` を timestamp 付き backup に退避してから `LOCAL_LLM_*` と `INFERENCE_*` を直更新し、`docker compose ... up -d --force-recreate api` で `api` を再作成した。
- (2026-04-25 21:40 JST) Pi5 実機確認が成功した。Pi5 から DGX / Ubuntu の `/healthz` はどちらも `ok`、Pi5 API の `GET /api/system/local-llm/status` は `configured=true` と `health.ok=true` を返し、管理 Chat は `system-prod-primary` / `疎通確認成功` を返した。さらに API コンテナ内 router では `document_summary -> dgx_text`、`photo_label -> ubuntu_vlm` を確認した。
- (2026-04-25 21:49 JST) `./scripts/deploy/verify-phase12-real.sh` を実行し、`PASS 43 / WARN 0 / FAIL 0` を確認した。今回の Pi5 `api` 再作成後も、既存の kiosk / signage / due-management / part-measurement / remote service checks に回帰は出ていない。
- (2026-04-25 22:03 JST) repo 側で provider 別 runtime control 実装を追加した。`INFERENCE_PROVIDERS_JSON` の各 provider に `runtimeControl` を持てるようにし、Pi5 API の on-demand controller は `document_summary -> dgx_text`、`photo_label -> ubuntu_vlm`、`admin_console_chat -> admin provider` の対応で start/stop を解決するよう更新した。関連 unit test 30 件は成功した。
- (2026-04-25 22:24 JST) Pi5 へ provider-aware runtime control の API 差分を同期し、`api` を rebuild して再検証した。`document_summary` と `photo_label` の synthetic on-demand check はどちらも成功し、`GET /api/system/local-llm/status` は `configured=true`、admin chat は `疎通確認成功` を返した。再実行した `./scripts/deploy/verify-phase12-real.sh` も `PASS 43 / WARN 0 / FAIL 0` だった。
- (2026-04-26 08:19 JST) 方針を再確認した。Ubuntu PC は「Spark より優れているから残す」のではなく、`photo_label` の Spark VLM 実証が終わるまでの **暫定 fallback** と位置づける。最終目標は、管理 chat / `document_summary` / `photo_label` を含む本システム用 LocalLLM を **Spark へ集中**させ、Ubuntu は rollback 手段が不要になった時点で退役候補にする。
- (2026-04-26 08:22 JST) `photo_label` を Spark 側へ寄せるための独立検証計画 `docs/plans/dgx-spark-photo-label-validation-plan.md` を追加した。current payload 互換、on-demand 安定性、代表画像セット品質、Ubuntu 退役判断条件を分離して追える形にした。
- (2026-04-26 08:27 JST) Pi5 経由で DGX `system-prod-primary` へ current `photo_label` payload を直接送った。runtime 起動後に `/v1/models` は ready になったが、画像付き `/v1/chat/completions` は `500` を返し、要点は `**image input is not supported` / `mmproj` が必要** だった。現行 Spark endpoint は text 用構成であり、photo_label を受ける VLM 構成にはなっていない。
- (2026-04-26 08:30 JST) 次の優先順を整理した。まずは **現行 `Qwen3.5-35B-A3B-UD-Q4_K_XL.gguf` に `mmproj` を足し、`system-prod-primary` を単一 VLM endpoint として成立させる**。`Qwen3.6` 系への置換は、その構造が安定したあとに同じ alias / 同じ入口のまま行う。もし現行 `Qwen3.5-35B` の VLM 化が詰まる場合のみ、`Qwen2.5-VL` / `Qwen2.5-Omni` / `Gemma 3/4` などの multimodal GGUF を中間到達点として検討する。
- (2026-04-26 09:07 JST) DGX `system-prod` に `mmproj-F16.gguf` を配置し、更新済み `start-llama-server.sh` で `Qwen3.5-35B-A3B-UD-Q4_K_XL.gguf` を `mmproj` 付きで起動できる形にした。DGX localhost で `scripts/dgx-local-llm-system/probe-photo-label-vlm.py` を実行し、current `photo_label` payload と同形の `/v1/chat/completions` は `200` で成功、応答例は `穴あけドリル` だった。
- (2026-04-26 09:10 JST) Pi5 API コンテナ内の one-off synthetic で `photo_label -> dgx_primary` を仮設定し、`ensureReady('photo_label') -> vision.complete() -> release('photo_label')` を確認した。連続 3 回とも成功し、`runtime_ready` は約 `6.3s` - `9.4s`、`vision.complete()` は約 `3.3s` - `4.8s`、応答例は `ドリル` / `穴あけドリル` だった。
- (2026-04-26 14:52 JST) 将来の NVFP4 / TRT-LLM 系ランタイム差し替えに備え、repo 側に **Blue/Green backend の土台**を追加した。DGX `gateway-server.py` / `control-server.py` は `ACTIVE_LLM_BACKEND=green|blue` で active backend を切り替えられるようにし、blue 用に `start-trtllm-server.sh` / `stop-trtllm-server.sh` の配線を追加した。Pi5 API 側は `INFERENCE_ADMIN_PROVIDER_ID` / `INFERENCE_ADMIN_MODEL` を導入し、管理 chat も provider-aware に切り替えられるよう更新した。関連 unit test は成功した。
- (2026-04-26 19:51 JST) DGX `system-prod` の **blue backend（`vllm/vllm-openai:cu130-nightly` + `sakamakismile/Qwen3.6-27B-NVFP4`、publish `127.0.0.1:38083->8000`）について、Hugging Face 重みの取得完了後、重み load → `torch.compile` → FlashInfer autotune など起動待ちのあと、OpenAI 互換 API の `**GET /v1/models` が `200`（`id=system-prod-primary`）、最小の `**POST /v1/chat/completions` が `200`** まで到達した（この時点の注意: `message.content` が空で `reasoning` に出る/短い `max_tokens` で `finish_reason=length` になりやすい挙動が観測された）。
- (2026-04-26 19:51 JST) 同じ blue endpoint に対し、repo 同梱の `scripts/dgx-local-llm-system/probe-photo-label-vlm.py` 相当（`image_url` + `text`、かつ `chat_template_kwargs: {enable_thinking: false}`）の `**POST /v1/chat/completions` が `200**` まで到達し、`message.content` に通常テキストが返る形式を確認した（入力画像の内容と整合しない返答はあり得るが、**VLM 入力が受理されること**の確認には十分）。
- (2026-04-26 20:58 JST) DGX 再起動後に blue を再検証したところ、on-demand `POST /start` 自体は `200` だが、`GET /v1/models` は長時間 `502 bad gateway: [Errno 104] Connection reset by peer` を返した。DGX localhost での追跡では、起動直後の reset が継続した後、**約 11 分 50 秒（`ready attempt=71`, 10 秒刻み）で `200`** へ到達し、`POST /v1/chat/completions` も `200` を確認した。現行 Pi5 設定の `LOCAL_LLM_RUNTIME_READY_TIMEOUT_MS=180000`（3 分）では blue cold start を吸収できないため、repo 側で `LOCAL_LLM_RUNTIME_READY_TIMEOUT_MS` の許容上限を引き上げ、inventory 既定値を `900000`（15 分）へ延長した。
- (2026-04-26 21:20 JST) blue cold start で毎回待機が発生してテストが詰まるため、`control-server.py` に `BLUE_LLM_RUNTIME_KEEP_WARM=true` を追加した。active backend が blue の場合、`/stop` は no-op になり、コンテナを温存して連続検証を高速化できる。DGX 実機でも `/start`→ready→`/stop` 後に `post_stop /v1/models=200` を確認した。あわせて Pi5 API を最新コードで再ビルドして `LOCAL_LLM_RUNTIME_READY_TIMEOUT_MS=900000` を反映し、`./scripts/deploy/verify-phase12-real.sh` は **PASS 43 / WARN 0 / FAIL 0** を維持した。
- (2026-04-26 21:55 JST) blue（vLLM）では `message.content` が空で `message.reasoning` 側に本文相当が出るケースがあるため、Pi5 API `local-llm-proxy` の正規化を最小拡張した。`content` が空のときに `reasoning` / `reasoning_content` / `content[]`（text parts）へフォールバックして本文抽出する。関連 route test を追加し、Pi5 API 再ビルド後も `verify-phase12` は **PASS 43 / WARN 0 / FAIL 0**。
- (2026-04-27) **blue `/stop` 方針のモジュール化**: `BLUE_LLM_RUNTIME_KEEP_WARM` 直書き分岐を `runtime_stop_policy.py` へ分離。`BLUE_LLM_RUNTIME_STOP_MODE=on_demand|keep_warm|always_on`（**明示が `KEEP_WARM` 真偽より優先**、未知値は警告してレガシーへ）。ユニットテスト: `test_runtime_stop_policy.py` / 既存 `test_control_server.py` 更新。Runbook/ADR: [dgx-system-prod-local-llm.md](../runbooks/dgx-system-prod-local-llm.md)、[ADR-20260427](../decisions/ADR-20260427-blue-llm-runtime-stop-policy.md)。
- (2026-04-27) **Pi5 本番とリポジトリの整合（正規 `manage-app-configs` + コード同期 + API 再ビルド）を実施した。Pi5 上の `/opt/RaspberryPiSystem_002` が未更新だと、playbook 単体では `infrastructure/docker/.env` の `LOCAL_LLM_RUNTIME_READY_TIMEOUT_MS` 等が旧値のままになり得るため、開発端末から `apps/api/src/`・Ansible（`inventory.yml` / `manage-app-configs` / `api.env.j2` / `docker.env.j2`）を `rsync` 同期 → Pi5 で `ansible-playbook ... manage-app-configs.yml --limit raspberrypi5`（`failed=0`）→ `docker compose` で `api` イメージ再ビルド + `--force-recreate` の順を踏んだ。整合後、開発端末で `./scripts/deploy/verify-phase12-real.sh` を実行し、**PASS 42 / WARN 1 / FAIL 0**（WARN は `auto-tuning scheduler` ログ件数 0。スクリプトは `PUT auto-generate=200` を代替判定）を確認した。
- (2026-04-27) **DGX 本番へ `runtime_stop_policy.py` 同梱の `control-server.py` を反映し、Pi5 経由で疎通確認**（`runtime_stop_policy` 分離・`BLUE_LLM_RUNTIME_STOP_MODE` 本番運用）。Tailscale では **一時的に** `tag:server → tag:llm` に `**tcp:22`** を追加して Pi5 から DGX へ SSH で配置したあと、**作業完了後に grants から除去（ユーザー確認済み）**。到達経路・502/reset・`enable_thinking`・`keep_warm` の知見は [runbook の 2026-04-27 節](../runbooks/dgx-system-prod-local-llm.md)・[KB-357](../knowledge-base/infrastructure/security.md)・[tailscale-policy.md](../security/tailscale-policy.md) に集約。
- (2026-04-27) **PR [#203](https://github.com/denkoushi/RaspberryPiSystem_002/pull/203) を `main` にマージ**（**`e97c7941`**）し、Pi5 を **`update-all-clients.sh main … --limit raspberrypi5`** で正規追従（Detach **`20260427-201319-30682`**・**exit 0**）。**CI**: `api-db-and-infra` / **Wait for PostgreSQL** の一時失敗は **`gh run rerun --failed`** で緑化（[KB-358](../knowledge-base/ci-cd.md#kb-358-api-db-and-infra-の-wait-for-postgresql-が-flake-するborrow_return-等)）。**記録**: [deployment.md](../guides/deployment.md)・[EXEC_PLAN.md](../../EXEC_PLAN.md) Progress。
- (2026-04-28) **本番既定 backend 判断の文書化**（[ADR-20260428](../decisions/ADR-20260428-dgx-active-backend-prod-default.md)・Runbook）と、**VLM 画像デコード系 400 への再エンコード再送**（Pi5 API `RoutedVisionCompletionAdapter` + `vision-vlm-fallback.util.ts`）・OpenAI 互換応答の **reasoning 系フォールバック共通化**（`openai-chat-response.util.ts` / `local-llm-proxy`）を repo に反映。
- 本システム用 LocalLLM を DGX Spark 上に構築し、Ubuntu PC と並行稼働させる。
- Pi5 の LocalLLM upstream を DGX Spark へ切り替え、Phase12 と残りの代表機能検証を完了する。
- 私用・実験用途を追加し、業務用途との混流がないことを確認する。
- 運用 Runbook と ADR を必要に応じて更新する。

## Surprises & Discoveries

- Observation: DGX（`tag:llm`）へ **repo の `control-server.py` をホストに配置**する作業は、Tailnet 上の **API 入口 `38081` の疎通**とは独立である。既定 ACL では `**tag:server → tag:llm` は `tcp:38081` のみ**で、**Pi5 から DGX への SSH（`tcp:22`）は許可されない**。一時 grant を足して配置し、**完了後に grants から除去**する運用が必要（ [tailscale-policy.md](../security/tailscale-policy.md) ・ [KB-357](../knowledge-base/infrastructure/security.md) ）。
Evidence: 作業記録と手順を Runbook / KB に集約済み（2026-04-27）。
- Observation: 現行システムの LocalLLM は、管理チャットだけでなく、写真持出 VLM ラベル、要領書 OCR 要約にも使われている。
Evidence: `docs/runbooks/local-llm-tailscale-sidecar.md` は写真持出と要領書の `ensure/release` を明記し、`apps/api/src/services/tools/photo-tool-label/photo-tool-label.scheduler.ts` と `apps/api/src/services/kiosk-documents/kiosk-document-summary-on-demand-runtime.ts` がランタイム制御を参照している。
- Observation: Pi5 本番の `LOCAL_LLM_`* 正本は `apps/api/.env` ではなく、Ansible が生成する `infrastructure/docker/.env` である。
Evidence: `docs/runbooks/local-llm-tailscale-sidecar.md` と `docs/knowledge-base/infrastructure/ansible-deployment.md#kb-318-pi5-local-llm-via-docker-env` がこの経路を正としている。`infrastructure/ansible/templates/docker.env.j2` に `LOCAL_LLM_*` が出力される。
- Observation: NVIDIA 公式情報では、DGX Spark は Docker と NVIDIA Container Runtime が標準であり、GPU コンテナ実行が正規の運用入口である。
Evidence: NVIDIA 公式 `DGX Spark User Guide` と `NVIDIA Container Runtime for Docker` は、`docker run --gpus=all ... nvidia-smi` による検証を案内している。
- Observation: Secure Boot / TPM は利用可能だが、実機の既定状態は公式資料の版や文脈で解釈差が出やすい。設定前に実機で確認する。
Evidence: NVIDIA 公式 Porting Guide では first-party DGX Spark で Secure Boot / TPM が既定 off 寄りに読める記述がある。ユーザーサイトや要約情報だけで断定しない。
- Observation: 現在の作業ツリーには未追跡 `docs/design/pallet-signage-design-preview.html` と `docs/design/preview-assets/` が存在する。
Evidence: 2026-04-25 の `git status --short --branch` で確認。今回の DGX Spark ドキュメント作業では触らない。
- Observation: DGX Spark の初回 firmware 更新後、USB-C PD firmware の追加更新が残っていた。`fwupdmgr update` で Asus / LVFS の `GX10 USB-C PD FW Controller Update` を適用し、再起動後は `No updates available` になった。
Evidence: `fwupdmgr get-updates --no-unreported-check` が `Devices with the latest available firmware version` と `No updates available` を返した。
- Observation: DGX Spark の基盤状態は良好である。`nvidia-smi` は `NVIDIA GB10`、Driver `580.142`、CUDA `13.0` を表示し、公式 CUDA コンテナ内では CUDA `13.0.1` と同じ GPU を確認できた。
Evidence: ホスト側 `nvidia-smi` と `docker run --rm --gpus=all nvcr.io/nvidia/cuda:13.0.1-devel-ubuntu24.04 nvidia-smi` が成功した。
- Observation: `nvidia-smi` の `Memory-Usage: Not Supported` は DGX Spark の unified memory 構成では想定内として扱う。
Evidence: NVIDIA 公式既知情報では DGX Spark の unified memory では通常の RTX GPU と同じ VRAM 表示にならない注意がある。実機でも `Memory-Usage: Not Supported` のまま GPU と CUDA は正常に動作した。
- Observation: 用途分離の初期土台は Docker network とディレクトリ分離で開始した。`secrets` は `700`、その他の用途別サブディレクトリと共有モデル置き場は `750` にした。
Evidence: `find /srv/dgx -maxdepth 2 -type d -printf "%M %u:%g %p\n"` で、`/srv/dgx/*/secrets` が `drwx------`、`compose` / `data` / `logs` / `outputs` と `shared-models/{llm,vlm,cache}` が `drwxr-x---` であることを確認した。
- Observation: 公式 `vLLM` image は DGX Spark にプリインストールされておらず、NGC から取得する必要がある。
Evidence: `docker images` で `nvcr.io/nvidia/vllm:26.02-py3` が約 `14.7GB`、`nvcr.io/nvidia/cuda:13.0.1-devel-ubuntu24.04` が約 `6.59GB` と表示された。取得後の `df -h /srv/dgx` は `916GB` 中 `68GB` 使用、`802GB` 空きだった。
- Observation: DGX Spark の unified memory では、軽量モデルでも `vLLM` の既定設定が大きなメモリ予約を行う可能性がある。初回の `Qwen/Qwen2.5-Math-1.5B-Instruct` 起動では `/v1/chat/completions` は成功したが、ホスト全体の used memory が約 `116GiB` まで増えた。
Evidence: `docker stats` はコンテナ自身を約 `2.9GiB` と表示した一方、`free -h` は `121GiB` 中 `116GiB` 使用を示した。コンテナ停止後は used memory が約 `3.1GiB` に戻った。
- Observation: `vLLM` を `--gpu-memory-utilization 0.25`、`--max-model-len 2048`、`--enforce-eager` で起動すると、初回 smoke test としては十分に安定した。`Qwen/Qwen2.5-1.5B-Instruct` は `lab-qwen2.5-1.5b` として公開し、`こんにちは！` を返した。
Evidence: `curl http://127.0.0.1:18000/v1/models` が `lab-qwen2.5-1.5b` を返し、`POST /v1/chat/completions` が成功した。推論後の `free -h` は約 `35GiB` 使用、約 `78GiB` free、約 `85GiB` available、Hugging Face cache は約 `5.8GB` だった。
- Observation: smoke test 後はコンテナを停止し、モデル cache と image だけを残すのが安全である。
Evidence: `docker rm -f dgx-lab-vllm-qwen15b` 後、実行中コンテナはなく、`free -h` は約 `3.2GiB` used、約 `110GiB` free、`df -h /srv/dgx` は約 `796GB` free を示した。
- Observation: `Qwen/Qwen3.6-35B-A3B` は本命候補として妥当だが、現行の取得済み NVIDIA `vLLM` image だけでは要件が不足する可能性がある。
Evidence: Qwen model card は `vLLM>=0.19.0` と `SGLang>=0.5.10` を推奨している。DGX Spark 上の `nvcr.io/nvidia/vllm:26.02-py3` は `vLLM=0.15.1+nv26.2`、`transformers=4.57.5`、`torch=2.11.0a0+eb65b36914.nv26.2` だった。
- Observation: NVIDIA Spark 公式 SGLang playbook は DGX Spark 向けの正規導線だが、現時点の support matrix は `Qwen3` 系までで、`Qwen3.6` は明記されていない。また、`lmsysorg/sglang:spark` の取得は今回の回線では停滞した。
Evidence: `build.nvidia.com/spark/sglang` は `lmsysorg/sglang:spark` を案内し、Qwen は `Qwen3-8B`、`Qwen3-14B`、`Qwen3-32B` などを列挙している。`docker pull lmsysorg/sglang:spark` は一部 layer 取得後に長時間進まず、中断後の `docker images` には SGLang image が存在しなかった。
- Observation: `lmsysorg/sglang:latest` は ARM64 対応で、Qwen3.6 の要求を満たす SGLang 版を含む。`spark` tag より新しいため、Qwen3.6 検証では `latest` を優先する。
Evidence: Docker Hub tag 情報では `latest` が `linux/arm64` image を持ち、2026-04-09 更新だった。DGX Spark 上で `docker pull lmsysorg/sglang:latest` が完了し、`sglang=0.5.10.post1`、`transformers=5.3.0`、`torch=2.9.1+cu129` を確認した。
- Observation: `lmsysorg/sglang:latest` は DGX Spark の `NVIDIA GB10` を認識し、単純な CUDA tensor 計算は成功する。一方で PyTorch は GB10 の compute capability `12.1` を完全対応範囲外として警告する。
Evidence: `docker run --rm --gpus all --entrypoint python3 lmsysorg/sglang:latest ...` で `cuda_available=True`、`device=NVIDIA GB10`、CUDA 上の `512x512` 行列積が成功した。同時に `Minimum and Maximum cuda capability supported by this version of PyTorch is (8.0) - (12.0)` 警告が出た。
- Observation: `lmsysorg/sglang:latest` は Qwen3.6 の SGLang version 要件を満たすが、DGX Spark の GB10 向け serving 実行では Triton/PTX が `sm_121a` を扱えず停止する。
Evidence: 小型モデル `Qwen/Qwen2.5-1.5B-Instruct` の SGLang server 起動時、CUDA graph capture 中に `ptxas fatal: Value 'sm_121a' is not defined for option 'gpu-name'` が発生した。これはモデルサイズではなく、同梱 Triton/PTX toolchain と GB10 compute capability の互換性問題である。
- Observation: `lmsysorg/sglang:latest` の `sm_121a` 問題は CUDA graph 固有ではない。graph 系を無効化しても、SGLang の通常 request path で Triton kernel compile が走り、同じ `ptxas` エラーで停止した。
Evidence: `--disable-cuda-graph --disable-piecewise-cuda-graph` を付けた再試行でも、`write_req_to_token_pool_triton` の compile 時に `ptxas fatal: Value 'sm_121a' is not defined for option 'gpu-name'` が発生した。
- Observation: host 側 CUDA 13.0 の `ptxas` を `TRITON_PTXAS_PATH` に指定すると、Triton の bundled `ptxas` 問題は回避できる。しかし `lmsysorg/sglang:latest` はその後の attention 実行で GB10 向け kernel image が不足して停止する。
Evidence: `/usr/local/cuda-13.0/bin/ptxas` を `/opt/host-ptxas` に mount し、`TRITON_PTXAS_PATH=/opt/host-ptxas` を指定した再試行では、重み load と server startup までは進んだが、health check request の forward path で `torch.AcceleratorError: CUDA error: no kernel image is available for execution on the device` が発生した。
- Observation: DGX Spark / GB10 の `llama.cpp` CUDA build は `CMAKE_CUDA_ARCHITECTURES=121` が必要である。`120` 指定では CMake が `120a` に置換し、GPU は認識するが実推論で `CUDA error: no kernel image is available for execution on the device` が出た。
Evidence: `CMAKE_CUDA_ARCHITECTURES=120` の `build` は `ARCHS = 1200` と表示され、`Qwen2.5-0.5B-Instruct` の warmup/slot init で `MUL_MAT failed` になった。`CMAKE_CUDA_ARCHITECTURES=121` の `build-sm121` は同じモデルで `/v1/chat/completions` に成功した。
- Observation: `llama.cpp + GGUF` は、SGLang が詰まっている GB10 上でも OpenAI 互換 API のベースラインとして成立した。
Evidence: `build-sm121/bin/llama-server --model ... --alias lab-qwen2.5-0.5b-gguf --host 127.0.0.1 --port 18200 --ctx-size 2048 -ngl 99 -fa on --no-mmap --parallel 1` で `/v1/models` が alias を返し、`POST /v1/chat/completions` が `こんにちは。` を返した。停止後の使用量は `llama.cpp` build 約 `746MB`、小型 GGUF 約 `380MB`、ログ約 `64KB`、実行中 LLM process なし。
- Observation: `Qwen3.5-35B-A3B-UD-Q4_K_XL.gguf` の取得は正常完了し、まず `llama.cpp` ベースラインを実測できる状態になった。
Evidence: `/srv/dgx/shared-models/llm/gguf/Qwen3.5-35B-A3B-UD-Q4_K_XL.gguf` は `22,241,950,336 bytes` で保存され、監視タスクは `DONE` と `sha256=1b0ac637dfa092bbba2793977db9485a40c4f8b42df5fe342f0076d61b66ae83` を残して正常終了した。
- Observation: `Qwen3.5-35B-A3B-UD-Q4_K_XL.gguf` は GB10 上の `llama.cpp` で即座に起動し、35B クラスでも OpenAI 互換 API ベースラインとして成立した。
Evidence: `llama-server --model /srv/dgx/shared-models/llm/gguf/Qwen3.5-35B-A3B-UD-Q4_K_XL.gguf --alias lab-qwen3.5-35b-gguf --host 127.0.0.1 --port 18200 --ctx-size 2048 -ngl 99 -fa on --no-mmap --parallel 1` で `/health` は `{"status":"ok"}`、`/v1/models` は alias を返し、`/v1/chat/completions` は `time_total=0.601441`、`predicted_per_second=62.2901` を返した。
- Observation: DGX Spark の unified memory では、35B GGUF を起動するとホスト全体の used memory が約 `3.6GiB` から約 `26GiB` へ増えた一方、`ps` 上の `RSS` は約 `1.29GB` に見える。容量判断は process RSS ではなくホスト全体の `free -h` を正に見るべきである。
Evidence: 起動前 `free -h` は `used 3.6GiB / available 118GiB`、起動後 chat 実行時は `used 26GiB / available 95GiB`、停止後は再び `used 3.6GiB / available 118GiB` に戻った。
- Observation: Qwen3.5 GGUF の既定挙動では、短い問い合わせでも `reasoning_content` 側にトークンを使い、`max_tokens=32` では本文 `content` が空のまま `finish_reason=length` になる場合がある。
Evidence: `10文字以内で挨拶して` に対する test request は `prompt_tokens=17`、`completion_tokens=32`、`finish_reason=length` で、返答 JSON の `message.content` は空、`message.reasoning_content` に思考過程が入った。
- Observation: DGX 実機には `node` が入っておらず、`control-server.mjs` はそのままでは使えない。一方で `python3 3.12.3` は標準で利用できるため、localhost smoke は Python 版 `control-server.py` と `gateway-server.py` で構成した。
Evidence: DGX で `node --version` は `command not found`、`python3 --version` は `Python 3.12.3` を返した。
- Observation: `system-prod-primary` alias を使った localhost gateway 構成でも、on-demand start/stop と text chat の基本互換は成立した。
Evidence: `127.0.0.1:38081/healthz` は `ok`、`POST /start` と `POST /stop` は `{\"ok\": true}`、`GET /v1/models` は alias `system-prod-primary` を返した。`POST /v1/chat/completions` は `enable_thinking=false` で `疎通確認 OK` を返し、`time_total=0.372736`、`completion_tokens=5`、停止後の `free -h` は `used 4.0GiB / available 117GiB` だった。
- Observation: tailnet 側の allowlist は意図どおり機能している。運用 Mac (`tag:admin`) から `tag:llm:38081` は timeout だが、Pi5 (`tag:server`) からは到達できた。
Evidence: `docs/security/tailscale-policy.md` の allowlist は `tag:server -> tag:llm: tcp:38081` のみを許可している。実測でも Mac から `http://100.118.82.72:38081/healthz` は timeout、一方 Pi5 から同 URL は `ok`、さらに `POST /start`、`GET /v1/models`、`POST /v1/chat/completions`、`POST /stop` が通った。
- Observation: Pi5 から DGX への on-demand text 経路は、起動直後の short wait を含めれば実用になる見込みである。
Evidence: Pi5 から `POST /start` 後、`/v1/models` は ready 待ち後に `system-prod-primary` を返し、chat は `Pi5 疎通 OK`、`completion_tokens=7`、`predicted_per_second=64.19` を返した。`POST /stop` 後の DGX `free -h` は `used 3.6GiB / available 117GiB` に戻った。
- Observation: 標準 Ansible deploy は今回まだ実行しておらず、Pi5 本番反映は例外経路として `infrastructure/docker/.env` の直更新 + `api` 再作成で行った。rollback は Pi5 上に残した `.env.before-dgx-local-llm-<timestamp>` へ戻せる。
- Observation: Pi5 API の管理 Chat / status は、`INFERENCE_ADMIN_PROVIDER_ID` 未指定時は `default` 優先、その次に `INFERENCE_PROVIDERS_JSON` の先頭 provider に従う。これにより `LOCAL_LLM_*` と整合した管理系既定経路を維持しつつ、必要なら admin だけ明示的に別 provider へ寄せられる。
- Observation: Pi5 `api` 再作成後の `Phase12` 自動実機確認では、既存の Pi3 / Pi4 / Pi5 API 系に回帰は出なかった。少なくとも本番 kiosk / signage / due-management 系の基礎健全性は維持されている。
- Observation: 用途別 provider ルーティングだけでは不十分で、runtime 起動停止も同じ provider に追従させる必要がある。実測では `document_summary` は DGX で成功した一方、`photo_label` は Ubuntu provider へ解決されても Ubuntu VLM が停止中のため `502 Bad Gateway` になった。
- Evidence: Pi5 API 内 synthetic check では `document_summary` が `providerId=dgx_text` / `result=ok`、`photo_label` が `providerId=ubuntu_vlm` / `errorReason=upstream_http_502` を出した。Ubuntu upstream は `/healthz=200` でも `/v1/models=502`、かつ DGX の control token では `/start=403` だった。
- Observation: `.env` の provider runtimeControl だけを先に反映しても、Pi5 API 実装が古いままだと `photo_label` は従来の単一 runtime controller を使い続ける。設定反映とコード反映は同時に行う必要がある。
- Evidence: Pi5 で `.env` 更新直後は `document_summary` 成功 / `photo_label=502` だったが、`apps/api` の差分同期と `docker compose ... build api && up -d --force-recreate api` 後は両方成功した。
- Observation: 現時点で Ubuntu PC を残している理由は性能やモデル品質ではなく、`photo_label` を Spark 側の本命 VLM/runtime へ安全に移すまでの運用保険である。
- Evidence: text 系 (`admin chat` / `document_summary`) はすでに DGX 側で成功しており、Pi5 API の runtime routing も DGX 優先で成立している。一方で `photo_label` は「Spark 側の vision payload / model 互換確認」をまだ別タスクとして残している。
- Observation: 現在の DGX `system-prod-primary` endpoint は、画像付き chat payload を受けても VLM としては処理できない。問題は API 形ではなく、**現行 `Qwen3.5-35B` を VLM として起動していない**ことである。
- Evidence: Pi5 経由の直接プローブでは `POST /start -> 200`、ready 後の `POST /v1/chat/completions`（`image_url` + `text`）が `500` で、要点は `image input is not supported - ... provide the mmproj` だった。
- Observation: 現行の DGX 起動雛形 `scripts/dgx-local-llm-system/start-llama-server.sh` は text 用であり、`--mmproj` を渡す VLM 起動構成を持っていない。
- Evidence: 雛形スクリプトは `--model` / `--alias` / `--ctx-size` などだけを渡して `llama-server` を起動している。upstream の multimodal docs では `llama-server -m ... --mmproj ...`、または `-hf <supported multimodal GGUF>` が前提とされる。また `Qwen3.5-35B-A3B` GGUF には `mmproj-F16.gguf` などの projector が存在する。
- Observation: `Qwen3.5-35B-A3B-UD-Q4_K_XL.gguf` に `mmproj-F16.gguf` を組み合わせた `system-prod-primary` は、current `photo_label` payload を処理できる。
- Evidence: DGX localhost の `probe-photo-label-vlm.py` は `POST /v1/chat/completions -> 200` と `assistant_text: 穴あけドリル` を返した。Pi5 API コンテナ内 one-off synthetic でも `providerId=dgx_primary` / `model=system-prod-primary` / `result=ok` を 3 回連続で確認した。
- Observation: blue 側（`vLLM` + NVFP4 / compressed-tensors 想定）の first boot は、重みの HF 取得、重い safetensors load、`torch.compile`、FlashInfer autotune など **HTTP ready までが長く**、その間 `127.0.0.1:<published-port>` への疎通は `connection reset` になり得る。進捗判断は `docker logs`（load/compile/tune の段階）と、HF cache の `.incomplete` 有無、GPU process の存在を優先するのが早い。
- Evidence: 実測で `Time spent downloading weights ...` 後に `Loading weights took ...`、`torch.compile took ...`、FlashInfer `Autotuning ...`、最後に `Application startup complete.` が出てから `GET /v1/models` が安定して `200` になった。
- Observation: `vllm/vllm-openai` 系 image は entrypoint が `vllm` になりがちで、従来の `bash -lc` ラッパーと併用すると `vllm` の引数解釈が壊れる。Blue 起動では `**BLUE_SERVER_ENTRYPOINT=bash`** のように entrypoint を明示し、起動引数の `--entrypoint` と整合させるのが安全。
- Evidence: 以前は `vllm: error: unrecognized arguments: -lc '...'` が出た。entrypoint を `bash` に寄せ、launcher 側の二重 `bash` を避けると解消する。
- Observation: `Qwen3.6-27B-NVFP4`（`compressed-tensors` + NVFP4 kernel）系では、短い疎通 chat でも `**message.content` が空で `message.reasoning` に長文が出る** / `max_tokens` が小さいと `finish_reason=length` になりやすい、一方で `enable_thinking: false`（`chat_template_kwargs`）を併用する **VLM（image+text）payload では `message.content` に通常本文が出る**、という二系統の見え方が出る。
- Evidence: 同じ `system-prod-primary` に対し、極小 text だけの疎通は `content=null` + `reasoning=...` + `finish_reason=length` を観測。`probe-photo-label-vlm.py` 相当（`enable_thinking: false`）は `content` に日本語文が入り `finish_reason=stop` となった。
- Observation: **DGX ホストが SSH 応答不能**（`Connection timed out during banner exchange` 等）になるケースは、重い推論の cold start や I/O 負荷に加え、**システム全体のリソース枯渇**でも起こり得る。Tailscale 越しも同様に切れることがある。切り分けは**別経路（ローカル LAN / コンソール）**、必要なら**物理再起動**まで想定し、**事前に `docker logs` で進捗**を取っておく（blue は特に起動に時間がかかる）。
- Evidence: 再現手順は固定化できていないが、同様の事象は cold start 検証中に観測され、再起動で復帰した。
- Observation: **「コンテナに閉じてホストを汚さないか」について、本システムは 推論は Docker コンテナ内（公式/検証済み image + bind mount したモデル）に閉じ、ホストへ CUDA/PyTorch を手作業導入する運用は採用しない（ExecPlan の方針どおり）。一方、他コンテナと完全に混信・混入ゼロは、同一 DGX 上で GPU/DRAM/CPU を共有する限り保証しにくい。実務上の分離は 用途別 Docker network / 用途別 `compose` プロジェクト / ディレクトリと token の分離（`system-prod` / `private-personal` / `lab-experiments`）で行い、同一ホスト上の他ワークロードとはリソース競合し得る。blue（vLLM）で `--ipc host` を付ける例では IPC 名前空間をホストと共有する貿易（性能目的）が入り、「VM 相当の厳密分離」ではない**点に注意する。
- Observation: 一部の経路で、vision payload が upstream で `**400 Bad Request`（画像デコード系メッセージ）** になる事象は、DGX 側 vLLM / 前処理の組み合わせ次第で **未解決のチューニング余地** として残る。本文抽出は Pi5 `local-llm-proxy` で `reasoning` フォールバック等の対策済み。
- Evidence: エラーメッセージ例は `Failed to load image: cannot identify image file` 系（vLLM 側の解釈）。再現条件は payload / image pipeline に依存。
- Observation（2026-04-28）: **400** は単一原因に帰せない。**コンテキスト超過**（`Input length … maximum context length`）と **画像デコード失敗**（`cannot identify image file` 等）を **body** で区別できる。本番 Pi5 保存画像 **531 件**の一括プローブ例では **全件 200**。PR [#204](https://github.com/denkoushi/RaspberryPiSystem_002/pull/204) / [#205](https://github.com/denkoushi/RaspberryPiSystem_002/pull/205) で API 側の **再試行・再エンコード**を拡張済み。
- Evidence: 巨大・破損の**合成**画像で 400 を意図的再現。到達は **Pi5 経由 SSH トンネル**（`127.0.0.1:38081`）の方が Mac 直より安定しやすい例（[deployment.md](../guides/deployment.md) 2026-04-28 補足）。

## Decision Log

- Decision: DGX Spark は Ubuntu PC の単純な置換先ではなく、共有 AI 実行基盤として設計する。
Rationale: 本システム、私用、実験用途を同居させる想定があり、後から分離境界を作るとデータ、ログ、API キー、RAG データが混ざる危険が高いため。
Date/Author: 2026-04-25 / GPT-5.5
- Decision: NVIDIA 公式の DGX OS、Docker、NVIDIA Container Runtime、NGC コンテナを最優先する。
Rationale: DGX Spark は Grace Blackwell / ARM64 / CUDA 13 系の公式最適化スタックを前提にしている。ホスト OS に自己流で CUDA、PyTorch、vLLM を入れると、更新やトラブルシュートが難しくなるため。
Date/Author: 2026-04-25 / GPT-5.5
- Decision: 分離単位は「コンテナ単体」ではなく「用途領域」とする。
Rationale: コンテナだけでは、同じ Docker daemon、同じホスト OS、同じ GPU、同じログやボリュームを共有しがちで、気密性の説明として弱い。用途領域ごとに Linux user、Compose project、Docker network、volume、secrets、ログ保存先、外部入口を分ける。
Date/Author: 2026-04-25 / GPT-5.5
- Decision: 巨大モデル重みは原則として共有可能資産とし、プロンプト、応答ログ、RAG、添付資料、API キーは用途ごとに分離する。
Rationale: モデル重みはストレージ効率とロード効率の観点で共有価値が高い。一方で、情報流出リスクはモデル本体よりも入出力、ログ、知識ベース、資格情報に集中するため。
Date/Author: 2026-04-25 / GPT-5.5
- Decision: 最初は DGX Spark を本システム専用 LocalLLM ノードとして検証し、私用・実験用途の追加はその後にする。
Rationale: 一度に全用途を載せると、性能問題、ネットワーク問題、モデル互換問題、情報分離問題の切り分けが困難になる。先に現行 Ubuntu PC 置換の成功基準を満たす。
Date/Author: 2026-04-25 / GPT-5.5
- Decision: `lab` 領域の最初の軽量 LLM 検証は、NVIDIA 公式 `vLLM` コンテナと公開小型 Hugging Face model で行う。NIM は本番候補として強いが、NGC API key と model cache の扱いが必要なため、初回 smoke test では後回しにする。
Rationale: 最初の目的は DGX Spark 上で OpenAI 互換 API が立ち上がることの確認であり、秘密情報を増やさず、失敗時に消しやすい検証から始めるのが安全である。
Date/Author: 2026-04-25 / GPT-5.5
- Decision: 本システム用 LocalLLM の本命モデルは `Qwen/Qwen3.6-35B-A3B` とする。モデル差し替えを前提に、Pi5 から見える served model name は固定 alias にし、実モデル ID は DGX Spark の `system-prod` 側設定で切り替える。
Rationale: Qwen3.6 は最新の Qwen 世代で、テキスト、画像、エージェント/コーディング用途を横断できる。現システムには管理チャット、要領書要約、写真ラベルがあり、単一の multimodal 本命候補として検証する価値が高い。一方で今後さらに新しいモデルへ置換する可能性が高いため、Pi5 側に実モデル名を焼き込まない。
Date/Author: 2026-04-25 / GPT-5.5
- Decision: `Qwen/Qwen3.6-35B-A3B` の第一候補ランタイムは SGLang とし、保険として llama.cpp / GGUF を残す。現行の NVIDIA `vLLM:26.02-py3` は Qwen3.6 の要求より古いため、Qwen3.6 では第一候補にしない。
Rationale: Qwen3.6 model card が `SGLang>=0.5.10` を推奨しており、SGLang は LLM/VLM と OpenAI 互換 API の本番 serving に向く。現行 Ubuntu PC に近い llama.cpp は rollback 的な保険になる。一方、vLLM は強力だが、手元の公式 image は `vLLM=0.15.1+nv26.2` で、Qwen3.6 推奨の `vLLM>=0.19.0` に届かない。
Date/Author: 2026-04-25 / GPT-5.5
- Decision: Qwen3.6 の初回検証モデルは `Qwen/Qwen3.6-35B-A3B-FP8` とする。BF16 は保留し、まず FP8 でメモリ余裕、OpenAI 互換 API、画像入力の代表ケースを確認する。
Rationale: SGLang Qwen3.6 cookbook では FP8 variant が推奨例に含まれ、35B-A3B BF16 は重みだけで約 `70GB`、FP8 は約 `35GB` とされる。DGX Spark は 128GB UMA だが、他用途との共存、KV cache、画像特徴量、OS 余裕を考えると、初回は FP8 が安全である。
Date/Author: 2026-04-25 / GPT-5.5
- Decision: DGX への初回切替は一括置換ではなく段階切替にする。`LOCAL_LLM_`* は DGX `system-prod` を向ける一方、`photo_label` は `INFERENCE_PROVIDERS_JSON` の用途別 route で Ubuntu provider を残し、`document_summary` は DGX text provider へ寄せる。
Rationale: `Qwen3.5-35B-A3B-UD-Q4_K_XL.gguf` は DGX / GB10 上の text ベースラインとして成立したが、現時点では photo_label で必要な vision payload を未確認である。写真持出 VLM を壊さずに DGX 移行を前へ進めるには、用途別 route による段階切替が最も安全で rollback もしやすい。
Date/Author: 2026-04-25 / GPT-5.4
- Decision: 複数 provider を併用する段階切替では、runtime 制御も provider ごとに持たせる。`INFERENCE_PROVIDERS_JSON[*].runtimeControl` を追加し、Pi5 API の on-demand controller は useCase が解決した provider の `/start` `/stop` `/healthz` を使う。
- Rationale: `photo_label` を Ubuntu に残したまま `document_summary` と管理 Chat を DGX へ寄せるには、推論先と runtime 起動停止先が同じ provider を見る必要がある。単一の `LOCAL_LLM_RUNTIME`_* だけでは secondary provider が停止中のままになり、`502` を防げない。
- Date/Author: 2026-04-25 / GPT-5.4
- Decision: 本システム用 LocalLLM の最終形は **Spark 集中**とする。Ubuntu PC は段階移行中の fallback / rollback 用に限って残し、`photo_label` を含む代表ケースが Spark 上で安定した時点で退役判断へ進む。
- Rationale: 現在の本命モデルと計算資源は Spark 側が前提であり、Ubuntu を恒久併用する積極的な理由はない。二重運用を長く続けると token、runtime control、runbook、障害切り分けが増え、運用コストだけが残るため。
- Date/Author: 2026-04-26 / GPT-5.4
- Decision: `photo_label` の次の最優先技術検証は、**現行 `Qwen3.5-35B-A3B-UD-Q4_K_XL.gguf` を `mmproj` 付きで起動し、`system-prod-primary` を単一 VLM endpoint として成立させること**とする。
- Rationale: ユーザー意図は「モデル差し替え」と「実行デバイス差し替え」を壊さず進めることであり、複数 provider / 複数 model の暫定構成はそのための保険にすぎない。まず同じ alias / 同じ入口で text + image を扱える構造を固め、その後に `Qwen3.6` 系へ 1 対 1 で置き換える方が自然である。
- Date/Author: 2026-04-26 / GPT-5.4

## Outcomes & Retrospective

2026-04-25 19:56 JST 時点では、設計方針と段階計画の文書化に加え、DGX Spark 実機の初期セットアップ、firmware 更新、SSH 鍵登録、Docker 権限設定、ホスト GPU 確認、公式 CUDA コンテナ GPU 確認、用途別ディレクトリと Docker network の作成、公式 `vLLM` image 取得、`lab` 領域の軽量 LLM OpenAI 互換 API 疎通、本命モデル `Qwen/Qwen3.6-35B-A3B` の選定、Qwen3.6 要求を満たす `lmsysorg/sglang:latest` 取得、`llama.cpp` の GB10 対応 build 作成、小型 GGUF smoke test、`Qwen3.5-35B-A3B-UD-Q4_K_XL.gguf` の取得、さらに 35B GGUF の実測まで完了した。一方、`lmsysorg/sglang:latest` の小型モデル serving は、host CUDA 13.0 `ptxas` 指定でも attention kernel の GB10 対応不足で停止した。また Qwen3.5 GGUF は baseline として安定に動くが、既定では reasoning を優先しやすく、短い chat をそのまま Pi5 に繋ぐ前に `thinking` の扱いと `max_tokens` の方針を決める必要がある。まだ本システム用 LocalLLM 構築、Tailscale 参加、Pi5 upstream 切替は未実施である。次の作業は、`system-prod` 用の固定 alias、port、起動停止方式、ログ保存先、thinking 制御方針を決め、Pi5 互換の入口設計に落とすことである。

## Context and Orientation

現行システムでは、Raspberry Pi 5 が API、DB、Web、Ansible デプロイの中心である。LocalLLM は Pi5 ではなく Ubuntu PC 上に置かれており、Pi5 API が Tailscale 経由で代理呼び出しする。Ubuntu 側は `ubuntu-local-llm-system` という tailnet ノードで、Tailscale IP は `100.107.223.92`、入口は `http://100.107.223.92:38081` である。`nginx` が外部入口を受け、内部の `llama-server` は `127.0.0.1:38082`、起動停止制御は `control-server.mjs` が `0.0.0.0:39090` で受ける。

Pi5 側の本番設定は `infrastructure/ansible/inventory.yml` と `infrastructure/ansible/templates/docker.env.j2` に集約される。現在の意図は `LOCAL_LLM_RUNTIME_MODE=on_demand` であり、推論前に Pi5 API が Ubuntu 側の `/start` を叩き、推論可能状態を確認してから処理し、最後の利用者が終わったら `/stop` を叩く。参照カウントにより、写真持出 VLM、要領書要約、管理チャットが重なっても、最後の `release` まで `llama-server` は止まらない。

DGX Spark への移行では、Pi5 から見える LocalLLM upstream を Ubuntu PC から DGX Spark へ置き換える。ただし、DGX Spark は本システムだけでなく、私用、実験、将来の独立用途にも使う。そのため、DGX Spark 上では次の3つを別々に考える。

1. 共有してよい計算基盤。DGX OS、NVIDIA ドライバ、Docker、NVIDIA Container Runtime、NGC コンテナ、必要に応じて巨大モデル重み。
2. 共有してはいけない情報。業務データ、私用データ、添付ファイル、RAG データ、ベクトル DB、プロンプト、応答ログ、API キー、トークン。
3. 用途ごとの入口。Pi5 API が使う本システム用 endpoint、私用 UI/API、実験用 API を分ける。

## Requirements

### Functional Requirements

DGX Spark 上で、本システム用の OpenAI 互換 API を提供する。最低限、現行 Pi5 API が期待する `/healthz` と `/v1/chat/completions` に対応する。現行の写真持出 VLM が継続する場合は、画像付き `messages[].content` の payload 形にも対応する。

Pi5 API の `GET /api/system/local-llm/status` と `POST /api/system/local-llm/chat/completions` は、DGX Spark 切替後も同じ管理境界を維持する。利用者は `ADMIN` / `MANAGER` のみで、キオスク利用者や外部公開は前提にしない。

`LOCAL_LLM_RUNTIME_MODE=on_demand` を維持する場合、DGX Spark 側に `/start` と `/stop` 相当の制御入口を用意する。常駐運用へ切り替える場合は、その理由と性能、発熱、他用途への影響を ADR または本 ExecPlan の Decision Log に残す。

### Security and Confidentiality Requirements

本システム、私用、実験用途の間で、プロンプト、応答、アップロード資料、RAG データ、ベクトル DB、ログ、API キー、トークンを混ぜない。Docker コンテナを分けるだけではなく、用途領域ごとに Linux user、Compose project、Docker network、volume、secrets、ログ保存先、外部入口を分ける。

Docker の `docker` グループは実質 root 相当の強い権限を持つ。完全な機密境界として Docker だけに頼らない。単一所有者の自宅/場内運用としては現実的な分離を目指すが、他者管理データや高機密データを扱う場合は VM、別ホスト、または暗号化ストレージを検討する。

API キーやトークンは用途ごとに分ける。NVIDIA NGC API key、Hugging Face token、Pi5 用 `LOCAL_LLM_SHARED_TOKEN`、私用 UI 用 token は同じ値にしない。共有トークンはログ、メトリクス、Git、スクリーンショットに出さない。

### Performance Requirements

DGX Spark 公式の最適化経路を優先する。ホスト OS に CUDA、PyTorch、vLLM、TensorRT-LLM を手作業で直接導入するのではなく、まず NGC または NVIDIA が DGX Spark 向けに案内するコンテナを使う。コンテナタグは業務用途で `latest` を避け、検証済みタグを固定する。

コンテナ分離、Docker network 分離、Linux user 分離は通常の推論性能に大きな影響を与えない。性能を落としやすいのは、同時実行によるメモリ/CPU/GPU 競合、モデル重みの重複ロード、不要なログ肥大化、重い UI/DB を同じタイミングで動かすことである。

巨大 LocalLLM のモデル重みは、ストレージ効率のため共有可能資産として扱う。ただし、共有モデルを使う場合でも、API 入口、会話履歴、RAG、ログ、アップロード資料は用途ごとに分ける。必要に応じて「1モデル・多入口・多保存先」構成にする。

### Storage Requirements

DGX Spark 内蔵ストレージは 1TB である。DGX Spark を長期保管庫ではなく高速な作業台として扱う。長期保存、成果物、バックアップ、アーカイブ済みデータはクラウド、NAS、外部ストレージへ逃がす。ただし、機密データをクラウドへ出す場合は、保存先、暗号化、アクセス権、同期対象を用途ごとに分ける。

ローカルに置くのは、実行中ジョブの作業領域、頻繁に読むモデル、推論時の一時ファイル、低レイテンシが必要なデータに限定する。Docker image、Hugging Face cache、NGC cache、pip/npm/apt cache、ログ、古い実験成果物は定期的に棚卸しする。

## Scope

### In Scope

この計画は、DGX Spark 初回セットアップ後の標準検証、用途分離設計、本システム用 LocalLLM の DGX Spark 移行、巨大モデルの共有方針、ストレージ運用、クラウド/外部保存方針、Pi5 upstream 切替手順、検証基準を扱う。

### Out of Scope

この計画では、DGX Spark の購入手続き、物理設置の詳細、NVIDIA アカウント作成、具体的なクラウドプロバイダ契約、私用データの内容、業務外アプリケーションの詳細実装は扱わない。必要になった時点で、別 Runbook または別 ExecPlan を作る。

## Reference Information

公式情報は常に優先する。特に次を正本として参照する。

- NVIDIA DGX Spark User Guide: [https://docs.nvidia.com/dgx/dgx-spark/](https://docs.nvidia.com/dgx/dgx-spark/)
- Initial Setup - First Boot: [https://docs.nvidia.com/dgx/dgx-spark/first-boot.html](https://docs.nvidia.com/dgx/dgx-spark/first-boot.html)
- Hardware Overview: [https://docs.nvidia.com/dgx/dgx-spark/hardware.html](https://docs.nvidia.com/dgx/dgx-spark/hardware.html)
- System Overview: [https://docs.nvidia.com/dgx/dgx-spark/system-overview.html](https://docs.nvidia.com/dgx/dgx-spark/system-overview.html)
- NVIDIA Container Runtime for Docker: [https://docs.nvidia.com/dgx/dgx-spark/nvidia-container-runtime-for-docker.html](https://docs.nvidia.com/dgx/dgx-spark/nvidia-container-runtime-for-docker.html)
- DGX Spark Porting Guide - Software Stack: [https://docs.nvidia.com/dgx/dgx-spark-porting-guide/porting/software-requirements.html](https://docs.nvidia.com/dgx/dgx-spark-porting-guide/porting/software-requirements.html)
- DGX Spark practical playbooks: [https://build.nvidia.com/spark](https://build.nvidia.com/spark)

ユーザー事例、フォーラム、ブログ、LLM 回答は補助情報として扱う。公式と矛盾する場合は公式を優先し、実機で確認する。

## Target Architecture

DGX Spark のホスト OS はできるだけ標準状態を維持する。ホストに直接多数の Python package や CUDA 関連を入れず、AI 実行環境は Docker / NVIDIA Container Runtime 上に置く。

論理構成は次を目標にする。


| 領域                 | 目的              | 分離するもの                                                  | 共有してよいもの             |
| ------------------ | --------------- | ------------------------------------------------------- | -------------------- |
| `system-prod`      | 本システム用 LocalLLM | Pi5 用 token、業務ログ、業務 RAG、アップロード資料、Compose network、API 入口 | 公式コンテナ image、巨大モデル重み |
| `private-personal` | 個人用途            | 個人データ、個人ログ、個人 UI、個人 token、個人 RAG                        | 公式コンテナ image、公開モデル重み |
| `lab-experiments`  | 検証・破壊可能環境       | 実験ログ、検証データ、試験用 token、試験用 network                        | 公式コンテナ image、検証用モデル  |


この表の「共有してよいもの」は、読み取り専用または明確に管理された共有を前提にする。共有ディレクトリを雑に全コンテナへ bind mount しない。

## Directory and Account Model

初期案として、DGX Spark 上に次のような領域を作る。ただし、実際のパスは初回セットアップ後のユーザー名、ディスク構成、バックアップ方針に合わせて調整する。


| 用途領域  | Linux user 案                | ディレクトリ案                     | 備考                                                 |
| ----- | --------------------------- | --------------------------- | -------------------------------------------------- |
| 本システム | `dgx-system` または `localllm` | `/srv/dgx/system-prod`      | Pi5 API からの upstream。最優先で安定運用する。                   |
| 私用    | `dgx-private`               | `/srv/dgx/private-personal` | 業務データを一切 mount しない。                                |
| 実験    | `dgx-lab`                   | `/srv/dgx/lab-experiments`  | 破壊可能。新しい vLLM / NIM / SGLang / ComfyUI などはここで先に試す。 |
| 共有モデル | root 管理または専用 group          | `/srv/dgx/shared-models`    | 読み取り中心。用途別ログや RAG は置かない。                           |


`docker` グループに誰を入れるかは慎重に決める。便利さを優先して全ユーザーを `docker` グループに入れると、分離の意味が弱くなる。最初は運用者が `sudo docker` で管理し、必要になったら用途別ユーザーの権限を調整する。

## Network and Access Model

本システム用 LocalLLM は、現行 Ubuntu PC と同じく Tailscale 経由を基本にする。Pi5 の `tag:server` から DGX Spark の本システム用入口だけに到達できるようにする。私用 UI や実験 API は Pi5 から見えなくてよい。

DGX Spark 上の reverse proxy または nginx では、用途ごとに入口を分ける。


| 入口                      | 用途        | 認証                                    | 公開範囲                   |
| ----------------------- | --------- | ------------------------------------- | ---------------------- |
| `system-prod-local-llm` | Pi5 API 用 | `X-LLM-Token` / runtime control token | Pi5 / Tailscale ACL のみ |
| `private-ui`            | 私用 Web UI | 個人認証                                  | 自分の端末のみ                |
| `lab-api`               | 実験 API    | 短命 token                              | 限定端末のみ                 |


本システム用入口は現行 Pi5 API の期待に合わせ、`/healthz`、`/v1/chat/completions`、必要なら `/start`、`/stop` を提供する。

## Model Sharing Policy

巨大な LocalLLM は 1 個を兼用する方が効率的である。ただし「モデル重みの共有」と「運用データの共有」は別である。

共有してよいものは、モデル重み、ベースコンテナ image、CUDA/NVIDIA 実行基盤である。共有してはいけないものは、プロンプト、応答ログ、会話履歴、添付資料、RAG インデックス、ベクトル DB、業務ファイル、API キー、トークンである。

目標構成は「1モデル・多入口・多保存先」である。たとえば同じ巨大モデル重みを使っても、本システム用 API、私用 UI、実験 API は別プロセスまたは別 service とし、ログ保存先や RAG 接続先を分ける。性能上どうしても単一推論プロセスを共有する場合でも、入口ごとに token、rate limit、ログポリシーを分け、プロンプト本文を中央ログに出さない。

## Storage Policy

DGX Spark の 1TB ストレージは、モデル、コンテナ image、作業データ、ログですぐに圧迫される可能性がある。DGX Spark を長期保管庫にしない。

ローカルに置くものは、実行中ジョブの作業ディレクトリ、頻繁に読むモデル、低レイテンシが必要な推論データ、短期ログである。クラウドや外部ストレージへ逃がすものは、成果物、長期バックアップ、アーカイブ済みデータ、再取得できる中間生成物である。

クラウドへ出す場合は、用途ごとにバケット、フォルダ、暗号鍵、アクセス権を分ける。業務データと私用データを同じクラウド同期先に置かない。生プロンプトや生ログは外部保存前に必要性を判断し、原則として要約やメタデータだけを残す。

## Phased Plan of Work

### Phase 0: 物理設置と公式初回セットアップ

目的は、DGX Spark を公式が想定する標準状態で起動し、途中でホスト OS を汚さないことである。付属電源アダプタを使用し、できれば有線 LAN、HDMI、USB キーボード/マウスで初回セットアップする。初期アップデート中は電源断しない。セットアップ完了後に OS、ネットワーク、SSH、DGX Dashboard の状態を確認する。

Acceptance: DGX Spark にローカルまたは SSH でログインでき、公式アップデートが完了し、再起動後も安定して入れる。

### Phase 1: 公式 GPU コンテナ検証

目的は、NVIDIA Container Runtime が正しく機能し、コンテナ内から GPU が見えることを確認することである。公式案内に従い、`nvidia-smi`、`docker --version`、`nvidia-ctk --version`、`docker run --rm --gpus=all nvcr.io/nvidia/cuda:13.0.1-devel-ubuntu24.04 nvidia-smi` などを実行する。

Acceptance: ホストとコンテナの両方で GPU 情報が確認できる。`nvidia-smi` のメモリ表示が通常 RTX と違う場合は、DGX Spark の unified memory 仕様として記録する。

### Phase 2: 用途分離の土台作成

目的は、DGX Spark に複数用途を載せる前に、混流防止の枠を作ることである。`system-prod`、`private-personal`、`lab-experiments` のディレクトリ、Compose project、Docker network、secrets、ログ保存先を分ける。最初から全部を起動する必要はない。まず空の領域と命名ルールを作り、共有モデル置き場の扱いを決める。

Acceptance: 各用途の Compose file、`.env`、volume、network が分かれている。業務データのパスが私用/実験用 Compose に mount されていない。

### Phase 3: `lab` で軽量 LLM 疎通

目的は、本システムに影響を与えずに DGX Spark 上の推論スタックを試すことである。NVIDIA 公式 playbook または NGC コンテナを優先し、軽量モデルで OpenAI 互換 API を起動する。いきなり巨大モデルを入れない。LAN 内または Tailscale 経由で `/v1/chat/completions` を叩き、温度、電力、応答時間、ログ量を記録する。

Acceptance: `lab` の API が軽量モデルで応答する。`system-prod` のディレクトリ、ログ、secrets に触れていないことを確認できる。

### Phase 4: 本システム用 LocalLLM を DGX Spark へ構築

目的は、現行 Ubuntu PC の役割を DGX Spark に再現することである。`system-prod` 領域に、本システム専用の OpenAI 互換 API、`/healthz`、認証プロキシ、必要なら `/start` `/stop` 制御を置く。現行 `local-llm-tailscale-sidecar.md` の思想を引き継ぎつつ、DGX Spark 公式コンテナと ARM64 対応を確認する。

Acceptance: Pi5 から DGX Spark の `system-prod` 入口に到達できる。未認証の推論 API は拒否される。認証あり `/healthz` または status 相当が通る。軽量または予定モデルで chat completions が応答する。

### Phase 5: Pi5 upstream 切替

目的は、Pi5 API の LocalLLM 接続先を Ubuntu PC から DGX Spark へ安全に切り替えることである。変更対象は原則として Ansible inventory / vault / `docker.env.j2` 経路であり、Pi5 ホストの `apps/api/.env` を手で直す運用にはしない。切替前に Ubuntu PC を rollback 先として残す。

Acceptance: Pi5 API コンテナ内で `LOCAL_LLM_BASE_URL` が DGX Spark を指す。`GET /api/system/local-llm/status` が `configured=true` かつ `health.ok=true` を返す。管理チャットが DGX 経路で成功し、`photo_label` と `document_summary` の route が意図どおり解決される。最終的に Ansible 正規経路の反映と `./scripts/deploy/verify-phase12-real.sh` PASS まで完了する。

### Phase 6: 私用・実験用途の追加

目的は、本システム用 LocalLLM の安定後に、私用と実験用の利用を安全に追加することである。私用 UI、実験 API、ComfyUI、RAG、エージェント実験などは、それぞれの領域に閉じ込める。本システム用の token、ログ、データ、RAG を mount しない。

Acceptance: 私用/実験用途の起動中でも、本システム用 LocalLLM の status と代表推論が通る。私用/実験側から `system-prod` の secrets やデータパスにアクセスできない。

### Phase 7: 運用固定化

目的は、DGX Spark を長期運用できる状態にすることである。更新手順、バックアップ、ログローテーション、モデル棚卸し、クラウド/外部保存、トークンローテーション、障害時 rollback を Runbook に反映する。必要に応じて Ubuntu PC LocalLLM Runbook を DGX Spark 版へ分岐または更新する。

Acceptance: 運用者が Runbook だけで、起動確認、推論確認、停止、ログ確認、トークンローテーション、Pi5 rollback を実施できる。

## Progress Management Table


| Phase              | 状態  | 成果物                                    | 完了条件                                      | 次アクション                 |
| ------------------ | --- | -------------------------------------- | ----------------------------------------- | ---------------------- |
| 0. 初回セットアップ        | 完了  | DGX Spark 標準 OS 起動、SSH 鍵登録、firmware 更新 | 公式アップデート完了、SSH/ローカルログイン可、`fwupdmgr` 更新なし  | 完了。次は用途分離              |
| 1. GPU コンテナ検証      | 完了  | GPU コンテナ疎通ログ                           | `docker run --gpus=all ... nvidia-smi` 成功 | 完了。次は軽量 LLM 候補選定       |
| 2. 用途分離土台          | 完了  | 用途別 directory / network / secrets 方針   | 業務・私用・実験の mount と token が分離               | 完了。次は `lab` LLM        |
| 3. lab LLM         | 完了  | 軽量 LLM API                             | `/v1/chat/completions` 成功                 | 手順固定化または本番候補選定へ        |
| 4. system-prod LLM | 完了  | Pi5 用 DGX Spark LocalLLM               | `/healthz`、認証、chat の実配線成功                 | Phase 5 の正規 deploy へ進む |
| 5. Pi5 切替          | 進行中 | Pi5 例外反映済み / Ansible 正規化待ち             | status/chat/写真VLM/要領書/Phase12 成功          | Ansible 正規経路で収束、代表機能検証 |
| 6. 私用・実験追加         | 未着手 | private/lab サービス                       | system-prod とデータ混流なし                      | 追加用途の優先順位決定            |
| 7. 運用固定化           | 未着手 | Runbook / ADR / rollback 手順            | 第三者が手順どおり運用可能                             | docs 更新                |


## Requirements Traceability


| 要件                | 対応 Phase   | 検証方法                                          |
| ----------------- | ---------- | --------------------------------------------- |
| NVIDIA 公式スタック優先   | 0, 1, 3    | 公式コンテナで GPU 疎通、NGC/公式 playbook の利用記録          |
| 本システム LocalLLM 移行 | 4, 5       | Pi5 status/chat、写真持出 VLM、要領書要約、Phase12        |
| 気密性               | 2, 6, 7    | 用途別 token / volume / network / log、mount レビュー |
| 性能                | 1, 3, 4, 6 | 応答時間、温度、同時利用時の影響、モデルロード挙動                     |
| ストレージ効率           | 2, 4, 7    | モデル共有方針、cache/log 棚卸し、外部保存方針                  |
| rollback          | 5, 7       | Ubuntu PC upstream へ戻す手順が残っていること              |


## Concrete Steps

最初の実作業は、DGX Spark の初回セットアップと公式検証である。作業者は NVIDIA 公式 User Guide の Initial Setup を開き、付属電源、有線 LAN または安定 Wi-Fi、HDMI、USB キーボード/マウスを用意する。初回更新中に電源を切らない。

初回セットアップ完了後、DGX Spark 上で次を確認する。コマンドは実機で実行し、結果はこの ExecPlan の `Surprises & Discoveries` または別 Runbook に記録する。

```
uname -a
nvidia-smi
docker --version
nvidia-ctk --version
docker run --rm --gpus=all nvcr.io/nvidia/cuda:13.0.1-devel-ubuntu24.04 nvidia-smi
```

次に `lab` 領域で軽量モデルを試す。最初から巨大モデルを導入しない。公式 `build.nvidia.com/spark` の playbook を確認し、DGX Spark 対応の vLLM、NIM、llama.cpp、SGLang などから候補を選ぶ。候補を選んだら、理由と採否を `Decision Log` に残す。

本システム用に進む前に、DGX Spark から見たネットワーク、Pi5 から見た Tailscale 到達性、token 管理、`/healthz` と `/v1/chat/completions` の互換性を確認する。Pi5 の Ansible 変更は、必ず `infrastructure/ansible/inventory.yml`、`infrastructure/ansible/templates/docker.env.j2`、vault の正規経路で行う。

## Validation and Acceptance

DGX Spark 基盤の受け入れ条件は、公式 GPU コンテナが成功し、ホスト OS を大きく改造していないことである。業務 LocalLLM の受け入れ条件は、Pi5 API から DGX Spark upstream に対して status と chat が成功し、写真持出 VLM と要領書要約の代表ケースが動作し、Phase12 が成功することである。

気密性の受け入れ条件は、`system-prod` の token、業務ログ、業務 RAG、業務 upload path が、`private-personal` と `lab-experiments` の Compose file に mount されていないことである。私用/実験サービスを起動しても、本システム用入口以外から業務データを読めないことを確認する。

性能の受け入れ条件は、DGX Spark 上で本システム用 LocalLLM の代表応答時間が運用上許容でき、私用/実験サービスを停止すれば本システム用推論が安定することである。複数用途の同時実行を許可するかは、実測後に決める。

ストレージの受け入れ条件は、モデル、Docker image、cache、logs、outputs の置き場所と削除/退避方針が明文化されていることである。1TB を超えないよう、長期保存はクラウド、NAS、外部ストレージへ逃がす。

## Idempotence and Recovery

初回セットアップと公式アップデートは中断しない。設定作業は、ホスト OS 直編集よりも Compose file、env file、Runbook に寄せる。DGX Spark 上の用途領域作成は、再実行しても既存データを上書きしない手順にする。

Pi5 upstream 切替時は、Ubuntu PC の現行 LocalLLM をすぐ消さない。DGX Spark への切替に失敗した場合は、Ansible inventory / vault の `LOCAL_LLM_BASE_URL` と制御 URL を Ubuntu PC 側へ戻し、Pi5 API コンテナを再作成する。rollback 手順は切替前に Runbook へ書く。

秘密情報を誤ってログやチャットへ出した場合は、当該 token を即ローテーションする。NVIDIA NGC API key、Hugging Face token、Pi5 `LOCAL_LLM_SHARED_TOKEN`、runtime control token は別々に扱い、流用しない。

## Open Questions

- `Qwen3.5-35B-A3B` GGUF の初回 context length、KV cache 型、memory 上限、thinking mode、画像入力時の memory 余裕をどこに設定するか。
- 現行 `Qwen3.5-35B` の VLM 化が品質または安定性で不足した場合に限り、Spark 上の中間到達点としてどの VLM（例: `Qwen2.5-VL` 系）を採るか。
- GB10 対応済み SGLang image/build の調査は継続するか、Qwen3.5 GGUF ベースライン後に戻るか。
- `on_demand` を維持するか、DGX Spark の余力を前提に本システム用 LLM を常駐させるか。私用・実験用途との競合実測後に決める。
- 巨大モデルを単一プロセスで共有するか、同じ重みを使う用途別プロセスに分けるか。気密性とメモリ効率の実測後に決める。
- 1TB ストレージのうち、共有モデル、Docker image、作業領域、ログにどれだけ割り当てるか。

## Immediate Next Steps

1. **Repository と Pi5 の整合**: **(2026-04-27 反映済み)** 正規 `manage-app-configs` + 必要な `**apps/api/src` / Ansible 定義の同期** + Pi5 上 `api` 再ビルドで、`LOCAL_LLM_RUNTIME_READY_TIMEOUT_MS=900000` 等を本番に収束。以後の恒久運用は **リモートが `main` 相当まで追従**したうえで `update-all-clients` 等の標準手順に戻すのが望ましい。手動 `rsync` 経路は **ドリフト** しうる点に注意。
2. **blue 本番採用の判断**: **方針として** `ACTIVE_LLM_BACKEND=blue`（`Qwen3.6-27B` NVFP4 + vLLM）を**本番既定**（ADR の「正」）に据えるかを決める。**実機が既に blue か**は別問題で、**`POST /start` の `backend` と `GET /v1/models` の `root`** で確認する。判断材料は cold start（実測 ~12 分規模）・**リソース占有**（同一ホスト上の他用途）・VLM/画像経路の運用観測。結論は **ADR / Runbook** に残す。検証中は `BLUE_LLM_RUNTIME_KEEP_WARM=true` で `/stop` no-op により cold start 反復を避けられる（本番常駐方針とは別。恒久的には keep-warm の是非を決める）。
3. **VLM/画像 400 の扱い残り**: Pi5 API [`RoutedVisionCompletionAdapter`](../../apps/api/src/services/inference/adapters/routed-vision-completion.adapter.ts) は、画像ロード/デコード系 **400** 時に **JPEG 再エンコードで 1 回だけ再送**する（[`vision-vlm-fallback.util.ts`](../../apps/api/src/services/inference/adapters/vision-vlm-fallback.util.ts)）。根本原因の切り分けは引き続き DGX `docker logs` / 最小再現。Runbook に運用メモあり。
4. **運用観測**: `component: inference` / `localLlmRuntimeControl`、secret drift（[Runbook 既出](./../runbooks/dgx-system-prod-local-llm.md)）の spot check。DGX 再起動後は `38081/39090/38100` の listen を確認（systemd または `@reboot` 前提）。
5. **任意**: GB10 向け SGLang image/build の再調査、localhost gateway と nginx 統合の是非は、blue/green 方針が固まったあとに優先度を再評価する。

