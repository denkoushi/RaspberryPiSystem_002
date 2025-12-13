# インシデント対応手順

最終更新: 2025-12-13

## 概要

本ドキュメントでは、Raspberry Piシステムにおけるセキュリティインシデント（侵入、マルウェア検知、不正アクセスなど）発生時の対応手順を定義します。

## インシデントの種類

### 1. 侵入・不正アクセス
- fail2banによるIP Ban検知
- 不正ログイン試行の検知
- 管理画面への未許可IPからのアクセス試行

### 2. マルウェア検知
- ClamAVによるウイルス検知
- Trivyによる脆弱性検知
- rkhunterによるルートキット検知

### 3. サービス停止・異常動作
- APIサーバーの停止
- データベースの異常
- キオスク/サイネージの動作不良

### 4. データ漏洩・改ざん
- データベースの不正変更
- ファイルの改ざん
- バックアップの破損

## 対応フロー

### Phase 1: 初動対応（検知・確認）

#### 1.1 アラートの確認

**確認場所**:
- 管理画面のアラート一覧（`/admin`）
- アラートファイル: `/opt/RaspberryPiSystem_002/alerts/*.json`
- セキュリティログ: `/var/log/fail2ban.log`, `/var/log/clamav/*.log`, `/var/log/trivy/*.log`, `/var/log/rkhunter/*.log`

**確認コマンド**:
```bash
# Pi5にSSH接続
ssh denkon5sd02@192.168.10.230  # ローカルネットワーク経由
# または
ssh denkon5sd02@100.106.158.2   # Tailscale経由（メンテナンス時）

# 最新のアラートを確認
ls -lt /opt/RaspberryPiSystem_002/alerts/ | head -5
cat /opt/RaspberryPiSystem_002/alerts/alert-*.json | jq .

# fail2banのBan状況を確認
sudo fail2ban-client status sshd
sudo fail2ban-client status caddy-http-auth

# 最新のセキュリティログを確認
sudo tail -100 /var/log/fail2ban.log
sudo tail -100 /var/log/clamav/scan.log
sudo tail -100 /var/log/trivy/scan.log
sudo tail -100 /var/log/rkhunter/rkhunter.log
```

#### 1.2 インシデントの分類

**分類基準**:
- **Critical（緊急）**: システム停止、データ漏洩、マルウェア感染が確認された
- **High（高）**: 侵入試行が継続している、サービスが不安定
- **Medium（中）**: 単発の侵入試行、軽微な異常検知
- **Low（低）**: 誤検知の可能性が高い、既知の警告

**判断材料**:
- アラートの種類と頻度
- ログの内容とタイムスタンプ
- システムの稼働状況
- 影響範囲の推定

#### 1.3 影響範囲の確認

**確認項目**:
```bash
# システムの稼働状況を確認
docker ps
docker logs raspberry-pi-system-api-1 --tail 50
docker logs raspberry-pi-system-web-1 --tail 50

# データベースの状態を確認
docker exec raspberry-pi-system-db-1 psql -U postgres -d borrow_return -c "SELECT COUNT(*) FROM \"Loan\";"
docker exec raspberry-pi-system-db-1 psql -U postgres -d borrow_return -c "SELECT COUNT(*) FROM \"Item\";"

# ディスク使用量を確認
df -h
du -sh /opt/RaspberryPiSystem_002/storage/*

# ネットワーク接続を確認
netstat -tuln | grep -E ":(80|443|22|8080)"
sudo ufw status numbered

# プロセスを確認
ps aux | grep -E "(node|python|docker)" | head -20
```

### Phase 2: 封じ込め（影響範囲の限定）

#### 2.1 ネットワークレベルの封じ込め

**fail2banによる自動封じ込め**:
- fail2banが自動的にIPをBanしている場合は、そのまま維持
- 追加でBanが必要な場合は手動でBan

```bash
# 特定IPをBan
sudo fail2ban-client set sshd banip <IPアドレス>
sudo fail2ban-client set caddy-http-auth banip <IPアドレス>

# Banリストを確認
sudo fail2ban-client status sshd
sudo fail2ban-client status caddy-http-auth

# 誤検知の場合は解除
sudo fail2ban-client set sshd unbanip <IPアドレス>
```

**UFWによる手動封じ込め**:
```bash
# 特定IPをブロック
sudo ufw deny from <IPアドレス>

# 特定ポートを一時的に閉じる（緊急時）
sudo ufw deny 22/tcp  # SSH（注意: 接続が切れる可能性あり）
sudo ufw deny 80/tcp  # HTTP
sudo ufw deny 443/tcp # HTTPS

# 設定を確認
sudo ufw status numbered
```

#### 2.2 サービスレベルの封じ込め

**影響を受けたサービスの停止**:
```bash
# APIサーバーを停止（緊急時）
cd /opt/RaspberryPiSystem_002
docker compose -f infrastructure/docker/docker-compose.server.yml stop api

# Webサーバーを停止（緊急時）
docker compose -f infrastructure/docker/docker-compose.server.yml stop web

# 全サービスを停止（最悪の場合）
docker compose -f infrastructure/docker/docker-compose.server.yml down
```

**データベースの読み取り専用化**（データ改ざんが疑われる場合）:
```bash
# PostgreSQLを読み取り専用モードに変更（要設定変更）
# 注意: 通常は実施しない。データベースのバックアップを優先する。
```

#### 2.3 ファイルレベルの封じ込め

**感染が疑われるファイルの隔離**:
```bash
# 隔離ディレクトリを作成
sudo mkdir -p /opt/RaspberryPiSystem_002/quarantine

# 感染が疑われるファイルを移動
sudo mv <疑わしいファイル> /opt/RaspberryPiSystem_002/quarantine/

# ファイルの権限を変更（実行不可）
sudo chmod -x /opt/RaspberryPiSystem_002/quarantine/*
```

### Phase 3: 復旧（システムの正常化）

#### 3.1 マルウェアの除去

**ClamAVによる再スキャン**:
```bash
# フルスキャンを実行
sudo /usr/local/bin/clamav-scan.sh

# 特定ディレクトリをスキャン
sudo clamscan -r --infected /opt/RaspberryPiSystem_002/storage/

# 検知されたファイルを確認
sudo cat /var/log/clamav/scan.log | grep FOUND
```

**Trivyによる脆弱性確認**:
```bash
# ファイルシステムスキャン
sudo /usr/local/bin/trivy-scan.sh

# Dockerイメージスキャン
sudo /usr/local/bin/trivy-image-scan.sh

# 検知された脆弱性を確認
sudo cat /var/log/trivy/scan.log | grep -E "HIGH|CRITICAL"
```

**rkhunterによるルートキット確認**:
```bash
# システムスキャンを実行
sudo /usr/local/bin/rkhunter-scan.sh

# 検知結果を確認
sudo cat /var/log/rkhunter/rkhunter.log | grep -E "Warning|Found"
```

#### 3.2 データベースの復旧

**バックアップからの復元**:
```bash
# 最新の暗号化バックアップを確認
ls -lt /opt/RaspberryPiSystem_002/backups/ | head -5

# バックアップを復号・復元
export BACKUP_DECRYPTION_KEY="your-gpg-key-id"
bash /opt/RaspberryPiSystem_002/scripts/server/restore-encrypted.sh \
  /opt/RaspberryPiSystem_002/backups/backup-YYYYMMDD-HHMMSS.sql.gz.gpg

# 復元後の確認
docker exec raspberry-pi-system-db-1 psql -U postgres -d borrow_return -c "SELECT COUNT(*) FROM \"Loan\";"
```

**オフラインバックアップからの復元**（オンラインバックアップが破損している場合）:
```bash
# USB/HDDがマウントされていることを確認
ls -l /mnt/backup-usb/

# オフラインバックアップから復元
export BACKUP_OFFLINE_MOUNT="/mnt/backup-usb"
export BACKUP_DECRYPTION_KEY="your-gpg-key-id"
bash /opt/RaspberryPiSystem_002/scripts/test/backup-offline-verify.sh
```

#### 3.3 サービスの再起動

**段階的なサービス再起動**:
```bash
cd /opt/RaspberryPiSystem_002

# データベースを起動
docker compose -f infrastructure/docker/docker-compose.server.yml up -d db

# データベースの起動を確認
docker exec raspberry-pi-system-db-1 pg_isready -U postgres

# APIサーバーを起動
docker compose -f infrastructure/docker/docker-compose.server.yml up -d api

# APIサーバーの起動を確認
curl -k https://localhost/api/system/health

# Webサーバーを起動
docker compose -f infrastructure/docker/docker-compose.server.yml up -d web

# Webサーバーの起動を確認
curl -kI https://localhost/
```

#### 3.4 動作確認

**機能確認**:
```bash
# APIのヘルスチェック
curl -k https://localhost/api/system/health

# 管理画面へのアクセス確認
curl -kI https://localhost/admin

# キオスクへのアクセス確認
curl -kI https://localhost/kiosk

# データベースの整合性確認
docker exec raspberry-pi-system-db-1 psql -U postgres -d borrow_return -c "
  SELECT 
    (SELECT COUNT(*) FROM \"Loan\" WHERE \"returnedAt\" IS NULL) as active_loans,
    (SELECT COUNT(*) FROM \"Item\") as total_items,
    (SELECT COUNT(*) FROM \"Employee\") as total_employees;
"
```

### Phase 4: 事後対応（原因分析・再発防止）

#### 4.1 ログの収集と分析

**ログの収集**:
```bash
# インシデント発生時刻前後のログを収集
INCIDENT_TIME="2025-12-13 14:00:00"  # インシデント発生時刻に置き換え

# fail2banログ
sudo grep "$INCIDENT_TIME" /var/log/fail2ban.log > /tmp/incident-fail2ban.log

# Caddyアクセスログ
sudo grep "$INCIDENT_TIME" /var/log/caddy/access.log > /tmp/incident-caddy.log

# Dockerログ
docker logs raspberry-pi-system-api-1 --since "$INCIDENT_TIME" > /tmp/incident-api.log
docker logs raspberry-pi-system-web-1 --since "$INCIDENT_TIME" > /tmp/incident-web.log

# システムログ
sudo journalctl --since "$INCIDENT_TIME" > /tmp/incident-system.log
```

**ログの分析**:
- 侵入経路の特定（どのポート、どのIPから）
- 攻撃手法の特定（ブルートフォース、SQLインジェクション、XSSなど）
- 影響範囲の特定（どのデータ、どのサービスが影響を受けた）

#### 4.2 原因の特定

**確認項目**:
- 脆弱性の有無（Trivyスキャン結果）
- 設定ミス（UFW、fail2ban、Caddy設定）
- パスワードの強度（JWTシークレット、データベースパスワード）
- アクセス制御の不備（IP制限、認証・認可）

#### 4.3 再発防止策の実施

**実施項目**:
- 脆弱性の修正（パッチ適用、依存関係の更新）
- 設定の強化（UFW、fail2ban、Caddy設定の見直し）
- パスワードの変更（JWTシークレット、データベースパスワード）
- アクセス制御の強化（IP制限の追加、認証・認可の見直し）
- 監視の強化（アラート閾値の調整、監視項目の追加）

#### 4.4 ドキュメントの更新

**更新項目**:
- インシデントレポートの作成
- ナレッジベースへの記録（`docs/knowledge-base/infrastructure.md`）
- 運用手順の更新（必要に応じて）

## 演習計画

### 年次演習（推奨）

**実施時期**: 年1回（例: 年末またはシステム更新時）

**演習シナリオ**:
1. **シナリオ1: ブルートフォース攻撃**
   - 架空IPからSSHログイン試行を模擬
   - fail2banによる自動Banを確認
   - アラート生成を確認

2. **シナリオ2: マルウェア検知**
   - テスト用のEICARファイルを配置
   - ClamAVによる検知を確認
   - アラート生成と隔離手順を確認

3. **シナリオ3: データベース復旧**
   - バックアップからの復元手順を実施
   - 復元後の整合性確認を実施

**演習の記録**:
- 実施日時
- 実施者
- 所要時間
- 発見された問題点
- 改善提案

## 緊急連絡先

### システム管理者
- **連絡先**: [管理者の連絡先を記載]
- **対応時間**: [対応可能時間を記載]

### 外部サポート（必要に応じて）
- **セキュリティベンダー**: [ベンダー名・連絡先を記載]
- **クラウドプロバイダー**: [プロバイダー名・連絡先を記載]

## 参考資料

- [セキュリティ要件定義](./requirements.md)
- [セキュリティ実装評価](./implementation-assessment.md)
- [セキュリティ検証レビュー](./validation-review.md)
- [セキュリティ強化ExecPlan](../plans/security-hardening-execplan.md)
- [デプロイメントガイド](../guides/deployment.md)
- [バックアップ・復元ガイド](../guides/backup-and-restore.md)
