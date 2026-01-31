# Macストレージ圧迫対策: Docker/Cursorデータの外付けSSD移行とGoogleドライブバックアップ

最終更新: 2026-01-31

## 概要

Macのストレージが圧迫してきた場合、DockerとCursorのデータを外付けSSDに移動し、Googleドライブにバックアップを取る手順を説明します。

## 現状確認

### ストレージ使用状況

- **Docker**: `~/Library/Containers/com.docker.docker` → **15GB**
  - 主に `Data` ディレクトリ（15GB）
- **Cursor**: 
  - `~/Library/Application Support/Cursor` → **21GB**
    - 主に `User` ディレクトリ（19GB）
  - `~/.cursor` → **872MB**
    - 主に `projects` ディレクトリ（854MB）

**合計**: 約37GBのデータを移動可能

### 外付けSSD確認

- **マウントポイント**: `/Volumes/MySSD`
- **容量**: 931GB（ほぼ空）

## 移動手順

### 前提条件

- 外付けSSDが接続されていること
- Docker DesktopとCursorが完全に終了していること
- 十分な空き容量があること（移動先に37GB以上）

### 1. Dockerデータの移動（推奨方法: Docker Desktop UI）

Docker Desktop for Macには公式のUI設定でデータディレクトリを移動する機能があります。

#### 手順

1. **Docker Desktopを完全に終了**
   ```bash
   # Docker Desktopが起動しているか確認
   ps aux | grep -i docker
   
   # 起動している場合は終了
   # Docker Desktopメニューから「Quit Docker Desktop」を選択
   ```

2. **Docker Desktop設定を開く**
   - Docker Desktopを起動
   - Settings → Resources → Advanced
   - 「Disk image location」セクションで「Browse」をクリック
   - 外付けSSD（`/Volumes/MySSD`）を選択
   - 「Apply」をクリック

3. **移動完了を確認**
   ```bash
   # 新しい場所にデータが移動されているか確認
   ls -lh /Volumes/MySSD/Docker.raw
   
   # 元の場所が空になっているか確認（念のため）
   du -sh ~/Library/Containers/com.docker.docker/Data
   ```

**注意**: Docker DesktopのUIから移動する場合、元のデータは自動的に削除される可能性があります。事前にバックアップを取ることを推奨します。

### 2. Cursorデータの移動（シンボリックリンク方式）

Cursorは公式の移動機能がないため、シンボリックリンクを使用します。

#### 2-1. Application Supportディレクトリの移動

```bash
# 1. Cursorを完全に終了（すべてのウィンドウを閉じる）

# 2. 外付けSSDにディレクトリを作成
mkdir -p /Volumes/MySSD/Cursor

# 3. データをコピー（時間がかかります）
echo "コピー開始: Application Support..."
rsync -av --progress ~/Library/Application\ Support/Cursor/ /Volumes/MySSD/Cursor/ApplicationSupport/

# 4. コピー完了を確認
du -sh /Volumes/MySSD/Cursor/ApplicationSupport
du -sh ~/Library/Application\ Support/Cursor

# 5. 元のディレクトリをバックアップ（念のため）
mv ~/Library/Application\ Support/Cursor ~/Library/Application\ Support/Cursor.backup

# 6. シンボリックリンクを作成
ln -s /Volumes/MySSD/Cursor/ApplicationSupport ~/Library/Application\ Support/Cursor

# 7. 動作確認
ls -la ~/Library/Application\ Support/Cursor
```

#### 2-2. .cursorディレクトリの移動

```bash
# 1. 外付けSSDにディレクトリを作成
mkdir -p /Volumes/MySSD/Cursor

# 2. データをコピー
echo "コピー開始: .cursor..."
rsync -av --progress ~/.cursor/ /Volumes/MySSD/Cursor/DotCursor/

# 3. コピー完了を確認
du -sh /Volumes/MySSD/Cursor/DotCursor
du -sh ~/.cursor

# 4. 元のディレクトリをバックアップ（念のため）
mv ~/.cursor ~/.cursor.backup

# 5. シンボリックリンクを作成
ln -s /Volumes/MySSD/Cursor/DotCursor ~/.cursor

# 6. 動作確認
ls -la ~/.cursor
```

### 3. 動作確認

#### Docker確認

```bash
# Docker Desktopを起動
# コンテナが正常に起動するか確認
docker ps

# イメージが表示されるか確認
docker images
```

#### Cursor確認

```bash
# Cursorを起動
# 設定が保持されているか確認
# 拡張機能が正常に動作するか確認
# プロジェクトが開けるか確認
```

### 4. バックアップの削除（動作確認後）

動作確認が完了したら、バックアップディレクトリを削除してストレージを解放できます。

```bash
# 注意: 動作確認が完了してから実行すること

# Application Supportのバックアップを削除
rm -rf ~/Library/Application\ Support/Cursor.backup

# .cursorのバックアップを削除
rm -rf ~/.cursor.backup
```

## Googleドライブバックアップ

### バックアップ対象

以下のディレクトリをGoogleドライブにバックアップします：

1. **Dockerデータ**: `/Volumes/MySSD/Docker.raw`（移動後）
2. **Cursor Application Support**: `/Volumes/MySSD/Cursor/ApplicationSupport`
3. **Cursor .cursor**: `/Volumes/MySSD/Cursor/DotCursor`

### バックアップ方法

#### 方法1: Googleドライブアプリを使用（推奨）

1. **Googleドライブアプリをインストール**
   - [Google Drive for Desktop](https://www.google.com/drive/download/)からダウンロード

2. **バックアップフォルダを設定**
   ```bash
   # Googleドライブの同期フォルダを確認
   # 通常は ~/Google Drive または ~/Library/CloudStorage/GoogleDrive-*
   
   # バックアップ用のディレクトリを作成
   mkdir -p ~/Google\ Drive/Backups/MacStorage
   
   # シンボリックリンクを作成（Googleドライブに同期される）
   ln -s /Volumes/MySSD/Cursor ~/Google\ Drive/Backups/MacStorage/Cursor
   ```

3. **定期バックアップスクリプトを作成**

   `~/bin/backup-to-google-drive.sh`:
   ```bash
   #!/bin/bash
   set -euo pipefail
   
   BACKUP_DIR="$HOME/Google Drive/Backups/MacStorage"
   SSD_BASE="/Volumes/MySSD"
   
   echo "=== Macストレージバックアップ開始 ==="
   echo "日時: $(date)"
   
   # バックアップディレクトリが存在するか確認
   if [ ! -d "$BACKUP_DIR" ]; then
       echo "エラー: バックアップディレクトリが存在しません: $BACKUP_DIR"
       exit 1
   fi
   
   # 外付けSSDがマウントされているか確認
   if [ ! -d "$SSD_BASE" ]; then
       echo "警告: 外付けSSDがマウントされていません: $SSD_BASE"
       echo "バックアップをスキップします"
       exit 0
   fi
   
   # Cursorデータのバックアップ
   echo "Cursorデータをバックアップ中..."
   rsync -av --delete \
       "$SSD_BASE/Cursor/" \
       "$BACKUP_DIR/Cursor/"
   
   # Dockerデータのバックアップ（オプション: サイズが大きいため）
   # echo "Dockerデータをバックアップ中..."
   # rsync -av --delete \
   #     "$SSD_BASE/Docker.raw" \
   #     "$BACKUP_DIR/Docker.raw"
   
   echo "=== バックアップ完了 ==="
   echo "日時: $(date)"
   ```

4. **スクリプトに実行権限を付与**
   ```bash
   chmod +x ~/bin/backup-to-google-drive.sh
   ```

5. **定期実行の設定（launchd）**

   `~/Library/LaunchAgents/com.user.backup-storage.plist`:
   ```xml
   <?xml version="1.0" encoding="UTF-8"?>
   <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
   <plist version="1.0">
   <dict>
       <key>Label</key>
       <string>com.user.backup-storage</string>
       <key>ProgramArguments</key>
       <array>
           <string>/bin/bash</string>
           <string>-c</string>
           <string>/Users/tsudatakashi/bin/backup-to-google-drive.sh</string>
       </array>
       <key>StartCalendarInterval</key>
       <dict>
           <key>Hour</key>
           <integer>2</integer>
           <key>Minute</key>
           <integer>0</integer>
       </dict>
       <key>RunAtLoad</key>
       <false/>
   </dict>
   </plist>
   ```

6. **launchdに登録**
   ```bash
   launchctl load ~/Library/LaunchAgents/com.user.backup-storage.plist
   
   # 確認
   launchctl list | grep backup-storage
   ```

#### 方法2: rcloneを使用（上級者向け）

rcloneを使用してGoogleドライブに直接アップロードすることもできます。

```bash
# rcloneをインストール
brew install rclone

# Googleドライブを設定
rclone config

# バックアップ実行
rclone sync /Volumes/MySSD/Cursor gdrive:Backups/MacStorage/Cursor --progress
```

## トラブルシューティング

### Dockerが起動しない

1. **シンボリックリンクを確認**
   ```bash
   ls -la ~/Library/Containers/com.docker.docker/Data
   ```

2. **Docker Desktop設定を確認**
   - Settings → Resources → Advanced
   - 「Disk image location」が正しく設定されているか確認

3. **ログを確認**
   ```bash
   # Docker Desktopのログを確認
   tail -f ~/Library/Containers/com.docker.docker/Data/log/host/*.log
   ```

### Cursorが起動しない

1. **シンボリックリンクを確認**
   ```bash
   ls -la ~/Library/Application\ Support/Cursor
   ls -la ~/.cursor
   ```

2. **外付けSSDがマウントされているか確認**
   ```bash
   mount | grep MySSD
   ```

3. **権限を確認**
   ```bash
   ls -ld /Volumes/MySSD/Cursor
   ```

### シンボリックリンクが壊れた場合の復旧

```bash
# バックアップから復元
mv ~/Library/Application\ Support/Cursor.backup ~/Library/Application\ Support/Cursor
mv ~/.cursor.backup ~/.cursor

# または、外付けSSDから再コピー
rsync -av /Volumes/MySSD/Cursor/ApplicationSupport/ ~/Library/Application\ Support/Cursor/
rsync -av /Volumes/MySSD/Cursor/DotCursor/ ~/.cursor/
```

## 注意事項

1. **外付けSSDの常時接続**: シンボリックリンクを使用しているため、外付けSSDが接続されていないとCursorが正常に動作しません。

2. **Dockerデータのサイズ**: Dockerデータは非常に大きくなる可能性があります。定期的にクリーンアップを実行することを推奨します。
   ```bash
   # 未使用のイメージ・コンテナを削除
   docker system prune -a
   ```

3. **バックアップの頻度**: Googleドライブへのバックアップは、データ量に応じて時間がかかる場合があります。初回バックアップは特に時間がかかるため、夜間などに実行することを推奨します。

4. **ストレージ使用量の監視**: 定期的にストレージ使用量を確認し、必要に応じてクリーンアップを実行してください。
   ```bash
   # ストレージ使用量を確認
   df -h
   du -sh /Volumes/MySSD/*
   ```

## 参考リンク

- [Docker Desktop Settings Documentation](https://docs.docker.com/desktop/settings/mac/)
- [Cursor Documentation](https://docs.cursor.com/)
- [Google Drive for Desktop](https://www.google.com/drive/download/)
