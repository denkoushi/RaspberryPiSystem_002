# ADR-20260508: FKOJUNST_Status（メール同期）を工順ST表示・外部完了の唯一の正本とする

- **Status**: accepted
- **Context**:
  - 旧仕様では一覧の工順ST列が **`fkmail` 優先・`fkst`（Gmail FKOJUNST）フォールバック**であり、外部完了のメール由来が **dedupe キー消失差分**に依存していた。
  - **運用上の単一の意味の正本**を **`FKOJUNST_Status` CSV → `ProductionScheduleFkojunstMailStatus`** に揃えたい。
- **Decision**:
  - **一覧の FKOJUNST 表示・可視性**: `fkmail` のみ。`S`/`R` のみ表示、`C`/`X`/`O`/`P` 等は非表示（`fkmail` 無しは表示し列は空）。
  - **外部完了（メール由来）**: **`statusCode` が `C` または `X` のみ**。`O`/`P` は未完了。
  - **キー消失ベースのメール同期外部完了**と **`fkst` フォールバック**を撤去（生産日程本体 CSV のスナップショット「消滅」同期は別途維持）。
- **Alternatives**:
  - **A**: `fkst` フォールバックを残す — 正本が二重になり運用混乱のリスク。
  - **B**: キー消失で完了を継続 — status と矛盾し得る。
- **Consequences**:
  - **良**: 表示・完了・非表示の説明が **`fkmail.statusCode` だけ**で完結する。
  - **悪**: `fkmail` 未着の winner は工順ST列が空のまま（旧 `fkst` の `R` 等は一覧に影響しない）。
- **References**:
  - [KB-297 §FKOJUNST_Status](../knowledge-base/KB-297-kiosk-due-management-workflow.md#fkojunst_status-mail-from-gmail-csv-2026-04-28)
  - [`fkojunst-mail-status-completion.policy.ts`](../../apps/api/src/services/production-schedule/completion/fkojunst-mail-status-completion.policy.ts)
  - [`fkojunst-production-schedule-list-visibility.policy.ts`](../../apps/api/src/services/production-schedule/policies/fkojunst-production-schedule-list-visibility.policy.ts)
