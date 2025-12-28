# バックアップ対象管理UI実機検証手順

最終更新: 2025-12-28（Phase 3の保持期間設定機能を追加）

## 概要

本ドキュメントでは、バックアップ対象管理UI機能の実機検証手順を説明します。

## 検証環境

- **Raspberry Pi 5**: サーバー（API/DB/Web UI）

## 前提条件

1. Pi5上でシステムが正常に動作していること
2. 管理コンソールにアクセスできること（`https://<pi5>/admin`）
3. 管理者権限でログインできること

## 検証項目

### 1. バックアップ対象の追加

#### 1.1 管理コンソールからバックアップ対象を追加

**検証手順**:

1. **管理コンソールにログイン**
   ```bash
   # ブラウザでアクセス
   https://<pi5>/admin
   ```

2. **バックアップタブを開く**
   - ナビゲーションバーから「バックアップ」をクリック
   - `/admin/backup/targets`に遷移することを確認

3. **「追加」ボタンをクリック**
   - フォームが表示されることを確認

4. **フォームに入力**
   - **種類**: `file`を選択
   - **ソース**: `/tmp/test-backup-file.txt`を入力
   - **バックアップ先**: 「システム設定を使用」を選択、または「ローカルストレージ」/「Dropbox」を選択（Phase 1-2）
   - **スケジュール**: 時刻入力フィールドに`03:00`を入力（Phase 1: 新しいUI）
   - **実行曜日**: 必要に応じて曜日ボタンを選択（未選択の場合は毎日）
   - **有効にする**: チェックを入れる

5. **「保存」ボタンをクリック**
   - 成功メッセージが表示されることを確認
   - 一覧に新しい対象が表示されることを確認

6. **設定ファイルを確認**
   ```bash
   # Pi5上で実行
   cat /opt/RaspberryPiSystem_002/config/backup.json | jq '.targets[] | select(.source == "/tmp/test-backup-file.txt")'
   ```
   - 追加した対象が設定ファイルに含まれていることを確認

**期待される結果**:
- ✅ フォームが正しく表示される
- ✅ 入力値が正しく保存される
- ✅ 一覧に新しい対象が表示される
- ✅ 設定ファイル（`backup.json`）が正しく更新される

### 2. バックアップ対象の有効/無効切り替え

#### 2.1 管理コンソールからバックアップ対象を無効化

**検証手順**:

1. **バックアップ対象一覧を開く**
   - `/admin/backup/targets`にアクセス

2. **トグルスイッチをクリック**
   - 最初の対象のチェックボックスをクリックして無効化

3. **設定が保存されることを確認**
   - ページが再読み込みされ、状態が更新されることを確認

4. **設定ファイルを確認**
   ```bash
   # Pi5上で実行
   cat /opt/RaspberryPiSystem_002/config/backup.json | jq '.targets[0].enabled'
   ```
   - `false`が返されることを確認

5. **再有効化**
   - 同じチェックボックスをクリックして再有効化
   - 設定ファイルで`enabled`が`true`になることを確認

**期待される結果**:
- ✅ トグルスイッチが正しく動作する
- ✅ 設定が即座に保存される
- ✅ 設定ファイル（`backup.json`）の`enabled`フラグが正しく更新される

### 3. バックアップ対象の削除

#### 3.1 管理コンソールからバックアップ対象を削除

**検証手順**:

1. **バックアップ対象一覧を開く**
   - `/admin/backup/targets`にアクセス

2. **削除対象を確認**
   - 先ほど追加した`/tmp/test-backup-file.txt`の対象を確認

3. **「削除」ボタンをクリック**
   - 確認ダイアログが表示されることを確認
   - 「OK」をクリック

4. **削除が完了することを確認**
   - 一覧から該当項目が削除されることを確認

5. **設定ファイルを確認**
   ```bash
   # Pi5上で実行
   cat /opt/RaspberryPiSystem_002/config/backup.json | jq '.targets[] | select(.source == "/tmp/test-backup-file.txt")'
   ```
   - 何も返されないことを確認（削除されている）

**期待される結果**:
- ✅ 確認ダイアログが表示される
- ✅ 削除が正常に完了する
- ✅ 一覧から該当項目が削除される
- ✅ 設定ファイル（`backup.json`）から該当項目が削除される

### 4. バックアップ対象の編集

#### 4.1 管理コンソールからバックアップ対象のスケジュールを編集

**検証手順**:

1. **バックアップ対象一覧を開く**
   - `/admin/backup/targets`にアクセス

2. **「編集」ボタンをクリック**
   - 最初の対象の「編集」ボタンをクリック
   - フォームが表示されることを確認

3. **スケジュールを変更**
   - **スケジュール**: `0 5 * * *`に変更（毎日5時）

4. **「保存」ボタンをクリック**
   - 成功メッセージが表示されることを確認

5. **設定ファイルを確認**
   ```bash
   # Pi5上で実行
   cat /opt/RaspberryPiSystem_002/config/backup.json | jq '.targets[0].schedule'
   ```
   - `"0 5 * * *"`が返されることを確認

**期待される結果**:
- ✅ 編集フォームが正しく表示される
- ✅ 変更が正しく保存される
- ✅ 設定ファイル（`backup.json`）の`schedule`が正しく更新される

### 5. 手動バックアップ実行

#### 5.1 管理コンソールから手動バックアップを実行

**検証手順**:

1. **バックアップ対象一覧を開く**
   - `/admin/backup/targets`にアクセス

2. **「実行」ボタンをクリック**
   - 最初の対象（データベースなど）の「実行」ボタンをクリック
   - 「実行中...」と表示されることを確認

3. **バックアップが完了することを確認**
   - 成功メッセージが表示されることを確認

4. **バックアップ履歴を確認**
   - 「履歴」ボタンをクリック
   - `/admin/backup/history`に遷移
   - 実行したバックアップが履歴に記録されていることを確認

5. **バックアップファイルを確認**
   ```bash
   # Pi5上で実行
   ls -lh /opt/backups/
   ```
   - 新しいバックアップファイルが作成されていることを確認

**期待される結果**:
- ✅ バックアップが正常に実行される
- ✅ バックアップ履歴に記録される
- ✅ バックアップファイルが作成される

### 6. backup.shスクリプトとの整合性確認

#### 6.1 管理コンソールで追加した対象がbackup.shで認識される

**検証手順**:

1. **管理コンソールでバックアップ対象を追加**
   - `/admin/backup/targets`で新しい対象を追加（例: `kind: file`, `source: /tmp/test-env-backup.env`）

2. **backup.shスクリプトを実行**
   ```bash
   # Pi5上で実行
   cd /opt/RaspberryPiSystem_002
   ./scripts/server/backup.sh
   ```

3. **API経由でバックアップが実行されることを確認**
   - スクリプトの出力に「✅ fileバックアップ成功（API経由）」が表示されることを確認

4. **バックアップファイルを確認**
   ```bash
   # Pi5上で実行
   ls -lh /opt/backups/
   ```
   - 追加した対象のバックアップファイルが作成されていることを確認

**期待される結果**:
- ✅ `backup.sh`スクリプトが新しい対象を認識する
- ✅ API経由でバックアップが実行される
- ✅ バックアップファイルが作成される

#### 6.2 管理コンソールで無効化した対象がbackup.shでスキップされる

**検証手順**:

1. **管理コンソールでバックアップ対象を無効化**
   - `/admin/backup/targets`で対象のチェックボックスをクリックして無効化

2. **backup.shスクリプトを実行**
   ```bash
   # Pi5上で実行
   cd /opt/RaspberryPiSystem_002
   ./scripts/server/backup.sh
   ```

3. **無効化された対象がスキップされることを確認**
   - スクリプトの出力に該当対象のバックアップが実行されていないことを確認

**期待される結果**:
- ✅ 無効化された対象が`backup.sh`でスキップされる
- ✅ 有効な対象のみがバックアップされる

### 7. Dropbox連携確認（オプション）

#### 7.1 Dropbox設定が有効化されている場合の動作確認

**前提条件**: Dropbox設定が有効化されていること

**検証手順**:

1. **Dropbox設定を確認**
   ```bash
   # Pi5上で実行
   cat /opt/RaspberryPiSystem_002/config/backup.json | jq '.storage.provider'
   ```
   - `"dropbox"`が返されることを確認

2. **管理コンソールでバックアップ対象を追加**
   - `/admin/backup/targets`で新しい対象を追加

3. **backup.shスクリプトを実行**
   ```bash
   # Pi5上で実行
   cd /opt/RaspberryPiSystem_002
   ./scripts/server/backup.sh
   ```

4. **Dropboxにアップロードされることを確認**
   - スクリプトの出力に「API経由でバックアップ完了」が表示されることを確認
   - Dropboxのバックアップフォルダを確認（手動またはDropbox Web UI）

**期待される結果**:
- ✅ Dropbox設定が有効化されている場合、自動的にDropboxにアップロードされる
- ✅ ローカルバックアップも同時に実行される

## トラブルシューティング

### 問題1: バックアップ対象が追加できない

**症状**: 「追加」ボタンをクリックしてもフォームが表示されない、または保存に失敗する

**確認事項**:
- ブラウザのコンソールにエラーが表示されていないか確認
- APIエンドポイント（`/api/backup/config/targets`）が正しく動作しているか確認
  ```bash
  curl -X POST https://<pi5>/api/backup/config/targets \
    -H "Authorization: Bearer <token>" \
    -H "Content-Type: application/json" \
    -d '{"kind":"file","source":"/tmp/test.txt","enabled":true}'
  ```

**対処**:
- APIサーバーのログを確認: `docker logs api`
- 設定ファイルの権限を確認: `ls -l /opt/RaspberryPiSystem_002/config/backup.json`

### 問題2: 設定ファイルが更新されない

**症状**: 管理コンソールで変更を加えても、設定ファイル（`backup.json`）が更新されない

**確認事項**:
- 設定ファイルのパスを確認: `BACKUP_CONFIG_PATH`環境変数
- ファイルの権限を確認: `ls -l /opt/RaspberryPiSystem_002/config/backup.json`
- APIサーバーのログを確認: `docker logs api`

**対処**:
- 設定ファイルの権限を修正: `chmod 600 /opt/RaspberryPiSystem_002/config/backup.json`
- APIサーバーを再起動: `docker compose restart api`

### 問題3: backup.shスクリプトが新しい対象を認識しない

**症状**: 管理コンソールで追加した対象が`backup.sh`で実行されない

**確認事項**:
- 設定ファイルの内容を確認: `cat /opt/RaspberryPiSystem_002/config/backup.json | jq '.targets'`
- `backup.sh`スクリプトがAPI経由でバックアップを実行しているか確認（スクリプトの出力を確認）

**対処**:
- APIが利用可能か確認: `curl -f http://localhost:8080/api/system/health`
- APIサーバーを再起動: `docker compose restart api`

## 関連ドキュメント

- [バックアップ対象管理UI実装計画](../requirements/backup-target-management-ui.md)
- [バックアップ・リストア手順](./backup-and-restore.md)
- [バックアップ設定ガイド](./backup-configuration.md)
