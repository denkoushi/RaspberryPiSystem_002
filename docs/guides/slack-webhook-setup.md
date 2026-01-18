# Slack Webhook URL設定手順

## 概要

Slack通知を4系統（deploy/ops/security/support）に分類するため、各チャンネルのIncoming Webhook URLを取得してAnsible Vaultに設定します。

## 前提条件

- 4つのSlackチャンネルが作成済み（`#rps-deploy`, `#rps-ops`, `#rps-security`, `#rps-support`）
- Slackワークスペースの管理者権限、またはIncoming Webhookを作成する権限があること

## 手順

### 1. 各チャンネルのIncoming Webhook URLを取得

各チャンネルごとに以下の手順を繰り返します：

1. **Slackアプリの設定画面を開く**
   - Slackワークスペースで「設定と管理」→「アプリを管理」を開く
   - または、https://api.slack.com/apps にアクセス

2. **Incoming Webhooksを有効化**
   - 「機能」→「Incoming Webhooks」を選択
   - 「Incoming Webhooksを有効にする」をONにする

3. **Webhookを追加**
   - 「Webhook URLを追加」をクリック
   - 投稿先チャンネルを選択（例: `#rps-deploy`）
   - 「許可」をクリック

4. **Webhook URLをコピー**
   - 生成されたWebhook URL（例: `https://hooks.slack.com/services/TFG0Z5X53/B0A6W3S6468/...`）をコピー
   - **重要**: このURLは機密情報です。他人に共有しないでください

5. **他のチャンネルでも繰り返す**
   - `#rps-ops`, `#rps-security`, `#rps-support` についても同様にWebhook URLを取得

### 2. Ansible VaultにWebhook URLを設定

取得したWebhook URLをAnsible Vaultに設定します：

```bash
# Pi5のvault.ymlを編集
ansible-vault edit infrastructure/ansible/host_vars/raspberrypi5/vault.yml
```

以下の変数に取得したWebhook URLを設定します：

```yaml
# Alerts Dispatcher Slack Webhooks (route-based)
vault_alerts_slack_webhook_deploy: "https://hooks.slack.com/services/..."  # #rps-deployのURL
vault_alerts_slack_webhook_ops: "https://hooks.slack.com/services/..."      # #rps-opsのURL
vault_alerts_slack_webhook_security: "https://hooks.slack.com/services/..." # #rps-securityのURL
vault_alerts_slack_webhook_support: "https://hooks.slack.com/services/..."  # #rps-supportのURL

# キオスクサポート直送もsupportチャンネルへ（既存のGeneralから変更）
vault_slack_kiosk_support_webhook_url: "https://hooks.slack.com/services/..."  # #rps-supportのURL（上記と同じ）
```

**注意**: 
- `vault_slack_kiosk_support_webhook_url` は既存のGeneralチャンネルのWebhook URLが設定されている可能性があります。これを `#rps-support` のWebhook URLに更新してください。
- トークプラザ拠点（`infrastructure/ansible/host_vars/talkplaza-pi5/vault.yml`）も同様に設定が必要です。

### 3. デプロイと検証

Webhook URL設定後、デプロイを実行します：

```bash
./scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml
```

デプロイ後、各routeKeyのテストアラートを生成して、正しいチャンネルに着弾することを確認します：

```bash
# deployチャンネル確認
./scripts/generate-alert.sh ansible-update-failed "テスト: デプロイ失敗" "テスト用メッセージ"

# opsチャンネル確認
./scripts/generate-alert.sh storage-usage-high "テスト: ストレージ使用量警告" "テスト用メッセージ"

# securityチャンネル確認（API経由）
# 管理画面でユーザーのロールを変更すると、role_changeアラートが生成されます

# supportチャンネル確認
./scripts/generate-alert.sh kiosk-support-test "テスト: キオスクサポート" "テスト用メッセージ"
```

### 4. APIコンテナの再起動（環境変数変更を反映）

環境変数が変更されたため、APIコンテナを再起動して設定を反映します：

```bash
# Pi5にSSH接続
ssh denkon5sd02@<Pi5のIP>

# Docker ComposeでAPIコンテナを再起動
cd /opt/RaspberryPiSystem_002
docker compose -f infrastructure/docker/docker-compose.server.yml restart api
```

## トラブルシューティング

### Webhook URLが設定されていない場合

- 未設定（空文字）のrouteKeyのアラートはSlackに送信されません（ファイル生成のみ）
- `infrastructure/docker/.env` を確認して、環境変数が正しく設定されているか確認してください

### アラートが正しいチャンネルに着弾しない場合

1. `infrastructure/docker/.env` で環境変数を確認
2. APIコンテナのログを確認: `docker logs <api-container-name>`
3. `apps/api/src/services/alerts/alerts-config.ts` のルーティング設定を確認

## 関連ドキュメント

- [デプロイガイド](./deployment.md#slack通知のチャンネル分離2026-01-18実装)
- [Alerts Platform Phase2設計](../plans/alerts-platform-phase2.md)
