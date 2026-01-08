#!/bin/bash
# サイネージスケジュール作成テスト用スクリプト（認証が必要なため、管理コンソール経由での作成を推奨）

set -euo pipefail

PI5_HOST="denkon5sd02@100.106.158.2"
BASE_URL="https://100.106.158.2"

echo "=========================================="
echo "サイネージスケジュール作成テスト"
echo "=========================================="
echo ""
echo "⚠️  注意: このスクリプトは認証が必要なAPIを使用します。"
echo "管理コンソール（$BASE_URL/admin/signage/schedules）経由での作成を推奨します。"
echo ""

# 現在の日時を取得してスケジュール名に使用
CURRENT_TIME=$(date +%H:%M)
SCHEDULE_NAME="検証用_$(date +%Y%m%d_%H%M%S)"

echo "検証用スケジュール名: $SCHEDULE_NAME"
echo ""
echo "以下のスケジュールを作成できます："
echo "1. FULLレイアウト + loansスロット"
echo "2. FULLレイアウト + pdfスロット"
echo "3. SPLITレイアウト + 左loans/右pdf"
echo "4. SPLITレイアウト + 左pdf/右loans"
echo ""
echo "管理コンソールで作成する場合の手順："
echo "1. $BASE_URL/admin/signage/schedules にアクセス"
echo "2. 「新規作成」をクリック"
echo "3. レイアウトとコンテンツを選択"
echo "4. スケジュール設定（曜日、時間帯、優先順位）を設定"
echo "5. 「保存」をクリック"
echo ""

