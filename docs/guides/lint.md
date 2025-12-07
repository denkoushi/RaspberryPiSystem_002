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
- importルール強化: `import/order`、`import/no-cycle` を有効化（API/Web/shared-types）
- shared-typesも lint 対象 (`pnpm -r lint` で `packages/shared-types` を含む)
- dist/生成物は lint 対象外（`ignorePatterns: ['dist/**']`）
- 厳格化（`recommended-type-checked`, securityルール）は影響範囲を見て段階導入する

### import/order 運用メモ
- グループ順: builtin → external → internal（`@raspi-system/**`など） → parent/sibling → object → type
- グループ間は空行を1行入れる
- 新規ファイル作成時は `pnpm lint --fix` を実行して自動整形する

### CIで落ちやすいポイントと対策
- import/order: 空行不足・type importの位置ずれ → `pnpm lint --fix` で解決可
- lockfile: 依存追加後に `pnpm install` で `pnpm-lock.yaml` を更新（`--frozen-lockfile` 回避）
- E2Eスモーク: `VITE_DEFAULT_CLIENT_KEY` など環境変数を固定し、DB起動→generate→migrate→seedを実行

### コミット前チェックリスト
- `pnpm lint --max-warnings=0`
- 追加/更新ファイルで `pnpm lint --fix` を実行
- 依存を追加した場合は `pnpm install` 後に lockfile をコミット

## CIでの扱いと段階的な安定化
- lintは必須ジョブとして実行（秩序維持の最低ライン）
- E2Eは段階導入：まずはUIスモーク（初期表示＋タブ遷移など最小ケース）を安定化し、重いシナリオは任意ジョブに退避
- CI用の固定設定例：`VITE_KIOSK_DEFAULT_MODE=TAG` など、設定依存リダイレクトを固定して描画を安定させる
- 待機強化：クリック前後で`toBeVisible`/`waitForURL`などを使い、描画遅延によるデタッチを防止
- 実機検証OKでも、将来の統合に備えてlint＋軽量スモークは通す（統合時期がずれても同じ文法・構造でコードを維持するため）

## 秩序維持の考え方（lintの位置づけ）
- 目的: モジュール間の統合や将来の拡張を容易にするため、コード規律を保つ
- 手段: lintで基本ルールを強制し、同じ文法・スタイルで書かれたコードを積み上げる
- バランス: 過度な厳格化は避け、最低限の規律（型・未使用・Hooks依存）を守りつつ開発速度を確保

