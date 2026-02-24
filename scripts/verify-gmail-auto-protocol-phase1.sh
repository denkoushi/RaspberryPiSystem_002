#!/bin/bash
# Gmail自動運用プロトコル フェーズ1 実機検証スクリプト
# 使用方法: ./scripts/verify-gmail-auto-protocol-phase1.sh

set -euo pipefail

API_BASE_URL="${API_BASE_URL:-http://localhost:3000}"
LOG_FILE="${LOG_FILE:-/tmp/gmail-phase1-verification.log}"

echo "=========================================="
echo "Gmail自動運用プロトコル フェーズ1 実機検証"
echo "=========================================="
echo ""

# ログファイルを初期化
echo "検証開始: $(date)" > "$LOG_FILE"

# 1. ヘルスチェック
echo "1. ヘルスチェック..."
echo "1. ヘルスチェック..." >> "$LOG_FILE"
HEALTH_RESPONSE=$(curl -s "${API_BASE_URL}/api/system/health" || echo "{}")
echo "$HEALTH_RESPONSE" | jq . >> "$LOG_FILE"

if echo "$HEALTH_RESPONSE" | jq -e '.status == "ok"' > /dev/null 2>&1; then
    echo "✅ ヘルスチェック成功"
    echo "✅ ヘルスチェック成功" >> "$LOG_FILE"
else
    echo "❌ ヘルスチェック失敗"
    echo "❌ ヘルスチェック失敗" >> "$LOG_FILE"
    echo "$HEALTH_RESPONSE" | jq .
fi
echo ""

# 2. GmailRateLimitStateの確認
echo "2. GmailRateLimitStateの確認..."
echo "2. GmailRateLimitStateの確認..." >> "$LOG_FILE"

# Dockerコンテナ経由でDBに接続
if docker ps | grep -q raspi-system-db; then
    echo "データベースコンテナが実行中です"
    echo "データベースコンテナが実行中です" >> "$LOG_FILE"
    
    STATE_QUERY="SELECT id, \"cooldownUntil\", \"last429At\", \"lastRetryAfterMs\", version, \"createdAt\", \"updatedAt\" FROM \"GmailRateLimitState\" WHERE id = 'gmail:me';"
    
    DB_RESULT=$(docker exec raspi-system-db psql -U postgres -d raspi_system -t -A -F',' -c "$STATE_QUERY" 2>&1 || echo "")
    
    if [ -n "$DB_RESULT" ] && [ "$DB_RESULT" != "" ]; then
        echo "✅ GmailRateLimitStateが存在します"
        echo "✅ GmailRateLimitStateが存在します" >> "$LOG_FILE"
        echo "$DB_RESULT" >> "$LOG_FILE"
    else
        echo "⚠️  GmailRateLimitStateが存在しません（初回実行時は自動作成されます）"
        echo "⚠️  GmailRateLimitStateが存在しません（初回実行時は自動作成されます）" >> "$LOG_FILE"
    fi
else
    echo "⚠️  データベースコンテナが見つかりません"
    echo "⚠️  データベースコンテナが見つかりません" >> "$LOG_FILE"
fi
echo ""

# 3. 古いPROCESSING状態の確認
echo "3. 古いPROCESSING状態の確認..."
echo "3. 古いPROCESSING状態の確認..." >> "$LOG_FILE"

if docker ps | grep -q raspi-system-db; then
    STALE_QUERY="SELECT COUNT(*) FROM \"CsvImportHistory\" WHERE status = 'PROCESSING' AND \"startedAt\" < NOW() - INTERVAL '60 minutes';"
    STALE_COUNT=$(docker exec raspi-system-db psql -U postgres -d raspi_system -t -A -c "$STALE_QUERY" 2>&1 | tr -d ' ' || echo "0")
    
    if [ "$STALE_COUNT" -gt 0 ]; then
        echo "⚠️  60分以上PROCESSING状態の履歴が ${STALE_COUNT} 件あります"
        echo "⚠️  60分以上PROCESSING状態の履歴が ${STALE_COUNT} 件あります" >> "$LOG_FILE"
        
        DETAIL_QUERY="SELECT id, \"scheduleId\", status, \"startedAt\", \"completedAt\" FROM \"CsvImportHistory\" WHERE status = 'PROCESSING' AND \"startedAt\" < NOW() - INTERVAL '60 minutes' ORDER BY \"startedAt\" DESC LIMIT 5;"
        docker exec raspi-system-db psql -U postgres -d raspi_system -c "$DETAIL_QUERY" >> "$LOG_FILE" 2>&1 || true
    else
        echo "✅ 古いPROCESSING状態の履歴はありません"
        echo "✅ 古いPROCESSING状態の履歴はありません" >> "$LOG_FILE"
    fi
else
    echo "⚠️  データベースコンテナが見つかりません"
    echo "⚠️  データベースコンテナが見つかりません" >> "$LOG_FILE"
fi
echo ""

# 4. ログの確認（GmailImportOrchestrator）
echo "4. ログの確認（GmailImportOrchestrator）..."
echo "4. ログの確認（GmailImportOrchestrator）..." >> "$LOG_FILE"

# systemdサービス経由でログを確認
if systemctl is-active --quiet raspi-system-api 2>/dev/null; then
    echo "systemdサービスが実行中です"
    echo "systemdサービスが実行中です" >> "$LOG_FILE"
    
    ORCHESTRATOR_LOGS=$(journalctl -u raspi-system-api -n 100 --no-pager 2>&1 | grep -i "GmailImportOrchestrator" | tail -10 || echo "")
    
    if [ -n "$ORCHESTRATOR_LOGS" ]; then
        echo "✅ GmailImportOrchestratorのログが見つかりました（最新10件）:"
        echo "✅ GmailImportOrchestratorのログが見つかりました（最新10件）:" >> "$LOG_FILE"
        echo "$ORCHESTRATOR_LOGS" | head -5
        echo "$ORCHESTRATOR_LOGS" >> "$LOG_FILE"
    else
        echo "⚠️  GmailImportOrchestratorのログが見つかりません（まだ実行されていない可能性があります）"
        echo "⚠️  GmailImportOrchestratorのログが見つかりません（まだ実行されていない可能性があります）" >> "$LOG_FILE"
    fi
else
    echo "⚠️  systemdサービスが見つかりません（Docker直接実行の可能性があります）"
    echo "⚠️  systemdサービスが見つかりません（Docker直接実行の可能性があります）" >> "$LOG_FILE"
fi
echo ""

# 5. ログの確認（429エラー関連）
echo "5. ログの確認（429エラー関連）..."
echo "5. ログの確認（429エラー関連）..." >> "$LOG_FILE"

if systemctl is-active --quiet raspi-system-api 2>/dev/null; then
    RATE_LIMIT_LOGS=$(journalctl -u raspi-system-api -n 200 --no-pager 2>&1 | grep -iE "429|rate.*limit|cooldown" | tail -10 || echo "")
    
    if [ -n "$RATE_LIMIT_LOGS" ]; then
        echo "⚠️  429エラーまたはレート制限関連のログが見つかりました（最新10件）:"
        echo "⚠️  429エラーまたはレート制限関連のログが見つかりました（最新10件）:" >> "$LOG_FILE"
        echo "$RATE_LIMIT_LOGS" | head -5
        echo "$RATE_LIMIT_LOGS" >> "$LOG_FILE"
    else
        echo "✅ 429エラー関連のログは見つかりません（正常）"
        echo "✅ 429エラー関連のログは見つかりません（正常）" >> "$LOG_FILE"
    fi
else
    echo "⚠️  systemdサービスが見つかりません"
    echo "⚠️  systemdサービスが見つかりません" >> "$LOG_FILE"
fi
echo ""

# 6. バックアップ設定の確認（Gmailスケジュール）
echo "6. バックアップ設定の確認（Gmailスケジュール）..."
echo "6. バックアップ設定の確認（Gmailスケジュール）..." >> "$LOG_FILE"

CONFIG_FILE="${CONFIG_FILE:-/opt/RaspberryPiSystem_002/config/backup.json}"

if [ -f "$CONFIG_FILE" ]; then
    GMAIL_SCHEDULES=$(jq -r '.csvImports[]? | select(.provider == "gmail" and (.targets[]?.type == "csvDashboards" or .targets[]?.type == "csvDashboards")) | {id, name, schedule, enabled}' "$CONFIG_FILE" 2>/dev/null || echo "")
    
    if [ -n "$GMAIL_SCHEDULES" ]; then
        echo "✅ Gmail csvDashboardsスケジュールが見つかりました:"
        echo "✅ Gmail csvDashboardsスケジュールが見つかりました:" >> "$LOG_FILE"
        echo "$GMAIL_SCHEDULES" | jq .
        echo "$GMAIL_SCHEDULES" | jq . >> "$LOG_FILE"
    else
        echo "⚠️  Gmail csvDashboardsスケジュールが見つかりません"
        echo "⚠️  Gmail csvDashboardsスケジュールが見つかりません" >> "$LOG_FILE"
    fi
else
    echo "⚠️  設定ファイルが見つかりません: $CONFIG_FILE"
    echo "⚠️  設定ファイルが見つかりません: $CONFIG_FILE" >> "$LOG_FILE"
fi
echo ""

# 検証完了
echo "=========================================="
echo "検証完了"
echo "=========================================="
echo "ログファイル: $LOG_FILE"
echo ""
echo "次のステップ:"
echo "1. ログファイルを確認してください: cat $LOG_FILE"
echo "2. 必要に応じて、手動で追加の検証を実施してください"
echo "3. 検証結果をドキュメントに記録してください: docs/guides/gmail-auto-protocol-phase1-verification.md"
