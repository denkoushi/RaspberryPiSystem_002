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

## References

- [dgx-system-prod-local-llm.md](../runbooks/dgx-system-prod-local-llm.md)（管理コンソール節・Phase3 説明）
- [KB-364](./KB-364-dgx-blue-vllm-comfyui-gpu-contention.md)
- [ADR-20260502-dgx-resource-control-targets.md](../decisions/ADR-20260502-dgx-resource-control-targets.md)
