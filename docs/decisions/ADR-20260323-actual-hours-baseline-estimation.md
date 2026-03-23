# ADR-20260323: 実績基準時間の推定式を縮小中央値へ変更

Status: accepted

## Context

- `actualPerPieceMinutes`（実績基準時間）は、`p75PerPieceMinutes ?? medianPerPieceMinutes` を返す実装だった。
- 実DB（`ProductionScheduleActualHoursCanonical`）の holdout 評価では、`p75` は過大側に寄りやすく、代表値としての誤差が大きかった。
- 生産スケジュール側では個数未取込のため、まずは `分/個` の代表値信頼性を高める必要があった。
- query 系と scoring 系で実績特徴量の読取経路（location fallback / GroupCD / mapping）がズレており、表示値とランキング根拠の一貫性に課題があった。

## Decision

- `actualPerPieceMinutes` の既定戦略を **`shrinkedMedianV1`** に変更する。
  - 式: `w * median(FHINCD×FSIGENCD) + (1 - w) * median(FSIGENCD)`、`w = n / (n + 3)`。
  - `n` は当該キーの `sampleCount`。
- 既存互換のため `legacyP75` 戦略を残し、resolver で戦略差し替え可能にする。
- `actual-hours` の共通読取コンテキストを導入し、query/scoring の読取経路を統一する。
- Feature 集約の対象期間は、直近除外（30日）に加えて lookback 365日を既定とする。

## Alternatives

- `p75` 優先を維持する。
  - 安全側には寄るが、代表値としては過大推定が増えるため不採用。
- 単純中央値のみへ変更する。
  - 少数サンプルキーの振れ幅が残るため不採用。
- すぐに個数取込まで含めて総工数推定へ進む。
  - 現行契約への影響が大きく、段階移行の安全性が落ちるため不採用。

## Consequences

- 良い点:
  - 実績基準時間が代表値として安定し、過大寄りの偏りを抑えられる。
  - query/scoring で同一解決経路となり、表示と根拠の整合が上がる。
- 注意点:
  - `actualPerPieceMinutes` の意味が変わるため、過去運用値との見え方が変化する。
  - 個数未取込のため、`所要(総分)` との厳密比較は引き続き別段の実装が必要。

## References

- API:
  - `apps/api/src/services/production-schedule/actual-hours-feature-resolver.service.ts`
  - `apps/api/src/services/production-schedule/actual-hours/actual-hours-read-context.service.ts`
  - `apps/api/src/services/production-schedule/production-actual-hours-aggregate.service.ts`
  - `apps/api/src/services/production-schedule/production-schedule-query.service.ts`
  - `apps/api/src/services/production-schedule/due-management-query.service.ts`
  - `apps/api/src/services/production-schedule/due-management-scoring.service.ts`
- KB: [KB-297](../knowledge-base/KB-297-kiosk-due-management-workflow.md#実績基準時間-推定式見直し2026-03-23)
