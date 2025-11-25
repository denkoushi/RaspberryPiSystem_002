# Dockerビルドとコード更新の仕組み

## なぜ`git pull`だけではコードが更新されないのか？

### Dockerの動作原理

1. **ビルド時**: Dockerfileの`COPY`コマンドでコードをイメージにコピー
   ```dockerfile
   COPY apps ./apps  # この時点でコードがイメージに固定される
   ```

2. **実行時**: ビルド済みのイメージからコンテナを起動
   - コンテナ内のコードは、**ビルド時にコピーされたコード**を使用
   - ローカルファイルの変更は**コンテナ内に反映されない**

### よくある間違い

```bash
# ❌ これだけではコンテナ内のコードは更新されない
git pull
docker compose restart api
```

`docker compose restart`は、**既存のイメージでコンテナを再起動するだけ**です。
ローカルファイルを更新しても、コンテナ内のコードは古いままです。

### 正しい手順

```bash
# 1. 最新のコードを取得
git pull origin main

# 2. 新しいイメージをビルド（キャッシュを使わない）
docker compose -f infrastructure/docker/docker-compose.server.yml build --no-cache api

# 3. 新しいイメージでコンテナを再起動
docker compose -f infrastructure/docker/docker-compose.server.yml restart api
```

### なぜ`--no-cache`が必要なのか？

Dockerはビルドキャッシュを使用して高速化しますが、コード変更が検出されない場合があります。
`--no-cache`を指定することで、確実に最新のコードでビルドできます。

### 確認方法

ビルド後に、コンテナ内のコードを確認：

```bash
# コンテナ内のファイルを確認
docker compose -f infrastructure/docker/docker-compose.server.yml exec api cat /app/apps/api/src/plugins/rate-limit.ts

# または、ビルドログで確認
docker compose -f infrastructure/docker/docker-compose.server.yml build api 2>&1 | grep -i "copy\|build"
```

### まとめ

- `git pull` → ローカルファイルを更新（コンテナには影響なし）
- `docker compose build` → 新しいイメージをビルド（この時点でコードがコピーされる）
- `docker compose restart` → 新しいイメージでコンテナを再起動

**重要**: コードを変更したら、必ず`docker compose build`を実行してください。

