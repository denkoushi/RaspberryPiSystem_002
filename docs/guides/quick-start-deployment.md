---
title: クイックスタートガイド - 一括更新とクライアント監視
tags: [クイックスタート, デプロイ, 運用]
audience: [運用者]
last-verified: 2025-12-01
related: [production-deployment-management-plan.md, status-agent.md, deployment.md]
category: guides
update-frequency: high
---

# クイックスタートガイド - 一括更新とクライアント監視

最終更新: 2025-12-01

## 概要

本ガイドでは、MacからRaspberry Piクライアントを一括更新し、クライアント状態を監視する方法を5分で説明します。

## 前提条件

- MacからRaspberry Pi 5にSSH接続できること
- Raspberry Pi 5にAnsibleがインストールされていること
- クライアント（Raspberry Pi 3/4）にSSH鍵認証が設定されていること

## クイックスタート

### 1. 全クライアントを一括更新（1コマンド）

**Macのターミナルで実行:**

```bash
# プロジェクトディレクトリに移動
cd /Users/tsudatakashi/RaspberryPiSystem_002

# 環境変数を設定
export RASPI_SERVER_HOST="denkon5sd02@192.168.128.131"

# 一括更新スクリプトを実行
./scripts/update-all-clients.sh
```

**実行結果の確認:**

```
PLAY RECAP *********************************************************************
raspberrypi3               : ok=7    changed=1    unreachable=0    failed=0
raspberrypi4               : ok=7    changed=0    unreachable=0    failed=0
```

- `ok=7`: 全タスクが成功
- `changed=1`: 更新があった（Gitリポジトリの更新、サービスの再起動など）
- `failed=0`: エラーなし

**ログファイルの確認:**

```bash
# 最新のログファイルを確認
ls -lt logs/ansible-update-*.log | head -1
cat logs/ansible-update-YYYYMMDD-HHMMSS.log
```

### 2. クライアント状態を確認（管理画面）

**ブラウザでアクセス:**

```
https://192.168.128.131/admin/clients
```

**表示内容:**

- **クライアント稼働状況カード**: CPU、メモリ、ディスク、温度、最終確認時刻
- **12時間超オフライン**: 12時間以上更新がないクライアントは赤背景で表示
- **クライアント最新ログ**: 各クライアントの最新ログを表示

### 3. クライアントログを検索（管理画面）

**ブラウザでアクセス:**

```
https://192.168.128.131/admin/clients/logs
```

**フィルタリング:**

- **クライアントID**: 特定のクライアントのログのみ表示
- **ログレベル**: DEBUG、INFO、WARN、ERRORでフィルタ
- **件数制限**: 表示件数を指定（デフォルト: 50件）

## よくある操作

### 特定のクライアントのみ更新

**Raspberry Pi 5のターミナルで実行:**

```bash
cd /opt/RaspberryPiSystem_002
ansible-playbook -i infrastructure/ansible/inventory.yml \
  infrastructure/ansible/playbooks/update-clients.yml \
  --limit raspberrypi3
```

### 更新前の状態確認（ドライラン）

**Raspberry Pi 5のターミナルで実行:**

```bash
cd /opt/RaspberryPiSystem_002
ansible-playbook -i infrastructure/ansible/inventory.yml \
  infrastructure/ansible/playbooks/update-clients.yml \
  --check
```

### クライアント状態をAPIで確認

**Macのターミナルで実行:**

```bash
# ログインしてトークンを取得
TOKEN=$(curl -s -X POST http://192.168.128.131:8080/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin1234"}' | jq -r '.accessToken')

# クライアント状態を取得
curl -X GET http://192.168.128.131:8080/api/clients/status \
  -H "Authorization: Bearer $TOKEN" | jq '.'
```

## トラブルシューティング

### 接続エラーが発生する場合

**確認事項:**

1. **SSH接続の確認**:
   ```bash
   # Raspberry Pi 5からクライアントに接続テスト
   ssh tools03@192.168.128.102
   ssh signageras3@192.168.128.152
   ```

2. **インベントリファイルの確認**:
   ```bash
   cat /opt/RaspberryPiSystem_002/infrastructure/ansible/inventory.yml
   ```

3. **Ansible接続テスト**:
   ```bash
   ansible all -i infrastructure/ansible/inventory.yml -m ping
   ```

### 更新が失敗する場合

**確認事項:**

1. **ログファイルの確認**:
   ```bash
   # Macで確認
   cat logs/ansible-update-YYYYMMDD-HHMMSS.log
   ```

2. **クライアントの状態確認**:
   ```bash
   # 管理画面で確認
   https://192.168.128.131/admin/clients
   ```

3. **手動での更新確認**:
   ```bash
   # クライアントに直接接続して確認
   ssh tools03@192.168.128.102
   cd /opt/RaspberryPiSystem_002
   git status
   ```

### クライアント状態が表示されない場合

**確認事項:**

1. **status-agentの動作確認**:
   ```bash
   # クライアントで確認
   systemctl status status-agent.timer
   systemctl status status-agent.service
   ```

2. **APIサーバーの確認**:
   ```bash
   # Raspberry Pi 5で確認
   docker compose -f infrastructure/docker/docker-compose.server.yml logs api | tail -50
   ```

3. **データベースの確認**:
   ```bash
   # Raspberry Pi 5で確認
   docker compose -f infrastructure/docker/docker-compose.server.yml exec db psql -U postgres -d borrow_return -c "SELECT * FROM \"ClientStatus\" ORDER BY \"lastSeen\" DESC LIMIT 10;"
   ```

## 詳細ドキュメント

- **一括更新システムの詳細**: [production-deployment-management-plan.md](../plans/production-deployment-management-plan.md)
- **status-agentの設定**: [status-agent.md](./status-agent.md)
- **デプロイメントガイド**: [deployment.md](./deployment.md)
- **トラブルシューティング**: [knowledge-base/index.md](../knowledge-base/index.md)

## 次のステップ

1. **運用マニュアルを確認**: [operation-manual.md](./operation-manual.md)
2. **監視・アラートを設定**: [monitoring.md](./monitoring.md)
3. **バックアップ・リストア**: [backup-and-restore.md](./backup-and-restore.md)

