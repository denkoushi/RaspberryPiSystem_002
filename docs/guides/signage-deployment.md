---
title: デジタルサイネージ機能 デプロイメントガイド
tags: [デプロイ, デジタルサイネージ, ラズパイ5]
audience: [運用者, 開発者]
last-verified: 2025-11-28
related: [../modules/signage/README.md, deployment.md]
category: guides
update-frequency: medium
---

# デジタルサイネージ機能 デプロイメントガイド

最終更新: 2025-11-28

## 概要

本ドキュメントでは、デジタルサイネージ機能を実機環境（Raspberry Pi 5）にデプロイする手順を説明します。

## 前提条件

- Raspberry Pi 5にシステムが既にセットアップ済み
- Docker & Docker Composeがインストール済み
- Gitリポジトリがクローン済み（`/opt/RaspberryPiSystem_002`）

## デプロイ手順

### 1. リポジトリの更新

```bash
cd /opt/RaspberryPiSystem_002
git pull origin feature/digital-signage  # または mainブランチにマージ後
```

### 2. データベースマイグレーションの実行

```bash
# マイグレーションの実行
docker compose -f infrastructure/docker/docker-compose.server.yml exec api pnpm prisma migrate deploy

# Prisma Clientの生成
docker compose -f infrastructure/docker/docker-compose.server.yml exec api pnpm prisma generate
```

### 3. APIコンテナの再ビルド（poppler-utils追加のため）

```bash
# APIコンテナを再ビルド
docker compose -f infrastructure/docker/docker-compose.server.yml build api

# APIコンテナを再起動
docker compose -f infrastructure/docker/docker-compose.server.yml up -d --force-recreate api
```

### 4. 動作確認

```bash
# APIヘルスチェック
curl http://localhost:8080/api/system/health

# サイネージスケジュール取得（認証不要）
curl http://localhost:8080/api/signage/schedules

# サイネージコンテンツ取得（認証不要）
curl http://localhost:8080/api/signage/content
```

### 5. 管理画面での確認

1. ブラウザで管理画面にアクセス: `https://<ラズパイ5のIP>/admin`
2. ログイン後、「サイネージ」メニューを確認
3. スケジュール設定、PDF管理、緊急表示設定が表示されることを確認

## トラブルシューティング

### マイグレーションエラー

```bash
# エラーログを確認
docker compose -f infrastructure/docker/docker-compose.server.yml logs api | grep -i migration

# データベース接続を確認
docker compose -f infrastructure/docker/docker-compose.server.yml exec api pnpm prisma db pull
```

### Prisma Client生成エラー

```bash
# Prisma Clientを手動で生成
docker compose -f infrastructure/docker/docker-compose.server.yml exec api pnpm prisma generate

# エラーログを確認
docker compose -f infrastructure/docker/docker-compose.server.yml logs api
```

### PDFページ生成が動作しない

```bash
# poppler-utilsがインストールされているか確認
docker compose -f infrastructure/docker/docker-compose.server.yml exec api which pdftoppm

# エラーログを確認
docker compose -f infrastructure/docker/docker-compose.server.yml logs api | grep -i pdf
```

## 次のステップ

デプロイ完了後、以下を実施してください：

1. **管理画面での設定**
   - スケジュールの作成
   - PDFのアップロード
   - 緊急表示の設定

2. **サイネージ表示の確認**
   - `/signage` にアクセスして表示を確認
   - 工具管理データが表示されることを確認
   - PDFが表示されることを確認（PDFアップロード後）

3. **クライアント端末のセットアップ**
   - Raspberry Pi 3/Zero2Wでのセットアップ
   - 詳細は [signage-client-setup.md](./signage-client-setup.md) を参照

## 関連ドキュメント

- [デジタルサイネージモジュール仕様書](../modules/signage/README.md)
- [クライアント端末セットアップガイド](./signage-client-setup.md)
- [デプロイメントガイド](./deployment.md)

