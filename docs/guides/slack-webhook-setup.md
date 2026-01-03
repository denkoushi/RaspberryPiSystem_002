---
title: Slack Incoming Webhook設定ガイド
tags: [Slack, Webhook, 設定]
audience: [運用者, 管理者]
last-verified: 2026-01-03
related: [verification-checklist.md]
category: guides
update-frequency: low
---

# Slack Incoming Webhook設定ガイド

最終更新: 2026-01-03

## 概要

本ドキュメントでは、キオスクサポート機能で使用するSlack Incoming Webhookの設定手順を説明します。

## 前提条件

- Slackワークスペースへのアクセス権限があること
- 管理者権限があること（推奨）

## 設定手順

### 方法1: Slackワークスペースから直接作成（推奨）

1. **Slackワークスペースにログイン**
   - ブラウザまたはSlackアプリでワークスペースにアクセス

2. **Incoming Webhooksアプリを追加**
   - 左サイドバーの「Apps」をクリック
   - 検索バーで「Incoming Webhooks」と検索
   - 「Incoming Webhooks」アプリを選択して「Add to Slack」をクリック

3. **Webhook URLを取得**
   - 「Post to Channel」で通知を送信したいチャンネルを選択（例: `#general` または `#support`）
   - 「Add Incoming Webhooks integration」ボタンをクリック
   - 表示された「Webhook URL」をコピー（形式: `https://hooks.slack.com/services/...`）

4. **Webhook URLを保存**
   - コピーしたURLを安全な場所に保存（後でPi5の環境変数に設定します）

### 方法2: Slack APIサイトから作成

1. **Slack APIサイトにアクセス**
   - https://api.slack.com/apps にアクセス
   - 「Sign in to your Slack account」をクリックしてログイン

2. **新しいアプリを作成**
   - 「Create New App」をクリック
   - 「From scratch」を選択
   - アプリ名（例: `Kiosk Support`）とワークスペースを選択して「Create App」をクリック

3. **Incoming Webhooksを有効化**
   - 左サイドバーの「Incoming Webhooks」をクリック
   - 「Activate Incoming Webhooks」をONにする

4. **Webhook URLを追加**
   - ページ下部の「Add New Webhook to Workspace」をクリック
   - 通知を送信したいチャンネルを選択して「Allow」をクリック
   - 表示された「Webhook URL」をコピー

## Pi5側の環境変数設定

Webhook URLを取得したら、Pi5側の環境変数に設定します。

### 手順

1. **Pi5にSSH接続**
   ```bash
   ssh denkon5sd02@100.106.158.2
   ```

2. **`.env`ファイルを編集**
   ```bash
   cd /opt/RaspberryPiSystem_002/infrastructure/docker
   nano .env
   ```

3. **環境変数を追加**
   ```bash
   SLACK_KIOSK_SUPPORT_WEBHOOK_URL=取得したWebhookURLをここに貼り付け
   ```
   （取得したWebhook URLをそのまま貼り付けてください）

4. **保存して終了**
   - `Ctrl+O` → `Enter` → `Ctrl+X`

5. **APIコンテナを再起動**
   ```bash
   docker compose -f docker-compose.server.yml up -d --force-recreate api
   ```

6. **環境変数の確認**
   ```bash
   docker compose -f docker-compose.server.yml exec api env | grep SLACK_KIOSK_SUPPORT_WEBHOOK_URL
   ```

## 動作確認

1. **キオスク画面にアクセス**
   - `https://100.106.158.2/kiosk` にアクセス

2. **お問い合わせを送信**
   - ヘッダーの「お問い合わせ」ボタンをクリック
   - 「よくある困りごと」から1つ選択
   - 「詳細」欄に任意のメッセージを入力（任意）
   - 「送信」ボタンをクリック

3. **Slackチャンネルで確認**
   - 設定したチャンネルに通知が届いていることを確認
   - 通知には以下の情報が含まれます:
     - クライアントID
     - 端末名
     - 場所
     - 画面（ページパス）
     - メッセージ内容
     - Request ID

## トラブルシューティング

### Webhook URLが設定されていない場合

- 環境変数が設定されていない場合、Slack通知はスキップされますが、ログは正常に保存されます
- APIログに警告メッセージが記録されます: `[SlackWebhook] SLACK_KIOSK_SUPPORT_WEBHOOK_URL is not set, skipping notification`

### 通知が届かない場合

1. **環境変数の確認**
   ```bash
   docker compose -f docker-compose.server.yml exec api env | grep SLACK_KIOSK_SUPPORT_WEBHOOK_URL
   ```

2. **APIログの確認**
   ```bash
   docker compose -f docker-compose.server.yml logs api | grep SlackWebhook
   ```

3. **Webhook URLの確認**
   - Slackワークスペースの「Apps」→「Incoming Webhooks」で、Webhookが有効になっているか確認
   - Webhook URLが正しいか確認（`https://hooks.slack.com/services/`で始まる形式であること）

### セキュリティに関する注意事項

- **Webhook URLは機密情報です**: 公開リポジトリにコミットしないでください
- **`.env`ファイルの権限**: 適切な権限（`600`）を設定してください
  ```bash
  chmod 600 /opt/RaspberryPiSystem_002/infrastructure/docker/.env
  ```

## 関連ドキュメント

- [検証チェックリスト - 6.9 キオスクサポート機能](./verification-checklist.md#69-キオスクサポート機能slack通知)
- [デプロイメントガイド](./deployment.md)

