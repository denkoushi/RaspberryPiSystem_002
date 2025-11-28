---
title: デジタルサイネージ機能 デプロイメント - Step 1: リポジトリ更新
tags: [デプロイ, デジタルサイネージ, ラズパイ5]
audience: [運用者, 開発者]
last-verified: 2025-11-28
related: [signage-deployment.md]
category: guides
update-frequency: medium
---

# Step 1: リポジトリの更新

## 実行コマンド

```bash
# Raspberry Pi 5で実行
cd /opt/RaspberryPiSystem_002

# feature/digital-signageブランチを取得
git fetch origin feature/digital-signage

# ブランチをチェックアウト（またはmainブランチにマージ済みの場合はmainをpull）
git checkout feature/digital-signage
# または
# git pull origin main  # mainブランチにマージ済みの場合

# 最新の変更を確認
git log --oneline -5
```

## 確認事項

- [ ] `git fetch`が成功したか
- [ ] ブランチが正しくチェックアウトされたか
- [ ] 最新のコミットが含まれているか（cf23ee9以降のコミット）

## 次のステップ

Step 1が完了したら、Step 2（マイグレーション実行）に進みます。

