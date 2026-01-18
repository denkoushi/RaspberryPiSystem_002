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

## プロジェクト固有コンテキスト（ショートカット）

このプロジェクト固有の文脈（デプロイ手順・運用・KB等）は `docs/` 配下にあります。網羅的な入口は `docs/INDEX.md` です。

- **ドキュメント入口**: `docs/INDEX.md`
- **デプロイ標準手順**: `docs/guides/deployment.md`
- **ナレッジベース索引**: `docs/knowledge-base/index.md`
- **CIトラブルシュート**: `docs/guides/ci-troubleshooting.md`
- **現状把握（進捗・決定）**: `EXEC_PLAN.md`

## 共有時の推奨フレーズ（短縮）

「**`AGENTS.md` と `.cursor/rules/` を読んでから開始**」
