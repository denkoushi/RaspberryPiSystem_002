---
Title: ADR-20261017: 管理画面「DGXリソース」を業務 LLM 専用にする
Status: accepted
---

# ADR-20261017: 管理画面「DGXリソース」を業務 LLM 専用にする

## Context

- 管理画面 `/admin/tools/dgx-resource` は、業務 LLM の状態表示に加えて、実験ラボ（`experiment-lab`）・Agent（`agent-container`）の起動停止、運用モード（`business_first` / `private_ok` / `experiment_first`）、「業務→実験」「実験→業務」「私用→業務」の切替シナリオを持っていた。
- DGX Spark Control Plane（`denkoushi/DGXSparkControlPlane`）は `experiment-lab` / `agent-container` / `private-comfyui` を個人用ワークロード（`LEGACY_PRIVATE_WORKLOADS`）と定義し、業務 principal からの `/experiment-lab/*` `/agent-container/*` は個人用の Lease として扱う。業務画面がこれを動かすのは、業務と個人用を分ける境界に反する。
- 排他調停・Job（切替手順の組み立て、ワークロード自動調整、Warm 時間帯）は Control Plane の責務であり、業務側に重複実装があった。
- 業務推論の表示が gateway・`/v1/models`・embedding の最悪値で決まり、embedding の監視 URL が未設定だと業務 LLM が動いていても Unknown になっていた。業務で実際に使う埋め込みは写真持出の画像埋め込みで、DGX 側に業務用の健康確認窓口は無い。
- 画面に内部 ID や英語の生値が多く出ており、使われていない部品も残っていた。

## Decision

1. 画面の役割を「業務 LLM が今使えるか、どのモデルで動いているかがわかり、使えないときは業務モデルを選んで戻せる」に絞る。
2. 業務側に残す操作は次の 4 つだけにする（`POST /api/system/dgx-resource/actions`）。
   - `RETURN_TO_BUSINESS { modelProfileId }`: DGX `/start` に `modelProfileId` を渡し、すぐ受付を返す。準備完了（`/v1/models` と `activeProfileId` の一致、未準備なら `/start` を 1 回だけ再試行）を裏で待ち、成功したら業務意図を記録する。進行状態は API プロセス内に持ち、画面は overview の `businessReturn` で表示する。二重実行は 409。
   - `STOP_BUSINESS_LLM`: gateway の `stop_force`。
   - `PREVIEW_MODEL_STORAGE_DELETE` / `EXECUTE_MODEL_STORAGE_DELETE`: 既存契約のまま。
3. 次を業務側から外す: 運用モードと `SET_POLICY`、`EXECUTE_TARGET_ACTION`、`LOCAL_LLM_START/STOP`、`START_MODEL_PROFILE`、切替シナリオの preview/execute と指紋、安全ロールバック、実験ラボ・Agent・私用 ComfyUI の監視と起停、Control Target 一覧、Warm 時間帯表示、`DGX_RESOURCE_EMBEDDING_HEALTH_URL` の監視。DGX 側（38081）の窓口は変えない。業務側から呼ぶのをやめるだけ。
4. `GET /api/system/dgx-resource/overview` は業務専用の形にする: `business`（`state`: `ready` / `ready_mismatch` / `degraded` / `down` / `unconfigured` / `returning`、`llm`、`embedding`、動いているモデルと業務で使うモデル、一致）、`metrics`、`modelProfiles`（起動可否・メモリに入るか・削除可否）、`businessReturn`、`alerts`。
5. 埋め込みは実際の呼び出し結果で判定する。写真持出の HTTP 埋め込みアダプタが成功・失敗をプロセス内に記録し（`photo-tool-embedding-health.ts`）、直近が失敗なら `degraded`。まだ呼ばれていない・無効のときは判定に入れない。
6. 別名ルート `/admin/dgx-resource` は `/admin/tools/dgx-resource` へ転送する。

## Alternatives

- 表示の修正（Unknown・用語・不要部品）だけを行い、実験ラボ・Agent・運用モードを残す: 業務と個人用の境界違反が残るため採らない。
- DGX の `/system/text-embedding/health` を埋め込みの監視先にする: 業務では使っていない文章埋め込みの窓口で、写真持出の状態を表さないため採らない。

## Consequences

- 業務画面から個人用ワークロードを動かせなくなる。個人用の起停は DGX 側（Control Plane）で行う。
- 業務復帰の進行状態・操作履歴・埋め込みの直近結果は API プロセス内だけに持つ。API 再起動で消える（業務意図は従来どおりファイルに残る）。
- `DGX_RESOURCE_AGENT_CONTAINER_*` などの env は推論ランタイム側（`get-local-llm-runtime-controller.ts`・`local-llm-on-demand-runtime.ts`）でまだ読まれているため残す。Ansible の env 定義も今回は触らない。整理は別作業。

## Validation

- API: business 判定の各状態、埋め込み記録、`RETURN_TO_BUSINESS` の成功・失敗・二重実行・起動不可、`STOP_BUSINESS_LLM`、actions の型検証（4 種以外は 400）のテスト。
- Web: 状態表示の各ケース、確認ブロック、削除時のモデル名入力、内部語が出ないことのテスト。
- 本番: `/admin/tools/dgx-resource` で業務 LLM の状態と動いているモデルが表示され、実験ラボ・Agent・運用モードが出ないこと。

## Supersedes

- [ADR-20260502: Control Target レジストリ](ADR-20260502-dgx-resource-control-targets.md)
- [ADR-20260503: 運用者コンソールとワークロード遷移](ADR-20260503-dgx-resource-operator-console.md)

## References

- [DGX system-prod ローカル LLM Runbook](../runbooks/dgx-system-prod-local-llm.md)
- [KB-365 DGX リソース Phase3 ワークロード調停](../knowledge-base/KB-365-dgx-resource-phase3-workload-orchestration.md)
- [DGXSparkControlPlane の責任分界](https://github.com/denkoushi/DGXSparkControlPlane/blob/main/docs/repository-boundary.md)
