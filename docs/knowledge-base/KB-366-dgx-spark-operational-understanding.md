---
title: KB-366 DGX Spark 運用理解（メモリ・モデル・モード切替・KPI）
tags: [DGX, DGX_RESOURCE, Spark, vLLM, ComfyUI, 運用, メモリ, KPI]
audience: [開発者, 運用者]
last-verified: 2026-05-28
category: knowledge-base
---

# KB-366: DGX Spark 運用理解（メモリ・モデル・モード切替・KPI）

## Context

2026-05-25 に **`private_ok` 強制停止（`stop-force`）** の本番反映と、その前後の運用確認・議論で整理した **「Spark 上で何が動いているか」** の正本。DGX リソース画面の見方、メモリ KPI の意味、27B/35B の関係、Comfy との両立可否を、後から読んでも迷わないよう **FAQ 形式**で集約する。

**関連**: [KB-365](./KB-365-dgx-resource-phase3-workload-orchestration.md)·[KB-364](./KB-364-dgx-blue-vllm-comfyui-gpu-contention.md)·[Runbook dgx-system-prod-local-llm.md](../runbooks/dgx-system-prod-local-llm.md)·[deployment §2026-05-25](../guides/deployment.md#dgx-resource-private-ok-strong-stop-force-2026-05-25)·[KB-379](./KB-379-dgx-private-comfyui-nvfp4-migration-and-workflow-tuning.md)

---

## 1. 業務モードと私用モードでメモリがどう変わるか

| 運用のイメージ | メモリ KPI（概ね） | DGX 上で載っているもの |
|----------------|-------------------|------------------------|
| **業務優先 / 私用→業務**（27B 起動後） | **大きい**（例: 80〜100 GiB 台の used/total） | **`system-prod-trtllm`**（vLLM・**Qwen3.6-27B NVFP4**）が **1 本** |
| **私用OK / 業務→私用**（強制停止後） | **ほぼゼロに近い** | **業務 LLM コンテナは停止**（推論モデル未ロード） |

**理解の要点**

- 私用に切り替えると **業務用 27B を止めてメモリを空ける**のが今回の `private_ok` + `stop-force` の目的（[KB-365 §2026-05-25](./KB-365-dgx-resource-phase3-workload-orchestration.md#production-2026-05-25-dgx-private-ok-stop-force)）。
- ComfyUI を別途動かせば **Comfy 分だけ**メモリは使う。**業務 27B と Comfy のフル同時稼働は期待しない**（[KB-364](./KB-364-dgx-blue-vllm-comfyui-gpu-contention.md)）。

---

## 1b. 35B は VLM か（宣言 vs 今回 ready）

| 観点 | 意味 |
|------|------|
| `declaredCapabilities` に `vision` | manifest が **この profile は VLM 想定** と宣言 |
| `runtimeReadyCapabilities` に `vision` | **今回の起動**で vision 経路が ready（blue は `blue_native_vlm`、green はログの `mmproj=` 検出） |
| `visionReadyReason` | 判定根拠（例: `mmproj_detected` / `mmproj_missing`） |

**現場**: 写真ラベルが動かないのに KPI が 35B・メモリ低い → **プロセスは動いているが VLM ready ではない**可能性。DGX `GET /system/model-profiles` の `state.runtimeReadyCapabilities` を確認（[ADR-20260529](../decisions/ADR-20260529-dgx-profile-capabilities-runtime-intent.md)）。

**本番（2026-05-29）**: Pi5 + DGX に capabilities / intent 基盤を反映済み。**`INFERENCE_RUNTIME_START_PROFILE_ENABLED` は本番 `false` のまま**（挙動は従来どおり·ログのみ shadow）。DGX API では両 profile に **`declaredCapabilities: text+vision`** を確認。詳細: [KB-365 §本番](../knowledge-base/KB-365-dgx-resource-phase3-workload-orchestration.md#production-2026-05-29-dgx-profile-capabilities-runtime-intent)。

### 35B 写真ラベル cold start と `runtime_ready_timeout`（2026-05-29） {#35b-photo-label-cold-start-runtime-ready-timeout}

- **症状**: 管理画面で **35B** に切替後、キオスク持出の **初回** 画像認識だけ失敗。Pi5 API ログに **`runtime_ready_timeout`**（例: **latencyMs≈901707** · useCase **`photo_label`**）。**2 回目以降は成功**し得る。27B では顕在化しにくい（起動が速い）。
- **調査結果（2026-05-29 · CONFIRMED）**:
  - 35B は **VLM 非対応ではない**: `runtimeReadyCapabilities: ["text","vision"]` · **`visionReadyReason: mmproj_detected`**
  - DGX 単体 `/v1/chat/completions`（画像付き）は **HTTP 200**
  - 主因は **35B cold start が `LOCAL_LLM_RUNTIME_READY_TIMEOUT_MS`（本番 900000）を超える**こと（HTTP `/v1/models` ready 待ちの段階）
- **Fix（Pi5 · 本番 `efe1853f`）**: HTTP ready と **profile スコープ readiness**（active 一致 + `photo_label` 時 vision capability）を分離。業務復帰 Strict Ready に **`model_profile_vision_runtime`**。詳細: [KB-365 §profile-scoped readiness](./KB-365-dgx-resource-phase3-workload-orchestration.md#business-profile-scoped-runtime-readiness) · [deployment §optin-ready](../guides/deployment.md#dgx-business-profile-optin-ready-2026-05-29)
- **運用**: KPI **Unified Mem 20 GiB 台**でも 35B green は稼働し得る（メモリだけで「モデル未ロード」と判断しない）。初回失敗時は **ロード完了まで待って再撮影**。
- **次の改善候補**: `INFERENCE_RUNTIME_START_PROFILE_ENABLED=true` で業務復帰と on-demand の profile を揃えたうえで shadow 確認 · 必要なら timeout / UX（「モデル準備中」）の見直し

## 2. 写真ラベル・要領書・Hermes は「別モデル」か

**用途名は複数あるが、DGX 上の業務推論は基本的に 1 系統。**

| 用途（Pi5 API 等） | 経路 |
|--------------------|------|
| 写真ラベル（`photo_label`） | 職場 Pi5 → DGX gateway `38081` |
| 要領書要約（`document_summary`） | 同上 |
| 管理チャット（`admin_console_chat`） | 同上 |
| StackChan 職場 API（`stackchan_chat`） | 同上 |
| **Hermes（私用 Pi5）** | 私用 Pi5 → **同じ DGX gateway**（別マシンだが **同じ `system-prod-primary` エイリアス**） |

inventory 上の正本: `inference_*_provider_id: dgx_primary`・モデル名 **`system-prod-primary`**（[Runbook](../runbooks/dgx-system-prod-local-llm.md)）。

**誤解しやすい点**: 「用途ごとに 27B が何本もロード」ではない。**1 つの vLLM プロセス（+ KV キャッシュ枠）を共有**する。

**業務復帰で選んだモデルと各機能（2026-05-29 · 本番反映済）**: GUI で選んだ `modelProfileId` は DGX `/start` で正本化される。職場 Pi5 は **`BusinessProfileIntentStore`** に同じ ID を保持し、opt-in 時は photo_label / 要約 / 管理チャット / StackChan の on-demand `/start` に **同一 profile** を載せる。KPI 下段の **Pi5 業務意図** と **Active Model** の一致を確認。**本番**: Pi5 Detach **`20260529-141701-10018`** · Git **`1edebd70`** · 既定 **`INFERENCE_RUNTIME_START_PROFILE_ENABLED=false`**（shadow）。正本: [KB-365 §本番](./KB-365-dgx-resource-phase3-workload-orchestration.md#production-2026-05-29-dgx-business-profile-intent-propagation) · [deployment §2026-05-29](../guides/deployment.md#dgx-business-profile-intent-propagation-2026-05-29)。

---

## 3. 27B（blue）と 35B（green）は同時に載るか

**通常運用では同時フルロードしない。** 設計は **green / blue のどちらか一方**。

| 系統 | 実体 | 代表モデル | ポート（ローカル） |
|------|------|------------|-------------------|
| **green** | `llama-server` | **Qwen3.5-35B**（GGUF） | `38082` |
| **blue** | `system-prod-trtllm`（Docker vLLM） | **Qwen3.6-27B**（NVFP4） | `38083` |

- **`ACTIVE_LLM_BACKEND`** が `blue` か `green` かで **アクティブ側が 1 つ**（本番記録・実機確認は **blue**）。
- **`DGX_LLM_SINGLE_ACTIVE_GUARD`**: `/start` 前に **非アクティブ側を必ず stop**（[Runbook §単一アクティブ](../runbooks/dgx-system-prod-local-llm.md#単一アクティブ運用ガードdgx_llm_single_active_guard)）。
- **業務復帰のモデル選択**: 管理 UI の **私用→業務** / **実験→業務** では `modelProfileId` を選ぶ。選択時は DGX manifest の `backend` が優先され、`ACTIVE_LLM_BACKEND` は未指定 start 用の fallback になる。初期 ID は **`business_qwen36_27b_nvfp4`**（blue / 推奨）と **`business_qwen35_35b_gguf`**（green）。

**念のための確認（DGX）**

```bash
grep '^ACTIVE_LLM_BACKEND=' /srv/dgx/system-prod/secrets/control-server.env
ss -ltnp | awk '/:38082|:38083/'
docker ps --format '{{.Names}}' | grep -E 'system-prod|trtllm|llama'
```

**正常（blue 業務時）**: `ACTIVE_LLM_BACKEND=blue`・**`system-prod-trtllm` 1 つ**・**`38082` 非 listen**・**`llama-server` プロセスなし**。

**異常**: `38082` と `38083` が同時 listen、または llama と vLLM が同時稼働。

---

## 4. KPI のメモリと vLLM の `gpu-memory-utilization 0.85` の違い

**別物。混同しない。**

### vLLM の `--gpu-memory-utilization 0.85`

- **意味**: vLLM が「GPU（DGX Spark では統一メモリ）の **最大何割まで使ってよいか**」の **上限（キャップ）**。
- **vLLM 公式の既定は `0.9`**。本リポジトリの Runbook 例は **`0.85`（やや控えめの運用値）**（[Runbook BLUE_SERVER_COMMAND 例](../runbooks/dgx-system-prod-local-llm.md)）。
- **「今ちょうど 85% 使っている」というリアルタイム表示ではない**。起動時に **KV キャッシュ等の枠を確保**し、**起動中はその枠に近い占有が続きやすい**。
- **下げられるか**: はい（例: `0.65`〜`0.75`）。ただし **同時リクエスト・長文で KV 不足**や **起動失敗**のリスク。Comfy 両立の本命は利用率を下げることではなく **モード切替**（[KB-364](./KB-364-dgx-blue-vllm-comfyui-gpu-contention.md)）。

### 管理画面 KPI（`Unified Mem` / `Free Mem`）

- **意味**: DGX `gateway-server.py` が **`nvidia-smi` の memory.used / memory.total**（または compute-apps フォールバック）を読んだ **スナップショット**（`GET /system/metrics` → Pi5 `overview.kpis`）。
- **表示例**: `96 / 128 GiB` と **バー（used÷total の％）**。
- **リアルタイムに近い実測**だが、ダッシュボードの **ポーリング間隔ごとの点**（厳密な毎秒ストリームではない）。
- **バーが 85% 付近** = 「設定が 0.85」ではなく **実測の使用率が 85% 前後**。

### 管理画面 KPI 帯（2026-05-29 再設計 · `overview.runtimeSummary`） {#管理画面-kpi-帯2026-05-29-再設計--overviewruntimesummary}

- **上段（純メトリクス）**: `GPU Util` / `Unified Mem` / `Free Mem` のみ（`overview.kpis`）。**8 秒ポーリング**のスナップショット。
- **下段（実行時状態）**: `overview.runtimeSummary` — **`Active Model`**（`activeProfileId` / 表示名）· **`Backend`**（green/blue）· **`Business Ready`**（`/v1/models` 到達のヒント）· **`Policy`**（Pi5 `policyMode`）。
- **切替判断**: **Policy ラベルだけ**で「業務 LLM が載った/外れた」とは限らない。**Active Model + Backend + Unified Mem** をセットで見る（35B green は **20 GiB 台**のまま業務稼働し得る · 27B blue は **80〜100 GiB 台**になりやすい）。
- **私用切替の停止**: `stop-force` は **`active-model-profile.json` の `backend` を正本**に停止対象を決める（env `ACTIVE_LLM_BACKEND` とのずれで **llama が残る**事故を防ぐ）。state 無し時のみ env フォールバック。
- **本番反映（2026-05-29）**: Pi5 **`af4997fc`** + DGX `control-server.py`（[KB-365 §2026-05-29](./KB-365-dgx-resource-phase3-workload-orchestration.md#production-2026-05-29-dgx-runtime-state-alignment)）。実機で **`backendSource: model_profile_state`** の `stop-force` を確認済み。**検証スモークで blue 停止した場合**は画面上部の業務復帰または保守 start で再ロードする。

### なぜ業務時に 100 GiB 台に見えるか

- Spark の **総メモリが大きい**（例: 128 GiB 級）× vLLM が **枠を大きく取る** → KPI の **used が 80〜100 GiB** になりやすい。
- **27B が 2 本載っているからではない**（単一アクティブガード前提）。

---

## 5. ComfyUI と業務 27B の同時稼働

**フル同時は無理に近い（設計上も運用上も切り替え前提）。**

- 27B（vLLM）だけでも **数十 GB 級**の占有（実測・KB 上 **~57GB** の言及あり: [KB-364](./KB-364-dgx-blue-vllm-comfyui-gpu-contention.md)·[KB-379](./KB-379-dgx-private-comfyui-nvfp4-migration-and-workflow-tuning.md)）。
- Comfy（FLUX 等）も **数十 GB 級**になり得る。
- **`gpu-memory-utilization` を少し下げても**、**両方フルは基本無理**。**業務モード ⇔ 私用モード**でどちらかを止める運用が正本。

---

## 6. 管理画面: 「ワークロード自動調整」チェックと切替手順

### チェック項目の正しい名前と場所

- 文言: **「切替時にワークロード自動調整」**（`DgxResourceProfilePanel`）。
- 場所: `/admin/tools/dgx-resource` を下へスクロール → 折りたたみ **「詳細・保守（通常は不要）」** → **「運用モード（保守・手動切替）」** 内。
- **画面上部の運用ガイド（4 つの大きい操作）にはこのチェックは無い。**

### いつチェックが要るか

| 操作 | チェック |
|------|----------|
| **運用ガイドの「業務→私用」等**（`EXECUTE_ORCHESTRATION_SCENARIO`） | **不要**（API 側で `applyWorkloadChanges: true` 相当） |
| **保守パネルの「私用OK」ボタンのみ** | **要る**（チェック OFF だと **モード表示だけ変わり、停止 POST が走らない**） |

**API の事実**: `planWorkloadAdjustmentsBeforePolicyChange` は **`applyWorkloadChanges: false` なら空配列**（停止なし）。`private_ok` の確認ダイアログは **チェック無しでも出る**が、**実停止はチェック ON 時のみ**（`dgx-resource.policy-arbitrator.ts` + `SET_POLICY` body）。

**現場確認の推奨**: **運用ガイドの「業務→私用」**で実行（チェック不要）。保守の「私用OK」だけ使う場合は **チェック ON**。

---

## 7. 手動確認の最短手順（現場）

1. `/admin/tools/dgx-resource` を開く。
2. **運用ガイド**から **業務→私用**（または同等シナリオ）を選び、確認→実行。
3. KPI で **Unified Mem が大きく下がる**こと、必要なら DGX で `docker ps` に **`system-prod-trtllm` が無い**ことを確認。
4. Comfy を使う場合は **別途** Mac SSH トンネル等（[KB-378](./KB-378-dgx-private-comfyui-mac-ssh-access.md)）。**`private_ok` は Mac の `127.0.0.1:8188` 経路を変えない。**

---

## 8. `gpu-memory-utilization` を下げる場合（参考）

- **変更場所**: `/srv/dgx/system-prod/secrets/control-server.env` の **`BLUE_SERVER_COMMAND`** 内 `--gpu-memory-utilization`。Hermes `/task` 復旧時（**2026-06-05**）は **`0.65`** で 27B NVFP4 の起動を確認（従来例示の **`0.85`** は当該実機では **起動失敗**）。
- **反映**: `control-server.pid` ガード手順で **control-server 再起動** → 業務 LLM の **stop/start**（Runbook 標準）。
- **トレードオフ**: Comfy 用の空きは **少し**増え得るが、**業務推論の同時処理・安定性**が落ちる可能性。変更前後で **写真ラベル / 要領書** の体感を確認する。

### 8.1 blue 27B 起動失敗と Hermes `/task` 502（2026-06-05）

**症状**: Pi5 tools から DGX **`/v1/models` が 502** · `system-prod-trtllm` 未起動または即 exit。

**根本原因（実機）**:

| 要因 | 対策 |
|------|------|
| `vllm serve sakamakismile/Qwen3.6-27B-NVFP4`（repo id）が HF metadata で失敗 | **ローカル snapshot path** を `BLUE_SERVER_COMMAND` に指定（`hf-cache/hub/models--sakamakismile--Qwen3.6-27B-NVFP4/snapshots/<sha>`）。`<sha>` は **`${BLUE_MODEL_DIR}/refs/main`** |
| `--gpu-memory-utilization 0.85` で空きメモリ不足 | **`0.65`** に下げて起動確認 |
| vision 系ロードが Hermes テキスト `/task` に不要 | **`--hf-overrides "{\"language_model_only\": true}"`** |

**repo 例示（secret ではない）**: [`control-server.env.example`](../../scripts/dgx-local-llm-system/systemd/control-server.env.example) · [Runbook §Phase2 blue 最小例](../runbooks/dgx-system-prod-local-llm.md) · [KB `/task` profile restore §blue 502](./KB-private-pi5-hermes-task-dgx-profile-restore.md#追記--blue-backend-起動失敗で-v1models-5022026-06-05)。

**起動待ち**: 初回は重みロード・compile・autotuneで **数分**。起動中 `/v1/models` が **`Connection reset by peer`** でも **コンテナ生存なら待つ**。

**秘密情報**: 実機 `control-server.env` の全文は **Git 禁止**。snapshot SHA 等は KB に **例として**残してよいが、トークンは載せない。

---

## 本番反映（2026-05-28 · 業務復帰モデル選択） {#production-2026-05-28-dgx-business-return-model-selection}

- **何が変わったか**: 管理 UI の **私用→業務** / **実験→業務** で **`business_qwen36_27b_nvfp4`（blue·推奨）** と **`business_qwen35_35b_gguf`（green）** を選べる。選択は DGX manifest の **`backend`** を `/start` に渡し、**green/blue の「どちらか一方」設計は維持**（§3）。
- **デプロイ**: Pi5 Detach **`20260528-184011-18178`** → DGX **`scp` + PID 再起動**（[KB-365 §本番](./KB-365-dgx-resource-phase3-workload-orchestration.md#production-2026-05-28-dgx-business-return-model-selection)）。
- **実機**: `GET /system/model-profiles` → **2 profiles**（未 start 前 **`activeProfileId: null`** は正常）。Phase12 **43/0/0**。
- **運用上の注意**: **KPI の Unified Mem** は選択した profile の backend 起動後に変化する。**profile ID と `ACTIVE_LLM_BACKEND` env** が食い違う場合は **active state ファイル**（`/srv/dgx/system-prod/state/active-model-profile.json`）と **`GET /system/model-profile`** で確認。
- **モデルが 1 件しか選べないとき**: DGX API は 2 profile 返却でも、27B が **`status: unavailable`**（manifest の `currentStorageLocation` が実ディスクとずれている）だと UI は 35B のみ表示。**HF 27B の実体は `hf-cache/hub/models--sakamakismile--Qwen3.6-27B-NVFP4`** を確認し、registry manifest を合わせる（[KB-365 §storage availability](./KB-365-dgx-resource-phase3-workload-orchestration.md#dgx-model-profile-storage-availability)）。**2026-05-28 本番修正済** → [§storage path 本番](#production-2026-05-28-dgx-model-profile-storage-path)。
- **業務復帰 503（activeProfileId null）**: ドロップダウンに 2 件出るのに **`DGX_MODEL_PROFILES_UNAVAILABLE`** → DGX は **`activeProfileId: null` が正常**（未 start 前·state 未書き込み）。**現在ロード中かは `/v1/models` で別確認**。Pi5 は allowlist 取得 OK なら **`overview.modelProfiles.status: ok`**（[KB-365 §activeProfileId null](./KB-365-dgx-resource-phase3-workload-orchestration.md#dgx-model-profile-active-profile-id-null)）。**stop 後も state ファイルは残り得る**（null にならない場合あり）。

## 業務復帰 success だが KPI が選択モデルと合わない（2026-05-28） {#dgx-strict-ready-model-profile-mismatch-2026-05-28}

- **症状**: 27B 選択後も **Unified Mem が 20GB 台**・実際は **35B green**。Pi5 execute は **success** になり UI が再操作可能。
- **原因**: Strict Ready が **`/v1/models` のみ**で、**`activeProfileId` 不一致**を見ていなかった（旧契約）。
- **Fix**: Pi5 API で業務復帰 **`modelProfileId` 指定時は profile 一致を Ready 必須**（[KB-365 §Strict Ready profile 一致](./KB-365-dgx-resource-phase3-workload-orchestration.md#dgx-strict-ready-model-profile-match) · [Runbook](../runbooks/dgx-system-prod-local-llm.md#strict-ready-model-profile-match-2026-05-28)）。
- **切り分け**: `GET /system/model-profiles` の **`activeProfileId` / `state.backend`** と選択 ID を突合。**`/v1/models` だけでは不十分**。
- **本番反映（2026-05-28）**: Pi5 **`fix/dgx-strict-ready-profile-match`** · **`90ba94d9`** · Detach **`20260528-221349-13434`** · Phase12 **43/0/0** — [KB-365 §本番](../knowledge-base/KB-365-dgx-resource-phase3-workload-orchestration.md#production-2026-05-28-dgx-strict-ready-profile-match) · [Runbook §本番](../runbooks/dgx-system-prod-local-llm.md#本番反映2026-05-28-strict-ready-profile-match)。

## 本番反映（2026-05-28 · 27B manifest `currentStorageLocation`） {#production-2026-05-28-dgx-model-profile-storage-path}

- **症状（修正前）**: 業務復帰 UI のモデル選択が **35B のみ**（API は profiles **2 件**·27B は **`unavailable`**）。
- **Fix**: DGX registry の **`business_qwen36_27b_nvfp4/manifest.json`** を **`hf-cache/hub/models--…`** に更新（**`scp` のみ**·**再起動不要**）。
- **検証**: `GET /system/model-profiles` → **両 profile `available`**。管理 UI で **2 件選択可能**。
- **正本**: [KB-365 §本番 storage path](./KB-365-dgx-resource-phase3-workload-orchestration.md#production-2026-05-28-dgx-model-profile-storage-path)·[Runbook](../runbooks/dgx-system-prod-local-llm.md#本番反映2026-05-28-27b-model-profile-storage-path)·[deployment.md](../guides/deployment.md#dgx-model-profile-storage-path-2026-05-28)。

## Prevention（再発防止・ドキュメント）

- KPI と vLLM 利用率を **別節**で Runbook に残す（本 KB + Runbook 追補）。
- 現場手順は **「運用ガイド優先・保守パネルはチェック注意」** を deployment / KB-365 に明記済み。
- 27B/35B 同時載せの切り分けは **4 点チェック**（Runbook）をデプロイ後に一度実行して記録しておく。

## References

- [KB-365 §private_ok stop-force 本番](./KB-365-dgx-resource-phase3-workload-orchestration.md#production-2026-05-25-dgx-private-ok-stop-force)
- [KB-364 GPU 競合](./KB-364-dgx-blue-vllm-comfyui-gpu-contention.md)
- [ADR-20260428 active backend](../decisions/ADR-20260428-dgx-active-backend-prod-default.md)
- [vLLM Engine Args — gpu-memory-utilization](https://docs.vllm.ai/en/latest/configuration/engine_args/)（既定 **0.9**）
