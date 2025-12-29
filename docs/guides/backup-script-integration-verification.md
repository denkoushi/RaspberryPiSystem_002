# backup.shスクリプトとの整合性確認手順

最終更新: 2025-12-29

## 概要

本ドキュメントでは、管理コンソールで追加したバックアップ対象が`backup.sh`スクリプトで正しく認識されることを確認する手順を説明します。

## 検証環境

- **Raspberry Pi 5**: サーバー（API/DB/Web UI）
- **backup.shスクリプト**: `/opt/RaspberryPiSystem_002/scripts/server/backup.sh`

## 前提条件

- APIが起動していること（`http://localhost:8080/api/system/health`が200を返す）
- 管理コンソールにアクセスできること（`https://100.106.158.2/admin`）

## 動作原理

`backup.sh`スクリプトは以下の動作をします：

1. **APIが利用可能か確認**: `http://localhost:8080/api/system/health`にアクセス
2. **API経由でバックアップ実行**: `/api/backup/internal`エンドポイントを呼び出し
3. **設定ファイルを自動読み込み**: APIが`backup.json`を読み込んで、設定された対象に基づいてバックアップを実行
4. **フォールバック**: APIが利用できない場合、ローカルバックアップのみ実行

**重要**: 管理コンソールで追加したバックアップ対象は`backup.json`に保存されるため、`backup.sh`スクリプトからも自動的に認識されます。

## 検証項目

### 検証1: 管理コンソールで追加した対象がbackup.shで認識される

**目的**: 管理コンソールで追加したバックアップ対象が`backup.sh`スクリプトで正しくバックアップされることを確認

**検証手順**:

1. **管理コンソールでバックアップ対象を追加**
   - 管理コンソール → 「バックアップ」タブ → 「バックアップ対象」
   - 「追加」ボタンをクリック
   - 新しい対象を追加（例: `kind: csv`, `source: employees`, `schedule: "0 5 * * *"`）
   - 「保存」ボタンをクリック

2. **設定ファイルの確認**
   ```bash
   # 設定ファイルの内容を確認
   docker compose -f /opt/RaspberryPiSystem_002/infrastructure/docker/docker-compose.server.yml exec -T api cat /app/config/backup.json | jq '.targets[] | select(.kind == "csv" and .source == "employees")'
   ```
   - 追加した対象が設定ファイルに含まれていることを確認

3. **backup.shスクリプトを実行**
   ```bash
   # backup.shスクリプトを実行
   cd /opt/RaspberryPiSystem_002
   ./scripts/server/backup.sh
   ```

4. **バックアップ結果の確認**
   - スクリプトの出力で、追加した対象のバックアップが実行されていることを確認
   - バックアップ履歴ページで、追加した対象のバックアップが記録されていることを確認

**期待される結果**:
- ✅ 追加した対象のバックアップが実行される
- ✅ バックアップ履歴に記録される
- ✅ Dropbox設定が有効な場合、Dropboxにもアップロードされる

---

### 検証2: 設定ファイルの変更が即座に反映される

**目的**: 管理コンソールで設定ファイルを変更した後、`backup.sh`スクリプトで即座に反映されることを確認

**検証手順**:

1. **設定ファイルの変更前の状態を確認**
   ```bash
   # 現在の設定ファイルの内容を確認
   docker compose -f /opt/RaspberryPiSystem_002/infrastructure/docker/docker-compose.server.yml exec -T api cat /app/config/backup.json | jq '.targets | length'
   ```

2. **管理コンソールで設定を変更**
   - 管理コンソール → 「バックアップ」タブ → 「バックアップ対象」
   - 既存の対象を編集（例: スケジュールを変更、有効/無効を切り替え）
   - 「保存」ボタンをクリック

3. **設定ファイルの変更後の状態を確認**
   ```bash
   # 変更後の設定ファイルの内容を確認
   docker compose -f /opt/RaspberryPiSystem_002/infrastructure/docker/docker-compose.server.yml exec -T api cat /app/config/backup.json | jq '.targets[] | select(.kind == "csv" and .source == "employees")'
   ```
   - 変更が反映されていることを確認

4. **backup.shスクリプトを実行**
   ```bash
   # backup.shスクリプトを実行
   cd /opt/RaspberryPiSystem_002
   ./scripts/server/backup.sh
   ```

5. **変更が反映されていることを確認**
   - スクリプトの出力で、変更した設定に基づいてバックアップが実行されていることを確認
   - バックアップ履歴ページで、変更した設定に基づいてバックアップが記録されていることを確認

**期待される結果**:
- ✅ 設定ファイルの変更が即座に反映される
- ✅ `backup.sh`スクリプトが変更後の設定を使用する

---

### 検証3: ストレージプロバイダー設定の反映確認

**目的**: 管理コンソールで設定したストレージプロバイダー（Dropbox/local）が`backup.sh`スクリプトで正しく使用されることを確認

**検証手順**:

1. **管理コンソールでストレージプロバイダーを設定**
   - 管理コンソール → 「バックアップ」タブ → 「バックアップ対象」
   - 対象を編集し、ストレージプロバイダーを`dropbox`に設定
   - 「保存」ボタンをクリック

2. **設定ファイルの確認**
   ```bash
   # ストレージプロバイダー設定を確認
   docker compose -f /opt/RaspberryPiSystem_002/infrastructure/docker/docker-compose.server.yml exec -T api cat /app/config/backup.json | jq '.targets[] | select(.kind == "csv" and .source == "employees") | .storage'
   ```

3. **backup.shスクリプトを実行**
   ```bash
   # backup.shスクリプトを実行
   cd /opt/RaspberryPiSystem_002
   ./scripts/server/backup.sh
   ```

4. **バックアップ結果の確認**
   - バックアップ履歴ページで、`storageProvider: dropbox`として記録されていることを確認
   - Dropbox上にバックアップファイルがアップロードされていることを確認

**期待される結果**:
- ✅ 設定したストレージプロバイダーが使用される
- ✅ Dropbox設定が有効な場合、Dropboxにアップロードされる
- ✅ バックアップ履歴に正しい`storageProvider`が記録される

---

### 検証4: 保持期間設定の反映確認

**目的**: 管理コンソールで設定した保持期間（`days`、`maxBackups`）が`backup.sh`スクリプトで正しく使用されることを確認

**検証手順**:

1. **管理コンソールで保持期間を設定**
   - 管理コンソール → 「バックアップ」タブ → 「バックアップ対象」
   - 対象を編集し、保持期間を設定（例: `days: 7`, `maxBackups: 10`）
   - 「保存」ボタンをクリック

2. **設定ファイルの確認**
   ```bash
   # 保持期間設定を確認
   docker compose -f /opt/RaspberryPiSystem_002/infrastructure/docker/docker-compose.server.yml exec -T api cat /app/config/backup.json | jq '.targets[] | select(.kind == "csv" and .source == "employees") | .retention'
   ```

3. **複数回バックアップを実行**
   ```bash
   # backup.shスクリプトを複数回実行（保持期間を超える数のバックアップを作成）
   cd /opt/RaspberryPiSystem_002
   for i in {1..15}; do
     echo "バックアップ実行: $i回目"
     ./scripts/server/backup.sh
     sleep 5
   done
   ```

4. **自動削除の確認**
   - バックアップ履歴ページで、古いバックアップの`fileStatus`が`DELETED`になっていることを確認
   - 実際のファイル数が`maxBackups`設定値以下になっていることを確認

**期待される結果**:
- ✅ 保持期間設定が正しく反映される
- ✅ `maxBackups`設定値以上のバックアップが作成された場合、古いバックアップが自動削除される
- ✅ バックアップ履歴の`fileStatus`が`DELETED`に更新される

---

## API経由での確認（オプション）

### 設定ファイルの内容確認（API経由）

```bash
# 1. ログインしてトークンを取得
TOKEN=$(curl -s -k -X POST https://100.106.158.2/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin1234"}' | jq -r '.accessToken')

# 2. バックアップ設定を取得
curl -s -k https://100.106.158.2/api/backup/config \
  -H "Authorization: Bearer $TOKEN" | jq '.targets[] | select(.kind == "csv" and .source == "employees")'
```

---

## トラブルシューティング

### エラー: "APIが利用できません"

**原因**: APIコンテナが起動していない、またはヘルスチェックエンドポイントが応答しない

**解決策**:
```bash
# APIコンテナの状態を確認
docker compose -f /opt/RaspberryPiSystem_002/infrastructure/docker/docker-compose.server.yml ps api

# APIコンテナを起動
docker compose -f /opt/RaspberryPiSystem_002/infrastructure/docker/docker-compose.server.yml up -d api

# ヘルスチェックを確認
curl -f http://localhost:8080/api/system/health
```

### エラー: "Internal backup endpoint is only accessible from localhost"

**原因**: `/api/backup/internal`エンドポイントはlocalhostからのアクセスのみ許可されている

**解決策**:
- `backup.sh`スクリプトはPi5上で実行する必要があります
- リモートから実行する場合は、SSH経由でPi5に接続して実行してください

### 設定ファイルの変更が反映されない

**原因**: APIコンテナが設定ファイルをキャッシュしている可能性

**解決策**:
```bash
# APIコンテナを再起動
docker compose -f /opt/RaspberryPiSystem_002/infrastructure/docker/docker-compose.server.yml restart api

# 設定ファイルの内容を再確認
docker compose -f /opt/RaspberryPiSystem_002/infrastructure/docker/docker-compose.server.yml exec -T api cat /app/config/backup.json
```

---

## 検証結果の記録

検証完了後、以下の情報を記録してください：

- **検証日時**: YYYY-MM-DD HH:MM:SS
- **検証者**: 名前
- **検証結果**: ✅ 成功 / ❌ 失敗
- **検証内容**: 
  - 管理コンソールで追加した対象がbackup.shで認識される: ✅ / ❌
  - 設定ファイルの変更が即座に反映される: ✅ / ❌
  - ストレージプロバイダー設定の反映確認: ✅ / ❌
  - 保持期間設定の反映確認: ✅ / ❌
- **発見された問題**: （あれば）
- **備考**: （あれば）

---

## 関連ドキュメント

- [バックアップAPI仕様](../api/backup.md)
- [バックアップ・リストア手順](./backup-and-restore.md)
- [バックアップ設定ガイド](./backup-configuration.md)
- [バックアップ対象管理UI実装計画](../requirements/backup-target-management-ui.md)
