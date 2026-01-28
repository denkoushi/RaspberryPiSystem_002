# 実機運用検証メモ（Pi5 本番）

最終更新: 2026-01-28

本ファイルは、**本番Pi5での運用検証**（検知→通知→可視化、バックアップ/復元、USBオフライン）を行うための手順メモです。
本ワークスペースから実機に直接実行できないため、実行結果は別途証跡として保存してください。

## 1. 検知→通知→可視化（E2E）

### fail2ban
```bash
sudo fail2ban-client status sshd
sudo fail2ban-client set sshd banip 203.0.113.50
sleep 900
ls -lt /opt/RaspberryPiSystem_002/alerts/ | head -5
sudo fail2ban-client set sshd unbanip 203.0.113.50
```

### security-monitor / malware scan
```bash
sudo /usr/local/bin/security-monitor.sh
sudo /usr/local/bin/clamav-scan.sh
sudo /usr/local/bin/trivy-scan.sh
sudo /usr/local/bin/rkhunter-scan.sh
ls -lt /opt/RaspberryPiSystem_002/alerts/ | head -5
```

## 2. バックアップ/復元（検証DB）

```bash
cd /opt/RaspberryPiSystem_002
sudo ./scripts/server/backup-encrypted.sh

docker compose -f infrastructure/docker/docker-compose.server.yml exec db \
  psql -U postgres -c "CREATE DATABASE borrow_return_restore_test;"

sudo ./scripts/server/restore-encrypted.sh \
  /opt/backups/backup-encrypted-*.gpg \
  borrow_return_restore_test

docker compose -f infrastructure/docker/docker-compose.server.yml exec db \
  psql -U postgres -d borrow_return_restore_test \
  -c "SELECT COUNT(*) FROM \"Loan\";"

docker compose -f infrastructure/docker/docker-compose.server.yml exec db \
  psql -U postgres -c "DROP DATABASE borrow_return_restore_test;"
```

## 3. USBオフライン運用（必須証跡）

```bash
sudo mount /dev/sda1 /mnt/usb
sudo cp /opt/backups/backup-encrypted-*.gpg /mnt/usb/
sudo rm /opt/backups/backup-encrypted-*.gpg
sudo cp /mnt/usb/backup-encrypted-*.gpg /opt/backups/
sudo ./scripts/server/restore-encrypted.sh \
  /opt/backups/backup-encrypted-*.gpg \
  borrow_return_restore_test
sudo umount /mnt/usb
```

**保存先**: `docs/security/evidence/` に証跡を保存
```
YYYYMMDD-HHMM_prod_ops_fail2ban.txt
YYYYMMDD-HHMM_prod_ops_monitor.txt
YYYYMMDD-HHMM_prod_backup_restore.txt
YYYYMMDD-HHMM_prod_usb_restore.txt
```
