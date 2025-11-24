#!/bin/bash
set -e

# GitHub Actionsのログを取得するスクリプト
# 使用方法: ./scripts/ci/get-logs.sh [job-name] [--errors-only]

REPO="denkoushi/RaspberryPiSystem_002"
OUTPUT_DIR="${HOME}/Downloads/gh-actions-logs"
ERRORS_ONLY=false

# オプション解析
while [[ $# -gt 0 ]]; do
  case $1 in
    --errors-only)
      ERRORS_ONLY=true
      shift
      ;;
    *)
      JOB_NAME_ARG="$1"
      shift
      ;;
  esac
done

# GitHub CLIがインストールされているか確認
if ! command -v gh &> /dev/null; then
  echo "❌ GitHub CLI (gh) がインストールされていません"
  echo "インストール方法: brew install gh"
  exit 1
fi

# 認証確認
if ! gh auth status &> /dev/null; then
  echo "❌ GitHub CLIが認証されていません"
  echo "認証方法: gh auth login"
  exit 1
fi

# 出力ディレクトリを作成
mkdir -p "${OUTPUT_DIR}"

# 最新のワークフロー実行を取得
echo "📋 最新のワークフロー実行を取得中..."
RUN_ID=$(gh run list --repo "${REPO}" --limit 1 --json databaseId --jq '.[0].databaseId')

if [ -z "${RUN_ID}" ]; then
  echo "❌ ワークフロー実行が見つかりません"
  exit 1
fi

echo "✅ ワークフロー実行ID: ${RUN_ID}"

# 実行ステータスを取得
STATUS=$(gh run view "${RUN_ID}" --repo "${REPO}" --json conclusion,status --jq '.conclusion // .status')
echo "📊 ステータス: ${STATUS}"

# ジョブ一覧を取得
echo ""
echo "📦 利用可能なジョブ:"
gh run view "${RUN_ID}" --repo "${REPO}" --json jobs --jq '.jobs[] | "  - \(.name) (\(.conclusion // .status))"'

# ジョブ名が指定されている場合はそのジョブのログのみ取得
if [ -n "${JOB_NAME_ARG}" ]; then
  JOB_NAME="${JOB_NAME_ARG}"
  echo ""
  echo "📥 ジョブ '${JOB_NAME}' のログを取得中..."
  
  # ジョブIDを取得
  JOB_ID=$(gh run view "${RUN_ID}" --repo "${REPO}" --json jobs --jq ".jobs[] | select(.name == \"${JOB_NAME}\") | .databaseId")
  
  if [ -z "${JOB_ID}" ]; then
    echo "❌ ジョブ '${JOB_NAME}' が見つかりません"
    exit 1
  fi
  
  OUTPUT_FILE="${OUTPUT_DIR}/${RUN_ID}_${JOB_NAME}.txt"
  gh run view "${RUN_ID}" --repo "${REPO}" --log --job "${JOB_ID}" > "${OUTPUT_FILE}"
  echo "✅ ログを保存しました: ${OUTPUT_FILE}"
  
  # エラーのみを表示する場合
  if [ "${ERRORS_ONLY}" = true ]; then
    echo ""
    echo "🔍 エラーのみを抽出:"
    if grep -q "Error\|Failed\|✖\|×\|exit code 1\|TimeoutError" "${OUTPUT_FILE}"; then
      grep -A 10 -B 5 "Error\|Failed\|✖\|×\|exit code 1\|TimeoutError" "${OUTPUT_FILE}" | head -100
    else
      echo "  エラーは見つかりませんでした"
    fi
  elif grep -q "Error\|Failed\|✖\|×\|exit code 1\|TimeoutError" "${OUTPUT_FILE}"; then
    echo ""
    echo "⚠️  エラーが見つかりました:"
    grep -A 5 -B 5 "Error\|Failed\|✖\|×\|exit code 1\|TimeoutError" "${OUTPUT_FILE}" | head -50
  fi
else
  # すべてのジョブのログを取得
  echo ""
  echo "📥 すべてのジョブのログを取得中..."
  
  gh run view "${RUN_ID}" --repo "${REPO}" --json jobs --jq -r '.jobs[].name' | while read -r JOB_NAME; do
    echo "  - ${JOB_NAME} のログを取得中..."
    JOB_ID=$(gh run view "${RUN_ID}" --repo "${REPO}" --json jobs --jq ".jobs[] | select(.name == \"${JOB_NAME}\") | .databaseId")
    OUTPUT_FILE="${OUTPUT_DIR}/${RUN_ID}_${JOB_NAME}.txt"
    gh run view "${RUN_ID}" --repo "${REPO}" --log --job "${JOB_ID}" > "${OUTPUT_FILE}" 2>&1 || true
    echo "    ✅ ${OUTPUT_FILE}"
  done
  
  echo ""
  echo "✅ すべてのログを保存しました: ${OUTPUT_DIR}/"
  
  # 失敗したジョブのエラーを表示
  if [ "${ERRORS_ONLY}" = false ]; then
    echo ""
    echo "🔍 失敗したジョブのエラー:"
    for LOG_FILE in "${OUTPUT_DIR}/${RUN_ID}"_*.txt; do
      if [ -f "${LOG_FILE}" ]; then
        JOB_NAME=$(basename "${LOG_FILE}" .txt | sed "s/${RUN_ID}_//")
        if grep -q "Error\|Failed\|✖\|×\|exit code 1\|TimeoutError" "${LOG_FILE}"; then
          echo ""
          echo "━━━ ${JOB_NAME} ━━━"
          grep -A 10 -B 5 "Error\|Failed\|✖\|×\|exit code 1\|TimeoutError" "${LOG_FILE}" | head -50
        fi
      fi
    done
  fi
fi

echo ""
echo "📂 ログファイル: ${OUTPUT_DIR}/"
echo "💡 ヒント: ログファイルをここに貼り付けるか、ファイルパスを指定してください"

