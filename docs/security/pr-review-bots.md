# PR 自動レビュー（CodeRabbit / Cursor Bugbot）

## 目的

- AI や高速差分開発で増えやすい **認証漏れ・機微ログ・危険パターン** を、人間レビュー前に機械的に拾う。
- 本リポジトリでは **GitHub Actions（CodeQL / Gitleaks / 既存 CI）** を一次ゲートとし、**外部レビュー Bot** を補助として使う。

## CodeRabbit

1. GitHub の Organization / Repository で **CodeRabbit GitHub App** をインストールする。
2. 本リポジトリルートの [`.coderabbit.yaml`](../../.coderabbit.yaml) がレビュー設定の起点になる。
3. PR では **要約・指摘・セキュリティ観点**のコメントが付く。指摘は **誤検知があり得る**ため、必ず人間が最終判断する。

## Cursor Bugbot

1. Cursor の **Bugbot** は Cursor 側の設定と GitHub 連携（組織ポリシーに従う）で有効化する。
2. リポジトリ内に必須の設定ファイルが無い場合もあるため、**Cursor ドキュメントの最新手順**に従う。
3. Bugbot の指摘は **差分中心**であり、設計全体の代替にはならない。

## レビューで必ず見る観点（人間・Bot 共通）

- **認証/認可**: 新規 `route` に `preHandler` / `x-client-key` が必要か。
- **秘密情報**: Webhook URL、トークン、`.env` 混入。Gitleaks と二重で確認。
- **外部通信**: ユーザー入力由来の URL fetch（SSRF）、タイムアウト・上限。
- **LLM 周辺**: プロンプトのロール分離、`max_tokens` 上限、ログに生テキストを残さない。
- **レート制限**: 認証系・高コスト処理の除外範囲が肥大化していないか。

## 関連

- [`.github/workflows/codeql.yml`](../../.github/workflows/codeql.yml)
- [`.github/workflows/gitleaks.yml`](../../.github/workflows/gitleaks.yml)
- [`ci-branch-protection.md`](../guides/ci-branch-protection.md)
