---
title: "Runbook: DGX Spark system-prod LocalLLM 段階切替"
tags: [運用, DGX Spark, LocalLLM, llama.cpp, Tailscale, on_demand]
audience: [運用者, 開発者]
last-verified: 2026-05-10
related:
  - ./local-llm-tailscale-sidecar.md
  - ../plans/dgx-spark-local-llm-migration-execplan.md
  - ../decisions/ADR-20260329-local-llm-pi5-api-operations.md
  - ../decisions/ADR-20260402-inference-foundation-phase1.md
  - ../decisions/ADR-20260403-on-demand-local-llm-runtime-control.md
  - ../decisions/ADR-20260502-dgx-resource-control-targets.md
category: runbooks
update-frequency: high
---

# Runbook: DGX Spark system-prod LocalLLM 段階切替

> **現行の節**: 業務 GLM / DeepSeek 切替、私用 Pi5 `stackchan-bridge` との区別、管理コンソール（2026-10-17 以降は [ADR-20261017](../decisions/ADR-20261017-dgx-resource-business-llm-only.md) が正本）、`/dev/shm` の週次掃除、GB10 性能パラメータ、GLM-5.3-Flash 切替、Nemotron 3.5 段階導入。2026-04〜06 の移行判断ログ、Phase A/B の段階切替、Ubuntu への rollback は履歴であり、現行手順ではない（[履歴 archive](../archive/runbooks/dgx-system-prod-local-llm-history-2026-04-06.md)）。本文の「本番反映（…）」記録にある `export RASPI_SERVER_HOST=…` と `--detach --follow` は当時のコマンドで、現行の入口では使えない。Pi5 のデプロイは [deployment guide](../guides/deployment.md)、復旧は [deploy-status-recovery.md](./deploy-status-recovery.md) に従う。

## 目的

- DGX Spark の `system-prod` を、Pi5 API が使う業務 LocalLLM（写真持出 VLM・要領書要約・管理 Chat など）として運用する
- Pi5 API が期待する `/healthz`、`/v1/chat/completions`、`/start`、`/stop` の運用形を維持する

## 業務 GLM / DeepSeek 切替（既定 off）

`BUSINESS_DEEPSEEK_SWITCH_ENABLED=false` が既定。API / gateway / control-server と、その子のadapterへ同じ値を渡す。
CP側は別の `DGX_BUSINESS_DEEPSEEK_SWITCH_ENABLED`。片側のみon、CP capabilityの404・不達・契約版違いでは管理画面の選択を受け付けない。

1. 別途承認されたoperator作業で、専用kit `/srv/dgx/system-prod/kits/deepseek-v41-flash-tp2` を
   `f424dfe3b14ac9f02fe12f5777c852dba967a79a` に固定する。kitのworker SSHは
   `ubudgxkoushi@192.168.100.10`（Spark 1）とし、専用SSH認証を事前設定する。
   **業務用のprepare・build・download・モデルコピーは行わない。** 所有者の決定により業務もprivateと同じ
   uncensoredモデル（`ABLIT=1`、EAQ v1、overlay `0bdc2036113c4fdda38ef6005b3cbc0bc0dfa0f0`）を使う。
   公開モデル成果物にユーザーデータは含まれず、両Sparkの既存image `tensorfold-dsv41:exl3-tp2-<hash>` を再利用する。
   Spark 2（head、`192.168.100.11`）の `/srv/ssd/hf`、その下の
   `tensorfold-dsv41/878f5689-ablit-0bdc2036` と `tensorfold-dsv41/kit-abe07c7d`、Spark 1の
   `/home/ubudgxkoushi/.cache/dsv41-tensorfold/engram-1bae0e10` と
   `/home/ubudgxkoushi/.cache/dsv41-tensorfold/rank-cache-878f5689-ablit-0bdc2036` がprivate側で準備済みであることを確認する。
   Spark 2の `/home/ubudgxkoushi/.local/state/dsv41-tensorfold/prepared` を読み取り専用で参照する。
   markerの完全なmodel revisionは `878f5689` prefix必須で、業務markerの作成・コピーは不要。
   marker照合ではworkerパスのリテラル `$HOME/` を `/home/ubudgxkoushi/` へ、既存/業務のNFS volume名だけを正規化し、
   他の全設定・image identity・template hashの一致、rank index identity、Engram shardサイズを検査する。
   不一致や欠落は停止前に拒否する。修復はprivateの所有者が別途行い、業務から共有成果物やprivate stateを更新しない。
2. Spark 2のNFS export `/srv/ssd/hf` が **Spark 1 (`192.168.100.10`) とhead自身 (`192.168.100.11`) の双方にro**
   で公開されていることを確認する。既存 `/etc/exports` のworker向け `192.168.100.10(ro,no_subtree_check)` を保持し、
   head向けの許可がなければ同じexportへ `192.168.100.11(ro,no_subtree_check)` を追加し、通常のNFS設定反映手順を使う。
   以下を各ホストで実行する（既存volumeがあれば削除・作り直しせず、同じdevice/serverかつ `ro`、`rw` なしをinspectで確認して再利用する）。

   ```bash
   # Spark 1: worker用の業務volume
   docker volume create --driver local --opt type=nfs --opt device=:/srv/ssd/hf \
     --opt o=addr=192.168.100.11,nfsvers=4.2,ro,nconnect=8,rsize=1048576,wsize=1048576,hard,timeo=600 business-dsv41-hf
   # Spark 2: head用の業務volume
   docker volume create --driver local --opt type=nfs --opt device=:/srv/ssd/hf \
     --opt o=addr=192.168.100.11,nfsvers=4.2,ro,nconnect=8,rsize=1048576,wsize=1048576,hard,timeo=600 business-dsv41-hf-head
   # 各ホスト: 上記volume名で確認
   docker volume inspect <volume-name>
   ```

   両Sparkで業務実行ユーザー所有の実ディレクトリを作成する（symlink不可）。

   ```bash
   install -d -m 0700 /srv/dgx/system-prod/state/deepseek-v41 \
     /srv/dgx/system-prod/state/deepseek-v41/logs \
     /srv/dgx/system-prod/logs/deepseek-v41 \
     /srv/dgx/system-prod/data/deepseek-v41/{home,hf,tmp,cache,spill}
   ```

   shared dirsも指定の絶対パスに存在する実ディレクトリでなければ拒否する。
   HOME・HF_HOME・XDG cache・tmp・spill・lock・generation・launcher/memguard PID・ログは業務領域に分離する。
   `SPILL_GIB=0` / `SPILL_WEIGHTS_SHA=0` を固定し、共有rank cache内のハッシュキャッシュ作成を防ぐ。
   起動ログは10世代・7日以内、コンテナのprompt/応答ログは破棄する。
   portは8889（fabric IP bind、Spark 1 gatewayのみ許可）、container名は `business-dsv41-1017-exl3-tf`、
   served nameは `system-prod-primary`。privateの8888は業務LAN/Piから遮断する。
   Spark 2の `/srv/dgx/system-prod/state/deepseek-v41/api-key` にprivateと異なる非空の業務API keyを0600で配置し、
   `API_KEY=1` とgateway/control-serverの `BUSINESS_DEEPSEEK_UPSTREAM_API_KEY` に安全に供給する。
   secretはGit外のroot所有0600 storeへ置く。実機でログ本文抑止・分離を確認できるまで有効化しない。
   Spark 1の配置済みadapterから `BUSINESS_DEEPSEEK_SWITCH_ENABLED=true python3 /srv/dgx/system-prod/bin/business_tensorfold.py check`
   を実行し、共有準備検査の成功を確認する。この単発の検査以外は既定offを維持する。
3. 正常なGLM active JSONから、先に業務flagをonにしてcontrol-serverを起動する。
   `selectedBusinessProfileId=business_glm53_flash_fp4_tp2`、非負整数 `selectionRevision`、
   `businessTransition=idle|loading|ready|failed` の初期化を確認する。private active・欠落・壊れたstateでは移行を拒否する。
   control-serverが `<DGX_ACTIVE_MODEL_STATE_PATH>.lock` を作成する。gatewayにはstateディレクトリの
   traverse権限とstate JSON / lockの読み取り権限を付与する。共有flockは読み取り専用で開き、gatewayの書き込み権限は不要。
4. 次にCP flagをonにし、業務principalで `GET /system/business-model-switch-capability` が
   `{"enabled":true,"contractVersion":1}` を返すことを確認してから、配置済みbusiness DeepSeek manifestをenabledにする。
   既存「DGXリソース」の一覧から選択し、通常/SSEのalias、画像拒否、両rankの世代・停止/GPU解放、
   再起動/keep-warm/private解放後の選択保持を確認する。準備済み生成readyは900秒目標、1200秒上限。

rollbackは両gateをonのまま停止証明→GLM明示選択→ready確認、その後 **CP flag off→業務flag off** の順。
DeepSeek稼働中にflagを先に戻さない。privateの既存データは削除しない。

業務DeepSeek（tensorfold）は `response_format` / `guided_*` を受け付けない。gatewayは業務DeepSeek宛ての
`/chat/completions` からこれらを外し、JSONオブジェクトだけで答える指示（schemaがあれば併記）をsystemに足す。
非ストリーム応答は本文から `<think>` とコードフェンスを除いてJSONオブジェクトを取り出し、`content` を置き換える。
取り出せない本文はそのまま返す。GLM宛ての要求は変えない。この変更はPi5の標準デプロイでは反映されず、
`gateway-server.py` を `/srv/dgx/system-prod/bin/` へ配置してgatewayを再起動したときに効く。

control-server再起動時、監視threadのない `loading` は `failed` / `business_control_restarted` に遷移する。
次の `/start` で新しいgenerationを起動する。kitの置換anchor不一致は `business_kit_layout_mismatch` として
停止前に拒否する。完全な準備検査はstart前または `business_tensorfold.py check` だけで実行し、statusはprepared markerを参照する。
`gpuReleased` は業務コンテナのプロセスがGPUを解放した状態を表す。停止確認は業務の8889 / 38083と対象コンテナに限定し、
privateの8888やComfyUIのGPU利用は停止条件に含めない。

## 私用 Pi5 `stackchan-bridge` との区別（境界・read-only）

- **本 Runbook の主対象**は **職場 Pi5 API** が **`LOCAL_LLM_*`** 経由で扱う **DGX system-prod gateway**（単一キュー・用途別 keep-warm 含む）。
- **自宅の StackChan 等**は `scripts/private-pi5-stackchan-bridge`（DGXSparkControlPlane へ移動） により **私用 Pi5 から DGX へ直接** HTTP する。**職場 Pi5 API の `stackchan_chat` 契約とは別系統**（JWT・キューを通さない）。**2系統の正本**: 計画 §2系統（DGXSparkControlPlane `docs/private-history/plans/stackchan-private-pi5-tailnet-workflow-plan.md`）·[KB-365 §私用 bridge](../archive/knowledge-base/KB-365-dgx-resource-phase3-workload-orchestration.md#private-pi5-stackchan-bridge-boundary-2026-05-10)。

## 管理コンソール: DGX リソース（Pi5 API 経由）

**目的**: ブラウザから疎通・推論可否の目安・運用ポリシー表示、`on_demand` 時の `/start` `/stop` 要求を **Pi5 の API だけ**に閉じ込める（トークンを Web に持たせない）。

**UI ルート**:

- 推奨: **管理コンソール** → `/admin/tools/dgx-resource`
- 後方互換: `/admin/dgx-resource`（`/admin/tools/dgx-resource` へ転送）

> **2026-10-17 以降の正本**: 画面と API は業務 LLM 専用になった（[ADR-20261017](../decisions/ADR-20261017-dgx-resource-business-llm-only.md)）。actions は `RETURN_TO_BUSINESS` / `STOP_BUSINESS_LLM` / `PREVIEW_MODEL_STORAGE_DELETE` / `EXECUTE_MODEL_STORAGE_DELETE` の 4 種だけ。以下に残る `operator`・`targets[]`・`EXECUTE_TARGET_ACTION`・`SET_POLICY`・運用モード・切替シナリオ・`START_MODEL_PROFILE`・実験ラボ・Agent の記述は履歴で、現行の業務画面には無い。個人用ワークロードの起停は DGX 側（Control Plane）で行う。

**サーバ API（管理者・マネージャー）**:

- `GET /api/system/dgx-resource/overview` — ゲートウェイ `/healthz` と `GET /v1/models` に基づく推論バックエンド状態、任意のメトリクス/ComfyUI/埋め込み疎通、**任意の Spark ホスト簡易疎通（`sparkHost`）**。あわせて **標準 Control Target 一覧（`targets[]`）**（`kind`・`capabilities`・`status`）。**後方互換**で同一判定根拠の **`services[]`** も返す。**運用者向け**に **`overview.operator`**（業務 VLM / 私用 Comfy / 実験ラボ / **Agent コンテナ** の要約・主要ガイド操作・注意プレビュー）と **`overview.modelProfiles`**（DGX 正本の業務復帰モデル allowlist・activeProfileId）を返す（表示の正本は引き続き `targets[]`。UI はコンソールを優先し、技術 ID は詳細欄へ）。
- `GET /api/system/dgx-resource/events?limit=…` — UI 操作の直近履歴（プロセス内リングバッファ）
- `POST /api/system/dgx-resource/actions` — 受け付ける `type` は `RETURN_TO_BUSINESS`（`modelProfileId` 指定）/ `STOP_BUSINESS_LLM` / `PREVIEW_MODEL_STORAGE_DELETE` / `EXECUTE_MODEL_STORAGE_DELETE` の 4 種だけ（`apps/api/src/routes/system/dgx-resource.ts`）。
- **`POST /api/system/stackchan/chat`（2026-10-17 削除）** — 業務 Pi5 の StackChan 会話 API と用途 `stackchan_chat` は PR #2095 で削除した（[code-health ExecPlan 段階9](../plans/code-health-refactor-execplan.md)）。2026-05-10 の本番反映記録は [deployment.md §StackChan 本番](../archive/deployments/2026-05.md#stackchan-production-2026-05-10)・[KB-365 §StackChan](../archive/knowledge-base/KB-365-dgx-resource-phase3-workload-orchestration.md#production-2026-05-10-stackchan-pi5-api-chat) に残る。

**運用プロファイル（`SET_POLICY` / `policy.mode`）**:

- `business_first`（**業務優先**）— 本番 VLM/LocalLLM を最優先。**表示上のみ**私用ワークロード抑制のヒント（GPU は強制しません）。
- `private_ok`（**私用OK**）— ComfyUI 等の私用ワークロード向けに **業務 LLM を退避**し、Spark メモリを空ける。
- `experiment_first`（**実験優先**）— lab/実験コンテナ検証寄り。**業務 Inference との競合は人手で確認**してください。

**ワークロード自動調停（`SET_POLICY`・`applyWorkloadChanges: true`）**: UI のチェック有効時、**業務優先へ切替える前に**設定済みの experiment-lab / **agent-container** / Comfy に対して **停止 POST を順に試行**。**私用OKへ切替える前に**は、設定済みなら **experiment-lab と agent-container の停止**に加え、**`system-prod-gateway` へ keep_warm を上書きする強制停止**を試行する。**実験優先へ切替える前に**（設定済みなら）**私用 Comfy の停止 POST のみ**。失敗した時点で API がエラーとなり **`policy.mode` は更新されない**（処理順序により一部 POST は済んでいる可能性あり。**DGX 側 hook はべき等に近い設計を推奨**）。競合関連は [KB-364](../knowledge-base/KB-364-dgx-blue-vllm-comfyui-gpu-contention.md)・[KB-365](../archive/knowledge-base/KB-365-dgx-resource-phase3-workload-orchestration.md)。

**運用理解（Spark・メモリ・KPI・日常手順の正本）**: 業務/私用でメモリ KPI がどう変わるか、写真ラベル・要領書・Hermes が **同一 27B（`system-prod-primary`）を共有**する理由、**green（35B）/ blue（27B）の同時フルロードをしない**設計、**KPI の `Unified Mem`（実測）と vLLM `--gpu-memory-utilization`（上限枠）の違い**、管理 UI の **「切替時にワークロード自動調整」**（**詳細・保守** 内）と **運用ガイド 4 操作**（チェック不要）の使い分けは **[KB-366](../knowledge-base/KB-366-dgx-spark-operational-understanding.md)** に集約。**現場の推奨（2026-10-17 以前の手順・履歴。現行画面に運用ガイドは無い）**: 日常は画面上部の **運用ガイド「業務→私用」** を使う。保守パネルの **「私用OK」だけ** では **チェック OFF だと強制停止が走らない**（確認ダイアログは出るが `applyWorkloadChanges` が false のため）。

**メインAI 制御の直列化（Pi5 API）**: `on_demand` 時、**推論側の `/start`・`/stop`** と **DGX リソース UI 経由の `system-prod-gateway` 起停**は、同一プロセス内の **単一キュー**で直列化される（`local-llm-runtime-command-queue.ts` → `enqueueMainLocalLlmRuntimeControl`）。`private_ok` の **強制停止**も同じキューを通す。待機が長い場合は `main_llm_control_queue_wait` ログで把握可能。

**用途別停止（Pi5 API）**: `photo_label` / `business_hermes` / `security_review` / `document_summary` / `admin_console_chat` / **`agent_container_task`** は **参照カウント 0 でも `/stop` を抑止**（メインAI・Agent コンテナの warm 維持。`stackchan_chat` は 2026-10-17 削除）。**warm 窓**（`LOCAL_LLM_RUNTIME_WARM_WINDOW_*`）は、将来追加される **上記以外の用途**向けの抑止に利用（現行は `LOCAL_LLM_ALWAYS_KEEP_WARM_USE_CASES` の 6 用途）。実装は `local-llm-runtime-schedule.policy.ts` の `shouldSuppressLocalLlmRuntimeStop`。Agent 経路のラッパーは `withAgentContainerTaskOnDemandRuntime`（`local-llm-on-demand-runtime.ts`）。

## Model profile capabilities と runtime ready（2026-05-29） {#model-profile-capabilities-runtime-ready}

- **宣言（manifest）**: `declaredCapabilities`（例: `text`, `vision`）、`visionRequiresMmproj`（green）、`launcherHints`（起動 env ヒント・optional）
- **実測（active state / `GET /system/model-profiles` の `state`）**: `runtimeReadyCapabilities`, `visionReadyReason`（例: `mmproj_detected`, `mmproj_missing`, `blue_native_vlm`）
- **運用判断**: 「profile が vision 可能」と「**今回の起動が vision-ready**」は別。35B で写真 VLM が効かないときは KPI だけでなく **`visionReadyReason`** を確認する
- **Pi5 on-demand intent（opt-in）**: `INFERENCE_RUNTIME_START_PROFILE_ENABLED=true` のときのみ `/start` に `modelProfileId` を付与。既定 `false` は shadow ログのみ（[ADR-20260529](../decisions/ADR-20260529-dgx-profile-capabilities-runtime-intent.md)）

## 業務 profile スコープ runtime readiness（2026-05-29） {#business-profile-scoped-runtime-readiness}

- **ねらい**: 35B 切替直後の `photo_label` が HTTP ready だけで通過してタイムアウトするのを防ぎ、**profile 一致 + vision capability** を Pi5 on-demand / 業務復帰 Strict Ready で検証する。
- **KB**: [KB-365 §profile-scoped readiness](../archive/knowledge-base/KB-365-dgx-resource-phase3-workload-orchestration.md#business-profile-scoped-runtime-readiness) · [KB-366 §35B 写真ラベル](../knowledge-base/KB-366-dgx-spark-operational-understanding.md#35b-photo-label-cold-start-runtime-ready-timeout)

**本番反映（2026-05-29 · profile-scoped runtime readiness · Pi5 のみ）** {#本番反映2026-05-29-business-profile-optin-ready}

- **対象**: **`raspberrypi5` のみ**（**`--limit raspberrypi5`**）。**DGX / Pi4 / Pi3 未実施**
- **手順**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"` · `./scripts/update-all-clients.sh feat/dgx-business-profile-optin-ready infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`（**`main` マージ後は第2引数 `main`**）
- **Detach `20260529-173357-17360`** · **`ok=134` `changed=4` `failed=0`** · Git **`efe1853f`** · **`--follow` 約 924s**
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **43/0/0**（約 **112s**）
- **実機（機能）**:
  - api: **`business-runtime-readiness.js`** · **`model_profile_vision_runtime`** in scenario-readiness
  - **`INFERENCE_RUNTIME_START_PROFILE_ENABLED=false`** · **`LOCAL_LLM_RUNTIME_READY_TIMEOUT_MS=900000`**
- **手動（推奨）**: 35B 業務復帰後、**初回持出写真認識**がタイムアウトする場合は **cold start 完了まで待って再撮影**。DGX `GET /system/model-profiles` で **`runtimeReadyCapabilities` に `vision`** を確認。
- **正本**: [deployment.md §2026-05-29 optin-ready](../archive/deployments/2026-05.md#dgx-business-profile-optin-ready-2026-05-29) · [KB-365 §本番](../archive/knowledge-base/KB-365-dgx-resource-phase3-workload-orchestration.md#production-2026-05-29-dgx-business-profile-optin-ready)

## 業務モデル意図の Pi5 伝播（2026-05-29） {#business-profile-intent-propagation}

- **ねらい**: 業務復帰 GUI で選んだモデルが、写真ラベル・要領書要約・管理チャット・StackChan（職場 Pi5 API 経由）の on-demand 起動意図として **同一 `modelProfileId`** になる。
- **設定**:
  - `INFERENCE_BUSINESS_RUNTIME_START_PROFILE_ID` — 業務共通 profile（推奨。用途別 env と食い違うと API 起動エラー）
  - `INFERENCE_RUNTIME_START_PROFILE_ENABLED=true` — `/start` に profile を実送信（本番切替は shadow 確認後）
- **運用**: 業務復帰シナリオ成功後、KPI 下段の **Active Model** と **Pi5 業務意図** が一致していることを確認。不一致時は業務復帰を再実行するか env を揃える。**overview を開くだけでは Pi5 意図は変わらない**（env 固定・orchestration 成功のみ store 更新）。
- **KB**: [KB-365 §業務モデル意図の Pi5 伝播](../archive/knowledge-base/KB-365-dgx-resource-phase3-workload-orchestration.md#business-profile-intent-propagation)

**本番反映（2026-05-29 · 業務モデル意図の Pi5 伝播 · Pi5 のみ）** {#本番反映2026-05-29-business-profile-intent-propagation}

- **対象**: **`raspberrypi5` のみ**（**`--limit raspberrypi5`**）。**DGX / Pi4 / Pi3 未実施**（DGX コード変更なし·**Pi3 専用手順不要**）
- **手順**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"` · `./scripts/update-all-clients.sh feat/dgx-business-profile-propagation infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`（**`main` マージ後は第2引数 `main`**）
- **Detach `20260529-141701-10018`** · **`ok=138` `changed=7` `failed=0`** · Git **`1edebd70`** · **`--follow` 約 930s**
- **実機（自動）**: `./scripts/deploy/verify-phase12-real.sh` → **43/0/0**（約 **30s**）
- **実機（機能）**:
  - api: **`business-profile-intent.js`** / **`business-profile-intent-store.js`** · **`INFERENCE_RUNTIME_START_PROFILE_ENABLED=false`**
  - web: KPI 下段 **「Pi5 業務意図」**（`runtimeSummary.businessRuntimeIntentProfileId`）
  - **手動（推奨）**: `/admin/tools/dgx-resource` で業務復帰実行後、**Pi5 業務意図** と **Active Model** の一致を確認（不一致は再業務復帰または env 固定）
- **トラブルシュート**: 意図行が無い → 業務復帰未成功 or Pi5 ref 旧。**`/start` に profile が載らない** → 既定は shadow のみ（`INFERENCE_RUNTIME_START_PROFILE_ENABLED=true` で opt-in）
- **正本**: [deployment.md §2026-05-29 業務モデル意図](../archive/deployments/2026-05.md#dgx-business-profile-intent-propagation-2026-05-29) · [KB-365 §本番](../archive/knowledge-base/KB-365-dgx-resource-phase3-workload-orchestration.md#production-2026-05-29-dgx-business-profile-intent-propagation)

**本番反映（2026-05-29 · profile capabilities / runtime intent · Pi5→DGX 順次・各 1 台）** {#本番反映2026-05-29-dgx-profile-capabilities-runtime-intent}

- **① Pi5** — `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"` · `./scripts/update-all-clients.sh feat/dgx-profile-capability-intent-foundation infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`（**`main` マージ後は第2引数 `main`**）。**Detach `20260529-121631-3901`** · **`ok=138` `changed=7` `failed=0`** · **`--follow` 約 994s**。
- **② DGX** — 以下を **`scp`** → **`/srv/dgx/system-prod/bin/`**: [`control-server.py`](../../scripts/dgx-local-llm-system/control-server.py), [`model_profiles.py`](../../scripts/dgx-local-llm-system/model_profiles.py), [`active_model_state.py`](../../scripts/dgx-local-llm-system/active_model_state.py), [`profile_capabilities.py`](../../scripts/dgx-local-llm-system/profile_capabilities.py), [`profile_launcher.py`](../../scripts/dgx-local-llm-system/profile_launcher.py), [`vision_readiness.py`](../../scripts/dgx-local-llm-system/vision_readiness.py), [`vllm_command_builder.py`](../../scripts/dgx-local-llm-system/vllm_command_builder.py), [`start-llama-server.sh`](../../scripts/dgx-local-llm-system/start-llama-server.sh), [`start-trtllm-server.sh`](../../scripts/dgx-local-llm-system/start-trtllm-server.sh)。registry: 例 manifest → **`/srv/dgx/shared-models/registry/business_qwen35_35b_gguf/manifest.json`** / **`business_qwen36_27b_nvfp4/manifest.json`** / **`business_ornith_35b_nvfp4/manifest.json`**。**再起動**: **`control-server.pid`** と **`gateway-server.pid`** の PID を **`kill` → ファイル削除 → 各 `start-*.sh`**（**gateway-server.py 本体は未更新だが `model_profiles` import 先が変わるため gateway 再起動必須**）。
- **検証**: `./scripts/deploy/verify-phase12-real.sh` → **43/0/0**（約 **31s**）。DGX: `TOKEN=$(tr -d '\n' < /srv/dgx/system-prod/secrets/api-token)` · `curl -H "X-LLM-Token: $TOKEN" http://127.0.0.1:38081/system/model-profiles` → profiles の **`declaredCapabilities`** と state の **`runtimeReadyCapabilities`**。
- **トラブルシュート**: `update-all-clients.sh` が **未 push** で止まる → **push 後に再実行**。gateway 再起動直後 **`healthz` Connection refused** → **数秒待って再試行**。
- **正本**: [deployment.md §2026-05-29 capabilities](../archive/deployments/2026-05.md#dgx-profile-capabilities-runtime-intent-2026-05-29) · [KB-365 §本番](../archive/knowledge-base/KB-365-dgx-resource-phase3-workload-orchestration.md#production-2026-05-29-dgx-profile-capabilities-runtime-intent)

**本番反映（2026-05-29 · runtime state 整合 · KPI 下段 + `stop-force` backend 正本 · Pi5→DGX 順次・各 1 台）** {#本番反映2026-05-29-runtime-state-alignment}

- **① Pi5 のみ** — `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"` · `./scripts/update-all-clients.sh feat/dgx-runtime-state-alignment infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`（**`main` マージ後は第2引数 `main`**）。**Detach `20260529-093340-9025`** · `PLAY RECAP`: **`ok=134` `changed=4` `failed=0` / `unreachable=0`** · **`--follow` 約 865s**。
- **② DGX** — repo の [`control-server.py`](../../scripts/dgx-local-llm-system/control-server.py) を **`scp`** → **`/srv/dgx/system-prod/bin/control-server.py`**。**再起動**: **`/srv/dgx/system-prod/logs/control-server.pid` の PID を `kill`** → **`rm -f` PID ファイル** → **`bash /srv/dgx/system-prod/bin/start-control-server.sh`**（**`gateway-server.py` は本変更で未更新**）。
- **仕様**: 管理 UI は **`overview.runtimeSummary`**（Active Model / Backend / Business Ready / Policy）を KPI 下段に表示。`POST /stop-force` は **`active-model-profile.json` の `backend` 優先** · 応答 **`backendSource`**。
- **実機**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **33s**）。Pi5 から `POST …/stop-force` → **`backendSource: model_profile_state`**（検証スモーク。**blue 停止後は業務 LLM の再 start が必要**）。
- **正本**: [deployment.md §2026-05-29](../archive/deployments/2026-05.md#dgx-runtime-state-alignment-2026-05-29) · [KB-365 §2026-05-29](../archive/knowledge-base/KB-365-dgx-resource-phase3-workload-orchestration.md#production-2026-05-29-dgx-runtime-state-alignment) · [KB-366 §KPI 帯](../knowledge-base/KB-366-dgx-spark-operational-understanding.md#管理画面-kpi-帯2026-05-29-再設計--overviewruntimesummary)

**本番反映（2026-05-25・`private_ok` 強制メモリ解放・Pi5→DGX 順次・各 1 台）**: **① Pi5 のみ** — `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh feat/dgx-resource-strong-private-ok infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`（**`main` マージ後は第2引数 `main`**）。**Detach `20260525-162034-25035`**·`PLAY RECAP`: **`ok=134` `changed=4` `failed=0` / `unreachable=0`**·**`--follow` 約 938s**。**② DGX** — **`scp scripts/dgx-local-llm-system/control-server.py ubudgxkoushi@100.118.82.72:/srv/dgx/system-prod/bin/control-server.py`** → **`control-server.pid` の PID を `kill` → `rm -f` PID ファイル → `bash /srv/dgx/system-prod/bin/start-control-server.sh`**。**③ DGX gateway（必須）** — Pi5 は **`http://100.118.82.72:38081/stop-force`** を叩く。**gateway が `/stop-force` を転送しないと 404** となるため、**`scp scripts/dgx-local-llm-system/gateway-server.py`** → **`gateway-server.pid` 同手順で `start-gateway-server.sh`**。
**検証例**: `curl -sS -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:38081/stop-force -H 'X-Runtime-Control-Token: …'` → **403/200**（トークン次第）·**404 は転送未反映**。**実機** `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（**約 68s**）。**正本**: [deployment.md §2026-05-25](../archive/deployments/2026-05.md#dgx-resource-private-ok-strong-stop-force-2026-05-25)·[KB-365 §2026-05-25](../archive/knowledge-base/KB-365-dgx-resource-phase3-workload-orchestration.md#production-2026-05-25-dgx-private-ok-stop-force)。**現場手動（2026-10-17 以前の手順・履歴）**: 管理 **`/admin/tools/dgx-resource`** で **私用OK** + **ワークロード自動調停 ON** → 確認ダイアログの **業務 LLM 強制退避** 文言 → 実行後 **DGX `system-prod-trtllm` 停止**または **GPU/統一メモリ空き**を確認（[KB-364](../knowledge-base/KB-364-dgx-blue-vllm-comfyui-gpu-contention.md)）。

**本番反映（2026-05-10・メインAI 単一キュー・調停から gateway 自動停止除外・Pi5 API のみ）**: ブランチ **`feature/dgx-single-queue-stop-policy`**（**`23bce3bf`**·**`4d658897`**）を **`raspberrypi5` のみ**へ反映（**`--limit raspberrypi5`・1 台**）。`export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh feature/dgx-single-queue-stop-policy infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`（**`main` マージ後は第2引数 `main`**）。**Detach `20260510-114418-29512`**·`PLAY RECAP`: **`ok=134` `changed=4` `failed=0` / `unreachable=0`**·**`--follow` 約 559s**。**実機** `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（**約 130s**。Pi4/Pi3 は play **no hosts matched**・**Pi3 専用手順不要**）。**正本**: [deployment.md §2026-05-10](../archive/deployments/2026-05.md#dgx-main-llm-single-queue-stop-policy-2026-05-10)·[KB-365 §本番反映（2026-05-10）](../archive/knowledge-base/KB-365-dgx-resource-phase3-workload-orchestration.md#production-2026-05-10-dgx-main-llm-single-queue)。**トラブルシュート**: 挙動が旧（推論と UI 起停が交叉・実験優先で gateway が止まる）→ Pi5 **`api` Docker イメージ**の ref と **Detach `Git: changed`** を確認。

**本番反映（2026-05-24・私用 Pi5 Hermes Phase D0・DGX gateway のみ・1 台）**: **対象外**: 業務 Pi5 / Pi4 / Pi3。**手順**: repo の [`gateway-server.py`](../../scripts/dgx-local-llm-system/gateway-server.py) と [`gateway_llm_auth.py`](../../scripts/dgx-local-llm-system/gateway_llm_auth.py) を **`scp`** → **`gateway-server.pid` の PID を `kill` → PID ファイル削除 → **`start-gateway-server.sh`**（private-pi5-hermes-deploy.md §本番反映 2026-05-24（DGXSparkControlPlane `docs/private-history/runbooks/private-pi5-hermes-deploy.md`））。**実機**: `healthz` **200**。**注意**: `gateway-server.py` は同ディレクトリの `gateway_llm_auth` を import するため **両ファイル必須**。`LLM_SHARED_ADDITIONAL_TOKENS` は未設定でも既存 `LLM_SHARED_TOKEN` で後方互換。

**本番反映（2026-05-10・AgentContainer・Control Target `agent-container`・Pi5→DGX 順次・各 1 台）**: **① Pi5 のみ** — `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh feat/agent-container-control-target infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`（**`main` 取り込み後は第2引数 `main`**）。**Detach `20260510-125420-15123`**·`PLAY RECAP`: **`ok=139` `changed=8` `failed=0` / `unreachable=0`**·リモート **`exit` `0`**·**`--follow` 約 669s**。Pi4／Pi3 は **`skipping: no hosts matched`**（**Pi3 playbook は未適用**）。**② DGX** — **`scp scripts/dgx-local-llm-system/gateway-server.py ubudgxkoushi@100.118.82.72:/srv/dgx/system-prod/bin/gateway-server.py`**。**再起動の実績手順**: **`start-gateway-server.sh`** は **PID ファイルが生存 PID を指すと新コードを読まず `exit 0`** となるため、**`/srv/dgx/system-prod/logs/gateway-server.pid` の PID を `kill`** → **`rm -f` PID ファイル** → **`bash /srv/dgx/system-prod/bin/start-gateway-server.sh`**。**`curl http://127.0.0.1:38081/healthz`** は **起動直後に一度 `Connection refused`** になり得るが **1s 以内の再試行で 200** を確認済み。**実機** `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（**約 57s**）。**正本**: [deployment.md §AgentContainer](../archive/deployments/2026-05.md#dgx-agent-container-control-target-2026-05-10)·[KB-365 §AgentContainer](../archive/knowledge-base/KB-365-dgx-resource-phase3-workload-orchestration.md#production-2026-05-10-dgx-agent-container)。**ロールバック**: Pi5 は安定 ref へ **`update-all-clients.sh`** を再実行。DGX は **`gateway-server.py` を復元**して **同一の PID 終了→`start-gateway-server.sh`**。

履歴として **ひとつ前のモード** は `overview.policy.previousMode` に返り、GUI の「直前モードへ戻す」から `SET_POLICY`（**ワークロード自動調停なし**）で復帰できます（**再起動またはマルチプロセス構成では単一ソースではない**。厳密な監査が必要なら将来の永続化を検討）。

**任意の環境変数（Pi5 `apps/api`）**:

> 2026-10-17 以降に API が読むのは `DGX_RESOURCE_METRICS_URL`・`DGX_RESOURCE_PROBE_TIMEOUT_MS`・`DGX_RESOURCE_EVENT_LOG_MAX`・`DGX_RESOURCE_AGENT_CONTAINER_*` だけ。ComfyUI・実験ラボ・補助 POST タイムアウト・埋め込み・Spark ホストの各変数は履歴（業務画面では使わない）。

- `DGX_RESOURCE_METRICS_URL` — GPU/メモリKPI 用の GET JSON（Pi5 から到達可能な URL）。**未設定時**は admin LocalLLM base の **`GET /system/metrics`**（**`X-LLM-Token` 必須**）→ 続けて **`GET /v1/system/metrics`** を試行（詳細は **KB-365** の Phase 10 節）
- `DGX_RESOURCE_COMFYUI_HEALTH_URL` — ComfyUI 等の GET が 200 なら running とみなす
- **`DGX_RESOURCE_PRIVATE_COMFYUI_RUNTIME_START_URL` / `_STOP_URL` / （任意）`_CONTROL_TOKEN`** — Comfy を Pi5 API 経由で起停するための POST。本文 JSON `{ reason }`・ヘッダ `X-Runtime-Control-Token`（トークン設定時）。
- **`DGX_RESOURCE_EXPERIMENT_LAB_RUNTIME_START_URL` / `_STOP_URL` / （任意）`_CONTROL_TOKEN`** — 実験ラボ論理ターゲットの起停用 POST。
- **`DGX_RESOURCE_AGENT_CONTAINER_RUNTIME_START_URL` / `_STOP_URL` / （任意）`_CONTROL_TOKEN`** — Agent コンテナ（`agent-container`）の起停用 POST（DGX 側は **`gateway-server.py`** の **`/agent-container/start`** / **`/stop`**）。
- **`DGX_RESOURCE_AGENT_CONTAINER_HEALTH_URL`** — Agent コンテナ GET ヘルス（任意）。gateway 側 **`AGENT_CONTAINER_HEALTH_MODE`**（**`container`** | **`http`**）で **`docker ps`** または HTTP プロキシ。
- **`DGX_RESOURCE_EXPERIMENT_LAB_HEALTH_URL`** — 実験環境 GET ヘルス（任意）。DGX **`gateway-server.py`** 側では **`experiment_lab_health_mode`**（既定 **`container`**）により **`docker ps`** でコンテナ生存を見る運用が可能（立ち上がり直後の **`v1/models` 502** で overview が沈むのを避ける）
- **`DGX_RESOURCE_AUX_RUNTIME_REQUEST_TIMEOUT_MS`** — 上記補助 POST のタイムアウト（既定 90000）
- `DGX_RESOURCE_EMBEDDING_HEALTH_URL` — 相対なら admin `LOCAL_LLM` baseUrl を prefix
- **`DGX_RESOURCE_SPARK_HOST_STATUS_URL`** — DGX Spark **ホスト**の簡易疎通用（メトリクス sidecar の `/health` 等。**GET が 200** なら管理 UI で「応答あり」）。未設定時は **admin `LOCAL_LLM_BASE_URL` の `/healthz` を既定フォールバック**として使うため、Pi5 から DGX gateway に到達できれば Spark（ホスト）パネルも最低限の生存監視を行う。専用 sidecar を使う場合だけ明示設定する
- `DGX_RESOURCE_PROBE_TIMEOUT_MS` — プローブのタイムアウト（既定 10000）

**運用コンソール（管理 UI）**: （現行: 2026-10-17 以降、`overview.runtimeSummary`・Policy・目的別ガイド・`PREVIEW_ORCHESTRATION_SCENARIO`/`EXECUTE_ORCHESTRATION_SCENARIO`・`EXECUTE_TARGET_ACTION` は [ADR-20261017](../decisions/ADR-20261017-dgx-resource-business-llm-only.md) で削除され、API は 400 を返す。overview は `business`・`metrics`・`modelProfiles`・`businessReturn`・`alerts` を返す。以下は 2026-05〜06 の記録）**2026-05-29** より KPI 帯は **上段＝メトリクス（`overview.kpis`）**、**下段＝実行時状態（`overview.runtimeSummary`：Active Model / Backend / Business Ready / Policy）** の二段構成。**モード切替の成否は Policy だけでなく Active Model・Backend・Unified Mem をセットで確認**（[KB-366 §KPI 帯 2026-05-29](../knowledge-base/KB-366-dgx-spark-operational-understanding.md#管理画面-kpi-帯2026-05-29-再設計--overviewruntimesummary)）。「目的別ガイド」は Phase4 の **`PREVIEW_ORCHESTRATION_SCENARIO`（指紋取得）→確定後 `EXECUTE_ORCHESTRATION_SCENARIO`** をバックエンド契約として維持。**私用→業務** と **実験→業務** では DGX から取得した **モデルプロファイル**を選択し、同じ `modelProfileId` を preview/execute と DGX `/start` へ渡す。`planFingerprint` には `modelProfileId` も入るため、選択を変えた場合は stale 判定される。単発の保守 `EXECUTE_TARGET_ACTION` start にはモデル選択 UI を付けない。**Phase 7（2026-05-03）** ではフロントを **状態チップ一行 + 4 操作**に最小化し、**確認ダイアログ後にプレビュー→実行を連続**（プレビュー専用ボタンなし。**メイン画面にイベントログタイムラインは出さない**。履歴は **`GET …/events`** とサーバログ）。**Phase 8（2026-05-03）** ではさらに **`overview.kpis` を先頭の KPI ストリップ**へ戻し、読み込み完了後の **`h1「DGX リソース」`** と補助説明を消し、Spark / シナリオ / KPI の長文は **省略せず折り返し表示**に寄せた。**Phase 9** では **`EXECUTE_ORCHESTRATION_SCENARIO` 成功＝Strict Ready 達成まで**（業務復帰は `/v1/models` **+（`modelProfileId` 指定時）`activeProfileId` / `state.backend` 一致**、私用は Comfy ヘルス、実験は experiment ヘルス必須。待機は `LOCAL_LLM_RUNTIME_READY_TIMEOUT_MS` 等。失敗時は安全ロールバック方針。**KB-365 §Phase9** · **§Strict Ready profile 一致**）。**Phase 11（2026-05-04）** では進行中表示を **イベント由来判定 + `sessionStorage` pending** の二系統で維持し、タブ移動後の復帰でも `進行中:` を表示し続ける。**Stale（409）**時は内部的にプレビューを取り直してから実行する運用が前提。単発の起停は **`EXECUTE_TARGET_ACTION`**（**詳細・保守** の Control Targets）。**ガイドが途中停止**した場合は `scenarioExecute.completedStepOrders`・`overview.monitoring.lastScenarioFailure`・`/events` を参照（一部 POST 済みの可能性）。

**実装参照**: `apps/web/src/features/admin/dgx-resource/*` / `apps/web/src/pages/admin/DgxResourceAdminPage.tsx` / `apps/api/src/routes/system/dgx-resource.ts` / `apps/api/src/services/system/dgx-resource/`（2026-10-17 以降: `dgx-resource.service.ts`・`dgx-resource.gateway-runtime.executor.ts`・`dgx-resource.model-profiles.ts`・`dgx-resource.model-storage-delete.ts`・`dgx-resource.probes.ts`・`dgx-resource.scenario-readiness.ts`・`dgx-resource.startup-fit.ts`・`dgx-resource.state-store.ts`。旧 control-target / policy / operator-overview 系は ADR-20261017 で削除）

**DGX モデルプロファイル正本（業務復帰）**:

- 正本: `/srv/dgx/shared-models/registry/<modelProfileId>/manifest.json`
- active state: `/srv/dgx/system-prod/state/active-model-profile.json`
- resource state: `/srv/dgx/system-prod/state/dgx-resource-state.json`
- gateway API: `GET /system/model-profiles` / `GET /system/model-profile`
- owner API: `GET /system/resource-state`
- control API: `POST /start {"modelProfileId":"business_qwen36_27b_nvfp4"}`
- **activeProfileId 契約（Pi5 overview と DGX の違い）**:
  - **`GET /system/model-profiles`（複数形）**: registry allowlist + **`activeProfileId`**（state ファイルが無ければ **`null`** — **未 start 前は想定内**）。Pi5 `overview.modelProfiles` は **HTTP 200 で profiles が取れれば `status: ok`**（`activeProfileId: null` でも degraded にしない）。
  - **`GET /system/model-profile`（単数形）**: active state **のみ**。state 無し → **503** `ACTIVE_MODEL_PROFILE_UNAVAILABLE`（一覧 API とは挙動が異なる）。
  - **state ライフサイクル**: **作成・更新** = `POST /start` で `modelProfileId` 指定時のみ。**`POST /stop` / `stop-force` では state ファイルは削除されない**（停止後も `activeProfileId` が残り得る → **現在ロード中かは `GET /v1/models` / コンテナ状態で別確認**）。
  - **`POST /stop-force`（2026-05-29）**: 停止対象 backend は **`active-model-profile.json` の `backend` を優先**（無いときのみ `ACTIVE_LLM_BACKEND`）。env と実プロセスがずれていても **green `llama-server` が残る**事故を防ぐ。応答の **`backendSource`** で根拠を確認できる。
  - **切り分け（業務復帰 503 `DGX_MODEL_PROFILES_UNAVAILABLE`）**: ① `curl …/system/model-profiles` で profiles 件数・各 `status` ② `activeProfileId` が null でも allowlist 取得 OK なら Pi5 は `ok`（[KB-365 §activeProfileId null](../archive/knowledge-base/KB-365-dgx-resource-phase3-workload-orchestration.md#dgx-model-profile-active-profile-id-null)）③ state 単体は `curl …/system/model-profile`。
  - **切り分け（業務復帰 success だが KPI/モデルが選択と違う）**: ① `activeProfileId` が選択 ID と一致するか ② `state.backend` が manifest の `backend` と一致するか ③ `/v1/models` だけ OK では Pi5 success にならない（[§Strict Ready profile 一致](#strict-ready-model-profile-match-2026-05-28)）。
- **resource-state 契約（DGX owner/lease 表示）**:
  - `control-server.py` は `/start` / `/stop` / `/stop-force` 後に `dgx-resource-state.json` を best-effort 更新する。書込失敗は起動停止自体を失敗にしない。
  - `owner`: `business` / `private` / `experiment` / `unknown`。業務eligible profile は `business`、`businessOrchestrationEligible:false` の profile は `private`。`stop-force` は GPU を私用へ空ける操作として `private`。
  - `status`: `preparing` / `released`。Strict Ready の最終成功判定は Pi5 orchestration 側が `/v1/models` / activeProfile / backend / runtime capability で行う。resource-state は「誰に貸しているか」の共有表示であり、KPIではない。**本番検証・実測メモリ・未完了（非同期復帰）**: [KB-389](../knowledge-base/KB-389-dgx-resource-runtime-profile-resource-state.md)。
- **runtimeProfile 契約（profile別運用予算）**:
  - `business_qwen36_27b_nvfp4`: `runtimeProfile.engine=vllm`、`vllm.gpuMemoryUtilization=0.65`、`maxModelLen=8192`、`maxNumSeqs=4`、`languageModelOnly=true`、`quantization=compressed-tensors` を known-good default とする。`languageModelOnly=true` の blue 起動は runtime vision-ready と見なさない。
  - `business_ornith_35b_nvfp4`: `sakamakismile/Ornith-1.0-35B-NVFP4`。VLM smoke（text + small image chat）成功後に `enabled=true` とし、業務復帰候補に出す。Ornith は `--quantization` を付けず、`disableCustomAllReduce=true` を使う。
  - GGUF / llama.cpp profile は `gpuMemoryUtilization` ではなく `llamaCpp.ctxSize` / `parallel` / `nGpuLayers` を正本にする。
  - `launcher_env_for_profile()` は `runtimeProfile` を `VLLM_*` / `LLAMA_SERVER_*` env へ展開できる。profile 指定の blue 起動では `BLUE_SERVER_COMMAND` / `TRTLLM_SERVER_COMMAND` を空で上書きし、manifest の `BLUE_MODEL_DIR` と runtimeProfile を優先する。secret 側 `BLUE_SERVER_COMMAND` は legacy override とし、通常は空にして `vllm_command_builder.py` に snapshot path を解決させる。
- 初期 profile: `business_qwen36_27b_nvfp4`（blue / Qwen3.6 27B NVFP4 / text only）、`business_qwen35_35b_gguf`（green / Qwen3.5 35B GGUF）、`business_ornith_35b_nvfp4`（blue / Ornith 35B NVFP4 / smoke 後に有効化）
- 私用テキスト向け（業務キオスク非対象）: `qwen36_35b_uncensored`（green / Qwen3.6 35B Uncensored GGUF / text only）— 下記 [§uncensored profile](#dgx-uncensored-profile-2026-05-29)
- HF 移行: `sakamakismile/Qwen3.6-27B-NVFP4` は `/srv/dgx/shared-models/hf/sakamakismile/Qwen3.6-27B-NVFP4` へ寄せる。既存 cache は manifest の `currentStorageLocation` に残し、実ファイル移動は実機手動確認で行う
- **ストレージパス契約（可用性判定）**:
  - **`storageLocation`**: 移行**先**（正規配置）。未移行なら存在しないことがある
  - **`currentStorageLocation`**: **現配置**（移行途中の実体）。HF cache 利用時は **`/srv/dgx/system-prod/data/hf-cache/hub/models--<org>--<model>`** 形式（**`hub/` 配下**）。`hf-cache/models--...` のように **`hub` を抜くと `status: unavailable` になり、管理 UI のドロップダウンに出ない**
  - DGX `model_profiles.profile_storage_available()` は **`currentStorageLocation` → `storageLocation` の OR 存在チェック**。どちらか一方でもディレクトリがあれば `GET /system/model-profiles` では `status: available`
  - **切り分け**: API で profiles が 2 件なのに UI が 1 件だけ → 各 profile の `status` と manifest の `currentStorageLocation` を `ls` で突合する（[KB-365 §model profile storage](../archive/knowledge-base/KB-365-dgx-resource-phase3-workload-orchestration.md#dgx-model-profile-storage-availability)）

## `qwen36_35b_uncensored` と固定起動ボタン（2026-05-29） {#dgx-uncensored-profile-2026-05-29}

- **用途**: 私用テキスト生成（Uncensored GGUF）。**業務キオスク・photo_label・`BusinessProfileIntent` には載せない**。
- **manifest 正本**: `/srv/dgx/shared-models/registry/qwen36_35b_uncensored/manifest.json`（repo 例: [`model-registry.examples/qwen36_35b_uncensored`](../../scripts/dgx-local-llm-system/model-registry.examples/qwen36_35b_uncensored/manifest.json)）
- **GGUF**: `/srv/dgx/shared-models/llm/gguf/Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive-Q8_K_P.gguf`（期待サイズ **43605014656** バイト）
- **DGX bin（業務復帰除外の必須条件）**: [`model_profiles.py`](../../scripts/dgx-local-llm-system/model_profiles.py) を **`/srv/dgx/system-prod/bin/`** へ **`scp`** し **control + gateway 再起動**。manifest だけでは `GET /system/model-profiles` に **`businessOrchestrationEligible`** が出ず、Pi5 は未送信を **eligible=true** と解釈する（混在デプロイで業務復帰ドロップダウンに uncensored が載る）
- **反映後の確認例**（DGX）: `curl -sS -H "X-LLM-Token: …" http://127.0.0.1:38081/system/model-profiles` の `profiles[]` で `id==qwen36_35b_uncensored` の **`businessOrchestrationEligible` が `false`**
- **業務復帰ドロップダウン**: `businessOrchestrationEligible !== false` かつ `available` の profile のみ（`qwen36_35b_uncensored` は **`businessOrchestrationEligible: false`** のため **出ない**）。
- **ExecPlan**: [dgx-uncensored-profile-button.md](../plans/dgx-uncensored-profile-button.md)

**本番反映（2026-05-29 · `qwen36_35b_uncensored` + Pi5 固定ボタン · Pi5→DGX 順次）** {#本番反映2026-05-29-dgx-uncensored-profile-button}

- **対象**: **① Pi5 のみ**（`raspberrypi5` · **`--limit raspberrypi5`**）→ **② DGX Spark のみ**（Ansible 対象外）。**Pi4 / Pi3 / Hermes**: **未実施**
- **ブランチ**: **`feat/dgx-uncensored-profile-button`**（**`83bb4fc0`** · CI **`26630868193`** success）
- **① Pi5**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"` · `./scripts/update-all-clients.sh feat/dgx-uncensored-profile-button infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`。**Detach `20260529-191402-25013`** · **`ok=134` `changed=4` `failed=0`**
- **② DGX**（**manifest + `model_profiles.py` + 再起動をセット**）:
  1. `scp` repo → `/srv/dgx/system-prod/bin/model_profiles.py`
  2. `scp` repo 例 manifest → `/srv/dgx/shared-models/registry/qwen36_35b_uncensored/manifest.json`（**`businessOrchestrationEligible: false`**）
  3. GGUF は事前 rsync 済み（**43605014656** B）
  4. **`control-server` + `gateway-server`**: `/srv/dgx/system-prod/logs/*.pid` の PID を `kill` → ファイル削除 → 各 `start-*.sh`（実績: control **355140** · gateway **355152** · `healthz` **200**）
- **検証**:
  - `./scripts/deploy/verify-phase12-real.sh` → **43/0/0**（約 **109s**）
  - DGX: `GET /system/model-profiles` → **`qwen36_35b_uncensored`**: **`status: available`**, **`businessOrchestrationEligible: false`**
  - Pi5 api **`83bb4fc0`**: **`START_MODEL_PROFILE`** · **`businessReturnSelectable`**
  - Pi5 web bundle: **`qwen36_35b_uncensored`** 文字列あり（`/srv/site/assets/index-*.js`）
- **知見**: manifest のみ先行で bin 未更新 → 業務復帰ドロップダウンに uncensored が載る混在状態。**DGX 検証は `curl | python3`**（heredoc と stdin 競合しない）
- **KB**: [KB-365 §本番](../archive/knowledge-base/KB-365-dgx-resource-phase3-workload-orchestration.md#production-2026-05-29-dgx-uncensored-profile-button) · [deployment.md §2026-05-29](../archive/deployments/2026-05.md#dgx-uncensored-profile-button-2026-05-29)

**Strict Ready と model profile 一致（2026-05-28 · Pi5 API）** {#strict-ready-model-profile-match-2026-05-28}

- **契約**: 私用→業務 / 実験→業務で **`modelProfileId` を指定した execute** は、Strict Ready で次を **すべて**満たすまで **success にしない**。
  - `inference_business`: `GET /v1/models`（`system-prod-primary`）
  - `model_profile_active`: `GET /system/model-profiles` の **`activeProfileId === 選択 ID`**
  - `model_profile_backend`: `state.backend` が返る場合は **選択 profile の green/blue と一致**
- **確認**: `scenarioExecute.readinessChecksJa` に上記 code が並び、不一致時は `satisfied: false` のままタイムアウト。
- **KB**: [KB-365 §Strict Ready profile 一致](../archive/knowledge-base/KB-365-dgx-resource-phase3-workload-orchestration.md#dgx-strict-ready-model-profile-match)。

**本番反映（2026-05-28 · Strict Ready profile 一致 · Pi5 API）** {#本番反映2026-05-28-strict-ready-profile-match}

- **対象**: **Pi5 のみ**（`raspberrypi5` · **`--limit raspberrypi5`**）。**DGX / Pi4 / Pi3 はデプロイ不要**。
- **ブランチ**: **`fix/dgx-strict-ready-profile-match`**（**`90ba94d9`** · CI **`26575185778` success**）。
- **変更内容**: 業務復帰 **`modelProfileId` 指定 execute** の success 条件に **profile 一致ゲート**を追加（`/v1/models` 単独 OK 禁止）。
- **手順**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"` · `./scripts/update-all-clients.sh fix/dgx-strict-ready-profile-match infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`（**Detach `20260528-221349-13434`** · **`failed=0`** · 約 **932s**）。
- **検証**:
  - Phase12 **`verify-phase12-real.sh` → 43/0/0**（約 **110s**）
  - Pi5 api コンテナ HEAD **`90ba94d9`** · `model_profile_active` / `model_profile_backend` コード確認
  - api コンテナ内 `fetchDgxModelProfilesOverview` → **2 profiles** · **`activeStateBackend` 取得可**
  - **管理 UI**: 私用→業務で **選択 profile と異なる active のまま** execute すると **Strict Ready タイムアウト**（success にならない）ことを確認（推奨）
- **KB**: [KB-365 §本番 Strict Ready profile](../archive/knowledge-base/KB-365-dgx-resource-phase3-workload-orchestration.md#production-2026-05-28-dgx-strict-ready-profile-match) · [deployment.md §Strict Ready profile](../archive/deployments/2026-05.md#dgx-strict-ready-profile-match-2026-05-28)。

**本番反映（2026-05-28 · activeProfileId null · Pi5 API 契約修正）** {#本番反映2026-05-28-activeprofileid-null-pi5-api}

- **対象**: **Pi5 のみ**（`raspberrypi5` · **`--limit raspberrypi5`**）。**DGX / Pi4 / Pi3 はデプロイ不要**。
- **ブランチ**: **`fix/dgx-active-profile-null-contract`**（**`f4ec13dc`** · CI **`26572037918` success**）。
- **変更内容**: Pi5 `fetchDgxModelProfilesOverview` が **`activeProfileId: null` でも allowlist 取得成功なら `status: ok`**。業務復帰 PREVIEW/EXECUTE の **`DGX_MODEL_PROFILES_UNAVAILABLE`（503）** を解消。
- **手順**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"` · `./scripts/update-all-clients.sh fix/dgx-active-profile-null-contract infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`（**Detach `20260528-204344-14223`** · **`failed=0`** · 約 **903s**）。
- **検証**:
  - DGX: `curl …/system/model-profiles` → **`activeProfileId: null`** · profiles **2 件 `available`**
  - Pi5 api: `fetchDgxModelProfilesOverview` → **`status: ok`** · `assertModelProfileKnownAndStartable` 成功
  - Phase12 **43/0/0**
- **KB**: [KB-365 §本番 activeProfileId null](../archive/knowledge-base/KB-365-dgx-resource-phase3-workload-orchestration.md#production-2026-05-28-dgx-active-profile-null-contract) · [deployment.md §activeProfileId null](../archive/deployments/2026-05.md#dgx-active-profile-null-contract-2026-05-28)。

**本番反映（2026-05-28・業務復帰モデル選択・Pi5 API+Web + DGX control/gateway）** {#本番反映2026-05-28-業務復帰モデル選択}

- **① Pi5 のみ**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh feat/dgx-business-model-selection infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`。**Detach `20260528-184011-18178`**·`PLAY RECAP`: **`ok=134` `changed=4` `failed=0`**·`--follow` 約 **1195s**·Git **`91be7dcf`**。Pi4／Pi3 **no hosts matched**。
- **② DGX**（Ansible 対象外）: repo から **`control-server.py`·`gateway-server.py`·`model_profiles.py`·`active_model_state.py`·`profile_launcher.py`·`vision_readiness.py`·`vllm_command_builder.py`·`start-trtllm-server.sh`** を **`scp`** → **`/srv/dgx/system-prod/bin/`**。例 manifest を **`/srv/dgx/shared-models/registry/<modelProfileId>/manifest.json`** へ配置（初期 **`business_qwen36_27b_nvfp4`** / **`business_qwen35_35b_gguf`** / **`business_ornith_35b_nvfp4`**）。**再起動**: **`/srv/dgx/system-prod/logs/control-server.pid`** と **`gateway-server.pid`** の PID を **`kill`** → ファイル削除 → **`bash /srv/dgx/system-prod/bin/start-control-server.sh`** → **`start-gateway-server.sh`**。
- **検証（Pi5 から）**: `curl -sS -H "X-Runtime-Control-Token: $TOKEN" http://100.118.82.72:38081/system/model-profiles` → **`ok: true`**・**`profiles` 2 件**（未 start 前 **`activeProfileId: null` は想定内**）。**`./scripts/deploy/verify-phase12-real.sh`** → **43/0/0**（約 **111s**）。
- **知見**: 再起動直後 **`curl …/healthz` が Connection refused** → **1s 程度待つと 200**（PID ガード起動スクリプトのレース）。**管理 UI** で業務復帰時にモデル選択が出ない場合は Pi5 **`web` ref** と **`overview.modelProfiles`**（[KB-365 §2026-05-28](../archive/knowledge-base/KB-365-dgx-resource-phase3-workload-orchestration.md#production-2026-05-28-dgx-business-return-model-selection)）。
- **KB**: [KB-365 §本番 2026-05-28](../archive/knowledge-base/KB-365-dgx-resource-phase3-workload-orchestration.md#production-2026-05-28-dgx-business-return-model-selection)·[deployment.md §2026-05-28](../archive/deployments/2026-05.md#dgx-business-return-model-selection-2026-05-28)·[KB-366](../knowledge-base/KB-366-dgx-spark-operational-understanding.md#production-2026-05-28-dgx-business-return-model-selection)。

**本番反映（2026-05-28 · 27B model profile `currentStorageLocation` 修正 · DGX registry のみ）** {#本番反映2026-05-28-27b-model-profile-storage-path}

- **対象**: **DGX Spark のみ**（`ubudgxkoushi@100.118.82.72`·Ansible 対象外）。**Pi5 / Pi4 / Pi3 はデプロイ不要**（コード変更なし·manifest 正本は DGX registry）。
- **ブランチ**: **`fix/dgx-model-profile-current-storage-path`**（代表 **`ff5947c8`**·CI **`26569969639`** **success**）。
- **変更内容**: `business_qwen36_27b_nvfp4` の registry manifest で **`currentStorageLocation` に `/hub/` を追加**（誤: `hf-cache/models--…` → 正: `hf-cache/hub/models--…`）。**control/gateway 再起動は不要**（`model_profiles` は manifest を都度読む）。
- **手順**:
  1. ローカル例: `scripts/dgx-local-llm-system/model-registry.examples/business_qwen36_27b_nvfp4/manifest.json`
  2. `scp` → **`/srv/dgx/shared-models/registry/business_qwen36_27b_nvfp4/manifest.json`**
- **検証（Pi5 から）**: `curl -H "X-LLM-Token: …" http://100.118.82.72:38081/system/model-profiles` → **`business_qwen36_27b_nvfp4` が `status: available`**・**`business_qwen35_35b_gguf` も `available`**（profiles **2 件とも available**）。管理 UI 業務復帰ドロップダウンで **2 件選択可能**（`enabled && status === 'available'`）。
- **知見**: API が profiles 2 件返却でも UI が 1 件だけ → **各 profile の `status`** と manifest の **`currentStorageLocation` を `ls` で突合**（[KB-365 §storage availability](../archive/knowledge-base/KB-365-dgx-resource-phase3-workload-orchestration.md#dgx-model-profile-storage-availability)）。
- **KB**: [KB-365 §本番 storage path](../archive/knowledge-base/KB-365-dgx-resource-phase3-workload-orchestration.md#production-2026-05-28-dgx-model-profile-storage-path)·[deployment.md §storage path](../archive/deployments/2026-05.md#dgx-model-profile-storage-path-2026-05-28)·[KB-366 §storage path](../knowledge-base/KB-366-dgx-spark-operational-understanding.md#production-2026-05-28-dgx-model-profile-storage-path)。

**本番反映（2026-06-15・運用者コンソールコンパクト化・Web のみ）** {#本番反映2026-06-15-dgx-resource-console-layout-review}

- **status**: deployed · **scope**: `/admin/tools/dgx-resource` · **date**: 2026-06-15
- **branch / HEAD**: **`fix/dgx-resource-console-layout-review`** · **`6bdcc539`**
- **変更（Web のみ・API/Prisma/migration なし）**:
  - **`DgxResourceOperatorConsole`**: 白カード内に **Current State / Model / Memory / GPU / Alerts** のコンパクト KPI 帯を統合。右ペインにワークロード補助状態を表示
  - **`DgxResourceDashboard`**: 重複 **`DgxResourceStatusBoard`** を撤去。詳細タブ群を **`DgxResourceAdvancedControls`（「詳細・保守・ログ」）** に折りたたみ
  - **`DgxResourcePrimaryScenarioFlow`**: ライトテーマの 2×2 グリッド操作ボタン。表示は短縮ラベル（例: **業務→私用**）、**`aria-label` は完全操作名を維持**
  - **`AdminLayout`**: 管理ヘッダーを 1 行コンパクト化（ナビ・ログアウトを同一行）
- **対象ホスト**: **`raspberrypi5` のみ**（`--limit raspberrypi5`）。Pi4／Pi3／DGX **対象外**
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"` · `./scripts/update-all-clients.sh fix/dgx-resource-console-layout-review infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`
- **本番デプロイ（実績）**: Detach **`20260615-211822-4369`** · `PLAY RECAP`: **`ok=134` `changed=4` `failed=0` / `unreachable=0`** · リモート HEAD **`6bdcc539`** · **`web` 再ビルド** · バンドル **`index-D_aJZdPV.js`**
- **自動回帰**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **54s**）
- **実機（バンドル確認）**: `index-D_aJZdPV.js` に **`Current State`** · **`詳細・保守・ログ`** · **`業務→私用`** を確認
- **実機（手動·管理 UI）**: `/admin/tools/dgx-resource` でコンパクト KPI 帯・4 操作ボタン・「詳細・保守・ログ」折りたたみを目視。旧レイアウトのままなら [verification-checklist.md](../guides/verification-checklist.md) §6.6.4 **強制リロード**
- **CI（push 時）**: GitHub Actions **`27544935827`** **success**
- **未完了**: 管理 UI の手動目視（運用者による最終確認）は任意
- **関連コード**: `DgxResourceOperatorConsole.tsx` · `DgxResourceDashboard.tsx` · `DgxResourcePrimaryScenarioFlow.tsx` · `AdminLayout.tsx`

**本番反映（2026-06-15・DGX ライトコンソール UI 仕上げ・Web のみ）** {#本番反映2026-06-15-dgx-resource-light-console-ui-review}

- **status**: deployed · **scope**: `/admin/tools/dgx-resource` · **date**: 2026-06-15
- **branch / HEAD**: **`chore/dgx-resource-ui-review`** · **`b5e08265`**
- **変更（Web のみ・API/Prisma/migration なし）**:
  - **ライトテーマ統一**: DGX 管理 UI 各パネルを白背景・slate 系トークンへ。ダークグラデ依存の `ghostOnDark` をライト面では `ghost` へ
  - **`DgxResourceDashboard`**: 通常表示に **モデルプロファイル** / **詳細（Gateway・Spark Host・Logs）** サマリー 2 列を追加。`profileStatus` は active 実在時のみ `active`、未取得時 `not loaded`
  - **`AdminLayout`**: DGX ルート（`/admin/dgx-resource` および `/admin/tools/dgx-resource` 配下）のみヘッダー・背景をライトテーマへ。サブルートも `startsWith` で判定
  - **レビュー追補**: 詳細タブ `tabIndex`、プロファイル行 subtitle の重複計算除去
- **対象ホスト**: **`raspberrypi5` のみ**（`--limit raspberrypi5`）。Pi4／Pi3／DGX **対象外**
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"` · `./scripts/update-all-clients.sh chore/dgx-resource-ui-review infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`
- **本番デプロイ（実績）**: Detach **`20260615-221641-31564`** · `PLAY RECAP`: **`ok=134` `changed=4` `failed=0` / `unreachable=0`** · リモート HEAD **`b5e08265`** · **`web` 再ビルド** · バンドル **`index-B6GGePVd.js`**
- **自動回帰**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **57s**）
- **実機（バンドル確認）**: `docker-web-1:/srv/site/assets/index-B6GGePVd.js` に **`モデルプロファイル`** · **`閉じた状態を既定`** · **`通常表示は「状態」と「主要操作」に限定`** · **`Current State`** · **`詳細・保守・ログ`** を確認
- **実機（手動·管理 UI）**: `/admin/tools/dgx-resource` でライト背景・2 列サマリー・コンパクト KPI 帯を目視。旧ダーク UI のままなら [verification-checklist.md](../guides/verification-checklist.md) §6.6.4 **強制リロード**
- **CI（push 時）**: GitHub Actions **`27547887659`** **success**
- **未完了**: 管理 UI の手動目視（運用者による最終確認）は任意
- **関連コード**: `DgxResourceDashboard.tsx` · `DgxResourceOperatorConsole.tsx` · `AdminLayout.tsx` · `dgxResourceUi.ts` ほか DGX resource コンポーネント群

**本番反映（2026-06-15・運用者コンソールレイアウト統合・Web のみ）** {#本番反映2026-06-15-dgx-resource-operator-console-layout}

- **status**: deployed · **scope**: `/admin/tools/dgx-resource` · **date**: 2026-06-15
- **branch / HEAD**: **`fix/dgx-resource-operator-console`** · **`cd12be28`**
- **変更（Web のみ・API/Prisma/migration なし）**:
  - 先頭を **`DgxResourceOperatorConsole`** に統合（`DgxResourceStatusHeader` 撤去）
  - 見出し **`DGX リソース`** + バッジ **`運用ガイド`**（旧 `DGX 運用ガイド` h2 を置換）
  - **`externalBusy`**（シナリオ進行中）を OperatorConsole → PrimaryScenarioFlow へ伝播し操作ボタンを二重実行防止
  - **`DgxResourcePreflightPanel`** を **「状態」タブ**へ移動（日常導線を簡素化）
  - **`DgxResourceStatusBoard`** は運用ガイド直下に維持
- **対象ホスト**: **`raspberrypi5` のみ**（`--limit raspberrypi5`）。Pi4／Pi3 **対象外**
- **標準コマンド**: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"` · `./scripts/update-all-clients.sh fix/dgx-resource-operator-console infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`
- **本番デプロイ（実績）**: Detach **`20260615-201216-8870`** · `PLAY RECAP`: **`ok=134` `changed=4` `failed=0` / `unreachable=0`** · リモート HEAD **`cd12be28`** · **`web` 再ビルド** · バンドル **`index-BJeGPCuR.js`**
- **自動回帰**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **58s**）
- **実機（手動·管理 UI）**: `/admin/tools/dgx-resource` を開き、先頭に **運用ガイド付きコンソール**・4 操作ボタン・進行中バナーが表示されること。旧レイアウトのままなら [verification-checklist.md](../guides/verification-checklist.md) §6.6.4 **強制リロード**
- **CI（push 時）**: GitHub Actions **`27541517478`** **success**
- **未完了**: なし（本番反映・自動回帰・バンドル文字列確認まで完了）
- **関連コード**: `apps/web/src/features/admin/dgx-resource/DgxResourceDashboard.tsx` · `DgxResourceOperatorConsole.tsx`

**本番反映（2026-05-03・Phase5・運用者コンソール `overview.operator`・ワークロード遷移分離・API+Web）**: ブランチ **`feat/dgx-resource-operator-console`**（代表 **`e88d9206`**）を **`raspberrypi5` のみ**へ反映。`export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh feat/dgx-resource-operator-console infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`。Detach **`20260503-115446-2532`**・`PLAY RECAP`: **`ok=130` `changed=4` `failed=0` / `unreachable=0`**・リモート exit **`0`**（ローカル `--follow` 完了まで **約 826s**）。Pi4／Pi3 は **no hosts matched**（**Pi3 個体へは本変更の Ansible を当てない**）。実機 `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **97s**）。**仕様**: `/admin/tools/dgx-resource` は **運用者コンソールを主軸**、技術 ID の Control Targets は折りたたみ詳細。`overview.operator` は **`targets[]` と整合する運用者向け要約**（起停可否の契約は引き続き `targets[]`）。**`scenarioExecute.outcomeKind`** で成功／部分失敗／noop を区別可能。**ADR**: [ADR-20260503](../decisions/ADR-20260503-dgx-resource-operator-console.md)。**KB**: [KB-365 §Phase5](../archive/knowledge-base/KB-365-dgx-resource-phase3-workload-orchestration.md#phase-5-本番反映記録)。**トラブルシュート**: コンソールが旧のまま → **`api`/`web` の同一ブランチ**・[verification-checklist.md](../guides/verification-checklist.md) §6.6.4 **強制リロード**。

**本番反映（2026-05-03・Phase8・KPI 先頭・説明削減・全文可読・Web のみ）**: ブランチ **`feat/dgx-resource-dashboard-ui-phase8`**（代表 **`89f65a7c`**）を **`raspberrypi5` のみ**へ反映。`export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh feat/dgx-resource-dashboard-ui-phase8 infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`。Detach **`20260503-181600-946`**・`PLAY RECAP`: **`ok=130` `changed=4` `failed=0` / `unreachable=0`**・リモート exit **`0`**（ローカル `--follow` 完了まで **約 666s**）。Pi4／Pi3 は **no hosts matched**。実機 `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **118s**）。**仕様**: 先頭に **KPI ストリップ**、説明文と絵文字を削除、`Spark` / シナリオ文言は **折り返し表示**。**知見**: Pi5 の標準デプロイ preflight は **Pi5→Pi5 self-SSH** を使うため、**`~/.ssh/id_ed25519.pub` が `authorized_keys` に無いと `Permission denied (publickey)`** で止まる。
失敗時に **`runner=bootstrap` / `runPid=null`** の lock だけ残ることがあり、（現行: lock や run 情報を手で編集・削除せず [deploy-status-recovery.md](./deploy-status-recovery.md) に従う）。**KB**: [KB-365 §Phase8](../archive/knowledge-base/KB-365-dgx-resource-phase3-workload-orchestration.md#phase-8kpi-先頭説明削減全文可読web-のみ本番反映)·[Ansible/デプロイ KB](../knowledge-base/infrastructure/ansible-deployment.md)。

**本番反映（2026-05-03・Phase9・Orchestration Strict Ready・安全ロールバック・API+Web）**: ブランチ **`feat/dgx-resource-ready-guarantee`**（代表 **`8cbc6f38`**）を **`raspberrypi5` のみ**へ反映。`export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh feat/dgx-resource-ready-guarantee infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`。Detach **`20260503-194121-32704`**・`PLAY RECAP`: **`ok=134` `changed=4` `failed=0` / `unreachable=0`**・リモート exit **`0`**（ローカル `--follow` 完了まで **約 684s**）。Pi4／Pi3 は **no hosts matched**（Pi3 は専用手順対象外で本変更の Ansible 適用にも含めない）。実機 `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **89s**）。**仕様**: **`EXECUTE_ORCHESTRATION_SCENARIO` が成功になるのは Strict Ready 達成後**。**タイムアウト時**はモード復帰＋補助ワークロードのロールバック試行。**知見**: Phase12 はシナリオ Ready を直接叩かない。**トラブルシュート**: Ready タイムアウト → **`LOCAL_LLM_RUNTIME_READY_TIMEOUT_MS`** と **`apps/api/src/config/env.ts` の上限**を整合させて調整。**KB**: [KB-365 §Phase9](../archive/knowledge-base/KB-365-dgx-resource-phase3-workload-orchestration.md#phase-9orchestration-strict-readyapi--web)·[deployment.md](../guides/deployment.md) Phase9 項。

**本番反映（2026-05-03・KPI メトリクス・`GET /system/metrics`・API + DGX gateway）**: **① Pi5 のみ** Ansible（**`--limit raspberrypi5`**）→ **② DGX** へ **`scripts/dgx-local-llm-system/gateway-server.py`** を **`/srv/dgx/system-prod/bin/gateway-server.py`** に配置しゲートウェイを再起動（**順序付き**。Pi4／Pi3 は **対象外**）。Pi5: `export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh feat/dgx-kpi-metrics-fallback infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`。Detach **`20260503-211051-8713`**・`PLAY RECAP`: **`ok=134` `changed=4` `failed=0` / `unreachable=0`**・exit **`0`**（ローカル `--follow` 約 **702s**）。**仕様**: **`DGX_RESOURCE_METRICS_URL` 未設定**時、Pi5 API は **`GET /system/metrics`**（**`X-LLM-Token` 必須**）→ **`/v1/system/metrics`** の順で KPI を取得。gateway は **`nvidia-smi`** と **`free -b`** フォールバック。**知見**: **API と gateway は同じ反映窗口で揃える**。**DGX 再起動（実績）**: **`sudo systemctl restart dgx-llm-gateway`** は運用ユーザーに **sudo が無く未実行**。
当該ホストでは **`dgx-llm-gateway` が inactive** で **`start-gateway-server.sh`** 常駐のため、**既存 `gateway-server.py` を終了**してから **`/srv/dgx/system-prod/bin/start-gateway-server.sh`** を実行。**systemd へ統一する場合**は下記 **`install-systemd-units.sh`** 節。**実機**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**。**KB**: [KB-365](../archive/knowledge-base/KB-365-dgx-resource-phase3-workload-orchestration.md)（Phase 10）·[deployment.md](../guides/deployment.md)（2026-05-03 KPI メトリクス項）。

**本番反映（2026-05-04・Phase11・進行中表示持続化・API+Web+DGX gateway）**: **① `raspberrypi5` のみ**（`export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`）→ **② DGX** へ repo の **`gateway-server.py`** を **`scp`**。**Detach `20260504-113918-744`**・`PLAY RECAP`: **`ok=134` `changed=4` `failed=0` / `unreachable=0`**・exit **`0`**（`--follow` 約 **702s**）。**`main`** 代表 **`5d96b59b`**（[PR #246](https://github.com/denkoushi/RaspberryPiSystem_002/pull/246)）。Pi4／Pi3 **対象外**。**DGX 再起動**: **`sudo systemctl restart dgx-llm-gateway`** は **sudo 非対話不可**のため **`/srv/dgx/system-prod/bin/start-gateway-server.sh`**。**トラブルシュート**: 広い **`pkill -f`** は **SSH コマンドラインを巻き込み得る** → **`start-gateway-server.sh`** で **`healthz` 200** まで復旧。**実機**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**（約 **109s**）。**KB**: [KB-365 §Phase11](../archive/knowledge-base/KB-365-dgx-resource-phase3-workload-orchestration.md#phase-11進行中表示の持続化長時間切替の運用解釈web--runbook)·[deployment.md](../guides/deployment.md)（2026-05-04 項）。

**本番反映（2026-05-06・`control-server` 単一アクティブ運用ガード・DGX のみ）**: **対象は DGX のみ**（Pi5／Pi4／Pi3 **Ansible 不要**）。repo の **`control-server.py`**・**`dgx_llm_single_active_guard.py`**（**同一ディレクトリに必ず同梱**）・**`stop-llama-server.sh`**・**`stop-trtllm-server.sh`** を **`scp`** で **`/srv/dgx/system-prod/bin/`**（例: `ubudgxkoushi@100.118.82.72`）。**`runtime_stop_policy.py` は既存が `/srv/dgx/system-prod/bin/` にあれば追加 `scp` は不要**（`control-server.py` が import）。**再起動**: **`start-control-server.sh` は既存 PID が生きていると新コードを読まず終了する**ため、**`/srv/dgx/system-prod/logs/control-server.pid` の PID を `kill`（必要なら `kill -9`）して PID ファイルを消したうえで** **`bash /srv/dgx/system-prod/bin/start-control-server.sh`**。**ゲートウェイは本変更の範囲では再起動しない**。**検証**: 本文「単一アクティブ運用ガード」節・「切替後の 4 点チェック」節のコマンド。**実績（2026-05-06）**: **`ACTIVE_LLM_BACKEND=blue`** で **`38081/healthz` 200**・**`/v1/models` に `system-prod-primary`**・**`39090` 401**・**`38082` 非 listen**・**`llama-server` プロセス無し**。**KB**: [KB-365 §Phase12](../archive/knowledge-base/KB-365-dgx-resource-phase3-workload-orchestration.md#phase-12-dgx-control-server-single-active-guard-2026-05-06)·[deployment.md](../guides/deployment.md)（2026-05-06 DGX control-server 項）。

**本番反映（2026-05-03・Phase3・補助起停 + `SET_POLICY.applyWorkloadChanges`・API+Web）**: ブランチ **`feat/dgx-resource-policy-orchestration-phase3`**（代表 **`a44b9f78`**）を **`raspberrypi5` のみ**へ反映。`export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh feat/dgx-resource-policy-orchestration-phase3 infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`。Detach **`20260503-094340-23537`**・`PLAY RECAP`: **`ok=135` `changed=8` `failed=0` / `unreachable=0`**・リモート exit **`0`**（所要 **約 597s**）。Pi4／Pi3 は **no hosts matched**。実機 `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**。**仕様**: `EXECUTE_TARGET_ACTION` は **`targets[].capabilities` に応じて** **`system-prod-gateway`** に加え、補助 URL 設定済みなら **`private-comfyui`**・**`experiment-lab`** も起停可能。**ワークロード調停**: [KB-365](../archive/knowledge-base/KB-365-dgx-resource-phase3-workload-orchestration.md)。**ナレッジ**: カード直下に **`EXECUTE_TARGET_ACTION` 失敗**を表示して操作文脈を維持（Web）。

**本番反映（2026-05-03・Control Targets 本番・API+Web・旧仕様：gateway のみ書込）**: ブランチ **`feat/dgx-resource-standard-control-targets`**（**`1e24d169`**）を **`raspberrypi5` のみ**へ反映。`export RASPI_SERVER_HOST="denkon5sd02@100.106.158.2"`·`./scripts/update-all-clients.sh feat/dgx-resource-standard-control-targets infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`。Detach **`20260503-082132-17926`**・`PLAY RECAP`: **`ok=130` `changed=4` `failed=0` / `unreachable=0`**・リモート exit **`0`**（所要 **約 610s**）。実機 `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**。**仕様**: `overview.targets[]`・**`EXECUTE_TARGET_ACTION`** が書き込みの正規経路（**`system-prod-gateway`** のみ）。**知見**: `targets` 欠落の旧 API 応答でも UI が落ちないよう **optional フォールバック**を維持。**トラブルシュート**: 管理画面の Control Targets が旧のまま → **`web` 再ビルド**と **強制リロード**（[verification-checklist.md](../guides/verification-checklist.md) §6.6.4）。

**本番反映（2026-05-02・Phase2）**: `feat/dgx-resource-profile-and-spark-visibility-clean`（`09b2423e`）を **`raspberrypi5` のみ**へ反映。`./scripts/update-all-clients.sh feat/dgx-resource-profile-and-spark-visibility-clean infrastructure/ansible/inventory.yml --limit raspberrypi5 --detach --follow`、Detach **`20260502-190642-27778`**、`PLAY RECAP`: **`ok=130 changed=4 unreachable=0 failed=0`**。実機 `./scripts/deploy/verify-phase12-real.sh` は **PASS 43 / WARN 0 / FAIL 0**。  
**運用知見（2026-05-02・当時の `--follow`。現行は `--status RUN_ID` で確認する）**: `--follow` が停止して見えるケースでは `status.json` が stale のままでも、遠隔ログの **`PLAY RECAP failed=0`** と `summary.json` を優先して完了判定してよい。  

**本番反映（2026-05-02・API: `sparkHost` 既定 `/healthz` フォールバック + Ansible `DGX_RESOURCE_*` 出力）**: `fix/dgx-resource-admin-readable-typography`（**`6c6888d6`**）を **`raspberrypi5` のみ**へ反映。[PR #238](https://github.com/denkoushi/RaspberryPiSystem_002/pull/238)。Detach **`20260502-203857-20230`**、`PLAY RECAP`: **`failed=0` / `unreachable=0`**（runner exit **`0`**）。実機 `./scripts/deploy/verify-phase12-real.sh` は **PASS 43 / WARN 0 / FAIL 0**。**運用メモ**: `--follow` ログに **`Connection closed by … port 22`** が一度出ても、**再作成・再起動タイミングの一時切断**があり得る。**正本は `PLAY RECAP` / `summary.json`**。**ナレッジ**: [KB-363](../archive/knowledge-base/KB-363-dgx-resource-spark-status-fallback.md)。

**本番反映（2026-05-02・管理UI可読性）**: `fix/dgx-resource-admin-readable-typography`（`f856e2f2`）で **タイポ・余白**を調整、[PR #238](https://github.com/denkoushi/RaspberryPiSystem_002/pull/238)。**対象**: **`raspberrypi5` のみ**。Detach **`20260502-195653-14945`**、`PLAY RECAP`: **`ok=130 changed=4 failed=0`**。実機 `./scripts/deploy/verify-phase12-real.sh` は **PASS 43 / WARN 0 / FAIL 0**。**運用メモ**: 反映後も文字が小さく見える場合は **ブラウザのページズーム**と **[verification-checklist.md](../guides/verification-checklist.md) §6.6.4 の強制リロード**を先に確認。

**本番反映（2026-05-01・Phase1）**: 管理 UI は **Pi5 の `api` + `web` 再デプロイ**で配信される。**対象は `raspberrypi5` のみ**（Pi3 は専用手順・必須対象外）。標準: [deployment.md](../guides/deployment.md) 補足（2026-05-01 DGX リソース管理コンソール）。**実機**: `./scripts/deploy/verify-phase12-real.sh` が **PASS 43 / WARN 0 / FAIL 0**。**運用メモ**: **`LOCAL_LLM_STOP`** は **`LOCAL_LLM_RUNTIME_STOP_REQUEST_TIMEOUT_MS`**（開始用 `…_START…` とは別）で制御する。

> 履歴は [移行履歴 archive](../archive/runbooks/dgx-system-prod-local-llm-history-2026-04-06.md#現時点の判断2026-04-26) へ移設した（「現時点の判断（2026-04-26）」ほか）。

## backend 常駐と Blue/Green 差し替え

### systemd への移行（推奨・`@reboot` の代替）

`@reboot` は起動順が保証されず、journald との統合も弱い。**恒久運用**では systemd ユニットへ寄せることを推奨する（`llama-server` 本体は従来どおり on-demand のみ常駐させない）。

1. リポジトリの [`scripts/dgx-local-llm-system/systemd/`](../../scripts/dgx-local-llm-system/systemd/) を DGX 上の同パス（または手元からコピー）で参照する。
2. `control-server.env.example` / `gateway-server.env.example` を元に、`/srv/dgx/system-prod/secrets/control-server.env` と `gateway-server.env` を作成する（`chmod 600`）。値は既存の `runtime-control-token` / `api-token` と**同一**にする（Pi5 `vault` とも整合）。
3. root で `install-systemd-units.sh` を実行し、`dgx-llm-embedding.service` → `dgx-llm-control.service` → `dgx-llm-gateway.service` を有効化する。installer は既定で `/srv/dgx/system-prod` の owner/group を unit の `User` / `Group` に埋め込むため、root 実行による log / PID 所有者の崩れを避けられる。
4. `systemctl status` で `38081` / `39090` / 埋め込みコンテナ相当が復帰することを確認したら、重複起動を避けるため **ユーザ `crontab` の `@reboot` 3 行を削除またはコメントアウト**する。
5. Pi5 から `POST /start` → `GET /v1/models` → `POST /v1/chat/completions` → `POST /embed` → `POST /stop` のスモークを再実行する。

詳細は [`scripts/dgx-local-llm-system/README.md`](../../scripts/dgx-local-llm-system/README.md) の systemd 節を参照。

> 履歴は [移行履歴 archive](../archive/runbooks/dgx-system-prod-local-llm-history-2026-04-06.md#本番既定-backend-の判断ログ2026-04-28) へ移設した（「本番既定 backend の判断ログ（2026-04-28）」ほか）。

### Blue/Green backend での安全な差し替え

新 runtime を並行検証するときは、Pi5 から見える契約は固定したまま、DGX 内部だけを切り替える。

- 固定するもの:
  - 外部入口 `38081`
  - `api-token` / `runtime-control-token`
  - alias `system-prod-primary`
- 切り替えるもの:
  - `ACTIVE_LLM_BACKEND=green`（現行 `llama.cpp`）
  - `ACTIVE_LLM_BACKEND=blue`（新しい blue backend。現時点の第一候補は `Qwen3.6-27B-NVFP4` を Spark 向け `vLLM` image で起動する構成）

systemd 運用では、`/srv/dgx/system-prod/secrets/control-server.env` と `gateway-server.env` の両方に同じ `ACTIVE_LLM_BACKEND` を書き、`systemctl restart dgx-llm-control dgx-llm-gateway` で反映する。blue 側は `127.0.0.1:38083` 想定で、`start-trtllm-server.sh` / `stop-trtllm-server.sh` から container を起動停止する。ファイル名は歴史的に `trtllm` だが、実体は **任意 image + 任意 command を受ける blue backend launcher** である。`@reboot` / 手動起動の `start-control-server.sh` / `start-gateway-server.sh` も同じ `secrets/*.env` を自動で `source` する。

#### 単一アクティブ運用ガード（`DGX_LLM_SINGLE_ACTIVE_GUARD`）

- **目的**: `green`（`llama-server`）と `blue`（vLLM コンテナ等）の推論ランタイムが **同時に残らない**ようにする（GPU/統一メモリの二重占有・応答モデルが不明瞭になることを防ぐ）。
- **既定**: 環境変数未設定でも **有効**（`true` 相当）。`control-server.py` は **`POST /start` の直前に非アクティブ側へ実 stop を必ず実行**し、その後にアクティブ側の start を実行する。
- **`keep_warm` との関係**: `BLUE_LLM_RUNTIME_STOP_MODE=keep_warm`（または `always_on`）は **アクティブ側が blue のときの `/stop` のみ no-op** となる。**非アクティブ側**を止める処理には適用されない（`/start` 前に残留していたもう一方の backend は必ず実停止される）。
- **起動時検証**: ガード有効時、`GREEN_LLM_RUNTIME_STOP_CMD` / `BLUE_LLM_RUNTIME_STOP_CMD` と **`LLM_RUNTIME_STOP_CMD`（フォールバック）の両系統から実停止コマンドが解決できること**を起動時に確認する（片側のみしか用意しない検証ホストでは起動を拒否される）。
- **オプトアウト**: `DGX_LLM_SINGLE_ACTIVE_GUARD=false`（または `0` / `no` / `off`）で **`/start` 前の非アクティブ stop と dual-stop の起動検証を無効化**。通常の `system-prod` では **両 backend の stop コマンドを揃えたうえでガード ON を維持**する。
- **実装の置き場所**: [`scripts/dgx-local-llm-system/dgx_llm_single_active_guard.py`](../../scripts/dgx-local-llm-system/dgx_llm_single_active_guard.py) に単一アクティブ判定を集約し、`control-server.py` が import して `/start` に組み込む。

#### 強制停止（`/stop-force`）

- **目的**: `private_ok` で Comfy 向けに Spark メモリを空けたいとき、**blue active + `keep_warm` / `always_on`** でも **実ランタイムを確実に落とす**。
- **通常 `/stop` との違い**: `/stop` は blue の stop policy を尊重し、**keep_warm 系では no-op** になり得る。**`/stop-force`** は **active backend の stop command をそのまま実行**し、**keep_warm を上書き**する。
- **用途**: 管理コンソールの **`private_ok`** からの私用切替、または明示的に GPU / 統一メモリを空けたい保守操作。**Hermes keep-warm や通常運用の `/stop` 契約は壊さない**。
- **Pi5 からの到達**: 既定の runtime stop URL（**`38081/stop`**）に **`-force` サフィックス**（`dgx-resource.gateway-runtime.executor.ts`）。**gateway は `/stop-force` を `39090` へプロキシ**する（`/start`・`/stop` と同型）。**gateway 未更新時は `38081/stop-force` が 404** となり強制停止は失敗する（2026-05-25 本番で確認）。

#### 切替後の 4 点チェック（推奨）

1. **`ACTIVE_LLM_BACKEND` の実効値**: `control-server.env` と `gateway-server.env` が **同一**であること。
2. **`GET /v1/models`（入口は通常 `38081`）**: `system-prod-primary` の応答があり、`root`（またはモデル識別子）が **期待どおり**であること。
3. **Listen ポート**: アクティブに応じて **不要側が listen していない**こと（例: `ACTIVE_LLM_BACKEND=blue` なら `127.0.0.1:38082` に **いない**）。
4. **プロセスとコンテナ**: `ps` と `docker ps` で **もう一方の backend** が残っていないこと。

```bash
# 1) env の一致
sed -n '/^ACTIVE_LLM_BACKEND=/p' /srv/dgx/system-prod/secrets/control-server.env
sed -n '/^ACTIVE_LLM_BACKEND=/p' /srv/dgx/system-prod/secrets/gateway-server.env

# 2) gateway 応答モデル
TOKEN="$(cat /srv/dgx/system-prod/secrets/api-token)"
curl -sS -H "X-LLM-Token: ${TOKEN}" http://127.0.0.1:38081/v1/models

# 3) listen port
ss -ltnp | awk '/:38081|:38082|:38083|:39090|:38100/'

# 4) process / container
ps -eo pid,cmd | awk 'BEGIN{IGNORECASE=1} /llama-server|vllm|system-prod-trtllm/ {print}'
docker ps --format '{{.Names}}\t{{.Image}}\t{{.Status}}' | awk 'BEGIN{IGNORECASE=1} /system-prod|trtllm|vllm/ {print}'
```

**PASS の目安**:

- `control-server.env` / `gateway-server.env` の `ACTIVE_LLM_BACKEND` が一致
- `38081 /v1/models` の `root` が期待した backend と一致
- 非アクティブ側 port が listen していない（例: blue active なら `38082` 不在）
- 非アクティブ側の `llama-server` / `vllm` / `system-prod-trtllm` が残っていない

まずは DFlash なしで blue 単体起動を成立させ、`system-prod-primary` alias の text / vision 疎通を確認する。その後に必要なら `z-lab/Qwen3.6-27B-DFlash` を追加する。Phase2 実機投入で使う最小 blue 例:

```dotenv
# /srv/dgx/system-prod/secrets/control-server.env
LLM_RUNTIME_CONTROL_TOKEN=...
ACTIVE_LLM_BACKEND=blue
BLUE_SERVER_IMAGE=ghcr.io/aeon-7/vllm-spark-omni-q36:v1.2
BLUE_SERVER_PORT=38083
BLUE_SERVER_CONTAINER_PORT=8000
# BLUE_SERVER_ENTRYPOINT=bash
BLUE_MODEL_DIR=/srv/dgx/system-prod/data/hf-cache/hub/models--sakamakismile--Qwen3.6-27B-NVFP4
VLLM_GPU_MEMORY_UTILIZATION=0.65
VLLM_MAX_MODEL_LEN=8192
VLLM_MAX_NUM_SEQS=4
VLLM_MAX_NUM_BATCHED_TOKENS=16384
VLLM_KV_CACHE_DTYPE=fp8
VLLM_LANGUAGE_MODEL_ONLY=true
VLLM_QUANTIZATION=compressed-tensors
# BLUE_SERVER_COMMAND は通常空。start-trtllm-server.sh が vllm_command_builder.py で snapshot path を解決する。
BLUE_EXTRA_DOCKER_ARGS='--ipc host --ulimit memlock=-1 --ulimit stack=67108864'
```

```dotenv
# /srv/dgx/system-prod/secrets/gateway-server.env
LLM_SHARED_TOKEN=...
# 任意（2026-05-24 Phase D0）: Hermes chat/tools 専用トークン（カンマ区切り）
# LLM_SHARED_ADDITIONAL_TOKENS=hermes-chat-token,hermes-tools-token
LLM_RUNTIME_CONTROL_TOKEN=...
ACTIVE_LLM_BACKEND=blue
GREEN_LLM_BASE_URL=http://127.0.0.1:38082
BLUE_LLM_BASE_URL=http://127.0.0.1:38083
```

**複数トークン**: repo [`gateway_llm_auth.py`](../../scripts/dgx-local-llm-system/gateway_llm_auth.py) は `X-LLM-Token` / `Authorization: Bearer` のいずれかが primary または additional に一致すれば 200。私用 Pi5 Hermes の手順は private-pi5-hermes-deploy.md §Phase D0（DGXSparkControlPlane `docs/private-history/runbooks/private-pi5-hermes-deploy.md`）。

メモ:

- `TRTLLM_*` という env 名は互換のため残しているだけで、blue backend の実体は TRT-LLM に限らない
- 新しい設定では `BLUE_SERVER_*` / `BLUE_MODEL_DIR` / `BLUE_EXTRA_DOCKER_ARGS` の別名も使える
- profile 指定の blue 起動では、launcher が `BLUE_SERVER_COMMAND` / `TRTLLM_SERVER_COMMAND` を空上書きする。既存 env に legacy fallback command を残す運用でも、管理コンソールの profile 起動は manifest 側のモデルを使う
- **snapshot path の解決**: `vllm_command_builder.py` が `cat ${BLUE_MODEL_DIR}/refs/main` 相当を実行し、`snapshots/<sha>` を `vllm serve` に渡す。secret に snapshot SHA 直書きは不要
- **Hermes `/task` 復旧（2026-06-05）**: repo id ではなく **snapshot path** · **`gpu-memory-utilization 0.65`** · **`language_model_only`** が実機で必須だった — 詳細 [KB-366 §8.1](./../knowledge-base/KB-366-dgx-spark-operational-understanding.md#81-blue-27b-起動失敗と-hermes-task-5022026-06-05) · KB `/task` blue 502（DGXSparkControlPlane `docs/private-history/knowledge-base/KB-private-pi5-hermes-task-dgx-profile-restore.md`）

### トラブルシュート — blue backend 起動失敗 / `/v1/models` 502（2026-06-05）

| 症状 | 確認 | 対処 |
|------|------|------|
| `POST /start` 200 だが `/v1/models` **502** | `docker ps` · `docker logs system-prod-trtllm` | 起動中なら **数分待ち**（compile/autotune）。container exit なら下記 |
| vLLM が HF metadata で落ちる | `BLUE_SERVER_COMMAND` が残っていないか、`BLUE_MODEL_DIR/refs/main` と `snapshots/<sha>` があるか | `BLUE_SERVER_COMMAND` を空にし、`BLUE_MODEL_DIR` + `vllm_command_builder.py` に snapshot path を解決させる |
| `CUDA out of memory` / メモリ不足 | `--gpu-memory-utilization` | **`0.65`** から試す（実機で Hermes `/task` 復旧確認済） |
| Hermes `/task` のみ失敗・業務 Pi5 は別症状 | Pi5 から `curl …/v1/models`（tools Bearer） | DGX backend 正本。profile 切替は Hermes Runbook §profile 復帰（DGXSparkControlPlane `docs/private-history/runbooks/private-pi5-hermes-deploy.md`） |

**反映手順（DGX のみ）**: `control-server.env` 編集 → **control-server 再起動**（PID ガード手順）→ **`POST /start`**（`business_qwen36_27b_nvfp4`）→ `curl http://127.0.0.1:38083/v1/models` が **200** になるまで待つ。
- image 既定 entrypoint が shell でない場合は `BLUE_SERVER_ENTRYPOINT=bash` を併用する
- 最初の成功条件は **`/v1/models` が `system-prod-primary` を返し、Pi5 の on-demand ready probe が通ること**
- DFlash を後から足す場合は、drafter mount と `--attention-backend flash_attn` / `--speculative-config ...` を追加する
- `Qwen3.6-27B-NVFP4` は dense 27B なので、MoE の `Qwen3.6-35B-A3B` より速度期待は控えめに見る

> 履歴は [移行履歴 archive](../archive/runbooks/dgx-system-prod-local-llm-history-2026-04-06.md#2026-04-26-dgx-上の不要物を整理) へ移設した（「2026-04-26 DGX 上の不要物を整理」ほか）。

## コンテナ隔離・ホスト汚染・他コンテナとの関係（2026-04-26 追補）

- **推論の実体**は DGX 上の **Docker コンテナ**（`llama-server` や vLLM blue など）内に置き、ホストに CUDA スタックを手作業で導入する前提にはしない。モデル重みは **`/srv/dgx/shared-models` 等への bind mount** など、用途領域で決めたパスに置く。
- **本システム用（`system-prod`）**は、用途別に用意した **ディレクトリ・`secrets`・Docker network**（例: `dgx_system_prod_net`）で他用途（`private-personal` / `lab-experiments`）の Compose や業務外データ path と**混ぜない**方針とする（ExecPlan の分離設計に沿う）。
- **他コンテナと混信ゼロ**の意味では、**同一物理 DGX** では **GPU / 統一メモリ / CPU** を**共有**する。別コンテナの負荷や巨大モデル起動は、**リソース上は相互に影響**し得る。ネットワーク分離（別 bridge）や port 分離は**通信上の衝突**を避けるが、**演算リソースの排他**までは保証しない。
- blue（vLLM）起動例で `--ipc host` を付与する場合、**IPC 名前空間がホストと共有**される。これは性能目的の**意図的なトレード**であり、**仮想マシン相当の厳密分離**ではない。必要なら Runbook / launcher の `BLUE_EXTRA_DOCKER_ARGS` を見直す。
- **混信（データの混入）**の観点では、**Pi5 用 token / 業務データ path を他用途の Compose に mount しない**こと、**別 tailnet 入口**（ACL で Pi5 から `llm:38081` のみ、等）を維持することが主な防御策である。

## `/dev/shm` の残骸と週次掃除（2026-10-12）

- **原因**: blue（vLLM）は `--ipc host` で動くため、コンテナが起動するたびに `psm_*` などの共有メモリファイルがホストの `/dev/shm` に残る。DGX は GPU と CPU でメモリを共有するので、残骸はそのままモデルに使える量を減らす。
- **実測（2026-10-12）**: 1,544 ファイル、実サイズ 2.2 GiB（ほぼ全部が `psm_*` 269 個）。1 日以上前で未使用の 1,487 件（2,101 MiB）を削除し、110 MiB になった。削除後も `system-prod-trtllm` と `system-prod-embedding` は正常。
- **掃除スクリプト**: DGX の `/usr/local/sbin/dgx-shm-cleanup`（root 所有、内容は下の「スクリプトとユニットの内容」）。root で実行する。引数なしは一覧表示のみ、`--delete` で削除する。対象は `/dev/shm` 直下のファイルのうち、1 日以上前で、どのプロセスも開いておらずマップもしていないもの。
- **週次タイマー**: `dgx-shm-cleanup.service` / `dgx-shm-cleanup.timer` を `/etc/systemd/system/` に導入済み。毎週日曜 4:00 に実行し、`Persistent=true` で取りこぼしは次回起動時に実行する。標準デプロイからは配布しない。
- **確認**: `systemctl list-timers dgx-shm-cleanup.timer`、`journalctl -u dgx-shm-cleanup.service`、`df -h /dev/shm`。
- **再導入**: スクリプトを `/usr/local/sbin/dgx-shm-cleanup` に `install -o root -g root -m 0755` で置き、ユニット 2 つを `/etc/systemd/system/` に置いて `systemctl daemon-reload && systemctl enable --now dgx-shm-cleanup.timer`。root のタイマーが実行するので、スクリプトを一般ユーザーが書き換えられる場所に置かない。
- **停止**: `sudo systemctl disable --now dgx-shm-cleanup.timer`。

### スクリプトとユニットの内容

`/usr/local/sbin/dgx-shm-cleanup`:

```bash
#!/usr/bin/env bash
# /dev/shm に残った古い共有メモリファイルを消す。
# 既定は一覧表示のみ。--delete を付けたときだけ削除する。
# 対象: 1 日以上前のファイルで、どのプロセスも開いておらず、マップもしていないもの。
set -euo pipefail

if [ "$(id -u)" != 0 ]; then
  echo "root で実行してください (sudo bash $0 [--delete])" >&2
  exit 1
fi

mode=${1:-}
min_age_min=1440
inuse=$(mktemp)
trap 'rm -f "$inuse"' EXIT

# root なら全プロセス(コンテナ内も含む)の fd と maps が見える
for p in /proc/[0-9]*; do
  ls -l "$p/fd" 2>/dev/null | grep -o '/dev/shm/[^ ]*' || true
  grep -o '/dev/shm/[^ ]*' "$p/maps" 2>/dev/null || true
done | sort -u > "$inuse"

echo "使用中として除外する名前: $(wc -l < "$inuse") 件"
echo "実行前: $(df -h /dev/shm | tail -1)"

count=0
kb=0
skipped=0
while IFS= read -r -d '' f; do
  if grep -qxF "$f" "$inuse"; then
    skipped=$((skipped + 1))
    continue
  fi
  size=$(du -k "$f" | cut -f1)
  count=$((count + 1))
  kb=$((kb + size))
  if [ "$mode" = "--delete" ]; then
    rm -f -- "$f"
  fi
done < <(find /dev/shm -xdev -maxdepth 1 -type f -mmin +"$min_age_min" -print0)

if [ "$mode" = "--delete" ]; then
  echo "削除: $count 件, $((kb / 1024)) MiB (使用中で除外: $skipped 件)"
  echo "実行後: $(df -h /dev/shm | tail -1)"
else
  echo "削除対象: $count 件, $((kb / 1024)) MiB (使用中で除外: $skipped 件)"
  echo "まだ何も消していません。消すには --delete を付けて実行してください。"
fi
```

`/etc/systemd/system/dgx-shm-cleanup.service`:

```ini
[Unit]
Description=Remove stale shared memory files left in /dev/shm by restarted containers

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/dgx-shm-cleanup --delete
```

`/etc/systemd/system/dgx-shm-cleanup.timer`:

```ini
[Unit]
Description=Weekly cleanup of stale /dev/shm files

[Timer]
OnCalendar=Sun 04:00
Persistent=true

[Install]
WantedBy=timers.target
```

## トラブルシューティング補足（blue・Pi5 連携）

- **DGX へ SSH / Tailscale が通らない**: cold start 中の高負荷に加え、**ホスト全体の応答不良**でも banner 前で落ちることがある。ローカル LAN や**物理コンソール**を試し、必要なら**再起動**。常に **`docker logs`（vLLM / gateway）**で起動段階を先に追う。
- **Pi5 API が起動に失敗（Zod）**: `LOCAL_LLM_RUNTIME_READY_TIMEOUT_MS` を inventory で伸ばす場合、**`apps/api/src/config/env.ts` の `max` 以下**でないと API コンテナが起動しない。repo 側の上限拡大と**セット**で反映する。
- **upstream `400` + 画像（VLM）**: **応答 body** で大まかに分類できる。**(1) 画像デコード失敗**系（例: `Failed to load image: cannot identify image file`）は **bytes / MIME / 破損**を疑う。**(2) コンテキスト超過**系（例: `Input length … exceeds … maximum context length`）は **プロンプト＋画像トークンが長すぎる**可能性。切り分け: payload（base64 / URL）の最小再現、**DGX 上**または **Pi5 から到達する同一 URL** で `probe-photo-label-vlm.py`、**`docker logs`**（vLLM `system-prod-trtllm` 等）。**到達経路**: 開発端末から DGX 入口 **直接 HTTP** は **timeout** になり得る → **Pi5 へ SSH** し **`127.0.0.1:38081`** へ **ローカルポートフォワード**（トンネル）で当てると切り分けしやすい。**観測（2026-04-28）**: Pi5 **保存済み**画像 **531 件**を一括プローブした例では **全件 200**（ストレージ母集団では 400 が出ない観測）。Pi5 側 `local-llm-proxy` の `reasoning` フォールバックは**本文空**対策であり、**400 自体**は解消しない。

> 履歴は [移行履歴 archive](../archive/runbooks/dgx-system-prod-local-llm-history-2026-04-06.md#2026-04-27-pi5-本番repo-差分の正規--手元同期で収束した例) へ移設した（「2026-04-27 Pi5 本番：repo 差分の「正規 + 手元同期」で収束した例」ほか）。

## 推奨ポートと役割

Ubuntu 現行構成との互換を優先し、DGX 側でも次を基本にする。

- 外部入口: `38081` (`nginx` / 認証 / `/healthz` / `/v1/`* / `/start` / `/stop`)
- 内部推論: `127.0.0.1:38082` (`llama-server`)
- 内部推論 blue: `127.0.0.1:38083`（blue backend。現時点の第一候補は Spark 向け `vLLM`）
- 内部制御: `39090` (`control-server.py` / `control-server.mjs` 互換)
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

> 履歴は [移行履歴 archive](../archive/runbooks/dgx-system-prod-local-llm-history-2026-04-06.md#段階切替の基本方針暫定-fallback) へ移設した（「段階切替の基本方針（暫定 fallback）」ほか）。

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

この節は 2026-04 前半の段階切替（text 系を Spark、`photo_label` を Ubuntu fallback）の記録である。2026-04-26 以降の本番は `dgx_primary` 単一 provider に一本化済み（[§Spark 一本化反映](../archive/runbooks/dgx-system-prod-local-llm-history-2026-04-06.md#2026-04-26-spark-一本化反映)）で、Ubuntu fallback は使わない。

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
api_local_llm_runtime_ready_timeout_ms: "900000"

inference_providers_json: >-
  [{"id":"dgx_primary","baseUrl":"http://<dgx-tailnet-ip>:38081","sharedToken":"<dgx-token>","defaultModel":"system-prod-primary","timeoutMs":60000,
    "runtimeControl":{"mode":"on_demand","startUrl":"http://<dgx-tailnet-ip>:38081/start","stopUrl":"http://<dgx-tailnet-ip>:38081/stop","controlToken":"<dgx-runtime-token>","healthBaseUrl":"http://<dgx-tailnet-ip>:38081"}}]
inference_document_summary_provider_id: "dgx_primary"
inference_document_summary_model: "system-prod-primary"
inference_photo_label_provider_id: "dgx_primary"
inference_photo_label_model: "system-prod-primary"
```

共有トークンの入れ替え: DGX の `/srv/dgx/system-prod/secrets/api-token`（`X-LLM-Token`）と Pi5 の `vault_api_local_llm_shared_token`（API の `LOCAL_LLM_SHARED_TOKEN`）は常に同じ値にする。新しい値は十分長い乱数（例 `openssl rand -hex 32`）で作り、平文をチャット・Issue に貼らない。Pi5 側は vault を更新し、標準経路で Pi5 だけ（`--limit raspberrypi5`）を反映して、`/api/system/local-llm/status` と chat で確認する。401 や `health.ok=false` のときは両方の値の一致を確認する。

`blue`（`vLLM` + NVFP4）を on-demand で使う場合、cold start が 10 分超になるケースがある。`api_local_llm_runtime_ready_timeout_ms` は `900000` 以上を推奨する。

さらに、検証フェーズでは DGX `control-server.env` で **blue の停止ポリシー**を指定できる（推奨: `BLUE_LLM_RUNTIME_STOP_MODE`）。`keep_warm` または `always_on` のとき、active backend が blue なら `/stop` は no-op 化し、**実ランタイムを落とさない**（`on_demand` では従来どおり `BLUE_LLM_RUNTIME_STOP_CMD` を実行）。**互換**: `BLUE_LLM_RUNTIME_STOP_MODE` 未使用時は `BLUE_LLM_RUNTIME_KEEP_WARM=true` で同等の `keep_warm` 相当。詳細: `scripts/dgx-local-llm-system/runtime_stop_policy.py`、ADR: [ADR-20260427-blue-llm-runtime-stop-policy.md](../decisions/ADR-20260427-blue-llm-runtime-stop-policy.md)。

#### Blue 停止ポリシーと一般的大規模推論運用（対照）

| 本リポのモード | ざっくり意味 | 主な比較軸（トレードオフ） |
| --- | --- | --- |
| `on_demand` | 利用後に止める | **リソース回収**・他用途との併用に有利。起動**待ち**は最大（blue cold start ~12 分規模の可能性）。 |
| `keep_warm` / `always_on` | `/stop` を掛けず温存 | **反復検証/SLA 寄り**の応答導通に有利。GPU/メモリ**占有**が続く。 |
| （Pi5 側 `on_demand` 制御） | リクエスト単位の ensure/release | クラウド系では **HPA + 最小レプリカ**、**重みの事前キャッシュ**と同軸。単一 DGX では `STOP_MODE` で近似。 |

**外部のよくあるパターン（要約）**: 本番 vLLM / K8s では、巨大モデルは **起動＋重み load がボトルネック**になることが多く、**永続 volume 上の重み**・**スケール時の待ち行列**・**prefix caching 等**で tail latency を抑える。本システムは **1 台 DGX**・Pi5 gateway が `start`/`stop` を叩くため、**`keep_warm` は「最小レプリカ 1 相当の温域」**、`on_demand` は **ゼロスケール寄り**と読み替えられる。推奨の整理は ADR および `docs/plans/dgx-spark-local-llm-migration-execplan.md` の **green→blue 本番採用判断**と合わせる。

blue では upstream `chat.completions` の返りが `message.content` ではなく `message.reasoning`（または `reasoning_content`）に寄ることがある。Pi5 API 側 `local-llm-proxy` では、`content` が空のときに `reasoning` / `reasoning_content` / `content[]`（text parts）へフォールバックして本文を抽出する実装を入れておく。

secret は少なくとも次を vault で持つ。

- `vault_api_local_llm_shared_token`
- `vault_api_local_llm_runtime_control_token`

`inference_providers_json` 内の token は、そのまま inventory に平文で書かず、vault 変数から組み立てる。

2026-04-25 時点の実値に寄せるなら、`<dgx-tailnet-ip>` は `100.118.82.72`。

> 履歴は [移行履歴 archive](../archive/runbooks/dgx-system-prod-local-llm-history-2026-04-06.md#2026-04-25-の実反映メモ) へ移設した（「2026-04-25 の実反映メモ」ほか）。

## 重要な注意

- `LOCAL_LLM_`* は **管理 Chat / status / on-demand 制御**の正本であり、`INFERENCE_PROVIDERS_JSON` だけでは置き換わらない
- `INFERENCE_PROVIDERS_JSON` は **photo_label / document_summary の用途別ルーティング**に加え、**provider ごとの runtimeControl** を持てる
- Pi5 API の runtime 制御は、`document_summary` / `photo_label` / `admin_console_chat` / **`stackchan_chat`** が解決した **provider 単位**で start/stop を叩く（`stackchan_chat` は admin provider と同一経路）
- `photo_label` を DGX / Spark へ切り替える前に、**現行 `Qwen3.5-35B` + `mmproj` で vision payload が同じ入口で通るか**を必ず確認する
- Ubuntu fallback は **暫定運用**であり、Spark が `photo_label` まで担えると確認できたら、Ubuntu 前提の token / runtimeControl / rollback は縮退対象になる
- rollback は、Pi5 の `LOCAL_LLM_BASE_URL` と `LOCAL_LLM_RUNTIME_CONTROL`_* を Ubuntu 側へ戻せばよい形にしておく

> 履歴は [移行履歴 archive](../archive/runbooks/dgx-system-prod-local-llm-history-2026-04-06.md#localhost-smoke-実績2026-04-25) へ移設した（「localhost smoke 実績（2026-04-25）」ほか）。

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

> 履歴は [移行履歴 archive](../archive/runbooks/dgx-system-prod-local-llm-history-2026-04-06.md#rollback) へ移設した（「rollback」ほか）。

## DGX 実機適用とロールバック（GB10 性能パラメータ · 2026-07-05）

**対象**: repo 内 `scripts/dgx-local-llm-system/` の vLLM コマンドビルダー・model profile manifest（`business_qwen36_27b_nvfp4` / `business_ornith_35b_nvfp4` 等）。

**前提**: 本節は **DGX ホストへの手動反映**用。Pi5 `--limit raspberrypi5` だけでは DGX 側スクリプトは更新されない。

### 適用手順（概要）

1. Mac または管理端末から DGX へ SSH（tailnet 例: `100.118.82.72`）。
2. `/srv/dgx/system-prod/bin/`（または運用中の正本パス）へ repo から `vllm_command_builder.py`・`profile_launcher.py`・`model-registry.examples/` を **rsync/scp** で反映。
3. 対象 model profile manifest を DGX の model registry 正本へコピー（`business_qwen36_27b_nvfp4` 等）。
4. **業務→私用→業務** または orchestration **業務復帰** で blue backend を再起動（profile 切替で vLLM 再起動）。
5. 確認:
   - `GET /healthz` · `GET /v1/models`（activeProfileId 一致）
   - 管理 Chat 疎通 · 代表 `photo_label` / `document_summary`（設定済み用途）
   - DGX 側ログで `--moe-backend marlin` · `VLLM_MARLIN_USE_ATOMIC_ADD=1` · `--enable-chunked-prefill` **無し**（NVFP4 業務 profile の場合）

### 変更内容（2026-07-05 repo 正本）

| 項目 | 旧 | 新（NVFP4 業務 profile） |
| --- | --- | --- |
| Marlin atomic add | 未設定 | `VLLM_MARLIN_USE_ATOMIC_ADD=1` |
| MoE backend | 自動 | `--moe-backend marlin` |
| KV cache | `fp8` | 未指定（f16 既定） |
| Chunked prefill | 既定 ON | manifest で `false` |
| max-model-len | 8192 | 16384 |

### ロールバック

1. 反映前の `vllm_command_builder.py` / manifest を timestamp 付き backup から復元。
2. 同一 profile で gateway `/stop` → `/start`（または orchestration 業務復帰）。
3. `GET /v1/models` と管理 Chat で疎通確認。
4. 性能劣化・OOM の場合は `maxModelLen` を 8192 に戻し、`gpuMemoryUtilization` を下げる。

**参照**: [docs/plans/dgx-spark-optimization-execplan-202607.md](../plans/dgx-spark-optimization-execplan-202607.md) · [ADR-20260705](../decisions/ADR-20260705-dgx-spark-gb10-inference-performance-parameters.md)

## GLM-5.3-Flash(2台)への切替とロールバック {#glm53-flash-tp2}

実機操作は保守時間内に利用者が行う。Control Plane の後方互換対応(CP1)を先に反映する。
GLM 稼働中は Spark 2 の GPU も業務 worker が専有するため、私用モデルと同時には使えない。

1. Spark 1 の `/srv/dgx/system-prod/bin/` に `glm53-flash-tp2-adapter.sh`、
   `start-trtllm-server.sh`、`stop-trtllm-server.sh`、`profile_launcher.py`、`gateway-server.py` を配置する。
   shell は実行可能にし、既存の control/gateway 起動手順で Python の変更を再読込する。
   例の `model-registry.examples/business_glm53_flash_fp4_tp2/manifest.json` は
   `/srv/dgx/shared-models/registry/business_glm53_flash_fp4_tp2/manifest.json` に配置する。
2. head の重みは `/srv/dgx/system-prod/data/models/GLM-5.3-Flash-FP4-Local`、
   worker は `/home/ubudgxkoushi/models/GLM-5.3-Flash-FP4-Local` に用意する。
   `ubudgxkoushi` から `ssh -o BatchMode=yes -o ConnectTimeout=10 ubudgxkoushi@192.168.100.11` と
   Docker の利用を確認し、manifest の image を両ノードに事前取得する（`blueServerImage` で digest 固定も可）。
   `blueCacheDir` は両ノードそれぞれの同じ絶対パスにマウントするローカル cache である。
   registry の storage 検証は head 側のみで、worker のディレクトリは起動時に SSH で検査する。
3. keep-warm と Pi5 の on-demand が Qwen を再起動しない保守状態にし、標準制御経路で `/stop-force` を送る。
   Pi5 の `*_RUNTIME_START_PROFILE_ID`、CP の `dgx_keep_warm_profile_id` と
   `dgx_private_shared_business_profile_id` を GLM の ID に揃え、
   `/start {"modelProfileId":"business_glm53_flash_fp4_tp2"}` を送る。
   起動コマンドはコンテナ起動だけで戻るため、`/v1/models` の `system-prod-primary` と
   active profile、priority 付き会話・画像・思考制御を別途確認して保守状態を解除する。
4. ロールバックは同じ保守状態で `/stop-force` を送り、両コンテナの停止を確認する。
   指す先を `business_qwen38_flash_next_nvfp4` に戻し、同 ID で `/start` して応答を確認する。
   Qwen の重みは経過観察が終わるまで残す。
5. GPU メモリ割合はマニフェストの `runtimeProfile.vllm.gpuMemoryUtilization` で決まる(既定 0.85、2026-10-23 から)。
   値を変えたら、標準制御経路の `/stop-force` と `/start` で入れ直す。CP を通さずに手で再起動すると、
   CP の起動監視が確認に失敗したと判断し、自動で入れ直すことがある(2026-10-23 に1回発生)。
6. keep-warm の指すプロファイルは、CP の private inventory の `dgx_keep_warm_profile_id` を変え、
   CP の `dgx_agent` ロールで drop-in を再適用する。`config.conf` を手で書き換えない。

両 rank に `dgx.profile` ラベルを付け、要求 ID は launcher が `BLUE_MODEL_PROFILE_ID` で渡す。
別 profile の head が稼働中なら `/start` は失敗するので、先に `/stop-force` を行う。
worker の停止情報は `/srv/dgx/system-prod/state/blue-remote-worker.json`
（起動・停止共通の `BLUE_REMOTE_WORKER_MARKER_PATH` で変更可）に残す。
SSH 停止失敗時は marker を保持して非0を返すため、接続を復旧して停止を再実行する。
drop_caches は両ノードで特権一時コンテナから実行し、失敗は stderr に記録して起動を続ける。

## Nemotron 3.5 Lightning + DSpark の段階導入

対象は `business_nemotron35_lightning_dspark_nvfp4`。初期manifestは **disabled / 非推奨 / textのみ**。
これは導入候補であり、実機起動・業務回答品質・10秒以内は未検証。Pi5のHermes、DB、MCPは変更しない。
[NVIDIA公式手順](https://huggingface.co/nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-NVFP4#quick-start)の
vLLM 0.27.1 + DSpark K=3 + Marlin + FP8 KV + Mamba flashinfer/alignを既存blue起動経路で使用する。
Qwen専用PLE adapterは利用しない。`reasoning-parser=nemotron_v3`、ツールparserは `qwen3_coder`。

### 固定する配布物と準備

- 本体revision: `bee7596271d1495f6992ae224aefde4410e816b8`
- DSpark revision: `8a0177116d138011e63103110f136ec0ca09ebbf`
- vLLM 0.27.1 linux/arm64 digest: `sha256:1c8e60a0841b333c700488cb029d3664807249da0c071e862191b00fe34b228c`
- 重み約22.91GB、圧縮コンテナ約10.53GB。新規通信量は合計約33.44GB。RAM使用量ではない。
- 保存先は実行ユーザー所有の `/srv/dgx/system-prod/data/nemotron35-hf-cache`。
  `blueHfCacheDir` が同じディレクトリをコンテナへ渡す。既存の共有 `hf-cache/hub` がroot所有でも、
  その所有権を変更せず専用保存先で取得する。既存Qwenのcacheは変更しない。
- 準備時の空き容量チェックは保守的な **70GiB**。展開と一時ファイルを見込んだ運用予算であり実測値ではない。
  Docker data-rootがHF cacheと別filesystemなら、両方の空き容量を別途確認する。

実機接続・反映にはAGENTS.mdの対象SHA/CI確認と承認境界を適用する。
承認済みSHAから、従来のDGX専用反映手順で次を配布する（通常のPi5 fleet deployだけでは反映されない）：

- `profile_launcher.py`、`vllm_command_builder.py`、`start-trtllm-server.sh`、`nemotron35_dspark_cache.py`
- 新規manifest → `/srv/dgx/shared-models/registry/business_nemotron35_lightning_dspark_nvfp4/manifest.json`

先に既存runtimeファイルとactive profile、常駐モデル設定を保存する。Qwenのmanifest、重み、imageは保持する。
control-serverはPython moduleを常駐importするため、反映時は既存の管理方式で再読込が必要。
実際に使われているsystemd/起動wrapperを確認し、独立したcontrol-serverを追加起動しない。

DGXの永続実行ユーザーで、配布済みディレクトリから明示実行する：

```bash
python3 nemotron35_dspark_cache.py plan
python3 nemotron35_dspark_cache.py fetch
python3 nemotron35_dspark_cache.py verify
```

`plan` は変更なし。`fetch` は固定imageを取得し、そのHub clientで両モデルの固定revisionを取得する。
取得用コンテナはGPU・ポート・常駐サービスを使わず、active profileや `refs/main` も変更しない。
`verify` と通常起動はネットワーク取得をせず、両snapshotの設定・重みの存在とsafetensorsの長さを確認する。
DSparkは本体のtokenizerを使うため、draft側のtokenizerファイルを要求しない。
この起動時検査は全重量ファイルのchecksum再計算ではない。欠損・切断・明らかな未完了取得を拒否する。
通常起動は `--pull never` とHub/Transformers offlineを指定し、モデル・イメージの起動時ダウンロードを禁止する。

### 試験切替と復帰

1. 取得とverify成功後、試験時間帯の排他・常駐維持設定を確認する。
   ControlPlaneの `DGX_KEEP_WARM_PROFILE_ID` が別モデルを指定している場合は競合させない。
   設定変更が必要ならControlPlaneの既存手順で行い、業務優先・Lease制御を迂回しない。
2. 試験対象manifestだけ `enabled=true` にして、既存orchestrationの停止→モデル指定業務復帰で切り替える。
   稼働中の同じblueコンテナへの単発 `/start` は切替にならないため使わない。
3. `/v1/models` に加え `activeProfileId`、backend、実際の起動ログのmodel/draft snapshotを確認する。
4. Hermes経由で日本語、ツール呼び出し、根拠付き回答、該当なし、聞き返し、継続会話を確認する。
   既存の `enable_thinking=false` を継続する。画像を読む用途はQwenを必要とする。
5. 同じ業務質問・データ・会話条件でQwenと比較し、正答と質問送信から最終回答完了まで10秒以内を評価する。
   最初の文字やtok/sだけで合格にしない。初回/温まった状態、繰り返しの分布、冷起動を区別する。
6. 試験後は旧Qwen profileへ同じorchestration経路で戻し、profile一致と実際の回答まで確認する。
   常駐維持設定も保存した値に戻す。Nemotronは再びdisabledとし、推薦変更は合格後に判断する。

初期予算は同時1要求・64K文脈・GPU割当0.65・batch 2048。
64Kは現行Hermesの最小文脈条件を満たす値で、Qwen3.8の262Kと同容量ではない。
既存業務入力が64Kに収まることを確認し、切捨てや検索不成立を速度改善と数えない。
公式例の最大1M文脈やGPU割当0.85を無条件に転記せず、実機の空きメモリと予約を確認してから調整する。
失敗時は旧Qwenへ戻す。起動処理の回帰なら保存したruntimeファイルを復元してcontrolを再読込する。

ローカル検証は `tests/test_nemotron35_dspark.py`、既存profile launcher / vLLM builder / Qwen adapterのテストを対象とする。
Macでの偽Dockerによる確認は起動契約の検証であり、GB10上の実際の推論・メモリ・応答性能の証拠にはしない。
