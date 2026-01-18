---
title: ローカル環境対応の通知機能ガイド
tags: [通知, アラート, ローカル環境]
audience: [運用者, 開発者]
last-verified: 2025-12-01
related: [quick-start-deployment.md, operation-manual.md]
category: guides
update-frequency: medium
---

# ローカル環境対応の通知機能ガイド

最終更新: 2025-12-01

## 概要

本ガイドでは、ローカル環境（インターネット接続なし）で動作する通知機能について説明します。この機能により、クライアントの異常やAnsible更新の失敗を管理画面で確認できます。

## 重要な考え方（B1: Slackは通知、alertsは一次情報）

- **一次情報**: `alerts/alert-*.json`（管理画面で確認できる永続イベント）
- **二次経路（通知）**: Slack（チャンネル分離を含む）

このプロジェクトでは、**scriptsはalertsファイル生成に専念**し、**Slackへの配送はAPI側のAlerts Dispatcherが担当**する方針（B1）で設計します。

### Slack配送を有効化する（API Alerts Dispatcher）

Slackに通知したい場合は、APIコンテナに以下を設定します（Webhook URLはIncoming Webhookを使用）：

- `ALERTS_DISPATCHER_ENABLED=true`
- `ALERTS_SLACK_WEBHOOK_DEPLOY`（デプロイ通知）
- `ALERTS_SLACK_WEBHOOK_OPS`（運用/監視通知）
- `ALERTS_SLACK_WEBHOOK_SUPPORT`（サポート通知）
- `ALERTS_SLACK_WEBHOOK_SECURITY`（セキュリティ通知）

任意で設定（チューニング）:

- `ALERTS_DISPATCHER_INTERVAL_SECONDS`（既定: 30）
- `ALERTS_DISPATCHER_MAX_ATTEMPTS`（既定: 5）
- `ALERTS_DISPATCHER_RETRY_DELAY_SECONDS`（既定: 60）
- `ALERTS_DISPATCHER_WEBHOOK_TIMEOUT_MS`（既定: 5000）

さらに、JSON設定ファイルでまとめて管理する場合は `ALERTS_CONFIG_PATH=/opt/RaspberryPiSystem_002/config/alerts.json` を指定します（Webhook URLなど機密情報はAnsible Vaultで管理すること）。

## 通知の種類

### 1. クライアント状態アラート

**検出条件**:
- クライアントが12時間以上オフライン（`stale`フラグ）
- 過去24時間以内にエラーログが検出された

**表示場所**:
- 管理画面のダッシュボード（`/admin`）
- クライアント管理画面（`/admin/clients`）

### 2. ファイルベースのアラート

**検出条件**:
- Ansible更新スクリプトが失敗した場合
- ストレージ使用量が80%または90%を超えた場合（`storage-usage-high`）
- ストレージメンテナンスが失敗した場合（`storage-maintenance-failed`）
- 手動でアラートファイルを生成した場合

**アラートタイプ**:
- `ansible-update-failed`: Ansible更新スクリプトの失敗
- `storage-usage-high`: ディスク使用量が閾値を超えた場合（`monitor.sh`が生成）
- `storage-maintenance-failed`: ストレージメンテナンススクリプトの失敗（`storage-maintenance.sh`が生成）

**表示場所**:
- 管理画面のダッシュボード（`/admin`）

## 使用方法

### 管理画面での確認

**ブラウザでアクセス:**

```
https://192.168.128.131/admin
```

**アラートバナーの表示**:

- **オフラインクライアント**: 12時間以上更新がないクライアントの数
- **エラーログ**: 過去24時間以内のエラーログの件数
- **ファイルベースのアラート**: Ansible更新失敗などの通知

### アラートの確認済み処理

**ファイルベースのアラートを確認済みにする**:

1. ダッシュボードのアラートバナーで「確認済み」ボタンをクリック
2. アラートが確認済みとしてマークされ、表示から消えます

**注意**: クライアント状態アラート（オフライン、エラーログ）は自動的に更新されるため、確認済み処理は不要です。

### 手動でアラートを生成

**スクリプトを使用:**

```bash
# アラートファイルを生成
./scripts/generate-alert.sh <タイプ> <メッセージ> [詳細]

# 例: Ansible更新失敗
./scripts/generate-alert.sh \
  "ansible-update-failed" \
  "Ansible更新が失敗しました" \
  "ログファイル: logs/ansible-update-20251201-103259.log"
```

**アラートファイルの場所**:
- `alerts/alert-YYYYMMDD-HHMMSS.json`

**アラートファイルの形式**:
```json
{
  "id": "20251201-103259",
  "type": "ansible-update-failed",
  "message": "Ansible更新が失敗しました",
  "details": "ログファイル: logs/ansible-update-20251201-103259.log",
  "timestamp": "2025-12-01T10:32:59Z",
  "acknowledged": false
}
```

## APIでの確認

**アラート情報を取得:**

```bash
# ログインしてトークンを取得
TOKEN=$(curl -s -X POST http://192.168.128.131:8080/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin1234"}' | jq -r '.accessToken')

# アラート情報を取得
curl -X GET http://192.168.128.131:8080/api/clients/alerts \
  -H "Authorization: Bearer $TOKEN" | jq '.'
```

**アラートを確認済みにする:**

```bash
# アラートIDを指定して確認済みにする
curl -X POST http://192.168.128.131:8080/api/clients/alerts/20251201-103259/acknowledge \
  -H "Authorization: Bearer $TOKEN"
```

## アラートの自動生成

### Ansible更新失敗時

`scripts/update-all-clients.sh`が失敗した場合、自動的にアラートファイルが生成されます：

```bash
# 更新スクリプトを実行
# inventory指定が必須（誤デプロイ防止）
# 第2工場（既存）
./scripts/update-all-clients.sh main infrastructure/ansible/inventory.yml

# トークプラザ（新拠点）
./scripts/update-all-clients.sh main infrastructure/ansible/inventory-talkplaza.yml

# 失敗した場合、自動的にアラートファイルが生成される
# alerts/alert-YYYYMMDD-HHMMSS.json
```

### カスタムアラートの生成

**シェルスクリプトから:**

```bash
# アラートスクリプトを呼び出す
./scripts/generate-alert.sh "custom-alert" "カスタムメッセージ" "詳細情報"
```

**Pythonスクリプトから:**

```python
import subprocess
import sys

subprocess.run([
    sys.executable,
    "scripts/generate-alert.sh",
    "python-alert",
    "Pythonスクリプトからのアラート",
    "詳細情報"
])
```

## アラートファイルの管理

### 古いアラートファイルの削除

**30日以上古いアラートファイルを削除:**

```bash
# Macで実行
find alerts/ -name "alert-*.json" -mtime +30 -delete

# Raspberry Pi 5で実行
find /opt/RaspberryPiSystem_002/alerts/ -name "alert-*.json" -mtime +30 -delete
```

### アラートファイルの確認

**最新のアラートファイルを確認:**

```bash
# Macで実行
ls -lt alerts/alert-*.json | head -5

# アラートファイルの内容を確認
cat alerts/alert-YYYYMMDD-HHMMSS.json | jq '.'
```

## ベストプラクティス

### 1. アラートの確認頻度

- **日常的な確認**: 1日1回（管理画面で確認）
- **緊急時の確認**: 問題発生時（アラートバナーで確認）

### 2. アラートの対応

1. **アラートを確認**: 管理画面でアラートの詳細を確認
2. **原因を特定**: ログファイルやクライアント状態を確認
3. **対応を実施**: 問題を解決
4. **確認済みにする**: ファイルベースのアラートは確認済みにする

### 3. アラートファイルの整理

- **定期的な削除**: 30日以上古いアラートファイルを削除
- **確認済みアラート**: 確認済みのアラートは自動的に表示されない

## トラブルシューティング

### アラートが表示されない場合

**確認事項**:

1. **APIサーバーの確認**:
   ```bash
   docker compose -f infrastructure/docker/docker-compose.server.yml logs api | tail -50
   ```

2. **アラートディレクトリの確認**:
   ```bash
   ls -la alerts/
   ```

3. **データベースの確認**:
   ```bash
   docker compose -f infrastructure/docker/docker-compose.server.yml exec db \
     psql -U postgres -d borrow_return -c "SELECT * FROM \"ClientStatus\" ORDER BY \"lastSeen\" DESC LIMIT 10;"
   ```

### アラートファイルが生成されない場合

**確認事項**:

1. **スクリプトの実行権限**:
   ```bash
   ls -l scripts/generate-alert.sh
   chmod +x scripts/generate-alert.sh
   ```

2. **ディレクトリの作成**:
   ```bash
   mkdir -p alerts/
   ```

3. **スクリプトの実行テスト**:
   ```bash
   ./scripts/generate-alert.sh "test" "テストアラート" "テスト詳細"
   ls -la alerts/
   ```

## 関連ドキュメント

- [クイックスタートガイド](./quick-start-deployment.md)
- [運用マニュアル](./operation-manual.md)
- [Ansibleエラーハンドリングガイド](./ansible-error-handling.md)

