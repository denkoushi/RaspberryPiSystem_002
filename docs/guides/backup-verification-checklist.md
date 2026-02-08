# バックアップ検証チェックリスト

最終更新: 2026-02-08

## 目的

バックアップが正常に動作していることを定期的に検証し、復旧可能性を担保する。

## 検証頻度

- **月次検証**: 毎月1回（バックアップ履歴とファイル存在確認）
- **四半期検証**: 3ヶ月に1回（リストアテスト）

## 自動検証（Pi5 systemd timer）

- 月次: `backup-verify-monthly.timer`
- 四半期: `backup-verify-quarterly.timer`

ログ確認:

```bash
sudo journalctl -u backup-verify-monthly.service -n 200
sudo journalctl -u backup-verify-quarterly.service -n 200
```

## 月次検証（毎月1回）

### 1. バックアップ履歴の確認（管理コンソール）

- [ ] すべてのバックアップ対象が正常に実行されている
- [ ] 直近1ヶ月でエラーが発生していない
- [ ] `fileStatus: EXISTS` のバックアップが最新に存在する

### 2. Dropbox上のバックアップファイル確認

- [ ] 各バックアップ対象の最新ファイルが存在する
- [ ] ファイルサイズが0ではない
- [ ] 証明書バックアップ（`/backups/directory/.../certs`）が存在する

### 3. ローカルバックアップの確認（Pi5）

- [ ] `/opt/backups/` に最新のバックアップが存在する
- [ ] データベースバックアップのgzip整合性が取れている

```bash
ls -lh /opt/backups/
gunzip -t /opt/backups/db_backup_*.sql.gz
```

## 四半期検証（3ヶ月に1回）

### 1. データベースバックアップのリストアテスト

- [ ] テスト環境で`db_backup_*.sql.gz`をリストア
- [ ] 主要テーブルが参照可能
- [ ] 代表的な画面/APIが正常に動作

### 2. 証明書ファイルのリストアテスト

- [ ] 証明書バックアップ（`tar.gz`）を展開
- [ ] Caddyを再起動しHTTPS接続が成功する

```bash
tar -xzf certs_backup_YYYYMMDD_HHMMSS.tar.gz -C /opt/RaspberryPiSystem_002/
docker compose -f infrastructure/docker/docker-compose.server.yml restart caddy
```

### 3. 環境変数ファイルのリストアテスト

- [ ] `.env`を復元してAPI再起動
- [ ] ヘルスチェックが成功する

```bash
cp /opt/backups/api_env_YYYYMMDD_HHMMSS.env /opt/RaspberryPiSystem_002/apps/api/.env
docker compose -f infrastructure/docker/docker-compose.server.yml restart api
```

## 実施記録

検証実施後、結果を以下に記録する。

- 実施日:
- 実施者:
- 主要結果:
- 問題点/対処:
- 次回予定:
