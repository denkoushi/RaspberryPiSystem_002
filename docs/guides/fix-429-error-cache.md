# 429エラーとキャッシュ問題の解決方法

## 問題の症状

- `GET /api/imports/jobs`へのリクエストが続く（このエンドポイントは削除済み）
- `POST /api/imports/master`で429エラーが発生
- ブラウザが古いJavaScriptバンドルをキャッシュしている

## 解決手順

### 1. ラズパイ5でWebサーバーを再ビルド

`docker compose restart`だけでは新しいコードが反映されません。**必ず再ビルドが必要**です：

```bash
cd /opt/RaspberryPiSystem_002
git pull origin main
docker compose -f infrastructure/docker/docker-compose.server.yml build web
docker compose -f infrastructure/docker/docker-compose.server.yml up -d web
```

### 2. APIサーバーも再起動（念のため）

```bash
docker compose -f infrastructure/docker/docker-compose.server.yml restart api
```

### 3. ブラウザのキャッシュをクリア

#### 方法1: ハードリロード（推奨）
- **Windows/Linux**: `Ctrl + Shift + R`
- **Mac**: `Cmd + Shift + R`

#### 方法2: 開発者ツールから
1. 開発者ツール（F12）を開く
2. ネットワークタブを開く
3. 「キャッシュを無効にする」にチェックを入れる
4. ページをリロード

#### 方法3: ブラウザの設定から
- Chrome/Edge: 設定 → プライバシーとセキュリティ → 閲覧履歴データの削除
- 「キャッシュされた画像とファイル」を選択して削除

### 4. 動作確認

1. ブラウザのコンソール（F12）を開く
2. ネットワークタブで`/api/imports/jobs`へのリクエストが**発生していない**ことを確認
3. CSVファイルをアップロードして、429エラーが**発生しない**ことを確認

## トラブルシューティング

### まだ429エラーが出る場合

1. **APIサーバーのログを確認**：
   ```bash
   docker compose -f infrastructure/docker/docker-compose.server.yml logs api | grep -i "rate limit"
   ```

2. **Webサーバーのビルドが成功したか確認**：
   ```bash
   docker compose -f infrastructure/docker/docker-compose.server.yml logs web
   ```

3. **ブラウザのキャッシュを完全にクリア**：
   - シークレット/プライベートモードで開いて試す
   - または、ブラウザの設定から「すべてのデータを削除」

### ビルドに時間がかかる場合

初回ビルドは時間がかかります（5-10分程度）。ビルド中は待機してください。

## 根本原因

- **Webサーバー**: Dockerイメージが古いビルドをキャッシュしている
- **ブラウザ**: JavaScriptバンドルをキャッシュしている
- **APIサーバー**: レート制限の設定が正しく反映されていない可能性

## 予防策

今後、フロントエンドのコードを変更した場合は：
1. `docker compose build web`を実行してから再起動
2. ブラウザのキャッシュをクリアする習慣をつける

