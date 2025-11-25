# 問題診断: 改善が確認できない原因の特定

## アーキテクチャの確認

- **Raspberry Pi 5**: サーバー（API、データベース、Web UI）
  - 管理画面（ダッシュボード、履歴、従業員管理、アイテム管理）は**ラズパイ5**のWebアプリ
  - URL: `http://<ラズパイ5のIP>:4173/admin/*`

- **Raspberry Pi 4**: クライアント（キオスク画面 + NFCリーダー）
  - キオスク画面（貸出・返却）は**ラズパイ4**のブラウザで表示
  - URL: `http://<ラズパイ5のIP>:4173/kiosk`

## 確認すべき点

### 1. 管理画面はどこでアクセスしているか？

**質問**: 管理画面（ダッシュボード、履歴、従業員管理、アイテム管理）はどこでアクセスしていますか？
- ラズパイ5のブラウザ？
- ラズパイ4のブラウザ？
- PCのブラウザ？

### 2. 実際に発生しているエラー

**質問**: 具体的にどのエラーが発生していますか？
- 429エラー（Too Many Requests）？
- 404エラー（Not Found）？
- 削除ができない？
- インポートができない？

### 3. ブラウザのキャッシュ

**質問**: ブラウザのキャッシュを完全にクリアしましたか？
- 開発者ツール（F12）→ Networkタブ → "Disable cache"にチェック
- または、シークレットモードでアクセス

### 4. Webアプリのビルド確認

ラズパイ5で以下を実行して、実際にビルドされたJavaScriptファイルを確認：

```bash
# Webコンテナ内のJavaScriptファイルを確認
docker compose -f infrastructure/docker/docker-compose.server.yml exec web sh -c 'grep -r "tools/transactions" /srv/site/assets/*.js | head -3'

# 古いエンドポイントが残っていないか確認
docker compose -f infrastructure/docker/docker-compose.server.yml exec web sh -c 'grep -r "api/transactions" /srv/site/assets/*.js | head -3'
```

### 5. APIエンドポイントの確認

ラズパイ5で以下を実行して、APIが正しく動作しているか確認：

```bash
# APIのヘルスチェック
curl http://localhost:8080/api/system/health

# 従業員一覧（レート制限が無効になっているか確認）
curl -H "Authorization: Bearer <TOKEN>" http://localhost:8080/api/tools/employees

# 履歴（404エラーが発生しないか確認）
curl -H "Authorization: Bearer <TOKEN>" http://localhost:8080/api/tools/transactions
```

## 診断手順

1. **ブラウザの開発者ツール（F12）を開く**
   - Networkタブで実際のリクエストを確認
   - どのエンドポイントにリクエストが送られているか確認
   - レスポンスのステータスコードを確認

2. **ラズパイ5のWebコンテナのログを確認**
   ```bash
   docker compose -f infrastructure/docker/docker-compose.server.yml logs web --tail=50
   ```

3. **ラズパイ5のAPIコンテナのログを確認**
   ```bash
   docker compose -f infrastructure/docker/docker-compose.server.yml logs api --tail=50
   ```

4. **実際のJavaScriptファイルの内容を確認**
   ```bash
   docker compose -f infrastructure/docker/docker-compose.server.yml exec web sh -c 'cat /srv/site/assets/index-*.js | grep -o "tools/transactions" | head -1'
   ```

