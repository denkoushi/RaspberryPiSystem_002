---
title: 運用マニュアル
tags: [運用, マニュアル, 日常運用, トラブルシューティング, メンテナンス]
audience: [運用者, 管理者]
last-verified: 2025-12-01
related: [deployment.md, monitoring.md, backup-and-restore.md, ../knowledge-base/index.md]
category: guides
update-frequency: medium
---

# 運用マニュアル

## 概要

本ドキュメントでは、Raspberry Pi NFC 持出返却システムの日常的な運用、トラブル時の対応、定期メンテナンスの手順を説明します。

## 目次

1. [日常的な運用手順](#日常的な運用手順)
2. [クライアント一括更新](#クライアント一括更新)
3. [クライアント状態監視](#クライアント状態監視)
4. [トラブル時の対応手順](#トラブル時の対応手順)
5. [定期メンテナンス手順](#定期メンテナンス手順)
6. [緊急時の対応](#緊急時の対応)

---

## 日常的な運用手順

### システム起動確認

#### サーバー側（Raspberry Pi 5）

```bash
# ラズパイ5で実行
cd /opt/RaspberryPiSystem_002

# Dockerコンテナの状態確認
docker compose -f infrastructure/docker/docker-compose.server.yml ps

# 期待される出力:
# NAME           STATUS         PORTS
# docker-api-1   Up X minutes   0.0.0.0:8080->8080/tcp
# docker-db-1    Up X minutes   0.0.0.0:5432->5432/tcp
# docker-web-1   Up X minutes   0.0.0.0:4173->80/tcp
```

**確認ポイント**:
- すべてのコンテナが`Up`状態であること
- ポートが正しく公開されていること

#### クライアント側（Raspberry Pi 4）

```bash
# ラズパイ4で実行
# NFCエージェントの状態確認
curl http://localhost:7071/api/agent/status | jq

# 期待される出力:
# {
#   "readerConnected": true,
#   "message": "監視中",
#   "lastError": null,
#   "queueSize": 0
# }
```

**確認ポイント**:
- `readerConnected`が`true`であること
- `queueSize`が`0`であること（オフライン時のキューが空であること）

### ヘルスチェック

#### APIヘルスチェック

```bash
# ラズパイ5で実行
curl http://localhost:8080/api/system/health | jq

# 期待される出力:
# {
#   "status": "ok",
#   "timestamp": "2025-11-27T00:00:00.000Z",
#   "checks": {
#     "database": { "status": "ok" },
#     "memory": { "status": "ok" }
#   }
# }
```

**確認ポイント**:
- `status`が`"ok"`であること
- `checks.database.status`が`"ok"`であること
- `checks.memory.status`が`"ok"`であること（警告の場合は`"warning"`も可）

#### メトリクス確認

```bash
# ラズパイ5で実行
curl http://localhost:8080/api/system/metrics | grep -E "loans_active_total|employees_active_total|items_active_total"

# 期待される出力:
# loans_active_total 0
# employees_active_total 2
# items_active_total 3
```

### ログ確認

#### APIログ

```bash
# ラズパイ5で実行
docker compose -f infrastructure/docker/docker-compose.server.yml logs --tail=50 api
```

#### データベースログ

```bash
# ラズパイ5で実行
docker compose -f infrastructure/docker/docker-compose.server.yml logs --tail=50 db
```

#### Webサーバーログ

```bash
# ラズパイ5で実行
docker compose -f infrastructure/docker/docker-compose.server.yml logs --tail=50 web
```

---

## クライアント一括更新

### Macから全クライアントを更新

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

- `ok=7`: 全タスクが成功
- `changed=1`: 更新があった（Gitリポジトリの更新、サービスの再起動など）
- `failed=0`: エラーなし

**ログファイルの確認:**

```bash
# 最新のログファイルを確認
ls -lt logs/ansible-update-*.log | head -1
cat logs/ansible-update-YYYYMMDD-HHMMSS.log
```

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

### 更新頻度の推奨

- **日常的な更新**: 必要に応じて（コード変更時）
- **定期更新**: 週次または月次（セキュリティパッチ適用時）

詳細は [クイックスタートガイド](./quick-start-deployment.md) を参照してください。

---

## クライアント状態監視

### 管理画面での確認

**ブラウザでアクセス:**

```
https://192.168.128.131/admin/clients
```

**表示内容:**

- **クライアント稼働状況カード**: CPU、メモリ、ディスク、温度、最終確認時刻
- **12時間超オフライン**: 12時間以上更新がないクライアントは赤背景で表示
- **クライアント最新ログ**: 各クライアントの最新ログを表示

### クライアントログの検索

**ブラウザでアクセス:**

```
https://192.168.128.131/admin/clients/logs
```

**フィルタリング:**

- **クライアントID**: 特定のクライアントのログのみ表示
- **ログレベル**: DEBUG、INFO、WARN、ERRORでフィルタ
- **件数制限**: 表示件数を指定（デフォルト: 50件）

### APIでの確認

**Macのターミナルで実行:**

```bash
# ログインしてトークンを取得
TOKEN=$(curl -s -X POST http://192.168.128.131:8080/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin1234"}' | jq -r '.accessToken')

# クライアント状態を取得
curl -X GET http://192.168.128.131:8080/api/clients/status \
  -H "Authorization: Bearer $TOKEN" | jq '.'

# クライアントログを取得
curl -X GET "http://192.168.128.131:8080/api/clients/logs?clientId=raspberrypi5-server&limit=10" \
  -H "Authorization: Bearer $TOKEN" | jq '.'
```

### status-agentの状態確認

**クライアント（Raspberry Pi 3/4）で実行:**

```bash
# status-agentのタイマー状態確認
systemctl status status-agent.timer

# status-agentのサービス状態確認
systemctl status status-agent.service

# 最新の実行ログ確認
journalctl -u status-agent.service -n 20 --no-pager
```

### 監視の推奨頻度

- **日常的な確認**: 1日1回（管理画面で確認）
- **異常検知**: 12時間以上更新がないクライアントを確認
- **ログ確認**: エラーが発生した場合に確認

詳細は [status-agentガイド](./status-agent.md) を参照してください。

---

## トラブル時の対応手順

### 問題の特定

#### 1. システム全体の状態確認

```bash
# ラズパイ5で実行
cd /opt/RaspberryPiSystem_002

# 監視スクリプトを実行
./scripts/server/monitor.sh
```

**確認項目**:
- APIヘルスチェック
- Dockerコンテナの状態
- ディスク使用量
- メモリ使用量

#### 2. エラーログの確認

```bash
# ラズパイ5で実行
# APIエラーログを確認
docker compose -f infrastructure/docker/docker-compose.server.yml logs api | grep -i error

# データベースエラーログを確認
docker compose -f infrastructure/docker/docker-compose.server.yml logs db | grep -i error
```

### よくある問題と対応

#### 問題1: APIが応答しない

**症状**: 
- `curl http://localhost:8080/api/system/health`がタイムアウト
- Web UIが表示されない

**対応手順**:

1. **コンテナの状態確認**
   ```bash
   docker compose -f infrastructure/docker/docker-compose.server.yml ps api
   ```

2. **コンテナの再起動**
   ```bash
   docker compose -f infrastructure/docker/docker-compose.server.yml restart api
   ```

3. **ログ確認**
   ```bash
   docker compose -f infrastructure/docker/docker-compose.server.yml logs api --tail=100
   ```

4. **再起動しても解決しない場合**: コンテナを再作成
   ```bash
   docker compose -f infrastructure/docker/docker-compose.server.yml up -d --force-recreate api
   ```

**関連ナレッジ**: [KB-001](../knowledge-base/api.md#kb-001-429エラーレート制限エラーが発生する), [KB-002](../knowledge-base/api.md#kb-002-404エラーが発生する)

#### 問題2: データベース接続エラー

**症状**:
- APIヘルスチェックで`database.status`が`"error"`
- データが表示されない

**対応手順**:

1. **データベースコンテナの状態確認**
   ```bash
   docker compose -f infrastructure/docker/docker-compose.server.yml ps db
   ```

2. **データベースコンテナの再起動**
   ```bash
   docker compose -f infrastructure/docker/docker-compose.server.yml restart db
   ```

3. **データベース接続確認**
   ```bash
   docker compose -f infrastructure/docker/docker-compose.server.yml exec db \
     psql -U postgres -d borrow_return -c "SELECT 1;"
   ```

4. **再起動しても解決しない場合**: データベースボリュームの確認
   ```bash
   docker volume ls | grep db-data
   docker volume inspect docker_db-data
   ```

**関連ナレッジ**: [KB-003](../knowledge-base/database.md#kb-003-p2002エラーnfctaguidの重複が発生する)

#### 問題3: NFCリーダーが動作しない

**症状**:
- NFCエージェントの`readerConnected`が`false`
- NFCカードをかざしても反応しない

**対応手順**:

1. **NFCエージェントの状態確認**
   ```bash
   # ラズパイ4で実行
   curl http://localhost:7071/api/agent/status | jq
   ```

2. **PC/SCデーモンの確認**
   ```bash
   # ラズパイ4で実行
   systemctl status pcscd
   ```

3. **PC/SCデーモンの再起動**
   ```bash
   # ラズパイ4で実行
   sudo systemctl restart pcscd
   ```

4. **NFCリーダーの検出確認**
   ```bash
   # ラズパイ4で実行
   pcsc_scan
   ```

5. **NFCエージェントの再起動**
   ```bash
   # ラズパイ4で実行
   cd /opt/RaspberryPiSystem_002/clients/nfc-agent
   poetry run python -m nfc_agent
   ```

**関連ナレッジ**: [NFCリーダーの問題](../troubleshooting/nfc-reader-issues.md)

#### 問題5: クライアント一括更新が失敗する

**症状**:
- Ansibleプレイブックの実行が失敗する
- 特定のクライアントに接続できない

**対応手順**:

1. **SSH接続の確認**
   ```bash
   # Raspberry Pi 5からクライアントに接続テスト
   ssh tools03@192.168.128.102
   ssh signageras3@192.168.128.152
   ```

2. **インベントリファイルの確認**
   ```bash
   # Raspberry Pi 5で確認
   cat /opt/RaspberryPiSystem_002/infrastructure/ansible/inventory.yml
   ```

3. **Ansible接続テスト**
   ```bash
   # Raspberry Pi 5で実行
   cd /opt/RaspberryPiSystem_002
   ansible all -i infrastructure/ansible/inventory.yml -m ping
   ```

4. **ログファイルの確認**
   ```bash
   # Macで確認
   cat logs/ansible-update-YYYYMMDD-HHMMSS.log
   ```

**関連ナレッジ**: [KB-058](../knowledge-base/infrastructure.md#kb-058-ansible接続設定でraspberry-pi-34への接続に失敗する問題ユーザー名ssh鍵サービス存在確認)

#### 問題6: クライアント状態が表示されない

**症状**:
- 管理画面でクライアント状態が表示されない
- status-agentが動作していない

**対応手順**:

1. **status-agentの状態確認**
   ```bash
   # クライアントで確認
   systemctl status status-agent.timer
   systemctl status status-agent.service
   ```

2. **status-agentの再起動**
   ```bash
   # クライアントで実行
   sudo systemctl restart status-agent.timer
   sudo systemctl restart status-agent.service
   ```

3. **APIサーバーの確認**
   ```bash
   # Raspberry Pi 5で確認
   docker compose -f infrastructure/docker/docker-compose.server.yml logs api | tail -50
   ```

4. **データベースの確認**
   ```bash
   # Raspberry Pi 5で確認
   docker compose -f infrastructure/docker/docker-compose.server.yml exec db \
     psql -U postgres -d borrow_return -c "SELECT * FROM \"ClientStatus\" ORDER BY \"lastSeen\" DESC LIMIT 10;"
   ```

**関連ナレッジ**: [status-agentガイド](./status-agent.md)

#### 問題4: ディスク容量不足

**症状**:
- 監視スクリプトでディスク使用量が80%超
- バックアップが失敗する

**対応手順**:

1. **ディスク使用量の確認**
   ```bash
   df -h
   ```

2. **古いバックアップファイルの削除**
   ```bash
   # ラズパイ5で実行
   ls -lh /opt/backups/
   # 30日以上古いバックアップを削除（例）
   find /opt/backups/ -name "*.sql.gz" -mtime +30 -delete
   find /opt/backups/ -name "*.env" -mtime +30 -delete
   ```

3. **Dockerイメージ・コンテナのクリーンアップ**
   ```bash
   # 使用していないDockerリソースを削除
   docker system prune -a --volumes
   ```

4. **ログファイルのクリーンアップ**
   ```bash
   # Dockerログのローテーション設定確認
   docker compose -f infrastructure/docker/docker-compose.server.yml config | grep logging
   ```

### トラブルシューティングナレッジベース

詳細なトラブルシューティング情報は、[ナレッジベース索引](../knowledge-base/index.md)を参照してください。

**主要カテゴリ**:
- [API関連](../knowledge-base/api.md): APIエラー、レート制限、認証問題
- [データベース関連](../knowledge-base/database.md): P2002エラー、削除機能、シードデータ
- [CI/CD関連](../knowledge-base/ci-cd.md): CIテスト失敗、E2Eテスト問題
- [フロントエンド関連](../knowledge-base/frontend.md): キオスク接続、XState問題
- [インフラ関連](../knowledge-base/infrastructure.md): Docker、Caddy、オフライン耐性

---

## 定期メンテナンス手順

### 日次メンテナンス

#### 1. システム状態の確認

```bash
# ラズパイ5で実行
cd /opt/RaspberryPiSystem_002
./scripts/server/monitor.sh
```

**確認項目**:
- APIヘルスチェック
- Dockerコンテナの状態
- ディスク使用量
- メモリ使用量

#### 2. ログの確認

```bash
# ラズパイ5で実行
# エラーログの確認
docker compose -f infrastructure/docker/docker-compose.server.yml logs --since 24h api | grep -i error
```

### 週次メンテナンス

#### 1. バックアップの実行

```bash
# ラズパイ5で実行
cd /opt/RaspberryPiSystem_002
./scripts/server/backup.sh
```

**確認項目**:
- バックアップファイルが正常に作成されたこと
- バックアップファイルのサイズが適切であること

詳細は [バックアップ・リストア手順](./backup-and-restore.md) を参照してください。

#### 2. データベースの整合性確認

```bash
# ラズパイ5で実行
docker compose -f infrastructure/docker/docker-compose.server.yml exec db \
  psql -U postgres -d borrow_return -c "
    SELECT 
      (SELECT COUNT(*) FROM \"Employee\") as employees,
      (SELECT COUNT(*) FROM \"Item\") as items,
      (SELECT COUNT(*) FROM \"Loan\" WHERE \"returnedAt\" IS NULL) as active_loans,
      (SELECT COUNT(*) FROM \"Transaction\") as transactions;
  "
```

**確認項目**:
- データの件数が異常でないこと
- 未返却の貸出が適切な件数であること

### 月次メンテナンス

#### 1. システム更新

```bash
# ラズパイ5で実行
cd /opt/RaspberryPiSystem_002

# 最新のコードを取得
git fetch origin
git pull origin main

# 依存関係の更新
pnpm install

# Dockerイメージの再ビルド
docker compose -f infrastructure/docker/docker-compose.server.yml build --pull

# コンテナの再起動
docker compose -f infrastructure/docker/docker-compose.server.yml up -d --force-recreate
```

**注意**: 本番環境では、メンテナンス時間を設けて実施してください。

#### 2. 古いバックアップの整理

```bash
# ラズパイ5で実行
# 90日以上古いバックアップを削除
find /opt/backups/ -name "*.sql.gz" -mtime +90 -delete
find /opt/backups/ -name "*.env" -mtime +90 -delete
```

#### 3. ログファイルのローテーション

```bash
# ラズパイ5で実行
# Dockerログの確認
docker compose -f infrastructure/docker/docker-compose.server.yml logs --since 30d | wc -l

# 必要に応じてログをクリア（注意: 本番環境では慎重に）
# docker compose -f infrastructure/docker/docker-compose.server.yml logs --since 1d > /tmp/recent-logs.txt
```

### 四半期メンテナンス

#### 1. データベースの最適化

```bash
# ラズパイ5で実行
docker compose -f infrastructure/docker/docker-compose.server.yml exec db \
  psql -U postgres -d borrow_return -c "VACUUM ANALYZE;"
```

#### 2. システム全体の再起動

```bash
# ラズパイ5で実行
cd /opt/RaspberryPiSystem_002

# コンテナの停止
docker compose -f infrastructure/docker/docker-compose.server.yml down

# システム再起動（必要に応じて）
# sudo reboot

# 再起動後、コンテナの起動確認
docker compose -f infrastructure/docker/docker-compose.server.yml up -d
```

---

## 緊急時の対応

### システム全体が停止した場合

#### 1. 緊急復旧手順

```bash
# ラズパイ5で実行
cd /opt/RaspberryPiSystem_002

# すべてのコンテナを停止
docker compose -f infrastructure/docker/docker-compose.server.yml down

# コンテナを再起動
docker compose -f infrastructure/docker/docker-compose.server.yml up -d

# 状態確認
docker compose -f infrastructure/docker/docker-compose.server.yml ps
```

#### 2. データベースの復旧

データベースが破損した場合、最新のバックアップから復旧します。

```bash
# ラズパイ5で実行
cd /opt/RaspberryPiSystem_002

# 最新のバックアップファイルを確認
ls -lt /opt/backups/ | head -5

# バックアップから復旧（最新のバックアップファイルを指定）
BACKUP_FILE="/opt/backups/db_backup_YYYYMMDD_HHMMSS.sql.gz"
./scripts/server/restore.sh
```

詳細は [バックアップ・リストア手順](./backup-and-restore.md) を参照してください。

### データ損失が発生した場合

1. **最新のバックアップを確認**
2. **バックアップから復旧**
3. **データ損失の範囲を特定**
4. **必要に応じて手動でデータを補完**

### セキュリティインシデント

1. **影響範囲の特定**
2. **該当コンテナの停止**
3. **ログの確認と証拠保全**
4. **必要に応じてシステムの再構築**

---

## 関連ドキュメント

- [クイックスタートガイド](./quick-start-deployment.md): 一括更新とクライアント監視のクイックスタート
- [デプロイメントガイド](./deployment.md)
- [監視・アラートガイド](./monitoring.md)
- [バックアップ・リストア手順](./backup-and-restore.md)
- [status-agentガイド](./status-agent.md): クライアント状態送信エージェントの設定
- [一括更新システムの詳細](../plans/production-deployment-management-plan.md)
- [トラブルシューティングナレッジベース](../knowledge-base/index.md)
- [インフラ基盤](../architecture/infrastructure-base.md)

---

## 更新履歴

- 2025-11-27: 初版作成
- 2025-12-01: クライアント一括更新とクライアント状態監視のセクションを追加

