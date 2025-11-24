# トラブルシューティングガイド

このドキュメントでは、システム運用中に発生した問題とその解決方法を記録しています。

## 目次

- [APIレート制限による429エラー](#apiレート制限による429エラー)
- [データベース関連の問題](#データベース関連の問題)
- [NFCエージェント関連の問題](#nfcエージェント関連の問題)

---

## APIレート制限による429エラー

### 問題の概要

キオスク画面で2秒ごとのポーリングが行われている際、APIレート制限（100リクエスト/分）に引っかかり、429 "Too Many Requests"エラーが発生する。

### 発生時期

2025-11-24

### 症状

- ブラウザコンソールに429エラーが大量に表示される
- `/api/tools/loans/active`へのリクエストが429で失敗する
- `/api/kiosk/config`へのリクエストが429で失敗する
- `/api/tools/loans/borrow`や`/api/tools/loans/return`へのリクエストが429で失敗する
- 返却一覧が表示されない、または更新されない

### 根本原因の特定プロセス

#### 1. 正常動作時点のコードとの比較

```bash
# 正常動作していた時点のコミットを確認
git log --oneline -n 20

# 正常動作時点のコードを確認
git show ef2bd7c:apps/api/src/plugins/rate-limit.ts
```

**発見事項：**
- 正常動作時点（`ef2bd7c`）では、`skip`関数は存在しなかった
- レート制限は適用されていたが、フロントエンド側で重複リクエストを防いでいたため、レート制限に引っかからなかった
- その後、`skip`関数を追加しようとしたが、`@fastify/rate-limit`の`skip`関数が期待通りに動作しなかった

#### 2. ログ分析による原因特定

```bash
# APIログを確認
docker compose -f infrastructure/docker/docker-compose.server.yml logs -f api | grep -E "429|Rate limit"
```

**発見事項：**
- `skip`関数が呼び出されていない（ログに`Rate limit skip function called`が出力されない）
- `onRequest`フックは動作しているが、`skip`関数が呼び出されていない
- `allowList`関数も呼び出されていない

#### 3. コード履歴の詳細分析

```bash
# レート制限関連のコミット履歴を確認
git log --oneline apps/api/src/plugins/rate-limit.ts

# 各コミットの変更内容を確認
git show <commit-hash>:apps/api/src/plugins/rate-limit.ts
```

**発見事項：**
- 正常動作時点では、`skip`関数は不要だった
- フロントエンド側で重複リクエストを防いでいたため、レート制限に引っかからなかった
- `@fastify/rate-limit`の`skip`関数が期待通りに動作しない問題があった

### 根本原因

1. **正常動作時点の状態**
   - `rate-limit.ts`に`skip`関数は存在しなかった
   - レート制限は適用されていたが、フロントエンド側で重複リクエストを防いでいたため、レート制限に引っかからなかった

2. **問題発生の経緯**
   - レート制限機能を追加した後、キオスクエンドポイントを除外するために`skip`関数を追加しようとした
   - しかし、`@fastify/rate-limit`の`skip`関数が期待通りに動作しなかった
   - その結果、キオスクエンドポイントにもレート制限が適用され、2秒ごとのポーリングで429エラーが発生した

### 解決方法

**最終的な解決策：ルート単位でのレート制限無効化**

キオスクエンドポイントに対して、Fastify標準の`config: { rateLimit: false }`オプションを使用してレート制限を無効化する。

#### 実装内容

**1. `apps/api/src/plugins/rate-limit.ts`**
```typescript
export async function registerRateLimit(app: FastifyInstance): Promise<void> {
  // 一般APIエンドポイント用のレート制限（デフォルト）
  await app.register(rateLimit, {
    max: 100, // 100リクエスト
    timeWindow: '1 minute', // 1分間
    skipOnError: false,
    addHeaders: {
      'x-ratelimit-limit': true,
      'x-ratelimit-remaining': true,
      'x-ratelimit-reset': true,
    },
    keyGenerator: (request) => {
      return request.ip || (Array.isArray(request.headers['x-forwarded-for'])
        ? request.headers['x-forwarded-for'][0]
        : request.headers['x-forwarded-for']) || 'unknown';
    },
  });
}
```

**2. キオスクエンドポイントのルート定義**

各キオスクエンドポイントに`config: { rateLimit: false }`を追加：

- `apps/api/src/routes/tools/loans/active.ts`
  ```typescript
  app.get('/active', { config: { rateLimit: false } }, async (request, reply) => {
    // ...
  });
  ```

- `apps/api/src/routes/tools/loans/borrow.ts`
  ```typescript
  app.post('/borrow', { config: { rateLimit: false } }, async (request) => {
    // ...
  });
  ```

- `apps/api/src/routes/tools/loans/return.ts`
  ```typescript
  app.post('/return', { config: { rateLimit: false } }, async (request) => {
    // ...
  });
  ```

- `apps/api/src/routes/kiosk.ts`
  ```typescript
  app.get('/kiosk/config', { config: { rateLimit: false } }, async () => {
    // ...
  });
  ```

### 検証方法

1. **APIログの確認**
   ```bash
   docker compose -f infrastructure/docker/docker-compose.server.yml logs -f api | grep -E "429|Rate limit"
   ```
   - 429エラーが出力されないことを確認
   - `/api/tools/loans/active`へのリクエストが200で成功することを確認

2. **ブラウザコンソールの確認**
   - 429エラーが表示されないことを確認
   - 返却一覧が正常に表示されることを確認

3. **動作確認**
   - アイテムと社員証をスキャンして貸出しが正常に動作することを確認
   - 返却操作が正常に動作することを確認

### 学んだ教訓

1. **正常動作時点のコードとの比較が重要**
   - 問題発生時は、まず正常動作していた時点のコードと比較する
   - 正常動作時点では不要だった機能を追加しようとしたことが問題の原因だった

2. **プラグインの動作確認**
   - `@fastify/rate-limit`の`skip`関数が期待通りに動作しない場合がある
   - プラグインの標準機能（`config: { rateLimit: false }`）を使用する方が確実

3. **ログ分析の重要性**
   - ログを詳細に分析することで、`skip`関数が呼び出されていないことを特定できた
   - デバッグログを追加することで、問題の原因を特定しやすくなる

4. **対処療法ではなく根本解決**
   - 同じアプローチを繰り返すのではなく、正常動作時点のコードと比較して根本原因を特定する
   - Fastify標準の機能を使用することで、確実に問題を解決できる

### 関連ファイル

- `apps/api/src/plugins/rate-limit.ts` - レート制限プラグインの設定
- `apps/api/src/routes/tools/loans/active.ts` - アクティブローン取得ルート
- `apps/api/src/routes/tools/loans/borrow.ts` - 貸出ルート
- `apps/api/src/routes/tools/loans/return.ts` - 返却ルート
- `apps/api/src/routes/kiosk.ts` - キオスク設定ルート

---

## データベース関連の問題

### アイテム・従業員が登録されていない

#### 症状

- 貸出API（`/api/tools/loans/borrow`）が404エラーを返す
- エラーメッセージ：「対象アイテムが登録されていません」または「対象従業員が登録されていません」

#### 原因

データベースにアイテムや従業員が登録されていない。

#### 解決方法

**1. データベースの状態確認**

```bash
# アイテムの確認
docker compose -f infrastructure/docker/docker-compose.server.yml exec db \
  psql -U postgres -d borrow_return \
  -c "SELECT id, name, \"nfcTagUid\" FROM \"Item\" WHERE \"nfcTagUid\" = '<UID>';"

# 従業員の確認
docker compose -f infrastructure/docker/docker-compose.server.yml exec db \
  psql -U postgres -d borrow_return \
  -c "SELECT id, \"displayName\", \"nfcTagUid\" FROM \"Employee\" WHERE \"nfcTagUid\" = '<UID>';"
```

**2. シードデータの再投入**

```bash
cd /opt/RaspberryPiSystem_002/apps/api
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/borrow_return" pnpm prisma db seed
```

**3. 実機UIDに合わせたシードデータの更新**

実機で使用しているNFCタグのUIDに合わせて、`apps/api/prisma/seed.ts`を更新する必要がある場合があります。

#### 予防策

- デプロイ時にシードデータが正しく投入されているか確認する
- 実機UIDとシードデータのUIDが一致しているか確認する

---

## NFCエージェント関連の問題

### WebSocket接続エラー

#### 症状

- ブラウザコンソールに`WebSocket connection to 'ws://localhost:7071/stream' failed: Error in connection establishment: net::ERR_CONNECTION_REFUSED`エラーが表示される

#### 原因

NFCエージェントが起動していない、またはポート7071でリッスンしていない。

#### 解決方法

**1. NFCエージェントのステータス確認**

```bash
curl http://localhost:7071/api/agent/status
```

**2. NFCエージェントのプロセス確認**

```bash
ps aux | grep nfc_agent
```

**3. ポート7071のリッスン確認**

```bash
netstat -tlnp | grep 7071
```

**4. NFCエージェントの起動**

```bash
cd /opt/RaspberryPiSystem_002/clients/nfc-agent
poetry run python -m nfc_agent
```

**5. バックグラウンドで起動する場合**

```bash
cd /opt/RaspberryPiSystem_002/clients/nfc-agent
nohup poetry run python -m nfc_agent > /tmp/nfc_agent.log 2>&1 &
```

**6. systemdサービスとして設定する場合**

```bash
# systemdサービスファイルの確認
cat /etc/systemd/system/nfc-agent.service

# サービスが存在する場合は起動
sudo systemctl start nfc-agent
sudo systemctl status nfc-agent
```

#### 予防策

- systemdサービスとして設定し、自動起動するようにする
- 監視スクリプトでNFCエージェントの状態を確認する

---

## トラブルシューティングの基本手順

### 1. 問題の症状を確認

- エラーメッセージを確認
- ブラウザコンソールのエラーを確認
- APIログを確認

### 2. 正常動作時点との比較

- Git履歴を確認して、正常動作していた時点のコードと比較
- 変更履歴を確認して、問題が発生したタイミングを特定

### 3. ログ分析

- APIログを詳細に確認
- デバッグログを追加して、問題の原因を特定

### 4. 根本原因の特定

- 対処療法ではなく、根本原因を特定する
- 正常動作時点のコードと比較して、何が変わったかを確認

### 5. 解決方法の実装

- Fastify標準の機能を使用する
- プラグインの動作を確認してから使用する

### 6. 検証

- 問題が解決したことを確認
- 他の機能に影響がないことを確認

---

## 参考資料

- [Fastify Rate Limit Documentation](https://github.com/fastify/fastify-rate-limit)
- [Fastify Route Configuration](https://www.fastify.io/docs/latest/Reference/Routes/#routes-config)
- [EXEC_PLAN.md](../../EXEC_PLAN.md) - プロジェクト全体の進捗と発見事項

