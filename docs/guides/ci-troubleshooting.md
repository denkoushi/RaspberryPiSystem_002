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

### 11. `test:coverage` が `TypeError: minimatch is not a function` で失敗する（`test-exclude@6.0.0` と `minimatch@10.x` の非互換）

**症状**: CIの`Run API tests`ステップで、すべてのテストファイル（90件）が失敗し、以下のエラーが表示される:
```
TypeError: minimatch is not a function
❯ matches ../../node_modules/.pnpm/test-exclude@6.0.0/node_modules/test-exclude/index.js:99:36
❯ TestExclude.shouldInstrument ../../node_modules/.pnpm/test-exclude@6.0.0/node_modules/test-exclude/index.js:102:28
❯ IstanbulCoverageProvider.onFileTransform ../../node_modules/.pnpm/@vitest+coverage-istanbul@1.6.1_vitest@1.6.1/node_modules/@vitest/coverage-istanbul/dist/provider.js:167:27
```

**確認事項**:
- `package.json`の`pnpm.overrides`に`test-exclude`のバージョンが指定されているか
- `minimatch`のバージョンが`10.x`以上か（セキュリティ修正のため）
- `test-exclude@6.0.0`が`minimatch@10.x`と非互換か

**対処法**:
1. `package.json`の`pnpm.overrides`に`"test-exclude": "7.0.1"`を追加（`test-exclude@7.0.1`は`minimatch@10.x`に対応）
2. `test-exclude>glob: 7.2.3`のoverrideを削除（不要になったため）
3. `minimatch`のoverrideを`>=10.2.1`から`10.2.1`に固定（セキュリティ修正のため）
4. `pnpm install --no-frozen-lockfile`で依存関係を更新
5. ローカルで`pnpm --filter @raspi-system/api test:coverage`を実行して確認
6. CIを再実行して確認

**注意**:
- `test-exclude@6.0.0`は`minimatch@10.x`のESMエクスポート形式に対応していないため、`test-exclude@7.0.1`への更新が必要
- セキュリティ修正（`minimatch`のoverride）と互換性修正（`test-exclude`のoverride）を同時に行う場合は、両方の影響を確認する

**参考**: 2026-02-19に発生し、`test-exclude@7.0.1`へのoverride追加で解決。CI成功（Run ID `22163832946`）、デプロイ成功、実機検証で正常表示を確認。詳細は [knowledge-base/ci-cd.md#kb-270](../knowledge-base/ci-cd.md#kb-270-ciのvitest-coverageでtest-excludeとminimatchの非互換エラー) を参照。

### 9. 性能テストの失敗（`Run API performance tests`）

**症状**: `Run API performance tests` ステップでテストが失敗し、CIが停止

**エラーメッセージ例**:
```
Error: Response time 2100ms exceeds threshold 1800ms
  at performance.test.ts:45
```

**確認事項**:
- 性能テストの閾値（`PERF_RESPONSE_TIME_THRESHOLD_MS`）が適切か（デフォルト: `1800ms`）
- テスト対象のAPIエンドポイントが正常に動作しているか
- データベースの負荷が高い状態でないか
- CI環境のリソース（CPU/メモリ）が不足していないか

**対処法**:
- ローカルで `pnpm test -- performance` を実行して再現性を確認
- 閾値を一時的に引き上げる（環境変数 `PERF_RESPONSE_TIME_THRESHOLD_MS` を設定）
- パフォーマンスの根本原因を調査（DBクエリの最適化、インデックス追加など）
- CI環境のリソース状況を確認（GitHub Actionsのログで確認）

**よくある原因**:
1. **クライアント認証不足**: `x-client-key` ヘッダーが必要なエンドポイントで未設定
   - 対処: テスト内で `createTestClientDevice()` を呼び出し、`x-client-key` を付与
2. **レスポンス形式の誤解**: JSONを期待しているが、実際はテキスト形式
   - 対処: `response.json()` ではなく `response.body.length` をチェック
3. **テストデータの一意制約衝突**: 固定の `apiKey` を使用して `ClientDevice` を作成
   - 対処: `createTestClientDevice()` で自動生成キーを使用（固定キーを避ける）
4. **認証前提の見落とし**: 管理系エンドポイント（例: `/api/tools/employees`, `/api/tools/items`）でJWTヘッダ未付与
   - 対処: 性能テストでは `createTestUser('ADMIN')` + `createAuthHeader(token)` を利用して `Authorization` ヘッダを明示的に付与

**参考**: フェーズ4第一弾実装時に、`performance.test.ts` で以下のトラブルが発生:
- `GET /api/kiosk/production-schedule/history-progress` が `401 CLIENT_KEY_REQUIRED` → テスト用クライアント作成で解決
- `GET /api/system/metrics` がJSONではなくテキスト → JSONパース依存を除去して解決
- 固定 `apiKey` による一意制約衝突（P2002）→ 自動生成キーへ修正して解決
- フェーズ4第二弾で追加した `/api/tools/employees`・`/api/tools/items` が `401 AUTH_TOKEN_REQUIRED` → JWTヘッダ付与で解決

詳細は [knowledge-base/api.md#kb-258](./../knowledge-base/api.md#kb-258-コード品質改善フェーズ2ratchet-型安全化lint抑制削減契約型拡張) を参照。

### 10. `test:coverage` が `ERR_INVALID_ARG_TYPE` で失敗する（`test-exclude` / `glob` 競合）

**症状**: ローカルで `pnpm --filter @raspi-system/api test:coverage` を実行すると、`test-exclude` 読み込み時に以下で停止する。

```text
TypeError [ERR_INVALID_ARG_TYPE]: The "original" argument must be of type function.
... test-exclude/index.js
```

**確認事項**:
- root `package.json` の `pnpm.overrides` に `glob` が強制指定されているか
- `apps/api` の coverage provider が `istanbul` 指定になっているか
- `apps/api` で Prisma Client が生成済みか（未生成だと別エラーを誘発）

**対処法（本リポジトリの確定手順）**:
1. `apps/api/package.json` の `test:coverage` を `--coverage.provider=istanbul` 付きで実行
2. root `package.json` の `pnpm.overrides` に `test-exclude>glob: 7.2.3` を維持
3. `pnpm install --no-frozen-lockfile` 後に `pnpm prisma generate` を実行
4. 再度 `pnpm --filter @raspi-system/api test:coverage -- <target>` で確認

**注意**:
- `test-exclude>glob` を外すと同エラーが再発するため、現時点では維持が必要
- 依存を大きく更新するB2フェーズを実施する場合は、再度この項目の検証を行う

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

