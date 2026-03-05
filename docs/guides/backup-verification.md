---
title: バックアップ機能実機検証ガイド
tags: [検証, バックアップ, 実機テスト]
audience: [運用者, 開発者]
last-verified: 2026-02-08
related: [backup-configuration.md, backup-and-restore.md]
category: guides
update-frequency: medium
---

# バックアップ機能実機検証ガイド

最終更新: 2026-03-05（KB-290・67c4de1実機検証結果、API経路・内部エンドポイント・トラブルシュート追記）

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

# APIヘルスチェック（Pi5ホストからはCaddy経由で443を使用）
curl -sk https://localhost/api/system/health
```

**期待結果**: 
- すべてのコンテナが `Up` 状態
- ヘルスチェックが `{"status":"ok"}` または `{"status":"degraded",...}` を返す（メモリ高負荷時は degraded）

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

#### 3-a. 設定ヘルスチェック（推奨）

管理コンソール（バックアップ設定の健全性表示）またはAPIで、設定の衝突/欠落を事前に検知できます。

```bash
curl -sk https://localhost/api/backup/config/health \
  -H "Authorization: Bearer <your-admin-token>"
```

### 4. 手動バックアップの実行

**方法A: 内部エンドポイント（認証不要、Pi5ホストからのみ）**

```bash
# Pi5ホストにSSH接続した状態で実行。localhost/172.x からのみ許可。
curl -sk -X POST https://localhost/api/backup/internal \
  -H "Content-Type: application/json" \
  -d '{"kind":"csv","source":"employees","metadata":{"label":"manual-verify"}}'
```

**方法B: 管理者トークンを使用**

```bash
# 1. 管理者でログインしてトークンを取得（管理画面から）
# 2. トークンを使用してバックアップを実行

TOKEN="your-admin-token"

# CSVバックアップ（従業員データ）
curl -sk -X POST https://localhost/api/backup \
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
curl -sk https://localhost/api/backup \
  -H "Authorization: Bearer ${TOKEN}"
```

**期待結果**: 
- バックアップが成功し、`{"success": true, "path": "...", "sizeBytes": ...}` が返る
- バックアップ一覧に作成したバックアップが表示される

### 5. バックアップファイルの確認

```bash
# バックアップディレクトリの確認
docker compose -f infrastructure/docker/docker-compose.server.yml exec -T api \
  ls -la /opt/backups/

# 特定のバックアップファイルの確認
docker compose -f infrastructure/docker/docker-compose.server.yml exec -T api \
  ls -lah /opt/backups/csv/*/
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

### APIヘルスチェックが失敗する（接続拒否・タイムアウト）

**症状**: `curl http://localhost:8080/api/system/health` が接続失敗（exit code 7 等）

**原因**: Pi5ではAPIはCaddy経由で443で待ち受けており、8080はコンテナ内のみでホストに露出していない。

**対処**: `curl -sk https://localhost/api/system/health` を使用する。`-s`（サイレント）、`-k`（自己署名証明書を許可）を付与。

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

### 2026-03-05: Dropbox容量不足恒久対策（KB-290）実機検証

- **検証日時**: 2026-03-05
- **デプロイブランチ**: `feat/pi4-robodrill01-firefox`（Dropbox恒久対策を含む）
- **デプロイRun ID**: `20260305-085419-3769`（Pi5のみ、`--limit server`、`state: success`）
- **検証結果**: 手動CSVバックアップ（employees）成功、Dropboxアップロード成功、履歴に`dropbox`・`COMPLETED`で記録
- **関連**: [KB-290](../knowledge-base/infrastructure/backup-restore.md#kb-290-dropbox容量不足の恒久対策チャンクアップロード自動削除再試行)

### 2026-03-05: 同一ターゲット内削除限定（67c4de1）実機検証

- **検証日時**: 2026-03-05
- **デプロイコミット**: `67c4de1`（fix: insufficient_space時の削除を同一ターゲット内に限定）
- **デプロイRun ID**: `20260305-093035-20970`（Pi5のみ、`--limit server`、`state: success`）
- **検証結果**:
  - コンテナ: api / db / web すべて Up
  - マイグレーション: up to date（35 migrations）
  - バックアップスケジューラー: 26タスク登録、Scheduler started
  - backup.json: 存在（15KB）
  - APIヘルス: `https://localhost/api/system/health` 応答（status: degraded、memory 95.5%）
  - 手動CSVバックアップ（employees）: 成功、Dropboxアップロード成功（2,996 bytes）
- **備考**: insufficient_space 時の同一ターゲット内削除は、実際に容量不足を発生させないと検証不可。バックアップ実行パス（recoverAndRetryBackupOnInsufficientSpace 含む）はデプロイ済み。
- **関連**: [KB-290](../knowledge-base/infrastructure/backup-restore.md#kb-290-dropbox容量不足の恒久対策チャンクアップロード自動削除再試行)
