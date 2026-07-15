# 段階型CIと`main` rulesetガイド

## 概要

このドキュメントでは、変更内容に応じて実行jobを絞る段階型CIと、`main`を保護するGitHub rulesetの契約を説明します。

## 背景

すべてのPRで全jobを実行するとfeedbackが遅くなります。一方、条件付きjobそのものをrequired checkにすると、正しくskipされたPRがmerge不能になります。そのため次の三層に分けます。

1. `scripts/ci/classify_changes.py`が変更pathを分類し、必要なjobだけを実行する
2. 常に存在する`ci-required`が、選択jobの成功と非選択jobのskipを検証する
3. rulesetは固定名`ci-required`、`codeql`、`gitleaks`だけをrequiredにする

## 段階型CI

PRでは`repo-policy`、`workspace-quality`、`api`、`web`、`db-infra`、`deploy-contract`、`client`、`e2e-smoke`、`e2e-tests`、`docker-security`から必要なものを並列実行します。docsとroot Markdownだけの変更は`repo-policy`だけです。未知path、rename、delete、workflow、action、CI classifier変更はfail-closedでfull suiteになります。

`push main`、`merge_group`、`workflow_dispatch`、毎日02:30 JSTのscheduleはpathに関係なくfull suiteです。PRのAPI testはcoverageなしで全件を1回実行し、full-suite eventではcoverage付き3 shardを実行します。

## `main` ruleset

representative PRで`ci-required`、`codeql`、`gitleaks`が成功した後に、default branchだけを対象とするactive rulesetを設定します。PRを必須にし、必要承認数は`0`、required checkはこの3件だけです。force-pushとbranch deletionは禁止し、branch must be up to dateは無効にします。

条件付きjob名をrequiredへ追加してはいけません。GitHubはrequired status checkをworkflowやeventごとに区別しないため、skipされるjobをrequiredにするとmergeが停止します。`merge_group`でも3つの固定checkが生成されるよう、対応workflowはすべて`merge_group` eventを持ちます。

設定値と確認方法の短い一覧は[`.github/BRANCH_PROTECTION_SETUP.md`](../../.github/BRANCH_PROTECTION_SETUP.md)を参照してください。このrepositoryには`develop` branchがないため、対象は`main`だけです。

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

### 問題: rulesetが機能しない

**確認事項**:
1. rulesetのenforcementがactiveか
2. 対象がdefault branchか
3. required checkが`ci-required`、`codeql`、`gitleaks`の3件だけか
4. 最新PR headで3件が成功しているか

### 問題: path分類漏れで`main`だけ失敗した

**対応**:
1. 失敗pathをclassifier fixtureとして追加する
2. conditional jobの`if`だけを一時的に無効化し、PRをfull suiteへ戻す
3. `ci-required`とrulesetは維持する
4. fixtureと修正後のrepresentative PRが成功してから条件分岐を再有効化する

## 関連ドキュメント

- `docs/analysis/dropbox-csv-integration-status.md`: CI/CDの課題と対策の詳細
- `.github/workflows/ci.yml`: CIワークフローの設定
- `docs/guides/development.md`: 開発環境とワークフローの説明

## 更新履歴

- 2026-07-16: 段階型CI、固定`ci-required`、default-branch ruleset契約へ更新
- 2026-04-21: 必須チェック名を現行ワークフロー（`lint-build-unit` 等）と `codeql` / `gitleaks` に同期
- 2025-12-15: 初版作成、`continue-on-error`削除を実施
