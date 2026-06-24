# AI引き継ぎプロンプト

このプロジェクトを引き継ぐAIアシスタントへ：

**まず、以下のドキュメントを順番に確認してください：**

1. **[AGENTS.md](../AGENTS.md)** - AIの最上位入口
2. **[docs/AI_START_HERE.md](./AI_START_HERE.md)** - AI向けの最小入口
3. **[.cursor/rules/00-core-safety.mdc](../.cursor/rules/00-core-safety.mdc)** - 安全ルール
4. **[.cursor/rules/01-core-docs-and-knowledge.mdc](../.cursor/rules/01-core-docs-and-knowledge.mdc)** - ドキュメント正本ルール
5. 今回の作業に該当する `.cursor/rules/*.mdc`
6. Codex/Cursor agmsg連携を使う場合は **[agmsg連携ガイド](./guides/agmsg-codex-cursor-collaboration.md)**
7. 関連する KB / Runbook / ADR / Plan

**重要な原則：**
- `EXEC_PLAN.md` は legacy historical log。詳細正本として使わない。
- 詳細な事実は KB / Runbook / ADR / Plan の1か所だけに置く。
- `docs/INDEX.md` と `docs/knowledge-base/index.md` は薄い索引に限定する。
- 同じ事実を複数文書へ全文コピーしない。
- agmsg はAI間の連絡用であり、正本ドキュメントやGitの代わりにしない。

詳細は [docs/guides/ai-handoff.md](./guides/ai-handoff.md) を参照してください。
