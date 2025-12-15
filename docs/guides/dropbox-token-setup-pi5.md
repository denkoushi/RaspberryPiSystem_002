# Dropboxトークン設定ガイド（Pi5実機環境）

最終更新: 2025-12-15

## 概要

本ガイドでは、MacのターミナルからRaspberry Pi 5にDropboxアクセストークンを設定する手順を説明します。

## 前提条件

- Dropboxアクセストークンを取得済み（`sl.`で始まるトークン）
- MacからPi5にSSH接続可能（Tailscale経由: `100.106.158.2`）

## 手順

### Step 1: Dropboxアクセストークンの取得

1. **Dropbox App Consoleにアクセス**
   - https://www.dropbox.com/developers/apps を開く
   - アプリを作成（または既存のアプリを選択）
   - 「Generate access token」ボタンをクリック
   - 表示されたトークンをコピー（`sl.`で始まる長い文字列）

### Step 2: Pi5の`.env`ファイルに設定

Macのターミナルから以下のコマンドを実行：

```bash
# Pi5にSSH接続して.envファイルを編集
ssh denkon5sd02@100.106.158.2

# .envファイルの場所に移動
cd /opt/RaspberryPiSystem_002/infrastructure/docker

# 既存のDROPBOX_ACCESS_TOKENを確認
grep DROPBOX_ACCESS_TOKEN .env

# トークンを設定（既存の行を置き換える場合）
# 方法1: sedコマンドで置き換え
sed -i 's/DROPBOX_ACCESS_TOKEN=.*/DROPBOX_ACCESS_TOKEN=sl.あなたのトークン/' .env

# 方法2: 直接編集（nanoエディタを使用）
nano .env
# DROPBOX_ACCESS_TOKEN=your-token-here の行を
# DROPBOX_ACCESS_TOKEN=sl.あなたのトークン に変更
# Ctrl+Oで保存、Ctrl+Xで終了

# 設定を確認
grep DROPBOX_ACCESS_TOKEN .env
```

### Step 3: APIコンテナを再起動

環境変数の変更を反映するため、APIコンテナを再起動：

```bash
# Pi5上で実行
cd /opt/RaspberryPiSystem_002
docker compose -f infrastructure/docker/docker-compose.server.yml restart api

# または、Macのターミナルから実行
ssh denkon5sd02@100.106.158.2 "cd /opt/RaspberryPiSystem_002 && docker compose -f infrastructure/docker/docker-compose.server.yml restart api"
```

### Step 4: 設定の確認

```bash
# コンテナ内の環境変数を確認
ssh denkon5sd02@100.106.158.2 "docker compose -f /opt/RaspberryPiSystem_002/infrastructure/docker/docker-compose.server.yml exec -T api env | grep DROPBOX"

# 設定ファイルでの環境変数参照を確認
ssh denkon5sd02@100.106.158.2 "docker compose -f /opt/RaspberryPiSystem_002/infrastructure/docker/docker-compose.server.yml exec -T api cat /app/config/backup.json | python3 -m json.tool | grep -A 3 accessToken"
```

### Step 5: Dropbox連携テスト

```bash
# ログインしてトークンを取得
TOKEN=$(ssh denkon5sd02@100.106.158.2 "curl -s -X POST http://localhost:8080/api/auth/login -H 'Content-Type: application/json' -d '{\"username\":\"admin\",\"password\":\"admin1234\"}' | python3 -c 'import sys, json; d=json.load(sys.stdin); print(d.get(\"accessToken\", \"\"))'")

# Dropboxストレージプロバイダーでバックアップを実行
ssh denkon5sd02@100.106.158.2 "curl -s -X POST http://localhost:8080/api/backup -H 'Content-Type: application/json' -H \"Authorization: Bearer $TOKEN\" -d '{\"kind\":\"csv\",\"source\":\"employees\",\"storage\":{\"provider\":\"dropbox\"}}' | python3 -m json.tool"
```

## ワンライナーコマンド（Macのターミナルから実行）

以下のコマンドをMacのターミナルで実行すると、Pi5の`.env`ファイルにトークンを設定できます：

```bash
# トークンを変数に設定（実際のトークンに置き換えてください）
DROPBOX_TOKEN="sl.あなたのトークン"

# Pi5の.envファイルを更新
ssh denkon5sd02@100.106.158.2 "cd /opt/RaspberryPiSystem_002/infrastructure/docker && sed -i 's/DROPBOX_ACCESS_TOKEN=.*/DROPBOX_ACCESS_TOKEN=$DROPBOX_TOKEN/' .env && grep DROPBOX_ACCESS_TOKEN .env"

# APIコンテナを再起動
ssh denkon5sd02@100.106.158.2 "cd /opt/RaspberryPiSystem_002 && docker compose -f infrastructure/docker/docker-compose.server.yml restart api"
```

## トラブルシューティング

### エラー: "Dropbox access token is required"

- `.env`ファイルに`DROPBOX_ACCESS_TOKEN`が設定されているか確認
- APIコンテナを再起動したか確認
- コンテナ内の環境変数を確認: `docker compose exec api env | grep DROPBOX`

### エラー: "Invalid access token"

- トークンが正しくコピーされているか確認（`sl.`で始まる）
- トークンに余分なスペースや改行が含まれていないか確認
- Dropbox App Consoleで新しいトークンを生成

### 設定が反映されない

- Docker Composeの環境変数はコンテナ起動時に読み込まれるため、再起動が必要
- `.env`ファイルの場所が正しいか確認（`/opt/RaspberryPiSystem_002/infrastructure/docker/.env`）

## セキュリティ注意事項

- ⚠️ **アクセストークンは機密情報です**
- `.env`ファイルは`.gitignore`に含まれていることを確認
- トークンは安全な場所に保管してください
- トークンが漏洩した場合は、Dropbox App Consoleで無効化して新しいトークンを生成してください
