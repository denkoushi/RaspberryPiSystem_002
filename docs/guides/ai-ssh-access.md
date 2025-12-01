---
title: AIアシスタントのSSHアクセスについて
tags: [AI, SSH, 開発環境, セキュリティ]
audience: [AIアシスタント, 開発者]
last-verified: 2025-12-01
related: [mac-ssh-access.md, development.md]
category: guides
update-frequency: low
---

# AIアシスタントのSSHアクセスについて

最終更新: 2025-12-01

## 概要

本ドキュメントでは、AIアシスタント（Cursor）がRaspberry Pi 5にSSH接続できるかどうか、および開発作業での活用方法について説明します。

## 現状（2025-12-01時点）

### AIアシスタントのSSH接続能力

**技術的には可能ですが、セキュリティ上の理由から推奨されません。**

**理由:**
1. **セキュリティリスク**: SSH鍵やパスワードをAIアシスタントに提供することは、セキュリティリスクを伴います
2. **アクセス制御**: AIアシスタントが直接SSH接続できると、意図しない操作が行われる可能性があります
3. **監査ログ**: AIアシスタントによる操作と人間による操作を区別することが困難です

### 推奨される開発フロー

**MacからRaspberry Pi 5へのSSH接続を経由:**

1. **ユーザーがMacからSSH接続**
   ```bash
   ssh raspi5  # または ssh denkon5sd02@192.168.128.131
   ```

2. **ユーザーがAIアシスタントに指示**
   - AIアシスタントは、ユーザーに実行すべきコマンドを提示
   - ユーザーが実際にコマンドを実行

3. **結果をAIアシスタントに共有**
   - ユーザーが実行結果をAIアシスタントに共有
   - AIアシスタントが結果を分析し、次のステップを提案

**この方法の利点:**
- ✅ セキュリティリスクが低い
- ✅ ユーザーが操作を監視できる
- ✅ 監査ログが明確
- ✅ AIアシスタントが誤操作を防げる

---

## AIアシスタントが開発を支援する方法

### 1. コマンドの提案

**AIアシスタントは、ユーザーに実行すべきコマンドを提案します:**

```bash
# AIアシスタントが提案するコマンド例
# Raspberry Pi 5で実行してください

cd /opt/RaspberryPiSystem_002
git pull origin main
docker compose -f infrastructure/docker/docker-compose.server.yml restart api
```

### 2. ログの分析

**ユーザーがログを共有すると、AIアシスタントが分析します:**

```bash
# ユーザーが実行
ssh raspi5 "cd /opt/RaspberryPiSystem_002 && docker compose -f infrastructure/docker/docker-compose.server.yml logs api --tail=100"

# 結果をAIアシスタントに共有
# AIアシスタントがエラーを分析し、解決策を提案
```

### 3. 設定ファイルの確認

**AIアシスタントは、設定ファイルの内容を確認し、修正案を提案します:**

```bash
# ユーザーが実行
ssh raspi5 "cat /opt/RaspberryPiSystem_002/infrastructure/docker/docker-compose.server.yml"

# 結果をAIアシスタントに共有
# AIアシスタントが設定を確認し、修正案を提案
```

---

## 開発作業での活用例

### 例1: コードの更新とデプロイ

**AIアシスタントが提案する手順:**

1. **Macでコードを編集・コミット・プッシュ**
   ```bash
   cd /Users/tsudatakashi/RaspberryPiSystem_002
   git add .
   git commit -m "feat: 新機能の追加"
   git push origin feature/new-feature
   ```

2. **Raspberry Pi 5で最新コードを取得**
   ```bash
   ssh raspi5 "cd /opt/RaspberryPiSystem_002 && git pull origin feature/new-feature"
   ```

3. **Dockerコンテナを再ビルド・再起動**
   ```bash
   ssh raspi5 "cd /opt/RaspberryPiSystem_002 && docker compose -f infrastructure/docker/docker-compose.server.yml up -d --build api"
   ```

### 例2: エラーの調査と解決

**AIアシスタントが提案する手順:**

1. **ログを確認**
   ```bash
   ssh raspi5 "cd /opt/RaspberryPiSystem_002 && docker compose -f infrastructure/docker/docker-compose.server.yml logs api --tail=100"
   ```

2. **エラーメッセージをAIアシスタントに共有**
   - AIアシスタントがエラーを分析
   - 解決策を提案

3. **修正を適用**
   ```bash
   # AIアシスタントが提案する修正コマンドを実行
   ssh raspi5 "cd /opt/RaspberryPiSystem_002 && ..."
   ```

### 例3: 設定ファイルの更新

**AIアシスタントが提案する手順:**

1. **設定ファイルを確認**
   ```bash
   ssh raspi5 "cat /opt/RaspberryPiSystem_002/infrastructure/docker/docker-compose.server.yml"
   ```

2. **AIアシスタントが修正案を提案**
   - 設定ファイルの修正内容を提示

3. **修正を適用**
   ```bash
   # Macで設定ファイルを編集
   # Raspberry Pi 5にコピー
   scp infrastructure/docker/docker-compose.server.yml raspi5:/opt/RaspberryPiSystem_002/infrastructure/docker/
   ```

---

## セキュリティに関する注意事項

### ⚠️ 重要な注意点

1. **SSH鍵の管理**: SSH鍵は絶対にAIアシスタントに共有しない
2. **パスワードの共有**: パスワードもAIアシスタントに共有しない
3. **実行前の確認**: AIアシスタントが提案するコマンドは、実行前に必ず確認する
4. **権限の確認**: 管理者権限が必要なコマンドは、慎重に実行する

### 推奨される運用方法

**MacからRaspberry Pi 5へのSSH接続を経由:**

- ✅ ユーザーがSSH接続を確立
- ✅ AIアシスタントがコマンドを提案
- ✅ ユーザーがコマンドを実行
- ✅ 結果をAIアシスタントに共有

**この方法により、セキュリティリスクを最小限に抑えながら、AIアシスタントの支援を受けることができます。**

---

## 関連ドキュメント

- [MacからRaspberry Pi 5へのSSH接続ガイド](./mac-ssh-access.md): MacからのSSH接続手順
- [開発ガイド](./development.md): 開発環境のセットアップと開発手順
- [運用マニュアル](./operation-manual.md): 日常的な運用手順

