---
title: バックアップ・リストア手順
tags: [運用, バックアップ, PostgreSQL, ラズパイ5]
audience: [運用者, 開発者]
last-verified: 2026-08-20
related: [monitoring.md, deployment.md]
category: guides
update-frequency: medium
---

# バックアップ・リストア手順

> 役割: 本書はバックアップ全体方針・責務分担・リストア手順の正本です。`backup.json` の設定仕様と、Dropbox対象の現行方針（2026-09-30: 秘密情報はDropbox対象外）は [バックアップ設定ガイド](./backup-configuration.md#pi5本番の現在方針2026-09-30) を正本とします。

最終更新: 2026-08-20（DropboxとGoogle Driveの責務分担、Pi4資格情報の扱い、業務Pi5全損DRを反映）

## 概要

本ドキュメントでは、Raspberry Pi 5上で動作するシステムのバックアップとリストア手順を説明します。

## バックアップ責務の分担

- **Dropbox**: 日常の個別ファイル・個別データの復元を担当します。既存のバックアップAPIと`backup.json`の契約は変更しません。`.env`、`backup.json`、証明書、端末の秘密情報はDropboxの対象外です（2026-09-30、[現在方針](./backup-configuration.md#pi5本番の現在方針2026-09-30)）。
- **Google Drive**: 業務Pi5の全損復旧（SSDまたはPi5交換）を担当します。暗号化resticスナップショットの準備、容量確認、隔離先への復元検証は [業務Pi5 Google Drive DR Runbook](../runbooks/google-drive-disaster-recovery.md) を正本とします。ライブ領域への自動復元は行いません。
- **Pi4**: 業務Pi5のGoogle Driveスナップショットには含めません。Pi4のSDカード全体は、Pi5が週1回Pi5のSSDへ保存し、Google Driveへ複製します（[Pi4 SDカード Runbook](../runbooks/pi4-sd-card-backup.md)、[ADR-20260930](../decisions/ADR-20260930-pi4-sd-card-backup.md)）。
- **認証情報**: 新しいSDやPiへ古いSSH鍵・Tailscale identity/stateを自動復元しません。必要な認証は交換先で明示的に再発行・再設定します。例外は、同じPi4キオスクのSDカードを差し替えるときに、そのキオスク自身のPi4 SDバックアップを書き戻す場合だけです（旧カードは使用停止。[ADR-20260930](../decisions/ADR-20260930-pi4-sd-card-backup.md)）。

Google Drive DRの実装は既存のTypeScriptバックアップAPI、UI、Prisma schema/migration、通常Dropbox設定とは独立した専用レーンです。完全な対象・除外・検証手順は上記Runbookを参照してください。

## バックアップ対象

### 必須バックアップ（失うと復旧困難）

1. **PostgreSQLデータベース**: すべてのデータ（従業員、アイテム、貸出履歴、トランザクション等）
   - **場所**: Dockerボリューム `db-data-pg18`（旧 `db-data` は legacy read-only。ただし、Google Drive DRでは生volumeをコピーしない）
   - **バックアップ方法**: 日常の個別復元は`scripts/server/backup.sh`、全損DRは`pg_dump -Fc --no-owner --no-acl`による専用スナップショット
   - **頻度**: 日次（推奨）
   - **保存先**: `/opt/backups/`

2. **環境変数ファイル**: `.env`ファイル（JWTシークレット、データベース接続情報等）
   - **場所**: `apps/api/.env`, `apps/web/.env`, `infrastructure/docker/.env`
   - **バックアップ方法**: Google Drive DRの暗号化スナップショット（[Runbook](../runbooks/google-drive-disaster-recovery.md#snapshot-coverage)）。`scripts/server/backup.sh`を手動実行した場合は`/opt/backups/`へローカルコピーも残る
   - **Dropbox**: 対象外（2026-09-30、[現在方針](./backup-configuration.md#pi5本番の現在方針2026-09-30))

3. **証明書ファイル**
   - **場所**: `/opt/RaspberryPiSystem_002/certs/`（コンテナ内パス: `/app/host/certs`）
   - **バックアップ方法**: Google Drive DRの暗号化スナップショット（[Runbook](../runbooks/google-drive-disaster-recovery.md#snapshot-coverage)）
   - **Dropbox**: 対象外（2026-09-30、[現在方針](./backup-configuration.md#pi5本番の現在方針2026-09-30))

4. **復旧必須の永続ファイル**
   - **場所**: `/opt/RaspberryPiSystem_002/storage/part-measurement-drawings`, `/opt/RaspberryPiSystem_002/storage/measuring-instrument-genres`, `/opt/RaspberryPiSystem_002/storage/pallet-machine-illustrations`
   - **バックアップ方法**: `scripts/server/backup.sh`でAPI経由バックアップ（`backup.json`の`directory`ターゲット）
   - **頻度**: 日次（推奨）
   - **保存先**: Dropbox（推奨）
   - **容量方針**: 小容量一次ファイルは`maxBackups: 4`。PDFは中核機能に必須ではないため、2GB Dropboxの対象外とする

5. **写真ファイル**
   - **場所**: `/opt/RaspberryPiSystem_002/storage/photos`（`thumbnails`は派生物としてGoogle Drive DRから除外）
   - **バックアップ方法**: Dropbox容量保護のため、日常運用では`image:photo-storage`を無効化し得ます。Google Drive DRでは一次写真を暗号化スナップショットへ含めます
   - **注意**: Dropboxで写真を個別復元する場合は既存設定に従い、Pi5全損時は [Google Drive DR Runbook](../runbooks/google-drive-disaster-recovery.md) の隔離復元を使用します

### 推奨バックアップ（失っても再設定可能だが時間がかかる）

1. **IPアドレス設定**
   - **場所**: `infrastructure/ansible/group_vars/all.yml`
   - **バックアップ方法**: リポジトリに含まれるため、Gitで管理
   - **頻度**: 変更時（Gitコミット）
   - **注意**: デバイスごとに異なる値が設定されているため、新しいデバイスでは再設定が必要

### デバイスごとのバックアップ対象

#### Pi5（サーバー）にのみ存在する情報

| 情報の種類 | 場所 | バックアップ | 管理方法 |
|-----------|------|------------|---------|
| **環境変数ファイル** | `apps/api/.env`, `apps/web/.env`, `infrastructure/docker/.env` | ✅ **必須** | `.env.example`をコピーして作成。Google Drive DRで保護（Dropbox対象外） |
| **証明書ファイル** | `/opt/RaspberryPiSystem_002/certs/` | ✅ **必須** | Google Drive DRで保護（Dropbox対象外） |
| **IPアドレス設定** | `infrastructure/ansible/group_vars/all.yml` | ⚠️ **推奨** | Ansible変数で管理、リポジトリに含まれる（デバイスごとに異なる値） |
| **データベース** | Dockerボリューム `db-data-pg18` | ✅ **必須** | バックアップスクリプトで自動バックアップ |
| **復旧必須の永続ファイル** | `/opt/RaspberryPiSystem_002/storage/part-measurement-drawings`, `measuring-instrument-genres`, `pallet-machine-illustrations` | ✅ **必須** | `backup.json`の`directory`ターゲット + バックアップスクリプトで自動バックアップ |
| **写真ファイル** | `/opt/RaspberryPiSystem_002/storage/photos`（`thumbnails`は派生物） | ⚠️ **Dropboxは容量次第／Google Drive DRは一次写真を含む** | Dropboxでは本番無効化し得る。全損DRはGoogle Driveスナップショットを使用 |

#### Pi4（キオスク）にのみ存在する情報

| 情報の種類 | 場所 | バックアップ | 管理方法 |
|-----------|------|------------|---------|
| **NFCエージェント設定** | `clients/nfc-agent/.env` | ⚠️ **Dropbox対象外** | 秘密情報のためDropboxへ送らない。Pi4 SDバックアップで保護し、通常はAnsibleで再構成 |
| **運用ユーザーSSH設定** | `/home/<ユーザー>/.ssh` | ❌ **バックアップ禁止** | コードのSSH authority policyにより`client-file`/`client-directory`の対象にできない。交換先で新しい鍵を明示設定 |
| **Tailscale状態** | `/var/lib/tailscale` | ⚠️ **Dropbox対象外** | 新SDや新Piへ自動復元しない。交換先で新しいidentityを明示的に発行・設定（同じキオスクのSD差し替えだけはPi4 SDバックアップから戻す） |
| **status-agent設定** | `/etc/raspi-status-agent.conf` | ⚠️ **Dropbox対象外** | 秘密情報のためDropboxへ送らない。Pi4 SDバックアップで保護し、通常はAnsibleで再構成 |
| **NFCリーダー設定** | システム設定 | ❌ 不要 | ハードウェア設定、再設定可能 |

**旧方針（2026-09-30廃止）**: Pi4キオスクの上記ファイルを`client-file`ターゲットで日次Dropboxへ保存していました。現在はDropboxの推奨対象外です（[現在方針](./backup-configuration.md#pi5本番の現在方針2026-09-30)）。`client-file`/`client-directory`の仕組み自体は残っており、クライアント端末のファイルはAnsibleでPi5へ取得してからバックアップします。

PDFの扱い、実機検証結果、Dropbox容量の復旧履歴は [KB: バックアップ・リストア関連](../knowledge-base/infrastructure/backup-restore.md#backup-restore-20260712) を正本とします。

**AnsibleとTailscale連携の詳細**:
- Ansible Playbookは`hosts: "{{ client_host }}"`で実行され、`group_vars/all.yml`の変数（`kiosk_ip`など）が正しく展開されます
- `network_mode: "tailscale"`の場合、Tailscale IP経由で接続されます
- `network_mode: "local"`の場合、ローカルネットワークIP経由で接続されます
- SSH鍵はDockerコンテナ内にマウントされ、Pi5からPi4へのSSH接続が可能です
- 詳細は [KB-102](../knowledge-base/infrastructure/backup-restore.md#kb-102-ansibleによるクライアント端末バックアップ機能実装時のansibleとtailscale連携問題) を参照してください。

#### Pi3（サイネージ）にのみ存在する情報

| 情報の種類 | 場所 | バックアップ | 管理方法 |
|-----------|------|------------|---------|
| **ブラウザ設定** | Chromium設定 | ❌ 不要 | 再設定可能 |

## バックアップ対象の決定仕様

バックアップ対象は、**バックアップAPI（`/api/backup`）**と**バックアップ設定ファイル（`backup.json`）**で管理されます。設定仕様は [バックアップ設定ガイド](./backup-configuration.md) を正本とします。

- 設定ファイルの構造: [設定ファイルの構造](./backup-configuration.md#設定ファイルの構造)
- ストレージプロバイダー: [ストレージプロバイダーの設定](./backup-configuration.md#ストレージプロバイダーの設定)（対象ごとの`storage.provider`/`storage.providers`は [KB-103](../knowledge-base/infrastructure/backup-restore.md#kb-103-バックアップ対象ごとのストレージプロバイダー指定機能実装phase-1-2)）
- バックアップ対象（`kind`/`source`）: [バックアップ対象の設定](./backup-configuration.md#バックアップ対象の設定)（`client-directory`は [KB-144](../knowledge-base/infrastructure/backup-restore.md#kb-144-バックアップ手動実行時の500エラーclient-directory-kind追加とbackupjson正規化)）
- 保持期間: [保持期間の設定](./backup-configuration.md#保持期間の設定)（対象ごとの`retention`は [KB-104](../knowledge-base/infrastructure/backup-restore.md#kb-104-バックアップ対象ごとの保持期間設定と自動削除機能実装phase-3)）
- 管理コンソール: [管理コンソールからの設定管理](./backup-configuration.md#管理コンソールからの設定管理)
- 履歴のファイル存在状態・実際のプロバイダー記録: [KB-094](../knowledge-base/infrastructure/backup-restore.md#kb-094-バックアップ履歴のファイル存在状態管理機能)、[KB-095](../knowledge-base/infrastructure/backup-restore.md#kb-095-バックアップ履歴のストレージプロバイダー記録の不整合)
- `backup.sh`との対応: [KB-106](../knowledge-base/infrastructure/backup-restore.md#kb-106-バックアップスクリプトとの整合性確認)

## バックアップ手順

### 1. データベースのバックアップ

```bash
# ラズパイ5で実行
cd /opt/RaspberryPiSystem_002

# バックアップディレクトリを作成
mkdir -p /opt/backups
BACKUP_DIR="/opt/backups"
DATE=$(date +%Y%m%d_%H%M%S)

# PostgreSQLデータベースのバックアップ
docker compose -f infrastructure/docker/docker-compose.server.yml exec -T db \
  pg_dump -U postgres borrow_return > "${BACKUP_DIR}/db_backup_${DATE}.sql"

# バックアップファイルを圧縮
gzip "${BACKUP_DIR}/db_backup_${DATE}.sql"

echo "バックアップ完了: ${BACKUP_DIR}/db_backup_${DATE}.sql.gz"
```

### 2. 環境変数ファイルのバックアップ

```bash
# 環境変数ファイルをバックアップ
cp apps/api/.env "${BACKUP_DIR}/api_env_${DATE}.env"
cp apps/web/.env "${BACKUP_DIR}/web_env_${DATE}.env" 2>/dev/null || true
cp infrastructure/docker/.env "${BACKUP_DIR}/docker_env_${DATE}.env" 2>/dev/null || true
cp clients/nfc-agent/.env "${BACKUP_DIR}/nfc_agent_env_${DATE}.env" 2>/dev/null || true
```

**重要**: 環境変数ファイルには機密情報（パスワード、APIキーなど）が含まれているため、バックアップファイルも安全に保管してください。

### 3. 証明書ファイルのバックアップ

証明書ファイルはバックアップスクリプトに含まれていないため、以下のいずれかでバックアップします。

```bash
# Pi5上で実行
# 証明書ファイルをバックアップ
tar -czf "${BACKUP_DIR}/certs_backup_${DATE}.tar.gz" -C /opt/RaspberryPiSystem_002 certs/

# USBメディアにコピー（USBメディアがマウントされている場合）
# sudo mount /dev/sda1 /mnt/usb
# cp "${BACKUP_DIR}/certs_backup_${DATE}.tar.gz" /mnt/usb/
# sudo umount /mnt/usb
```

**自動バックアップ**:
- 証明書はGoogle Drive DRの暗号化スナップショットで保護します（[Runbook](../runbooks/google-drive-disaster-recovery.md#snapshot-coverage)）。
- 証明書はDropboxの対象外です（2026-09-30、[現在方針](./backup-configuration.md#pi5本番の現在方針2026-09-30)）。`kind=directory` / `source=/app/host/certs` をDropbox向けに追加しないでください。

**重要**: 証明書ファイルを失うと、HTTPS接続ができなくなります。証明書生成時（一度だけ）に必ずバックアップを取得してください。

### 4. Dockerボリュームのバックアップ

通常は pg_dump によるバックアップを優先する。

```bash
# Dockerボリュームのバックアップ
docker run --rm \
  -v docker_db-data-pg18:/data \
  -v "${BACKUP_DIR}":/backup \
  alpine tar czf /backup/volume_db-data-pg18_${DATE}.tar.gz -C /data .
```

### 5. 自動バックアップスクリプト

`scripts/server/backup.sh`は以下の機能を提供します：

**バックアップ対象**:
- PostgreSQLデータベース
- 環境変数ファイル（`.env`）
- 写真ディレクトリ（本番ではDropbox容量保護のためAPI/Dropboxは無効化、ローカルtarのみ）
- CSVデータ（従業員・アイテム、API経由の場合）
- 復旧必須の永続ディレクトリ（部品測定図面、計測機器ジャンル画像、パレット加工機イラスト）
- PDF本体は中核機能の稼働に必須ではないため、2GB Dropboxの推奨対象外。必要に応じて再投入、ローカル媒体、または別ストレージで保護する
- 大きくなり得る領域（Hermesナレッジの `knowledge-assets` / `knowledge-git`、組立手順書の `assembly-procedure-assets`、要領書の `procedure-materials` / `procedure-videos`）も2GB Dropboxの推奨対象外。Google Drive DR（[Runbook](../runbooks/google-drive-disaster-recovery.md)）だけで保護する。要領書の `work-instruction-assets`（約1GB）は推奨カタログには残すが、本番のDropbox対象では無効化し、同じくGoogle Drive DRで保護する（2026-10-07）

**バックアップ先**:
- **ローカルディレクトリ**: `/opt/backups/`（常に実行）
- **Dropbox**: 設定ファイル（`/opt/RaspberryPiSystem_002/config/backup.json`）でDropboxが有効化されている場合、API経由で自動的にDropboxにアップロード

**動作**:
1. APIが利用可能な場合、API経由でバックアップを実行（設定ファイルのDropbox設定が自動的に使用される）
2. APIが利用できない場合、またはAPI経由のバックアップが失敗した場合、ローカルバックアップにフォールバック
3. ローカルバックアップは常に実行される（API経由のバックアップが成功しても、フォールバック用に保持）

**使用方法**:
```bash
# Pi5上で実行
cd /opt/RaspberryPiSystem_002
./scripts/server/backup.sh
```

**Dropboxへの自動アップロードを有効化する方法**:
1. 設定ファイル（`/opt/RaspberryPiSystem_002/config/backup.json`）を作成・編集
2. `storage.provider`を`"dropbox"`に設定
3. Dropboxアクセストークンを設定（詳細は [バックアップ設定ガイド](./backup-configuration.md) を参照）

設定ファイルが存在しない場合、ローカルバックアップのみ実行されます。

### 6. 定期実行

定期バックアップはAPIのバックアップスケジューラーが`backup.json`の各ターゲットの`schedule`に従って実行します。`backup.sh`をcronやtimerへ登録する必要はありません（Ansibleも登録しません）。追加すると、スケジューラーのDB/Dropboxバックアップと重なり、Dropbox容量を圧迫するおそれがあります。

## リストア手順

- **事前バックアップ（安全策）**: データベースのリストアは既定で事前バックアップを作成し、失敗時はリストアを中断する（`preBackup: true`）。
- **ドライラン**: `/api/backup/restore/dry-run` で対象・サイズ・存在確認を事前に取得できる（破壊的操作なし）。

### 推奨フロー（安全）

1. **ドライラン**で、対象パス・種類・サイズ・存在を確認する  
2. **リストア（preBackup有効）**で実行する  
3. 完了後にヘルスチェック（`/api/system/health`）と主要画面を確認する

ドライラン例:

```bash
curl -k -X POST https://<pi5>/api/backup/restore/dry-run \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <JWT_TOKEN>" \
  -d '{
    "backupPath": "/backups/database/2026-02-08T00-00-00-000Z/borrow_return.sql.gz",
    "targetKind": "database"
  }'
```

※ 例の `backupPath` は環境に合わせて置き換えてください（管理コンソールの履歴からコピーするのが確実）。

### 1. データベースのリストア

```bash
# ラズパイ5で実行
cd /opt/RaspberryPiSystem_002

# バックアップファイルを指定
BACKUP_FILE="/opt/backups/db_backup_20250101_020000.sql.gz"

# データベースをリストア
gunzip -c "${BACKUP_FILE}" | \
  docker compose -f infrastructure/docker/docker-compose.server.yml exec -T db \
  psql -U postgres -d borrow_return

echo "リストア完了"
```

### 2. 環境変数ファイルのリストア

```bash
# 環境変数ファイルをリストア
cp /opt/backups/api_env_20250101_020000.env /opt/RaspberryPiSystem_002/apps/api/.env
```

本番Pi5のAPIはblue/green構成（`docker-compose.phase3.yml`、`api-blue`/`api-green`）で動いており、`docker-compose.server.yml`の`api`サービスは使いません。反映は [デプロイメントガイド](./deployment.md) の標準経路、復旧は [deploy-status-recovery Runbook](../runbooks/deploy-status-recovery.md) に従います。稼働中APIでコマンドを実行する場合は`scripts/server/run-in-active-api.sh <command>`を使います。

### 3. 証明書ファイルのリストア

2026-09-30以降、証明書はDropboxへ保存されません。現行の世代は [Google Drive DR Runbook](../runbooks/google-drive-disaster-recovery.md#isolated-restore-check) の隔離復元から取り出します。

**Dropbox経由でのリストア（2026-09-30より前の世代のみ）**:
1. 管理コンソールの「バックアップ」タブ → 「リストア」セクション
2. 証明書ディレクトリのバックアップを選択
3. 「リストア」ボタンをクリック
4. リストア完了後、web（Caddy）を再起動

```bash
docker compose -f infrastructure/docker/docker-compose.server.yml restart web
```

**手動でのリストア**:
1. Dropboxから証明書バックアップファイル（`tar.gz`）をダウンロード
2. Pi5上で展開

```bash
tar -xzf certs_backup_YYYYMMDD_HHMMSS.tar.gz -C /opt/RaspberryPiSystem_002/
sudo chown -R denkon5sd02:denkon5sd02 /opt/RaspberryPiSystem_002/certs
docker compose -f infrastructure/docker/docker-compose.server.yml restart web
```

### 4. 画像バックアップのリストア

画像バックアップは`tar.gz`形式で保存されています。リストア時には`tar.gz`を展開して、写真ディレクトリ（`photos`）とサムネイルディレクトリ（`thumbnails`）に復元します。

**API経由でのリストア（推奨）**:

管理コンソールの「バックアップ」タブから、またはAPIエンドポイント `/api/backup/restore/from-dropbox` を使用してリストアできます：

```bash
# API経由で画像バックアップをリストア
curl -X POST https://<pi5>/api/backup/restore/from-dropbox \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <JWT_TOKEN>" \
  -d '{
    "backupPath": "/backups/image/2025-12-19T05-45-14-502Z/photo-storage",
    "targetKind": "image"
  }'
```

**手動でのリストア**:

```bash
# ラズパイ5で実行
cd /opt/RaspberryPiSystem_002

# バックアップファイルを指定
BACKUP_FILE="/opt/backups/image/2025-12-19T05-45-14-502Z/photo-storage"

# 一時ディレクトリを作成
TMP_DIR=$(mktemp -d)

# tar.gzを展開
tar -xzf "${BACKUP_FILE}" -C "${TMP_DIR}"

# 既存のディレクトリをバックアップ（安全のため）
PHOTO_STORAGE_DIR="/opt/RaspberryPiSystem_002/storage"
if [ -d "${PHOTO_STORAGE_DIR}/photos" ]; then
  mv "${PHOTO_STORAGE_DIR}/photos" "${PHOTO_STORAGE_DIR}/photos-backup-$(date +%Y%m%d_%H%M%S)"
fi
if [ -d "${PHOTO_STORAGE_DIR}/thumbnails" ]; then
  mv "${PHOTO_STORAGE_DIR}/thumbnails" "${PHOTO_STORAGE_DIR}/thumbnails-backup-$(date +%Y%m%d_%H%M%S)"
fi

# 展開されたディレクトリを目的の場所に移動
if [ -d "${TMP_DIR}/photos" ]; then
  mkdir -p "${PHOTO_STORAGE_DIR}"
  mv "${TMP_DIR}/photos" "${PHOTO_STORAGE_DIR}/photos"
fi
if [ -d "${TMP_DIR}/thumbnails" ]; then
  mkdir -p "${PHOTO_STORAGE_DIR}"
  mv "${TMP_DIR}/thumbnails" "${PHOTO_STORAGE_DIR}/thumbnails"
fi

# 一時ディレクトリを削除
rm -rf "${TMP_DIR}"

echo "画像バックアップのリストア完了"
```

**注意事項**:
- 画像バックアップは`tar.gz`形式で保存されます（JPEGファイルがそのまま含まれています）
- リストア時には既存の写真ディレクトリとサムネイルディレクトリがバックアップされ、新しいデータで上書きされます
- API経由のリストアでは、既存ディレクトリの自動バックアップが実行されます

**実機検証手順**: Dropbox経由のリストア機能の実機検証手順は [バックアップリストア機能の実機検証手順](../archive/guides/backup-restore-verification.md) を参照してください。

**エラーハンドリング**:
- Dropbox APIのレート制限エラー（429）時は自動的にリトライされます（最大5回、指数バックオフ）
- ネットワークエラー（タイムアウト、接続エラーなど）時も自動的にリトライされます
- **証明書ピニング検証失敗（500エラー）**: Dropboxが証明書を更新した場合、証明書ピニング検証が失敗しバックアップが500エラーになることがあります。この場合は、`apps/api/scripts/get-dropbox-cert-fingerprint.ts`で新しい証明書フィンガープリントを取得し、`apps/api/src/services/backup/storage/dropbox-cert-pinning.ts`に追加してください。詳細は [KB-199](../knowledge-base/infrastructure/backup-restore.md#kb-199-dropbox証明書ピニング検証失敗によるバックアップ500エラー) を参照してください
- 詳細は [バックアップエラーハンドリング改善](../archive/guides/backup-error-handling-improvements.md) を参照してください

### 5. Dockerボリュームのリストア

```bash
# Dockerボリュームをリストア
docker run --rm \
  -v docker_db-data-pg18:/data \
  -v /opt/backups:/backup \
  alpine tar xzf /backup/volume_db-data-pg18_20250101_020000.tar.gz -C /data

# Dockerコンテナを再起動
docker compose -f infrastructure/docker/docker-compose.server.yml restart db
```

## 旧式の完全リストア手順（ローカル／Dropbox互換情報）

> この節は既存のローカル／Dropbox運用との互換情報です。業務Pi5の全損時にGoogle Driveの暗号化スナップショットを使う場合は、必ず [業務Pi5 Google Drive DR Runbook](../runbooks/google-drive-disaster-recovery.md) の「隔離復元」から開始してください。復元先にライブ領域を指定したり、検証前に既存のDBボリュームを削除したりしないでください。Google Drive DRのrunnerはライブ領域を自動上書きしません。
>
> 本番Pi5のAPIはblue/green構成（`docker-compose.phase3.yml`、`api-blue`/`api-green`）で、下記の`docker-compose.server.yml`の`api`を使う手順は本番には当てはまりません。マイグレーションと反映は [デプロイメントガイド](./deployment.md) の標準経路で行います。

システム全体をリストアする場合：

```bash
# 1. Dockerコンテナを停止
cd /opt/RaspberryPiSystem_002
docker compose -f infrastructure/docker/docker-compose.server.yml down

# 2. 既存のボリュームを削除（注意：データが失われます）
docker volume rm docker_db-data-pg18

# 3. ボリュームをリストア
docker run --rm \
  -v docker_db-data-pg18:/data \
  -v /opt/backups:/backup \
  alpine tar xzf /backup/volume_db-data-pg18_20250101_020000.tar.gz -C /data

# 4. 環境変数ファイルをリストア
cp /opt/backups/api_env_20250101_020000.env /opt/RaspberryPiSystem_002/apps/api/.env

# 5. 証明書ファイルをリストア
tar -xzf /opt/backups/certs_backup_20250101_020000.tar.gz -C /opt/RaspberryPiSystem_002/
sudo chown -R denkon5sd02:denkon5sd02 /opt/RaspberryPiSystem_002/certs

# 6. Dockerコンテナを起動
docker compose -f infrastructure/docker/docker-compose.server.yml up -d

# 7. データベースマイグレーションは標準Deploy経路で適用する（docs/guides/deployment.md）

# 8. データベースをリストア
gunzip -c /opt/backups/db_backup_20250101_020000.sql.gz | \
  docker compose -f infrastructure/docker/docker-compose.server.yml exec -T db \
  psql -U postgres -d borrow_return
```

## backup.jsonが失われた場合の復元手順

`backup.json`は2026-09-30以降Dropboxの対象外で、Google Drive DRの暗号化スナップショット（`config/backup.json`）で保護されています。Dropbox上の`backup.json`は2026-09-30より前の古い世代だけです。

### 復元手順

1. **バックアップから取り出す**:
   - [Google Drive DR Runbook](../runbooks/google-drive-disaster-recovery.md#isolated-restore-check) の隔離復元で、隔離先に`config/backup.json`を復元する
   - 2026-09-30より前の世代が必要な場合だけ、Dropbox上の `/backups/file/backup.json/` 配下を使う（[KB-165](../knowledge-base/infrastructure/backup-restore.md#kb-165-dropboxからのbackupjson復元方法)）
2. **backup.jsonを復元**:
   ```bash
   # Pi5上で実行
   sudo nano /opt/RaspberryPiSystem_002/config/backup.json
   # 取り出したバックアップの内容を貼り付け
   ```
3. **スケジュールへの反映**: バックアップスケジューラーは起動時と管理コンソールからの設定保存時に`backup.json`を読み直します。本番のAPIはblue/green構成のため、`docker-compose.server.yml`の`api`は再起動しません。APIの入れ替えが必要な場合は [デプロイメントガイド](./deployment.md) の標準経路に従います。
4. **Gmail設定の復元（必要に応じて）**:
   - [KB-166](../knowledge-base/infrastructure/backup-restore.md#kb-166-gmail-oauth設定の復元方法) を参照
   - 管理コンソールの「バックアップ」タブ → 「Gmail設定」セクションからOAuth認証を実行

**関連ナレッジ**:
- [KB-165](../knowledge-base/infrastructure/backup-restore.md#kb-165-dropboxからのbackupjson復元方法)
- [KB-166](../knowledge-base/infrastructure/backup-restore.md#kb-166-gmail-oauth設定の復元方法)

## バックアップの検証

定期的にバックアップが正しく作成されているか確認：

```bash
# バックアップファイルの存在確認
ls -lh /opt/backups/

# バックアップファイルの整合性確認（gzipファイルの場合）
gunzip -t /opt/backups/db_backup_*.sql.gz

# バックアップファイルの内容確認（最初の数行）
gunzip -c /opt/backups/db_backup_*.sql.gz | head -20
```

## 注意事項

- **バックアップの保存場所**: バックアップは別のストレージ（USBメモリ、外部HDD、クラウドストレージ）にも保存することを推奨します
- **バックアップの暗号化**: 機密情報を含むバックアップは暗号化することを推奨します
- **リストア前の確認**: リストア前に現在のデータベースのバックアップを取得してください
- **テストリストア**: 定期的にテストリストアを実行し、バックアップが正しく動作することを確認してください
- **エラーハンドリング**: Dropbox APIのレート制限エラーやネットワークエラー時は自動的にリトライされます。証明書ピニング検証失敗（500エラー）の場合は、証明書フィンガープリントの更新が必要です。詳細は [KB-199](../knowledge-base/infrastructure/backup-restore.md#kb-199-dropbox証明書ピニング検証失敗によるバックアップ500エラー) と [バックアップエラーハンドリング改善](../archive/guides/backup-error-handling-improvements.md) を参照してください

---

## 関連ドキュメント

- [バックアップ設定ガイド](./backup-configuration.md): バックアップ設定ファイルの詳細
- [バックアップAPI仕様](../api/backup.md): バックアップAPIの詳細仕様
- [バックアップリストア機能の実機検証結果](../archive/guides/backup-restore-verification-results.md): 実機検証結果
- [バックアップスクリプトとの整合性確認結果](../archive/guides/backup-script-integration-verification.md): バックアップスクリプトとの整合性確認結果
- [バックアップエラーハンドリング改善](../archive/guides/backup-error-handling-improvements.md): エラーハンドリング改善の詳細
- [バックアップ対象管理UI実装計画](../requirements/backup-target-management-ui.md): 管理コンソールからのバックアップ対象管理機能の実装計画
- [業務Pi5 Google Drive DR Runbook](../runbooks/google-drive-disaster-recovery.md): Google Drive暗号化スナップショット、隔離復元、全損復旧の正本
