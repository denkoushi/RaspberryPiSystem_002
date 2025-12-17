# CI必須化とブランチ保護設定ガイド

## 概要

このドキュメントでは、CIテストの必須化とブランチ保護ルールの設定方法について説明します。

## 背景

以前、CIテストが失敗してもマージが進んでしまう問題がありました。これを防ぐため、以下の対策を実施します：

1. **CIテストの必須化**: `continue-on-error: true`を削除し、すべてのテストを必須化
2. **ブランチ保護ルールの設定**: GitHubのブランチ保護機能を使用して、テストがパスしない限りマージできないようにする

## CI必須化の実装

### 1. GitHub Actionsワークフローの修正

**変更内容**:
- `.github/workflows/ci.yml`から`continue-on-error: true`を削除
- すべてのテストジョブが失敗時に`exit-code: 1`を返すように設定

**実施済み**:
- ✅ `e2e-tests`ジョブから`continue-on-error: true`を削除（2025-12-15）
- ✅ `e2e-tests`ジョブのコメントを修正（「non-blocking」→「blocking」に変更、2025-12-15）
- ✅ `imports-dropbox`テストをCIワークフローに追加（2025-12-15）

**⚠️ 重要**: ブランチ保護ルールの設定は**手動で実施する必要があります**。設定手順は [`.github/BRANCH_PROTECTION_SETUP.md`](../../.github/BRANCH_PROTECTION_SETUP.md) を参照してください。

### 2. 必須チェックの一覧

以下のチェックが必須となります：

- `lint-and-test`: リントと単体テスト
- `e2e-smoke`: E2Eスモークテスト
- `docker-build`: Dockerイメージのビルド
- `imports-dropbox-tests`: Dropbox CSVインポートテスト（Phase 1実装後）
- `imports-schedule-tests`: スケジュールインポートテスト（Phase 2実装後）
- `backup-restore-dropbox-tests`: Dropboxバックアップ・リストアテスト（Phase 3実装後）

## ブランチ保護ルールの設定

### GitHubでの設定手順

1. **リポジトリの設定ページにアクセス**
   - GitHubリポジトリのページで「Settings」をクリック
   - 左メニューから「Branches」を選択

2. **ブランチ保護ルールの追加**
   - 「Add branch protection rule」をクリック
   - 「Branch name pattern」に`main`を入力

3. **必須チェックの設定**
   - 「Require status checks to pass before merging」にチェック
   - 「Require branches to be up to date before merging」にチェック
   - 「Status checks that are required」で以下のチェックを選択：
     - `lint-and-test`
     - `e2e-smoke`
     - `docker-build`
     - （Phase 1実装後）`imports-dropbox-tests`
     - （Phase 2実装後）`imports-schedule-tests`
     - （Phase 3実装後）`backup-restore-dropbox-tests`

4. **管理者のスルーを禁止**
   - 「Do not allow bypassing the above settings」にチェック
   - これにより、管理者でもテストをスルーできなくなります

5. **設定の保存**
   - 「Create」をクリックして設定を保存

### 同様に`develop`ブランチにも設定

`develop`ブランチにも同様の保護ルールを設定することを推奨します。

## テストの安定化対策

CI必須化を実施する前に、テストの安定化も重要です。

### 1. タイムアウトの適切な設定

CI環境では、ローカル環境より処理が遅い可能性があるため、タイムアウトを長めに設定します。

**例**:
```typescript
// 大規模CSV処理のテスト
const maxTime = process.env.CI ? 60000 : 30000; // CIでは60秒、ローカルでは30秒
expect(processingTime).toBeLessThan(maxTime);
```

### 2. リトライロジックの実装

不安定なテストにはリトライロジックを実装します。

**例**:
```yaml
# .github/workflows/ci.yml
- name: Run tests with retry
  run: |
    pnpm test --reporter=verbose || {
      echo "Tests failed, retrying..."
      pnpm test --reporter=verbose || exit 1
    }
```

### 3. テストの独立性

各テストが独立して実行可能であることを確認します。

- テスト間で状態を共有しない
- 各テストで必要なデータをセットアップする
- テスト後にクリーンアップする

## 監視とアラート

### CIテストの監視項目

以下の項目を監視します：

1. **成功率**: CIテストの成功率を追跡
2. **実行時間**: テスト実行時間を監視し、異常に長いテストを特定
3. **失敗原因**: 失敗したテストの原因を分析
4. **スルー状況**: CIテストのスルーが検出された場合にアラート

### アラート条件

以下の条件でアラートを発火します：

- CIテストが3回連続で失敗した場合
- CIテストのスルーが検出された場合（ブランチ保護ルールが適切に設定されていれば発生しない）

## トラブルシューティング

### 問題: テストが不安定で頻繁に失敗する

**対策**:
1. テストのログを確認して原因を特定
2. タイムアウトを適切に設定
3. リトライロジックを実装
4. テストの独立性を確認

### 問題: ブランチ保護ルールが機能しない

**確認事項**:
1. ブランチ保護ルールが正しく設定されているか
2. 必須チェックの名前が正しいか（GitHub Actionsのジョブ名と一致しているか）
3. 「Do not allow bypassing the above settings」が有効になっているか

### 問題: 緊急時にマージが必要だがテストが失敗している

**対応**:
1. まず、テストが失敗している原因を特定
2. 可能であれば、テストを修正してからマージ
3. 緊急の場合は、一時的にブランチ保護ルールを無効化（ただし、後で必ず有効化する）
4. マージ後、失敗したテストを修正して再マージ

## 関連ドキュメント

- `docs/analysis/dropbox-csv-integration-status.md`: CI/CDの課題と対策の詳細
- `.github/workflows/ci.yml`: CIワークフローの設定
- `docs/guides/development.md`: 開発環境とワークフローの説明

## 更新履歴

- 2025-12-15: 初版作成、`continue-on-error`削除を実施
