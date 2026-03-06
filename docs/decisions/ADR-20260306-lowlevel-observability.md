# ADR-20260306: 低レイヤー観測強化（SOLID・非破壊）

Status: accepted

## Context

- KB-268（生産スケジュールキオスク操作で間欠的に数秒待つ）で、イベントループ詰まりや signage worker の影響が疑われている
- KB-274（signage-render-worker の高メモリ化）で worker のリエントランシーガードを実装済みだが、観測データに基づく改善施策の決定が未整備
- 低レイヤー（eventLoop、メモリ、worker 状態）の観測を強化し、体感遅延の原因切り分けと将来の改善施策決定に役立てたい

## Decision

**観測強化のみ**（メトリクス拡充・Runbook整備・しきい値定義）の範囲で実施し、ロジック変更・worker分離等の改善は次フェーズに先送りする。

**ロールアウト**: カナリア（Pi5または1台のみ）→検証→段階展開を採用。

### 実施内容

1. **API health/metrics 拡張**
   - eventLoop: p50/p90/p99, ELU（Event Loop Utilization）, activeMs/idleMs
   - signage-render-scheduler: worker_pid, skip_total, last_duration, running
   - しきい値: warn（p99 >= 120ms または ELU >= 0.80）, degraded（p99 >= 250ms または ELU >= 0.95）

2. **運用整備**
   - operation-manual.md に「低レイヤー観測（Pi5カナリア）」セクションを追加
   - 判定基準・切り戻し条件・次フェーズ移行ゲート（7日連続合格）を定義

3. **デプロイ対象**
   - API は Pi5 のみで稼働するため、観測強化のデプロイはPi5（`--limit server`）のみで十分。Pi4/Pi3 は API を消費する側のため影響なし。

## Alternatives

- **全台一括デプロイ**: 観測は読み取り専用のため、全台一括でも問題ないが、カナリアで検証してから段階展開する方が安全
- **改善施策まで実施**: 観測データ不足の段階で改善を入れると、効果の有無が不明確になる。観測→分析→改善の順で進める

## Consequences

**良い点**:
- 既存稼働を壊さず、観測データに基づいて改善施策を決定できる
- 観測ロジックを `event-loop-observability.ts` に集約し、SOLID・非破壊を維持

**悪い点**:
- 7日連続合格まで次フェーズに進めない（意図的なゲート）

## References

- [operation-manual.md](../guides/operation-manual.md)（低レイヤー観測）
- [KB-268](../knowledge-base/frontend.md#kb-268-生産スケジュールキオスク操作で間欠的に数秒待つ継続観察)
- [KB-274](../knowledge-base/infrastructure/signage.md#kb-274-signage-render-workerの高メモリ化断続と安定化対応)
- [EXEC_PLAN.md](../../EXEC_PLAN.md)（Decision Log）
