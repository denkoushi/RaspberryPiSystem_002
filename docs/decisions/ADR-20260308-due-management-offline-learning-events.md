# ADR-20260308: 納期管理ランキング学習はオフライン評価 + イベントログ方式

- Status: accepted

## Context

- 納期管理ランキングは重み付きスコアで自動提案できるが、主目的（納期遅れ最小化）と副目的（現場順位への整合）を明確に分離できていなかった
- 既存データはCSV再取込や保持期間削除の影響を受けるため、学習/監査向けの履歴としては欠損しうる
- 本番での即時自己学習は、データ品質やサンプル不足時に挙動が不安定化するリスクがある

## Decision

- 学習方式は **オフライン評価のみ** とし、本番保存時に重みを自動更新しない
- 以下の追記専用イベントテーブルを導入する
  - `DueManagementProposalEvent`
  - `DueManagementOperatorDecisionEvent`
  - `DueManagementOutcomeEvent`
- 既存の `ProductionScheduleGlobalRank` は運用表示向け投影として維持する
- 新規API `GET /api/kiosk/production-schedule/due-management/global-rank/learning-report` で期間評価を提供する

## Alternatives

- 代替案A: 本番で重みを逐次更新するオンライン学習
  - 却下理由: データ品質/件数が安定する前に導入すると過学習・挙動不安定化を招く
- 代替案B: 既存テーブルのみで学習を行う
  - 却下理由: 履歴欠損時に再現性・監査性を担保しにくい

## Consequences

- 良い影響
  - 学習・監査・再現実験のための履歴が保持される
  - 本番挙動を安定させたまま改善サイクルを回せる
  - 目的関数（遅れ最小化）と一致度指標を分離して評価できる
- 悪い影響
  - イベント保存によりDBサイズと集計コストが増える
  - レポート運用（期間指定・解釈）が追加で必要になる

## References

- `docs/knowledge-base/KB-297-kiosk-due-management-workflow.md`
- `apps/api/src/services/production-schedule/due-management-learning-event.repository.ts`
- `apps/api/src/services/production-schedule/due-management-learning-evaluator.service.ts`
- `apps/api/src/routes/kiosk/production-schedule/due-management-global-rank.ts`
