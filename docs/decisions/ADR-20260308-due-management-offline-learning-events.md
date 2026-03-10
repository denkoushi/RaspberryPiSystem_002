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
- （2026-03-09 追記）`ProductionScheduleGlobalRank` を親順位として、行単位の投影 `ProductionScheduleGlobalRowRank` を別テーブルで保持する
  - `processingOrder`（資源CD別順番）は既存運用のまま維持し、意味を分離する
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
  - 全体順位（globalRank）と資源順番（processingOrder）の責務が分離され、UI/運用の混同を避けられる
- 悪い影響
  - イベント保存によりDBサイズと集計コストが増える
  - レポート運用（期間指定・解釈）が追加で必要になる

## 実装前議論（コンテキスト共有）

本ADR採択前に以下の議論・検討を行った。今後の開発方向性のコンテキスト共有に有用。

- **オフライン評価を採用した理由**: 本番での即時自己学習（オンライン学習）は、データ品質やサンプル不足時に挙動が不安定化するリスクがある。既存データはCSV再取込や保持期間削除の影響を受けるため、学習/監査向けの履歴としては欠損しうる。オフライン評価のみに限定することで、本番挙動を安定させたまま改善サイクルを回せる
- **イベントモデル設計**: 追記専用の3テーブル（Proposal/Decision/Outcome）で一次データを保持。既存 `ProductionScheduleGlobalRank` は運用表示向け投影として維持し、イベントテーブルは分析・再学習・監査の一次データとして扱う
- **主指標と副指標の分離**: 主指標は遅延側（overdue件数、overdue日数）。提案と現場決定の一致度（Top-K/Spearman/Kendall）は副指標として、目的関数（遅れ最小化）と一致度指標を分離して評価できる
- **実装時の知見**: Prisma JSONカラムへの `Record<string, unknown> | null` の代入でCIビルドが失敗。`Prisma.JsonNull` と `Prisma.InputJsonValue` の型契約に従う必要がある（[KB-299](../knowledge-base/ci-cd.md#kb-299-prisma-jsonカラムへのrecordstring-unknown-やnullの代入でciビルド失敗)）

## References

- `docs/knowledge-base/KB-297-kiosk-due-management-workflow.md`
- `apps/api/src/services/production-schedule/due-management-learning-event.repository.ts`
- `apps/api/src/services/production-schedule/due-management-learning-evaluator.service.ts`
- `apps/api/src/routes/kiosk/production-schedule/due-management-global-rank.ts`
