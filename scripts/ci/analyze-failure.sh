#!/bin/bash
# CIテスト失敗の分析スクリプト
# GitHub Actionsのログから重要な情報を抽出

set -e

echo "=== CIテスト失敗分析スクリプト ==="
echo ""
echo "このスクリプトは、GitHub Actionsのログから重要な情報を抽出します。"
echo ""
echo "使用方法:"
echo "1. GitHub Actionsの失敗したジョブのログをコピー"
echo "2. ログをファイルに保存（例: ci-log.txt）"
echo "3. このスクリプトを実行: bash scripts/ci/analyze-failure.sh ci-log.txt"
echo ""
echo "または、GitHub ActionsのログURLを指定:"
echo "bash scripts/ci/analyze-failure.sh <ログURLまたはファイルパス>"
echo ""

if [ $# -eq 0 ]; then
    echo "エラー: ログファイルまたはURLを指定してください"
    exit 1
fi

LOG_SOURCE=$1

# 一時ファイル
TEMP_FILE=$(mktemp)

# URLの場合はダウンロード、ファイルの場合はコピー
if [[ $LOG_SOURCE == http* ]]; then
    echo "ログをダウンロード中..."
    curl -s "$LOG_SOURCE" > "$TEMP_FILE" || {
        echo "エラー: ログのダウンロードに失敗しました"
        exit 1
    }
else
    if [ ! -f "$LOG_SOURCE" ]; then
        echo "エラー: ファイルが見つかりません: $LOG_SOURCE"
        exit 1
    fi
    cp "$LOG_SOURCE" "$TEMP_FILE"
fi

echo ""
echo "=== 重要なエラーメッセージ ==="
grep -i "error\|failed\|failure\|✖\|×" "$TEMP_FILE" | head -50

echo ""
echo "=== テスト失敗の詳細 ==="
grep -A 5 "FAIL\|failing\|AssertionError\|Test failed" "$TEMP_FILE" | head -100

echo ""
echo "=== PostgreSQL関連のエラー ==="
grep -i "postgres\|database\|connection\|migration" "$TEMP_FILE" | grep -i "error\|failed\|failure" | head -30

echo ""
echo "=== ビルドエラー ==="
grep -i "build\|compile\|typescript\|prisma" "$TEMP_FILE" | grep -i "error\|failed\|failure" | head -30

echo ""
echo "=== 環境変数と設定 ==="
grep -E "DATABASE_URL|JWT_|NODE_ENV|CI=" "$TEMP_FILE" | head -20

echo ""
echo "=== テスト実行のサマリー ==="
grep -E "Tests:|Test Files:|passed|failed|skipped" "$TEMP_FILE" | tail -20

echo ""
echo "=== タイムアウトエラー ==="
grep -i "timeout\|timed out" "$TEMP_FILE" | head -20

# 一時ファイルを削除
rm "$TEMP_FILE"

echo ""
echo "=== 分析完了 ==="
echo "上記の情報をAIアシスタントに共有してください。"

