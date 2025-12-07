---
title: CIテスト失敗のトラブルシューティングガイド
tags: [CI/CD, トラブルシューティング, GitHub Actions]
audience: [開発者]
last-verified: 2025-12-07
related: [../knowledge-base/ci-cd.md, development.md]
category: guides
update-frequency: high
---

# CIテスト失敗のトラブルシューティングガイド

## 概要

GitHub ActionsのCIテストが失敗した場合、このガイドに従って問題を特定し、必要な情報をAIアシスタントに共有してください。

## ベストプラクティス

### 1. 失敗ログの取得方法

#### 方法A: GitHub ActionsのWeb UIから取得（推奨）

1. GitHubリポジトリの「Actions」タブを開く
2. 失敗したワークフローをクリック
3. 失敗したジョブ（例: `lint-and-test`）をクリック
4. ログをコピー（右上の「Copy log」ボタン、または手動でコピー）

#### 方法B: GitHub CLIを使用

```bash
# 最新の失敗したワークフローのログを取得
gh run list --limit 1 --json databaseId --jq '.[0].databaseId' | xargs gh run view --log
```

### 2. ログの分析スクリプトを使用

分析スクリプトを使用して、重要な情報だけを抽出します：

```bash
# ログファイルを保存
# （GitHub ActionsのWeb UIからコピーしたログを ci-log.txt に保存）

# 分析スクリプトを実行
bash scripts/ci/analyze-failure.sh ci-log.txt
```

このスクリプトは以下を抽出します：
- 重要なエラーメッセージ
- テスト失敗の詳細
- PostgreSQL関連のエラー
- ビルドエラー
- 環境変数と設定
- テスト実行のサマリー
- タイムアウトエラー

### 3. AIアシスタントに共有する情報

以下の情報を含めてください：

#### 必須情報

1. **エラーメッセージの要約**
   - 主なエラーメッセージ（最初の3-5行）
   - エラーの種類（ビルドエラー、テストエラー、タイムアウトなど）

2. **失敗したステップ**
   - どのステップで失敗したか（例: "Run API tests"）
   - ステップの開始から失敗までのログ（20-30行程度）

3. **テスト実行のサマリー**
   - 実行されたテスト数
   - 失敗したテスト数
   - 失敗したテストの名前

#### 推奨情報

4. **環境情報**
   - Node.jsバージョン
   - pnpmバージョン
   - PostgreSQLの接続状態

5. **関連するコード変更**
   - 最近変更したファイル
   - コミットメッセージ

### 4. ログの共有形式

#### 良い例

```
CIテストが失敗しました。

失敗したステップ: Run API tests
エラーメッセージ:
  Error: Timeout of 30000ms exceeded
  at tests/integration.test.ts:45

テストサマリー:
  Test Files: 10 passed, 1 failed
  Tests: 84 passed, 2 failed

失敗したテスト:
  - POST /api/tools/loans/borrow - should borrow an item successfully
```

#### 悪い例

```
CIが失敗しました。ログ全体を添付します。
（数千行のログが含まれる）
```

## よくある問題と対処法

### 1. PostgreSQL接続エラー

**症状**: `connection refused` や `database does not exist` エラー

**確認事項**:
- PostgreSQLコンテナが起動しているか
- データベース名が正しいか（`borrow_return`）
- 接続文字列が正しいか

**対処法**:
- CIワークフローの`Wait for PostgreSQL`ステップを確認
- 接続確認のログを確認

### 2. タイムアウトエラー

**症状**: `Timeout of 30000ms exceeded`

**確認事項**:
- テストの実行時間が長すぎないか
- データベースクエリが遅いか

**対処法**:
- `vitest.config.ts`のタイムアウト設定を確認
- テストの実行時間を確認

### 3. Prisma Client生成エラー

**症状**: `Prisma Client is not generated` エラー

**確認事項**:
- `Generate Prisma Client`ステップが実行されているか
- `DATABASE_URL`が設定されているか

**対処法**:
- CIワークフローの`Generate Prisma Client`ステップを確認

- 環境変数の設定を確認

### 4. ビルドエラー

**症状**: TypeScriptのコンパイルエラー

**確認事項**:
- 型エラーがないか
- インポートパスが正しいか

**対処法**:
- ローカルで`pnpm build`を実行して確認
- 型エラーを修正

### 5. E2Eスモーク（kiosk）が画面表示に失敗する

**症状**: Playwrightの`kiosk-smoke`でリンクが可視にならず失敗する（/kiosk でナビゲーションが表示されない）。

**チェックリスト（CIで再現性を確保するための最小セット）**:
1. PostgreSQLを起動しているか（`docker run ... postgres-e2e-smoke`）
2. Prisma Clientを生成したか（`pnpm prisma generate`）
3. migrateとseedを実行したか（`pnpm prisma migrate deploy` / `pnpm prisma db seed`）
4. seedに`client-key-raspberrypi4-kiosk1`が含まれているか
5. Vite devサーバーにAPI/WSプロキシがあるか（`vite.config.ts` で `/api` `/ws` を `http://localhost:8080` にフォワード）
6. Playwright起動時に以下を環境変数で渡しているか
   - `VITE_API_BASE_URL=http://localhost:8080/api`
   - `VITE_WS_BASE_URL=ws://localhost:8080/ws`
   - `VITE_DEFAULT_CLIENT_KEY=client-key-raspberrypi4-kiosk1`

**参考ファイル**:
- `.github/workflows/ci.yml`
- `apps/web/vite.config.ts`
- `playwright.config.ts`
- `apps/api/prisma/seed.ts`

### 6. lockfile更新忘れによる frozen-lockfile エラー

**症状**: `ERR_PNPM_OUTDATED_LOCKFILE` で CI が停止（例: shared-types に lint 依存を追加後）

**対処**:
- 依存追加後に必ず `pnpm install` を実行し、`pnpm-lock.yaml` を更新する
- CI では `--frozen-lockfile` がデフォルトのため、lockfile未更新だと止まる

### 7. クリーンアップステップでコンテナ未存在エラー

**症状**: `docker stop postgres-test && docker rm postgres-test` が「コンテナなし」で失敗し、ジョブが中断

**対処**:
- `.github/workflows/ci.yml` のクリーンアップを `docker stop ... && docker rm ... || true` にして未存在を許容

### 8. Lintエラー（import/order違反）

**症状**: `import/order` エラーでlintジョブが失敗

**エラーメッセージ例**:
```
error  There should be at least one empty line between import groups  import/order
error  `../client` import should occur before type import of `@raspi-system/shared-types`  import/order
```

**確認事項**:
- 新規ファイルを作成したか（特にテストファイル）
- import文の順序が正しいか（builtin → external → internal → parent/sibling → type）
- importグループ間に空行があるか

**対処法**:
- ローカルで `pnpm lint --fix` を実行して自動修正
- コミット前に必ず `pnpm lint --max-warnings=0` で確認
- 修正後、再度CIを実行して確認

**予防策**:
- 新規ファイル作成時は必ず `pnpm lint --fix` を実行してからコミット
- VS CodeのESLint拡張機能を有効化してリアルタイムで確認
- コミット前に `pnpm lint --max-warnings=0` で確認する習慣をつける

**参考**: Phase 8実装時に `contracts.client.test.ts` で同様のエラーが発生し、CI run #637-#640が失敗。`pnpm lint --fix` で修正後、run #641で成功。

## ログの見方

### 重要な行を探す

1. **エラーメッセージ**: `Error:`, `✖`, `FAIL` を含む行
2. **スタックトレース**: エラーメッセージの直後の行
3. **テストサマリー**: `Test Files:`, `Tests:` を含む行
4. **環境情報**: `DATABASE_URL`, `NODE_ENV` を含む行

### ログの構造

```
Step: <ステップ名>
  → 実行中のコマンド
  → 出力
  → エラー（あれば）
```

## 関連ドキュメント

- [トラブルシューティングナレッジベース](../knowledge-base/troubleshooting-knowledge.md#kb-005-ciテストが失敗する)
- [開発ガイド](./development.md)
- [デプロイメントガイド](./deployment.md)

