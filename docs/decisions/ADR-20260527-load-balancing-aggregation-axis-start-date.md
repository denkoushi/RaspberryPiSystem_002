# ADR-20260527: キオスク負荷調整の集計軸は着手日とする（FSIGENSHOYOYMD に合わせない）

## Status

accepted

## Context

- 生産システムの資源負荷グラフは、生産日程 CSV ではなく **資源所要量テーブル** の **`FSIGENSHOYOYMD`** を横軸に **`FSIGENSHOYORYO`（分）** を積み上げている（2026-05-27 突合で確認）。
- キオスク負荷調整は **生産日程 winner 行**（`CsvDashboardRow`）と **着手日・納期** に基づく **日割り平準化** を目的とする。
- 現場では生産の「負荷残」「負荷消費」（例: N7・033・7月 **706H / 113H**）とキオスク月次が一致せず、どちらを正とするかの判断が必要だった。

## Decision

1. **キオスク負荷調整の正本集計軸は `plannedStartDate`（と有効納期による日割り）とする。**
2. **`FSIGENSHOYOYMD` および資源所要量 CSV（`scawSTSIGENSHOYORYO` 等）をキオスクの主データ源にしない。**
3. 生産システムの月次 H とは **別 KPI** として扱い、一致を製品要件にしない。
4. 必要なら将来、**参考表示**（read-only・出所明示）として生産所要量系を並置する余地は残すが、山崩し・平準化の判断は着手日系を優先する。

## Alternatives

| 案 | 概要 | 却下理由 |
|----|------|----------|
| A. `FSIGENSHOYOYMD` に全面合わせ | 生産グラフと数値一致 | 日付の業務意味が不明確。日別行と工程行の **粒度不一致**。平準化 UI（着手移動）と軸が乖離。 |
| B. 所要量 CSV を取込し二軸併記 | 両方表示 | 取込・同期コスト。現場がどちらで動くか曖昧になり **山崩し判断が分裂** しうる。 |
| C. 納期月（俯瞰）のみに統一 | タブ統合 | 着手日平準化タブの目的（いつ負荷が載るか）を損なう。 |

## Consequences

### 良い

- **着手日・平準化シミュ** と集計軸が一致する。
- 「生産と合わない＝バグ」と誤解しにくくなる（ドキュメントで明示）。
- 既存の `ProductionScheduleOrderSupplement` / 稼働日ルールを活かせる。

### 悪い

- 生産画面の **706H / 113H** とキオスク数値は **そのままでは一致しない**（運用説明が必要）。
- ~~実装面では **×plannedQuantity** や **FKOJUNST 母集団** の修正は **別タスク**~~ → **2026-05-27 実装**（`feat/kiosk-load-balancing-aggregation-fix`）：着手日は総分のみ、3タブ負荷母集団を `buildLoadBalancingRowEligibilityWhereSql` に統一。

## References

- [KB-363](../knowledge-base/KB-363-load-balancing-production-system-reconciliation.md)
- [分析](../analysis/production-load-balancing-reconciliation-with-production-system-20260527.md)
- [KB-362](../knowledge-base/KB-362-kiosk-load-balancing.md)
