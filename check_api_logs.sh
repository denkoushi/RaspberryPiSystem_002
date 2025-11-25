#!/bin/bash

# APIログを直接確認するスクリプト
# ラズパイ5で実行してください

echo "=== APIログから429エラーと404エラーを検索 ==="
echo ""

echo "=== 429エラーのログ ==="
docker compose -f infrastructure/docker/docker-compose.server.yml logs api --tail 200 2>&1 | grep -i "429\|too many" | tail -20

echo ""
echo "=== 404エラーのログ ==="
docker compose -f infrastructure/docker/docker-compose.server.yml logs api --tail 200 2>&1 | grep -i "404\|not found" | tail -20

echo ""
echo "=== 最近のエラーログ（全般） ==="
docker compose -f infrastructure/docker/docker-compose.server.yml logs api --tail 100 2>&1 | grep -E "level\":(40|50)" | tail -20

