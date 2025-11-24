# /api/imports/jobs の429エラー デバッグログ

最終更新: 2025-11-24

## 問題の概要

`/api/imports/jobs`エンドポイントで429エラーが発生している。`config: { rateLimit: false }`を設定しているにもかかわらず、レート制限が適用されている。

## 確認事項

1. APIログで429エラーが発生しているか確認
2. `/api/imports/jobs`エンドポイントに`config: { rateLimit: false }`が正しく設定されているか確認
3. レート制限プラグインが正しく動作しているか確認

## ログ確認コマンド

```bash
# APIログを確認（429エラーを検索）
docker compose -f infrastructure/docker/docker-compose.server.yml logs api | grep -E "429|imports/jobs|Rate limit"

# リアルタイムでログを確認
docker compose -f infrastructure/docker/docker-compose.server.yml logs -f api

# レート制限関連のログを確認
docker compose -f infrastructure/docker/docker-compose.server.yml logs api | grep -i "rate"
```

## 確認すべきポイント

1. `/api/imports/jobs`へのリクエストが429エラーを返しているか
2. レート制限プラグインが正しく動作しているか
3. `config: { rateLimit: false }`が正しく認識されているか

