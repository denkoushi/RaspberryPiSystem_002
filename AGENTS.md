# AI Agent Entry Point

このリポジトリにおけるAIエージェントの基本方針は、`.cursor/rules/` に集約する。

## ExecPlan（複雑な作業の必須手順）

複雑な機能追加・大きなリファクタは、`.agent/PLANS.md` に従って ExecPlan を作成し、設計→実装→検証の順で進める。

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
