# バックアップエラーハンドリング改善

最終更新: 2025-12-29

## 概要

本ドキュメントでは、バックアップ・リストア機能のエラーハンドリング改善について説明します。

## 実装内容

### ✅ 完了した改善（2025-12-29）

#### 1. Dropbox APIのレート制限対応

**実装箇所**: `apps/api/src/services/backup/storage/dropbox-storage.provider.ts`

**改善内容**:
- `upload`メソッド: レート制限エラー（429）時に指数バックオフでリトライ（既存実装）
- `download`メソッド: レート制限エラー（429）時に指数バックオフでリトライ（**新規追加**）
- `delete`メソッド: レート制限エラー（429）時に指数バックオフでリトライ（**新規追加**）

**リトライロジック**:
- 最大リトライ回数: 5回
- リトライ待機時間: `Retry-After`ヘッダーが指定されている場合はその値、それ以外は指数バックオフ（2^retryCount秒、最大30秒）

#### 2. ネットワークエラー時のリトライ機能

**実装箇所**: `apps/api/src/services/backup/storage/dropbox-storage.provider.ts`

**改善内容**:
- `download`メソッド: ネットワークエラー（タイムアウト、接続エラーなど）時に指数バックオフでリトライ（**新規追加**）
- `delete`メソッド: ネットワークエラー（タイムアウト、接続エラーなど）時に指数バックオフでリトライ（**新規追加**）

**検出するネットワークエラー**:
- `ETIMEDOUT`: タイムアウト
- `ECONNRESET`: 接続リセット
- `ENOTFOUND`: DNS解決失敗
- `ECONNREFUSED`: 接続拒否
- エラーメッセージに`timeout`、`network`、`ECONN`が含まれる場合

**リトライロジック**:
- 最大リトライ回数: 5回
- リトライ待機時間: 指数バックオフ（2^retryCount秒、最大30秒）

### 実装詳細

#### `download`メソッドの改善

```typescript
async download(path: string): Promise<Buffer> {
  const fullPath = this.normalizePath(path);
  const maxRetries = 5;
  let retryCount = 0;

  while (retryCount < maxRetries) {
    try {
      return await this.handleAuthError(async () => {
        const response = await this.dbx.filesDownload({ path: fullPath });
        // ... 処理
      });
    } catch (error: unknown) {
      // レート制限エラー（429）の場合、リトライ
      if (err?.status === 429 || err?.error?.error?.['.tag'] === 'rate_limit') {
        const retryAfter = this.extractRetryAfter(err);
        const delay = this.calculateBackoffDelay(retryCount, retryAfter);
        await this.sleep(delay);
        retryCount++;
        continue;
      }
      
      // ネットワークエラーの場合、リトライ
      const isNetworkError = 
        err?.code === 'ETIMEDOUT' ||
        err?.code === 'ECONNRESET' ||
        // ... その他のネットワークエラー
      
      if (isNetworkError && retryCount < maxRetries - 1) {
        const delay = this.calculateBackoffDelay(retryCount, 0);
        await this.sleep(delay);
        retryCount++;
        continue;
      }
      
      throw error;
    }
  }
}
```

#### `delete`メソッドの改善

`download`メソッドと同様のリトライロジックを実装。

### 効果

1. **レート制限エラーへの対応**: Dropbox APIのレート制限に達した場合でも、自動的にリトライすることでバックアップ・リストアが成功する可能性が向上
2. **ネットワークエラーへの対応**: 一時的なネットワークエラー（タイムアウト、接続エラーなど）が発生した場合でも、自動的にリトライすることでバックアップ・リストアが成功する可能性が向上
3. **ログ出力の改善**: リトライ時に詳細なログを出力することで、問題の特定が容易に

### 今後の改善予定

#### 進捗表示機能（未実装）

大容量ファイルのバックアップ・リストア時の進捗表示機能は、以下の理由により今回は実装を見送りました：

1. **大規模な変更が必要**: ストレージプロバイダーインターフェースの変更、バックアップサービスの変更、APIエンドポイントの変更など、多くの箇所に影響がある
2. **優先度が低い**: 現在のバックアップ・リストア機能は正常に動作しており、進捗表示は必須機能ではない
3. **実装コストが高い**: WebSocketやServer-Sent Events（SSE）などの実装が必要

**将来の実装案**:
- WebSocketまたはSSEを使用したリアルタイム進捗通知
- バックアップ履歴APIで進捗情報を取得可能にする
- フロントエンドで進捗バーを表示

---

## 関連ドキュメント

- [バックアップ・リストア手順](./backup-and-restore.md)
- [バックアップ設定ガイド](./backup-configuration.md)
- [バックアップリストア機能の実機検証結果](./backup-restore-verification-results.md)
- [バックアップスクリプトとの整合性確認結果](./backup-script-integration-verification.md)
