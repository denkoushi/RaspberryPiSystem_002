---
title: SDカードからSSDへの移行手順
tags: [運用, 移行, SSD, Raspberry Pi 5]
audience: [運用者, 開発者]
last-verified: 2025-11-27
related: [backup-and-restore.md, deployment.md]
category: guides
update-frequency: medium
---

# SDカードからSSDへの移行手順

最終更新: 2026-11-04（再構築手順を復旧Runbookへの参照に置換）

## 概要

本ドキュメントでは、Raspberry Pi 5をSDカードからSSDに移行する手順を説明します。

## 前提条件

- Raspberry Pi 5がSDカードで正常に動作していること
- 1TB以上のSSDが用意されていること
- USB接続またはNVMe接続でSSDを接続できること
- 最新のバックアップが取得済みであること

## 移行前の確認事項

### Private Pi5 Hermes の移行タイミング

Private Pi5 Hermes は、Hermes の DGX profile 復帰・Discord 定期投稿・Life Pilot の運用が安定してから SSD 移行する。Hermes 機能改善のデプロイと同日に boot 移行を重ねない。

移行時は SD カードを fallback として保管し、SSD boot 確認が終わるまで SD 側を初期化しない。

追加で退避・確認する対象:

- `/home/hermes/.hermes`
- `/home/hermes/.hermes-tools`
- `/home/hermes/.hermes-life`
- `hermes` ユーザーの systemd unit 状態と timer 状態
- Syncthing の HermesLife receive-only 設定
- ローカル inventory fragment、Discord token、DGX token、Hermes profile の secret 類

移行直前の read-only snapshot:

- `findmnt -no SOURCE,TARGET,FSTYPE,OPTIONS /` で、現在の root が SD か SSD かを記録する。
- `lsblk -o NAME,PATH,SIZE,TYPE,FSTYPE,MOUNTPOINTS,MODEL` で、移行先 SSD の device、容量、filesystem、mountpoint を記録する。NTFS 等で既に `/media/...` にマウントされている USB ディスクは、boot target として初期化してよいかを明示確認するまで触らない。
- `systemctl is-active` で `hermes-gateway.service`、`hermes-tools-gateway.service`、`hermes-dgx-keep-warm.timer`、`hermes-life-reminder.timer`、`hermes-life-proactive-morning.timer`、`hermes-life-proactive-evening.timer`、`hermes-life-followup.timer`、`hermes-life-interest-digest.timer`、`hermes-life-discord-ui.service` を記録する。
- `/home/hermes/.hermes`、`/home/hermes/.hermes-tools`、`/home/hermes/.hermes-life` の owner/mode、容量、主要サブディレクトリのファイル数を記録する。本文や token の中身は出力しない。
- Syncthing は `syncthing@hermes.service` の active 状態と、HermesLife folder の `type=receiveonly`、path `/home/hermes/.hermes-life/obsidian/HermesLife` を記録する。
- ローカル非追跡 inventory fragment と secret 類は、存在と必要キーだけ確認し、値をチャット・ログ・Git に出さない。

### 1. 現在の状態確認

```bash
# ディスク使用状況の確認
df -h

# 現在のマウントポイントの確認
mount | grep -E "mmcblk|nvme|sda"

# バックアップファイルの確認
ls -lh /opt/backups/ | tail -5
```

### 2. 最終バックアップの取得

```bash
cd /opt/RaspberryPiSystem_002
./scripts/server/backup.sh
```

最新のバックアップファイルを確認：
- `db_backup_YYYYMMDD_HHMMSS.sql.gz`
- `photos_backup_YYYYMMDD_HHMMSS.tar.gz`
- `api_env_YYYYMMDD_HHMMSS.env`（存在する場合）

## 移行手順

### ステップ1: SSDの接続と認識確認

1. **SSDをRaspberry Pi 5に接続**
   - USB接続の場合: USBポートに接続
   - NVMe接続の場合: M.2スロットに接続

2. **SSDが認識されているか確認**

```bash
# 接続されているストレージデバイスを確認
lsblk

# または
sudo fdisk -l
```

SSDが `/dev/sda` または `/dev/nvme0n1` として表示されることを確認してください。

### ステップ2: Raspberry Pi OSのインストール

1. **Raspberry Pi Imagerを使用してSSDにOSをインストール**
   - Raspberry Pi OS (64-bit) を選択
   - SSHを有効化
   - ユーザー名とパスワードを設定
   - ホスト名を設定（例: `raspberrypi`）

2. **SSDから起動するように設定**
   - Raspberry Pi 5のブートローダーを更新（必要に応じて）

### ステップ3〜9: システムの再構築とデータの復元

以前のこの節の手動手順（Docker/Node/Poetryの手動導入、`.env.example` のコピー、ホストからの `docker compose up -d db` と `pnpm prisma migrate deploy`、`docker-compose.server.yml` での全コンテナ起動）は、現行構成では成り立たない。DBの起動には Ansible が配置する `POSTGRES_SUPERUSER_PASSWORD_FILE` が必須で、DBの5432もホストへ公開されていない。API/Webは標準releaseが bluegreen project として起動する。

SSDから起動した後の再構築とデータ復元は、次の正本に従う。

- [Google Drive 全損復旧手順](../runbooks/google-drive-disaster-recovery.md#total-loss-recovery-procedure)（OS・Ansible前提、同じSHAとrelease設定の適用、隔離復元確認後のDB・ファイル復元）
- [Pi5 復旧訓練 Runbook](../runbooks/pi5-restore-drill.md)（同じ手順を訓練機で確認する場合）
- アプリの更新・反映は [デプロイ・クイックスタート](./quick-start-deployment.md) の標準経路だけを使う

### ステップ10: 動作確認

```bash
# APIヘルスチェック
curl -k https://localhost/api/system/health

# データベースのレコード数を確認
docker compose -f infrastructure/docker/docker-compose.server.yml exec db \
  psql -U postgres -d borrow_return \
  -c "SELECT COUNT(*) FROM \"Loan\";"

# 写真ファイルの確認
ls -lh storage/photos/*/ | tail -5
ls -lh storage/thumbnails/*/ | tail -5
```

### ステップ11: ブラウザでの動作確認

1. Raspberry Pi 4のブラウザで `https://<raspberry-pi-5-ip>/` にアクセス
2. ログイン画面が表示されることを確認
3. キオスク画面が正常に動作することを確認

## トラブルシューティング

### SSDが認識されない場合

```bash
# USB接続の場合
sudo dmesg | tail -20

# NVMe接続の場合
sudo lsblk | grep nvme
```

### データベースのリストアやコンテナ起動が失敗する場合

```bash
# データベースコンテナのログを確認（読み取り専用）
docker compose -f infrastructure/docker/docker-compose.server.yml logs db

# API/Web/gateway の状態を確認（読み取り専用）
docker ps -a --format '{{.Names}}\t{{.Status}}'
```

DBの再作成やコンテナの手動再ビルドは行わない。隔離ディレクトリを残したまま [全損復旧手順](../runbooks/google-drive-disaster-recovery.md#total-loss-recovery-procedure) の診断へ戻り、標準releaseの失敗は [デプロイ停止・復旧Runbook](../runbooks/deploy-status-recovery.md) に従う。

## 再起動後の手順

コンテナは restart policy により自動で起動する。手動で `docker compose up -d` しない。再起動後は「ステップ10: 動作確認」の health と `docker ps` で状態を確認する。

## 移行後の確認事項

- [ ] データベースのレコード数が移行前と同じであること
- [ ] 写真ファイルが正しくリストアされていること
- [ ] APIが正常に動作していること
- [ ] Web UIが正常に動作していること
- [ ] キオスク画面が正常に動作していること
- [ ] バックアップスクリプトが正常に動作すること
- [ ] 再起動後も正常に動作すること
- [ ] Private Pi5 Hermes の `hermes-gateway` が active であること
- [ ] `hermes-dgx-keep-warm.timer`、`hermes-life-reminder.timer`、`hermes-life-proactive-morning.timer`、`hermes-life-followup.timer` の active/inactive が移行前の設計どおりであること
- [ ] `hermes-life-proactive-evening.timer` は opt-in にしていない限り inactive であること
- [ ] `/home/hermes/.hermes-life` の notes/reminders/inbox/interest/proactive が移行前と同じ件数であること
- [ ] Syncthing の HermesLife 共有が receive-only のまま復旧していること
- [ ] SD カード fallback で元環境へ戻せることを確認するまで、旧 SD を消去しないこと

## 参考資料

- [バックアップ・リストア手順](./backup-and-restore.md)
- [デプロイメントガイド](./deployment.md)
- [監視・アラートガイド](./monitoring.md)
