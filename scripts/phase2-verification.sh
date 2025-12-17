#!/bin/bash
#
# Phase 2 実機検証スクリプト
# Raspberry Pi 5で実行してください
#
# 使用方法:
#   1. Raspberry Pi 5にSSH接続
#   2. cd /opt/RaspberryPiSystem_002
#   3. git pull origin main
#   4. ./scripts/phase2-verification.sh
#

set -e

# 色の定義
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ログ関数
log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# 設定
API_URL="${API_URL:-http://localhost:8080}"
COMPOSE_FILE="${COMPOSE_FILE:-infrastructure/docker/docker-compose.server.yml}"

# 作業ディレクトリ
cd "$(dirname "$0")/.."
PROJECT_ROOT=$(pwd)
log_info "Project root: $PROJECT_ROOT"

echo ""
echo "======================================"
echo " Phase 2 実機検証 - CSVインポートスケジュール"
echo "======================================"
echo ""

# 1. 前提条件の確認
log_info "1. 前提条件の確認..."

# Dockerコンテナの確認
if ! docker compose -f "$COMPOSE_FILE" ps --status running | grep -q "api"; then
    log_error "APIサーバーが起動していません"
    log_info "以下のコマンドで起動してください:"
    echo "  docker compose -f $COMPOSE_FILE up -d"
    exit 1
fi
log_success "APIサーバーが起動しています"

# PostgreSQLの確認
if ! docker compose -f "$COMPOSE_FILE" ps --status running | grep -q "db"; then
    log_error "PostgreSQLが起動していません"
    exit 1
fi
log_success "PostgreSQLが起動しています"

# 2. CsvImportHistoryテーブルの確認
log_info "2. CsvImportHistoryテーブルの確認..."
TABLE_EXISTS=$(docker compose -f "$COMPOSE_FILE" exec -T db psql -U postgres -d borrow_return -t -c \
    "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'CsvImportHistory');" 2>/dev/null | tr -d '[:space:]')

if [ "$TABLE_EXISTS" != "t" ]; then
    log_error "CsvImportHistoryテーブルが存在しません"
    log_info "マイグレーションを実行してください:"
    echo "  docker compose -f $COMPOSE_FILE exec api npx prisma migrate deploy"
    exit 1
fi
log_success "CsvImportHistoryテーブルが存在します"

# 3. backup.jsonの確認
log_info "3. backup.jsonの確認..."
CONFIG_FILE="/opt/RaspberryPiSystem_002/config/backup.json"
if [ -f "$CONFIG_FILE" ]; then
    if grep -q "dropbox" "$CONFIG_FILE" && grep -q "accessToken" "$CONFIG_FILE"; then
        log_success "Dropbox認証が設定されています"
    else
        log_warn "Dropbox認証が設定されていない可能性があります"
    fi
else
    log_error "backup.jsonが見つかりません: $CONFIG_FILE"
    exit 1
fi

# 4. APIサーバーのログでスケジューラの起動確認
log_info "4. CsvImportSchedulerの起動確認..."
if docker compose -f "$COMPOSE_FILE" logs api --tail 100 2>/dev/null | grep -qi "csv.*import.*scheduler.*started\|csvimportscheduler"; then
    log_success "CsvImportSchedulerが起動しています"
else
    log_warn "CsvImportSchedulerの起動ログが見つかりません（起動直後でない場合は問題ありません）"
fi

echo ""
echo "======================================"
echo " スケジュールAPIのテスト"
echo "======================================"
echo ""

# 5. スケジュール一覧の取得
log_info "5. スケジュール一覧を取得..."
SCHEDULES=$(curl -s "${API_URL}/api/imports/schedule" -H "x-client-key: raspi")
echo "  Response: $SCHEDULES"

if echo "$SCHEDULES" | grep -q "csvImports"; then
    log_success "スケジュールAPI (GET) が動作しています"
else
    log_error "スケジュールAPI (GET) が動作していません"
fi

# 6. テストスケジュールの追加
log_info "6. テストスケジュールを追加..."
SCHEDULE_ID="verification-test-$(date +%s)"
ADD_RESULT=$(curl -s -X POST "${API_URL}/api/imports/schedule" \
    -H "Content-Type: application/json" \
    -H "x-client-key: raspi" \
    -d '{
        "id": "'"$SCHEDULE_ID"'",
        "name": "検証用テストスケジュール",
        "employeesPath": "/test/employees.csv",
        "schedule": "0 0 1 1 *",
        "enabled": false
    }')
echo "  Response: $ADD_RESULT"

if echo "$ADD_RESULT" | grep -q "$SCHEDULE_ID"; then
    log_success "スケジュールAPI (POST) が動作しています"
else
    log_error "スケジュールAPI (POST) が動作していません"
fi

# 7. スケジュールの更新
log_info "7. スケジュールを更新..."
UPDATE_RESULT=$(curl -s -X PUT "${API_URL}/api/imports/schedule/${SCHEDULE_ID}" \
    -H "Content-Type: application/json" \
    -H "x-client-key: raspi" \
    -d '{
        "name": "検証用テストスケジュール（更新後）"
    }')
echo "  Response: $UPDATE_RESULT"

if echo "$UPDATE_RESULT" | grep -q "更新後"; then
    log_success "スケジュールAPI (PUT) が動作しています"
else
    log_error "スケジュールAPI (PUT) が動作していません"
fi

# 8. 手動実行のテスト（エラーになることを確認）
log_info "8. 手動実行テスト（エラーになることを確認）..."
RUN_RESULT=$(curl -s -X POST "${API_URL}/api/imports/schedule/${SCHEDULE_ID}/run" \
    -H "x-client-key: raspi")
echo "  Response: $RUN_RESULT"

if echo "$RUN_RESULT" | grep -qi "error\|failed\|not found"; then
    log_success "手動実行API (POST /run) が動作しています（存在しないファイルでエラー）"
else
    log_warn "手動実行の結果を確認してください"
fi

# 9. インポート履歴の確認
log_info "9. インポート履歴を確認..."
HISTORY_COUNT=$(docker compose -f "$COMPOSE_FILE" exec -T db psql -U postgres -d borrow_return -t -c \
    "SELECT COUNT(*) FROM \"CsvImportHistory\" WHERE \"scheduleId\" = '$SCHEDULE_ID';" 2>/dev/null | tr -d '[:space:]')
echo "  履歴件数: $HISTORY_COUNT"

if [ "$HISTORY_COUNT" -gt 0 ]; then
    log_success "インポート履歴が記録されています"
    
    # 履歴の詳細を表示
    log_info "  履歴の詳細:"
    docker compose -f "$COMPOSE_FILE" exec -T db psql -U postgres -d borrow_return -c \
        "SELECT id, \"scheduleId\", status, \"startedAt\", \"completedAt\" FROM \"CsvImportHistory\" WHERE \"scheduleId\" = '$SCHEDULE_ID' ORDER BY \"startedAt\" DESC LIMIT 3;"
else
    log_warn "インポート履歴が記録されていません（ImportHistoryServiceが有効化されているか確認してください）"
fi

# 10. アラートの確認
log_info "10. アラートファイルを確認..."
ALERTS_DIR="/opt/RaspberryPiSystem_002/alerts"
if [ -d "$ALERTS_DIR" ]; then
    ALERT_COUNT=$(find "$ALERTS_DIR" -name "*.json" -mmin -5 2>/dev/null | wc -l | tr -d '[:space:]')
    if [ "$ALERT_COUNT" -gt 0 ]; then
        log_success "アラートファイルが生成されました ($ALERT_COUNT件)"
        log_info "  最新のアラート:"
        find "$ALERTS_DIR" -name "*.json" -mmin -5 -exec cat {} \; | head -20
    else
        log_info "過去5分以内のアラートはありません"
    fi
else
    log_info "アラートディレクトリが存在しません: $ALERTS_DIR"
fi

# 11. スケジュールの削除
log_info "11. テストスケジュールを削除..."
DELETE_RESULT=$(curl -s -X DELETE "${API_URL}/api/imports/schedule/${SCHEDULE_ID}" \
    -H "x-client-key: raspi")
echo "  Response: $DELETE_RESULT"

if echo "$DELETE_RESULT" | grep -q "success\|deleted\|csvImports"; then
    log_success "スケジュールAPI (DELETE) が動作しています"
else
    log_error "スケジュールAPI (DELETE) が動作していません"
fi

echo ""
echo "======================================"
echo " 検証結果サマリー"
echo "======================================"
echo ""

# 最終的なログ確認
log_info "APIサーバーのCSV関連ログ（最新20件）:"
docker compose -f "$COMPOSE_FILE" logs api --tail 50 2>/dev/null | grep -i "csv\|import\|scheduler" | tail -20

echo ""
log_success "Phase 2 実機検証が完了しました"
echo ""
echo "次のステップ:"
echo "  1. 実際のDropboxパスでCSVインポートをテスト"
echo "  2. cronスケジュールを設定して自動実行を確認"
echo "  3. 連続失敗時のアラート生成を確認"
echo ""
