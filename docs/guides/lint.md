# Lint 運用ガイド

## 実行方法
- 全体 lint: `pnpm lint --max-warnings=0`
- 自動修正: `pnpm lint --fix`
- Web 単体: `cd apps/web && pnpm lint`
- API 単体: `cd apps/api && pnpm lint`

## VS Code 推奨拡張
- ESLint (`dbaeumer.vscode-eslint`)
- Prettier (`esbenp.prettier-vscode`)

## 現状の方針
- 既存指摘は解消済み（`--max-warnings=0`で通過）
- 厳格化（`recommended-type-checked`, security/import ルール）は評価の上、必要時に段階導入する

