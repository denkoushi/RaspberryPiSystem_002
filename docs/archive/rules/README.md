# アーカイブ: 旧Cursorルールファイル

このディレクトリには、`.cursor/rules/`から移動した**閉架（Deprecated）**の旧ルールファイルを保管しています。

## 注意

⚠️ **これらのファイルは通常は参照しないでください。**

内容は新しい汎用ルール（`.cursor/rules/00-*.mdc`、`10-*.mdc`など）へ移行済みです。

## 保管理由

- 互換性のため（過去の参照が残っている可能性）
- 移行履歴の記録として

## ファイル一覧

- `system-stability.mdc` → `.cursor/rules/00-core-safety.mdc` などへ移行
- `documentation-first.mdc` → `.cursor/rules/01-core-docs-and-knowledge.mdc` へ移行
- `debug-mode.mdc` → `.cursor/rules/11-debugging-playbook.mdc` へ移行
- `documentation-maintenance.mdc` → `.cursor/rules/30-docs-maintenance.mdc` へ移行
- `git-workflow.mdc` → `.cursor/rules/20-git-workflow.mdc` へ移行

## 移動日

2025-01-XX: `.cursor/rules/`から`docs/archive/rules/`へ移動
