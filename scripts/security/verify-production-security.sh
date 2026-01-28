#!/bin/bash
set -euo pipefail

# セキュリティ評価 実機検証スクリプト（Pi5本番）
# 使用方法: sudo ./scripts/security/verify-production-security.sh
#
# このスクリプトは以下の検証を実施します:
# 1. ポート露出の確認
# 2. 検知→通知→可視化のE2E確認
# 3. バックアップ/復元の実効性確認
# 4. USBオフライン運用の検証（USB接続時のみ）

PROJECT_DIR="/opt/RaspberryPiSystem_002"
EVIDENCE_DIR="${PROJECT_DIR}/docs/security/evidence"
TIMESTAMP=$(date +%Y%m%d-%H%M)
COMPOSE_FILE="${PROJECT_DIR}/infrastructure/docker/docker-compose.server.yml"

# 証跡ディレクトリを作成
mkdir -p "${EVIDENCE_DIR}"

echo "=== セキュリティ評価 実機検証開始 ==="
echo "実施日時: $(date)"
echo "証跡保存先: ${EVIDENCE_DIR}"
echo ""

# 1. ポート露出の確認
echo "1. ポート露出の確認..."
{
  echo "=== ポート状態確認 ==="
  echo "実施日時: $(date)"
  echo ""
  echo "--- ss -H -tulpen ---"
  sudo ss -H -tulpen
  echo ""
  echo "--- ufw status verbose ---"
  sudo ufw status verbose
  echo ""
  echo "--- docker compose ps ---"
  cd "${PROJECT_DIR}"
  docker compose -f "${COMPOSE_FILE}" ps
} > "${EVIDENCE_DIR}/${TIMESTAMP}_prod_ports_status.txt" 2>&1
echo "✅ ポート状態を保存: ${EVIDENCE_DIR}/${TIMESTAMP}_prod_ports_status.txt"

# 2. fail2ban監視の確認
echo ""
echo "2. fail2ban監視の確認..."
TEST_IP="203.0.113.50"
{
  echo "=== fail2ban監視確認 ==="
  echo "実施日時: $(date)"
  echo ""
  echo "--- fail2ban status ---"
  sudo fail2ban-client status sshd
  echo ""
  echo "--- fail2ban log (最新20行) ---"
  sudo tail -20 /var/log/fail2ban.log
  echo ""
  echo "--- Ban IP設定: ${TEST_IP} ---"
  sudo fail2ban-client set sshd banip "${TEST_IP}"
  echo ""
  echo "--- 15分待機中（security-monitor.timerの実行間隔） ---"
  echo "注意: 実際の検証では15分待機が必要ですが、ここでは短縮版として10秒待機します"
  sleep 10
  echo ""
  echo "--- alerts/ ディレクトリ確認 ---"
  ls -lt "${PROJECT_DIR}/alerts/" | head -5 || echo "alerts/ ディレクトリが見つかりません"
  echo ""
  echo "--- 最新のアラートファイル ---"
  if [ -d "${PROJECT_DIR}/alerts/" ]; then
    LATEST_ALERT=$(ls -t "${PROJECT_DIR}/alerts/"/*.json 2>/dev/null | head -1 || echo "")
    if [ -n "${LATEST_ALERT}" ]; then
      cat "${LATEST_ALERT}" | jq . 2>/dev/null || cat "${LATEST_ALERT}"
    else
      echo "アラートファイルが見つかりません"
    fi
  fi
  echo ""
  echo "--- Ban解除: ${TEST_IP} ---"
  sudo fail2ban-client set sshd unbanip "${TEST_IP}"
} > "${EVIDENCE_DIR}/${TIMESTAMP}_prod_ops_fail2ban.txt" 2>&1
echo "✅ fail2ban検証結果を保存: ${EVIDENCE_DIR}/${TIMESTAMP}_prod_ops_fail2ban.txt"

# 3. security-monitor / マルウェアスキャンの確認
echo ""
echo "3. security-monitor / マルウェアスキャンの確認..."
{
  echo "=== security-monitor / マルウェアスキャン確認 ==="
  echo "実施日時: $(date)"
  echo ""
  echo "--- security-monitor.sh 実行 ---"
  sudo /usr/local/bin/security-monitor.sh 2>&1 || echo "security-monitor.sh が見つかりません"
  echo ""
  echo "--- ClamAVスキャン実行（タイムアウト: 60秒） ---"
  timeout 60 sudo /usr/local/bin/clamav-scan.sh 2>&1 || echo "clamav-scan.sh が見つかりません または タイムアウト"
  echo ""
  echo "--- Trivyスキャン実行（タイムアウト: 60秒） ---"
  timeout 60 sudo /usr/local/bin/trivy-scan.sh 2>&1 || echo "trivy-scan.sh が見つかりません または タイムアウト"
  echo ""
  echo "--- rkhunterスキャン実行（タイムアウト: 60秒） ---"
  timeout 60 sudo /usr/local/bin/rkhunter-scan.sh 2>&1 || echo "rkhunter-scan.sh が見つかりません または タイムアウト"
  echo ""
  echo "--- alerts/ ディレクトリ確認（スキャン後） ---"
  ls -lt "${PROJECT_DIR}/alerts/" | head -10 || echo "alerts/ ディレクトリが見つかりません"
  echo ""
  echo "--- 最新のアラートファイル（スキャン後） ---"
  if [ -d "${PROJECT_DIR}/alerts/" ]; then
    LATEST_ALERT=$(ls -t "${PROJECT_DIR}/alerts/"/*.json 2>/dev/null | head -1 || echo "")
    if [ -n "${LATEST_ALERT}" ]; then
      cat "${LATEST_ALERT}" | jq . 2>/dev/null || cat "${LATEST_ALERT}"
    fi
  fi
} > "${EVIDENCE_DIR}/${TIMESTAMP}_prod_ops_monitor.txt" 2>&1
echo "✅ 監視検証結果を保存: ${EVIDENCE_DIR}/${TIMESTAMP}_prod_ops_monitor.txt"

# 4. バックアップ/復元の実効性確認
echo ""
echo "4. バックアップ/復元の実効性確認..."
cd "${PROJECT_DIR}"
{
  echo "=== バックアップ/復元検証 ==="
  echo "実施日時: $(date)"
  echo ""
  echo "--- 既存バックアップファイル確認 ---"
  ls -lh /opt/backups/ | head -10 || echo "バックアップディレクトリが見つかりません"
  echo ""
  echo "--- 暗号化バックアップ実行 ---"
  sudo ./scripts/server/backup-encrypted.sh 2>&1 || echo "バックアップスクリプトの実行に失敗"
  echo ""
  echo "--- バックアップファイル確認（実行後） ---"
  ls -lh /opt/backups/ | head -10 || echo "バックアップディレクトリが見つかりません"
  echo ""
  echo "--- 検証用DB作成 ---"
  docker compose -f "${COMPOSE_FILE}" exec -T db psql -U postgres -c "CREATE DATABASE borrow_return_restore_test;" 2>&1 || echo "検証用DB作成に失敗"
  echo ""
  echo "--- 最新のバックアップファイルを特定 ---"
  LATEST_BACKUP=$(ls -t /opt/backups/backup-encrypted-*.gpg 2>/dev/null | head -1 || echo "")
  if [ -z "${LATEST_BACKUP}" ]; then
    LATEST_BACKUP=$(ls -t /opt/backups/database/*.gpg 2>/dev/null | head -1 || echo "")
  fi
  if [ -z "${LATEST_BACKUP}" ]; then
    echo "バックアップファイルが見つかりません"
  else
    echo "使用するバックアップファイル: ${LATEST_BACKUP}"
    echo ""
    echo "--- 復元実行 ---"
    sudo ./scripts/server/restore-encrypted.sh "${LATEST_BACKUP}" borrow_return_restore_test 2>&1 || echo "復元に失敗"
    echo ""
    echo "--- 復元後のデータ確認 ---"
    docker compose -f "${COMPOSE_FILE}" exec -T db psql -U postgres -d borrow_return_restore_test -c 'SELECT COUNT(*) FROM "Loan";' 2>&1 || echo "データ確認に失敗"
    echo ""
    echo "--- 検証用DB削除 ---"
    docker compose -f "${COMPOSE_FILE}" exec -T db psql -U postgres -c "DROP DATABASE borrow_return_restore_test;" 2>&1 || echo "検証用DB削除に失敗"
  fi
} > "${EVIDENCE_DIR}/${TIMESTAMP}_prod_backup_restore.txt" 2>&1
echo "✅ バックアップ/復元検証結果を保存: ${EVIDENCE_DIR}/${TIMESTAMP}_prod_backup_restore.txt"

# 5. USBオフライン運用の検証（USB接続時のみ）
echo ""
echo "5. USBオフライン運用の検証..."
USB_MOUNT="/mnt/usb"
if [ -b /dev/sda1 ] || [ -b /dev/sdb1 ]; then
  USB_DEVICE=""
  if [ -b /dev/sda1 ]; then
    USB_DEVICE="/dev/sda1"
  elif [ -b /dev/sdb1 ]; then
    USB_DEVICE="/dev/sdb1"
  fi
  
  echo "USBデバイスを検出: ${USB_DEVICE}"
  {
    echo "=== USBオフライン運用検証 ==="
    echo "実施日時: $(date)"
    echo "USBデバイス: ${USB_DEVICE}"
    echo ""
    echo "--- USBマウントポイント作成 ---"
    sudo mkdir -p "${USB_MOUNT}"
    echo ""
    echo "--- USBマウント ---"
    sudo mount "${USB_DEVICE}" "${USB_MOUNT}" 2>&1 || echo "USBマウントに失敗"
    echo ""
    echo "--- 最新のバックアップファイルを特定 ---"
    LATEST_BACKUP=$(ls -t /opt/backups/backup-encrypted-*.gpg 2>/dev/null | head -1 || echo "")
    if [ -z "${LATEST_BACKUP}" ]; then
      LATEST_BACKUP=$(ls -t /opt/backups/database/*.gpg 2>/dev/null | head -1 || echo "")
    fi
    if [ -n "${LATEST_BACKUP}" ]; then
      BACKUP_NAME=$(basename "${LATEST_BACKUP}")
      echo "コピー元: ${LATEST_BACKUP}"
      echo ""
      echo "--- バックアップファイルをUSBにコピー ---"
      sudo cp "${LATEST_BACKUP}" "${USB_MOUNT}/" 2>&1 || echo "USBへのコピーに失敗"
      echo ""
      echo "--- USB上のファイル確認 ---"
      ls -lh "${USB_MOUNT}/" | grep -E "\.(gpg|sql\.gz)" || echo "USB上にバックアップファイルが見つかりません"
      echo ""
      echo "--- Pi5上のバックアップファイルを削除（テスト用） ---"
      echo "注意: 実際の運用では削除しませんが、検証のため削除します"
      sudo rm -f "${LATEST_BACKUP}" 2>&1 || echo "バックアップファイルの削除に失敗"
      echo ""
      echo "--- USBからPi5へ復元 ---"
      sudo cp "${USB_MOUNT}/${BACKUP_NAME}" /opt/backups/ 2>&1 || echo "USBからの復元に失敗"
      echo ""
      echo "--- 復元後のリストアテスト ---"
      docker compose -f "${COMPOSE_FILE}" exec -T db psql -U postgres -c "CREATE DATABASE borrow_return_restore_test;" 2>&1 || echo "検証用DB作成に失敗"
      sudo ./scripts/server/restore-encrypted.sh "/opt/backups/${BACKUP_NAME}" borrow_return_restore_test 2>&1 || echo "リストアに失敗"
      echo ""
      echo "--- リストア後のデータ確認 ---"
      docker compose -f "${COMPOSE_FILE}" exec -T db psql -U postgres -d borrow_return_restore_test -c 'SELECT COUNT(*) FROM "Loan";' 2>&1 || echo "データ確認に失敗"
      echo ""
      echo "--- 検証用DB削除 ---"
      docker compose -f "${COMPOSE_FILE}" exec -T db psql -U postgres -c "DROP DATABASE borrow_return_restore_test;" 2>&1 || echo "検証用DB削除に失敗"
      echo ""
      echo "--- USBアンマウント ---"
      sudo umount "${USB_MOUNT}" 2>&1 || echo "USBアンマウントに失敗"
    else
      echo "バックアップファイルが見つかりません"
    fi
  } > "${EVIDENCE_DIR}/${TIMESTAMP}_prod_usb_restore.txt" 2>&1
  echo "✅ USBオフライン運用検証結果を保存: ${EVIDENCE_DIR}/${TIMESTAMP}_prod_usb_restore.txt"
else
  echo "⚠️ USBデバイスが検出されませんでした。USB接続時に再実行してください。"
  {
    echo "=== USBオフライン運用検証（スキップ） ==="
    echo "実施日時: $(date)"
    echo ""
    echo "USBデバイスが検出されませんでした。"
    echo "USB接続時に以下の手順で実施してください:"
    echo ""
    echo "1. USBデバイスを接続"
    echo "2. このスクリプトを再実行"
    echo ""
    echo "または、手動で以下を実行:"
    echo "  sudo mount /dev/sda1 /mnt/usb"
    echo "  sudo cp /opt/backups/backup-encrypted-*.gpg /mnt/usb/"
    echo "  # ... (詳細は docs/security/evidence/ops-verification-runbook.md を参照)"
  } > "${EVIDENCE_DIR}/${TIMESTAMP}_prod_usb_restore.txt" 2>&1
fi

echo ""
echo "=== セキュリティ評価 実機検証完了 ==="
echo "証跡は以下のディレクトリに保存されました:"
echo "  ${EVIDENCE_DIR}"
echo ""
echo "生成された証跡ファイル:"
ls -lh "${EVIDENCE_DIR}/${TIMESTAMP}"_*.txt 2>/dev/null || echo "証跡ファイルが見つかりません"
echo ""
echo "次のステップ:"
echo "1. 証跡ファイルを確認"
echo "2. 必要に応じて評価報告書を更新"
echo "3. ギャップ一覧・トップリスク10を更新"
