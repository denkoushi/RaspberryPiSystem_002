---
title: KB-365 DGXリソース Phase3・補助ランタイム起停・ワークロード自動調停
tags: [DGX, DGX_RESOURCE, Pi5, ComfyUI, experiment-lab, 運用]
audience: [開発者, 運用者]
last-verified: 2026-05-03
category: knowledge-base
---

# KB-365: DGXリソース Phase3・補助ランタイム起停・ワークロード自動調停

## Context

`/admin/tools/dgx-resource` の **Control Target を拡張**し、`system-prod-gateway` 以外にも **Pi5 から POST できる補助起停**（私用 ComfyUI・論理ターゲット `experiment-lab`）を追加した。あわせて **`SET_POLICY` に `applyWorkloadChanges`** を用意し、GUI のチェック有効時に **業務優先 / 実験優先へ切り替える前に**自動で停止試行する（GPU 競合緩和。KB-364 系）。

## Preconditions

- Pi5 **`apps/api`** が Tailscale（または許可経路）で **DGX 側の軽い HTTP hook（POST）**に到達できること（URL は運用が DGX で用意）。
- Hook は gateway と同様、トークン使用時 **`X-Runtime-Control-Token`** を検証することを推奨。
- `applyWorkloadChanges` は **順次 POST**であり、途中失敗時は **モード変更前にエラー**。一部 POST 済みの可能性は運用側で許容または hook をべき等に。

## ENV（Pi5）

- `DGX_RESOURCE_PRIVATE_COMFYUI_RUNTIME_START_URL` / `_STOP_URL`（/ 任意 `_CONTROL_TOKEN`）
- `DGX_RESOURCE_EXPERIMENT_LAB_RUNTIME_START_URL` / `_STOP_URL`（/ 任意 `_CONTROL_TOKEN`）
- （任意）`DGX_RESOURCE_EXPERIMENT_LAB_HEALTH_URL` — GET で状態表示用
- `DGX_RESOURCE_AUX_RUNTIME_REQUEST_TIMEOUT_MS` — 補助 POST タイムアウト（既定 90000）

Ansible は `templates/api.env.j2` / `templates/docker.env.j2` で上記変数を空既定で出力（inventory で上書き）。

## API/UI

- **`EXECUTE_TARGET_ACTION`**: `overview.targets[].capabilities` に `start`/`stop` があるもののみ許可。
- **`SET_POLICY`**: `applyWorkloadChanges: true` のときのみ `dgx-resource.policy-arbitrator` の計画に従って停止試行。**直前モードへ戻す** は `applyWorkloadChanges: false` で呼ぶ（ワークロードは触らない）。

## 本番反映（記録）

- **ホスト**: `raspberrypi5` のみ（`--limit raspberrypi5`。Pi4／Pi3 play **no hosts matched**）
- **ブランチ**: `feat/dgx-resource-policy-orchestration-phase3`（代表コミット **`a44b9f78`**）
- **Detach Run ID**: **`20260503-094340-23537`**（`PLAY RECAP`: **`ok=135` `changed=8` `failed=0` / `unreachable=0`**・exit **`0`**・約 **597s**）
- **自動実機検証**: `./scripts/deploy/verify-phase12-real.sh` → **PASS 43 / WARN 0 / FAIL 0**

## 運用・トラブルシュート

- **補助ボタンが出ない**: Pi5 に **`DGX_RESOURCE_*_RUNTIME_START_URL` と `_STOP_URL` が両方**なければ `capabilities` は **`readStatus` のみ**（読取のみのままでも運用継続可）。
- **`SET_POLICY` + `applyWorkloadChanges` でエラー**: ワークロード POST が途中で失敗すると **`policy.mode` は更新されない**ことがある。その場合はイベントログ・DGX hook 側ログで **べき等性／原因**を確認する（競合関連は [KB-364](./KB-364-dgx-blue-vllm-comfyui-gpu-contention.md)）。
- **UI が古い**: Pi5 で **`web` 再構築**済みでもブラウザキャッシュがある → [verification-checklist.md](../guides/verification-checklist.md) §6.6.4 **強制リロード**。

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

## References

- [dgx-system-prod-local-llm.md](../runbooks/dgx-system-prod-local-llm.md)（管理コンソール節・Phase3 説明）
- [KB-364](./KB-364-dgx-blue-vllm-comfyui-gpu-contention.md)
- [ADR-20260502-dgx-resource-control-targets.md](../decisions/ADR-20260502-dgx-resource-control-targets.md)
- [ADR-20260503-dgx-resource-operator-console.md](../decisions/ADR-20260503-dgx-resource-operator-console.md)
