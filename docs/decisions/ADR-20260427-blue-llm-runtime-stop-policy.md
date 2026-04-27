# ADR-20260427: DGX blue ランタイムの `/stop` 方針をモードで表現する

Status: accepted

## Context

- DGX `control-server.py` は Pi5 由来の on-demand 制御で `POST /start` / `POST /stop` を受ける。
- blue（vLLM 等）では **cold start まで 10 分超**になり得るため、反復検証では **`/stop` を実 stop にせず温存**したい要求があった。
- 当初は真偽環境変数 `BLUE_LLM_RUNTIME_KEEP_WARM` だけで表現し、**条件分岐が control-server 本体に直書き**されていた。

## Decision

- **停止ポリシー**を `runtime_stop_policy.py` に分離し、blue 向けに次の**モード**で表現する:
  - `on_demand`: `BLUE_LLM_RUNTIME_STOP_CMD` を実行（従来どおり）
  - `keep_warm`: `/stop` はシェル no-op（`:`）— 反復テスト用の温存
  - `always_on`: 現状は `keep_warm` と同じ no-op 挙動（**運用ラベル**として「常に停止させない方針」を表す）
- 設定は **`BLUE_LLM_RUNTIME_STOP_MODE` を優先**し、未使用または `default` のときは **`BLUE_LLM_RUNTIME_KEEP_WARM`（非推奨・互換）** にフォールバックする。
- 未知トークンは stderr に警告し、上記レガシー真偽で解決する。

## Alternatives

- **K8s 型の min-replica + HPA**: 多ノード想定。本系は **単一 DGX** のため、制御面は `control-server` モードで足りる。
- **常に実 stop**: リソース回収は良いが、blue の cold start 再現で検証が非現実的。
- **always_on をプロセス分離の別常駐**: 将来拡張。現状は `/stop` no-op の意味合いに留める。

## Consequences

- 良い: 方針変更が**モジュール境界 1 箇所**に集約され、テスト可能。
- 良い: 一般の大規模推論運用（**warm 維持 / オンデマンド**のトレードオフ）の説明と用語を揃えやすい。
- 注意: 本番で `keep_warm` / `always_on` を使うと **GPU/メモリを占有**し続ける。Runbook のリソース・セキュリティ注意と併せて使う。

## References

- `scripts/dgx-local-llm-system/runtime_stop_policy.py`
- `docs/runbooks/dgx-system-prod-local-llm.md`（Blue 停止ポリシー・一般運用との対照）
- vLLM / K8s 系: cold start 対策として **永続化キャッシュ・最小レプリカ・HPA** がよく用いられる（本リポ外の一般ベースラインとして Runbook に要約）
