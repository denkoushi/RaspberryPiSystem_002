---
title: バックアップ機能実機検証ガイド
tags: [検証, バックアップ, 実機テスト]
audience: [運用者, 開発者]
last-verified: 2025-12-14
related: [backup-configuration.md, backup-and-restore.md]
category: guides
update-frequency: medium
---

# バックアップ機能実機検証ガイド

最終更新: 2025-12-14

## 概要

本ガイドでは、実機環境（Raspberry Pi 5）でのバックアップ機能の動作確認手順を説明します。

## 前提条件

- Raspberry Pi 5にシステムがデプロイされていること
- APIサーバーが正常に動作していること
- 管理者権限を持つユーザーアカウントが存在すること

## 検証手順

### 1. デプロイ確認

```bash
# Pi5にSSH接続
ssh denkon5sd02@100.106.158.2

# コンテナの状態を確認
cd /opt/RaspberryPiSystem_002
docker compose -f infrastructure/docker/docker-compose.server.yml ps

# APIヘルスチェック
curl http://localhost:8080/api/system/health
```

**期待結果**: 
- すべてのコンテナが `Up` 状態
- ヘルスチェックが `{"status":"ok"}` を返す

### 2. バックアップスケジューラーの起動確認

```bash
# APIログでバックアップスケジューラーの起動を確認
docker compose -f infrastructure/docker/docker-compose.server.yml logs api | grep -i "BackupScheduler"
```

**期待結果**: 
- `[BackupScheduler] Scheduler started` が表示される
- 4つのタスク（database, csv-employees, csv-items, image-photo-storage）が登録されている

### 3. バックアップ設定の確認

```bash
# 設定ファイルの存在確認
docker compose -f infrastructure/docker/docker-compose.server.yml exec -T api \
  cat /opt/RaspberryPiSystem_002/config/backup.json 2>/dev/null || \
  echo "Config file does not exist (using default)"
```

**期待結果**: 
- 設定ファイルが存在する場合は内容が表示される
- 存在しない場合はデフォルト設定が使用される（ログに警告が表示される）

### 4. 手動バックアップの実行

管理者トークンを取得してバックアップを実行：

```bash
# 1. 管理者でログインしてトークンを取得（管理画面から）
# 2. トークンを使用してバックアップを実行

TOKEN="your-admin-token"

# CSVバックアップ（従業員データ）
curl -X POST http://localhost:8080/api/backup \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TOKEN}" \
  -d '{
    "kind": "csv",
    "source": "employees",
    "metadata": {
      "label": "manual-test"
    }
  }'

# バックアップ一覧の取得
curl http://localhost:8080/api/backup \
  -H "Authorization: Bearer ${TOKEN}"
```

**期待結果**: 
- バックアップが成功し、`{"success": true, "path": "...", "sizeBytes": ...}` が返る
- バックアップ一覧に作成したバックアップが表示される

### 5. バックアップファイルの確認

```bash
# バックアップディレクトリの確認
docker compose -f infrastructure/docker/docker-compose.server.yml exec -T api \
  ls -la /opt/RaspberryPiSystem_002/backups/

# 特定のバックアップファイルの確認
docker compose -f infrastructure/docker/docker-compose.server.yml exec -T api \
  ls -lah /opt/RaspberryPiSystem_002/backups/backups/csv/*/
```

**期待結果**: 
- バックアップディレクトリが作成されている
- バックアップファイルが存在し、サイズが0より大きい

### 6. スケジュールバックアップの確認

スケジュールされた時間にバックアップが実行されることを確認：

```bash
# ログを監視（別ターミナルで実行）
docker compose -f infrastructure/docker/docker-compose.server.yml logs -f api | grep -i backup

# または、過去のログを確認
docker compose -f infrastructure/docker/docker-compose.server.yml logs api | \
  grep -E "BackupScheduler|BackupService|backup.*success"
```

**期待結果**: 
- スケジュールされた時間にバックアップが実行される
- ログに `[BackupScheduler] Backup executed successfully` が表示される

### 7. Dropbox連携の確認（オプション）

Dropbox連携が設定されている場合：

```bash
# 設定ファイルでDropboxプロバイダーが設定されているか確認
docker compose -f infrastructure/docker/docker-compose.server.yml exec -T api \
  cat /opt/RaspberryPiSystem_002/config/backup.json | grep -i dropbox

# バックアップ実行後、Dropboxにファイルがアップロードされているか確認
# （Dropboxアカウントで確認）
```

**期待結果**: 
- Dropboxプロバイダーが設定されている場合、バックアップがDropboxにアップロードされる
- Dropboxアカウントでファイルが確認できる

## トラブルシューティング

### バックアップスケジューラーが起動しない

**症状**: ログに `[BackupScheduler] Scheduler started` が表示されない

**対処**:
1. APIコンテナのログを確認
2. エラーメッセージを確認
3. 設定ファイルの形式が正しいか確認

### バックアップが実行されない

**症状**: スケジュールされた時間にバックアップが実行されない

**対処**:
1. cron形式のスケジュールが正しいか確認
2. `enabled: true` が設定されているか確認
3. APIサーバーのタイムゾーンを確認

### バックアップファイルが作成されない

**症状**: バックアップが成功したが、ファイルが存在しない

**対処**:
1. ストレージプロバイダーの設定（`basePath`）を確認
2. ファイルシステムの権限を確認
3. ディスク容量を確認

### Dropboxへのアップロードが失敗する

**症状**: Dropboxへのバックアップが失敗する

**対処**:
1. アクセストークンが正しく設定されているか確認
2. Dropboxアプリの権限（scopes）が正しいか確認
3. ネットワーク接続を確認
4. APIログでエラーメッセージを確認

## 検証チェックリスト

- [ ] デプロイが正常に完了した
- [ ] バックアップスケジューラーが起動した
- [ ] デフォルト設定が読み込まれた（または設定ファイルが正しく読み込まれた）
- [ ] 手動バックアップが成功した
- [ ] バックアップファイルが作成された
- [ ] バックアップ一覧が正しく表示された
- [ ] スケジュールバックアップが実行された（時間を待つか、スケジュールを変更して確認）
- [ ] Dropbox連携が動作した（設定されている場合）

## 検証結果の記録

検証完了後、以下の情報を記録してください：

- **検証日時**: 
- **デプロイブランチ**: 
- **検証者**: 
- **検証結果**: 
- **発見した問題**: 
- **改善提案**: 
