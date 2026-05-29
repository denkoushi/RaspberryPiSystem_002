---
title: KB-365 DGXリソース Phase3・補助ランタイム起停・ワークロード自動調停
tags: [DGX, DGX_RESOURCE, Pi5, ComfyUI, experiment-lab, 運用]
audience: [開発者, 運用者]
last-verified: 2026-05-25
category: knowledge-base
---

# KB-365: DGXリソース Phase3・補助ランタイム起停・ワークロード自動調停

## Context

`/admin/tools/dgx-resource` の **Control Target を拡張**し、`system-prod-gateway` 以外にも **Pi5 から POST できる補助起停**（私用 ComfyUI・論理ターゲット `experiment-lab`）を追加した。あわせて **`SET_POLICY` に `applyWorkloadChanges`** を用意し、GUI のチェック有効時に **業務優先 / 実験優先へ切り替える前に**自動で停止試行する（GPU 競合緩和。KB-364 系）。

## Pi5 メインAI: 単一キュー・用途別停止・実験優先時の gateway 除外（2026-05）

- **単一キュー**: メインAI相当の制御 POST（`HttpOnDemandLocalLlmRuntimeController` の `/start`・`/stop` と `executeGatewayRuntimeStartStop`）を **`enqueueMainLocalLlmRuntimeControl`** で直列化（`apps/api/src/services/inference/runtime/local-llm-runtime-command-queue.ts`）。推論経路と DGX 管理経路の競合を抑える。
- **停止抑止**: `shouldSuppressLocalLlmRuntimeStop` — `photo_label` / `document_summary` / `admin_console_chat` / **`stackchan_chat`** / **`agent_container_task`** は **常に** release 時の `/stop` を抑止。それ以外の用途（型を拡張した将来）では **warm 窓**のみ抑止。
- **ポリシー調停**: `experiment_first` + `applyWorkloadChanges` では **private-comfyui のみ**自動停止。**`business_first`** では **`experiment-lab` → `agent-container` → `private-comfyui`** を順に停止試行。**`private_ok`** では **`experiment-lab` → `agent-container`** に加え、**`system-prod-gateway` を keep_warm 上書きで強制停止**し、Comfy 向けに Spark メモリを空ける。`planWorkloadAdjustmentsBeforePolicyChange`（`dgx-resource.policy-arbitrator.ts`）。

### 本番反映（2026-05-10・Pi5 メインAI 単一キュー確定） {#production-2026-05-10-dgx-main-llm-single-queue}

- **ブランチ**: **`feature/dgx-single-queue-stop-policy`**（**`main` マージ後は `origin/main` HEAD** をデプロイ引数の正本とする）。
- **代表コミット**: **`23bce3bf`**（`fix(api): serialize DGX runtime control`）·**`4d658897`**（`test(api): align local-llm on_demand route expectations`・CI **run `25617712720` success**）。
- **ホスト**: **`raspberrypi5` のみ**（**`--limit raspberrypi5`・1 台**）。Pi4／Pi3 play **`skipping: no hosts matched`**（**Pi3 専用手順は対象外・未実施で正**）。
- **標準**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh feature/dgx-single-queue-stop-policy infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`。
- **Detach Run ID**: **`20260510-114418-29512`**（**`PLAY RECAP` `ok=134` `changed=4` `failed=0` / `unreachable=0`**·リモート **`exit` `0`**·ローカル **`--follow` 約 559s**·**`Git: changed`**·**Docker compose 再起動 `changed`**·**`Run prisma migrate deploy` / `prisma migrate status` `ok`**）。
- **実機**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（**約 130s**・Tailscale **`100.106.158.2`**）。**`deploy-status`（Pi4×4）** PASS / **`auto-tuning scheduler` ログ** 件数=1。
- **仕様確定（本番で有効化された挙動）**:
  - **単一キュー**: `enqueueMainLocalLlmRuntimeControl` が **推論 on_demand の `HttpOnDemandLocalLlmRuntimeController` `/start`・`/stop`** と **`dgx-resource.gateway-runtime.executor` の `executeGatewayRuntimeStartStop`**（`system-prod-gateway` の通常停止 / 強制停止を含む）を **同居プロセス内で直列実行**（競合する二重 POST の抑止）。
  - **用途別 `/stop` 抑止**: `shouldSuppressLocalLlmRuntimeStop` — **`photo_label`** / **`document_summary`** / **`admin_console_chat`** / **`stackchan_chat`** / **`agent_container_task`** は **参照カウント 0 でも release で `/stop` しない**。
  - **実験優先の事前停止**: **`experiment_first` + `applyWorkloadChanges: true`** で **`private-comfyui` のみ**自動 stop 試行。**`system-prod-gateway` の自動 stop は撤去**済み（実装: `planWorkloadAdjustmentsBeforePolicyChange`）。
- **ローカル開発の知見**: 先行実装で **`src/routes/system/__tests__/local-llm.test.ts`** が旧前提（admin が常に `/stop` する）のまま残り **4 件 FAIL** → **`4d658897`** で期待値を **抑止後の契約**へ合わせた。
- **トラブルシュート**:
  - **キュー待ちが異常に長い** → **同時多発の `/start`/`/stop`** を疑い、ログ **`main_llm_control_queue_*`** を確認。Pi5 **`api` ref** が本節の **`23bce3bf` 系**か。
  - **実験優先へ切替えたのに業務 gateway が止まる** → arbitrator 以前のイメージまたは **手動 `EXECUTE_TARGET_ACTION`** の痕跡。**Detach** と **コンテナ再作成**を確認。
  - **実機 Phase12 のみ `deploy-status` FAIL** → [KB-369](./KB-369-leader-order-board-api-internal-latency.md)·Pi5 **`config/deploy-status.json`**・他ホスト連続デプロイ後の **再実行**。
- **参照**: [deployment.md §DGX 単一キュー 2026-05-10](../guides/deployment.md#dgx-main-llm-single-queue-stop-policy-2026-05-10)·[dgx-system-prod-local-llm.md §管理コンソール](../runbooks/dgx-system-prod-local-llm.md#管理コンソール-dgx-リソースpi5-api-経由)·[`EXEC_PLAN.md`](../../EXEC_PLAN.md)。

### 本番反映（2026-05-10・StackChan Pi5 API チャット） {#production-2026-05-10-stackchan-pi5-api-chat}

- **ブランチ（先行反映時）**: **`feat/stackchan-interactive-chat-api`**。**代表コミット（記録時点の tip）**: **`81fe4d2a`**（`feat(api): add StackChan chat API`）。**`main` squash マージ後**は **`origin/main` HEAD** をデプロイ引数の正本とする。
- **ホスト**: **`raspberrypi5` のみ**（**`--limit raspberrypi5`**）。Pi4／Pi3 play **`skipping: no hosts matched`**。**Pi3**: playbook **未適用**（リソース僅少・**専用手順はこの変更では実行しない**）。
- **標準**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh feat/stackchan-interactive-chat-api infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`。
- **Detach Run ID**: **`20260510-134157-20990`**（**`PLAY RECAP` `ok=134` `changed=4` `failed=0` / `unreachable=0`**·リモート **`exit` `0`**·ローカル **`--follow` 約 650s**·**`Git: changed`**·**Docker compose 再起動 `changed`**·**`prisma migrate deploy` / `status` `ok`**）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（**約 54s**・Tailscale **Pi5 `100.106.158.2`**）。
- **実機（追加スモーク）**: **未認証** `POST https://100.106.158.2/api/system/stackchan/chat` → **HTTP `401`**（ルート登録と認可ゲートの確認。**運用 JWT はログに残さない**）。
- **仕様（runtime 観点）**:
  - **用途 ID**: **`stackchan_chat`** を **`ProviderLocalLlmRuntimeController`** が **admin provider と同一**に解決（**`resolveAdminProvider`**・ready probe に **`stackchan_chat` を admin モデルで登録**）。
  - **単一キュー優先度**: **`MAIN_LOCAL_LLM_RUNTIME_CONTROL_PRIORITIES.agent`**（**`admin_console_chat` と同層**・業務 `business` より後）。
  - **`LOCAL_LLM_ALWAYS_KEEP_WARM_USE_CASES`**: **`stackchan_chat` を追加**済み → **`release` でも用途別 `/stop` 抑止**（admin と同系）。
  - **詳説 system**: **`mergeStackChanDetailSystemPrompt`** が **既存 `system` に詳説ブロックが含まれる場合は二重追記しない**（トークン肥大の抑制）。
- **トラブルシュート**:
  - **ルートが無い／404** → Pi5 **`api` の Git ref** が **`81fe4d2a` 以降（またはマージ後 `main`）**か。**Detach `Git: changed`** と **Docker `api` 再作成**を確認。
  - **`503` LocalLLM** → **`LOCAL_LLM_*`** 設定と **admin チャット**（`POST /api/system/local-llm/chat/completions`）の可否を先に切り分け。
  - **キュー待ちのみ増加** → **`main_llm_control_queue_wait`** と **`useCase`**（`stackchan_chat` vs 業務）をログで確認。
- **参照**: [deployment.md §StackChan 本番](../guides/deployment.md#stackchan-production-2026-05-10)·[dgx-system-prod-local-llm.md §管理コンソール](../runbooks/dgx-system-prod-local-llm.md#管理コンソール-dgx-リソースpi5-api-経由)·[`EXEC_PLAN.md`](../../EXEC_PLAN.md)。

### 私用 Pi5 stackchan-bridge と職場 Pi5 API の境界（2026-05-10 ドキュメント正本） {#private-pi5-stackchan-bridge-boundary-2026-05-10}

- **2系統**:
  - **Private path**: StackChan / 私用デバイス → **私用 Pi5** の `stackchan-bridge`（[`dgx_runtime_client.py`](../../scripts/private-pi5-stackchan-bridge/dgx_runtime_client.py) の **`DgxUpstreamClient`** + [`stackchan_chat_core.py`](../../scripts/private-pi5-stackchan-bridge/stackchan_chat_core.py) の **`ChatCompletionWorkflow`**）→ **DGX Spark**。**職場 Pi5 API・JWT・`enqueueMainLocalLlmRuntimeControl` 単一キューを通さない**。
  - **Work path**（上記「StackChan Pi5 API チャット」項）: クライアント → **`POST /api/system/stackchan/chat`（職場 Pi5）** → 同一 **`stackchan_chat`** 用途で **admin と同系 on_demand**・**keep-warm `/stop` 抑止**（`local-llm-runtime-schedule.policy.ts`）。
- **競合注意**: private bridge が独自に **`POST /start`** しても、職場側キューとは **別プロセス**だが **DGX 上の同一 gateway/backend** を触る。`.env` / vault は **私用と職場で混線禁止**。
- **検証**: 開発 Mac から DGX を直叩きした結果と、私用 Pi5 からの結果が **一致しない**ことがある（Tailscale ACL・経路差）。**運用切り分けの正は私用 Pi5 上**の `curl` / bridge。
- **2026-05-10 late の追記（実機経路）**: StackChan 実機は **`192.168.128.124`**、private Pi5 は当日 DHCP で **`192.168.128.113`** を取得したが、StackChan ファームは **旧 bridge IP `192.168.128.112`** を見ていた。DGX upstream 復旧後も `GET /chat?...` に対応する bridge ログが出ないことで **宛先IPミスマッチ**を切り分け、private Pi5 `wlan0` に **`192.168.128.112/24` compatibility alias** を一時追加した直後に **`POST /api/stackchan/chat/simple 200`** を確認した。**教訓**: StackChan の `/chat` が `200` でも **bridge ログが無い**なら、upstream より先に **bridge URL の IP ドリフト**を疑う。
- **2026-05-10 追記（実装モジュール）**: 入力検証・upstream オーケストレーションは [`stackchan_chat_core.py`](../../scripts/private-pi5-stackchan-bridge/stackchan_chat_core.py)（`ChatCompletionWorkflow`）。HTTP のみ [`bridge_server.py`](../../scripts/private-pi5-stackchan-bridge/bridge_server.py)。**text-only 完了条件**は [stackchan-community-text-only-e2e.md §text-only-done-criteria](../runbooks/stackchan-community-text-only-e2e.md#text-only-done-criteria)。

### 本番反映（2026-05-10・AgentContainer・Pi5 API + Web + DGX gateway） {#production-2026-05-10-dgx-agent-container}

- **ブランチ（先行反映時）**: **`feat/agent-container-control-target`**（実装 tip **`9fd37c0a`**）。**`main` squash（PR [#284](https://github.com/denkoushi/RaspberryPiSystem_002/pull/284)）**: **`14f105c1`**。**デプロイ ref の正本**は **`origin/main` HEAD**（本項記録時点では **`14f105c1`** と一致）。
- **ホスト（順序固定・Ansible スコープ外は SSH のみ）**:
  - **① `raspberrypi5` のみ** — `./scripts/update-all-clients.sh … --limit raspberrypi5 --detach --follow`
  - **② DGX（Tailscale 例 `100.118.82.72`・ユーザー `ubudgxkoushi`）** — **`scp`** で **`gateway-server.py`** を **`/srv/dgx/system-prod/bin/`** へ配置し **ゲートウェイ再起動**（詳細は [deployment.md §AgentContainer](../guides/deployment.md#dgx-agent-container-control-target-2026-05-10)）。
  - **Pi4／Pi3** — 本変更の **`update-all-clients.sh`** では **`skipping: no hosts matched`**。**Pi3** は **個体への playbook 適用なし**（Phase12 で **services 疎通のみ**）。
- **Detach Run ID（Pi5）**: **`20260510-125420-15123`**（**`PLAY RECAP` `ok=139` `changed=8` `failed=0` / `unreachable=0`**·リモート **`exit` `0`**·ローカル **`--follow` 約 669s**·**`Git: changed`**·**Docker / api・web 再作成あり**·**`prisma migrate deploy` / `status` ok**）。
- **実機検証**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（本記録 **約 57s**・Pi5 **`100.106.158.2`**）。
- **仕様（本番で有効になる追加契約）**:
  - **Control Target `agent-container`**: `overview.targets[]` に **`experiment-lab` の直後**で登場。**`DGX_RESOURCE_AGENT_CONTAINER_RUNTIME_START_URL` / `_STOP_URL` が両方設定**されているときのみ **`start`/`stop`** capability。**`DGX_RESOURCE_AGENT_CONTAINER_HEALTH_URL`** は任意（未設定時は状態 **`unknown`** になり得るが POST 起停は可）。
  - **単一キュー**: useCase **`agent_container_task`** を **`ProviderLocalLlmRuntimeController`** 経由で **`HttpOnDemandLocalLlmRuntimeController`** に分離。**ready** は **`/v1/models` ではなく**（設定時）**単純 GET ヘルス**（`optionalSimpleHealthProbeUrl`）で待機。
  - **keep-warm**: **`LOCAL_LLM_ALWAYS_KEEP_WARM_USE_CASES`** に **`agent_container_task`** を追加済み（**release でも upstream `/stop` 抑止**）。
  - **調停**: **`business_first` / `private_ok`** で **`agent-container` の stop** を **`experiment-lab` の後**に計画（POST URL が Pi5 に揃っている場合）。
  - **DGX gateway**: **`GET /agent-container/health`**（既定 **`AGENT_CONTAINER_HEALTH_MODE=container`** で **`docker ps`** 相当）· **`POST /agent-container/start|stop`**（**`X-Runtime-Control-Token`**）。
- **知見（DGX・コード反映）**: **`start-gateway-server.sh`** は **既存 PID が生きていると即退出**し **`scp` だけでは新コードが載らない**。**PID を終了し PID ファイルを消してから**スクリプトを再実行する必要がある（**広い `pkill -f` は避ける** · Runbook Phase11 と同趣旨）。
- **知見（ヘルスチェックレース）**: 再起動直後 **`curl 127.0.0.1:38081/healthz`** が一度 **`Connection refused`** になり得る。**短い待機またはループ再試行**で **200** を確認する。
- **トラブルシュート**:
  - **UI に `agent-container` が無い／グリッドだけ古い** → Pi5 **`api`/`web` の ref** と **ブラウザ強制リロード**（[verification-checklist.md](../guides/verification-checklist.md) §6.6.4）。
  - **補助 POST が 502／タイムアウト** → DGX 側 **`./start-agent-container.sh`** / **`./stop-agent-container.sh`**（既定）の **実行ユーザー権限・timeout**（**`PRIVATE_COMFY_CMD_TIMEOUT_SEC`** 系と共用）を確認。
  - **Pi5 側で Agent 用ランタイムが no-op** → **`get-local-llm-runtime-controller.ts`** の解決条件（**start/stop・token・health URL 派生**が **揃わないと controller を組み立てない**）を確認。
- **参照**: [deployment.md §AgentContainer 2026-05-10](../guides/deployment.md#dgx-agent-container-control-target-2026-05-10)·[dgx-system-prod-local-llm.md §AgentContainer 本番反映](../runbooks/dgx-system-prod-local-llm.md)·[`gateway-server.py`](../../scripts/dgx-local-llm-system/gateway-server.py)。

### 本番反映（2026-05-25・`private_ok` 強制停止 `stop-force`） {#production-2026-05-25-dgx-private-ok-stop-force}

- **ブランチ**: **`feat/dgx-resource-strong-private-ok`**（**`main` マージ後は `origin/main` HEAD** をデプロイ引数の正本とする）。
- **代表コミット**: **`7fe1ca15`**（DGX `control-server` + Pi5 planner/UI）·**`2d91d032`**（`stop_force` を公開契約から分離・CI **`26386720859` success**）·**gateway 転送**（本番窗口で `gateway-server.py` に **`/stop-force` プロキシ**を追加）。
- **ホスト（順序固定）**:
  - **① `raspberrypi5` のみ** — `./scripts/update-all-clients.sh … --limit raspberrypi5 --detach --follow`
  - **② DGX（`100.118.82.72` / `ubudgxkoushi`）** — **`control-server.py`** の **`scp` + PID ガード再起動** → 続けて **`gateway-server.py`**（**`/stop-force` 404 回避のため同窗口で必須**）
  - **Pi4／Pi3** — play **`skipping: no hosts matched`**（**Pi3 専用手順は未実施で正**）
- **Detach Run ID（Pi5）**: **`20260525-162034-25035`**（**`PLAY RECAP` `ok=134` `changed=4` `failed=0` / `unreachable=0`**·リモート **`exit` `0`**·ローカル **`--follow` 約 938s**·**`Git: changed`**·**Docker compose 再起動 `changed`**）。
- **実機**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（**約 68s**・Tailscale **`100.106.158.2`**）。
- **仕様（本番で有効化された挙動）**:
  - **`private_ok` + `applyWorkloadChanges: true`**: 調停計画に **`system-prod-gateway` + `stop_force`** を追加（`planWorkloadAdjustmentsBeforePolicyChange`）。**experiment-lab / agent-container の stop 試行の後**に実行。
  - **強制停止の契約分離**: **`POST /stop-force`**（DGX control-server）と **通常 `POST /stop`**（keep_warm 尊重）を分離。**Pi5 の `EXECUTE_TARGET_ACTION` には `stop_force` を露出しない**（内部オーケストレーション専用）。
  - **到達経路**: Pi5 executor は **`LOCAL_LLM_RUNTIME_CONTROL_STOP_URL`（`38081/stop`）から `…/stop-force` を合成**。**gateway が `39090` へ転送**（2026-05-25 本番前は **404** だったため gateway も更新）。
  - **管理 Web**: 私用OK 説明・確認ダイアログに **業務 LLM 強制退避** を明示。
- **知見**:
  - **実装ブランチに gateway 変更が無くても、本番到達には gateway 転送が必要**（inventory の stop URL は **外部入口 `38081`** 固定）。
  - **CI 初回失敗**: `stop_force` が aux executor の `'start'|'stop'` に流れ TypeScript エラー → **`2d91d032`** で内部型 + ガードに分離。
  - **デプロイ中の切り分け**: `control-server` 反映後も **`38081/stop-force` が 404** → gateway 未転送と確定（**403/200 は到達 OK**）。
- **トラブルシュート**:
  - **`private_ok` にしたのに 27B warm が残る** → 上記 3 点（Pi5 ref・control-server `stop-force`・**gateway 404 でないか**）を順に確認。
  - **強制停止だけ 404** → **`gateway-server.py` の `("/start", "/stop", "/stop-force")` 分岐**と **PID ガード再起動**。
  - **UI が旧** → Pi5 **`web` ref** + ブラウザ強制リロード。
- **参照**: [deployment.md §2026-05-25](../guides/deployment.md#dgx-resource-private-ok-strong-stop-force-2026-05-25)·[Runbook §本番反映 2026-05-25](../runbooks/dgx-system-prod-local-llm.md)·[ADR-20260428](../decisions/ADR-20260428-dgx-active-backend-prod-default.md)·[`EXEC_PLAN.md`](../../EXEC_PLAN.md)。
- **運用理解（FAQ 正本・2026-05-25）**: メモリ KPI の意味・27B/35B の関係・業務用途の共有推論・**「切替時にワークロード自動調整」チェック**と運用ガイドの違いは **[KB-366](./KB-366-dgx-spark-operational-understanding.md)** を参照。

## Preconditions

- Pi5 **`apps/api`** が Tailscale（または許可経路）で **DGX 側の軽い HTTP hook（POST）**に到達できること（URL は運用が DGX で用意）。
- Hook は gateway と同様、トークン使用時 **`X-Runtime-Control-Token`** を検証することを推奨。
- `applyWorkloadChanges` は **順次 POST**であり、途中失敗時は **モード変更前にエラー**。一部 POST 済みの可能性は運用側で許容または hook をべき等に。

## ENV（Pi5）

- `DGX_RESOURCE_PRIVATE_COMFYUI_RUNTIME_START_URL` / `_STOP_URL`（/ 任意 `_CONTROL_TOKEN`）
- `DGX_RESOURCE_EXPERIMENT_LAB_RUNTIME_START_URL` / `_STOP_URL`（/ 任意 `_CONTROL_TOKEN`）
- **`DGX_RESOURCE_AGENT_CONTAINER_RUNTIME_START_URL` / `_STOP_URL`（/ 任意 `_CONTROL_TOKEN`）** — Control Target **`agent-container`**（DGX **`gateway-server.py`** の **`/agent-container/start|stop|health`** と対になる Pi5 側 URL）
- （任意）`DGX_RESOURCE_AGENT_CONTAINER_HEALTH_URL` — GET で状態表示・停止後確認に利用（未設定でも POST 起停のみは可）
- （任意）`DGX_RESOURCE_EXPERIMENT_LAB_HEALTH_URL` — GET で状態表示用
- `DGX_RESOURCE_AUX_RUNTIME_REQUEST_TIMEOUT_MS` — 補助 POST タイムアウト（既定 90000）

Ansible は `templates/api.env.j2` / `templates/docker.env.j2` で上記変数を空既定で出力（inventory で上書き）。

## API/UI

- **`EXECUTE_TARGET_ACTION`**: `overview.targets[].capabilities` に `start`/`stop` があるもののみ許可。
- **`SET_POLICY`**: `applyWorkloadChanges: true` のときのみ `dgx-resource.policy-arbitrator` の計画に従って停止試行。**直前モードへ戻す** は `applyWorkloadChanges: false` で呼ぶ（ワークロードは触らない）。
- **業務復帰モデル選択（2026-05-28 実装）**: `private_to_business` / `experiment_to_business` の `PREVIEW_ORCHESTRATION_SCENARIO` と `EXECUTE_ORCHESTRATION_SCENARIO` は任意 `modelProfileId` を受ける。ID は DGX `GET /system/model-profiles` の allowlist 正本で、Pi5 は正本を持たない。`modelProfileId` は `planFingerprint` に含まれ、preview と execute で違う ID を送ると `409 / DGX_SCENARIO_PLAN_STALE` になる。`business_to_private` / `business_to_experiment` に指定すると `400 / DGX_MODEL_PROFILE_NOT_ALLOWED_FOR_SCENARIO`。単発 `EXECUTE_TARGET_ACTION` start にはモデル選択を付けない。

## DGX model profile capabilities / runtime intent（2026-05-29） {#dgx-profile-capabilities-runtime-intent}

- **加算契約**: manifest と `GET /system/model-profiles` に `declaredCapabilities`, `visionRequiresMmproj`, `launcherHints`。active state に `runtimeReadyCapabilities`, `visionReadyReason`。
- **35B 写真 VLM**: `declaredCapabilities` に `vision` があっても、green で **mmproj 未検出**なら `runtimeReadyCapabilities` は `text` のみになり得る（`visionReadyReason: mmproj_missing`）。
- **stop 対称化**: `/stop` も active model state の `backend` を env より優先（`stop-force` と同原則）。
- **Pi5 shadow → opt-in**: `INFERENCE_*_RUNTIME_START_PROFILE_ID` / provider `runtimeStartProfileId`。送信は `INFERENCE_RUNTIME_START_PROFILE_ENABLED=true` 時のみ。正本: [ADR-20260529](../decisions/ADR-20260529-dgx-profile-capabilities-runtime-intent.md)。

### 本番反映（2026-05-29 · profile capabilities / runtime intent · Pi5 + DGX） {#production-2026-05-29-dgx-profile-capabilities-runtime-intent}

- **ブランチ**: **`feat/dgx-profile-capability-intent-foundation`** · **コミット** **`18591d18`**
- **対象**: **`raspberrypi5`** → **DGX Spark**（順次·各 1 台）。Pi4/Pi3 **対象外**
- **Pi5 Detach**: **`20260529-121631-3901`** · **`ok=138` `changed=7` `failed=0`** · Git **`18591d18`**
- **DGX**: `control-server` 系 7 ファイル + registry manifest 2 件 **`scp`** · **control-server / gateway-server 再起動**（gateway は import 先更新のため再起動必須）
- **実機**:
  - Phase12 **`verify-phase12-real.sh` → 43/0/0**（約 **31s**）
  - Pi5: **`INFERENCE_RUNTIME_START_PROFILE_ENABLED=false`**（本番既定·shadow のみ）
  - DGX: `GET /system/model-profiles` → **`declaredCapabilities`** 付き profile 2 件 · state に **`runtimeReadyCapabilities`**
- **コードレビュー後の追加ガード（同コミット内）**:
  - Pi5: 同一 provider で用途別 profile が食い違うと **起動時エラー**（opt-in 時）
  - Pi5: on-demand controller キャッシュキーに **profileId** を含め **refCount 共有による /start 抑止**を防止
  - DGX: vision ready は **`launcherHints` / start env** をログより優先（`mmproj_missing` の false negative 回避）
- **次の運用タスク（未実施）**: `INFERENCE_RUNTIME_START_PROFILE_ENABLED=true` への切替は **全用途で同一 profile に揃えたうえで** shadow ログを確認してから
- **参照**: [deployment.md §2026-05-29](../guides/deployment.md#dgx-profile-capabilities-runtime-intent-2026-05-29) · [Runbook §本番](../runbooks/dgx-system-prod-local-llm.md#本番反映2026-05-29-dgx-profile-capabilities-runtime-intent)

## 業務モデル意図の Pi5 伝播（2026-05-29 · コード） {#business-profile-intent-propagation}

- **目的**: 管理 UI で業務復帰時に選んだ `modelProfileId` を、職場 Pi5 の **photo_label / document_summary / admin_console_chat / stackchan_chat** が on-demand `/start` で共有参照できるようにする（DGX 単一アクティブ前提は維持）。
- **正本**: DGX `active-model-profile.json` と `GET /system/model-profiles` の `activeProfileId`。Pi5 は **プロセス内 `BusinessProfileIntentStore`** に意図を保持する。
- **解決優先順**（`business-profile-intent.ts`）: `provider.runtimeStartProfileId` → **`INFERENCE_BUSINESS_RUNTIME_START_PROFILE_ID`（運用固定）** → **orchestration 成功時の選択 ID** → 用途別 `INFERENCE_*_RUNTIME_START_PROFILE_ID`。
- **orchestration 成功時**: `private_to_business` / `experiment_to_business` で Strict Ready 成功後、選択 `modelProfileId` を store に記録（イベントログにも 1 行）。
- **overview は store を更新しない**: `activeProfileId` は KPI 表示のみ。passive な overview 閲覧で on-demand 意図が DGX active にすり替わらない。
- **env**: `INFERENCE_BUSINESS_RUNTIME_START_PROFILE_ID`（業務共通）。用途別 ID と併用する場合は **同一 ID** に揃える（不一致は API 起動時エラー）。
- **opt-in**: `INFERENCE_RUNTIME_START_PROFILE_ENABLED=true` のときのみ on-demand `POST /start` body に `modelProfileId` を付与。既定 `false` は shadow ログのみ（従来どおり）。
- **UI**: `overview.runtimeSummary` に **Pi5 業務意図**（`businessRuntimeIntentProfileId`）と Active Model との一致可否を表示。
- **対象外**: Hermes 私用 Pi5・`stackchan-bridge` 直結・ComfyUI・experiment-lab（別ワークロード）。

### 本番反映（2026-05-29 · 業務モデル意図の Pi5 伝播 · Pi5 API/Web） {#production-2026-05-29-dgx-business-profile-intent-propagation}

- **ブランチ**: **`feat/dgx-business-profile-propagation`** · **`fd16b711`** `feat(dgx): propagate business profile intent` · **`1edebd70`** `fix(dgx): harden business profile intent lifecycle`（overview が store を上書きしない·env > store·provider lease 解放）
- **CI**: **`26618352572`** — 全ジョブ **success**（約 **11m48s**）
- **デプロイ対象**: **`raspberrypi5` のみ**（**`--limit raspberrypi5`**）。**DGX / Pi4 / Pi3 未実施**
- **Pi5 Detach**: **`20260529-141701-10018`**（**`PLAY RECAP` `ok=138` `changed=7` `failed=0`** · リモート exit **`0`** · **`--follow` 約 930s**）
- **変更内容（要約）**:
  - **`BusinessProfileIntentStore`** + **`resolveBusinessRuntimeStartProfileId`**（`business-profile-intent.ts`）
  - **`inference-use-case-runtime-intent.ts`** 統合·**`provider-local-llm-runtime.controller.ts`** lease 固定/失敗時解放
  - **`dgx-resource.workload-transition.ts`** — 業務復帰 Strict Ready 成功時のみ store 更新
  - **`dgx-resource.runtime-summary.ts`** — KPI 下段 **Pi5 業務意図**（overview は store を更新しない）
  - Ansible **`docker.env.j2`** — `INFERENCE_BUSINESS_RUNTIME_START_PROFILE_ID`（inventory 側で値設定可）
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **43/0/0**（約 **30s**）
- **実機（Pi5）**:
  - Git **`1edebd70`** · dist に **`business-profile-intent*.js`**
  - **`INFERENCE_RUNTIME_START_PROFILE_ENABLED=false`**
  - Web **`Pi5 業務意図`** 表示（`index-CZRmk5_v.js`）
- **運用上の意味**: 業務復帰で選んだ profile が **職場 Pi5 業務推論の意図正本**（実 `/start` 送信は opt-in）。DGX active と不一致の間は KPI で可視化し、再業務復帰または env で揃える
- **トラブルシュート**:
  - **store が空·意図行なし** → 業務復帰 execute 未成功、または **overview だけ開いた**（store は orchestration 成功時のみ）
  - **env と store が違う** → **`INFERENCE_BUSINESS_RUNTIME_START_PROFILE_ID` が store より優先**（意図的）。固定運用は inventory/vault で env を設定
  - **API 起動失敗（profile 競合）** → 用途別 `INFERENCE_*_RUNTIME_START_PROFILE_ID` が業務共通と不一致 — **同一 ID に揃える**
- **参照**: [deployment §2026-05-29](../guides/deployment.md#dgx-business-profile-intent-propagation-2026-05-29) · [Runbook §本番](../runbooks/dgx-system-prod-local-llm.md#本番反映2026-05-29-business-profile-intent-propagation) · [KB-366 §業務復帰と各機能](../knowledge-base/KB-366-dgx-spark-operational-understanding.md#2-写真ラベル要領書hermes-は別モデルか)

## 業務 profile スコープ runtime readiness（2026-05-29 · コード） {#business-profile-scoped-runtime-readiness}

- **背景**: 35B 選択後、キオスク持出 `photo_label` が **`runtime_ready_timeout`（latencyMs≈901707）** で失敗する一方、DGX 単体 VLM プローブは **HTTP 200**（`visionReadyReason=mmproj_detected`）。**「35B は画像非対応」ではなく cold start + ready 判定の分離不足**が主因。
- **`business-runtime-readiness.ts`**: profile 付き `/start` 後に **`GET /system/model-profiles`** で **`activeProfileId` 一致**と、**`photo_label` 時は `runtimeReadyCapabilities` に `vision`** を検証（`verifyBusinessRuntimeAfterProfileStart`）。
- **`http-on-demand-local-llm-runtime.controller.ts`**: 共有 runtime の **HTTP ready**（`/v1/models`）と **`ensureUseCaseProfileReadiness`**（用途別 capability）を分離。`ensureReady` 失敗時は refCount を戻し stale lease を防ぐ。
- **`dgx-resource.scenario-readiness.ts`**: 業務復帰で `modelProfileId` 指定時、Strict Ready に **`model_profile_vision_runtime`**（active state の vision capability）を追加。
- **opt-in との関係**: 本番は引き続き **`INFERENCE_RUNTIME_START_PROFILE_ENABLED=false`**（shadow）。上記検証は **opt-in 有効時**および **業務復帰 orchestration の Strict Ready** で効く。意図 profile の実 `/start` 送信は shadow 確認後に切替。

### 本番反映（2026-05-29 · profile-scoped runtime readiness · Pi5 API） {#production-2026-05-29-dgx-business-profile-optin-ready}

- **ブランチ**: **`feat/dgx-business-profile-optin-ready`** · **`60ec06d1`** · **`efe1853f`**
- **CI**: **`26624687386`** — **success**
- **デプロイ対象**: **`raspberrypi5` のみ**（**`--limit raspberrypi5`**）。**DGX / Pi4 / Pi3 未実施**
- **Pi5 Detach**: **`20260529-173357-17360`**（**`PLAY RECAP` `ok=134` `changed=4` `failed=0`** · **`--follow` 約 924s**）
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **43/0/0**（約 **112s**）
- **実機（Pi5）**: Git **`efe1853f`** · **`business-runtime-readiness.js`** · scenario-readiness に **`model_profile_vision_runtime`**
- **トラブルシュート**:
  - **初回 photo_label のみ失敗** → 35B cold start が **`LOCAL_LLM_RUNTIME_READY_TIMEOUT_MS`（900000）** 超 — 起動完了後に再試行
  - **vision Strict Ready 未達** → DGX state の **`runtimeReadyCapabilities`** / **`visionReadyReason`**（KPI メモリだけでは判断しない）
- **参照**: [deployment §2026-05-29 optin-ready](../guides/deployment.md#dgx-business-profile-optin-ready-2026-05-29) · [Runbook §本番](../runbooks/dgx-system-prod-local-llm.md#本番反映2026-05-29-business-profile-optin-ready) · [KB-366 §35B 写真ラベル](../knowledge-base/KB-366-dgx-spark-operational-understanding.md#35b-photo-label-cold-start-runtime-ready-timeout)

## DGX model profile contract（2026-05-28）

- registry: `/srv/dgx/shared-models/registry/<modelProfileId>/manifest.json`
- active state: `/srv/dgx/system-prod/state/active-model-profile.json`
- gateway: `GET /system/model-profiles`（一覧 + `activeProfileId`）/ `GET /system/model-profile`（active state）
- control: `POST /start {"modelProfileId":"..."}`。指定時は profile の `backend` が `ACTIVE_LLM_BACKEND` より優先。未指定 start は従来互換で env fallback。
- 初期 ID: `business_qwen36_27b_nvfp4`（blue / Qwen3.6 27B NVFP4 / 推奨）と `business_qwen35_35b_gguf`（green / Qwen3.5 35B GGUF）
- Strict Ready（業務復帰・`modelProfileId` 指定時）は **`/v1/models` の `system-prod-primary` に加え**、ポーリング毎の `GET /system/model-profiles` で **`activeProfileId === 選択 modelProfileId`** を必須とする。`state.backend` が返る場合は **選択 profile の `backend`（green/blue）と一致**も必須（readiness check: `model_profile_active` / `model_profile_backend`）。**`/v1/models` のみ OK では success にしない**（2026-05-28 不具合の再発防止）。

### 業務復帰 Strict Ready と model profile 一致（2026-05-28） {#dgx-strict-ready-model-profile-match}

- **症状**: 私用→業務で **27B を選択**しても API が **success**、KPI は **20GB 台のまま**（実際は **35B green / llamacpp** が稼働）。`active-model-profile.json` は別 profile。
- **根本原因**: Pi5 `waitScenarioReadiness` / `inferenceBusinessReady()` が **`/v1/models` 到達のみ**を見て、**選択 `modelProfileId` と DGX `activeProfileId` / `state.backend` の一致を見ていなかった。
- **Fix（コード）**: `OverviewProbeBundle` に `modelProfiles` を含め、業務復帰で `modelProfileId` 指定時は Strict Ready に profile 一致ゲートを追加。
- **確認手順**:
  1. `curl …/system/model-profiles` → **`activeProfileId`**・**`state.backend`**（あれば）・選択 ID と一致するか
  2. `curl …/v1/models` → 推論は応答するが ① と不一致なら **Strict Ready は未達**（execute **success にならない**）
  3. Pi5 `scenarioExecute.readinessChecksJa` → `model_profile_active` / `model_profile_backend` の `satisfied`
- **参照**: [Runbook §Strict Ready profile 一致](../runbooks/dgx-system-prod-local-llm.md#strict-ready-model-profile-match-2026-05-28) · [KB-366 §業務復帰 KPI 不一致](./KB-366-dgx-spark-operational-understanding.md#dgx-strict-ready-model-profile-mismatch-2026-05-28)。

### 本番反映（2026-05-28 · Strict Ready profile 一致 · Pi5 API） {#production-2026-05-28-dgx-strict-ready-profile-match}

- **ブランチ**: **`fix/dgx-strict-ready-profile-match`**（**`90ba94d9`** `fix(dgx): require selected model profile for strict ready`）。
- **CI**: **`26575185778`** — 全ジョブ **success**（約 **12m54s**）。
- **デプロイ対象**: **`raspberrypi5` のみ**（**`--limit raspberrypi5`**）。**DGX / Pi4 / Pi3 未実施**（DGX バイナリ変更なし）。
- **Pi5 Detach**: **`20260528-221349-13434`**（**`PLAY RECAP` `ok=134` `changed=4` `failed=0`** · リモート exit **`0`** · ローカル **`--follow` 約 932s**）。
- **変更内容**:
  - `OverviewProbeBundle` に **`modelProfiles`** を追加（ポーリング毎に DGX `GET /system/model-profiles` を readiness へ）。
  - 業務復帰で **`modelProfileId` 指定時**、Strict Ready に **`model_profile_active`** / **`model_profile_backend`** チェックを追加。
  - `fetchDgxModelProfilesOverview` が DGX 応答の **`state.backend`** を **`activeStateBackend`** として解析。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **43/0/0**（約 **110s**）。
- **実機（Pi5 api コンテナ）**:
  - HEAD **`90ba94d9`** · デプロイ artifact に **`model_profile_active` / `model_profile_backend`**
  - `fetchDgxModelProfilesOverview` → **`status: ok`** · **`activeProfileId: business_qwen35_35b_gguf`** · **`activeStateBackend: green`** · allowlist **2 件 available**
- **運用上の意味**: 業務復帰 execute の **success = 選択した profile が DGX active かつ `/v1/models` ready**。**別 profile が `/v1/models` だけ応答している状態では success にならない**。
- **トラブルシュート**:
  - **`readinessChecksJa` に profile 系が無い** → execute に **`modelProfileId` 未指定**、または Pi5 **旧 ref**。
  - **profile 不一致でタイムアウト** → 想定内。DGX 側で選択 ID への `/start` 完了と `activeProfileId` 更新を確認。
  - **503 と混同しない** → allowlist 取得失敗は別件（[§activeProfileId null](#dgx-model-profile-active-profile-id-null)）。
- **参照**: [deployment §Strict Ready profile](../guides/deployment.md#dgx-strict-ready-profile-match-2026-05-28) · [Runbook §本番](../runbooks/dgx-system-prod-local-llm.md#本番反映2026-05-28-strict-ready-profile-match) · [KB-366 §KPI 不一致](./KB-366-dgx-spark-operational-understanding.md#dgx-strict-ready-model-profile-mismatch-2026-05-28)。

### 実状態整合（2026-05-29 · KPI 再設計 + `stop-force` backend 正本） {#production-2026-05-29-dgx-runtime-state-alignment}

- **ブランチ**: **`feat/dgx-runtime-state-alignment`** · **代表コミット** **`af4997fc`**（`fix(dgx): align runtime state with dashboard indicators)`）· **`main` マージ後は `origin/main` HEAD をデプロイ正本とする**。
- **Pi5 API**: `GET /api/system/dgx-resource/overview` に **`runtimeSummary`** を追加（`activeProfileId` / `activeBackend` / `businessReady` / `policyLabel` / `runtimeSource` 等）。**Strict Ready の待機ロジックは変更せず**、overview 用の**現時点スナップショット**のみ。
- **Web**: `DgxResourceStatusBoard` — **上段メトリクス + 下段実行時状態**（`DgxResourceKpiStrip` + `DgxResourceRuntimeSummaryStrip`）。Policy 単独チップは廃止し runtime 行へ統合。
- **DGX `control-server.py`**: `POST /stop-force` は **`read_active_model_state()` の `backend` を優先**（無ければ `ACTIVE_LLM_BACKEND`）。応答 JSON に **`backendSource`**（`model_profile_state` | `env_fallback`）を付与。
- **確認（Mac / CI）**: API `dgx-resource.runtime-summary` テスト · Web KPI/runtime モデルテスト · `scripts/dgx-local-llm-system/tests/test_control_server.py`（state 優先 stop-force）。
- **本番反映（2026-05-29 · Pi5→DGX 順次・各 1 台）**:
  - **① Pi5 のみ** — `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"` · `./scripts/update-all-clients.sh feat/dgx-runtime-state-alignment infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`。**Detach `20260529-093340-9025`** · `PLAY RECAP`: **`ok=134` `changed=4` `failed=0` / `unreachable=0`** · リモート exit **`0`** · **`--follow` 約 865s**。Pi4/Pi3 は **`skipping: no hosts matched`**（**Pi3 専用手順不要**）。
  - **② DGX** — **`scp scripts/dgx-local-llm-system/control-server.py`** → **`/srv/dgx/system-prod/bin/control-server.py`** → **`control-server.pid` の PID を `kill` → `rm -f` PID ファイル → **`bash /srv/dgx/system-prod/bin/start-control-server.sh`**（**gateway は本差分で未更新** — 既存 gateway が `/stop-force` を転送済みである前提）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **33s** · Tailscale **`100.106.158.2`**）。
- **実機（機能）**:
  - Pi5 Git **`af4997fc`** · api コンテナに **`dgx-resource.runtime-summary.js`** 存在 · Web bundle **`index-COC3GNKC.js`** に **`DgxResourceStatusBoard`** / **`runtimeSummary`** 文字列を確認。
  - DGX 反映直前の **`active-model-profile.json`**: **`business_qwen36_27b_nvfp4`** · **`backend: blue`**（env **`ACTIVE_LLM_BACKEND=blue`** と一致）。
  - Pi5 から **`POST http://100.118.82.72:38081/stop-force`**（`X-Runtime-Control-Token`）→ **`{"ok":true,"backend":"blue","backendSource":"model_profile_state"}`**（**検証用スモーク**。blue 側ランタイムは停止されるため、検証後は管理 UI または通常 `/start` で業務 LLM を再開すること）。
- **トラブルシュート**:
  - **KPI は空きに見えるが Policy だけ業務** → 下段 **`runtimeSummary`** の **Active Model / Backend** を確認（上段 KPI のみでは判断しない）。
  - **`stop-force` 後も green `llama-server` が残る** → **`backendSource: env_fallback`** なら state 未読み。**`model_profile_state` なのに残る** → 停止コマンド失敗または別プロセス。DGX `active-model-profile.json` と env の **`ACTIVE_LLM_BACKEND` ずれ**を先に解消。
  - **`backendSource` が応答に無い** → DGX **`control-server.py` が未反映**（`start-control-server.sh` は生存 PID があると新コードを読まない）。
- **参照**: [deployment §2026-05-29](../guides/deployment.md#dgx-runtime-state-alignment-2026-05-29) · [Runbook §本番 2026-05-29](../runbooks/dgx-system-prod-local-llm.md#本番反映2026-05-29-runtime-state-alignment) · [KB-366 §KPI 帯 2026-05-29](./KB-366-dgx-spark-operational-understanding.md#管理画面-kpi-帯2026-05-29-再設計--overviewruntimesummary)

### DGX model profile storage availability {#dgx-model-profile-storage-availability}

- **症状**: `GET /system/model-profiles` は **profiles 2 件**を返すが、管理 UI の業務復帰ドロップダウンは **1 件だけ**（2026-05-28 実機）。
- **原因**: Web は `enabled && status === 'available'` のみ表示（`DgxResourcePrimaryScenarioFlow`）。DGX は manifest の **`currentStorageLocation` / `storageLocation` の実在**で `status` を決める（`model_profiles.profile_storage_available`）。27B の例では **`currentStorageLocation` が `hf-cache/hub/models--...` ではなく `hf-cache/models--...` を指していた**ため `unavailable` となり、35B GGUF のみ `available` だった。
- **確認手順**:
  1. DGX: `curl -H "X-LLM-Token: …" http://127.0.0.1:38081/system/model-profiles` で各 profile の `status` / `currentStorageLocation`
  2. DGX: `ls` で `currentStorageLocation` と `storageLocation` の存在を確認（HF は **`hf-cache/hub/`** 配下が典型）
  3. registry manifest を実パスに合わせて更新（例: `business_qwen36_27b_nvfp4` の `currentStorageLocation` に **`/hub/`** を含める）
- **再発防止**: リポジトリ例 [`model-registry.examples/business_qwen36_27b_nvfp4/manifest.json`](../../scripts/dgx-local-llm-system/model-registry.examples/business_qwen36_27b_nvfp4/manifest.json) と `test_model_profiles.py` の回帰テストを正本とする。

### DGX model profile activeProfileId null {#dgx-model-profile-active-profile-id-null}

- **症状（2026-05-28 実機）**: 管理 UI で業務復帰時にモデル 2 件は選べるが、実行すると **`DGX active profile state が取得できませんでした` / `DGX_MODEL_PROFILES_UNAVAILABLE` (503)**。
- **原因**: DGX `GET /system/model-profiles` は **`activeProfileId: null`**（`/srv/dgx/system-prod/state/active-model-profile.json` 未作成·legacy `/start` 後など）を返すが、**Pi5 API が null を `overview.modelProfiles.status: degraded` と誤判定**し、`PREVIEW_ORCHESTRATION_SCENARIO`（`modelProfileId` 付き）を拒否していた。**profiles 2 件 `available` とは別問題**（storage path 修正済み）。
- **DGX 契約**: `activeProfileId: null` = **profile 指定 start の記録がない**（未 start 前は正常）。**推論稼働中でも state 無し得る**（`/v1/models` は 200 だが state 未書き込み）。
- **Pi5 契約（修正後）**: allowlist 取得成功（HTTP 200 + profiles）→ **`status: ok`**。`activeProfileId` / `lastLoadedProfileId` は null のまま可。**degraded** は HTTP 失敗・接続失敗・未設定のみ。
- **2 API の違い**:
  | API | null の意味 | state 無し時 |
  |-----|------------|-------------|
  | `/system/model-profiles` | 記録なし（正常） | `activeProfileId: null`、profiles は返る |
  | `/system/model-profile` | エラー | **503** |
- **state ライフサイクル**: 書込 = **`POST /start` + `modelProfileId`** のみ。**stop では消えない**。
- **確認手順**:
  1. `curl -H "X-LLM-Token: …" http://…:38081/system/model-profiles` → profiles 件数・`activeProfileId`
  2. `curl -H "X-LLM-Token: …" http://…:38081/system/model-profile` → 503 なら state ファイル未作成
  3. `curl …/v1/models` → 現在ロード中モデル（state と不一致あり得る）
  4. Pi5 デプロイ後: 業務復帰 PREVIEW が 503 にならないこと
- **Fix（コード）**: `apps/api/.../dgx-resource.model-profiles.ts` — **`fetchDgxModelProfilesOverview` が null を degraded にしない**（ブランチ **`fix/dgx-active-profile-null-contract`**）。
- **Fix（運用・任意）**: 稼働中 backend に合わせ **`POST /start {"modelProfileId":"…"}`** で state を書く、または manifest に沿った `active-model-profile.json` を DGX に配置。

### 本番反映（2026-05-28 · activeProfileId null · Pi5 API 契約修正） {#production-2026-05-28-dgx-active-profile-null-contract}

- **ブランチ**: **`fix/dgx-active-profile-null-contract`**（**`f4ec13dc`** `fix(dgx): allow null active profile in model overview`）。
- **CI**: **`26572037918`** — 全ジョブ **success**。
- **デプロイ対象**: **`raspberrypi5` のみ**（Ansible **`--limit raspberrypi5`**）。**DGX / Pi4 / Pi3 未実施**。
- **Pi5 Detach**: **`20260528-204344-14223`**（**`PLAY RECAP` `ok=134` `changed=4` `failed=0`** · リモート exit **`0`** · ローカル **`--follow` 約 903s**）。
- **変更内容**: `fetchDgxModelProfilesOverview` — allowlist 取得成功時 **`activeProfileId: null` でも `status: ok`**（`errorMessageJa` を付けない）。`assertModelProfileKnownAndStartable` は per-profile 可用性で判定（全体 degraded 誤判定を解消）。
- **実機（DGX）**: `GET /system/model-profiles` → **`activeProfileId: null`** · **profiles 2 件とも `available`**（27B storage path 修正済み）。
- **実機（Pi5 api コンテナ）**: `fetchDgxModelProfilesOverview` → **`{"status":"ok","activeProfileId":null,"count":2}`** · `assertModelProfileKnownAndStartable(..., business_qwen35_35b_gguf)` **成功**（修正前は **`DGX_MODEL_PROFILES_UNAVAILABLE` 503**）。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **116s**）。
- **UI 想定**: `/admin/tools/dgx-resource` 私用→業務（または実験→業務）でモデル選択後 **PREVIEW/EXECUTE が 503 にならない**。
- **参照**: [deployment §activeProfileId null](../guides/deployment.md#dgx-active-profile-null-contract-2026-05-28) · [Runbook §本番 activeProfileId null](../runbooks/dgx-system-prod-local-llm.md#本番反映2026-05-28-activeprofileid-null-pi5-api) · [KB-366 §503 切り分け](./KB-366-dgx-spark-operational-understanding.md#production-2026-05-28-dgx-business-return-model-selection)。

### 本番反映（2026-05-28 · 27B `currentStorageLocation` 修正 · DGX registry のみ） {#production-2026-05-28-dgx-model-profile-storage-path}

- **ブランチ**: **`fix/dgx-model-profile-current-storage-path`**（**`ff5947c8`** `fix(dgx): align model profile storage path docs` · **`af0e7e02`** CI Trivy 抑制）。
- **CI**: **`26569969639`** — 全ジョブ **success**（初回 **`26569170631`** は `security-docker` failure → `.trivyignore` で解消）。
- **デプロイ対象**: **DGX Spark のみ**（**`scp` manifest 1 ファイル**）。**Pi5 / Pi4 / Pi3 は未実施**（本修正は DGX registry 正本のデータ修正·Pi5 はプロキシのみでコード差分なし）。
- **本番配置**: 例 manifest → **`/srv/dgx/shared-models/registry/business_qwen36_27b_nvfp4/manifest.json`**（`currentStorageLocation` = **`/srv/dgx/system-prod/data/hf-cache/hub/models--sakamakismile--Qwen3.6-27B-NVFP4`**）。
- **再起動**: **なし**（gateway/control の PID 再起動不要）。
- **実機（自動）**: Pi5 から `GET http://100.118.82.72:38081/system/model-profiles`（`X-LLM-Token`）→ **`business_qwen36_27b_nvfp4` `available: true`**（修正前は **`unavailable`**）·**`business_qwen35_35b_gguf` `available`**·**profiles 2 件とも `available`**。
- **実機（UI）**: `/admin/tools/dgx-resource` 業務復帰フローで **27B（推奨）と 35B GGUF の 2 件**がドロップダウンに表示（`DgxResourcePrimaryScenarioFlow` は `enabled && status === 'available'` のみ）。
- **参照**: [Runbook §本番 storage path](../runbooks/dgx-system-prod-local-llm.md#本番反映2026-05-28-27b-model-profile-storage-path)·[deployment.md](../guides/deployment.md#dgx-model-profile-storage-path-2026-05-28)·[KB-366 §storage path](./KB-366-dgx-spark-operational-understanding.md#production-2026-05-28-dgx-model-profile-storage-path)。

### 本番反映（2026-05-28 · 業務復帰モデル選択 · Pi5→DGX 順次 · 各 1 台） {#production-2026-05-28-dgx-business-return-model-selection}

- **ブランチ**: **`feat/dgx-business-model-selection`**（**`main` マージ後は `origin/main` HEAD** をデプロイ引数の正本とする）。
- **代表コミット**: **`91be7dcf`**（`feat(dgx): select business return model profiles`）。
- **CI**: **`26566270315`** — `lint-build-unit` / `e2e-smoke` / `e2e-tests` / `api-db-and-infra` **success** · `security-docker` **failure**（Caddy Trivy·本変更と無関係）。
- **ホスト順序**: **① `raspberrypi5` のみ**（Ansible `--limit raspberrypi5`）→ **② DGX Spark**（**`ubudgxkoushi@100.118.82.72`**·**`scp` + PID 再起動**）。Pi4／Pi3 **no hosts matched**·**Pi3 専用手順未実施**。
- **Pi5 Detach**: **`20260528-184011-18178`**（**`PLAY RECAP` `ok=134` `changed=4` `failed=0`**·リモート exit **`0`**·ローカル **`--follow` 約 1195s**）。
- **DGX 配置（`/srv/dgx/system-prod/bin/`）**: `control-server.py`·`gateway-server.py`·`model_profiles.py`·`active_model_state.py`。**registry 例**: `business_qwen36_27b_nvfp4`·`business_qwen35_35b_gguf` の `manifest.json` を **`/srv/dgx/shared-models/registry/<id>/`** へ。
- **DGX 再起動**: `control-server.pid` / `gateway-server.pid` の PID を **`kill`** → PID ファイル削除 → **`start-control-server.sh`** / **`start-gateway-server.sh`**。
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **111s**）。
- **実機（機能）**: Pi5 `api` から **`GET http://100.118.82.72:38081/system/model-profiles`**（`X-Runtime-Control-Token`）→ **`ok: true`**, **profiles 2 件**, 未 start 前 **`activeProfileId: null`**。Web: 業務復帰フローにモデル選択 UI。Pi5 コンテナ HEAD **`91be7dcf`**。
- **知見**:
  - **起動直後 `curl healthz` が Connection refused** → 数秒後 **200**（起動レース·[Runbook](../runbooks/dgx-system-prod-local-llm.md#本番反映2026-05-28-業務復帰モデル選択) と同型）。
  - **`modelProfileId` 指定 start 後も Strict Ready はスキップしない**（`ranModelProfileStart`）。
  - **Web**: `DgxResourceOperatorConsole` が **`modelProfiles={overview.modelProfiles}`** を `DgxResourcePrimaryScenarioFlow` へ渡す必要あり。
- **参照**: [deployment.md §2026-05-28](../guides/deployment.md#dgx-business-return-model-selection-2026-05-28)·[KB-366 §本番](./KB-366-dgx-spark-operational-understanding.md#production-2026-05-28-dgx-business-return-model-selection)·[Runbook §2026-05-28](../runbooks/dgx-system-prod-local-llm.md#本番反映2026-05-28-業務復帰モデル選択)·[`scripts/dgx-local-llm-system/README.md`](../../scripts/dgx-local-llm-system/README.md)。

## 本番反映（記録）

- **ホスト**: `raspberrypi5` のみ（`--limit raspberrypi5`。Pi4／Pi3 play **no hosts matched**）
- **ブランチ**: `feat/dgx-resource-policy-orchestration-phase3`（代表コミット **`a44b9f78`**）
- **Detach Run ID**: **`20260503-094340-23537`**（`PLAY RECAP`: **`ok=135` `changed=8` `failed=0` / `unreachable=0`**・exit **`0`**・約 **597s**）
- **自動実機検証**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**

## 運用・トラブルシュート

- **補助ボタンが出ない**: Pi5 に **`DGX_RESOURCE_*_RUNTIME_START_URL` と `_STOP_URL` が両方**なければ `capabilities` は **`readStatus` のみ**（読取のみのままでも運用継続可）。
- **`SET_POLICY` + `applyWorkloadChanges` でエラー**: ワークロード POST が途中で失敗すると **`policy.mode` は更新されない**ことがある。その場合はイベントログ・DGX hook 側ログで **べき等性／原因**を確認する（競合関連は [KB-364](./KB-364-dgx-blue-vllm-comfyui-gpu-contention.md)）。
- **UI が古い**: Pi5 で **`web` 再構築**済みでもブラウザキャッシュがある → [verification-checklist.md](../guides/verification-checklist.md) §6.6.4 **強制リロード**。
- **`private_ok` にしたのに 27B warm が残る**: Pi5 **`api` ref**（**`7fe1ca15` / `2d91d032` 以降**）·DGX **`control-server.py` の `/stop-force`**·**`curl -X POST http://127.0.0.1:38081/stop-force` が 404 でないか**（gateway 未転送）。詳細は [§本番反映 2026-05-25](#production-2026-05-25-dgx-private-ok-stop-force)。

## Phase 4（半自動オーケストレーション／overview 運用ヒント）（実機反映）

- **API アクション追加**
  - `PREVIEW_ORCHESTRATION_SCENARIO` — ワークロード調停＋運用モード適用までの **順序付きプレビュー** と **`planFingerprint`（環境起因で変わる前提の SHA-256）** を返却。
  - `EXECUTE_ORCHESTRATION_SCENARIO` — `planFingerprint` **`confirmed: true`** を必須にし、**プレビューとの指紋一致**でなければ **`409 / DGX_SCENARIO_PLAN_STALE`**（Stale 対策）。
  - **`/v1/models` ヒント**: 成功応答のみ JSON を読み、`modelsProbe.inferenceHint` と admin `model hint` を **Inference 状態要約に結合**（混同防止のため単発 target の `metaLines` は `inference routing:` など英語語彙）。
- **`overview.monitoring`**（構造化）— `activeInferenceSummary`・`sparkSummaryJa`・`alerts`（GPU 競合疑い等）・直近 **`lastScenarioFailure`**（ガイド途中失敗の永続ヒント）。Web は **運用監視ヒント／複合運用ガイド** パネルで表示。**プレビュー→確認→実行後**にも **完了 step orders / recommendedNextJa** を即時カードへ出す UI を含む。
- **シナリオ ID**: `business_to_private` | `private_to_business` | `business_to_experiment` | `experiment_to_business`（プランナー側 `DGX_ORCHESTRATION_SCENARIO_IDS`）。

### Phase 4 本番反映（記録）

- **ホスト**: `raspberrypi5` のみ（`--limit raspberrypi5`。Pi4／Pi3 play **no hosts matched**）
- **先行ブランチ（デプロイ時）**: `feat/dgx-resource-guided-orchestration-monitoring`
- **`main` に取り込み後**: 運用側の `./scripts/update-all-clients.sh` 引数は **`main`**（[deployment.md](../guides/deployment.md) と同様）
- **Detach Run ID**: **`20260503-102936-930`**（`PLAY RECAP`: **`ok=130` `changed=4` `failed=0` / `unreachable=0`**・リモート `exit` **`0`**・約 **663s**。ローカル `update-all-clients.sh --detach --follow` の **総所要**も同桁）
- **自動実機検証**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（所要 **約 205s**。Pi3 は **単体デプロイではなく検証のみ接続**。Pi3 はリソース僅少のため本変更の Ansible 適用対象外）

### 運用メモ／トラブルシュート（Phase 4 追加）

- **Stale（409）が出た**: **`PREVIEW_ORCHESTRATION_SCENARIO` を再実行**して `planFingerprint` を更新する（環境側の `_RUNTIME_*` 有効化や gateway on_demand 設定が変わると **指紋も変わる**）。
- **ガイドが途中停止**: **`overview.monitoring.lastScenarioFailure`** とイベントログ、`scenarioExecute.completedStepOrders` で **どこまで POST が通ったか**を確認。失敗応答でも一部 hook は **べき等でなく通っている**ことがあるため、単発 **`EXECUTE_TARGET_ACTION`** と KB-364 系を併読。
- **UI が見えない / 情報が欠ける**: **`api` と `web` を同一ブランチ**へ揃える → ブラウザ **[verification-checklist.md](../guides/verification-checklist.md) §6.6.4 強制リロード**。

## Phase 5（運用者コンソール / API 境界整理）（実装・本番反映）

- **`overview.operator`**: 3 ワークロード（業務 VLM / 私用 Comfy / 実験ラボ）の要約、`operatorSummary`（見出し・アラート先頭）、`operatorActions`（4 シナリオのラベル・無効理由・主要導線フラグ）。**`targets[]` は正規の監視・起停可否の契約として維持**し、コンソールは翻訳レイヤとして追加（二重化しつつ責務を分離）。
- **`dgx-resource.workload-transition.ts`**: `SET_POLICY` 前ワークロード列と **`EXECUTE_ORCHESTRATION_SCENARIO`** の実行本体を **サービスから分離**。成功時 **`scenarioExecute.outcomeKind`** に **`noop`**（計画ステップなし・モード変更なし）を付与可能。
- **Web**: `DgxResourceOperatorConsole` を主軸にし、Control Target グリッドは折りたたみ詳細へ。`SET_POLICY` は親の **単一 `postDgxResourceAction` 経路**に集約可能（`DgxResourceProfilePanel` の `postDgxAction`）。
- **ADR**: [ADR-20260503-dgx-resource-operator-console.md](../decisions/ADR-20260503-dgx-resource-operator-console.md)

### Phase 5 本番反映（記録）

- **ホスト**: `raspberrypi5` のみ（`--limit raspberrypi5`。Pi4／Pi3 play **no hosts matched**・**Pi3 への個体デプロイは実施しない**）
- **ブランチ**: `feat/dgx-resource-operator-console`（代表コミット **`e88d9206`**）
- **Detach Run ID**: **`20260503-115446-2532`**（`PLAY RECAP`: **`ok=130` `changed=4` `failed=0` / `unreachable=0`**・リモート exit **`0`**・ローカル `--follow` 完了まで **約 826s**）
- **自動実機検証**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（所要 **約 97s**。Pi3 は **検証スクリプトのサービス疎通のみ**）
- **知見**: Pi5 のみ更新でも Phase12 は **広域 API + Pi3/Pi4 チェック**を踏むため、**所要 90–120s 程度**は普通に発生する。`--detach --follow` の **完了正本**は引き続き **`PLAY RECAP` / 遠隔 `summary.json` / `*.exit`**。
- **トラブルシュート（Phase 5 追補）**
  - **`operator` が overview に無い**: Pi5 `api` が当該コミットで再構築済みか（`docker compose` ログ・`deploy-status`）。
  - **シナリオ選択がポリシー変更後も古いまま**: 管理 UI は **`operator` 更新で無効化された選択を主要シナリオへ差し替え**（テスト: `DgxResourceOperatorConsole.test.tsx`）。
  - その他は Phase 4 節（Stale 409・途中失敗・強制リロード）を併読。

## Phase 5 UI（運用コンソール再設計）（Web のみ・本番反映）

- **概要**: API／型契約は変更せず、**管理 SPA の情報設計と視認性**を整理。**`dgxResourceUi.ts`** で Tailwind トークンと **`shouldShowMonitoringPanel`** を単一化。**運用コンソール**は StatusBar（ポリシーバッジ・業務推論ドット・注意件数・Comfy 抑止ヒント等）＋ワークロードカード＋**シナリオ選択とプレビューボタンの分離**（誤タップでの即 PREVIEW を防止）。**右カラム**は Spark を 1 行＋`<details>`、**運用監視ヒント**は条件付き表示。
- **Button 方針**: **`ghost`** はライト背景互換の **`text-slate-800`** を維持。ダークパネルは **`ghostOnDark`**。停止系は **`danger`**。
- **注意バッジ件数**: **`overview.monitoring.alerts.length` のみ**。`operatorSummary.alertPreviewJa` はサーバが **`monitoring.alerts` 先頭から生成**する要約配列のため、UI で **二重加算しない**（デプロイ前コードレビューで是正）。
- **本番反映（記録）**
  - **ホスト**: `raspberrypi5` のみ（`--limit raspberrypi5`）
  - **ブランチ**: `feat/dgx-resource-ui-redesign`（代表コミット **`d449b655`**）
  - **Detach Run ID**: **`20260503-131606-21654`**（`PLAY RECAP`: **`ok=130` `changed=4` `failed=0` / `unreachable=0`**・exit **`0`**・`--follow` 約 **347s**）
  - **自動実機検証**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **125s**）
- **トラブルシュート**: **監視パネルが無い＝異常ではない**（正常・ヒント不要時は StatusBar に集約）。**409 Stale・ガイド途中失敗**は Phase 4／5 API 節どおり。**キャッシュ**は [verification-checklist.md](../guides/verification-checklist.md) §6.6.4。

## Phase 6（目的別ガイド / post-policy Comfy）（API+Web・本番反映）

- **UI**: 主操作を **目的別 4 シナリオ** に固定並び（`dgxResourceTaskFlows.ts` の `orderPrimaryScenarioActions`）。状態要約 **`DgxResourceCurrentStateSummary`** とプレビュー実行 **`DgxResourcePrimaryScenarioFlow`** を分離。保守詳細は **`DgxResourceAdvancedControls`** で折りたたみ（サービス単位グリッド／Spark・監視・手動モード）。複合運用パネルの実行ボタン文言は **「この内容で実行する」** に統一。
- **API**: `buildPostPolicyOrchestrationSteps` が **`business_to_private` + `comfyRuntimeConfigured`** のとき **`private-comfyui start`** を返す。**Phase 7** で **`business_to_experiment` + 実験ランタイム設定** に **`experiment-lab start`** を追加し、プラン指紋は **`postPolicyStarts`**（**`private-comfyui` / `experiment-lab` の列**）へ一般化（旧単一フラグ **`postPolicyPrivateComfyStart`** は置換）。ワークロード遷移は **事前調停 → `setPolicyMode` → post-policy**。型は **post-policy の `targetId` を `WorkloadAdjustmentStep['targetId']` と揃え**、`tsc -p tsconfig.build.json` と Vitest で整合させる。
- **本番反映（記録）**
  - **ホスト**: `raspberrypi5` のみ（`--limit raspberrypi5`。Pi4／Pi3 **no hosts matched**・**Pi3 個別 Ansible 適用なし**）
  - **ブランチ**: `feat/dgx-resource-ui-task-first`（代表 **`5ac0f17d`**）
  - **Detach Run ID**: **`20260503-140320-20910`**（`PLAY RECAP`: **`ok=130` `changed=4` `failed=0` / `unreachable=0`**・exit **`0`**・`--follow` 約 **651s**）
  - **自動実機検証**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **113s**。Pi5 以外は疎通検証のみ）
- **トラブルシュート（追補）**: **ガイドに Comfy の POST が出ない**: Pi5 の **`DGX_RESOURCE_PRIVATE_COMFYUI_RUNTIME_*`** が両方未設定またはシナリオが `business_to_private` でないことを確認。**既に私用OKで Comfy だけ起動**するケースでもプレビューに警告が付くことがある → プレビュー文とイベントログで **べき等性・二重送信**を確認。[deployment.md](../guides/deployment.md) 当該補足を参照。

## Phase 7（運用 UI の最小化・補助ランタイム実運用・実験シナリオ整合）（API + Web + DGX gateway + Ansible）

### 概要（仕様）

- **Web**: メイン画面は **現在状態のチップ一行** と **目的別 4 操作** に絞る。**KPI ストリップ・運用監視パネル・イベントタイムライン**はメインから外し、**「詳細・保守（通常は不要）」** の折りたたみ内へ（ポリシー手動変更・Control Target グリッド・従来の詳細など）。主シナリオは **`DgxResourcePrimaryScenarioFlow`** で、利用者操作は **確認ダイアログ後にプレビュー→実行を連続**（**別ボタンのプレビュー専用 UI は廃止**。**`planFingerprint` はフロントで煽らない**。イベント・詳細ログは **API `/events` とサーバ側**が正本）。
- **API**: **`business_to_experiment`** で **`experimentLabRuntimeConfigured`** のとき、ポリシー適用後の **post-policy に `experiment-lab` `start`** を含める（**`business_to_private` の Comfy と同様のパターン**）。プラン指紋は **`postPolicyStarts`**（**`private-comfyui` / `experiment-lab` の列**）へ集約。**型**: post-policy の `targetId` は **`WorkloadAdjustmentStep`** と揃え、`build` は **`tsconfig.build.json`** で検証。
- **DGX `gateway-server.py`（`38081`）**: **`private-comfyui`** の **`GET /private-comfyui/health`** は **読取プローブ用に認証を要求しない**（Pi5 からのヘルスが **403** になると overview が更新されない問題の是正）。**`experiment-lab`** は **`experiment_lab_health_mode`**（既定 **`container`**）で **`docker ps`** によりコンテナ稼働を見る。**`http`** にすると従来どおり HTTP プローブ。**実験コンテナ起動スクリプト**は **`control-server.env` を source** して **`BLUE_SERVER_IMAGE` / `TRTLLM_SERVER_IMAGE`** 等をコンテナモードで供給。
- **Ansible**: [`inventory.yml`](../../infrastructure/ansible/inventory.yml) の **`raspberrypi5`** に **`api_dgx_resource_*`**（メトリクス・各ヘルス URL・補助ランタイム POST URL・タイムアウト・トークン鍵）をマッピング。[`vault.yml.example`](../../infrastructure/ansible/host_vars/raspberrypi5/vault.yml.example) に **`vault_api_dgx_resource_*`** のプレースホルダ。**`ansible_connection: local`** は Pi5 実運用では使わず **SSH + become** で sudo を渡す（ローカル sudo 対話回避）。

### リポジトリ上の代表コミット（記録）

- **`feat(web): simplify DGX resource screen to task-first flow`** — **`956cccf7`**
- **`feat(dgx): align scenario execution with runtime health visibility`** — **`0a136ce9`**

### トラブルシュート（Phase 7）

| 症状 | 典型原因 | 確認・対処 |
| --- | --- | --- |
| **`DGX_TARGET_ACTION_NOT_SUPPORTED`**（Comfy / 実験） | Pi5 に **`DGX_RESOURCE_*_RUNTIME_START_URL` と `_STOP_URL` が両方無い** | Ansible / `.env` と API ログ（endpoint missing）。inventory の **`api_dgx_resource_*`** がテンプレへ渡っているか |
| 実験 **`start` がコンテナ環境変数エラー** | DGX で **`control-server.env` 未読込** | gateway の実験 start が **`control-server.env` を source** しているか、DGX 側ファイルに **`BLUE_*` / `TRTLLM_*`** があるか |
| Comfy **`overview` が stopped/unknown のまま** | **`GET …/private-comfyui/health` が 403** 等 | gateway でヘルス経路が **トークン不要**か、URL が Pi5 から到達可能か |
| **`experiment-lab` がずっと unknown** | HTTP **`v1/models` が立ち上がり直後 502** | 既定 **`experiment_lab_health_mode=container`** と **`experiment_lab_container_name`**（例: **`system-prod-trtllm`**）でコンテナ生存を見る |

### 本番反映メモ

- 上記コミットは **`main`** に載せたうえで、運用側は **`./scripts/update-all-clients.sh main … --limit raspberrypi5`** が標準（ブランチ先行検証済みなら **`main`** に統一）。
- **Detach Run ID** は環境実行ごとに変わるため、本 KB の正本は **`PLAY RECAP` failed=0 / `summary.json` / `*.exit`** とこの Phase 節の **コミット SHA** とする。

## Phase 8（KPI 先頭・説明削減・全文可読）（Web のみ・本番反映）

### 概要（仕様）

- **Web**: `/admin/tools/dgx-resource` の先頭に **`overview.kpis`** を **KPI ストリップ**として表示。狭い幅では **横スクロール**、広い幅では **均等伸長**。KPI の表示モデルは **`dgxResourceKpiStripModel.ts`** に分離し、React 非依存の純関数としてテスト固定。
- **運用導線**: 読み込み完了後の **`h1「DGX リソース」`** と **「4つの操作だけ…」説明**を削除。シナリオカードの **絵文字**も削除し、主要画面は **KPI + 状態チップ + 4 操作**により短く読む前提へ寄せる。
- **可読性**: KPI 値、シナリオ説明、Spark `errorBrief` / `probeUrl` は **`truncate` を廃止**し、**`break-words` / `break-all`** で全文を読めるようにした。Spark 詳細の `probe` 行は **`minmax(0,1fr)`** の grid に変えて長い URL を潰さない。
- **後方互換**: ロード中だけは従来どおり **`DGX リソース` + 読み込み中**を出し、既存の overview/operator 契約は変更しない。

### リポジトリ上の代表コミット（記録）

- **`feat(web): simplify DGX dashboard into a KPI-first operator view`** — **`89f65a7c`**

### 本番反映（記録）

- **ホスト**: **`raspberrypi5` のみ**（`--limit raspberrypi5`。Pi4／Pi3 play **no hosts matched**）
- **ブランチ**: **`feat/dgx-resource-dashboard-ui-phase8`**（**`main` 取り込み後の標準運用は `main`**）
- **Detach Run ID**: **`20260503-181600-946`**（`PLAY RECAP`: **`ok=130` `changed=4` `failed=0` / `unreachable=0`**・exit **`0`**・ローカル `--follow` 完了まで **約 666s**）
- **自動実機検証**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **118s**）

### トラブルシュート（Phase 8）

| 症状 | 典型原因 | 確認・対処 |
| --- | --- | --- |
| **UI が旧のまま** | Pi5 の `web` が旧コミット / SPA キャッシュ | Pi5 の deploy SHA とブラウザの **強制リロード**（[verification-checklist.md](../guides/verification-checklist.md) §6.6.4） |
| `update-all-clients.sh` の preflight で **`raspberrypi5 | UNREACHABLE! Permission denied (publickey)`** | **Pi5 自身の公開鍵が Pi5 の `authorized_keys` に無い**ため、Pi5→Pi5 self-SSH が失敗 | Pi5 で **`ssh -o BatchMode=yes denkon5sd02@100.106.158.2`** を確認し、必要なら **`~/.ssh/id_ed25519.pub`** を `authorized_keys` に追加 |
| lock 取得で **`LOCKED: age=... timeout=2400s`** のまま進まない | preflight 失敗などで **`runner=bootstrap` / `runPid=null`** の lock が残存 | deploy artifact / 実行中プロセスが無いことを確認してから **lock を退避・削除**し再試行（詳細は [Ansible/デプロイ KB](./infrastructure/ansible-deployment.md)） |

## Phase 9（Orchestration Strict Ready）（API + Web）

### 概要（仕様）

- **`EXECUTE_ORCHESTRATION_SCENARIO` の API が成功になる条件** を、POST 送信完了だけではなく **Strict Ready フェーズの達成まで**含めた。
- **業務復帰**（`private_to_business` / `experiment_to_business`）：ゲートウェイ health 正常かつ **`/v1/models` 応答まで**プローブ。`LOCAL_LLM_RUNTIME_MODE=on_demand` かつランタイム起停が揃っている場合、未準備なら **`/start` を 1 回だけ**試みる。待機時間・間隔は **`LOCAL_LLM_RUNTIME_READY_TIMEOUT_MS`** / **`LOCAL_LLM_RUNTIME_HEALTH_POLL_INTERVAL_MS`**。
- **私用開始**（`business_to_private` で Comfy POST 両方あり）：**`DGX_RESOURCE_COMFYUI_HEALTH_URL` が設定されていること**を前提にヘルス準備まで確認（未設定環境ではガイド自動化の前提を満たさない）。
- **実験開始**（`business_to_experiment` で実験ラボ POST あり）：**`DGX_RESOURCE_EXPERIMENT_LAB_HEALTH_URL` が必須**。HTTP で見えない実験コンテナはガイド完了扱いにできない。
- **安定判定**：各ゲートが **連続 2 サンプル**成功で Ready。
- **タイムアウト時の安全ロールバック**：運用モードを **ガイド前のモードへ復帰**。合わせて、私用開始失敗後は **`private-comfyui` stop**、実験開始失敗後は **`experiment-lab` stop** を試行（設定されている場合）。gateway の任意起停は逆操作に使わない。
- API 応答 `scenarioExecute` に **`readinessChecksJa` / `readinessSummaryJa` / `rollback`** を追加（省略可能フィールドとして消費側は後方互換）。

### 本番反映記録（2026-05-03）

- **ホスト**: **`raspberrypi5` のみ**（`--limit raspberrypi5`。Pi4／Pi3 play **no hosts matched**。**Pi3 個別デプロイ不要**）
- **ブランチ**: **`feat/dgx-resource-ready-guarantee`**（**`main` 取り込み後は `main` が正**）。代表 **`8cbc6f38`**
- **Detach Run ID**: **`20260503-194121-32704`**（`PLAY RECAP`: **`ok=134` `changed=4` `failed=0` / `unreachable=0`**・exit **`0`**・ローカル `--follow` 約 **684s**）
- **自動実機検証**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **89s**）

**知見**: Phase12 は DGX のシナリオ Strict Ready を **直接スモークしない**。運用でのガイド成否は **`scenarioExecute.readiness*`** と管理コンソール表示、および API コンテナログで追う。

### トラブルシュート（Phase 9）

| 症状 | 典型原因 | 確認・対処 |
| --- | --- | --- |
| Inference Ready タイムアウト | cold start が **`LOCAL_LLM_RUNTIME_READY_TIMEOUT_MS`** を超える | Ansible / 実測に合わせてタイムアウトを検討（Runbook） |
| `private_comfy` 未達 | Comfy ヘルス URL が未到達 | トンネル・gateway 側 `/private-comfyui/health` と Pi5 の `DGX_RESOURCE_COMFYUI_HEALTH_URL` |
| `experiment_lab` 未達 | ヘルス URL 未設定 / 502 直後 | **HEALTH URL** 設定、または gateway の **container health モード**（Phase7 gateway 項） |

## Phase 10（DGX KPI メトリクス・`GET /system/metrics`）（API + gateway）

### 概要（仕様）

- **`DGX_RESOURCE_METRICS_URL` が未設定**のとき、Pi5 API は admin LocalLLM の **`LOCAL_LLM_BASE_URL`** に対し **`GET /system/metrics`**（**`X-LLM-Token`** = 共有トークン）→ 失敗時 **`GET /v1/system/metrics`** の順で KPI 用 JSON を取得する。
- DGX **`gateway-server.py`** は **`GET /system/metrics`** で **`gpuUtilPct` / `unifiedMemoryUsedGiB` / `unifiedMemoryTotalGiB` / `freeMemoryGiB`** を返す。**`/v1/*` と同様** **`X-LLM-Token` が `LLM_SHARED_TOKEN` と一致**しない場合は **403**。収集不能時は **503**（JSON `gpu_metrics_unavailable`）。
- GPU メモリが `nvidia-smi` で **`[N/A]`** の環境（例: Spark unified memory）では **`free -b`** の **`Mem:`** 行から used/total を算出して埋める。

### 本番反映記録（2026-05-03）

- **ホスト順序**: **① `raspberrypi5` のみ**（Ansible `--limit raspberrypi5`）→ **② DGX**（tailnet **`100.118.82.72`**、`gateway-server.py` を **`/srv/dgx/system-prod/bin/`** へ配置してゲートウェイ再起動）。Pi4／Pi3 は対象外。
- **ブランチ**: **`feat/dgx-kpi-metrics-fallback`**。**代表コミット**: **`47a17096`**（トークン保護を含む。先行 **`a3b67495`** は KPI フォールバック本体）。
- **Pi5 Detach Run ID**: **`20260503-211051-8713`**（`PLAY RECAP`: **`ok=134` `changed=4` `failed=0` / `unreachable=0`**・exit **`0`**）。
- **DGX 再起動（実績）**: `scp … gateway-server.py` 後、Runbook の **`sudo systemctl restart dgx-llm-gateway`** は **当該ユーザーに sudo が無く未実行**。当該ホストでは **`dgx-llm-gateway` が inactive** で **`start-gateway-server.sh`** によるプロセス常駐だったため、**既存 Python プロセスを終了**してから **`/srv/dgx/system-prod/bin/start-gateway-server.sh`** を実行し **`/healthz` 200** を確認した。**systemd 常駐へ寄せる場合**は Runbook の **`install-systemd-units.sh`** 節に従う。
- **自動実機検証**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**。

### トラブルシュート（Phase 10）

| 症状 | 典型原因 | 確認・対処 |
| --- | --- | --- |
| **`kpis` がすべて null** | API が旧／gateway が旧／順序ずれでトークン未送信 | Pi5 **`api` のデプロイ SHA** と **DGX の `gateway-server.py` の更新時刻**。overview の **`notes`**（メトリクス取得失敗メッセージ） |
| **`GET /system/metrics` が 403** | **`X-LLM-Token` 不一致**またはヘッダ欠落 | Pi5 の **`LOCAL_LLM_SHARED_TOKEN`** と DGX **`LLM_SHARED_TOKEN`**（secret ファイル）の整合 |
| **`503` `gpu_metrics_unavailable`** | `nvidia-smi` 失敗かつ **`free -b` パース失敗** | DGX で **`nvidia-smi`** と **`free -b`** を直接確認 |

## Phase 11（進行中表示の持続化・長時間切替の運用解釈）（Web + Runbook）

### 概要（仕様）

- **進行中表示の二系統化**: DGX 画面の切替中表示は、`DgxResourcePrimaryScenarioFlow` の `busy`（`flowBusy`/`actionBusy`/`globalPending`/`externalBusy`）に加え、`DgxResourceDashboard` 側で **イベントログ由来の実行判定**と **`sessionStorage` の pending** を併用して表示する。
- **表示文言の明確化**: 切替中は `role="status"` で **`進行中:`** を含むメッセージを常時表示し、タブ移動後に復帰しても「処理継続中」であることを明示する。
- **イベント反映待ちの保険**: `Strict Ready` 開始イベントの到着遅延時は、`sessionStorage` 側 pending（TTL 20分）で暫定的に `進行中` を維持し、イベント到着後に正式判定へ移行する。

### 本番反映記録（2026-05-04）

- **ホスト順序**: **① `raspberrypi5` のみ**（Ansible `--limit raspberrypi5`）→ **② DGX**（**`gateway-server.py`** を **`/srv/dgx/system-prod/bin/`** へ **`scp`** しゲートウェイ再起動）。Pi4／Pi3 は対象外。
- **ブランチ**: **`main`**。代表コミット **`5d96b59b`**（[PR #246](https://github.com/denkoushi/RaspberryPiSystem_002/pull/246)）。
- **Pi5 Detach Run ID**: **`20260504-113918-744`**（`PLAY RECAP`: **`ok=134` `changed=4` `failed=0` / `unreachable=0`**・exit **`0`**・`--follow` 約 **702s**）。
- **DGX 再起動（実績）**: **`sudo systemctl restart dgx-llm-gateway`** は **非対話 sudo 不可**。**`dgx-llm-gateway` は inactive** のため **`/srv/dgx/system-prod/bin/start-gateway-server.sh`** で復旧。**`pkill -f` を広く当てる**と誤停止し得る → **正規は `start-gateway-server.sh`**（PID ファイルと二重起動ガードあり）。
- **自動実機検証**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **109s**）。

### 運用知見（2026-05-04）

- **`private_to_business` が約10分**: DGX Spark / Blackwell 系では cold start（`torch.compile`/CUDA graph 捕捉を含む）で数分〜10分級になるケースがあり得る。今回の実測でも `Strict Ready` が終端するまで待機が必要だった。
- **`business_to_private` が約1分でメモリ低下**: `experiment-lab stop` が有効に通る構成では、業務系の重いワークロードが外れてメモリが低下する挙動は整合的。
- **GPUメモリの瞬間スパイク**: 切替中に一時スパイクすることはあり得るため、単点値より **シナリオイベント（開始/完了/失敗）** とセットで判断する。

### トラブルシュート（Phase 11）

| 症状 | 典型原因 | 確認・対処 |
| --- | --- | --- |
| タブ復帰後に進行中表示が見えない | ローカル state のみで busy 判定していた / イベント到着遅延 | `sessionStorage` pending と `GET /system/dgx-resource/events` の両方で判定する実装へ統一。画面は `進行中:` 表示を優先 |
| `private_to_business` が長い（5〜10分） | cold start（モデルロード/初期化） | まずイベントログで `Strict Ready: ... 開始` と終端（確認/timeout）を確認。タイムアウト頻発時のみ `LOCAL_LLM_RUNTIME_READY_TIMEOUT_MS` を見直し |
| `補助ランタイム制御が拒否または失敗` | `experiment-lab`/Comfy の stop hook が 502/timeout、または片系のみ成功 | Control Targets と `/events` で部分成功の有無を確認し、Runbook の単発復旧手順（対象ランタイム再停止→再試行）を実施 |
| KPI値がモード切替に追随しないように見える | 表示更新遅延 / gateway 側メトリクス更新待ち | `/overview` の `kpis` と `notes` を確認し、`/system/metrics` 応答・トークン整合を再確認（Phase 10 手順） |
| DGX **`healthz` が不通**（`gateway-server.py` 更新直後） | 手動 **`pkill`** の誤マッチでプロセス停止 / 再起動未実施 | `ps` / `pgrep --full` で **`/srv/dgx/system-prod/bin/gateway-server.py`** のみを確認。**`/srv/dgx/system-prod/bin/start-gateway-server.sh`** で起動（**広い `pkill -f` は避ける**） |

## Phase 12: DGX control-server single-active guard (2026-05-06)

（JP）**単一アクティブ運用ガード**を DGX の **`control-server.py` に本番反映した記録。**対象は DGX のみ**（Pi5 Ansible なし）。

### 概要（仕様）

- **`POST /start` 前の強制整理**: `ACTIVE_LLM_BACKEND` に対して **非アクティブ側**へ **実 stop** を先に実行し、続けてアクティブ側の start を実行する（[`dgx_llm_single_active_guard.py`](../../scripts/dgx-local-llm-system/dgx_llm_single_active_guard.py) で判定・コマンド解決を集約）。
- **起動時検証**: ガード既定 ON のとき、**green/blue 双方の hard-stop が解決できること**を **`control-server.py` 起動時**に検証。片系だけしか設定しないホストでは **起動拒否**となる（**`DGX_LLM_SINGLE_ACTIVE_GUARD=false` は検証・移行用**。本番 `system-prod` では **両方の stop を揃えて ON 維持**）。
- **`keep_warm` との関係**: **`BLUE_LLM_RUNTIME_STOP_MODE=keep_warm`** 等は **アクティブが blue のときの `/stop` のみ** no-op になり得る。**非アクティブ側を止める処理には適用されない**。

### 本番反映記録（2026-05-06）

- **ホスト**: **DGX のみ**（Pi5 の Ansible・Pi4／Pi3 は **対象外**）。
- **配置ファイル**: **`control-server.py`**・**`dgx_llm_single_active_guard.py`**・**`stop-llama-server.sh`**・**`stop-trtllm-server.sh`** を **`/srv/dgx/system-prod/bin/`** へ **`scp`**。**`dgx_llm_single_active_guard.py` は `control-server.py` と同ディレクトリ必須**。
- **再起動**: **`start-control-server.sh` が「既に起動中」と判定すると `exit 0` で終わり、新コードを読まない**。反映後は **`control-server.pid` のプロセスを明示停止**してから **`start-control-server.sh`** を実行する（gateway は **本変更では再起動不要**）。
- **実機確認（一例）**: **`ACTIVE_LLM_BACKEND` が `control-server.env` / `gateway-server.env` で一致**・`38081/healthz` **200**・`/v1/models` に **`system-prod-primary`**・（blue active 時）**`38082` が listen していない**・**`llama-server` が残っていない**。

### トラブルシュート（Phase 12）

| 症状 | 典型原因 | 確認・対処 |
| --- | --- | --- |
| **`scp` 後も挙動が古い** | **`start-control-server.sh` の PID ガード**で旧プロセスが継続 | `/srv/dgx/system-prod/logs/control-server.pid` を確認し **該当 PID を停止**→ **`rm -f` PID ファイル**→ **`start-control-server.sh`** |
| **`control-server` が起動しない**（すぐ終了） | **片系だけ stop が設定**されガード ON | **`GREEN_LLM_RUNTIME_STOP_CMD` / `BLUE_LLM_RUNTIME_STOP_CMD`** と **`LLM_RUNTIME_STOP_CMD`**（フォールバック）を Runbook どおり **両 backend で解決できる形**に揃える（暫定のみ **`DGX_LLM_SINGLE_ACTIVE_GUARD=false`**） |
| **`ModuleNotFoundError: dgx_llm_single_active_guard`** | guard ファイルが **`bin/` に無い**／パス不一致 | **`dgx_llm_single_active_guard.py` を `control-server.py` と同じ `/srv/dgx/system-prod/bin/` に配置** |

## References

- [dgx-system-prod-local-llm.md](../runbooks/dgx-system-prod-local-llm.md)（管理コンソール節・Phase3 説明）
- [KB-364](./KB-364-dgx-blue-vllm-comfyui-gpu-contention.md)
- [KB-366 DGX Spark 運用理解](./KB-366-dgx-spark-operational-understanding.md)（メモリ・KPI・モード切替・27B/35B）
- [ADR-20260502-dgx-resource-control-targets.md](../decisions/ADR-20260502-dgx-resource-control-targets.md)
- [ADR-20260503-dgx-resource-operator-console.md](../decisions/ADR-20260503-dgx-resource-operator-console.md)
