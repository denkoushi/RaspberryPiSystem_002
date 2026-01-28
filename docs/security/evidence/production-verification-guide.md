# 実機検証実行ガイド（Pi5本番）

最終更新: 2026-01-28

## 概要

本ガイドは、セキュリティ評価の実機検証をPi5本番環境で実施するための手順です。

## 前提条件

- Pi5へのSSH接続が可能（Tailscale経由またはローカルネットワーク経由）
- sudo権限がある
- Docker Composeが動作している
- バックアップスクリプトが利用可能

## 実行方法

### 方法1: 自動スクリプト実行（推奨）

```bash
# Pi5にSSH接続
ssh <pi5-user>@<pi5-ip>

# プロジェクトディレクトリに移動
cd /opt/RaspberryPiSystem_002

# スクリプトを実行（sudoが必要）
sudo ./scripts/security/verify-production-security.sh
```

### 方法2: 手動実行

手動で実行する場合は、[ops-verification-runbook.md](./ops-verification-runbook.md) を参照してください。

## 実行内容

スクリプトは以下の検証を自動実行します：

1. **ポート露出の確認**
   - `ss -H -tulpen` でLISTENポートを確認
   - `ufw status verbose` でファイアウォール設定を確認
   - `docker compose ps` でコンテナのポートマッピングを確認

2. **fail2ban監視の確認**
   - fail2banの状態確認
   - テストIPをBanしてアラート生成を確認
   - 15分待機（実際の検証では、security-monitor.timerの実行間隔）

3. **security-monitor / マルウェアスキャンの確認**
   - security-monitor.shの実行
   - ClamAV/Trivy/rkhunterスキャンの実行
   - アラートファイルの生成確認

4. **バックアップ/復元の実効性確認**
   - 暗号化バックアップの実行
   - 検証用DBへのリストア
   - データの整合性確認

5. **USBオフライン運用の検証**（USB接続時のみ）
   - USBデバイスの検出
   - バックアップファイルのコピー/削除/復元
   - リストアテスト

## 証跡の保存先

すべての証跡は以下のディレクトリに保存されます：

```
/opt/RaspberryPiSystem_002/docs/security/evidence/
```

命名規則: `YYYYMMDD-HHMM_prod_<category>_<detail>.txt`

例:
- `20260128-2130_prod_ports_status.txt`
- `20260128-2130_prod_ops_fail2ban.txt`
- `20260128-2130_prod_ops_monitor.txt`
- `20260128-2130_prod_backup_restore.txt`
- `20260128-2130_prod_usb_restore.txt`

## 実行後の確認事項

1. **証跡ファイルの確認**
   ```bash
   ls -lh /opt/RaspberryPiSystem_002/docs/security/evidence/20260128-*_prod_*.txt
   ```

2. **エラーの有無確認**
   - 各証跡ファイルにエラーメッセージがないか確認
   - 特にバックアップ/復元、USBオフライン運用の結果を確認

3. **評価報告書の更新**
   - 証跡を基に `docs/security/evaluation-report.md` の「実機検証結果」セクションを更新
   - ギャップ一覧・トップリスク10を更新（必要に応じて）

## 注意事項

- **本番環境への影響**: スクリプトは検証用DBを作成・削除しますが、本番データには影響しません
- **USBオフライン運用**: USBデバイスが接続されていない場合はスキップされます
- **fail2ban検証**: テストIPをBanしますが、すぐに解除されます
- **バックアップ**: 既存のバックアップファイルは削除されません（USB検証時のみ一時的に削除）

## トラブルシューティング

### スクリプトが実行できない

```bash
# 実行権限を確認
ls -l scripts/security/verify-production-security.sh

# 実行権限を付与
chmod +x scripts/security/verify-production-security.sh
```

### Docker Composeが見つからない

```bash
# Docker Composeのパスを確認
which docker-compose
which docker

# docker composeコマンドを使用（Docker Compose v2）
docker compose version
```

### バックアップスクリプトが見つからない

```bash
# バックアップスクリプトの存在確認
ls -l scripts/server/backup-encrypted.sh
ls -l scripts/server/restore-encrypted.sh
```

## 関連ドキュメント

- [ops-verification-runbook.md](./ops-verification-runbook.md): 手動実行手順
- [evaluation-report.md](../evaluation-report.md): 評価報告書
- [evaluation-plan.md](../evaluation-plan.md): 評価計画書
