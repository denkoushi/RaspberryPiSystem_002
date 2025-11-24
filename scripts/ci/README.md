# CIログ取得スクリプト

GitHub Actionsのログを簡単に取得するためのスクリプトです。

## セットアップ

### 1. GitHub CLIのインストール

```bash
brew install gh
```

### 2. GitHub CLIの認証

```bash
gh auth login
```

## 使用方法

### 最新のワークフロー実行のログを取得

```bash
# すべてのジョブのログを取得
./scripts/ci/get-logs.sh

# 特定のジョブのログのみ取得
./scripts/ci/get-logs.sh e2e-tests
./scripts/ci/get-logs.sh lint-and-test

# エラーのみを抽出して表示（ログファイルは保存されない）
./scripts/ci/get-logs.sh e2e-tests --errors-only
./scripts/ci/get-logs.sh --errors-only  # すべてのジョブのエラーのみ
```

### エイリアスの設定（オプション）

`~/.zshrc` または `~/.bashrc` に以下を追加：

```bash
alias gh-logs='~/RaspberryPiSystem_002/scripts/ci/get-logs.sh'
```

その後、以下のように使用できます：

```bash
gh-logs              # すべてのジョブのログを取得
gh-logs e2e-tests    # E2Eテストのログのみ取得
```

## 出力先

ログファイルは `~/Downloads/gh-actions-logs/` に保存されます。

## トラブルシューティング

### GitHub CLIが認証されていない

```bash
gh auth login
```

### ワークフロー実行が見つからない

- GitHub Actionsでワークフローが実行されているか確認してください
- リポジトリ名が正しいか確認してください（デフォルト: `denkoushi/RaspberryPiSystem_002`）

