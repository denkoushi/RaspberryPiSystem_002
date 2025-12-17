# ブランチ保護ルール設定手順（必須）

## ⚠️ 重要: CIを無視する問題を防ぐために必須設定

この設定を行わないと、CIテストが失敗してもマージが進んでしまう問題が発生します。

## 設定手順

### 1. GitHubリポジトリの設定ページにアクセス

1. GitHubリポジトリのページで「Settings」をクリック
2. 左メニューから「Branches」を選択

### 2. `main`ブランチの保護ルールを追加

1. 「Add branch protection rule」をクリック
2. 「Branch name pattern」に`main`を入力

### 3. 必須チェックの設定

以下の設定を**必ず**行ってください：

- ✅ **「Require status checks to pass before merging」にチェック**
- ✅ **「Require branches to be up to date before merging」にチェック**
- ✅ **「Status checks that are required」で以下のチェックを選択**：
  - `lint-and-test`
  - `e2e-smoke`
  - `docker-build`

### 4. 管理者のスルーを禁止（最重要）

- ✅ **「Do not allow bypassing the above settings」にチェック**
- これにより、管理者でもテストをスルーできなくなります

### 5. 設定の保存

- 「Create」をクリックして設定を保存

### 6. `develop`ブランチにも同様の設定

`develop`ブランチにも同様の保護ルールを設定してください。

## 確認方法

設定後、以下の方法で確認できます：

1. **テストを失敗させるPRを作成**
   - 意図的にテストを失敗させる変更をコミット
   - PRを作成
   - 「Merge」ボタンが無効化されていることを確認

2. **GitHub Actionsのステータスを確認**
   - PRページで「Checks」タブを確認
   - 必須チェックが表示されていることを確認

## トラブルシューティング

### 問題: 必須チェックが表示されない

**原因**: GitHub Actionsのワークフローがまだ実行されていない

**解決方法**:
1. 一度PRを作成してCIを実行する
2. CIが完了した後、ブランチ保護ルールの設定ページで必須チェックが表示されるようになる

### 問題: 設定してもマージできてしまう

**原因**: 「Do not allow bypassing the above settings」がチェックされていない

**解決方法**:
1. ブランチ保護ルールの設定ページを開く
2. 「Do not allow bypassing the above settings」にチェックを入れる
3. 設定を保存

## 関連ドキュメント

- [CI必須化とブランチ保護設定ガイド](../docs/guides/ci-branch-protection.md)
- [CI/CDの課題と対策](../docs/analysis/dropbox-csv-integration-status.md#cicdの課題と対策)
