# AI Agent Entry Point

このリポジトリにおけるAIエージェントの基本方針は、`docs/AI_START_HERE.md` と `.cursor/rules/` に集約する。

## AI Start Rule

作業開始時は次の順で読む。

1. `AGENTS.md`
2. `docs/AI_START_HERE.md`
3. `.cursor/rules/00-core-safety.mdc`
4. `.cursor/rules/01-core-docs-and-knowledge.mdc`
5. 今回の作業に該当する `.cursor/rules/*.mdc`
6. Codex/Cursor agmsg連携を使う場合は `docs/guides/agmsg-codex-cursor-collaboration.md`
7. 関連する KB / Runbook / ADR / Plan

## ExecPlan（複雑な作業の必須手順）

複雑な機能追加・大きなリファクタは、`.agent/PLANS.md` に従って ExecPlan を作成し、設計→実装→検証の順で進める。

**ExecPlanの種類**:
- **個別機能のExecPlan**: `docs/plans/*.md` に配置（例: `alerts-platform-phase2.md`、`deploy-stability-execplan.md`）
- **プロジェクト全体のExecPlan**: `EXEC_PLAN.md`（ルート直下・現在は legacy historical log）

**`EXEC_PLAN.md`の現在の扱い**:
- **legacy historical log** として扱う
- 肥大化と文字化けがあるため、詳細正本として信頼しない
- 新規の詳細追記は原則禁止
- 必要な場合でも、現在状態・未完了・次アクションだけに限定する

詳細な事実は1か所だけに記録する。障害・調査は KB、手順は Runbook、設計判断は ADR、未完了計画は Plan に置く。`docs/INDEX.md` と `docs/knowledge-base/index.md` は索引専用とし、本文級の追記は禁止する。

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

このプロジェクト固有の文脈（デプロイ手順・運用・KB等）は `docs/` 配下にあります。AI向けの最小入口は `docs/AI_START_HERE.md`、網羅的な入口は `docs/INDEX.md` です。

- **AI向け最小入口**: `docs/AI_START_HERE.md`
- **ドキュメント入口**: `docs/INDEX.md`
- **設計決定（ADR）**: `docs/decisions/`
- **デプロイ標準手順**: `docs/guides/deployment.md`
- **ナレッジベース索引**: `docs/knowledge-base/index.md`
- **CIトラブルシュート**: `docs/guides/ci-troubleshooting.md`
- **Codex/Cursor agmsg連携**: `docs/guides/agmsg-codex-cursor-collaboration.md`
- **PR 自動レビュー Bot（CodeRabbit / Bugbot）**: `docs/security/pr-review-bots.md`
- **過去ログ**: `EXEC_PLAN.md`（legacy historical log。詳細正本として使わない）

## Cursor 状態DB復旧後（2026-06-06）

チャット/Agent 履歴が失われても、**リポジトリ・`docs/`・未コミット WIP は残る**。復旧直後は次を優先する。

- **未コミット変更は WIP として破棄しない**（復旧直後に残っていた作業は `docs/` へ昇格してからコミット）
- **本番デプロイ・Pi 実機操作はユーザー明示まで実行しない**
- 文脈は [docs/AI_START_HERE.md](./docs/AI_START_HERE.md) · [docs/INDEX.md](./docs/INDEX.md) · 該当 KB / Runbook / ADR / Plan から再構築する
- `EXEC_PLAN.md` は過去ログとしてのみ参照し、復旧後の新規詳細追記先にしない

詳細: [KB-388](./docs/knowledge-base/KB-388-cursor-state-db-corruption-external-ssd-recovery.md) · [development §Cursor復旧後](./docs/guides/development.md#cursor-状態db復旧後の-agent-作業2026-06-06)

## 共有時の推奨フレーズ（短縮）

「**`AGENTS.md`、`docs/AI_START_HERE.md`、該当する `.cursor/rules/` を読んでから開始**」
