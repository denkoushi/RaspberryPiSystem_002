# ExecPlans
 
When writing complex features or significant refactors, use an ExecPlan (as described in .agent/PLANS.md) from design to implementation.

## 基本原則

**既存の稼働システムを壊さないことを最優先とする。**

- 作業前に必ず `docs/INDEX.md` から関連ドキュメントを参照する
- 既存のナレッジベース（KB-xxx）を確認し、過去のトラブルシューティング記録を尊重する
- 段階的に進め、各ステップで動作確認を行う
- 動いているコードは「動いている理由」を理解してから変更する
- 独自の新ロジックを追加する前に既存実装を確認する

詳細は以下のルールファイルを参照：
- `.cursor/rules/system-stability.mdc`: 既存システム保護ルール（最優先）
- `.cursor/rules/documentation-first.mdc`: ドキュメント優先・既存コード尊重ルール
- `.cursor/rules/debug-mode.mdc`: デバッグモードと開発方針ルール（開発時）
- `.cursor/rules/git-workflow.mdc`: Gitワークフロー改善ルール（Git操作時）
