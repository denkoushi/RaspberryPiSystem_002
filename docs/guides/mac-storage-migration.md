# Macストレージ圧迫対策: Docker/Cursorデータの外付けSSD移行とGoogleドライブバックアップ

最終更新: 2026-02-10

## 概要

Macのストレージが圧迫してきた場合、DockerとCursorのデータを外付けSSDに移動し、Googleドライブにバックアップを取る手順を説明します。

## 現状確認

### ストレージ使用状況

- **Docker**: `~/Library/Containers/com.docker.docker`（目安: 10〜数十GB）
- **Cursor**:
  - `~/Library/Application Support/Cursor`（目安: 数GB〜数十GB）
  - `~/.cursor`（目安: 数百MB〜数GB）

#### 実測例（2026-02-10）

- **Docker Desktop**: `~/Library/Containers/com.docker.docker` → **16GB**
  - 実体は `~/Library/Containers/com.docker.docker/Data/vms/0/data/Docker.raw`
- **Cursor**:
  - `~/Library/Application Support/Cursor` → **25GB**
    - 主因は `User/globalStorage`（例: **約23GB**）
  - `~/.cursor` → **約1GB**
- **移行後の空き容量（例）**: 内蔵の空きが **約9.6GiB → 約54GiB** まで回復（Cursor+Dockerの移行とバックアップ削除後）

**合計**: 約37GBのデータを移動可能

### 外付けSSD確認

- **マウントポイント（例）**: `/Volumes/SSD01`
- **容量**: 931GB（目安）

以降の手順では、外付けSSDのマウントポイントを `SSD_BASE="/Volumes/SSD01"` として説明します。

## 移動手順

### 前提条件

- 外付けSSDが接続されていること
- Docker DesktopとCursorが完全に終了していること
- 十分な空き容量があること（移動先に37GB以上）
- **重要**: Cursorのデータ切替（`mv`/`ln -s`）は Cursor を完全終了してから行う必要があります。**Cursor内ターミナルで手順を進めている場合、切替フェーズは外部ターミナル（Terminal.app/iTerm等）に切り替えること**（CursorをQuitするとターミナルも閉じるため）。

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
   - 外付けSSD（例: `/Volumes/SSD01`）配下を選択（例: `/Volumes/SSD01/DockerDesktop`）
   - 「Apply」をクリック

3. **移動完了を確認**
   ```bash
   SSD_BASE="/Volumes/SSD01"

   # 新しい場所にデータが移動されているか確認（例）
   ls -lh "$SSD_BASE/DockerDesktop/DockerDesktop/Docker.raw"
   
   # 元の場所が空になっているか確認（念のため）
   du -sh ~/Library/Containers/com.docker.docker

   # 注意: Docker.rawはスパースファイルのため、`ls -lh` だと「1.0T」等と見える場合があります。
   # 実使用量は `du -sh`（またはDocker Desktop UIの表示）を参照してください。

   # 参考: DockerがSSD上のDocker.rawを参照しているかを確認（起動後）
   ps aux | grep -F "com.docker.virtualization" | grep -F -- "--disk $SSD_BASE" | head -n 1
   ```

**注意**: Docker DesktopのUIから移動する場合、元のデータは自動的に削除される可能性があります。事前にバックアップを取ることを推奨します。

### 2. Cursorデータの移動（シンボリックリンク方式）

Cursorは公式の移動機能がないため、シンボリックリンクを使用します。

#### 2-1. Application Supportディレクトリの移動

```bash
# 1. Cursorを完全に終了（すべてのウィンドウを閉じる）

# 2. 外付けSSDにディレクトリを作成
SSD_BASE="/Volumes/SSD01"
mkdir -p "$SSD_BASE/MacOffload/Cursor/ApplicationSupport"

# 3. データをコピー（時間がかかります）
echo "コピー開始: Application Support..."
rsync -a --progress \
  "$HOME/Library/Application Support/Cursor/" \
  "$SSD_BASE/MacOffload/Cursor/ApplicationSupport/"

# 補足: macOS標準のrsyncは古い場合があり、`--info=progress2` が使えないことがあります。
# その場合は本手順どおり `--progress` を使うか、`brew install rsync` で新しいrsyncを入れてください。

# 4. コピー完了を確認
du -sh "$SSD_BASE/MacOffload/Cursor/ApplicationSupport"
du -sh ~/Library/Application\ Support/Cursor

# 5. 元のディレクトリをバックアップ（念のため、タイムスタンプ推奨）
ts="$(date +%Y%m%d-%H%M%S)"
mv "$HOME/Library/Application Support/Cursor" "$HOME/Library/Application Support/Cursor.backup.$ts"

# 6. シンボリックリンクを作成
ln -s "$SSD_BASE/MacOffload/Cursor/ApplicationSupport" "$HOME/Library/Application Support/Cursor"

# 7. 動作確認
ls -la ~/Library/Application\ Support/Cursor
```

#### 2-2. .cursorディレクトリの移動

```bash
# 1. 外付けSSDにディレクトリを作成
SSD_BASE="/Volumes/SSD01"
mkdir -p "$SSD_BASE/MacOffload/Cursor/DotCursor"

# 2. データをコピー
echo "コピー開始: .cursor..."
rsync -a --progress \
  "$HOME/.cursor/" \
  "$SSD_BASE/MacOffload/Cursor/DotCursor/"

# 3. コピー完了を確認
du -sh "$SSD_BASE/MacOffload/Cursor/DotCursor"
du -sh ~/.cursor

# 4. 元のディレクトリをバックアップ（念のため、タイムスタンプ推奨）
ts="$(date +%Y%m%d-%H%M%S)"
mv "$HOME/.cursor" "$HOME/.cursor.backup.$ts"

# 5. シンボリックリンクを作成
ln -s "$SSD_BASE/MacOffload/Cursor/DotCursor" "$HOME/.cursor"

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
# まずバックアップ名を確認（タイムスタンプ付きの場合）
ls -ld "$HOME/Library/Application Support/Cursor.backup."* "$HOME/.cursor.backup."* 2>/dev/null || true

# Application Supportのバックアップを削除（例: タイムスタンプ付きバックアップを全削除）
rm -rf "$HOME/Library/Application Support/Cursor.backup."*

# .cursorのバックアップを削除（例: タイムスタンプ付きバックアップを全削除）
rm -rf "$HOME/.cursor.backup."*

# 空き容量確認
df -h /System/Volumes/Data
```

## Googleドライブバックアップ

### バックアップ対象

以下のディレクトリをGoogleドライブにバックアップします：

1. **Dockerデータ**（移動後）: 例 `/Volumes/SSD01/DockerDesktop/DockerDesktop/Docker.raw`
2. **Cursor Application Support**: 例 `/Volumes/SSD01/MacOffload/Cursor/ApplicationSupport`
3. **Cursor .cursor**: 例 `/Volumes/SSD01/MacOffload/Cursor/DotCursor`

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
   ln -s /Volumes/SSD01/MacOffload/Cursor ~/Google\ Drive/Backups/MacStorage/Cursor
   ```

3. **定期バックアップスクリプトを作成**

   `~/bin/backup-to-google-drive.sh`:
   ```bash
   #!/bin/bash
   set -euo pipefail
   
   BACKUP_DIR="$HOME/Google Drive/Backups/MacStorage"
   SSD_BASE="/Volumes/SSD01"
   
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
rclone sync /Volumes/SSD01/MacOffload/Cursor gdrive:Backups/MacStorage/Cursor --progress
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
   - 移行直後に `docker` が `NOT_READY` になる場合は、Docker Desktopを一度Quitして起動し直すと復帰することがあります。

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
   mount | grep SSD01
   ```

3. **権限を確認**
   ```bash
   ls -ld /Volumes/SSD01/MacOffload/Cursor
   ```

### シンボリックリンクが壊れた場合の復旧

```bash
# バックアップから復元
# タイムスタンプ付きバックアップから戻す（例）
mv "$HOME/Library/Application Support/Cursor.backup.<timestamp>" "$HOME/Library/Application Support/Cursor"
mv "$HOME/.cursor.backup.<timestamp>" "$HOME/.cursor"

# または、外付けSSDから再コピー
rsync -a --progress /Volumes/SSD01/MacOffload/Cursor/ApplicationSupport/ "$HOME/Library/Application Support/Cursor/"
rsync -a --progress /Volumes/SSD01/MacOffload/Cursor/DotCursor/ "$HOME/.cursor/"
```

### `rsync: unrecognized option '--info=progress2'` が出る

macOS標準rsyncが古い可能性があります。`--info=progress2` を使わず、`--progress` を使ってください（本書の手順は `--progress` に統一）。

### ターミナルが `dquote>` で止まる

貼り付け中にクォートが崩れて「続き入力待ち」になっています。

1. `Ctrl + C` で抜ける
2. **1行コマンドは1行まるごと**貼り付けてEnter（途中で改行/変換を入れない）

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
   du -sh /Volumes/SSD01/*
   ```

## 参考リンク

- [Docker Desktop Settings Documentation](https://docs.docker.com/desktop/settings/mac/)
- [Cursor Documentation](https://docs.cursor.com/)
- [Google Drive for Desktop](https://www.google.com/drive/download/)
