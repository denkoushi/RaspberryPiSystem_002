# AI Agent Entry Point

このリポジトリにおけるAIエージェントの基本方針は、`.cursor/rules/` に集約する。

## ExecPlan（複雑な作業の必須手順）

複雑な機能追加・大きなリファクタは、`.agent/PLANS.md` に従って ExecPlan を作成し、設計→実装→検証の順で進める。

**ExecPlanの種類**:
- **個別機能のExecPlan**: `docs/plans/*.md` に配置（例: `alerts-platform-phase2.md`、`deploy-stability-execplan.md`）
- **プロジェクト全体のExecPlan**: `EXEC_PLAN.md`（ルート直下）

**`EXEC_PLAN.md`の用途**:
- **進捗管理**: プロジェクト全体の完了タスクと残タスクを追跡
- **決定事項の記録**: `Decision Log`セクションに重要な設計決定を記録
- **発見事項の記録**: `Surprises & Discoveries`セクションに実装中に発見した問題や知見を記録
- **振り返り**: `Outcomes & Retrospective`セクションに完了したマイルストーンの成果と学びを記録
- **次のタスクの提示**: `Next Steps`セクションに将来のタスク候補を記録

**`EXEC_PLAN.md`を参照すべきタイミング**:
- 作業開始前: プロジェクト全体の進捗と決定事項を把握
- 設計決定時: 過去の決定事項を確認し、一貫性を保つ
- 作業完了時: 進捗を更新し、発見事項や決定事項を記録
- 次のタスク検討時: `Next Steps`セクションを確認

## 参照するルール（`.cursor/rules/`）

### Always（常時適用）

- `.cursor/rules/00-core-safety.mdc`: 安全最優先（破壊的操作の抑止、最小変更、実行境界）
- `.cursor/rules/01-core-docs-and-knowledge.mdc`: ナレッジ/ドキュメントの構造化（KB/ADR/Runbook/索引）
- `.cursor/rules/02-core-architecture.mdc`: 疎結合・モジュール化・互換性維持

### Auto Attached / Agent Requested（必要時のみ）

- `.cursor/rules/10-quality-ci-and-tests.mdc`: CI/テストによる品質担保
- `.cursor/rules/11-debugging-playbook.mdc`: 仮説駆動デバッグ
- `.cursor/rules/20-git-workflow.mdc`: Git安全運用（明示依頼がある時のみ実行）
- `.cursor/rules/30-docs-maintenance.mdc`: ドキュメント肥大化対策
- `.cursor/rules/33-frontend-ui-quality.mdc`: UI品質（UI Skillsを条件付き採用）

## プロジェクト固有コンテキスト（ショートカット）

このプロジェクト固有の文脈（デプロイ手順・運用・KB等）は `docs/` 配下にあります。網羅的な入口は `docs/INDEX.md` です。

- **ドキュメント入口**: `docs/INDEX.md`
- **デプロイ標準手順**: `docs/guides/deployment.md`
- **ナレッジベース索引**: `docs/knowledge-base/index.md`
- **CIトラブルシュート**: `docs/guides/ci-troubleshooting.md`
- **プロジェクト全体の進捗・決定・次のタスク**: `EXEC_PLAN.md`（ルート直下）
  - 進捗管理、決定事項の記録、発見事項の記録、振り返り、次のタスクの提示
  - 詳細は上記「ExecPlan（複雑な作業の必須手順）」セクションを参照

## 共有時の推奨フレーズ（短縮）

「**`AGENTS.md` と `.cursor/rules/` を読んでから開始**」
